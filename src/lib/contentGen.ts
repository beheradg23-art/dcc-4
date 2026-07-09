import { supabase } from './supabaseClient';

// ---------- Hidden content generation ----------
// Not surfaced to the user as an "AI" feature — it's just how the app fills
// in real detail (chapter breakdowns, exercise form guides, starter goals)
// whenever a user adds something of their own instead of using the built-in
// defaults. Everything is cached locally *and* through the same cloud-sync
// mechanism as the rest of the app's data (see CONTENT_CACHE_KEY wired into
// cloudSync.ts's SYNC_KEYS), so a topic/exercise is only ever generated once
// per account, even across devices.

export const CONTENT_CACHE_KEY = 'dcc_content_cache_v1';

type CacheShape = Record<string, any>;

function readCache(): CacheShape {
  try {
    return JSON.parse(localStorage.getItem(CONTENT_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape) {
  try {
    localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.error('[contentGen] failed to write cache', e);
  }
}

function cacheKey(kind: string, input: string) {
  return `${kind}:${input.trim().toLowerCase()}`;
}

/**
 * Calls the generate-content Edge Function for a given "kind" + input,
 * caching the result so repeat lookups (or the same topic added by the
 * same user twice) never hit the network again.
 *
 * Returns null on any failure — callers should fall back to a generic
 * default rather than blocking the UI on a network hiccup.
 */
async function generate(kind: string, input: string, context?: string): Promise<any | null> {
  const cache = readCache();
  const key = cacheKey(kind, input);
  if (cache[key]) return cache[key];

  try {
    const { data, error } = await supabase.functions.invoke('generate-content', {
      body: { kind, input, context },
    });
    if (error) throw error;
    if (!data?.data) return null;

    cache[key] = data.data;
    writeCache(cache);
    return data.data;
  } catch (e) {
    console.error(`[contentGen] generation failed for ${kind}:"${input}"`, e);
    return null;
  }
}

export function generateTopicDetails(topicName: string, subjectContext?: string) {
  return generate('topic', topicName, subjectContext) as Promise<
    { chapters: string[]; focus: string[] } | null
  >;
}

export function generateExerciseGuide(exerciseName: string, context?: string) {
  return generate('exercise', exerciseName, context) as Promise<
    { target: string; instructions: string[]; cues: string } | null
  >;
}

export function generateProfileTargets(goalDescription: string) {
  return generate('profile-targets', goalDescription) as Promise<
    {
      targets: { rank: number; name: string; course: string; tag: string; color: string; desc: string }[];
      baselineLabel: string;
    } | null
  >;
}

export function generateHealthPlan(issue: string, context?: string) {
  return generate('health-plan', issue, context) as Promise<
    { plan: string; details: string[]; tag: string } | null
  >;
}