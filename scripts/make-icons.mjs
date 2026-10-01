// Draws the app icon as PNG files in ./public. Phones need PNGs: iOS ignores SVG home-screen icons
// and Android builds its launcher icon from the 192 and 512 pixel sizes.
// Run with `node scripts/make-icons.mjs` after changing the design below.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const YELLOW = [255, 210, 63];
const INK = [21, 23, 28];

/** Distance-based coverage of a rounded rectangle at a point; all units are in the 512-unit design space. */
const inRoundedRect = (x, y, left, top, size, radius) => {
  const cx = Math.min(Math.max(x, left + radius), left + size - radius);
  const cy = Math.min(Math.max(y, top + radius), top + size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
};

/**
 * The mark is a 2x2 brick seen from above.
 * `plate`: corner radius of the yellow background, or null for a full-bleed square (launchers that
 * apply their own mask). `inset`: where the dark brick starts, which sets how much margin it has.
 */
function sample(x, y, { plate, inset }) {
  const brick = 512 - inset * 2;
  const stud = brick * 0.144;
  const offset = brick * 0.3;
  for (const sx of [inset + offset, 512 - inset - offset]) {
    for (const sy of [inset + offset, 512 - inset - offset]) {
      if (Math.hypot(x - sx, y - sy) <= stud) return [...YELLOW, 255];
    }
  }
  if (inRoundedRect(x, y, inset, inset, brick, brick * 0.175)) return [...INK, 255];
  if (plate === null || inRoundedRect(x, y, 0, 0, 512, plate)) return [...YELLOW, 255];
  return [0, 0, 0, 0];
}

function render(size, design) {
  const SS = 4; // supersampling for smooth edges
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((px + (sx + 0.5) / SS) * 512) / size, ((py + (sy + 0.5) / SS) * 512) / size, design);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      pixels[i] = a ? Math.round(r / a) : 0;
      pixels[i + 1] = a ? Math.round(g / a) : 0;
      pixels[i + 2] = a ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round(a / (SS * SS));
    }
  }
  return pixels;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1)); // each scanline is prefixed with filter type 0
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ROUNDED = { plate: 116, inset: 96 };
const FULL_BLEED = { plate: null, inset: 96 };
// Android crops maskable icons to a circle or squircle, so the brick sits well inside the safe zone.
const MASKABLE = { plate: null, inset: 136 };

const icons = [
  ['icon-192.png', 192, ROUNDED],
  ['icon-512.png', 512, ROUNDED],
  ['icon-maskable-512.png', 512, MASKABLE],
  ['apple-touch-icon.png', 180, FULL_BLEED],
];
for (const [name, size, design] of icons) {
  await writeFile(path.join(publicDir, name), png(size, render(size, design)));
  console.log(`wrote public/${name}`);
}
