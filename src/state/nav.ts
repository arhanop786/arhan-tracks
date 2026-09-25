import { create } from 'zustand';

export type Screen =
  | 'splash'
  | 'role_select'
  | 'patient_login'
  | 'staff_login'
  | 'patient_home'
  | 'live_queue'
  | 'book'
  | 'confirmation'
  | 'upcoming'
  | 'history'
  | 'profile'
  | 'settings'
  | 'notif_prefs'
  | 'staff_dashboard'
  | 'walk_in'
  | 'patient_details'
  | 'queue_mgmt'
  | 'doctor_dashboard'
  | 'daily_summary'
  | 'analytics'
  | 'admin';

export interface NavParams {
  queueEntryId?: string;
  appointmentId?: string;
  confirmationApptNumber?: string;
  patientId?: string;
  patientName?: string;
  /** staff_login: open as doctor console */
  as?: 'doctor' | 'staff';
}

interface NavState {
  stack: Screen[];
  params: NavParams;
  push: (s: Screen, p?: NavParams) => void;
  replace: (s: Screen, p?: NavParams) => void;
  pop: () => void;
  resetTo: (s: Screen, p?: NavParams) => void;
}

export const useNav = create<NavState>((set) => ({
  stack: ['splash'],
  params: {},
  push: (s, p) => set((st) => ({ stack: [...st.stack, s], params: p ?? {} })),
  replace: (s, p) => set((st) => ({ stack: [...st.stack.slice(0, -1), s], params: p ?? {} })),
  pop: () => set((st) => (st.stack.length > 1 ? { stack: st.stack.slice(0, -1), params: {} } : st)),
  resetTo: (s, p) => set({ stack: [s], params: p ?? {} }),
}));

export function currentScreen(): Screen {
  const st = useNav.getState();
  return st.stack[st.stack.length - 1];
}

export function currentScreenParams(): NavParams {
  return useNav.getState().params;
}
