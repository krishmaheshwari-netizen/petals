// Composed bouquet rendering.
//
// There are no bouquet photographs in this app -- Commons has almost none that
// are usable -- so each arrangement is DRAWN from the verified single-flower
// photos.
//
// The first version scattered one circle per variety across the frame, which
// read as three unrelated stock photos rather than a bouquet. What actually
// makes something look like an arrangement is not the individual blooms, it is:
//
//   * MASS      blooms overlap into a single dome, not spaced out in a row
//   * REPEAT    a real bouquet uses several stems of each variety, not one
//   * STEMS     everything converges to one tie point below the flowers
//   * A BASE    the wrap or vase that the stems disappear into
//
// So the layout builds a dome of many overlapping blooms, draws stems from each
// down to a single tie, and renders the wrap underneath.

import { INDEX } from '../lib/deck.js';

/** Stable per-bouquet jitter, so a given arrangement always draws identically. */
function seededRandom(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The dome the blooms are massed into, in percentage coordinates.
const DOME = { cx: 50, cy: 40, rx: 33, ry: 25 };
const TIE = { x: 50, y: 74 };

/**
 * Places blooms in overlapping rings. Focal varieties go biggest and centre,
 * secondaries fill the ring around them, filler breaks the outline at the edge.
 * Each variety repeats, because that is what a florist actually does.
 */
function buildLayout(focals, secondaries, fillers, seed) {
  const rand = seededRandom(seed);
  const jitter = (n) => (rand() - 0.5) * n;
  const out = [];

  const push = (stem, x, y, size, z, opacity, blur) =>
    out.push({ stem, x, y, size, z, opacity, blur, rot: jitter(26) });

  // Outer ring: filler, breaking the silhouette so it isn't a hard circle.
  if (fillers.length) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI; // sweep across the top
      push(
        fillers[i % fillers.length],
        DOME.cx + Math.cos(a) * (DOME.rx * 1.06) + jitter(6),
        DOME.cy + Math.sin(a) * (DOME.ry * 1.06) + jitter(5),
        15 + jitter(3),
        10, 0.62, 1.2,
      );
    }
  }

  // Middle ring: secondary varieties.
  const midSource = secondaries.length ? secondaries : focals;
  const midCount = midSource.length >= 2 ? 8 : 7;
  for (let i = 0; i < midCount; i++) {
    const a = Math.PI * 0.92 + (i / (midCount - 1)) * Math.PI * 1.16;
    push(
      midSource[i % midSource.length],
      DOME.cx + Math.cos(a) * (DOME.rx * 0.72) + jitter(5),
      DOME.cy + Math.sin(a) * (DOME.ry * 0.78) + jitter(4),
      17 + jitter(3),
      20, 0.97, 0.2,
    );
  }

  // Centre: the focal flowers, largest and fully opaque.
  const focalSpots = [
    { x: 0, y: 2, s: 25 }, { x: -14, y: -4, s: 21 }, { x: 14, y: -3, s: 21 },
    { x: -6, y: 11, s: 19 }, { x: 9, y: 12, s: 18 },
  ];
  focalSpots.forEach((spot, i) => {
    const stem = focals[i % focals.length];
    if (!stem) return;
    push(stem, DOME.cx + spot.x + jitter(3), DOME.cy + spot.y + jitter(2), spot.s, 30 + i, 1, 0);
  });

  return out;
}

