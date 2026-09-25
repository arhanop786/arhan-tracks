# ============================================================
# Android Trusted Web Activity (TWA) package for Google Play.
# Wraps the PWA (arhan-tracks.pages.dev) in a lightweight APK
# using Google's own generator — no Android Studio needed.
#
#   node scripts/make-twa.mjs          (shows usage)
#   npm run twa                        (uses .twa.config.json)
#
# Prerequisites (one-time):
#   • JDK 17:  https://adoptium.net  (java -version must work)
#   • Android build tools are fetched automatically by Gradle.
#
# What you get: twa/ project → build with `cd twa && ./gradlew
# assembleRelease` → app-release-bundle.aab → upload to Play Console.
# ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const cfgPath = resolve(process.cwd(), '.twa.config.json');
if (!existsSync(cfgPath)) {
  console.error(`Missing ${cfgPath} — create it first (see scripts/README-play.md).`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const args = [
  'bubblewrap', 'init',
  '--manifest', cfg.manifestUrl,
  '--directory', cfg.directory ?? 'twa',
];

// bubblewrap init prompts interactively; seed it with answers via env-style
// CLI flags it supports. Anything not covered here keeps its default.
if (cfg.packageId) args.push('--packageId', cfg.packageId);
if (cfg.host) args.push('--host', cfg.host);
if (cfg.name) args.push('--name', cfg.name);
if (cfg.launcherName) args.push('--launcherName', cfg.launcherName);
if (cfg.display) args.push('--display', cfg.display);
if (cfg.themeColor) args.push('--themeColor', cfg.themeColor);
if (cfg.backgroundColor) args.push('--backgroundColor', cfg.backgroundColor);
if (cfg.startUrl) args.push('--startUrl', cfg.startUrl);
if (cfg.iconUrl) args.push('--iconUrl', cfg.iconUrl);
if (cfg.maskableIconUrl) args.push('--maskableIconUrl', cfg.maskableIconUrl);
if (cfg.shortcuts) args.push('--shortcuts', JSON.stringify(cfg.shortcuts));
if (cfg.signingKeyPath) args.push('--signingKeyPath', cfg.signingKeyPath);
if (cfg.signingKeyAlias) args.push('--signingKeyAlias', cfg.signingKeyAlias);
if (cfg.keyPassword) args.push('--keyPassword', cfg.keyPassword);
if (cfg.storePassword) args.push('--storePassword', cfg.storePassword);
if (cfg.skipPwaValidation) args.push('--skipPwaValidation');
if (cfg.timeout) args.push('--timeout', String(cfg.timeout));

console.log(`> npx ${args.join(' ')}`);
execSync(`npx ${args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')}`, {
  stdio: 'inherit',
  cwd: process.cwd(),
});

// Write the Digital Asset Links file for the host to serve.
const dalDir = resolve(process.cwd(), 'public/.well-known');
const { mkdirSync } = await import('node:fs');
mkdirSync(dalDir, { recursive: true });
const statement = {
  target: {
    namespace: 'android_app',
    package_name: cfg.packageId ?? 'com.example.arhantracks',
    sha256_cert_fingerprints: cfg.certFingerprint ? [cfg.certFingerprint] : ['REPLACE_WITH_PLAY_APP_SIGNING_SHA256'],
  },
  relation: ['delegate_permission/common.handle_all_urls'],
};
writeFileSync(resolve(dalDir, 'assetlinks.json'), JSON.stringify([statement], null, 2) + '\n');
console.log('\n✔ twa/ project created.');
console.log('  → public/.well-known/assetlinks.json written — commit & deploy it.');
console.log('  → cd twa && ./gradlew assembleRelease  (or bubblewrap build)');
