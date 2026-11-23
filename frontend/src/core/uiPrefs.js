import { useSyncExternalStore } from "react";
import { api } from "../api.js";

/** The signed-in account's display settings (Settings > Appearance), kept on the server: loaded with /auth/me, saved by PUT /auth/ui. */
let prefs = { swap_arrows: true, nicknames: true, timeline: true, table_view: false };
const listeners = new Set();

export const getUiPref = (key) => prefs[key];
/** Take the settings the server sent (and tell the pages showing them). */
export function loadUiPrefs(ui) {
  prefs = { ...prefs, ...ui };
  listeners.forEach((f) => f());
}
/** Change one setting at once on screen, then save the set on the account. */
export function setUiPref(key, value) {
  loadUiPrefs({ [key]: value });
  api.put("/auth/ui", prefs).catch(() => {});
}
export const useUiPref = (key) => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => prefs[key]);
