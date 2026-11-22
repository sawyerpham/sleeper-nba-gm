import React, { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { api, qs } from "../api.js";
import Headshot from "../core/Headshot.jsx";
import { PosList, PosTag } from "../core/Pos.jsx";
import PlayerSidebar, { DepthGrid, TeamRanks } from "../core/PlayerSidebar.jsx";
import TeamLink, { TeamLinkContext } from "../core/TeamLink.jsx";
import PlayerSearch from "../core/PlayerSearch.jsx";
import NeonArrow from "../core/NeonArrow.jsx";
import DragScroll from "../core/DragScroll.jsx";
import { useWatch } from "../core/watch.js";
import { useNBAMatches, findMatch, watchUrl } from "./streams.jsx";
import InjuryTag, { injuryTip, isDoubt, isOut } from "../core/InjuryTag.jsx";
import { fmt, setZone, timeOf, tipInfo } from "./tz.js";
import { reseat, swapSteps } from "./swaps.js";
import Icon from "../core/Icon.jsx";

const REFRESH_MS = 60000;

export const watchTitle = (w) => w.kind === "gtd" ? `${w.name} GTD: check, else start ${w.backup}` : w.kind === "out" ? `${w.name} OUT: bench${w.backup ? `, start ${w.backup}` : ""}` : w.kind === "lock" ? `Lock ${w.name} now`
  : w.decision === "SWAP" ? `SWAP: bench ${w.name}, start ${w.backup}` : `${w.decision}: ${w.backup} check`;

export const untilText = (mins) => {
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
export const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const md = (d) => d.slice(5).replace("-", "/");
export const fp = (x) => (x == null ? "" : x.toFixed(2));
const showNicks = () => { try { return localStorage.getItem("da.nicks") !== "off"; } catch { return true; } };
const NARROW = "(max-width: 1599px)";
const useMedia = (q) => useSyncExternalStore(
  (cb) => { const m = window.matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
  () => window.matchMedia(q).matches);
const useNarrow = () => useMedia(NARROW);
const useThin = () => useMedia("(max-width: 999px)");

export function TeamName({ t, cls = "", size = 24, record = true, mine = false }) {
  const rec = record && t.wins != null;
  return (
    <span className={`team-name-tag ${mine ? "is-me" : ""}`}>
      {t.avatar && <img className="team-avatar" src={t.avatar} width={size} height={size} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
      <span className="team-name-lines">
        <span className={cls}>{t.name}</span>
        {(rec || (t.user && t.user !== t.name)) && <span className="small muted team-sub">
          {t.user && t.user !== t.name && <span className="team-user">{t.user}</span>}
          {rec && <span className="team-rec" data-testid="team-record">{t.wins}-{t.losses}{t.last === "W" && <span className="good-text"> ▲</span>}{t.last === "L" && <span className="warn-text"> ▼</span>}</span>}
        </span>}
      </span>
    </span>
  );
}



const TEAM_TABS = [["roster", "Roster"], ["schedule", "Schedule"], ["stats", "Stats"], ["news", "News"]];
export const teamLogo = (abbr) => `https://sleepercdn.com/images/team_logos/nba/${abbr.toLowerCase()}.png`;
const shortName = (n) => { const [first, ...rest] = (n || "").split(" "); return rest.length ? `${first[0]}. ${rest.join(" ")}` : n; };
export function TeamPanel({ abbr, leagueId, onOpenPid, onClose }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("roster");
  const [news, setNews] = useState(null);
  useEffect(() => { api.get(`/leagues/${leagueId}/season/team` + qs({ abbr })).then(setT).catch((e) => setError(e.message)); }, [leagueId, abbr]);
  useEffect(() => {
    if (tab === "news" && !news) api.get(`/leagues/${leagueId}/season/team/news` + qs({ abbr })).then((x) => setNews(x.news)).catch(() => setNews([]));
  }, [tab, news, leagueId, abbr]);
  const results = (t?.schedule || []).map((g) => g.result).filter(Boolean);
  return (
    <div className="panel scroll team-panel" data-testid="team-panel">
      <button className="sidebar-close" onClick={onClose} title="Close team" data-testid="team-close" aria-label="Close team"><Icon name="x" /></button>
      {!t ? <div className="muted">{error || `Loading ${abbr}…`}</div> : <>
        <div className="tp-head sec">
          <img src={t.logo} alt="" width={52} height={52} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          <div>
            <h3 className="tp-name">{t.name}{t.conference && <span className={`conf conf-${t.conference}`}>{t.conference}</span>}</h3>
            <div className="small muted">{results.length > 0 && <><strong data-testid="team-nba-record">{results.filter((r) => r === "W").length}-{results.filter((r) => r === "L").length}</strong> · </>}
              team <strong>#{t.talent_rank}</strong> of {t.teams} in projected fantasy talent</div>
          </div>
        </div>
        <nav className="profile-tabs" data-testid="team-tabs">
          {TEAM_TABS.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} data-testid={`team-tab-${id}`}>{label}</button>)}
        </nav>
        {tab === "schedule" && (
          <DragScroll vertical className="tp-schedule sec news-scroll" data-testid="team-schedule">{t.schedule.map((g) => (
            <div key={g.date} className="tp-game">
              <span className="small muted tp-date">{dayName(g.date)} {md(g.date)}</span>
              <span className="muted tp-at">{g.home ? "vs" : "@"}</span>
              <img src={teamLogo(g.opp)} alt="" width={22} height={22} />
              <TeamLink abbr={g.opp}>{t.names[g.opp] || g.opp}</TeamLink>
              {g.result && <span className="tp-result"><strong className={g.result === "W" ? "ok" : "warn-text"}>{g.result}</strong> {g.pts}-{g.opp_pts}</span>}
            </div>
          ))}</DragScroll>
        )}
        {tab === "roster" && (
          <div className="team-card">
            {t.ranks && <TeamRanks r={t.ranks} />}
            <DepthGrid grid={t.depth_grid} onSelectPlayer={onOpenPid} />
          </div>
        )}
        {tab === "stats" && (
          <DragScroll className="tp-stats-wrap sec" ><table className="tp-stats" data-testid="team-stats">
            <thead><tr><th>{t.name}</th>{["MIN", "PTS", "REB", "AST", "FG%", "FT%", "3P%", "STL", "BLK", "TO", "PF"].map((h) => <th key={h} className="num">{h}</th>)}</tr></thead>
            <tbody>{t.stats.map((r) => (
              <tr key={r.sleeper_id} className="clickable" onClick={() => onOpenPid(r.player_id)}>
                <td><span className="tp-player"><Headshot sleeperId={r.sleeper_id} name={r.name} size={22} /><span>{shortName(r.name)}</span> <PosList list={r.pos} /></span></td>
                {r.gp ? ["min", "pts", "reb", "ast", "fg_pct", "ft_pct", "tp_pct", "stl", "blk", "to", "pf"].map((k) => <td key={k} className="num">{r[k] ?? "—"}</td>)
                  : <td className="num muted" colSpan={11}>no games yet</td>}
              </tr>
            ))}</tbody>
          </table></DragScroll>
        )}
        {tab === "news" && <DragScroll vertical className="sec news-scroll">{news ? (news.length ? news.map((n, i) => <NewsNote key={i} n={n} open={onOpenPid} />) : <div className="muted">No recent notes on this team's players.</div>)
          : <div className="muted">Loading news…</div>}</DragScroll>}
        {tab === "roster" && (
          <div className="sec" data-testid="team-injuries"><div className="bid-label sp-head">Roster status</div>{[["q", "? Questionable", "Game-time and day-to-day decisions"], ["out", "(−) Out", "Out and injured reserve"]].map(([g, title, sub]) => {
            const list = t.injuries.filter((h) => h.group === g);
            return (
              <section key={g} className={`tp-inj health-box-${g}`}>
                <h4 className={`health-${g}`}>{title} <span className="small muted">· {sub} ({list.length})</span></h4>
                {list.length ? list.map((h) => (
                  <div key={h.sid} className={`tp-inj-row ${h.player_id ? "clickable" : ""}`} onClick={() => h.player_id && onOpenPid(h.player_id)}>
                    <Headshot sleeperId={h.sid} name={h.name} size={28} />
                    <span><strong className={`health-${g}`}>{h.name}</strong> <span className="small muted">{h.pos.join(" ")}</span></span>
                    <span className="small tp-inj-tag">{h.status}{h.body ? ` · ${h.body}` : ""}{h.note ? ` · ${h.note}` : ""}</span>
                  </div>
                )) : <div className="small muted">None.</div>}
              </section>
            );
          })}</div>
        )}
      </>}
    </div>
  );
}

const BOX_COLS = [["MIN", (r) => r.min], ["PTS", (r) => r.stats.pts], ["REB", (r) => r.stats.reb], ["AST", (r) => r.stats.ast],
  ["STL", (r) => r.stats.stl], ["BLK", (r) => r.stats.blk], ["TO", (r) => r.stats.to], ["FG", (r) => `${r.stats.fgm}-${r.stats.fga}`],
  ["3PT", (r) => `${r.stats.tpm}-${r.stats.tpa}`], ["FT", (r) => `${r.stats.ftm}-${r.stats.fta}`], ["PF", (r) => r.stats.pf]];
const initialName = (n) => { const [first, ...rest] = (n || "").split(" "); return rest.length ? `${first[0]}. ${rest.join(" ")}` : n; };
const normName = (n) => (n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
const GpHead = ({ src, size }) => src
  ? <img className="gp-head" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
  : <span className="gp-head" style={{ width: size, height: size }} />;
export function GamePanel({ sel, data, leagueId, onOpenPid, onClose }) {
  const [g, setG] = useState(null);
  const [error, setError] = useState("");
  const { list: matches } = useNBAMatches();
  useEffect(() => {
    const load = () => api.get(`/leagues/${leagueId}/season/game` + qs({ event: sel.game.event })).then((x) => { setG(x); setError(""); }).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [leagueId, sel.game.event]);
  const owner = {};
  for (const t of data.teams) for (const sid of t.players) {
    const n = data.players[sid]?.name;
    if (n) owner[normName(n)] = { sid, team: t.user || t.name, mine: t.is_user };
  }
  const watch = sel.game.state !== "post" ? watchUrl(findMatch(matches, sel.game, sel.team)) : null;
  const { mins, countdown, when } = tipInfo(g?.tip);
  const status = !g ? "" : g.state === "in" ? quarters(g.detail) : g.state === "post" ? "Final" : countdown;
  return (
    <div className="panel scroll game-panel" data-testid="game-panel">
      <button className="sidebar-close" onClick={onClose} title="Close game" data-testid="game-close" aria-label="Close game"><Icon name="x" /></button>
      {!g ? <div className="muted">{error || "Loading the game…"}</div> : <>
        <div className="gp-score">
          {g.teams.map((t, i) => (
            <React.Fragment key={t.abbr}>
              {i === 1 && <div className="gp-status">{g.state !== "in" && g.state !== "post" && mins > 0 && <span className="small muted">TIPS IN</span>}<span className={g.state === "in" ? "gp-live" : ""}>{status}</span><span className="small muted">{when}</span></div>}
              <div className={`gp-team ${i ? "gp-home" : ""}`}>
                {t.logo && <TeamLink abbr={t.abbr}><img src={t.logo} alt="" width={40} height={40} /></TeamLink>}
                <div><div className="gp-abbr"><TeamLink abbr={t.abbr} />{g.state !== "pre" && t.record && <span className="gp-rec"> {t.record}</span>}</div>
                  {g.state === "pre" ? <div className="gp-record">{t.record || "—"}</div> : <div className="gp-pts">{t.score ?? "—"}</div>}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
        {watch && <div className="gp-actions"><a className="gp-watch" href={watch} target="_blank" rel="noopener noreferrer">▶ Watch</a></div>}
        {g.teams.some((t) => t.players.length) && (
          <section className="gp-section" data-testid="game-leaders">
            <h4>Top performers</h4>
            <div className="gp-leaders">{g.teams.map((t) => (
              <div key={t.abbr}>
                <div className="gp-leaders-team">{t.logo && <img src={t.logo} alt="" width={18} height={18} />}<TeamLink abbr={t.abbr} /></div>
                {[...t.players].sort((a, b) => b.fp - a.fp).slice(0, 5).map((r) => {
                  const own = owner[normName(r.name)];
                  return (
                    <div key={r.name} className={`gp-leader ${r.player_id ? "clickable" : ""}`} onClick={r.player_id ? () => onOpenPid(r.player_id) : undefined}>
                      <GpHead src={r.head} size={34} />
                      <div>
                        <div className={`gp-name ${own?.mine ? "gp-mine-name" : ""}`}>{r.name}{r.jersey && <span className="gp-jersey">#{r.jersey}</span>}</div>
                        <div className="gp-line"><span className="gp-fp">{fp(r.fp)} FP</span>
                          {r.min != null && <span><strong>{r.min}</strong> MIN</span>}
                          {r.lead.map(([k, v]) => <span key={k}><strong>{v}</strong> {k}</span>)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}</div>
          </section>
        )}
        {g.teams.map((t, i) => {
          const rows = [...t.players].sort((a, b) => b.starter - a.starter || b.min - a.min);
          return (
            <section key={t.abbr} className={`gp-section gp-tint-${i % 2}`}>
              <h4><TeamLink abbr={t.abbr}>{t.name}</TeamLink></h4>
              {g.state === "pre" ? null : rows.length ? (
                <table className="gp-box"><thead><tr><th>Player</th><th className="num">FP</th>{BOX_COLS.map(([h]) => <th key={h} className="num">{h}</th>)}</tr></thead>
                  <tbody>{rows.map((r) => {
                    const own = owner[normName(r.name)];
                    return (
                      <tr key={r.name} className={own?.mine ? "gp-mine" : ""}>
                        <td className={r.player_id ? "clickable" : ""} onClick={r.player_id ? () => onOpenPid(r.player_id) : undefined}>
                          <span className="gp-player">
                            <GpHead src={r.head} size={22} />
                            <span className="gp-name">{initialName(r.name)}</span>
                          </span>
                        </td>
                        <td className="num"><strong>{fp(r.fp)}</strong></td>
                        {BOX_COLS.map(([h, f]) => <td key={h} className="num">{f(r)}</td>)}
                      </tr>
                    );
                  })}</tbody></table>
              ) : <div className="small muted">No minutes yet.</div>}
              {t.dnp.some((d) => d.reason) && <div className="small muted gp-dnp">{g.state === "post" ? "DNP" : "Not in yet"}: {t.dnp.filter((d) => d.reason).map((d) => d.name).join(", ")}</div>}
              {t.ranks && <TeamRanks r={t.ranks} />}
              <DepthGrid grid={t.depth_grid} onSelectPlayer={onOpenPid} />
            </section>
          );
        })}
      </>}
    </div>
  );
}

export const lockEdge = (r) => (r.win_lock ?? 0) - (r.win_wait ?? 0);
export const lockableOf = (p) => p.players.filter((r) => r.x != null && r.x_final && r.lock_status !== "locked" && r.lock_status !== "guess" && lockEdge(r) >= -0.05)
  .sort((a, b) => lockEdge(b) - lockEdge(a));
export const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

function GameChips({ games, today, lockDate, lockGuess, lockable, benched, day, lane, team, onOpen, onLock }) {
  const graph = useNarrow();
  const peak = Math.max(1, ...games.map((x) => Math.max(x.fp ?? 0, x.pace ?? 0, x.proj ?? 0)));
  if (!games.length) return lane ? <span className="chips-lane"><span className="muted small">no games</span></span> : <span className="muted small">no games</span>;
  const chips = games.map((g, i) => {
        const played = g.fp != null, live = g.state === "in" || (played && g.state !== "post");
        const later = games.slice(i + 1).some((x) => x.state !== "pre" || x.fp != null);
        const dead = lockDate ? g.date !== lockDate : (g.state === "post" && (later || !lockable)) || (live && benched);
        const upcoming = g.state === "pre" && !played && !dead;
        const toggle = !onLock ? null : lockDate === g.date ? "" : !lockDate && g.state === "post" && played && !benched ? g.date : null;
        const lockClick = (e) => { e.stopPropagation(); onLock(toggle); };
        const exp = live && g.pace != null ? g.pace : g.proj;
        const tip = [
          graph && [timeOf(g.tip), played && `${fp(g.fp)} FP`, exp != null && `proj ${fp(exp)}`].filter(Boolean).join(" · "),
          [team, g.score, g.home ? "vs" : "@", g.opp, g.opp_score].filter((x) => x != null && x !== "").join(" "),
          played && g.min != null && !g.box && `${Math.round(g.min)} MIN`,
          g.b2b && g.state === "pre" && "2nd night of a back-to-back",
          g.beat != null && `${Math.round(g.beat * 100)}% to score higher this week`,
          lockDate === g.date ? (lockGuess ? "locked (a guess: his next game confirms it)" : "locked") : dead && !toggle && "can't be locked",
          toggle === "" ? "padlock: unlock" : toggle && (dead ? "padlock: mark it locked (a lock you didn't record)" : "padlock: lock"),
        ].filter(Boolean).join(" · ") + (g.box ? `\n${boxLine(g.box, g.min)}` : "");
        return (
          <span key={g.date} onClick={onOpen && g.event ? (e) => { e.stopPropagation(); onOpen(g); } : undefined}
            style={lane?.xs ? { left: lane.xs.get(tipMs(g)) ?? 0, ...(lane.scale < 1 && { width: 100 * lane.scale }) } : undefined}
            className={`game-chip ${graph ? "graph" : ""} ${played ? "played" : ""} ${live ? "live" : ""} ${g.date === today && upcoming ? "today" : ""} ${lockDate === g.date ? `locked ${lockGuess ? "guess" : ""}` : ""} ${day ? (g.date === day && upcoming ? "pick" : lockDate === g.date || live || (g.state === "post" && !dead) ? "" : "dim") : ""} ${dead ? "dead" : ""} ${onOpen && g.event ? "openable" : ""}`}
            data-tip={tip}>
            <span className="gch-day">{live ? shortQuarter(g.detail) : dayName(g.date)} <span className="gch-time">{live ? "LIVE"
              : lockDate === g.date && toggle !== "" ? <LockIcon />  
              : played ? "final" : timeOf(g.tip).replace(":00", "").replace(" PM", "p").replace(" AM", "a")}</span></span>
            {toggle && <button className="gch-lockbtn corner" onClick={lockClick} aria-label="Lock" data-testid="lock-game"><LockIcon open /></button>}
            {toggle === "" && <button className="gch-lockbtn corner unlock" onClick={lockClick} aria-label="Unlock" data-testid="unlock-game"><LockIcon /></button>}
            {graph ? <>
              <span className="gch-bar"><i className="exp" style={{ height: `${100 * (exp ?? 0) / peak}%` }} />{played && <i className="act" style={{ height: `${100 * g.fp / peak}%` }} />}</span>
              <span className="gch-fp">{fp(played ? g.fp : exp)}</span>
            </> : <span className="gch-fp">{played ? fp(g.fp) : "—"}<span className={`gch-exp ${live && g.pace != null && g.proj != null ? (g.pace >= g.proj ? "up" : "down") : ""}`}>{fp(exp)}</span></span>}
          </span>
        );
      });
  if (!lane) return <span className="chips-row">{chips}</span>;
  return <span className="chips-lane">{lane.xs ? chips : <span className="chips-row">{chips}</span>}</span>;
}

export const quarters = (detail) => (detail || "").replace(/^(.+) - (\d)(?:st|nd|rd|th)$/, "Q$2 $1").replace(/^(.+) - (\d?OT)$/, "$2 $1")
  .replace(/\b(\d)(?:st|nd|rd|th)\b/g, "Q$1");
export const shortQuarter = (detail) => quarters(detail).replace("End of ", "End ").replace("Start of ", "Start ").replace("Halftime", "Half") || "—";

const boxLine = (b, min) => `${min != null ? `${Math.round(min)} MIN, ` : ""}${b.pts} PTS, ${b.reb} REB, ${b.ast} AST, ${b.blk} BLK, ${b.fgm}/${b.fga} FG, ${b.ftm}/${b.fta} FT, ${b.to} TO, ${b.pf} PF`;

export const LockIcon = ({ open }) => (
  <svg className="gch-lock" viewBox="0 0 10 12" aria-hidden="true">
    <path d={open ? "M3 5.2V2.6a2 2 0 0 1 4 0v.6" : "M3 5.2V3.6a2 2 0 0 1 4 0v1.6"} fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="1" y="5" width="8" height="6.5" rx="1.6" fill="currentColor" />
  </svg>
);

const tipMs = (g) => Date.parse(g.tip) || Date.parse(`${g.date}T12:00:00`);

const CHIP_W = 100, CHIP_GAP = 6, HOUR_MIN = 4, HOUR_MAX = 12;
function laneXs(games, width) {
  const day = new Map(games);
  const tips = [...day.keys()].sort((a, b) => a - b);
  if (!tips.length || !width) return { xs: new Map(), scale: 1 };
  const t0 = tips[0], span = Math.max(1, tips.at(-1) - t0);
  const place = (s, h, cw) => {
    const x = new Map();
    let prev = 0, start = 0, first = t0, last = t0;
    for (const t of tips) {
      const lin = (s * (t - t0) / span) * (width - cw);
      let v;
      if (day.get(t) !== day.get(last)) { v = Math.max(prev + cw + CHIP_GAP, lin); start = v; first = t; }
      else v = Math.max(prev, start + ((t - first) / 3600e3) * h, lin);
      x.set(t, v); prev = v; last = t;
    }
    return x;
  };
  const ok = (s, h, cw) => place(s, h, cw).get(tips.at(-1)) + cw <= width;
  const most = (lo, hi, f) => {
    if (f(hi)) return hi;
    if (!f(lo)) return null;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (f(m)) lo = m; else hi = m; }
    return lo;
  };
  const h = most(HOUR_MIN, HOUR_MAX, (v) => ok(0, v, CHIP_W));
  if (h == null) {
    const cw = most(0.65 * CHIP_W, CHIP_W, (v) => ok(0, HOUR_MIN, v));
    return cw == null ? { xs: null } : { xs: place(0, HOUR_MIN, cw), scale: cw / CHIP_W };
  }
  const s = most(0, 1, (v) => ok(v, h, CHIP_W));
  return { xs: place(s, h, CHIP_W), scale: 1 };
}

function laneAt(xs, ms, start, end, width) {
  const pts = [[start, -8], ...xs, [Math.max(end, start + 1), width]];
  if (ms <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, x1] = pts[i], [t0, x0] = pts[i - 1];
    if (ms <= t1) return t1 === t0 ? x1 : x0 + ((ms - t0) / (t1 - t0)) * (x1 - x0);
  }
  return width;
}

const sameFields = (a, b) => a === b || (!!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]));
const sameCard = (a, b) => Object.keys(a).every((k) => (k === "r" ? sameFields(a.r, b.r) : a[k] === b[k]));
const PlayerCard = React.memo(function PlayerCard({ data, r, open, openGame, setLock, mine, side, day, lane }) {
  const openTeam = useContext(TeamLinkContext);
  if (!r) return <div className={`mu-card empty ${side}`}><span className="muted small">empty</span></div>;
  const p = data.players[r.sid] || { games: [] };
  const starter = r.slot !== "BN" && r.slot !== "IR";
  const locked = r.lock_status === "locked" || r.lock_status === "guess";
  return (
    <div className={`mu-card ${side} ${starter ? "" : "bench"} ${locked ? "done" : ""} ${isOut(p.injury_tag) ? "out" : isDoubt(p.injury_tag) ? "doubt" : ""}`} data-testid={`mu-${r.sid}`}>
      <div className="mu-top">
        <div className="mu-id clickable" onClick={() => open(r.sid)} data-testid={`open-${r.sid}`}>
        <span className="mu-hs" data-tip={injuryTip(p.injury_tag, p.injury_note)}><Headshot sleeperId={r.sid} name={r.name} size={34} />{p.team && <span className="mu-hs-badge" data-tip="" role="link" onClick={openTeam ? (e) => { e.stopPropagation(); openTeam(p.team); } : undefined}><img className="mu-hs-logo" src={teamLogo(p.team)} alt={p.team} /></span>}</span>
        <div className="mu-who">
          <div className="mu-name"><span className="mu-nm" data-clip={r.name}>{r.name}</span><InjuryTag tag={p.injury_tag} note={p.injury_note} /></div>
          <div className="small muted mu-sub" data-clip={p.nick && showNicks() ? `“${p.nick}”` : undefined}>{!p.team && <>{p.retired ? "Retired" : "FA"} </>}<PosList list={r.pos} />
            {p.nick && showNicks() && <span className="nick"> · “{p.nick}”</span>}</div>
        </div>
        </div>
        <GameChips games={p.games} team={p.team} today={data.today} day={mine ? day || data.day : day} lockDate={locked ? r.lock_date : null} lockGuess={r.lock_status === "guess"} lockable={r.x != null} benched={r.slot === "BN" || r.slot === "IR"} lane={lane}
          onOpen={openGame ? (g) => openGame({ game: g, team: p.team, sid: r.sid, name: r.name }) : null}
          onLock={setLock ? (date) => setLock(r.sid, date) : null} />
      </div>
    </div>
  );
}, sameCard);

export function bySlot(rows, positions, irSlots) {
  const pool = {};
  for (const r of [...rows].sort((a, b) => b.value - a.value)) (pool[r.slot] ||= []).push(r);
  const fill = (slot, n) => Array.from({ length: n }, () => ({ slot, r: (pool[slot] || []).shift() }));
  const lines = positions.filter((x) => x !== "BN" && x !== "IR").map((slot) => ({ slot, r: (pool[slot] || []).shift() }));
  const bench = fill("BN", Math.max(positions.filter((x) => x === "BN").length, (pool.BN || []).length));
  const ir = fill("IR", Math.max(irSlots || 0, (pool.IR || []).length));
  return { lines, bench, ir };
}

export function flashEl(el) {
  el.classList.remove("ap-flash");
  void el.offsetWidth;
  el.classList.add("ap-flash");
  el.addEventListener("animationend", () => el.classList.remove("ap-flash"), { once: true });
}

export function WeekView({ data, plan, open, openGame, setLock, leagueId, onShow, focus }) {
  const idxOf = (rid) => data.matchups.findIndex((pair) => pair.some((m) => m.roster_id === rid));
  const mineIdx = Math.max(0, idxOf(plan.roster_id));
  const [idx, setIdx] = useState(() => (focus && idxOf(focus.rid) >= 0 ? idxOf(focus.rid) : mineIdx));
  useEffect(() => { if (focus && idxOf(focus.rid) >= 0) setIdx(idxOf(focus.rid)); }, [focus]);
  useEffect(() => { onShow?.(idx === mineIdx ? plan.roster_id : data.matchups[idx]?.[0]?.roster_id); }, [idx]);
  const [other, setOther] = useState(null);
  const isMine = idx === mineIdx;
  const shown = isMine ? plan : other;
  const [at, setAt] = useState(null);
  const tl = shown?.timeline, nowMs = data.now ? Date.parse(data.now) : Date.now();
  const atMs = Math.max(at ?? nowMs, nowMs);
  const gap = data.sleeper_gap;
  const gamesOf = React.useMemo(() => Object.fromEntries(Object.entries(data.players).map(([sid, p]) => [sid, p.games])), [data.players]);
  const best = bestLineup(shown, atMs, data.roster_positions, false, gamesOf), them = bestLineup(shown?.opponent, atMs, data.roster_positions, true, gamesOf);
  const [view, setView] = useState("best");
  const differs = !!shown && best.rows.some((r, i) => r.slot !== shown.players[i].slot);
  const me = differs && view === "sleeper" ? bestLineup(shown, atMs, data.roster_positions, true, gamesOf) : best;
  const seg = me.seg;
  const gridRef = React.useRef(null);
  const narrow = useNarrow(), thin = useThin(), gutter = narrow ? 60 : ARROW_GUTTER;
  useEffect(() => {
    if (isMine) { setOther(null); return; }
    const rid = data.matchups[idx]?.[0]?.roster_id;
    api.get(`/leagues/${leagueId}/season/plan` + qs({ week: data.week, roster_id: rid })).then(setOther).catch(() => setOther(null));
  }, [idx, isMine, leagueId, data.week, data.matchups]);
  const flashed = React.useRef(null);
  useEffect(() => {
    const leftRid = isMine ? plan.roster_id : data.matchups[idx]?.[0]?.roster_id;
    if (!focus || flashed.current === focus || !shown || shown.roster_id !== leftRid || !gridRef.current) return;
    flashed.current = focus;
    const side = focus.rid === leftRid ? "left" : "right", panel = gridRef.current.closest(".matchup");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    [...panel.querySelectorAll(`.mu-card.${side}`), panel.querySelector(side === "left" ? ".mu-head > .mu-team:not(.right)" : ".mu-head > .mu-team.right")].forEach((el) => el && flashEl(el));
  });
  const [lane, setLane] = useState(null);
  React.useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const measure = () => {
      const g = grid.getBoundingClientRect().left;
      const side = (s) => [...grid.querySelectorAll(`.mu-card.${s} .chips-lane`)];
      const L = side("left"), R = side("right");
      if (!L.length && !R.length) return;
      const w = Math.min(...[...L, ...R].map((e) => e.getBoundingClientRect().width));
      const edge = (els) => (els.length ? els[0].getBoundingClientRect().left - g : null);
      const l = edge(L), r = edge(R);
      setLane((o) => (o && o.w === w && o.l === l && o.r === r ? o : { w, l, r }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  });
  const games = (players) => players.flatMap((r) => (data.players[r.sid]?.games || []).map((g) => [tipMs(g), g.date]));
  const xs = React.useMemo(() => (narrow ? { xs: null } : laneXs([...games(shown?.players || []), ...games(shown?.opponent?.players || [])], lane?.w)),
    [shown, data.players, lane?.w, narrow]);
  const n = data.matchups.length;
  const step = (d) => setIdx((i) => (i + d + n) % n);
  const nav = (
    <>
      <button className="mu-arrow neon-arrow left" onClick={() => step(-1)} data-tip="Previous matchup" aria-label="Previous matchup" data-testid="mu-prev"><NeonArrow dir="left" /></button>
      <button className="mu-arrow neon-arrow right" onClick={() => step(1)} data-tip="Next matchup" aria-label="Next matchup" data-testid="mu-next"><NeonArrow dir="right" /></button>
    </>
  );
  if (!shown) return <div className="panel matchup"><div className="mu-head">{nav}<div className="muted">Loading matchup {idx + 1} of {n}…</div></div></div>;
  const o = shown.opponent;
  const L = bySlot(me.rows, data.roster_positions, data.reserve_slots);
  const R = o ? bySlot(them.rows, data.roster_positions, data.reserve_slots) : { lines: [], bench: [], ir: [] };
  const irRows = Math.max(L.ir.length, R.ir.length);
  const allRows = L.lines.length + Math.max(L.bench.length, R.bench.length) + irRows;
  const nBench = Math.max(L.bench.length, R.bench.length);
  const rowT = `minmax(${ROW_MIN}px, 1fr)`;
  const tracks = [...Array(L.lines.length).fill(rowT), ...(nBench ? ["5px", ...Array(nBench).fill(rowT)] : []),
    ...(irRows ? ["5px", ...Array(irRows).fill(rowT)] : [])];
  const minH = allRows * ROW_MIN + (tracks.length - allRows) * 5 + (tracks.length - 1) * 5;
  const row = (l, r, key, slot, first, gr) => (
    <React.Fragment key={key}>
      <div className="mu-cell" style={{ gridRow: gr }}><PlayerCard data={data} r={l?.r} open={open} openGame={openGame} setLock={setLock} mine={isMine} side="left" day={seg?.date} lane={xs} /></div>
      <div className={`mu-slot ${first ? "first" : ""}`} style={{ gridRow: gr }}><PosTag text={slot} /></div>
      {!thin && <div className="mu-cell" style={{ gridRow: gr }}><PlayerCard data={data} r={r?.r} open={open} openGame={openGame} setLock={setLock} side="right" day={them.seg?.date} lane={xs} /></div>}
    </React.Fragment>
  );
  const benchAt = L.lines.length + 2, irAt = benchAt + nBench + (nBench ? 1 : 0);
  return (
    <div className={`panel matchup ${thin ? "thin" : ""}`} data-testid="my-week" style={{ "--gut": `${gutter}px` }}>
      {tl?.segments.length > 0 && <Timeline tl={tl} nowMs={nowMs} atMs={atMs} setAt={setAt} view={differs ? view : "best"} setView={setView} differs={differs} />}
      {gap && <div className="small muted mu-gap" data-testid="sleeper-gap">Sleeper still shows yesterday's lineup: the arrows start from it, so skip any move you've already made.</div>}
      <div className="mu-head">
        <button className="mu-arrow neon-arrow" onClick={() => step(-1)} data-tip="Previous matchup" aria-label="Previous matchup" data-testid="mu-prev"><NeonArrow dir="left" /></button>
        <div className="mu-team">
          <TeamName t={shown} cls="mc-name" size={34} mine={isMine} />
          <span className="small muted">{shown.games_left} left</span>
          <span className="mu-score">{Math.abs(shown.expected - shown.points) >= 0.005 && <span className="mu-exp-total">{shown.expected}</span>}<span className="mc-points">{fp(shown.points)}</span></span>
        </div>
        <div className="mu-mid">
          <span className="small muted">{idx + 1}/{n}</span>
          {!isMine && <button className="tiny" onClick={() => setIdx(mineIdx)}>mine</button>}
        </div>
        {!thin && <div className="mu-team right">
          {o && <span className="mu-score"><span className="mc-points">{fp(o.points)}</span>{Math.abs(o.expected - o.points) >= 0.005 && <span className="mu-exp-total">{o.expected}</span>}</span>}
          {o && <span className="small muted">{o.games_left} left · {o.locked} locked</span>}
          {o ? <TeamName t={o} cls="mc-name" size={34} /> : <span className="mc-name">no opponent</span>}
        </div>}
        <button className="mu-arrow neon-arrow" onClick={() => step(1)} data-tip="Next matchup" aria-label="Next matchup" data-testid="mu-next"><NeonArrow dir="right" /></button>
      </div>
      <div className="mu-scroll">
      <div className="mu-grid with-arrows" ref={gridRef} style={{ gridTemplateRows: tracks.join(" "), minHeight: minH }}>
        <SwapArrows pairs={me.pairs} side="left" gutter={gutter} names={(sid) => data.players[sid]?.name || sid} />
        {!thin && <SwapArrows pairs={them.pairs} side="right" gutter={gutter} names={(sid) => data.players[sid]?.name || sid} />}
        {tl && lane && xs.xs?.size > 0 && [["l", lane.l], ["r", lane.r]].filter(([, x]) => x != null).map(([k, x]) => (
          <div key={k} className="time-line" data-testid={`time-line-${k}`} style={{ left: x + laneAt(xs.xs, atMs, Date.parse(tl.start), Date.parse(tl.end), lane.w) - 1 }} />
        ))}
        {L.lines.map((l, i) => row(l, R.lines[i], `s${i}`, l.slot, false, i + 1))}
        {Array.from({ length: nBench }, (_, i) => row(L.bench[i], R.bench[i], `b${i}`, "BN", i === 0, benchAt + i))}
        {Array.from({ length: irRows }, (_, i) => row(L.ir[i], R.ir[i], `i${i}`, "IR", i === 0, irAt + i))}
      </div>
      </div>
    </div>
  );
}

const GAME_MS = 135 * 60000;
export function bestLineup(team, atMs, positions, asIs, games = {}) {
  const tl = team?.timeline, players = team?.players || [];
  const seg = tl?.segments[Math.max(0, tl.segments.findIndex((s) => atMs < Date.parse(s.to)))];
  const seats = seg ? seg.seats : team?.today?.seats;
  if (!seats) return { seg, rows: players, pairs: [] };
  const best = {};
  for (const [slot, sids] of Object.entries(seats)) for (const sid of sids) best[sid] = slot;
  const now = Object.fromEntries(players.map((r) => [r.sid, r.slot]));
  const pos = Object.fromEntries(players.map((r) => [r.sid, r.pos || []]));
  const playing = (sid) => (games[sid] || []).some((g) => {
    const tip = Date.parse(g.tip);
    return tip <= atMs && g.state !== "post" && (g.state === "in" || atMs < tip + GAME_MS);
  });
  const fixed = new Set(players.filter((r) => r.lock_status === "locked" || r.lock_status === "guess"
    || (r.slot === "BN" && playing(r.sid))).map((r) => r.sid));
  const after = reseat(now, Object.fromEntries(players.map((r) => [r.sid, best[r.sid] || (r.slot === "IR" ? "IR" : "BN")])), pos, positions, fixed);
  const rows = players.map((r) => ({ ...r, slot: after[r.sid] }));
  return { seg, rows: asIs ? players : rows, pairs: swapSteps(now, after, pos, !asIs) };
}

const ROW_MIN = 54;
const ARROW_GUTTER = 80;
function SwapArrows({ pairs, side, names, gutter = ARROW_GUTTER }) {
  const svgRef = React.useRef(null);
  const [lines, setLines] = useState([]);
  const key = pairs.map((p) => `${p.n}:${p.a}>${p.b}`).join(",");
  React.useLayoutEffect(() => {
    const grid = svgRef.current?.parentElement;
    if (!grid) return undefined;
    const measure = () => {
      const top = grid.getBoundingClientRect().top;
      const mid = (sid) => {
        const el = grid.querySelector(`.mu-card.${side}[data-testid="mu-${sid}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 - top;
      };
      setLines(pairs.map((p) => ({ ...p, y1: mid(p.b), y2: mid(p.a) })).filter((l) => l.y1 != null && l.y2 != null)
        .sort((a, b) => Math.abs(a.y1 - a.y2) - Math.abs(b.y1 - b.y2)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [key]);
  const step = Math.min(13, (gutter - 24) / Math.max(1, lines.length));
  const label = {};
  for (const s of pairs) {
    if (pairs.some((o) => o.n !== s.n && [o.in, o.out].some((x) => x === s.in || x === s.out))) label[s.n] = Object.keys(label).length + 1;
  }
  const end = gutter - 6;
  return (
    <svg ref={svgRef} className={`swap-arrows ${side}`} width={gutter} data-testid={`swap-arrows-${side}`}>
      {lines.map((l, i) => {
        const x = end - 12 - i * step, r = 6, dir = l.y2 < l.y1 ? -1 : 1;
        const color = `var(--pos-${(String(l.slot).match(/PG|SG|SF|PF|C/) || ["C"])[0]})`;
        const chained = label[l.n] != null;
        const mid = l.y1 + (l.y2 - l.y1) * [0.5, 0.3, 0.7][i % 3], gap = chained ? 10 : 0;
        const d = `M ${end - 5} ${l.y1} H ${x + r} Q ${x} ${l.y1} ${x} ${l.y1 + dir * r} V ${mid - dir * gap} `
          + `M ${x} ${mid + dir * gap} V ${l.y2 - dir * r} Q ${x} ${l.y2} ${x + r} ${l.y2} H ${end - 5}`;
        const head = (y) => `${end - 6},${y - 5} ${end + 1},${y} ${end - 6},${y + 5}`;
        return (
          <g key={l.n} style={{ color }}>
            <title>{`Swap ${names(l.in)} (${l.from}) and ${names(l.out)} (${l.to})`}</title>
            <path d={d} className="swap-path" />
            <polygon points={head(l.y1)} fill="currentColor" />
            <polygon points={head(l.y2)} fill="currentColor" />
            {chained && <text className="swap-n" x={side === "right" ? -x : x} y={mid} transform={side === "right" ? "scale(-1,1)" : undefined}>{label[l.n]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

const STEP_MS = 15 * 60000;

function Timeline({ tl, nowMs, atMs, setAt, view, setView, differs }) {
  const start = Date.parse(tl.start), end = Date.parse(tl.end);
  const frac = (ms) => Math.min(1, Math.max(0, (ms - start) / (end - start)));
  const at = (ms) => `calc(${frac(ms)} * (100% - 16px) + 8px)`;
  const days = Array.from({ length: 7 }, (_, i) => start + i * 86400000 + 12 * 3600000);
  const next = tl.segments.slice(0, -1).map((s) => Date.parse(s.to)).find((ms) => ms > nowMs);
  const until = untilText(next ? Math.ceil((next - nowMs) / 60000) : 0);
  return (
    <div className="timeline" data-testid="timeline">
      <button className="tl-next" onClick={() => setView(view === "best" ? "sleeper" : "best")} disabled={!differs} data-testid="lineup-toggle"
        data-tip={differs ? "Switch between the best lineup and the lineup in Sleeper now." : "The Sleeper lineup is already the best one."}>
        <span className="tl-next-head"><span className="tl-next-label">LINEUP</span></span>
        <strong className="tl-toggle-val"><span className={view === "best" ? "" : "off"}>Best</span><span className={view === "best" ? "off" : ""}>Current</span></strong>
      </button>
      <div className="tl-main">
        <div className="tl-days">{days.map((d) => <span key={d}>{fmt(d, { weekday: "short" })} {fmt(d, { month: "2-digit", day: "2-digit" })}</span>)}</div>
        <div className="tl-bar">
          <div className="tl-past" style={{ width: at(nowMs) }} />
          {tl.segments.slice(0, -1).map((s) => <div key={s.to} className="tl-mark" style={{ left: at(Date.parse(s.to)) }} />)}
          <input type="range" min={start} max={end} step={STEP_MS} value={Math.round((atMs - start) / STEP_MS) * STEP_MS + start}
            onChange={(e) => setAt(Math.max(Number(e.target.value), nowMs))} aria-label="Lineup time" data-testid="timeline-slider" />
          <span className="tl-time" style={{ left: at(atMs) }} data-testid="timeline-time">{fmt(atMs, { hour: "numeric", minute: "2-digit" })}</span>
        </div>
      </div>
      {next && <button className="tl-next" onClick={() => setAt(next)} data-testid="next-check"
        data-tip="The next time the lineup changes: open Sleeper then and make every swap at once. Click to show that lineup.">
        <span className="tl-next-head"><span className="tl-next-label">Next check-in</span><span className="tl-next-in">in {until}</span></span>
        <strong>{fmt(next, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
      </button>}
    </div>
  );
}

function TeamColumn({ data, team, open }) {
  const { lines, bench, ir } = bySlot(team.players, data.roster_positions, data.reserve_slots);
  return (
    <div className="team-col">
      {[...lines, ...bench, ...ir].map((line, i) => (
        <div key={i} className="team-col-row"><div className="mu-slot"><PosTag text={line.slot} /></div><PlayerCard data={data} r={line.r} open={open} side="left" /></div>
      ))}
    </div>
  );
}

const newsTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso), mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60);
  const ago = mins < 60 ? `${mins}m` : d ? `${d}d ${h}h` : `${h}h`;
  return `${ago} ago · ${fmt(t, { month: "2-digit", day: "2-digit", year: "2-digit" })}`;
};

function NewsNote({ n, open, owner }) {
  const title = n.headline.startsWith(`${n.name} - `) ? n.headline.slice(n.name.length + 3) : n.headline;
  return (
    <div className={`news-item ${n.injury ? "injury" : ""} ${isDoubt(n.injury_tag) ? "doubt" : ""}`}>
      <div className="news-head">
        <span className="clickable news-player" onClick={() => open(n.player_id)}>
          <Headshot sleeperId={n.sid} name={n.name} size={28} /> <strong>{n.name}</strong>
        </span>
        {n.pos?.length > 0 && <span className="small"><PosList list={n.pos} /></span>}
        {n.role && <span className={`role-tag ${n.role.star ? "star" : ""}`}>{n.role.label}</span>}
        {n.team && <span className="small muted news-team"><img src={teamLogo(n.team)} alt="" width={16} height={16} /><TeamLink abbr={n.team} /></span>}
        <InjuryTag tag={n.injury_tag} note={n.injury_note} />
        {owner && <span className="small muted">· {n.owner}</span>}
        <span className="small muted news-time">{newsTime(n.published)}</span>
      </div>
      <div className="news-title">{title}</div>
      {n.story && <div className="small news-story">{n.story}</div>}
    </div>
  );
}

const LEAGUE_NEWS = 80;

function TeamsReport({ leagueId, open, refreshKey }) {
  const [r, setR] = useState(null);
  const openTeam = useContext(TeamLinkContext);
  const order = (ps) => [...ps].sort((a, b) => !!b.starter - !!a.starter || (a.role?.rank ?? 99) - (b.role?.rank ?? 99));
  useEffect(() => { api.get(`/leagues/${leagueId}/season/injuries`).then(setR).catch(() => setR({ teams: [], names: {} })); }, [leagueId, refreshKey]);
  return (
    <div className="panel news-teams" data-testid="teams-report">
      <h3>Teams Report <span className="small muted">most starters hurt first</span></h3>
      {!r ? <div className="muted">Loading injuries…</div> : r.teams.map((t, i) => (
        <div key={t.abbr} className="tr-team clickable" onClick={() => openTeam?.(t.abbr)} data-testid={`report-${t.abbr}`}>
          <span className="muted tr-rank">{i + 1}</span>
          <img src={teamLogo(t.abbr)} alt="" width={24} height={24} />
          <div className="tr-body">
            <div className="tr-top"><strong>{r.names[t.abbr] || t.abbr}</strong>
              <span className="tr-counts">
                {t.starters_out > 0 && <span className="health-out">{t.starters_out} starter{t.starters_out > 1 ? "s" : ""}</span>}
                {t.starters_q > 0 && <span className="health-q">{t.starters_q} starter{t.starters_q > 1 ? "s" : ""} ?</span>}
              </span></div>
            <div className="tr-names">{order(t.players).map((h) => (
              <div key={h.sid} className={`tr-player ${h.player_id ? "clickable" : ""}`}
                onClick={h.player_id ? (e) => { e.stopPropagation(); open(h.player_id); } : undefined}>
                <Headshot sleeperId={h.sid} name={h.name} size={24} />
                <span className={`health-${h.group} ${h.starter ? "tr-starter" : ""}`}>{h.name}</span>
                {h.role && <span className={`role-tag ${h.role.star ? "star" : ""}`}
                  data-tip={h.role.shared_with ? `Shares the #1 option with ${h.role.shared_with.name} (${h.role.shared_with.fpg} projected FP/G)` : undefined}>{h.role.label}</span>}
                <span className="muted small">{[/^out$/i.test(h.status) ? "" : h.status, h.body, h.note].filter(Boolean).join(" · ")}</span></div>))}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamPick({ value, onChange, teams }) {
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) ref.current.open = false; };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const pick = (t) => { onChange(t); ref.current.open = false; };
  const row = (t) => <>{t ? <img src={teamLogo(t)} alt="" width={18} height={18} /> : null}{t || "All NBA teams"}</>;
  return (
    <details className="team-pick" ref={ref} data-testid="news-nba">
      <summary>{row(value)}</summary>
      <div className="team-pick-list">
        {["", ...teams].map((t) => <button key={t} type="button" className={`ghost ${t === value ? "active" : ""}`} onClick={() => pick(t)}>{row(t)}</button>)}
      </div>
    </details>
  );
}

export function NewsView({ leagueId, open, refreshKey }) {
  const [news, setNews] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState(""), [nba, setNba] = useState(""), [mgr, setMgr] = useState(""), [inj, setInj] = useState(false), [tab, setTab] = useState("mine");
  const [watched] = useWatch(leagueId);
  const watchKey = watched.join(",");
  useEffect(() => {
    api.get(`/leagues/${leagueId}/season/news`).then((n) => { setNews(n); setError(""); }).catch((e) => setError(e.message));
  }, [leagueId, refreshKey, watchKey]);
  if (error) return <div className="panel error">{error}</div>;
  if (!news) return <div className="panel muted">Loading news…</div>;
  const words = q.toLowerCase().trim();
  const keep = (n) => (!nba || n.team === nba) && (!inj || n.injury)
    && (!words || [n.name, n.team, n.user, n.headline, n.story].join(" ").toLowerCase().includes(words));
  const all = [...news.mine, ...news.league, ...news.free];
  const lists = {
    mine: news.mine,
    watched: all.filter((n) => watched.includes(n.player_id)).sort((a, b) => (b.published || "").localeCompare(a.published || "")),
    league: news.league.filter((n) => !mgr || n.user === mgr),
    free: news.free.filter((n) => n.trending !== false),
  };
  const shown = lists[tab].filter(keep);
  const nbaTeams = [...new Set(all.map((n) => n.team).filter(Boolean))].sort();
  const managers = [...new Set(news.league.map((n) => n.user))].sort((a, b) => a.localeCompare(b));
  const empty = { mine: "No recent notes on your players", watched: watched.length ? "No recent notes on your watched players" : "No watched players yet: open a player and press Watch", league: "No notes", free: "No notes" }[tab];
  return (
    <div className="news-wrap">
    <TeamsReport leagueId={leagueId} open={open} refreshKey={refreshKey} />
    <div className="news-col">
      <div className="panel news-filters" data-testid="news-filters">
        <input type="search" placeholder="Search player, team, manager or note…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="news-search" />
        <TeamPick value={nba} onChange={setNba} teams={nbaTeams} />
        {tab === "league" && <select value={mgr} onChange={(e) => setMgr(e.target.value)} data-testid="news-manager"><option value="">All managers</option>{managers.map((m) => <option key={m}>{m}</option>)}</select>}
        <label className="inline"><input type="checkbox" checked={inj} onChange={(e) => setInj(e.target.checked)} data-testid="news-injuries" /> Injuries only</label>
      </div>
      <div className="profile-tabs news-tabs" role="tablist">
        {[["mine", "My team"], ["watched", "Watched"], ["league", "League-wide"], ["free", "Free agents"]].map(([id, label]) => (
          <button key={id} role="tab" className={tab === id ? "active" : ""} onClick={() => setTab(id)} data-testid={`news-tab-${id}`}>{label}</button>))}
      </div>
      <div className="news-list">
        <div className="panel news" data-testid={`news-${tab}`}>
          {shown.length ? shown.slice(0, tab === "league" ? LEAGUE_NEWS : undefined).map((n, i) => <NewsNote key={i} n={n} open={open} owner={tab === "league" || tab === "watched"} />)
            : <div className="muted">{shown.length === 0 && (q || nba || inj) ? "No notes match." : `${empty}.`}</div>}
        </div>
      </div>
    </div>
    </div>
  );
}

function BestGames({ leagueId, week, openPid, openGame }) {
  const [games, setGames] = useState(null);
  useEffect(() => { api.get(`/leagues/${leagueId}/season/best` + qs({ week })).then((x) => setGames(x.games)).catch(() => setGames([])); }, [leagueId, week]);
  return (
    <div className="panel" data-testid="best-games">
      <h3>Best games</h3>
      {!games ? <div className="muted small">Loading…</div> : !games.length ? <div className="muted small">No games played yet.</div> : (
        <div className="best-games">{games.map((b, i) => {
          const g = b.game, sides = [[b.team, g.score], [g.opp, g.opp_score]], [away, home] = g.home ? [sides[1], sides[0]] : sides;
          const status = g.state === "in" ? quarters(g.detail) : g.state === "post" ? "Final" : "";
          return (
            <div key={`${b.sid}-${g.date}`} className="best-game">
              <span className="best-rank">{i + 1}</span>
              <Headshot sleeperId={b.sid} name={b.name} size={44} />
              <div className="best-main">
                <div><strong className={b.player_id && openPid ? "clickable" : ""} onClick={b.player_id && openPid ? () => openPid(b.player_id) : undefined}>{b.name}</strong>
                  {" "}<span className="small muted"><TeamLink abbr={b.team} /> <PosList list={b.pos} /></span></div>
                <div className="small muted best-line">{b.lead.map(([k, v]) => <span key={k}><strong>{v}</strong> {k}</span>)}
                  <span>{b.fg[0]}/{b.fg[1]} FG</span><span>{b.ft[0]}/{b.ft[1]} FT</span><span>{b.min} MIN</span></div>
              </div>
              <div className={`best-gamecard ${g.event && openGame ? "clickable" : ""}`}
                onClick={g.event && openGame ? () => openGame({ game: g, team: b.team, sid: b.sid, name: b.name }) : undefined}>
                {[away, home].map(([abbr, pts]) => (
                  <div key={abbr} className={`best-gc-team ${abbr === b.team ? "his" : ""}`}><img src={teamLogo(abbr)} alt="" width={16} height={16} /> {abbr}<strong>{pts ?? "—"}</strong></div>))}
                <div className="best-gc-status"><span className={g.state === "in" ? "gp-live" : ""}>{status}</span> {dayName(g.date)}</div>
              </div>
              <span className="best-fp">{fp(b.fp)}<small>FP</small></span>
            </div>
          );
        })}</div>
      )}
    </div>
  );
}

export function LeagueView({ data, leagueId, open, openPid, openGame, openMatchup, Standings }) {
  const team = Object.fromEntries(data.teams.map((t) => [t.roster_id, t]));
  const [shown, setShown] = useState(null);
  const show = (rid) => (openMatchup ? openMatchup(rid) : api.get(`/leagues/${leagueId}/season/plan` + qs({ week: data.week, roster_id: rid })).then(setShown).catch(() => setShown(null)));
  const standings = [...data.teams].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
  return (
    <>
      <div className="panel">
        <h3>Matchups</h3>
        <div className="league-matchups">
          {data.matchups.map((pair, i) => (
            <div key={i} className="lm-card">
              {pair.map((m) => {
                const t = team[m.roster_id] || {}, other = pair.find((x) => x !== m);
                return (
                  <div key={m.roster_id} className={`lm-row clickable ${t.is_user ? "me" : ""} ${other && (m.points || 0) > (other.points || 0) ? "lead" : ""}`}
                    onClick={() => show(m.roster_id)} data-tip={openMatchup ? "Jump to this team's matchup" : "Show this team's roster and games"}>
                    <TeamName t={t} size={22} mine={!!t.is_user} /><strong>{fp(m.points || 0)}</strong>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {shown && (
        <div className="panel" data-testid="team-roster">
          <h3><TeamName t={shown} size={28} /> <span className="small muted">expected {shown.expected} FP this week · {shown.games_left} games left</span>
            <button className="small ghost" style={{ marginLeft: 8 }} onClick={() => setShown(null)}>close</button></h3>
          <TeamColumn data={data} team={shown} open={open} />
        </div>
      )}
      <BestGames leagueId={leagueId} week={data.week} openPid={openPid} openGame={openGame} />
      {Standings ? <Standings data={data} onPick={show} /> : <div className="panel">
        <h3>Standings</h3>
        <table className="small st-table" data-testid="standings">
          <thead><tr><th>#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">PF</th><th className="num">FAAB left</th></tr></thead>
          <tbody>{standings.map((t, i) => (
            <tr key={t.roster_id} className={`${t.is_user ? "you-need" : ""} st-row st-${i + 1}`} style={{ "--pct": t.wins + t.losses ? t.wins / (t.wins + t.losses) : 0 }}><td className="st-rank"><b>{i + 1}</b></td><td className="clickable st-team" onClick={() => show(t.roster_id)}><TeamName t={t} size={22} record={false} /></td><td className="num">{t.wins}</td><td className="num">{t.losses}</td>
              <td className="num">{fp(t.fpts)}</td><td className="num">{data.waiver ? `$${(data.faab_budget ?? 100) - (t.faab_used || 0)}` : "?"}</td></tr>))}</tbody>
        </table>
      </div>}
    </>
  );
}

export function WaiversView({ leagueId, onSelect }) {
  const [w, setW] = useState(null);
  const [sort, setSort] = useState(null);
  useEffect(() => { api.get(`/leagues/${leagueId}/season/waivers`).then(setW).catch(() => setW(null)); }, [leagueId]);
  if (!w) return <div className="panel waivers">Loading free agents…</div>;
  if (w.error) return <div className="panel waivers warn-text" data-testid="waivers-error">{w.error}</div>;
  const faab = w.type === "FAAB";
  const STATS = [["fp", "FP/G"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["tpm", "3PM"], ["gp", "GP"]];
  const val = (c, k) => (k === "owned" || k === "started" ? c[k] : k === "games" ? c.games_left * 100 + c.games_next : c.season?.[k]);
  const claims = !sort ? w.claims : [...w.claims].sort((a, b) => {
    const x = val(a, sort.k), y = val(b, sort.k);
    return x == null || y == null ? (x == null) - (y == null) : sort.dir * (x - y);
  });
  const th = (k, label, tip, cls = "num") => (
    <th className={`${cls} clickable`} data-tip={tip} onClick={() => setSort(sort?.k !== k ? { k, dir: 1 } : sort.dir === 1 ? { k, dir: -1 } : null)} data-testid={`sort-${k}`}>
      {label}{sort?.k === k && (sort.dir === 1 ? " ▲" : " ▼")}</th>);
  const until = untilText(Math.max(0, Math.round((Date.parse(w.next_run) - Date.now()) / 60000)));
  const runDay = fmt(w.next_run, { weekday: "short" });
  const hour = `${w.run_hour % 12 || 12} ${w.run_hour < 12 ? "AM" : "PM"}`;
  return (
    <div className="panel waivers" data-testid="waivers">
      <div className="wv-head">
        <h3>Best available</h3>
        <span className="wv-chip">{faab ? "Blind FAAB" : `${w.type} priority`}</span>
        <span className="wv-chip">Runs {w.runs.join(" & ")} · {hour}</span>
        <span className="wv-next" data-testid="waiver-next">Next run <strong>{runDay} {timeOf(w.next_run)}</strong> <span className="muted">in {until}</span></span>
        {faab && (
          <span className="wv-faab" data-tip="FAAB left this season">
            <span className="wv-meter"><span style={{ width: `${(w.faab_left / w.budget) * 100}%` }} /></span>
            <strong>${w.faab_left}</strong><span className="muted"> / ${w.budget}</span>
          </span>
        )}
      </div>
      {w.claims.length ? (
        <table className="wv-table">
          <thead><tr><th>Player</th>
            {STATS.map(([k, l]) => th(k, l))}
            {th("owned", "Rostered", "The share of all Sleeper leagues that have him on a roster.")}
            {th("started", "Started", "The share of all Sleeper leagues that started him this week.")}
            {th("games", "Games once he lands", `A claim lands at the next run (${runDay} ${timeOf(w.next_run)}): his games from then, the rest of this week and next week.`)}
</tr></thead>
          <tbody>{claims.map((c) => (
            <tr key={c.player_id} className="clickable" onClick={() => onSelect(c.player_id)}>
              <td><div className="wv-player"><Headshot sleeperId={c.sleeper_id} name={c.name} size={44} />
                <div><strong>{c.name}</strong><InjuryTag tag={c.injury_tag} /><div className="small muted"><TeamLink abbr={c.team} /> · <PosList list={c.pos} /></div>
                </div></div></td>
              {STATS.map(([k]) => <td key={k} className="num" data-testid={k === "fp" ? "waiver-stats" : undefined}>{c.season ? (k === "fp" ? c.season.fp.toFixed(2) : c.season[k]) : <span className="muted">-</span>}</td>)}
              <td className="num"><strong>{c.owned != null ? `${c.owned.toFixed(1)}%` : "-"}</strong></td>
              <td className="num">{c.started != null ? `${c.started.toFixed(1)}%` : "-"}</td>
              <td className="num"><strong>{c.games_left}</strong> <span className="muted">this wk</span> · <strong>{c.games_next}</strong> <span className="muted">next</span></td></tr>))}</tbody>
        </table>
      ) : <div className="muted">No free agents found.</div>}
    </div>
  );
}
