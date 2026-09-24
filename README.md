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
| `9000000002` | Ravi (Admin) | Staff Dashboard |
| `8800000001` | Dr. Meera Krishnan | Doctor Dashboard (use the **Doctor** sign-in) |
| `8800000002` | Dr. Arjun Rao | Doctor Dashboard |

---

## The 2-minute demo (try this first)

1. Open **two browser windows** side by side.
2. **Window A** — sign in as patient `9810012345` (Rhea). You'll see her LIVE queue card.
3. **Window B** — staff login `9000000001`. Complete the in-progress consultation.
4. Watch Window A update **without reloading**: now-serving advances, patients-ahead drops, the progress bar moves, and ETA recalculates.

Also worth trying in the staff window: **Add Walk-in** (token sequence continues), **Mark Priority** (jumps the ordered queue), **Pause queue** (ETA countdown freezes), and try **Call Next** while a consultation is active — it's correctly rejected.

> **Note on state:** the demo runs on an in-memory engine persisted to `localStorage` and synced across tabs in the same browser (BroadcastChannel + storage events). Real state is **per browser** — two different computers won't share a queue. That's the architecture seam where Supabase Realtime plugs in for production.

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

## Roadmap to production

- [ ] **Supabase backend** — tables per the schema in `src/lib/types.ts`, Row Level Security for clinic isolation, Realtime on `queue_entries`
- [ ] **Push notifications** — FCM/Web Push for the existing 3-tokens-away / your-turn / delay events
- [ ] **Real SMS OTP** — Twilio/MSG91 (the first API key you'll need; everything else runs free)
- [ ] **PWA** — installable on phones, offline-friendly patient view

## Tech stack

React 19 · TypeScript · Vite · Zustand — no other runtime dependencies.
