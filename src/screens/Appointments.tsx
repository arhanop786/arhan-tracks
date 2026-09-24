import { useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useUI } from '../state/ui';
import { apiCancelAppointment, apiCheckIn, apiFetchMyAppointments, apiFetchMyHistory, apiFetchDoctors } from '../server/api';
import { Header, StatusChip, EmptyState, Segmented, Sheet } from '../components/ui';
import { IconCalendar, IconXCircle } from '../components/icons';
import { fmtTime12, fmtDateLong, fmtDateShort, relativeTime } from '../lib/time';

export function Upcoming() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const [sheetAppt, setSheetAppt] = useState<string | null>(null);
  const doctors = apiFetchDoctors(session.clinicId);

  const upcoming = apiFetchMyAppointments(session).filter((a) => ['booked'].includes(a.status));
  const appt = upcoming.find((a) => a.id === sheetAppt);

  const cancel = (id: string) => {
    try {
      apiCancelAppointment(session, id);
      toast('Appointment cancelled');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not cancel', 'error');
    }
    setSheetAppt(null);
  };

  const checkIn = (id: string) => {
    try {
      apiCheckIn(session, id);
      toast('Checked in — get your token below');
      setSheetAppt(null);
      nav.push('live_queue');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Check-in failed', 'error');
    }
  };

  return (
    <div className="screen">
      <Header title="Upcoming appointments" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {upcoming.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<IconCalendar size={24} />}
              title="No upcoming appointments"
              body="Book a visit and it will show up here."
              action={<button className="btn primary" onClick={() => nav.replace('book')}>Book appointment</button>}
            />
          </div>
        ) : (
          upcoming.map((a) => (
            <button
              key={a.id}
              className="card"
              style={{ padding: 14, textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setSheetAppt(a.id)}
            >
              <div className="row between">
                <div>
                  <div className="body-strong">{a.reason ?? 'Consultation'}</div>
                  <div className="caption" style={{ marginTop: 2 }}>
                    {doctors.find((d) => d.id === a.doctorId)?.name ?? ''} · {fmtDateLong(a.scheduledDate)} · {fmtTime12(a.scheduledTime)}
                  </div>
                </div>
                <StatusChip status={a.status} />
              </div>
              <div className="caption mono-num" style={{ marginTop: 6, color: 'var(--brand)' }}>{a.appointmentNumber}</div>
            </button>
          ))
        )}
      </div>

      <Sheet open={!!appt} onClose={() => setSheetAppt(null)} title="Manage appointment">
        {appt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="card pad">
              <div className="body-strong">{appt.reason ?? 'Consultation'}</div>
              <div className="caption" style={{ marginTop: 2 }}>
                {fmtDateLong(appt.scheduledDate)} · {fmtTime12(appt.scheduledTime)}
              </div>
              <div className="caption mono-num" style={{ marginTop: 4, color: 'var(--brand)' }}>{appt.appointmentNumber}</div>
            </div>
            <button className="btn primary block" onClick={() => checkIn(appt.id)}>Check in & get token</button>
            <button className="btn block" onClick={() => nav.push('book')}>Reschedule (book new slot)</button>
            <button className="btn danger block" onClick={() => cancel(appt.id)}>
              <IconXCircle size={16} /> Cancel appointment
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

export function History() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const [filter, setFilter] = useState<'all' | 'done' | 'cancelled' | 'no_show'>('all');
  const appts = apiFetchMyAppointments(session).filter((a) => a.status !== 'booked');
  const history = apiFetchMyHistory(session);
  const doctors = apiFetchDoctors(session.clinicId);
  const shown = filter === 'all' ? appts : appts.filter((a) => a.status === filter);

  return (
    <div className="screen">
      <Header title="History" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'done', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'no_show', label: 'No-shows' },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Completed and cancelled visits will appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((a) => {
              const q = history.find((h) => h.appointmentId === a.id);
              return (
                <div key={a.id} className="card" style={{ padding: 14 }}>
                  <div className="row between">
                    <div>
                      <div className="body-strong">{a.reason ?? 'Consultation'}</div>
                      <div className="caption" style={{ marginTop: 2 }}>
                        {doctors.find((d) => d.id === a.doctorId)?.name ?? ''} · {fmtDateShort(a.scheduledDate)} · {fmtTime12(a.scheduledTime)}
                      </div>
                      {q && (
                        <div className="caption" style={{ marginTop: 2 }}>
                          Token {q.tokenNumber} · checked in {relativeTime(q.checkInTime)}
                        </div>
                      )}
                    </div>
                    <StatusChip status={a.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
