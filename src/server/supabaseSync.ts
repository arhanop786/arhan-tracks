// ============================================================
// Supabase sync layer — the production path for the demo's
// localStorage "authoritative store".
//
// Behavior:
//   • No VITE_SUPABASE_* env vars → every function is a no-op and the
//     app runs exactly as before (in-memory + localStorage demo mode).
//   • With env vars configured →
//       pullFromSupabase()  hydrates the in-memory DB from Postgres
//                           (seeding the demo clinic on first run),
//       pushDbToSupabase()  upserts the in-memory DB after mutations
//                           (debounced by db.persistDb),
//       subscribeRemote()   re-hydrates on other devices' changes.
//   • Writes use the anon key in demo mode; the RLS policies in
//     supabase/schema.sql scope everything to the demo clinic and
//     forbid deletes except the demo reset.
//   • All epoch timestamps are milliseconds everywhere (app, mappers,
//     and bigint columns alike) — no unit conversions, ever.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Appointment,
  AppNotification,
  Clinic,
  Consultation,
  DailyStats,
  Doctor,
  Patient,
  QueueEntry,
  QueueEvent,
  StaffMember,
} from './types';
import type { DB } from './db';
import { buildDemo } from './seed';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

/** Supabase sync is enabled only when both env vars are present. */
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : v == null ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

// ---------- row <-> domain mappers ----------
// Row keys are snake_case Postgres columns; domain types are camelCase.

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow<T>(row: any): T {
  const out: any = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    const camel = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camel] = v;
  }
  return out as T;
}

function toClinic(r: any): Clinic {
  return {
    id: r.id,
    name: r.name,
    address: r.address ?? '',
    phone: r.phone ?? '',
    timezone: r.timezone ?? 'Asia/Kolkata',
    queuePrefix: r.queue_prefix ?? 'A',
    defaultConsultMinutes: num(r.default_consult_minutes) || 12,
    openMinutes: num(r.open_minutes) || 540,
    closeMinutes: num(r.close_minutes) || 1140,
    slotIntervalMinutes: num(r.slot_interval_minutes) || 10,
    checkinLeadMinutes: num(r.checkin_lead_minutes) || 15,
  };
}

function toDoctor(r: any): Doctor {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    specialty: r.specialty ?? '',
    workingHours: r.working_hours ?? { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' },
    status: r.status ?? 'available',
    phone: r.phone ?? undefined,
  };
}

function toStaff(r: any): StaffMember {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    phone: r.phone,
    role: r.role ?? 'receptionist',
    permissions: r.permissions ?? [],
  };
}

function toPatient(r: any): Patient {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    name: r.name,
    phone: r.phone,
    yearOfBirth: r.year_of_birth ?? undefined,
    note: r.note ?? undefined,
    createdAt: num(r.created_at),
    notify3Away: r.notify_3_away ?? true,
    notifyTurn: r.notify_turn ?? true,
    notifyDelay: r.notify_delay ?? true,
  };
}

function toAppointment(r: any): Appointment {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    doctorId: r.doctor_id,
    appointmentNumber: r.appointment_number,
    scheduledDate: typeof r.scheduled_date === 'string' ? r.scheduled_date.slice(0, 10) : String(r.scheduled_date),
    scheduledTime: r.scheduled_time,
    status: r.status ?? 'booked',
    reason: r.reason ?? undefined,
    bookedAt: num(r.booked_at),
    statusHistory: r.status_history ?? [],
  };
}

function toQueueEntry(r: any): QueueEntry {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    doctorId: r.doctor_id,
    appointmentId: r.appointment_id ?? undefined,
    patientId: r.patient_id,
    tokenNumber: r.token_number,
    seq: num(r.seq),
    queuePosition: r.queue_position == null ? null : num(r.queue_position),
    status: r.status ?? 'waiting',
    isPriority: r.is_priority ?? false,
    checkInTime: num(r.checkin_time),
    calledAt: optNum(r.called_at),
    consultationStartTime: optNum(r.consultation_start_time),
    consultationEndTime: optNum(r.consultation_end_time),
    pausedAt: optNum(r.paused_at),
    totalPausedMs: num(r.total_paused_ms),
    createdAt: num(r.created_at),
    statusHistory: r.status_history ?? [],
  };
}

