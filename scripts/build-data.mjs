// Builds src/data/flowers.json and src/data/fillers.json from scripts/catalog.mjs.
//
// For every catalog entry this script:
//   1. queries the Wikimedia Commons search API for candidate File: pages
//   2. ranks candidates (botanical name in title beats search rank; obvious
//      non-portrait subjects -- herbarium sheets, distribution maps, seed packets,
//      whole fields -- are rejected outright)
//   3. verifies the chosen thumbnail URL actually returns HTTP 200
//   4. downloads a 64px thumbnail and samples it for the dominant *petal* colour,
//      skipping green/brown/grey pixels so foliage and background don't win
//   5. records the Commons artist + licence for attribution
//
// Entries that cannot clear step 3 are DROPPED, never placeholdered.
//
//   node scripts/build-data.mjs            # build everything
//   node scripts/build-data.mjs --verify   # re-check every URL in the built JSON

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { FLOWERS, FILLERS } from './catalog.mjs';
import { hueFamily } from '../src/lib/color.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'src', 'data');
const CACHE_DIR = join(HERE, '.cache');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'PetalsApp/1.0 (personal gift project; contact via github)';

// Commons will quietly start returning empty result sets if you hammer it, which
// looks exactly like "this flower has no photos" -- so every network call goes
// through one throttle, and every search response is cached to disk. Re-running
// to tune the ranking heuristic then costs zero requests.
// upload.wikimedia.org (the thumbnail CDN) rate-limits far more aggressively
// than the API does, so the gap between calls adapts: every 429 widens it and
// triggers a long cooldown, and sustained success narrows it again.
const BASE_GAP_MS = 1200;
const MAX_GAP_MS = 9000;
let gap = BASE_GAP_MS;
let lastCall = 0;
let okStreak = 0;

