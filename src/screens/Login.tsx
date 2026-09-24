import { useRef, useState } from 'react';
import { useNav, currentScreenParams } from '../state/nav';
import { requestOtp, verifyOtp, staffLoginDemo, type OtpChallenge } from '../server/api';
import { useSession } from '../state/session';
import { useUI } from '../state/ui';
import { Header } from '../components/ui';
import { IconLock, IconPhone } from '../components/icons';

export function PatientLogin() {
  const nav = useNav();
  const login = useSession((s) => s.login);
  const toast = useUI((s) => s.toast);
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [err, setErr] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const sendCode = () => {
    setErr('');
    try {
      const ch = requestOtp(phone, 'patient');
      setChallenge(ch);
      toast(`Demo OTP: ${ch.demoCode}`, 'info');
      setTimeout(() => refs.current[0]?.focus(), 60);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send code');
    }
  };

  const confirm = (code?: string) => {
    if (!challenge) return;
    const value = code ?? digits.join('');
    try {
      const session = verifyOtp(challenge.challengeId, value);
      login(session);
      nav.resetTo('patient_home');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed');
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
    }
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setErr('');
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (next.every((x) => x !== '')) confirm(next.join(''));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <Header title="Patient sign in" onBack={() => nav.pop()} brand="patient" />
      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {!challenge ? (
          <>
            <div className="h1" style={{ marginBottom: 6 }}>Welcome back</div>
            <div className="body" style={{ marginBottom: 22 }}>
              Enter your mobile number — we’ll text you a one-time code.
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <span className="label">Mobile number</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="input" style={{ width: 74, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>+91</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="98XXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                  autoFocus
                />
              </div>
            </div>
            {err && <div className="caption text-coral" style={{ marginBottom: 10 }}>{err}</div>}
            <button className="btn primary block" onClick={sendCode} disabled={phone.replace(/\D/g, '').length < 10}>
              <IconPhone size={17} /> Send code
            </button>
            <div className="caption" style={{ marginTop: 16, textAlign: 'center' }}>
              New here? You’ll be registered automatically on first sign-in.
            </div>
          </>
        ) : (
          <>
            <div className="h1" style={{ marginBottom: 6 }}>Enter the code</div>
            <div className="body" style={{ marginBottom: 20 }}>
              Sent to +91 {challenge.phone.slice(0, 5)} {challenge.phone.slice(5)}.{' '}
              <button className="btn ghost sm" onClick={() => setChallenge(null)} style={{ minHeight: 26, padding: '2px 8px' }}>
                Change
              </button>
            </div>
            <div className="otp-row" style={{ marginBottom: 18 }}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  className="otp-box"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  aria-label={`Digit ${i + 1}`}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => e.key === 'Backspace' && !d && i > 0 && refs.current[i - 1]?.focus()}
                />
              ))}
            </div>
            {err && <div className="caption text-coral" style={{ marginBottom: 10, textAlign: 'center' }}>{err}</div>}
            <button className="btn primary block" onClick={() => confirm()} disabled={digits.some((x) => x === '')}>
              <IconLock size={16} /> Verify & continue
            </button>
            <div className="caption" style={{ marginTop: 14, textAlign: 'center' }}>
              Demo code: <b className="text-brand">{challenge.demoCode}</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function StaffLogin() {
  const nav = useNav();
  const params = currentScreenParams();
  const asDoctor = params?.as === 'doctor';
  const login = useSession((s) => s.login);
  const toast = useUI((s) => s.toast);
  const [phone, setPhone] = useState(asDoctor ? '8800000001' : '9000000001');
  const [err, setErr] = useState('');

  const submit = () => {
    setErr('');
    try {
      const session = staffLoginDemo(phone);
      if (asDoctor && session.role !== 'doctor') throw new Error('This number is not a doctor account');
      if (!asDoctor && session.role === 'doctor') throw new Error('This number is not a staff account');
      login(session);
      nav.resetTo(session.role === 'doctor' ? 'doctor_dashboard' : 'staff_dashboard');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <Header title={asDoctor ? 'Doctor sign in' : 'Staff sign in'} onBack={() => nav.pop()} brand={asDoctor ? 'doctor' : 'staff'} />
      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div className="h1" style={{ marginBottom: 6 }}>{asDoctor ? 'Doctor console' : 'Front desk console'}</div>
        <div className="body" style={{ marginBottom: 22 }}>
          {asDoctor
            ? 'Sign in with your registered doctor number.'
            : 'Sign in with your work number issued by the clinic.'}
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <span className="label">Work number</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="9000000001"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoFocus
          />
        </div>
        {err && <div className="caption text-coral" style={{ marginBottom: 10 }}>{err}</div>}
        <button className="btn primary block" onClick={submit} disabled={phone.length < 4}>
          Sign in
        </button>
        <div className="caption" style={{ marginTop: 16, lineHeight: 1.7 }}>
          <b>Demo accounts</b>
          <br />
          Reception — 9000000001
          <br />
          Admin — 9000000002
          <br />
          Doctor — 8800000001
        </div>
      </div>
    </div>
  );
}
