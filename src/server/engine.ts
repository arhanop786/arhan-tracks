import type {
  Appointment,
  Clinic,
  Consultation,
  DailyStats,
  Doctor,
  LiveDoctorView,
  LivePatientView,
  LiveStaffView,
  Patient,
  QueueEntry,
  QueueEvent,
  QueuePatientRow,
  Session,
  StaffMember,
  StaffQueueRow,
} from './types';
import { db, nextTokenSeq, persistDb } from './db';
import { tokenString, uid } from './ids';
import { isoDate, timeToMinutes } from './time';
import { computePositions } from './seed';
import { realtime } from './realtime';
import { recordNotification } from './notify';

const M = 60_000;

export class ApiError extends Error {
  code: string;
  constructor(message: string, code = 'invalid') {
    super(message);
    this.code = code;
  }
}

// ---------- lookups ----------

export function getClinic(clinicId: string): Clinic {
  const c = db.clinics.find((x) => x.id === clinicId);
  if (!c) throw new ApiError('Clinic not found', 'not_found');
  return c;
}

export function getPatient(id: string): Patient {
  const p = db.patients.find((x) => x.id === id);
  if (!p) throw new ApiError('Patient not found', 'not_found');
  return p;
}

export function getDoctor(id: string): Doctor {
  const d = db.doctors.find((x) => x.id === id);
  if (!d) throw new ApiError('Doctor not found', 'not_found');
  return d;
}

export function getStaff(id: string): StaffMember {
  const s = db.staff.find((x) => x.id === id);
  if (!s) throw new ApiError('Staff not found', 'not_found');
  return s;
}

function pushEvent(clinicId: string, actor: string, action: string, detail?: string): void {
  const ev: QueueEvent = { id: uid('ev'), clinicId, at: Date.now(), actor, action, detail };
  db.events.push(ev);
}

function doneConsultations(doctorId: string, limit = 10): Consultation[] {
  return db.consultations
    .filter((c) => c.doctorId === doctorId)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit);
}

export function rollingAverageSeconds(doctorId: string): { seconds: number; samples: number } {
  const cons = doneConsultations(doctorId, 10);
  if (cons.length === 0) return { seconds: 0, samples: 0 };
  const total = cons.reduce((acc, c) => acc + c.durationSeconds, 0);
  return { seconds: total / cons.length, samples: cons.length };
}

// ---------- ETA engine ----------

export interface EtaResult {
  minutes: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  basis: string;
}

/**
 * ETA = patientsAhead × rollingAvg − elapsed time of current consultation.
 * Never negative. Falls back to clinic default when no consultation history.
 * When the doctor runs long, downstream ETAs grow dynamically.
 */
export function computeEta(doctorId: string, patientsAhead: number, paused: boolean, now: number): EtaResult {
  const clinic = getClinic(db.clinics[0].id);
  const { seconds, samples } = rollingAverageSeconds(doctorId);

  let perPatientMin: number;
  let confidence: EtaResult['confidence'];
  let basis: string;

  if (samples === 0) {
    perPatientMin = clinic.defaultConsultMinutes;
    confidence = 'low';
    basis = `clinic default · ${perPatientMin} min/visit`;
  } else if (samples < 3) {
    perPatientMin = seconds / 60;
    confidence = 'medium';
    basis = `based on last ${samples} consultation${samples === 1 ? '' : 's'}`;
  } else {
    perPatientMin = seconds / 60;
    confidence = 'high';
    basis = `based on last ${samples} consultations`;
  }

  let minutes = patientsAhead * perPatientMin;

  const current = db.queue.find((q) => q.doctorId === doctorId && q.status === 'in_progress');
  if (current && current.consultationStartTime) {
    const elapsed = (now - current.consultationStartTime) / M;
    minutes = minutes - elapsed;
    if (elapsed > perPatientMin) {
      const over = elapsed - perPatientMin;
      minutes += over;
      basis += ` · running ~${Math.round(over)} min long`;
    }
  }

  minutes = Math.max(0, minutes);

  if (paused && patientsAhead > 0) {
    basis = `${basis} · queue paused`;
  }

  if (patientsAhead === 0 && !current) {
    return { minutes: null, confidence: 'none', basis: 'No patients waiting' };
  }

  return { minutes, confidence, basis };
}

// ---------- broadcast ----------

let broadcastQueued = false;
export function broadcastQueueChange(clinicId: string): void {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setTimeout(() => {
    broadcastQueued = false;
    persistDb();
    realtime.publish({ type: 'queue_changed', clinicId, at: Date.now() });
  }, 120);
}

// ---------- today scoping ----------

export function todayQueue(clinicId: string): QueueEntry[] {
  const today = isoDate();
  return db.queue.filter((q) => q.clinicId === clinicId && isoDate(q.checkInTime) === today);
}

