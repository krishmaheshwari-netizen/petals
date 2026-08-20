# Petals

A swipe deck that works out which flowers someone actually likes, then turns that
into arrangements you can hand to a florist.

The point is that liking two flowers separately doesn't mean they work in one
vase. So Petals learns taste at three levels — individual stems, colour palettes,
and bouquet style/filler — and then applies real floral design rules when it
builds recommendations, rather than just stacking up the highest-scoring flowers.

**Live:** https://krishmaheshwari-netizen.github.io/petals/

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run deploy     # build + publish to GitHub Pages
```

No backend, no accounts, no database. State lives in `localStorage`; results
travel in a URL, or get emailed via a form relay (see below).

---

## The deck

130 cards, three types interleaved so you never see three of the same kind in a
row (an unbroken run of flower cards stops teaching the palette and style
signals):

| Type | Count | What it is |
|---|---|---|
| Flower | 76 | One bloom, full-bleed photo, name overlaid |
| Bouquet | 34 | A composed arrangement (see below) |
| Filler / greenery | 20 | Eucalyptus, ruscus, baby's breath, bupleurum, … |

Swipe right = love, left = pass, up = obsessed (2× weight). Tap to flip for
details. Arrow keys and the on-screen buttons do the same thing, so it works on
a desktop; `Backspace` or the back button steps back a card.

The commit thresholds (`DISTANCE_THRESHOLD` / `VELOCITY_THRESHOLD` in
`SwipeCard.jsx`) are deliberately generous — the card can be pushed well
off-centre and still spring back, so a decision feels chosen rather than
triggered. Every decision is confirmed by a mark that punches in over the deck,
the way a double-tap heart does.

### Bouquet cards are drawn, not photographed

There isn't a single bouquet photograph in the app. Each arrangement is composed
at render time from the verified single-flower images — filler behind at reduced
opacity and scale, secondaries flanking, focal front and centre — using CSS
transforms and radial masks, plus a palette bar and the style name.

Because the source photos are whole-plant shots, each bloom sits in an inner
element scaled about its centre (where the flower almost always is) while the
mask stays on the unscaled parent, so the soft edge isn't magnified with it.
See `src/components/BouquetComposition.jsx`.

---

## Data pipeline

`src/data/*.json` is generated, not hand-written. Don't edit it directly.

```bash
npm run data          # rebuild flowers.json, fillers.json, bouquets.json
npm run data:verify   # re-check that every image URL still returns 200
npm run sanity        # assert the generator obeys its own design constraints
```

- **`scripts/catalog.mjs`** — hand-authored horticultural facts for every entry
  (form, scale, scent, seasons, price tier, colour range, blurb) plus the
  Commons search string. This is the file to edit to add a flower.
- **`scripts/build-data.mjs`** — queries the Wikimedia Commons API, ranks
  candidates (botanical name in the title beats search rank; herbarium sheets,
  distribution maps, seed heads and pollinator shots are rejected), verifies the
  chosen URL returns **200**, samples the photo for its dominant petal colour,
  and records artist + licence. **Entries that can't be verified are dropped, never
  placeholdered.** Currently 96/96 resolve.
- **`scripts/bouquets.mjs` → `build-bouquets.mjs`** — the 34 curated
  arrangements, validated against what actually survived image verification.
  Any bouquet referencing a missing stem is dropped; design problems (no shared
  season, duplicate form) are reported as warnings.

Two things worth knowing if you re-run the build:

1. **Commons rate-limits hard.** The thumbnail CDN returns 429s that look exactly
   like "this flower has no photos". The script treats an empty result as
   *retryable*, adapts its request gap on every 429, and caches both search
   results and verified URLs to `scripts/.cache/`. A re-run costs almost nothing.
2. **The colour sampler is guarded.** If the sampled colour isn't one the variety
   is actually sold in, the curated colour wins — a pink protea photographed
   against foliage shouldn't be recorded as olive.

---

## Finals round

Binary swiping leaves ~50 likes out of 156 cards, which is far too flat to rank
stems or to sharpen the generator. The finals round fixes that with forced-choice
comparisons: two flowers, "which would you rather get?", no skip button. There is
a quiet "can't decide" that records a draw, because a draw is information and a
skip is not.

It starts when the deck finishes, or from the deck once more than 20 flowers are
liked. State persists to `localStorage`, so she can leave and resume, and it
travels in the share link.

**Ratings** (`src/lib/elo.js`) seed at 1500, or 1600 for an up-swipe. Standard
Elo, K=32 for the first ten rounds and K=16 after, so early comparisons move a
long way and later ones refine. Stops when the top ten has been unchanged for
five rounds, or at 35 rounds.

**Pairing runs in two phases, and this is a deliberate departure from the obvious
design.** Pairing purely by closest rating sounds right — the closest matchup
carries the most information — but simulation showed it ranks badly in practice:
with ~50 liked flowers and ~25 rounds, adjacent-rating pairs cluster in one part
of the table and most flowers are never shown at all, leaving them on their seed
rating and giving a mean rank error around 11 places out of 50. So:

1. **Coverage** — while any flower is unseen, pair from the least-compared ones.
   Every flower earns a real rating.
2. **Refine** — then closest-rated unplayed pairs, preferring the top of the
   table, since that is the part the output uses.

The stopping rule also cannot fire until coverage is complete: a table where
nothing has moved is trivially "stable".

```bash
node scripts/finals-sim.mjs   # simulated preferences, 20 runs per case
```

Worth knowing what this can and cannot do. Fully sorting 50 items needs roughly
280 comparisons; the cap is 35. So finals reliably sharpens **the top of the
ranking** — around 8 of the true top 10 — while the tail stays approximate. That
is the right trade, because the top is what the recommendations are built from.

---

## Scoring

Four **independent** signals, deliberately never collapsed into one number
(`src/lib/scoring.js`):

| Signal | Learns |
|---|---|
| `stem` | which flowers, forms and scents |
| `palette` | which palette types and hue families |
| `style` | loose vs structured vs minimal vs cascading |
| `filler` | which greenery, and airy vs dense |

```
score(tag) = (weighted likes with tag − passes with tag) / normalise(deck frequency)
```

Once finals has run, a like is no longer worth a flat 1: each liked flower
contributes `strengthBase + strength * strengthSpan`, so her #1 flower moves the
profile about six times as much as the weakest thing she liked. Passes stay at a
flat negative — "no" carries no gradient.

This sharpens the **stem** and **palette** signals, which come from flower cards.
**Style** and **filler** still come from arrangement swipes and stay binary,
since finals ranks individual stems rather than whole bouquets.

Everything tunable lives in one `TUNING` object at the top of the file: swipe
weights, the normalisation mode (`sqrt` by default, `linear` and `none`
available), the minimum observations before a tag is trusted, and how much a
bouquet swipe is allowed to bleed into its component stems (kept low — she's
reacting to the arrangement, not its parts).

---

## The generator

`src/lib/generator.js`. Order of operations is the whole point:

1. **exclude** — manual dislikes, banned colours and scent sensitivities are
   removed outright, overriding any swipe score
2. **filter** — hard design constraints reject candidate combinations *before*
   ranking:
   - every stem shares at least one season
   - 1–2 focal, 1–2 secondary, 1–2 filler — never all-focal, never all-filler
   - combined colours form a valid relationship for her preferred palette type,
     with no clashing hues
   - no two varieties share a form (a ruffled focal wants a spiky or airy partner)
   - total price tier stays within one step of her average liked tier
3. **rank** — only survivors get scored

With finals run, focals are drawn from the top decile of the ranking and
secondaries from the top half, with anything below the median available but never
preferred. Each tier widens if it is too small to build from — returning nothing
would be worse than reaching one tier down.

An arrangement counts as "already seen" when its **headline** (focal + secondary)
matches one from the deck. Matching on the focal alone sounds safer but blocks any
arrangement merely sharing a flower with a curated one, which in practice
collapsed five recommendations to one.

Colours are assigned greedily in score order from each flower's *orderable*
range, so two flowers she likes can appear together in shades that work rather
than the shades that happened to be photographed. If none of a stem's favoured
colours will sit with what's already there, the generator looks for a neutral in
the same flower's range as a tonal bridge — the higher-scoring flower keeps its
colour and the one that fought it comes in cream or silver.

If a top-scoring flower still can't satisfy the constraints it is **excluded and
reported**, grouped by reason:

> You loved garden rose, peony and coral charm peony, but their colours don't sit
> well with the soft neighbouring palette you kept picking — worth buying on
> their own.

`npm run sanity` runs four taste profiles × two preference sets through the real
data and asserts every constraint above on every bouquet produced, including that
nothing recommended is one she already saw in the deck.

---

## Manual preferences

A separate always-available tab, saved to `localStorage` and carried into the
share link.

The free-text box is stored and displayed **verbatim** — never parsed,
summarised, or fed to the generator. The structured chips (never-colours, scent
sensitivity, vessel, occasion, budget, disliked flowers) *are* machine-readable
and act as hard exclusions that beat any swipe score.

## Getting the results back

Two routes, on the results screen.

**Send my flowers to him** (the main one) posts a plain-text report to
[FormSubmit](https://formsubmit.co), which forwards it as an email. No account
and no API key, which is what makes it work from a static site. The report
contains the taste profile, top stems, her note verbatim, her hard rules, and
every generated bouquet with its exact stem list, counts, colours, wrap and
price band — so it can be pasted straight into a florist's contact form.

- The destination address and endpoint are the `DELIVERY` object at the top of
  `src/lib/sendResults.js`.
- **The first send to a new address needs confirming once.** FormSubmit emails
  that address a confirmation link; until it is clicked, sends come back with an
  activation notice (which the UI reports rather than pretending it worked).
- The report passes through FormSubmit's servers on the way to the inbox. If you
  would rather nothing be relayed, the copy-link button is a direct alternative.
- To keep the address out of the built JavaScript, activate it once, then swap in
  the random alias FormSubmit gives you. It works identically.
- If the request fails, the UI falls back to a `mailto:` link through the user's
  own mail app.

**Copy my link** packs swipes and preferences into a `?r=` query parameter (short
keys, single-character verdicts, base64url). A full 130-card deck plus preferences
encodes to about 4.3 KB. Opening such a link puts the app in read-only mode —
"What she likes" — with the order cards ready to use. This route touches no third
party at all.

---

## Layout

```
scripts/          data pipeline + sanity checks (Node, run at build time)
src/lib/          color.js · scoring.js · generator.js · deck.js · share.js
src/components/   SwipeCard · BouquetComposition · Preferences · Results
src/data/         GENERATED — do not edit by hand
```