async function throttle() {
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function noteThrottled() {
  okStreak = 0;
  gap = Math.min(MAX_GAP_MS, Math.round(gap * 1.6));
}

function noteOk() {
  if (++okStreak >= 12 && gap > BASE_GAP_MS) {
    gap = Math.max(BASE_GAP_MS, Math.round(gap * 0.8));
    okStreak = 0;
  }
}

const cachePath = (key) =>
  join(CACHE_DIR, createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json');

function cacheGet(key) {
  const p = cachePath(key);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function cacheSet(key, value) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify(value));
}

// Titles containing these are never a usable single-bloom portrait.
const TITLE_REJECT = [
  'herbarium', 'illustration', 'botanical plate', 'distribution', 'map',
  'seed', 'packet', 'stamp', 'coin', 'logo', 'diagram', 'label', 'sign',
  'graph', 'chart', 'cemetery', 'grave', 'plantation', 'field of', 'nursery',
  'greenhouse', 'market', 'shop', 'vase', 'bouquet', 'arrangement', 'wreath',
  'garland', 'pot ', 'potted', 'bud', 'seedling', 'sprout', 'root', 'bulb',
  'fruit', 'pod', 'dried', 'wilted', 'snow', 'insect', 'bee ', 'butterfly',
  'moth', 'beetle', 'spider', 'bird', 'person', 'woman', 'man ', 'hand',
  // Seed heads and spent flowers rank well but are not what she is swiping on.
  'samen', 'kapsel', 'capsule', 'seedhead', 'seed head', 'fruchtstand',
  'infructescence', 'achene', 'gone over',
  // Pollinator shots -- the insect ends up dead centre of the crop.
  'bombus', 'apis mellifera', 'syrphid', 'hoverfly', 'schwebfliege', 'hummel',
  'pollinat', 'papilio', 'vanessa', 'pieris',
  // Scanned nursery catalogues and old field guides. Commons has a great many of
  // these (the Biodiversity Heritage Library uploads) and they rank well, but
  // they are sepia halftone prints, not photographs of a flower.
  'catalog', 'catalogue', 'trade list', 'seed annual', 'engrav', 'lithograph',
  'woodcut', 'plate ', 'flora of', 'field guide', 'for the garden',
  'garden guide', 'horticultur', 'bulb guide', 'price list',
];

// A year before 1960 in the title is a reliable tell for a scanned publication.
const ARCHIVAL_YEAR = /\b(1[5-9]\d{2})\b/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// An empty `query.pages` is treated as a RETRYABLE failure, not as "no such
// flower" -- that distinction is what the first build run got wrong.
async function searchRaw(query) {
  const cached = cacheGet('search:' + query);
  if (cached) return cached;

  const url = `${API}?${new URLSearchParams({
    format: 'json',
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1000',
  })}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2500 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
      if (pages.length) { cacheSet('search:' + query, pages); return pages; }
      // Empty could be genuine or could be throttling. Back off and ask again;
      // only after repeated empties do we believe it.
      await sleep(3000 * (attempt + 1));
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  cacheSet('search:' + query, []);
  return [];
}

async function searchCandidates(query) {
  const pages = await searchRaw(query);
  return pages
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii) return null;
      return {
        title: p.title,
        rank: p.index ?? 99,
        url: ii.thumburl,
        descUrl: ii.descriptionurl,
        width: ii.thumbwidth ?? ii.width,
        height: ii.thumbheight ?? ii.height,
        mime: ii.mime,
        artist: stripHtml(ii.extmetadata?.Artist?.value),
        license: ii.extmetadata?.LicenseShortName?.value ?? '',
        credit: stripHtml(ii.extmetadata?.Credit?.value),
      };
    })
    .filter(Boolean);
}

function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Prefer titles that name the plant, penalise anything that looks like it isn't
// a photograph of a single open bloom, and use search rank as the tiebreak.
function scoreCandidate(cand, entry) {
  const title = cand.title.toLowerCase();
  let score = 40 - cand.rank;

  if (!/^image\/(jpeg|png)$/.test(cand.mime)) return -Infinity;
  for (const bad of TITLE_REJECT) if (title.includes(bad)) score -= 30;
  const year = title.match(ARCHIVAL_YEAR);
  if (year && Number(year[1]) < 1995) score -= 40;

  const sci = entry.scientificName.toLowerCase().split(/\s+/);
  const genus = sci[0];
  const species = sci[1] ?? '';
  if (genus && title.includes(genus)) score += 14;
  if (species && species.length > 3 && title.includes(species)) score += 8;
  for (const word of entry.commonName.toLowerCase().split(/\s+/)) {
    if (word.length > 3 && title.includes(word)) score += 4;
  }

  // Card is a tall rectangle; portrait and square crops survive it best.
  const ratio = cand.width / cand.height;
  if (ratio >= 0.6 && ratio <= 1.15) score += 6;
  else if (ratio <= 1.5) score += 3;
  else if (ratio > 2) score -= 6;

  if ((cand.width ?? 0) < 400) score -= 12;
  return score;
}

// A verified 200 is cached permanently -- re-running the build must never
// re-hammer the CDN for images we have already confirmed.
async function verify(url) {
  const cached = cacheGet('status:' + url);
  if (cached && cached.status === 200) return 200;

  const BACKOFF = [8000, 20000, 45000, 90000];
  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        noteThrottled();
        await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
        continue;
      }
      noteOk();
      if (res.status === 200) cacheSet('status:' + url, { status: 200 });
      return res.status;
    } catch {
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
    }
  }
  return 0;
}

// Greenery, and flowers that genuinely come in green, must not have their own
// colour filtered out as "foliage".
function entryAllowsGreen(entry) {
  if (entry.scale === 'filler') return true;
  return entry.colors.some((c) => {
    const n = parseInt(c.hex.slice(1), 16);
    const { hue, sat } = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
    return sat > 0.15 && hue >= 70 && hue <= 165;
  });
}

// --- dominant petal colour -------------------------------------------------
// Samples a small thumbnail, throws away pixels that read as foliage, bark,
// sky or a blown-out background, then returns the modal hue bucket's average.
async function dominantHex(baseThumbUrl, { allowGreen }) {
  const cacheKey = `hex:${allowGreen ? 'g' : 'n'}:${baseThumbUrl}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.hex;

  const small = baseThumbUrl.replace(/\/\d+px-/, '/128px-');
  let buf = null;
  const BACKOFF = [8000, 20000, 45000];
  for (let attempt = 0; attempt < 4 && !buf; attempt++) {
    await throttle();
    try {
      const res = await fetch(small, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        noteThrottled();
        await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
        continue;
      }
      if (!res.ok) return null;
      noteOk();
      buf = Buffer.from(await res.arrayBuffer());
    } catch {
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]);
    }
  }
  if (!buf) return null;

  let px, w, h;
  try {
    if (small.toLowerCase().endsWith('.png')) {
      const png = PNG.sync.read(buf);
      px = png.data; w = png.width; h = png.height;
    } else {
      const img = jpeg.decode(buf, { useTArray: true });
      px = img.data; w = img.width; h = img.height;
    }
  } catch { return null; }

  // Central 70% of the frame -- the subject, not the backdrop.
  const x0 = Math.floor(w * 0.15), x1 = Math.ceil(w * 0.85);
  const y0 = Math.floor(h * 0.15), y1 = Math.ceil(h * 0.85);

  // Two competing readings of the photo: the strongest *hue* present, and the
  // plain average of the neutrals. A white flower has no dominant hue and must
  // resolve to its neutrals, so neutral pixels are collected rather than thrown
  // away -- discarding them was what turned baby's breath into grey.
  const hueBuckets = new Map();
  const neutral = { n: 0, r: 0, g: 0, b: 0 };
  let kept = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const { hue, sat, val } = rgbToHsv(r, g, b);
      if (val < 0.10 || val > 0.99) continue; // crushed black or blown-out white
      // Foliage only counts as the subject when the entry is itself greenery.
      if (!allowGreen && sat > 0.15 && hue >= 70 && hue <= 165) continue;
      kept++;
      if (sat < 0.15) {
        neutral.n++; neutral.r += r; neutral.g += g; neutral.b += b;
      } else {
        const key = Math.floor(hue / 15);
        const acc = hueBuckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        acc.n++; acc.r += r; acc.g += g; acc.b += b;
        hueBuckets.set(key, acc);
      }
    }
  }
  if (!kept) return null;

  let bestHue = null;
  for (const acc of hueBuckets.values()) {
    if (!bestHue || acc.n > bestHue.n) bestHue = acc;
  }
  // Only let a hue win if it is actually a meaningful share of the subject.
  const use = bestHue && bestHue.n / kept >= 0.15 ? bestHue : (neutral.n ? neutral : bestHue);
  if (!use || !use.n) return null;
  const hex = rgbToHex(Math.round(use.r / use.n), Math.round(use.g / use.n), Math.round(use.b / use.n));
  cacheSet(cacheKey, { hex });
  return hex;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === rn) hue = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / d + 2);
    else hue = 60 * ((rn - gn) / d + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, sat: max === 0 ? 0 : d / max, val: max };
}

