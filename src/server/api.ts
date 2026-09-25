// ============================================================
// API facade — every client call funnels through here.
// In production each function is a Supabase Edge Function / RLS-backed
// query. Here it runs in-process against the authoritative store and
// broadcasts realtime changes on every mutation.
// ============================================================

import type {
  Appointment,
  AppointmentStatus,
  LiveDoctorView,
  LivePatientView,
  LiveStaffView,
  Session,
  DailyStats,
  Doctor,
  Patient,
  Clinic,
  StaffMember,
} from './types';
import { db, persistDb, resetSharedDb } from './db';
import { deleteRowFromSupabase, reseedSupabaseDemo, supabaseEnabled, wipeSupabaseDemo } from './supabaseSync';
import {
  ApiError,
  bookAppointment,
  callNext,
  cancelAppointment,
  checkInAppointment,
  completeConsultation,
  createWalkIn,
  getDailyStats,
  getLiveDoctorView,
  getLivePatientView,
  getLiveStaffView,
  getPatientAppointments,
  getPatientHistory,
  getSlots,
  listNotifications,
  markNoShow,
  markNotificationsRead,
  moveEntry,
  rescheduleAppointment,
  setQueuePaused,
  startConsultation,
  togglePriority,
  updatePatientProfile,
  getConsultationLog,
  addDoctor,
  updateDoctor,
  removeDoctor,
  setDoctorStatus,
  updateClinicSettings,
  setTokenStart,
  getTokenInfo,
  checkAdminPin,
  setAdminPin,
  isAdminPinDefault,
} from './engine';
import { isoDate } from './time';
import { realtime } from './realtime';
import { getDoctor, getPatient, getStaff } from './engine';

export type Unsubscribe = () => void;

// ---------- auth ----------

export interface OtpChallenge {
  challengeId: string;
  phone: string;
  role: 'patient' | 'staff';
  /** Dev/demo only — a real backend never returns the code */
  demoCode: string;
  isNewPatient?: boolean;
}

const challenges = new Map<string, { phone: string; code: string; role: 'patient' | 'staff'; expires: number; attempts: number }>();

export function requestOtp(phoneRaw: string, role: 'patient' | 'staff'): OtpChallenge {
  const phone = normalizePhone(phoneRaw);
  if (phone.length < 10) throw new ApiError('Enter a valid phone number', 'invalid_phone');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const challengeId = `ch_${Math.random().toString(36).slice(2, 10)}`;
  challenges.set(challengeId, { phone, code, role, expires: Date.now() + 5 * 60_000, attempts: 0 });
  return { challengeId, phone, role, demoCode: code };
}

export function verifyOtp(challengeId: string, code: string): Session {
  const ch = challenges.get(challengeId);
  if (!ch) throw new ApiError('Verification expired — request a new code', 'challenge_not_found');
  if (Date.now() > ch.expires) throw new ApiError('Code expired — request a new one', 'challenge_expired');
  ch.attempts += 1;
  if (ch.attempts > 5) throw new ApiError('Too many attempts — request a new code', 'too_many_attempts');
  if (ch.code !== code.trim()) throw new ApiError('Incorrect code', 'bad_code');

  challenges.delete(challengeId);

  if (ch.role === 'staff') {
    const staff = db.staff.find((s) => s.phone === ch.phone);
    if (!staff) throw new ApiError('No staff account for this number', 'not_found');
    return { role: 'staff', clinicId: staff.clinicId, userId: staff.id, name: staff.name, phone: staff.phone };
  }

  // Patient: auto-provision on first login (tenant = demo clinic)
  let patient = db.patients.find((p) => p.phone === ch.phone);
  if (!patient) {
    patient = {
      id: `pat_${ch.phone.slice(-4)}_${Math.random().toString(36).slice(2, 5)}`,
      clinicId: db.clinics[0].id,
      name: 'New Patient',
      phone: ch.phone,
      createdAt: Date.now(),
      notify3Away: true,
      notifyTurn: true,
      notifyDelay: true,
    };
    db.patients.push(patient);
    persistDb();
  }
  return { role: 'patient', clinicId: patient.clinicId, userId: patient.id, name: patient.name, phone: patient.phone };
}

export function staffLogin(phoneRaw: string, clinicId: string): Session {
  const phone = normalizePhone(phoneRaw);
  const staff = db.staff.find((s) => s.phone === phone && s.clinicId === clinicId);
  if (!staff) throw new ApiError('No staff account found for this number', 'not_found');
  return { role: 'staff', clinicId: staff.clinicId, userId: staff.id, name: staff.name, phone: staff.phone };
}

export function doctorLogin(phoneRaw: string): Session {
  const phone = normalizePhone(phoneRaw);
  const doctor = db.doctors.find((d) => (d as unknown as { phone?: string }).phone === phone);
  if (!doctor) throw new ApiError('No doctor account found for this number', 'not_found');
  return { role: 'doctor', clinicId: doctor.clinicId, userId: doctor.id, name: doctor.name, phone };
}

