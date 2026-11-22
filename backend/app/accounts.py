"""Accounts (P39): users, magic-link login, sessions, league ownership, Telegram links and usage events, in one SQLite
file (data/app.db). Every token (login, session, Telegram link) is stored as its SHA-256 hash, so a copy of the database
can't be used to sign in. Admins are the emails listed in ADMIN_EMAILS (comma-separated)."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

LOGIN_TTL = 15 * 60
SESSION_TTL = 30 * 24 * 3600
LINK_TTL = 10 * 60
SEEN_EVERY = 60
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
# (event kind, key column, max count, window seconds)
LIMITS = {
    "login_email": [("email", 3, 15 * 60), ("ip", 10, 3600)],
    "tg_link": [("user_id", 5, 3600)],
    "tg_sent": [("user_id", 100, 24 * 3600)],
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, created_at REAL NOT NULL,
  last_seen REAL, prefs TEXT, tg_chat_id INTEGER UNIQUE, tg_name TEXT);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT, user_id INTEGER, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS leagues (league_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (at REAL NOT NULL, kind TEXT NOT NULL, user_id INTEGER, email TEXT, ip TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
CREATE INDEX IF NOT EXISTS leagues_user ON leagues (user_id);
"""


class RateLimited(Exception):
    """Too many requests of one kind in the window."""


def _hash(token: str) -> str:
    """The stored form of a token."""
    return hashlib.sha256(token.encode()).hexdigest()


def admin_emails() -> set[str]:
    """The admin emails from ADMIN_EMAILS, lower-cased."""
    return {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}


def normalize_email(email: str) -> str:
    """The email lower-cased and trimmed; ValueError when it doesn't look like one."""
    email = (email or "").strip().lower()
    if len(email) > 254 or not EMAIL.match(email):
        raise ValueError("Enter a valid email address")
    return email


