import pytest
from fastapi.testclient import TestClient

from app.calculations import resolve
from app.lockin import weekplan as wp
from app.main import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    """A client over the app with no league state: the calculations need none."""
    return TestClient(create_app(state=None))


def entries(client):
    """The catalog entries."""
    return client.get("/api/calculations").json()["calculations"]


def test_catalog_lists_every_calculation_with_the_expected_fields(client):
    """Catalog lists every calculation with the expected fields."""
    items = entries(client)
    assert client.get("/api/calculations").json()["count"] == len(items) >= 8
    assert len({c["id"] for c in items}) == len(items)
    for c in items:
        assert {"id", "area", "name", "summary", "formula", "inputs", "outputs", "code"} <= c.keys()
        assert callable(resolve(c["code"])), c["id"]


def test_every_catalog_example_request_runs(client):
    """Every catalog example request runs, so the documented examples cannot go stale."""
    runnable = [c for c in entries(client) if c["run"]]
    assert len(runnable) >= 6
    for c in runnable:
        r = client.post(c["run"]["path"], json=c["run"]["request"])
        assert r.status_code == 200, (c["id"], r.text)
        assert r.json()["id"] == c["id"] and r.json()["result"]
    assert all(c["needs"] for c in entries(client) if not c["run"])


def test_win_chance_matches_the_engine_and_mirrors(client):
    """Win chance matches the engine and the two sides mirror."""
    body = {"mine": {"mean": 130, "variance": 25}, "theirs": {"mean": 124.9, "variance": 100}}
    r = client.post("/api/calculations/win-chance", json=body).json()["result"]
    assert r["win_chance"] == round(wp.win_chance((130, 25), (124.9, 100)), 4)
    assert r["win_chance"] + r["opponent_win_chance"] == pytest.approx(1, abs=1e-3)


def test_fantasy_points_use_the_scoring_and_stack_bonuses(client):
    """Fantasy points use the scoring and stack bonuses."""
    line = {"stats": {"pts": 52, "reb": 10, "ast": 10, "fgm": 20, "fga": 30}}
    r = client.post("/api/calculations/fantasy-points", json=line).json()["result"]
    assert {"pts_40", "pts_50", "triple_double"} <= set(r["bonuses_hit"])
    assert r["fantasy_points"] == pytest.approx(r["base_points"] + r["bonus_points"], abs=0.01)


def test_lock_or_wait_calls_by_expected_points(client):
    """Lock or wait calls by expected points."""
    games = [{"date": "2026-11-26", "proj": 38.0}]
    high = client.post("/api/calculations/lock-or-wait", json={"locked_fp": 90, "remaining": games}).json()["result"]
    low = client.post("/api/calculations/lock-or-wait", json={"locked_fp": 1, "remaining": games}).json()["result"]
    assert (high["call"], low["call"]) == ("LOCK", "WAIT")
    assert high["wait_value"] == low["wait_value"] > 0


def test_live_estimate_is_at_least_the_points_so_far_and_seating_respects_slots(client):
    """Live estimate is at least the points so far, and seating respects the slots."""
    live = client.post("/api/calculations/live-finish-estimate", json={"fp": 22, "minutes_played": 24, "proj": 40, "proj_minutes": 34, "period": 3, "clock_seconds": 420}).json()["result"]
    assert live["estimated_final"] > 22
    seat = client.post("/api/calculations/lineup-seating", json={"players": [{"name": f"P{i}", "positions": ["C"], "value": i} for i in range(3)], "slots": {"C": 2}}).json()["result"]
    assert len(seat["seats"]["C"]) == 2 and seat["left_out"] == ["P0"]


def test_bad_input_is_a_422_and_unknown_ids_404(client):
    """Bad input is a 422 and unknown ids 404."""
    assert client.post("/api/calculations/win-chance", json={"mine": {"mean": 1, "variance": -1}, "theirs": {"mean": 1, "variance": 1}}).status_code == 422
    assert client.get("/api/calculations/nope").status_code == 404
