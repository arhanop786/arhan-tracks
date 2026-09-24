// ============================================================
// Realtime hub — syncs state across tabs/devices.
//
// Demo mode (no env vars): BroadcastChannel + localStorage events,
//   re-hydrating the shared store on every remote event.
// Supabase mode (env vars set): a real postgres_changes subscription —
//   any device's mutation re-pulls Postgres state everywhere.
//
// Every remote event re-hydrates the shared authoritative store first,
// so views refetched in response always read fresh state.
// ============================================================

import { db, hydrateDb } from './db';
import { pullFromSupabase, supabaseEnabled } from './supabaseSync';

export type RealtimeHandler = (payload: unknown) => void;

const CHANNEL_NAME = 'arhan-tracks-realtime';

/**
 * Ready-gate: while a device is still booting (pulling Postgres state),
 * remote events must not apply a STALE local snapshot over it. The first
 * local mutation flips this to true — the same signal db.ts uses to start
 * pushing. Until then, remote-driven hydrates are suppressed.
 */
let localWriterReady = false;
export function markLocalWriterReady(): void {
  localWriterReady = true;
}

class RealtimeHub {
  private bc: BroadcastChannel | null = null;
  private handlers = new Set<RealtimeHandler>();
  private storageListener: ((e: StorageEvent) => void) | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel(CHANNEL_NAME);
      this.bc.onmessage = (e) => this.dispatch(e.data);
    }
    // Fallback / redundancy for older browsers
    if (typeof window !== 'undefined') {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === CHANNEL_NAME && e.newValue) {
          try {
            this.dispatch(JSON.parse(e.newValue).payload);
          } catch {
            /* ignore */
          }
        }
        if (e.key === 'arhan_db_ping') {
          this.dispatch({ type: 'db_reset' });
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  publish(payload: unknown): void {
    if (this.bc) this.bc.postMessage(payload);
    try {
      localStorage.setItem(CHANNEL_NAME, JSON.stringify({ payload, n: Math.random() }));
    } catch {
      /* ignore */
    }
  }

  /**
   * Ingest a REMOTE payload (e.g. from the Supabase postgres_changes
   * bridge) through the same dispatch pipeline as local broadcasts:
   * re-pull authoritative state, then notify all view handlers.
   */
  ingestRemote(payload: unknown): void {
    this.dispatch(payload);
  }

  /** Notify view handlers without pulling (used after the boot pull). */
  notifyLocal(payload: unknown = { type: 'db_refresh' }): void {
    for (const h of this.handlers) {
      try {
        h(payload);
      } catch (err) {
        console.error('realtime handler error', err);
      }
    }
  }

  private dispatch(payload: unknown) {
    void (async () => {
      // Remote event → pull the latest authoritative state before delivering.
      if (supabaseEnabled) {
        if (localWriterReady) await pullFromSupabase(db);
        // Else: still booting — do not overwrite the in-flight pull with
        // a stale local snapshot; the next event after ready will sync us.
      } else {
        hydrateDb();
      }
      for (const h of this.handlers) {
        try {
          h(payload);
        } catch (err) {
          console.error('realtime handler error', err);
        }
      }
    })();
  }

  subscribe(handler: RealtimeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const realtime = new RealtimeHub();
