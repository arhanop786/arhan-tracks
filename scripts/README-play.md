# Publishing Arhan Tracks to Google Play

The app is a PWA, so Play distribution uses a **Trusted Web Activity (TWA)**:
a thin Android wrapper that opens `https://arhan-tracks.pages.dev` full-screen
in Chrome, no browser UI, with your icons and splash. When you update the
website, the Play app updates automatically — **no Play re-review needed**.

This repo generates everything and **builds the signed AAB in GitHub Actions** —
you need no Java, no Android Studio, no local Android SDK.

---

## What's in the repo

| Path | Purpose |
| --- | --- |
| `scripts/make-twa.mjs` | Generates the Bubblewrap config, `assetlinks.json`, and store graphics (`npm run twa`) |
| `.twa.config.json` | App identity: package id `com.arhan.tracks`, host, icons |
| `twa/twa-manifest.json` | Bubblewrap build config (committed, regenerated) |
| `.github/workflows/twa.yml` | Builds the signed AAB in the cloud on every relevant push |
| `public/.well-known/assetlinks.json` | Digital Asset Links — makes the app open with no URL bar |
| `public/privacy.html` | Hosted privacy policy (Play requirement) — live at `/privacy.html` |
| `store/` | Feature graphic + placeholder screenshot for the listing |

---

## One-time setup (~30 min, no Android Studio)

1. **Create a Play developer account** — <https://play.google.com/console>.
   One-time $25 fee; identity verification can take a day or two.
2. **Create the app entry** → *All apps* → *Create app*.
   - Name: **Arhan Tracks** · Type: **App** · Free · declare no ads.
3. **Set a real keystore password (recommended before first upload)**:
   repo → Settings → Secrets and variables → Actions → New secret
   - `TWA_KEY_PASSWORD` = a long password of your choice.
   If you skip this, the workflow uses the fallback password
   `arhan-tracks-twa` (fine for testing; change before review).
4. **Run the build**: Actions → *Build Android AAB (Play Store)* → *Run workflow*
   (or push a change touching `.twa.config.json`). The run:
   - generates the upload keystore once and caches it,
   - runs `bubblewrap init` against the live web manifest,
   - produces `twa/app-release-bundle.aab` (+ signed APK),
   - prints the **upload key SHA-256** fingerprint in the log,
   - ships a ready-made `public/.well-known/assetlinks.json` (the repo's
     `signing.sha256` is baked in — no manual copy-paste).
5. **Download the AAB** (`arhan-tracks-play`) from the run's *Artifacts* section.

---

## Identity links

`assetlinks.json` is generated automatically with the upload-key fingerprint
stored in `.twa.config.json`. Verify it after the first deploy:
<https://arhan-tracks.pages.dev/.well-known/assetlinks.json> — the one
statement covers both the Android app and any desktop browsers verifying the
domain (the same data also satisfies Play Console → *App integrity* when asked).

---

## Store listing checklist

- [ ] App name, short description (80 chars), full description (4000 chars)
- [ ] Phone screenshots — at least 2 (1080×1920+). `store/phone-screenshot.png`
      is a placeholder: take real ones from the installed app and replace it.
- [ ] Feature graphic 1024×500 — `store/feature-graphic.png` is ready
- [ ] App category: **Medical** (or Health & Fitness), contact email
- [ ] Privacy policy URL: `https://arhan-tracks.pages.dev/privacy.html`
- [ ] Content rating questionnaire → IARC rating
- [ ] Data safety form: "No data collected or shared" fits today's schema —
      revisit if you add auth/analytics
- [ ] Target audience + countries, then *Submit for review*

---

## Local build (optional)

With JDK 17 + Android SDK installed:

```bash
npm run twa              # regenerate config + graphics
cd twa
bubblewrap build --skipPwaValidation
```

---

## Updating the app

Site changes deploy on push to `main` (existing `deploy.yml`) and appear in
the installed Play app automatically. Bump `appVersionCode` /
`appVersionName` in `scripts/make-twa.mjs`, push, download the new AAB, and
upload it to Play as a new release — only needed if you change the wrapper
(package id, icons, permissions, Play listing metadata).
