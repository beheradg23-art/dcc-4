// Shared "liquid" animated gradient fill used across icon badges, primary
// buttons, avatars, and progress fills throughout the app (same treatment
// as AuthGate). Split out of the old App.tsx monolith so any component
// that wants the liquid-fill look can import it directly instead of
// relying on a function defined 1000+ lines away in the same file.
import React, { useEffect, useRef, useState } from 'react';

// --- shared "liquid" animated gradient fill (same treatment as AuthGate) --
//
// Every icon badge, primary button, avatar, and progress fill that used to
// be a flat static gradient (bg-gradient-to-br from-indigo-600 via-violet-
// 600 to-fuchsia-500) is filled with this instead: the brand color stops
// slowly drift via an animated background-position, and a soft diagonal
// light sheen is layered on top (as a second background-image) so it
// periodically glides across the shape for a glossy, liquid feel — all on
// one element, no extra DOM needed. The shine layer is built from several
// close, low-contrast stops (rather than a hard jump straight to a bright
// peak) so it reads as a gentle glow passing through, not a visible seam.
export const LIQUID_GRADIENT_KEYFRAMES = `
  @keyframes akyos-liquid-fill {
    0%   { background-position: 0% 50%, 0% 50%; }
    50%  { background-position: 100% 50%, 100% 50%; }
    100% { background-position: 0% 50%, 0% 50%; }
  }
`;
export const LIQUID_ANIMATION = 'akyos-liquid-fill 6s ease-in-out infinite';
export const LIQUID_GRADIENT_FILL: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(100deg, transparent 8%, rgba(255,255,255,0.16) 28%, rgba(255,255,255,0.30) 42%, rgba(255,255,255,0.30) 50%, rgba(255,255,255,0.16) 58%, transparent 78%), ' +
    'linear-gradient(115deg, #4f46e5 0%, #7c3aed 22%, #d946ef 45%, #7c3aed 68%, #4f46e5 85%, #d946ef 100%)',
  backgroundSize: '340% 340%, 300% 300%',
  backgroundPosition: '0% 50%, 0% 50%',
  animation: LIQUID_ANIMATION,
};

// --- one-shot "swipe reveal" played the instant a hover starts -----------
//
// Previously every hover-triggered gradient (icon badge fill, heading text
// fill, the card's animated ring) just snapped in at full opacity the
// moment `hovering` became true. This adds a single-play sweep that masks
// each of those in behind a soft, feathered edge that travels from the
// bottom-left corner to the top-right corner once, so the gradient reveals
// itself rather than appearing instantly — the "fade in swipe" effect
// layers on top of (not instead of) the existing infinite liquid drift,
// the same way a one-off entrance animation is combined with a looping one
// elsewhere in this file.
//
// Two earlier attempts at this didn't pan out, worth noting so they don't
// get re-tried: (1) animating the mask gradient's *stop offsets* directly
// across keyframes isn't reliably interpolated cross-browser — several
// engines just snap straight to the end frame instead of sweeping through
// it; (2) a `clip-path: polygon(...)` sweep interpolates fine and *did*
// visibly sweep, but a polygon clip is a hard geometric cut with no way to
// soften its edge — there's no such thing as a "feathered polygon".
//
// This version instead registers `--akyos-sweep` as a real animatable
// percentage via `@property` (supported in current Chrome/Edge/Safari;
// degrades to a single non-smooth jump on the rare browser without it,
// same as any progressive-enhancement custom-property animation) and
// keeps the gradient's own text completely static — only that one custom
// property changes across the keyframes, referenced through `calc()`. That
// sidesteps both earlier problems: a genuinely numeric value is what's
// being interpolated (not gradient syntax), and the gradient's transparent
// -> white transition zone (width set by SWEEP_FEATHER_PCT below) gives an
// actual soft edge rather than a hard line. White, not black, for the
// opaque stop — this file's other mask (the ring cutout, a few lines
// down) already uses `#fff` for the same reason: masking defaults to
// luminance mode in some engines, where transparent-to-*black* reads as
// "zero luminance either way" and never reveals anything.
//
// `to bottom left` is a real CSS gradient keyword, not an approximated
// angle — it points exactly from the top-right corner to the opposite
// corner regardless of the element's own aspect ratio, which is what was
// asked for (a 36px square icon badge and a wide card both get a true
// corner-to-corner sweep, not just a similar-looking one).
const SWEEP_FEATHER_PCT = 20; // half-width of the soft transition zone, in percent of the corner-to-corner gradient line

