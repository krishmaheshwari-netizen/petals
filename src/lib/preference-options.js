// The option lists behind the manual preferences screen, plus the lookups the
// results screen needs to render a chosen colour back as a labelled swatch.
// These live outside the component file so that both screens can import them.

export const NEVER_COLORS = [
  { family: 'red', label: 'Red', hex: '#B32330' },
  { family: 'coral', label: 'Coral', hex: '#F0806D' },
  { family: 'peach', label: 'Peach', hex: '#F4BA92' },
  { family: 'gold', label: 'Yellow', hex: '#EFC02A' },
  { family: 'chartreuse', label: 'Lime', hex: '#C0CB5B' },
  { family: 'green', label: 'Green', hex: '#5C8352' },
  { family: 'blue', label: 'Blue', hex: '#3F55A0' },
  { family: 'violet', label: 'Purple', hex: '#6A4A9C' },
  { family: 'lilac', label: 'Lilac', hex: '#B49AD0' },
  { family: 'magenta', label: 'Magenta', hex: '#C0357B' },
  { family: 'pink', label: 'Pink', hex: '#DE7BA0' },
  { family: 'blush', label: 'Blush', hex: '#EFC3C6' },
  { family: 'wine', label: 'Burgundy', hex: '#6E1B2E' },
  { family: 'rust', label: 'Rust', hex: '#B05B34' },
  { family: 'cream', label: 'Cream / white', hex: '#F2EAD8' },
];

export const SCENT_OPTIONS = [
  { value: '', label: 'No preference' },
  { value: 'loves-scent', label: 'The stronger the better' },
  { value: 'sensitive', label: 'Keep it light' },
  { value: 'allergic', label: 'Allergies — unscented please' },
];

export const VESSEL_OPTIONS = [
  { value: '', label: 'No preference' },
  { value: 'vase', label: 'Arranged in a vase' },
  { value: 'wrapped', label: 'Wrapped bunch' },
  { value: 'potted', label: 'Potted / living' },
];

export const OCCASION_OPTIONS = [
  { value: '', label: 'No preference' },
  { value: 'just-because', label: 'Just because' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'apology', label: 'Sorry' },
  { value: 'celebration', label: 'Celebration' },
];


export function colorLabel(family) {
  return NEVER_COLORS.find((c) => c.family === family)?.label ?? family;
}

export function colorHex(family) {
  return NEVER_COLORS.find((c) => c.family === family)?.hex ?? '#CCC';
}
