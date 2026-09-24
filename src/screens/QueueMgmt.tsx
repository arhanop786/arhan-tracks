import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useLiveSync } from '../state/useLiveSync';
import { useLive } from '../state/live';
import { useUI } from '../state/ui';
import { apiFetchDoctors, apiSetQueuePaused, apiTogglePriority, apiMarkNoShow, apiMoveEntry } from '../server/api';
import { Header, EmptyState } from '../components/ui';
import { LivePill } from '../components/Bits';
import { IconChevronDown, IconChevronUp, IconPause, IconPlay, IconStar, IconXCircle } from '../components/icons';
import { hhmm } from '../lib/time';

export function QueueMgmt() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const live = useLive((s) => s.staff);
  const refresh = useLive((s) => s.refreshStaff);
  const connected = useLive((s) => s.connected);
  useLiveSync('staff');
  const doctors = apiFetchDoctors(session.clinicId);

  const run = (fn: () => unknown, ok?: string) => {
    try {
      fn();
      if (ok) toast(ok);
      refresh(session.clinicId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  const waiting = live?.rows.filter((r) => ['waiting', 'called', 'paused'].includes(r.status)) ?? [];

  return (
    <div className="screen">
      <Header title="Queue management" onBack={() => nav.pop()} brand="staff" right={<LivePill connected={connected} />} />
      <div className="scroll-y" style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {doctors.map((d) => {
          const paused = d.status === 'on_break';
          const docRows = waiting.filter((r) => r.doctorId === d.id);
          return (
            <div key={d.id} className="card" style={{ overflow: 'hidden' }}>
              <div className="row between" style={{ padding: '12px 14px', background: paused ? 'var(--amber-soft)' : 'var(--bg-inset-app)' }}>
                <div>
                  <div className="body-strong">{d.name}</div>
                  <div className="caption">
                    {paused ? 'Queue paused — clock stopped' : `${docRows.length} waiting`}
                  </div>
                </div>
                <button
                  className="btn sm"
                  onClick={() => run(() => apiSetQueuePaused(session, session.clinicId, d.id, !paused), paused ? 'Resumed' : 'Paused')}
                >
                  {paused ? <IconPlay size={13} /> : <IconPause size={13} />} {paused ? 'Resume' : 'Pause'}
                </button>
              </div>
              {docRows.length === 0 ? (
                <div className="caption" style={{ padding: 14 }}>No patients waiting.</div>
              ) : (
                docRows.map((r, i) => (
                  <div key={r.id} className="row between" style={{ padding: '10px 14px', borderTop: '1px solid var(--border-app)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="caption mono-num" style={{ width: 16 }}>{i + 1}</span>
                      <span className="mono-num body-strong">{r.tokenNumber}</span>
                      <span className="body" style={{ fontSize: 13 }}>{r.patientName}</span>
                      {r.isPriority && <IconStar size={13} style={{ color: '#a06a10' }} />}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn sm" aria-label="Move up" onClick={() => run(() => apiMoveEntry(session, r.id, -1), 'Moved up')}>
                        <IconChevronUp size={13} />
                      </button>
                      <button className="btn sm" aria-label="Move down" onClick={() => run(() => apiMoveEntry(session, r.id, 1), 'Moved down')}>
                        <IconChevronDown size={13} />
                      </button>
                      <button
                        className="btn sm"
                        aria-label="Toggle priority"
                        onClick={() => run(() => apiTogglePriority(session, r.id), r.isPriority ? 'Priority cleared' : 'Marked priority')}
                      >
                        <IconStar size={13} style={r.isPriority ? { color: '#a06a10' } : undefined} />
                      </button>
                      <button className="btn sm danger" aria-label="No-show" onClick={() => run(() => apiMarkNoShow(session, r.id), 'Marked no-show')}>
                        <IconXCircle size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
        {waiting.length === 0 && doctors.length === 0 && (
          <EmptyState title="No queues configured" />
        )}
        <div className="caption" style={{ textAlign: 'center' }}>
          Checked in {live && live.rows.length ? `· first check-in ${hhmm(Math.min(...live.rows.map((r) => r.checkedInAt)))}` : ''}
        </div>
      </div>
    </div>
  );
}
