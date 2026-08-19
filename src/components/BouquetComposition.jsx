// Composed bouquet rendering.
//
// There are no bouquet photographs anywhere in this app. Every arrangement is
// drawn from the verified single-flower images in flowers.json / fillers.json,
// layered with CSS transforms and radial masks:
//
//     filler      behind, largest spread, reduced opacity and scale
//     secondary   flanking, mid-size, rotated outward
//     focal       front and centre, largest, fully opaque
//
// Each bloom is a circular masked crop of its source photo with a soft radial
// fade at the edge, so the square photo boundary never shows.

import { INDEX } from '../lib/deck.js';

// Where each stem sits, by role and index. Hand-placed rather than random, so a
// bouquet looks arranged instead of scattered.
const FOCAL_SPOTS = [
  { x: 50, y: 52, size: 52, rot: -4, z: 30 },
  { x: 33, y: 60, size: 44, rot: 7, z: 29 },
];
const SECONDARY_SPOTS = [
  { x: 72, y: 44, size: 34, rot: 12, z: 20 },
  { x: 26, y: 40, size: 32, rot: -14, z: 20 },
  { x: 61, y: 70, size: 30, rot: 5, z: 19 },
  { x: 40, y: 30, size: 28, rot: -8, z: 18 },
];
const FILLER_SPOTS = [
  { x: 18, y: 30, size: 40, rot: -22, z: 10 },
  { x: 82, y: 30, size: 40, rot: 22, z: 10 },
  { x: 50, y: 18, size: 38, rot: 0, z: 9 },
  { x: 76, y: 66, size: 34, rot: 30, z: 9 },
  { x: 24, y: 68, size: 34, rot: -30, z: 9 },
];

// The source photos are whole-plant shots, so a plain circular crop lands on
// leaves and background as often as on the flower. The image therefore sits in
// an inner element scaled up about the centre -- where the bloom almost always
// is -- while the mask stays on the unscaled parent so the soft edge is not
// magnified along with it.
function Bloom({ stem, spot, opacity, scale, blur, zoom = 1.5 }) {
  if (!stem) return null;
  const size = spot.size * scale;
  return (
    <div
      className="absolute no-drag"
      style={{
        left: `${spot.x}%`,
        top: `${spot.y}%`,
        width: `${size}%`,
        aspectRatio: '1 / 1',
        transform: `translate(-50%, -50%) rotate(${spot.rot}deg)`,
        zIndex: spot.z,
        opacity,
        filter: blur ? `blur(${blur}px) saturate(0.9)` : undefined,
        borderRadius: '50%',
        overflow: 'hidden',
        WebkitMaskImage: 'radial-gradient(circle at 50% 50%, #000 56%, rgba(0,0,0,0.6) 72%, transparent 82%)',
        maskImage: 'radial-gradient(circle at 50% 50%, #000 56%, rgba(0,0,0,0.6) 72%, transparent 82%)',
      }}
    >
      <div
        className="h-full w-full bg-cover bg-center"
        style={{
          backgroundImage: `url("${stem.imageUrl}")`,
          transform: `scale(${zoom})`,
        }}
      />
    </div>
  );
}

export default function BouquetComposition({ bouquet, className = '' }) {
  const get = (id) => INDEX.byId[id];
  const focals = (bouquet.focalIds ?? []).map(get).filter(Boolean);
  const secondaries = (bouquet.secondaryIds ?? []).map(get).filter(Boolean);
  const fillers = (bouquet.fillerIds ?? []).map(get).filter(Boolean);

  // A minimal single-variety bouquet repeats its one flower rather than looking
  // half-empty, which is what that style actually looks like in a vase.
  const focalRender = focals.length === 1 && !secondaries.length && !fillers.length
    ? [focals[0], focals[0]]
    : focals;

  // Soft wash behind everything, tinted to the palette, so the composition sits
  // on something rather than floating on the card.
  const wash = bouquet.paletteHexes?.[0] ?? '#EADFD0';
  const wash2 = bouquet.paletteHexes?.[1] ?? wash;

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 50% 62%, ${wash}55 0%, ${wash2}33 45%, transparent 72%)`,
        }}
      />

      {/* filler behind, knocked back in opacity and slightly blurred for depth */}
      {fillers.slice(0, 5).map((f, i) => (
        <Bloom
          key={`f-${f.id}-${i}`}
          stem={f}
          spot={FILLER_SPOTS[i % FILLER_SPOTS.length]}
          opacity={0.55}
          scale={1}
          blur={1.4}
          zoom={1.3}
        />
      ))}
      {/* a second, wider ring of filler when the style is a full one */}
      {fillers.length > 0 && (bouquet.style === 'structured-round' || bouquet.style === 'cascading') &&
        fillers.slice(0, 2).map((f, i) => (
          <Bloom
            key={`fx-${f.id}-${i}`}
            stem={f}
            spot={{ ...FILLER_SPOTS[(i + 3) % FILLER_SPOTS.length], size: 46, z: 8 }}
            opacity={0.4}
            scale={1}
            blur={2.2}
            zoom={1.25}
          />
        ))}

      {secondaries.slice(0, 4).map((f, i) => (
        <Bloom
          key={`s-${f.id}-${i}`}
          stem={f}
          spot={SECONDARY_SPOTS[i % SECONDARY_SPOTS.length]}
          opacity={0.94}
          scale={1}
          blur={0.3}
          zoom={1.55}
        />
      ))}

      {focalRender.slice(0, 2).map((f, i) => (
        <Bloom
          key={`p-${f.id}-${i}`}
          stem={f}
          spot={FOCAL_SPOTS[i % FOCAL_SPOTS.length]}
          opacity={1}
          scale={i === 0 ? 1.08 : 0.9}
          zoom={1.65}
        />
      ))}

      {/* vignette to pull the eye into the centre of the arrangement */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(115% 85% at 50% 55%, transparent 52%, rgba(52,44,36,0.16) 100%)' }}
      />
    </div>
  );
}

/** The 2-4 swatch strip that appears under every bouquet composition. */
export function PaletteBar({ hexes = [], className = '' }) {
  const shown = hexes.slice(0, 4);
  if (!shown.length) return null;
  return (
    <div className={`flex h-2.5 w-full overflow-hidden rounded-full ${className}`}>
      {shown.map((hex, i) => (
        <div key={`${hex}-${i}`} className="h-full flex-1" style={{ backgroundColor: hex }} />
      ))}
    </div>
  );
}
