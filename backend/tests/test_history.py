"""Past-season game logs (history.db) and finding a past game's ESPN event."""

from datetime import date

from app.history import connect, player_log, player_seasons, store
from app.lockin.service import find_event
from nba_fantasy_shared.models.players import GameLine
from nba_fantasy_shared.models.scoring import ScoringSettings
from nba_fantasy_shared.scoring.formula import score_game


def _line(season: str, game_id: str, day: date, pts: int) -> GameLine:
    """A game line for player 7 (a 1996-97 row as stats.nba.com's leaguegamelog gives it, parsed)."""
    return GameLine(player_id=7, season=season, game_id=game_id, game_date=day, team_abbr="SEA", opponent_abbr="NJN", home=False,
                    win=True, minutes=33.0, pts=pts, reb=5, ast=4, stl=1, blk=0, tov=2, fgm=8, fga=15, ftm=3, fta=4, fg3m=1,
                    fg3a=3, oreb=1, dreb=4, pf=2, plus_minus=-7)


def test_a_players_past_seasons_and_log_in_league_scoring(tmp_path):
    """Seasons newest first; a season's games oldest first, scored by the league's settings; no file means no history."""
    path = tmp_path / "history.db"
    assert player_seasons(path, 7) == [] and player_log(path, 7, "1996-97", ScoringSettings()) == []
    db = connect(path)
    late, early = _line("1996-97", "2", date(1996, 11, 3), 30), _line("1996-97", "1", date(1996, 11, 1), 12)
    store(db, [late, early, _line("2003-04", "3", date(2004, 1, 15), 20)])
    store(db, [early])  # a re-pull replaces, never duplicates
    db.close()
    assert player_seasons(path, 7) == ["2003-04", "1996-97"]
    log = player_log(path, 7, "1996-97", ScoringSettings())
    assert [r["date"] for r in log] == ["1996-11-01", "1996-11-03"]
    assert log[1]["fp"] == round(score_game(late, ScoringSettings()).fpts, 2)
    assert (log[0]["team"], log[0]["opp"], log[0]["home"], log[0]["to"], log[0]["pm"]) == ("SEA", "NJN", False, 2, -7)


def test_past_weeks_run_monday_to_sunday_from_opening_night_through_the_playoffs(tmp_path):
    """Opening night Fri 1996-11-01 (another player's game) is week 1 with that Sunday; Monday starts week 2; a playoff
    game (id 004...) keeps counting weeks and is tagged PO."""
    path = tmp_path / "history.db"
    db = connect(path)
    store(db, [_line("1996-97", "0029600001", date(1996, 11, 1), 10).model_copy(update={"player_id": 8}),
               _line("1996-97", "0029600020", date(1996, 11, 3), 10), _line("1996-97", "0029600030", date(1996, 11, 4), 10),
               _line("1996-97", "0049600001", date(1997, 4, 24), 10)])
    db.close()
    log = player_log(path, 7, "1996-97", ScoringSettings())
    assert [(r["week"], r["stage"]) for r in log] == [(1, None), (2, None), (26, "PO")]


def test_find_event_maps_old_team_codes_to_espns():
    """stats.nba.com says NJN; ESPN's scoreboard says NJ (seen for 1996-11-01). Unknown teams find nothing."""
    board = {"events": [{"id": "961101", "date": "1996-11-02T00:30Z", "status": {"type": {"state": "post"}},
                         "competitions": [{"competitors": [{"homeAway": "home", "team": {"abbreviation": "NJ"}},
                                                           {"homeAway": "away", "team": {"abbreviation": "CLE"}}]}]}]}
    fetch = lambda url, ttl: board  # noqa: E731
    assert find_event(fetch, "1996-11-01", "NJN") == "961101"
    assert find_event(fetch, "1996-11-01", "SEA", "CLE") == "961101"
    assert find_event(fetch, "1996-11-01", "SEA") is None
