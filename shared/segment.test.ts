import assert from 'node:assert/strict';
import { test } from 'node:test';
import { segment, type Pixels, type Region } from '../src/lib/scan/segment.ts';

type RGB = [number, number, number];

const RED: RGB = [201, 26, 9];
const BLUE: RGB = [0, 85, 191];
const YELLOW: RGB = [242, 205, 55];
const GREEN: RGB = [35, 120, 65];
const BLACK: RGB = [5, 19, 29];
const WHITE: RGB = [255, 255, 255];
const ORANGE: RGB = [254, 138, 24];
const LIGHT_GRAY: RGB = [160, 165, 169];

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  color: RGB;
}

/** A photo of pieces on a sheet of paper: uneven light, camera noise, and a hard shadow beside each piece. */
function photo(pieces: Piece[], { width = 640, height = 480, noise = 3, shadow = 0.2, surface = [243, 239, 230] as RGB } = {}): Pixels {
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const light = 1 - 0.12 * ((x / width + y / height) / 2);
      const n = (rand() - 0.5) * 2 * noise;
      for (let c = 0; c < 3; c++) data[p + c] = surface[c] * light + n;
      data[p + 3] = 255;
    }
  }
  const paint = (piece: Piece, dx: number, dy: number, grow: number, color: RGB | null) => {
    const cos = Math.cos(piece.angle);
    const sin = Math.sin(piece.angle);
    const w = piece.w * grow;
    const h = piece.h * grow;
    const reach = Math.ceil(Math.hypot(w, h) / 2) + 1;
    const cx = piece.x + dx;
    const cy = piece.y + dy;
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(height, cy + reach); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(width, cx + reach); x++) {
        const u = (x - cx) * cos + (y - cy) * sin;
        const v = -(x - cx) * sin + (y - cy) * cos;
        if (Math.abs(u) > w / 2 || Math.abs(v) > h / 2) continue;
        const p = (y * width + x) * 4;
        // Lit from one side, with a faint pattern of studs.
        const shade = color ? (0.9 + 0.2 * (v / h + 0.5)) * ((Math.floor((u + w) / 9) + Math.floor((v + h) / 9)) % 2 ? 1.06 : 0.94) : 1 - shadow;
        for (let c = 0; c < 3; c++) data[p + c] = (color ? color[c] : data[p + c]) * shade;
      }
    }
  };
  for (const piece of pieces) {
    if (shadow) paint(piece, piece.w * 0.06, piece.h * 0.12, 1.04, null);
    paint(piece, 0, 0, 1, piece.color);
  }
  return { width, height, data };
}

/** The regions whose box holds the middle of a piece. */
const holding = (regions: Region[], piece: Piece, image: Pixels) =>
  regions.filter((r) => piece.x / image.width >= r.x && piece.x / image.width <= r.x + r.w && piece.y / image.height >= r.y && piece.y / image.height <= r.y + r.h);

test('every piece on a tray is found once, whatever its color', () => {
  const colors = [RED, BLUE, YELLOW, GREEN, BLACK, WHITE, ORANGE, LIGHT_GRAY, RED, GREEN, BLUE, YELLOW];
  const pieces = colors.map((color, i): Piece => ({ x: 80 + (i % 4) * 160, y: 80 + Math.floor(i / 4) * 160, w: 70 - (i % 3) * 8, h: 44 + (i % 2) * 10, angle: (i * 0.37) % 1.2 - 0.6, color }));
  const image = photo(pieces);
  const { regions } = segment(image);
  assert.equal(regions.length, pieces.length);
  for (const piece of pieces) assert.equal(holding(regions, piece, image).length, 1);
});

test('a shadow is not a piece', () => {
  const image = photo([{ x: 320, y: 240, w: 90, h: 60, angle: 0.3, color: RED }], { shadow: 0.35 });
  assert.equal(segment(image).regions.length, 1);
});

test('pieces of different colors that touch are told apart', () => {
  const red: Piece = { x: 280, y: 240, w: 80, h: 60, angle: 0, color: RED };
  const blue: Piece = { x: 358, y: 246, w: 80, h: 60, angle: 0, color: BLUE };
  const image = photo([red, blue]);
  const { regions } = segment(image);
  assert.equal(regions.length, 2);
  assert.notEqual(holding(regions, red, image)[0], holding(regions, blue, image)[0]);
});

test('pieces of one color that touch at a corner are told apart', () => {
  const image = photo(
    [
      { x: 270, y: 200, w: 80, h: 70, angle: 0, color: RED },
      { x: 346, y: 266, w: 80, h: 70, angle: 0, color: RED },
    ],
    { shadow: 0 },
  );
  assert.equal(segment(image).regions.length, 2);
});

test('one piece with a waist stays one piece', () => {
  // An arch seen from the side: two legs joined by a bar nearly half their width.
  const image = photo(
    [
      { x: 270, y: 240, w: 40, h: 90, angle: 0, color: BLUE },
      { x: 370, y: 240, w: 40, h: 90, angle: 0, color: BLUE },
      { x: 320, y: 204, w: 80, h: 18, angle: 0, color: BLUE },
    ],
    { shadow: 0 },
  );
  assert.equal(segment(image).regions.length, 1);
});

test('the surface may be dark, colored or unevenly lit', () => {
  const pieces: Piece[] = [RED, WHITE, YELLOW, BLUE].map((color, i) => ({ x: 130 + i * 130, y: 240, w: 70, h: 50, angle: i * 0.3, color }));
  for (const surface of [[34, 36, 40], [217, 188, 154], [120, 124, 128]] as RGB[]) {
    const image = photo(pieces, { surface, shadow: 0.15 });
    assert.equal(segment(image).regions.length, pieces.length, `surface ${surface}`);
  }
});

test('each pixel is labelled with the region it belongs to', () => {
  const piece: Piece = { x: 200, y: 150, w: 80, h: 60, angle: 0, color: GREEN };
  const image = photo([piece]);
  const { regions, labels, width } = segment(image);
  assert.equal(labels[piece.y * width + piece.x], regions[0].label);
  assert.equal(labels[10 * width + 10], 0);
});
