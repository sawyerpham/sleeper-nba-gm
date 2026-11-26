import React, { useEffect, useState } from "react";
import { api, qs } from "../api.js";
import { PosTag } from "../core/Pos.jsx";
import TeamLink, { TeamTag } from "../core/TeamLink.jsx";
import { fmt, tipInfo } from "./tz.js";
import DragScroll from "../core/DragScroll.jsx";
import InjuryTag from "../core/InjuryTag.jsx";


const f1 = (x) => (x == null ? "—" : Number(x).toFixed(1));
const f2 = (x) => (x == null ? "—" : Number(x).toFixed(2));
const mmdd = (d) => d.slice(5).replace("-", "/");
const longDate = (ms) => fmt(ms, { month: "short", day: "numeric", year: "numeric" }).replace(",", "");
const quarters = (d) => (d || "").replace(/^(.+) - (\d)(?:st|nd|rd|th)$/, "Q$2 $1").replace(/^(.+) - (\d?OT)$/, "$2 $1").replace(/\b(\d)(?:st|nd|rd|th)\b/g, "Q$1");

/** One team of a game header, as the game popup draws it: logo and abbreviation with a big line under it (record or score). */
function TeamSide({ abbr, line, cls, right }) {
  return (
    <div className={`gp-team ${right ? "gp-home" : ""}`}>
      <TeamLink abbr={abbr}><img src={`https://sleepercdn.com/images/team_logos/nba/${abbr.toLowerCase()}.png`} alt="" width={40} height={40} /></TeamLink>
      <div><div className="gp-abbr"><TeamLink abbr={abbr} /></div><div className={cls}>{line}</div></div>
    </div>
  );
}

