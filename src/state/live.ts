import { create } from 'zustand';
import type { LivePatientView, LiveStaffView, LiveDoctorView, Session } from '../server/types';
import { fetchPatientLive, fetchStaffLive, fetchDoctorLive, subscribeToQueue } from '../server/api';
import { useSession } from './session';

/**
 * Live snapshots with realtime push + local ticking.
 * The engine owns truth; this store only holds last-known snapshots and
 * re-reads them when the server broadcasts a change.
 */
interface LiveState {
  patient: LivePatientView | null;
  staff: LiveStaffView | null;
  doctor: LiveDoctorView | null;
  lastSync: number;
  connected: boolean;
  refreshPatient: (session: Session) => void;
  refreshStaff: (clinicId: string) => void;
  refreshDoctor: (doctorId: string) => void;
  setConnected: (v: boolean) => void;
}

export const useLive = create<LiveState>((set) => ({
  patient: null,
  staff: null,
  doctor: null,
  lastSync: 0,
  connected: false,
  refreshPatient: (session) => {
    try {
      const v = fetchPatientLive(session);
      set({ patient: v, lastSync: Date.now(), connected: true });
    } catch {
      set({ patient: null });
    }
  },
  refreshStaff: (clinicId) => {
    try {
      const v = fetchStaffLive(clinicId);
      set({ staff: v, lastSync: Date.now(), connected: true });
    } catch {
      set({ staff: null });
    }
  },
  refreshDoctor: (doctorId) => {
    try {
      const v = fetchDoctorLive(doctorId);
      set({ doctor: v, lastSync: Date.now(), connected: true });
    } catch {
      set({ doctor: null });
    }
  },
  setConnected: (v) => set({ connected: v }),
}));

/** Attach realtime subscription once; refetch active views on every change. */
let attached = false;
export function attachRealtime(): void {
  if (attached) return;
  attached = true;
  subscribeToQueue(() => {
    const st = useLive.getState();
    const sess = useSession.getState().session;
    if (st.patient && sess && sess.role === 'patient') st.refreshPatient(sess);
    if (st.staff && sess) st.refreshStaff(sess.clinicId);
    if (st.doctor && sess && sess.role === 'doctor') st.refreshDoctor(sess.userId);
  }, 'clinic_arhan');
}
