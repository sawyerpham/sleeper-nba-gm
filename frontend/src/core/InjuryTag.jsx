const INJ_TAG = {
  Sus: ["SUS", "out", "suspended"], Suspended: ["SUS", "out", "suspended"], Out: ["OUT", "out", "out"], IR: ["OUT", "out", "out"],
  Doubtful: ["D", "out", "doubtful"], DTD: ["DTD", "", "day-to-day"], GTD: ["GTD", "", "game-time decision"],
  Questionable: ["Q", "", "questionable"], Probable: ["P", "ok", "probable"],
};
export const isOut = (tag) => INJ_TAG[tag]?.[1] === "out";
export const isDoubt = (tag) => INJ_TAG[tag]?.[1] === "";
export function injuryTip(tag, note) {
  if (!tag) return undefined;
  const [abbr, , meaning] = INJ_TAG[tag] || [tag, "", tag];
  const say = abbr.toLowerCase() === meaning ? "" : `${meaning[0].toUpperCase()}${meaning.slice(1)}`;
  return [say, note].filter(Boolean).join(" · ") || undefined;
}
export default function InjuryTag({ tag, note }) {
  if (!tag) return null;
  const [abbr, cls] = INJ_TAG[tag] || [tag, ""];
  return <span className={`inj ${cls}`} data-tip={injuryTip(tag, note)}>{abbr}</span>;
}
