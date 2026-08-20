// Headless check that the generator actually obeys its own hard constraints.
//
// Simulates several different tastes against the real data, then asserts every
// rule from the brief on every bouquet produced. Run with `npm run sanity`.
//
// This exists because the constraints are the whole value of the generator: a
// recommender that just stacks up her highest-scoring flowers would be worse
// than useless, and that failure is invisible from the UI.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScores } from '../src/lib/scoring.js';
import { generateBouquets } from '../src/lib/generator.js';
import { satisfiesPalette, anyClash, hueFamily } from '../src/lib/color.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const flowers = JSON.parse(readFileSync(join(DATA, 'flowers.json'), 'utf8'));
const fillers = JSON.parse(readFileSync(join(DATA, 'fillers.json'), 'utf8'));
const bouquets = JSON.parse(readFileSync(join(DATA, 'bouquets.json'), 'utf8'));

const byId = Object.fromEntries([...flowers, ...fillers].map((f) => [f.id, f]));
const INDEX = { byId };
const SEASONS = ['spring', 'summer', 'fall', 'winter'];

const deck = [
  ...flowers.map((f) => ({ id: `flower:${f.id}`, type: 'flower', data: f })),
  ...fillers.map((f) => ({ id: `filler:${f.id}`, type: 'filler', data: f })),
  ...bouquets.map((b) => ({ id: `bouquet:${b.id}`, type: 'bouquet', data: b })),
];

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) { failures++; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`); }
};

/** Swipes right on everything matching `predicate`, left on the rest. */
function simulate(predicate) {
  const swipes = {};
  let i = 0;
  for (const card of deck) {
    const likes = predicate(card);
    if (likes) swipes[card.id] = i++ % 3 === 0 ? 'obsessed' : 'love';
    else swipes[card.id] = 'pass';
  }
  return swipes;
}

const PROFILES = {
  'soft romantic (blush, ruffled, loose garden)': (card) => {
    const d = card.data;
    if (card.type === 'bouquet') {
      return ['loose-garden', 'structured-round'].includes(d.style) &&
        ['monochrome', 'analogous', 'neutral-plus-accent'].includes(d.paletteType);
    }
    return ['ruffled', 'cluster'].includes(d.form) ||
      ['blush', 'cream', 'peach'].includes(hueFamily(d.imageHex));
  },
  'modern graphic (bold, structural, high contrast)': (card) => {
    const d = card.data;
    if (card.type === 'bouquet') {
      return ['asymmetric', 'minimal-single-variety'].includes(d.style) ||
        ['high-contrast', 'complementary'].includes(d.paletteType);
    }
    return ['spiky', 'globe', 'single'].includes(d.form) ||
      d.vibeTags.some((v) => ['architectural', 'graphic', 'sculptural', 'modern'].includes(v));
  },
  'meadow / wildflower': (card) => {
    const d = card.data;
    if (card.type === 'bouquet') return ['wildflower', 'loose-garden'].includes(d.style);
    return d.vibeTags.some((v) => ['meadow', 'wildflower', 'airy', 'cottage'].includes(v));
  },
  'cool blues and purples': (card) => {
    const d = card.data;
    if (card.type === 'bouquet') return d.paletteHexes.some((h) => ['blue', 'violet', 'periwinkle', 'lilac'].includes(hueFamily(h)));
    return ['blue', 'violet', 'periwinkle', 'lilac', 'green', 'silver'].includes(hueFamily(d.imageHex));
  },
};

const PREFS_CASES = {
  'no manual prefs': {},
  'hard exclusions': {
    dislikedFlowerIds: [flowers[0].id, flowers[1].id],
    neverColors: ['gold', 'chartreuse', 'rust'],
    scentSensitivity: 'allergic',
    maxBudget: '200',
  },
};

console.log(`Data: ${flowers.length} flowers, ${fillers.length} fillers, ${bouquets.length} bouquets\n`);

for (const [profileName, predicate] of Object.entries(PROFILES)) {
  for (const [prefsName, prefs] of Object.entries(PREFS_CASES)) {
    const swipes = simulate(predicate);
    const scores = buildScores(deck, swipes, INDEX);
    const res = generateBouquets({
      flowers, fillers, deck, swipes, scores, prefs,
      seenBouquets: bouquets, count: 5,
    });

    console.log(`${profileName}  [${prefsName}]`);
    console.log(`  target: ${res.targets.paletteType} / ${res.targets.style} / ${res.targets.density} · ${res.candidateCount} valid candidates · ${res.bouquets.length} shown`);

    check('produced at least one bouquet', res.bouquets.length > 0);

    for (const b of res.bouquets) {
      const stems = [...b.focalIds, ...b.secondaryIds, ...b.fillerIds].map((id) => byId[id]);
      const tag = `${b.name}`;

      // 1. seasonal overlap
      const shared = SEASONS.filter((s) => stems.every((f) => f.seasons.includes(s)));
      check(`[${tag}] seasonal overlap`, shared.length > 0);

      // 2. scale hierarchy
      check(`[${tag}] 1-2 focal`, b.focalIds.length >= 1 && b.focalIds.length <= 2, `got ${b.focalIds.length}`);
      check(`[${tag}] <=2 secondary`, b.secondaryIds.length <= 2);
      check(`[${tag}] <=2 filler`, b.fillerIds.length <= 2);
      check(`[${tag}] not all-focal`,
        b.style === 'minimal-single-variety' || b.secondaryIds.length + b.fillerIds.length > 0);
      check(`[${tag}] not all-filler`, b.focalIds.length > 0);
      check(`[${tag}] focals really are focal`,
        b.focalIds.every((id) => byId[id].scale === 'focal'));
      check(`[${tag}] fillers really are filler`,
        b.fillerIds.every((id) => byId[id].scale === 'filler'));

      // 3. palette coherence
      const hexes = b.stems.map((s) => s.hex);
      check(`[${tag}] palette is ${b.paletteType}`, satisfiesPalette(hexes, b.paletteType), hexes.join(' '));
      check(`[${tag}] no clashing hues`, !anyClash(hexes), hexes.join(' '));

      // 4. texture contrast
      const headline = [...b.focalIds, ...b.secondaryIds].map((id) => byId[id].form);
      check(`[${tag}] no duplicate form`, new Set(headline).size === headline.length, headline.join(','));

      // 5. price coherence
      const tierAvg = stems.reduce((s, f) => s + f.priceTier, 0) / stems.length;
      check(`[${tag}] price within one step`, Math.abs(tierAvg - res.targets.avgTier) <= 1,
        `bouquet ${tierAvg.toFixed(2)} vs liked ${res.targets.avgTier.toFixed(2)}`);

      // 6. manual exclusions really are hard
      for (const id of prefs.dislikedFlowerIds ?? []) {
        check(`[${tag}] excludes disliked ${id}`, !stems.some((f) => f.id === id));
      }
      for (const fam of prefs.neverColors ?? []) {
        check(`[${tag}] avoids never-colour ${fam}`, !b.stems.some((s) => hueFamily(s.hex) === fam),
          b.stems.map((s) => `${s.name}:${hueFamily(s.hex)}`).join(' '));
      }
      if (prefs.scentSensitivity === 'allergic') {
        check(`[${tag}] no strong scent`, !stems.some((f) => f.scent === 'sweet' || f.scent === 'spicy'),
          stems.filter((f) => ['sweet', 'spicy'].includes(f.scent)).map((f) => f.commonName).join(','));
      }
      if (prefs.maxBudget) {
        check(`[${tag}] within budget`, b.price.low <= Number(prefs.maxBudget), `$${b.price.low}`);
      }

      // 7. genuinely new -- same definition the generator uses: an arrangement
      // counts as seen only when its headline flowers match one from the deck.
      const sig = [...b.focalIds, ...b.secondaryIds].sort().join('+');
      check(`[${tag}] not one she already saw`,
        !bouquets.some((old) => [...old.focalIds, ...old.secondaryIds].sort().join('+') === sig));

      // 8. order card is complete
      check(`[${tag}] every stem has a count and colour`,
        b.stems.every((s) => s.count > 0 && s.color && s.hex));
      check(`[${tag}] price band is sane`, b.price.low > 0 && b.price.high > b.price.low);
    }

    const ex = [...res.exclusions.design, ...res.exclusions.manual];
    if (ex.length) {
      console.log(`  excluded: ${ex.map((e) => e.flower.commonName).join(', ')}`);
    }
    console.log('');
  }
}

console.log(failures === 0 ? `All constraint checks passed.` : `${failures} CHECK(S) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
