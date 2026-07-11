import React, { useEffect, useRef, useState } from 'react';
import { Lock, Mail, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  pullFromCloud,
  pushToCloud,
  hashPasscode,
  setPasscodeHash,
  getPasscodeHash,
  PASSCODE_HASH_KEY,
} from '../lib/cloudSync';

const PASSCODE_LENGTH = 6;

// Colors for the liquid layer, in the app's existing sky -> violet ->
// fuchsia brand gradient (same one used on every button/icon badge in
// this file). More, smaller blobs than a typical "ambient glow" panel —
// that's what gives the goo filter below enough shapes to actually melt
// into and split apart from each other as they drift.
const LIQUID_BLOBS = [
  { baseXPct: 20, baseYPct: 22, sizeVmin: 26, color: '#38bdf8', speed: 0.00023, driftX: 60, driftY: 46, pulseSpeed: 0.0012, phase: 0.0 },
  { baseXPct: 52, baseYPct: 14, sizeVmin: 22, color: '#60a5fa', speed: 0.0002, driftX: 50, driftY: 60, pulseSpeed: 0.0009, phase: 1.1 },
  { baseXPct: 78, baseYPct: 28, sizeVmin: 30, color: '#818cf8', speed: 0.00017, driftX: 68, driftY: 50, pulseSpeed: 0.0008, phase: 2.3 },
  { baseXPct: 30, baseYPct: 52, sizeVmin: 30, color: '#a78bfa', speed: 0.00015, driftX: 62, driftY: 56, pulseSpeed: 0.0007, phase: 3.4 },
  { baseXPct: 64, baseYPct: 58, sizeVmin: 34, color: '#c084fc', speed: 0.00013, driftX: 76, driftY: 58, pulseSpeed: 0.0006, phase: 4.1 },
  { baseXPct: 46, baseYPct: 80, sizeVmin: 28, color: '#e879f9', speed: 0.00022, driftX: 54, driftY: 44, pulseSpeed: 0.0011, phase: 5.0 },
  { baseXPct: 16, baseYPct: 78, sizeVmin: 22, color: '#22d3ee', speed: 0.0002, driftX: 44, driftY: 40, pulseSpeed: 0.0013, phase: 0.6 },
  { baseXPct: 86, baseYPct: 74, sizeVmin: 24, color: '#d946ef', speed: 0.00018, driftX: 50, driftY: 48, pulseSpeed: 0.001, phase: 2.9 },
];

// How long a point in the mouse trail stays visible before it's fully
// faded out and dropped, in ms. Tuned so a fast flick across the panel
// leaves a comet-like tail rather than a lingering scribble.
const TRAIL_MAX_AGE_MS = 750;
// Minimum pixel distance between recorded points — keeps the trail from
// flooding with near-duplicate points when the mouse moves slowly.
const TRAIL_MIN_DIST = 3;

type TrailPoint = { x: number; y: number; t: number };

