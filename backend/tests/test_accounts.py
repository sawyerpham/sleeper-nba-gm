"""P39: sign-in, per-user leagues, admin-only routes, admin stats, and Telegram linking."""

import pytest
from fastapi.testclient import TestClient

from app import notify
from app.accounts import Accounts, RateLimited
from app.core.services.app_state import AppState
from app.main import create_app
from nba_fantasy_shared.models.league import LeagueSettings
from nba_fantasy_shared.providers.fixture_provider import FixturePlatformProvider, FixtureStatsProvider
from nba_fantasy_shared.storage import JsonStore

from .conftest import ADMIN, sign_in


@pytest.fixture
def app(tmp_path, fixtures_dir):
    """A fresh app over a temp store (no leagues, no users)."""
    return create_app(AppState(JsonStore(tmp_path), FixtureStatsProvider(fixtures_dir), FixturePlatformProvider(fixtures_dir)))


def test_signed_out_gets_401_except_health_and_calculators(app):
    """Every data route needs a session; health and the calculators stay public."""
    c = TestClient(app)
    assert c.get("/api/leagues").status_code == 401
    assert c.get("/api/players").status_code == 401
    assert c.get("/api/auth/me").status_code == 401
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/calculations").status_code == 200


def test_login_token_is_single_use_and_logout_ends_the_session(app):
    """A sign-in link works once; signing out makes the cookie useless."""
    c = TestClient(app)
    token = app.state.app_state.accounts.request_login("Fan@Test.local ", None)
    assert c.post("/api/auth/verify", json={"token": token}).json()["email"] == "fan@test.local"
    assert c.post("/api/auth/verify", json={"token": token}).status_code == 400
    assert c.get("/api/auth/me").status_code == 200
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401


def test_login_route_validates_and_rate_limits(app):
    """Bad emails are 400; the fourth link for one email inside 15 minutes is 429."""
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"email": "not-an-email"}).status_code == 400
    assert [c.post("/api/auth/login", json={"email": "a@b.co"}).status_code for _ in range(4)] == [200, 200, 200, 429]


def test_users_only_see_their_own_leagues(app):
    """Two users adding the same Sleeper league get separate copies; neither can read or delete the other's."""
    a, b = TestClient(app), TestClient(app)
    sign_in(a, "a@test.local")
    sign_in(b, "b@test.local")
    assert a.post("/api/leagues", json={"league_id": "sleeper-1", "name": "A"}).json()["league"]["league_id"] == "sleeper-1"
    assert b.post("/api/leagues", json={"league_id": "sleeper-1", "name": "B"}).json()["league"]["league_id"] == "sleeper-1-u2"
    assert a.post("/api/leagues", json={"league_id": "sleeper-1", "name": "A"}).status_code == 409
    assert [x["league_id"] for x in a.get("/api/leagues").json()] == ["sleeper-1"]
    assert [x["league_id"] for x in b.get("/api/leagues").json()] == ["sleeper-1-u2"]
    for path in ("/api/leagues/sleeper-1", "/api/leagues/sleeper-1/draft", "/api/leagues/sleeper-1/season/watch", "/api/players?league_id=sleeper-1"):
        assert b.get(path).status_code == 404, path
    assert b.delete("/api/leagues/sleeper-1").status_code == 404
    assert a.get("/api/leagues/sleeper-1").status_code == 200


def test_admin_only_routes_and_the_admin_takes_over_old_leagues(app):
    """Data pulls, player notes and stats are admin-only; the admin's sign-in claims leagues from before accounts."""
    state = app.state.app_state
    state.create_league(LeagueSettings(league_id="old", name="Old"))
    fan = TestClient(app)
    sign_in(fan, "fan@test.local")
    assert fan.post("/api/data/pull", json={}).status_code == 403
    assert fan.get("/api/admin/stats").status_code == 403
    assert fan.patch("/api/players/1/overrides", json={}).status_code == 403
    assert fan.get("/api/leagues/old").status_code == 404
    admin = TestClient(app)
    assert sign_in(admin)["admin"] is True
    assert admin.get("/api/leagues/old").status_code == 200
    stats = admin.get("/api/admin/stats").json()
    assert stats["users"] == 2 and stats["leagues"] == 1 and stats["active_24h"] == 2 and stats["logins_24h"] == 2
    assert {r["email"]: r["role"] for r in stats["recent"]} == {ADMIN: "owner", "fan@test.local": "user"} and stats["admins"] == 1
    assert len(stats["signups_by_day"]) == 14
    assert fan.get("/api/notify").status_code == 403 and fan.post("/api/notify/link").status_code == 403


