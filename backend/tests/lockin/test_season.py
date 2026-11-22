
from datetime import date

from app.lockin.service import actual_fp, current_week, days_still_out, ir_worthy, merge_sources, week_view
from tests.test_session import JOKIC, fixture_world, make_session  # noqa: F401  (pytest fixture)


def test_week_view_joins_schedule_projections_scores_and_tips(fixture_world):
    """Week view joins schedule projections scores and tips."""
    s = make_session(fixture_world, sleeper_league_id="L1")
    rec = s.players[JOKIC]
    s.players[JOKIC] = rec = rec.model_copy(update={"sleeper_id": "999", "team_abbr": "DEN"})
    s.managers[0] = s.managers[0].model_copy(update={"sleeper_roster_id": 1})
    box = {"pts": 40, "reb": 12, "ast": 10, "stl": 1, "blk": 1, "to": 3, "fgm": 15, "fga": 25, "ftm": 8, "fta": 9, "tpm": 2, "sp": 2160}
    canned = {
        "schedule/nba/regular/2026": [{"date": "2026-10-20", "week": 1, "home": {"team": "DEN"}, "away": {"team": "LAL"}},
                                      {"date": "2026-10-22", "week": 1, "home": {"team": "PHX"}, "away": {"team": "DEN"}},
                                      {"date": "2026-10-27", "week": 2, "home": {"team": "DEN"}, "away": {"team": "UTA"}}],
        "projections/nba/2026/1": [{"player_id": "999", "date": "2026-10-22", "stats": {"pts": 28, "reb": 12, "ast": 10}}],
        "stats/nba/2026/1": [{"player_id": "999", "date": "2026-10-20", "stats": box}],
        "league/L1/rosters": [{"roster_id": 1, "owner_id": "u1", "players": ["999"], "starters": ["999"],
                               "settings": {"wins": 1, "losses": 0, "fpts": 50, "fpts_decimal": 25},
                               "metadata": {"p_nick_999": " The Joker ", "p_nick_123": "traded away", "allow_pn": "on"}}],
        "league/L1/users": [{"user_id": "u1", "display_name": "me", "avatar": "abc", "metadata": {"team_name": "Joker Fans"}}],
        "league/L1/matchups/1": [{"roster_id": 1, "matchup_id": 1, "points": 31.5}, {"roster_id": 2, "matchup_id": 1, "points": 20}],
        "scoreboard?dates=20261020": {"events": [{"date": "2026-10-21T02:00Z", "status": {"type": {"state": "post", "shortDetail": "Final"}},
                                                  "competitions": [{"competitors": [{"homeAway": "home", "team": {"abbreviation": "DEN"}},
                                                                                    {"homeAway": "away", "team": {"abbreviation": "LAL"}}]}]}]},
    }
    fetch = lambda url, ttl: next((v for k, v in canned.items() if k in url), None)

    w = week_view(s, fetch, today=date(2026, 10, 21))
    assert w["week"] == 1 and w["dates"] == ["2026-10-20", "2026-10-22"]
    team = w["teams"][0]
    assert team["name"] == "Joker Fans" and team["user"] == "me" and team["avatar"] == "https://sleepercdn.com/avatars/thumbs/abc"
    assert w["players"]["999"]["nick"] == "The Joker" and "123" not in w["players"]
    assert team["is_user"] and team["fpts"] == 50.25 and team["wins"] == 1
    assert [len(m) for m in w["matchups"]] == [2]
    g1, g2 = w["players"]["999"]["games"]
    assert g1["opp"] == "LAL" and g1["state"] == "post" and g1["min"] == 36.0
    assert g1["fp"] == round(actual_fp(box, s.league.scoring), 2) and g1["fp"] > 20
    assert g2["opp"] == "PHX" and g2["fp"] is None and g2["proj"] > 0 and g2["tip"] is None

    from app.lockin import service as season
    real = season.today_ct
    season.today_ct = lambda *_: date(2026, 10, 20)
    try:
        assert week_view(s, fetch)["day"] == "2026-10-22"
    finally:
        season.today_ct = real
    season.RETIRED.add("999")
    try:
        p = week_view(s, fetch, today=date(2026, 10, 21))["players"]["999"]
        assert p["retired"] and p["games"] == []
    finally:
        season.RETIRED.discard("999")