// The left-half liquid panel for the desktop sign-in layout.
//
// Two effects layered together:
//  1. A "goo" liquid — several solid-color circles drifting/pulsing on
//     their own slow paths (plus leaning toward the cursor), rendered
//     inside a container with `blur + contrast` CSS filters. That combo
//     is the classic trick behind melting/morphing blob effects (soften
//     the edges with blur, then crank contrast back up so anywhere two
//     blurred shapes overlap gets pulled solid while the thin blurred
//     halo outside them gets crushed to nothing) — shapes visibly fuse
//     and split as they move, like the fluid blobs on lusion.co, all in
//     CSS with no WebGL.
//  2. A canvas-drawn cursor trail modeled on Strava's post-run route
//     reveal: every recent mouse position is kept for a short window and
//     drawn as a glowing line that tapers in width and fades in opacity
//     the older it gets, then is dropped once it expires.
// Both are driven by one shared rAF loop, gated to only run on lg+
// screens (checked via matchMedia) since the panel is hidden below that.
function LiquidGradientPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const blobElRefs = useRef<(HTMLDivElement | null)[]>([]);

  const targetMouse = useRef({ x: 0.5, y: 0.5 }); // normalized 0..1
  const smoothMouse = useRef({ x: 0.5, y: 0.5 });
  const trailPoints = useRef<TrailPoint[]>([]);
  const lastTrailPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mq = window.matchMedia('(min-width: 1024px)');
    let raf = 0;
    let active = mq.matches;
    const startTime = performance.now();

    // Canvas needs to match the container's actual pixel size (and be
    // scaled for device pixel ratio) or the trail will look soft/blurry
    // on high-DPI screens and misaligned with the cursor otherwise.
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(container);

    const tick = (now: number) => {
      if (!active) return;
      const elapsed = now - startTime;

      // Ease the raw cursor position toward a smoothed one so the goo
      // layer glides toward the pointer rather than snapping to it.
      smoothMouse.current.x += (targetMouse.current.x - smoothMouse.current.x) * 0.035;
      smoothMouse.current.y += (targetMouse.current.y - smoothMouse.current.y) * 0.035;
      const mx = (smoothMouse.current.x - 0.5) * 2; // -1..1
      const my = (smoothMouse.current.y - 0.5) * 2;

      LIQUID_BLOBS.forEach((b, i) => {
        const el = blobElRefs.current[i];
        if (!el) return;
        const dx = Math.sin(elapsed * b.speed + b.phase) * b.driftX + mx * (b.driftX * 1.1);
        const dy = Math.cos(elapsed * b.speed * 0.85 + b.phase) * b.driftY + my * (b.driftY * 1.1);
        const scale = 1 + Math.sin(elapsed * b.pulseSpeed + b.phase) * 0.22;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0) translate(-50%, -50%) scale(${scale})`;
      });

      if (ambientRef.current) {
        const gx = smoothMouse.current.x * 100;
        const gy = smoothMouse.current.y * 100;
        ambientRef.current.style.background = `radial-gradient(38% 45% at ${gx}% ${gy}%, rgba(196,132,252,0.22), rgba(56,189,248,0.08) 55%, transparent 75%)`;
      }

      // --- cursor trail ---
      const cutoff = now - TRAIL_MAX_AGE_MS;
      while (trailPoints.current.length && trailPoints.current[0].t < cutoff) {
        trailPoints.current.shift();
      }
      const rect = container.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      const pts = trailPoints.current;
      if (pts.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const age = now - p1.t;
          const life = Math.max(0, 1 - age / TRAIL_MAX_AGE_MS); // 1 = fresh, 0 = expired
          if (life <= 0) continue;
          const hue = 190 + (1 - life) * 130; // sky -> violet -> fuchsia as it ages
          ctx.strokeStyle = `hsla(${hue}, 92%, 68%, ${life * 0.9})`;
          ctx.lineWidth = 0.5 + life * 5.5;
          ctx.shadowColor = `hsla(${hue}, 95%, 62%, ${life})`;
          ctx.shadowBlur = 16 * life;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!active || raf) return;
      resizeCanvas();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const handleChange = (e: MediaQueryListEvent) => {
      active = e.matches;
      if (active) start(); else stop();
    };
    mq.addEventListener('change', handleChange);
    if (active) start();

    return () => {
      mq.removeEventListener('change', handleChange);
      ro.disconnect();
      stop();
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    targetMouse.current = { x: x / rect.width, y: y / rect.height };

    const last = lastTrailPoint.current;
    if (!last || Math.hypot(x - last.x, y - last.y) >= TRAIL_MIN_DIST) {
      trailPoints.current.push({ x, y, t: performance.now() });
      lastTrailPoint.current = { x, y };
      // Cap the buffer defensively — the age-based cutoff in the rAF
      // loop normally keeps this short, but a very fast mouse could
      // otherwise queue up more points per frame than it drops.
      if (trailPoints.current.length > 200) trailPoints.current.shift();
    }
  };

  const handleMouseLeave = () => {
    lastTrailPoint.current = null;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative hidden h-full overflow-hidden bg-zinc-950 lg:block lg:w-1/2"
    >
      {/* Soft ambient light that leans toward the cursor — sits behind the
          goo layer so it reads as light bouncing off the liquid rather
          than a shape of its own. */}
      <div ref={ambientRef} className="pointer-events-none absolute inset-0" />

      {/* The goo/metaball liquid: solid blobs blended together, then
          blurred and pushed back to hard contrast so overlapping shapes
          visibly fuse into one fluid mass and split apart as they drift.
          `isolate` keeps the blend modes scoped to this layer instead of
          bleeding into the page behind it. */}
      <div
        className="pointer-events-none absolute inset-0 isolate"
        style={{ filter: 'blur(38px) contrast(26) saturate(1.35)' }}
      >
        {LIQUID_BLOBS.map((b, i) => (
          <div
            key={i}
            ref={(el) => { blobElRefs.current[i] = el; }}
            className="absolute rounded-full mix-blend-screen"
            style={{
              left: `${b.baseXPct}%`,
              top: `${b.baseYPct}%`,
              width: `${b.sizeVmin}vmin`,
              height: `${b.sizeVmin}vmin`,
              backgroundColor: b.color,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </div>

      {/* Grounds the panel back to the app's near-black base — the goo
          filter's contrast boost otherwise blows the blob edges out
          toward white. */}
      <div className="pointer-events-none absolute inset-0 bg-zinc-950/30" />

      {/* Strava-style trail: a glowing line following recent cursor
          history that tapers and fades as each point ages out. */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}

// Once cloud data is pulled into localStorage, every piece of state in
// JEEDashboard that reads localStorage.getItem(...) inside a useState
// initializer already ran BEFORE the pull finished (those initializers only
// run once, on mount). So instead of trying to force-update dozens of
// pieces of state, we do one clean reload after the pull — same pattern
// your own DataBackupCard import flow already uses. A sessionStorage flag
// stops it from looping.
const SYNCED_FLAG = 'dcc_cloud_synced_this_session';

type Stage = 'checking' | 'auth' | 'syncing' | 'setPasscode' | 'passcode' | 'forgotPassword' | 'resetPassword';

export default function AuthGate({ onUnlock }: { onUnlock: () => void }) {
  const [stage, setStage] = useState<Stage>('checking');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // --- email/password form state ---
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [signupNotice, setSignupNotice] = useState('');

  // --- "choose your passcode" (signup) state ---
  const [pcSetupPhase, setPcSetupPhase] = useState<'enter' | 'confirm'>('enter');
  const [pcSetupFirst, setPcSetupFirst] = useState('');
  const [pcSetupValue, setPcSetupValue] = useState('');
  const [pcSetupError, setPcSetupError] = useState('');
  const [pcSetupBusy, setPcSetupBusy] = useState(false);
  const pcSetupInputRef = useRef<HTMLInputElement>(null);

  // --- "enter your passcode" (returning) state ---
  const [pcValue, setPcValue] = useState('');
  const [pcError, setPcError] = useState(false);
  const [pcChecking, setPcChecking] = useState(false);
  const pcInputRef = useRef<HTMLInputElement>(null);

  // --- forgot-password (send reset email) state ---
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  // --- set-new-password (after clicking the emailed recovery link) state ---
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newPasswordBusy, setNewPasswordBusy] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState('');

  const decidePostSyncStage = (userId: string) => {
    setPendingUserId(userId);
    const cachedHash = localStorage.getItem(PASSCODE_HASH_KEY);
    setStage(cachedHash ? 'passcode' : 'setPasscode');
  };

  const syncThenContinue = async (userId: string) => {
    if (sessionStorage.getItem(SYNCED_FLAG) === 'true') {
      decidePostSyncStage(userId);
      return;
    }
    setStage('syncing');
    try {
      await pullFromCloud(userId);
    } catch (e) {
      console.error('[AuthGate] cloud pull failed', e);
      // Don't block the user out of their own app over a network hiccup —
      // fall through using whatever is already cached locally.
    }
    try {
      const hash = await getPasscodeHash(userId);
      if (hash) localStorage.setItem(PASSCODE_HASH_KEY, hash);
    } catch (e) {
      console.error('[AuthGate] passcode fetch failed', e);
    }
    sessionStorage.setItem(SYNCED_FLAG, 'true');
    window.location.reload();
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        syncThenContinue(data.session.user.id);
      } else {
        setStage('auth');
      }
    });

    // Clicking the "reset your password" link in the email lands back here
    // with a temporary recovery session. Supabase fires this event when
    // that happens — intercept it before the normal auth flow takes over.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStage('resetPassword');
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage === 'passcode') pcInputRef.current?.focus();
    if (stage === 'setPasscode') pcSetupInputRef.current?.focus();
  }, [stage]);

  // --- returning-user passcode check ---
  useEffect(() => {
    if (pcValue.length !== PASSCODE_LENGTH || !pendingUserId) return;
    let cancelled = false;
    setPcChecking(true);
    (async () => {
      const hash = await hashPasscode(pcValue, pendingUserId);
      const cached = localStorage.getItem(PASSCODE_HASH_KEY);
      if (cancelled) return;
      setPcChecking(false);
      if (hash === cached) {
        onUnlock();
      } else {
        setPcError(true);
        setTimeout(() => {
          setPcValue('');
          setPcError(false);
          pcInputRef.current?.focus();
        }, 500);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcValue, pendingUserId]);

  // --- new-account passcode setup (two-step: enter, then confirm) ---
  useEffect(() => {
    if (pcSetupValue.length !== PASSCODE_LENGTH) return;
    if (pcSetupPhase === 'enter') {
      setPcSetupFirst(pcSetupValue);
      setPcSetupValue('');
      setPcSetupPhase('confirm');
      return;
    }
    // confirm phase
    if (pcSetupValue === pcSetupFirst) {
      finalizeNewPasscode(pcSetupValue);
    } else {
      setPcSetupError("Those didn't match — let's try again.");
      setTimeout(() => {
        setPcSetupPhase('enter');
        setPcSetupFirst('');
        setPcSetupValue('');
        setPcSetupError('');
        pcSetupInputRef.current?.focus();
      }, 700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcSetupValue]);

  const finalizeNewPasscode = async (finalPasscode: string) => {
    if (!pendingUserId) return;
    setPcSetupBusy(true);
    setPcSetupError('');
    try {
      const hash = await hashPasscode(finalPasscode, pendingUserId);
      await setPasscodeHash(pendingUserId, hash);
      localStorage.setItem(PASSCODE_HASH_KEY, hash);
      // Save whatever's currently on this device as the account's baseline
      // cloud copy (matters most for a brand-new signup with existing
      // local data already sitting in this browser).
      await pushToCloud(pendingUserId).catch(() => {});
      sessionStorage.setItem(SYNCED_FLAG, 'true');
      onUnlock();
    } catch (e) {
      console.error('[AuthGate] failed to save passcode', e);
      setPcSetupError('Could not save your passcode — check your connection and try again.');
      setPcSetupPhase('enter');
      setPcSetupFirst('');
      setPcSetupValue('');
    } finally {
      setPcSetupBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setSignupNotice('');
    setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && !data.session) {
          // Email confirmation is turned on in the Supabase dashboard.
          setSignupNotice('Account created — check your email to confirm it, then sign in.');
          setAuthMode('signin');
          setAuthBusy(false);
          return;
        }
        if (data.session?.user) {
          // Brand new account — nothing to pull from the cloud, so skip
          // straight to "choose your passcode" instead of a sync cycle.
          sessionStorage.setItem(SYNCED_FLAG, 'true');
          setPendingUserId(data.session.user.id);
          setStage('setPasscode');
          setAuthBusy(false);
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session?.user) {
          await syncThenContinue(data.session.user.id);
          return;
        }
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Something went wrong. Try again.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err: any) {
      setResetError(err?.message || 'Could not send the reset email. Try again.');
    } finally {
      setResetBusy(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewPasswordError('');
    if (newPassword.length < 6) {
      setNewPasswordError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setNewPasswordError("Those didn't match — try again.");
      return;
    }
    setNewPasswordBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        await syncThenContinue(data.session.user.id);
      } else {
        setStage('auth');
      }
    } catch (err: any) {
      setNewPasswordError(err?.message || 'Could not update your password. Try again.');
    } finally {
      setNewPasswordBusy(false);
    }
  };

  const makeDigitHandler = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value.replace(/\D/g, '').slice(0, PASSCODE_LENGTH));
  };

  // ---------------- render ----------------

  if (stage === 'checking' || stage === 'syncing') {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-zinc-950 px-6 gap-3">
        <Loader2 className="h-6 w-6 text-violet-400 animate-spin" strokeWidth={2} />
        <p className="text-[12.5px] text-neutral-500">
          {stage === 'syncing' ? 'Syncing your data from the cloud…' : 'Loading…'}
        </p>
      </div>
    );
  }

  if (stage === 'auth') {
    return (
      <div className="fixed inset-0 z-[999] flex bg-zinc-950">
        <LiquidGradientPanel />

        <div className="flex h-full w-full flex-col items-center justify-center px-6 lg:w-1/2">
          <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
            <Mail className="h-5 w-5 text-neutral-950" strokeWidth={2} />
          </div>

          <h1 className="mb-1.5 text-[15px] font-semibold tracking-tight text-neutral-50">
            {authMode === 'signin' ? 'Sign In' : 'Create Account'}
          </h1>
          <p className="mb-8 max-w-xs text-center text-[12.5px] leading-relaxed text-neutral-500">
            {authMode === 'signin'
              ? 'Sign in to sync your command center across devices.'
              : "You'll pick your own passcode right after this."}
          </p>

          <form onSubmit={handleAuthSubmit} className="w-full max-w-xs space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-[13px] text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-violet-500/50"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-[13px] text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-violet-500/50"
            />

            {authError && <p className="text-[12px] text-rose-400">{authError}</p>}
            {signupNotice && <p className="text-[12px] text-violet-400">{signupNotice}</p>}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 py-3 text-[13px] font-semibold text-neutral-950 transition-opacity disabled:opacity-60"
            >
              {authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          </form>

          {authMode === 'signin' && (
            <button
              onClick={() => {
                setResetEmail(email);
                setResetError('');
                setResetSent(false);
                setStage('forgotPassword');
              }}
              className="mt-4 text-[12px] font-medium text-neutral-500 hover:text-neutral-300"
            >
              Forgot password?
            </button>
          )}

          <button
            onClick={() => {
              setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
              setAuthError('');
              setSignupNotice('');
            }}
            className="mt-5 text-[12px] font-medium text-violet-400 hover:text-violet-300"
          >
            {authMode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'setPasscode') {
    const boxes = Array.from({ length: PASSCODE_LENGTH });
    const value = pcSetupValue;
    return (
      <div
        className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-zinc-950 px-6"
        onClick={() => pcSetupInputRef.current?.focus()}
      >
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
          <ShieldCheck className="h-5 w-5 text-neutral-950" strokeWidth={2} />
        </div>

        <h1 className="mb-1.5 text-[15px] font-semibold tracking-tight text-neutral-50">
          {pcSetupPhase === 'enter' ? 'Choose a Passcode' : 'Confirm Your Passcode'}
        </h1>
        <p className="mb-8 max-w-xs text-center text-[12.5px] leading-relaxed text-neutral-500">
          {pcSetupPhase === 'enter'
            ? "Pick 6 digits. This is what you'll use to unlock the app on this and every device — it's yours alone."
            : 'Enter it one more time to confirm.'}
        </p>

        <div className={`relative flex gap-2.5 ${pcSetupError ? 'animate-shake' : ''}`}>
          {boxes.map((_, i) => {
            const filled = i < value.length;
            const isCurrent = i === value.length;
            return (
              <div
                key={i}
                className={`flex h-12 w-10 items-center justify-center rounded-xl border text-lg font-semibold tabular-nums transition-colors duration-150 ${
                  pcSetupError
                    ? 'border-rose-500/50 bg-rose-500/[0.06] text-rose-300'
                    : isCurrent
                    ? 'border-violet-500/50 bg-neutral-900/80 text-neutral-100'
                    : filled
                    ? 'border-neutral-700 bg-neutral-900/80 text-neutral-100'
                    : 'border-neutral-800 bg-neutral-900/40 text-neutral-700'
                }`}
              >
                {filled ? value[i] : ''}
              </div>
            );
          })}
          <input
            ref={pcSetupInputRef}
            value={value}
            onChange={makeDigitHandler(setPcSetupValue)}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            disabled={pcSetupBusy}
            aria-label="New passcode"
            className="absolute inset-0 h-full w-full cursor-default opacity-0"
          />
        </div>

        <p className={`mt-5 h-4 text-[12px] font-medium text-rose-400 transition-opacity duration-150 ${pcSetupError ? 'opacity-100' : 'opacity-0'}`}>
          {pcSetupError || ' '}
        </p>
        {pcSetupBusy && <p className="text-[12px] text-neutral-500 -mt-2">Saving…</p>}
      </div>
    );
  }

  if (stage === 'forgotPassword') {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-zinc-950 px-6">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
          <Mail className="h-5 w-5 text-neutral-950" strokeWidth={2} />
        </div>

        <h1 className="mb-1.5 text-[15px] font-semibold tracking-tight text-neutral-50">
          Reset Your Password
        </h1>
        <p className="mb-8 max-w-xs text-center text-[12.5px] leading-relaxed text-neutral-500">
          {resetSent
            ? "Check your inbox — we've sent a link to reset your password."
            : "Enter your account email and we'll send you a reset link."}
        </p>

        {!resetSent ? (
          <form onSubmit={handleSendResetEmail} className="w-full max-w-xs space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-[13px] text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-violet-500/50"
            />
            {resetError && <p className="text-[12px] text-rose-400">{resetError}</p>}
            <button
              type="submit"
              disabled={resetBusy}
              className="w-full rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 py-3 text-[13px] font-semibold text-neutral-950 transition-opacity disabled:opacity-60"
            >
              {resetBusy ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <CheckCircle2 className="h-8 w-8 text-violet-400" strokeWidth={2} />
        )}

        <button
          onClick={() => {
            setAuthError('');
            setStage('auth');
          }}
          className="mt-6 text-[12px] font-medium text-violet-400 hover:text-violet-300"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (stage === 'resetPassword') {
    return (
      <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-zinc-950 px-6">
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
          <ShieldCheck className="h-5 w-5 text-neutral-950" strokeWidth={2} />
        </div>

        <h1 className="mb-1.5 text-[15px] font-semibold tracking-tight text-neutral-50">
          Set a New Password
        </h1>
        <p className="mb-8 max-w-xs text-center text-[12.5px] leading-relaxed text-neutral-500">
          Choose a new password for your account.
        </p>

        <form onSubmit={handleSetNewPassword} className="w-full max-w-xs space-y-3">
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 6 characters)"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-[13px] text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-violet-500/50"
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 text-[13px] text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-violet-500/50"
          />
          {newPasswordError && <p className="text-[12px] text-rose-400">{newPasswordError}</p>}
          <button
            type="submit"
            disabled={newPasswordBusy}
            className="w-full rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 py-3 text-[13px] font-semibold text-neutral-950 transition-opacity disabled:opacity-60"
          >
            {newPasswordBusy ? 'Saving…' : 'Save New Password'}
          </button>
        </form>
      </div>
    );
  }

  // stage === 'passcode'
  const boxes = Array.from({ length: PASSCODE_LENGTH });
  return (
    <div
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-zinc-950 px-6"
      onClick={() => pcInputRef.current?.focus()}
    >
      <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
        <Lock className="h-5 w-5 text-neutral-950" strokeWidth={2} />
      </div>

      <h1 className="mb-1.5 text-[15px] font-semibold tracking-tight text-neutral-50">Welcome Back</h1>
      <p className="mb-8 max-w-xs text-center text-[12.5px] leading-relaxed text-neutral-500">
        Enter your passcode to continue.
      </p>

      <div className={`relative flex gap-2.5 ${pcError ? 'animate-shake' : ''}`}>
        {boxes.map((_, i) => {
          const filled = i < pcValue.length;
          const isCurrent = i === pcValue.length;
          return (
            <div
              key={i}
              className={`flex h-12 w-10 items-center justify-center rounded-xl border text-lg font-semibold tabular-nums transition-colors duration-150 ${
                pcError
                  ? 'border-rose-500/50 bg-rose-500/[0.06] text-rose-300'
                  : isCurrent
                  ? 'border-violet-500/50 bg-neutral-900/80 text-neutral-100'
                  : filled
                  ? 'border-neutral-700 bg-neutral-900/80 text-neutral-100'
                  : 'border-neutral-800 bg-neutral-900/40 text-neutral-700'
              }`}
            >
              {filled ? pcValue[i] : ''}
            </div>
          );
        })}
        <input
          ref={pcInputRef}
          value={pcValue}
          onChange={makeDigitHandler(setPcValue)}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          disabled={pcChecking}
          aria-label="Passcode"
          className="absolute inset-0 h-full w-full cursor-default opacity-0"
        />
      </div>

      <p className={`mt-5 h-4 text-[12px] font-medium text-rose-400 transition-opacity duration-150 ${pcError ? 'opacity-100' : 'opacity-0'}`}>
        Incorrect passcode
      </p>

      <button
        onClick={async () => {
          sessionStorage.removeItem(SYNCED_FLAG);
          localStorage.removeItem(PASSCODE_HASH_KEY);
          await supabase.auth.signOut();
          window.location.reload();
        }}
        className="mt-10 text-[11.5px] font-medium text-neutral-600 hover:text-neutral-400"
      >
        Not you? Sign out
      </button>
    </div>
  );
}