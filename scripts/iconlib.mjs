// ============================================================
// iconlib — the brand mark (teal rounded square + mint check)
// rasterized to PNG buffers, zero dependencies.
//
// Used by:
//   • scripts/make-icons.mjs  → PWA icons (public/)
//   • scripts/make-twa.mjs    → Android launcher mipmaps + Play assets
//
// Pure PNG encoding: no canvas, no image libraries. Rasterizes
// the mark into an RGBA pixel buffer, then writes a minimal
// PNG (color type 6, one IDAT, CRC32 per chunk).
// ============================================================

import { deflateSync } from 'node:zlib';

// Brand colors — keep in sync with src/styles.css / index.html favicon.
export const BG = [14, 92, 79]; // --teal-800 #0E5C4F
export const CHECK = [49, 196, 141]; // --teal-500 #31C48D

// Rounded-rect coverage via signed distance; AA = 1px feather.
export function roundedRectAlpha(px, py, size, radius) {
  const x = px + 0.5;
  const y = py + 0.5;
  const r = radius;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dist = Math.hypot(x - cx, y - cy) - r;
  return Math.min(1, Math.max(0, 0.5 - dist));
}

// Check-mark coverage: distance to segment (a→b), AA = 1px feather.
export function strokeAlpha(px, py, size, a, b, width) {
  const x = px + 0.5;
  const y = py + 0.5;
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * vx + (y - a[1]) * vy) / len2));
  const dist = Math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy));
  return Math.min(1, Math.max(0, 0.5 + width / 2 - dist));
}

/**
 * Render the brand mark into an RGBA buffer.
 *  • default      → rounded teal tile, transparent corners
 *  • maskable     → full-bleed tile, mark shrunk to the 80% safe zone
 *  • { markOnly } → just the check on transparency (adaptive-icon foreground)
 *  • { markScale, markStroke } → scale the check (units in a 48-grid)
 *  • { bg }       → override the tile color (e.g. Play listing variants)
 */
export function drawIcon(size, { maskable = false, markOnly = false, markScale = 1, markStroke = 1, bg = BG } = {}) {
  const rgba = Buffer.alloc(size * size * 4, 0);

  // Check mark in a 48-unit design space, scaled to the target size.
  const s = (size / 48) * markScale;
  const a = [14 * s, 26 * s];
  const b = [20 * s, 32 * s];
  const c = [34 * s, 16 * s];
  const strokeW = 5 * s * markStroke;

  // Maskable safe zone: content must fit in the central 80% circle,
  // so the mark shrinks inside the full-bleed tile.
  const inset = maskable ? 0.12 * size : 0;
  const tileR = maskable ? 0 : size * 0.25; // full-bleed square when maskable

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xi = x - inset;
      const yi = y - inset;
      const inner = size - 2 * inset;

      let alpha = 255;
      if (markOnly) {
        alpha = 0;
      } else if (!maskable) {
        alpha = Math.round(255 * roundedRectAlpha(xi, yi, inner, tileR));
      }

      // Compose: background tile, then check mark over it.
      let r = bg[0];
      let g = bg[1];
      let bl = bg[2];
      const mark = Math.min(1, strokeAlpha(xi, yi, size, a, b, strokeW) + strokeAlpha(xi, yi, size, b, c, strokeW));
      if (mark > 0) {
        r = Math.round(bg[0] * (1 - mark) + CHECK[0] * mark);
        g = Math.round(bg[1] * (1 - mark) + CHECK[1] * mark);
        bl = Math.round(bg[2] * (1 - mark) + CHECK[2] * mark);
      } else if (markOnly) {
        r = 0; g = 0; bl = 0;
      }

      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = bl;
      rgba[i + 3] = alpha;
    }
  }
  return rgba;
}

// ---------- minimal PNG encoder ----------

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

/** Encode an RGBA pixel buffer (w×h square for our uses) as a PNG. */
export function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10..12: compression 0, filter 0, interlace 0

  // One filter row (0) per scanline, for deflate.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
