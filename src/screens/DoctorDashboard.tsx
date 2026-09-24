import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useLiveSync, useTick } from '../state/useLiveSync';
import { useLive } from '../state/live';
import { useUI } from '../state/ui';
import { apiDoctorCallNext, apiDoctorFinish, apiDoctorStart, apiSetQueuePaused, apiFetchClinic } from '../server/api';
import { Header, Stat, EmptyState } from '../components/ui';
import { LivePill, ProgressRing } from '../components/Bits';
import { IconPause, IconPlay, IconStar, IconUser, IconCheck } from '../components/icons';
import { hhmm } from '../lib/time';

export function DoctorDashboard() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const live = useLive((s) => s.doctor);
  const connected = useLive((s) => s.connected);
  const refresh = useLive((s) => s.refreshDoctor);
  const clinic = apiFetchClinic(session.clinicId);
  useLiveSync('doctor');
  const now = useTick(1000);

  const run = (fn: () => unknown, ok?: string) => {
    try {
      fn();
      if (ok) toast(ok);
      refresh(session.userId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  const rolling = live?.stats.rollingAvgMinutes ?? 0;
  const elapsed = live?.current?.elapsedMinutes ?? 0;

  return (
    <div className="screen">
      <Header
        title={session.name}
        subtitle={`${clinic.name} · consultation console`}
        brand="doctor"
        right={<LivePill connected={connected} />}
      />
      <div className="scroll-y" style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {live?.current ? (
          <div className="card" style={{ padding: 18, background: 'linear-gradient(150deg, var(--teal-800), var(--teal-600))', border: 'none', color: '#fff' }}>
            <div className="row between">
              <div>
                <div className="caption" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Now consulting</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 800, margin: '2px 0' }} className="mono-num">
                  {live.current.tokenNumber}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{live.current.patientName}</div>
                <div className="caption" style={{ color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                  Started {hhmm(now - live.current.elapsedMinutes * 60000)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <ProgressRing value01={rolling > 0 ? elapsed / rolling : 0.5} size={72} stroke={7} color="rgba(255,255,255,0.9)" />
                <div className="caption" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{elapsed}m / ~{rolling}m</div>
              </div>
            </div>
            <button
              className="btn block"
              style={{ marginTop: 14, background: '#fff', color: 'var(--teal-900)', border: 'none' }}
              onClick={() => run(() => apiDoctorFinish(session, live.current!.id), 'Consultation completed')}
            >
              <IconCheck size={16} /> Finish consultation
            </button>
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon={<IconUser size={24} />}
              title={live?.queuePaused ? 'Queue paused' : 'No patient in consultation'}
              body={live?.next ? 'Call the next patient when ready.' : 'No patients waiting right now.'}
            />
          </div>
        )}

        {live?.next && !live.current && (
          <button
            className="card pad"
            style={{ textAlign: 'left', cursor: 'pointer', border: '2px dashed var(--border-strong)', background: 'var(--brand-soft)' }}
            onClick={() => run(() => {
              const n = apiDoctorCallNext(session, session.clinicId);
              if (n) toast(`Called ${n.tokenNumber}`);
            }, undefined)}
          >
            <div className="caption" style={{ color: 'var(--brand)' }}>Next up</div>
            <div className="row" style={{ marginTop: 2 }}>
              <span className="mono-num h1 text-brand">{live.next.tokenNumber}</span>
              <span className="body-strong">{live.next.patientName}</span>
              {live.next.isPriority && <IconStar size={15} style={{ color: '#a06a10' }} />}
            </div>
            <div className="caption">Waiting {live.next.waitMinutes}m · tap to call</div>
          </button>
        )}

        {live && live.upcoming.length > 0 && (
          <div className="card pad">
            <div className="h2" style={{ fontSize: 14, marginBottom: 8 }}>Up next</div>
            {live.upcoming.map((u, i) => (
              <div key={u.id} className="row between" style={{ padding: '7px 0', borderTop: i ? '1px solid var(--border-app)' : undefined }}>
                <span className="mono-num body-strong">{u.tokenNumber}</span>
                <span className="body" style={{ flex: 1, marginLeft: 8 }}>{u.patientName}</span>
                {u.isPriority && <IconStar size={13} style={{ color: '#a06a10' }} />}
                <span className="caption mono-num">{u.waitMinutes}m</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Stat label="Seen today" value={live?.stats.seenToday ?? 0} />
          <Stat label="Avg consult" value={`${live?.stats.avgConsultMinutes ?? 0}m`} hint="today" />
          <Stat label="Rolling avg" value={`${rolling}m`} hint="last 10" accent="var(--brand)" />
          <Stat label="Avg wait" value={`${live?.stats.avgWaitMinutes ?? 0}m`} />
          <Stat label="No-shows" value={live?.stats.noShows ?? 0} />
          <Stat
            label="Delay"
            value={(live?.stats.delayMinutes ?? 0) > 0 ? `+${live?.stats.delayMinutes}m` : 'On time'}
            accent={(live?.stats.delayMinutes ?? 0) > 0 ? 'var(--coral-deep)' : 'var(--teal-700)'}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn block"
            onClick={() => run(() => apiSetQueuePaused(session as never, session.clinicId, session.userId, !(live?.queuePaused ?? false)), live?.queuePaused ? 'Queue resumed' : 'Queue paused')}
          >
            {live?.queuePaused ? <IconPlay size={15} /> : <IconPause size={15} />}
            {live?.queuePaused ? 'Resume queue' : 'Pause queue (break)'}
          </button>
        </div>

        <button className="btn ghost block" onClick={() => nav.push('daily_summary')}>
          Open daily summary
        </button>
      </div>
    </div>
  );
}
