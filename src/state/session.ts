import { create } from 'zustand';
import type { Session } from '../server/types';
import { db } from '../server/db';
import { subscribeToQueue } from '../server/api';

const KEY = 'arhan_session';

interface SessionState {
  session: Session | null;
  clinicId: string;
  login: (s: Session) => void;
  logout: () => void;
  ensureClinic: () => string;
}

export const useSession = create<SessionState>((set, get) => ({
  session: loadSession(),
  clinicId: 'clinic_arhan',
  login: (s) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    set({ session: s });
  },
  logout: () => {
    localStorage.removeItem(KEY);
    set({ session: null });
  },
  ensureClinic: () => {
    return get().clinicId;
  },
}));

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * Live data hook factory: subscribes to realtime and refetches on every
 * queue change (server pushes only — no client polling loops).
 */
export function makeLiveFetcher<T>(fetcher: () => T) {
  let unsub: Unsubscribe | null = null;
  return {
    fetch: fetcher,
    subscribe: (cb: () => void, clinicId: string) => {
      unsub = subscribeToQueue(cb, clinicId);
      return () => {
        unsub?.();
        unsub = null;
      };
    },
  };
}

type Unsubscribe = () => void;
