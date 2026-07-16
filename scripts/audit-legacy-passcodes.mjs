// ---------------------------------------------------------------------------
// Fix for audit item #5: the legacy unsalted `sha256(passcode:userId)` hash
// format is accepted indefinitely for backward compatibility, and only gets
// upgraded to PBKDF2 the moment that specific account next logs in
// correctly. That's fine for active users, but an account that hasn't
// logged in since the PBKDF2 hardening shipped is sitting on a hash that's
// trivially crackable offline if it ever leaks.
//
// This is a one-off ADMIN script (run locally, never deployed) that:
//   1. Lists every user_id in `user_data` still on the legacy format, and
//   2. With --reset, clears their passcode hash (via the same clear path
//      "forgot passcode" uses), which forces them to set a new passcode
//      next time they open the app — safe because passcode recovery is
//      already gated on Supabase Auth identity, not on the hash itself.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
// NEVER commit real values for either — this reads them from process.env
// only. Usage:
//   node scripts/audit-legacy-passcodes.mjs            # list only
//   node scripts/audit-legacy-passcodes.mjs --reset     # list + force-reset
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const shouldReset = process.argv.includes('--reset');
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isLegacyHash(hash) {
  // Current format is `pbkdf2:<iterations>:<saltHex>:<hashHex>`. Anything
  // else non-null is the old bare 64-char hex SHA-256 digest.
  return typeof hash === 'string' && hash.length > 0 && !hash.startsWith('pbkdf2:');
}

async function main() {
  const { data, error } = await admin
    .from('user_data')
    .select('user_id, passcode_hash')
    .not('passcode_hash', 'is', null);

  if (error) {
    console.error('Failed to read user_data:', error);
    process.exit(1);
  }

  const legacy = (data ?? []).filter((row) => isLegacyHash(row.passcode_hash));

  if (legacy.length === 0) {
    console.log('No accounts on the legacy passcode hash format. Nothing to do.');
    return;
  }

  console.log(`${legacy.length} account(s) still on the legacy passcode hash format:`);
  legacy.forEach((row) => console.log(`  - ${row.user_id}`));

  if (!shouldReset) {
    console.log('\nRe-run with --reset to force these accounts to set a new passcode next login.');
    return;
  }

  console.log('\nClearing passcode_hash for the accounts above (forces "set a new passcode" on next login)...');
  for (const row of legacy) {
    const { error: updateError } = await admin
      .from('user_data')
      .update({ passcode_hash: null })
      .eq('user_id', row.user_id);
    if (updateError) {
      console.error(`  Failed for ${row.user_id}:`, updateError);
    } else {
      console.log(`  Cleared ${row.user_id}`);
    }
  }
}

main();
