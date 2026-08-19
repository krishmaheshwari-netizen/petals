// Colour theory helpers shared by scoring.js and generator.js.
//
// Everything here works in HSL because the two questions we actually ask --
// "what family of colour is this?" and "do these sit together?" -- are questions
// about hue distance and lightness spread, not about RGB.

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = 60 * (((gn - bn) / d) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / d + 2);
  else h = 60 * ((rn - gn) / d + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

export const hsl = (hex) => rgbToHsl(hexToRgb(hex));

/** Shortest distance between two hues, 0-180. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The named colour family a hex belongs to. These are the buckets the taste
 * profile talks in ("you kept picking blush and cream"), so they are named the
 * way a person would name them rather than the way a colour wheel would.
 */
export function hueFamily(hex) {
  const { h, s, l } = hsl(hex);
  if (s < 0.14) return l > 0.72 ? 'cream' : l < 0.25 ? 'charcoal' : 'silver';
  if (l > 0.86 && s < 0.3) return 'cream';

  if (h < 15 || h >= 345) {
    if (l > 0.72) return 'blush';
    if (l < 0.3) return 'wine';
    return 'red';
  }
  if (h < 42) {
    if (l < 0.38) return 'rust';
    if (l > 0.74) return 'peach';
    return 'coral';
  }
  if (h < 66) return l < 0.4 ? 'bronze' : 'gold';
  if (h < 90) return 'chartreuse';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return l > 0.72 ? 'periwinkle' : 'blue';
  if (h < 290) return l > 0.72 ? 'lilac' : 'violet';
  if (h < 330) return l > 0.74 ? 'lilac' : 'magenta';
  return l > 0.72 ? 'blush' : 'pink';
}

/** Families that read as a backdrop rather than as a colour choice. */
const NEUTRAL_FAMILIES = new Set(['cream', 'silver', 'charcoal']);
export const isNeutral = (hex) => NEUTRAL_FAMILIES.has(hueFamily(hex));

/**
 * Groups the saturated hues in a palette into clusters, so that three shades of
 * the same pink count as one decision and not three.
 */
function hueClusters(hexes, tolerance = 30) {
  const chromatic = hexes.filter((x) => !isNeutral(x)).map((x) => hsl(x).h);
  const clusters = [];
  for (const h of chromatic) {
    const found = clusters.find((c) => hueDistance(c.mean, h) <= tolerance);
    if (found) {
      found.members.push(h);
      // circular mean, so 350 and 10 average to 0 rather than 180
      const xs = found.members.map((m) => Math.cos((m * Math.PI) / 180));
      const ys = found.members.map((m) => Math.sin((m * Math.PI) / 180));
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      found.mean = ((Math.atan2(my, mx) * 180) / Math.PI + 360) % 360;
    } else {
      clusters.push({ mean: h, members: [h] });
    }
  }
  return clusters;
}

/** Widest hue spread across the chromatic colours in a palette. */
function hueSpread(hexes) {
  const chromatic = hexes.filter((x) => !isNeutral(x)).map((x) => hsl(x).h);
  let max = 0;
  for (let i = 0; i < chromatic.length; i++) {
    for (let j = i + 1; j < chromatic.length; j++) {
      max = Math.max(max, hueDistance(chromatic[i], chromatic[j]));
    }
  }
  return max;
}

function lightnessSpread(hexes) {
  if (!hexes.length) return 0;
  const ls = hexes.map((x) => hsl(x).l);
  return Math.max(...ls) - Math.min(...ls);
}

/**
 * Does this set of colours form the named relationship? Used as a HARD filter in
 * the generator -- a combination that fails is rejected before ranking, not
 * merely scored down.
 */
export function satisfiesPalette(hexes, type) {
  const clusters = hueClusters(hexes);
  const neutrals = hexes.filter(isNeutral).length;
  const spread = hueSpread(hexes);
  const lSpread = lightnessSpread(hexes);

  switch (type) {
    case 'monochrome':
      // One hue only. Neutrals are always allowed to ride along.
      return clusters.length <= 1 && spread <= 30;

    case 'analogous':
      // Neighbouring hues -- a walk of at most a quarter of the wheel.
      return clusters.length >= 1 && spread <= 90;

    case 'complementary': {
      // Two hue groups roughly opposite one another.
      if (clusters.length !== 2) return false;
      const d = hueDistance(clusters[0].mean, clusters[1].mean);
      return d >= 130 && d <= 180;
    }

    case 'neutral-plus-accent':
      // Mostly neutral, with a single hue allowed to speak.
      return neutrals >= 1 && clusters.length <= 1;

    case 'high-contrast':
      // Either far apart on the wheel or far apart in lightness.
      return spread >= 100 || lSpread >= 0.5;

    default:
      return true;
  }
}

/** Best-fitting description of a palette we didn't design to a spec. */
export function classifyPalette(hexes) {
  for (const type of ['monochrome', 'neutral-plus-accent', 'analogous', 'complementary', 'high-contrast']) {
    if (satisfiesPalette(hexes, type)) return type;
  }
  return 'high-contrast';
}

/**
 * The florist's "these two fight" test. Colours a short but not tiny distance
 * apart on the wheel, both saturated and at similar lightness, read as a mistake
 * rather than as a choice -- the classic example being a warm orange next to a
 * cool pink. Far apart is fine (that's contrast). Very close is fine (that's
 * tonal). It's the middle that clashes.
 */
export function clashes(hexA, hexB) {
  const a = hsl(hexA), b = hsl(hexB);
  if (isNeutral(hexA) || isNeutral(hexB)) return false;
  if (a.s < 0.35 || b.s < 0.35) return false;
  const d = hueDistance(a.h, b.h);
  const similarLightness = Math.abs(a.l - b.l) < 0.22;
  return d >= 25 && d <= 75 && similarLightness;
}

export function anyClash(hexes) {
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      if (clashes(hexes[i], hexes[j])) return true;
    }
  }
  return false;
}

export function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Readable text colour for a given background. */
export function readableInk(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#3A3129' : '#FBF7F0';
}
