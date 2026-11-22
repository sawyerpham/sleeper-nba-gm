import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import DataPage from "./DataPage.jsx";

const when = (t) => (t ? new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

/** Admin tab: usage numbers, sign-ups over 14 days, the most recently seen users, and the data pull. */
export default function AdminPage({ onPoolChanged }) {
  const [st, setSt] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => api.get("/admin/stats").then(setSt).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const tiles = st ? [
    ["Users", st.users, `+${st.new_7d} this week`],
    ["Active today", st.active_24h, `${st.active_7d} this week`],
    ["Leagues", st.leagues, `${st.leagues_on_disk} on disk`],
    ["Telegram linked", st.telegram_linked, st.users ? `${Math.round((100 * st.telegram_linked) / st.users)}% of users` : ""],
    ["Alerts sent", st.sent_24h, `${st.sent_7d} this week`],
    ["Sign-ins today", st.logins_24h, `${st.login_emails_24h} links emailed`],
  ] : [];
  const peak = st ? Math.max(1, ...st.signups_by_day.map((d) => d.n)) : 1;
  return (
    <div className="ap-page ap-view-admin" data-testid="admin">
      <div className="ap-top"><h1 className="ap-title">Admin<span>{st ? `${st.players} players in the pool` : "Loading…"}</span></h1></div>
      {error && <div className="panel error">{error}</div>}
      <div className="ap-scroll ap-admin">
        <div className="ap-admin-tiles">
          {tiles.map(([label, n, foot]) => (
            <div key={label} className="ap-widget"><span className="ap-label">{label}</span><strong className="ap-num sm">{n}</strong><span className="ap-foot">{foot}</span></div>
          ))}
        </div>
        {st && (
          <section className="panel">
            <h3>Sign-ups, last 14 days</h3>
            <div className="ap-admin-bars" role="img" aria-label={st.signups_by_day.map((d) => `${d.day}: ${d.n}`).join(", ")}>
              {st.signups_by_day.map((d) => (
                <span key={d.day} title={`${d.day}: ${d.n}`}><i style={{ height: `${(100 * d.n) / peak}%` }} /><small>{d.day.slice(8)}</small></span>
              ))}
            </div>
          </section>
        )}
        {st && (
          <section className="panel">
            <h3>Users <span className="small muted">most recently seen first</span></h3>
            <table className="ap-admin-users">
              <thead><tr><th>Email</th><th>Joined</th><th>Last seen</th><th>Leagues</th><th>Telegram</th></tr></thead>
              <tbody>
                {st.recent.map((u) => (
                  <tr key={u.email}><td>{u.email}</td><td>{when(u.created_at)}</td><td>{when(u.last_seen)}</td><td>{u.leagues}</td><td>{u.telegram ? "linked" : "-"}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <DataPage onPoolChanged={onPoolChanged} />
      </div>
    </div>
  );
}