def test_best_games_ranks_every_players_games_by_league_fp_with_the_game(fixture_world):
    """Best games: anyone's games (rostered or not) ranked by league FP, best first, with stat line and ESPN game."""
    from app.lockin.service import best_games

    s = make_session(fixture_world, sleeper_league_id="L1")
    s.players[JOKIC] = s.players[JOKIC].model_copy(update={"sleeper_id": "999", "team_abbr": "DEN"})
    big = {"pts": 40, "reb": 12, "ast": 10, "fgm": 15, "fga": 25, "ftm": 8, "fta": 9, "sp": 2160}
    canned = {
        "schedule/nba/regular/2026": [{"date": "2026-10-20", "week": 1, "home": {"team": "DEN"}, "away": {"team": "LAL"}}],
        "stats/nba/2026/1": [{"player_id": "5", "date": "2026-10-20", "team": "LAL", "opponent": "DEN", "stats": {"pts": 10, "sp": 1200},
                              "player": {"first_name": "Some", "last_name": "Guy", "fantasy_positions": ["SF"]}},
                             {"player_id": "999", "date": "2026-10-20", "team": "DEN", "opponent": "LAL", "stats": big},
                             {"player_id": "7", "date": "2026-10-20", "team": "LAL", "stats": {}},
                             {"player_id": "TEAM_DEN", "date": "2026-10-20", "team": "DEN", "stats": {"pts": 120, "sp": 14400}}],
        "scoreboard?dates=20261020": {"events": [{"id": "401", "date": "2026-10-21T02:00Z", "status": {"type": {"state": "post"}},
                                                  "competitions": [{"competitors": [{"homeAway": "home", "score": "120", "team": {"abbreviation": "DEN"}},
                                                                                    {"homeAway": "away", "score": "110", "team": {"abbreviation": "LAL"}}]}]}]},
    }
    got = best_games(s, lambda url, ttl: next((v for k, v in canned.items() if k in url), None), today=date(2026, 10, 21))
    assert [g["sid"] for g in got] == ["999", "5"] and got[0]["player_id"] == JOKIC and got[1]["name"] == "Some Guy"
    assert got[0]["fp"] == round(actual_fp(big, s.league.scoring), 2) and got[0]["lead"][0] == ["PTS", 40] and got[0]["fg"] == [15, 25]
    assert got[0]["game"].items() >= {"event": "401", "opp": "LAL", "home": True, "score": "120", "opp_score": "110", "state": "post"}.items()


def test_current_week_is_the_monday_to_sunday_span_holding_today():
    """Current week is the monday to sunday span holding today."""
    weeks = {1: ["2026-10-20", "2026-10-25"], 2: ["2026-10-26", "2026-11-01"]}
    assert current_week(weeks, date(2026, 10, 16)) == 1
    assert current_week(weeks, date(2026, 10, 25)) == 1
    assert current_week(weeks, date(2026, 10, 26)) == 2
    assert current_week(weeks, date(2027, 6, 1)) == 2


def test_lock_detection_and_your_answers():
    """Lock detection and your answers."""
    from app.lockin.service import detect_lock

    games = [{"date": "2026-10-20", "fp": 18.5}, {"date": "2026-10-22", "fp": 11.0}, {"date": "2026-10-24", "fp": None}]
    assert detect_lock(18.5, games, None) == ("locked", "2026-10-20")
    assert detect_lock(11.0, games, None) == ("maybe", "2026-10-22")
    assert detect_lock(0, games, None) == ("no", None)
    assert detect_lock(11.0, games, "2026-10-20") == ("locked", "2026-10-20")
    assert detect_lock(18.5, games, "") == ("no", None)


def test_lock_answers_are_saved_per_league_and_week(tmp_path):
    """Lock answers are saved per league and week."""
    from app.lockin.service import read_locks, write_lock
    from nba_fantasy_shared.storage import JsonStore

    store = JsonStore(tmp_path)
    write_lock(store, "lg", 1, "999", "2026-10-20")
    write_lock(store, "lg", 1, "111", "")
    assert read_locks(store, "lg", 1) == {"999": "2026-10-20", "111": ""} and read_locks(store, "lg", 2) == {}
    write_lock(store, "lg", 1, "999", None)
    assert read_locks(store, "lg", 1) == {"111": ""}


def test_roster_rules_flag_a_healthy_player_on_ir_and_open_ir_spots(fixture_world):
    """Roster rules flag a healthy player on ir and open ir spots."""
    from app.lockin.service import team_plan

    s = make_session(fixture_world)
    positions = ["PG", "SG", "BN"]
    pl = lambda sid, inj="healthy": {"player_id": None, "name": sid, "team": "DEN", "pos": ["PG"], "injury": inj,
                                     "injury_note": "", "retired": False, "games": []}
    view = {"today": "2026-10-16", "dates": [], "roster_positions": positions, "reserve_slots": 2, "matchups": [],
            "players": {"a": pl("a"), "b": pl("b"), "c": pl("c", "out_long_term"), "back": pl("back")},
            "teams": [{"roster_id": 1, "name": "me", "is_user": True, "players": ["a", "b", "c", "back"],
                       "starters": ["a", "b"], "reserve": ["back"]}]}
    r = team_plan(s, view)["roster"]
    assert r["illegal"] == ["back"]
    assert r["ir_open"] == 1 and r["ir_candidates"] == ["c"]


