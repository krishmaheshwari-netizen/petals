// Results screen.
//
// Four things, in this order:
//   1. a plain-language taste profile covering all four signals
//   2. her top five individual stems
//   3. the generated bouquets, rendered with the same composition treatment as
//      the deck cards, each with a "why this works" line
//   4. a florist order card per bouquet -- exact stems, counts, colours, wrap,
//      price band, and a copy button that yields plain text for a contact form

import { useMemo, useState } from 'react';
import BouquetComposition, { PaletteBar } from './BouquetComposition.jsx';
import { topStems, topTags, likedPriceTier } from '../lib/scoring.js';
import { generateBouquets } from '../lib/generator.js';
import { FLOWERS, FILLERS, BOUQUETS, INDEX } from '../lib/deck.js';
import { colorLabel, colorHex } from '../lib/preference-options.js';
import { buildReport, sendReport, mailtoUrl } from '../lib/sendResults.js';
import { Sprig, Leaf, SprigRule } from './Ornament.jsx';
import { tierFor } from '../lib/elo.js';

const PALETTE_PROSE = {
  monochrome: 'one colour, held all the way through',
  analogous: 'colours that sit next to each other and never argue',
  complementary: 'two opposite colours set against each other',
  'neutral-plus-accent': 'mostly quiet neutrals with a single colour allowed to speak',
  'high-contrast': 'strong contrast — nothing subtle about it',
};

const STYLE_PROSE = {
  'loose-garden': 'loose and garden-grown, like it was gathered rather than built',
  'structured-round': 'a tidy round dome — deliberate and symmetrical',
  asymmetric: 'off-centre and sculptural, with real negative space',
  wildflower: 'meadow-loose, every stem at a different height',
  'minimal-single-variety': 'one variety, repeated, and nothing else',
  cascading: 'spilling forward over the edge rather than standing up',
};

const FORM_PROSE = {
  ruffled: 'soft many-petalled blooms', spiky: 'tall spires',
  star: 'flat open faces', bell: 'cupped, closed shapes',
  cluster: 'heads made of many small flowers', single: 'clean single discs',
  globe: 'tight spheres',
};

const SCENT_PROSE = {
  none: 'unscented', light: 'lightly scented', sweet: 'sweetly perfumed',
  spicy: 'spice-scented', green: 'green and herbal',
};

/**
 * The four-part profile as plain sentences. The screen renders its own richer
 * version; this is what goes in the email, so it has to stand alone without any
 * of the surrounding layout.
 */
function profileLines(scores, targets, deck, swipes) {
  const hues = topTags(scores, 'palette', { namespace: 'hue', limit: 3 });
  const forms = topTags(scores, 'stem', { namespace: 'form', limit: 2 });
  const scents = topTags(scores, 'stem', { namespace: 'scent', limit: 1 });
  const greens = topTags(scores, 'filler', { namespace: 'filler', limit: 2 });
  const tier = likedPriceTier(deck, swipes);
  const lines = [];

  lines.push(
    forms.length
      ? `Stems: ${forms.map((f) => FORM_PROSE[f.label] ?? f.label).join(' and ')}` +
        (scents.length && scents[0].label !== 'none'
          ? `, and she doesn't mind them ${SCENT_PROSE[scents[0].label]}.`
          : ', leaning unscented.')
      : 'Stems: not enough swipes to call it.',
  );
  lines.push(
    hues.length
      ? `Colour: kept picking ${hues.map((h) => h.label).join(', ')} — she wants ${PALETTE_PROSE[targets.paletteType] ?? targets.paletteType}.`
      : 'Colour: no clear pattern yet.',
  );
  lines.push(`Shape: ${STYLE_PROSE[targets.style] ?? targets.style}.`);
  lines.push(
    `Greenery: leans ${targets.density}` +
      (greens.length
        ? `, especially ${greens.map((g) => INDEX.byId[g.label]?.commonName).filter(Boolean).join(' and ')}`
        : '') +
      `. Around ${'$'.repeat(Math.max(1, Math.round(tier)))} a stem is her level.`,
  );
  return lines;
}

