import type {
  Appointment,
  Clinic,
  Consultation,
  DailyStats,
  Doctor,
  Patient,
  QueueEntry,
  QueueEvent,
  StaffMember,
} from './types';
import { appointmentNumber, mulberry, tokenString, uid } from './ids';
import { isoDate, minutesToTime, parseDate } from './time';

export const DAY_MS = 86_400_000;

export interface DemoConfig {
  clinic: Clinic;
  doctors: Doctor[];
  staff: StaffMember[];
  patients: Patient[];
  appointments: Appointment[];
  queue: QueueEntry[];
  consultations: Consultation[];
  events: QueueEvent[];
  stats: DailyStats[];
  appointmentSeq: number;
}

const H = 3_600_000;
const M = 60_000;

export function buildDemo(now = Date.now()): DemoConfig {
  const today = isoDate(now);
  // Local-midnight anchor: new Date('YYYY-MM-DD') parses as UTC midnight and
  // would shift every timestamp by the UTC offset (e.g. +5:30 in India).
  const [yy, mm, dd] = today.split('-').map(Number);
  const todayStart = new Date(yy, mm - 1, dd).getTime();
  const rand = mulberry(20260923);

  const clinic: Clinic = {
    id: 'clinic_arhan',
    name: 'Arhan Family Clinic',
    address: '24 Meadowbrook Lane, Indiranagar',
    phone: '+91 98450 11220',
    timezone: 'Asia/Kolkata',
    queuePrefix: 'A',
    defaultConsultMinutes: 10,
    openMinutes: 9 * 60,
    closeMinutes: 19 * 60,
    slotIntervalMinutes: 10,
    checkinLeadMinutes: 15,
    adminPin: '246810',
  };

  const doctors: Doctor[] = [
    {
      id: 'doc_meera',
      clinicId: clinic.id,
      name: 'Dr. Meera Krishnan',
      specialty: 'General Physician',
      workingHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00' },
      status: 'in_consultation',
      phone: '8800000001',
    },
    {
      id: 'doc_arjun',
      clinicId: clinic.id,
      name: 'Dr. Arjun Rao',
      specialty: 'Pediatrician',
      workingHours: { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' },
      status: 'available',
      phone: '8800000002',
    },
  ];

  const staff: StaffMember[] = [
    {
      id: 'staff_priya',
      clinicId: clinic.id,
      name: 'Priya (Reception)',
      phone: '9000000001',
      role: 'receptionist',
      permissions: [
        'patient.register',
        'appointments.manage',
        'queue.no_show',
        'queue.pause',
        'queue.priority',
        'queue.reorder',
      ],
    },
    {
      id: 'staff_admin',
      clinicId: clinic.id,
      name: 'Ravi (Admin)',
      phone: '9000000002',
      role: 'admin',
      permissions: [
        'patient.register',
        'appointments.manage',
        'queue.no_show',
        'queue.pause',
        'queue.priority',
        'queue.reorder',
        'analytics.view',
      ],
    },
  ];

  const patientSeeds: Array<[string, string, number | undefined, boolean]> = [
    ['Rhea Sharma', '9810012345', 1991, true],
    ['Karan Mehta', '9810023456', 1985, true],
    ['Aisha Verma', '9810034567', undefined, false],
    ['Farhan Ali', '9810045678', 1978, true],
    ['Sana Iyer', '9810056789', 2000, true],
    ['Vikram Bose', '9810067890', 1969, false],
    ['Ananya Rao', '9810078901', 1996, true],
    ['Dev Patel', '9810089012', 1988, true],
    ['Meher Nanda', '9810090123', undefined, false],
    ['Rohit Kulkarni', '9810001234', 1975, true],
    ['Nikhil Menon', '9810094001', 1983, true],
    ['Tara Joshi', '9810094002', 1994, false],
    ['Imran Sheikh', '9810094003', 1972, true],
    ['Leela Pillai', '9810094004', 1959, true],
  ];

  const patients: Patient[] = patientSeeds.map(([name, phone, yob, n3], i) => ({
    id: `pat_${phone.slice(-4)}`,
    clinicId: clinic.id,
    name,
    phone,
    yearOfBirth: yob,
    createdAt: todayStart - (30 - i) * DAY_MS,
    notify3Away: n3,
    notifyTurn: true,
    notifyDelay: n3,
  }));

  // ---------------- Appointments ----------------
  let apptSeq = 415;
  const appointments: Appointment[] = [];
  const mkAppt = (
    patientId: string,
    doctorId: string,
    date: string,
    time: string,
    status: Appointment['status'],
    reason: string,
    bookedOffsetDays = 0,
  ): Appointment => {
    apptSeq += 1;
    const bookedAt = todayStart - bookedOffsetDays * DAY_MS + 10 * H;
    const a: Appointment = {
      id: uid('appt'),
      clinicId: clinic.id,
      patientId,
      doctorId,
      appointmentNumber: appointmentNumber(apptSeq),
      scheduledDate: date,
      scheduledTime: time,
      status,
      reason,
      bookedAt,
      statusHistory: [{ status: 'booked', at: bookedAt }],
    };
    if (status !== 'booked') a.statusHistory.push({ status, at: now - 30 * M });
    appointments.push(a);
    return a;
  };

  // Past done appointments (history + analytics)
  for (let i = 0; i < 3; i++) {
    const p = patients[(i * 3) % patients.length];
    mkAppt(
      p.id,
      i % 2 === 0 ? 'doc_meera' : 'doc_arjun',
      isoDate(todayStart - (i + 3) * DAY_MS),
      minutesToTime(9 * 60 + 30 + i * 40),
      'done',
      i === 0 ? 'Fever & body ache' : i === 1 ? 'Child vaccination' : 'Routine check-up',
      i + 4,
    );
  }

  // Today's & upcoming booked appointments
  // Linked to live queue entries below (the 09:40 checked-in visit was seen; the 11:30 visit no-showed).
  const seenAppt = mkAppt('pat_4567', 'doc_meera', today, '09:40', 'done', 'Annual health check', 1); // Aisha
  const noShowAppt = mkAppt('pat_7890', 'doc_meera', today, '11:30', 'no_show', 'Diabetes review', 2); // Vikram
  mkAppt('pat_8901', 'doc_meera', tomorrow(), '11:00', 'booked', 'Back pain consult', 1);
  mkAppt('pat_5678', 'doc_arjun', tomorrow(), '12:30', 'booked', 'Child fever', 1);
  mkAppt('pat_9012', 'doc_meera', isoDate(todayStart + 2 * DAY_MS), '10:20', 'booked', 'Skin rash', 0);
  mkAppt('pat_7890', 'doc_arjun', isoDate(todayStart + 3 * DAY_MS), '16:10', 'booked', 'Growth check', 0);

  // One cancelled for history realism
  const cancelled = mkAppt('pat_8901', 'doc_meera', isoDate(todayStart - 1 * DAY_MS), '15:00', 'cancelled', 'Travel plan', 6);
  void cancelled;

  // ---------------- Historical consultations ----------------
  // 10 previous business days of realistic consultations (~7-16 min each)
  const consultations: Consultation[] = [];
  const histDurations: number[][] = [];
  const doctorsHist = ['doc_meera', 'doc_arjun'];
  for (let d = 10; d >= 1; d--) {
    const date = isoDate(todayStart - d * DAY_MS);
    // skip Sundays in history (local-date parse — see todayStart note)
    if (parseDate(date).getDay() === 0) continue;
    for (let di = 0; di < 2; di++) {
      const docId = doctorsHist[di];
      const durations: number[] = [];
      const n = 8 + Math.floor(rand() * 5);
      for (let c = 0; c < n; c++) {
        const base = di === 0 ? 10 : 8;
        const dur = Math.round(base + (rand() - 0.35) * 7); // ~7–16 min
        const start = todayStart - d * DAY_MS + (9 + di) * H + (c * (dur + 3) + 10) * M;
        const cs = Math.max(4, dur) * 60;
        const end = start + cs * 1000;
        consultations.push({
          id: uid('cons'),
          queueId: `hist_${d}_${di}_${c}`,
          clinicId: clinic.id,
          doctorId: docId,
          startTime: start,
          endTime: end,
          durationSeconds: cs,
        });
        durations.push(cs);
      }
      histDurations.push(durations);
    }
  }
  void histDurations;

  // ---------------- Live queue ----------------
  const queue: QueueEntry[] = [];
  const events: QueueEvent[] = [];
  const pushEvent = (action: string, detail: string, at: number, actor: string = 'system') => {
    events.push({ id: uid('ev'), clinicId: clinic.id, at, actor, action, detail });
  };

  let seq = 0;
  // Demo timeline compression: the whole seeded session is modeled as
  // "minutes ago". If the app is opened shortly after midnight, unscaled
  // offsets would spill into yesterday and split the day's stats. Scale all
  // offsets so the longest chain fits inside the time elapsed today (full
  // size during business hours, compressed in the small hours).
  const timelineMinutes = 130;
  const minutesIntoDay = Math.max(18, Math.floor((now - todayStart) / M) - 6);
  const scale = Math.min(1, minutesIntoDay / timelineMinutes);
  // Every seeded timestamp lands in Postgres bigint columns; a fractional
  // ms (e.g. when the small-hours compression scales a minute offset by
  // 0.185) is rejected by the API as "invalid input syntax for type bigint".
  // Round once at the source so the whole demo timeline is integer-ms.
  const at = (ms: number): number => Math.round(ms);
  const mkEntry = (opts: {
    patientId: string;
    doctorId: string;
    status: QueueEntry['status'];
    appointmentId?: string;
    checkInOffsetMin: number;
    priority?: boolean;
    calledMinAgo?: number;
    startedMinAgo?: number;
    endedMinAgo?: number;
    pausedAtMinAgo?: number;
  }): QueueEntry => {
    seq += 1;
    // Same relative anchor as every other seed timestamp: "N minutes ago"
    // from the wall clock (scaled — see above), so check-ins stay in the
    // past and ordered before their call/start events at any time of day.
    const checkIn = at(now - opts.checkInOffsetMin * scale * M);
    const e: QueueEntry = {
      id: uid('q'),
      clinicId: clinic.id,
      doctorId: opts.doctorId,
      appointmentId: opts.appointmentId,
      patientId: opts.patientId,
      tokenNumber: tokenString(clinic.queuePrefix, seq),
      seq,
      queuePosition: null,
      status: opts.status,
      isPriority: opts.priority ?? false,
      checkInTime: checkIn,
      totalPausedMs: 0,
      createdAt: checkIn,
      statusHistory: [{ status: 'waiting', at: checkIn }],
    };
    if (opts.calledMinAgo !== undefined) {
      e.calledAt = at(now - opts.calledMinAgo * scale * M);
      e.statusHistory.push({ status: 'called', at: e.calledAt });
    }
    if (opts.startedMinAgo !== undefined) {
      e.consultationStartTime = at(now - opts.startedMinAgo * scale * M);
      e.statusHistory.push({ status: 'in_progress', at: e.consultationStartTime });
    }
    if (opts.endedMinAgo !== undefined) {
      e.consultationEndTime = at(now - opts.endedMinAgo * scale * M);
      e.statusHistory.push({ status: 'done', at: e.consultationEndTime });
    }
    if (opts.pausedAtMinAgo !== undefined) {
      e.pausedAt = at(now - opts.pausedAtMinAgo * scale * M);
    }
    return e;
  };

  // Done: 5 completed this morning for Dr Meera
  const doneDurs = [9, 12, 10, 11, 8]; // rolling avg = 10 min
  const donePatients = [patients[1], patients[2], patients[3], patients[4], patients[11]]; // Karan, Aisha, Farhan, Sana, Tara
  doneDurs.forEach((durMin, i) => {
    const p = donePatients[i];
    // Started 79→35 min ago; each waited a realistic 26→50 min before that.
    const startedAgo = (5 - i) * 11 + 24;
    const e = mkEntry({
      patientId: p.id,
      doctorId: 'doc_meera',
      status: 'done',
      appointmentId: i === 1 ? seenAppt.id : undefined, // Aisha checked in with her booked appointment
      checkInOffsetMin: startedAgo + 26 + i * 6,
      startedMinAgo: startedAgo,
      endedMinAgo: startedAgo - durMin,
    });
    e.queuePosition = null;
    queue.push(e);
    consultations.push({
      id: uid('cons'),
      queueId: e.id,
      clinicId: clinic.id,
      doctorId: 'doc_meera',
      startTime: e.consultationStartTime!,
      endTime: e.consultationEndTime!,
      durationSeconds: durMin * 60,
    });
  });
  pushEvent('consultation_completed', 'A-001 completed — 9 min', at(now - 52 * scale * M));

  // No-show
  const nsEntry = mkEntry({
    patientId: patients[5].id,
    doctorId: 'doc_meera',
    status: 'no_show',
    appointmentId: noShowAppt.id, // Vikram's booked 11:30 appointment became the no-show
    checkInOffsetMin: 48,
  });
  queue.push(nsEntry);
  pushEvent('marked_no_show', 'A-006 marked no-show', at(now - 25 * scale * M), 'Priya (Reception)');

  // Current: in consultation
  const cur = mkEntry({
    patientId: patients[6].id,
    doctorId: 'doc_meera',
    status: 'in_progress',
    checkInOffsetMin: 55,
    calledMinAgo: 14,
    startedMinAgo: 13,
  });
  queue.push(cur);
  pushEvent('consultation_started', 'A-007 consultation started', at(now - 13 * scale * M));

  // Called, not yet started
  const called = mkEntry({
    patientId: patients[7].id,
    doctorId: 'doc_meera',
    status: 'called',
    checkInOffsetMin: 60,
    calledMinAgo: 1,
  });
  queue.push(called);
  pushEvent('patient_called', 'A-008 called', at(now - 1 * scale * M), 'Priya (Reception)');

  // Waiting queue (includes priority patient)
  const waitingSeeds: Array<[string, boolean]> = [
    ['pat_2345', false], // Rhea
    ['pat_0123', true], // Meher — priority
    ['pat_4001', false], // Nikhil
  ];
  for (const [pid, prio] of waitingSeeds) {
    const e = mkEntry({
      patientId: pid,
      doctorId: 'doc_meera',
      status: 'waiting',
      checkInOffsetMin: 62 + queue.length,
      priority: prio,
    });
    queue.push(e);
  }
  pushEvent('priority_marked', 'A-010 marked priority', at(now - 6 * scale * M), 'Priya (Reception)');

  // Dr Arjun: 1 done + 1 waiting (second doctor, proves multi-queue isolation)
  const arjDone = mkEntry({ patientId: 'pat_4003', doctorId: 'doc_arjun', status: 'done', checkInOffsetMin: 66, startedMinAgo: 40, endedMinAgo: 31 });
  arjDone.queuePosition = null;
  queue.push(arjDone);
  consultations.push({
    id: uid('cons'),
    queueId: arjDone.id,
    clinicId: clinic.id,
    doctorId: 'doc_arjun',
    startTime: arjDone.consultationStartTime!,
    endTime: arjDone.consultationEndTime!,
    durationSeconds: 9 * 60,
  });
  const arjWait = mkEntry({ patientId: 'pat_4004', doctorId: 'doc_arjun', status: 'waiting', checkInOffsetMin: 50 });
  queue.push(arjWait);

  computePositions(queue);

  const stats = buildStats(clinic.id, today, queue, consultations, now);

  return {
    clinic,
    doctors,
    staff,
    patients,
    appointments,
    queue,
    consultations,
    events,
    stats,
    appointmentSeq: apptSeq,
  };
}

function tomorrow(): string {
  return isoDate(Date.now() + DAY_MS);
}

/** Recompute queuePosition for waiting/called entries per doctor. Priority first, then FIFO by seq. */
export function computePositions(queue: QueueEntry[]): void {
  const byDoctor = new Map<string, QueueEntry[]>();
  for (const e of queue) {
    if (e.status === 'waiting' || e.status === 'called' || e.status === 'paused') {
      const list = byDoctor.get(e.doctorId) ?? [];
      list.push(e);
      byDoctor.set(e.doctorId, list);
    } else {
      e.queuePosition = null;
    }
  }
  for (const [, list] of byDoctor) {
    list.sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      return a.seq - b.seq;
    });
    list.forEach((e, i) => (e.queuePosition = i + 1));
  }
}

