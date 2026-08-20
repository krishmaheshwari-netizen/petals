// The finals round: two flowers, one question, no way to skip.
//
// The forced choice is the mechanic. A skip button would let her avoid exactly
// the close calls that carry the most information, so "can't decide" exists but
// is deliberately quiet and records a draw rather than discarding the round.

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { INDEX } from '../lib/deck.js';
import { nextPair, ranking, ELO } from '../lib/elo.js';
import { Sprig, SprigRule } from './Ornament.jsx';

function Contender({ flower, onPick, side }) {
  return (
    <motion.button
      type="button"
      onClick={onPick}
      className="group relative flex-1 overflow-hidden rounded-[18px] ring-1 ring-line"
      initial={{ opacity: 0, x: side === 'left' ? -18 : 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      whileTap={{ scale: 0.975 }}
    >
      <div className="relative aspect-[3/4] w-full">
        <img
          src={flower.imageUrl}
          alt={flower.commonName}
          className="h-full w-full object-cover no-drag"
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-[7px] rounded-[12px] border border-white/20" />
        <div className="pointer-events-none absolute inset-0 bg-ink/0 transition-colors group-active:bg-ink/10" />
      </div>
      <div className="bg-paper px-3 py-3 text-center">
        <div className="font-display text-[17px] leading-tight text-ink">{flower.commonName}</div>
        <div className="mt-0.5 font-display text-[11px] italic text-ink-faint">
          {flower.scientificName}
        </div>
      </div>
    </motion.button>
  );
}

export default function Finals({ state, onChoose, onFinish, onRestart }) {
  const pair = useMemo(() => (state ? nextPair(state) : null), [state]);
  const total = Math.max(state?.estimate ?? 0, state?.round ?? 0);
  const complete = !state || state.done || !pair;

  if (!state || Object.keys(state.ratings ?? {}).length < 2) {
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-20 text-center">
        <Sprig size={26} className="mx-auto text-sage" />
        <h1 className="mt-3 font-display text-[28px] text-ink">Not enough to compare yet</h1>
        <p className="prose-serif mt-2 text-[15px] text-ink-soft">
          Like a few more flowers in the deck and come back.
        </p>
      </div>
    );
  }

  if (complete) {
    const top = ranking(state).slice(0, 3).map((id) => INDEX.byId[id]?.commonName).filter(Boolean);
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-16 text-center">
        <Sprig size={30} className="mx-auto text-sage" />
        <h1 className="mt-3 font-display text-[32px] leading-tight text-ink">
          That settles it.
        </h1>
        <p className="prose-serif mx-auto mt-3 max-w-xs text-[15.5px] leading-[1.6] text-ink-soft">
          {state.round} comparisons. Your top three came out{' '}
          <span className="italic">{top.join(', ')}</span>.
        </p>
        <SprigRule className="my-7" />
        <button
          type="button"
          onClick={onFinish}
          className="rounded-full bg-rose px-8 py-3 text-[12px] uppercase tracking-[0.14em] text-paper transition active:scale-[0.99]"
        >
          See the results
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="mt-3 block w-full text-[11px] uppercase tracking-[0.13em] text-ink-faint underline underline-offset-4"
        >
          Run it again
        </button>
      </div>
    );
  }

  const [aId, bId] = pair;
  const a = INDEX.byId[aId];
  const b = INDEX.byId[bId];
  if (!a || !b) return null;

  return (
    <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-5">
      <header className="text-center">
        <div className="label-caps">
          {state.round + 1} of ~{total}
          {state.round >= ELO.kSwitchRound && <span className="ml-2 opacity-70">· refining</span>}
        </div>
        <h1 className="mt-2 font-display text-[27px] leading-tight text-ink">
          Which would you rather get?
        </h1>
        {/* Progress as a filling hairline, not a chunky bar. */}
        <div className="mx-auto mt-3.5 h-px w-40 bg-line">
          <div
            className="h-px bg-gradient-to-r from-sage to-rose transition-[width] duration-500"
            style={{ width: `${Math.min(100, (state.round / Math.max(1, total)) * 100)}%` }}
          />
        </div>
      </header>

      <AnimatePresence mode="wait">
        <div key={`${aId}-${bId}`} className="mt-6 flex items-stretch gap-3">
          <Contender flower={a} side="left" onPick={() => onChoose(aId, bId, 'a')} />
          <Contender flower={b} side="right" onPick={() => onChoose(aId, bId, 'b')} />
        </div>
      </AnimatePresence>

      <div className="mt-6 flex flex-col items-center gap-3">
        {/* Present but quiet: a draw is still information, a skip is not. */}
        <button
          type="button"
          onClick={() => onChoose(aId, bId, 'draw')}
          className="text-[11.5px] italic text-ink-faint underline underline-offset-4 transition hover:text-ink-soft"
        >
          can't decide
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="rounded-full border border-line px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint transition hover:border-ink-faint hover:text-ink-soft"
        >
          Good enough — show results
        </button>
      </div>
    </div>
  );
}