function Bloom({ item }) {
  const { stem, x, y, size, z, opacity, blur, rot } = item;
  if (!stem) return null;
  return (
    <div
      className="absolute no-drag"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}%`,
        aspectRatio: '1 / 1',
        transform: `translate(-50%, -50%) rotate(${rot}deg)`,
        zIndex: z,
        opacity,
        filter: blur ? `blur(${blur}px) saturate(0.9) brightness(1.1)` : undefined,
        borderRadius: '50%',
        overflow: 'hidden',
        // A soft edge so the circular crops melt into each other rather than
        // sitting on the card as separate discs.
        WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 46%, rgba(0,0,0,0.75) 64%, transparent 80%)',
        maskImage: 'radial-gradient(circle at 50% 50%, #000 46%, rgba(0,0,0,0.75) 64%, transparent 80%)',
      }}
    >
      {/* Zoomed well in: the source photos are whole-plant shots, and only the
          middle of the frame is reliably flower rather than leaves. */}
      <div
        className="h-full w-full bg-cover bg-center"
        style={{ backgroundImage: `url("${stem.imageUrl}")`, transform: 'scale(1.9)' }}
      />
    </div>
  );
}

/** Stems converging from the flower mass down to a single tie. */
function Stems({ items }) {
  const anchors = items.filter((i) => i.z >= 20).slice(0, 11);
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 6 }}
      aria-hidden="true"
    >
      {anchors.map((a, i) => (
        <path
          key={i}
          d={`M ${a.x} ${a.y + 3} C ${a.x} ${(a.y + TIE.y) / 2}, ${TIE.x + (a.x - TIE.x) * 0.18} ${(a.y + TIE.y) / 2}, ${TIE.x} ${TIE.y}`}
          stroke="#6E7C5C"
          strokeOpacity={0.5}
          strokeWidth={0.7}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {/* Cut ends below the tie, splayed very slightly. */}
      {[-3.4, -1.7, 0, 1.7, 3.4].map((dx, i) => (
        <path
          key={`end-${i}`}
          d={`M ${TIE.x} ${TIE.y} L ${TIE.x + dx} 93`}
          stroke="#5E6B4E"
          strokeOpacity={0.55}
          strokeWidth={0.75}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** The wrap or vessel the stems disappear into. */
function Base({ wrap }) {
  const common = { className: 'pointer-events-none absolute inset-0 h-full w-full', style: { zIndex: 8 } };
  if (wrap === 'vase') {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" {...common} aria-hidden="true">
        <path d="M41 79 L39.5 96 Q50 99 60.5 96 L59 79 Z" fill="#DCE3E6" fillOpacity="0.7" stroke="#B9C4C8" strokeWidth="0.5" />
        <path d="M41 79 L59 79" stroke="#B9C4C8" strokeWidth="0.6" />
      </svg>
    );
  }
  if (wrap === 'ribbon-tied') {
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" {...common} aria-hidden="true">
        <rect x="44.5" y="76" width="11" height="3" rx="1.5" fill="#A8425C" fillOpacity="0.8" />
        <path d="M45 79 Q41 83 42.5 86" stroke="#A8425C" strokeOpacity="0.65" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M55 79 Q59 83 57.5 86" stroke="#A8425C" strokeOpacity="0.65" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  // kraft / clear: a paper cone
  const paper = wrap === 'clear' ? '#EFEFE9' : '#DCC7A6';
  const edge = wrap === 'clear' ? '#D8D8CE' : '#C2A883';
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" {...common} aria-hidden="true">
      <path d="M34 76 L44 97 Q50 99 56 97 L66 76 Z" fill={paper} fillOpacity={wrap === 'clear' ? 0.42 : 0.72} stroke={edge} strokeWidth="0.5" />
      <path d="M50 78 L50 97" stroke={edge} strokeWidth="0.4" strokeOpacity="0.7" />
    </svg>
  );
}

export default function BouquetComposition({ bouquet, className = '' }) {
  const get = (id) => INDEX.byId[id];
  const focals = (bouquet.focalIds ?? []).map(get).filter(Boolean);
  const secondaries = (bouquet.secondaryIds ?? []).map(get).filter(Boolean);
  const fillers = (bouquet.fillerIds ?? []).map(get).filter(Boolean);
  if (!focals.length) return <div className={className} />;

  const items = buildLayout(focals, secondaries, fillers, bouquet.id ?? 'x');
  const wash = bouquet.paletteHexes?.[0] ?? '#EADFD0';
  const wash2 = bouquet.paletteHexes?.[1] ?? wash;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(115% 80% at 50% 42%, ${wash}44 0%, ${wash2}26 48%, transparent 74%)`,
        }}
      />
      <Stems items={items} />
      <Base wrap={bouquet.wrap} />
      {items.map((item, i) => (
        <Bloom key={`${item.stem?.id}-${i}`} item={item} />
      ))}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 60, background: 'radial-gradient(110% 78% at 50% 42%, transparent 55%, rgba(43,37,31,0.14) 100%)' }}
      />
    </div>
  );
}

/** The 2-4 swatch strip that appears under every bouquet composition. */
export function PaletteBar({ hexes = [], className = '' }) {
  const shown = hexes.slice(0, 4);
  if (!shown.length) return null;
  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full ${className}`}>
      {shown.map((hex, i) => (
        <div key={`${hex}-${i}`} className="h-full flex-1" style={{ backgroundColor: hex }} />
      ))}
    </div>
  );
}
