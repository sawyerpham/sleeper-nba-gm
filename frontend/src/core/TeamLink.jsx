import React, { createContext, useContext } from "react";

export const TeamLinkContext = createContext(null);

export function TeamTag({ abbr }) {
  if (!abbr) return null;
  return (
    <span className="team-tag">
      <img src={`https://sleepercdn.com/images/team_logos/nba/${abbr.toLowerCase()}.png`} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <TeamLink abbr={abbr} />
    </span>
  );
}

export default function TeamLink({ abbr, children }) {
  const open = useContext(TeamLinkContext);
  const text = children ?? abbr;
  if (!open || !abbr) return <>{text}</>;
  return (
    <span className="team-link" role="link" tabIndex={0} title={`Open ${abbr}'s team card`} data-testid={`team-link-${abbr}`}
      onClick={(e) => { e.stopPropagation(); open(abbr); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); open(abbr); } }}>
      {text}
    </span>
  );
}
