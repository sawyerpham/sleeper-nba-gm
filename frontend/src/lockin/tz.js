let zone = "America/Chicago";
export const setZone = (z) => { if (z) zone = z; };
export const fmt = (ms, opts) => new Date(ms).toLocaleString("en-US", { timeZone: zone, ...opts });
export const timeOf = (iso) => (iso ? fmt(iso, { hour: "numeric", minute: "2-digit" }) : "");
export const tzAbbr = (ms = Date.now()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value || "";

const dayKey = (ms) => fmt(ms, { year: "numeric", month: "numeric", day: "numeric" });
/** A tip time as the game popup says it: minutes to go, "18h 27m" (or "Tips soon"), and "Tomorrow, 5:00 PM". */
export const tipInfo = (tip) => {
  const mins = tip ? Math.floor((new Date(tip).getTime() - Date.now()) / 60000) : 0;
  const rel = !tip ? "" : dayKey(tip) === dayKey(Date.now()) ? "Today" : dayKey(tip) === dayKey(Date.now() + 864e5) ? "Tomorrow" : fmt(tip, { weekday: "short", month: "short", day: "numeric" });
  const when = tip ? `${rel}${rel === "Today" || rel === "Tomorrow" ? "," : " ·"} ${timeOf(tip)}` : "";
  const countdown = mins <= 0 ? "Tips soon" : [[Math.floor(mins / 1440), "d"], [Math.floor(mins / 60) % 24, "h"], [mins % 60, "m"]].filter(([n]) => n).map(([n, u]) => `${n}${u}`).join(" ");
  return { mins, countdown, when };
};
