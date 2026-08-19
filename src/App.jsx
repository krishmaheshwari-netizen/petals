import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SwipeCard from './components/SwipeCard.jsx';
import Preferences from './components/Preferences.jsx';
import Results from './components/Results.jsx';
import { buildDeck, makeSeed, INDEX } from './lib/deck.js';
import { buildScores } from './lib/scoring.js';
import { buildShareUrl, readShareFromUrl } from './lib/share.js';

const STORE_KEY = 'petals.v1';

const EMPTY_PREFS = {
  note: '', neverColors: [], scentSensitivity: '', vessel: '',
  occasion: '', maxBudget: '', dislikedFlowerIds: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      seed: parsed.seed ?? makeSeed(),
      swipes: parsed.swipes ?? {},
      prefs: { ...EMPTY_PREFS, ...(parsed.prefs ?? {}) },
      history: parsed.history ?? [],
    };
  } catch {
    return null;
  }
}

export default function App() {
  // A link with ?r= puts the app in read-only "he is looking at her results" mode.
  const shared = useMemo(() => readShareFromUrl(), []);

  const [state, setState] = useState(() => {
    if (shared) {
      return { seed: shared.seed, swipes: shared.swipes, prefs: { ...EMPTY_PREFS, ...shared.prefs }, history: [] };
    }
    return loadState() ?? { seed: makeSeed(), swipes: {}, prefs: { ...EMPTY_PREFS }, history: [] };
  });

  const [tab, setTab] = useState(shared ? 'results' : 'deck');

  const deck = useMemo(() => buildDeck(state.seed), [state.seed]);

  // Persist everything, so a refresh mid-deck loses nothing. Shared views are
  // read-only and must never overwrite the viewer's own saved session.
  useEffect(() => {
    if (shared) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        seed: state.seed, swipes: state.swipes, prefs: state.prefs, history: state.history,
      }));
    } catch { /* storage full or blocked; the session still works in memory */ }
  }, [state, shared]);

  const remaining = deck.filter((c) => !state.swipes[c.id]);
  const done = remaining.length === 0;

  const decide = useCallback((cardId, verdict) => {
    setState((s) => ({
      ...s,
      swipes: { ...s.swipes, [cardId]: verdict },
      history: [...s.history, cardId],
    }));
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      if (!s.history.length) return s;
      const last = s.history[s.history.length - 1];
      const { [last]: _removed, ...rest } = s.swipes;
      return { ...s, swipes: rest, history: s.history.slice(0, -1) };
    });
  }, []);

  const scores = useMemo(
    () => buildScores(deck, state.swipes, INDEX),
    [deck, state.swipes],
  );

  const setPrefs = useCallback((prefs) => setState((s) => ({ ...s, prefs })), []);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return buildShareUrl({ swipes: state.swipes, prefs: state.prefs, seed: state.seed });
  }, [state]);

  function startOver() {
    if (!confirm('Clear every swipe and start the deck again? Your written preferences are kept.')) return;
    setState((s) => ({ ...s, seed: makeSeed(), swipes: {}, history: [] }));
    setTab('deck');
  }

  const swiped = Object.keys(state.swipes).length;

  return (
    <div className="paper-grain relative flex min-h-full flex-col">
      <div className="relative z-10 flex min-h-full flex-1 flex-col">
        <TopBar tab={tab} setTab={setTab} shared={!!shared} progress={swiped / deck.length} />

        <main className="flex-1">
          {tab === 'deck' && !shared && (
            <DeckView
              remaining={remaining}
              done={done}
              decide={decide}
              undo={undo}
              canUndo={state.history.length > 0}
              onFinish={() => setTab('results')}
              swiped={swiped}
              total={deck.length}
            />
          )}
          {tab === 'prefs' && <Preferences prefs={state.prefs} setPrefs={setPrefs} />}
          {tab === 'results' && (
            <Results
              deck={deck}
              swipes={state.swipes}
              scores={scores}
              prefs={state.prefs}
              shareUrl={shareUrl}
              isSharedView={!!shared}
            />
          )}
        </main>

        {!shared && tab === 'results' && (
          <div className="mx-auto w-full max-w-lg px-5 pb-10">
            <button
              onClick={startOver}
              className="w-full rounded-xl border border-line py-2.5 text-[13.5px] text-ink-faint transition hover:text-ink-soft"
            >
              Start the deck over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ tab, setTab, shared, progress }) {
  const tabs = shared
    ? [{ id: 'results', label: 'Results' }]
    : [
        { id: 'deck', label: 'Deck' },
        { id: 'prefs', label: 'Preferences' },
        { id: 'results', label: 'Results' },
      ];

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 pb-2.5 pt-3.5">
        <span className="font-display text-[21px] tracking-tight text-ink">Petals</span>
        <nav className="flex gap-0.5 rounded-full border border-line bg-paper-deep/60 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition ${
                tab === t.id ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {!shared && (
        <div className="h-[2px] w-full bg-line/60">
          <div
            className="h-full bg-rose transition-[width] duration-500"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
    </header>
  );
}

function DeckView({ remaining, done, decide, undo, canUndo, onFinish, swiped, total }) {
  const visible = remaining.slice(0, 3);

  // Instagram-style confirmation: a big mark punches in over the deck for a
  // moment after every decision, so the choice is acknowledged even when the
  // card flies off too fast to read the stamp on it.
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);

  const commit = useCallback((cardId, verdict) => {
    setFlash({ verdict, key: cardId + verdict + Date.now() });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 620);
    decide(cardId, verdict);
  }, [decide]);

  const goBack = useCallback(() => {
    clearTimeout(flashTimer.current);
    setFlash(null);
    undo();
  }, [undo]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Keyboard support, so it works properly on a desktop too.
  useEffect(() => {
    function onKey(e) {
      if (!visible.length) return;
      if (e.key === 'ArrowRight') commit(visible[0].id, 'love');
      else if (e.key === 'ArrowLeft') commit(visible[0].id, 'pass');
      else if (e.key === 'ArrowUp') commit(visible[0].id, 'obsessed');
      else if ((e.key === 'Backspace' || e.key === 'ArrowDown') && canUndo) {
        e.preventDefault();
        goBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, commit, goBack, canUndo]);

  if (done) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 py-24 text-center">
        <h2 className="font-display text-[34px] leading-tight text-ink">That's the whole deck.</h2>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-ink-soft">
          {swiped} cards. Enough to know what you like and, more usefully, what you like together.
        </p>
        <button
          onClick={onFinish}
          className="mt-7 rounded-xl bg-rose px-7 py-3 text-[15px] font-medium text-white transition active:scale-[0.99]"
        >
          See what it worked out
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-5">
      <div className="relative mx-auto mt-4 w-full" style={{ aspectRatio: '3 / 4.35', maxHeight: '62vh' }}>
        <AnimatePresence initial={false}>
          {visible
            .slice()
            .reverse()
            .map((card) => {
              const offset = visible.indexOf(card);
              return (
                <SwipeCard
                  key={card.id}
                  card={card}
                  isTop={offset === 0}
                  offset={offset}
                  onDecide={(verdict) => commit(card.id, verdict)}
                />
              );
            })}
        </AnimatePresence>

        <DecisionFlash flash={flash} />
      </div>

      <div className="mt-6 flex items-center justify-center gap-3.5">
        <ActionButton
          label="Back"
          onClick={goBack}
          disabled={!canUndo}
          className="border-line bg-paper text-ink-faint"
          small
        >
          <BackIcon />
        </ActionButton>

        <ActionButton
          label="Pass"
          onClick={() => visible[0] && commit(visible[0].id, 'pass')}
          className="border-line bg-paper text-[#4C7BC4]"
        >
          <XIcon />
        </ActionButton>

        <ActionButton
          label="Obsessed"
          onClick={() => visible[0] && commit(visible[0].id, 'obsessed')}
          className="border-rose bg-rose text-white"
          big
        >
          <StarIcon />
        </ActionButton>

        <ActionButton
          label="Love"
          onClick={() => visible[0] && commit(visible[0].id, 'love')}
          className="border-line bg-paper text-rose"
        >
          <HeartIcon />
        </ActionButton>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 pb-8 text-[12px] text-ink-faint">
        <span>{swiped} / {total}</span>
        <span aria-hidden>·</span>
        <span>tap a card for details</span>
      </div>
    </div>
  );
}

/** The mark that punches in over the deck to confirm a decision. */
function DecisionFlash({ flash }) {
  const CONFIG = {
    love: { color: '#B14A63', Icon: HeartIcon },
    pass: { color: '#4C7BC4', Icon: XIcon },
    obsessed: { color: '#D98A2B', Icon: StarIcon },
  };
  return (
    <AnimatePresence mode="popLayout">
      {flash && (
        <motion.div
          key={flash.key}
          className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <motion.div
            style={{ color: CONFIG[flash.verdict].color }}
            className="drop-shadow-[0_6px_18px_rgba(52,44,36,0.45)]"
            initial={{ scale: 0.3, opacity: 0 }}
            // Overshoot then settle, the way a double-tap heart does.
            animate={{ scale: [0.3, 1.25, 1.05], opacity: [0, 1, 1] }}
            exit={{ scale: 1.45, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.42, times: [0, 0.55, 1], ease: 'easeOut' }}
          >
            {(() => {
              const { Icon } = CONFIG[flash.verdict];
              return <Icon size={128} />;
            })()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActionButton({ children, label, onClick, className, big, small, disabled }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      whileHover={disabled ? undefined : { y: -2 }}
      className={`flex items-center justify-center rounded-full border shadow-[0_4px_14px_-6px_rgba(52,44,36,0.5)] transition-opacity ${className} ${
        big ? 'h-[68px] w-[68px]' : small ? 'h-[44px] w-[44px]' : 'h-[56px] w-[56px]'
      } ${disabled ? 'pointer-events-none opacity-35' : ''}`}
    >
      {children}
    </motion.button>
  );
}

const XIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const HeartIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 21s-7.5-4.9-9.4-9.2C1.1 8.4 3 5 6.4 5c2 0 3.4 1.1 4.2 2.3l.7 1 .7-1C12.8 6.1 14.2 5 16.2 5c3.4 0 5.3 3.4 3.8 6.8C18.1 16.1 12 21 12 21z" />
  </svg>
);

const StarIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.6l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.7l-5.6 3.1 1.3-6.3-4.8-4.3 6.4-.7z" />
  </svg>
);

const BackIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);
