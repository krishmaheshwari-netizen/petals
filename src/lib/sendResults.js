// Emailing the results.
//
// There is no backend, so the "send" button hands the report to a form-relay
// service which forwards it as an email. FormSubmit is used because it needs no
// account and no API key -- you POST to it with the destination address and it
// emails you.
//
// WHAT THIS MEANS FOR PRIVACY: the report (including her free-text note) passes
// through formsubmit.co's servers on its way to the inbox. That is a third party
// seeing the message. The share link on its own never touches a server, so if
// you would rather nothing be relayed, use the copy-link button instead.
//
// FIRST USE: the very first submission to a new address triggers a confirmation
// email from FormSubmit to that address. Click the link in it once and every
// later send goes straight through.
//
// To stop the address appearing in the built JavaScript, activate it once, take
// the random alias FormSubmit gives you, and put that here instead of the plain
// address -- it works identically.
export const DELIVERY = {
  endpoint: 'https://formsubmit.co/ajax/tatertot1783@gmail.com',
  to: 'tatertot1783@gmail.com',
  subject: 'Petals — her flower picks',
};

const WRAP_TEXT = {
  kraft: 'Ribbon-tied in kraft paper',
  clear: 'Wrapped in clear cellophane',
  'ribbon-tied': 'Hand-tied with ribbon',
  vase: 'Arranged in a simple clear vase',
};

const SCENT_TEXT = {
  'loves-scent': 'the stronger the better',
  sensitive: 'keep it light',
  allergic: 'allergies — unscented only',
};

const VESSEL_TEXT = {
  vase: 'arranged in a vase', wrapped: 'wrapped bunch', potted: 'potted / living',
};

/**
 * The whole report as plain text. Deliberately plain rather than HTML: it has to
 * survive being pasted into a florist's contact form, which is the entire point
 * of the order cards.
 */
export function buildReport({ profile, stems, bouquets, prefs, shareUrl, swipeCount }) {
  const L = [];

  L.push('PETALS — what she picked');
  L.push(`${swipeCount} cards swiped`);
  L.push('');

  if (shareUrl) {
    L.push('See it properly (taste profile, pictures, everything):');
    L.push(shareUrl);
    L.push('');
  }

  L.push('─────────────────────────────');
  L.push('HER TASTE');
  L.push('─────────────────────────────');
  for (const line of profile) L.push(`• ${line}`);
  L.push('');

  if (stems.length) {
    L.push('─────────────────────────────');
    L.push('TOP FIVE STEMS');
    L.push('─────────────────────────────');
    stems.forEach((s, i) => L.push(`${i + 1}. ${s.commonName} (${s.scientificName})`));
    L.push('');
  }

  // Her own words go in untouched, clearly fenced so it is obvious what is hers.
  if (prefs.note && prefs.note.trim()) {
    L.push('─────────────────────────────');
    L.push('IN HER OWN WORDS (exactly as written)');
    L.push('─────────────────────────────');
    L.push(prefs.note);
    L.push('');
  }

  const chips = [];
  if (prefs.neverColors?.length) chips.push(`Never: ${prefs.neverColors.join(', ')}`);
  if (prefs.dislikedFlowerIds?.length) chips.push(`Won't touch: ${prefs.dislikedFlowerIds.join(', ')}`);
  if (prefs.scentSensitivity) chips.push(`Scent: ${SCENT_TEXT[prefs.scentSensitivity] ?? prefs.scentSensitivity}`);
  if (prefs.vessel) chips.push(`Vessel: ${VESSEL_TEXT[prefs.vessel] ?? prefs.vessel}`);
  if (prefs.occasion) chips.push(`Occasion: ${prefs.occasion.replace(/-/g, ' ')}`);
  if (prefs.maxBudget) chips.push(`Budget: up to $${prefs.maxBudget}`);
  if (chips.length) {
    L.push('HER RULES (these override everything)');
    for (const c of chips) L.push(`• ${c}`);
    L.push('');
  }

  L.push('─────────────────────────────');
  L.push('ORDER THESE');
  L.push('─────────────────────────────');
  L.push('');

  bouquets.forEach((b, i) => {
    L.push(`${i + 1}. ${b.name.toUpperCase()}   ($${b.price.low}–$${b.price.high})`);
    L.push('');
    for (const r of b.stems) L.push(`   ${r.count} × ${r.name.toLowerCase()} — ${r.color}`);
    L.push('');
    L.push(`   ${WRAP_TEXT[b.wrap] ?? b.wrap}. In season ${b.seasons.join(', ')}.`);
    L.push('');
    L.push(`   Why it works: ${b.why}`);
    L.push('');
    L.push('   — paste this into the florist —');
    L.push(`   ${b.orderText}`);
    L.push('');
    L.push('');
  });

  return L.join('\n');
}

/**
 * Sends the report. Resolves to a status the UI can act on rather than throwing,
 * because the fallback (mailto / copy link) is a normal outcome, not an error.
 */
export async function sendReport(report, { fromName = 'Petals' } = {}) {
  try {
    const res = await fetch(DELIVERY.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: fromName,
        _subject: DELIVERY.subject,
        _template: 'box',
        message: report,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && String(data.success) === 'true') return { ok: true };

    // FormSubmit answers the first-ever send with an activation notice instead
    // of delivering, which is a distinct case worth telling the user about.
    const msg = String(data.message ?? '');
    if (/activat|confirm/i.test(msg)) return { ok: false, reason: 'activation', message: msg };
    return { ok: false, reason: 'rejected', message: msg || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: 'network', message: String(err?.message ?? err) };
  }
}

/** Fallback that never depends on a third party: open the user's mail app. */
export function mailtoUrl(report, shareUrl) {
  // Mail clients choke on very long bodies, so the fallback sends the link plus
  // a trimmed report rather than the whole thing.
  const trimmed = report.length > 1600 ? `${report.slice(0, 1600)}\n\n…full version at the link above.` : report;
  const body = shareUrl ? `${shareUrl}\n\n${trimmed}` : trimmed;
  return `mailto:${DELIVERY.to}?subject=${encodeURIComponent(DELIVERY.subject)}&body=${encodeURIComponent(body)}`;
}