def test_a_counted_latest_game_is_guessed_locked_when_locking_beats_waiting(fixture_world):
    """A counted latest game is guessed locked when locking beats waiting."""
    from app.lockin.service import team_plan

    s = make_session(fixture_world)
    g = lambda d, fp=None, proj=10.0, st="pre": {"date": d, "proj": proj, "fp": fp, "state": st, "tip": None, "min": None}
    pl = lambda sid, games: {"player_id": None, "name": sid, "team": "DEN", "pos": ["PG"], "injury": "healthy",
                             "injury_note": "", "retired": False, "games": games}
    view = {"today": "2026-10-21", "dates": [], "roster_positions": ["PG", "PG"], "reserve_slots": 0,
            "matchups": [[{"roster_id": 1, "players_points": {"hot": 18.6, "cold": 4.0}}]],
            "players": {"hot": pl("hot", [g("2026-10-20", 18.6, st="post"), g("2026-10-23")]),
                        "cold": pl("cold", [g("2026-10-20", 4.0, st="post"), g("2026-10-23")])},
            "teams": [{"roster_id": 1, "name": "rival", "is_user": False, "players": ["hot", "cold"], "starters": ["hot", "cold"], "reserve": []}]}
    out = {p["sid"]: p for p in team_plan(s, view, roster_id=1)["players"]}
    assert out["hot"]["lock_status"] == "guess" and out["hot"]["locked"] == 18.6
    assert out["cold"]["lock_status"] == "maybe" and out["cold"]["locked"] is None
    assert team_plan(s, view, roster_id=1)["points"] == 18.6
    view["players"]["hot"]["games"][0]["state"] = "in"
    assert {p["sid"]: p["lock_status"] for p in team_plan(s, view, roster_id=1)["players"]}["hot"] == "maybe"
    view["players"]["hot"]["games"][0]["state"] = "post"
    view["teams"][0]["is_user"] = True
    assert team_plan(s, view)["points"] == 0


def test_news_merges_my_players_newest_first_and_flags_injuries():
    """News merges my players newest first and flags injuries."""
    from app.lockin.service import season_news

    note = lambda t, d, ms: {"published": ms, "metadata": {"title": t, "description": d}}
    feeds = {"a": [note("Al Pha - Questionable", "Pha (ankle) is questionable Monday.", 1_792_000_000_000),
                   note("", "", 1_792_900_000_000)],
             "b": [note("Bo Ta - Resting Monday", "Ta (rest) won't play Monday.", 1_792_100_000_000)],
             "c": [note("Cy Ga - Suffers torn Achilles", "Ga suffered a season-ending Achilles tear, Shams Charania reports.", 1_792_200_000_000)],
             "f": [note("Ben Simmons - Suffers torn Achilles", "Simmons tore his right Achilles.", 1_792_300_000_000)]}
    fetch = lambda url, ttl: {} if "injuries" in url else feeds[url.split("/")[-2]]

    view = {"teams": [{"is_user": True, "name": "me", "user": "meuser", "players": ["a", "b"]},
                      {"is_user": False, "name": "rival", "user": "rivaluser", "players": ["c"]}],
            "players": {"a": {"name": "Al Pha", "player_id": 1}, "b": {"name": "Bo Ta", "player_id": 2}, "c": {"name": "Cy Ga", "player_id": 3},
                        "f": {"name": "Ben Simmons", "player_id": 4, "team": "SAC"}}}
    n = season_news(view, fetch, free=["f", "c", "zz"])
    assert [(x["headline"], x["injury"]) for x in n["mine"]] == [("Bo Ta - Resting Monday", False), ("Al Pha - Questionable", True)]
    assert [(x["headline"], x["injury"], x["user"]) for x in n["league"]] == [("Cy Ga - Suffers torn Achilles", True, "rivaluser")]
    assert [(x["name"], x["team"], x["owner"]) for x in n["free"]] == [("Ben Simmons", "SAC", None)]
    assert n["mine"][0]["published"].startswith("2026-")


