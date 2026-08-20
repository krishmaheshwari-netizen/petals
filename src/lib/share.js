// Share encoding.
//
// Everything she does has to survive a trip through a URL, because there is no
// backend and no account. The payload is her swipes plus her manual preferences,
// compressed by hand into short keys and base64url'd.
//
// Swipes are stored as a single string of `id:verdict` pairs using one-character
// verdicts, which keeps a full 90-card deck comfortably inside URL length limits.

const VERDICT_TO_CHAR = { love: 'l', pass: 'p', obsessed: 'o' };
const CHAR_TO_VERDICT = { l: 'love', p: 'pass', o: 'obsessed' };

// Card ids look like `flower:garden-rose`; the type prefix is recoverable from
// the id itself, so it is dropped and restored on decode.
const TYPE_CHAR = { flower: 'f', filler: 'g', bouquet: 'b' };
const CHAR_TYPE = { f: 'flower', g: 'filler', b: 'bouquet' };

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare({ swipes, prefs, seed, showBouquets = true }) {
  const swipeStr = Object.entries(swipes)
    .map(([cardId, verdict]) => {
      const [type, id] = cardId.split(':');
      return `${TYPE_CHAR[type] ?? 'f'}${id}=${VERDICT_TO_CHAR[verdict] ?? 'p'}`;
    })
    .join(',');

  const payload = {
    v: 1,
    s: swipeStr,
    d: seed,
    b: showBouquets === false ? 0 : 1,
    p: {
      note: prefs.note || '',
      never: prefs.neverColors || [],
      scent: prefs.scentSensitivity || '',
      vessel: prefs.vessel || '',
      occasion: prefs.occasion || '',
      budget: prefs.maxBudget || '',
      dislikes: prefs.dislikedFlowerIds || [],
    },
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(param) {
  try {
    const payload = JSON.parse(fromBase64Url(param));
    if (!payload || payload.v !== 1) return null;

    const swipes = {};
    if (payload.s) {
      for (const chunk of payload.s.split(',')) {
        const [left, verdictChar] = chunk.split('=');
        if (!left || !verdictChar) continue;
        const type = CHAR_TYPE[left[0]] ?? 'flower';
        const id = left.slice(1);
        swipes[`${type}:${id}`] = CHAR_TO_VERDICT[verdictChar] ?? 'pass';
      }
    }

    const p = payload.p ?? {};
    return {
      swipes,
      seed: payload.d ?? 1,
      // Older links predate the toggle and always included arrangements.
      showBouquets: payload.b === undefined ? true : payload.b === 1,
      prefs: {
        note: p.note ?? '',
        neverColors: p.never ?? [],
        scentSensitivity: p.scent ?? '',
        vessel: p.vessel ?? '',
        occasion: p.occasion ?? '',
        maxBudget: p.budget ?? '',
        dislikedFlowerIds: p.dislikes ?? [],
      },
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(state) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = `?r=${encodeShare(state)}`;
  return url.toString();
}

export function readShareFromUrl() {
  const param = new URLSearchParams(window.location.search).get('r');
  return param ? decodeShare(param) : null;
}
