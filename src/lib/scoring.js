// Petals scoring.
//
// Four INDEPENDENT signals are tracked. They are deliberately never collapsed
// into a single "taste score", because liking a flower and liking the kind of
// arrangement it belongs in are different facts, and the generator needs both
// separately:
//
//   stem     which individual flowers, forms and scents she responds to
//   palette  which paletteTypes and which hue families
//   style    loose vs structured vs minimal vs cascading
//   filler   which greenery, and whether she leans airy or dense
//
// Every card contributes tags to one or more signals. A tag's score is
//
//     (weighted likes containing the tag) − (passes containing the tag)
//     ------------------------------------------------------------------
//                     normalise(times the tag appeared in the deck)
//
// The normalisation stops common tags (every deck has a lot of `form:ruffled`)
// from automatically beating rare ones.
//
// ---------------------------------------------------------------------------
// TUNING -- everything you'd want to fiddle with lives in this one object.
// ---------------------------------------------------------------------------
export const TUNING = {
  // Swipe weights. Up-swipe is "obsessed" and counts double, per the deck rules.
  weights: { obsessed: 2, love: 1, pass: -1 },

  // 'linear' divides by how often the tag appeared; 'sqrt' divides by its square
  // root, which is gentler and lets frequent tags retain some of their pull.
  // 'none' disables normalisation entirely.
  normalisation: 'sqrt',

  // A tag seen fewer times than this is too thin to trust and is held back from
  // the profile (it can still contribute to ranking, at reduced confidence).
  minObservations: 2,

  // How much a bouquet swipe teaches about the individual stems inside it.
  // Kept low: she is reacting to the whole arrangement, not to its components.
  bouquetToStemBleed: 0.35,

  // How much a flower swipe teaches about that flower's colour family.
  flowerToPaletteBleed: 0.7,
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function normalise(net, freq) {
  if (freq <= 0) return 0;
  switch (TUNING.normalisation) {
    case 'none': return net;
    case 'linear': return net / freq;
    case 'sqrt':
    default: return net / Math.sqrt(freq);
  }
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------
// A tag is a `namespace:value` string. The namespace decides which of the four
// signals it lands in, via SIGNAL_OF below.

const SIGNAL_OF = {
  stem: 'stem', form: 'stem', scent: 'stem', scale: 'stem', vibe: 'stem', price: 'stem',
  hue: 'palette', paletteType: 'palette',
  style: 'style', wrap: 'style',
  filler: 'filler', density: 'filler', fillerVibe: 'filler',
};

import { hueFamily } from './color.js';

/** Tags contributed by a single-flower or filler card. */
export function tagsForFlower(flower) {
  const tags = [
    `stem:${flower.id}`,
    `form:${flower.form}`,
    `scent:${flower.scent}`,
    `scale:${flower.scale}`,
    `price:${flower.priceTier}`,
  ];
  for (const v of flower.vibeTags) tags.push(`vibe:${v}`);

  // The colour she actually saw on the card carries more weight than the full
  // orderable range of the variety, so it goes in at full strength and the rest
  // of the range goes in too but will be diluted by frequency.
  tags.push(`hue:${hueFamily(flower.imageHex)}`);
  for (const c of flower.colors) tags.push(`hue:${hueFamily(c.hex)}`);

  if (flower.scale === 'filler') {
    tags.push(`filler:${flower.id}`);
    for (const v of flower.vibeTags) tags.push(`fillerVibe:${v}`);
    if (flower.vibeTags.includes('airy')) tags.push('density:airy');
    if (flower.vibeTags.includes('dense')) tags.push('density:dense');
  }
  return [...new Set(tags)];
}

/**
 * Tags contributed by a bouquet card. Palette, style and filler come through at
 * full strength; the individual stems inside bleed through only weakly, because
 * she is reacting to the composition.
 */
export function tagsForBouquet(bouquet, index) {
  const strong = [
    `paletteType:${bouquet.paletteType}`,
    `style:${bouquet.style}`,
    `wrap:${bouquet.wrap}`,
    `price:${bouquet.priceTier}`,
  ];
  for (const hex of bouquet.paletteHexes) strong.push(`hue:${hueFamily(hex)}`);
  for (const id of bouquet.fillerIds) strong.push(`filler:${id}`);

  // Density is inferred from the greenery the arrangement uses, which is the
  // only honest way to learn "airy vs dense" from a swipe on a whole bouquet.
  const fillers = bouquet.fillerIds.map((id) => index.byId[id]).filter(Boolean);
  const airy = fillers.filter((f) => f.vibeTags.includes('airy')).length;
  const dense = fillers.filter((f) => f.vibeTags.includes('dense')).length;
  if (airy > dense) strong.push('density:airy');
  else if (dense > airy) strong.push('density:dense');
  if (bouquet.style === 'minimal-single-variety' || bouquet.fillerIds.length === 0) {
    strong.push('density:airy');
  }
  for (const f of fillers) for (const v of f.vibeTags) strong.push(`fillerVibe:${v}`);

  const weak = [];
  for (const id of [...bouquet.focalIds, ...bouquet.secondaryIds]) {
    const f = index.byId[id];
    if (!f) continue;
    weak.push(`stem:${f.id}`, `form:${f.form}`, `scent:${f.scent}`);
    for (const v of f.vibeTags) weak.push(`vibe:${v}`);
  }
  return { strong: [...new Set(strong)], weak: [...new Set(weak)] };
}

/** Every tag a card contributes, with per-tag multipliers applied. */
export function tagsForCard(card, index) {
  if (card.type === 'bouquet') {
    const { strong, weak } = tagsForBouquet(card.data, index);
    return [
      ...strong.map((t) => ({ tag: t, mult: 1 })),
      ...weak.map((t) => ({ tag: t, mult: TUNING.bouquetToStemBleed })),
    ];
  }
  const tags = tagsForFlower(card.data);
  return tags.map((t) => ({
    tag: t,
    mult: t.startsWith('hue:') ? TUNING.flowerToPaletteBleed : 1,
  }));
}

// ---------------------------------------------------------------------------
// The score table
// ---------------------------------------------------------------------------

/**
 * @param {Array} deck    every card that was in the deck (for tag frequency)
 * @param {Object} swipes { [cardId]: 'love' | 'pass' | 'obsessed' }
 * @param {Object} index  { byId } lookup over flowers + fillers
 */
export function buildScores(deck, swipes, index) {
  const freq = new Map();      // tag -> how often it appeared in the deck at all
  const net = new Map();       // tag -> weighted likes minus passes
  const seen = new Map();      // tag -> how often it appeared on a *swiped* card

  for (const card of deck) {
    const contributions = tagsForCard(card, index);
    for (const { tag, mult } of contributions) {
      freq.set(tag, (freq.get(tag) ?? 0) + mult);
    }
    const verdict = swipes[card.id];
    if (!verdict) continue;
    const w = TUNING.weights[verdict] ?? 0;
    for (const { tag, mult } of contributions) {
      net.set(tag, (net.get(tag) ?? 0) + w * mult);
      seen.set(tag, (seen.get(tag) ?? 0) + mult);
    }
  }

  const signals = { stem: {}, palette: {}, style: {}, filler: {} };
  const meta = {};
  for (const [tag, n] of net) {
    const [ns] = tag.split(':');
    const signal = SIGNAL_OF[ns];
    if (!signal) continue;
    const value = normalise(n, freq.get(tag) ?? 1);
    signals[signal][tag] = value;
    meta[tag] = {
      raw: n,
      deckFrequency: freq.get(tag) ?? 0,
      observations: seen.get(tag) ?? 0,
      confident: (seen.get(tag) ?? 0) >= TUNING.minObservations,
    };
  }

  return { signals, meta, swipeCount: Object.keys(swipes).length };
}

/** Convenience: read one tag's score out of whichever signal owns it. */
export function scoreOf(scores, tag) {
  const [ns] = tag.split(':');
    const signal = SIGNAL_OF[ns];
  if (!signal) return 0;
  return scores.signals[signal][tag] ?? 0;
}

/** Top N entries of one signal, optionally restricted to a namespace. */
export function topTags(scores, signal, { namespace, limit = 5, confidentOnly = true } = {}) {
  return Object.entries(scores.signals[signal] ?? {})
    .filter(([tag]) => (namespace ? tag.startsWith(`${namespace}:`) : true))
    .filter(([tag]) => (confidentOnly ? scores.meta[tag]?.confident : true))
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, value]) => ({ tag, value: value, label: tag.split(':').slice(1).join(':') }));
}

