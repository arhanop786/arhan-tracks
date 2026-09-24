import { useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useLiveSync, useTick } from '../state/useLiveSync';
import { useLive } from '../state/live';
import { apiFetchMyAppointments, apiCheckIn } from '../server/api';
import type { Appointment, LivePatientView } from '../server/types';
import { Header, StatusChip, EmptyState } from '../components/ui';
import { EtaChip, LivePill, QueueProgressBar, UpdatedAgo } from '../components/Bits';
import { TabBar } from '../components/Chrome';
import { IconCalendar, IconChevronRight, IconPlus } from '../components/icons';
import { fmtEta, fmtTime12, fmtDateShort } from '../lib/time';
import { useUI } from '../state/ui';

export function PatientHome() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const live = useLive((s) => s.patient);
  const lastSync = useLive((s) => s.lastSync);
  const connected = useLive((s) => s.connected);
  useLiveSync('patient');
  const now = useTick(1000);

  const appts = apiFetchMyAppointments(session).filter((a) => a.status === 'booked');
  const toast = useUI((s) => s.toast);
  const refreshLive = useLive((s) => s.refreshPatient);

  const checkIn = (a: Appointment) => {
    try {
      apiCheckIn(session, a.id);
      toast('Checked in — your token is ready');
      refreshLive(session);
      nav.push('live_queue');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Check-in failed', 'error');
    }
  };

  return (
    <div className="screen">
      <Header
        title="Home"
        brand="patient"
        right={<LivePill connected={connected} />}
      />
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        {live && live.yourToken ? (
          <LiveQueueCard view={live} now={now} onOpen={() => nav.push('live_queue')} />
        ) : (
          <button
            className="card"
            onClick={() => nav.push('book')}
            style={{
              width: '100%',
              padding: '22px 18px',
              cursor: 'pointer',
              background: 'linear-gradient(140deg, var(--teal-800), var(--teal-700))',
              border: 'none',
              color: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800 }}>Book an appointment</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>
                  Pick a doctor, date and time in under a minute.
                </div>
              </div>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconPlus />
              </div>
            </div>
          </button>
        )}

        <div className="row between" style={{ margin: '22px 2px 10px' }}>
          <div className="h2">Upcoming appointments</div>
          <button className="btn ghost sm" onClick={() => nav.push('upcoming')}>
            All <IconChevronRight size={14} />
          </button>
        </div>

        {appts.length === 0 ? (
          <div className="card" style={{ padding: 6 }}>
            <EmptyState
              icon={<IconCalendar size={24} />}
              title="Nothing booked yet"
              body="Your upcoming appointments will appear here."
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {appts.slice(0, 3).map((a) => (
              <ApptRow key={a.id} a={a} onCheckIn={checkIn} />
            ))}
          </div>
        )}
      </div>
      <TabBar
        tabs={[
          { key: 'home', label: 'Home', icon: <IconCalendar size={20} />, active: true, onClick: () => {} },
          { key: 'book', label: 'Book', icon: <IconPlus size={20} />, active: false, onClick: () => nav.push('book') },
          { key: 'appts', label: 'Appointments', icon: <IconCalendar size={20} />, active: false, onClick: () => nav.push('upcoming') },
          { key: 'profile', label: 'Profile', icon: <IconCalendar size={20} />, active: false, onClick: () => nav.push('profile') },
        ]}
      />
    </div>
  );
}

export function LiveQueueCard({ view, now, onOpen }: { view: LivePatientView; now: number; onOpen: () => void }) {
  void now;
  return (
    <button
      onClick={onOpen}
      className="card anim-in"
      style={{
        width: '100%',
        padding: 18,
        cursor: 'pointer',
        textAlign: 'center',
        background:
          view.patientsAhead === 0 && view.status === 'called'
            ? 'linear-gradient(150deg, #b3761b, #d99b33)'
            : view.status === 'in_progress'
              ? 'linear-gradient(150deg, var(--teal-800), var(--teal-600))'
              : 'var(--bg-surface)',
        color: view.status === 'waiting' ? 'var(--text-1)' : '#fff',
        border: view.status === 'waiting' ? '1px solid var(--border-app)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <span
          className="chip"
          style={{
            background: 'rgba(255,255,255,0.16)',
            color: view.status === 'waiting' ? 'var(--text-2)' : '#fff',
            border: view.status === 'waiting' ? '1px solid var(--border-app)' : 'transparent',
          }}
        >
          <span className="live-dot" style={{ width: 7, height: 7, background: view.status === 'waiting' ? 'var(--accent)' : '#fff' }} />
          LIVE
        </span>
      </div>
      <div className="caption" style={{ color: view.status === 'waiting' ? 'var(--text-3)' : 'rgba(255,255,255,0.75)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
        {view.status === 'called' ? 'Your turn — proceed in' : view.status === 'in_progress' ? 'You’re in consultation' : 'Now serving'}
      </div>
      <div className="mono-num" style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', margin: '2px 0' }}>
        {view.nowServingToken ?? '—'}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>
        Your token <b style={{ fontSize: 15 }}>{view.yourToken}</b>
        {view.patientsAhead > 0 && <> · {view.patientsAhead} ahead</>}
      </div>
      <div style={{ margin: '12px 6px 10px' }}>
        <QueueProgressBar view={view} />
      </div>
      <EtaChip eta={view.etaMinutes} behind={view.behindScheduleMinutes} />
      <div style={{ marginTop: 8 }}>
        <UpdatedAgo lastSync={lastSyncOf(view)} />
      </div>
    </button>
  );
}

function lastSyncOf(_view: unknown): number {
  return useLive.getState().lastSync;
}

function ApptRow({ a, onCheckIn }: { a: Appointment; onCheckIn: (a: Appointment) => void }) {
  void fmtEta;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row between">
        <div>
          <div className="body-strong">{a.reason ?? 'Consultation'}</div>
          <div className="caption" style={{ marginTop: 2 }}>
            {fmtDateShort(a.scheduledDate)} · {fmtTime12(a.scheduledTime)}
          </div>
        </div>
        <StatusChip status={a.status} />
      </div>
      <button className="btn subtle sm block" style={{ marginTop: 10 }} onClick={() => onCheckIn(a)}>
        Check in & get token
      </button>
    </div>
  );
}
