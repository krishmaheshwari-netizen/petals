import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SwipeCard from './components/SwipeCard.jsx';
import Preferences from './components/Preferences.jsx';
import Results from './components/Results.jsx';
import Finals from './components/Finals.jsx';
import { buildDeck, makeSeed, INDEX } from './lib/deck.js';
import { buildScores } from './lib/scoring.js';
import {
  createBracket, tap as bracketTap, strengthsWithManualOrder, hasSignal,
} from './lib/bracket.js';
import { buildShareUrl, readShareFromUrl } from './lib/share.js';
import { Sprig } from './components/Ornament.jsx';

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
      showBouquets: parsed.showBouquets !== false,
      finals: parsed.finals ?? null,
      manualOrder: parsed.manualOrder ?? null,
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
      return {
        seed: shared.seed, swipes: shared.swipes, prefs: { ...EMPTY_PREFS, ...shared.prefs },
        history: [], showBouquets: shared.showBouquets !== false,
        finals: shared.finals ?? null,
        manualOrder: shared.manualOrder ?? null,
      };
    }
    return loadState() ?? {
      seed: makeSeed(), swipes: {}, prefs: { ...EMPTY_PREFS }, history: [],
      showBouquets: true, finals: null, manualOrder: null,
    };
  });

  const [tab, setTab] = useState(shared ? 'results' : 'deck');

  const deck = useMemo(
    () => buildDeck(state.seed, { includeBouquets: state.showBouquets }),
    [state.seed, state.showBouquets],
  );

  // Persist everything, so a refresh mid-deck loses nothing. Shared views are
  // read-only and must never overwrite the viewer's own saved session.
  useEffect(() => {
    if (shared) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        seed: state.seed, swipes: state.swipes, prefs: state.prefs,
        history: state.history, showBouquets: state.showBouquets, finals: state.finals,
        manualOrder: state.manualOrder,
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

  // Only trust finals once it has actually measured something.
  const strengths = useMemo(
    () => (hasSignal(state.finals)
      ? strengthsWithManualOrder(state.finals, state.manualOrder)
      : null),
    [state.finals, state.manualOrder],
  );

  const scores = useMemo(
    () => buildScores(deck, state.swipes, INDEX, { strengths }),
    [deck, state.swipes, strengths],
  );

  // Flowers she liked, which is who competes in the finals.
  const likedFlowerIds = useMemo(
    () => deck
      .filter((c) => c.type === 'flower' && ['love', 'obsessed'].includes(state.swipes[c.id]))
      .map((c) => c.data.id),
    [deck, state.swipes],
  );

  const startFinals = useCallback(() => {
    setState((s) => ({
      ...s,
      finals: createBracket(likedFlowerIds, s.swipes, String(s.seed)),
    }));
    setTab('finals');
  }, [likedFlowerIds]);

  // Every tap is written straight back to state, and state is persisted, so she
  // resumes on the exact screen and mid-group selection she left on.
  const tapFinal = useCallback((flowerId) => {
    setState((s) => (s.finals ? { ...s, finals: bracketTap(s.finals, flowerId) } : s));
  }, []);

  const setManualOrder = useCallback((order) => {
    setState((s) => ({ ...s, manualOrder: order }));
  }, []);

  // Re-running finals discards a hand-edited order, since it no longer refers to
  // anything the new run produced.
  const restartFinals = useCallback(() => {
    setState((s) => ({
      ...s,
      manualOrder: null,
      finals: createBracket(likedFlowerIds, s.swipes, String(s.seed) + '-' + Date.now()),
    }));
    setTab('finals');
  }, [likedFlowerIds]);

  const setPrefs = useCallback((prefs) => setState((s) => ({ ...s, prefs })), []);

  const toggleBouquets = useCallback(
    () => setState((s) => ({ ...s, showBouquets: !s.showBouquets })),
    [],
  );

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return buildShareUrl({
      swipes: state.swipes, prefs: state.prefs, seed: state.seed,
      showBouquets: state.showBouquets, finals: state.finals,
      manualOrder: state.manualOrder,
    });
  }, [state]);

  function startOver() {
    if (!confirm('Clear every swipe and start the deck again? Your written preferences are kept.')) return;
    setState((s) => ({ ...s, seed: makeSeed(), swipes: {}, history: [], finals: null }));
    setTab('deck');
  }

  const swiped = deck.reduce((n, c) => n + (state.swipes[c.id] ? 1 : 0), 0);

  return (
    <div className="paper-grain relative flex min-h-full flex-col overflow-x-clip">
      <div className="relative z-10 flex min-h-full flex-1 flex-col">
        <TopBar
          tab={tab}
          setTab={setTab}
          shared={!!shared}
          progress={swiped / deck.length}
          hasFinals={!!state.finals}
        />

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
              showBouquets={state.showBouquets}
              toggleBouquets={toggleBouquets}
              likedCount={likedFlowerIds.length}
              onNarrow={startFinals}
            />
          )}
          {tab === 'finals' && !shared && (
            <Finals
              state={state.finals}
              onTap={tapFinal}
              onFinish={() => setTab('results')}
              onRestart={restartFinals}
            />
          )}
          {tab === 'prefs' && <Preferences prefs={state.prefs} setPrefs={setPrefs} />}
          {tab === 'results' && (
            <Results
              deck={deck}
              swipes={state.swipes}
              scores={scores}
              prefs={state.prefs}
              strengths={strengths}
              finals={state.finals}
              onRunFinals={restartFinals}
              manualOrder={state.manualOrder}
              setManualOrder={setManualOrder}
              shareUrl={shareUrl}
              isSharedView={!!shared}
            />
          )}
        </main>

        {!shared && tab === 'results' && (
          <div className="mx-auto w-full max-w-lg px-5 pb-10">
            <button
              onClick={startOver}
              className="w-full rounded-full border border-line py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint transition hover:border-ink-faint hover:text-ink-soft"
            >
              Start the deck over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ tab, setTab, shared, progress, hasFinals }) {
  const tabs = shared
    ? [{ id: 'results', label: 'Results' }]
    : [
        { id: 'deck', label: 'Deck' },
        ...(hasFinals ? [{ id: 'finals', label: 'Finals' }] : []),
        { id: 'prefs', label: 'Prefs' },
        { id: 'results', label: 'Results' },
      ];

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-lg items-end justify-between px-5 pb-2.5 pt-4">
        <span className="flex items-baseline gap-1.5">
          <Sprig size={15} className="translate-y-[2px] text-sage" />
          <span className="font-display text-[22px] leading-none text-ink">Petals</span>
        </span>
        {/* Small-caps with a hairline underline: an index page, not a segmented
            control. The pill toggle was the single most generic thing here. */}
        <nav className="flex items-baseline gap-3.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative pb-1 text-[10.5px] uppercase tracking-[0.12em] whitespace-nowrap transition-colors ${
                tab === t.id ? 'text-ink' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              {t.label}
              <span
                className={`absolute inset-x-0 -bottom-px h-px transition-opacity ${
                  tab === t.id ? 'bg-rose opacity-100' : 'opacity-0'
                }`}
              />
            </button>
          ))}
        </nav>
      </div>
      {!shared && (
        <div className="h-px w-full bg-line/70">
          <div
            className="h-px bg-gradient-to-r from-sage to-rose transition-[width] duration-700"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
    </header>
  );
}

