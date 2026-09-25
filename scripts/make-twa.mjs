#!/usr/bin/env node
// ============================================================
// make-twa — Play Store assets + Bubblewrap config for the
// Android (Trusted Web Activity) package of Arhan Tracks.
// Zero dependencies, plain node:   node scripts/make-twa.mjs
//
// Produces:
//   twa/twa-manifest.json          Bubblewrap build config (committed)
//   public/.well-known/assetlinks.json  Digital Asset Links template
//   store/feature-graphic.png      1024×500 Play listing graphic
//   store/phone-screenshot.png     1080×1920 placeholder screenshot
//
// The signed AAB is built in the cloud by .github/workflows/twa.yml
// (JDK 17 + Android SDK on the GitHub runner + @bubblewrap/cli) —
// no local Java needed. The upload keystore is generated once by
// Bubblewrap on the first run and kept stable via the workflow cache.
// ============================================================

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { drawIcon, BG, CHECK } from './iconlib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, '.twa.config.json'), 'utf8'));
const httpsHost = cfg.host.replace(/\/$/, '');

// ---------- generic (non-square) PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePngAny(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 1. Bubblewrap build config ----------
mkdirSync(join(root, 'twa'), { recursive: true });
const twaManifest = {
  packageId: cfg.packageId,
  host: httpsHost,
  name: cfg.name,
  launcherName: cfg.launcherName,
  display: cfg.display || 'standalone',
  themeColor: cfg.themeColor,
  themeColorDark: cfg.themeColor,
  navigationColor: cfg.themeColor,
  navigationColorDark: cfg.themeColor,
  navigationDividerColor: cfg.themeColor,
  navigationDividerColorDark: cfg.themeColor,
  backgroundColor: cfg.backgroundColor,
  enableNotifications: false,
  startUrl: cfg.startUrl || '/',
  iconUrl: cfg.iconUrl,
  maskableIconUrl: cfg.maskableIconUrl,
  monochromeIconUrl: undefined,
  splashScreenFadeOutDuration: 300,
  // apksigner runs from the Gradle project dir (twa/app/), so the path
  // must be absolute or it fails with "Failed to load signer". CI exports
  // TWA_SIGNING_KEY_PATH; local bubblewrap resolves relative to cwd.
  signingKey: {
    path: process.env.TWA_SIGNING_KEY_PATH
      ? join(root, 'twa', 'android.keystore')
      : './android.keystore',
    alias: 'android',
  },
  appVersionCode: 1,
  appVersionName: '1.0.0',
  shortcuts: [],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: cfg.manifestUrl,
  fallbackType: 'customtabs',
  features: { locationDelegation: { enabled: true } },
  alphaDependencies: { enabled: false },
};
writeFileSync(join(root, 'twa', 'twa-manifest.json'), JSON.stringify(twaManifest, null, 2) + '\n');

// ---------- 2. Digital Asset Links template ----------
// The SHA-256 fingerprint is printed by the twa.yml workflow after the
// first build ("Upload key SHA-256"). Paste it into the line marked TODO.
const assetlinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: cfg.packageId,
      sha256_cert_fingerprints: [
        'TODO:REPLACE_WITH_UPLOAD_KEY_SHA256_FROM_CI_OUTPUT',
      ],
    },
  },
];
mkdirSync(join(root, 'public', '.well-known'), { recursive: true });
writeFileSync(join(root, 'public', '.well-known', 'assetlinks.json'), JSON.stringify(assetlinks, null, 2) + '\n');

// ---------- 3. Play listing assets ----------
const storeDir = join(root, 'store');
mkdirSync(storeDir, { recursive: true });

// Feature graphic — 1024×500, teal field, big check mark.
function featureGraphic() {
  const w = 1024, h = 500;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = BG[0]; buf[i + 1] = BG[1]; buf[i + 2] = BG[2]; buf[i + 3] = 255;
    }
  }
  // Stamp the 512px brand mark (rounded tile + check) centered right.
  const mark = drawIcon(360);
  const ox = Math.round(w - 360 - 60);
  const oy = Math.round((h - 360) / 2);
  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 360; x++) {
      const a = mark[(y * 360 + x) * 4 + 3];
      if (a > 0) {
        const di = ((y + oy) * w + (x + ox)) * 4;
        const t = a / 255;
        buf[di] = Math.round(buf[di] * (1 - t) + mark[(y * 360 + x) * 4] * t);
        buf[di + 1] = Math.round(buf[di + 1] * (1 - t) + mark[(y * 360 + x) * 4 + 1] * t);
        buf[di + 2] = Math.round(buf[di + 2] * (1 - t) + mark[(y * 360 + x) * 4 + 2] * t);
      }
    }
  }
  // A few mint "queue tick" bars on the left — abstract, font-free.
  for (let n = 0; n < 3; n++) {
    const bx = 80, by = 150 + n * 80, bw = 220 - n * 50, bh = 26, r = 13;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const cx = Math.min(Math.max(x, bx + r), bx + bw - r);
        const cy = Math.min(Math.max(y, by + r), by + bh - r);
        const dist = Math.hypot(x - cx, y - cy) - r;
        if (dist < -0.5) {
          const di = (y * w + x) * 4;
          buf[di] = CHECK[0]; buf[di + 1] = CHECK[1]; buf[di + 2] = CHECK[2];
        }
      }
    }
  }
  return encodePngAny(buf, w, h);
}
writeFileSync(join(storeDir, 'feature-graphic.png'), featureGraphic());

// Phone screenshot placeholder — 1080×1920 brand frame with device note.
// (Play wants real app screenshots before review; this one meets the size
//  requirements so the listing can be drafted, then replaced.)
function screenshot() {
  const w = 1080, h = 1920;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = BG[0]; buf[i + 1] = BG[1]; buf[i + 2] = BG[2]; buf[i + 3] = 255;
    }
  }
  const mark = drawIcon(420);
  const ox = Math.round((w - 420) / 2), oy = Math.round((h - 420) / 2);
  for (let y = 0; y < 420; y++) {
    for (let x = 0; x < 420; x++) {
      const a = mark[(y * 420 + x) * 4 + 3];
      if (a > 0) {
        const di = ((y + oy) * w + (x + ox)) * 4;
        const t = a / 255;
        buf[di] = Math.round(buf[di] * (1 - t) + mark[(y * 420 + x) * 4] * t);
        buf[di + 1] = Math.round(buf[di + 1] * (1 - t) + mark[(y * 420 + x) * 4 + 1] * t);
        buf[di + 2] = Math.round(buf[di + 2] * (1 - t) + mark[(y * 420 + x) * 4 + 2] * t);
      }
    }
  }
  return encodePngAny(buf, w, h);
}
writeFileSync(join(storeDir, 'phone-screenshot.png'), screenshot());

// ---------- summary ----------
console.log('Play Store package assets generated:');
console.log('  twa/twa-manifest.json            (bubblewrap build config)');
console.log('  public/.well-known/assetlinks.json  (paste CI fingerprint into TODO)');
console.log('  store/feature-graphic.png        (1024×500)');
console.log('  store/phone-screenshot.png       (1080×1920 placeholder — replace)');
console.log('Next: push to main — .github/workflows/twa.yml builds the signed AAB.');
