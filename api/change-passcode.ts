import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyPasscodeServerSide, hashPasscodeServerSide, isPlausiblePasscode } from './_passcodeCrypto';

// --- Best-effort per-IP rate limiting -------------------------------------
// Same caveat as api/delete-account.ts: in-memory only, resets on cold
// start, not shared across instances/regions. A cheap deterrent against
// casual abuse, not a real defense — swap for a shared store (Upstash
// Redis / Vercel KV) if this ever sees real traffic.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateLimitHits.get(ip) || []).filter((t) => t > windowStart);
  hits.push(now);
  rateLimitHits.set(ip, hits);

  if (rateLimitHits.size > 5000) {
    for (const [key, timestamps] of rateLimitHits) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length === 0) rateLimitHits.delete(key);
      else rateLimitHits.set(key, recent);
    }
  }

  return hits.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first ? first.split(',')[0].trim() : req.socket?.remoteAddress;
  return ip || 'unknown';
}

// Changes the signed-in caller's 6-digit app passcode, requiring proof of
// the CURRENT passcode server-side before the new one is written.
//
// Previously (see PasscodeChangeCard.tsx), "change passcode" only checked
// the current passcode in the browser, then wrote the new hash straight to
// Supabase using the client's already-persisted session token. That token
// alone was enough to call setPasscodeHash(userId, arbitraryHash) directly
// (browser console, a malicious extension, XSS) and overwrite the passcode
// without ever going through the passcode UI — the passcode wasn't really
// an independent factor, just a UI speed bump sitting on top of the
// session. This endpoint closes that gap the same way api/delete-account.ts
// closes it for account deletion:
//
// 1. Client-side (PasscodeChangeCard.tsx): the person re-enters their
//    current passcode and chooses a new one before this endpoint is called.
// 2. Server-side session check (this file): the request must carry a valid
//    Supabase access token, verified against Supabase itself — the only
//    source of truth for "who is this".
// 3. Server-side passcode check (this file): the request must ALSO include
//    the correct CURRENT passcode, independently verified here against the
//    stored hash. Only then is the new hash computed (server-side, from
//    scratch — never trusting a pre-hashed value from the client) and
//    written. A stolen session token alone can no longer change the
//    passcode without also knowing it.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests — please try again later.' });
  }

  const body = req.body as { currentPasscode?: unknown; newPasscode?: unknown } | undefined;
  const currentPasscode = body?.currentPasscode;
  const newPasscode = body?.newPasscode;
  if (!isPlausiblePasscode(currentPasscode) || !isPlausiblePasscode(newPasscode)) {
    return res.status(400).json({ error: 'Missing or invalid passcode.' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL as string;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY as string;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    // Same SUPABASE_SERVICE_ROLE_KEY requirement as api/delete-account.ts —
    // server-side only env var, never VITE_-prefixed. See that file's
    // comment for details on where to get it.
    return res.status(500).json({ error: 'Server misconfigured — missing Supabase env vars' });
  }

  // Step 1: verify the token belongs to a real, currently-valid session.
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const userId = userData.user.id;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Step 2: independently verify the CURRENT passcode against the stored
  // hash before allowing any change.
  const { data: userRow, error: userRowError } = await adminClient
    .from('user_data')
    .select('passcode_hash')
    .eq('user_id', userId)
    .maybeSingle();
  if (userRowError) {
    console.error('[change-passcode] Failed to load passcode hash', { userId, error: userRowError });
    return res.status(500).json({ error: 'Could not verify your passcode. Please try again.' });
  }
  const currentOk = verifyPasscodeServerSide(currentPasscode, userId, userRow?.passcode_hash ?? null);
  if (!currentOk) {
    return res.status(401).json({ error: 'Incorrect passcode.' });
  }

  // Step 3: only now compute and store the new hash.
  const newHash = hashPasscodeServerSide(newPasscode, userId);
  const { error: updateError } = await adminClient
    .from('user_data')
    .upsert({ user_id: userId, passcode_hash: newHash }, { onConflict: 'user_id' });
  if (updateError) {
    console.error('[change-passcode] Failed to store new passcode hash', { userId, error: updateError });
    return res.status(500).json({ error: 'Could not update your passcode. Please try again.' });
  }

  return res.status(200).json({ success: true, passcodeHash: newHash });
}
