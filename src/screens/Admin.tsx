import { useState } from 'react';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { useUI } from '../state/ui';
import { useLive } from '../state/live';
import { useLiveSync } from '../state/useLiveSync';
import {
  apiAddDoctor,
  apiCheckAdminPin,
  apiFetchClinic,
  apiFetchDoctors,
  apiFetchMe,
  apiGetTokenInfo,
  apiIsAdminPinDefault,
  apiRemoveDoctor,
  apiSetAdminPin,
  apiSetTokenStart,
  apiUpdateClinicSettings,
  apiUpdateDoctor,
} from '../server/api';
import type { Doctor, StaffMember } from '../server/types';
import { Header, Field, Segmented, Sheet } from '../components/ui';
import { IconBuilding, IconClock, IconEdit, IconList, IconLock, IconPlus, IconStethoscope, IconX } from '../components/icons';
import { fmtTime12 } from '../lib/time';

type Tab = 'doctors' | 'clinic' | 'tokens';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Admin console — visible to staff accounts with the admin role. */
export function Admin() {
  const session = useSession((s) => s.session)!;
  const nav = useNav();
  const toast = useUI((s) => s.toast);
  const refresh = useLive((s) => s.refreshStaff);
  useLiveSync('staff');

  const me = apiFetchMe(session) as StaffMember | null;
  const isAdmin = me?.role === 'admin';

  const [tab, setTab] = useState<Tab>('doctors');
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Doctor | null>(null);
  // Per-browser unlock (sessionStorage clears on tab close) — the shared PIN
  // is the real cross-device secret; this just avoids retyping it every visit.
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('arhan_admin_unlocked') === '1');

  const run = (fn: () => unknown, ok: string) => {
    try {
      fn();
      toast(ok);
      refresh(session.clinicId);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed', 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="screen">
        <Header title="Admin" onBack={() => nav.pop()} brand="staff" />
        <div className="scroll-y" style={{ flex: 1, padding: 24 }}>
          <div className="card pad" style={{ textAlign: 'center' }}>
            <div className="body-strong">Admin access only</div>
            <div className="caption" style={{ marginTop: 4 }}>
              Sign in with an admin staff account (e.g. Ravi · 9000000002) to manage doctors, hours, and tokens.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <PinGate
        clinicId={session.clinicId}
        onUnlock={() => {
          sessionStorage.setItem('arhan_admin_unlocked', '1');
          setUnlocked(true);
        }}
        onCancel={() => nav.pop()}
      />
    );
  }

  return (
    <div className="screen">
      <Header title="Admin" subtitle={me.name} onBack={() => nav.pop()} brand="staff" />
      <div className="scroll-y" style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'doctors', label: 'Doctors' },
            { value: 'clinic', label: 'Clinic' },
            { value: 'tokens', label: 'Tokens' },
          ]}
        />

        {tab === 'doctors' && (
          <DoctorsTab
            clinicId={session.clinicId}
            onEdit={(d) => setEditing(d)}
            onRemove={(d) => setConfirmRemove(d)}
            onAdd={() => setEditing('new')}
          />
        )}
        {tab === 'clinic' && <ClinicTab clinicId={session.clinicId} onSave={(patch, ok) => run(() => apiUpdateClinicSettings(session, patch), ok)} />}
        {tab === 'tokens' && (
          <TokensTab
            clinicId={session.clinicId}
            onSave={({ queuePrefix, nextNumber }) => {
              if (queuePrefix && queuePrefix !== apiGetTokenInfo(session.clinicId).prefix) {
                run(() => apiUpdateClinicSettings(session, { queuePrefix }), 'Token settings saved');
              }
              if (nextNumber != null) run(() => apiSetTokenStart(session, nextNumber), 'Token settings saved');
            }}
          />
        )}
      </div>

      <DoctorSheet
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(docId, input, ok) =>
          run(
            () => (docId ? apiUpdateDoctor(session, docId, input) : apiAddDoctor(session, { clinicId: session.clinicId, ...input })),
            ok,
          )
        }
      />

      {confirmRemove && (
        <Sheet open onClose={() => setConfirmRemove(null)} title={`Remove ${confirmRemove.name}?`}>
          <div className="caption" style={{ marginBottom: 14 }}>
            Past history is kept, but the doctor disappears from booking and the queue. Doctors with patients still
            waiting can’t be removed.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn block" onClick={() => setConfirmRemove(null)}>Cancel</button>
            <button
              className="btn danger block"
              onClick={() => {
                run(() => apiRemoveDoctor(session, confirmRemove.id), `${confirmRemove.name} removed`);
                setConfirmRemove(null);
              }}
            >
              Remove
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---------- PIN gate ----------

function PinGate({ clinicId, onUnlock, onCancel }: { clinicId: string; onUnlock: () => void; onCancel: () => void }) {
  const toast = useUI((s) => s.toast);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    try {
      if (apiCheckAdminPin(clinicId, pin)) {
        onUnlock();
      } else {
        setError('Incorrect PIN — try again');
        setPin('');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Check failed';
      setError(msg);
      setPin('');
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Header title="Admin" subtitle="Restricted" onBack={onCancel} brand="staff" />
      <div className="scroll-y" style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: 20, margin: '8px auto 0',
            background: 'var(--brand-soft)', color: 'var(--brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconLock size={28} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="h2">Enter admin PIN</div>
          <div className="caption" style={{ marginTop: 4 }}>
            This device is shared — the PIN protects clinic settings.
          </div>
        </div>
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Admin PIN">
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pin.length >= 4 && !busy) submit();
              }}
              placeholder="••••"
              style={{ textAlign: 'center', fontSize: 22, letterSpacing: 8, fontWeight: 800 }}
            />
          </Field>
          {error && (
            <div className="caption" style={{ color: 'var(--coral-deep)', textAlign: 'center', fontWeight: 700 }} role="alert">
              {error}
            </div>
          )}
          <button className="btn primary block" disabled={pin.length < 4 || busy} onClick={submit}>
            Unlock admin console
          </button>
          <div className="caption" style={{ textAlign: 'center' }}>
            5 wrong attempts lock the console for 5 minutes.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- doctors tab ----------

function DoctorsTab({
  clinicId,
  onEdit,
  onRemove,
  onAdd,
}: {
  clinicId: string;
  onEdit: (d: Doctor) => void;
  onRemove: (d: Doctor) => void;
  onAdd: () => void;
}) {
  const doctors = apiFetchDoctors(clinicId);
  return (
    <>
      {doctors.map((d) => (
        <div key={d.id} className="card pad">
          <div className="row between">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
              <div
                style={{
                  width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                  background: 'var(--brand-soft)', color: 'var(--brand)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <IconStethoscope size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="body-strong">{d.name}</div>
                <div className="caption">{d.specialty || 'General practice'}{d.phone ? ` · ${d.phone}` : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" aria-label={`Edit ${d.name}`} onClick={() => onEdit(d)}>
                <IconEdit size={14} />
              </button>
              <button className="btn sm danger" aria-label={`Remove ${d.name}`} onClick={() => onRemove(d)}>
                <IconX size={14} />
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="chip">
              <IconClock size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              {fmtTime12(d.workingHours.start)} – {fmtTime12(d.workingHours.end)}
            </span>
            <span className="chip">
              {d.workingHours.days.map((x) => DAY_FULL[x]).join(' · ')}
            </span>
          </div>
        </div>
      ))}
      <button className="btn block" onClick={onAdd}>
        <IconPlus size={15} /> Add doctor
      </button>
      {doctors.length === 0 && (
        <div className="card pad caption" style={{ textAlign: 'center' }}>No doctors yet — add the first one below.</div>
      )}
      <SecurityCard />
    </>
  );
}

// ---------- PIN management (Doctors tab, below the directory) ----------

function SecurityCard() {
  const session = useSession((s) => s.session)!;
  const toast = useUI((s) => s.toast);
  const refresh = useLive((s) => s.refreshStaff);
  const isDefault = apiIsAdminPinDefault(session.clinicId);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');

  const valid = /^\d{4,8}$/.test(pin) && pin === confirm;

  if (!open) {
    return (
      <div className="card pad row between">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <IconLock size={18} style={{ color: 'var(--brand)' }} />
          <div>
            <div className="body-strong">Admin PIN</div>
            <div className="caption">
              {isDefault
                ? 'Still the shared default — change it before going live'
                : 'Custom PIN set — protects settings on shared devices'}
            </div>
          </div>
        </div>
        <button className="btn sm" onClick={() => setOpen(true)}>
          {isDefault ? 'Set PIN' : 'Change'}
        </button>
      </div>
    );
  }

  return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <IconLock size={18} style={{ color: 'var(--brand)' }} />
        <div className="body-strong">Change admin PIN</div>
      </div>
      <div className="caption">
        The PIN is shared across all clinic devices and unlocks the Admin console.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="New PIN">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="4–8 digits"
          />
        </Field>
        <Field label="Confirm">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="Repeat"
          />
        </Field>
      </div>
      {pin && confirm && pin !== confirm && (
        <div className="caption" style={{ color: 'var(--coral-deep)' }}>PINs don’t match yet.</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn block" onClick={() => { setOpen(false); setPin(''); setConfirm(''); }}>
          Cancel
        </button>
        <button
          className="btn primary block"
          disabled={!valid}
          onClick={() => {
            try {
              apiSetAdminPin(session, pin);
              toast('Admin PIN updated');
              refresh(session.clinicId);
              setOpen(false);
              setPin('');
              setConfirm('');
            } catch (e) {
              toast(e instanceof Error ? e.message : 'Could not update PIN', 'error');
            }
          }}
        >
          Update PIN
        </button>
      </div>
    </div>
  );
}

// ---------- doctor add/edit sheet ----------

interface DoctorFormInput {
  name: string;
  specialty: string;
  phone: string;
  start: string;
  end: string;
  days: number[];
}

function DoctorSheet({
  editing,
  onClose,
  onSave,
}: {
  editing: Doctor | 'new' | null;
  onClose: () => void;
  onSave: (doctorId: string | null, input: DoctorFormInput, ok: string) => void;
}) {
  const isNew = editing === 'new';
  const d = editing && editing !== 'new' ? editing : null;
  const [form, setForm] = useState<DoctorFormInput>({
    name: '',
    specialty: '',
    phone: '',
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5, 6],
  });
  // Re-seed the form when the sheet opens or the target doctor changes.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!editing && seededFor !== null) {
    setSeededFor(null);
  }
  if (editing && seededFor !== (d?.id ?? 'new')) {
    setSeededFor(d?.id ?? 'new');
    setForm({
      name: d?.name ?? '',
      specialty: d?.specialty ?? '',
      phone: d?.phone ?? '',
      start: d?.workingHours.start ?? '09:00',
      end: d?.workingHours.end ?? '17:00',
      days: d ? [...d.workingHours.days] : [1, 2, 3, 4, 5, 6],
    });
  }
  if (!editing) return null;

  const valid = form.name.trim().length >= 2 && form.start < form.end && form.days.length > 0;

  return (
    <Sheet open onClose={onClose} title={isNew ? 'Add doctor' : 'Edit doctor'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr. Full Name" />
        </Field>
        <Field label="Specialty">
          <input className="input" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="e.g. General Physician" />
        </Field>
        <Field label="Phone (optional)" hint="Lets the doctor sign in to their console">
          <input className="input" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10-digit number" />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Starts">
            <input className="input" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </Field>
          <Field label="Ends">
            <input className="input" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </Field>
        </div>
        <Field label="Working days">
          <div style={{ display: 'flex', gap: 6 }}>
            {DAY_LABELS.map((label, i) => {
              const on = form.days.includes(i);
              return (
                <button
                  key={i}
                  aria-pressed={on}
                  aria-label={DAY_FULL[i]}
                  className="btn sm"
                  style={{
                    flex: 1,
                    minWidth: 34,
                    background: on ? 'var(--brand)' : 'var(--bg-inset-app)',
                    color: on ? '#fff' : 'var(--text-2)',
                    borderColor: 'transparent',
                    fontWeight: 800,
                  }}
                  onClick={() =>
                    setForm({ ...form, days: on ? form.days.filter((x) => x !== i) : [...form.days, i] })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>
        <button
          className="btn primary block"
          disabled={!valid}
          onClick={() => {
            onSave(
              d?.id ?? null,
              form,
              isNew ? `${form.name.trim()} added to the directory` : 'Doctor updated',
            );
            onClose();
          }}
        >
          {isNew ? 'Add doctor' : 'Save changes'}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- clinic tab ----------

function ClinicTab({
  clinicId,
  onSave,
}: {
  clinicId: string;
  onSave: (patch: Parameters<typeof apiUpdateClinicSettings>[1], ok: string) => void;
}) {
  const clinic = apiFetchClinic(clinicId);
  const [form, setForm] = useState({
    name: clinic.name,
    address: clinic.address,
    phone: clinic.phone,
    open: minutesToTime(clinic.openMinutes),
    close: minutesToTime(clinic.closeMinutes),
    slotInterval: String(clinic.slotIntervalMinutes),
    consult: String(clinic.defaultConsultMinutes),
  });

  const valid =
    form.name.trim().length >= 2 &&
    form.open < form.close &&
    Number(form.slotInterval) >= 5 &&
    Number(form.consult) >= 1;

  return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <IconBuilding size={18} style={{ color: 'var(--brand)' }} />
        <div className="body-strong">Clinic profile & hours</div>
      </div>
      <Field label="Clinic name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Address">
        <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Contact phone">
        <input className="input" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+]/g, '') })} />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Opens">
          <input className="input" type="time" value={form.open} onChange={(e) => setForm({ ...form, open: e.target.value })} />
        </Field>
        <Field label="Closes">
          <input className="input" type="time" value={form.close} onChange={(e) => setForm({ ...form, close: e.target.value })} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Slot length (min)" hint="Booking grid interval">
          <input className="input" inputMode="numeric" value={form.slotInterval} onChange={(e) => setForm({ ...form, slotInterval: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Default consult (min)" hint="Used until the doctor has history">
          <input className="input" inputMode="numeric" value={form.consult} onChange={(e) => setForm({ ...form, consult: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <button
        className="btn primary block"
        disabled={!valid}
        onClick={() =>
          onSave(
            {
              name: form.name,
              address: form.address,
              phone: form.phone,
              open: form.open,
              close: form.close,
              slotIntervalMinutes: Number(form.slotInterval),
              defaultConsultMinutes: Number(form.consult),
            },
            'Clinic settings saved',
          )
        }
      >
        Save clinic settings
      </button>
    </div>
  );
}

// ---------- tokens tab ----------

function TokensTab({
  clinicId,
  onSave,
}: {
  clinicId: string;
  onSave: (patch: { queuePrefix?: string; nextNumber?: number }) => void;
}) {
  const info = apiGetTokenInfo(clinicId);
  const [prefix, setPrefix] = useState(info.prefix);
  const [next, setNext] = useState(String(info.nextNumber));
  const prefixChanged = prefix !== info.prefix;
  const nextChanged = Number(next) !== info.nextNumber;

  return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <IconList size={18} style={{ color: 'var(--brand)' }} />
        <div className="body-strong">Token settings</div>
      </div>
      <div className="caption" style={{ lineHeight: 1.6 }}>
        Tokens look like <b>{info.prefix}-014</b>. Issued today: <b>{info.issuedToday}</b>. Changing the prefix affects
        new tokens only — history keeps its original numbers.
      </div>
      <Field label="Token prefix" hint="1–2 letters, e.g. A → A-015">
        <input
          className="input"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))}
          placeholder="A"
        />
      </Field>
      <Field label="Next token number" hint="Must be higher than any token issued today">
        <input
          className="input"
          inputMode="numeric"
          value={next}
          onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </Field>
      <div className="card pad" style={{ background: 'var(--bg-inset-app)', padding: 12 }}>
        <div className="caption">Preview</div>
        <div className="h1 mono-num" style={{ fontSize: 22 }}>
          {prefix || info.prefix}-{String(Number(next) || 0).padStart(3, '0')}
        </div>
      </div>
      <button
        className="btn primary block"
        disabled={!prefixChanged && !nextChanged}
        onClick={() => {
          const patch: { queuePrefix?: string; nextNumber?: number } = {};
          if (prefixChanged) patch.queuePrefix = prefix;
          if (nextChanged) patch.nextNumber = Number(next);
          onSave(patch);
        }}
      >
        Save token settings
      </button>
    </div>
  );
}

// ---------- helpers ----------

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
