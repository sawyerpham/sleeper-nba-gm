import React, { useEffect, useRef, useState } from "react";
import Headshot from "./Headshot.jsx";
import { PosList } from "./Pos.jsx";
import { api, qs } from "../api.js";
import Icon from "./Icon.jsx";

const TEAMS = ("ATL Atlanta Hawks,BOS Boston Celtics,BKN Brooklyn Nets,CHA Charlotte Hornets,CHI Chicago Bulls,CLE Cleveland Cavaliers," +
  "DAL Dallas Mavericks,DEN Denver Nuggets,DET Detroit Pistons,GSW Golden State Warriors,HOU Houston Rockets,IND Indiana Pacers," +
  "LAC LA Clippers,LAL Los Angeles Lakers,MEM Memphis Grizzlies,MIA Miami Heat,MIL Milwaukee Bucks,MIN Minnesota Timberwolves," +
  "NOP New Orleans Pelicans,NYK New York Knicks,OKC Oklahoma City Thunder,ORL Orlando Magic,PHI Philadelphia 76ers,PHX Phoenix Suns," +
  "POR Portland Trail Blazers,SAC Sacramento Kings,SAS San Antonio Spurs,TOR Toronto Raptors,UTA Utah Jazz,WAS Washington Wizards")
  .split(",").map((t) => ({ abbr: t.slice(0, 3), name: t.slice(4) }));

/** Search box over players, plus NBA teams (with onSelectTeam) and the league's managers (managers = data.teams, with onSelectManager). */
export default function PlayerSearch({ leagueId, onSelect, onSelectTeam, managers, onSelectManager, placeholder = "Search player…", testId = "search-input", autoFocus = false }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const input = useRef(null);

  const needle = q.trim().toLowerCase();
  const teams = onSelectTeam && needle.length >= 2 ? TEAMS.filter((t) => t.abbr.toLowerCase() === needle || t.name.toLowerCase().includes(needle)) : [];
  const mgrs = onSelectManager && managers && needle.length >= 2
    ? managers.filter((m) => [m.user, m.name].some((x) => x?.toLowerCase().includes(needle))) : [];

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return undefined;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.get("/players" + qs({ q, limit: 12, league_id: leagueId })).then((rows) => {
        setHits(rows);
        setOpen(true);
      }).catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(timer.current);
  }, [q, leagueId]);

  const choose = (p) => {
    setOpen(false);
    setQ("");
    p.roster_id != null ? onSelectManager(p.roster_id) : p.abbr ? onSelectTeam(p.abbr) : onSelect(p);
  };
  const rows = [...mgrs, ...teams, ...hits];

  return (
    <div className="search-wrap">
      <input
        ref={input}
        type="text"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        data-testid={testId}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && rows.length) choose(rows[0]);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && rows.length > 0 && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          {mgrs.map((m) => (
            <div key={`m${m.roster_id}`} onClick={() => choose(m)} data-testid={`search-manager-${m.roster_id}`}>
              {m.user || m.name} <span className="muted">{m.user && m.name !== m.user ? `${m.name} · ` : ""}matchup</span>
            </div>
          ))}
          {teams.map((t) => (
            <div key={t.abbr} onClick={() => choose(t)} data-testid={`search-team-${t.abbr}`}>
              {t.name} <span className="muted">{t.abbr} · team card</span>
            </div>
          ))}
          {hits.map((p) => (
            <div key={p.player_id} onClick={() => choose(p)} data-testid={`search-result-${p.player_id}`}>
              <Headshot sleeperId={p.sleeper_id} name={p.full_name} size={28} />
              {p.full_name} <span className="muted">{p.team_abbr || "FA"} · {p.eligibility.length ? <PosList list={p.eligibility} /> : "no position"}</span>
              {p.drafted_by && <span className="badge">drafted: {p.drafted_by}</span>}
              {!p.has_stats && <span className="badge warn">no stats</span>}
            </div>
          ))}
        </div>
      )}
      {q && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { setQ(""); setOpen(false); input.current?.focus(); }}><Icon name="x" /></button>}
    </div>
  );
}
