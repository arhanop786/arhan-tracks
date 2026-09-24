import { useNav } from '../state/nav';
import { useSession } from '../state/session';
import { apiFetchMyAppointments } from '../server/api';
import { Confetti } from '../components/Bits';
import { IconCheckCircle, IconChevronRight } from '../components/icons';
import { fmtTime12, fmtDateLong } from '../lib/time';

export function Confirmation() {
  const nav = useNav();
  const session = useSession((s) => s.session)!;
  const params = useNav((s) => s.params);
  const appt = apiFetchMyAppointments(session).find((a) => a.id === params.appointmentId);

  return (
    <div className="screen" style={{ background: 'var(--bg-app)' }}>
      <div
        className="scroll-y anim-in"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <Confetti />
        <div
          className="anim-pop"
          style={{
            width: 84,
            height: 84,
            borderRadius: 28,
            background: 'var(--mint-soft)',
            color: 'var(--teal-700)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <IconCheckCircle size={44} />
        </div>
        <div className="h-display">Appointment confirmed</div>
        <div className="body" style={{ marginTop: 8, maxWidth: 260 }}>
          You’re booked. We’ve saved this to your appointments.
        </div>

        <div className="card pad" style={{ width: '100%', marginTop: 22, textAlign: 'left' }}>
          <div className="caption">Appointment number</div>
          <div className="mono-num" style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, margin: '2px 0 12px' }}>
            {params.confirmationApptNumber ?? appt?.appointmentNumber ?? '—'}
          </div>
          {appt && (
            <>
              <div className="divider" style={{ margin: '2px 0 12px' }} />
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className="caption">When</span>
                <span className="body-strong">{fmtDateLong(appt.scheduledDate)} · {fmtTime12(appt.scheduledTime)}</span>
              </div>
              <div className="row between">
                <span className="caption">Status</span>
                <span className="chip mint">Booked</span>
              </div>
            </>
          )}
          <div className="divider" style={{ margin: '12px 0' }} />
          <div className="caption" style={{ lineHeight: 1.6 }}>
            Your live queue token (like A-014) is assigned when you check in — arrive around your slot time and tap
            <b> Check in</b>.
          </div>
        </div>

        <button className="btn primary block" style={{ marginTop: 18 }} onClick={() => nav.resetTo('patient_home')}>
          Done
        </button>
        <button className="btn ghost block" onClick={() => nav.resetTo('upcoming')}>
          View appointments <IconChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
