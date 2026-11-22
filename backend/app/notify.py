"""Telegram notifications: the in-season watch list (GTD / OUT / swap / lock calls), the lineup moves (Sleeper lineup ->
best lineup) before the tip they must beat, and injury-tag changes on your roster (a player now OUT, now GTD / DTD, or
cleared). Which kinds go out, and the win chance a lock call must add, are each user's Notifications settings
(accounts.prefs, Settings > Notifications). No roster-illegal pushes: the user can still move players then.

Each user links their own Telegram chat (P39): Settings asks for a one-time link (POST /notify/link), the user opens
t.me/<bot>?start=<token> and taps Start, and the bot thread reads the /start <token> from that user's own chat, so a chat can
only be linked by whoever holds that Telegram account. /stop in the chat, Unlink in Settings, or Telegram refusing a send
(the user blocked the bot) unlinks it. Each league's alerts go to its owner's chat.

Setup: put TELEGRAM_BOT_TOKEN in backend/.env (see README.md, Telegram notifications); `python -m app.serve` then starts the
watcher and bot threads, logging to data/cache/notify.log. Test delivery alone with: python -m app.notify <chat id> "hello"
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from nba_fantasy_shared.reconcile.names import normalize_name

from .accounts import RateLimited
from .core.api.deps import get_state

log = logging.getLogger(__name__)
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
POLL_S = 60
QUIET_S = 15 * 60
HOT_BEFORE_S = 2 * 3600
MOVE_LEAD_MIN = 30
TELEGRAM = "https://api.telegram.org/bot{}/{}"
BOT_POLL_S = 50
DOUBT_TAGS = {"GTD", "DTD", "Questionable", "Doubtful"}
OUT_TAGS = {"Out", "Suspended", "Sus", "IR"}
_UNSEEN = object()
NEWS_MIN_SHIFT_DAYS = 3
NL = "\n"


class NotifyPrefs(BaseModel):
    """Which pushes to send. lock_min_wpa: a lock call goes out only when locking adds at least this many points of win
    chance over leaving the game open (0 = every lock call)."""
    lock: bool = True
    lock_min_wpa: int = Field(0, ge=0, le=100)
    swap: bool = True
    out: bool = True
    dtd: bool = True
    cleared: bool = True
    moves: bool = True


def read_prefs(accounts, user_id: int) -> dict:
    """A user's saved Notifications settings, defaults for anything unset or unreadable."""
    try:
        return NotifyPrefs.model_validate(accounts.prefs(user_id)).model_dump()
    except ValueError:
        return NotifyPrefs().model_dump()


def write_prefs(accounts, user_id: int, prefs: NotifyPrefs) -> dict:
    """Save a user's Notifications settings; the watcher reads them on its next poll."""
    accounts.set_prefs(user_id, prefs.model_dump())
    return prefs.model_dump()


def load_env(path: Path = ENV_FILE) -> None:
    """Read KEY=VALUE lines from the .env file into os.environ (real environment variables win)."""
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.partition("=")
            if sep and not k.lstrip().startswith("#"):
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def configured() -> bool:
    """Whether the bot token is set."""
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN"))


def _redact(exc: Exception) -> str:
    """An error message with the bot token blanked: requests puts the request URL, token included, in its messages."""
    return str(exc).replace(os.environ.get("TELEGRAM_BOT_TOKEN") or "\0", "<token>")


def _call(method: str, http_timeout: float = 10, **params):
    """One Telegram Bot API call; its `result`, or ValueError with Telegram's description when it refuses."""
    r = requests.get(TELEGRAM.format(os.environ["TELEGRAM_BOT_TOKEN"], method), params=params, timeout=http_timeout).json()
    if not r.get("ok"):
        raise ValueError(r.get("description") or "Telegram refused the call")
    return r.get("result") if r.get("result") is not None else {}


