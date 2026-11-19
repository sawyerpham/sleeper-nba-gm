import assert from "node:assert/strict";
import { fits, reseat, swapSteps } from "./swaps.js";

function replay(before, after, pos) {
  const cur = { ...before }, steps = swapSteps(before, after, pos);
  for (const s of steps) {
    assert.ok(fits(pos[s.in], cur[s.out]) && fits(pos[s.out], cur[s.in]), `illegal step ${JSON.stringify(s)}`);
    [cur[s.in], cur[s.out]] = [cur[s.out], cur[s.in]];
  }
  assert.deepEqual(cur, after);
  return steps.map((s) => `${s.in}<>${s.out}`);
}

const pos = { coward: ["SG", "SF"], wiggins: ["SG", "SF", "PF"], sabonis: ["PF", "C"], grant: ["SF", "PF"] };
assert.deepEqual(replay({ coward: "SG", wiggins: "PF", sabonis: "BN", grant: "PF" },
                        { coward: "BN", wiggins: "SG", sabonis: "PF", grant: "PF" }, pos), ["sabonis<>wiggins", "wiggins<>coward"]);
const p2 = { kyrie: ["PG", "SG"], hali: ["PG", "SG"], derozan: ["SG", "SF", "PF"], nesmith: ["SG", "SF"], murray: ["PG"], bane: ["PG", "SG"] };
const slots = ["PG", "PG", "SG", "SG", "SF", "BN", "BN"];
const was = { murray: "PG", hali: "PG", bane: "SG", derozan: "SG", nesmith: "SF", kyrie: "BN" };
const plan = { murray: "PG", hali: "SG", bane: "SG", derozan: "SF", nesmith: "BN", kyrie: "PG" };
assert.deepEqual(replay(was, reseat(was, plan, p2, slots), p2), ["kyrie<>derozan", "derozan<>nesmith"]);
const cards = (shownAfter) => swapSteps(was, reseat(was, plan, p2, slots), p2, shownAfter).map((s) => `${s.a}-${s.b}`);
assert.deepEqual(cards(false), ["kyrie-derozan", "kyrie-nesmith"]);
assert.deepEqual(cards(true), ["nesmith-kyrie", "nesmith-derozan"]);
const p3 = { ...p2, bane: ["PG", "SG", "SF"] };
const fixedBest = reseat(was, plan, p3, slots, new Set(["derozan"]));
assert.equal(fixedBest.derozan, "SG");
assert.deepEqual(replay(was, fixedBest, p3).length, 2);
assert.deepEqual(replay({ grant: "PF", sabonis: "BN" }, { grant: "BN", sabonis: "PF" }, pos), ["sabonis<>grant"]);
assert.deepEqual(swapSteps({ grant: "PF" }, { grant: "PF" }, pos), []);