/**
 * Her five favourite individual stems, ranked. Greenery is deliberately left out
 * -- filler is its own signal and gets its own line in the profile, so listing
 * eucalyptus among her favourite flowers would double-count it and crowd out an
 * actual bloom.
 */
export function topStems(scores, index, limit = 5) {
  return Object.entries(scores.signals.stem)
    .filter(([tag, v]) => tag.startsWith('stem:') && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, value]) => ({ flower: index.byId[tag.slice(5)], value }))
    .filter((x) => x.flower && x.flower.scale !== 'filler')
    .slice(0, limit);
}

/** Average priceTier across everything she liked -- drives price coherence. */
export function likedPriceTier(deck, swipes) {
  let sum = 0, n = 0;
  for (const card of deck) {
    const v = swipes[card.id];
    if (v !== 'love' && v !== 'obsessed') continue;
    const tier = card.data.priceTier;
    if (!tier) continue;
    const w = v === 'obsessed' ? 2 : 1;
    sum += tier * w; n += w;
  }
  return n ? sum / n : 2;
}

/** Her preferred value for a single-choice dimension, e.g. paletteType. */
export function preferred(scores, signal, namespace, fallback) {
  const top = topTags(scores, signal, { namespace, limit: 1, confidentOnly: false });
  return top.length && top[0].value > 0 ? top[0].label : fallback;
}

/** 0-1 confidence that we know anything at all yet. */
export function confidence(scores, deckSize) {
  return clamp01(scores.swipeCount / Math.max(1, Math.min(deckSize, 40)));
}