def send(text: str, chat_id: int | None, accounts=None) -> bool:
    """Send a Telegram message to one chat; False (logged) when unconfigured, over the user's daily cap, or Telegram
    refuses. With `accounts`: the send counts toward the admin stats and the cap, and a 403 (the user blocked the bot or
    deleted the chat) unlinks the chat."""
    if not configured() or chat_id is None:
        return False
    uid = accounts.user_id_for_chat(chat_id) if accounts is not None else None
    if accounts is not None:
        try:
            accounts.check_limit("tg_sent", user_id=uid)
        except RateLimited:
            log.warning("telegram daily cap hit for user %s", uid)
            return False
    try:
        r = requests.post(TELEGRAM.format(os.environ["TELEGRAM_BOT_TOKEN"], "sendMessage"),
                          json={"chat_id": chat_id, "text": text}, timeout=10)
        if r.status_code == 403 and accounts is not None:
            accounts.unlink_chat(chat_id)
            log.info("telegram chat of user %s unlinked: bot blocked", uid)
            return False
        r.raise_for_status()
        if accounts is not None:
            accounts.log("tg_sent", user_id=uid)
        return True
    except requests.RequestException as exc:
        log.warning("telegram send failed: %s", _redact(exc))
        return False


_bot: dict = {}


def bot_username() -> str | None:
    """The bot's @username from getMe (asked once), None while Telegram can't be reached."""
    if "username" not in _bot:
        try:
            _bot["username"] = _call("getMe").get("username")
        except (requests.RequestException, ValueError) as exc:
            log.warning("telegram getMe failed: %s", _redact(exc))
            return None
    return _bot["username"]


def status(user: dict) -> dict:
    """Whether Telegram alerts exist on this server, the bot's username, and the name of the chat this user linked."""
    if not configured():
        return {"configured": False}
    return {"configured": True, "bot": bot_username(), "linked": user.get("tg_chat_id") is not None, "chat": user.get("tg_name")}


def chat_name(chat: dict) -> str | None:
    """A Telegram chat's display name: first + last name, else @username."""
    return " ".join(x for x in (chat.get("first_name"), chat.get("last_name")) if x) or (f"@{chat['username']}" if chat.get("username") else None)


def handle_update(accounts, update: dict) -> str | None:
    """Answer one message to the bot: /start <token> links this chat to the token's account, /stop unlinks it, anything
    else gets the how-to. Only private chats are linked. Returns the reply (the caller sends it), None to stay quiet."""
    msg = update.get("message") or {}
    chat, text = msg.get("chat") or {}, (msg.get("text") or "").strip()
    if chat.get("type") != "private" or chat.get("id") is None:
        return None
    if text.startswith("/start "):
        user = accounts.consume_link(text.split(None, 1)[1].strip(), chat["id"], chat_name(chat))
        if user is None:
            return "That link is used or expired. In the app, open Settings > Notifications and tap Link Telegram again."
        return f"Linked to {user['email']}. Your league alerts will come here. Send /stop to turn them off."
    if text == "/stop":
        return "Alerts are off for this chat." if accounts.unlink_chat(chat["id"]) else "This chat isn't linked to an account."
    return "To get alerts here, open the app's Settings > Notifications and tap Link Telegram."


TOKEN_SETTING = "telegram_bot_token"
TOKEN_FORMAT = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")


def apply_token(accounts) -> None:
    """Use the bot token the admin set in the app (accounts setting; "" = removed) over the one from backend/.env."""
    saved = accounts.setting(TOKEN_SETTING)
    if saved is None:
        return
    if saved:
        os.environ["TELEGRAM_BOT_TOKEN"] = saved
    else:
        os.environ.pop("TELEGRAM_BOT_TOKEN", None)
    _bot.clear()


