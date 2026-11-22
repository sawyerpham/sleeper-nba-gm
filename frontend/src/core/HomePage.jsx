import React, { useState } from "react";
import { api } from "../api.js";
import TeamMap from "./TeamMap.jsx";

const APPLY = ["name", "scoring", "roster_slots", "num_managers", "keepers"];
const sleeperId = (text) => (String(text).match(/\d{12,}/) || [])[0] || null;

/** Home: the team map; plus, until a league is connected, a Sleeper username + league import form. */
export default function HomePage({ leagueId, setLeagueId, setTab }) {
  const [username, setUsername] = useState("");
  const [league, setLeague] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    const sid = sleeperId(league);
    if (!sid) return setError("Paste your Sleeper league ID or its link (the long number in sleeper.com/leagues/…).");
    setBusy(true); setError("");
    const id = `sleeper-${sid}`;
    try {
      let fresh = true;
      try {
        await api.post("/leagues", { league_id: id, name: `Sleeper ${sid}` });
      } catch (e) {
        if (!/already exists/.test(e.message)) throw e;
        fresh = false;
      }
      await api.post(`/leagues/${id}/sleeper/apply`, { sleeper_league_id: sid, apply: fresh ? APPLY : APPLY.filter((f) => f !== "num_managers") });
      try { await api.post(`/leagues/${id}/sleeper/sync`); } catch { /* managers load on the next sync */ }
      const me = (await api.get(`/leagues/${id}/managers`)).find((m) => m.name.toLowerCase() === username.trim().toLowerCase());
      if (!me) return setError(`No manager named "${username.trim()}" in that league. Use your Sleeper display name.`);
      if (!me.is_user) await api.patch(`/leagues/${id}/managers/${me.manager_id}`, { is_user: true });
      setLeagueId(id);
      setTab("standings");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const go = (e) => e.key === "Enter" && !busy && username.trim() && league.trim() && connect();
  return (
    <div className="home" data-testid="home-page">
      {!leagueId && (
        <div className="home-import" data-testid="home-import-form">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={go}
            placeholder="Sleeper username" aria-label="Sleeper username" data-testid="home-username" />
          <input type="text" value={league} onChange={(e) => setLeague(e.target.value)} onKeyDown={go}
            placeholder="Sleeper league ID or link" aria-label="Sleeper league ID or link" data-testid="home-league" />
          <button className="primary" onClick={connect} disabled={busy || !username.trim() || !league.trim()} data-testid="home-import">{busy ? "Importing…" : "Connect"}</button>
          {error && <div className="error">{error}</div>}
        </div>
      )}
      <TeamMap />
    </div>
  );
}
