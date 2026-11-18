import React, { useEffect, useState } from "react";
import { api, qs } from "../api.js";
import HomePage from "../core/HomePage.jsx";
import DraftPage from "../draft/DraftPage.jsx";
import Headshot from "../core/Headshot.jsx";
import Icon from "../core/Icon.jsx";
import { TipLayer } from "../core/Terms.jsx";
import { TeamLinkContext } from "../core/TeamLink.jsx";
import { SEASON_VIEWS, SettingsModal, useAppState } from "../core/Shell.jsx";
import useSeason from "../lockin/useSeason.js";
import { CardNav, CurrentCard, SeasonTools, WeekNav, callsOf, nextCheckIn, nowOf, slate } from "../lockin/seasonBits.jsx";
import { LeagueView, NewsView, WaiversView, WeekView, dayName, fp, lockEdge, lockableOf, pct, quarters, teamLogo, untilText } from "../lockin/SeasonPage.jsx";
import { fmt, timeOf } from "../lockin/tz.js";

// Apple (Settings > UI): built for the Apple theme (themes.css). A floating frosted sidebar of Settings-style rows, a large-title
// toolbar, widget tiles with an activity ring, inset grouped lists for calls and games, and player / team / game cards as a sheet.

const SIDE = [["season", "calendar", "Today", "#007aff"], ["standings", "trophy", "League", "#ff9500"], ["news", "news", "News", "#ff3b30"], ["waivers", "user-plus", "Waivers", "#34c759"], ["draft", "gavel", "Draft", "#af52de"]];
const TITLES = { week: "Today", league: "League", news: "News", waivers: "Waivers" };
const CALL_ICON = { swap: "swap", gtd: "alert", out: "alert", lock: "lock", alert: "alert" };

