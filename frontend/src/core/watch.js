import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api.js";

// Watched players, per league, kept by the backend; a tiny store so the profile button and the News tab stay in step.
const listeners = new Set();
const cache = {};   // leagueId -> the watched ids, replaced (never mutated) on a change so useSyncExternalStore sees a new snapshot
const loading = new Set();
const NONE = [];
const set = (leagueId, ids) => { cache[leagueId] = ids; listeners.forEach((cb) => cb()); };

/** The league's watched player ids and a toggle: `const [watched, toggle] = useWatch(leagueId)`; `watched` is an array of player ids (empty until the first load). */
export function useWatch(leagueId) {
  const watched = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => cache[leagueId] || NONE);
  useEffect(() => {
    if (!leagueId || cache[leagueId] || loading.has(leagueId)) return;
    loading.add(leagueId);
    api.get(`/leagues/${leagueId}/season/watch`).then((r) => set(leagueId, r.watched)).catch(() => {}).finally(() => loading.delete(leagueId));
  }, [leagueId]);
  /** Save the change on the backend, then show it (the News tab reloads on the new list). */
  const toggle = (pid) => api.post(`/leagues/${leagueId}/season/watch`, { player_id: pid, watched: !watched.includes(pid) }).then((r) => set(leagueId, r.watched)).catch(() => {});
  return [watched, toggle];
}
