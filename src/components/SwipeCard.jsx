// One card in the deck, with real drag physics.
//
// Right = love, left = pass, up = obsessed (2x weight). Tap flips the card over
// for the details. The card is thrown with momentum rather than faded: velocity
// carries past the threshold, and the tilt is proportional to horizontal offset
// so it feels like a physical card being pushed off a pile.

import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform, useMotionValueEvent } from 'framer-motion';
import BouquetComposition, { PaletteBar } from './BouquetComposition.jsx';
import { INDEX } from '../lib/deck.js';

// How far the card has to actually travel before the decision locks in. These
// are deliberately generous: a card that commits after a twitch feels like a
// misfire rather than a choice, and there is no satisfaction in it. You should
// be able to push the card well off-centre, look at it there, and still change
// your mind by letting it spring back.
// Commit distance is a FRACTION OF THE CARD, not a fixed pixel count. 170px was
// ~40% of the width of a phone screen, which meant an ordinary swipe fell short
// and sprang back -- the card felt like it was ignoring you. A third of the card
// is far enough to feel deliberate and short enough to be reachable with a thumb.
const COMMIT_FRACTION = 0.32;
const MIN_DISTANCE = 90;
const MAX_DISTANCE = 150;
// A flick should also commit even if it never travels far.
const VELOCITY_THRESHOLD = 500;

const STYLE_LABEL = {
  'loose-garden': 'Loose garden',
  'structured-round': 'Structured round',
  asymmetric: 'Asymmetric',
  wildflower: 'Wildflower',
  'minimal-single-variety': 'Single variety',
  cascading: 'Cascading',
};

const PALETTE_LABEL = {
  monochrome: 'One colour',
  analogous: 'Neighbouring colours',
  complementary: 'Opposite colours',
  'neutral-plus-accent': 'Neutral + one accent',
  'high-contrast': 'High contrast',
};

const WRAP_LABEL = {
  kraft: 'kraft paper', clear: 'clear wrap', 'ribbon-tied': 'ribbon-tied', vase: 'in a vase',
};

const SCENT_LABEL = {
  none: 'No scent', light: 'Light scent', sweet: 'Sweet scent',
  spicy: 'Spicy scent', green: 'Green, herbal scent',
};

