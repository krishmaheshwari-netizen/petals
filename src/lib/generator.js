// Bouquet generator.
//
// Takes the four preference signals plus the manual preferences and proposes
// arrangements she has not already seen. The order of operations matters and is
// the whole point of this file:
//
//     1. exclude    manual dislikes and never-colours are removed outright
//     2. FILTER     hard design constraints reject candidate combinations
//     3. rank       only survivors are scored against her preferences
//
// A flower she loved that cannot satisfy the constraints is EXCLUDED and
// reported, not quietly squeezed in.

import { hueFamily, isNeutral, satisfiesPalette, anyClash } from './color.js';
import { scoreOf, preferred, likedPriceTier } from './scoring.js';

// How many stems of each role a style wants, and what kind of filler suits it.
const STYLE_RECIPES = {
  'minimal-single-variety': { focal: [1, 1], secondary: [0, 0], filler: [0, 1], density: 'airy', counts: { focal: 5, secondary: 0, filler: 3 } },
  'structured-round': { focal: [1, 1], secondary: [1, 2], filler: [1, 1], density: 'dense', counts: { focal: 5, secondary: 5, filler: 6 } },
  'loose-garden': { focal: [1, 2], secondary: [1, 2], filler: [1, 2], density: 'airy', counts: { focal: 4, secondary: 5, filler: 6 } },
  'asymmetric': { focal: [1, 2], secondary: [1, 1], filler: [1, 2], density: 'airy', counts: { focal: 3, secondary: 4, filler: 5 } },
  'wildflower': { focal: [1, 1], secondary: [2, 2], filler: [1, 2], density: 'airy', counts: { focal: 3, secondary: 6, filler: 7 } },
  'cascading': { focal: [1, 1], secondary: [1, 2], filler: [1, 2], density: 'dense', counts: { focal: 4, secondary: 4, filler: 7 } },
};

const WRAP_FOR_STYLE = {
  'minimal-single-variety': 'clear',
  'structured-round': 'ribbon-tied',
  'loose-garden': 'kraft',
  'asymmetric': 'vase',
  'wildflower': 'kraft',
  'cascading': 'vase',
};

const UNIT_PRICE = { 1: 4, 2: 8, 3: 15 }; // rough per-stem retail, USD

const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// ---------------------------------------------------------------------------
// Constraint 1 -- seasonal overlap
// ---------------------------------------------------------------------------
function sharedSeasons(stems) {
  return SEASONS.filter((s) => stems.every((f) => f.seasons.includes(s)));
}

// ---------------------------------------------------------------------------
// Constraint 4 -- texture contrast
// ---------------------------------------------------------------------------
// Two varieties with the same form read as a mistake at arm's length. Fillers
// are exempt from each other (two feathery greens are fine together) but a
// filler may not duplicate the form of a focal.
function hasTextureContrast(focals, secondaries, fillers) {
  const headline = [...focals, ...secondaries];
  const forms = headline.map((f) => f.form);
  if (new Set(forms).size !== forms.length) return false;
  const focalForms = new Set(focals.map((f) => f.form));
  if (fillers.some((f) => focalForms.has(f.form) && f.form !== 'cluster')) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Colour assignment -- picks one colour per stem from its orderable range
// ---------------------------------------------------------------------------
// Greedy, in score order: the focal takes her best-loved colour, then each
// following stem takes whichever of its available colours keeps the palette
// legal. This is what lets two flowers she likes appear together in a shade that
// works, rather than in the shades that happened to be photographed.
//
// When none of a stem's favoured colours will sit with what is already in the
// vase, we do not drop the arrangement immediately -- we look through the same
// stem's range for a neutral, which is a florist's standard move for exactly
// this situation (the higher-scoring flower keeps its colour, and the one that
// fought it comes in cream or silver instead). Only if there is no such bridge
// is the combination rejected, and the flower then gets reported as excluded.
function assignColours(stems, paletteType, scores) {
  const hueScore = (hex) => scoreOf(scores, `hue:${hueFamily(hex)}`);
  const chosen = [];

  const fits = (hex) => {
    const trial = [...chosen.map((c) => c.hex), hex];
    if (anyClash(trial)) return false;
    return trial.length <= 1 || satisfiesPalette(trial, paletteType);
  };

  for (const stem of stems) {
    const byPreference = [...stem.colors].sort((a, b) => hueScore(b.hex) - hueScore(a.hex));

    // First choice: her favourite colour for this flower that still works.
    let picked = byPreference.find((opt) => fits(opt.hex));

    // Fallback: a neutral from the same flower's range, as a tonal bridge.
    if (!picked) {
      picked = byPreference.filter((opt) => isNeutral(opt.hex)).find((opt) => fits(opt.hex));
    }

    if (!picked) return null;
    chosen.push({ stem, ...picked });
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Candidate assembly
// ---------------------------------------------------------------------------
const combinations = (arr, k) => {
  if (k === 0) return [[]];
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest]);
  }
  return out;
};

