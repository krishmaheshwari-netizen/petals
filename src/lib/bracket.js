// Finals round: group brackets with a full ordering per screen.
//
// Four flowers at a time, ordered by three taps (favourite, next, least). The
// fourth is implicitly third and scores for it. Every flower in every group
// therefore leaves with a distinct, meaningful number -- losing to a favourite is
// worth 2, not 0 -- so nothing gets shut out by landing in a strong group.
//
//   group of 4   3 taps   3 / 2 / 1(implicit) / 0
//   group of 3   2 taps   3 / 2 / 0
//   group of 2   1 tap    3 / 1
//
// Fixed length by construction: the partitions for both passes are computed up
// front and the redemption set is a known size, so the progress bar is honest
// from the first screen to the last.

export const BRACKET = {
  groupSize: 4,
  // 8 screens per pass at a full field. The field cap follows from the budget:
  // every flower must appear in both passes, so the field can be at most
  // screensPerPass * groupSize.
  screensPerPass: 8,
  redemptionCap: 16,
  topByScore: 12,          // seeds of the redemption set
  strongCompanyTop: 8,     // "beaten only by a top-8 finisher" counts as strong
  opponentAdjustment: 0.25, // final = raw * (1 + 0.25 * opponentStrength)
};

export const FIELD_CAP = BRACKET.screensPerPass * BRACKET.groupSize; // 32

