import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import LeaguePage from "./LeaguePage.jsx";
import SettingsPage from "./SettingsPage.jsx";
import NotifyPage from "./NotifyPage.jsx";
import Icon from "./Icon.jsx";
import { signOut } from "./Auth.jsx";
import useBackdrop from "./useBackdrop.js";


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
  // The chosen league is per browser (localStorage), the leagues are per account: on a new device (or after
  // switching accounts) pick one of the account's own leagues, a Sleeper one first, instead of the import form.
  useEffect(() => {
    api.get("/leagues").then((ls) => {
      const cur = ls.find((l) => l.league_id === leagueId);
      if (!cur && ls.length) {
        setLeagueId((ls.find((l) => l.league_id.startsWith("sleeper-")) || ls[0]).league_id);
        if (tab === "home") setTab("standings");
        return;
      }
      if (!cur && leagueId) setLeagueId("");
      setLeagueName(cur?.name || "");
    }).catch(() => {});
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

/** Ask for the account's email again, then delete the account and everything kept for it, and go back to sign-in. */
async function deleteAccount() {
  const typed = window.prompt("This deletes your account, your leagues and their saved data for good. Type your email to confirm:");
  if (!typed) return;
  try {
    await api.post("/auth/delete", { email: typed });
    try { localStorage.removeItem("da.league"); } catch { /* storage blocked */ }
    window.location.reload();
  } catch (e) {
    window.alert(e.message);
  }
}

export function SettingsModal({ app, user }) {
  const close = () => app.setSettingsOpen(false);
  const backdrop = useBackdrop(close);
  if (!app.settingsOpen) return null;
  return (
    <div className="modal-backdrop" {...backdrop} data-testid="settings-modal">
      <div className="modal settings-modal">
        <button className="small settings-close" onClick={close} aria-label="Close settings" data-testid="settings-close"><Icon name="x" /></button>
      <div className="panel section-card" data-testid="section-account"><h2>Account</h2>
        <p className="settings-account">Signed in as <strong>{user.email}</strong>
          <button className="small" onClick={signOut} data-testid="sign-out"><Icon name="log-out" /> Sign out</button></p>
        {user.kind !== "owner" && <p className="settings-account small muted">Deleting your account removes your leagues, lock answers and sign-in history for good.
          <button className="small danger" onClick={deleteAccount} data-testid="delete-account">Delete account</button></p>}
      </div>
      <div className="panel section-card" data-testid="section-appearance"><h2>Appearance</h2>
      <div className="panel wall-pick"><h3>Wallpaper</h3>
        <select value={app.wall} onChange={(e) => app.setWall(e.target.value)} data-testid="wallpaper">
          {WALLPAPERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      </div>
      {user.telegram && <div className="panel section-card" data-testid="section-notify"><h2>Notifications</h2>
        <NotifyPage />
      </div>}
      <div className="panel section-card" data-testid="section-league"><h2>League</h2>
        <LeaguePage leagueId={app.leagueId} setLeagueId={app.setLeagueId} />
        {app.leagueId && <SettingsPage leagueId={app.leagueId} />}
      </div>
      </div>
    </div>
  );
}
