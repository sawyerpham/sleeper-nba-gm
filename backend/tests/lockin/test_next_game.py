"""The player profile's next game: this week's when one is left, else the schedule's next date filled in from ESPN."""

from app.lockin import service
from app.lockin.service import next_game_of


def test_this_weeks_game_first_else_the_schedule_with_espns_event(monkeypatch):
    week = [{"date": "2026-11-21", "state": "post", "event": "1"}, {"date": "2026-11-22", "state": "pre", "event": "2"}]
    log = [{"date": "2026-11-21", "status": "complete"}, {"date": "2026-11-23", "status": "pre_game", "opp": "SAC", "home": False},
           {"date": "2026-11-25", "status": "pre_game", "opp": "POR", "home": False}]
    assert next_game_of(week, log, "SAS", None, "2026-11-22")["event"] == "2"
    monkeypatch.setattr(service, "espn_day", lambda fetch, day, today: {"SAS": {"event": "401", "tip": "2026-11-24T01:00Z", "record": "12-4",
                                                                              "opp_record": "5-11"}} if day == "2026-11-23" else {})
    g = next_game_of(week[:1], log, "SAS", None, "2026-11-22")
    assert (g["date"], g["opp"], g["event"], g["tip"], g["state"]) == ("2026-11-23", "SAC", "401", "2026-11-24T01:00Z", "pre")
    assert next_game_of([], log[:1], "SAS", None, "2026-11-22") is None