def _start(text, chat_id=7, kind="private"):
    """A Telegram update carrying one message."""
    return {"update_id": 1, "message": {"text": text, "chat": {"id": chat_id, "type": kind, "first_name": "Sam"}}}


def test_telegram_link_needs_the_users_own_start_and_stop_unlinks():
    """Only /start <token> from the chat itself links it; tokens are single-use; groups are ignored; /stop unlinks;
    a chat moves to the newest account that links it."""
    acc = Accounts(":memory:")
    uid = acc.verify_login(acc.request_login("a@test.local", None))[1]["id"]
    uid2 = acc.verify_login(acc.request_login("b@test.local", None))[1]["id"]
    assert "expired" in notify.handle_update(acc, _start("/start made-up"))
    token = acc.link_token(uid)
    assert notify.handle_update(acc, _start(f"/start {token}", kind="group")) is None
    assert notify.handle_update(acc, _start(f"/start {token}")).startswith("Linked to a@test.local")
    assert acc.user(uid)["tg_chat_id"] == 7 and acc.user(uid)["tg_name"] == "Sam"
    assert "expired" in notify.handle_update(acc, _start(f"/start {token}"))
    notify.handle_update(acc, _start(f"/start {acc.link_token(uid2)}"))
    assert acc.user(uid)["tg_chat_id"] is None and acc.user(uid2)["tg_chat_id"] == 7
    assert notify.handle_update(acc, _start("/stop")) == "Alerts are off for this chat."
    assert acc.user(uid2)["tg_chat_id"] is None
    for _ in range(4):
        acc.link_token(uid)
    with pytest.raises(RateLimited):
        acc.link_token(uid)


def test_send_unlinks_a_chat_that_blocked_the_bot(monkeypatch):
    """Telegram's 403 (bot blocked) unlinks the chat; a delivered message counts toward the stats."""
    acc = Accounts(":memory:")
    uid = acc.verify_login(acc.request_login("a@test.local", None))[1]["id"]
    acc.consume_link(acc.link_token(uid), 7, "Sam")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "x")

    class R:
        """A fake requests response."""
        def __init__(self, code):
            self.status_code = code

        def raise_for_status(self):
            """Like requests: raise on 4xx/5xx."""
            if self.status_code >= 400:
                raise notify.requests.HTTPError(str(self.status_code))

    monkeypatch.setattr(notify.requests, "post", lambda *a, **k: R(200))
    assert notify.send("hi", 7, acc) is True and acc.stats()["sent_24h"] == 1
    monkeypatch.setattr(notify.requests, "post", lambda *a, **k: R(403))
    assert notify.send("hi", 7, acc) is False and acc.user(uid)["tg_chat_id"] is None


def test_backup_has_the_accounts_and_leagues_but_not_the_caches(tmp_path):
    """The daily archive holds a readable copy of app.db plus league files; caches stay out; old archives are deleted."""
    import os
    import sqlite3
    import tarfile

    from app.backup import backup

    acc = Accounts(tmp_path / "app.db")
    acc.verify_login(acc.request_login("a@test.local", None))
    (tmp_path / "leagues").mkdir()
    (tmp_path / "leagues" / "lg.json").write_text("{}")
    (tmp_path / "cache").mkdir()
    (tmp_path / "cache" / "big.json").write_text("{}")
    (tmp_path / "backups").mkdir()
    old = tmp_path / "backups" / "data-2000-01-01.tgz"
    old.write_text("")
    os.utime(old, (0, 0))
    archive = backup(tmp_path)
    with tarfile.open(archive) as tar:
        names = set(tar.getnames())
        tar.extract("app.db", tmp_path / "restore", filter="data")
    assert {"app.db", "leagues", "leagues/lg.json"} <= names and not any(n.startswith("cache") for n in names)
    assert sqlite3.connect(tmp_path / "restore" / "app.db").execute("SELECT email FROM users").fetchall() == [("a@test.local",)]
    assert not old.exists() and not (tmp_path / "backups" / "app.db.tmp").exists()


