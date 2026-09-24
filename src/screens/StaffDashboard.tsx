import { useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useLiveSync, useTick } from '../state/useLiveSync';
import { useLive } from '../state/live';
import { useUI } from '../state/ui';
import {
  apiCallNext, apiCompleteConsultation, apiCreateWalkIn, apiMarkNoShow, apiMoveEntry,
  apiSetQueuePaused, apiStartConsultation, apiTogglePriority, apiFetchClinic, apiFetchDoctors,
} from '../server/api';
import type { StaffQueueRow } from '../server/types';
import { Header, Stat, StatusChip, EmptyState, Sheet, Field } from '../components/ui';
import { LivePill, UpdatedAgo, EtaChip } from '../components/Bits';
import { TabBar } from '../components/Chrome';
import {
  IconCheck, IconChevronDown, IconChevronUp, IconPause, IconPlay, IconPlus, IconStar, IconUser, IconXCircle, IconChart, IconList, IconHome,
} from '../components/icons';
import { hhmm } from '../lib/time';

export function StaffDashboard() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const live = useLive((s) => s.staff);
  const connected = useLive((s) => s.connected);
  const lastSync = useLive((s) => s.lastSync);
  const refresh = useLive((s) => s.refreshStaff);
  useLiveSync('staff');
  useTick(1000);

  const clinic = apiFetchClinic(session.clinicId);
  const doctors = apiFetchDoctors(session.clinicId);
  const [focusDoctorId, setFocusDoctorId] = useState<string | null>(null);
  const focusDoctor = doctors.find((d) => d.id === focusDoctorId) ?? doctors[0];
  const run = (fn: () => void | unknown, ok?: string) => {
    try {
      fn();
      if (ok) toast(ok);
      refresh(session.clinicId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  return (
    <div className="screen">
      <Header
        title={clinic.name}
        subtitle={`${session.name} · reception console`}
        brand="staff"
        right={<LivePill connected={connected} />}
      />
      <div className="scroll-y" style={{ flex: 1, padding: 14 }}>
        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
          <Stat label="Seen today" value={live?.stats.seenToday ?? 0} />
          <Stat label="Waiting" value={live?.stats.waiting ?? 0} accent="var(--brand)" />
          <Stat label="Avg consult" value={`${live?.stats.avgConsultMinutes ?? 0}m`} />
          <Stat
            label="Delay"
            value={(live?.stats.delayMinutes ?? 0) > 0 ? `+${live?.stats.delayMinutes}m` : 'On time'}
            accent={(live?.stats.delayMinutes ?? 0) > 0 ? 'var(--coral-deep)' : 'var(--teal-700)'}
          />
        </div>

        {/* Now serving + called */}
        {live?.serving ? (
          <div className="card pad" style={{ marginBottom: 10, background: 'var(--indigo-50)', borderColor: 'transparent' }}>
            <div className="row between">
              <div>
                <div className="caption" style={{ color: 'var(--indigo-700)' }}>In consultation</div>
                <div className="row" style={{ gap: 8, marginTop: 2 }}>
                  <span className="mono-num h1" style={{ color: 'var(--indigo-900)' }}>{live.serving.tokenNumber}</span>
                  <span className="body-strong">{live.serving.patientName}</span>
                  {live.serving.isPriority && <IconStar size={15} style={{ color: '#a06a10' }} />}
                </div>
                <div className="caption" style={{ marginTop: 2 }}>Started {hhmm(live.serving.startedAt)} · {live.serving.elapsedMinutes}m elapsed</div>
              </div>
              <button className="btn primary sm" onClick={() => run(() => apiCompleteConsultation(session, live.serving!.id), 'Consultation completed')}>
                <IconCheck size={15} /> Done
              </button>
            </div>
          </div>
        ) : live?.called ? (
          <div className="card pad" style={{ marginBottom: 10, background: 'var(--amber-soft)', borderColor: 'transparent' }}>
            <div className="row between">
              <div>
                <div className="caption" style={{ color: '#a06a10' }}>Called — waiting for patient</div>
                <div className="row" style={{ gap: 8, marginTop: 2 }}>
                  <span className="mono-num h1" style={{ color: '#a06a10' }}>{live.called.tokenNumber}</span>
                  <span className="body-strong">{live.called.patientName}</span>
                </div>
              </div>
              <button className="btn primary sm" onClick={() => run(() => apiStartConsultation(session, live.called!.id), 'Consultation started')}>
                <IconPlay size={14} /> Start
              </button>
            </div>
          </div>
        ) : null}

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            className="btn primary sm"
            style={{ flex: 1 }}
            onClick={() =>
              run(() => {
                const n = apiCallNext(session, session.clinicId, focusDoctor?.id);
                if (n) toast(`Called ${n.tokenNumber}`);
                else toast('Queue is empty', 'warn');
              })
            }
            >
            Call next
          </button>
          <button className="btn sm" onClick={() => nav.push('walk_in')}>
            <IconPlus size={15} /> Walk-in
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const doc = focusDoctor;
              const paused = !(live?.queuePaused ?? false);
              run(() => apiSetQueuePaused(session, session.clinicId, doc.id, paused), paused ? 'Queue paused' : 'Queue resumed');
            }}
          >
            {live?.queuePaused ? <IconPlay size={14} /> : <IconPause size={14} />}
            {live?.queuePaused ? 'Resume' : 'Pause'}
          </button>
        </div>

        {/* Queue table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid', gridTemplateColumns: '72px 1fr 96px 54px 118px', gap: 6,
              padding: '10px 12px', background: 'var(--bg-inset-app)', fontSize: 10.5, fontWeight: 800,
              color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em',
            }}
          >
            <span>Token</span>
            <span>Patient</span>
            <span>Status</span>
            <span>Wait</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>
          {live && live.rows.length > 0 ? (
            live.rows.map((r) => <StaffRow key={r.id} r={r} run={run} session={session} appointmentNumber={r.appointmentNumber} />)
          ) : (
            <EmptyState icon={<IconUser size={22} />} title="No patients in queue" body="Walk-ins and checked-in appointments appear here." />
          )}
        </div>

        {/* Recent events */}
        <div className="card pad" style={{ marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="h2" style={{ fontSize: 14 }}>Activity</div>
            <UpdatedAgo lastSync={lastSync} />
          </div>
          {live?.recentEvents.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {live.recentEvents.map((e) => (
                <div key={e.id} className="row between">
                  <span className="caption" style={{ color: 'var(--text-2)' }}>{e.detail ?? e.action}</span>
                  <span className="caption mono-num">{hhmm(e.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="caption">No activity yet today.</div>
          )}
        </div>
      </div>

      <TabBar
        tabs={[
          { key: 'dash', label: 'Queue', icon: <IconList size={19} />, active: true, onClick: () => {} },
          { key: 'walkin', label: 'Walk-in', icon: <IconPlus size={19} />, active: false, onClick: () => nav.push('walk_in') },
          { key: 'summary', label: 'Summary', icon: <IconHome size={19} />, active: false, onClick: () => nav.push('daily_summary') },
          { key: 'analytics', label: 'Analytics', icon: <IconChart size={19} />, active: false, onClick: () => nav.push('analytics') },
        ]}
      />
    </div>
  );
}

function StaffRow({
  r, run, session, appointmentNumber,
}: {
  r: StaffQueueRow;
  run: (fn: () => unknown, ok?: string) => void;
  session: { name: string };
  appointmentNumber?: string;
}) {
  const nav = useNav();
  const active = ['waiting', 'called', 'paused'].includes(r.status);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr 96px 54px 118px',
        gap: 6,
        padding: '10px 12px',
        borderTop: '1px solid var(--border-app)',
        alignItems: 'center',
        background: r.status === 'in_progress' ? 'var(--indigo-50)' : r.isPriority ? 'var(--amber-soft)' : undefined,
      }}
    >
      <span className="mono-num body-strong">{r.tokenNumber}</span>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'var(--text-1)', fontWeight: 700, fontSize: 13.5 }}
        onClick={() => nav.push('patient_details', { patientId: r.patientId, queueEntryId: r.id })}
      >
        {r.patientName}
        {r.kind === 'walk-in' && <span className="caption" style={{ marginLeft: 5 }}>· walk-in</span>}
        {r.kind === 'appointment' && appointmentNumber && (
          <span className="caption mono-num" style={{ marginLeft: 5, color: 'var(--text-3)' }}>{appointmentNumber}</span>
        )}
      </button>
      <StatusChip status={r.status} />
      <span className="caption mono-num">{active ? `${r.waitMinutes}m` : '—'}</span>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {r.status === 'called' && (
          <button className="btn sm primary" onClick={() => run(() => apiStartConsultation(session as never, r.id), 'Started')} title="Start consultation">
            <IconPlay size={13} />
          </button>
        )}
        {r.status === 'in_progress' && (
          <button className="btn sm primary" onClick={() => run(() => apiCompleteConsultation(session as never, r.id), 'Completed')} title="Complete">
            <IconCheck size={14} />
          </button>
        )}
        {active && r.status !== 'called' && (
          <>
            <button className="btn sm" onClick={() => run(() => apiMoveEntry(session as never, r.id, -1), 'Moved up')} title="Move up">
              <IconChevronUp size={14} />
            </button>
            <button className="btn sm" onClick={() => run(() => apiMoveEntry(session as never, r.id, 1), 'Moved down')} title="Move down">
              <IconChevronDown size={14} />
            </button>
            <button
              className="btn sm"
              style={r.isPriority ? { color: '#a06a10' } : undefined}
              onClick={() => run(() => apiTogglePriority(session as never, r.id), r.isPriority ? 'Priority cleared' : 'Marked priority')}
              title="Toggle priority"
            >
              <IconStar size={14} />
            </button>
            <button className="btn sm danger" onClick={() => run(() => apiMarkNoShow(session as never, r.id), 'Marked no-show')} title="No-show">
              <IconXCircle size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Walk-in ----------

export function WalkIn() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const refresh = useLive((s) => s.refreshStaff);
  const doctors = apiFetchDoctors(session.clinicId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [yob, setYob] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState(false);
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');

  const submit = () => {
    try {
      const entry = apiCreateWalkIn(session, {
        clinicId: session.clinicId,
        doctorId,
        name,
        phone,
        yearOfBirth: yob ? Number(yob) : undefined,
        note: note || undefined,
        priority,
      });
      toast(`Added ${entry.tokenNumber} to queue`);
      refresh(session.clinicId);
      nav.pop();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add walk-in', 'error');
    }
  };

  return (
    <div className="screen">
      <Header title="Add walk-in" onBack={() => nav.pop()} brand="staff" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Full name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Patient name" autoFocus />
        </Field>
        <Field label="Mobile number">
          <input className="input" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))} placeholder="10-digit number" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Year of birth">
            <input className="input" inputMode="numeric" value={yob} onChange={(e) => setYob(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1990" />
          </Field>
          <Field label="Assign to">
            <select className="select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. BP check" />
        </Field>
        <button
          className="card pad row between"
          style={{ cursor: 'pointer', border: priority ? '2px solid var(--amber)' : '1px solid var(--border-app)' }}
          onClick={() => setPriority(!priority)}
          role="checkbox"
          aria-checked={priority}
        >
          <div style={{ textAlign: 'left' }}>
            <div className="body-strong">Priority / emergency</div>
            <div className="caption">Moves this patient to the front of the queue</div>
          </div>
          <span className={`chip ${priority ? 'amber' : ''}`}>{priority ? 'Priority' : 'Normal'}</span>
        </button>
        <button className="btn primary block" disabled={name.trim().length < 2 || phone.length < 10} onClick={submit}>
          Add to queue & assign token
        </button>
        <div className="caption" style={{ textAlign: 'center' }}>
          Existing patients are matched by phone — no duplicates.
        </div>
      </div>
    </div>
  );
}