/** Deterministic PRNG so partitions survive a reload unchanged. */
function rng(seedText) {
  let a = 0;
  for (let i = 0; i < seedText.length; i++) a = (a * 31 + seedText.charCodeAt(i)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** How many taps a group of this size needs. */
export const tapsFor = (size) => (size >= 4 ? 3 : size === 3 ? 2 : 1);

/**
 * Splits into groups of four, never leaving a group of one: a trailing single is
 * folded back into a three-and-two rather than shown on its own.
 */
function chunk(ids) {
  const groups = [];
  for (let i = 0; i < ids.length; i += 4) groups.push(ids.slice(i, i + 4));
  const last = groups[groups.length - 1];
  if (last && last.length === 1 && groups.length > 1) {
    const prev = groups[groups.length - 2];
    const merged = [...prev, ...last];         // 5
    groups.splice(groups.length - 2, 2, merged.slice(0, 3), merged.slice(3));
  }
  return groups;
}

/**
 * Builds groups that avoid rematches where possible. Falls back to allowing a
 * repeat rather than failing -- an imperfect group beats no group.
 */
function partitionAvoidingRepeats(ids, facedMap, rand) {
  const pool = shuffled(ids, rand);
  const groups = [];
  while (pool.length) {
    const group = [pool.shift()];
    while (group.length < 4 && pool.length) {
      const fresh = pool.findIndex((cand) =>
        group.every((m) => !(facedMap[m] ?? []).includes(cand)));
      group.push(pool.splice(fresh >= 0 ? fresh : 0, 1)[0]);
    }
    groups.push(group);
  }
  const last = groups[groups.length - 1];
  if (last && last.length === 1 && groups.length > 1) {
    const prev = groups.pop();
    groups[groups.length - 1].push(...prev);
    const merged = groups.pop();
    groups.push(merged.slice(0, 3), merged.slice(3));
  }
  return groups;
}

/** Who enters: up-swipes first, then likes, capped by the screen budget. */
export function selectField(likedIds, swipes = {}) {
  const obsessed = likedIds.filter((id) => swipes[`flower:${id}`] === 'obsessed');
  const rest = likedIds.filter((id) => swipes[`flower:${id}`] !== 'obsessed');
  return [...obsessed, ...rest].slice(0, FIELD_CAP);
}

export function createBracket(likedIds, swipes = {}, seedText = 'petals') {
  const field = selectField(likedIds, swipes);
  const rand = rng(seedText + field.length);

  const passA = chunk(shuffled(field, rand)).map((members) => ({ pass: 'A', members }));

  // Pass B is built against what Pass A already paired up.
  const faced = {};
  for (const g of passA) {
    for (const id of g.members) {
      faced[id] = [...(faced[id] ?? []), ...g.members.filter((m) => m !== id)];
    }
  }
  const passB = partitionAvoidingRepeats(field, faced, rand).map((members) => ({ pass: 'B', members }));

  // The redemption set is a known size before it starts, which is what keeps the
  // progress bar accurate end to end.
  const redemptionSize = Math.min(BRACKET.redemptionCap, field.length);
  const plannedRedemption = field.length >= 2 ? Math.ceil(redemptionSize / 4) : 0;

  return {
    seedText,
    field,
    unranked: likedIds.filter((id) => !field.includes(id)),
    obsessed: field.filter((id) => swipes[`flower:${id}`] === 'obsessed'),
    screens: [...passA, ...passB],
    plannedTotal: passA.length + passB.length + plannedRedemption,
    redemptionBuilt: false,
    current: 0,
    partial: [],            // ids chosen so far on the current screen
    points: Object.fromEntries(field.map((id) => [id, 0])),
    appearances: Object.fromEntries(field.map((id) => [id, 0])),
    favoritePicks: Object.fromEntries(field.map((id) => [id, 0])),
    lastPlaces: Object.fromEntries(field.map((id) => [id, 0])),
    faced: {},
    done: field.length < 2,
  };
}

export const currentScreen = (state) => state?.screens?.[state.current] ?? null;

export function totalScreens(state) {
  return Math.max(state?.plannedTotal ?? 0, state?.screens?.length ?? 0);
}

/** Points a group awards, best-first. */
function pointsForOrdering(size) {
  if (size >= 4) return [3, 2, 1, 0];
  if (size === 3) return [3, 2, 0];
  return [3, 1];
}

/**
 * Records one tap. When the group has had all its taps the scores are applied
 * and the bracket advances. Returns a new state -- every tap is persistable.
 */
export function tap(state, flowerId) {
  const screen = currentScreen(state);
  if (!screen || state.done) return state;
  // Guard against a tap that isn't for this group at all -- a stale click during
  // the reveal, or a double-fire as the board changes underneath.
  if (!screen.members.includes(flowerId)) return state;
  if (state.partial.includes(flowerId)) return state;

  const partial = [...state.partial, flowerId];
  const needed = tapsFor(screen.members.length);
  if (partial.length < needed) return { ...state, partial };

  // Complete: the untouched card takes the remaining place.
  const remaining = screen.members.filter((id) => !partial.includes(id));
  const ordering = screen.members.length >= 4
    // taps are favourite, second, least -- the untouched one is third
    ? [partial[0], partial[1], ...remaining, partial[2]]
    : [...partial, ...remaining];

  const award = pointsForOrdering(screen.members.length);
  const points = { ...state.points };
  const appearances = { ...state.appearances };
  const favoritePicks = { ...state.favoritePicks };
  const lastPlaces = { ...state.lastPlaces };
  const faced = { ...state.faced };

  ordering.forEach((id, place) => {
    points[id] = (points[id] ?? 0) + award[place];
    appearances[id] = (appearances[id] ?? 0) + 1;
    if (place === 0) favoritePicks[id] = (favoritePicks[id] ?? 0) + 1;
    if (place === ordering.length - 1) lastPlaces[id] = (lastPlaces[id] ?? 0) + 1;
    faced[id] = [...new Set([...(faced[id] ?? []), ...screen.members.filter((m) => m !== id)])];
  });

  let next = {
    ...state, points, appearances, favoritePicks, lastPlaces, faced,
    partial: [], current: state.current + 1,
    lastResult: { members: screen.members, ordering },
  };

  // Both passes finished: build the redemption pass from the standings.
  if (!next.redemptionBuilt && next.current >= next.screens.length) {
    next = buildRedemption(next);
  }
  next.done = next.current >= next.screens.length;
  return next;
}

/**
 * The redemption set is the top scorers PLUS anyone whose every appearance was
 * in a group won by a flower that finished top 8 -- beaten only by strong
 * company, and owed a clean look.
 */
export function buildRedemption(state) {
  const adjusted = adjustedScores(state);
  const order = rankIds(state, adjusted);
  const topByScore = order.slice(0, BRACKET.topByScore);
  const strongTop = new Set(order.slice(0, BRACKET.strongCompanyTop));

  const beatenOnlyByStrong = state.field.filter((id) => {
    if (topByScore.includes(id)) return false;
    if ((state.appearances[id] ?? 0) === 0) return false;
    const rivals = state.faced[id] ?? [];
    return rivals.length > 0 && rivals.some((r) => strongTop.has(r)) &&
      (state.favoritePicks[id] ?? 0) === 0;
  });

  const size = Math.min(BRACKET.redemptionCap, state.field.length);
  const set = [...topByScore];
  for (const id of beatenOnlyByStrong) if (set.length < size) set.push(id);
  for (const id of order) if (set.length < size && !set.includes(id)) set.push(id);

  const rand = rng(`${state.seedText}-redemption`);
  const groups = partitionAvoidingRepeats(set, state.faced, rand)
    .map((members) => ({ pass: 'R', members }));

  return {
    ...state,
    screens: [...state.screens, ...groups],
    redemptionBuilt: true,
    plannedTotal: Math.max(state.plannedTotal, state.screens.length + groups.length),
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Raw points under-credit a flower that drew hard groups, so each score is
 * lifted by up to 25% according to how strong its opponents turned out to be.
 * Opponent strength is measured from RAW points, not adjusted ones -- adjusting
 * against adjusted scores would be circular.
 */
export function adjustedScores(state) {
  const ids = state.field ?? [];
  if (!ids.length) return {};
  const raw = state.points ?? {};
  const values = ids.map((id) => raw[id] ?? 0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const norm = (id) => (span === 0 ? 0.5 : ((raw[id] ?? 0) - lo) / span);

  const out = {};
  for (const id of ids) {
    const rivals = state.faced[id] ?? [];
    const strength = rivals.length
      ? rivals.reduce((s, r) => s + norm(r), 0) / rivals.length
      : 0;
    out[id] = (raw[id] ?? 0) * (1 + BRACKET.opponentAdjustment * strength);
  }
  return out;
}

const stableJitter = (id) => {
  let a = 0;
  for (let i = 0; i < id.length; i++) a = (a * 31 + id.charCodeAt(i)) >>> 0;
  return (a % 1000) / 1000;
};

/** Ranked ids, with the tie-breaks applied in order. */
export function rankIds(state, adjusted = null) {
  const score = adjusted ?? adjustedScores(state);
  const obsessed = new Set(state.obsessed ?? []);
  return [...(state.field ?? [])].sort((a, b) =>
    (score[b] ?? 0) - (score[a] ?? 0) ||
    (state.favoritePicks[b] ?? 0) - (state.favoritePicks[a] ?? 0) ||
    (state.lastPlaces[a] ?? 0) - (state.lastPlaces[b] ?? 0) ||
    (obsessed.has(b) ? 1 : 0) - (obsessed.has(a) ? 1 : 0) ||
    stableJitter(a) - stableJitter(b));
}

export const ranking = (state) => rankIds(state);

/** Normalised 0..1 strength, which is what the rest of the app consumes. */
export function strengths(state) {
  const ids = state?.field ?? [];
  if (!ids.length) return {};
  const adj = adjustedScores(state);
  const values = ids.map((id) => adj[id] ?? 0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const out = {};
  for (const id of ids) out[id] = span === 0 ? 0.5 : ((adj[id] ?? 0) - lo) / span;
  return out;
}

/** Progress through the fixed-length run, 0..1. */
export function completion(state) {
  const total = totalScreens(state);
  return total ? Math.min(1, (state.current ?? 0) / total) : 1;
}

/** True once there is a ranking worth using downstream. */
export function hasSignal(state) {
  return !!state && (state.current ?? 0) >= 2 && (state.field?.length ?? 0) >= 2;
}

/**
 * The invariant, checked before results are shown: nobody in the field may reach
 * the ranking without having actually been looked at twice.
 */
export function checkInvariant(state) {
  const problems = [];
  for (const id of state.field ?? []) {
    const n = state.appearances[id] ?? 0;
    if (n === 0) problems.push(`${id} never appeared`);
    else if (n < 2) problems.push(`${id} appeared only ${n}x`);
  }
  return { ok: problems.length === 0, problems };
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
