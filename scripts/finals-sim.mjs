// Does the group-bracket finals actually rank, and does it stay inside budget?
//
// Simulates a person with a fixed hidden preference order who orders each group
// the way she truly feels, with some noise. Checks the invariant (everyone seen
// at least twice), the screen/tap budget, and how well the top comes out.
//
//   node scripts/finals-sim.mjs

import { readFileSync } from 'node:fs';
import {
  createBracket, currentScreen, tap, tapsFor, rankIds, checkInvariant,
  totalScreens,
} from '../src/lib/bracket.js';

const flowers = JSON.parse(readFileSync(new URL('../src/data/flowers.json', import.meta.url), 'utf8'));

/** Plays one full run and returns what happened. */
function play({ likedCount, noise }) {
  const liked = flowers.slice(0, likedCount).map((f) => f.id);
  const trueRank = Object.fromEntries(liked.map((id, i) => [id, i])); // 0 = favourite

  let state = createBracket(liked, {}, 'sim');
  let taps = 0;
  let screens = 0;

  while (!state.done) {
    const screen = currentScreen(state);
    if (!screen) break;
    // Order this group by true preference, with noise on the comparisons.
    const ordered = [...screen.members].sort((a, b) => {
      const flip = Math.random() < noise ? -1 : 1;
      return (trueRank[a] - trueRank[b]) * flip;
    });
    const needed = tapsFor(screen.members.length);
    // Taps are: favourite, next favourite, then LEAST favourite.
    const sequence = needed === 3
      ? [ordered[0], ordered[1], ordered[3]]
      : needed === 2 ? [ordered[0], ordered[1]] : [ordered[0]];
    for (const id of sequence) { state = tap(state, id); taps++; }
    screens++;
  }

  const inv = checkInvariant(state);
  const order = rankIds(state);
  const appearances = state.field.map((id) => state.appearances[id]);
  return {
    field: state.field.length,
    screens,
    taps,
    planned: totalScreens(state),
    minAppearances: Math.min(...appearances),
    maxAppearances: Math.max(...appearances),
    zeroScores: state.field.filter((id) => (state.points[id] ?? 0) === 0).length,
    invariantOk: inv.ok,
    problems: inv.problems.slice(0, 3),
    top5correct: order.slice(0, 5).filter((id) => trueRank[id] < 8).length,
    top3correct: order.slice(0, 3).filter((id) => trueRank[id] < 5).length,
    unranked: state.unranked.length,
  };
}

const CASES = [
  { name: '8 liked', likedCount: 8, noise: 0.12 },
  { name: '16 liked', likedCount: 16, noise: 0.12 },
  { name: '30 liked', likedCount: 30, noise: 0.12 },
  { name: '32 liked (full field)', likedCount: 32, noise: 0.12 },
  { name: '50 liked (over cap)', likedCount: 50, noise: 0.12 },
  { name: '50 liked, decisive', likedCount: 50, noise: 0.02 },
  { name: '50 liked, very unsure', likedCount: 50, noise: 0.30 },
];

console.log('Group-bracket finals — 25 runs per case\n');
let failures = 0;

for (const c of CASES) {
  const runs = Array.from({ length: 25 }, () => play(c));
  const avg = (f) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  const badInvariant = runs.filter((r) => !r.invariantOk);
  const overBudget = runs.filter((r) => r.taps > 60 || r.screens > 20);
  failures += badInvariant.length + overBudget.length;

  console.log(c.name);
  console.log(`  field ${runs[0].field}  (${runs[0].unranked} liked left unranked)`);
  console.log(`  screens ${avg((r) => r.screens).toFixed(1)} / planned ${runs[0].planned}   taps ${avg((r) => r.taps).toFixed(0)}`);
  console.log(`  appearances per flower  min ${Math.min(...runs.map((r) => r.minAppearances))}  max ${Math.max(...runs.map((r) => r.maxAppearances))}`);
  console.log(`  flowers left on zero points  ${avg((r) => r.zeroScores).toFixed(1)}`);
  console.log(`  top-5 within true top-8  ${avg((r) => r.top5correct).toFixed(1)} / 5`);
  console.log(`  top-3 within true top-5  ${avg((r) => r.top3correct).toFixed(1)} / 3`);
  console.log(`  invariant  ${badInvariant.length ? `FAILED (${badInvariant[0].problems.join('; ')})` : 'holds'}`);
  console.log(`  budget     ${overBudget.length ? 'EXCEEDED' : 'within 20 screens / 60 taps'}`);
  console.log('');
}

console.log(failures === 0
  ? 'All runs: invariant holds and budget respected.'
  : `${failures} run(s) violated the invariant or the budget.`);
process.exitCode = failures === 0 ? 0 : 1;