def test_acquisitions_draft_price_then_moves_in_order():
    """Acquisitions draft price then moves in order."""
    from types import SimpleNamespace

    from app.lockin.service import acquisitions

    def fetch(url, ttl):
        """Stub fetcher returning canned Sleeper league responses by URL."""
        if url.endswith("/league/L"):
            return {"draft_id": "D"}
        if "/draft/D/picks" in url:
            return [{"player_id": "9", "roster_id": 1, "is_keeper": False, "metadata": {"amount": "24"}}]
        if url.endswith("/transactions/1"):
            return [{"type": "waiver", "status": "complete", "adds": {"9": 2}, "drops": None, "settings": {"waiver_bid": 7}, "status_updated": 30},
                    {"type": "free_agent", "status": "complete", "adds": None, "drops": {"9": 1}, "status_updated": 20},
                    {"type": "waiver", "status": "failed", "adds": {"9": 3}, "settings": {"waiver_bid": 9}, "status_updated": 25}]
        return []

    session = SimpleNamespace(league=SimpleNamespace(sleeper_league_id="L"))
    view = {"week": 1, "teams": [{"roster_id": 1, "name": "me"}, {"roster_id": 2, "name": "rival"}, {"roster_id": 3, "name": "other"}]}
    assert [(a["kind"], a["team"], a["price"]) for a in acquisitions(session, fetch, view, "9")] == [
        ("drafted", "me", 24), ("dropped", "me", None), ("claimed", "rival", 7)]


def test_waivers_say_so_when_sleeper_sent_no_waiver_settings():
    """Waivers say so when sleeper sent no waiver settings."""
    from app.lockin.service import waivers

    assert waivers(None, None, {"teams": [], "waiver": None}) == {"error": "Couldn't receive Sleeper waiver and FAAB data.", "claims": []}


def test_timeline_hands_the_slot_to_a_later_player_at_his_check_in():
    """Timeline hands the slot to a later player at his check in."""
    from app.lockin.service import week_timeline
    from app.lockin.weekplan import Game, PlanPlayer, plan_week

    shai = PlanPlayer(sid="s", name="s", eligibility=["PG"], slot="PG", games=[Game("2026-10-20", 15, tip="2026-10-21T01:30:00Z")])
    reav = PlanPlayer(sid="r", name="r", eligibility=["PG"], slot="BN", games=[Game("2026-10-21", 12, tip="2026-10-22T02:00:00Z")])
    plan_week([shai, reav], {"PG": 1})
    view = {"tz": "America/Chicago", "dates": ["2026-10-20", "2026-10-21"], "day": "2026-10-20"}
    segs = week_timeline([shai, reav], {"PG": 1}, view, None)["segments"]
    assert [(x["seats"]["PG"], x["to"][:16]) for x in segs] == [
        (["s"], "2026-10-21T20:45"),
        (["r"], "2026-10-26T00:00")]
    assert shai.slot == "PG" and not shai.games[0].started


def test_timeline_does_a_nights_swaps_at_one_check_in_and_never_moves_a_player_mid_game():
    """Timeline does a nights swaps at one check in and never moves a player mid game."""
    from app.lockin.service import week_timeline
    from app.lockin.weekplan import Game, PlanPlayer, plan_week

    def guy(sid, slot, tip):
        """A one-game plan player in slot `slot`, tipping at `tip` on Wed 10/21 (CDT)."""
        return PlanPlayer(sid=sid, name=sid, eligibility=["C"], slot=slot, games=[Game("2026-10-21", 20, tip=tip)])
    six, six30, seven = guy("6:00", "C", "2026-10-21T23:00:00Z"), guy("6:30", "C", "2026-10-21T23:30:00Z"), guy("7:00", "C", "2026-10-22T00:00:00Z")
    nine, nine30 = guy("9:00", "BN", "2026-10-22T02:00:00Z"), guy("9:30", "BN", "2026-10-22T02:30:00Z")
    ps = [six, six30, seven, nine, nine30]
    plan_week(ps, {"C": 3})
    view = {"tz": "America/Chicago", "dates": ["2026-10-21"], "day": "2026-10-21"}
    segs = week_timeline(ps, {"C": 3}, view, None)["segments"]
    assert [(sorted(x["seats"]["C"]), x["to"][:16]) for x in segs] == [
        (["6:00", "6:30", "7:00"], "2026-10-21T20:45"),
        (["7:00", "9:00", "9:30"], "2026-10-26T00:00")]


