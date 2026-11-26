import React, { useEffect, useState } from "react";
import { api, qs } from "../api.js";
import HomePage from "../core/HomePage.jsx";
import AdminPage from "../core/AdminPage.jsx";
import DraftPage from "../draft/DraftPage.jsx";
import Headshot from "../core/Headshot.jsx";
import Icon from "../core/Icon.jsx";
import { TipLayer } from "../core/Terms.jsx";
import useBackdrop from "../core/useBackdrop.js";
import useSwipe from "../core/useSwipe.js";
import TeamLink, { TeamLinkContext } from "../core/TeamLink.jsx";
import { SEASON_VIEWS, SettingsModal, useAppState } from "../core/Shell.jsx";
import { useNBAMatches, findMatch, watchUrl } from "../lockin/streams.jsx";
import useSeason from "../lockin/useSeason.js";
import { CardNav, CurrentCard, SeasonTools, WeekNav, callsOf, nextCheckIn, nowOf, slate } from "../lockin/seasonBits.jsx";
import { LeagueView, NewsView, TeamName, flashEl, WaiversView, WeekView, dayName, fp, lockEdge, lockableOf, pct, quarters, teamLogo, untilText } from "../lockin/SeasonPage.jsx";
import { fmt, timeOf } from "../lockin/tz.js";


const SIDE = [["season", "calendar", "Today", "#007aff"], ["standings", "trophy", "League", "#ff9500"], ["news", "news", "News", "#ff3b30"], ["waivers", "user-plus", "Waivers", "#34c759"], ["draft", "gavel", "Draft", "#af52de"]];
const TITLES = { week: "Today", league: "League", news: "News", waivers: "Waivers" };
const CALL_ICON = { swap: "swap", gtd: "alert", out: "alert", lock: "lock", alert: "alert" };

export default function App({ user }) {
  const app = useAppState();
  const { tab, setTab, leagueId, health } = app;
  const side = user.admin ? [...SIDE, ["admin", "shield", "Admin", "#5856d6"]] : SIDE;
  return (
    <div className="ap">
      <aside className="ap-side">
        <button className="ap-brand" onClick={() => setTab("home")} data-testid="home">
          <span className="ap-brand-icon"><Icon name="ball" /></span>
          <span className="ap-brand-text"><strong>NBA Fantasy</strong><small>{app.leagueName || "Choose a league"}</small></span>
        </button>
        <nav className="ap-nav">
          {side.map(([id, icon, label, c]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} data-testid={`tab-${id}`} style={{ "--c": c }}>
              <span className="ap-tile"><Icon name={icon} /></span>{label}
            </button>
          ))}
        </nav>
        <span className="ap-gap" />
        {health && !health.ok && <span className="ap-health" data-testid="health"><Icon name="alert" /> API unreachable</span>}
        <nav className="ap-nav">
          <button className={app.settingsOpen ? "active" : ""} onClick={() => app.setSettingsOpen(true)} data-testid="tab-settings" style={{ "--c": "#8e8e93" }}>
            <span className="ap-tile"><Icon name="settings" /></span>Settings
          </button>
        </nav>
      </aside>
      <main className="ap-main">
        {tab === "home" && <HomePage leagueId={leagueId} setLeagueId={app.setLeagueId} setTab={app.goTab} />}
        {tab === "draft" && <DraftPage leagueId={leagueId} leagueName={app.leagueName} />}
        {tab === "admin" && user.admin && <AdminPage onPoolChanged={app.refreshHealth} />}
        {SEASON_VIEWS[tab] && <AppleSeason leagueId={leagueId} leagueName={app.leagueName} view={SEASON_VIEWS[tab]} onWeek={() => setTab("season")} />}
      </main>
      <SettingsModal app={app} user={user} />
      <TipLayer />
    </div>
  );
}