def test_admin_switches_the_bot_and_everyone_relinks(app, monkeypatch):
    """Only the admin can set the bot token; a bad token is refused; a new bot unlinks every chat; the token never comes back."""
    import os

    state = app.state.app_state
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setattr(notify, "_bot", {})
    good = "123456789:" + "A" * 35
    monkeypatch.setattr(notify, "check_token", lambda t: "new_bot" if t == good else (_ for _ in ()).throw(ValueError("Telegram didn't accept that token")))
    fan, admin = TestClient(app), TestClient(app)
    fan_id = sign_in(fan, "fan@test.local")["id"]
    sign_in(admin)
    state.accounts.consume_link(state.accounts.link_token(fan_id), 7, "Sam")
    assert fan.put("/api/admin/telegram", json={"token": good}).status_code == 403
    assert admin.put("/api/admin/telegram", json={"token": "nope"}).status_code == 400
    assert admin.put("/api/admin/telegram", json={"token": good}).json() == {"bot": "new_bot", "unlinked": 1}
    assert os.environ["TELEGRAM_BOT_TOKEN"] == good and state.accounts.user(fan_id)["tg_chat_id"] is None
    monkeypatch.setattr(notify, "bot_username", lambda: "new_bot")
    got = admin.get("/api/admin/telegram").json()
    assert got == {"configured": True, "bot": "new_bot", "source": "app", "linked": 0} and good not in str(got)
    assert admin.put("/api/admin/telegram", json={"token": ""}).json()["bot"] is None
    assert "TELEGRAM_BOT_TOKEN" not in os.environ and admin.get("/api/admin/telegram").json()["configured"] is False


def test_bot_token_format_is_checked_before_any_call(monkeypatch):
    """A malformed token never reaches Telegram (it would land in the request URL)."""
    monkeypatch.setattr(notify.requests, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("called Telegram")))
    for bad in ("", "abc", "123:short", "123456789:" + "A" * 35 + "/../x"):
        with pytest.raises(ValueError, match="bot token"):
            notify.check_token(bad)


@pytest.mark.parametrize("bad", [
    "a@b.co\r\nBcc: victim@x.com", "a@b.co,c@d.co", "<script>alert(1)</script>@x.com", '"a b"@x.com', "a@b.co>", "a@b",
    "a@-b.co", "a@b.co' OR '1'='1", "x" * 65 + "@b.co", "a@b.c0", "",
])
def test_emails_that_try_to_inject_are_refused(app, bad):
    """Line breaks (extra headers), commas (extra recipients), markup and quotes never get through the email check."""
    assert TestClient(app).post("/api/auth/login", json={"email": bad}).status_code == 400


def test_owner_promotes_and_demotes_and_nobody_else_can(app):
    """Owners and admins change user types; an owner can't be changed; a demoted admin loses admin pages and Telegram."""
    state = app.state.app_state
    owner, fan, other = TestClient(app), TestClient(app), TestClient(app)
    sign_in(owner)
    fan_id = sign_in(fan, "fan@test.local")["id"]
    other_id = sign_in(other, "other@test.local")["id"]
    owner_id = state.accounts.user_by_email(ADMIN)["id"]
    assert fan.put(f"/api/admin/users/{other_id}/role", json={"role": "admin"}).status_code == 403
    assert fan.put(f"/api/admin/users/{fan_id}/role", json={"role": "admin"}).status_code == 403    # no self-promotion
    assert owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "boss"}).status_code == 422
    assert owner.put(f"/api/admin/users/{owner_id}/role", json={"role": "user"}).status_code == 400
    assert owner.put("/api/admin/users/999/role", json={"role": "admin"}).status_code == 404
    assert owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "admin"}).json()["role"] == "admin"
    assert fan.get("/api/auth/me").json() == {"id": fan_id, "email": "fan@test.local", "admin": True, "telegram": True, "kind": "admin"}
    assert fan.get("/api/admin/stats").json()["admins"] == 2
    assert fan.put(f"/api/admin/users/{owner_id}/role", json={"role": "user"}).status_code == 400   # admins can't demote the owner
    state.accounts.consume_link(state.accounts.link_token(fan_id), 9, "Fan")
    assert owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "user"}).json()["role"] == "user"
    assert fan.get("/api/admin/stats").status_code == 403 and state.accounts.user(fan_id)["tg_chat_id"] is None