export const SWEEP_REVEAL_KEYFRAMES = `
  @property --akyos-sweep {
    syntax: '<percentage>';
    inherits: false;
    initial-value: 130%;
  }
  @keyframes akyos-sweep-reveal {
    0%   { opacity: 0; --akyos-sweep: 130%; }
    25%  { opacity: 1; }
    100% { opacity: 1; --akyos-sweep: -30%; }
  }
`;
// Total 3.5s so the sweep is clearly visible rather than a flicker; `both`
// fill-mode holds the fully-hidden state for the instant before playback
// starts, then the fully-revealed state once it's done.
const SWEEP_DURATION = '3.5s';
const SWEEP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const SWEEP_REVEAL_ANIMATION = `akyos-sweep-reveal ${SWEEP_DURATION} ${SWEEP_EASING} both`;

// The exit counterpart: the exact same keyframes played backwards
// (`reverse`), not a second hand-authored animation. Forwards, the reveal
// travels bottom-left -> top-right (see the corner-to-corner note above),
// so time-reversing it retraces that same line: content nearest the
// bottom-left corner is the first to lose opacity, the top-right corner
// the last — i.e. it fades out bottom-left to top-right, the mirror image
// of the fade-in rather than an independent effect that could ever drift
// out of sync with it. `reverse` also flips the easing curve for free
// (browsers reverse cubic-bezier() curves automatically for a reversed
// animation), so the deceleration on the way in becomes an acceleration
// on the way out, which is the correct feel for a mirrored exit. `both`
// still applies here: it holds the fully-visible frame until playback
// starts, then holds fully-hidden once it ends.
export const SWEEP_HIDE_ANIMATION = `akyos-sweep-reveal ${SWEEP_DURATION} ${SWEEP_EASING} reverse both`;

// Gap between the fade-in finishing and the fade-out starting, for the
// "pointer entered and left almost instantly" case below — long enough to
// read as a deliberate beat rather than a stutter, short enough that the
// whole in -> pause -> out sequence still feels like one continuous
// gesture rather than two unrelated animations.
export const SWEEP_GAP_MS = 500;

// The mask itself — static across the whole animation (only the
// `--akyos-sweep` custom property above changes), spread into an
// element's style alongside SWEEP_REVEAL_ANIMATION.
export const SWEEP_REVEAL_STYLE: React.CSSProperties = {
  WebkitMaskImage: `linear-gradient(to bottom left, transparent calc(var(--akyos-sweep) - ${SWEEP_FEATHER_PCT}%), white calc(var(--akyos-sweep) + ${SWEEP_FEATHER_PCT}%))`,
  maskImage: `linear-gradient(to bottom left, transparent calc(var(--akyos-sweep) - ${SWEEP_FEATHER_PCT}%), white calc(var(--akyos-sweep) + ${SWEEP_FEATHER_PCT}%))`,
  WebkitMaskSize: '100% 100%',
  maskSize: '100% 100%',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
} as React.CSSProperties;