export function buildStats(
  clinicId: string,
  date: string,
  queue: QueueEntry[],
  consultations: Consultation[],
  now: number,
): DailyStats[] {
  const docs = [...new Set(queue.map((q) => q.doctorId))];
  const out: DailyStats[] = [];
  for (const docId of docs) {
    const doneToday = queue.filter((q) => q.doctorId === docId && q.status === 'done');
    const noShows = queue.filter((q) => q.doctorId === docId && q.status === 'no_show').length;
    const cons = consultations
      .filter((c) => c.doctorId === docId)
      .sort((a, b) => a.startTime - b.startTime);
    const rolling = cons.slice(-10);
    const avgRoll = rolling.length ? rolling.reduce((s, c) => s + c.durationSeconds, 0) / rolling.length : 0;
    const waits = doneToday.map((q) => Math.max(0, (q.consultationStartTime ?? now) - q.checkInTime));
    const avgWait = waits.length ? waits.reduce((s, w) => s + w, 0) / waits.length : 0;
    const waitingCount = queue.filter(
      (q) => q.doctorId === docId && (q.status === 'waiting' || q.status === 'called'),
    ).length;
    const cur = queue.find((q) => q.doctorId === docId && q.status === 'in_progress');
    const curElapsedMin = cur && cur.consultationStartTime ? (now - cur.consultationStartTime) / M : 0;
    const estEnd =
      avgRoll > 0 ? now + (curElapsedMin > 0 ? Math.max(0, avgRoll / 60 - curElapsedMin) : avgRoll / 60) * M + waitingCount * (avgRoll / 60) * M : 0;
    out.push({
      date,
      clinicId,
      doctorId: docId,
      patientsSeen: doneToday.length,
      noShows,
      rollingAvgSeconds: Math.round(avgRoll),
      avgWaitSeconds: Math.round(avgWait / 1000),
      totalDelayMinutes: 0,
      queuePeak: Math.max(waitingCount + doneToday.length, waitingCount),
      estimatedEndTime: estEnd,
    });
  }
  return out;
}
