// Finals round: pairwise ranking of the liked set.
//
// Binary swiping leaves ~50 likes out of ~120 cards, which is far too flat to
// rank stems or to sharpen the palette signal. Forced-choice comparisons fix
// that, and Elo is the right model because it extracts a continuous strength
// from nothing but "A beat B".
//
// Two decisions matter more than the maths:
//
//   PAIRING is adaptive, not random. A matchup between the #2 and #40 flower
//   tells you almost nothing -- you already knew the answer. A matchup between
//   two flowers with near-identical ratings is where the information is, so
//   every round picks the closest-rated pair that hasn't already been played.
//
//   K DECAYS. Early comparisons should move ratings a long way (K=32) because
//   the seeds are arbitrary; later ones should refine rather than thrash
//   (K=16), or the ordering never settles and the stopping rule never fires.

export const ELO = {
  seed: 1500,
  obsessedSeed: 1600,   // an up-swipe is real information; start it ahead
  kEarly: 32,
  kLate: 16,
  kSwitchRound: 10,
  // The cap has to scale with the set. A flat 35 works for ~30 liked flowers but
  // fails for 50, where covering everyone once already costs 25 rounds and
  // leaves nothing to actually narrow with. She can stop whenever she likes, so
  // the cap is a ceiling rather than a target.
  maxRoundsFor: (n) => Math.max(24, Math.min(60, Math.ceil(n / 2) + 28)),
  maxRounds: 35,        // fallback for state created before the cap was adaptive
  stableRounds: 4,      // top-N unchanged this many rounds in a row -> done
  topN: 10,

  // Stopping thresholds. Without these the round quits while every flower has
  // been seen exactly once: after coverage all the winners share an identical
  // rating, so the top-N list stops changing and looks "settled" even though
  // nothing has actually been told apart. A single win is not a ranking.
  minComparisons: 1,        // everyone, from the coverage phase
  minTopComparisons: 4,     // the contenders, who are what the output uses
  contenderCount: 12,       // how many get the repeat matchups

  // Ranking everything she liked is arithmetically impossible at a tolerable
  // number of taps: 50 flowers needing 4 comparisons each is 100 pairings, and
  // nobody taps 100 times. Spreading the budget thinner instead produces a table
  // where every winner is tied on one win and the "top" is whoever sorted first.
  //
  // So the field is capped -- up-swipes first, then likes -- and the rest keep
  // their binary like without a placing. Measured over 40 simulated runs with a
  // 50-flower liked set and 12% choice noise, holding taps roughly constant:
  //
  //     field 24, ~3 comparisons each, 34 taps -> 2.5 of the top 5 correct
  //     field 16, ~4 comparisons each, 36 taps -> 4.2 of the top 5 correct
  //     field 12, ~5 comparisons each, 28 taps -> 4.5 of the top 5 correct
  //
  // A smaller field is better on BOTH axes, because evidence per flower is what
  // actually determines the ranking. 16 keeps the ranked list a useful length
  // without giving up much.
  fieldCap: 16,
};

/** Who actually enters the tournament, strongest evidence first. */
export function selectField(likedIds, swipes = {}) {
  const obsessed = likedIds.filter((id) => swipes[`flower:${id}`] === 'obsessed');
  const rest = likedIds.filter((id) => swipes[`flower:${id}`] !== 'obsessed');
  return [...obsessed, ...rest].slice(0, ELO.fieldCap);
}

/** Rounds still worth playing, for the "18 of ~30" progress readout. */
export function estimatedRounds(playerCount) {
  if (playerCount < 2) return 0;
  // Coverage (n/2 rounds) plus enough repeats to test the contenders. The
  // stopping rule often fires a little before this.
  const coverage = Math.ceil(playerCount / 2);
  const refine = Math.min(playerCount, ELO.contenderCount) * ELO.minTopComparisons / 2;
  return Math.min(ELO.maxRoundsFor(playerCount), Math.round(coverage + refine));
}

const pairKey = (a, b) => [a, b].sort().join('|');

/**
 * @param likedIds  flower ids she swiped right or up on
 * @param swipes    the raw swipe map, to find the up-swipes
 */
