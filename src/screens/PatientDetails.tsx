import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useUI } from '../state/ui';
import { apiFetchClinicAppointments, getPatient } from '../server/api';
import { Header, StatusChip } from '../components/ui';
import { IconPhone } from '../components/icons';
import { fmtTime12, fmtDateShort } from '../lib/time';

export function PatientDetails() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const params = useNav((s) => s.params);
  const toast = useUI((s) => s.toast);
  const patient = getPatient(params.patientId ?? '');
  const appts = apiFetchClinicAppointments(session.clinicId).filter((a) => a.patientId === patient.id);

  return (
    <div className="screen">
      <Header title="Patient details" onBack={() => nav.pop()} brand="staff" />
      <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              width: 50, height: 50, borderRadius: 17, background: 'var(--indigo-50)', color: 'var(--indigo-700)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21, fontWeight: 800,
            }}
          >
            {patient.name.slice(0, 1)}
          </div>
          <div style={{ flex: 1 }}>
            <div className="h2">{patient.name}</div>
            <div className="caption" style={{ marginTop: 2 }}>+91 {patient.phone}{patient.yearOfBirth ? ` · b. ${patient.yearOfBirth}` : ''}</div>
          </div>
          <a className="btn sm subtle" href={`tel:${patient.phone}`} onClick={(e) => { e.preventDefault(); toast('Calling is disabled in the demo', 'info'); }}>
            <IconPhone size={14} />
          </a>
        </div>

        {patient.note && (
          <div className="card pad">
            <div className="caption">Note</div>
            <div className="body" style={{ marginTop: 2 }}>{patient.note}</div>
          </div>
        )}

        <div className="h2" style={{ fontSize: 14, marginTop: 4 }}>Appointment history</div>
        {appts.length === 0 ? (
          <div className="card pad caption">No appointments recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {appts.map((a) => (
              <div key={a.id} className="card" style={{ padding: 12 }}>
                <div className="row between">
                  <div>
                    <div className="body-strong" style={{ fontSize: 13.5 }}>{a.reason ?? 'Consultation'}</div>
                    <div className="caption" style={{ marginTop: 2 }}>
                      {fmtDateShort(a.scheduledDate)} · {fmtTime12(a.scheduledTime)} · <span className="mono-num">{a.appointmentNumber}</span>
                    </div>
                  </div>
                  <StatusChip status={a.status} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="caption" style={{ textAlign: 'center', marginTop: 6 }}>
          Visible to {`Arhan Family Clinic`} staff only — scoped to your clinic.
        </div>
      </div>
    </div>
  );
}
