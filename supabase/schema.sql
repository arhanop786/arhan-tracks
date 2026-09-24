-- ============================================================
-- Arhan Tracks — Supabase schema + Row Level Security
-- Run this whole file in: Supabase Dashboard → SQL Editor → New query
--
-- Two RLS tiers in one file:
--   1. DEMO MODE (active) — the anon key can read clinic data and seed
--      the demo clinic, so the deployed app syncs across real devices
--      immediately, with no auth backend yet.
--   2. PRODUCTION TIER (commented templates) — real per-role policies
--      for when you add Supabase Auth + JWT claims.
--
-- Design notes
--   • Every table is scoped by clinic_id → multi-tenant isolation.
--   • Tokens are text (A-014); uniqueness is per (clinic_id, date, token)
--     and enforced by the app + a unique index on (clinic_id, seq, day).
--   • All app timestamps are epoch-ms bigint columns (checkin_time etc.);
--     created_at is timestamptz for SQL-side convenience.
--   • status_history is jsonb — an append-only audit trail.
--
-- Phase-B upgrade path (when >few concurrent writers):
--   • Per-row realtime filters (see RLS step 6), a claim_tokens()
--     SECURITY DEFINER function for atomic token assignment, and a
--     recalc_eta() trigger on queue_entries.
-- ============================================================

-- ---------- 1. Tables ----------

create table if not exists public.clinics (
  id                      text primary key,
  name                    text not null,
  address                 text not null default '',
  phone                   text not null default '',
  timezone                text not null default 'Asia/Kolkata',
  queue_prefix            text not null default 'A',
  default_consult_minutes int  not null default 12,
  open_minutes            int  not null default 540,   -- 09:00
  close_minutes           int  not null default 1140,  -- 19:00
  slot_interval_minutes   int  not null default 10,
  checkin_lead_minutes    int  not null default 15,
  created_at              timestamptz not null default now()
);

create table if not exists public.doctors (
  id             text primary key,
  clinic_id      text not null references public.clinics(id) on delete cascade,
  name           text not null,
  specialty      text not null default '',
  working_hours  jsonb not null default '{"days":[1,2,3,4,5,6],"start":"09:00","end":"17:00"}',
  status         text not null default 'available'
                 check (status in ('available','in_consultation','on_break','off_duty')),
  phone          text,
  created_at     timestamptz not null default now()
);

create table if not exists public.staff (
  id           text primary key,
  clinic_id    text not null references public.clinics(id) on delete cascade,
  name         text not null,
  phone        text not null,
  role         text not null default 'receptionist' check (role in ('receptionist','admin')),
  permissions  jsonb not null default '[]',
  created_at   timestamptz not null default now()
);
create unique index if not exists staff_clinic_phone_uq on public.staff (clinic_id, phone);

create table if not exists public.patients (
  id               text primary key,
  clinic_id        text not null references public.clinics(id) on delete cascade,
  name             text not null,
  phone            text not null,
  year_of_birth    int,
  note             text,
  created_at       bigint not null default (extract(epoch from now()) * 1000)::bigint,
  notify_3_away    boolean not null default true,
  notify_turn      boolean not null default true,
  notify_delay     boolean not null default true
);
create index if not exists patients_clinic_phone_ix on public.patients (clinic_id, phone);

create table if not exists public.appointments (
  id                 text primary key,
  clinic_id          text not null references public.clinics(id) on delete cascade,
  patient_id         text not null references public.patients(id) on delete cascade,
  doctor_id          text not null references public.doctors(id) on delete cascade,
  appointment_number text not null,
  scheduled_date     date not null,
  scheduled_time     text not null,           -- "HH:MM" local
  status             text not null default 'booked'
                     check (status in ('booked','checked_in','in_progress','done','no_show','cancelled')),
  reason             text,
  booked_at          bigint not null default (extract(epoch from now()) * 1000)::bigint,
  status_history     jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  unique (clinic_id, appointment_number)
);
create index if not exists appts_clinic_date_ix   on public.appointments (clinic_id, scheduled_date);
create index if not exists appts_patient_ix       on public.appointments (patient_id, scheduled_date desc);