export function createFinals(likedIds, swipes = {}) {
  const field = selectField(likedIds, swipes);
  const ratings = {};
  for (const id of field) {
    ratings[id] = swipes[`flower:${id}`] === 'obsessed' ? ELO.obsessedSeed : ELO.seed;
  }
  return {
    ratings,
    played: [],        // pair keys already shown
    round: 0,
    stableFor: 0,
    lastTop: [],
    done: field.length < 2,
    estimate: estimatedRounds(field.length),
    cap: ELO.maxRoundsFor(field.length),
    // Everything she liked that didn't make the field, so the results screen can
    // still list them rather than silently dropping them.
    unranked: likedIds.filter((id) => !field.includes(id)),
  };
}

/** Ids ordered strongest first. */
export function ranking(state) {
  return Object.keys(state.ratings).sort((a, b) => state.ratings[b] - state.ratings[a]);
}

/** How many comparisons each flower has actually been in. */
function appearances(state) {
  const counts = Object.fromEntries(Object.keys(state.ratings).map((id) => [id, 0]));
  for (const key of state.played) {
    for (const id of key.split('|')) if (counts[id] !== undefined) counts[id]++;
  }
  return counts;
}

/**
 * Which pair to show next.
 *
 * Closest-rating alone -- the obvious reading -- turns out to rank badly on a
 * realistic set. With ~50 liked flowers and ~25 rounds, adjacent-rating pairs
 * cluster in one part of the table and most flowers are never shown at all,
 * leaving them on their seed rating. Simulation put the mean rank error around
 * 11 places out of 50 that way.
 *
 * So pairing runs in two phases:
 *   1. COVERAGE  -- while anything is unseen, pick from the least-compared
 *      flowers, closest-rated among those. Every flower earns a real rating.
 *   2. REFINE    -- after that, closest-rated unplayed pair, preferring the top
 *      of the table, because that is the part the output actually uses.
 */
export function nextPair(state) {
  const ids = ranking(state);
  if (ids.length < 2) return null;
  const seen = new Set(state.played);
  const counts = appearances(state);

  const closestUnplayed = (pool) => {
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (seen.has(pairKey(pool[i], pool[j]))) continue;
        const gap = Math.abs(state.ratings[pool[i]] - state.ratings[pool[j]]);
        if (!best || gap < best.gap) best = { a: pool[i], b: pool[j], gap };
      }
    }
    return best;
  };

  // Phase 1: coverage.
  const minSeen = Math.min(...Object.values(counts));
  if (minSeen === 0) {
    const starved = ids.filter((id) => counts[id] === 0);
    // Pair two unseen flowers together where possible -- it covers two per round.
    const pairUp = closestUnplayed(starved);
    if (pairUp) return [pairUp.a, pairUp.b];
    // Otherwise pit the last unseen one against its nearest rated neighbour.
    const lone = starved[0];
    const rival = ids
      .filter((id) => id !== lone && !seen.has(pairKey(lone, id)))
      .sort((x, y) =>
        Math.abs(state.ratings[x] - state.ratings[lone]) -
        Math.abs(state.ratings[y] - state.ratings[lone]))[0];
    if (rival) return [lone, rival];
  }

  // Phase 2: narrow down the contenders by making them fight repeatedly. The
  // least-tested contender goes first, so nobody reaches the podium on the
  // strength of a single win.
  const contenders = ids.slice(0, Math.max(ELO.topN, Math.ceil(ids.length * 0.6)));
  const untested = contenders
    .filter((id) => counts[id] < ELO.minTopComparisons)
    .sort((a, b) => counts[a] - counts[b]);

  for (const id of untested) {
    const rival = contenders
      .filter((other) => other !== id && !seen.has(pairKey(id, other)))
      .sort((x, y) => {
        const byCount = counts[x] - counts[y];
        if (byCount !== 0) return byCount;
        return Math.abs(state.ratings[x] - state.ratings[id]) -
               Math.abs(state.ratings[y] - state.ratings[id]);
      })[0];
    if (rival) return [id, rival];
  }

  // Everyone's been tested: fall back to the closest unplayed pair anywhere.
  const best = closestUnplayed(contenders) ?? closestUnplayed(ids);
  return best ? [best.a, best.b] : null;
}

