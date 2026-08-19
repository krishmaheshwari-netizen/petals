// Validates scripts/bouquets.mjs against the built flowers.json / fillers.json
// and writes src/data/bouquets.json.
//
// The hand-authored arrangements reference stems by id, but a stem only exists
// in the app if its image survived verification. Rather than trusting those ids,
// this drops any arrangement that references a stem which isn't there, and
// reports design warnings (no seasonal overlap, duplicate forms) without
// dropping -- the curated 30 are allowed to be looser than the generator, since
// their job is to elicit preferences rather than to be ordered.
//
//   node scripts/build-bouquets.mjs

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUQUETS } from './bouquets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'src', 'data');

const flowers = JSON.parse(readFileSync(join(DATA, 'flowers.json'), 'utf8'));
const fillers = JSON.parse(readFileSync(join(DATA, 'fillers.json'), 'utf8'));
const byId = Object.fromEntries([...flowers, ...fillers].map((f) => [f.id, f]));

const SEASONS = ['spring', 'summer', 'fall', 'winter'];

const kept = [];
const dropped = [];
const warnings = [];

for (const b of BOUQUETS) {
  const ids = [...b.focalIds, ...b.secondaryIds, ...b.fillerIds];
  const missing = ids.filter((id) => !byId[id]);
  if (missing.length) {
    dropped.push({ id: b.id, missing });
    continue;
  }

  const stems = ids.map((id) => byId[id]);
  const shared = SEASONS.filter((s) => stems.every((f) => f.seasons.includes(s)));
  if (!shared.length) warnings.push(`${b.id}: stems share no season`);

  const headline = [...b.focalIds, ...b.secondaryIds].map((id) => byId[id]);
  const forms = headline.map((f) => f.form);
  if (new Set(forms).size !== forms.length) warnings.push(`${b.id}: duplicate form among focal/secondary`);

  if (b.fillerIds.some((id) => byId[id].scale !== 'filler')) {
    warnings.push(`${b.id}: a fillerId points at a non-filler`);
  }

  kept.push({ ...b, seasons: shared });
}

mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'bouquets.json'), JSON.stringify(kept, null, 2) + '\n');

console.log(`bouquets.json: ${kept.length} kept, ${dropped.length} dropped`);
for (const d of dropped) console.log(`  DROP ${d.id} -> missing ${d.missing.join(', ')}`);
if (warnings.length) {
  console.log('\nWarnings (kept anyway):');
  for (const w of warnings) console.log(`  ${w}`);
}

// Coverage report -- the deck only discriminates if it spans the space.
const tally = (key) => {
  const m = {};
  for (const b of kept) m[b[key]] = (m[b[key]] ?? 0) + 1;
  return m;
};
console.log('\npaletteType:', tally('paletteType'));
console.log('style:', tally('style'));
console.log('wrap:', tally('wrap'));
console.log('priceTier:', tally('priceTier'));
