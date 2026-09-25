# Arhan Tracks

**Real-time clinic appointment & queue tracking — "Know exactly when it's your turn."**

Arhan Tracks gives patients a live view of the clinic queue (token number, position, and a dynamic wait estimate), gives reception staff a fast operations dashboard, and gives doctors a focused consultation console.

---

## Feature highlights

| Area | What it does |
|---|---|
| **Live Queue** (patient hero screen) | Now-serving token, your token, patients ahead, animated progress — updates in real time across tabs/devices-open windows |
| **ETA engine** | Rolling average of the last 5–10 *actual* consultation durations; subtracts elapsed time of the in-progress consultation; never negative; handles first-of-day (falls back to clinic default), doctor pause, no-shows, priority insertions, and over-running consultations |
| **Booking** | Clinic → doctor → date → slot flow, appointment numbers (`APPT-2026-00421`), reschedule/cancel, history |
| **Staff dashboard** | Call next, start/complete consultation, no-show, walk-ins, priority marking, pause queue, move up/down — with concurrency guards and daily stats |
| **Doctor console** | Current/next patient, start/finish, daily summary and analytics (avg consultation, avg wait, no-shows, delay) |
| **Multi-role auth** | Patient OTP (auto-registers new patients), staff/doctor login — role-scoped views and permissions |
| **Admin console** | In-app management of the doctor directory (add/edit/remove, working hours & days), clinic profile + opening hours + slot/consult lengths, and token settings (prefix, next number) — no Supabase dashboard needed; admin-only, syncs live to all devices |

Token numbers (`A-014`) and appointment numbers (`APPT-2026-00421`) are intentionally distinct — see the check-in flow.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (typechecks first):

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

Requires Node 18+.

---

## Demo accounts

**Patients** — sign in with any of these phone numbers. The OTP is **shown on the login screen** (demo mode); just type it in.

| Phone | Patient | Why it's interesting |
|---|---|---|
| `9810012345` | Rhea Sharma | **In the live queue** — shows the hero Live Queue card |
| `9810090123` | Meher Nanda | Priority patient in the queue |
| `9810089012` | Dev Patel | Currently Called to consultation |
| any number | *(new patient)* | Auto-registers and shows empty states + booking flow |

**Staff / Doctors** — use the **Staff** tab on the login screen (no OTP):