/** Every flower has been compared at least once. */
export function hasFullCoverage(state) {
  const counts = Object.values(appearances(state));
  return counts.length > 0 && Math.min(...counts) >= ELO.minComparisons;
}

/**
 * Has the top of the table actually been tested, rather than merely populated?
 * This is the gate that stops the round quitting after one pass.
 */
export function contendersTested(state) {
  const counts = appearances(state);
  const top = ranking(state).slice(0, Math.min(ELO.contenderCount, Object.keys(counts).length));
  if (!top.length) return false;
  return top.every((id) => counts[id] >= ELO.minTopComparisons);
}

/** Progress through the work that actually has to happen, 0..1. */
export function completion(state) {
  const ids = Object.keys(state.ratings ?? {});
  if (ids.length < 2) return 1;
  const counts = appearances(state);
  const covered = ids.filter((id) => counts[id] >= ELO.minComparisons).length / ids.length;
  const top = ranking(state).slice(0, Math.min(ELO.contenderCount, ids.length));
  const tested = top.reduce(
    (n, id) => n + Math.min(counts[id], ELO.minTopComparisons) / ELO.minTopComparisons, 0,
  ) / top.length;
  // Coverage is the first half of the job, testing the contenders the second.
  return Math.min(1, covered * 0.5 + tested * 0.5);
}

const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/**
 * @param outcome 'a' | 'b' | 'draw'
 */
export function recordResult(state, a, b, outcome) {
  const k = state.round < ELO.kSwitchRound ? ELO.kEarly : ELO.kLate;
  const ra = state.ratings[a];
  const rb = state.ratings[b];
  const scoreA = outcome === 'draw' ? 0.5 : outcome === 'a' ? 1 : 0;

  const ratings = {
    ...state.ratings,
    [a]: ra + k * (scoreA - expected(ra, rb)),
    [b]: rb + k * ((1 - scoreA) - expected(rb, ra)),
  };

  const next = {
    ...state,
    ratings,
    played: [...state.played, pairKey(a, b)],
    round: state.round + 1,
  };

  // Stop once the ordering that actually matters has stopped moving.
  const top = ranking(next).slice(0, ELO.topN);
  const unchanged = top.length === next.lastTop.length && top.every((id, i) => id === next.lastTop[i]);
  next.stableFor = unchanged ? next.stableFor + 1 : 0;
  next.lastTop = top;
  next.done =
    next.round >= (next.cap ?? ELO.maxRounds) ||
    (next.stableFor >= ELO.stableRounds && hasFullCoverage(next) && contendersTested(next)) ||
    nextPair(next) === null;

  return next;
}

/**
 * Continuous strength in 0..1, min-max normalised across the participants.
 * This is what replaces "she liked it" everywhere downstream.
 */
export function strengths(state) {
  const ids = Object.keys(state.ratings ?? {});
  if (!ids.length) return {};
  const values = ids.map((id) => state.ratings[id]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const out = {};
  for (const id of ids) out[id] = span === 0 ? 0.5 : (state.ratings[id] - lo) / span;
  return out;
}

/** Tier labels, so the florist card can tell "must include" from "fine as filler". */
export const TIERS = [
  { key: 'obsessed', label: 'Obsessed', upto: 5 },
  { key: 'love', label: 'Love', upto: 15 },
  { key: 'like', label: 'Like', upto: Infinity },
];

export function tierFor(rankIndex) {
  return TIERS.find((t) => rankIndex < t.upto) ?? TIERS[TIERS.length - 1];
}

/** Quantile helpers the generator uses to pick focals and secondaries. */
export function quantileThreshold(state, q) {
  const values = Object.values(state?.ratings ?? {});
  if (!values.length) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

/** True when finals produced something worth using downstream. */
export function hasSignal(state) {
  return !!state && (state.round ?? 0) >= 3 && Object.keys(state.ratings ?? {}).length >= 3;
}