function toConsultation(r: any): Consultation {
  return {
    id: r.id,
    queueId: r.queue_id,
    clinicId: r.clinic_id,
    doctorId: r.doctor_id,
    startTime: num(r.start_time),
    endTime: optNum(r.end_time) ?? 0,
    durationSeconds: num(r.duration_seconds),
  };
}

function toEvent(r: any): QueueEvent {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    at: num(r.at),
    actor: r.actor,
    action: r.action,
    detail: r.detail ?? undefined,
  };
}

function toNotification(r: any): AppNotification {
  return {
    id: r.id,
    patientId: r.patient_id,
    queueId: r.queue_id,
    kind: r.kind,
    title: r.title,
    body: r.body ?? '',
    createdAt: num(r.created_at),
    readAt: optNum(r.read_at),
  };
}

function toStats(r: any): DailyStats {
  return {
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : String(r.date),
    clinicId: r.clinic_id,
    doctorId: r.doctor_id,
    patientsSeen: num(r.patients_seen),
    noShows: num(r.no_shows),
    rollingAvgSeconds: num(r.rolling_avg_seconds),
    avgWaitSeconds: num(r.avg_wait_seconds),
    totalDelayMinutes: num(r.total_delay_minutes),
    queuePeak: num(r.queue_peak),
    estimatedEndTime: num(r.estimated_end_time),
  };
}

// ---------- pull: Postgres → in-memory DB ----------

/**
 * Hydrate the in-memory DB from Postgres. Seeds the demo clinic when the
 * database is empty (multi-device safe: upserts make concurrent seeds
 * converge; the losing device re-pulls the winner's rows).
 * Returns true when the DB was refreshed from Postgres.
 */
export async function pullFromSupabase(db: DB): Promise<boolean> {
  if (!supabaseEnabled) return false;
  const s = sb();

  const clinicId = 'clinic_arhan';
  try {
    const { data: existing, error: existErr } = await s
      .from('clinics')
      .select('id')
      .eq('id', clinicId)
      .maybeSingle();
    if (existErr) {
      console.warn('[supabase] pull failed, staying in demo mode:', existErr.message);
      return false;
    }

    // Empty database → seed it from the in-memory demo data. A second
    // device racing us hits the same upserts (idempotent) or pulls ours.
    if (!existing) await pushDbToSupabase(db);

    const [clinics, doctors, staff, patients, appointments, queue, consultations, events, notifications, stats] =
      await Promise.all([
        s.from('clinics').select('*'),
        s.from('doctors').select('*'),
        s.from('staff').select('*'),
        s.from('patients').select('*'),
        s.from('appointments').select('*'),
        s.from('queue_entries').select('*'),
        s.from('consultations').select('*'),
        s.from('queue_events').select('*').order('at', { ascending: false }).limit(200),
        s.from('notifications').select('*'),
        s.from('daily_stats').select('*'),
      ]);

    const results = [clinics, doctors, staff, patients, appointments, queue, consultations, events, notifications, stats];
    const fail = results.find((r) => r.error);
    if (fail?.error) {
      console.warn('[supabase] pull failed, staying in demo mode:', fail.error.message);
      return false;
    }

    db.clinics = (clinics.data ?? []).map(toClinic);
    db.doctors = (doctors.data ?? []).map(toDoctor);
    db.staff = (staff.data ?? []).map(toStaff);
    db.patients = (patients.data ?? []).map(toPatient);
    db.appointments = (appointments.data ?? []).map(toAppointment);
    db.queue = (queue.data ?? []).map(toQueueEntry);
    db.consultations = (consultations.data ?? []).map(toConsultation);
    db.events = (events.data ?? []).map(toEvent).sort((a, b) => b.at - a.at);
    db.notifications = (notifications.data ?? []).map(toNotification);
    db.stats = (stats.data ?? []).map(toStats);

    // Sequences must survive reloads or tokens/appointment numbers collide.
    db.appointmentSeq = db.appointments.reduce(
      (max, a) => Math.max(max, Number(a.appointmentNumber.split('-').pop()) || 0),
      0,
    );
    db.tokenSeq = { [clinicId]: db.queue.reduce((max, q) => Math.max(max, q.seq), 0) };
    return true;
  } catch (err) {
    console.warn('[supabase] pull failed, staying in demo mode:', err);
    return false;
  }
}

