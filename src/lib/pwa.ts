// ============================================================
// PWA runtime — service worker registration (production builds
// only; the dev server would cache-bust HMR) and the Web Install
// API plumbing shared by the Settings screen.
// ============================================================

export interface InstallPrompt {
  prompt: () => Promise<void>;
  outcome?: Promise<string>;
}

type BeforeInstallPromptEvent = Event & InstallPrompt;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
// iOS Safari puts installed web apps in standalone mode (non-standard flag).
const iosStandalone = typeof navigator !== 'undefined' && 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
let installed = iosStandalone;

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

export function onInstallAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the browser can show the install prompt right now. */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/** True when the app is already running as an installed app. */
export function isInstalled(): boolean {
  return installed;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });

  // iOS Safari: no beforeinstallprompt; standalone mode is the signal.
  if (iosStandalone) installed = true;
}

/** Show the browser install prompt. Returns the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const p = deferredPrompt;
  deferredPrompt = null;
  emit();
  await p.prompt();
  const choice = await p.outcome;
  return choice === 'accepted' ? 'accepted' : 'dismissed';
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}
