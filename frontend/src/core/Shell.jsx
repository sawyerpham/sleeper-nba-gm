import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import DataPage from "./DataPage.jsx";
import LeaguePage from "./LeaguePage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import NotifyPage from "./NotifyPage.jsx";
import Icon from "./Icon.jsx";


export const UIS = [["", "New"], ["apple", "Apple"], ["command", "Command Center"], ["broadcast", "Broadcast"]];
const THEMES = [["courtside", "Courtside: broadcast scoreboard"], ["office", "Front Office: analyst terminal"], ["locker", "Locker Room: light"], ["apple", "Apple: light and dark"]];
const WALLPAPERS = [
  ["", "No wallpaper"],
  ["kawhi-dagger", "Kawhi dagger"],
  ["wemby-block", "Wemby block"],
  ["lin-calderon", "Lin over Calderón"],
  ["haliburton-msg", "Haliburton at MSG"],
  ["curry-okc", "Curry from deep"],
  ["lebron-block", "LeBron chase-down block"],
  ["lebron-chalk", "LeBron chalk toss"],
];
export const TABS = [["season", "Season"], ["standings", "League"], ["news", "News"], ["waivers", "Waivers"], ["draft", "Draft"]];
export const SEASON_VIEWS = { season: "week", news: "news", standings: "league", waivers: "waivers" };

const UI = (() => { try { return localStorage.getItem("da.ui") || ""; } catch { return ""; } })();
const setUi = (v) => { try { localStorage.setItem("da.ui", v); if (v === "apple") localStorage.setItem("da.theme", "apple");
    sessionStorage.setItem("da.settings", "1"); } catch { } location.reload(); };
const reopenSettings = () => { try { const v = sessionStorage.getItem("da.settings"); sessionStorage.removeItem("da.settings"); return !!v; } catch { return false; } };

export function useAppState() {
  const [tab, setTab] = useState(() => {
    const t = localStorage.getItem("da.tab");
    return !t || ["settings", "data", "league"].includes(t) ? "home" : t;
  });
  const [settingsOpen, setSettingsOpen] = useState(reopenSettings);
  const goTab = (t) => (t === "settings" ? setSettingsOpen(true) : setTab(t));
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const k = (e) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [settingsOpen]);
  const [leagueId, setLeagueIdState] = useState(() => localStorage.getItem("da.league") || "");
  const [wall, setWall] = useState(() => { const w = localStorage.getItem("da.wall") || ""; return WALLPAPERS.some(([id]) => id === w) ? w : ""; });
  const [theme, setTheme] = useState(() => THEMES.some(([id]) => id === localStorage.getItem("da.theme")) ? localStorage.getItem("da.theme") : THEMES[0][0]);
  const [health, setHealth] = useState(null);

  const setLeagueId = useCallback((id) => {
    setLeagueIdState(id || "");
    if (id) localStorage.setItem("da.league", id);
    else localStorage.removeItem("da.league");
  }, []);

  useEffect(() => { localStorage.setItem("da.tab", tab); }, [tab]);

  const [leagueName, setLeagueName] = useState("");
  useEffect(() => {
    if (!leagueId) return setLeagueName("");
    api.get("/leagues").then((ls) => setLeagueName(ls.find((l) => l.league_id === leagueId)?.name || "")).catch(() => {});
  }, [leagueId, tab]);

  useEffect(() => {
    document.documentElement.style.setProperty("--wall", wall ? `url(/wallpapers/${wall}.png)` : "none");
    document.documentElement.dataset.wall = wall;
    localStorage.setItem("da.wall", wall);
  }, [wall]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("da.theme", theme);
  }, [theme]);

  const [accent, setAccent] = useState(() => localStorage.getItem("da.accent") || "");
  useEffect(() => {
    const s = document.documentElement.style;
    if (theme === "courtside" && accent) { s.setProperty("--primary", accent); s.setProperty("--info-t", `color-mix(in srgb, ${accent} 45%, white)`); }
    else { s.removeProperty("--primary"); s.removeProperty("--info-t"); }
    localStorage.setItem("da.accent", accent);
  }, [theme, accent]);

  const refreshHealth = useCallback(() => {
    api.get("/health").then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 15000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  return { tab, setTab, goTab, settingsOpen, setSettingsOpen, leagueId, setLeagueId, leagueName, wall, setWall, theme, setTheme, accent, setAccent, health, refreshHealth };
}

function AccentPick({ app }) {
  const [draft, setDraft] = useState(app.accent || "#f97316");
  return (
    <div className="inline" style={{ marginTop: 8, width: "100%" }}>
      <input type="color" value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="accent" /> Main colour
      {app.accent && <button className="small ghost" onClick={() => { app.setAccent(""); setDraft("#f97316"); }}>reset</button>}
      <button className="small primary" style={{ marginLeft: "auto" }} onClick={() => app.setAccent(draft)} disabled={draft === (app.accent || "#f97316")}>Save</button>
    </div>
  );
}

export function SettingsModal({ app }) {
  if (!app.settingsOpen) return null;
  const close = () => app.setSettingsOpen(false);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="settings-modal">
      <div className="modal settings-modal">
        <button className="small settings-close" onClick={close} aria-label="Close settings" data-testid="settings-close"><Icon name="x" /></button>
      <div className="panel section-card" data-testid="section-appearance"><h2>Appearance</h2>
      <div className="panel wall-pick"><h3>UI</h3>
        <select value={UI} onChange={(e) => setUi(e.target.value)} data-testid="ui">
          {UIS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="panel wall-pick"><h3>Theme</h3>
        <select value={app.theme} onChange={(e) => app.setTheme(e.target.value)} data-testid="theme">
          {THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {app.theme === "courtside" && <AccentPick app={app} />}
      </div>
      <div className="panel wall-pick"><h3>Wallpaper</h3>
        <select value={app.wall} onChange={(e) => app.setWall(e.target.value)} data-testid="wallpaper">
          {WALLPAPERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      </div>
      <div className="panel section-card" data-testid="section-notify"><h2>Notifications</h2>
        <NotifyPage />
      </div>
      <div className="panel section-card" data-testid="section-league"><h2>League</h2>
        <LeaguePage leagueId={app.leagueId} setLeagueId={app.setLeagueId} />
        {app.leagueId && <SettingsPage leagueId={app.leagueId} />}
        <DataPage onPoolChanged={app.refreshHealth} />
      </div>
      </div>
    </div>
  );
}
