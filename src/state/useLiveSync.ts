import { useEffect, useState } from 'react';
import { useSession } from './session';
import { useLive, attachRealtime } from './live';
import { useUI } from './ui';

/**
 * Keeps a live view fresh: server push (realtime) + light refresh interval
 * for time-decaying fields (ETA). Respects the offline simulation.
 */
export function useLiveSync(kind: 'patient' | 'staff' | 'doctor') {
  const session = useSession((s) => s.session);

  useEffect(() => {
    if (!session) return;
    attachRealtime();

    const refresh = () => {
      if (useUI.getState().offline) {
        useLive.getState().setConnected(false);
        return;
      }
      if (kind === 'patient') useLive.getState().refreshPatient(session);
      else if (kind === 'staff') useLive.getState().refreshStaff(session.clinicId);
      else useLive.getState().refreshDoctor(session.userId);
    };

    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, session?.role, kind]);
}

/** Re-render every `ms` — for elapsed timers. */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  void n;
  return Date.now();
}
