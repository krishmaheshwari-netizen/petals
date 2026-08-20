// Does the finals round actually recover a ranking?
//
// Simulates a person with a fixed hidden preference order who picks the flower
// they truly prefer, with some noise (real people are inconsistent on close
// calls). Then checks how well the recovered top-10 matches the truth, that
// pairs never repeat, and that the stopping rule fires before the hard cap.
//
//   node scripts/finals-sim.mjs

import { readFileSync } from 'node:fs';
import {
  createFinals, nextPair, recordResult, ranking, strengths, ELO,
} from '../src/lib/elo.js';

const flowers = JSON.parse(readFileSync(new URL('../src/data/flowers.json', import.meta.url), 'utf8'));

function simulate({ likedCount, noise, seedObsessed = 0 }) {
  const liked = flowers.slice(0, likedCount).map((f) => f.id);
  // Hidden truth: index 0 is her favourite, ascending index = less preferred.
  const truth = [...liked].sort(() => 0); // already in order
  const trueRank = Object.fromEntries(truth.map((id, i) => [id, i]));

  const swipes = {};
  // Up-swipe a few of her genuine favourites, and a couple of mid ones, since a
  // real person's up-swipes are informative but not perfect.
  for (let i = 0; i < seedObsessed; i++) swipes[`flower:${truth[i]}`] = 'obsessed';

  let state = createFinals(liked, swipes);
  let rounds = 0;
  while (!state.done) {
    const pair = nextPair(state);
    if (!pair) break;
    const [a, b] = pair;
    const aBetter = trueRank[a] < trueRank[b];
    // Noise: sometimes she picks the one she actually likes less.
    const flip = Math.random() < noise;
    const winner = (aBetter !== flip) ? 'a' : 'b';
    state = recordResult(state, a, b, winner);
    rounds++;
  }

  const recovered = ranking(state);
  const trueTop10 = truth.slice(0, 10);
  const recTop10 = recovered.slice(0, 10);
  const overlap = recTop10.filter((id) => trueTop10.includes(id)).length;

  // Spearman-ish: mean absolute rank error over the whole set.
  const meanErr =
    recovered.reduce((s, id, i) => s + Math.abs(i - trueRank[id]), 0) / recovered.length;

  const dupes = state.played.length !== new Set(state.played).size;
  const str = strengths(state);
  const strengthRange = [Math.min(...Object.values(str)), Math.max(...Object.values(str))];

  return { rounds, overlap, meanErr, dupes, stableFor: state.stableFor, strengthRange };
}

const CASES = [
  { name: 'decisive, 30 liked', likedCount: 30, noise: 0.02, seedObsessed: 4 },
  { name: 'decisive, 50 liked', likedCount: 50, noise: 0.02, seedObsessed: 6 },
  { name: 'realistic noise, 50 liked', likedCount: 50, noise: 0.15, seedObsessed: 6 },
  { name: 'very inconsistent, 50 liked', likedCount: 50, noise: 0.30, seedObsessed: 0 },
  { name: 'small set, 8 liked', likedCount: 8, noise: 0.10, seedObsessed: 2 },
];

console.log('Finals simulation — 20 runs per case\n');
let anyDupes = false;
for (const c of CASES) {
  const runs = Array.from({ length: 20 }, () => simulate(c));
  const avg = (f) => (runs.reduce((s, r) => s + f(r), 0) / runs.length);
  anyDupes ||= runs.some((r) => r.dupes);
  console.log(c.name);
  console.log(`  rounds played      ${avg((r) => r.rounds).toFixed(1)}  (cap ${ELO.maxRounds})`);
  console.log(`  top-10 recovered   ${avg((r) => r.overlap).toFixed(1)} / 10`);
  console.log(`  mean rank error    ${avg((r) => r.meanErr).toFixed(1)} places`);
  console.log(`  repeated a pair    ${runs.some((r) => r.dupes) ? 'YES — BUG' : 'no'}`);
  console.log('');
}
console.log(anyDupes ? 'FAIL: pairs repeated' : 'No pair was ever shown twice.');
process.exitCode = anyDupes ? 1 : 0;