def test_lead_stats_points_first_then_what_is_worth_fantasy_points(fixture_world):
    """Lead stats points first then what is worth fantasy points."""
    from app.lockin.service import lead_stats

    s = make_session(fixture_world)
    lead = lead_stats({"pts": 20, "reb": 10, "ast": 1, "stl": 0, "blk": 3, "tpm": 0}, s.league.scoring)
    assert lead[0] == ["PTS", 20] and lead[1:] == [["REB", 10], ["BLK", 3], ["AST", 1]]
    assert not any(label in ("STL", "3PM") for label, _ in lead)
    assert lead_stats({"pts": 7, "reb": 2}, s.league.scoring) == [["PTS", 7], ["REB", 2]]
    many = lead_stats({"pts": 30, "reb": 9, "ast": 8, "stl": 3, "blk": 2, "tpm": 4}, s.league.scoring)
    assert len(many) == 5 and many[0][0] == "PTS"


def test_team_ranks_offense_from_its_box_scores_and_defense_from_its_opponents():
    """Team ranks offense from its box scores and defense from its opponents."""
    from app.lockin.service import team_ranks

    def row(team, opp, game="g1", **st):
        """One team's box-score row for a game."""
        return {"player_id": f"TEAM_{team}", "team": team, "opponent": opp, "game_id": game, "stats": st}
    rows = [row("MEM", "BOS", pts=120, reb=50, to=20), row("BOS", "MEM", pts=100, reb=40, to=10),
            row("MEM", "DEN", pts=110, reb=50, to=18), row("DEN", "MEM", pts=130, reb=45, to=12),
            row("DEN", "BOS", pts=105, reb=35, to=15), row("BOS", "DEN", pts=115, reb=40, to=14),
            {"player_id": "123", "team": "MEM", "opponent": "BOS", "game_id": "g1", "stats": {"pts": 40}},
            row("MEM", "LAL", game="live", pts=30, reb=9, to=2)]
    done = {"g1"}
    r = team_ranks(rows, "MEM", done)
    assert r["games"] == 2 and r["teams"] == 3
    assert r["offense"]["pts"] == {"v": 115.0, "rank": 2}
    assert r["offense"]["reb"]["rank"] == 1 and r["offense"]["to"]["rank"] == 3
    assert r["defense"]["pts"] == {"v": 115.0, "rank": 3}
    assert team_ranks(rows, "BOS", done)["offense"]["reb"]["rank"] == 2 == team_ranks(rows, "DEN", done)["offense"]["reb"]["rank"]
    assert team_ranks(rows, "LAL", done) is None


