# NBA Fantasy Tool

[![CI](https://github.com/sawyerpham/sleeper-nba-gm/actions/workflows/ci.yml/badge.svg)](https://github.com/sawyerpham/sleeper-nba-gm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Python 3.13](https://img.shields.io/badge/python-3.13-3776ab.svg)
![React 19](https://img.shields.io/badge/react-19-61dafb.svg)

**Live at [fantasy.sawyerpham.dev](https://fantasy.sawyerpham.dev).** Sign in with your email (a one-time link, no
password), connect your Sleeper league, and pick which manager you are.

A full-stack assistant for Sleeper NBA fantasy leagues. Before the season it runs an auction-draft advisor. During the
season it runs a lineup engine for Sleeper's **Lock-In** format: at any minute of the week it shows the best lineup,
which finished games to lock, which bench player to swap in before the next tip, and how much each call changes the
chance of winning the matchup. A 12-team league uses it every week, and it pushes its calls to Telegram.

![The Today page: win chance, the next check-in, lockable games, League Tonight, the Do now list, and the matchup in Table view](docs/today.png)

## What it does

**In season (Lock-In leagues)**

- The best lineup for the current time of the week, re-planned on every request. A timeline slider replays the plan
  at any minute of the week, with ticks at the check-ins where a Sleeper visit is needed.
- Lock or wait calls for every finished game, each with the win chance locked and the win chance left open. The app
  shows both numbers and never dictates.
- Keep or swap calls while games are live: where a starter's game is headed versus the bench player tipping later.
- Injury watch (GTD / OUT) with the backup to start, the week's lockable games ranked by win-probability added, and the
  opponent's remaining projection and banked points.
- Today: win chance, the next check-in, the week's lockable games and a "Do now" list of swaps and injury calls, with a
  switch between the two managers in the matchup that shows either side. League Tonight lists the night's games with
  each team's record and marks your players, who are one click from their lineup card.
- Live game cards from ESPN (score, box scores in league scoring, top performers, depth charts), player profiles with
  game logs and news, NBA team cards with records, ranks and schedules, the week's best games across the whole NBA.
- League: the week's matchups, standings with record, points for and against, last five results, FAAB left and the
  playoff line (clicking a manager jumps to their matchup), and the best games of the week.
- Waivers: the best free agents in your league by Sleeper's % rostered and % started, with season averages and the
  games each would play once a claim lands.
- News: notes for your players, your league and free agents, with a teams report ranking NBA teams by starters hurt.
- Telegram pushes: each GTD / OUT / swap / lock call once at its alarm time, and the lineup moves due before a tip.
- Your way to look at it: a table view with one column per game day, a timeline view spaced by tip time, light and
  dark mode, and a phone layout.

**Before the season (auction drafts)**

- Auction values and rankings from last season's game logs under the league's own scoring, with position scarcity and
  tier cliffs, keeper keep-or-cut verdicts, a budget plan for the open roster spots, and rival managers' money, needs
  and bidding habits from past Sleeper leagues.
- Live sync with the Sleeper draft room: a bid call on each nominee as it comes up.

## How it works

```
  React 19 + Vite  (frontend/src)             FastAPI, Python 3.13  (backend/app)          Outside
 ┌───────────────────────────────┐   /api   ┌───────────────────────────────────┐    ┌───────────────────┐
 │ Today · League · News         │ ───────▶ │ lockin/   week_view, team_plan    │ ─▶ │ Sleeper API       │
 │ Waivers · Draft · Settings    │ ◀─────── │           weekplan  (the engine)  │ ─▶ │ ESPN scoreboard   │
 │ one UI, light and dark        │          │ draft/    auction room, bid calls │ ─▶ │ stats.nba.com     │
 └───────────────────────────────┘          │ core/     league session, pull    │    └───────────────────┘
                                            │ notify    Telegram watcher thread │ ─▶   Telegram
                                            └─────────────────┬─────────────────┘
                                                              │
                                            ┌─────────────────▼─────────────────┐
                                            │ shared/nba_fantasy_shared         │
                                            │ models · providers · reconcile    │
                                            │ scoring · JSON store              │
                                            └───────────────────────────────────┘
```

- **Backend:** FastAPI, everything under `/api`. One `AppState` per process holds the providers, the player pool and
  the open league sessions. Persistence is flat JSON under `backend/data/`; there is no database. The same process
  serves the built frontend, so one container runs the whole app.
- **Frontend:** React 19 with Vite, plain JSX, no UI library. One Apple-style UI that follows the system's light or
  dark mode; the design is pure CSS tokens.
- **Shared package:** the data models (Pydantic), the Sleeper / nba_api / fixture providers, name reconciliation, the
  scoring formula and the JSON store, installed editable into the backend.
- **Data:** Sleeper (rosters, matchups, per-game projections, box scores, injuries, news, transactions), ESPN (tip
  times, live status, game summaries) and nba_api (game logs for valuations). Every fetch goes through one per-URL
  cache with a TTL by volatility: 90 s on game days, 30 min for projections, 6 h for schedules. A week's requests are
  prefetched in parallel.

## The interesting problems

**Lock or wait, decided by win probability.** In Lock-In each starting slot scores exactly one game a week: the game
you lock, or else the slot's last game. Locking a finished game is final; waiting risks a worse last game. For each
starter the engine compares *X*, his finished game, with *W*, the value of his remaining games played optimally,
computed backwards from his last game:

    V_last = p · μ_last
    V_k    = p · E[max(X_k, V_k+1)] + (1 − p) · V_k+1,     X_k ~ Normal(μ_k, μ_k · swing)

where *p* is his chance to play (from his injury tag, back-to-backs and age), *μ* is Sleeper's projection scaled by
0.925 (it runs high) and *swing* is one game's spread as a share of its mean: his own game-to-game variation pulled
toward the league's 0.45. The same recursion carries the second moment, so every open slot has its real variance:
a questionable player's 60 % of a 20 is far less certain than a healthy player's 12. The call is not "which is
bigger" but which gives the higher chance to win the matchup: the week's totals are summed and
P(win) = Φ(Δ / √(σ²<sub>me</sub> + σ²<sub>opp</sub>)), with the deciding slot's chance of scoring nothing counted
apart from the bell curve. Both chances are shown on every card (`weekplan.py: wait_moments, decide_by_win_chance`). Both managers in a matchup
decide against each other over a few rounds, so the two sides' chances always sum to 100 %.

**Seating a lineup under multi-position eligibility.** Slots are PG PG SG SG SF SF PF PF C C and most players fit
two or three. Seating highest value first and sliding already-seated players along augmenting paths is optimal here
(the slots form a transversal matroid), and it is what puts a PG/SG's lock in the SG slot when two better PGs still
have games (`seat_players`).

**A week as a timeline of check-ins.** Sleeper can only be changed by hand, so the lineup changes only at check-ins
15 minutes before a tip where someone moves in, and every swap available at that moment is made at once: one visit
per slate rather than one per game. Each check-in replans the day from the previous one's lineup. The slider replays
the result at any minute, and the arrows on the cards are the exact moves to make in Sleeper, in a legal order
(`week_timeline`, `swaps.js`).

**Keep or swap on a live score.** Where a game in progress will finish: points so far plus a rate times the minutes
left, with the rate shrunk toward the pregame projection as if he had played `PRIOR_MINUTES` more at it, so a hot or
cold first quarter does not swing the call. The two constants were fit by replaying this season's finished games at
fixed points on the game clock (`backtest_live.py`; numbers below).

**One player, three sources.** nba_api, Sleeper and ESPN each have their own ids and spellings. A five-stage
reconciliation matches on normalized name and team, then unique name, then birthdate, then nba_api's static list;
nothing is dropped silently and every non-trivial match lands in a report shown in Settings.

**Working with Sleeper as it is.** The multi-megabyte player file may be fetched once a day, so it sits behind an
on-disk guard that is never bypassed at startup. Sleeper's "% rostered" figures come from an undocumented endpoint on `api.sleeper.com` (its public API has no such
field), so the Waivers list shows an error rather than guessing if it changes. Sleeper serves one lineup day at a time and flips to the next in the early
morning, so the app knows when the lineup it reads is yesterday's. Whether a rival locked a game is inferred by
comparing Sleeper's counted points with the box scores, and a finished week takes Sleeper's final count over any
saved answer.

## Measured

The live finish estimate was backtested by replaying every finished game of the 2026-27 season so far (Oct 20 to
Nov 11: **2,843 player games, 11,296 checkpoints** at the end of Q1, halftime, end of Q3 and mid-Q4), for rotation
players projected for 15+ minutes. Error is in league fantasy points, where a typical starter's game is 8 to 15 FP.

| Estimate at                     | end of Q1 | halftime | end of Q3 | mid-Q4 |
|---------------------------------|----------:|---------:|----------:|-------:|
| naive: tonight's rate continues | 3.46      | 2.14     | 1.36      | 0.90   |
| **shipped: rate shrunk toward the projection** | **2.28** | **1.84** | **1.33** | **0.91** |
| pregame projection's rate alone | 2.27      | 1.84     | 1.34      | 0.92   |

Mean absolute error of the predicted final; bias is within 0.15 FP at every checkpoint, and the predicted minutes
left are within about a minute of the actual at each checkpoint. Two findings worth knowing: shrinking the live rate
cuts the first-quarter error by a third against naive extrapolation, and a player's live rate adds almost nothing
over his projection on average, so the engine leans on the projection and lets the actual score, not the rate, move
the keep-or-swap call. The miss shrinks with the square root of the share of the game left (0.87 / 0.70 / 0.51 /
0.36 of the pregame miss at those four checkpoints, against √share = 0.87 / 0.71 / 0.50 / 0.35), which is how a live
game's spread is modelled. Reproduce with `python -m app.lockin.backtest_live` from `backend`.

The week plan's inputs were fit on the first three weeks (**2,048 played games, 882 player weeks, 18 matchups**),
replayed from Sleeper's own history. Reproduce with `python -m app.lockin.backtest_week` from `backend`.

| Check                                                        | before | now  | calibrated |
|--------------------------------------------------------------|-------:|-----:|-----------:|
| actual FP ÷ the plan's mean for a game                       | 0.926  | 1.00 | 1.00       |
| actual one-game spread ÷ the plan's                          | 2.13   | 1.02 | 1.00       |
| lock rule replayed: FP banked vs the wait value promised     | 8.58 vs 8.55 | 8.57 vs 8.71 | equal |
| lock rule replayed: miss ÷ the plan's spread for the slot    | n/a    | 1.07 | 1.00       |
| Monday win chance, Brier score (0.25 = coin flip)            | 0.246  | 0.247 | lower     |
| real matchup margin ÷ the plan's spread for it               | 1.39   | 1.25 | 1.00       |

The game-level numbers are solid; 18 matchups are too few to judge the win chance itself (its Brier score moves by
about 0.03 from sample noise alone), and real margins still run wider than the plan expects.

## Testing and CI

- 374 backend tests (`pytest`) run offline against captured real API responses under `backend/tests/fixtures`:
  the engine, the API, reconciliation, scoring, the week plan and the Telegram watcher.
- `frontend/src/lockin/swaps.check.mjs` replays every lineup swap the UI can propose and asserts each step is legal.
- Playwright end-to-end scripts in `frontend/e2e`: a mock auction draft driven entirely through the browser, and
  screenshot / computed-style diffs for CSS refactors.
- GitHub Actions runs `ruff`, the test suite, the swap checks, the production build and the Docker build on every push,
  and deploys `main` when they pass.

## Production

- **Accounts:** passwordless email sign-in (one-time links, 30-day sessions), per-account leagues, and account tiers
  (Telegram alerts for Premium), with an admin dashboard for users, activity and the data pull.
- **Security:** CSRF checks on the Origin header on top of SameSite cookies, a strict Content-Security-Policy,
  parameterized queries, per-account rate limits, input caps, and self-service account deletion. Usage data with IPs
  expires after 90 days.
- **Delivery:** one Docker container serves the API and the built frontend behind Caddy (automatic HTTPS) on an ARM VM.
  GitHub Actions runs the checks on every push and deploys `main` when they pass, over SSH with a key that can only run
  the deploy script, then confirms the site answers. Data is backed up daily.

## Calculations API

The math behind the app is also a small public JSON API: `GET /api/calculations` lists each calculation with its
formula, inputs and an example request, and `POST /api/calculations/<id>` runs it on your own numbers (win chance,
lock or wait, live finish estimate, game swing, lineup seating, fantasy points). The code is in
`backend/app/calculations.py`; `docs/calculations.tex` writes the formulas out.

## Repository layout

```
backend/app/
  core/      api/ (leagues, players, data pull)   engine/ (session, ranking, bidding, budget, roster, keepers)
             services/ (app state, pull, valuations, Sleeper league link and changelog)
  draft/     auction routes, fit, market, room
  lockin/    api, service (week view, plans, game and team cards), weekplan (the engine), backtest_live, backtest_week
  main.py    notify.py (Telegram)   calculations.py (the calculations API)   pull.py / valuate.py (CLIs)
backend/tests/      pytest suite; fixtures/ holds captured API responses
frontend/src/
  core/      shell, settings, player sidebar and search, shared widgets
  draft/     the Draft tab          lockin/   the Season views, swaps.js, time zone helpers
  ui-apple/  the app shell and its styles (the only UI)    themes.css  the Apple light / dark tokens
shared/nba_fantasy_shared/   models, providers, reconcile, scoring, storage
```

## Run it locally

<details>
<summary>Python 3.13 and Node 20+</summary>

```sh
cd backend
python -m venv venv
./venv/bin/python -m pip install -r requirements.txt     # Windows: .\venv\Scripts\python.exe
./venv/bin/python -m app.pull                            # first time: NBA game logs and the Sleeper player file
./venv/bin/python -m app.serve --port 8000
```

In another terminal:

```sh
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to the backend
```

Sign in with any email: without a mail key the sign-in link is printed in the backend log. Checks: `ruff check` from
the repo root, `python -m pytest -q tests` from `backend`, `npm run build` from `frontend`. Docker:
`docker compose up --build`, then http://localhost:8000.

</details>

## Scope

Sleeper leagues only. The in-season views support the Lock-In format; the Draft tab supports auction drafts.
Projections and news come from Sleeper's feeds.

## License

[MIT](LICENSE)