def check_token(token: str) -> str:
    """The bot's @username for a token (Telegram's getMe); ValueError when the token is malformed or Telegram refuses it.
    Errors never carry the token."""
    if not TOKEN_FORMAT.match(token or ""):
        raise ValueError("That doesn't look like a bot token (it's like 123456789:AA... from @BotFather)")
    try:
        r = requests.get(TELEGRAM.format(token, "getMe"), timeout=10).json()
    except (requests.RequestException, ValueError) as exc:
        raise ValueError("Couldn't reach Telegram, try again") from exc
    if not r.get("ok"):
        raise ValueError("Telegram didn't accept that token")
    return r["result"].get("username")


def set_token(accounts, token: str | None) -> dict:
    """Admin: switch the bot (None or "" removes it). Every linked chat is unlinked, since a different bot can't message
    people who never pressed Start in it; the same token again changes nothing. Returns the bot's username and how
    many chats were unlinked."""
    token = (token or "").strip()
    bot = check_token(token) if token else None
    if token == (os.environ.get("TELEGRAM_BOT_TOKEN") or ""):
        return {"bot": bot, "unlinked": 0}
    unlinked = accounts.unlink_all()
    accounts.set_setting(TOKEN_SETTING, token)
    apply_token(accounts)
    log.info("telegram bot changed to %s, %d chats unlinked", bot, unlinked)
    return {"bot": bot, "unlinked": unlinked}


def bot_loop(accounts) -> None:
    """Long-poll Telegram for messages to the bot forever and answer them (handle_update). Polling needs no public URL, so
    it works the same locally and on a server; only one process may poll a bot at a time. Idles while no token is set,
    and starts over (offset 0) when the admin switches bots."""
    offset, token = 0, None
    while True:
        if not configured():
            time.sleep(5)
            continue
        if os.environ["TELEGRAM_BOT_TOKEN"] != token:
            offset, token = 0, os.environ["TELEGRAM_BOT_TOKEN"]
        try:
            for update in _call("getUpdates", http_timeout=BOT_POLL_S + 10, offset=offset, timeout=BOT_POLL_S, allowed_updates='["message"]') or []:
                offset = update["update_id"] + 1
                reply = handle_update(accounts, update)
                if reply:
                    send(reply, update["message"]["chat"]["id"])
        except Exception as exc:
            log.warning("telegram bot poll failed: %s", _redact(exc))
            time.sleep(5)


def title(w: dict) -> str:
    """One-line headline for a watch line (same wording as the Season tab's list)."""
    k = w["kind"]
    if k == "gtd":
        return f"{w['name']} GTD: check, else start {w['backup']}"
    if k == "out":
        return f"{w['name']} OUT: bench" + (f", start {w['backup']}" if w.get("backup") else "")
    if k == "lock":
        return f"Lock {w['name']} now"
    return f"SWAP: bench {w['name']}, start {w['backup']}" if w.get("decision") == "SWAP" else f"{w.get('decision')}: {w['backup']} check"


def _t(iso: str) -> datetime:
    """Parse a watch line's UTC time ("2026-11-08T00:30Z")."""
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def key_of(w: dict, date: str, lid: str = "") -> str:
    """A line's dedupe key: league, day, kind, player, and what makes a repeat worth sending: nothing for OUT / GTD / lock (one
    per player per day, whoever the backup is), SWAP vs. a KEEP / PENDING check for swap calls, the new tag for status pushes
    and the target slot for lineup moves."""
    k = w["kind"]
    extra = ("swap" if w.get("decision") == "SWAP" else "check") if k == "swap" else "" if k in ("out", "gtd", "lock") else w.get("backup_sid", "")
    return f"{lid}|{date}|{k}|{w['sid']}|{extra}" if lid else f"{date}|{k}|{w['sid']}|{extra}"