function activeEntries(clinicId: string, doctorId: string): QueueEntry[] {
  return todayQueue(clinicId).filter(
    (q) => q.doctorId === doctorId && ['waiting', 'called', 'in_progress', 'paused'].includes(q.status),
  );
}

export function isQueuePaused(_clinicId: string, doctorId: string): boolean {
  return getDoctor(doctorId).status === 'on_break';
}

// ---------- patient view ----------

export function getLivePatientView(session: Session): LivePatientView {
  const clinic = getClinic(session.clinicId);
  const now = Date.now();

  // The patient's most recent active queue entry today
  const mine = todayQueue(session.clinicId)
    .filter((q) => q.patientId === session.userId && ['waiting', 'called', 'in_progress', 'paused'].includes(q.status))
    .sort((a, b) => b.checkInTime - a.checkInTime)[0];

  if (!mine) {
    return emptyPatientView(session.clinicId, now);
  }

  const doctorId = mine.doctorId;
  const paused = isQueuePaused(session.clinicId, doctorId);
  const ordered = orderedActive(clinic.id, doctorId);
  const current = ordered.find((q) => q.status === 'in_progress') ?? null;
  const myIndex = ordered.findIndex((q) => q.id === mine.id);
  const patientsAhead = myIndex === -1 ? 0 : myIndex;

  const queue: QueuePatientRow[] = ordered.map((q) => ({
    tokenNumber: q.tokenNumber,
    status: q.status,
    isPriority: q.isPriority,
    kind: q.appointmentId ? 'appointment' : 'walk-in',
  }));

  const eta = computeEta(doctorId, patientsAhead, paused, now);

  return {
    clinicId: session.clinicId,
    doctorId,
    serverTime: now,
    queueOpen: isOpen(clinic, now),
    queuePaused: paused,
    nowServingToken: current ? current.tokenNumber : ordered.find((q) => q.status === 'called')?.tokenNumber ?? null,
    yourToken: mine.tokenNumber,
    position: mine.status === 'in_progress' ? 0 : myIndex + 1,
    patientsAhead,
    currentElapsedSeconds:
      current && current.consultationStartTime ? Math.floor((now - current.consultationStartTime) / 1000) : null,
    etaMinutes: eta.minutes,
    etaConfidence: eta.confidence,
    etaBasis: eta.basis,
    behindScheduleMinutes: behindSchedule(doctorId, now),
    status: mine.status,
    queue,
    myEntryId: mine.id,
  };
}

function emptyPatientView(clinicId: string, now: number): LivePatientView {
  return {
    clinicId,
    doctorId: '',
    serverTime: now,
    queueOpen: true,
    queuePaused: false,
    nowServingToken: null,
    yourToken: null,
    position: null,
    patientsAhead: 0,
    currentElapsedSeconds: null,
    etaMinutes: null,
    etaConfidence: 'none',
    etaBasis: '',
    behindScheduleMinutes: 0,
    status: null,
    queue: [],
    myEntryId: null,
  };
}

/** Active entries ordered: priority first, then by seq (FIFO). */
export function orderedActive(clinicId: string, doctorId: string): QueueEntry[] {
  return activeEntries(clinicId, doctorId).sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return a.seq - b.seq;
  });
}

function isOpen(clinic: Clinic, now: number): boolean {
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= clinic.openMinutes && mins < clinic.closeMinutes;
}

/** How many minutes behind (positive) or ahead (negative) the doctor is vs plan. */
export function behindSchedule(doctorId: string, now: number): number {
  const { seconds, samples } = rollingAverageSeconds(doctorId);
  if (samples === 0) return 0;
  const perPatientMin = seconds / 60;
  const current = db.queue.find((q) => q.doctorId === doctorId && q.status === 'in_progress');
  if (!current || !current.consultationStartTime) return 0;
  const elapsed = (now - current.consultationStartTime) / M;
  return Math.max(0, Math.round(elapsed - perPatientMin));
}

// ---------- staff view ----------