def test_next_waiver_run_is_the_coming_saturday_or_sunday_at_2_am():
    """Next waiver run is the coming saturday or sunday at 2 am."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.lockin.service import next_waiver_run

    ct = ZoneInfo("America/Chicago")
    at = lambda *a: datetime(*a, tzinfo=ct)
    assert next_waiver_run(at(2026, 10, 21, 15, 0), [5, 6], 2) == at(2026, 10, 24, 2, 0)
    assert next_waiver_run(at(2026, 10, 24, 1, 59), [5, 6], 2) == at(2026, 10, 24, 2, 0)
    assert next_waiver_run(at(2026, 10, 24, 18, 0), [5, 6], 2) == at(2026, 10, 25, 2, 0)
    assert next_waiver_run(at(2026, 10, 25, 2, 0), [5, 6], 2) == at(2026, 10, 31, 2, 0)
    assert next_waiver_run(at(2026, 10, 24, 18, 0), [2], 0) == at(2026, 10, 28, 0, 0)


def test_season_averages_count_finished_games_in_league_scoring(fixture_world):
    """Season averages count finished games in league scoring."""
    from app.lockin.service import season_averages

    s = make_session(fixture_world)
    box = {"pts": 20, "reb": 10, "ast": 4, "stl": 1, "blk": 1, "to": 2, "tpm": 2, "sp": 1800}
    rows = [{"player_id": "7", "game_id": "g1", "stats": box},
            {"player_id": "7", "game_id": "g2", "stats": {**box, "pts": 10, "reb": 6}},
            {"player_id": "7", "game_id": "live", "stats": {**box, "pts": 2}},
            {"player_id": "7", "game_id": "g3", "stats": {"pts": 0}},
            {"player_id": "8", "game_id": "g1", "stats": box}]
    a = season_averages(rows, {"7"}, {"g1", "g2", "g3"}, s.league.scoring)
    assert set(a) == {"7"} and a["7"]["gp"] == 2 and a["7"]["pts"] == 15.0 and a["7"]["reb"] == 8.0
    assert a["7"]["fp"] == round((actual_fp(box, s.league.scoring) + actual_fp({**box, "pts": 10, "reb": 6}, s.league.scoring)) / 2, 2)


def test_game_card_shows_both_teams_before_the_tip_with_their_ranks(fixture_world):
    """Game card shows both teams before the tip with their ranks."""
    from app.lockin.service import game_detail

    s = make_session(fixture_world)
    team = lambda abbr, name, ha, rec: {"homeAway": ha, "team": {"abbreviation": abbr, "displayName": name,
                                                                "logos": [{"href": f"https://logo/{abbr}.png"}]},
                                       "record": [{"type": "total", "summary": rec}]}
    canned = {
        "summary?event=9": {"header": {"competitions": [{"date": "2026-10-25T22:00Z", "status": {"type": {"state": "pre"}},
                                                         "competitors": [team("UTAH", "Utah Jazz", "home", "1-1"), team("LAL", "Los Angeles Lakers", "away", "2-0")]}]}},
        "schedule/nba/regular/2026": [{"date": "2026-10-21", "week": 1, "status": "complete", "game_id": "g1",
                                       "home": {"team": "UTA"}, "away": {"team": "LAL"}}],
        "stats/nba/2026/1": [{"player_id": "TEAM_UTA", "team": "UTA", "opponent": "LAL", "game_id": "g1", "stats": {"pts": 100}},
                             {"player_id": "TEAM_LAL", "team": "LAL", "opponent": "UTA", "game_id": "g1", "stats": {"pts": 110}}],
    }
    g = game_detail(s, lambda url, ttl: next((v for k, v in canned.items() if k in url), None), "9")
    away, home = g["teams"]
    assert g["state"] == "pre" and (away["abbr"], home["abbr"]) == ("LAL", "UTA")
    assert home["name"] == "Utah Jazz" and home["record"] == "1-1" and home["logo"] == "https://logo/UTAH.png"
    assert home["players"] == [] and home["ranks"]["offense"]["pts"]["rank"] == 2 and away["ranks"]["offense"]["pts"]["rank"] == 1


def test_sleeper_injuries_tag_every_hurt_player_red_or_yellow():
    """Sleeper injuries tag every hurt player red or yellow."""
    from app.lockin.service import sleeper_injuries

    feed = {"1": {"full_name": "Zach Edey", "team": "MEM", "injury_status": "Out", "injury_body_part": "Ankle"},
            "2": {"full_name": "Cedric Coward", "team": "MEM", "injury_status": "GTD", "injury_body_part": "Wrist"},
            "3": {"full_name": "Healthy Guy", "team": "MEM", "injury_status": None},
            "4": {"full_name": "Free Agent", "team": None, "injury_status": "Out"},
            "5": {"full_name": "Long Term", "team": "BKN", "injury_status": "IR"}}
    hurt = sleeper_injuries(lambda url, ttl: feed)
    assert set(hurt) == {"1", "2", "5"}
    assert (hurt["1"]["group"], hurt["2"]["group"], hurt["5"]["group"]) == ("out", "q", "out")
    assert hurt["1"]["body"] == "Ankle" and hurt["2"]["team"] == "MEM"
    assert sleeper_injuries(lambda url, ttl: (_ for _ in ()).throw(OSError("down"))) == {}


def test_team_card_schedule_stats_and_injury_report(fixture_world):
    """Team card schedule stats and injury report."""
    from app.lockin.service import injury_report, team_player_stats, team_schedule

    sched = [{"date": "2026-10-22", "status": "complete", "home": {"team": "MEM", "points": 110}, "away": {"team": "UTA", "points": 120}},
             {"date": "2026-10-20", "status": "complete", "home": {"team": "BOS", "points": 99}, "away": {"team": "MEM", "points": 101}},
             {"date": "2026-10-25", "status": "pre_game", "home": {"team": "SAC"}, "away": {"team": "MEM"}},
             {"date": "2026-10-21", "status": "complete", "home": {"team": "LAL"}, "away": {"team": "DEN"}}]
    s = team_schedule(sched, "MEM")
    assert [(g["date"], g["home"], g["opp"], g["result"]) for g in s] == [
        ("2026-10-20", False, "BOS", "W"), ("2026-10-22", True, "UTA", "L"), ("2026-10-25", False, "SAC", None)]
    assert (s[0]["pts"], s[0]["opp_pts"]) == (101, 99)

    sess = make_session(fixture_world)
    sess.players[JOKIC] = sess.players[JOKIC].model_copy(update={"sleeper_id": "999", "team_abbr": "DEN"})
    line = {"sp": 2100, "pts": 30, "reb": 12, "ast": 9, "fgm": 12, "fga": 20, "ftm": 4, "fta": 5, "tpm": 2, "tpa": 4}
    rows = [{"player_id": "999", "team": "DEN", "game_id": "g1", "stats": line},
            {"player_id": "999", "team": "DEN", "game_id": "g2", "stats": {**line, "pts": 20, "fgm": 8}},
            {"player_id": "999", "team": "DEN", "game_id": "live", "stats": line},
            {"player_id": "TEAM_DEN", "team": "DEN", "game_id": "g1", "stats": line}]
    j = next(r for r in team_player_stats(sess, rows, {"g1", "g2"}, "DEN") if r["sleeper_id"] == "999")
    assert j["gp"] == 2 and j["pts"] == 25.0 and j["min"] == 35.0 and j["fg_pct"] == 50.0 and j["ft_pct"] == 80.0

    hurt = {"1": {"name": "A", "team": "MEM", "group": "out"}, "2": {"name": "B", "team": "MEM", "group": "q"},
            "3": {"name": "C", "team": "BKN", "group": "out", "starter": True}, "4": {"name": "D", "team": "LAL", "group": "q"},
            "5": {"name": "E", "team": "LAL", "group": "q", "starter": True}}
    rep = injury_report(hurt)
    assert [t["abbr"] for t in rep] == ["BKN", "LAL", "MEM"] and rep[0]["starters_out"] == 1 and rep[1]["starters_q"] == 1
    assert (rep[2]["out"], rep[2]["q"], rep[2]["starters_out"]) == (1, 1, 0) and rep[1]["players"][0]["name"] == "E"


def test_ir_only_for_foreseeable_long_absences():
    """Sleeper IR status or a structural-injury note qualifies; illness, bruise, strain, spasms, healthy don't."""
    assert ir_worthy("out_long_term", None) and ir_worthy("out_season", "")
    assert ir_worthy("out_short_term", "Achilles - Surgery") and ir_worthy("out_short_term", "Foot - Fracture")
    assert not any(ir_worthy("out_short_term", n) for n in ("Illness", "Hip - Bruise", "Calf - Strain", "Back - Spasms", None))
    assert not ir_worthy("healthy", "Knee - Surgery")


