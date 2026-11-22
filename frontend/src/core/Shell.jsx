import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import DataPage from "./DataPage.jsx";
import LeaguePage from "./LeaguePage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import NotifyPage from "./NotifyPage.jsx";
import Icon from "./Icon.jsx";


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
export const SEASON_VIEWS = { season: "week", news: "news", standings: "league", waivers: "waivers" };

export function useAppState() {
  const [tab, setTab] = useState(() => {
    const t = localStorage.getItem("da.tab");
    const connected = !!localStorage.getItem("da.league");
    if (!t || t === "home") return connected ? "standings" : "home";
    return ["settings", "data", "league"].includes(t) ? "home" : t;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const goTab = (t) => (t === "settings" ? setSettingsOpen(true) : setTab(t));
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const k = (e) => e.key === "Escape" && setSettingsOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [settingsOpen]);
  const [leagueId, setLeagueIdState] = useState(() => localStorage.getItem("da.league") || "");
  const [wall, setWall] = useState(() => { const w = localStorage.getItem("da.wall") || ""; return WALLPAPERS.some(([id]) => id === w) ? w : ""; });
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

  useEffect(() => { document.documentElement.dataset.theme = "apple"; }, []);

  const refreshHealth = useCallback(() => {
    api.get("/health").then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 15000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  return { tab, setTab, goTab, settingsOpen, setSettingsOpen, leagueId, setLeagueId, leagueName, wall, setWall, health, refreshHealth };
}

export function SettingsModal({ app }) {
  if (!app.settingsOpen) return null;
  const close = () => app.setSettingsOpen(false);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="settings-modal">
      <div className="modal settings-modal">
        <button className="small settings-close" onClick={close} aria-label="Close settings" data-testid="settings-close"><Icon name="x" /></button>
      <div className="panel section-card" data-testid="section-appearance"><h2>Appearance</h2>
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