/** Accepts short demo numbers so seeded staff/doctor accounts are easy to try. */
export function staffLoginDemo(phoneRaw: string): Session {
  const p = normalizePhone(phoneRaw);
  const staff = db.staff.find((s) => s.phone.endsWith(p) || p.endsWith(s.phone));
  if (staff) return { role: 'staff', clinicId: staff.clinicId, userId: staff.id, name: staff.name, phone: staff.phone };
  const doc = db.doctors.find((d) => {
    const dp = (d as unknown as { phone?: string }).phone;
    return dp && (dp.endsWith(p) || p.endsWith(dp));
  });
  if (doc) return { role: 'doctor', clinicId: doc.clinicId, userId: doc.id, name: doc.name, phone: p };
  throw new ApiError('No staff or doctor account for this number', 'not_found');
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, '').slice(-10);
}

// ---------- realtime subscription ----------

export function subscribeToQueue(cb: () => void, clinicId: string): Unsubscribe {
  return realtime.subscribe((payload) => {
    const p = payload as { type?: string; clinicId?: string };
    if (p.type === 'db_reset' || (p.type === 'queue_changed' && (!p.clinicId || p.clinicId === clinicId))) {
      cb();
    }
  });
}

// ---------- views ----------

export function fetchPatientLive(session: Session): LivePatientView {
  assertRole(session, 'patient');
  return getLivePatientView(session);
}

export function fetchStaffLive(clinicId: string): LiveStaffView {
  return getLiveStaffView(clinicId);
}

export function fetchDoctorLive(doctorId: string): LiveDoctorView {
  return getLiveDoctorView(doctorId);
}

// ---------- patient actions ----------

export function apiBookAppointment(
  session: Session,
  input: { clinicId: string; doctorId: string; date: string; time: string; reason?: string },
): Appointment {
  assertRole(session, 'patient');
  if (input.clinicId !== session.clinicId) throw new ApiError('Cross-clinic booking denied', 'forbidden');
  return bookAppointment(session, input);
}

export function apiCancelAppointment(session: Session, appointmentId: string): Appointment {
  return cancelAppointment(session, appointmentId);
}

export function apiRescheduleAppointment(session: Session, appointmentId: string, date: string, time: string): Appointment {
  return rescheduleAppointment(session, appointmentId, date, time);
}

export function apiCheckIn(session: Session, appointmentId: string): ReturnType<typeof checkInAppointment> {
  return checkInAppointment(session, appointmentId);
}

export function apiFetchSlots(clinicId: string, doctorId: string, date: string): { time: string; available: boolean }[] {
  return getSlots(clinicId, doctorId, date);
}

export function apiFetchMyAppointments(session: Session): Appointment[] {
  assertRole(session, 'patient');
  return getPatientAppointments(session.userId);
}

export function apiFetchMyHistory(session: Session) {
  assertRole(session, 'patient');
  return getPatientHistory(session.clinicId, session.userId);
}

export function apiFetchMyNotifications(session: Session) {
  assertRole(session, 'patient');
  return listNotifications(session.userId);
}

export function apiMarkNotificationsRead(session: Session): void {
  assertRole(session, 'patient');
  markNotificationsRead(session.userId);
}

export function apiUpdateProfile(
  session: Session,
  patch: { name?: string; yearOfBirth?: number; notify3Away?: boolean; notifyTurn?: boolean; notifyDelay?: boolean },
): Patient {
  return updatePatientProfile(session, patch);
}

export function apiFetchMe(session: Session): Patient | Doctor | StaffMember | null {
  if (session.role === 'patient') {
    const p = db.patients.find((x) => x.id === session.userId);
    return p ?? null;
  }
  if (session.role === 'staff') return db.staff.find((x) => x.id === session.userId) ?? null;
  return db.doctors.find((x) => x.id === session.userId) ?? null;
}

// ---------- staff actions ----------

export function apiCallNext(session: Session, clinicId: string, doctorId?: string) {
  assertRole(session, 'staff');
  return callNext(session, clinicId, doctorId);
}

export function apiStartConsultation(session: Session, entryId: string) {
  if (session.role !== 'staff' && session.role !== 'doctor') throw new ApiError('Not permitted', 'forbidden');
  return startConsultation(session, entryId);
}

export function apiCompleteConsultation(session: Session, entryId: string) {
  if (session.role !== 'staff' && session.role !== 'doctor') throw new ApiError('Not permitted', 'forbidden');
  return completeConsultation(session, entryId);
}

export function apiMarkNoShow(session: Session, entryId: string) {
  assertRole(session, 'staff');
  return markNoShow(session, entryId);
}

export function apiTogglePriority(session: Session, entryId: string) {
  assertRole(session, 'staff');
  return togglePriority(session, entryId);
}

export function apiMoveEntry(session: Session, entryId: string, direction: -1 | 1) {
  assertRole(session, 'staff');
  moveEntry(session, entryId, direction);
}