def due(lines: list[dict], date: str, now: datetime, sent: set[str], lid: str = "") -> list[tuple[str, dict]]:
    """The (dedupe key, line) pairs whose alarm time has come, whose tip hasn't passed, and that weren't sent yet today (a key
    in the old league-less format, `date|kind|sid|backup`, still counts as sent)."""
    out = []
    for w in lines:
        key = key_of(w, date, lid)
        if key in sent or f"{date}|{w['kind']}|{w['sid']}|{w.get('backup_sid', '')}" in sent or not w.get("alarm"):
            continue
        if (w["alarm"] == "now" or _t(w["alarm"]) <= now) and (not w.get("by") or w["by"] == "now" or _t(w["by"]) > now):
            out.append((key, w))
    return out


def body(w: dict) -> str:
    """The message text: OUT / GTD / status lines already say everything in their text; swap and lock calls keep the headline above it."""
    if w["kind"] in ("out", "gtd", "status", "injury") and w.get("text"):
        return w["text"]
    return f"{title(w)}\n{w.get('text', '')}"


def quiet_status(status: list[dict], watch: list[dict]) -> list[dict]:
    """The status pushes minus the ones a watch line already covers: "now Out" when an OUT line exists for him, "now GTD / DTD"
    when a GTD line does (the watch line says the same and what to do)."""
    outs = {w["sid"] for w in watch if w["kind"] == "out"}
    gtds = {w["sid"] for w in watch if w["kind"] == "gtd"}
    return [x for x in status if not (x["change"] == "out" and x["sid"] in outs or x["change"] == "dtd" and x["sid"] in gtds)]


def covered_sids(watch: list[dict], date: str, lid: str, sent: set[str]) -> set[str]:
    """The players an OUT / GTD / SWAP message already sent today told you to move (the starter and his backup): a lineup-move
    message would only repeat them."""
    return {x for w in watch if w["kind"] in ("out", "gtd", "swap") and key_of(w, date, lid) in sent for x in (w["sid"], w.get("backup_sid")) if x}


def move_lines(moves: list[dict]) -> list[dict]:
    """Today's lineup moves that must beat a tip, as watch-like lines (for `due`) alarmed MOVE_LEAD_MIN before it."""
    return [{**m, "kind": "move", "backup_sid": m["to"], "alarm": (_t(m["by"]) - timedelta(minutes=MOVE_LEAD_MIN)).isoformat()}
            for m in moves if m.get("by")]


def moves_text(due_moves: list[dict], free: list[dict], tz: ZoneInfo) -> str:
    """One message for the lineup moves now due, plus the moves with no deadline (they free the slots), in Sleeper's words."""
    first = min(_t(m["by"]) for m in due_moves).astimezone(tz).strftime("%I:%M %p").lstrip("0")
    return "\n".join([f"Set your lineup before {first}:"] + [f"{m['name']}: {m['from']} → {m['to']}" for m in due_moves + free])


def status_lines(prev: dict, players: dict, mine: list[str], phrase: dict | None = None) -> list[dict]:
    """Injury-tag changes on your roster since the last poll (`prev`: sid -> the tag then, updated here): a player now
    OUT, now GTD / DTD, or cleared (tag gone, or Probable, after one of those). The first poll only records the tags.
    Lines are due at once; their dedupe key carries the new tag. `phrase`: sid -> "Right knee: out ~23 days (back Dec 14)", which
    replaces Sleeper's one-word note when there is one."""
    lines, phrase = [], phrase or {}
    for sid in mine:
        p = players.get(sid) or {}
        tag, old = p.get("injury_tag"), prev.get(sid, _UNSEEN)
        prev[sid] = tag
        if old is _UNSEEN or old == tag:
            continue
        if tag in OUT_TAGS:
            change = "out"
        elif tag in DOUBT_TAGS:
            change = "dtd"
        elif old in OUT_TAGS | DOUBT_TAGS and (tag is None or tag == "Probable"):
            change = "cleared"
        else:
            continue
        name, note = p.get("name", sid), p.get("injury_note") or ""
        reason = "" if note == tag else note.removeprefix(f"{tag}: ")
        reason = phrase.get(sid) or reason
        text = f"{name} cleared to play (was {old})" if change == "cleared" else f"{name} is now {tag}" + (f": {reason}" if reason else "")
        lines.append({"kind": "status", "change": change, "sid": sid, "name": name, "backup_sid": tag or "ok", "alarm": "now", "text": text})
    return lines