export default function Results({ deck, swipes, scores, prefs, shareUrl, isSharedView, strengths, finals, onRunFinals }) {
  const result = useMemo(
    () =>
      generateBouquets({
        flowers: FLOWERS,
        fillers: FILLERS,
        deck,
        swipes,
        scores,
        prefs,
        seenBouquets: BOUQUETS,
        count: 5,
        strengths,
      }),
    [deck, swipes, scores, prefs, strengths],
  );

  // With finals run this is the full ranked list; without it, the old top five.
  const ranked = topStems(scores, INDEX, strengths ? 200 : 5, strengths);
  const swipeCount = Object.keys(swipes).length;

  const report = useMemo(
    () =>
      buildReport({
        profile: profileLines(scores, result.targets, deck, swipes),
        stems: ranked.slice(0, 12).map((s2) => s2.flower),
        bouquets: result.bouquets,
        prefs,
        shareUrl,
        swipeCount,
        ranked: !!strengths,
      }),
    [scores, result, deck, swipes, ranked, prefs, shareUrl, swipeCount, strengths],
  );

  return (
    <div className="mx-auto w-full max-w-lg px-5 pb-28 pt-6">
      <header className="mb-9 text-center">
        <Sprig size={30} className="mx-auto text-sage" />
        <h1 className="mt-3 font-display text-[40px] leading-[1.02] text-ink">
          {isSharedView ? 'What she likes' : 'Your flowers'}
        </h1>
        <p className="mt-2.5 text-[11px] uppercase tracking-[0.2em] text-ink-faint">
          {swipeCount} cards · {result.targets.paletteType.replace(/-/g, ' ')}
        </p>
        <SprigRule className="mt-5" />
      </header>

      <TasteProfile scores={scores} targets={result.targets} deck={deck} swipes={swipes} />

      {/* ---- top stems ---- */}
      {ranked.length > 0 && (
        <RankedStems
          ranked={ranked}
          tiered={!!strengths}
          finals={finals}
          onRunFinals={onRunFinals}
          isSharedView={isSharedView}
        />
      )}

      {/* ---- manual preferences, verbatim ---- */}
      <ManualPrefs prefs={prefs} />

      {/* ---- generated bouquets ---- */}
      <section className="mb-10">
        <SectionTitle>Made for you</SectionTitle>
        <p className="mb-4 mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          {result.bouquets.length
            ? 'New arrangements you haven’t seen, built to real design rules rather than just stacking up your favourites.'
            : 'Not enough swipes yet to build something that obeys the design rules. Try a few more cards.'}
        </p>

        <div className="space-y-8">
          {result.bouquets.map((b) => (
            <GeneratedBouquet key={b.id} bouquet={b} />
          ))}
        </div>
      </section>

      {/* ---- what we left out and why ---- */}
      <Exclusions exclusions={result.exclusions} />

      {!isSharedView && shareUrl && <ShareBlock url={shareUrl} report={report} />}
    </div>
  );
}

/**
 * The ranked stem list. After the finals round this is a real ordering, so it
 * shows everything -- collapsed after ten -- and labels the tiers, which is what
 * lets the florist card separate "must include" from "fine as filler".
 */
