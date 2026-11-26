import React from "react";
import PlayerSidebar from "../core/PlayerSidebar.jsx";
import PlayerSearch from "../core/PlayerSearch.jsx";
import Icon from "../core/Icon.jsx";
import { GamePanel, TeamPanel, bestLineup, watchTitle } from "./SeasonPage.jsx";


export function CurrentCard({ s, leagueId }) {
  const c = s.cur;
  if (!c) return null;
  if (c.pid) return <PlayerSidebar leagueId={leagueId} playerId={c.pid} season plan={s.plan} view={c.view} onView={s.setView} onSelectPlayer={s.openPid} refreshKey={s.tick} onClose={s.close} onOpenGame={s.openGame} onOpenMatchup={s.openMatchup} />;
  if (c.game) return <GamePanel key={c.game.game.event || `${c.game.game.date}-${c.game.team}`} sel={c.game} data={s.data} leagueId={leagueId} onOpenPid={s.openPid} onClose={s.close} />;
  return <TeamPanel key={c.team} abbr={c.team} leagueId={leagueId} onOpenPid={s.openPid} onClose={s.close} />;
}

export function CardNav({ s }) {
  return (
    <span className="card-nav">
      <button className="small" onClick={s.back} disabled={!s.back} aria-label="Back" data-testid="side-back"><Icon name="chevron-left" /></button>
      <button className="small" onClick={s.forward} disabled={!s.forward} aria-label="Forward" data-testid="side-forward"><Icon name="chevron-right" /></button>
    </span>
  );
}

export function WeekNav({ s }) {
  const { data, week, setWeek } = s;
  return (
    <span className="week-nav">
      <button className="small" disabled={data.week <= 1} onClick={() => setWeek(data.week - 1)} aria-label="Previous week"><Icon name="chevron-left" /></button>
      <strong className={`week-nav-name ${week ? "clickable" : ""}`} onClick={week ? () => setWeek(null) : undefined} title={week ? "Back to this week" : undefined}>WEEK {data.week}</strong>
      <button className="small" disabled={data.week >= Math.max(...data.weeks)} onClick={() => setWeek(data.week + 1)} aria-label="Next week"><Icon name="chevron-right" /></button>
    </span>
  );
}

export function SeasonTools({ s, leagueId }) {
  return (
    <span className="season-tools-x">
      <span className="season-search"><PlayerSearch leagueId={leagueId} onSelect={(p) => s.openPid(p.player_id)} onSelectTeam={s.openTeam} managers={s.data?.teams} onSelectManager={s.openMatchup} placeholder="Player, team or manager…" testId="season-search" /></span>
      <button className="small primary icon-btn" onClick={s.sync} disabled={s.syncing} data-testid="sync" aria-label="Sync with Sleeper"><Icon name="refresh" className={s.syncing ? "spin" : ""} /></button>
    </span>
  );
}

export const nowOf = (data) => (data.now ? Date.parse(data.now) : Date.now());

export const nextCheckIn = (plan, nowMs) => (plan.timeline?.segments || []).slice(0, -1).map((x) => Date.parse(x.to)).find((ms) => ms > nowMs) ?? null;

export function gamesOn(data, date, rid) {
  const mine = new Set(data.teams.find((t) => (rid != null ? t.roster_id === rid : t.is_user))?.players || []);
  const out = new Map();
  for (const [sid, p] of Object.entries(data.players)) for (const g of p.games || []) {
    if (g.date !== date || !g.event || !p.team) continue;
    const e = out.get(g.event) || {
      event: g.event, state: g.state, detail: g.detail, tip: g.tip, mine: 0, sel: { game: g, team: p.team, sid, name: p.name },
      ...(g.home ? { home: p.team, away: g.opp, homeScore: g.score, awayScore: g.opp_score, homeRecord: g.record, awayRecord: g.opp_record } : { away: p.team, home: g.opp, awayScore: g.score, homeScore: g.opp_score, awayRecord: g.record, homeRecord: g.opp_record }),
    };
    if (mine.has(sid)) { e.mine += 1; (e.mineSids ||= []).push(sid); }
    out.set(g.event, e);
  }
  const rank = { in: 0, pre: 1, post: 2 };
  return [...out.values()].sort((a, b) => (rank[a.state] ?? 1) - (rank[b.state] ?? 1) || Date.parse(a.tip) - Date.parse(b.tip));
}

export function slate(data, rid) {
  for (const d of data.dates.filter((x) => x >= data.today)) {
    const list = gamesOn(data, d, rid);
    if (list.length) return { date: d, list };
  }
  return { date: data.today, list: [] };
}

export function callsOf(data, plan) {
  const nowMs = nowOf(data);
  const games = Object.fromEntries(Object.entries(data.players).map(([sid, p]) => [sid, p.games]));
  const name = (sid) => data.players[sid]?.name || sid;
  const swaps = bestLineup(plan, nowMs, data.roster_positions, false, games).pairs.map((p) => ({
    key: `now-${p.n}`, kind: "swap", when: "now", title: `Swap ${name(p.in)} (${p.from}) and ${name(p.out)} (${p.to})`, sid: p.in, sid2: p.out, tone: "even",
  }));
  const watch = [...(plan.today?.watch || [])].sort((x, y) => (x.alarm === "now" ? "" : x.alarm || "~").localeCompare(y.alarm === "now" ? "" : y.alarm || "~"))
    .map((w) => ({
      key: `${w.kind}-${w.sid}-${w.backup_sid || ""}`, kind: w.kind, when: w.alarm, title: watchTitle(w), short: w.short, text: w.text, sid: w.sid, sid2: w.backup_sid,
      tone: ["gtd", "out"].includes(w.kind) || w.decision === "SWAP" ? "bad" : "even",
    }));
  const r = plan.roster;
  const roster = [
    ...(r?.illegal.length ? [{ key: "illegal", kind: "alert", when: "now", title: `Roster illegal: ${r.illegal.join(", ")} healthy on IR`, text: "Drop or trade someone: Sleeper blocks lineup changes and locks.", tone: "bad" }] : []),
    ...(r?.ir_candidates.length ? [{ key: "ir", kind: "alert", when: "now", title: `IR open: move ${r.ir_candidates.join(", ")} to IR`, tone: "even" }] : []),
  ];
  return [...swaps, ...watch, ...roster];
}
