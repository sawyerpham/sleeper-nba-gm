import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api.js";

const listeners = new Set();
const cache = {};
const loading = new Set();
const NONE = [];
const set = (leagueId, ids) => { cache[leagueId] = ids; listeners.forEach((cb) => cb()); };

export function useWatch(leagueId) {
  const watched = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => cache[leagueId] || NONE);
  useEffect(() => {
    if (!leagueId || cache[leagueId] || loading.has(leagueId)) return;
    loading.add(leagueId);
    api.get(`/leagues/${leagueId}/season/watch`).then((r) => set(leagueId, r.watched)).catch(() => {}).finally(() => loading.delete(leagueId));
  }, [leagueId]);
  const toggle = (pid) => api.post(`/leagues/${leagueId}/season/watch`, { player_id: pid, watched: !watched.includes(pid) }).then((r) => set(leagueId, r.watched)).catch(() => {});
  return [watched, toggle];
}
