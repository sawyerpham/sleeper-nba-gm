"""The project's calculations as a small JSON API: a catalog of what is computed, and endpoints that run them.

    GET  /api/calculations        the catalog (formula, inputs, constants, an example request for each)
    GET  /api/calculations/{id}   one entry
    POST /api/calculations/{id}   run it on your own numbers (the ids with a "run" block in the catalog)

Every POST calls the same function the app itself uses, with no league data needed. The constants in the catalog are
read from the code and each example request is posted by a test, so neither can drift.
"""

from __future__ import annotations

from datetime import date
from importlib import import_module
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from nba_fantasy_shared.models.players import GameLine
from nba_fantasy_shared.models.scoring import ScoringSettings
from nba_fantasy_shared.scoring.formula import score_game

from .lockin import weekplan as wp

router = APIRouter(prefix="/calculations", tags=["calculations"])

Injury = Literal["healthy", "day_to_day", "out_short_term", "out_long_term", "out_season"]


class Spread(BaseModel):
    """A team's expected total and its variance."""
    mean: float
    variance: float = Field(ge=0)


class WinChanceIn(BaseModel):
    """Two teams' final totals."""
    mine: Spread
    theirs: Spread


class StatLine(BaseModel):
    """One game's counting stats."""
    pts: int = 0
    reb: int = 0
    ast: int = 0
    stl: int = 0
    blk: int = 0
    tov: int = 0
    fgm: int = 0
    fga: int = 0
    ftm: int = 0
    fta: int = 0
    fg3m: int = 0
    fg3a: int = 0
    oreb: int = 0
    dreb: int = 0
    pf: int = 0
    plus_minus: int = 0


class FantasyPointsIn(BaseModel):
    """A stat line, scored under `scoring` (the project's default scoring when omitted)."""
    stats: StatLine
    scoring: ScoringSettings | None = None


class SwingIn(BaseModel):
    """A player's per-game fantasy points over a season."""
    game_points: list[float]


class UpcomingGame(BaseModel):
    """One game still to come."""
    date: str
    proj: float = Field(description="Sleeper-style projected fantasy points")
    b2b: bool = Field(False, description="second night of a back-to-back")
    vet: bool = False


class LockOrWaitIn(BaseModel):
    """A finished game's score to lock, and the games still to come."""
    locked_fp: float | None = Field(None, description="the finished game you could lock")
    remaining: list[UpcomingGame]
    swing: float = Field(wp.SWING_CENTER, description="one game's spread as a share of its mean")
    injury: Injury = "healthy"


class LiveGameIn(BaseModel):
    """A game in progress."""
    fp: float = Field(description="fantasy points so far")
    minutes_played: float
    proj: float = Field(description="projected fantasy points for the whole game")
    proj_minutes: float
    period: int = Field(ge=1)
    clock_seconds: float = Field(ge=0, description="seconds left in the period")


class SeatPlayer(BaseModel):
    """A player to seat."""
    name: str
    positions: list[str]
    value: float


class SeatingIn(BaseModel):
    """Players and the starting slots to fill."""
    players: list[SeatPlayer]
    slots: dict[str, int] = Field(default_factory=lambda: {"PG": 2, "SG": 2, "SF": 2, "PF": 2, "C": 2})


def _run(calc_id: str, result: dict) -> dict:
    """The response shape shared by every POST."""
    return {"id": calc_id, "result": result}