export function getLiveStaffView(clinicId: string): LiveStaffView {
  const now = Date.now();
  const today = todayQueue(clinicId);

  // Per-doctor ordered active lists, so ETA/positions are per queue
  const perDoctor = new Map<string, QueueEntry[]>();
  for (const q of today) {
    if (['waiting', 'called', 'in_progress', 'paused'].includes(q.status)) {
      const list = perDoctor.get(q.doctorId) ?? [];
      list.push(q);
      perDoctor.set(q.doctorId, list);
    }
  }
  for (const [docId, list] of perDoctor) {
    perDoctor.set(
      docId,
      list.sort((a, b) => {
        if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
        return a.seq - b.seq;
      }),
    );
  }

  const statusRank: Record<string, number> = { in_progress: 0, called: 1, waiting: 2, paused: 2, done: 3, no_show: 4 };
  const rows: StaffQueueRow[] = today
    .map((q) => {
      const patient = db.patients.find((p) => p.id === q.patientId);
      const appt = q.appointmentId ? db.appointments.find((a) => a.id === q.appointmentId) : undefined;
      const ordered = perDoctor.get(q.doctorId) ?? [];
      const idx = ordered.findIndex((o) => o.id === q.id);
      const ahead = idx === -1 ? 0 : idx;
      const eta = computeEta(q.doctorId, ahead, isQueuePaused(clinicId, q.doctorId), now);
      return {
        row: {
          id: q.id,
          tokenNumber: q.tokenNumber,
          patientName: patient ? patient.name : 'Unknown',
          patientId: q.patientId,
          appointmentNumber: appt?.appointmentNumber,
          kind: (q.appointmentId ? 'appointment' : 'walk-in') as StaffQueueRow['kind'],
          status: q.status,
          isPriority: q.isPriority,
          checkedInAt: q.checkInTime,
          waitMinutes: Math.max(0, Math.floor((now - q.checkInTime) / M)),
          etaMinutes: eta.minutes,
          phone: patient ? patient.phone : '',
          doctorId: q.doctorId,
          appointmentId: q.appointmentId,
        } as StaffQueueRow,
        rank: statusRank[q.status] ?? 9,
        seq: q.seq,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.seq - b.seq)
    .map((x) => x.row);

  const firstDoctor = db.doctors.find((d) => perDoctor.has(d.id)) ?? db.doctors[0];
  const ordered = perDoctor.get(firstDoctor.id) ?? [];
  const current = ordered.find((q) => q.status === 'in_progress') ?? null;
  const called = ordered.find((q) => q.status === 'called') ?? null;
  const doctorId = firstDoctor.id;
  const paused = isQueuePaused(clinicId, doctorId);
  const waiting = rows.filter((r) => ['waiting', 'paused'].includes(r.status) && r.doctorId === doctorId).length;
  const seenToday = today.filter((q) => q.status === 'done').length;

  const { seconds, samples } = rollingAverageSeconds(doctorId);
  const avgMin = samples > 0 ? seconds / 60 : getClinic(clinicId).defaultConsultMinutes;

  let estCompletion: number | null = null;
  if (samples > 0 || waiting > 0) {
    const eta = computeEta(doctorId, waiting + (called ? 1 : 0), paused, now);
    estCompletion = eta.minutes !== null ? now + eta.minutes * M : null;
  }

  return {
    clinicId,
    serverTime: now,
    queuePaused: paused,
    rows,
    serving: current
      ? {
          id: current.id,
          tokenNumber: current.tokenNumber,
          patientName: db.patients.find((p) => p.id === current.patientId)?.name ?? 'Unknown',
          startedAt: current.consultationStartTime ?? now,
          elapsedMinutes: Math.floor((now - (current.consultationStartTime ?? now)) / M),
          isPriority: current.isPriority,
        }
      : null,
    called: called
      ? {
          id: called.id,
          tokenNumber: called.tokenNumber,
          patientName: db.patients.find((p) => p.id === called.patientId)?.name ?? 'Unknown',
          calledAt: called.calledAt ?? now,
        }
      : null,
    stats: {
      seenToday,
      waiting,
      remaining: waiting + (current ? 1 : 0) + (called ? 1 : 0),
      avgConsultMinutes: Math.round(avgMin * 10) / 10,
      estCompletionTime: estCompletion,
      delayMinutes: behindSchedule(doctorId, now),
      noShows: today.filter((q) => q.status === 'no_show').length,
      queuePeak: computeQueuePeak(clinicId, doctorId),
    },
    recentEvents: db.events
      .filter((e) => e.clinicId === clinicId)
      .sort((a, b) => b.at - a.at)
      .slice(0, 8),
  };
}

function computeQueuePeak(clinicId: string, doctorId: string): number {
  const today = todayQueue(clinicId).filter((q) => q.doctorId === doctorId);
  return today.length;
}

// ---------- doctor view ----------

export function getLiveDoctorView(doctorId: string): LiveDoctorView {
  const doctor = getDoctor(doctorId);
  const clinic = getClinic(doctor.clinicId);
  const now = Date.now();
  const ordered = orderedActive(clinic.id, doctorId);
  const paused = isQueuePaused(clinic.id, doctorId);

  const current = ordered.find((q) => q.status === 'in_progress') ?? null;
  const waitingList = ordered.filter((q) => q.status === 'waiting' || q.status === 'called' || q.status === 'paused');

  const nameOf = (pid: string) => db.patients.find((p) => p.id === pid)?.name ?? 'Unknown';
  const waitingMinutes = (q: QueueEntry) => Math.max(0, Math.floor((now - q.checkInTime) / M));

  const next = waitingList[0]
    ? {
        id: waitingList[0].id,
        tokenNumber: waitingList[0].tokenNumber,
        patientName: nameOf(waitingList[0].patientId),
        isPriority: waitingList[0].isPriority,
        waitMinutes: waitingMinutes(waitingList[0]),
      }
    : null;

  const upcoming = waitingList.slice(1, 6).map((q) => ({
    id: q.id,
    tokenNumber: q.tokenNumber,
    patientName: nameOf(q.patientId),
    isPriority: q.isPriority,
    waitMinutes: waitingMinutes(q),
  }));

  const { seconds, samples } = rollingAverageSeconds(doctorId);
  const todayCons = db.consultations.filter((c) => c.doctorId === doctorId && isoDate(c.startTime) === isoDate());
  const avgToday =
    todayCons.length > 0 ? todayCons.reduce((s, c) => s + c.durationSeconds, 0) / todayCons.length / 60 : 0;

  // last 7 days trend
  const weekTrend: { date: string; seen: number; avgMinutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = isoDate(now - i * 86_400_000);
    const dayCons = db.consultations.filter((c) => c.doctorId === doctorId && isoDate(c.startTime) === date);
    weekTrend.push({
      date,
      seen: dayCons.length,
      avgMinutes: dayCons.length ? Math.round((dayCons.reduce((s, c) => s + c.durationSeconds, 0) / dayCons.length / 60) * 10) / 10 : 0,
    });
  }

  return {
    clinicId: clinic.id,
    doctorId,
    serverTime: now,
    queuePaused: paused,
    current: current
      ? {
          id: current.id,
          tokenNumber: current.tokenNumber,
          patientName: nameOf(current.patientId),
          elapsedMinutes: Math.floor((now - (current.consultationStartTime ?? now)) / M),
          isPriority: current.isPriority,
        }
      : null,
    next,
    upcoming,
    stats: {
      seenToday: db.queue.filter((q) => q.doctorId === doctorId && q.status === 'done' && isoDate(q.checkInTime) === isoDate()).length,
      avgConsultMinutes: Math.round(avgToday * 10) / 10,
      rollingAvgMinutes: samples > 0 ? Math.round((seconds / 60) * 10) / 10 : clinic.defaultConsultMinutes,
      avgWaitMinutes: Math.round(
        db.queue
          .filter((q) => q.doctorId === doctorId && q.status === 'done' && isoDate(q.checkInTime) === isoDate())
          .reduce((s, q) => s + ((q.consultationStartTime ?? now) - q.checkInTime), 0) /
          Math.max(1, db.queue.filter((q) => q.doctorId === doctorId && q.status === 'done' && isoDate(q.checkInTime) === isoDate()).length) /
          M,
      ),
      delayMinutes: behindSchedule(doctorId, now),
      noShows: db.queue.filter((q) => q.doctorId === doctorId && q.status === 'no_show' && isoDate(q.checkInTime) === isoDate()).length,
    },
    weekTrend,
  };
}

// ---------- mutations (atomic, validated) ----------

export interface WalkInInput {
  clinicId: string;
  doctorId: string;
  name: string;
  phone: string;
  yearOfBirth?: number;
  note?: string;
  priority?: boolean;
  actor: string;
}

export function createWalkIn(input: WalkInInput): QueueEntry {
  const clinic = getClinic(input.clinicId);
  const doctor = getDoctor(input.doctorId);
  if (doctor.clinicId !== input.clinicId) throw new ApiError('Doctor not in this clinic', 'forbidden');

  // Reuse existing patient by phone within this clinic (tenant isolation)
  let patient = db.patients.find((p) => p.clinicId === input.clinicId && p.phone === input.phone);
  if (!patient) {
    patient = {
      id: uid('pat'),
      clinicId: input.clinicId,
      name: input.name.trim(),
      phone: input.phone.trim(),
      yearOfBirth: input.yearOfBirth,
      note: input.note,
      createdAt: Date.now(),
      notify3Away: true,
      notifyTurn: true,
      notifyDelay: true,
    };
    db.patients.push(patient);
  } else if (input.name && input.name.trim() !== patient.name) {
    patient.name = input.name.trim();
  }

  const entry = enqueuePatient({
    clinicId: clinic.id,
    doctorId: doctor.id,
    patientId: patient.id,
    priority: input.priority ?? false,
    actor: input.actor,
    kind: 'walk-in',
  });
  return entry;
}

export interface EnqueueInput {
  clinicId: string;
  doctorId: string;
  patientId: string;
  appointmentId?: string;
  priority?: boolean;
  actor: string;
  kind: 'appointment' | 'walk-in';
}

export function enqueuePatient(input: EnqueueInput): QueueEntry {
  const clinic = getClinic(input.clinicId);
  const today = isoDate();

  // Duplicate guard: same patient+doctor already active today
  const dup = todayQueue(input.clinicId).find(
    (q) => q.patientId === input.patientId && q.doctorId === input.doctorId && ['waiting', 'called', 'in_progress', 'paused'].includes(q.status),
  );
  if (dup) throw new ApiError('Patient already has an active token', 'duplicate');

  const seq = nextTokenSeq(clinic.id);
  const now = Date.now();
  const entry: QueueEntry = {
    id: uid('q'),
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    appointmentId: input.appointmentId,
    patientId: input.patientId,
    tokenNumber: tokenString(clinic.queuePrefix, seq),
    seq,
    queuePosition: null,
    status: 'waiting',
    isPriority: input.priority ?? false,
    checkInTime: now,
    totalPausedMs: 0,
    createdAt: now,
    statusHistory: [{ status: 'waiting', at: now }],
  };
  db.queue.push(entry);
  computePositions(db.queue.filter((q) => isoDate(q.checkInTime) === today));

  pushEvent(clinic.id, input.actor, 'patient_checked_in', `${entry.tokenNumber} checked in`);
  evaluateNotifications(clinic.id, input.doctorId);
  broadcastQueueChange(clinic.id);
  return entry;
}

export function checkInAppointment(session: Session, appointmentId: string): QueueEntry {
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new ApiError('Appointment not found', 'not_found');
  // Tenant + ownership guards
  if (appt.clinicId !== session.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  if (session.role === 'patient' && appt.patientId !== session.userId) {
    throw new ApiError('Not your appointment', 'forbidden');
  }
  if (appt.status !== 'booked') throw new ApiError(`Appointment is ${appt.status.replace('_', ' ')}`, 'invalid_state');

  const now = Date.now();
  appt.status = 'checked_in';
  appt.statusHistory.push({ status: 'checked_in', at: now });
  const entry = enqueuePatient({
    clinicId: appt.clinicId,
    doctorId: appt.doctorId,
    patientId: appt.patientId,
    appointmentId: appt.id,
    actor: session.role === 'patient' ? 'self check-in' : session.name,
    kind: 'appointment',
  });
  return entry;
}

export function callNext(session: Session, clinicId: string, doctorId?: string): QueueEntry | null {
  assertStaff(session, clinicId);
  const doc = doctorId ?? firstBusyDoctor(clinicId);
  if (isQueuePaused(clinicId, doc)) throw new ApiError('Queue is paused — resume it first', 'invalid_state');
  const ordered = orderedActive(clinicId, doc);
  const current = ordered.find((q) => q.status === 'in_progress');
  if (current) throw new ApiError('Finish the current consultation first', 'invalid_state');
  if (ordered.some((q) => q.status === 'called')) throw new ApiError('A patient is already called', 'invalid_state');

  const next = ordered.find((q) => q.status === 'waiting');
  if (!next) return null;

  const now = Date.now();
  next.status = 'called';
  next.calledAt = now;
  next.statusHistory.push({ status: 'called', at: now });
  computePositions(db.queue);
  pushEvent(clinicId, session.name, 'patient_called', `${next.tokenNumber} called`);
  evaluateNotifications(clinicId, next.doctorId);
  broadcastQueueChange(clinicId);
  return next;
}

export function startConsultation(session: Session, entryId: string): QueueEntry {
  const entry = getEntryForActor(session, entryId);
  if (entry.status !== 'called') throw new ApiError('Patient must be called first', 'invalid_state');
  if (isQueuePaused(entry.clinicId, entry.doctorId)) {
    throw new ApiError('Queue is paused — resume it first', 'invalid_state');
  }
  const now = Date.now();
  entry.status = 'in_progress';
  entry.consultationStartTime = now;
  entry.statusHistory.push({ status: 'in_progress', at: now });

  const doctor = getDoctor(entry.doctorId);
  doctor.status = 'in_consultation';

  // Consultation record with start time (duration finalized on complete)
  db.consultations.push({
    id: uid('cons'),
    queueId: entry.id,
    clinicId: entry.clinicId,
    doctorId: entry.doctorId,
    startTime: now,
    endTime: 0,
    durationSeconds: 0,
  });

  if (entry.appointmentId) {
    const appt = db.appointments.find((a) => a.id === entry.appointmentId);
    if (appt) {
      appt.status = 'in_progress';
      appt.statusHistory.push({ status: 'in_progress', at: now });
    }
  }

  pushEvent(entry.clinicId, session.name, 'consultation_started', `${entry.tokenNumber} consultation started`);
  evaluateNotifications(entry.clinicId, entry.doctorId);
  broadcastQueueChange(entry.clinicId);
  return entry;
}

export function completeConsultation(session: Session, entryId: string): QueueEntry {
  const entry = getEntryForActor(session, entryId);
  if (entry.status !== 'in_progress') throw new ApiError('No active consultation', 'invalid_state');
  const now = Date.now();
  entry.status = 'done';
  entry.consultationEndTime = now;
  entry.queuePosition = null;
  entry.statusHistory.push({ status: 'done', at: now });

  const doctor = getDoctor(entry.doctorId);
  doctor.status = 'available';

  const cons = [...db.consultations].reverse().find((c) => c.queueId === entry.id && c.endTime === 0);
  if (cons) {
    cons.endTime = now;
    cons.durationSeconds = Math.round((now - cons.startTime) / 1000);
  }

  if (entry.appointmentId) {
    const appt = db.appointments.find((a) => a.id === entry.appointmentId);
    if (appt) {
      appt.status = 'done';
      appt.statusHistory.push({ status: 'done', at: now });
    }
  }

  pushEvent(entry.clinicId, session.name, 'consultation_completed', `${entry.tokenNumber} completed`);
  evaluateNotifications(entry.clinicId, entry.doctorId);
  broadcastQueueChange(entry.clinicId);
  return entry;
}

export function markNoShow(session: Session, entryId: string): QueueEntry {
  const entry = getEntryForActor(session, entryId);
  if (!['waiting', 'called', 'paused'].includes(entry.status)) {
    throw new ApiError('Only waiting patients can be marked no-show', 'invalid_state');
  }
  const now = Date.now();
  entry.status = 'no_show';
  entry.queuePosition = null;
  entry.statusHistory.push({ status: 'no_show', at: now });

  if (entry.appointmentId) {
    const appt = db.appointments.find((a) => a.id === entry.appointmentId);
    if (appt) {
      appt.status = 'no_show';
      appt.statusHistory.push({ status: 'no_show', at: now });
    }
  }

  pushEvent(entry.clinicId, session.name, 'marked_no_show', `${entry.tokenNumber} marked no-show`);
  evaluateNotifications(entry.clinicId, entry.doctorId);
  broadcastQueueChange(entry.clinicId);
  return entry;
}

export function togglePriority(session: Session, entryId: string): QueueEntry {
  const entry = getEntryForActor(session, entryId);
  if (entry.status !== 'waiting') throw new ApiError('Only waiting patients can be prioritized', 'invalid_state');
  entry.isPriority = !entry.isPriority;
  computePositions(db.queue);
  pushEvent(
    entry.clinicId,
    session.name,
    entry.isPriority ? 'priority_marked' : 'priority_cleared',
    `${entry.tokenNumber} ${entry.isPriority ? 'marked priority' : 'priority cleared'}`,
  );
  evaluateNotifications(entry.clinicId, entry.doctorId);
  broadcastQueueChange(entry.clinicId);
  return entry;
}

export function moveEntry(session: Session, entryId: string, direction: -1 | 1): void {
  const entry = getEntryForActor(session, entryId);
  if (!['waiting', 'paused'].includes(entry.status)) {
    throw new ApiError('Only waiting patients can be reordered', 'invalid_state');
  }
  const ordered = orderedActive(entry.clinicId, entry.doctorId).filter((q) => q.status === 'waiting' || q.status === 'paused');
  const idx = ordered.findIndex((q) => q.id === entryId);
  const swapWith = ordered[idx + direction];
  if (!swapWith) throw new ApiError('Cannot move further', 'invalid');

  // Swap seq values (positions derive from priority + seq)
  const tmp = entry.seq;
  entry.seq = swapWith.seq;
  swapWith.seq = tmp;
  computePositions(db.queue);

  pushEvent(entry.clinicId, session.name, 'queue_reordered', `${entry.tokenNumber} moved ${direction === -1 ? 'up' : 'down'}`);
  evaluateNotifications(entry.clinicId, entry.doctorId);
  broadcastQueueChange(entry.clinicId);
}

export function setQueuePaused(session: Session, clinicId: string, doctorId: string, paused: boolean): void {
  assertStaff(session, clinicId);
  const doctor = getDoctor(doctorId);
  if (paused && doctor.status === 'on_break') return;
  if (!paused && doctor.status !== 'on_break') return;

  doctor.status = paused ? 'on_break' : 'available';
  pushEvent(clinicId, session.name, paused ? 'queue_paused' : 'queue_resumed', `${doctor.name}'s queue ${paused ? 'paused' : 'resumed'}`);
  broadcastQueueChange(clinicId);
}

export function cancelAppointment(session: Session, appointmentId: string): Appointment {
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new ApiError('Appointment not found', 'not_found');
  if (appt.clinicId !== session.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  if (session.role === 'patient' && appt.patientId !== session.userId) throw new ApiError('Not your appointment', 'forbidden');
  if (!['booked'].includes(appt.status)) throw new ApiError('Only booked appointments can be cancelled', 'invalid_state');
  appt.status = 'cancelled';
  appt.statusHistory.push({ status: 'cancelled', at: Date.now() });
  pushEvent(appt.clinicId, session.name, 'appointment_cancelled', appt.appointmentNumber);
  broadcastQueueChange(appt.clinicId);
  return appt;
}

export function rescheduleAppointment(session: Session, appointmentId: string, date: string, time: string): Appointment {
  const appt = db.appointments.find((a) => a.id === appointmentId);
  if (!appt) throw new ApiError('Appointment not found', 'not_found');
  if (appt.clinicId !== session.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  if (session.role === 'patient' && appt.patientId !== session.userId) throw new ApiError('Not your appointment', 'forbidden');
  if (appt.status !== 'booked') throw new ApiError('Only booked appointments can be rescheduled', 'invalid_state');
  assertSlotFree(appt.clinicId, appt.doctorId, date, time, appt.id);
  appt.scheduledDate = date;
  appt.scheduledTime = time;
  pushEvent(appt.clinicId, session.name, 'appointment_rescheduled', `${appt.appointmentNumber} → ${date} ${time}`);
  return appt;
}

function assertSlotFree(clinicId: string, doctorId: string, date: string, time: string, ignoreApptId?: string): void {
  const clash = db.appointments.find(
    (a) =>
      a.clinicId === clinicId &&
      a.doctorId === doctorId &&
      a.scheduledDate === date &&
      a.scheduledTime === time &&
      ['booked', 'checked_in', 'in_progress'].includes(a.status) &&
      a.id !== ignoreApptId,
  );
  if (clash) throw new ApiError('That slot was just taken — pick another', 'slot_taken');
}

// ---------- booking ----------

export function getSlots(clinicId: string, doctorId: string, date: string): { time: string; available: boolean }[] {
  const doctor = getDoctor(doctorId);
  const clinic = getClinic(clinicId);
  const startMin = timeToMinutes(doctor.workingHours.start);
  const endMin = timeToMinutes(doctor.workingHours.end);
  const step = clinic.slotIntervalMinutes;
  const taken = new Set(
    db.appointments
      .filter(
        (a) =>
          a.clinicId === clinicId &&
          a.doctorId === doctorId &&
          a.scheduledDate === date &&
          ['booked', 'checked_in', 'in_progress'].includes(a.status),
      )
      .map((a) => a.scheduledTime),
  );

  const now = Date.now();
  const isToday = date === isoDate(now);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  const slots: { time: string; available: boolean }[] = [];
  for (let m = startMin; m < endMin; m += step) {
    const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const past = isToday && m <= nowMin + 15;
    slots.push({ time, available: !taken.has(time) && !past });
  }
  return slots;
}

export function bookAppointment(
  session: Session,
  input: { clinicId: string; doctorId: string; date: string; time: string; reason?: string },
): Appointment {
  if (session.role !== 'patient') throw new ApiError('Only patients can book', 'forbidden');
  assertSlotFree(input.clinicId, input.doctorId, input.date, input.time);

  db.appointmentSeq += 1;
  const now = Date.now();
  const appt: Appointment = {
    id: uid('appt'),
    clinicId: input.clinicId,
    patientId: session.userId,
    doctorId: input.doctorId,
    appointmentNumber: `APPT-${new Date(now).getFullYear()}-${String(db.appointmentSeq).padStart(5, '0')}`,
    scheduledDate: input.date,
    scheduledTime: input.time,
    status: 'booked',
    reason: input.reason,
    bookedAt: now,
    statusHistory: [{ status: 'booked', at: now }],
  };
  db.appointments.push(appt);
  pushEvent(input.clinicId, session.name, 'appointment_booked', `${appt.appointmentNumber} · ${input.date} ${input.time}`);
  return appt;
}

// ---------- guards ----------

function assertStaff(session: Session, clinicId: string): void {
  if (session.role !== 'staff') throw new ApiError('Staff only', 'forbidden');
  const staff = getStaff(session.userId);
  if (staff.clinicId !== clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
}

function getEntryForActor(session: Session, entryId: string): QueueEntry {
  const entry = db.queue.find((q) => q.id === entryId);
  if (!entry) throw new ApiError('Queue entry not found', 'not_found');
  if (session.role === 'patient') {
    if (entry.patientId !== session.userId) throw new ApiError('Not your queue entry', 'forbidden');
    throw new ApiError('Patients cannot modify the queue', 'forbidden');
  }
  if (session.role === 'staff') {
    const staff = getStaff(session.userId);
    if (staff.clinicId !== entry.clinicId) throw new ApiError('Cross-clinic access denied', 'forbidden');
  }
  if (session.role === 'doctor') {
    if (session.userId !== entry.doctorId) throw new ApiError('Not your patient', 'forbidden');
  }
  return entry;
}

function firstBusyDoctor(clinicId: string): string {
  const today = todayQueue(clinicId);
  const docIds = [...new Set(today.filter((q) => ['waiting', 'called', 'in_progress', 'paused'].includes(q.status)).map((q) => q.doctorId))];
  if (docIds.length > 0) return docIds[0];
  return db.doctors.find((d) => d.clinicId === clinicId)!.id;
}

// ---------- daily stats ----------

export function getDailyStats(clinicId: string, date = isoDate()): DailyStats[] {
  const today = todayQueue(clinicId);
  const doctorIds = [...new Set(db.doctors.filter((d) => d.clinicId === clinicId).map((d) => d.id))];
  const out: DailyStats[] = [];
  const now = Date.now();

  for (const doctorId of doctorIds) {
    const qToday = today.filter((q) => q.doctorId === doctorId);
    const done = qToday.filter((q) => q.status === 'done');
    const noShows = qToday.filter((q) => q.status === 'no_show').length;
    // True rolling window — same basis as the ETA engine (last 10 completed,
    // regardless of date) so the summary matches what patients are quoted.
    const rollingAvg = rollingAverageSeconds(doctorId).seconds;
    // Clamp guards against seed drift; real transitions always have start ≥ check-in.
    const waits = done.map((q) => Math.max(0, (q.consultationStartTime ?? now) - q.checkInTime));
    const avgWait = waits.length ? waits.reduce((s, w) => s + w, 0) / waits.length : 0;
    const waiting = qToday.filter((q) => ['waiting', 'called', 'paused'].includes(q.status)).length;
    const { minutes } = computeEta(doctorId, waiting, isQueuePaused(clinicId, doctorId), now);
    const peak = computeQueuePeak(clinicId, doctorId);

    out.push({
      date,
      clinicId,
      doctorId,
      patientsSeen: done.length,
      noShows,
      rollingAvgSeconds: Math.round(rollingAvg),
      avgWaitSeconds: Math.round(avgWait / 1000),
      totalDelayMinutes: behindSchedule(doctorId, now),
      queuePeak: peak,
      estimatedEndTime: minutes !== null ? now + minutes * M : now,
    });
  }
  return out;
}

export function getConsultationLog(clinicId: string, date = isoDate()): { token: string; doctor: string; durationMin: number; startedAt: number; endedAt: number }[] {
  return db.consultations
    .filter((c) => c.clinicId === clinicId && isoDate(c.startTime) === date && c.endTime > 0)
    .sort((a, b) => b.startTime - a.startTime)
    .map((c) => {
      const entry = db.queue.find((q) => q.id === c.queueId);
      return {
        token: entry?.tokenNumber ?? '—',
        doctor: db.doctors.find((d) => d.id === c.doctorId)?.name ?? '—',
        durationMin: Math.round((c.durationSeconds / 60) * 10) / 10,
        startedAt: c.startTime,
        endedAt: c.endTime,
      };
    });
}

// ---------- notifications ----------

/**
 * Fire once per queue entry per kind. Stored in db.notifications so repeated
 * evaluations never re-send the same event.
 */
function evaluateNotifications(clinicId: string, doctorId: string): void {
  const ordered = orderedActive(clinicId, doctorId);

  ordered.forEach((entry, idx) => {
    const patient = db.patients.find((p) => p.id === entry.patientId);
    if (!patient) return;

    // Your turn — fires exactly when the entry is called
    if (entry.status === 'called' && patient.notifyTurn) {
      recordNotification(entry, patient, 'your_turn', 'It’s your turn', `Token ${entry.tokenNumber} — please proceed to the consultation area.`);
      return;
    }

    if (entry.status !== 'waiting') return;

    // patientsAhead = active entries before me, excluding the one in consultation
    const inProgressBefore = ordered
      .slice(0, idx)
      .some((q) => q.status === 'in_progress');
    const ahead = idx - (inProgressBefore ? 1 : 0);

    if (ahead === 2 && patient.notify3Away) {
      recordNotification(entry, patient, 'three_away', 'Get ready — you’re almost up', `Token ${entry.tokenNumber} is 3 away. Please stay nearby.`);
    }
  });
}

export function listNotifications(patientId: string) {
  return db.notifications
    .filter((n) => n.patientId === patientId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
}

export function markNotificationsRead(patientId: string): void {
  for (const n of db.notifications) {
    if (n.patientId === patientId && !n.readAt) n.readAt = Date.now();
  }
  persistDb();
}

// ---------- history ----------

export function getPatientAppointments(patientId: string): Appointment[] {
  return db.appointments
    .filter((a) => a.patientId === patientId)
    .sort((a, b) => (b.scheduledDate + b.scheduledTime).localeCompare(a.scheduledDate + a.scheduledTime));
}

export function getPatientHistory(clinicId: string, patientId: string): QueueEntry[] {
  return db.queue
    .filter((q) => q.clinicId === clinicId && q.patientId === patientId)
    .sort((a, b) => b.checkInTime - a.checkInTime);
}

export function updatePatientProfile(session: Session, patch: { name?: string; yearOfBirth?: number; notify3Away?: boolean; notifyTurn?: boolean; notifyDelay?: boolean }): Patient {
  if (session.role !== 'patient') throw new ApiError('Patient only', 'forbidden');
  const p = getPatient(session.userId);
  if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
  if (patch.yearOfBirth !== undefined) p.yearOfBirth = patch.yearOfBirth;
  if (patch.notify3Away !== undefined) p.notify3Away = patch.notify3Away;
  if (patch.notifyTurn !== undefined) p.notifyTurn = patch.notifyTurn;
  if (patch.notifyDelay !== undefined) p.notifyDelay = patch.notifyDelay;
  persistDb();
  return p;
}