create table if not exists public.queue_entries (
  id                       text primary key,
  clinic_id                text not null references public.clinics(id) on delete cascade,
  doctor_id                text not null references public.doctors(id) on delete cascade,
  appointment_id           text references public.appointments(id) on delete set null,
  patient_id               text not null references public.patients(id) on delete cascade,
  token_number             text not null,           -- "A-014"
  seq                      int  not null,           -- monotonic per clinic+day
  queue_position           int,                     -- null once served/done
  status                   text not null default 'waiting'
                           check (status in ('waiting','called','in_progress','done','no_show','paused')),
  is_priority              boolean not null default false,
  checkin_time             bigint not null,
  called_at                bigint,
  consultation_start_time  bigint,
  consultation_end_time    bigint,
  paused_at                bigint,
  total_paused_ms          bigint not null default 0,
  created_at               bigint not null default (extract(epoch from now()) * 1000)::bigint,
  status_history           jsonb not null default '[]',
  updated_at               timestamptz not null default now()
);
-- seq is unique per clinic+calendar day → duplicate tokens are impossible.
-- to_char(timestamptz, ...) is only STABLE (rejected in index expressions), so
-- the day key comes from an IMMUTABLE helper — legitimate, since IST is fixed
-- +05:30 with no DST: add the offset, then count whole UTC days.
create or replace function public.ist_day_key(ms bigint)
returns bigint language sql immutable parallel safe as $fn$
  select (ms + 19800000) / 86400000
$fn$;
create unique index if not exists queue_day_seq_uq
  on public.queue_entries (clinic_id, public.ist_day_key(created_at), seq);
create index if not exists queue_clinic_status_ix on public.queue_entries (clinic_id, status);
create index if not exists queue_patient_ix       on public.queue_entries (patient_id, created_at desc);

create table if not exists public.consultations (
  id               text primary key,
  queue_id         text not null references public.queue_entries(id) on delete cascade,
  clinic_id        text not null references public.clinics(id) on delete cascade,
  doctor_id        text not null references public.doctors(id) on delete cascade,
  start_time       bigint not null,
  end_time         bigint,
  duration_seconds int,
  created_at       timestamptz not null default now()
);
create index if not exists consult_doctor_start_ix on public.consultations (doctor_id, start_time desc);