def _catalog() -> list[dict]:
    """The calculations, built on each request so the constants and the worked results always match the code."""
    examples = {
        "win-chance": {"mine": {"mean": 130.0, "variance": 25.0}, "theirs": {"mean": 124.9, "variance": 100.0}},
        "fantasy-points": {"stats": {"pts": 32, "reb": 11, "ast": 12, "stl": 1, "blk": 1, "tov": 3, "fgm": 12, "fga": 22, "ftm": 6, "fta": 7, "fg3m": 2}},
        "game-swing": {"game_points": [38.2, 51.0, 29.4, 44.8, 33.1, 40.5, 36.0, 55.2, 27.9, 42.3, 39.8, 31.5, 47.6, 35.4, 44.0, 28.8]},
        "lock-or-wait": {"locked_fp": 27.5, "injury": "day_to_day",
                         "remaining": [{"date": "2026-11-26", "proj": 38.0}, {"date": "2026-11-28", "proj": 36.0, "b2b": True}]},
        "live-finish-estimate": {"fp": 22.0, "minutes_played": 24.0, "proj": 40.0, "proj_minutes": 34.0, "period": 3, "clock_seconds": 420},
        "lineup-seating": {"players": [{"name": "A", "positions": ["PG", "SG"], "value": 50}, {"name": "B", "positions": ["PG"], "value": 45},
                                       {"name": "C", "positions": ["SG", "SF"], "value": 40}, {"name": "D", "positions": ["PG", "SG"], "value": 38}]},
    }

    def run(calc_id: str) -> dict:
        """The run block for a calculation: how to call it and a request that works."""
        return {"method": "POST", "path": f"/api/calculations/{calc_id}", "request": examples[calc_id]}

    return [
        {"id": "lock-or-wait", "area": "in-season", "name": "Lock or wait",
         "summary": "For one starter, compares his finished game against the value of the games he still has to play, worked backwards from his last game.",
         "formula": "V_last = p * mu_last;  V_k = p * E[max(X_k, V_k+1)] + (1 - p) * V_k+1,  X_k ~ Normal(mu_k, mu_k * swing)",
         "inputs": ["the finished game's points", "projected points for each game still to come", "injury status", "swing"],
         "outputs": ["expected value of waiting", "its variance", "chance of ending with nothing", "the expected-points call"],
         "constants": {"PROJ_SCALE": wp.PROJ_SCALE, "SWING_CENTER": wp.SWING_CENTER, "SWING_SHRINK": wp.SWING_SHRINK,
                       "MIN_SWING": wp.MIN_SWING, "MAX_SWING": wp.MAX_SWING, "MIN_GAMES_FOR_SWING": wp.MIN_GAMES_FOR_SWING},
         "code": {"module": "app.lockin.weekplan", "function": "wait_moments"}, "run": run("lock-or-wait")},
        {"id": "win-chance", "area": "in-season", "name": "Chance to win the week",
         "summary": "The normal CDF of the difference between the two teams' expected totals over their combined spread. In the app both managers decide lock-or-wait against each other, so the two sides sum to 100%.",
         "formula": "P(win) = Phi((mu_me - mu_opp) / sqrt(var_me + var_opp))",
         "inputs": ["each team's expected total", "each team's variance"], "outputs": ["win probability between 0 and 1"],
         "code": {"module": "app.lockin.weekplan", "function": "win_chance"}, "run": run("win-chance")},
        {"id": "game-swing", "area": "in-season", "name": "How much one game can swing a player's night",
         "summary": "A player's game-to-game spread as a share of his mean, pulled toward the league's typical spread, and with that alone when he has too few games.",
         "formula": "swing = clamp(shrink(std / mean toward SWING_CENTER), MIN_SWING, MAX_SWING)",
         "inputs": ["a season of per-game fantasy points"], "outputs": ["swing"],
         "constants": {"SWING_CENTER": wp.SWING_CENTER, "SWING_SHRINK": wp.SWING_SHRINK, "MIN_GAMES_FOR_SWING": wp.MIN_GAMES_FOR_SWING},
         "code": {"module": "app.lockin.weekplan", "function": "swing_of"}, "run": run("game-swing")},
        {"id": "live-finish-estimate", "area": "in-season", "name": "Live finish estimate",
         "summary": "Where a game in progress will finish: points so far plus a scoring rate times the minutes left, with the rate shrunk toward his pregame projected rate.",
         "formula": "rate = (fp + proj_rate * PRIOR_MINUTES) / (minutes_played + PRIOR_MINUTES);  final = fp + rate * minutes_left",
         "inputs": ["points so far", "minutes played", "projected points and minutes", "period and clock"],
         "outputs": ["estimated final fantasy points"],
         "constants": {"PRIOR_MINUTES": wp.PRIOR_MINUTES, "MINUTES_LEFT_SCALE": wp.MINUTES_LEFT_SCALE},
         "code": {"module": "app.lockin.weekplan", "function": "live_estimate"}, "run": run("live-finish-estimate")},
        {"id": "lineup-seating", "area": "in-season", "name": "Seating a lineup under multi-position eligibility",
         "summary": "Seats the highest-value player first and slides already-seated multi-position players along augmenting paths to make room, which is optimal here (the slots form a transversal matroid).",
         "formula": "augmenting-path matching of players to slots",
         "inputs": ["player values", "position eligibility", "slot counts"], "outputs": ["the players in each slot", "who is left out"],
         "code": {"module": "app.lockin.weekplan", "function": "seat_players"}, "run": run("lineup-seating")},
        {"id": "fantasy-points", "area": "shared", "name": "Fantasy points for a game",
         "summary": "Scores a stat line under a league's scoring: base points plus every bonus rule the game meets (bonuses stack).",
         "formula": "FP = sum(stat * weight) + sum(bonuses met)",
         "inputs": ["a game's stat line", "the scoring settings (optional)"], "outputs": ["fantasy points", "base points", "bonus points", "bonuses hit"],
         "code": {"module": "nba_fantasy_shared.scoring.formula", "function": "score_game"}, "run": run("fantasy-points")},
        {"id": "check-in-timeline", "area": "in-season", "name": "A week as a timeline of check-ins",
         "summary": "The best lineup at every moment of the week. The lineup changes only at check-ins shortly before a tip where someone moves in, and every swap available then happens at once.",
         "formula": "replan the day from the previous check-in's lineup; one visit per slate",
         "inputs": ["every game's tip time", "the plan's lock and swap calls"], "outputs": ["a list of check-ins with the lineup after each"],
         "constants": {"CHECK_LEAD_MIN": wp.CHECK_LEAD_MIN},
         "code": {"module": "app.lockin.service", "function": "week_timeline"},
         "run": None, "needs": "a linked Sleeper league: it is part of GET /api/leagues/{league_id}/season/plan"},
        {"id": "auction-valuation", "area": "draft", "name": "Player valuation from game logs",
         "summary": "Aggregates a player's game lines into FP per game, best game, weekly-best average, top-quarter average, availability and confidence, under the league's scoring.",
         "formula": "per-player aggregates over last season's game logs",
         "inputs": ["a player's game logs", "the league's scoring settings"], "outputs": ["a PlayerValuation"],
         "code": {"module": "nba_fantasy_shared.scoring.aggregate", "function": "valuate"},
         "run": None, "needs": "pulled NBA game logs (python -m app.pull)"},
    ]


