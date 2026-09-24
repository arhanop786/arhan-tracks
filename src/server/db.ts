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
import { buildDemo } from './seed';

/**
 * The single authoritative in-memory database.
 * In production this is Supabase/Postgres; every mutation here maps 1:1 to a
 * validated server action with row-level-security checks in the API layer.
 */
export interface DB {
  clinics: Clinic[];
  doctors: Doctor[];
  staff: StaffMember[];
  patients: Patient[];
  appointments: Appointment[];
  queue: QueueEntry[];
  consultations: Consultation[];
  events: QueueEvent[];
  notifications: AppNotification[];
  stats: DailyStats[];
  appointmentSeq: number;
  /** Next global token seq per clinic (ensures token uniqueness per day/queue) */
  tokenSeq: Record<string, number>;
}

const demo = buildDemo();

export const db: DB = {
  clinics: [demo.clinic],
  doctors: demo.doctors,
  staff: demo.staff,
  patients: demo.patients,
  appointments: demo.appointments,
  queue: demo.queue,
  consultations: demo.consultations,
  events: demo.events,
  notifications: [],
  stats: demo.stats,
  appointmentSeq: demo.appointmentSeq,
  tokenSeq: { [demo.clinic.id]: demo.queue.length },
};

/** Monotonic token sequence per clinic — guarantees unique tokens. */
export function nextTokenSeq(clinicId: string): number {
  db.tokenSeq[clinicId] = (db.tokenSeq[clinicId] ?? 0) + 1;
  return db.tokenSeq[clinicId];
}

// ----------------------------------------------------------
// Shared demo state — localStorage acts as the single
// authoritative store across tabs (stands in for Supabase).
// Bump SCHEMA_VERSION to force a clean reseed.
// ----------------------------------------------------------

import { isoDate } from './time';

const STORAGE_KEY = 'arhan_db_shared';
const SCHEMA_VERSION = 10;

export function persistDb(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, day: isoDate(), at: Date.now(), data: db }));
  } catch {
    /* quota or private mode — in-memory state still works */
  }
}

/** Load the shared DB written by another tab. Returns true when applied. */
export function hydrateDb(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { v?: number; day?: string; data?: Partial<DB> };
    // Crossed midnight since the shared state was written — reseed for the new day.
    if (parsed.v !== SCHEMA_VERSION || parsed.day !== isoDate() || !parsed.data) return false;
    const d = parsed.data;
    db.clinics = d.clinics ?? db.clinics;
    db.doctors = d.doctors ?? db.doctors;
    db.staff = d.staff ?? db.staff;
    db.patients = d.patients ?? db.patients;
    db.appointments = d.appointments ?? db.appointments;
    db.queue = d.queue ?? db.queue;
    db.consultations = d.consultations ?? db.consultations;
    db.events = d.events ?? db.events;
    db.notifications = d.notifications ?? db.notifications;
    db.stats = d.stats ?? db.stats;
    db.appointmentSeq = d.appointmentSeq ?? db.appointmentSeq;
    db.tokenSeq = d.tokenSeq ?? db.tokenSeq;
    return true;
  } catch {
    return false;
  }
}

/** Clear shared state — next load re-seeds. */
export function resetSharedDb(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// First tab seeds and shares; later tabs hydrate the same state.
if (!hydrateDb()) persistDb();