/** Root of the Apple UI: the sidebar and the open page. */
export default function App() {
  const app = useAppState();
  const { tab, setTab, leagueId, health } = app;
  return (
    <div className="ap">
      <aside className="ap-side">
        <button className="ap-brand" onClick={() => setTab("home")} data-testid="home">
          <span className="ap-brand-icon"><Icon name="ball" /></span>
          <span className="ap-brand-text"><strong>NBA Fantasy</strong><small>{app.leagueName || "Choose a league"}</small></span>
        </button>
        <nav className="ap-nav">
          {SIDE.map(([id, icon, label, c]) => (
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
        {tab === "home" && <HomePage setLeagueId={app.setLeagueId} setTab={app.goTab} />}
        {tab === "draft" && <DraftPage leagueId={leagueId} />}
        {SEASON_VIEWS[tab] && <AppleSeason leagueId={leagueId} leagueName={app.leagueName} view={SEASON_VIEWS[tab]} onWeek={() => setTab("season")} />}
      </main>
      <SettingsModal app={app} />
      <TipLayer />
    </div>
  );
}

/** The Season side: a large title with the toolbar (week, search, sync), then the view; cards open in a sheet. */
function AppleSeason({ leagueId, leagueName, view, onWeek }) {
  const s = useSeason(leagueId, onWeek);
  const [focusRid, setFocusRid] = useState(null);   // the matchup on the lineup grid: the win chance and projection widgets follow it
  useEffect(() => {
    if (!s.cur) return undefined;
    /** Escape closes the sheet. */
    const k = (e) => e.key === "Escape" && s.close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const [other, setOther] = useState(null);
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
  const shown = away ? other : plan;   // null while another team's plan loads
  const t = data.teams.find((x) => x.roster_id === (away ? focusRid : plan.roster_id));
  const whoName = t ? t.user || t.name : "";
  return (
    <TeamLinkContext.Provider value={s.openTeam}>
      <div className={`ap-page ap-view-${view}`}>
        <div className="ap-top">
          <h1 className="ap-title">{TITLES[view]}<span>{leagueName}</span></h1>
          {(view === "week" || view === "league") && <WeekNav s={s} />}
          {s.error && <span className="small warn-text">{s.error}</span>}
          <SeasonTools s={s} leagueId={leagueId} />
        </div>
        {view === "week" && (
          <div className="ap-week">
            <section className="ap-center">
              <Widgets data={data} plan={plan} shown={shown} who={whoName} open={s.open} />
              <div className="ap-pair">
                <Slate data={data} s={s} />
                <Calls data={data} plan={plan} s={s} />
              </div>
              <WeekView key={data.week} data={data} plan={plan} open={s.open} openGame={s.openGame} setLock={s.setLock} leagueId={leagueId} onShow={setFocusRid} focus={s.matchup} />
            </section>
          </div>
        )}
        {view === "news" && <div className="ap-fill"><NewsView leagueId={leagueId} open={s.openPid} refreshKey={s.tick} /></div>}
        {view === "league" && <div className="ap-scroll"><LeagueView data={data} leagueId={leagueId} open={s.open} openPid={s.openPid} openGame={s.openGame} /></div>}
        {view === "waivers" && <div className="ap-scroll"><WaiversView leagueId={leagueId} onSelect={s.openPid} /></div>}
      </div>
      {s.cur && (
        <div className="ap-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && s.close()}>
          <div className="ap-sheet" data-testid="card-sheet">
            <CardNav s={s} />
            <CurrentCard s={s} leagueId={leagueId} />
          </div>
        </div>
      )}
    </TeamLinkContext.Provider>
  );
}

/** Three widgets: win chance as an activity ring, the next check-in, and the lockable games with the win chance a lock adds. */
function Widgets({ data, plan, shown, who, open }) {
  const nowMs = nowOf(data), next = nextCheckIn(plan, nowMs);
  const p = shown || plan, wait = shown === null;   // win chance and lockable games follow the matchup on the lineup grid
  const lockable = wait ? [] : lockableOf(p);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="ap-widgets" data-testid="status-tiles">
      <div className="ap-widget ap-ring-widget">
        <svg viewBox="0 0 80 80" className="ap-ring" aria-hidden="true">
          <circle cx="40" cy="40" r={R} className="trk" />
          <circle cx="40" cy="40" r={R} className="val" strokeDasharray={`${wait ? 0 : C * p.win_chance} ${C}`} transform="rotate(-90 40 40)" />
        </svg>
        <div><span className="ap-label">Win chance · {who}</span><strong className="ap-num">{wait ? "…" : pct(p.win_chance)}</strong></div>
      </div>
      <div className="ap-widget">
        <span className="ap-label">Next check-in</span>
        <strong className="ap-num sm">{next ? fmt(next, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "None"}</strong>
        <span className="ap-foot">{next ? `in ${untilText(Math.ceil((next - nowMs) / 60000))}` : "no lineup changes left this week"}</span>
      </div>
      <div className="ap-widget ap-lock-widget" data-testid="lockable">
        <span className="ap-label">Lockable games · {who}{!wait && lockable.length > 0 && ` · ${lockable.length}`}</span>
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

/** "Do now": every call (callsOf) as a row of an inset grouped list. */
function Calls({ data, plan, s }) {
  const calls = callsOf(data, plan);
  return (
    <section className="panel ap-group" data-testid="calls">
      <h3>Do now</h3>
      {!calls.length && <div className="ap-row ap-empty"><Icon name="check" /> Nothing to do. Your lineup is set until the next check-in.</div>}
      {calls.map((c) => (
        <div key={c.key} className={`ap-row ap-call ${c.tone}`} data-testid="watch-line">
          <span className="ap-call-icon"><Icon name={CALL_ICON[c.kind] || "alert"} /></span>
          <span className="ap-call-body"><strong>{c.title}</strong>{c.text && <span className="small muted">{c.text}</span>}</span>
          <span className="ap-call-when">{!c.when || c.when === "now" ? "Now" : timeOf(c.when)}</span>
          <span className="ap-call-who">{[c.sid, c.sid2].filter(Boolean).map((sid) => (
            <button key={sid} onClick={() => s.open(sid)} title={data.players[sid]?.name}><Headshot sleeperId={sid} name={data.players[sid]?.name || ""} size={30} /></button>
          ))}</span>
        </div>
      ))}
    </section>
  );
}

/** Today's NBA games that involve the league's players; a row opens the game card. */
function Slate({ data, s }) {
  const { date, list } = slate(data);
  return (
    <section className="panel ap-group" data-testid="slate">
      <h3>{date === data.today ? "Tonight" : dayName(date)} <span className="small muted">{list.length} games</span></h3>
      <div className="ap-games">
      {list.map((g) => (
        <button key={g.event} className={`ap-row ap-game ${g.state}`} onClick={() => s.openGame(g.sel)}>
          <span className="ap-team"><img src={teamLogo(g.away)} alt="" width={28} height={28} /><strong>{g.away}</strong><b>{g.awayScore ?? ""}</b></span>
          <span className="ap-at">@</span>
          <span className="ap-team"><img src={teamLogo(g.home)} alt="" width={28} height={28} /><strong>{g.home}</strong><b>{g.homeScore ?? ""}</b></span>
          <span className="ap-game-status">{g.state === "in" ? <><i className="live-dot" />{quarters(g.detail)}</> : g.state === "post" ? "Final" : timeOf(g.tip)}</span>
          <span className="ap-slot">{g.mine > 0 && <span className="ap-pill">{g.mine} yours</span>}</span>
        </button>
      ))}
      </div>
      {!list.length && <div className="ap-row ap-empty small muted">No games left this week.</div>}
    </section>
  );
}
