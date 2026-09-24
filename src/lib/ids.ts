// Collision-free ids: timestamp-ordered prefix + random suffix.
export function uid(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

/** Deterministic pseudo-random generator for realistic seed data. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format token like A-014 from prefix + seq. */
export function tokenString(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

/** APPT-YYYY-NNNNN */
export function appointmentNumber(seq: number): string {
  return `APPT-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}
