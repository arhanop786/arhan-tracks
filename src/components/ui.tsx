import type { ReactNode, CSSProperties } from 'react';
import { IconChevronLeft } from './icons';

export function Header({
  title,
  onBack,
  right,
  subtitle,
  brand = 'patient',
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  subtitle?: string;
  brand?: 'patient' | 'staff' | 'doctor';
}) {
  const accent =
    brand === 'staff' ? 'var(--indigo-700)' : brand === 'doctor' ? 'var(--teal-700)' : 'var(--brand)';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        paddingTop: 'calc(var(--safe-top) + 26px)',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-app)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="btn sm ghost"
          style={{ color: accent, padding: 8, minWidth: 36, minHeight: 36 }}
        >
          <IconChevronLeft />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="h2" style={{ color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {subtitle && <div className="caption" style={{ color: 'var(--text-3)' }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    booked: { cls: 'chip', label: 'Booked' },
    checked_in: { cls: 'chip mint', label: 'Checked in' },
    in_progress: { cls: 'chip indigo', label: 'In consultation' },
    called: { cls: 'chip amber', label: 'Called' },
    waiting: { cls: 'chip', label: 'Waiting' },
    paused: { cls: 'chip amber', label: 'Paused' },
    done: { cls: 'chip mint', label: 'Done' },
    no_show: { cls: 'chip coral', label: 'No-show' },
    cancelled: { cls: 'chip coral', label: 'Cancelled' },
  };
  const m = map[status] ?? { cls: 'chip', label: status };
  return <span className={m.cls}>{m.label}</span>;
}

export function Stat({
  label,
  value,
  hint,
  accent,
  style,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-app)',
        borderRadius: 14,
        padding: '10px 12px',
        ...style,
      }}
    >
      <div className="caption" style={{ color: 'var(--text-3)', fontSize: 11 }}>{label}</div>
      <div
        className="h2 mono-num"
        style={{ color: accent ?? 'var(--text-1)', fontSize: 18, marginTop: 2 }}
        aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}`}
      >
        {value}
      </div>
      {hint && <div className="caption" style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '36px 24px' }}>
      {icon && (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          {icon}
        </div>
      )}
      <div className="h2" style={{ marginBottom: 6 }}>{title}</div>
      {body && <div className="body" style={{ color: 'var(--text-3)', maxWidth: 260, margin: '0 auto 16px' }}>{body}</div>}
      {action}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="caption">{hint}</span>}
    </label>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 150,
        display: 'flex',
        alignItems: 'flex-end',
        background: 'rgba(7, 33, 28, 0.45)',
        animation: 'fadeIn 0.2s ease both',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '18px 16px calc(16px + var(--safe-bottom))',
          width: '100%',
          maxHeight: '82%',
          overflowY: 'auto',
          animation: 'sheetUp 0.3s cubic-bezier(0.22, 0.9, 0.3, 1) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div className="h2" style={{ flex: 1 }}>{title}</div>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close" style={{ minHeight: 32 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function BrandLogo({ size = 40, light }: { size?: number; light?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.3,
          background: light ? 'rgba(255,255,255,0.14)' : 'var(--brand)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: size * 0.42, letterSpacing: '-0.01em', color: light ? '#fff' : 'var(--text-1)' }}>
          Arhan Tracks
        </div>
      </div>
    </div>
  );
}
