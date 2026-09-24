import { useEffect, useState } from 'react';
import type { LivePatientView } from '../server/types';
import { fmtEta } from '../lib/time';
import { IconWifi, IconWifiOff } from './icons';

/** Color-state ETA chip: mint (normal) → amber (approaching) → strong (your turn) → coral (delay). */
export function EtaChip({ eta, behind }: { eta: number | null; behind?: number }) {
  if (behind && behind > 0) {
    return <span className="chip coral">{`~${behind} min behind`}</span>;
  }
  if (eta === null) return <span className="chip">No wait</span>;
  if (eta <= 8) return <span className="chip amber">{fmtEta(eta)}</span>;
  return <span className="chip mint">{fmtEta(eta)}</span>;
}

/** Large animated token display used on live queue + cards. */
export function TokenDisplay({ token, size = 56, label, color }: { token: string | null; size?: number; label?: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      {label && (
        <div className="caption" style={{ marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11 }}>
          {label}
        </div>
      )}
      <div
        key={token ?? 'none'}
        className="mono-num anim-pop"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: size,
          letterSpacing: '-0.03em',
          color: color ?? 'var(--text-1)',
          lineHeight: 1.05,
        }}
      >
        {token ?? '—'}
      </div>
    </div>
  );
}

/** Pulsing LIVE pill with connection state. */
export function LivePill({ connected, stale }: { connected: boolean; stale?: boolean }) {
  if (!connected || stale) {
    return (
      <span className="chip amber" style={{ gap: 6 }}>
        <IconWifiOff size={13} /> Reconnecting…
      </span>
    );
  }
  return (
    <span className="chip mint" style={{ gap: 6 }}>
      <span className="live-dot" style={{ width: 7, height: 7 }} /> LIVE
    </span>
  );
}

/** "Updated Xs ago" + reconnect affordance. */
export function UpdatedAgo({ lastSync }: { lastSync: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - lastSync) / 1000));
  return (
    <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <IconWifi size={12} /> Updated {s < 5 ? 'just now' : `${s}s ago`}
    </span>
  );
}

/** Thin progress bar showing queue advancement (serving → your position). */
export function QueueProgressBar({ view }: { view: LivePatientView }) {
  const idx = view.queue.findIndex((q) => q.tokenNumber === view.yourToken);
  const serveIdx = view.queue.findIndex((q) => q.tokenNumber === view.nowServingToken);
  const total = view.queue.length;
  if (idx === -1 || total === 0) return null;
  const frac = Math.max(0, Math.min(1, (serveIdx + 1) / (idx + 1)));
  const color = view.patientsAhead <= 2 ? 'var(--amber)' : 'var(--accent)';
  return (
    <div style={{ height: 8, borderRadius: 999, background: 'var(--bg-inset-app)', overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        style={{
          width: `${frac * 100}%`,
          height: '100%',
          borderRadius: 999,
          background: `linear-gradient(90deg, var(--teal-600), ${color})`,
          transition: 'width 0.6s cubic-bezier(0.22,0.9,0.3,1)',
        }}
      />
    </div>
  );
}

/** Circular countdown for the current consultation (doctor-facing). */
export function ProgressRing({ value01, size = 64, stroke = 6, color = 'var(--accent)' }: { value01: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value01));
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-inset-app)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

export function Confetti() {
  const pieces = Array.from({ length: 18 });
  const colors = ['#31c48d', '#f0a83c', '#646fd8', '#147a63'];
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
      {pieces.map((_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 90,
            left: `${8 + ((i * 37) % 84)}%`,
            width: 8,
            height: 12,
            borderRadius: 2,
            background: colors[i % colors.length],
            animation: `confettiDrop ${1.1 + (i % 5) * 0.22}s cubic-bezier(0.2,0.7,0.4,1) ${i * 0.05}s both`,
          }}
        />
      ))}
    </div>
  );
}
