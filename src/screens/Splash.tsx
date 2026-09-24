import { useEffect } from 'react';
import { useNav } from '../state/nav';
import { useSession } from '../state/session';

export function Splash() {
  const nav = useNav();
  const session = useSession((s) => s.session);

  useEffect(() => {
    const t = setTimeout(() => {
      if (session) {
        // restore role home
        if (session.role === 'patient') nav.resetTo('patient_home');
        else if (session.role === 'staff') nav.resetTo('staff_dashboard');
        else nav.resetTo('doctor_dashboard');
      } else {
        nav.resetTo('role_select');
      }
    }, 1250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, var(--teal-900), var(--teal-800) 55%, #0a4a3e)',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(49,196,141,0.25), transparent 65%)',
          top: -80,
          right: -60,
        }}
      />
      <div className="anim-pop" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#31c48d" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17.5 19 7" />
          </svg>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Arhan Tracks
        </div>
        <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.72)' }}>
          Know exactly when it’s your turn
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 46, display: 'flex', gap: 7 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: 99,
              background: 'rgba(255,255,255,0.5)',
              animation: `livePulse 1.2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
