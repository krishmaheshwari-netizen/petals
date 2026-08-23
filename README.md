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

Binary swiping leaves ~50 likes out of 156 cards, far too flat to rank stems or
sharpen the generator. The finals round fixes that with group brackets: four
flowers on screen, ordered by three taps.

```
  group of 4   3 taps   favourite 3 / next 2 / untouched 1 / least 0
  group of 3   2 taps   3 / 2 / 0
  group of 2   1 tap    3 / 1
```

The card she never touches is implicitly third and **scores for it** — the reveal
holds the finished board for a beat so it is visible that it placed rather than
being skipped. Because every flower in every group leaves with a distinct number,
losing to a favourite is worth 2 rather than 0, and nothing is shut out by
landing in a strong group.

**Fixed length by construction.** Both passes are partitioned up front and the
redemption set is a known size, so the progress bar is honest from the first
screen. At a full field: 8 screens for pass A, 8 for pass B, 4 for redemption —
20 screens, 60 taps.

**The field cap follows from that budget.** Every flower must appear in both
passes, so the field can hold at most `screensPerPass × groupSize` = 32. Likes
beyond that are listed on the results screen as ranked-but-not-placed rather than
silently dropped.

**Opponent-strength adjustment.** Raw points under-credit a flower that drew hard
groups, so each score is lifted by up to 25% according to how strong its
opponents turned out to be: `final = raw × (1 + 0.25 × opponentStrength)`.
Opponent strength is measured from *raw* points — adjusting against already
adjusted scores would be circular.

**Redemption pass** is built from the top 12 by adjusted score plus anyone whose
appearances were all in groups won by a top-8 finisher, capped at 16, partitioned
to avoid rematches where satisfiable.

**Invariant**, asserted by the simulation: every flower in the field appears at
least twice with a nonzero appearance count. Ties break by favourite-picks, then
fewest last places, then up-swipe, then a stable per-id jitter.

Every tap is written back to state and persisted, so she resumes on the exact
screen — including a half-finished group.

**The list is editable.** Finals measures a preference; it doesn't overrule one.
A *Reorder* toggle on the results screen turns the ranking into a drag list — by
a grip handle, with up/down arrows alongside, since nudging one place is fiddly
to drag on a phone. Tier labels update live as things move.

Editing changes the recommendations, not just the display: the original spread of
scores is kept and reassigned by position, so whatever she puts at number one
inherits the top score and the generator picks focals accordingly. A hand-edited
order travels in the share link and can be reset back to the finals result.
Re-running the finals clears it, since it no longer refers to that run.

```bash
node scripts/finals-sim.mjs   # simulated preferences, 25 runs per case
```

One consequence worth knowing: because the adjustment is multiplicative, a flower
that places last in every appearance scores 0, and 0 × anything is still 0. About
2–3 flowers per full run finish there. They were genuinely ranked last every time
they were seen, so it is a real signal rather than an ambiguity — but if you want
strong-group protection to reach them too, the adjustment would need to be
additive rather than multiplicative.

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

---

## Picking this up again

```bash
cd ~/petals
npm install
npm run dev        # http://localhost:5173

npm run data:verify   # re-check all 122 Commons images still return 200
npm run sanity        # generator obeys its design constraints
node scripts/finals-sim.mjs   # finals ranks, holds its invariant, stays in budget
npm run deploy        # build + push to GitHub Pages
```

Run those three checks before and after any change to `src/lib` — between them
they cover the parts that fail silently.

**Where things live**

| File | What it owns |
|---|---|
| `scripts/catalog.mjs` | the hand-authored flower facts — edit here to add a flower |
| `scripts/build-data.mjs` | Commons fetch, image verification, colour sampling |
| `scripts/bouquets.mjs` | the 34 curated arrangements |
| `src/lib/color.js` | hue families, palette relationships, the clash test |
| `src/lib/scoring.js` | the four tag signals, all tunables in one `TUNING` object |
| `src/lib/bracket.js` | the finals round: groups, scoring, tiers, manual order |
| `src/lib/generator.js` | hard constraints, then ranking, then the copy |
| `src/lib/sendResults.js` | the emailed report and the FormSubmit endpoint |

**Knobs worth knowing**

- `TUNING` in `scoring.js` — swipe weights, normalisation, how much a finals
  placing outweighs a plain like.
- `BRACKET` in `bracket.js` — group size, screens per pass, the 25% opponent
  adjustment. `FIELD_CAP` is derived from the budget, not set by hand.
- `STYLE_RECIPES` in `generator.js` — how many stems of each role a style wants.
- `DELIVERY` in `sendResults.js` — where the emailed report goes.

**Known trade-offs, deliberate**

- Flower photos hot-link to `upload.wikimedia.org` rather than being bundled, so
  the app needs a connection. Bundling them is a build-time change if you want it.
- The `?r=` share payload is a query parameter, so it lands in the host's access
  logs. A hash fragment would keep it client-side.
- The repo is public because GitHub Pages requires it on a free account, which
  means the delivery address is visible in the source.
- A flower that places last in every finals appearance scores 0, and the
  opponent-strength adjustment is multiplicative, so it cannot lift them. Making
  it additive is a one-line change.
