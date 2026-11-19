let zone = "America/Chicago";
export const setZone = (z) => { if (z) zone = z; };
export const fmt = (ms, opts) => new Date(ms).toLocaleString("en-US", { timeZone: zone, ...opts });
export const timeOf = (iso) => (iso ? fmt(iso, { hour: "numeric", minute: "2-digit" }) : "");
export const tzAbbr = (ms = Date.now()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value || "";