export default function SwipeCard({ card, onDecide, isTop, offset }) {
  const [flipped, setFlipped] = useState(false);
  // A drag that falls short of the threshold springs back -- but the browser
  // still fires a click afterwards, which would flip the card, so a swipe that
  // didn't quite commit ALSO turned the card over.
  //
  // Two wrong guards were tried first, both of which broke tapping:
  //   1. "did Framer report a drag" -- it starts dragging after ~3px, and a
  //      finger tap always jitters, so real taps were discarded.
  //   2. comparing pointerdown to click coordinates -- motion components own the
  //      pointer props, so the handler never ran, pressRef stayed at {0,0}, and
  //      every tap measured as a ~400px drag and was discarded.
  // Framer's own drag report is the reliable signal: onDragEnd fires only when a
  // drag actually happened, and it fires before the click.
  const dragDistanceRef = useRef(0);

  // The flip is driven by a motion value rather than `animate={{ rotateY }}` so
  // that face visibility can be derived from the ACTUAL angle. Switching faces on
  // a fixed timer instead left a window where the front had been hidden but the
  // back was still culled by backface-visibility -- the card went completely
  // transparent and you saw the card behind it.
  const flipAngle = useMotionValue(0);
  const faceUp = (r) => { const a = ((r % 360) + 360) % 360; return a < 90 || a > 270; };
  const frontVisibility = useTransform(flipAngle, (r) => (faceUp(r) ? 'visible' : 'hidden'));
  const backVisibility = useTransform(flipAngle, (r) => (faceUp(r) ? 'hidden' : 'visible'));
  const cardRef = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotate = useTransform(x, [-300, 0, 300], [-22, 0, 22]);
  // Stamps fade in across the second half of the throw, so they read as
  // "this is where it will land" rather than firing on the first pixel.
  const loveOpacity = useTransform(x, [45, 130], [0, 1]);
  const passOpacity = useTransform(x, [-130, -45], [1, 0]);
  const obsessedOpacity = useTransform(y, [-130, -45], [1, 0]);
  // A little lift as the card is pulled away from the pile.
  const lift = useTransform(x, [-300, 0, 300], [1.04, 1, 1.04]);

  // Track the live drag so the stamp overlays don't fight each other.
  const [dir, setDir] = useState(null);
  useMotionValueEvent(x, 'change', (v) => {
    const yv = y.get();
    if (yv < -70 && Math.abs(v) < 90) setDir('obsessed');
    else if (v > 45) setDir('love');
    else if (v < -45) setDir('pass');
    else setDir(null);
  });

  function handleDragEnd(_e, info) {
    const { offset: o, velocity: v } = info;
    // Remembered so the click that follows a spring-back can be ignored.
    dragDistanceRef.current = Math.hypot(o.x, o.y);
    const cardWidth = cardRef.current?.offsetWidth ?? 360;
    const threshold = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, cardWidth * COMMIT_FRACTION));
    const upward = o.y < -threshold || v.y < -VELOCITY_THRESHOLD;
    const rightward = o.x > threshold || v.x > VELOCITY_THRESHOLD;
    const leftward = o.x < -threshold || v.x < -VELOCITY_THRESHOLD;

    // Up wins only when the throw was genuinely more vertical than horizontal.
    if (upward && Math.abs(o.y) > Math.abs(o.x)) onDecide('obsessed');
    else if (rightward) onDecide('love');
    else if (leftward) onDecide('pass');
    setDir(null);
  }

  useEffect(() => {
    const controls = animate(flipAngle, flipped ? 180 : 0, {
      type: 'spring', stiffness: 260, damping: 30,
    });
    return () => controls.stop();
  }, [flipped, flipAngle]);

  const isBouquet = card.type === 'bouquet';
  const depth = Math.min(offset, 2);

  return (
    <motion.div
      ref={cardRef}
      className="absolute inset-0 no-drag"
      style={{ x, y, rotate, scale: isTop ? lift : 1, zIndex: 100 - offset, touchAction: 'none' }}
      drag={isTop}
      dragElastic={0.95}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.94, y: 14, opacity: 0 }}
      animate={{
        scale: 1 - depth * 0.04,
        y: depth * 12,
        opacity: offset > 2 ? 0 : 1,
      }}
      exit={{
        x: dir === 'love' ? 700 : dir === 'pass' ? -700 : 0,
        y: dir === 'obsessed' ? -640 : 0,
        opacity: 0,
        rotate: dir === 'love' ? 28 : dir === 'pass' ? -28 : 0,
        transition: { duration: 0.38, ease: [0.22, 0.61, 0.36, 1] },
      }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      whileTap={isTop ? { cursor: 'grabbing' } : undefined}
    >
      <div
        className="relative h-full w-full"
        style={{ perspective: 1400 }}
        onClick={() => {
          if (!isTop) return;
          // A gesture that travelled was a swipe, not a tap. Reset either way,
          // so one ignored swipe can never wedge tapping permanently.
          const travelled = dragDistanceRef.current;
          dragDistanceRef.current = 0;
          if (travelled > 12) return;
          setFlipped((f) => !f);
        }}
      >
        <motion.div
          className="relative h-full w-full"
          style={{ transformStyle: 'preserve-3d', rotateY: flipAngle }}
        >
          {/* ---------------- front ---------------- */}
          {/* `backface-visibility: hidden` does NOT cull descendants that carry
              their own transforms -- and every bloom in a composed bouquet is a
              transformed element -- so in Safari the circles stayed visible on
              top of the flipped-over description. Visibility is therefore
              switched explicitly at the halfway point of the turn, where the
              face is edge-on and the change cannot be seen. */}
          <motion.div
            className="absolute inset-0 overflow-hidden rounded-[28px] bg-paper-deep shadow-[0_18px_40px_-12px_rgba(52,44,36,0.35),0_2px_6px_rgba(52,44,36,0.12)] ring-1 ring-line"
            style={{ backfaceVisibility: 'hidden', visibility: frontVisibility }}
          >
            {isBouquet ? (
              <BouquetFront bouquet={card.data} />
            ) : (
              <FlowerFront flower={card.data} isFiller={card.type === 'filler'} />
            )}

            <Stamp label="Love" color="#4C7A5A" opacity={loveOpacity} position="left-6 top-7 -rotate-12" />
            <Stamp label="Pass" color="#9C6154" opacity={passOpacity} position="right-6 top-7 rotate-12" />
            <Stamp label="Obsessed" color="#B14A63" opacity={obsessedOpacity} position="left-1/2 top-10 -translate-x-1/2 -rotate-3" />
          </motion.div>

          {/* ---------------- back ---------------- */}
          <motion.div
            className="absolute inset-0 overflow-y-auto rounded-[28px] bg-paper px-6 py-7 shadow-[0_18px_40px_-12px_rgba(52,44,36,0.35)] ring-1 ring-line"
            style={{ backfaceVisibility: 'hidden', rotateY: 180, visibility: backVisibility }}
          >
            {isBouquet ? <BouquetBack bouquet={card.data} /> : <FlowerBack flower={card.data} />}
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Stamp({ label, color, opacity, position }) {
  return (
    <motion.div
      className={`pointer-events-none absolute ${position} rounded-lg border-[3px] px-3 py-1 font-display text-xl tracking-wide`}
      style={{ opacity, color, borderColor: color, backgroundColor: 'rgba(250,245,236,0.72)' }}
    >
      {label}
    </motion.div>
  );
}

function FlowerFront({ flower, isFiller }) {
  return (
    <>
      <img
        src={flower.imageUrl}
        alt={flower.commonName}
        className="h-full w-full object-cover no-drag"
        draggable={false}
        loading="eager"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[rgba(28,23,18,0.88)] via-[rgba(28,23,18,0.45)] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-6">
        {isFiller && (
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70">
            Greenery
          </div>
        )}
        <h2 className="font-display text-[34px] leading-[1.05] text-white drop-shadow-sm">
          {flower.commonName}
        </h2>
        <p className="mt-1 font-display text-sm italic text-white/70">{flower.scientificName}</p>
      </div>
      <div className="absolute right-5 top-5 flex items-center gap-1.5">
        {flower.colors.slice(0, 4).map((c) => (
          <span
            key={c.hex}
            className="h-3.5 w-3.5 rounded-full ring-1 ring-white/70"
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </>
  );
}

function BouquetFront({ bouquet }) {
  return (
    <div className="flex h-full w-full flex-col bg-[#F6EEE1]">
      <BouquetComposition bouquet={bouquet} className="min-h-0 flex-1" />
      <div className="border-t border-line/70 bg-paper px-6 pb-6 pt-4">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
          Arrangement
        </div>
        <h2 className="font-display text-[30px] leading-[1.05] text-ink">{bouquet.name}</h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          {STYLE_LABEL[bouquet.style] ?? bouquet.style} · {WRAP_LABEL[bouquet.wrap] ?? bouquet.wrap}
        </p>
        <PaletteBar hexes={bouquet.paletteHexes} className="mt-3.5 ring-1 ring-line" />
      </div>
    </div>
  );
}

function FlowerBack({ flower }) {
  return (
    <div className="flex h-full flex-col">
      <h2 className="font-display text-3xl leading-tight text-ink">{flower.commonName}</h2>
      <p className="font-display text-sm italic text-ink-faint">{flower.scientificName}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{flower.blurb}</p>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Fact label="Shape" value={cap(flower.form)} />
        <Fact label="Role" value={cap(flower.scale)} />
        <Fact label="Scent" value={SCENT_LABEL[flower.scent]} />
        <Fact label="Cost" value={'·'.repeat(0) + '$'.repeat(flower.priceTier)} />
        <Fact label="In season" value={flower.seasons.map(cap).join(', ')} className="col-span-2" />
      </dl>

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          Comes in
        </div>
        <div className="flex flex-wrap gap-1.5">
          {flower.colors.map((c) => (
            <span
              key={c.hex}
              className="flex items-center gap-1.5 rounded-full border border-line bg-paper-deep py-1 pl-1.5 pr-2.5 text-[12px] text-ink-soft"
            >
              <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ backgroundColor: c.hex }} />
              {c.name}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-5 text-[10px] leading-relaxed text-ink-faint">
        Photo: {flower.imageAttribution.artist} · {flower.imageAttribution.license} · Wikimedia Commons
      </div>
    </div>
  );
}

function BouquetBack({ bouquet }) {
  const stems = [
    ...bouquet.focalIds.map((id) => ({ id, role: 'Focal' })),
    ...bouquet.secondaryIds.map((id) => ({ id, role: 'Secondary' })),
    ...bouquet.fillerIds.map((id) => ({ id, role: 'Filler' })),
  ];
  return (
    <div className="flex h-full flex-col">
      <h2 className="font-display text-3xl leading-tight text-ink">{bouquet.name}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{bouquet.blurb}</p>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Fact label="Style" value={STYLE_LABEL[bouquet.style] ?? bouquet.style} />
        <Fact label="Palette" value={PALETTE_LABEL[bouquet.paletteType] ?? bouquet.paletteType} />
        <Fact label="Wrapped" value={cap(WRAP_LABEL[bouquet.wrap] ?? bouquet.wrap)} />
        <Fact label="Cost" value={'$'.repeat(bouquet.priceTier)} />
      </dl>

      <div className="mt-5">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          What's in it
        </div>
        <ul className="space-y-1.5">
          {stems.map(({ id, role }) => {
            const f = INDEX.byId[id];
            if (!f) return null;
            return (
              <li key={`${role}-${id}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink">{f.commonName}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-faint">{role}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <PaletteBar hexes={bouquet.paletteHexes} className="mt-auto ring-1 ring-line" />
    </div>
  );
}

function Fact({ label, value, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
