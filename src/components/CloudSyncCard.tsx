import React, { useEffect, useState } from 'react';
import { Cloud, CloudUpload, LogOut, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { pushToCloud } from '../lib/cloudSync';

// Drop <CloudSyncCard /> into your Settings tab (ConfigEditorTab) wherever
// you'd like it to sit — it's self-contained, matches the same card styling
// used by DataBackupCard elsewhere in the app.

export default function CloudSyncCard() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const handleSyncNow = async () => {
    if (!userId) return;
    setSyncing(true);
    try {
      await pushToCloud(userId);
      setStatus({ type: 'success', message: 'Synced to the cloud.' });
    } catch {
      setStatus({ type: 'error', message: 'Sync failed — check your connection and try again.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSignOut = async () => {
    sessionStorage.removeItem('dcc_cloud_synced_this_session');
    localStorage.removeItem('dcc_passcode_hash');
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500">
            <Cloud className="h-4.5 w-4.5 text-neutral-950" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-[13.5px] font-bold text-neutral-100">Cloud Sync</h3>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              {email ? `Signed in as ${email}` : 'Not signed in'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleSyncNow}
            disabled={syncing || !userId}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-[12px] font-semibold text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-[12px] font-semibold text-rose-300 hover:bg-rose-950/40 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {status && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
            status.type === 'success' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {status.message}
        </div>
      )}
    </div>
  );
}