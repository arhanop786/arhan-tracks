// ============================================================
// Arhan Tracks — shared domain types
// Single source of truth for queue + ETA engine contracts.
// ============================================================

export type Role = 'patient' | 'staff' | 'doctor';

export interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  /** IANA timezone id */
  timezone: string;
  /** Queue letter prefix (e.g. "A") used for tokens */
  queuePrefix: string;
  /** Fallback consultation duration in minutes when no data exists */
  defaultConsultMinutes: number;
  /** Minute of day the queue opens, e.g. 540 = 09:00 */
  openMinutes: number;
  /** Minute of day the queue closes, e.g. 1140 = 19:00 */
  closeMinutes: number;
  /** Average walk-in interval in minutes, used for slot availability */
  slotIntervalMinutes: number;
  /** Average check-in lead time in minutes before slot */
  checkinLeadMinutes: number;
}

export interface WorkingHours {
  days: number[]; // 0=Sun … 6=Sat
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface Doctor {
  id: string;
  clinicId: string;
  name: string;
  specialty: string;
  workingHours: WorkingHours;
  status: 'available' | 'in_consultation' | 'on_break' | 'off_duty';
  /** Demo/production sign-in identifier (optional on the base type). */
  phone?: string;
}

export type StaffRole = 'receptionist' | 'admin';
export type StaffPermission =
  | 'queue.reorder'
  | 'queue.priority'
  | 'queue.pause'
  | 'queue.no_show'
  | 'patient.register'
  | 'appointments.manage'
  | 'analytics.view'
  | 'doctor.controls';

export interface StaffMember {
  id: string;
  clinicId: string;
  name: string;
  phone: string;
  role: StaffRole;
  permissions: StaffPermission[];
}

export interface Patient {
  id: string;
  clinicId: string;
  name: string;
  phone: string;
  yearOfBirth?: number;
  note?: string;
  createdAt: number;
  /** Patient-side notification preferences */
  notify3Away: boolean;
  notifyTurn: boolean;
  notifyDelay: boolean;
}

export type AppointmentStatus =
  | 'booked'
  | 'checked_in'
  | 'in_progress'
  | 'done'
  | 'no_show'
  | 'cancelled';

export interface Appointment {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  /** Permanent booking reference, e.g. APPT-2026-00421 */
  appointmentNumber: string;
  /** Local ISO date "YYYY-MM-DD" */
  scheduledDate: string;
  /** "HH:MM" 24h local */
  scheduledTime: string;
  status: AppointmentStatus;
  reason?: string;
  /** Epoch ms — timestamped for analytics on every transition */
  bookedAt: number;
  statusHistory: { status: AppointmentStatus; at: number }[];
}

export type QueueStatus = 'waiting' | 'called' | 'in_progress' | 'done' | 'no_show' | 'paused';

export interface QueueEntry {
  id: string;
  clinicId: string;
  doctorId: string;
  appointmentId?: string;
  /** Patient display name — staff only, never shown on public/patient queue rows */
  patientId: string;
  /** Position token, e.g. A-014 */
  tokenNumber: string;
  /** Monotonic sequence within clinic+day */
  seq: number;
  queuePosition: number | null;
  status: QueueStatus;
  isPriority: boolean;
  checkInTime: number;
  calledAt?: number;
  consultationStartTime?: number;
  consultationEndTime?: number;
  pausedAt?: number;
  totalPausedMs: number;
  createdAt: number;
  statusHistory: { status: QueueStatus; at: number }[];
}

export interface Consultation {
  id: string;
  queueId: string;
  clinicId: string;
  doctorId: string;
  startTime: number;
  endTime: number;
  /** end - start in seconds */
  durationSeconds: number;
}

export interface QueueEvent {
  id: string;
  clinicId: string;
  at: number;
  actor: string;
  action: string;
  detail?: string;
}

export interface DailyStats {
  date: string;
  clinicId: string;
  doctorId: string;
  patientsSeen: number;
  noShows: number;
  rollingAvgSeconds: number;
  avgWaitSeconds: number;
  totalDelayMinutes: number;
  queuePeak: number;
  estimatedEndTime: number;
}

// ---------- Realtime snapshot (single authoritative view) ----------

export interface QueuePatientRow {
  tokenNumber: string;
  status: QueueStatus;
  isPriority: boolean;
  /** Short label like "Walk-in" — no names/PII */
  kind: 'appointment' | 'walk-in';
}

export interface LivePatientView {
  clinicId: string;
  doctorId: string;
  serverTime: number;
  queueOpen: boolean;
  queuePaused: boolean;
  nowServingToken: string | null;
  yourToken: string | null;
  position: number | null;
  patientsAhead: number;
  /** Current consultation elapsed seconds, if someone is in consultation */
  currentElapsedSeconds: number | null;
  etaMinutes: number | null;
  etaConfidence: 'none' | 'low' | 'medium' | 'high';
  etaBasis: string;
  behindScheduleMinutes: number;
  status: QueueStatus | null;
  queue: QueuePatientRow[];
  myEntryId: string | null;
}

export interface StaffQueueRow {
  id: string;
  tokenNumber: string;
  patientName: string;
  patientId: string;
  appointmentNumber?: string;
  kind: 'appointment' | 'walk-in';
  status: QueueStatus;
  isPriority: boolean;
  checkedInAt: number;
  waitMinutes: number;
  etaMinutes: number | null;
  phone: string;
  doctorId: string;
  appointmentId?: string;
}

export interface LiveStaffView {
  clinicId: string;
  serverTime: number;
  queuePaused: boolean;
  rows: StaffQueueRow[];
  serving: {
    id: string;
    tokenNumber: string;
    patientName: string;
    startedAt: number;
    elapsedMinutes: number;
    isPriority: boolean;
  } | null;
  called: { id: string; tokenNumber: string; patientName: string; calledAt: number } | null;
  stats: {
    seenToday: number;
    waiting: number;
    remaining: number;
    avgConsultMinutes: number;
    estCompletionTime: number | null;
    delayMinutes: number;
    noShows: number;
    queuePeak: number;
  };
  recentEvents: QueueEvent[];
}

export interface LiveDoctorView {
  clinicId: string;
  doctorId: string;
  serverTime: number;
  queuePaused: boolean;
  current: { id: string; tokenNumber: string; patientName: string; elapsedMinutes: number; isPriority: boolean } | null;
  next: { id: string; tokenNumber: string; patientName: string; isPriority: boolean; waitMinutes: number } | null;
  upcoming: { id: string; tokenNumber: string; patientName: string; isPriority: boolean; waitMinutes: number }[];
  stats: {
    seenToday: number;
    avgConsultMinutes: number;
    rollingAvgMinutes: number;
    avgWaitMinutes: number;
    delayMinutes: number;
    noShows: number;
  };
  weekTrend: { date: string; seen: number; avgMinutes: number }[];
}

export interface SlotInfo {
  time: string;
  available: boolean;
  bookedCount: number;
}

export interface BookingPreview {
  doctorId: string;
  doctorName: string;
  date: string;
  time: string;
  clinicName: string;
  appointmentNumber: string;
}

// ---------- Notifications ----------

export type NotificationKind = 'three_away' | 'your_turn' | 'delay';

export interface AppNotification {
  id: string;
  patientId: string;
  queueId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: number;
  readAt?: number;
}

// ---------- Auth ----------

export interface Session {
  role: Role;
  clinicId: string;
  /** patient id | staff id | doctor id */
  userId: string;
  name: string;
  phone: string;
}

// ---------- API envelope ----------

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