// ---------- push: in-memory DB → Postgres ----------

type Row = Record<string, unknown>;

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function upsertAll(s: SupabaseClient, table: string, rows: Row[]): Promise<void> {
  for (const part of chunked(rows, 500)) {
    const { error } = await s.from(table).upsert(part, { ignoreDuplicates: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Upsert the whole in-memory DB. Called (debounced) after every mutation
 * via persistDb(). Demo-scale only (~dozens of rows); Phase B replaces
 * this with per-action writes driven by the engine.
 */
export async function pushDbToSupabase(db: DB): Promise<void> {
  if (!supabaseEnabled) return;
  const s = sb();

  const clinic = db.clinics[0];
  if (!clinic) return;

  await upsertAll(s, 'clinics', [
    {
      id: clinic.id,
      name: clinic.name,
      address: clinic.address,
      phone: clinic.phone,
      timezone: clinic.timezone,
      queue_prefix: clinic.queuePrefix,
      default_consult_minutes: clinic.defaultConsultMinutes,
      open_minutes: clinic.openMinutes,
      close_minutes: clinic.closeMinutes,
      slot_interval_minutes: clinic.slotIntervalMinutes,
      checkin_lead_minutes: clinic.checkinLeadMinutes,
    },
  ]);

  await upsertAll(
    s,
    'doctors',
    db.doctors.map((d) => ({
      id: d.id,
      clinic_id: d.clinicId,
      name: d.name,
      specialty: d.specialty,
      working_hours: d.workingHours,
      status: d.status,
      phone: d.phone ?? null,
    })),
  );

  await upsertAll(
    s,
    'staff',
    db.staff.map((x) => ({
      id: x.id,
      clinic_id: x.clinicId,
      name: x.name,
      phone: x.phone,
      role: x.role,
      permissions: x.permissions,
    })),
  );

  await upsertAll(
    s,
    'patients',
    db.patients.map((p) => ({
      id: p.id,
      clinic_id: p.clinicId,
      name: p.name,
      phone: p.phone,
      year_of_birth: p.yearOfBirth ?? null,
      note: p.note ?? null,
      created_at: p.createdAt,
      notify_3_away: p.notify3Away,
      notify_turn: p.notifyTurn,
      notify_delay: p.notifyDelay,
    })),
  );

  await upsertAll(
    s,
    'appointments',
    db.appointments.map((a) => ({
      id: a.id,
      clinic_id: a.clinicId,
      patient_id: a.patientId,
      doctor_id: a.doctorId,
      appointment_number: a.appointmentNumber,
      scheduled_date: a.scheduledDate,
      scheduled_time: a.scheduledTime,
      status: a.status,
      reason: a.reason ?? null,
      booked_at: a.bookedAt,
      status_history: a.statusHistory,
    })),
  );

  await upsertAll(
    s,
    'queue_entries',
    db.queue.map((q) => ({
      id: q.id,
      clinic_id: q.clinicId,
      doctor_id: q.doctorId,
      appointment_id: q.appointmentId ?? null,
      patient_id: q.patientId,
      token_number: q.tokenNumber,
      seq: q.seq,
      queue_position: q.queuePosition,
      status: q.status,
      is_priority: q.isPriority,
      checkin_time: q.checkInTime,
      called_at: q.calledAt ?? null,
      consultation_start_time: q.consultationStartTime ?? null,
      consultation_end_time: q.consultationEndTime ?? null,
      paused_at: q.pausedAt ?? null,
      total_paused_ms: q.totalPausedMs,
      created_at: q.createdAt,
      status_history: q.statusHistory,
    })),
  );

  await upsertAll(
    s,
    'consultations',
    db.consultations.map((c) => ({
      id: c.id,
      queue_id: c.queueId,
      clinic_id: c.clinicId,
      doctor_id: c.doctorId,
      start_time: c.startTime,
      end_time: c.endTime || null,
      duration_seconds: c.durationSeconds,
    })),
  );

  // Activity feed is capped at 200 rows in pull — mirror that on push.
  await upsertAll(
    s,
    'queue_events',
    db.events.slice(0, 200).map((e) => ({
      id: e.id,
      clinic_id: e.clinicId,
      at: e.at,
      actor: e.actor,
      action: e.action,
      detail: e.detail ?? null,
    })),
  );

  await upsertAll(
    s,
    'notifications',
    db.notifications.map((n) => ({
      id: n.id,
      patient_id: n.patientId,
      queue_id: n.queueId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      created_at: n.createdAt,
      read_at: n.readAt ?? null,
    })),
  );

  await upsertAll(
    s,
    'daily_stats',
    db.stats.map((x) => ({
      date: x.date,
      clinic_id: x.clinicId,
      doctor_id: x.doctorId,
      patients_seen: x.patientsSeen,
      no_shows: x.noShows,
      rolling_avg_seconds: x.rollingAvgSeconds,
      avg_wait_seconds: x.avgWaitSeconds,
      total_delay_minutes: x.totalDelayMinutes,
      queue_peak: x.queuePeak,
      estimated_end_time: x.estimatedEndTime,
    })),
  );
}

// ---------- single-row delete (admin directory edits) ----------

/**
 * Delete one row by id. The push path is upsert-only, so directory removals
 * (doctor offboarding) need an explicit delete or the next pull would
 * resurrect the row. Fire-and-forget: callers don't await this.
 */
export async function deleteRowFromSupabase(table: string, id: string): Promise<void> {
  if (!supabaseEnabled) return;
  const { error } = await sb().from(table).delete().eq('id', id);
  if (error) throw new Error(`${table}: ${error.message}`);
}

// ---------- wipe + reseed: demo reset ----------

/** Empty every table (demo Reset). Order: children before parents. */
export async function wipeSupabaseDemo(): Promise<void> {
  if (!supabaseEnabled) return;
  const s = sb();
  await s.from('notifications').delete().neq('id', '');
  await s.from('consultations').delete().neq('id', '');
  await s.from('queue_entries').delete().neq('id', '');
  await s.from('appointments').delete().neq('id', '');
  await s.from('queue_events').delete().neq('id', '');
  // daily_stats has a composite key (date, clinic_id, doctor_id) — no id column.
  await s.from('daily_stats').delete().neq('clinic_id', '');
  await s.from('patients').delete().neq('id', '');
  await s.from('staff').delete().neq('id', '');
  await s.from('doctors').delete().neq('id', '');
  await s.from('clinics').delete().neq('id', '');
}

/** Seed the (wiped) demo clinic from buildDemo(). */
export async function reseedSupabaseDemo(): Promise<void> {
  if (!supabaseEnabled) return;
  const d = buildDemo();
  const demo: DB = {
    clinics: [d.clinic],
    doctors: d.doctors,
    staff: d.staff,
    patients: d.patients,
    appointments: d.appointments,
    queue: d.queue,
    consultations: d.consultations,
    events: d.events,
    notifications: [],
    stats: d.stats,
    appointmentSeq: d.appointmentSeq,
    tokenSeq: { [d.clinic.id]: d.queue.length },
  };
  await pushDbToSupabase(demo);
}

// ---------- realtime ----------

const REALTIME_TABLES = [
  'queue_entries',
  'appointments',
  'patients',
  'notifications',
  'queue_events',
  'consultations',
  'daily_stats',
] as const;

/**
 * Subscribe to row changes from OTHER devices. On any change we re-pull
 * fresh state (same contract as the demo hub) and invoke the handler so
 * views refetch. Our own pushes also arrive as events — harmless, since
 * a re-pull simply re-reads the state we just wrote. Debounced: burst
 * writes → one refresh.
 */
export function subscribeRemote(cb: (payload: unknown) => void): () => void {
  if (!supabaseEnabled) return () => undefined;
  const s = sb();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPayload: unknown = null;
  const schedule = (payload: unknown) => {
    lastPayload = payload;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      cb(lastPayload);
    }, 300);
  };

  const channels = REALTIME_TABLES.map((table) =>
    s
      .channel(`arhan-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (change) =>
        schedule({ type: 'db_reset', table, change }),
      )
      .subscribe(),
  );

  return () => {
    if (timer) clearTimeout(timer);
    for (const ch of channels) void s.removeChannel(ch);
  };
}
