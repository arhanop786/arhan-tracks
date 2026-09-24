// ============================================================
// App boot — wire up persistent state before the UI renders.
//
// Demo mode:  the localStorage hydrate in db.ts already ran at import
// time, so there is nothing to do here.
// Supabase mode: pull authoritative state from Postgres BEFORE the
// first render (seeding it from buildDemo when empty), then bridge
// remote postgres_changes into the realtime hub's dispatch pipeline
// so every view refetches on other devices' mutations.
// ============================================================

import { db, persistDb } from './db';
import { markLocalWriterReady, realtime } from './realtime';
import { pullFromSupabase, subscribeRemote, supabaseEnabled } from './supabaseSync';

async function boot(): Promise<void> {
  if (!supabaseEnabled) return;

  // 1. Initial pull. On failure we stay on the in-memory demo state and
  //    simply skip remote sync — the UI still works fully.
  const pulled = await pullFromSupabase(db);
  if (pulled) {
    // Snapshot locally so a fast reload renders server state, not the
    // pristine seed. (The debounced push this schedules is harmless:
    // it re-upserts the state we just pulled.)
    persistDb();
    realtime.notifyLocal();
  }

  // 2. Bridge remote postgres_changes into the hub. realtime.dispatch
  //    re-pulls authoritative state (once this device is "ready") and
  //    notifies all view handlers — same contract as the demo hub.
  subscribeRemote((payload) => realtime.ingestRemote(payload));

  // 3. Ready-gate: until the first user gesture there can be no local
  //    mutation, so remote-driven hydrates stay suppressed (they would
  //    only overwrite the fresh boot pull with an identical snapshot).
  const onFirstGesture = () => {
    markLocalWriterReady();
    document.removeEventListener('pointerdown', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);
  };
  document.addEventListener('pointerdown', onFirstGesture, true);
  document.addEventListener('keydown', onFirstGesture, true);
}

void boot();
