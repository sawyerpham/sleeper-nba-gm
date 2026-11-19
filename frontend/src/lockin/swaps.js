
export const fits = (pos, slot) => slot === "BN" || slot === "UTIL" ? true : slot === "G" ? pos.some((p) => p === "PG" || p === "SG")
  : slot === "F" ? pos.some((p) => p === "SF" || p === "PF") : pos.includes(slot);

export function reseat(before, after, pos, positions, fixed = new Set()) {
  const seats = positions.filter((s) => s !== "BN" && s !== "IR"), who = Array(seats.length).fill(null);
  const starts = (slot) => slot && slot !== "BN" && slot !== "IR";
  const starters = [...new Set([...Object.keys(after).filter((sid) => starts(after[sid])), ...[...fixed].filter((s) => starts(before[s]))])];
  for (const sid of starters.filter((s) => starts(before[s]))) {
    const i = seats.findIndex((t, k) => t === before[sid] && who[k] == null);
    if (i >= 0) who[i] = sid;
  }
  const seatsFor = (sid) => seats.map((t, k) => k).filter((k) => fits(pos[sid] || [], seats[k]));
  const place = (sid) => {
    const prev = new Map(seatsFor(sid).map((k) => [k, -1])), queue = [...prev.keys()];
    while (queue.length) {
      let k = queue.shift();
      if (who[k] == null) {
        for (; prev.get(k) !== -1; k = prev.get(k)) who[k] = who[prev.get(k)];
        who[k] = sid;
        return true;
      }
      if (fixed.has(who[k])) continue;
      for (const j of seatsFor(who[k])) if (!prev.has(j)) { prev.set(j, k); queue.push(j); }
    }
    return false;
  };
  for (const sid of starters.filter((s) => !who.includes(s))) if (!place(sid)) return after;
  const out = { ...after };
  for (const sid of fixed) if (!starts(before[sid])) out[sid] = before[sid];
  who.forEach((sid, k) => { if (sid) out[sid] = seats[k]; });
  return out;
}

export function swapSteps(before, after, pos, shownAfter = false) {
  const cur = { ...before }, steps = [];
  const open = (sid) => cur[sid] !== after[sid] && cur[sid] !== "IR" && after[sid] !== "IR";
  for (let guard = 0; guard < 60; guard++) {
    const last = steps.at(-1)?.out;
    const todo = Object.keys(cur).filter(open).sort((a, b) => (b === last) - (a === last) || (cur[b] === "BN") - (cur[a] === "BN"));
    let done = false;
    for (const p of todo) {
      const qs = Object.keys(cur).filter((q) => q !== p && open(q) && cur[q] === after[p] && fits(pos[q] || [], cur[p]));
      const q = qs.find((x) => after[x] === cur[p]) || qs[0];
      if (!q) continue;
      steps.push({ in: p, out: q, slot: after[p] === "BN" ? cur[p] : after[p], n: steps.length + 1, from: cur[p], to: cur[q] });
      [cur[p], cur[q]] = [cur[q], cur[p]];
      done = true;
      break;
    }
    if (!done) break;
  }
  const holds = Object.fromEntries(Object.keys(before).map((s) => [s, s]));
  for (const s of steps) {
    s.a = holds[s.in]; s.b = holds[s.out];
    [holds[s.in], holds[s.out]] = [holds[s.out], holds[s.in]];
  }
  if (shownAfter) {
    const card = Object.fromEntries(Object.entries(holds).map(([sid, slot]) => [slot, sid]));
    for (const s of steps) { s.a = card[s.a]; s.b = card[s.b]; }
  }
  return steps;
}