const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();

// --- main ------------------------------------------------------------------
async function resolveEntry(entry) {
  const candidates = await searchCandidates(entry.query);
  if (!candidates.length) return { ok: false, reason: 'no search results' };

  const ranked = candidates
    .map((c) => ({ c, s: scoreCandidate(c, entry) }))
    .filter((x) => Number.isFinite(x.s))
    .sort((a, b) => b.s - a.s);

  const allowGreen = entryAllowsGreen(entry);
  for (const { c, s } of ranked.slice(0, 3)) {
    const status = await verify(c.url);
    if (status !== 200) continue;
    const sampled = await dominantHex(c.url, { allowGreen });

    // Sanity guard. Photos include stems, bracts and backgrounds, so the sampler
    // can land on a colour the flower does not actually come in (a pink protea
    // reading olive, say). If the sample doesn't match any colour we know the
    // variety is sold in, trust the curated colour over the pixel average.
    const knownFamilies = new Set(entry.colors.map((c2) => hueFamily(c2.hex)));
    const hex = sampled && knownFamilies.has(hueFamily(sampled))
      ? sampled
      : entry.colors[0].hex;
    if (sampled && hex !== sampled) {
      console.log(`       (sample ${sampled} rejected as ${hueFamily(sampled)}, using ${hex})`);
    }

    const { query: _query, ...rest } = entry;
    return {
      ok: true,
      chosen: c.title,
      score: s,
      data: {
        ...rest,
        imageUrl: c.url,
        imageHex: hex,
        imageAttribution: {
          title: c.title.replace(/^File:/, ''),
          artist: c.artist || 'Unknown',
          license: c.license || 'see Commons',
          sourceUrl: c.descUrl,
        },
      },
    };
  }
  return { ok: false, reason: 'no candidate returned 200' };
}

async function buildSet(name, entries) {
  const out = [];
  const dropped = [];
  for (const entry of entries) {
    const res = await resolveEntry(entry);
    if (res.ok) {
      out.push(res.data);
      console.log(`  ok   ${entry.id.padEnd(28)} ${res.data.imageHex}  ${res.chosen}`);
    } else {
      dropped.push({ id: entry.id, reason: res.reason });
      console.log(`  DROP ${entry.id.padEnd(28)} ${res.reason}`);
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${name}.json: ${out.length} kept, ${dropped.length} dropped\n`);
  return { out, dropped };
}

async function verifyBuilt() {
  let bad = 0, total = 0;
  for (const file of ['flowers.json', 'fillers.json']) {
    const path = join(OUT_DIR, file);
    if (!existsSync(path)) { console.log(`${file}: missing`); continue; }
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    for (const r of rows) {
      total++;
      const status = await verify(r.imageUrl);
      if (status !== 200) { bad++; console.log(`  ${status} ${file} ${r.id}`); }
    }
    console.log(`${file}: ${rows.length} entries checked`);
  }
  console.log(bad === 0 ? `\nAll ${total} image URLs return 200.` : `\n${bad}/${total} FAILED.`);
  process.exitCode = bad === 0 ? 0 : 1;
}

if (process.argv.includes('--verify')) {
  await verifyBuilt();
} else {
  console.log('Flowers:');
  const f = await buildSet('flowers', FLOWERS);
  console.log('Fillers:');
  const g = await buildSet('fillers', FILLERS);
  console.log(`Totals: ${f.out.length} flowers, ${g.out.length} fillers.`);
  if (f.dropped.length || g.dropped.length) {
    console.log('Dropped:', [...f.dropped, ...g.dropped].map((d) => d.id).join(', '));
  }
}
