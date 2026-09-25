// ============================================================
// PWA icon generator — zero dependencies, run with plain node:
//   node scripts/make-icons.mjs
// Draws the brand mark (teal rounded square + mint check, same
// as the inline favicon) at every size PWA installs need and
// writes public/icon-<size>.png (+ public/maskable-icon.png).
// Rendering + PNG encoding live in scripts/iconlib.mjs (shared
// with the Android/Play asset generator).
// ============================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { drawIcon, encodePng } from './iconlib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// 192 + 512 are the manifest install requirements; 180 is Apple touch.
const sizes = [192, 512];

for (const size of sizes) {
  const png = encodePng(drawIcon(size), size);
  const file = `icon-${size}.png`;
  writeFileSync(join(outDir, file), png);
  console.log(`${file.padEnd(22)} ${png.length} bytes · sha256 ${sha(png)}`);
}

const maskable = encodePng(drawIcon(512, { maskable: true }), 512);
writeFileSync(join(outDir, 'maskable-icon.png'), maskable);
console.log(`${'maskable-icon.png'.padEnd(22)} ${maskable.length} bytes · sha256 ${sha(maskable)}`);
console.log('done.');
