import { useEffect } from 'react';
import { useUI } from '../state/ui';
import { IconMoon, IconSun, IconWifiOff, IconWifi } from './icons';

export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-stage">
      <DemoBar />
      <div className="phone-frame">
        <div className="phone-notch" />
        {children}
      </div>
    </div>
  );
}

function DemoBar() {
  const { theme, toggleTheme, offline, setOffline } = useUI();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-app)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-1)',
        position: 'absolute',
        top: 18,
        left: 24,
        zIndex: 500,
      }}
    >
      <span className="caption" style={{ fontWeight: 800 }}>Arhan Tracks — demo</span>
      <span style={{ flex: 1 }} />
      <button
        className="btn sm subtle"
        onClick={() => setOffline(!offline)}
        title="Simulate a network drop to preview reconnection behavior"
      >
        {offline ? <IconWifiOff size={14} /> : <IconWifi size={14} />}
        {offline ? 'Offline' : 'Online'}
      </button>
      <button className="btn sm subtle" onClick={toggleTheme} title="Toggle dark mode">
        {theme === 'light' ? <IconMoon size={14} /> : <IconSun size={14} />}
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : t.kind === 'warn' ? 'warn' : ''}`}>
          {t.message}
        </div>
        ))}
    </div>
  );
}

export type TabDef = { key: string; label: string; icon: React.ReactNode; onClick: () => void; active: boolean };

export function TabBar({ tabs }: { tabs: TabDef[] }) {
  return (
    <nav
      style={{
        display: 'flex',
        borderTop: '1px solid var(--border-app)',
        background: 'var(--bg-surface)',
        paddingBottom: 'var(--safe-bottom)',
      }}
      aria-label="Primary"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={t.onClick}
          aria-current={t.active}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            padding: '9px 0 7px',
            background: 'none',
            border: 'none',
            color: t.active ? 'var(--brand)' : 'var(--text-3)',
            fontSize: 10.5,
            fontWeight: 800,
            cursor: 'pointer',
            minHeight: 48,
          }}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  );
}
