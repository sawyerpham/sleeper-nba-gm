import React from "react";
import TeamMap from "./TeamMap.jsx";

export default function HomePage() {
  return (
    <div className="home" data-testid="home-page">
      <h1>NBA Fantasy Tool</h1>
      <TeamMap />
    </div>
  );
}
