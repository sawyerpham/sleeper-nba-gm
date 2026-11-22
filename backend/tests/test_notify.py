from datetime import datetime, timezone

from app.notify import due, title

NOW = datetime(2026, 11, 8, 1, 0, tzinfo=timezone.utc)


def test_due_sends_once_inside_the_alarm_window():
    swap = {"kind": "swap", "sid": "1", "backup_sid": "2", "alarm": "2026-11-08T00:55Z", "by": "2026-11-08T01:10Z"}
    late = {"kind": "gtd", "sid": "3", "alarm": "2026-11-08T01:30Z", "by": "2026-11-08T02:00Z"}
    gone = {"kind": "gtd", "sid": "4", "alarm": "2026-11-08T00:00Z", "by": "2026-11-08T00:30Z"}
    out = {"kind": "out", "sid": "5", "alarm": "now", "by": "2026-11-08T02:00Z"}
    got = due([swap, late, gone, out], "2026-11-08", NOW, set())
    assert [w["sid"] for _, w in got] == ["1", "5"]
    assert not due([swap], "2026-11-08", NOW, {k for k, _ in got})


def test_lineup_moves_are_due_before_the_tip_they_must_beat_in_one_message():
    from zoneinfo import ZoneInfo

    from app.notify import move_lines, moves_text
    moves = [{"sid": "1", "name": "Harden", "from": "BN", "to": "PG", "by": "2026-11-08T01:20Z"},
             {"sid": "2", "name": "Sharpe", "from": "BN", "to": "C", "by": "2026-11-08T02:00Z"},
             {"sid": "3", "name": "Dunn", "from": "PG", "to": "BN", "by": None}]
    got = due(move_lines(moves), "2026-11-08", NOW, set())
    assert [m["sid"] for _, m in got] == ["1"]
    text = moves_text([m for _, m in got], [m for m in moves if not m["by"]], ZoneInfo("America/New_York"))
    assert text == "Set your lineup before 8:20 PM:\nHarden: BN → PG\nDunn: PG → BN"
    assert not due(move_lines(moves), "2026-11-08", NOW, {k for k, _ in got})


def test_title():
    assert title({"kind": "out", "name": "A"}) == "A OUT: bench"
    assert title({"kind": "swap", "name": "A", "backup": "B", "decision": "SWAP"}) == "SWAP: bench A, start B"


def test_prefs_gate_lines_and_a_lock_call_needs_its_wpa():
    from app.notify import NotifyPrefs, wanted

    prefs = NotifyPrefs(lock_min_wpa=5, swap=False).model_dump()
    players = {"1": {"sid": "1", "win_lock": 0.71, "win_wait": 0.64}, "2": {"sid": "2", "win_lock": 0.60, "win_wait": 0.58}}
    assert wanted({"kind": "lock", "sid": "1"}, prefs, players)
    assert not wanted({"kind": "lock", "sid": "2"}, prefs, players)
    assert not wanted({"kind": "lock", "sid": "9"}, prefs, players)
    assert wanted({"kind": "lock", "sid": "9"}, NotifyPrefs().model_dump(), players)
    assert not wanted({"kind": "swap", "sid": "1"}, prefs, players) and wanted({"kind": "gtd", "sid": "1"}, prefs, players)
    assert wanted({"kind": "status", "change": "cleared"}, prefs, players)
    assert not wanted({"kind": "status", "change": "out"}, {**prefs, "out": False}, players)


def test_status_changes_on_your_roster_after_the_first_poll():
    from app.notify import status_lines

    seen = {}
    players = {"1": {"name": "A", "injury_tag": "GTD", "injury_note": "GTD: Knee - Soreness"}, "2": {"name": "B", "injury_tag": None},
               "3": {"name": "C", "injury_tag": "Out"}}
    assert status_lines(seen, players, ["1", "2", "3"]) == []
    players = {"1": {"name": "A", "injury_tag": None}, "2": {"name": "B", "injury_tag": "Out", "injury_note": "Out: Ankle - Sprain"},
               "3": {"name": "C", "injury_tag": "DTD", "injury_note": "DTD"}}
    got = status_lines(seen, players, ["1", "2", "3"])
    assert [(w["change"], w["text"]) for w in got] == [("cleared", "A cleared to play (was GTD)"), ("out", "B is now Out: Ankle - Sprain"),
                                                       ("dtd", "C is now DTD")]
    assert all(w["kind"] == "status" and w["alarm"] == "now" for w in got)
    assert status_lines(seen, players, ["1", "2", "3"]) == []
    assert [k for k, _ in due(got, "2026-11-12", NOW, set())] == ["2026-11-12|status|1|ok", "2026-11-12|status|2|Out", "2026-11-12|status|3|DTD"]