def injury_phrase(row: dict, today) -> str:
    """An ESPN injury row as "Right knee: out ~23 days (back Dec 14)"."""
    days, back = (row["back"] - today).days, row["back"]
    when = "listed to return today" if days <= 0 else "expected back tomorrow" if days == 1 else f"out ~{days} days (back {back:%b} {back.day})"
    return f"{row['what']}: {when}" if row["what"] else when.capitalize()


def injury_phrases(players: dict, mine: list[str], espn: dict, today) -> dict[str, str]:
    """sid -> injury phrase for every player of yours that ESPN lists as injured."""
    rows = {sid: espn.get(normalize_name((players.get(sid) or {}).get("name", ""))) for sid in mine}
    return {sid: injury_phrase(row, today) for sid, row in rows.items() if row}


SEASON_ENDING = re.compile(r"season-ending|rest of the (?:season|year)|for the season|out indefinitely", re.I)


def season_ending(row: dict | None, today) -> bool:
    """Is this ESPN injury row season-ending: the return date is after the regular season (mid-April of the season's end year)
    or ESPN's note says so?"""
    if not row:
        return False
    cutoff = datetime(today.year + (today.month >= 7), 4, 15).date()
    return row["back"] >= cutoff or bool(SEASON_ENDING.search(row["comment"]))


def sorry(name: str) -> str:
    """The line added to the message that reports a season-ending injury."""
    return f"Sorry about {name}, this looks like a season-ending injury. Hope the recovery goes well."


def with_injury(watch: list[dict], phrase: dict) -> list[dict]:
    """OUT / GTD watch lines with the injury and days out added under their text."""
    return [{**w, "text": NL.join((w["text"], phrase[w["sid"]]))} if w["kind"] in ("out", "gtd") and w["sid"] in phrase else w for w in watch]


def injury_news(prev: dict, players: dict, mine: list[str], espn: dict, today) -> list[dict]:
    """ESPN's news on your injured players when the return date moves by NEWS_MIN_SHIFT_DAYS or more (a diagnosis after the first
    "Out": "torn MCL, 6-8 weeks") or a new injury appears: the injury, the days out and ESPN's note. `prev`: sid -> the return
    date last seen (updated here; a smaller drift keeps the old one so it adds up). The first poll only records."""
    lines = []
    for sid in mine:
        name = (players.get(sid) or {}).get("name", sid)
        row = espn.get(normalize_name(name))
        back, old = row["back"] if row else None, prev.get(sid, _UNSEEN)
        if old is _UNSEEN or back is None:
            prev[sid] = back
            continue
        if old is not None and abs((back - old).days) < NEWS_MIN_SHIFT_DAYS:
            continue
        prev[sid] = back
        lines.append({"kind": "injury", "sid": sid, "name": name, "backup_sid": back.isoformat(), "alarm": "now",
                      "text": NL.join(filter(None, (f"{name} injury update: {injury_phrase(row, today)}", row["comment"])))})
    return lines


def wanted(w: dict, prefs: dict, players_by_sid: dict) -> bool:
    """Whether the Notifications settings want this line: its kind's switch, and for a lock call the win chance it must add
    (lock_min_wpa, in points; a call whose win chances aren't known passes only at 0)."""
    k = w["kind"]
    if k == "lock":
        if not prefs["lock"]:
            return False
        q = players_by_sid.get(w["sid"]) or {}
        if prefs["lock_min_wpa"] <= 0:
            return True
        return q.get("win_lock") is not None and (q["win_lock"] - (q.get("win_wait") or 0)) * 100 >= prefs["lock_min_wpa"]
    if k == "status":
        return bool(prefs[w["change"]])
    return bool(prefs.get({"gtd": "dtd", "injury": "out"}.get(k, k), True))