export function apiSetQueuePaused(session: Session, clinicId: string, doctorId: string, paused: boolean) {
  assertRole(session, 'staff');
  setQueuePaused(session, clinicId, doctorId, paused);
}

export function apiCreateWalkIn(
  session: Session,
  input: { clinicId: string; doctorId: string; name: string; phone: string; yearOfBirth?: number; note?: string; priority?: boolean },
) {
  assertRole(session, 'staff');
  if (input.clinicId !== session.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  return createWalkIn({ ...input, actor: session.name });
}

export function apiCheckInByStaff(session: Session, appointmentId: string) {
  assertRole(session, 'staff');
  return checkInAppointment(session, appointmentId);
}

export function apiSetAppointmentStatus(session: Session, appointmentId: string, status: AppointmentStatus) {
  assertRole(session, 'staff');
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new ApiError('Appointment not found', 'not_found');
  if (appt.clinicId !== session.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  if (status === 'cancelled') return cancelAppointment(session, appointmentId);
  if (status === 'no_show' && appt.status === 'booked') {
    appt.status = 'no_show';
    appt.statusHistory.push({ status: 'no_show', at: Date.now() });
    return appt;
  }
  throw new ApiError('Unsupported status change', 'invalid_state');
}

export function apiFetchClinicAppointments(clinicId: string, date?: string): Appointment[] {
  return db.appointments
    .filter((a) => a.clinicId === clinicId && (!date || a.scheduledDate === date))
    .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));
}

export function apiFetchClinicPatients(clinicId: string): Patient[] {
  return db.patients.filter((p) => p.clinicId === clinicId);
}

// ---------- doctor actions ----------

export function apiDoctorStart(session: Session, entryId: string) {
  assertRole(session, 'doctor');
  return startConsultation(session, entryId);
}

export function apiDoctorFinish(session: Session, entryId: string) {
  assertRole(session, 'doctor');
  return completeConsultation(session, entryId);
}

export function apiDoctorCallNext(session: Session, clinicId: string) {
  assertRole(session, 'doctor');
  return callNext(session, clinicId, session.userId);
}

// ---------- admin (clinic settings, doctor directory, token config) ----------

export function apiAddDoctor(session: Session, input: Parameters<typeof addDoctor>[1]) {
  return addDoctor(session, input);
}

export function apiUpdateDoctor(session: Session, doctorId: string, patch: Parameters<typeof updateDoctor>[2]) {
  return updateDoctor(session, doctorId, patch);
}

export function apiRemoveDoctor(session: Session, doctorId: string): void {
  removeDoctor(session, doctorId);
  void deleteRowFromSupabase('doctors', doctorId).catch((err) =>
    console.warn('[supabase] doctor delete failed:', err),
  );
}

export function apiSetDoctorStatus(session: Session, doctorId: string, status: 'available' | 'in_consultation' | 'on_break' | 'off_duty') {
  return setDoctorStatus(session, doctorId, status);
}

export function apiUpdateClinicSettings(session: Session, patch: Parameters<typeof updateClinicSettings>[1]) {
  return updateClinicSettings(session, patch);
}

export function apiSetTokenStart(session: Session, nextNumber: number): void {
  setTokenStart(session, nextNumber);
}

export function apiGetTokenInfo(clinicId: string) {
  return getTokenInfo(clinicId);
}

export function apiCheckAdminPin(clinicId: string, pin: string): boolean {
  return checkAdminPin(clinicId, pin);
}

export function apiSetAdminPin(session: Session, pin: string): void {
  setAdminPin(session, pin);
}

export function apiIsAdminPinDefault(clinicId: string): boolean {
  return isAdminPinDefault(clinicId);
}

// ---------- analytics ----------

export function apiFetchDailyStats(clinicId: string, date?: string): DailyStats[] {
  return getDailyStats(clinicId, date ?? isoDate());
}

export function apiFetchConsultationLog(clinicId: string, date?: string) {
  return getConsultationLog(clinicId, date ?? isoDate());
}

export function apiFetchDoctors(clinicId: string): Doctor[] {
  return db.doctors.filter((d) => d.clinicId === clinicId);
}

export function apiFetchClinic(clinicId: string): Clinic {
  const c = db.clinics.find((x) => x.id === clinicId);
  if (!c) throw new ApiError('Clinic not found', 'not_found');
  return c;
}

export async function apiResetDemo(): Promise<void> {
  if (supabaseEnabled) {
    // Wipe Postgres and re-seed the demo clinic so every device converges
    // on a fresh queue after reload.
    await wipeSupabaseDemo();
    await reseedSupabaseDemo();
  } else {
    resetSharedDb();
  }
  window.location.reload();
}

// ---------- helpers ----------

function assertRole(session: Session, role: Session['role']): void {
  if (session.role !== role) throw new ApiError(`Requires ${role} role`, 'forbidden');
}

// Re-exports for screens
export { getDoctor, getPatient, getStaff };