def _story(head, text, published):
    """A news item in player_news's shape."""
    return {"headline": head, "story": text, "published": published, "injury": True}


def test_days_still_out_reads_durations_from_news():
    """Real FantasyPros/RotoWire wording (Jaren Jackson Jr., torn MCL): lower bound of the range, counted from the story's date."""
    from datetime import datetime, timezone
    now = datetime(2026, 11, 21, tzinfo=timezone.utc)
    mcl = _story("Jaren Jackson Jr. (knee) to miss 6-8 weeks", "Jaren Jackson Jr. has been diagnosed with a torn MCL in his right knee and will be sidelined for 6-8 weeks.", "2026-10-28T00:00:00+00:00")
    assert round(days_still_out([mcl], now)) == 42 - 24
    least = _story("Jaren Jackson - Expected to miss at least six weeks", "", "2026-11-21T00:00:00+00:00")
    assert days_still_out([least], now) == 42
    assert days_still_out([_story("X out for the season", "", "2026-11-20T00:00:00+00:00")], now) > 900
    assert days_still_out([_story("X cleared to return", "", "2026-11-20T00:00:00+00:00"), mcl], now) == 0
    for vague in ("X (knee) is week-to-week", "X is day-to-day with a sore hip", "X suffers knee injury Monday"):
        assert days_still_out([_story(vague, "", "2026-11-20T00:00:00+00:00")], now) is None
    assert days_still_out([], now) is None


def test_ir_candidate_comes_from_news_when_sleeper_only_says_out(fixture_world):
    """Sleeper marks him just Out, but the news says 6-8 weeks: he's an IR candidate; a different Out player is not."""
    from datetime import datetime, timezone

    from app.lockin.service import team_plan

    s = make_session(fixture_world)
    pl = lambda sid, inj="healthy": {"player_id": None, "name": sid, "team": "DEN", "pos": ["PG"], "injury": inj,
                                     "injury_note": "", "retired": False, "games": []}
    view = {"today": "2026-10-16", "dates": [], "roster_positions": ["PG", "SG", "BN"], "reserve_slots": 1, "matchups": [],
            "players": {"a": pl("a"), "jj": pl("jj", "out_short_term"), "ill": pl("ill", "out_short_term")},
            "teams": [{"roster_id": 1, "name": "me", "is_user": True, "players": ["a", "jj", "ill"], "starters": ["a", "jj"], "reserve": []}]}
    ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    feeds = {"jj": [{"published": ms, "metadata": {"title": "JJ (knee) to miss 6-8 weeks", "description": "Torn MCL, sidelined for 6-8 weeks."}}],
             "ill": [{"published": ms, "metadata": {"title": "ill is out with an illness", "description": "Day-to-day."}}]}
    fetch = lambda url, ttl: {} if "injuries" in url else feeds[url.split("/")[-2]]
    assert team_plan(s, view, fetch=fetch)["roster"]["ir_candidates"] == ["jj"]
    assert team_plan(s, view)["roster"]["ir_candidates"] == []