def slate_hot(fetch, now: datetime, today) -> bool:
    """Whether alerts can be due soon: an NBA game (yesterday's or today's, ESPN) is live or tips within HOT_BEFORE_S.
    Every lock / swap / OUT / GTD call and lineup move is timed off a tip, so outside that only injury-tag changes
    can come up, and those can wait QUIET_S. True when the scoreboard can't be read."""
    from .lockin.service import espn_day

    try:
        for day in (today - timedelta(days=1), today):
            for g in espn_day(fetch, day.isoformat(), today).values():
                if g["state"] == "in" or (g["state"] == "pre" and g.get("tip") and _t(g["tip"]) - now <= timedelta(seconds=HOT_BEFORE_S)):
                    return True
    except Exception as exc:
        log.info("scoreboard check failed, polling anyway: %s", exc)
        return True
    return False


def watch_once(state, sent: set[str], tags: dict | None = None, last: dict | None = None) -> None:
    """One poll: for every league whose owner has Telegram (premium, admin or owner) and linked a chat, compute today's plan and send to the owner's chat each newly
    due watch line their settings want, the injury-tag changes on the roster (`tags`: league -> sid -> last tag seen), and
    the lineup moves due (one message). Leagues of users without a chat are skipped before any Sleeper call. With `last`
    (league -> monotonic time of its last poll), a league is polled only every QUIET_S while no game is live or close
    (slate_hot). Its Sleeper calls are background calls (the smaller share of the server's Sleeper budget)."""
    from .core.api.deps import _session
    from .lockin.service import espn_injuries, http_fetch, read_locks, team_plan, today_ct, week_view

    tags = {} if tags is None else tags
    accounts = state.accounts
    fetch = http_fetch(state.platform, background=True)
    hot = last is None or slate_hot(fetch, datetime.now(timezone.utc), today_ct())
    for lid in state.leagues.list_ids():
        owner = accounts.user(accounts.owner(lid) or 0)
        chat = owner and owner["telegram"] and owner["tg_chat_id"]
        if not chat or (not hot and time.monotonic() - last.get(lid, float("-inf")) < QUIET_S):
            continue
        if last is not None:
            last[lid] = time.monotonic()
        prefs = read_prefs(accounts, owner["id"])
        try:
            session = _session(state, lid)
            view = week_view(session, fetch, None)
            plan = team_plan(session, view, None, read_locks(state.store, lid, view["week"]))
            espn = espn_injuries(fetch)
        except Exception as exc:
            log.info("watch skipped %s: %s", lid, exc)
            continue
        today, now = plan.get("today") or {}, datetime.now(timezone.utc)
        date = today.get("date") or view["today"]
        by_sid = {q["sid"]: q for q in plan.get("players", [])}
        mine, day0 = list(by_sid), datetime.fromisoformat(view["today"]).date()
        phrase = injury_phrases(view["players"], mine, espn, day0)
        watch = with_injury(today.get("watch", []), phrase)
        status_all = status_lines(tags.setdefault(lid, {}), view["players"], mine, phrase)
        status = quiet_status(status_all, watch)
        has_injury = {x["sid"] for x in status_all} | {w["sid"] for w in watch if w["kind"] in ("out", "gtd")}
        news_all = injury_news(tags.setdefault(f"{lid}|injury", {}), view["players"], mine, espn, day0)
        news = [n for n in news_all if n["sid"] not in has_injury]
        fresh = {x["sid"] for x in status_all if x["change"] != "cleared"} | {n["sid"] for n in news_all}
        for key, w in due([w for w in watch + status + news if wanted(w, prefs, by_sid)], date, now, sent, lid):
            text = body(w)
            if w["sid"] in fresh and w["kind"] in ("out", "status", "injury") and w.get("change") != "cleared" and season_ending(espn.get(normalize_name(w["name"])), day0):
                text = NL.join((text, sorry(w["name"])))
            if send(text, chat, accounts):
                sent.add(key)
                log.info("sent %s", key)
        done = covered_sids(watch, date, lid, sent)
        moves = due(move_lines(today.get("moves", [])), date, now, sent, lid) if prefs["moves"] else []
        sent.update(k for k, m in moves if m["sid"] in done)
        moves = [(k, m) for k, m in moves if m["sid"] not in done]
        free = [m for m in today.get("moves", []) if not m.get("by") and m["sid"] not in done]
        if moves and send(moves_text([m for _, m in moves], free, ZoneInfo(view["tz"])), chat, accounts):
            sent.update(k for k, _ in moves)
            log.info("sent %s", [k for k, _ in moves])


