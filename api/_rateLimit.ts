import type { SupabaseClient } from '@supabase/supabase-js';

// Server-authoritative, cross-instance rate limiting backed by a Postgres
// table + RPC (see supabase/migrations/0001_server_side_rate_limiting.sql).
// Replaces the old in-memory `Map`-based limiter that used to live directly
// in api/delete-account.ts: that reset on every cold start and wasn't
// shared across serverless instances/regions, so a distributed caller could
// exceed the intended limit by hitting different cold-started instances.
// Postgres is the one thing every instance already talks to, so it's the
// natural shared store here — no new infra (Redis/Vercel KV) required.
//
// `client` must be a SERVICE-ROLE Supabase client — `rate_limit_hit` is
// locked down to the `service_role` Postgres role only (see the migration).

/**
 * Records one "hit" against `key` within a `windowSeconds`-wide fixed
 * window and returns whether that hit pushed the bucket over `max`.
 * Fails OPEN (returns false / "not limited") on any infra error, so a
 * transient DB hiccup — or the migration not having been applied yet —
 * degrades to "no rate limiting" rather than locking every caller out.
 * The failure is logged either way so a persistent problem is visible.
 */
export async function isRateLimited(
  client: SupabaseClient,
  key: string,
  windowSeconds: number,
  max: number
): Promise<boolean> {
  const { data, error } = await client.rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('[rateLimit] rate_limit_hit RPC failed — did you run supabase/migrations/0001_server_side_rate_limiting.sql?', {
      key,
      error,
    });
    return false;
  }
  return (data as number) > max;
}

// SECURITY FIX: `x-forwarded-for` is set by whatever HTTP client makes the
// request unless the edge/proxy in front of this function overwrites it —
// on some hosts a caller can simply send their own `x-forwarded-for` header
// and get a fresh rate-limit bucket per request. On Vercel specifically,
// `x-vercel-forwarded-for` is the one header Vercel's own edge network sets
// itself from the real TCP connection, appended AFTER any incoming header
// of the same name — so it can't be spoofed by the caller the way a bare
// `x-forwarded-for` can (see https://vercel.com/docs/edge-network/headers).
// Prefer it, and only fall back to `x-forwarded-for`/socket address for
// local dev or non-Vercel hosting where that header won't be present.
export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const vercelIp = req.headers['x-vercel-forwarded-for'];
  const vercelFirst = Array.isArray(vercelIp) ? vercelIp[0] : vercelIp;
  if (vercelFirst) return vercelFirst.split(',')[0].trim();

  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first ? first.split(',')[0].trim() : req.socket?.remoteAddress;
  return ip || 'unknown';
}