function AppleSeason({ leagueId, leagueName, view, onWeek }) {
  const s = useSeason(leagueId, onWeek);
  const [focusRid, setFocusRid] = useState(null);
  const [pill, setPill] = useState(null);
  useEffect(() => {
    if (!s.cur) return undefined;
    const k = (e) => e.key === "Escape" && s.close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const [other, setOther] = useState(null);
  const backdrop = useBackdrop(s.close);
  const week = s.data?.week, myRid = s.plan?.roster_id;
  useEffect(() => {
    setOther(null);
    if (focusRid == null || focusRid === myRid || week == null) return;
    api.get(`/leagues/${leagueId}/season/plan` + qs({ week, roster_id: focusRid })).then(setOther).catch(() => setOther(null));
  }, [focusRid, myRid, week, leagueId, s.data?.now]);
  if (!leagueId) return <div className="panel muted" data-testid="no-league">No Sleeper league selected! Pick one in Settings.</div>;
  if (s.error && !s.data) return <div className="panel error">{s.error}</div>;
  if (!s.data || !s.plan) return <div className="panel">Loading the week from Sleeper…</div>;
  const { data, plan } = s;
  const away = focusRid != null && focusRid !== plan.roster_id;
  const shown = away ? other : plan;
  return (
    <TeamLinkContext.Provider value={s.openTeam}>
      <div className={`ap-page ap-view-${view}`}>
        <div className="ap-top">
          <h1 className="ap-title">{TITLES[view]}<span>{leagueName}</span></h1>
          {(view === "week" || view === "league") && <WeekNav s={s} />}
          {view === "week" && <ManagerPill data={data} rid={away ? focusRid : plan.roster_id} onPick={(rid) => { setFocusRid(rid); setPill({ rid }); }} onSwipe={(d) => setPill({ step: d })} />}
          {s.error && <span className="small warn-text">{s.error}</span>}
          <SeasonTools s={s} leagueId={leagueId} />
        </div>
        {view === "week" && (
          <div className="ap-week">
            <section className="ap-center">
              <Widgets data={data} plan={plan} shown={shown} open={s.open} />
              <div className="ap-pair">
                <Slate data={data} s={s} rid={away ? focusRid : plan.roster_id} />
                <Calls data={data} plan={shown} />
              </div>
              <WeekView key={data.week} data={data} plan={plan} open={s.open} openGame={s.openGame} setLock={s.setLock} leagueId={leagueId} onShow={setFocusRid} focus={s.matchup} pill={pill} />
            </section>
          </div>
        )}
        {view === "news" && <div className="ap-fill"><NewsView leagueId={leagueId} open={s.openPid} refreshKey={s.tick} /></div>}
        {view === "league" && <div className="ap-scroll"><LeagueView data={data} leagueId={leagueId} open={s.open} openPid={s.openPid} openGame={s.openGame} openMatchup={s.openMatchup} Standings={AppleStandings} /></div>}
        {view === "waivers" && <div className="ap-scroll"><WaiversView leagueId={leagueId} onSelect={s.openPid} /></div>}
      </div>
      {s.cur && (
        <div className="ap-sheet-wrap" {...backdrop}>
          <div className="ap-sheet" data-testid="card-sheet">
            <CardNav s={s} />
            <CurrentCard s={s} leagueId={leagueId} />
          </div>
        </div>
      )}
    </TeamLinkContext.Provider>
  );
}

/** The two managers of the shown matchup: tap one to show their side; swipe sideways for the next/previous matchup. */
function ManagerPill({ data, rid, onPick, onSwipe }) {
  const swipe = useSwipe(onSwipe);
  const pair = data.matchups.find((p) => p.some((m) => m.roster_id === rid)) || [];
  const name = (id) => { const t = data.teams.find((x) => x.roster_id === id); return t ? t.user || t.name : "?"; };
  if (pair.length < 2) return null;
  return (
    <span className="ap-who" role="group" aria-label="Show this manager's side" data-testid="manager-pill" {...swipe}>
      {pair.map((m) => <button key={m.roster_id} className={m.roster_id === rid ? "on" : ""} aria-pressed={m.roster_id === rid} onClick={() => onPick(m.roster_id)}>{name(m.roster_id)}</button>)}
    </span>
  );
}

function Widgets({ data, plan, shown, open }) {
  const nowMs = nowOf(data), next = nextCheckIn(shown || plan, nowMs);
  const p = shown || plan, wait = shown === null;
  const lockable = wait ? [] : lockableOf(p);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="ap-widgets" data-testid="status-tiles">
      <div className="ap-widget ap-ring-widget">
        <svg viewBox="0 0 80 80" className="ap-ring" aria-hidden="true">
          <circle cx="40" cy="40" r={R} className="trk" />
          <circle cx="40" cy="40" r={R} className="val" strokeDasharray={`${wait ? 0 : C * p.win_chance} ${C}`} transform="rotate(-90 40 40)" />
        </svg>
        <div><span className="ap-label">Win chance</span><strong className="ap-num">{wait ? "…" : pct(p.win_chance)}</strong></div>
      </div>
      <div className="ap-widget">
        <span className="ap-label">Next check-in</span>
        <strong className="ap-num sm">{next ? fmt(next, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "None"}</strong>
        {next && <span className="ap-foot">in {untilText(Math.ceil((next - nowMs) / 60000))}</span>}
      </div>
      <div className="ap-widget ap-lock-widget" data-testid="lockable">
        <span className="ap-label">Lockable games</span>
        {wait ? <span className="ap-foot">loading</span> : !lockable.length ? <span className="ap-foot">No lock is worth making right now.</span> : (
          <div className="ap-locks">
            {lockable.slice(0, 6).map((r) => {
              const e = lockEdge(r), best = r.lock_at?.[0];
              return (
                <button key={r.sid} className="ap-lock" onClick={() => open(r.sid)}>
                  <Headshot sleeperId={r.sid} name={r.name} size={30} />
                  <span className="ap-lock-main"><strong>{r.name}</strong>
                    <span>{fp(r.x)} FP · {best ? `Lock ${best.slot}` : "Lock"}{r.win_lock != null && ` · ${pct(r.win_lock)} vs ${pct(r.win_wait)}`}</span></span>
                  {r.win_lock != null && <span className={`hub-edge ${Math.abs(e) < 0.015 ? "even" : e > 0 ? "up" : "down"}`} data-tip="Win probability added: win % locked minus win % open">{`${e >= 0 ? "+" : "−"}${Math.abs(e * 100).toFixed(1)}%`}</span>}
                </button>
              );
            })}
          </div>
        )}
        {lockable.length > 6 && <span className="ap-foot">+{lockable.length - 6} more</span>}
      </div>
    </div>
  );
}

const MASCOT = String.raw`    /\_/\
   ( -.- )  z
    > ^ <  Z
   .-'''-.
 .'   |   '.
/ (   |   ) \
(-----+-----)
\ (   |   ) /
 '.   |   .'
   '-...-'`;

/** The Do now list: each call's title and one short line; a call with a longer explanation opens it on click. */
function Calls({ data, plan }) {
  const calls = plan ? callsOf(data, plan) : [];
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; });
  return (
    <section className="panel ap-group" data-testid="calls">
      <h3>Do now</h3>
      {!plan && <div className="ap-row ap-empty">Loading…</div>}
      {plan && !calls.length && <div className="ap-row ap-empty ap-mascot-row"><pre className="ap-mascot" role="img" aria-label="Nothing to do right now">{MASCOT}</pre></div>}
      {calls.map((c) => {
        const more = c.short && c.text && c.text !== c.short, shown = open.has(c.key);
        return (
          <div key={c.key} className={`ap-row ap-call ${c.tone} ${more ? "clickable" : ""}`} data-testid="watch-line"
            {...(more && { role: "button", tabIndex: 0, "aria-expanded": shown, onClick: () => toggle(c.key), onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(c.key); } } })}>
            <span className="ap-call-icon"><Icon name={CALL_ICON[c.kind] || "alert"} /></span>
            <span className="ap-call-body"><strong>{c.title}{more && <Icon name="chevron-down" className={`ap-call-more ${shown ? "open" : ""}`} />}</strong>
              {(shown ? c.text : c.short || c.text) && <span className="small muted">{shown ? c.text : c.short || c.text}</span>}</span>
            <span className="ap-call-when">{!c.when || c.when === "now" ? "Now" : timeOf(c.when)}</span>
          </div>
        );
      })}
    </section>
  );
}