// The exact photographic-negative of SWEEP_REVEAL_STYLE above — same
// `--akyos-sweep` variable, same feather width, same direction, just with
// the transparent/white stops swapped. Used to hide the plain white base
// heading text in lockstep with the gradient copy revealing on top of it.
//
// Why this exists: the gradient copy's mask has a soft (feathered) edge,
// which is required so the sweep doesn't look like a hard clip. But a soft
// mask means there's a band, `SWEEP_FEATHER_PCT` wide, where the gradient
// copy sits at partial opacity — and previously the solid-white base text
// stayed at full opacity directly underneath it for that whole band.
// Alpha-blending a translucent colored glyph over a fully-opaque white
// glyph doesn't read as "gradient fading in", it reads as pale, washed-out
// white edges bleeding around every letter — worse on fine strokes, since
// the mask's feather and the glyph's own antialiasing are two independent
// soft edges compounding on each other. That's the "white leaking edgy
// text" this fixes.
// Feeding the same --akyos-sweep value into a complementary mask on the
// base layer means at any instant the two opacities sum to ~1 across the
// whole feather band (base goes white -> transparent exactly where the
// overlay goes transparent -> white), so there's never a moment where a
// translucent white glyph and a translucent gradient glyph occupy the same
// pixels at once — it reads as one continuous crossfade along the sweep
// line. And because both masks share the one custom property plus the
// identical animation string, they can never drift out of sync with each
// other, however long the hover lasts.
export const SWEEP_REVEAL_STYLE_INVERSE: React.CSSProperties = {
  WebkitMaskImage: `linear-gradient(to bottom left, white calc(var(--akyos-sweep) - ${SWEEP_FEATHER_PCT}%), transparent calc(var(--akyos-sweep) + ${SWEEP_FEATHER_PCT}%))`,
  maskImage: `linear-gradient(to bottom left, white calc(var(--akyos-sweep) - ${SWEEP_FEATHER_PCT}%), transparent calc(var(--akyos-sweep) + ${SWEEP_FEATHER_PCT}%))`,
  WebkitMaskSize: '100% 100%',
  maskSize: '100% 100%',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
} as React.CSSProperties;

// Merges the liquid gradient fill into an element's style, safely combining
// its infinite animation with any one-shot animation the element already
// has (e.g. a fade/slide-in) instead of one overwriting the other.
export function liquidFillStyle(extra: React.CSSProperties = {}): React.CSSProperties {
  const { animation: extraAnimation, ...rest } = extra;
  return {
    ...LIQUID_GRADIENT_FILL,
    animation: extraAnimation ? `${extraAnimation}, ${LIQUID_ANIMATION}` : LIQUID_ANIMATION,
    ...rest,
  };
}

// Same moving-sheen treatment as liquidFillStyle, but for the handful of
// spots that use a different (non brand-indigo/violet/fuchsia) color pair,
// e.g. the Pomodoro "break" state. Takes the base color stops only —
// the shine layer, sizing, and animation stay identical everywhere so
// every gradient in the app moves and blends the same way.
export function liquidFillStyleFor(baseGradient: string, extra: React.CSSProperties = {}): React.CSSProperties {
  const { animation: extraAnimation, ...rest } = extra;
  return {
    backgroundImage:
      'linear-gradient(100deg, transparent 8%, rgba(255,255,255,0.16) 28%, rgba(255,255,255,0.30) 42%, rgba(255,255,255,0.30) 50%, rgba(255,255,255,0.16) 58%, transparent 78%), ' +
      baseGradient,
    backgroundSize: '340% 340%, 300% 300%',
    backgroundPosition: '0% 50%, 0% 50%',
    animation: extraAnimation ? `${extraAnimation}, ${LIQUID_ANIMATION}` : LIQUID_ANIMATION,
    ...rest,
  };
}

