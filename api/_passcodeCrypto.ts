import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

// Must match PBKDF2_ITERATIONS in src/lib/cloudSync.ts — kept as a separate
// constant here (rather than importing across the client/server boundary)
// since this file intentionally has zero dependency on browser-only code.
const PBKDF2_ITERATIONS = 150_000;

// Server-side mirror of the hashing scheme in src/lib/cloudSync.ts
// (hashPasscode/verifyPasscode). Deliberately kept in lock-step with that
// file's format so a hash produced by the browser (Web Crypto's
// PBKDF2-HMAC-SHA256) verifies identically here (Node's crypto.pbkdf2Sync
// with the same digest/iterations/salt) — these are the same standard
// PBKDF2 construction, just two different, compatible APIs for it.
//
// Hash format: `pbkdf2:<iterations>:<saltHex>:<hashHex>`. Older accounts
// may still carry the legacy bare-SHA-256 digest (`sha256(passcode:userId)`,
// no salt, no stretching) — this still recognizes that format too so a
// legacy user isn't locked out of deleting/changing on their first visit
// after this endpoint shipped.
//
// This file exists so that "prove you currently know the passcode" is
// something the SERVER checks before doing anything destructive/sensitive
// (delete account, change passcode), not just something the client-side UI
// happens to check before making the request. A stolen session token alone
// (e.g. via XSS reading localStorage) is no longer enough by itself —
// the caller also has to actually know the passcode.

function legacyHashPasscode(passcode: string, userId: string): string {
  return createHash('sha256').update(`${passcode}:${userId}`).digest('hex');
}

function pbkdf2Hex(input: string, saltHex: string, iterations: number): string {
  const salt = Buffer.from(saltHex, 'hex');
  return pbkdf2Sync(input, salt, iterations, 32, 'sha256').toString('hex');
}

function safeHexEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Checks a passcode guess against a stored hash (as fetched from the
 * `user_data.passcode_hash` column). Returns false for any malformed input,
 * missing hash, or mismatch — never throws.
 */
export function verifyPasscodeServerSide(
  passcode: string,
  userId: string,
  storedHash: string | null | undefined
): boolean {
  if (!storedHash || typeof passcode !== 'string') return false;

  try {
    if (storedHash.startsWith('pbkdf2:')) {
      const [, iterationsStr, saltHex, expectedHex] = storedHash.split(':');
      const iterations = parseInt(iterationsStr, 10);
      if (!iterations || !saltHex || !expectedHex) return false;
      const candidateHex = pbkdf2Hex(`${passcode}:${userId}`, saltHex, iterations);
      return safeHexEqual(candidateHex, expectedHex);
    }
    // Legacy bare-SHA-256 hash — no version prefix.
    const legacyHash = legacyHashPasscode(passcode, userId);
    return safeHexEqual(legacyHash, storedHash);
  } catch {
    // Malformed stored hash / bad hex, etc. — treat as "does not verify"
    // rather than letting an exception escape and 500 the request.
    return false;
  }
}

/** Basic shape check — the app's passcode is always exactly 6 digits. */
export function isPlausiblePasscode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

/**
 * Hashes a NEW passcode for storage, in the same `pbkdf2:<iterations>:
 * <saltHex>:<hashHex>` format hashPasscode() in cloudSync.ts produces.
 * Used by change-passcode.ts so the stored hash is always computed
 * server-side from a verified request, rather than trusting an
 * already-hashed value the client could otherwise send directly.
 */
export function hashPasscodeServerSide(passcode: string, userId: string): string {
  const salt = randomBytes(16);
  const hashHex = pbkdf2Sync(`${passcode}:${userId}`, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt.toString('hex')}:${hashHex}`;
}