function RankedStems({ ranked, tiered, finals, onRunFinals, isSharedView }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? ranked : ranked.slice(0, 10);
  // Precomputed rather than tracked with a mutable cursor during render.
  const tierStarts = new Set(
    tiered
      ? shown.map((_, i) => i).filter((i) => i === 0 || tierFor(i).key !== tierFor(i - 1).key)
      : [],
  );

  return (
    <section className="mb-10">
      <SectionTitle>{tiered ? 'Ranked' : 'Top five stems'}</SectionTitle>
      {tiered && (
        <p className="mb-1 mt-2 text-[12px] italic text-ink-faint">
          Settled by {finals?.round ?? 0} head-to-head comparisons, not by counting likes.
        </p>
      )}

      <ol className="mt-3 divide-y divide-line-soft">
        {shown.map(({ flower }, i) => {
          const tier = tiered ? tierFor(i) : null;
          const newTier = tier && tierStarts.has(i);
          return (
            <li key={flower.id}>
              {newTier && (
                <div className="flex items-center gap-2 pb-1.5 pt-4 first:pt-0">
                  <span className="label-caps text-rose/80">{tier.label}</span>
                  <span className="rule-fade flex-1" />
                </div>
              )}
              <div className="flex items-center gap-3.5 py-2.5">
                <span className="w-5 shrink-0 font-display text-[15px] text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className="h-12 w-12 shrink-0 rounded-full bg-cover bg-center ring-1 ring-line/80"
                  style={{ backgroundImage: `url("${flower.imageUrl}")` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] leading-tight text-ink">
                    {flower.commonName}
                  </span>
                  <span className="block truncate text-[12px] italic text-ink-faint">
                    {FORM_PROSE[flower.form]} · {SCENT_PROSE[flower.scent]}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {ranked.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 w-full rounded-full border border-line py-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint transition hover:border-ink-faint hover:text-ink-soft"
        >
          {expanded ? 'Show fewer' : `Show all ${ranked.length}`}
        </button>
      )}

      {!isSharedView && onRunFinals && (
        <button
          type="button"
          onClick={onRunFinals}
          className="mt-2 w-full text-[10.5px] uppercase tracking-[0.13em] text-ink-faint underline underline-offset-4 transition hover:text-ink-soft"
        >
          {tiered ? 'Run the finals again' : 'Rank these head-to-head'}
        </button>
      )}
    </section>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="mb-1">
      <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-ink-faint">
        <Leaf size={13} className="text-sage" />
        {children}
      </h2>
      <div className="rule-fade mt-2" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taste profile -- all four signals, in plain language
// ---------------------------------------------------------------------------
function TasteProfile({ scores, targets, deck, swipes }) {
  const hues = topTags(scores, 'palette', { namespace: 'hue', limit: 3 });
  const forms = topTags(scores, 'stem', { namespace: 'form', limit: 2 });
  const scents = topTags(scores, 'stem', { namespace: 'scent', limit: 1 });
  const vibes = topTags(scores, 'stem', { namespace: 'vibe', limit: 3 });
  const greens = topTags(scores, 'filler', { namespace: 'filler', limit: 2 });
  const tier = likedPriceTier(deck, swipes);

  const list = (arr, fn) => arr.map(fn).filter(Boolean);

  return (
    <section className="mb-10">
      <SectionTitle>Your taste, in four parts</SectionTitle>
      <dl className="mt-5 space-y-5 divide-y divide-line-soft [&>div]:pt-5 [&>div:first-child]:pt-0">
        <Signal label="Stems">
          {forms.length ? (
            <>
              You go for {list(forms, (f) => FORM_PROSE[f.label] ?? f.label).join(' and ')}
              {scents.length && scents[0].label !== 'none'
                ? `, and you don't mind them ${SCENT_PROSE[scents[0].label]}`
                : scents.length
                  ? ', and you lean towards the unscented ones'
                  : ''}
              .
              {vibes.length > 0 && (
                <> The word for it is <em className="font-display italic">{vibes.map((v) => v.label.replace(/-/g, ' ')).join(', ')}</em>.</>
              )}
            </>
          ) : (
            'Not enough swipes yet to call it.'
          )}
        </Signal>

        <Signal label="Colour">
          {hues.length ? (
            <>
              You kept picking {list(hues, (h) => h.label).join(', ')}. Put together, you want{' '}
              {PALETTE_PROSE[targets.paletteType] ?? targets.paletteType}.
            </>
          ) : (
            'No clear colour pattern yet.'
          )}
        </Signal>

        <Signal label="Shape">
          You want it {STYLE_PROSE[targets.style] ?? targets.style}.
        </Signal>

        <Signal label="Greenery">
          You lean {targets.density === 'airy' ? 'airy — open, with space between the stems' : 'dense — full, with the greenery filling the gaps'}
          {greens.length ? <>, and {greens.map((g) => INDEX.byId[g.label]?.commonName).filter(Boolean).join(' and ')} in particular</> : ''}.
          {' '}Around {'$'.repeat(Math.max(1, Math.round(tier)))} a stem is your level.
        </Signal>
      </dl>
    </section>
  );
}

function Signal({ label, children }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="prose-serif mt-1.5 text-[16px] leading-[1.6] text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A generated bouquet, plus its florist order card
// ---------------------------------------------------------------------------
function GeneratedBouquet({ bouquet }) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-line bg-paper shadow-[0_16px_36px_-22px_rgba(43,37,31,0.45)]">
      <BouquetComposition bouquet={bouquet} className="aspect-[4/3] w-full bg-[#F6EEE1]" />

      <div className="px-5 pb-5 pt-4">
        <h3 className="font-display text-[26px] leading-tight text-ink">{bouquet.name}</h3>
        <PaletteBar hexes={bouquet.paletteHexes} className="mt-3 ring-1 ring-line" />

        <div className="mt-4 border-l border-sage/50 pl-4">
          <div className="label-caps">Why this works</div>
          <p className="prose-serif mt-1.5 text-[14.5px] leading-[1.6] text-ink-soft">{bouquet.why}</p>
        </div>

        <OrderCard bouquet={bouquet} />
      </div>
    </article>
  );
}

function OrderCard({ bouquet }) {
  const [copied, setCopied] = useState(false);

  const plainText = useMemo(() => {
    const lines = bouquet.stems.map((r) => `- ${r.count} ${r.name.toLowerCase()} (${r.color})`);
    return [
      `Bouquet: ${bouquet.name}`,
      '',
      ...lines,
      '',
      `Style: ${bouquet.style.replace(/-/g, ' ')}, ${wrapText(bouquet.wrap)}.`,
      `Rough budget: $${bouquet.price.low}–$${bouquet.price.high}.`,
    ].join('\n');
  }, [bouquet]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainText);
    } catch {
      // Clipboard API needs a secure context; fall back to a temporary textarea.
      const ta = document.createElement('textarea');
      ta.value = plainText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mt-5 rounded-[14px] border border-dashed border-ink-faint/45 bg-paper-deep/45 px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="label-caps">Florist order card</div>
        <div className="font-display text-[15px] text-ink">
          ${bouquet.price.low}–${bouquet.price.high}
        </div>
      </div>

      <ul className="space-y-1.5">
        {bouquet.stems.map((r) => (
          <li key={r.id} className="flex items-baseline gap-2.5 text-[14px]">
            <span className="w-6 shrink-0 text-right font-display text-[15px] text-ink">{r.count}</span>
            <span
              className="h-2.5 w-2.5 shrink-0 translate-y-[1px] rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: r.hex }}
            />
            <span className="flex-1 text-ink">
              {r.name.toLowerCase()}{' '}
              <span className="text-ink-faint">in {r.color}</span>
            </span>
            {r.tier === 'must' && (
              <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-rose">
                must
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-soft">
        {wrapText(bouquet.wrap)}. In season {bouquet.seasons.join(', ')}.
      </p>

      <button
        type="button"
        onClick={copy}
        className="mt-4 w-full rounded-full bg-ink py-2.5 text-[11px] uppercase tracking-[0.14em] text-paper transition active:scale-[0.99]"
      >
        {copied ? 'Copied' : 'Copy as plain text'}
      </button>
    </div>
  );
}

const wrapText = (wrap) => ({
  kraft: 'Ribbon-tied in kraft paper',
  clear: 'Wrapped in clear cellophane',
  'ribbon-tied': 'Hand-tied with ribbon',
  vase: 'Arranged in a simple clear vase',
}[wrap] ?? wrap);

// ---------------------------------------------------------------------------
function ManualPrefs({ prefs }) {
  const hasStructured =
    (prefs.neverColors?.length ?? 0) ||
    prefs.scentSensitivity || prefs.vessel || prefs.occasion || prefs.maxBudget ||
    (prefs.dislikedFlowerIds?.length ?? 0);

  if (!prefs.note && !hasStructured) return null;

  return (
    <section className="mb-10">
      <SectionTitle>In her own words</SectionTitle>

      {prefs.note && (
        // Verbatim. Never parsed, never summarised.
        <blockquote className="mt-4 border-l-2 border-rose/70 bg-paper-deep/45 px-5 py-4">
          <p className="prose-serif whitespace-pre-wrap text-[16.5px] leading-[1.65] text-ink">
            {prefs.note}
          </p>
        </blockquote>
      )}

      {hasStructured && (
        <dl className="mt-4 space-y-3 text-[14px]">
          {prefs.neverColors?.length > 0 && (
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">Never</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {prefs.neverColors.map((f) => (
                  <span key={f} className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-1 pl-1.5 pr-2.5 text-[12.5px] text-ink-soft">
                    <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ backgroundColor: colorHex(f) }} />
                    {colorLabel(f)}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {prefs.dislikedFlowerIds?.length > 0 && (
            <Row label="Won't touch">
              {prefs.dislikedFlowerIds.map((id) => INDEX.byId[id]?.commonName).filter(Boolean).join(', ')}
            </Row>
          )}
          {prefs.scentSensitivity && <Row label="Scent">{scentText(prefs.scentSensitivity)}</Row>}
          {prefs.vessel && <Row label="Vessel">{vesselText(prefs.vessel)}</Row>}
          {prefs.occasion && <Row label="Occasion">{prefs.occasion.replace(/-/g, ' ')}</Row>}
          {prefs.maxBudget && <Row label="Budget">up to ${prefs.maxBudget}</Row>}
        </dl>
      )}
    </section>
  );
}

const scentText = (v) => ({
  'loves-scent': 'the stronger the better',
  sensitive: 'keep it light',
  allergic: 'allergies — unscented only',
}[v] ?? v);

const vesselText = (v) => ({
  vase: 'arranged in a vase', wrapped: 'wrapped bunch', potted: 'potted / living',
}[v] ?? v);

function Row({ label, children }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </dt>
      <dd className="flex-1 text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Exclusions({ exclusions }) {
  const all = [
    ...exclusions.design.map((e) => ({ key: `d-${e.reason}`, flowers: e.flowers, text: e.text })),
    ...exclusions.manual.map((e) => ({
      key: `m-${e.reason}`,
      flowers: e.flowers,
      text: e.text,
    })),
  ];
  if (!all.length) return null;

  return (
    <section className="mb-10">
      <SectionTitle>Left out on purpose</SectionTitle>
      <ul className="mt-3.5 space-y-4">
        {all.map(({ key, flowers, text }) => (
          <li key={key} className="flex gap-3.5">
            <span className="mt-0.5 flex w-[52px] shrink-0 justify-start -space-x-3">
              {flowers.slice(0, 3).map((f) => (
                <span
                  key={f.id}
                  className="h-9 w-9 rounded-full bg-cover bg-center opacity-65 ring-2 ring-paper grayscale"
                  style={{ backgroundImage: `url("${f.imageUrl}")` }}
                />
              ))}
            </span>
            <p className="prose-serif flex-1 text-[14.5px] leading-[1.6] text-ink-soft">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
function ShareBlock({ url, report }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | sending | sent | failed
  const [detail, setDetail] = useState('');

  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function send() {
    setStatus('sending');
    setDetail('');
    const res = await sendReport(report);
    if (res.ok) {
      setStatus('sent');
      return;
    }
    setStatus('failed');
    setDetail(
      res.reason === 'activation'
        ? 'Almost — this address needs to be confirmed once. Check the inbox for a confirmation email, then send again.'
        : 'Couldn’t send just now. Use the button below and it’ll go through your own mail app instead.',
    );
  }

  return (
    <section className="rounded-[20px] border border-line bg-paper-deep/55 px-6 py-6 text-center">
      <Sprig size={22} className="mx-auto text-sage" />
      <h2 className="mt-2 font-display text-[23px] text-ink">Send it to him</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
        Everything above — what you picked, what you wrote, and the exact stem lists
        for a florist — straight to his inbox.
      </p>

      <button
        type="button"
        onClick={send}
        disabled={status === 'sending' || status === 'sent'}
        className={`mt-4 w-full rounded-full py-3.5 text-[12px] uppercase tracking-[0.14em] text-paper transition active:scale-[0.99] ${
          status === 'sent' ? 'bg-[#4C7A5A]' : 'bg-rose'
        } ${status === 'sending' ? 'opacity-70' : ''}`}
      >
        {{
          idle: 'Send my flowers to him',
          sending: 'Sending…',
          sent: 'Sent ✓',
          failed: 'Try sending again',
        }[status]}
      </button>

      {status === 'sent' && (
        <p className="mt-2.5 text-center text-[13px] text-ink-soft">
          It’s on its way. You can close this now.
        </p>
      )}

      {status === 'failed' && (
        <>
          <p className="mt-2.5 text-[13px] leading-relaxed text-rose">{detail}</p>
          <a
            href={mailtoUrl(report, url)}
            className="mt-2.5 block w-full rounded-full border border-ink py-2.5 text-center text-[11px] uppercase tracking-[0.14em] text-ink"
          >
            Open my mail app instead
          </a>
        </>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[12.5px] leading-relaxed text-ink-faint">
          Or just send him the link yourself — it holds everything, and it doesn’t
          go through anyone else.
        </p>
        <button
          type="button"
          onClick={copy}
          className="mt-2.5 w-full rounded-full border border-line bg-paper py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-soft transition active:scale-[0.99]"
        >
          {copied ? 'Link copied' : 'Copy my link'}
        </button>
      </div>
    </section>
  );
}
