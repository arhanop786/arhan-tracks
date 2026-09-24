import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useLiveSync, useTick } from '../state/useLiveSync';
import { useLive } from '../state/live';
import { apiFetchMyAppointments } from '../server/api';
import { Header, StatusChip } from '../components/ui';
import { fmtEta, fmtTime12, fmtDateShort } from '../lib/time';
import { LivePill, QueueProgressBar, TokenDisplay, UpdatedAgo, Confetti } from '../components/Bits';

export function LiveQueue() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const view = useLive((s) => s.patient);
  const lastSync = useLive((s) => s.lastSync);
  const connected = useLive((s) => s.connected);
  useLiveSync('patient');
  useTick(1000);

  const appt = apiFetchMyAppointments(session).find((a) =>
    ['booked', 'checked_in', 'in_progress'].includes(a.status),
  );

  if (!view || !view.yourToken) {
    return (
      <div className="screen">
        <Header title="Live queue" onBack={() => nav.pop()} brand="patient" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="h1">No active token</div>
            <div className="body" style={{ marginTop: 6 }}>
              Check in to an appointment or book a new one to get your live token.
            </div>
            <button className="btn primary" style={{ marginTop: 18 }} onClick={() => nav.replace('book')}>
              Book an appointment
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isTurn = view.status === 'called';
  const inConsult = view.status === 'in_progress';
  const urgent = isTurn || (view.patientsAhead === 0 && view.status === 'waiting');

  const bg = isTurn
    ? 'linear-gradient(160deg, #b3761b, #d99b33)'
    : inConsult
      ? 'linear-gradient(160deg, var(--teal-900), var(--teal-700))'
      : 'var(--bg-surface)';
  const fg = isTurn || inConsult ? '#fff' : 'var(--text-1)';
  const sub = isTurn || inConsult ? 'rgba(255,255,255,0.78)' : 'var(--text-3)';

  return (
    <div className="screen">
      <Header
        title="Live queue"
        onBack={() => nav.pop()}
        brand="patient"
        right={<LivePill connected={connected} />}
      />
      <div className="scroll-y" style={{ flex: 1 }}>
        <div
          className="anim-in"
          style={{
            margin: 16,
            borderRadius: 24,
            padding: '26px 20px 22px',
            background: bg,
            border: isTurn || inConsult ? 'none' : '1px solid var(--border-app)',
            color: fg,
            boxShadow: 'var(--shadow-2)',
            textAlign: 'center',
            position: 'relative',
          }}
          role="status"
          aria-live="polite"
        >
          {isTurn && <Confetti />}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span
              className="chip"
              style={{
                background: isTurn || inConsult ? 'rgba(255,255,255,0.16)' : 'var(--brand-soft)',
                color: isTurn || inConsult ? '#fff' : 'var(--brand)',
                border: 'transparent',
              }}
            >
              <span className="live-dot" style={{ background: isTurn || inConsult ? '#fff' : 'var(--accent)' }} />
              {isTurn ? 'YOUR TURN' : inConsult ? 'IN CONSULTATION' : 'LIVE QUEUE'}
            </span>
          </div>

          {isTurn ? (
            <TokenDisplay token="Your turn" size={40} />
          ) : (
            <>
              <div className="caption" style={{ color: sub, letterSpacing: '0.09em', textTransform: 'uppercase' }}>Now serving</div>
              <TokenDisplay token={view.nowServingToken} size={52} color={fg} />
            </>
          )}

          <div style={{ height: 1, background: isTurn || inConsult ? 'rgba(255,255,255,0.18)' : 'var(--border-app)', margin: '16px 20px' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, textAlign: 'center' }}>
            <div>
              <div className="caption" style={{ color: sub }}>Your token</div>
              <div className="mono-num" style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800 }}>{view.yourToken}</div>
            </div>
            <div>
              <div className="caption" style={{ color: sub }}>{inConsult ? 'Elapsed' : 'Patients ahead'}</div>
              <div className="mono-num" style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800 }}>
                {inConsult ? `${Math.floor((view.currentElapsedSeconds ?? 0) / 60)}m` : view.patientsAhead}
              </div>
            </div>
          </div>

          <div style={{ margin: '14px 8px 12px' }}>
            <QueueProgressBar view={view} />
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 8,
              background: isTurn || inConsult ? 'rgba(255,255,255,0.14)' : 'var(--bg-inset-app)',
              padding: '10px 18px',
              borderRadius: 16,
            }}
          >
            <span className="caption" style={{ color: sub }}>Estimated wait</span>
            <span className="mono-num" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>
              {inConsult ? '—' : fmtEta(view.etaMinutes)}
            </span>
          </div>

          <div className="caption" style={{ marginTop: 10, color: sub }}>
            {view.etaBasis || 'Live estimate'}
          </div>

          {view.queuePaused && (
            <div className="chip amber" style={{ marginTop: 10 }}>⏸ Queue paused — clock stopped</div>
          )}
        </div>

        {/* Appointment / clinic context */}
        <div className="card pad" style={{ margin: '0 16px 12px' }}>
          <div className="row between">
            <div>
              <div className="caption">Appointment</div>
              <div className="body-strong">{appt ? appt.appointmentNumber : 'Walk-in'}</div>
            </div>
            {appt && <StatusChip status={appt.status} />}
          </div>
          {appt && (
            <div className="caption" style={{ marginTop: 4 }}>
              {fmtDateShort(appt.scheduledDate)} · {fmtTime12(appt.scheduledTime)}
            </div>
          )}
        </div>

        {/* Privacy-safe queue strip (tokens only) */}
        <div className="card pad" style={{ margin: '0 16px 16px' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="h2" style={{ fontSize: 14 }}>Queue today</div>
            <UpdatedAgo lastSync={lastSync} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {view.queue.map((q) => {
              const mine = q.tokenNumber === view.yourToken;
              const serving = q.tokenNumber === view.nowServingToken;
              return (
                <span
                  key={q.tokenNumber}
                  className="chip"
                  style={{
                    fontSize: 13,
                    padding: '7px 12px',
                    background: mine ? 'var(--brand)' : serving ? 'var(--amber-soft)' : 'var(--bg-inset-app)',
                    color: mine ? '#fff' : serving ? '#a06a10' : 'var(--text-2)',
                    border: 'transparent',
                    fontWeight: 800,
                  }}
                >
                  {q.tokenNumber}
                  {q.isPriority && ' ★'}
                  {serving && !mine ? ' ▸' : ''}
                </span>
              );
            })}
          </div>
          <div className="caption" style={{ marginTop: 10 }}>
            Tokens only — other patients’ details stay private.
          </div>
        </div>
      </div>
    </div>
  );
}
