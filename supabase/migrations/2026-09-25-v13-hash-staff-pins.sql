-- ============================================================
-- v13 migration — hash per-staff PINs with salted PBKDF2.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- Format: pbkdf2-sha256$<iters>$<saltHex>$<hashHex> (src/server/pin.ts)
-- ============================================================

-- 1. Demo rows: plaintext → pre-computed salted hashes.
--    (Real hashing needs the secret itself, so these literals are fixed.)
update public.staff set pin = 'pbkdf2-sha256$120000$314d5b1fe5f138288140356ea6fdf123$d5388e8375193a4a243844330c36e465d5b1c0b73b6481cb06d0fc475671cf8f'
  where pin = '1111';
update public.staff set pin = 'pbkdf2-sha256$120000$a51a8a3e94838970d9ee3a7bcab656bb$057df8ea17ef08cf29e6202caee31a28d90d0ecc4c66c5cd2f1c183e084f41d2'
  where pin = '2222';

-- 2. Any other plaintext PIN left behind → clear it. The app treats a
--    null pin as the shipped default (246810) and re-hashes the row the
--    first time that staff member signs in.
update public.staff
  set pin = null
  where pin is not null
    and pin not like 'pbkdf2-sha256$%';

-- 3. v11 leftover: the shared Admin-console PIN is gone (per-staff PINs).
alter table public.clinics drop column if exists admin_pin;
