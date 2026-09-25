import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { apiFetchDailyStats, apiFetchConsultationLog, apiFetchDoctors, apiFetchClinic, apiFetchMe } from '../server/api';
import type { StaffMember } from '../server/types';
import { Header, Stat } from '../components/ui';
import { hhmm, fmtDuration } from '../lib/time';

export function DailySummary() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const me = apiFetchMe(session) as StaffMember | null;
  const stats = apiFetchDailyStats(session.clinicId);
  const log = apiFetchConsultationLog(session.clinicId);
  const doctors = apiFetchDoctors(session.clinicId);
  const clinic = apiFetchClinic(session.clinicId);

  const totals = stats.reduce(
    (acc, s) => ({
      seen: acc.seen + s.patientsSeen,
      noShows: acc.noShows + s.noShows,
      delay: acc.delay + s.totalDelayMinutes,
    }),
    { seen: 0, noShows: 0, delay: 0 },
  );

  return (
    <div className="screen">
      <Header
        title="Daily summary"
        onBack={() => nav.pop()}
        brand="staff"
        right={
          me?.role === 'admin' ? (
            <button className="btn sm" onClick={() => nav.push('admin')}>
              Admin
            </button>
          ) : undefined
        }
      />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card pad">
          <div className="caption">{clinic.name} · today</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
            <Stat label="Patients seen" value={totals.seen} />
            <Stat label="No-shows" value={totals.noShows} accent={totals.noShows ? 'var(--coral-deep)' : undefined} />
            <Stat label="Total delay" value={`${totals.delay}m`} accent={totals.delay ? 'var(--coral-deep)' : 'var(--teal-700)'} />
          </div>
        </div>

        {stats.map((s) => {
          const d = doctors.find((x) => x.id === s.doctorId);
          return (
            <div key={s.doctorId} className="card pad">
              <div className="row between">
                <div className="body-strong">{d?.name ?? s.doctorId}</div>
                <span className="chip indigo">{d?.specialty}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
                <Stat label="Seen" value={s.patientsSeen} />
                <Stat label="Rolling avg" value={fmtDuration(s.rollingAvgSeconds)} hint="last 10" />
                <Stat label="Avg wait" value={fmtDuration(s.avgWaitSeconds)} />
              </div>
              <div className="caption" style={{ marginTop: 8 }}>
                Est. queue completion:{' '}
                <b>{s.estimatedEndTime ? hhmm(s.estimatedEndTime) : '—'}</b>
                {' · '}Queue peak: {s.queuePeak}
              </div>
            </div>
          );
        })}

        <div className="h2" style={{ fontSize: 14 }}>Consultation log</div>
        {log.length === 0 ? (
          <div className="card pad caption">No consultations completed yet today.</div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            {log.map((c, i) => (
              <div
                key={`${c.token}-${i}`}
                className="row between"
                style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--border-app)' : undefined }}
              >
                <span className="mono-num body-strong">{c.token}</span>
                <span className="caption" style={{ flex: 1, marginLeft: 8 }}>{c.doctor}</span>
                <span className="caption mono-num">{hhmm(c.startedAt)}–{hhmm(c.endedAt)}</span>
                <span className="chip mint" style={{ marginLeft: 8 }}>{c.durationMin}m</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Analytics() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const stats = apiFetchDailyStats(session.clinicId);
  const doctors = apiFetchDoctors(session.clinicId);
  const log = apiFetchConsultationLog(session.clinicId);

  const totalSeen = stats.reduce((s, x) => s + x.patientsSeen, 0);
  const totalNoShow = stats.reduce((s, x) => s + x.noShows, 0);
  const avgConsult =
    stats.length > 0 ? stats.reduce((s, x) => s + x.rollingAvgSeconds, 0) / stats.length / 60 : 0;

  // weekly trend per doctor (from consultations)
  const days: { date: string; seen: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const seen = log.filter((c) => c.startedAt >= new Date(iso).getTime() && c.startedAt < new Date(iso).getTime() + 86_400_000).length;
    days.push({ date: iso, seen });
  }
  const maxSeen = Math.max(1, ...days.map((d) => d.seen));

  return (
    <div className="screen">
      <Header title="Analytics" onBack={() => nav.pop()} brand="staff" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Stat label="Patients (today)" value={totalSeen} />
          <Stat label="No-shows" value={totalNoShow} accent={totalNoShow ? 'var(--coral-deep)' : undefined} />
          <Stat label="Avg consult" value={`${Math.round(avgConsult * 10) / 10}m`} hint="rolling" />
        </div>

        <div className="card pad">
          <div className="h2" style={{ fontSize: 14, marginBottom: 10 }}>Consultations · last 7 days</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 110 }}>
            {days.map((d) => (
              <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                <div
                  style={{
                    height: `${(d.seen / maxSeen) * 84 + 4}px`,
                    background: 'linear-gradient(180deg, var(--teal-500), var(--teal-700))',
                    borderRadius: 6,
                    minHeight: 4,
                  }}
                  title={`${d.seen} consultations`}
                />
                <div className="caption mono-num" style={{ fontSize: 9.5, marginTop: 4 }}>{d.date.slice(8)}</div>
              </div>
            ))}
          </div>
        </div>

        {stats.map((s) => {
          const d = doctors.find((x) => x.id === s.doctorId);
          return (
            <div key={s.doctorId} className="card pad">
              <div className="body-strong">{d?.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                <Stat label="Seen" value={s.patientsSeen} />
                <Stat label="Avg wait" value={fmtDuration(s.avgWaitSeconds)} />
                <Stat label="Delay" value={`${s.totalDelayMinutes}m`} accent={s.totalDelayMinutes ? 'var(--coral-deep)' : 'var(--teal-700)'} />
              </div>
            </div>
          );
        })}

        <div className="caption" style={{ textAlign: 'center' }}>
          Aggregates only — no patient-identifying data in analytics.
        </div>
      </div>
    </div>
  );
}