function stemScore(flower, scores) {
  let s = scoreOf(scores, `stem:${flower.id}`) * 3;
  s += scoreOf(scores, `form:${flower.form}`);
  s += scoreOf(scores, `scent:${flower.scent}`) * 0.6;
  for (const v of flower.vibeTags) s += scoreOf(scores, `vibe:${v}`) * 0.4;
  s += scoreOf(scores, `hue:${hueFamily(flower.imageHex)}`) * 0.8;
  return s;
}

function fillerScore(flower, scores, wantedDensity) {
  let s = scoreOf(scores, `filler:${flower.id}`) * 3;
  for (const v of flower.vibeTags) s += scoreOf(scores, `fillerVibe:${v}`) * 0.5;
  if (flower.vibeTags.includes(wantedDensity)) s += 1.2;
  s += scoreOf(scores, `density:${wantedDensity}`) * 0.8;
  return s;
}

/**
 * Applies the manual preferences as hard exclusions. These override swipe scores
 * completely -- if she wrote down that she hates carnations, no amount of
 * right-swiping on carnation-adjacent bouquets brings them back.
 */
function applyManualExclusions(pool, prefs) {
  const dislikedIds = new Set(prefs.dislikedFlowerIds ?? []);
  const bannedFamilies = new Set(prefs.neverColors ?? []);
  const scentSensitive = prefs.scentSensitivity === 'sensitive' || prefs.scentSensitivity === 'allergic';

  const excluded = [];
  const kept = pool.filter((f) => {
    if (dislikedIds.has(f.id)) {
      excluded.push({ flower: f, reason: 'you told me you actively dislike this one' });
      return false;
    }
    if (scentSensitive && (f.scent === 'sweet' || f.scent === 'spicy')) {
      excluded.push({ flower: f, reason: 'strongly scented, and you flagged a scent sensitivity' });
      return false;
    }
    // A flower is only banned on colour if EVERY colour it comes in is banned.
    const usable = f.colors.filter((c) => !bannedFamilies.has(hueFamily(c.hex)));
    if (bannedFamilies.size && usable.length === 0) {
      excluded.push({ flower: f, reason: `only comes in colours you ruled out` });
      return false;
    }
    return true;
  }).map((f) => {
    if (!bannedFamilies.size) return f;
    return { ...f, colors: f.colors.filter((c) => !bannedFamilies.has(hueFamily(c.hex))) };
  });

  return { kept, excluded };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export function generateBouquets({
  flowers, fillers, deck, swipes, scores, prefs = {}, seenBouquets = [], count = 4,
}) {
  const notes = [];

  // ---- her targets -------------------------------------------------------
  const paletteType = preferred(scores, 'palette', 'paletteType', 'analogous');
  const style = preferred(scores, 'style', 'style', 'loose-garden');
  const recipe = STYLE_RECIPES[style] ?? STYLE_RECIPES['loose-garden'];
  const density = preferred(scores, 'filler', 'density', recipe.density);
  const avgTier = likedPriceTier(deck, swipes);
  const budgetCap = prefs.maxBudget ? Number(prefs.maxBudget) : null;

  // ---- exclusions --------------------------------------------------------
  const flowerPool = applyManualExclusions(flowers, prefs);
  const fillerPool = applyManualExclusions(fillers, prefs);
  const manualExclusions = [...flowerPool.excluded, ...fillerPool.excluded];

  const focalPool = flowerPool.kept
    .filter((f) => f.scale === 'focal')
    .sort((a, b) => stemScore(b, scores) - stemScore(a, scores))
    .slice(0, 10);
  const secondaryPool = flowerPool.kept
    .filter((f) => f.scale === 'secondary')
    .sort((a, b) => stemScore(b, scores) - stemScore(a, scores))
    .slice(0, 14);
  const greenPool = fillerPool.kept
    .sort((a, b) => fillerScore(b, scores, density) - fillerScore(a, scores, density))
    .slice(0, 10);

  // Everything we would like to use, so we can report what got dropped and why.
  const wanted = new Set([
    ...focalPool.slice(0, 4).map((f) => f.id),
    ...secondaryPool.slice(0, 4).map((f) => f.id),
  ]);
  const used = new Set();
  const rejectionReasons = new Map();
  const noteRejection = (ids, reason) => {
    for (const id of ids) if (!rejectionReasons.has(id)) rejectionReasons.set(id, reason);
  };

  // ---- candidate generation ---------------------------------------------
  const candidates = [];
  const focalSets = [];
  for (let k = recipe.focal[0]; k <= recipe.focal[1]; k++) {
    focalSets.push(...combinations(focalPool.slice(0, 7), k));
  }

  for (const focals of focalSets) {
    const secondarySets = [];
    for (let k = recipe.secondary[0]; k <= recipe.secondary[1]; k++) {
      secondarySets.push(...combinations(secondaryPool.slice(0, 8), k));
    }
    for (const secondaries of secondarySets) {
      const headline = [...focals, ...secondaries];

      // -- Constraint 2: scale hierarchy (never all-focal, never all-filler) --
      if (focals.length === 0 || focals.length > 2) continue;
      if (headline.length > 4) continue;

      // -- Constraint 4: texture contrast (checked early, it's cheap) --------
      if (new Set(headline.map((f) => f.form)).size !== headline.length) {
        noteRejection(headline.map((f) => f.id), 'texture');
        continue;
      }

      // -- Constraint 1: seasonal overlap ------------------------------------
      const headlineSeasons = sharedSeasons(headline);
      if (!headlineSeasons.length) {
        noteRejection(headline.map((f) => f.id), 'season');
        continue;
      }

      const fillerSets = [];
      for (let k = Math.max(1, recipe.filler[0]); k <= recipe.filler[1]; k++) {
        fillerSets.push(...combinations(greenPool.slice(0, 6), k));
      }
      if (recipe.filler[0] === 0) fillerSets.push([]);

      for (const greens of fillerSets) {
        const all = [...headline, ...greens];
        if (!greens.length && recipe.filler[0] > 0) continue;

        // -- Constraint 1 again, now including the greenery -------------------
        const seasons = sharedSeasons(all);
        if (!seasons.length) { noteRejection(greens.map((f) => f.id), 'season'); continue; }

        // -- Constraint 4, fillers vs focals ----------------------------------
        if (!hasTextureContrast(focals, secondaries, greens)) {
          noteRejection(greens.map((f) => f.id), 'texture');
          continue;
        }

        // -- Constraint 3: palette coherence ----------------------------------
        const assignment = assignColours(all, paletteType, scores);
        if (!assignment) { noteRejection(headline.map((f) => f.id), 'palette'); continue; }
        const hexes = assignment.map((a) => a.hex);
        if (anyClash(hexes)) { noteRejection(headline.map((f) => f.id), 'palette'); continue; }
        if (!satisfiesPalette(hexes, paletteType)) {
          noteRejection(headline.map((f) => f.id), 'palette');
          continue;
        }

        // -- Constraint 5: price coherence -------------------------------------
        const tierAvg = all.reduce((s, f) => s + f.priceTier, 0) / all.length;
        if (Math.abs(tierAvg - avgTier) > 1) {
          noteRejection(all.map((f) => f.id), 'price');
          continue;
        }

        const stems = buildStemList(focals, secondaries, greens, assignment, recipe);
        const price = priceBand(stems);
        if (budgetCap && price.low > budgetCap) {
          noteRejection(all.map((f) => f.id), 'budget');
          continue;
        }

        candidates.push({
          focals, secondaries, greens, assignment, hexes, seasons, stems, price,
          score:
            focals.reduce((s, f) => s + stemScore(f, scores), 0) * 1.4 +
            secondaries.reduce((s, f) => s + stemScore(f, scores), 0) +
            greens.reduce((s, f) => s + fillerScore(f, scores, density), 0) * 0.8 +
            scoreOf(scores, `paletteType:${paletteType}`) +
            scoreOf(scores, `style:${style}`),
        });
      }
    }
  }

  // ---- rank and diversify -------------------------------------------------
  candidates.sort((a, b) => b.score - a.score);
  // Anything she has already swiped on in the deck is not a recommendation, and
  // that stays true in BOTH passes -- this set is never added to.
  const deckSignatures = new Set(
    seenBouquets.map((b) => [...b.focalIds].sort().join('+')),
  );
  const focalSig = (c) => c.focals.map((f) => f.id).sort().join('+');
  // The headline is what someone actually sees: the focal and secondary flowers.
  // Two arrangements that differ only in their greenery are the same bouquet as
  // far as she is concerned, and offering both wastes a recommendation slot.
  const headlineSig = (c) =>
    [...c.focals, ...c.secondaries].map((f) => f.id).sort().join('+');

  const picked = [];
  const usedFocals = new Set();
  const takenHeadlines = new Set();

  const take = (c) => {
    takenHeadlines.add(headlineSig(c));
    for (const f of c.focals) usedFocals.add(f.id);
    for (const f of [...c.focals, ...c.secondaries, ...c.greens]) used.add(f.id);
    picked.push(c);
  };

  // Pass 1: strictest -- a focal variety appears in at most one recommendation,
  // so the set she is shown doesn't look like four takes on the same idea.
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (deckSignatures.has(focalSig(c))) continue;
    if (c.focals.some((f) => usedFocals.has(f.id))) continue;
    take(c);
  }

  // Pass 2: the constraints can be tight enough that focal diversity alone
  // cannot reach three. Allow a focal to repeat, but only where the headline
  // flowers genuinely differ, and still never one she has already seen.
  //
  // This tops up to three and no further, on purpose. Three genuinely different
  // arrangements are worth more than five that are all the same focal flower with
  // the greenery swapped -- a padded list reads as a machine filling a quota.
  if (picked.length < Math.min(count, 3)) {
    const target = Math.min(count, 3);
    // Least-used focal first, so the top-up spreads across flowers rather than
    // stacking more variants onto whichever one already won.
    const byNovelty = [...candidates].sort((a, b) => {
      const usedA = a.focals.filter((f) => usedFocals.has(f.id)).length;
      const usedB = b.focals.filter((f) => usedFocals.has(f.id)).length;
      return usedA - usedB || b.score - a.score;
    });
    for (const c of byNovelty) {
      if (picked.length >= target) break;
      if (deckSignatures.has(focalSig(c))) continue;
      if (takenHeadlines.has(headlineSig(c))) continue;
      take(c);
    }
  }

  // ---- report what we had to leave out ------------------------------------
  // Excluded flowers are grouped by the reason they were dropped. Three roses
  // rejected for the same texture clash should be one sentence naming all three,
  // not the same sentence printed three times.
  const REASON_TEXT = {
    season: (names, sample) =>
      `${names} ${plural(sample)} only really around in ${sample.seasons.join(' and ')}, and nothing else in the palette you kept picking overlaps with that — worth ordering on ${own(sample)}, in season.`,
    texture: (names, sample) =>
      `${names} ${plural(sample)} ${formPhrase(sample.form)}, and so is the flower already carrying these arrangements — two of the same shape in one bunch reads flat, so ${names === sample.commonName ? 'it is' : 'they are'} worth buying on ${own(sample)}.`,
    palette: (names, sample) =>
      `You loved ${names.toLowerCase()}, but ${plural(sample) === 'is' ? 'its' : 'their'} colours don't sit well with the ${describePalette(paletteType)} you kept picking — worth buying on ${own(sample)}.`,
    price: (names, sample) =>
      `${names} ${plural(sample)} a long way off the price level of everything else you liked, which would make the bunch look unbalanced as much as expensive.`,
    budget: (names, sample) =>
      `${names} ${plural(sample)} what pushes the bunch past the budget you set.`,
  };

  const byReason = new Map();
  for (const id of wanted) {
    if (used.has(id)) continue;
    const flower = [...flowers, ...fillers].find((f) => f.id === id);
    if (!flower) continue;
    if (manualExclusions.some((e) => e.flower.id === id)) continue;
    const reason = rejectionReasons.get(id) ?? 'palette';
    // A texture rejection is explained in terms of the flower's shape, and a
    // seasonal one in terms of its season, so those group by that detail too --
    // otherwise one sentence ends up describing flowers it doesn't fit.
    const key = reason === 'texture' ? `texture:${flower.form}`
      : reason === 'season' ? `season:${flower.seasons.join(',')}`
      : reason;
    if (!byReason.has(key)) byReason.set(key, { reason, group: [] });
    byReason.get(key).group.push(flower);
  }

  const designExclusions = [...byReason.values()].map(({ reason, group }) => {
    const names = joinNames(group.map((f) => f.commonName));
    const sample = { ...group[0], plural: group.length > 1 };
    return {
      reason,
      flowers: group,
      flower: group[0],
      text: (REASON_TEXT[reason] ?? REASON_TEXT.palette)(names, sample),
    };
  });

  const bouquets = picked.map((c, i) => finaliseBouquet(c, { style, paletteType, density, index: i }));

  // Two arrangements can legitimately land on the same generated name (same
  // focal, same colour family). Names are how she tells them apart, so any
  // collision is broken using the flower that actually differs between them.
  const takenNames = new Set();
  for (const b of bouquets) {
    if (!takenNames.has(b.name)) { takenNames.add(b.name); continue; }
    const alternatives = [...b.secondaryIds, ...b.fillerIds]
      .map((id) => [...flowers, ...fillers].find((f) => f.id === id))
      .filter(Boolean)
      .map((f) => `${b.name} & ${f.commonName}`);
    // Walk the arrangement's other flowers until one yields an unused name.
    let resolved = alternatives.find((n) => !takenNames.has(n));
    for (let n = 2; !resolved; n++) {
      if (!takenNames.has(`${b.name} No.${n}`)) resolved = `${b.name} No.${n}`;
    }
    b.name = resolved;
    takenNames.add(resolved);
  }

  // Only surface a manual exclusion when she actually liked the thing -- telling
  // her that a flower she never swiped on was ruled out is noise, and a
  // scent-sensitivity flag alone would otherwise list thirty names.
  const notableManual = manualExclusions
    .filter((e) => stemScore(e.flower, scores) > 0)
    .sort((a, b) => stemScore(b.flower, scores) - stemScore(a.flower, scores))
    .slice(0, 4);

  return {
    bouquets,
    targets: { paletteType, style, density, avgTier },
    exclusions: {
      manual: notableManual,
      manualCount: manualExclusions.length,
      design: designExclusions.slice(0, 4),
    },
    notes,
    candidateCount: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Stem lists, pricing and copy
// ---------------------------------------------------------------------------
function buildStemList(focals, secondaries, greens, assignment, recipe) {
  const colourOf = (id) => assignment.find((a) => a.stem.id === id);
  const rows = [];
  const share = (base, n) => Math.max(2, Math.round(base / Math.max(1, n)) + (n > 1 ? 1 : 0));

  for (const f of focals) {
    rows.push({
      id: f.id, name: f.commonName, scientificName: f.scientificName, role: 'focal',
      count: share(recipe.counts.focal, focals.length),
      color: colourOf(f.id)?.name ?? f.colors[0].name,
      hex: colourOf(f.id)?.hex ?? f.colors[0].hex,
      priceTier: f.priceTier,
    });
  }
  for (const f of secondaries) {
    rows.push({
      id: f.id, name: f.commonName, scientificName: f.scientificName, role: 'secondary',
      count: share(recipe.counts.secondary, secondaries.length),
      color: colourOf(f.id)?.name ?? f.colors[0].name,
      hex: colourOf(f.id)?.hex ?? f.colors[0].hex,
      priceTier: f.priceTier,
    });
  }
  for (const f of greens) {
    rows.push({
      id: f.id, name: f.commonName, scientificName: f.scientificName, role: 'filler',
      count: share(recipe.counts.filler, greens.length),
      color: colourOf(f.id)?.name ?? f.colors[0].name,
      hex: colourOf(f.id)?.hex ?? f.colors[0].hex,
      priceTier: f.priceTier,
    });
  }
  return rows;
}

function priceBand(stems) {
  const base = stems.reduce((s, r) => s + r.count * (UNIT_PRICE[r.priceTier] ?? 8), 0);
  const withLabour = base * 1.35; // florist mark-up for arranging and wrapping
  return {
    low: Math.round(withLabour * 0.85 / 5) * 5,
    high: Math.round(withLabour * 1.2 / 5) * 5,
  };
}

const describePalette = (t) => ({
  monochrome: 'single-colour palette',
  analogous: 'soft neighbouring palette',
  complementary: 'opposite-colour palette',
  'neutral-plus-accent': 'mostly-neutral palette',
  'high-contrast': 'high-contrast palette',
}[t] ?? 'palette');

const describeStyle = (t) => ({
  'loose-garden': 'loose garden style',
  'structured-round': 'structured round shape',
  asymmetric: 'asymmetric shape',
  wildflower: 'wildflower looseness',
  'minimal-single-variety': 'minimal single-variety treatment',
  cascading: 'cascading shape',
}[t] ?? t);

function finaliseBouquet(c, { style, paletteType, density, index }) {
  const wrap = WRAP_FOR_STYLE[style] ?? 'kraft';
  const focalNames = c.focals.map((f) => f.commonName.toLowerCase());
  const name = generateName(c, paletteType);

  return {
    id: `gen-${index}-${c.focals.map((f) => f.id).join('-')}`,
    generated: true,
    name,
    focalIds: c.focals.map((f) => f.id),
    secondaryIds: c.secondaries.map((f) => f.id),
    fillerIds: c.greens.map((f) => f.id),
    paletteHexes: dedupeHexes(c.hexes).slice(0, 4),
    paletteType,
    style,
    wrap,
    priceTier: Math.round(
      [...c.focals, ...c.secondaries, ...c.greens].reduce((s, f) => s + f.priceTier, 0) /
      (c.focals.length + c.secondaries.length + c.greens.length),
    ),
    seasons: c.seasons,
    stems: c.stems,
    price: c.price,
    blurb: `${capitalise(focalNames[0])} carried in a ${describeStyle(style)}, ${wrap === 'vase' ? 'arranged in a vase' : `wrapped ${wrap === 'kraft' ? 'in kraft paper' : wrap === 'clear' ? 'in clear cellophane' : 'and ribbon-tied'}`}.`,
    why: whyThisWorks(c, { style, paletteType, density }),
    orderText: orderText(c, wrap),
  };
}

function dedupeHexes(hexes) {
  const out = [];
  for (const h of hexes) if (!out.some((o) => o.toLowerCase() === h.toLowerCase())) out.push(h);
  return out;
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A", "A and B", "A, B and C" */
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const plural = (sample) => (sample.plural ? 'are' : 'is');
const own = (sample) => (sample.plural ? 'their own' : 'its own');

/** The one-line design rationale shown under each generated bouquet. */
function whyThisWorks(c, { paletteType, density }) {
  const parts = [];
  const focal = c.focals[0];
  const secondary = c.secondaries[0];
  const green = c.greens[0];

  if (secondary) {
    parts.push(
      `The ${focal.commonName.toLowerCase()} is ${formPhrase(focal.form)} and the ${secondary.commonName.toLowerCase()} is ${formPhrase(secondary.form)}, so they read as two different textures instead of competing`,
    );
  } else {
    parts.push(`One variety only, which is what makes ${formPhrase(focal.form)} shapes land`);
  }

  parts.push(`the colours stay inside a ${describePalette(paletteType)}`);

  if (green) {
    parts.push(
      `and the ${green.commonName.toLowerCase()} keeps it ${density === 'airy' ? 'open and airy rather than packed' : 'full rather than sparse'}`,
    );
  }

  const seasonWord = c.seasons.length === 4 ? 'available year round' : `all in season together in ${c.seasons.join(' and ')}`;
  return `${parts.join(', ')}. Every stem is ${seasonWord}.`;
}

const formPhrase = (form) => ({
  ruffled: 'soft and many-petalled',
  spiky: 'tall and spiked',
  star: 'flat and open-faced',
  bell: 'closed and cupped',
  cluster: 'made of many small heads',
  single: 'one clean disc',
  globe: 'a tight sphere',
}[form] ?? form);

/** Plain text for the florist's contact form. */
function orderText(c, wrap) {
  const lines = c.stems.map(
    (r) => `${r.count} ${r.name.toLowerCase()}${r.count > 1 ? '' : ''} in ${r.color}`,
  );
  const wrapText = {
    kraft: 'ribbon-tied in kraft paper',
    clear: 'wrapped in clear cellophane',
    'ribbon-tied': 'hand-tied with ribbon',
    vase: 'arranged in a simple clear vase',
  }[wrap];
  return `${lines.join(', ')}, ${wrapText}.`;
}

function generateName(c, paletteType) {
  const family = hueFamily(c.hexes[0]);
  const focal = c.focals[0].commonName;
  const NAMES = {
    blush: 'Blush', cream: 'Cream', peach: 'Peach', coral: 'Coral', red: 'Red',
    wine: 'Wine', rust: 'Rust', gold: 'Gold', bronze: 'Bronze', chartreuse: 'Chartreuse',
    green: 'Green', teal: 'Teal', blue: 'Blue', periwinkle: 'Periwinkle',
    violet: 'Violet', lilac: 'Lilac', magenta: 'Magenta', pink: 'Pink',
    silver: 'Silver', charcoal: 'Ink',
  };
  const colourWord = NAMES[family] ?? capitalise(family);
  if (paletteType === 'monochrome') return `${colourWord} on ${colourWord}`;
  if (paletteType === 'neutral-plus-accent') return `${colourWord} & Quiet`;
  return `${colourWord} ${focal}`;
}
