import React, { useEffect, useState } from "react";
import { api } from "../api.js";

// [setting, label, text before the minutes box, lead setting, text after it]; no lead setting = the text alone.
const KINDS = [
  ["lock", "Lock calls", "", "lock_lead", "min before the tip that closes a lock window"],
  ["swap", "Keep / swap calls", "", "swap_lead", "min before a later bench player's tip (the call is final 5 min before)"],
  ["out", "Player ruled OUT", "a starter ruled out before his tip, and any player on your roster newly listed Out"],
  ["dtd", "Player GTD / DTD", "a questionable starter", "dtd_lead", "min before his tip, and any player newly listed GTD / DTD"],
  ["cleared", "Player cleared to play", "a GTD / DTD / Out player whose tag is gone (or Probable)"],
  ["moves", "Lineup moves", "the swaps to make in Sleeper,", "moves_lead", "min before the tip they must beat"],
];

export function useNotify() {
  const [st, setSt] = useState(null);
  const load = () => api.get("/notify").then(setSt).catch((e) => setSt({ configured: false, error: e.message }));
  useEffect(() => { load(); }, []);
  return [st, setSt, load];
}

/** Link Telegram: a one-time t.me link (10 minutes) that the user opens and taps Start in; the bot links the chat that
 *  taps it, then this polls until the link shows up. */
export function TelegramLink({ st, reload }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!waiting || st?.linked) return setWaiting(false);
    const t = setInterval(reload, 3000), stop = setTimeout(() => setWaiting(false), 10 * 60000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting, st?.linked]);
  const link = async () => {
    setError("");
    const tab = window.open("", "_blank");
    try {
      const { url } = await api.post("/notify/link");
      if (tab) tab.location.href = url; else window.location.href = url;
      setWaiting(true);
    } catch (e) {
      tab?.close();
      setError(e.message);
    }
  };
  const unlink = async () => { await api.del("/notify/link"); reload(); };
  if (!st) return <span className="muted">Checking Telegram…</span>;
  if (!st.configured) return <span data-testid="telegram-off">Telegram alerts aren't available on this server.</span>;
  if (st.linked) {
    return (
      <span data-testid="telegram-on">Alerts go to <strong>{st.chat || "your Telegram"}</strong>
        {st.bot && <> · <a href={`https://t.me/${st.bot}`} target="_blank" rel="noopener noreferrer" data-testid="telegram-chat">Open the chat</a></>}
        {" "}<button className="small" onClick={unlink} data-testid="telegram-unlink">Unlink</button></span>
    );
  }
  return (
    <span data-testid="telegram-unlinked">
      <button className="primary" onClick={link} disabled={!st.bot} data-testid="telegram-link">Link Telegram</button>
      <span className="small muted"> {waiting ? "Tap Start in Telegram, this updates by itself…" : "Opens Telegram: tap Start and you're set."}</span>
      {!st.bot && <span className="warn-text small"> Couldn't reach Telegram, try again later.</span>}
      {error && <span className="warn-text small"> {error}</span>}
    </span>
  );
}

export default function NotifyPage() {
  const [st, setSt, reload] = useNotify();
  const [msg, setMsg] = useState("");
  const set = (patch) => {
    const prefs = { ...st.prefs, ...patch };
    setSt({ ...st, prefs }); setMsg("");
    api.put("/notify/prefs", prefs).then((p) => { setSt((s) => ({ ...s, prefs: p })); setMsg("Saved"); }).catch((e) => setMsg(e.message));
  };
  return (
    <div className="panel" data-testid="notify-settings">
      <h3>Telegram</h3>
      <p><TelegramLink st={st} reload={reload} /></p>
      <h3>What to send</h3>
      {st?.prefs ? (
        <div className="notify-kinds">
          {KINDS.map(([k, label, before, lead, after]) => (
            <label key={k} className="inline notify-kind"><input type="checkbox" checked={st.prefs[k]} onChange={(e) => set({ [k]: e.target.checked })} data-testid={`notify-${k}`} />
              <span><strong>{label}</strong> <span className="small muted">— {before}{lead && <>{before && " "}
                <input type="number" className="notify-lead" min={0} max={240} step={5} value={st.prefs[lead]} disabled={!st.prefs[k]}
                  onChange={(e) => set({ [lead]: Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0))) })}
                  aria-label={`${label}: minutes before the tip`} data-testid={`notify-${lead}`} /> {after}</>}</span></span></label>
          ))}
          <label className="inline notify-wpa small">Lock calls only when locking adds at least
            <input type="number" min={0} max={100} step={1} value={st.prefs.lock_min_wpa} disabled={!st.prefs.lock}
              onChange={(e) => set({ lock_min_wpa: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} data-testid="notify-lock-wpa" aria-label="Minimum win chance added" />
            points of win chance <span className="muted">(0 = every lock call; the card's WPA)</span></label>
        </div>
      ) : <div className="small muted loading">{st?.error || "Loading…"}</div>}
      {msg && <div className={`small ${msg === "Saved" ? "muted" : "warn-text"}`} data-testid="notify-msg">{msg}</div>}
    </div>
  );
}
