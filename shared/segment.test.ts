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
  /** Painted flat, with no shading or studs and no shadow: a sheet of paper, a line, a hole. */
  plain?: boolean;
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
        const shade = !color ? 1 - shadow : piece.plain ? 1 : (0.9 + 0.2 * (v / h + 0.5)) * ((Math.floor((u + w) / 9) + Math.floor((v + h) / 9)) % 2 ? 1.06 : 0.94);
        for (let c = 0; c < 3; c++) data[p + c] = (color ? color[c] : data[p + c]) * shade;
      }
    }
  };
  for (const piece of pieces) {
    if (shadow && !piece.plain) paint(piece, piece.w * 0.06, piece.h * 0.12, 1.04, null);
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

const DESK: RGB = [150, 112, 74];
const PAPER: RGB = [240, 238, 232];
const DARK_GRAY: RGB = [99, 95, 98];

test('pieces on a sheet of paper are found when the paper is only part of the picture', () => {
  const paper: Piece = { x: 330, y: 250, w: 330, h: 250, angle: 0.05, color: PAPER, plain: true };
  const pieces: Piece[] = [RED, BLUE, GREEN, BLACK].map((color, i) => ({ x: 240 + (i % 2) * 170, y: 190 + Math.floor(i / 2) * 120, w: 60, h: 44, angle: i * 0.4, color }));
  const image = photo([paper, ...pieces], { surface: DESK });
  const { regions } = segment(image);
  assert.equal(regions.length, pieces.length);
  for (const p of pieces) assert.equal(holding(regions, p, image).length, 1);
  assert.ok(regions.every((r) => r.w < 0.3), 'the sheet of paper came back as a piece');
});

test('pieces inside a tray are found, not the tray', () => {
  // The rim of a tray: four thin dark bars closing a rectangle around the pieces.
  const rim: Piece[] = [
    { x: 320, y: 90, w: 440, h: 8, angle: 0, color: DARK_GRAY, plain: true },
    { x: 320, y: 390, w: 440, h: 8, angle: 0, color: DARK_GRAY, plain: true },
    { x: 100, y: 240, w: 8, h: 308, angle: 0, color: DARK_GRAY, plain: true },
    { x: 540, y: 240, w: 8, h: 308, angle: 0, color: DARK_GRAY, plain: true },
  ];
  const pieces: Piece[] = [RED, YELLOW, BLUE, GREEN, ORANGE, BLACK].map((color, i) => ({ x: 190 + (i % 3) * 130, y: 180 + Math.floor(i / 3) * 120, w: 64, h: 44, angle: i * 0.3, color }));
  const image = photo([...rim, ...pieces]);
  const { regions } = segment(image);
  for (const p of pieces) {
    const [region, ...more] = holding(regions, p, image);
    assert.ok(region && !more.length && region.w < 0.3, 'a piece in the tray was not found on its own');
  }
});

test('the holes in a piece are part of the piece', () => {
  // A dark gray beam with pin holes, on a light desk: the holes are in deep shadow.
  const beam: Piece = { x: 320, y: 240, w: 240, h: 60, angle: 0.2, color: DARK_GRAY };
  const holes: Piece[] = [-80, 0, 80].map((d) => ({ x: 320 + d * Math.cos(0.2), y: 240 + d * Math.sin(0.2), w: 30, h: 30, angle: 0.2, color: [18, 18, 20] as RGB, plain: true }));
  assert.equal(segment(photo([beam, ...holes], { surface: [222, 196, 160] })).regions.length, 1);
});

test('a piece lying against the edge of the table is still found', () => {
  // The floor beyond the table fills the bottom of the picture; a brick lies across the line.
  const floor: Piece = { x: 320, y: 450, w: 700, h: 70, angle: 0, color: [70, 60, 55], plain: true };
  const brick: Piece = { x: 300, y: 392, w: 80, h: 56, angle: 0, color: RED };
  const other: Piece = { x: 200, y: 200, w: 70, h: 50, angle: 0.3, color: BLUE };
  const image = photo([floor, brick, other], { shadow: 0 });
  const { regions } = segment(image);
  assert.equal(regions.length, 2);
  assert.equal(holding(regions, brick, image).length, 1);
});

test('a brick held up close is one piece, though its top and side differ', () => {
  const side: Piece = { x: 320, y: 290, w: 360, h: 150, angle: 0, color: [150, 20, 8], plain: true };
  const top: Piece = { x: 320, y: 170, w: 360, h: 100, angle: 0, color: [215, 40, 20], plain: true };
  assert.equal(segment(photo([side, top], { shadow: 0 })).regions.length, 1);
});

test('each pixel is labelled with the region it belongs to', () => {
  const piece: Piece = { x: 200, y: 150, w: 80, h: 60, angle: 0, color: GREEN };
  const image = photo([piece]);
  const { regions, labels, width } = segment(image);
  assert.equal(labels[piece.y * width + piece.x], regions[0].label);
  assert.equal(labels[10 * width + 10], 0);
});
