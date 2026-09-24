import { useNav } from '../state/nav';
import { BrandLogo } from '../components/ui';
import { IconChevronRight, IconStethoscope, IconUser, IconUsers } from '../components/icons';

export function RoleSelect() {
  const nav = useNav();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <div
        style={{
          padding: 'calc(var(--safe-top) + 40px) 20px 26px',
          background: 'linear-gradient(160deg, var(--teal-900), var(--teal-800))',
          color: '#fff',
        }}
      >
        <BrandLogo light size={44} />
        <div style={{ marginTop: 22, fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Good to see you.
        </div>
        <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
          Live clinic queue & wait times — pick how you’re using Arhan Tracks today.
        </div>
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <RoleCard
          icon={<IconUser size={22} />}
          title="I’m a Patient"
          desc="Book appointments and track your live queue token in real time."
          onClick={() => nav.push('patient_login')}
          tint="var(--brand-soft)"
          accent="var(--brand)"
        />
        <RoleCard
          icon={<IconUsers size={22} />}
          title="Clinic Staff"
          desc="Run the front desk — check-ins, walk-ins and the live queue."
          onClick={() => nav.push('staff_login', { as: undefined })}
          tint="var(--indigo-50)"
          accent="var(--indigo-700)"
        />
        <RoleCard
          icon={<IconStethoscope size={22} />}
          title="Doctor"
          desc="Your consultation console — current & next patient, one tap flow."
          onClick={() => nav.push('staff_login', { as: 'doctor' })}
          tint="var(--mint-soft)"
          accent="var(--teal-700)"
        />
        <div className="caption" style={{ textAlign: 'center', marginTop: 6, lineHeight: 1.6 }}>
          Demo tip — patient OTP: any 6 digits shown on screen.
          <br />
          Staff: 9000000001 (reception) · 9000000002 (admin) · Doctor: 8800000001
        </div>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, desc, onClick, tint, accent }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; tint: string; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        textAlign: 'left',
        cursor: 'pointer',
        border: '1px solid var(--border-app)',
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 15,
          background: tint,
          color: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div className="body-strong">{title}</div>
        <div className="caption" style={{ marginTop: 2 }}>{desc}</div>
      </div>
      <IconChevronRight size={18} style={{ color: 'var(--text-3)' }} />
    </button>
  );
}
