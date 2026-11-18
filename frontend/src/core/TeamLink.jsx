import React, { createContext, useContext } from "react";

// An NBA team's name or abbreviation that opens its Team card. The Season tab provides openTeam(abbr) through the
// context; anywhere else (the Draft tab's profiles) the name stays plain text.
export const TeamLinkContext = createContext(null);

/** An NBA team's abbreviation with its logo in front (the logo scales with the text); opens the Team card like TeamLink. */
export function TeamTag({ abbr }) {
  if (!abbr) return null;
  return (
    <span className="team-tag">
      <img src={`https://sleepercdn.com/images/team_logos/nba/${abbr.toLowerCase()}.png`} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <TeamLink abbr={abbr} />
    </span>
  );
}

/** An NBA team's name or abbreviation that opens its Team card when a TeamLinkContext provider is present; otherwise plain text. */
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