def start_watcher(state) -> None:
    """Start the watcher thread that polls every POLL_S seconds and the bot thread that answers /start and /stop. Both idle
    while no bot token is set (backend/.env, or the Admin tab), so a token set later works without a restart. Sent keys
    persist in cache/notified.json."""
    load_env()
    apply_token(state.accounts)
    if not configured():
        log.info("telegram not configured yet (backend/.env or Admin tab): notifications off until a bot token is set")
    path = state.store.root / "cache" / "notified.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(path.parent / "notify.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        sent = set(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        sent = set()
    tags: dict = {}
    last: dict = {}

    def loop() -> None:
        """Poll forever, saving the sent keys after each round."""
        while True:
            before = len(sent)
            try:
                if configured():
                    watch_once(state, sent, tags, last)
                if len(sent) != before:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps(sorted(sent)), encoding="utf-8")
            except Exception:
                log.exception("watch round failed")
            time.sleep(POLL_S)

    threading.Thread(target=loop, daemon=True, name="telegram-watch").start()
    threading.Thread(target=bot_loop, args=(state.accounts,), daemon=True, name="telegram-bot").start()
    log.info("telegram watcher started")


router = APIRouter(prefix="/notify", tags=["notify"])


@router.get("")
def get_notify(request: Request, state=Depends(get_state)) -> dict:
    """The signed-in user's Telegram link (bot username, linked chat's name; never the token or chat id) and settings."""
    load_env()
    user = request.state.user
    return {**status(user), "prefs": read_prefs(state.accounts, user["id"])}


@router.put("/prefs")
def put_prefs(body: NotifyPrefs, request: Request, state=Depends(get_state)) -> dict:
    """Save the signed-in user's Notifications settings; the watcher reads them on its next poll."""
    return write_prefs(state.accounts, request.state.user["id"], body)


@router.post("/link")
def link(request: Request, state=Depends(get_state)) -> dict:
    """A one-time t.me link that links the chat that opens it and taps Start to this account (10 minutes, 5 an hour)."""
    load_env()
    bot = bot_username() if configured() else None
    if not bot:
        raise HTTPException(503, "Telegram alerts aren't available on this server")
    try:
        token = state.accounts.link_token(request.state.user["id"])
    except RateLimited as exc:
        raise HTTPException(429, str(exc)) from exc
    return {"url": f"https://t.me/{bot}?start={token}"}


@router.delete("/link")
def unlink(request: Request, state=Depends(get_state)) -> dict:
    """Unlink the signed-in user's Telegram chat."""
    state.accounts.unlink_user(request.state.user["id"])
    return {"ok": True}


if __name__ == "__main__":
    import sys

    load_env()
    if len(sys.argv) < 2:
        sys.exit('usage: python -m app.notify <chat id> ["message"]')
    print("sent" if send(" ".join(sys.argv[2:]) or "NBA tool test message", int(sys.argv[1])) else "NOT sent (check backend/.env)")
