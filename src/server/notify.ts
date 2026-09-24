import type { AppNotification, NotificationKind, Patient, QueueEntry } from './types';
import { db } from './db';
import { uid } from './ids';

/**
 * Records a notification exactly once per (queue entry, kind).
 * Deduplication lives here so repeated engine evaluations never re-send.
 */
export function recordNotification(
  entry: QueueEntry,
  patient: Patient,
  kind: NotificationKind,
  title: string,
  body: string,
): void {
  const exists = db.notifications.some((n) => n.queueId === entry.id && n.kind === kind);
  if (exists) return;
  const n: AppNotification = {
    id: uid('ntf'),
    patientId: patient.id,
    queueId: entry.id,
    kind,
    title,
    body,
    createdAt: Date.now(),
  };
  db.notifications.push(n);
}