export function SeasonSummary({ sea, onOpenGame, onOpenMatchup }) {
  const g = sea.last_game, a = sea.averages, live = g?.state === "in";
  const stat = (label, value) => <div className="sp-stat"><span>{label}</span><strong>{value}</strong></div>;
  const openable = g?.event && onOpenGame;
  const next = sea.next_game;
  const nextOpenable = next?.event && onOpenGame;
  const { mins, countdown, when } = tipInfo(next?.tip);
  return (
    <div data-testid="season-summary">
      {g && (
        <div className={`sp-game sp-last ${live ? "live" : ""} ${openable ? "clickable" : ""}`} data-testid="last-game"
          onClick={openable ? () => onOpenGame({ game: g, team: g.team, sid: sea.sleeper_id }) : undefined}
          data-tip={openable ? "Open the game" : undefined}>
          <div className="gp-score">
            {(g.home ? [[g.opp, g.opp_pts], [g.team, g.team_pts]] : [[g.team, g.team_pts], [g.opp, g.opp_pts]]).map(([abbr, pts], i) => (
              <React.Fragment key={abbr}>
                {i === 1 && (
                  <div className="gp-status">
                    <span className={live ? "gp-live" : ""}>{live ? quarters(g.detail) : "Final"}</span>
                    <span className="small muted">{fmt(`${g.date}T12:00:00Z`, { weekday: "short", month: "short", day: "numeric" })}</span>
                  </div>
                )}
                <TeamSide abbr={abbr} line={pts ?? "—"} cls="gp-pts" right={i === 1} />
              </React.Fragment>
            ))}
          </div>
          <div className="sp-last-row">
            <div className="small muted best-line">{[["PTS", g.pts], ["REB", g.reb], ["AST", g.ast], ["STL", g.stl], ["BLK", g.blk], ["TO", g.to]].map(([k, v]) => <span key={k}><strong>{v}</strong> {k}</span>)}
              {g.fga != null && <><span>{g.fgm}/{g.fga} FG</span><span>{g.ftm}/{g.fta} FT</span></>}<span>{g.min} MIN</span></div>
            <div className="sp-fp"><span>{f2(g.fp)}</span><small>FP</small></div>
          </div>
        </div>
      )}
      {next && sea.team && (
        <div className={`sp-game sp-next ${nextOpenable ? "clickable" : ""}`} data-testid="next-game"
          onClick={nextOpenable ? () => onOpenGame({ game: next, team: sea.team, sid: sea.sleeper_id }) : undefined}
          data-tip={nextOpenable ? "Open the game" : undefined}>
          <div className="gp-score">
            {(next.home ? [[next.opp, next.opp_record], [sea.team, next.record]] : [[sea.team, next.record], [next.opp, next.opp_record]]).map(([abbr, rec], i) => (
              <React.Fragment key={abbr}>
                {i === 1 && (
                  <div className="gp-status">
                    {mins > 0 && <span className="small muted">TIPS IN</span>}
                    <span>{next.tip ? countdown : fmt(`${next.date}T12:00:00Z`, { weekday: "short", month: "short", day: "numeric" })}</span>
                    {when && <span className="small muted">{when}</span>}
                  </div>
                )}
                <TeamSide abbr={abbr} line={rec || "—"} cls="gp-record" right={i === 1} />
              </React.Fragment>
            ))}
          </div>
          {next.proj != null && <div className="small muted sp-next-proj">Projected {f1(next.proj)} FP</div>}
        </div>
      )}
      <div className="sec">
      {a ? <div className="sp-grid">{stat("MPG", f1(a.min))}{stat("PTS", f1(a.pts))}{stat("REB", f1(a.reb))}{stat("AST", f1(a.ast))}
        {stat("STL", f1(a.stl))}{stat("BLK", f1(a.blk))}{stat("TO", f1(a.to))}</div> : <div className="small muted">No finished games yet.</div>}
      <div className="sp-grid sp-grid-5">
        {stat("Pos rank", sea.pos_rank || "—")}{stat("Overall", sea.overall_rank ? `#${sea.overall_rank}` : "—")}
        {stat("Owned", sea.owned != null ? `${Math.round(sea.owned)}%` : "—")}{stat("Started", sea.started != null ? `${Math.round(sea.started)}%` : "—")}
        {stat("FP/G", f2(a?.fp))}
      </div>
      </div>
      <div className="sec sp-meta">
        <div className={`sp-grid sp-grid-${sea.owner ? 3 : 2}`}>
          <div className="sp-stat"><span>Owner</span>{sea.owner
            ? <strong className={`${sea.owner.is_user ? "sp-good" : ""} ${onOpenMatchup ? "clickable" : ""}`} data-testid="owner"
              {...(onOpenMatchup && { role: "button", tabIndex: 0, "data-tip": "Show this week's matchup",
                onClick: () => onOpenMatchup(sea.owner.roster_id), onKeyDown: (e) => e.key === "Enter" && onOpenMatchup(sea.owner.roster_id) })}>
              {sea.owner.is_user ? "You" : sea.owner.name}</strong>
            : <strong>Free agent</strong>}</div>
          {sea.owner && <div className="sp-stat"><span>Slot</span><strong><PosTag text={sea.owner.slot} /></strong></div>}
          <div className="sp-stat"><span>Status</span>{sea.retired ? <strong className="warn-text">retired</strong>
            : sea.injury_tag ? <><InjuryTag tag={sea.injury_tag} />{sea.injury_note && <small className="muted">{sea.injury_note.replace(`${sea.injury_tag}: `, "")}</small>}</> : <strong className="sp-good">healthy</strong>}</div>
        </div>
      </div>
      {sea.news.length > 0 && (
        <DragScroll vertical className="sec news-scroll">
          <div className="bid-label sp-head">Latest news</div>
          {sea.news.map((n, i) => (
            <div key={i} className="news-item small">
              <div className="news-top"><strong>{n.headline}</strong><span className="news-date">{n.published ? new Date(n.published).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span></div>
              {n.story && n.story !== n.headline && <div className="muted">{n.story}</div>}
            </div>
          ))}
        </DragScroll>
      )}
    </div>
  );
}

const LOG_COLS = [["FPTS", (r) => f2(r.fp), "fp"], ["MIN", (r) => r.min, "min"], ["PTS", (r) => r.pts, "pts"], ["REB", (r) => r.reb, "reb"],
  ["AST", (r) => r.ast, "ast"], ["STL", (r) => r.stl, "stl"], ["BLK", (r) => r.blk, "blk"], ["TO", (r) => r.to, "to"], ["PF", (r) => r.pf, "pf"],
  ["+/-", (r) => (r.pm > 0 ? `+${r.pm}` : r.pm), "pm"]];
const LESS_IS_BETTER = new Set(["to", "pf"]);
function logTone(k, v, avg) {
  if (v == null) return null;
  let rel = k === "pm" ? v / 10 : (v - avg) / Math.max(avg, 1);
  if (LESS_IS_BETTER.has(k)) rel = -rel;
  return rel >= 0.08 ? "up" : rel > -0.08 ? "even" : "down";
}
const STAGE_NAMES = { PO: "Playoffs", PI: "Play-in" };
/** The game log: this season's schedule (Sleeper) or, picked from the season menu, a past season's games (history.db),
 *  newest first with a blank row between the playoffs, the play-in and the regular season. A played row opens that
 *  game's card; the picked season is kept in the card's history entry (view / onView) so Back returns to it. */
export function SeasonLog({ sea, leagueId, onOpenGame, view, onView }) {
  const seasons = sea.seasons?.length ? sea.seasons : [null];
  const [season, setSeasonState] = useState(seasons.includes(view?.season) ? view.season : seasons[0]);
  const setSeason = (s) => { setSeasonState(s); onView?.({ season: s }); };
  const [past, setPast] = useState(null);
  const current = season === seasons[0];
  useEffect(() => {
    if (current) return;
    api.get(`/leagues/${leagueId}/season/player/${sea.player_id}/log` + qs({ season }))
      .then(setPast).catch((e) => setPast({ season, error: e.message }));
  }, [leagueId, sea.player_id, season, current]);
  const rows = current ? sea.season_log : past?.season === season ? [...past.log].reverse() : null;
  const played = (rows || []).filter((r) => r.fp != null);
  const avg = Object.fromEntries(LOG_COLS.map(([, , k]) => [k, played.reduce((t, r) => t + (r[k] || 0), 0) / (played.length || 1)]));
  const open = (r) => onOpenGame({ game: { date: r.date, team: r.team || sea.team, opp: r.opp, state: !current || r.status === "complete" ? "post" : "in" },
    team: r.team || sea.team, sid: sea.sleeper_id });
  return (
    <>
      {seasons.length > 1 && (
        <select className="log-season" value={season} onChange={(e) => setSeason(e.target.value)} data-testid="log-season" aria-label="Season">
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {!rows ? <div className="small muted loading">{past?.error || "Loading…"}</div> : (
        <table className="sp-log" data-testid="season-log">
          <thead><tr><th>WK</th><th>OPP</th><th>DATE</th>{LOG_COLS.map(([h]) => <th key={h} className="log-cell">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <React.Fragment key={r.date}>
              {i > 0 && (r.stage || null) !== (rows[i - 1].stage || null) && (
                <tr className="log-break"><td colSpan={3 + LOG_COLS.length}><div className="log-break-line">{STAGE_NAMES[rows[i - 1].stage] || "Regular season"}</div></td></tr>
              )}
              <tr className={`${current && r.week === sea.week ? "this-week" : ""} ${r.week % 2 ? "wk-alt" : ""} ${r.fp == null ? "muted" : onOpenGame ? "clickable" : ""}`}
                onClick={r.fp != null && onOpenGame ? () => open(r) : undefined}>
                <td>{r.week}</td><td>{r.home ? "" : "@"}<TeamTag abbr={r.opp} /></td><td>{mmdd(r.date)}</td>
                {LOG_COLS.map(([h, f, k]) => {
                  const tone = r.fp == null ? null : logTone(k, r[k], avg[k]);
                  return <td key={h} className="num log-cell">
                    {r.fp == null ? "" : <span className={`log-box ${tone || ""}`}>{f(r)}</span>}</td>;
                })}
              </tr>
            </React.Fragment>
          ))}</tbody>
        </table>
      )}
    </>
  );
}

const KIND = { drafted: "Drafted", keeper: "Keeper", claimed: "Claimed", "picked up": "Added", "traded to": "Trade", dropped: "Dropped", added: "Added" };
export function SeasonHistory({ sea }) {
  const what = (a) => {
    const by = a.team || "?", price = a.price != null ? ` for $${a.price}` : "";
    return a.kind === "keeper" ? `kept by ${by}${price}` : a.kind === "drafted" ? `drafted by ${by}${price}${a.season ? ` (${a.season})` : ""}`
      : a.kind === "claimed" ? `claimed by ${by}${price}` : a.kind === "traded to" ? `traded to ${by}` : a.kind === "dropped" ? `dropped by ${by}` : `added by ${by}`;
  };
  if (!sea.acquired?.length) return <div className="small muted sec">No transactions this season: he hasn't been drafted, kept or moved.</div>;
  return (
    <div className="sec"><table className="sp-history" data-testid="season-history">
      <tbody>{[...sea.acquired].reverse().map((a, i) => (
        <tr key={i}><td><strong>{KIND[a.kind] || a.kind}</strong></td><td>{what(a)}</td><td className="muted">{a.when ? longDate(a.when) : ""}</td></tr>
      ))}</tbody>
    </table></div>
  );
}