function flashCard(sid) {
  const el = document.querySelector(`[data-testid="mu-${sid}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  flashEl(el);
}

function AppleStandings({ data, onPick }) {
  const teams = [...data.teams].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
  const cut = data.playoff_teams || 0;
  return (
    <div className="panel ap-st" data-testid="standings">
      <h3>Standings</h3>
      <div className="ap-st-head"><span>#</span><span>Team</span><span>Record</span><span>Points</span><span>Last 5</span><span>FAAB</span></div>
      {teams.map((t, i) => {
        const diff = t.fpts_against != null ? t.fpts - t.fpts_against : null;
        return (
          <React.Fragment key={t.roster_id}>
            <div className={`ap-st-row ${t.is_user ? "me" : ""} ${cut && i < cut ? "in" : ""} clickable`} onClick={() => onPick(t.roster_id)}>
              <b className="ap-st-rank">{i + 1}</b>
              <TeamName t={t} size={32} record={false} mine={t.is_user} />
              <span className="ap-st-rec"><strong>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ""}</strong></span>
              <span className="ap-st-pts"><strong>{fp(t.fpts)}</strong>
                {diff != null && <span className="small muted">PA {fp(t.fpts_against)}<b className={diff >= 0 ? "good-text" : "warn-text"}> {diff >= 0 ? "+" : "−"}{fp(Math.abs(diff))}</b></span>}</span>
              <span className="ap-st-form" title={t.results ? `Last ${Math.min(5, t.results.length)}: ${t.results.slice(-5).split("").join(" ")}` : ""}>
                {Array.from({ length: 5 }, (_, k) => { const r = t.results?.slice(-5).padStart(5, " ")[k]; return <i key={k} className={r === "W" ? "w" : r === "L" ? "l" : r === "T" ? "t" : ""} />; })}</span>
              <span className="ap-st-faab">{data.waiver ? `$${(data.faab_budget ?? 100) - (t.faab_used || 0)}` : "?"}</span>
            </div>
            {cut > 0 && i === cut - 1 && i < teams.length - 1 && <div className="ap-st-cut"><span>Playoff line</span></div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Slate({ data, s, rid }) {
  const { list: matches } = useNBAMatches();
  const { date, list } = slate(data, rid);
  return (
    <section className="panel ap-group" data-testid="slate">
      <h3>{date === data.today ? "League Tonight" : dayName(date)} <span className="small muted">{list.length} games</span></h3>
      <div className="ap-games">
      {list.map((g) => (
        <div key={g.event} role="button" tabIndex={0} className={`ap-row ap-game ${g.state}`} onClick={() => s.openGame(g.sel)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) s.openGame(g.sel); }}>
          <span className="ap-teams">
            {[[g.away, g.awayScore, g.homeScore, g.awayRecord], [g.home, g.homeScore, g.awayScore, g.homeRecord]].map(([t, sc, opp, rec]) => (
              <span key={t} className={`ap-team${g.state === "post" && sc < opp ? " lost" : ""}`}><TeamLink abbr={t}><img src={teamLogo(t)} alt="" width={26} height={26} /></TeamLink><strong>{t}</strong>{rec && <small className="ap-rec">{rec}</small>}{g.state !== "pre" && <b>{sc ?? ""}</b>}{g.state === "post" && <i className="ap-win" aria-hidden="true">{sc > opp ? "◂" : ""}</i>}</span>
            ))}
            {g.state === "pre" && <b className="ap-vs">-</b>}
          </span>
          <span className="ap-mine" style={{ "--ov": `${Math.min(-4, -(((g.mineSids || []).length * 39 - 135) / Math.max(1, (g.mineSids || []).length - 1)))}px` }}>{(g.mineSids || []).map((sid) => (
            <span key={sid} role="button" title={data.players[sid]?.name} onClick={(e) => { e.stopPropagation(); flashCard(sid); }}><Headshot sleeperId={sid} name={data.players[sid]?.name || ""} size={39} /></span>
          ))}</span>
          <span className="ap-meta">
            <span className="ap-game-status">{g.state === "in" ? <><i className="live-dot" />{quarters(g.detail)}</> : g.state === "post" ? "Final" : timeOf(g.tip)}</span>
            {g.state !== "post" && <a className="gp-watch" href={watchUrl(findMatch(matches, g.sel.game, g.sel.team))} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>▶ Watch</a>}
          </span>
        </div>
      ))}
      </div>
      {!list.length && <div className="ap-row ap-empty small muted">No games left this week.</div>}
    </section>
  );
}