| Phone | Account | Lands on |
|---|---|---|
| `9000000001` | Priya (Reception) | Staff Dashboard — full queue controls |
| `9000000002` | Ravi (Admin) | Staff Dashboard → **Admin** console (PIN-gated, default PIN `246810` — change it in the console's Admin PIN card) |
| `8800000001` | Dr. Meera Krishnan | Doctor Dashboard (use the **Doctor** sign-in) |
| `8800000002` | Dr. Arjun Rao | Doctor Dashboard |

---

## The 2-minute demo (try this first)

1. Open **two browser windows** side by side.
2. **Window A** — sign in as patient `9810012345` (Rhea). You'll see her LIVE queue card.
3. **Window B** — staff login `9000000001`. Complete the in-progress consultation.
4. Watch Window A update **without reloading**: now-serving advances, patients-ahead drops, the progress bar moves, and ETA recalculates.

Also worth trying in the staff window: **Add Walk-in** (token sequence continues), **Mark Priority** (jumps the ordered queue), **Pause queue** (ETA countdown freezes), and try **Call Next** while a consultation is active — it's correctly rejected.

> **Note on state:** the demo runs on an in-memory engine persisted to `localStorage` and synced across tabs in the same browser (BroadcastChannel + storage events). **Configure Supabase (see below) to sync across real devices** — the sync layer is already wired end to end.

---

## Architecture

```
src/
  lib/          Shared domain types + pure helpers (ids, time)
  server/
    engine.ts   Queue engine: tokens, ordering, ETA, rolling average,
                concurrency guards, activity log — all mutations funnel
                through validated, timestamped transitions
    api.ts      Session/OTP/login + typed API surface (the "controller")
    db.ts       In-memory store + localStorage persistence + versioned reseed
    realtime.ts Cross-tab pub/sub (stands in for Supabase Realtime)
    seed.ts     Realistic demo data: 1 clinic, 2 doctors, 14 patients,
                in-progress consultations, no-show, priority entry, history
  state/        Zustand stores (navigation, session, live sync)
  screens/      20 screens: role select → patient flow, staff flow, doctor flow
  App.tsx       Router
```

**Design decisions that map 1:1 to production:**

- The engine is the **single authoritative state machine** — every action validates, mutates, timestamps, and broadcasts. In production this becomes Postgres functions / Edge Functions with the same contracts.
- All timestamps are epoch ms; all ETA math is duration-based, so the seed stays coherent at any hour of day (it compresses the demo timeline after midnight instead of crossing it).
- Views refetch on every realtime event, so swapping `realtime.ts` for a Supabase channel subscription is a contained change.
- Privacy: the public queue shows tokens, never patient names.

---

## Going live with Supabase (~10 minutes)

The app ships with a local demo mode (no accounts, no keys). To make queues sync **across real devices**:

1. **Create a free project** at [supabase.com](https://supabase.com) (no card needed).
2. **Run the schema**: Supabase Dashboard → SQL Editor → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → Run. This creates all 10 tables, indexes, the realtime publication, and Row Level Security policies (a demo tier that works with the anon key, plus commented production templates).
3. **Copy your keys**: Project Settings → API → the **Project URL** and the **anon public** key.
4. **Configure the app** — three options:
   - *Local:* `cp .env.example .env.local`, paste the values, restart `npm run dev`.
   - **Cloudflare Pages (the `Deploy` workflow):** repo → Settings → Secrets and variables → Actions → **Variables** tab → New repository variable, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then re-run the workflow (Actions → Deploy → Re-run). The workflow already wires both into the build.
   - *Vercel:* Project → Settings → Environment Variables → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` → redeploy.
5. **Test cross-device**: open the app on your phone and laptop, check in as staff on one, watch the patient's live queue update on the other.

### Deploying (Cloudflare Pages, automatic)

Every push to `main` builds and publishes `dist/` to Cloudflare Pages via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). One-time setup: create a **Cloudflare Pages — Edit** API token and copy your Account ID, then add repository **secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Settings → Secrets and variables → Actions → Secrets). The first green run creates the `arhan-tracks` Pages project; the site lives at `https://arhan-tracks.pages.dev`.

> The two `VITE_SUPABASE_*` values live in the **Variables** tab (not Secrets): they compile into the public JS bundle by design, and the anon key is safe to expose because of the RLS policies above. With the variables set, the live site syncs across real devices; without them it runs the localStorage demo.

> Security note: the anon key is safe to expose **because** of RLS. The demo-tier policies scope all writes to the demo clinic, forbid reading notifications except through the owning queue entry, and allow deletes only for the demo reset. When you add real auth, switch to the production policy templates in the same file.

## Roadmap to production

- [x] **Supabase backend** — schema + RLS in `supabase/schema.sql`, sync layer in `src/server/supabaseSync.ts` (pull on boot, debounced push on mutation, postgres_changes realtime)
- [ ] **Per-action writes** — move from snapshot upserts to engine-driven single-row mutations (Phase B; current scale is fine for demos)
- [ ] **Push notifications** — FCM/Web Push for the existing 3-tokens-away / your-turn / delay events
- [ ] **Real SMS OTP** — Twilio/MSG91 (the first paid API key; everything else runs free)
- [x] **PWA** — installable on phones (manifest + icons + iOS meta), service worker precaches the app shell for the offline patient view; `node scripts/make-icons.mjs` regenerates icons
- [x] **Google Play distribution** — Trusted Web Activity package via `npm run twa` (bubblewrap); see [`scripts/README-play.md`](scripts/README-play.md) for the full publishing walkthrough. Play-hosted privacy policy at `/privacy.html`.

## Tech stack

React 19 · TypeScript · Vite · Zustand — no other runtime dependencies.
