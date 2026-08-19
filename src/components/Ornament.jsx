// Botanical ornaments.
//
// Drawn as hairline SVG rather than emoji or icon-font glyphs, so they sit at
// the same optical weight as the rules and type around them. These are what make
// the thing read as floral -- colour alone just reads as pink.

/** A small sprig: one stem, a few leaves, used as a mark or a rule centrepiece. */
export function Sprig({ size = 18, className = '', strokeWidth = 1.1 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 21V6" />
      <path d="M12 10c0-2.2 1.7-4 3.9-4 0 2.2-1.7 4-3.9 4z" />
      <path d="M12 10c0-2.2-1.7-4-3.9-4 0 2.2 1.7 4 3.9 4z" />
      <path d="M12 15.5c0-2 1.5-3.6 3.5-3.6 0 2-1.6 3.6-3.5 3.6z" />
      <path d="M12 15.5c0-2-1.5-3.6-3.5-3.6 0 2 1.6 3.6 3.5 3.6z" />
      <circle cx="12" cy="4.4" r="1.5" />
    </svg>
  );
}

/** A single leaf, for list bullets and inline marks. */
export function Leaf({ size = 14, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 4c0 8-5.5 13-12 13-1.6 0-3-.3-4-.8C4 8.2 9.6 4 20 4z" />
      <path d="M4 20c3.5-4.6 7.4-7.6 12-9.4" />
    </svg>
  );
}

/**
 * A section rule with a sprig sitting in it -- the printed-page equivalent of a
 * heading underline, and the main structural ornament in the app.
 */
export function SprigRule({ className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden="true">
      <div className="rule-fade flex-1" />
      <Sprig size={15} className="shrink-0 text-sage" />
      <div className="rule-fade flex-1" />
    </div>
  );
}
