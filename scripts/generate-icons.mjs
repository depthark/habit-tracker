/**
 * generate-icons.mjs — writes the PWA icons without pulling in an image
 * library. A PNG is a signature, a few chunks, and zlib-compressed scanlines,
 * which is all `node:zlib` gives us; the drawing is done per pixel.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BRAND = [0x1f, 0x8f, 0x5c]; // --color-done
const INK = [0xff, 0xff, 0xff];

// --- tiny drawing helpers ---------------------------------------------------

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRectDistance(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - (halfW - radius);
  const qy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance from a point to a line segment, used to stroke the tick. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Render one icon.
 * @param {number} size    edge length in pixels
 * @param {number} inset   fraction of the canvas kept clear, for maskable icons
 */
function drawIcon(size, inset) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = (size * inset) / 2;
  const box = size - pad * 2;
  const radius = box * 0.22;
  const stroke = box * 0.11;
  const mid = size / 2;

  // The tick, as fractions of the tile, then converted to the same centred
  // space the distance helpers work in.
  const ax = pad + box * 0.28 - mid;
  const ay = pad + box * 0.53 - mid;
  const bx = pad + box * 0.43 - mid;
  const by = pad + box * 0.68 - mid;
  const cx = pad + box * 0.73 - mid;
  const cy = pad + box * 0.34 - mid;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - mid;
      const py = y + 0.5 - mid;

      // Coverage of the rounded tile, antialiased on its edge.
      const tileEdge = roundedRectDistance(px, py, box / 2, box / 2, radius);
      const tileA = Math.min(1, Math.max(0, 0.5 - tileEdge));

      // Coverage of the tick, clipped to the tile.
      const tickEdge = Math.min(
        segmentDistance(px, py, ax, ay, bx, by),
        segmentDistance(px, py, bx, by, cx, cy),
      ) - stroke / 2;
      const tickA = Math.min(1, Math.max(0, 0.5 - tickEdge)) * tileA;

      // Composite white over green, both over transparency.
      const outA = tickA + tileA * (1 - tickA);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const src = (INK[c] * tickA + BRAND[c] * tileA * (1 - tickA)) / (outA || 1);
        rgba[i + c] = Math.round(src);
      }
      rgba[i + 3] = Math.round(outA * 255);
    }
  }
  return rgba;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
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

// --- write them out ---------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  // Maskable icons get cropped to a circle by some launchers, so keep the
  // artwork inside the safe zone.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.2 },
];

for (const { file, size, inset } of targets) {
  const png = encodePng(size, drawIcon(size, inset));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}