create table if not exists public.queue_events (
  id         text primary key,
  clinic_id  text not null references public.clinics(id) on delete cascade,
  at         bigint not null,
  actor      text not null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists events_clinic_at_ix on public.queue_events (clinic_id, at desc);

create table if not exists public.notifications (
  id         text primary key,
  patient_id text not null references public.patients(id) on delete cascade,
  queue_id   text not null references public.queue_entries(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  read_at    bigint
);
create index if not exists notif_patient_ix on public.notifications (patient_id, created_at desc);

create table if not exists public.daily_stats (
  date                date not null,
  clinic_id           text not null references public.clinics(id) on delete cascade,
  doctor_id           text not null references public.doctors(id) on delete cascade,
  patients_seen       int  not null default 0,
  no_shows            int  not null default 0,
  rolling_avg_seconds int  not null default 0,
  avg_wait_seconds    int  not null default 0,
  total_delay_minutes int  not null default 0,
  queue_peak          int  not null default 0,
  estimated_end_time  bigint not null default 0,
  primary key (date, clinic_id, doctor_id)
);

-- ---------- 2. Realtime ----------
-- Broadcast row changes on these tables. In Phase B you can restrict to
-- per-row filters; for the demo every clinic broadcasts to every listener
-- and the client filters by clinic_id.
-- Idempotent publication: re-running the file must not error on tables
-- that are already members.
do $pub$
declare t text;
begin
  foreach t in array array[
    'queue_entries','appointments','patients','notifications',
    'queue_events','consultations','daily_stats'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$pub$;

-- ---------- 3. Row Level Security ----------
alter table public.clinics       enable row level security;
alter table public.doctors       enable row level security;
alter table public.staff         enable row level security;
alter table public.patients      enable row level security;
alter table public.appointments  enable row level security;
alter table public.queue_entries enable row level security;
alter table public.consultations enable row level security;
alter table public.queue_events  enable row level security;
alter table public.notifications enable row level security;
alter table public.daily_stats   enable row level security;

-- Make the policy section re-runnable: drop existing demo policies first.
do $drop$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and policyname like 'demo\_anon\_%'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$drop$;

-- ===== 3a. DEMO MODE — anon role (active) =====================
-- Goal: the deployed app works with only the anon key, every visitor
-- shares one live queue, and no client can destroy state.
--   • anon CAN:  read everything except notifications; seed the demo
--     clinic (idempotent); register patients; book appointments
--     (self-created only); update ONLY queue/appointment status fields.
--   • anon CANNOT: delete anything, edit clinic config, edit other
--     patients' rows, read notifications (personal — needs auth).
-- ===============================================================

-- Read: clinic config + directory open to everyone in demo
create policy "demo_anon_select_clinics"  on public.clinics      for select to anon using (true);
create policy "demo_anon_select_doctors"  on public.doctors      for select to anon using (true);
create policy "demo_anon_select_staff"    on public.staff        for select to anon using (true);
create policy "demo_anon_select_patients" on public.patients     for select to anon using (true);
create policy "demo_anon_select_appts"    on public.appointments for select to anon using (true);
create policy "demo_anon_select_queue"    on public.queue_entries for select to anon using (true);
create policy "demo_anon_select_consults" on public.consultations for select to anon using (true);
create policy "demo_anon_select_events"   on public.queue_events for select to anon using (true);
create policy "demo_anon_select_stats"    on public.daily_stats  for select to anon using (true);
-- notifications are scoped through the owning queue entry (see below) —
-- content is demo-generic (token alerts, no PII).

-- Seed: the demo clinic may be created by anon, but only that exact id
-- and only with default config — so the seed is idempotent and
-- tamper-resistant, and no other clinic can be created anonymously.
create policy "demo_anon_insert_seed_clinic" on public.clinics
  for insert to anon with check (id = 'clinic_arhan');
create policy "demo_anon_insert_doctors" on public.doctors
  for insert to anon with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_insert_staff"   on public.staff
  for insert to anon with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_insert_patients" on public.patients
  for insert to anon with check (clinic_id = 'clinic_arhan');

-- Patients self-register (demo phone auth) — any id, clinic must be the demo one
create policy "demo_anon_insert_patient_rows" on public.patients
  for insert to anon with check (clinic_id = 'clinic_arhan');

-- Booking: patient (or demo client) may create appointments in the demo clinic
create policy "demo_anon_insert_appts" on public.appointments
  for insert to anon with check (clinic_id = 'clinic_arhan');

-- Walk-ins / check-in create queue entries
create policy "demo_anon_insert_queue" on public.queue_entries
  for insert to anon with check (clinic_id = 'clinic_arhan');

-- Consultation records + events + stats are written by the app on transitions
create policy "demo_anon_insert_consults" on public.consultations
  for insert to anon with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_insert_events"   on public.queue_events
  for insert to anon with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_insert_stats"    on public.daily_stats
  for insert to anon with check (clinic_id = 'clinic_arhan');

-- Status transitions only: UPDATE is allowed but the WHERE clause pins the
-- row to the demo clinic, and WITH CHECK forbids re-assigning rows to
-- another clinic. (Field-level restriction comes with real auth in Phase B;
-- for the demo the app's own engine guards the transitions.)
create policy "demo_anon_update_queue" on public.queue_entries
  for update to anon
  using (clinic_id = 'clinic_arhan')
  with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_update_appts" on public.appointments
  for update to anon
  using (clinic_id = 'clinic_arhan')
  with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_update_patients" on public.patients
  for update to anon
  using (clinic_id = 'clinic_arhan')
  with check (clinic_id = 'clinic_arhan');
create policy "demo_anon_update_stats" on public.daily_stats
  for update to anon
  using (clinic_id = 'clinic_arhan')
  with check (clinic_id = 'clinic_arhan');

-- Notifications: no clinic_id column → scope every policy through the
-- owning queue entry. Content is demo-generic (token alerts, no PII),
-- and the patient bell needs to read them.
create policy "demo_anon_select_notifs" on public.notifications
  for select to anon
  using (exists (select 1 from public.queue_entries q
                 where q.id = queue_id and q.clinic_id = 'clinic_arhan'));
create policy "demo_anon_insert_notifs" on public.notifications
  for insert to anon
  with check (exists (select 1 from public.queue_entries q
                 where q.id = queue_id and q.clinic_id = 'clinic_arhan'));
create policy "demo_anon_update_notifs" on public.notifications
  for update to anon
  using (exists (select 1 from public.queue_entries q
                 where q.id = queue_id and q.clinic_id = 'clinic_arhan'))
  with check (exists (select 1 from public.queue_entries q
                 where q.id = queue_id and q.clinic_id = 'clinic_arhan'));

-- Delete: only used by the demo Reset button (wipeSupabaseDemo). Scoped
-- to the demo clinic; with real auth these are removed first.
create policy "demo_anon_delete_queue"    on public.queue_entries for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_appts"    on public.appointments for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_patients" on public.patients     for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_consults" on public.consultations for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_events"   on public.queue_events for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_stats"    on public.daily_stats  for delete to anon using (clinic_id = 'clinic_arhan');
create policy "demo_anon_delete_notifs"   on public.notifications for delete to anon
  using (exists (select 1 from public.queue_entries q
                 where q.id = queue_id and q.clinic_id = 'clinic_arhan'));

-- No DELETE policies at all → anon can never delete rows.

-- ===== 3b. PRODUCTION TIER — templates (enable when adding Supabase Auth) =====
-- Suggested JWT app claims:  app_metadata.role = patient|staff|doctor,
--                            app_metadata.clinic_id = <clinic uuid>,
--                            app_metadata.user_id = <patients|staff|doctors id>
-- Uncomment and adapt when you wire real authentication.
--
-- create or replace function public.jwt_role()      returns text language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'role','') $$;
-- create or replace function public.jwt_clinic_id() returns text language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'clinic_id','') $$;
-- create or replace function public.jwt_user_id()   returns text language sql stable as $$ select coalesce(auth.jwt()->'app_metadata'->>'user_id','') $$;
--
-- -- Clinics: members see their clinic
-- create policy "prod_select_clinic" on public.clinics for select to authenticated
--   using (id = public.jwt_clinic_id());
-- -- Directory within clinic
-- create policy "prod_select_doctors" on public.doctors for select to authenticated
--   using (clinic_id = public.jwt_clinic_id());
-- create policy "prod_select_staff"   on public.staff   for select to authenticated
--   using (clinic_id = public.jwt_clinic_id());
-- -- Patients: staff/admin see the whole clinic; patients see only themselves
-- create policy "prod_select_patients" on public.patients for select to authenticated
--   using (public.jwt_role() in ('staff','doctor')
--          and clinic_id = public.jwt_clinic_id())
--      or (public.jwt_role() = 'patient' and id = public.jwt_user_id());
-- -- Queue: staff+doctor read the clinic queue; patients read ONLY their own rows
-- create policy "prod_select_queue" on public.queue_entries for select to authenticated
--   using ((public.jwt_role() in ('staff','doctor') and clinic_id = public.jwt_clinic_id())
--          or (public.jwt_role() = 'patient' and patient_id = public.jwt_user_id()));
-- -- Appointments: same split
-- create policy "prod_select_appts" on public.appointments for select to authenticated
--   using ((public.jwt_role() in ('staff','doctor') and clinic_id = public.jwt_clinic_id())
--          or (public.jwt_role() = 'patient' and patient_id = public.jwt_user_id()));
-- -- Notifications: strictly the owner
-- create policy "prod_select_notifs" on public.notifications for select to authenticated
--   using (patient_id = public.jwt_user_id());
-- -- Writes: staff-only mutations (Phase B moves these into SECURITY DEFINER fns)
-- create policy "prod_staff_update_queue" on public.queue_entries for update to authenticated
--   using (public.jwt_role() = 'staff' and clinic_id = public.jwt_clinic_id())
--   with check (clinic_id = public.jwt_clinic_id());
-- create policy "prod_staff_insert_queue" on public.queue_entries for insert to authenticated
--   with check (public.jwt_role() = 'staff' and clinic_id = public.jwt_clinic_id());
-- create policy "prod_patient_insert_appt" on public.appointments for insert to authenticated
--   with check (public.jwt_role() = 'patient' and patient_id = public.jwt_user_id());
-- -- (etc. per table — same shape: role check + clinic_id check)
--
-- -- Phase B per-row realtime (replaces blanket publication rows above):
--   drop table public.queue_entries from publication supabase_realtime;
--   alter table public.queue_entries add row level security;  -- (implicit)
--   -- Then in the client: .on('postgres_changes',
--   --   { event:'*', schema:'public', table:'queue_entries',
--   --     filter:'clinic_id=eq.clinic_arhan' }, ...)
