// Deck construction.
//
// Three card types are interleaved so she never sees three of the same kind in a
// row -- an unbroken run of flower cards stops teaching us anything about
// palette or style, which are two of the four signals.

import flowersData from '../data/flowers.json';
import fillersData from '../data/fillers.json';
import bouquetsData from '../data/bouquets.json';

export const FLOWERS = flowersData;
export const FILLERS = fillersData;
export const BOUQUETS = bouquetsData;

/** Lookup across every stem, flower or filler. */
export const INDEX = {
  byId: Object.fromEntries([...FLOWERS, ...FILLERS].map((f) => [f.id, f])),
  bouquetById: Object.fromEntries(BOUQUETS.map((b) => [b.id, b])),
};

/** Deterministic PRNG so a given seed always produces the same deck. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Interleaves the three piles, never placing a third consecutive card of the
 * same type. At each step it picks the type that is furthest behind schedule,
 * skipping any type that would form a run of three.
 */
export function buildDeck(seed = 1) {
  const rand = mulberry32(seed);

  const piles = {
    flower: shuffle(FLOWERS.map((f) => ({ id: `flower:${f.id}`, type: 'flower', data: f })), rand),
    bouquet: shuffle(BOUQUETS.map((b) => ({ id: `bouquet:${b.id}`, type: 'bouquet', data: b })), rand),
    filler: shuffle(FILLERS.map((f) => ({ id: `filler:${f.id}`, type: 'filler', data: f })), rand),
  };

  const total = piles.flower.length + piles.bouquet.length + piles.filler.length;
  const targets = {
    flower: piles.flower.length / total,
    bouquet: piles.bouquet.length / total,
    filler: piles.filler.length / total,
  };

  const out = [];
  const taken = { flower: 0, bouquet: 0, filler: 0 };

  while (out.length < total) {
    const tail = out.slice(-2);
    const blocked =
      tail.length === 2 && tail[0].type === tail[1].type ? tail[0].type : null;

    // Whichever type is most behind its share of the deck goes next.
    const options = Object.keys(piles)
      .filter((t) => piles[t].length > 0 && t !== blocked)
      .sort((a, b) => {
        const debtA = targets[a] - taken[a] / Math.max(1, out.length);
        const debtB = targets[b] - taken[b] / Math.max(1, out.length);
        return debtB - debtA;
      });

    // Only happens when the sole remaining pile is the blocked one.
    const pick = options[0] ?? Object.keys(piles).find((t) => piles[t].length > 0);
    out.push(piles[pick].shift());
    taken[pick]++;
  }

  return out;
}

/** A stable seed per person, so refreshing doesn't reshuffle mid-session. */
export function makeSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