@router.get("")
def list_calculations() -> dict:
    """Every calculation the project performs."""
    items = _catalog()
    return {"count": len(items), "calculations": items}


@router.get("/{calc_id}")
def get_calculation(calc_id: str) -> dict:
    """One calculation by id, or 404."""
    item = next((c for c in _catalog() if c["id"] == calc_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"unknown calculation {calc_id}")
    return item


@router.post("/win-chance")
def run_win_chance(body: WinChanceIn) -> dict:
    """Chance that `mine` finishes above `theirs`, and the mirror chance for the other side."""
    mine, theirs = (body.mine.mean, body.mine.variance), (body.theirs.mean, body.theirs.variance)
    p = wp.win_chance(mine, theirs)
    return _run("win-chance", {"win_chance": round(p, 4), "opponent_win_chance": round(wp.win_chance(theirs, mine), 4)})


@router.post("/fantasy-points")
def run_fantasy_points(body: FantasyPointsIn) -> dict:
    """Fantasy points for one stat line."""
    line = GameLine(player_id=0, season="", game_id="", game_date=date.today(), team_abbr="", opponent_abbr="", home=True, minutes=0, **body.stats.model_dump())
    s = score_game(line, body.scoring or ScoringSettings())
    return _run("fantasy-points", {"fantasy_points": round(s.fpts, 2), "base_points": round(s.base_points, 2),
                                   "bonus_points": s.bonus_points, "bonuses_hit": list(s.bonuses_hit)})


@router.post("/game-swing")
def run_game_swing(body: SwingIn) -> dict:
    """The swing of a player's game-to-game fantasy points."""
    return _run("game-swing", {"swing": round(wp.swing_of(body.game_points), 4), "games": len(body.game_points)})


@router.post("/lock-or-wait")
def run_lock_or_wait(body: LockOrWaitIn) -> dict:
    """The value of waiting on the games still to come, and (when `locked_fp` is given) the expected-points call.
    The app itself decides by win chance, which needs the opponent too: see /win-chance."""
    games = [wp.Game(date=g.date, proj=g.proj, b2b=g.b2b, vet=g.vet) for g in body.remaining]
    mean, var, nothing = wp.wait_moments(games, body.swing, body.injury)
    out = {"wait_value": round(mean, 2), "wait_variance": round(var, 2), "chance_of_nothing": round(nothing, 4)}
    if body.locked_fp is not None:
        out["call"] = "LOCK" if body.locked_fp >= mean else "WAIT"
        out["locked_fp"] = body.locked_fp
    return _run("lock-or-wait", out)


@router.post("/live-finish-estimate")
def run_live_finish(body: LiveGameIn) -> dict:
    """Where a game in progress will probably finish."""
    g = wp.Game(date="", proj=body.proj, fp=body.fp, started=True, live=True, min=body.minutes_played, proj_min=body.proj_minutes,
                period=body.period, clock=body.clock_seconds)
    return _run("live-finish-estimate", {"estimated_final": round(wp.live_estimate(g), 2), "points_so_far": body.fp})


@router.post("/lineup-seating")
def run_lineup_seating(body: SeatingIn) -> dict:
    """Seat players into the slots, highest value first, sliding multi-position players to make room."""
    people = [wp.PlanPlayer(sid=str(i), name=p.name, eligibility=p.positions, slot="BN", games=[], value=p.value) for i, p in enumerate(body.players)]
    seats = wp.seat_players(sorted(people, key=lambda p: -p.value), body.slots)
    return _run("lineup-seating", {"seats": {slot: [p.name for p in ps] for slot, ps in seats.items()},
                                   "left_out": [p.name for p in people if p.seat is None]})


def resolve(code: dict):
    """The function a catalog entry points at (used by the test to keep the catalog honest)."""
    return getattr(import_module(code["module"]), code["function"])