def test_notify_api_reports_the_link_and_saves_the_prefs(tmp_path, fixtures_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from app import notify
    from app.core.services.app_state import AppState
    from app.main import create_app
    from nba_fantasy_shared.providers.fixture_provider import FixturePlatformProvider, FixtureStatsProvider
    from nba_fantasy_shared.storage import JsonStore

    from .conftest import sign_in

    monkeypatch.setattr(notify, "load_env", lambda *a, **k: None)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    store = JsonStore(tmp_path)
    client = TestClient(create_app(AppState(store, FixtureStatsProvider(fixtures_dir), FixturePlatformProvider(fixtures_dir))))
    assert client.get("/api/notify").status_code == 401
    sign_in(client, "fan@test.local")
    assert client.get("/api/notify").status_code == 403          # alerts are admin-only
    me = sign_in(client)
    r = client.get("/api/notify")
    assert r.status_code == 200 and r.json() == {"configured": False, "prefs": notify.NotifyPrefs().model_dump()}
    r = client.put("/api/notify/prefs", json={"lock": False, "lock_min_wpa": 5})
    assert r.status_code == 200 and r.json()["lock"] is False and r.json()["lock_min_wpa"] == 5 and r.json()["swap"] is True
    accounts = client.app.state.app_state.accounts
    assert client.get("/api/notify").json()["prefs"] == r.json() and notify.read_prefs(accounts, me["id"]) == r.json()
    assert client.put("/api/notify/prefs", json={"lock_min_wpa": 500}).status_code == 422


def test_same_player_same_day_is_one_key_whoever_the_backup_is():
    """OUT / GTD / lock repeat for a new backup is noise; a swap resends only when it turns from a check into SWAP; leagues are separate."""
    from app.notify import key_of

    gtd = {"kind": "gtd", "sid": "1", "backup_sid": "2"}
    assert key_of(gtd, "d") == key_of({**gtd, "backup_sid": "9"}, "d")
    swap = {"kind": "swap", "sid": "1", "backup_sid": "2", "decision": "PENDING"}
    assert key_of(swap, "d") == key_of({**swap, "backup_sid": "9", "decision": "KEEP"}, "d")
    assert key_of(swap, "d") != key_of({**swap, "decision": "SWAP"}, "d")
    assert key_of(gtd, "d", "lg1") != key_of(gtd, "d", "lg2")
    assert not due([{**gtd, "alarm": "now"}], "d", NOW, {"d|gtd|1|2"}, "lg1")   # sent under the old key format earlier today


def test_out_message_covers_the_status_push_and_the_lineup_move():
    """One injury = one message: the OUT line replaces 'is now Out' and the move lines for the starter and his backup."""
    from app.notify import body, covered_sids, quiet_status

    out = {"kind": "out", "sid": "1", "backup_sid": "2", "name": "A", "text": "A is OUT tonight: bench him and start B at SF now."}
    gtd = {"kind": "gtd", "sid": "3", "backup_sid": "4", "name": "C", "text": "C is questionable: check."}
    status = [{"kind": "status", "change": "out", "sid": "1"}, {"kind": "status", "change": "out", "sid": "5"},
              {"kind": "status", "change": "dtd", "sid": "3"}, {"kind": "status", "change": "cleared", "sid": "1"}]
    assert [(x["change"], x["sid"]) for x in quiet_status(status, [out, gtd])] == [("out", "5"), ("cleared", "1")]
    assert covered_sids([out, gtd], "d", "lg", set()) == set()
    assert covered_sids([out, gtd], "d", "lg", {"lg|d|out|1|"}) == {"1", "2"}
    assert body(out) == out["text"] and body({"kind": "lock", "name": "X", "text": "why"}) == "Lock X now\nwhy"


def test_one_injury_is_one_message_through_the_watcher(monkeypatch):
    """Replay of 11-21: a starter goes Out. The OUT line, the 'is now Out' push and the lineup moves used to be three messages."""
    from types import SimpleNamespace

    from app import notify
    from app.core.api import deps
    from app.lockin import service

    out = {"kind": "out", "sid": "1", "name": "A", "backup": "B", "backup_sid": "2", "alarm": "now", "by": "2099-01-01T00:00Z",
           "text": "A is OUT tonight: bench him and start B at SF now."}
    moves = [{"sid": "1", "name": "A", "from": "SF", "to": "BN", "by": "2099-01-01T00:00Z"},
             {"sid": "2", "name": "B", "from": "BN", "to": "SF", "by": "2099-01-01T00:00Z"}]
    plan = {"players": [{"sid": "1"}], "today": {"date": "2026-11-21", "watch": [out], "moves": moves}}
    tag = {"v": None}
    view = {"today": "2026-11-21", "tz": "America/New_York", "week": 1, "players": {"1": {"name": "A", "injury_tag": None}}}
    monkeypatch.setattr(deps, "_session", lambda *a: None)
    monkeypatch.setattr(service, "week_view", lambda *a, **k: {**view, "players": {"1": {"name": "A", "injury_tag": tag["v"]}}})
    monkeypatch.setattr(service, "team_plan", lambda *a, **k: plan)
    monkeypatch.setattr(service, "read_locks", lambda *a: {})
    monkeypatch.setattr(service, "http_fetch", lambda *a, **k: None)
    monkeypatch.setattr(notify, "read_prefs", lambda accounts, uid: notify.NotifyPrefs().model_dump())
    msgs = []
    monkeypatch.setattr(notify, "send", lambda text, chat, accounts=None: chat == 7 and (msgs.append(text) or True))
    state = SimpleNamespace(store=None, platform=None, leagues=SimpleNamespace(list_ids=lambda: ["lg", "unlinked"]), accounts=linked_owner())
    sent, tags = set(), {}
    notify.watch_once(state, sent, tags)      # first poll: records the tag, sends the OUT line, covers the moves
    tag["v"] = "Out"
    notify.watch_once(state, sent, tags)      # the tag flips to Out: no second message
    assert msgs == ["A is OUT tonight: bench him and start B at SF now."]
    notify.watch_once(state, sent, tags)
    assert len(msgs) == 1


def test_two_copies_of_one_sleeper_league_alert_once(monkeypatch):
    """Replay of 11-22: an owner had "tobedecided" and a re-imported "sleeper-1" on the same Sleeper league, and every
    alert arrived twice. Only the sleeper-<id> copy is watched; a different Sleeper league of the same owner still is."""
    from types import SimpleNamespace

    from app import notify
    from app.core.api import deps
    from app.lockin import service

    sleeper = {"tobedecided": "1", "sleeper-1": "1", "other": "2"}
    polled = []

    def session(state, lid):
        """A session whose league points at its Sleeper league."""
        polled.append(lid)
        return SimpleNamespace(league=SimpleNamespace(sleeper_league_id=sleeper[lid]))

    monkeypatch.setattr(deps, "_session", session)
    monkeypatch.setattr(service, "week_view", lambda *a, **k: {"today": "2026-11-22", "tz": "UTC", "week": 1, "players": {}})
    monkeypatch.setattr(service, "team_plan", lambda *a, **k: {"players": [], "today": {}})
    monkeypatch.setattr(service, "read_locks", lambda *a: {})
    monkeypatch.setattr(service, "http_fetch", lambda *a, **k: None)
    monkeypatch.setattr(service, "espn_injuries", lambda *a: {})
    acc = linked_owner()
    uid = acc.owner("lg")
    for lid in sleeper:
        acc.own(lid, uid)
    state = SimpleNamespace(store=None, platform=None, leagues=SimpleNamespace(list_ids=lambda: ["tobedecided", "sleeper-1", "other"]), accounts=acc)
    notify.watch_once(state, set(), {})
    assert polled == ["sleeper-1", "tobedecided", "other"]   # tobedecided is looked at, then dropped as a duplicate
    watched = []
    monkeypatch.setattr(service, "week_view", lambda s, *a, **k: watched.append(s.league.sleeper_league_id) or {"today": "2026-11-22", "tz": "UTC", "week": 1, "players": {}})
    notify.watch_once(state, set(), {})
    assert watched == ["1", "2"]


def _row(back, what="Right knee", comment=""):
    """An ESPN injury row as espn_injuries returns it."""
    from datetime import date
    return {"back": date.fromisoformat(back), "what": what, "comment": comment}


def test_injury_phrase_says_the_injury_and_the_days_out():
    from datetime import date

    from app.notify import injury_phrase

    today = date(2026, 11, 21)
    assert injury_phrase(_row("2026-12-14"), today) == "Right knee: out ~23 days (back Dec 14)"
    assert injury_phrase(_row("2026-11-22"), today) == "Right knee: expected back tomorrow"
    assert injury_phrase(_row("2026-11-21", what=""), today) == "Listed to return today"


def test_injury_news_fires_on_a_new_injury_or_a_shift_not_on_drift_or_the_first_poll():
    from datetime import date

    from app.notify import injury_news, normalize_name

    players = {"1": {"name": "Jaren Jackson Jr."}}
    seen, today = {}, date(2026, 11, 21)
    key = normalize_name("Jaren Jackson Jr.")
    mk = lambda back, c="": {key: _row(back, comment=c)} if back else {}
    assert injury_news(seen, players, ["1"], mk("2026-11-23"), today) == []                       # first poll: record
    assert injury_news(seen, players, ["1"], mk("2026-11-24"), today) == []                       # 1-day drift: quiet
    got = injury_news(seen, players, ["1"], mk("2026-12-14", "Torn MCL, 6-to-8 weeks."), today)  # diagnosis: shift
    assert [g["text"] for g in got] == ["Jaren Jackson Jr. injury update: Right knee: out ~23 days (back Dec 14)\nTorn MCL, 6-to-8 weeks."]
    assert injury_news(seen, players, ["1"], mk("2026-12-14"), today) == []                       # unchanged: quiet
    assert injury_news(seen, players, ["1"], mk(None), today) == [] and seen["1"] is None          # healed: record
    assert len(injury_news(seen, players, ["1"], mk("2026-12-01"), today)) == 1                   # a new injury later: news


def test_an_injured_starter_gets_one_message_with_the_injury_and_days(monkeypatch):
    """Through the watcher: Jackson goes Out with an ESPN row -> the OUT line carries 'Right knee: out ~23 days'; no status or news duplicate."""
    from types import SimpleNamespace

    from app import notify
    from app.core.api import deps
    from app.lockin import service

    out = {"kind": "out", "sid": "1", "name": "Jaren Jackson Jr.", "backup": "B", "backup_sid": "2", "alarm": "now", "by": "2099-01-01T00:00Z",
           "text": "Jaren Jackson Jr. is OUT tonight: bench him and start B at C now."}
    plan = {"players": [{"sid": "1"}], "today": {"date": "2026-11-21", "watch": [out], "moves": []}}
    tag = {"v": None}
    rows = {"on": False}
    monkeypatch.setattr(deps, "_session", lambda *a: None)
    monkeypatch.setattr(service, "week_view", lambda *a, **k: {"today": "2026-11-21", "tz": "America/New_York", "week": 1,
                                                               "players": {"1": {"name": "Jaren Jackson Jr.", "injury_tag": tag["v"]}}})
    monkeypatch.setattr(service, "team_plan", lambda *a, **k: plan)
    monkeypatch.setattr(service, "read_locks", lambda *a: {})
    monkeypatch.setattr(service, "http_fetch", lambda *a, **k: None)
    monkeypatch.setattr(service, "espn_injuries", lambda f: {notify.normalize_name("Jaren Jackson Jr."): _row("2026-12-14")} if rows["on"] else {})
    monkeypatch.setattr(notify, "read_prefs", lambda accounts, uid: notify.NotifyPrefs().model_dump())
    msgs = []
    monkeypatch.setattr(notify, "send", lambda text, chat, accounts=None: chat == 7 and (msgs.append(text) or True))
    state = SimpleNamespace(store=None, platform=None, leagues=SimpleNamespace(list_ids=lambda: ["lg", "unlinked"]), accounts=linked_owner())
    sent, tags = set(), {}
    plan["today"]["watch"] = []
    notify.watch_once(state, sent, tags)                       # healthy baseline
    plan["today"]["watch"], tag["v"], rows["on"] = [out], "Out", True
    notify.watch_once(state, sent, tags)
    assert msgs == ["Jaren Jackson Jr. is OUT tonight: bench him and start B at C now.\nRight knee: out ~23 days (back Dec 14)"]
    notify.watch_once(state, sent, tags)
    assert len(msgs) == 1


def test_season_ending_is_a_return_after_the_regular_season_or_espn_saying_so():
    from datetime import date

    from app.notify import season_ending

    today = date(2026, 11, 21)
    assert season_ending(_row("2027-07-01"), today) and season_ending(_row("2027-04-15"), today)
    assert not season_ending(_row("2027-04-02"), today) and not season_ending(_row("2026-12-14"), today) and not season_ending(None, today)
    assert season_ending(_row("2026-12-14", comment="Ruled out for the rest of the season."), today)
    assert season_ending(_row("2027-07-01"), date(2027, 2, 1)) and not season_ending(_row("2027-03-01"), date(2027, 2, 1))


def test_the_message_that_reports_a_season_ending_injury_says_sorry_once(monkeypatch):
    """Through the watcher: a starter tears an ACL (ESPN back in July) -> one message with the sorry line; a daily OUT line later has none."""
    from types import SimpleNamespace

    from app import notify
    from app.core.api import deps
    from app.lockin import service

    out = {"kind": "out", "sid": "1", "name": "Jaren Jackson Jr.", "backup": "B", "backup_sid": "2", "alarm": "now", "by": "2099-01-01T00:00Z",
           "text": "Jaren Jackson Jr. is OUT tonight: bench him and start B at C now."}
    plan = {"players": [{"sid": "1"}], "today": {"date": "2026-11-21", "watch": [], "moves": []}}
    tag, day = {"v": None}, {"d": "2026-11-21"}
    row = {notify.normalize_name("Jaren Jackson Jr."): _row("2027-07-01")}
    monkeypatch.setattr(deps, "_session", lambda *a: None)
    monkeypatch.setattr(service, "week_view", lambda *a, **k: {"today": day["d"], "tz": "America/New_York", "week": 1,
                                                               "players": {"1": {"name": "Jaren Jackson Jr.", "injury_tag": tag["v"]}}})
    monkeypatch.setattr(service, "team_plan", lambda *a, **k: plan)
    monkeypatch.setattr(service, "read_locks", lambda *a: {})
    monkeypatch.setattr(service, "http_fetch", lambda *a, **k: None)
    monkeypatch.setattr(service, "espn_injuries", lambda f: row if tag["v"] else {})
    monkeypatch.setattr(notify, "read_prefs", lambda accounts, uid: notify.NotifyPrefs().model_dump())
    msgs = []
    monkeypatch.setattr(notify, "send", lambda text, chat, accounts=None: chat == 7 and (msgs.append(text) or True))
    state = SimpleNamespace(store=None, platform=None, leagues=SimpleNamespace(list_ids=lambda: ["lg", "unlinked"]), accounts=linked_owner())
    sent, tags = set(), {}
    notify.watch_once(state, sent, tags)                       # baseline
    tag["v"], plan["today"]["watch"] = "Out", [out]
    notify.watch_once(state, sent, tags)
    assert len(msgs) == 1 and msgs[0].endswith("Sorry about Jaren Jackson Jr., this looks like a season-ending injury. Hope the recovery goes well.")
    day["d"], plan["today"]["date"] = "2026-11-22", "2026-11-22"
    notify.watch_once(state, sent, tags)                       # next day's routine OUT reminder: no sorry
    assert len(msgs) == 2 and "Sorry" not in msgs[1]


def linked_owner():
    """Accounts where league "lg" belongs to the owner, whose Telegram chat 7 is linked, and "unlinked" to a plain user
    (no Telegram on that account type, so that league is skipped even with chat 8 linked)."""
    from app.accounts import Accounts

    from .conftest import ADMIN

    acc = Accounts(":memory:")
    uid, other = (acc.verify_login(acc.request_login(e, None))[1]["id"] for e in (ADMIN, "b@test.local"))
    acc.consume_link(acc.link_token(uid), 7, "Sam")
    acc.consume_link(acc.link_token(other), 8, "Bo")          # a plain user's chat: never sent to
    acc.own("lg", uid)
    acc.own("unlinked", other)
    return acc


def test_sleeper_budget_keeps_room_for_page_loads():
    """Background calls stop at their cap while page loads still go through, and both wait out the window instead of failing."""
    from nba_fantasy_shared.providers.sleeper_limit import SleeperLimiter

    t, slept = [0.0], []
    lim = SleeperLimiter(cap=5, background_cap=3, window_s=60, clock=lambda: t[0], sleep=lambda s: (slept.append(s), t.__setitem__(0, t[0] + s)))
    for _ in range(3):
        lim.acquire(background=True)
    assert not slept and lim.used() == 3
    lim.acquire(), lim.acquire()
    assert not slept and lim.used() == 5
    lim.acquire(background=True)            # 5 used, background cap 3: waits until 3 calls have aged out
    assert slept and t[0] >= 60 and lim.used() <= 3


def test_watcher_polls_every_minute_only_near_games(monkeypatch):
    """With no game live or within 2 h, a league is polled once per QUIET_S; a live game makes every round poll."""
    from types import SimpleNamespace

    from app import notify
    from app.lockin import service

    calls, live = [], {"on": False}

    def session(state, lid):
        """Record the poll and stop there (the plan itself is covered elsewhere)."""
        calls.append(lid)
        raise ValueError("stop")

    monkeypatch.setattr(service, "http_fetch", lambda *a, **k: None)
    monkeypatch.setattr(service, "espn_day", lambda f, d, today: {"BOS": {"state": "in" if live["on"] else "pre", "tip": "2099-01-01T00:00Z"}})
    monkeypatch.setattr("app.core.api.deps._session", session)
    state = SimpleNamespace(store=None, platform=None, leagues=SimpleNamespace(list_ids=lambda: ["lg", "unlinked"]), accounts=linked_owner())
    last: dict = {}
    for _ in range(3):
        notify.watch_once(state, set(), {}, last)
    assert calls == ["lg"]                  # quiet: first round only; the unlinked league never
    live["on"] = True
    notify.watch_once(state, set(), {}, last)
    notify.watch_once(state, set(), {}, last)
    assert calls == ["lg", "lg", "lg"]


def test_alerts_go_out_at_the_users_lead_time():
    """Lock / swap / GTD alarms move to the user's minutes before the tip, lineup moves too; 'now' lines don't move."""
    from app.notify import NotifyPrefs, move_lines, retime

    prefs = {**NotifyPrefs().model_dump(), "lock_lead": 60, "swap_lead": 10, "dtd_lead": 45, "moves_lead": 20}
    tip = "2026-11-21T00:30:00+00:00"
    assert retime({"kind": "lock", "by": tip, "alarm": "2026-11-21T00:00:00+00:00"}, prefs)["alarm"] == "2026-11-20T23:30:00+00:00"
    assert retime({"kind": "swap", "by": tip, "alarm": "x"}, prefs)["alarm"] == "2026-11-21T00:20:00+00:00"
    assert retime({"kind": "gtd", "by": tip, "alarm": "x"}, prefs)["alarm"] == "2026-11-20T23:45:00+00:00"
    assert retime({"kind": "out", "by": tip, "alarm": "now"}, prefs)["alarm"] == "now"
    assert retime({"kind": "status", "alarm": "now"}, prefs)["alarm"] == "now"
    assert move_lines([{"sid": "1", "to": "SG", "by": tip}], prefs["moves_lead"])[0]["alarm"] == "2026-11-21T00:10:00+00:00"
    d = NotifyPrefs().model_dump()
    assert (d["lock_lead"], d["swap_lead"], d["dtd_lead"], d["moves_lead"]) == (30, 5, 30, 30)