function DeckView({ remaining, done, decide, undo, canUndo, onFinish, swiped, total, showBouquets, toggleBouquets, likedCount, onNarrow }) {
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
        <Sprig size={26} className="mb-4 text-sage" />
        <h2 className="font-display text-[34px] leading-tight text-ink">That's the whole deck.</h2>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-ink-soft">
          {swiped} cards. Enough to know what you like and, more usefully, what you like together.
        </p>
        {likedCount >= 2 ? (
          <>
            <button
              onClick={onNarrow}
              className="mt-7 rounded-full bg-rose px-8 py-3 text-[13px] uppercase tracking-[0.14em] text-paper transition active:scale-[0.99]"
            >
              Narrow it down
            </button>
            <p className="prose-serif mt-3 max-w-[17rem] text-[13.5px] italic leading-snug text-ink-faint">
              {likedCount} flowers made the cut — too many to rank by liking alone.
              A few head-to-heads will sort them.
            </p>
            <button
              onClick={onFinish}
              className="mt-5 text-[11px] uppercase tracking-[0.13em] text-ink-faint underline underline-offset-4"
            >
              Skip to results
            </button>
          </>
        ) : (
          <button
            onClick={onFinish}
            className="mt-7 rounded-full bg-rose px-8 py-3 text-[13px] uppercase tracking-[0.14em] text-paper transition active:scale-[0.99]"
          >
            See what it worked out
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-5">
      <div
        className="relative mx-auto mt-4 w-full"
        style={{ aspectRatio: '3 / 4.35', maxHeight: '62vh', overflow: 'visible', touchAction: 'none' }}
      >
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
          className="border-line bg-transparent text-ink-faint hover:border-ink-faint"
          small
        >
          <BackIcon />
        </ActionButton>

        <ActionButton
          label="Pass"
          onClick={() => visible[0] && commit(visible[0].id, 'pass')}
          className="border-line bg-paper text-[#5B7FA8] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]"
        >
          <XIcon />
        </ActionButton>

        <ActionButton
          label="Obsessed"
          onClick={() => visible[0] && commit(visible[0].id, 'obsessed')}
          className="border-rose-deep bg-rose text-paper shadow-[0_2px_10px_-4px_rgba(126,46,68,0.55)]"
          big
        >
          <StarIcon />
        </ActionButton>

        <ActionButton
          label="Love"
          onClick={() => visible[0] && commit(visible[0].id, 'love')}
          className="border-line bg-paper text-rose shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]"
        >
          <HeartIcon />
        </ActionButton>
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <span className="font-display text-[13px] text-ink-faint">{swiped}<span className="mx-1 opacity-50">/</span>{total}</span>
        <span className="h-3 w-px bg-line" aria-hidden />
        <span className="text-[11.5px] italic text-ink-faint">tap a card for details</span>
      </div>

      {/* Arrangement cards are the only place the palette and style signals come
          from, so this says what turning them off actually costs. */}
      <div className="mt-5 flex flex-col items-center gap-1.5 pb-8">
        <button
          type="button"
          onClick={toggleBouquets}
          className="flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-soft transition hover:border-ink-faint"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${showBouquets ? 'bg-sage' : 'bg-ink-faint/40'}`}
            aria-hidden
          />
          Arrangements {showBouquets ? 'on' : 'off'}
        </button>
        {likedCount > 20 && (
          <button
            type="button"
            onClick={onNarrow}
            className="mb-1 rounded-full border border-rose/50 px-4 py-1.5 text-[10px] uppercase tracking-[0.14em] text-rose transition hover:bg-rose/5"
          >
            Narrow it down ({likedCount} liked)
          </button>
        )}
        <span className="max-w-[15rem] text-center text-[10.5px] italic leading-snug text-ink-faint">
          {showBouquets
            ? 'Mixed in with the flowers — they teach it your palette and shape'
            : 'Single flowers only. Palette and shape fall back to defaults.'}
        </span>
      </div>
    </div>
  );
}

/** The mark that punches in over the deck to confirm a decision. */
function DecisionFlash({ flash }) {
  const CONFIG = {
    love: { color: '#A8425C', Icon: HeartIcon },
    pass: { color: '#5B7FA8', Icon: XIcon },
    obsessed: { color: '#B98F2E', Icon: StarIcon },
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
      className={`flex items-center justify-center rounded-full border transition-opacity ${className} ${
        big ? 'h-[66px] w-[66px]' : small ? 'h-[42px] w-[42px]' : 'h-[54px] w-[54px]'
      } ${disabled ? 'pointer-events-none opacity-30' : ''}`}
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