// --- sweep phase state machine --------------------------------------------
//
// Drives the fade-in / gap / fade-out lifecycle for the sweep reveal, given
// nothing but the raw "is the pointer over the card right now" boolean.
// Rules this encodes (matches how a person actually reads the hover):
//
// 1. Pointer enters -> fade-in always plays to completion. If the pointer
//    leaves mid-fade-in, that does NOT cut the fade-in short — leaving is
//    only acted on once the in-flight animation finishes.
// 2. If the pointer is still over the card once the fade-in finishes, the
//    sweep just stays fully visible and static — no fade-out is scheduled
//    until an actual leave happens, however long the hover lasts.
// 3. Once a leave is registered (immediately or after the fade-in
//    finishes), there's a fixed SWEEP_GAP_MS pause holding the fully-
//    visible state, then the fade-out plays to completion. So a pointer
//    that taps the card and leaves instantly still gets the full
//    fade-in -> gap -> fade-out sequence, uninterrupted end to end.
// 4. Re-entering during the gap cancels the pending fade-out and snaps
//    back to the static fully-visible state (no flash of a fade-out that
//    never gets to play). Re-entering mid fade-out is handled the same
//    way as a mid-fade-in leave, symmetrically: the in-flight fade-out is
//    left to finish rather than being cut off, and only once it completes
//    does playback pick back up (a fresh fade-in) if the pointer is still
//    there.
//
// Only one component instance should drive this per card (Card, via the
// ring overlay's onAnimationEnd) — everything else that renders a sweep
// layer (the icon badge, the heading) just reads `active`/`animation` off
// the same phase so all of a card's sweep layers are guaranteed to be on
// the exact same frame, never drifting apart.
export type SweepPhase = 'idle' | 'entering' | 'visible' | 'gap' | 'leaving';

export interface SweepController {
  phase: SweepPhase;
  active: boolean;
  animation: string;
  handleFadeInEnd: () => void;
  handleFadeOutEnd: () => void;
}

export function useSweepPhase(hovering: boolean): SweepController {
  const [phase, setPhase] = useState<SweepPhase>('idle');
  const phaseRef = useRef<SweepPhase>('idle');
  phaseRef.current = phase;
  const hoveringRef = useRef(hovering);
  hoveringRef.current = hovering;
  const gapTimer = useRef<number | null>(null);

  const clearGapTimer = () => {
    if (gapTimer.current !== null) {
      window.clearTimeout(gapTimer.current);
      gapTimer.current = null;
    }
  };

  const scheduleLeaving = () => {
    clearGapTimer();
    gapTimer.current = window.setTimeout(() => {
      gapTimer.current = null;
      setPhase('leaving');
    }, SWEEP_GAP_MS);
  };

  useEffect(() => {
    if (hovering) {
      if (phaseRef.current === 'idle') {
        setPhase('entering');
      } else if (phaseRef.current === 'gap') {
        // Caught the pending fade-out before it started — cancel it and
        // hold at fully visible instead of playing a fade-out that would
        // immediately have to reverse itself.
        clearGapTimer();
        setPhase('visible');
      }
      // 'entering' / 'leaving': an animation is already in flight — leave
      // it to finish; handleFadeInEnd / handleFadeOutEnd react to the
      // latest hoveringRef value once it does.
    } else if (phaseRef.current === 'visible') {
      scheduleLeaving();
    }
    // 'entering' -> handled by handleFadeInEnd once it fires.
    // 'gap' -> already counting down.
    // 'leaving' -> handled by handleFadeOutEnd once it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovering]);

  useEffect(() => clearGapTimer, []);

  const handleFadeInEnd = () => {
    if (phaseRef.current !== 'entering') return;
    if (hoveringRef.current) {
      setPhase('visible');
    } else {
      setPhase('gap');
      scheduleLeaving();
    }
  };

  const handleFadeOutEnd = () => {
    if (phaseRef.current !== 'leaving') return;
    setPhase(hoveringRef.current ? 'entering' : 'idle');
  };

  return {
    phase,
    active: phase !== 'idle',
    animation: phase === 'leaving' ? SWEEP_HIDE_ANIMATION : SWEEP_REVEAL_ANIMATION,
    handleFadeInEnd,
    handleFadeOutEnd,
  };
}