def test_days_still_out_live_wording_cases():
    """Wording seen in the live feed: 'two more weeks' counts; 'will return at some point this season' is long, not back."""
    from datetime import datetime, timezone
    now = datetime(2026, 11, 21, tzinfo=timezone.utc)
    hali = _story("Tyrese Haliburton - Expected to miss at least two more weeks", "", "2026-11-20T00:00:00+00:00")
    assert round(days_still_out([hali], now)) == 13
    dv = _story("Donte DiVincenzo (Achilles) expected to return at some point this season", "Connelly believes DiVincenzo will return at some point this season", "2026-10-05T00:00:00+00:00")
    assert days_still_out([dv], now) > 900


def test_espn_return_date_decides_when_it_has_a_row(fixture_world):
    """ESPN's return date beats the news text: 8+ days out = IR candidate, 'tomorrow' = not, even if the news says weeks."""
    from app.lockin.service import ESPN_INJURIES, team_plan

    s = make_session(fixture_world)
    pl = lambda sid, inj="healthy": {"player_id": None, "name": sid, "team": "DEN", "pos": ["PG"], "injury": inj,
                                     "injury_note": "", "retired": False, "games": []}
    view = {"today": "2026-11-21", "dates": [], "roster_positions": ["PG", "SG", "BN"], "reserve_slots": 2, "matchups": [],
            "players": {"a": pl("a"), "far": pl("far", "out_short_term"), "near": pl("near", "out_short_term")},
            "teams": [{"roster_id": 1, "name": "me", "is_user": True, "players": ["a", "far", "near"], "starters": ["a", "far"], "reserve": []}]}
    row = lambda name, back: {"athlete": {"displayName": name}, "details": {"returnDate": back}}
    espn = {"injuries": [{"injuries": [row("far", "2026-12-14"), row("near", "2026-11-22")]}]}
    fetch = lambda url, ttl: espn if url == ESPN_INJURIES else []
    assert team_plan(s, view, fetch=fetch)["roster"]["ir_candidates"] == ["far"]


def test_news_from_both_providers_is_one_entry_per_event():
    """Sleeper's feed has FantasyPros and RotoWire reporting each event; Shai's real entries merge to 3, FantasyPros kept."""
    item = lambda src, at, head, story: {"source": src, "published": f"2026-11-{at}:00+00:00", "headline": head, "story": story, "injury": False}
    sga = "Shai Gilgeous-Alexander"
    feed = [
        item("fantasy_pros", "21T23:00", f"{sga} (back/neck) listed questionable Sunday", f"{sga} is listed as questionable for Sunday's game against the Heat."),
        item("rotowire", "21T22:45", f"{sga} - Questionable to play Sunday", "Gilgeous-Alexander (back/neck) is listed as questionable for Sunday's game versus Miami."),
        item("fantasy_pros", "21T14:55", f"{sga} leads offense in Friday's win over Pelicans",
             f"{sga} led the Thunder offense Friday night, scoring 40 points (14-24 FG, 4-7 3PT, 8-11 FT) in a 126-120 win over the Pelicans."),
        item("rotowire", "21T03:37", f"{sga} - Drops 40-piece in win",
             "Gilgeous-Alexander recorded 40 points (14-24 FG, 4-7 3Pt, 8-11 FT) during Friday's 126-120 win over the Pelicans."),
        item("fantasy_pros", "19T15:20", f"{sga} scores 34 in Wednesday's loss", f"{sga} scored 34 points in a loss to the Grizzlies on Wednesday."),
    ]
    got = merge_sources(feed)
    assert [(n["source"], n["published"][8:16]) for n in got] == [("fantasy_pros", "21T23:00"), ("fantasy_pros", "21T14:55"), ("fantasy_pros", "19T15:20")]
    # two different events close together stay two (Edwards: the diagnosis vs an unrelated status line an hour earlier)
    ed = "Anthony Edwards"
    two = [item("fantasy_pros", "27T23:00", f"{ed} (knee) to miss up to two months", "Edwards will undergo an arthroscopic procedure and miss up to two months."),
           item("rotowire", "27T22:05", f"{ed} - Questionable for Wednesday", "Edwards is questionable for Wednesday's game against the Hawks.")]
    assert len(merge_sources(two)) == 2
