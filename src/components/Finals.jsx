// The finals round: four flowers, ordered by three taps.
//
// Favourite, next favourite, least favourite. The card she never touches is
// implicitly third and scores for it -- and the reveal makes a point of showing
// it settling into third, so it is obvious it was scored rather than skipped.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { INDEX } from '../lib/deck.js';
import {
  currentScreen, tapsFor, ranking, completion, totalScreens,
} from '../lib/bracket.js';
import { Sprig, SprigRule } from './Ornament.jsx';

const PROMPTS = ['Favourite?', 'Next favourite?', 'Least favourite?'];
const PLACE_LABEL = ['1st', '2nd', '3rd', '4th'];

/** Prompt for the tap about to happen, given how big the group is. */
function promptFor(groupSize, tapIndex) {
  if (groupSize === 2) return 'Which would you rather get?';
  if (groupSize === 3) return tapIndex === 0 ? PROMPTS[0] : PROMPTS[1];
  return PROMPTS[tapIndex];
}

function Card({ flower, place, dimmed, onPick, implicit }) {
  const picked = place !== null && place !== undefined;
  return (
    <motion.button
      type="button"
      onClick={onPick}
      disabled={picked || dimmed}
      className="relative overflow-hidden rounded-[16px] ring-1 ring-line disabled:cursor-default"
      animate={{ opacity: dimmed && !picked ? 0.45 : 1, scale: picked ? 0.97 : 1 }}
      whileTap={picked || dimmed ? undefined : { scale: 0.96 }}
      transition={{ duration: 0.24 }}
    >
      <div className="relative aspect-square w-full">
        <img
          src={flower.imageUrl}
          alt={flower.commonName}
          className="h-full w-full object-cover no-drag"
          draggable={false}
        />

        {/* The favourite glows; every placed card gets a corner badge. */}
        <AnimatePresence>
          {place === 0 && (
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-[16px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ boxShadow: 'inset 0 0 0 3px #A8425C, 0 0 22px -4px rgba(168,66,92,0.75)' }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {picked && (
            <motion.div
              className="absolute left-2 top-2 flex items-center rounded-full px-2 py-0.5 font-display text-[12px]"
              initial={{ opacity: 0, scale: 0.5, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              style={{
                backgroundColor: place === 0 ? '#A8425C' : 'rgba(251,247,239,0.94)',
                color: place === 0 ? '#FBF7EF' : '#2B251F',
              }}
            >
              {PLACE_LABEL[place]}
              {implicit && (
                <span className="ml-1 text-[9px] uppercase tracking-wider opacity-70">auto</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="bg-paper px-2 py-2 text-center">
        <div className="truncate font-display text-[13.5px] leading-tight text-ink">
          {flower.commonName}
        </div>
      </div>
    </motion.button>
  );
}

export default function Finals({ state, onTap, onFinish, onRestart }) {
  const screen = currentScreen(state);

  // After the last tap the untouched card takes third. The completed board is
  // held on screen for a beat so that is visible. Derived during render and
  // dismissed by a timer, rather than pushed into state from an effect.
  const [dismissed, setDismissed] = useState(null);
  const resultKey = state?.lastResult
    ? `${state.current}:${state.lastResult.members.join('|')}`
    : null;
  const reveal = resultKey && resultKey !== dismissed ? state.lastResult : null;

  useEffect(() => {
    if (!reveal) return undefined;
    const t = setTimeout(() => setDismissed(resultKey), 1000);
    return () => clearTimeout(t);
  }, [reveal, resultKey]);

  if (!state || (state.field?.length ?? 0) < 2) {
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

  if (state.done && !reveal) {
    const top = ranking(state).slice(0, 3).map((id) => INDEX.byId[id]?.commonName).filter(Boolean);
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-16 text-center">
        <Sprig size={30} className="mx-auto text-sage" />
        <h1 className="mt-3 font-display text-[32px] leading-tight text-ink">That settles it.</h1>
        <p className="prose-serif mx-auto mt-3 max-w-xs text-[15.5px] leading-[1.6] text-ink-soft">
          {state.current} screens. Your top three came out{' '}
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

  // While revealing, show the board that was just completed, fully placed.
  const board = reveal ? reveal.members : screen?.members ?? [];
  const groupSize = board.length;
  const tapIndex = state.partial.length;
  const needed = tapsFor(groupSize);
  const total = totalScreens(state);
  const screenNumber = Math.min(total, (state.current ?? 0) + (reveal ? 0 : 1));

  const placeOf = (id) => {
    if (reveal) return reveal.ordering.indexOf(id);
    const i = state.partial.indexOf(id);
    if (i === -1) return null;
    // Mid-group, the final tap is LAST place, not third.
    if (needed === 3 && i === 2) return groupSize - 1;
    return i;
  };

  // The card that takes third automatically, called out during the reveal.
  const implicitId = reveal && groupSize >= 4 ? reveal.ordering[2] : null;

  return (
    <div className="mx-auto w-full max-w-lg px-5 pb-10 pt-5">
      <header className="text-center">
        <div className="label-caps">
          Screen {screenNumber} of {total}
          {screen?.pass === 'R' && <span className="ml-2 text-rose/80">· redemption</span>}
        </div>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink">
          {reveal ? 'That’s the order.' : promptFor(groupSize, tapIndex)}
        </h1>
        <div className="mx-auto mt-3.5 h-px w-44 bg-line">
          <div
            className="h-px bg-gradient-to-r from-sage to-rose transition-[width] duration-500"
            style={{ width: `${Math.round(completion(state) * 100)}%` }}
          />
        </div>
        <p className="mt-2.5 text-[10.5px] italic text-ink-faint">
          {reveal && groupSize >= 4
            ? 'The one you didn’t touch takes third — it still scores'
            : 'Every flower here gets a score, not just the winner'}
        </p>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {board.map((id) => {
          const flower = INDEX.byId[id];
          if (!flower) return null;
          const place = placeOf(id);
          return (
            <Card
              key={id}
              flower={flower}
              place={place === -1 ? null : place}
              implicit={!!reveal && id === implicitId}
              dimmed={!!reveal}
              onPick={() => onTap(id)}
            />
          );
        })}
      </div>

      {!reveal && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onFinish}
            className="rounded-full border border-line px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-ink-faint transition hover:border-ink-faint hover:text-ink-soft"
          >
            Good enough — show results
          </button>
        </div>
      )}
    </div>
  );
}
