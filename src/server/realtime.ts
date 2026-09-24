// ============================================================
// Realtime hub — simulates Supabase Realtime across tabs/devices.
// BroadcastChannel where available, localStorage events as fallback.
// Every remote event re-hydrates the shared authoritative store first,
// so views refetched in response always read fresh state.
// ============================================================

import { hydrateDb } from './db';

export type RealtimeHandler = (payload: unknown) => void;

const CHANNEL_NAME = 'arhan-tracks-realtime';

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

  private dispatch(payload: unknown) {
    // Remote event → pull the latest authoritative state from shared storage.
    hydrateDb();
    for (const h of this.handlers) {
      try {
        h(payload);
      } catch (err) {
        console.error('realtime handler error', err);
      }
    }
  }

  subscribe(handler: RealtimeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const realtime = new RealtimeHub();
