import { useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useUI } from '../state/ui';
import { apiFetchMe, apiFetchClinic, apiMarkNotificationsRead, apiFetchMyNotifications, apiResetDemo, apiUpdateProfile } from '../server/api';
import type { Patient } from '../server/types';
import { Header, Field } from '../components/ui';
import {
  IconBell, IconChevronRight, IconLogout, IconMoon, IconRefresh, IconSun, IconUser, IconWifiOff, IconWifi,
} from '../components/icons';
import { relativeTime } from '../lib/time';

export function Profile() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const clinic = apiFetchClinic(session.clinicId);
  const me = apiFetchMe(session) as Patient | null;
  const [name, setName] = useState(me?.name ?? '');
  const [yob, setYob] = useState(me?.yearOfBirth?.toString() ?? '');
  const update = useUI.getState;
  void update;

  const save = () => {
    try {
      apiUpdateProfile(session, { name, yearOfBirth: yob ? Number(yob) : undefined });
      toast('Profile saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  };

  const logout = () => {
    useSession.getState().logout();
    nav.resetTo('splash');
  };

  return (
    <div className="screen">
      <Header title="Profile" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 18, background: 'var(--brand-soft)', color: 'var(--brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800,
            }}
          >
            {(me?.name ?? 'P').slice(0, 1)}
          </div>
          <div style={{ flex: 1 }}>
            <div className="body-strong">{me?.name}</div>
            <div className="caption">+91 {me?.phone}</div>
          </div>
          <span className="chip mint">Patient</span>
        </div>

        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Year of birth (optional)">
            <input className="input" inputMode="numeric" value={yob} onChange={(e) => setYob(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1990" />
          </Field>
          <button className="btn primary block" onClick={save}>Save changes</button>
        </div>

        <div className="card pad">
          <div className="caption">Your clinic</div>
          <div className="body-strong" style={{ marginTop: 2 }}>{clinic.name}</div>
          <div className="caption" style={{ marginTop: 2 }}>{clinic.address}</div>
          <div className="caption" style={{ marginTop: 2 }}>{clinic.phone}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MenuRow icon={<IconBell size={18} />} label="Notification preferences" onClick={() => nav.push('notif_prefs')} />
          <MenuRow icon={<IconUser size={18} />} label="Settings" onClick={() => nav.push('settings')} />
        </div>

        <button className="btn danger block" onClick={logout}>
          <IconLogout size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const nav = useNav();
  const { theme, toggleTheme, offline, setOffline } = useUI();
  return (
    <div className="screen">
      <Header title="Settings" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card pad row between">
          <div>
            <div className="body-strong">Dark mode</div>
            <div className="caption">Calm dark theme for low light</div>
          </div>
          <button className="btn sm subtle" onClick={toggleTheme}>
            {theme === 'light' ? <IconMoon size={14} /> : <IconSun size={14} />} {theme === 'light' ? 'Light' : 'Dark'}
          </button>
        </div>
        <div className="card pad row between">
          <div>
            <div className="body-strong">Simulate offline</div>
            <div className="caption">Preview reconnect behavior</div>
          </div>
          <button className="btn sm subtle" onClick={() => setOffline(!offline)}>
            {offline ? <IconWifiOff size={14} /> : <IconWifi size={14} />} {offline ? 'Offline' : 'Online'}
          </button>
        </div>
        <div className="card pad">
          <div className="body-strong">About Arhan Tracks</div>
          <div className="caption" style={{ marginTop: 4, lineHeight: 1.6 }}>
            Version 1.0.0 (demo build)
            <br />
            Real-time clinic queue tracking with dynamic wait estimates.
          </div>
        </div>
        <button
          className="btn block"
          onClick={() => {
            apiResetDemo();
          }}
        >
          <IconRefresh size={16} /> Reset demo data
        </button>
      </div>
    </div>
  );
}

export function NotifPrefs() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const me = apiFetchMe(session) as Patient | null;
  const [p, setP] = useState({
    notify3Away: me?.notify3Away ?? true,
    notifyTurn: me?.notifyTurn ?? true,
    notifyDelay: me?.notifyDelay ?? true,
  });
  const notifs = apiFetchMyNotifications(session);
  const unread = notifs.filter((n) => !n.readAt).length;

  const save = (patch: Partial<typeof p>) => {
    const next = { ...p, ...patch };
    setP(next);
    apiUpdateProfile(session, patch);
    toast('Preference saved');
  };

  return (
    <div className="screen">
      <Header
        title="Notifications"
        onBack={() => nav.pop()}
        brand="patient"
        right={unread > 0 ? <button className="btn sm subtle" onClick={() => apiMarkNotificationsRead(session)}>Mark read</button> : undefined}
      />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Toggle
          icon="🔔"
          title="3 tokens away"
          desc="“Get ready — you're almost up.”"
          value={p.notify3Away}
          onChange={(v) => save({ notify3Away: v })}
        />
        <Toggle
          icon="🟢"
          title="Your turn"
          desc="“It's your turn. Please proceed…”"
          value={p.notifyTurn}
          onChange={(v) => save({ notifyTurn: v })}
        />
        <Toggle
          icon="🐢"
          title="Significant delay"
          desc="Alerts if the doctor runs behind"
          value={p.notifyDelay}
          onChange={(v) => save({ notifyDelay: v })}
        />

        <div className="h2" style={{ marginTop: 8, fontSize: 14 }}>Recent notifications</div>
        {notifs.length === 0 ? (
          <div className="card pad caption">No notifications yet. You’ll get one when your turn is near.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notifs.map((n) => (
              <div key={n.id} className="card" style={{ padding: 12, borderLeft: n.readAt ? undefined : '3px solid var(--accent)' }}>
                <div className="row between">
                  <div className="body-strong" style={{ fontSize: 13.5 }}>{n.title}</div>
                  <span className="caption">{relativeTime(n.createdAt)}</span>
                </div>
                <div className="caption" style={{ marginTop: 2 }}>{n.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ icon, title, desc, value, onChange }: { icon: string; title: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="card pad row between">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 18 }}>{icon}</div>
        <div>
          <div className="body-strong">{title}</div>
          <div className="caption">{desc}</div>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={title}
        onClick={() => onChange(!value)}
        style={{
          width: 46,
          height: 28,
          borderRadius: 999,
          border: 'none',
          cursor: 'pointer',
          background: value ? 'var(--accent)' : 'var(--bg-inset-app)',
          position: 'relative',
          transition: 'background 0.2s ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 21 : 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: 'var(--shadow-1)',
            transition: 'left 0.2s cubic-bezier(0.22,0.9,0.3,1)',
          }}
        />
      </button>
    </div>
  );
}

export function MenuRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="card" style={{ padding: '13px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%' }} onClick={onClick}>
      <span style={{ color: 'var(--brand)', display: 'flex' }}>{icon}</span>
      <span className="body-strong" style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      <IconChevronRight size={16} style={{ color: 'var(--text-3)' }} />
    </button>
  );
}
