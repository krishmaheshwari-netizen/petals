// Manual preferences.
//
// Always reachable, saved to localStorage, and carried through to the share
// link. Two halves:
//
//   - a free-text box, stored and displayed VERBATIM. It is never parsed,
//     summarised or fed into the generator. Whatever she writes is what he sees.
//   - structured chips, which ARE machine-readable and act as hard exclusions in
//     the generator, overriding any swipe score.

import { useState } from 'react';
import { FLOWERS, FILLERS } from '../lib/deck.js';
import { NEVER_COLORS, SCENT_OPTIONS, VESSEL_OPTIONS, OCCASION_OPTIONS } from '../lib/preference-options.js';

export default function Preferences({ prefs, setPrefs }) {
  const [flowerQuery, setFlowerQuery] = useState('');
  const all = [...FLOWERS, ...FILLERS];

  const update = (patch) => setPrefs({ ...prefs, ...patch });

  const toggleColor = (family) => {
    const set = new Set(prefs.neverColors ?? []);
    if (set.has(family)) set.delete(family);
    else set.add(family);
    update({ neverColors: [...set] });
  };

  const toggleDislike = (id) => {
    const set = new Set(prefs.dislikedFlowerIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ dislikedFlowerIds: [...set] });
  };

  const matches = flowerQuery.trim()
    ? all.filter((f) => f.commonName.toLowerCase().includes(flowerQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  const disliked = (prefs.dislikedFlowerIds ?? [])
    .map((id) => all.find((f) => f.id === id))
    .filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-lg px-5 pb-28 pt-6">
      <header className="mb-7">
        <h1 className="font-display text-[32px] leading-tight text-ink">Anything else?</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
          None of this is guessed from your swipes. Whatever you set here wins.
        </p>
      </header>

      {/* ---- free text: stored and shown exactly as written ---- */}
      <Section title="In your own words" hint="Passed along word for word — nothing here gets interpreted.">
        <textarea
          value={prefs.note ?? ''}
          onChange={(e) => update({ note: e.target.value })}
          rows={5}
          placeholder="Anything you want me to know…"
          className="w-full resize-y rounded-2xl border border-line bg-paper-deep/60 px-4 py-3.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-rose focus:outline-none focus:ring-2 focus:ring-rose-soft"
        />
      </Section>

      {/* ---- hard exclusions ---- */}
      <Section title="Colours you never want" hint="These are removed outright, however you swiped.">
        <div className="flex flex-wrap gap-2">
          {NEVER_COLORS.map((c) => {
            const on = (prefs.neverColors ?? []).includes(c.family);
            return (
              <button
                key={c.family}
                type="button"
                onClick={() => toggleColor(c.family)}
                className={`flex items-center gap-2 rounded-full border py-1.5 pl-2 pr-3.5 text-[13px] transition ${
                  on
                    ? 'border-rose bg-rose text-white line-through decoration-white/60'
                    : 'border-line bg-paper-deep/50 text-ink-soft hover:border-ink-faint'
                }`}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: c.hex }}
                />
                {c.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Scent">
        <ChipRow
          options={SCENT_OPTIONS}
          value={prefs.scentSensitivity ?? ''}
          onChange={(v) => update({ scentSensitivity: v })}
        />
        {(prefs.scentSensitivity === 'sensitive' || prefs.scentSensitivity === 'allergic') && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-rose">
            Sweet- and spice-scented flowers will be excluded entirely.
          </p>
        )}
      </Section>

      <Section title="How you'd rather have them">
        <ChipRow
          options={VESSEL_OPTIONS}
          value={prefs.vessel ?? ''}
          onChange={(v) => update({ vessel: v })}
        />
      </Section>

      <Section title="Usually for">
        <ChipRow
          options={OCCASION_OPTIONS}
          value={prefs.occasion ?? ''}
          onChange={(v) => update({ occasion: v })}
        />
      </Section>

      <Section title="Budget" hint="A ceiling, not a target.">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-2xl text-ink-faint">$</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="5"
            value={prefs.maxBudget ?? ''}
            onChange={(e) => update({ maxBudget: e.target.value })}
            placeholder="no limit"
            className="w-36 rounded-xl border border-line bg-paper-deep/60 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-rose focus:outline-none focus:ring-2 focus:ring-rose-soft"
          />
        </div>
      </Section>

      <Section title="Flowers you actively dislike" hint="Hard exclusions. These never appear in a recommendation.">
        <input
          type="text"
          value={flowerQuery}
          onChange={(e) => setFlowerQuery(e.target.value)}
          placeholder="Search flowers…"
          className="w-full rounded-xl border border-line bg-paper-deep/60 px-4 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-rose focus:outline-none focus:ring-2 focus:ring-rose-soft"
        />
        {matches.length > 0 && (
          <ul className="mt-2 overflow-hidden rounded-xl border border-line">
            {matches.map((f) => {
              const on = (prefs.dislikedFlowerIds ?? []).includes(f.id);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => toggleDislike(f.id)}
                    className="flex w-full items-center gap-3 border-b border-line/60 bg-paper px-3.5 py-2.5 text-left text-[14px] last:border-b-0 hover:bg-paper-deep"
                  >
                    <span
                      className="h-6 w-6 shrink-0 rounded-full bg-cover bg-center ring-1 ring-line"
                      style={{ backgroundImage: `url("${f.imageUrl}")` }}
                    />
                    <span className="flex-1 text-ink">{f.commonName}</span>
                    <span className={`text-[12px] ${on ? 'text-rose' : 'text-ink-faint'}`}>
                      {on ? 'excluded' : 'exclude'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {disliked.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {disliked.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => toggleDislike(f.id)}
                className="flex items-center gap-1.5 rounded-full border border-rose bg-rose px-3 py-1.5 text-[13px] text-white"
              >
                {f.commonName}
                <span aria-hidden className="text-white/70">×</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-[19px] text-ink">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function ChipRow({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3.5 py-1.5 text-[13px] transition ${
            value === o.value
              ? 'border-ink bg-ink text-paper'
              : 'border-line bg-paper-deep/50 text-ink-soft hover:border-ink-faint'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