class Accounts:
    """The accounts database. One connection shared across threads behind a lock (sqlite3 serializes writes anyway)."""

    def __init__(self, path: Path | str) -> None:
        """Open (and create) the database at `path`; ":memory:" for tests."""
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(SCHEMA)

    def _q(self, sql: str, *args) -> list[sqlite3.Row]:
        """Run one statement and return its rows."""
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _one(self, sql: str, *args):
        """The first column of the first row, or None."""
        rows = self._q(sql, *args)
        return rows[0][0] if rows else None

    # --- usage events and rate limits ---

    def log(self, kind: str, user_id: int | None = None, email: str | None = None, ip: str | None = None) -> None:
        """Record one usage event (the admin stats and the rate limits count these)."""
        self._q("INSERT INTO events (at, kind, user_id, email, ip) VALUES (?, ?, ?, ?, ?)", time.time(), kind, user_id, email, ip)

    def check_limit(self, kind: str, **keys) -> None:
        """RateLimited when an event of `kind` would go over one of its LIMITS for the given keys (email / ip / user_id)."""
        for col, cap, window in LIMITS.get(kind, []):
            if keys.get(col) is None:
                continue
            n = self._one(f"SELECT COUNT(*) FROM events WHERE kind = ? AND {col} = ? AND at > ?", kind, keys[col], time.time() - window)
            if n >= cap:
                raise RateLimited(f"Too many requests, try again in {window // 60} minutes")

    # --- login and sessions ---

    def request_login(self, email: str, ip: str | None) -> str:
        """A single-use login token for `email` (valid LOGIN_TTL); RateLimited past 3 per email per 15 min or 10 per IP per hour."""
        email = normalize_email(email)
        self.check_limit("login_email", email=email, ip=ip)
        token = secrets.token_urlsafe(32)
        self._q("INSERT INTO tokens (hash, kind, email, expires) VALUES (?, 'login', ?, ?)", _hash(token), email, time.time() + LOGIN_TTL)
        self.log("login_email", email=email, ip=ip)
        return token

    def verify_login(self, token: str, ip: str | None = None) -> tuple[str, dict] | None:
        """Use a login token: (session token, user), creating the user on first sign-in; None when unknown, used or expired."""
        h = _hash(token or "")
        rows = self._q("DELETE FROM tokens WHERE hash = ? AND kind = 'login' RETURNING email, expires", h)
        if not rows or rows[0]["expires"] < time.time():
            return None
        email = rows[0]["email"]
        now = time.time()
        new = self._one("SELECT id FROM users WHERE email = ?", email) is None
        if new:
            self._q("INSERT INTO users (email, created_at, last_seen) VALUES (?, ?, ?)", email, now, now)
        user = self.user_by_email(email)
        session = secrets.token_urlsafe(32)
        self._q("INSERT INTO tokens (hash, kind, user_id, expires) VALUES (?, 'session', ?, ?)", _hash(session), user["id"], now + SESSION_TTL)
        self.log("signup" if new else "login", user_id=user["id"], ip=ip)
        self._q("DELETE FROM tokens WHERE expires < ?", now)
        return session, user

    def user_for_session(self, session: str | None) -> dict | None:
        """The signed-in user for a session token (last_seen refreshed at most once a minute), or None."""
        if not session:
            return None
        rows = self._q("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ? AND t.kind = 'session' AND t.expires > ?",
                       _hash(session), time.time())
        if not rows:
            return None
        user = self._user(rows[0])
        if (user["last_seen"] or 0) < time.time() - SEEN_EVERY:
            self._q("UPDATE users SET last_seen = ? WHERE id = ?", time.time(), user["id"])
        return user

    def logout(self, session: str | None) -> None:
        """End a session."""
        self._q("DELETE FROM tokens WHERE hash = ? AND kind = 'session'", _hash(session or ""))

    def _user(self, row: sqlite3.Row) -> dict:
        """A users row as a dict, with `admin` from ADMIN_EMAILS."""
        return {**dict(row), "admin": row["email"] in admin_emails()}

    def user(self, user_id: int) -> dict | None:
        """A user by id."""
        rows = self._q("SELECT * FROM users WHERE id = ?", user_id)
        return self._user(rows[0]) if rows else None

    def user_by_email(self, email: str) -> dict | None:
        """A user by email."""
        rows = self._q("SELECT * FROM users WHERE email = ?", email)
        return self._user(rows[0]) if rows else None

    # --- league ownership ---

    def owner(self, league_id: str) -> int | None:
        """The user who owns a league, or None."""
        return self._one("SELECT user_id FROM leagues WHERE league_id = ?", league_id)

    def own(self, league_id: str, user_id: int) -> None:
        """Make `user_id` the owner of a league."""
        self._q("INSERT OR REPLACE INTO leagues (league_id, user_id) VALUES (?, ?)", league_id, user_id)

    def disown(self, league_id: str) -> None:
        """Forget a league's owner (the league was deleted)."""
        self._q("DELETE FROM leagues WHERE league_id = ?", league_id)

    def owned(self, user_id: int) -> list[str]:
        """The ids of the leagues a user owns, sorted."""
        return [r[0] for r in self._q("SELECT league_id FROM leagues WHERE user_id = ? ORDER BY league_id", user_id)]

    def claim_unowned(self, league_ids: list[str], user_id: int) -> list[str]:
        """Give every league in `league_ids` that has no owner to `user_id` (the single-user data from before accounts)."""
        claimed = [lid for lid in league_ids if self.owner(lid) is None]
        for lid in claimed:
            self.own(lid, user_id)
        return claimed

    # --- notification settings and Telegram ---

    def prefs(self, user_id: int) -> dict:
        """A user's saved notification settings (raw; the caller fills defaults)."""
        raw = self._one("SELECT prefs FROM users WHERE id = ?", user_id)
        return json.loads(raw) if raw else {}

    def set_prefs(self, user_id: int, prefs: dict) -> None:
        """Save a user's notification settings."""
        self._q("UPDATE users SET prefs = ? WHERE id = ?", json.dumps(prefs), user_id)

    def link_token(self, user_id: int) -> str:
        """A single-use Telegram link token for the bot's /start (valid LINK_TTL); RateLimited past 5 an hour."""
        self.check_limit("tg_link", user_id=user_id)
        token = secrets.token_urlsafe(24)
        self._q("INSERT INTO tokens (hash, kind, user_id, expires) VALUES (?, 'link', ?, ?)", _hash(token), user_id, time.time() + LINK_TTL)
        self.log("tg_link", user_id=user_id)
        return token

    def consume_link(self, token: str, chat_id: int, name: str | None) -> dict | None:
        """Link the Telegram chat that sent /start <token> to the token's user (moving it off any other account); None when
        the token is unknown, used or expired. Only the person holding that Telegram account can send from its chat, so
        nobody can link a chat that isn't theirs."""
        rows = self._q("DELETE FROM tokens WHERE hash = ? AND kind = 'link' RETURNING user_id, expires", _hash(token or ""))
        if not rows or rows[0]["expires"] < time.time():
            return None
        uid = rows[0]["user_id"]
        self._q("UPDATE users SET tg_chat_id = NULL, tg_name = NULL WHERE tg_chat_id = ?", chat_id)
        self._q("UPDATE users SET tg_chat_id = ?, tg_name = ? WHERE id = ?", chat_id, name, uid)
        self.log("tg_linked", user_id=uid)
        return self.user(uid)

    def unlink_chat(self, chat_id: int) -> int | None:
        """Unlink a Telegram chat (/stop, or the bot was blocked); the user it was linked to, or None."""
        uid = self._one("SELECT id FROM users WHERE tg_chat_id = ?", chat_id)
        self._q("UPDATE users SET tg_chat_id = NULL, tg_name = NULL WHERE tg_chat_id = ?", chat_id)
        return uid

    def user_id_for_chat(self, chat_id: int) -> int | None:
        """The user a Telegram chat is linked to, or None."""
        return self._one("SELECT id FROM users WHERE tg_chat_id = ?", chat_id)

    def unlink_user(self, user_id: int) -> None:
        """Unlink a user's Telegram chat (from Settings)."""
        self._q("UPDATE users SET tg_chat_id = NULL, tg_name = NULL WHERE id = ?", user_id)

    def unlink_all(self) -> int:
        """Unlink every Telegram chat (the bot changed: a new bot can't message chats that never started it); how many."""
        n = self._one("SELECT COUNT(*) FROM users WHERE tg_chat_id IS NOT NULL")
        self._q("UPDATE users SET tg_chat_id = NULL, tg_name = NULL")
        return int(n or 0)

    # --- server settings (admin) ---

    def setting(self, key: str) -> str | None:
        """A server setting, None when never set."""
        return self._one("SELECT value FROM settings WHERE key = ?", key)

    def set_setting(self, key: str, value: str) -> None:
        """Save a server setting."""
        self._q("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value)

    # --- admin stats ---

    def stats(self) -> dict:
        """Counts for the admin panel: users, activity, leagues, Telegram, sign-ins and pushes, sign-ups per day for 14 days,
        and the 100 most recently seen users."""
        now, day, admins = time.time(), 24 * 3600, admin_emails()

        def count(sql: str, *args) -> int:
            """A COUNT(*) query's number."""
            return int(self._one(sql, *args) or 0)

        def events(kind: str, since: float) -> int:
            """How many events of a kind since a time."""
            return count("SELECT COUNT(*) FROM events WHERE kind = ? AND at > ?", kind, since)

        by_day = {r[0]: r[1] for r in self._q(
            "SELECT date(created_at, 'unixepoch') d, COUNT(*) FROM users WHERE created_at > ? GROUP BY d", now - 14 * day)}
        days = [time.strftime("%Y-%m-%d", time.gmtime(now - k * day)) for k in range(13, -1, -1)]
        recent = self._q("""SELECT u.email, u.created_at, u.last_seen, u.tg_chat_id IS NOT NULL tg, COUNT(l.league_id) leagues
                            FROM users u LEFT JOIN leagues l ON l.user_id = u.id GROUP BY u.id ORDER BY u.last_seen DESC LIMIT 100""")
        return {
            "users": count("SELECT COUNT(*) FROM users"),
            "admins": count(f"SELECT COUNT(*) FROM users WHERE email IN ({','.join('?' * len(admins))})", *admins) if admins else 0,
            "new_7d": count("SELECT COUNT(*) FROM users WHERE created_at > ?", now - 7 * day),
            "active_24h": count("SELECT COUNT(*) FROM users WHERE last_seen > ?", now - day),
            "active_7d": count("SELECT COUNT(*) FROM users WHERE last_seen > ?", now - 7 * day),
            "leagues": count("SELECT COUNT(*) FROM leagues"),
            "telegram_linked": count("SELECT COUNT(*) FROM users WHERE tg_chat_id IS NOT NULL"),
            "sent_24h": events("tg_sent", now - day),
            "sent_7d": events("tg_sent", now - 7 * day),
            "logins_24h": events("login", now - day) + events("signup", now - day),
            "login_emails_24h": events("login_email", now - day),
            "signups_by_day": [{"day": d, "n": by_day.get(d, 0)} for d in days],
            "recent": [{"email": r["email"], "created_at": r["created_at"], "last_seen": r["last_seen"],
                        "telegram": bool(r["tg"]), "leagues": r["leagues"], "role": "admin" if r["email"] in admins else "user"}
                       for r in recent],
        }