def test_cross_site_writes_are_refused_and_headers_are_set(app):
    """Another site can't make a signed-in browser change things; every response carries the security headers."""
    c = TestClient(app)
    sign_in(c)
    evil = {"Origin": "https://evil.example"}
    assert c.post("/api/leagues", json={"league_id": "x", "name": "X"}, headers=evil).status_code == 403
    assert c.post("/api/auth/logout", headers=evil).status_code == 403
    assert c.post("/api/leagues", json={"league_id": "x", "name": "X"}, headers={"Origin": "http://testserver"}).status_code == 201
    r = c.get("/api/leagues", headers=evil)                      # reads are fine: the browser won't hand them to evil.example
    assert r.status_code == 200 and r.headers["X-Frame-Options"] == "DENY" and r.headers["Cache-Control"] == "no-store"
    assert "script-src 'self'" in r.headers["Content-Security-Policy"] and r.headers["Referrer-Policy"] == "no-referrer"


def test_text_fields_are_bounded_and_ids_cant_escape(app):
    """Sleeper ids are numbers only (they go into URLs), league ids can't hold paths, names have a length cap."""
    c = TestClient(app)
    sign_in(c)
    assert c.post("/api/leagues", json={"league_id": "../../etc", "name": "X"}).status_code == 400
    assert c.post("/api/leagues", json={"league_id": "lg", "name": "x" * 101}).status_code == 422
    assert c.post("/api/leagues", json={"league_id": "lg", "name": ""}).status_code == 422
    assert c.post("/api/leagues", json={"league_id": "lg", "name": "<img src=x onerror=alert(1)>"}).status_code == 201
    for sid in ("1/../../v1/user/x", "123?x=1", "abc", ""):
        assert c.post("/api/leagues/lg/sleeper/preview", json={"sleeper_league_id": sid}).status_code == 422, sid
    settings = c.get("/api/leagues/lg/settings").json()
    assert c.put("/api/leagues/lg/settings", json={**settings, "sleeper_league_id": "1/../x"}).status_code == 400
    assert c.put("/api/leagues/lg/settings", json={**settings, "sleeper_history_league_ids": ["9", "x/y"]}).status_code == 400
    assert c.patch("/api/leagues/lg/managers/m1", json={"name": "y" * 61}).status_code == 422
    assert c.patch("/api/leagues/lg/managers/m1", json={"sleeper_user_id": "1 OR 1=1"}).status_code == 422


def test_premium_gets_telegram_but_not_the_admin_tab(app):
    """Premium: Notifications and Telegram linking yes, Admin tab and role changes no; back to user drops the link."""
    state = app.state.app_state
    owner, fan = TestClient(app), TestClient(app)
    sign_in(owner)
    fan_id = sign_in(fan, "fan@test.local")["id"]
    assert fan.get("/api/notify").status_code == 403
    assert owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "premium"}).json()["role"] == "premium"
    me = fan.get("/api/auth/me").json()
    assert me["kind"] == "premium" and me["telegram"] is True and me["admin"] is False
    assert fan.get("/api/notify").status_code == 200 and fan.put("/api/notify/prefs", json={"lock": False}).status_code == 200
    assert fan.get("/api/admin/stats").status_code == 403
    assert fan.put(f"/api/admin/users/{fan_id}/role", json={"role": "admin"}).status_code == 403
    assert owner.get("/api/admin/stats").json()["premium"] == 1
    state.accounts.consume_link(state.accounts.link_token(fan_id), 9, "Fan")
    owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "admin"})
    assert state.accounts.user(fan_id)["tg_chat_id"] == 9                     # premium -> admin keeps the link
    owner.put(f"/api/admin/users/{fan_id}/role", json={"role": "user"})
    assert state.accounts.user(fan_id)["tg_chat_id"] is None and fan.get("/api/notify").status_code == 403
