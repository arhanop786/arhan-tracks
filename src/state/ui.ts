import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UIState {
  theme: 'light' | 'dark';
  toasts: Toast[];
  /** Simulated offline toggle for demo of reconnect behavior */
  offline: boolean;
  toggleTheme: () => void;
  setOffline: (v: boolean) => void;
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;

export const useUI = create<UIState>((set, get) => ({
  theme: (localStorage.getItem('arhan_theme') as 'light' | 'dark') || 'light',
  toasts: [],
  offline: false,
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('arhan_theme', next);
    set({ theme: next });
  },
  setOffline: (v) => set({ offline: v }),
  toast: (message, kind = 'success') => {
    toastId += 1;
    const id = toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
