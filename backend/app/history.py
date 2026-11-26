"""Past NBA seasons' game logs: every player's regular-season games since 1996-97, in one SQLite file
(data/history.db), for the player profile's season picker. A finished season never changes, so each is pulled once:

    python -m app.history          # every finished season not stored yet (1996-97 through DEFAULT_STATS_SEASON)

One stats.nba.com `leaguegamelog` call per season (~25k rows, ~1 s). Since 2026-11-25 stats.nba.com stalls Python's
HTTP client on big endpoints while curl with browser headers (Accept-Encoding with br included) answers at once, so the
pull shells out to curl. Run it on a PC and copy history.db to the server's data folder: stats.nba.com often blocks
cloud IPs."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import time
from pathlib import Path
from urllib.parse import urlencode

from nba_fantasy_shared.models.players import GameLine
from nba_fantasy_shared.providers.nba_api_provider import game_line_from_row, season_label, season_start_year
from nba_fantasy_shared.scoring.formula import score_game

from . import config

FIRST_SEASON = "1996-97"
DB_NAME = "history.db"
FIELDS = tuple(GameLine.model_fields)
HEADERS = ("User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
           "Referer: https://www.nba.com/", "Origin: https://www.nba.com", "Accept: application/json, text/plain, */*",
           "Accept-Language: en-US,en;q=0.9", "Accept-Encoding: gzip, deflate, br", "Connection: keep-alive")


def connect(path: Path) -> sqlite3.Connection:
    """Open (creating if needed) the history database: one row per player game, indexed by player and season."""
    db = sqlite3.connect(path)
    db.execute(f"CREATE TABLE IF NOT EXISTS games ({', '.join(FIELDS)}, PRIMARY KEY (player_id, game_id))")
    db.execute("CREATE INDEX IF NOT EXISTS games_player ON games (player_id, season)")
    return db


def fetch_season(season: str) -> list[GameLine]:
    """Every player's regular-season game lines for one season from stats.nba.com (via curl, see module doc)."""
    url = "https://stats.nba.com/stats/leaguegamelog?" + urlencode(
        {"Counter": 0, "Direction": "ASC", "LeagueID": "00", "PlayerOrTeam": "P", "Season": season,
         "SeasonType": "Regular Season", "Sorter": "DATE"})
    args = ["curl", "-s", "--compressed", "--max-time", "90", *(a for h in HEADERS for a in ("-H", h)), url]
    out = subprocess.run(args, capture_output=True, check=True).stdout
    block = json.loads(out)["resultSets"][0]
    return [game_line_from_row(dict(zip(block["headers"], row))) for row in block["rowSet"]]


def store(db: sqlite3.Connection, lines: list[GameLine]) -> None:
    """Write game lines (a re-pulled season replaces its rows)."""
    db.executemany(f"INSERT OR REPLACE INTO games VALUES ({', '.join('?' * len(FIELDS))})",
                   [tuple(getattr(g, f) if f != "game_date" else g.game_date.isoformat() for f in FIELDS) for g in lines])
    db.commit()


def player_seasons(path: Path, player_id: int) -> list[str]:
    """The seasons a player has games in, newest first ([] when there is no history file)."""
    if not path.exists():
        return []
    with sqlite3.connect(path) as db:
        return [s for (s,) in db.execute("SELECT DISTINCT season FROM games WHERE player_id = ? ORDER BY season DESC", (player_id,))]


def player_log(path: Path, player_id: int, season: str, scoring) -> list[dict]:
    """A player's games in one past season, oldest first, shaped like the current season's log rows, with fantasy
    points in the league's scoring."""
    if not path.exists():
        return []
    with sqlite3.connect(path) as db:
        rows = db.execute(f"SELECT {', '.join(FIELDS)} FROM games WHERE player_id = ? AND season = ? ORDER BY game_date",
                          (player_id, season)).fetchall()
    out = []
    for row in rows:
        g = GameLine(**dict(zip(FIELDS, row)))
        out.append({"date": g.game_date.isoformat(), "team": g.team_abbr, "opp": g.opponent_abbr, "home": g.home, "win": g.win,
                    "fp": round(score_game(g, scoring).fpts, 2), "min": round(g.minutes, 1), "pts": g.pts, "reb": g.reb,
                    "ast": g.ast, "stl": g.stl, "blk": g.blk, "to": g.tov, "pf": g.pf, "fgm": g.fgm, "fga": g.fga,
                    "ftm": g.ftm, "fta": g.fta, "pm": g.plus_minus})
    return out


def main() -> None:
    """Pull every finished season in the range that isn't stored yet (or all of them with --force)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--from", dest="first", default=FIRST_SEASON)
    ap.add_argument("--to", dest="last", default=config.DEFAULT_STATS_SEASON)
    ap.add_argument("--force", action="store_true", help="re-pull seasons already stored")
    ap.add_argument("--db", type=Path, default=config.DEFAULT_DATA_DIR / DB_NAME)
    a = ap.parse_args()
    db = connect(a.db)
    have = {s for (s,) in db.execute("SELECT DISTINCT season FROM games")}
    for y in range(season_start_year(a.first), season_start_year(a.last) + 1):
        season = season_label(y)
        if season in have and not a.force:
            continue
        lines = fetch_season(season)
        store(db, lines)
        print(f"{season}: {len(lines)} games", flush=True)
        time.sleep(1)
    print(f"{a.db}: {db.execute('SELECT COUNT(*) FROM games').fetchone()[0]} games, {a.db.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
