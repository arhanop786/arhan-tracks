import { useMemo, useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useUI } from '../state/ui';
import { apiBookAppointment, apiFetchClinic, apiFetchDoctors, apiFetchSlots } from '../server/api';
import { apiFetchMyAppointments } from '../server/api';
import { Header, Field } from '../components/ui';
import { IconCheckCircle } from '../components/icons';
import { isoDate, fmtTime12, fmtDateLong, weekdayShort } from '../lib/time';

export function Book() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const clinic = apiFetchClinic(session.clinicId);
  const doctors = apiFetchDoctors(session.clinicId);
  const mine = apiFetchMyAppointments(session);

  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [date, setDate] = useState(isoDate());
  const [time, setTime] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 7; i++) out.push(isoDate(Date.now() + i * 86_400_000));
    return out;
  }, []);

  const slots = useMemo(() => {
    if (!doctorId || !date) return [];
    try {
      return apiFetchSlots(session.clinicId, doctorId, date);
    } catch {
      return [];
    }
  }, [doctorId, date, session.clinicId]);

  const submit = () => {
    if (!time) return;
    setBusy(true);
    try {
      const appt = apiBookAppointment(session, { clinicId: session.clinicId, doctorId, date, time, reason: reason || undefined });
      toast('Appointment confirmed');
      nav.replace('confirmation', { confirmationApptNumber: appt.appointmentNumber, appointmentId: appt.id });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Booking failed', 'error');
      setTime(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Header title="Book appointment" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card pad">
          <div className="caption" style={{ marginBottom: 8 }}>Clinic</div>
          <div className="body-strong">{clinic.name}</div>
          <div className="caption" style={{ marginTop: 2 }}>{clinic.address}</div>
        </div>

        <Field label="Doctor">
          <div style={{ display: 'flex', gap: 10 }}>
            {doctors.map((d) => {
              const booked = mine.filter((a) => a.doctorId === d.id && a.status === 'booked').length;
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setDoctorId(d.id);
                    setTime(null);
                  }}
                  className="card"
                  style={{
                    flex: 1,
                    padding: 12,
                    cursor: 'pointer',
                    border: doctorId === d.id ? '2px solid var(--brand)' : '1px solid var(--border-app)',
                    background: doctorId === d.id ? 'var(--brand-soft)' : 'var(--bg-surface)',
                  }}
                >
                  <div className="body-strong" style={{ fontSize: 13.5 }}>{d.name}</div>
                  <div className="caption" style={{ marginTop: 2 }}>{d.specialty}</div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Date">
          <div className="scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
            {days.map((d, i) => (
              <button
                key={d}
                onClick={() => {
                  setDate(d);
                  setTime(null);
                }}
                style={{
                  minWidth: 64,
                  padding: '10px 8px',
                  borderRadius: 14,
                  border: date === d ? '2px solid var(--brand)' : '1px solid var(--border-app)',
                  background: date === d ? 'var(--brand-soft)' : 'var(--bg-surface)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <div className="caption" style={{ color: 'var(--text-3)' }}>{i === 0 ? 'Today' : weekdayShort(d)}</div>
                <div className="body-strong mono-num" style={{ fontSize: 15 }}>{fmtDateShortNum(d)}</div>
                <div className="caption" style={{ fontSize: 10 }}>{fmtMonthShort(d)}</div>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Time slot" hint={slots.every((s) => !s.available) ? 'No open slots this day — try another date.' : undefined}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {slots.map((s) => (
              <button
                key={s.time}
                disabled={!s.available}
                onClick={() => setTime(s.time)}
                style={{
                  padding: '10px 6px',
                  borderRadius: 12,
                  border: time === s.time ? '2px solid var(--brand)' : '1px solid var(--border-app)',
                  background: time === s.time ? 'var(--brand-soft)' : s.available ? 'var(--bg-surface)' : 'var(--bg-inset-app)',
                  color: s.available ? 'var(--text-1)' : 'var(--text-3)',
                  cursor: s.available ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                  fontSize: 13,
                  textDecoration: s.available ? 'none' : 'line-through',
                }}
              >
                {fmtTime12(s.time)}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Reason (optional)">
          <input className="input" placeholder="e.g. fever, follow-up…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <button className="btn primary block" disabled={!time || busy} onClick={submit}>
          <IconCheckCircle size={17} /> Confirm appointment
        </button>
      </div>
    </div>
  );
}

function fmtDateShortNum(iso: string): string {
  return String(new Date(iso).getDate());
}
function fmtMonthShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short' });
}
void fmtDateLong;
