// A sample collection, roughly a classic creative box, for trying the app before scanning anything.
import type { NewPiece } from './db.ts';

const RED = 4, BLUE = 1, YELLOW = 14, GREEN = 2, WHITE = 15, BLACK = 0, LIGHT_GRAY = 71, DARK_GRAY = 72;
const ORANGE = 25, BROWN = 70, TAN = 19, BRIGHT_GREEN = 10, AZURE = 322, CLEAR = 47, TRANS_BLUE = 41;

// [part, color, quantity]
const PIECES: [string, number, number][] = [
  // Bricks
  ['3001', RED, 10], ['3001', BLUE, 8], ['3001', YELLOW, 8], ['3001', WHITE, 10], ['3001', GREEN, 6], ['3001', LIGHT_GRAY, 6],
  ['3002', RED, 6], ['3002', BLUE, 4], ['3002', YELLOW, 4], ['3002', WHITE, 6],
  ['3003', RED, 10], ['3003', BLUE, 8], ['3003', YELLOW, 8], ['3003', WHITE, 10], ['3003', GREEN, 6], ['3003', ORANGE, 4], ['3003', BLACK, 4],
  ['3004', RED, 16], ['3004', BLUE, 12], ['3004', YELLOW, 12], ['3004', WHITE, 16], ['3004', TAN, 12], ['3004', LIGHT_GRAY, 10], ['3004', BLACK, 6],
  ['3005', RED, 12], ['3005', BLUE, 8], ['3005', YELLOW, 10], ['3005', WHITE, 14], ['3005', TAN, 8], ['3005', BLACK, 8], ['3005', LIGHT_GRAY, 8],
  ['3010', RED, 12], ['3010', BLUE, 8], ['3010', YELLOW, 8], ['3010', WHITE, 12], ['3010', TAN, 10], ['3010', LIGHT_GRAY, 8],
  ['3622', RED, 6], ['3622', WHITE, 6], ['3622', TAN, 6],
  ['3009', RED, 6], ['3009', WHITE, 6], ['3009', TAN, 4], ['3009', LIGHT_GRAY, 4],
  ['3008', WHITE, 4], ['3008', RED, 4],
  ['98283', TAN, 10], ['98283', LIGHT_GRAY, 8],
  ['2357', RED, 4], ['2357', WHITE, 4],
  // Plates
  ['92438', GREEN, 1], ['3958', GREEN, 2], ['3035', GREEN, 2], ['3035', LIGHT_GRAY, 2], ['3035', TAN, 1],
  ['3032', GREEN, 2], ['3032', LIGHT_GRAY, 2], ['3031', GREEN, 2], ['3031', BLUE, 2], ['3031', DARK_GRAY, 2],
  ['3034', LIGHT_GRAY, 4], ['3034', BLACK, 2], ['3795', RED, 4], ['3795', WHITE, 4], ['3795', BROWN, 4],
  ['3020', RED, 6], ['3020', BLUE, 4], ['3020', WHITE, 6], ['3020', LIGHT_GRAY, 6], ['3020', BROWN, 4], ['3020', BLACK, 4],
  ['3021', YELLOW, 4], ['3021', DARK_GRAY, 4], ['3022', RED, 6], ['3022', WHITE, 6], ['3022', YELLOW, 4], ['3022', BLACK, 4], ['3022', BRIGHT_GREEN, 4],
  ['3023', RED, 10], ['3023', WHITE, 10], ['3023', BLACK, 8], ['3023', LIGHT_GRAY, 8], ['3023', YELLOW, 6], ['3023', BLUE, 6],
  ['3024', RED, 8], ['3024', WHITE, 8], ['3024', YELLOW, 8], ['3024', BLACK, 8], ['3024', CLEAR, 6],
  ['3710', RED, 6], ['3710', WHITE, 6], ['3710', BLACK, 4], ['3710', LIGHT_GRAY, 6], ['3666', WHITE, 4], ['3666', BROWN, 4], ['3460', LIGHT_GRAY, 2],
  ['3623', RED, 4], ['3623', WHITE, 4], ['2420', LIGHT_GRAY, 4],
  // Slopes
  ['3040b', RED, 10], ['3040b', BLUE, 6], ['3040b', DARK_GRAY, 6], ['3040b', WHITE, 4],
  ['3039', RED, 12], ['3039', BLUE, 6], ['3039', DARK_GRAY, 8], ['3039', BROWN, 4],
  ['3037', RED, 8], ['3037', DARK_GRAY, 6], ['3037', BLUE, 4], ['3038', RED, 4],
  ['3045', RED, 4], ['3044c', RED, 4], ['3298', RED, 4], ['3298', BLACK, 2], ['4286', BLUE, 4],
  ['3665', RED, 4], ['3665', WHITE, 4], ['3665', LIGHT_GRAY, 4], ['3660', RED, 4], ['3660', WHITE, 4], ['3660', BLACK, 2],
  ['54200', RED, 6], ['54200', WHITE, 6], ['54200', TRANS_BLUE, 4], ['54200', ORANGE, 4], ['85984', WHITE, 4], ['85984', BLACK, 4],
  ['15068', RED, 2], ['15068', WHITE, 2], ['11477', WHITE, 4], ['11477', BLACK, 4],
  // Tiles
  ['3068b', WHITE, 6], ['3068b', LIGHT_GRAY, 4], ['3068b', BLACK, 4], ['3069b', WHITE, 6], ['3069b', BROWN, 4], ['3069b', DARK_GRAY, 4],
  ['3070b', RED, 4], ['3070b', YELLOW, 4], ['3070b', BLACK, 4], ['2431', BROWN, 4], ['2431', WHITE, 2], ['87079', LIGHT_GRAY, 2],
  // Round parts and details
  ['3062b', WHITE, 8], ['3062b', YELLOW, 6], ['3062b', BROWN, 6], ['3062b', CLEAR, 4], ['3941', WHITE, 4], ['3941', BROWN, 4], ['3941', RED, 2],
  ['6141', YELLOW, 8], ['6141', RED, 6], ['6141', CLEAR, 6], ['6141', BLACK, 6], ['6141', BRIGHT_GREEN, 6], ['6141', ORANGE, 4],
  ['4032a', BLACK, 4], ['4032a', LIGHT_GRAY, 2], ['4032a', BRIGHT_GREEN, 2], ['4589', ORANGE, 4], ['4589', WHITE, 2], ['4589', BRIGHT_GREEN, 4],
  ['3659', WHITE, 4], ['3659', RED, 2], ['3659', TAN, 2], ['60592', WHITE, 4], ['60592', BROWN, 2], ['3245c', WHITE, 4],
  ['3700', LIGHT_GRAY, 4], ['3700', BLACK, 4], ['32000', LIGHT_GRAY, 2],
  // A few pieces the designer cannot use yet, as any real collection has
  ['4070', WHITE, 4], ['87087', LIGHT_GRAY, 4], ['3794b', WHITE, 4], ['3794b', AZURE, 2],
];

export const STARTER_COLLECTION: NewPiece[] = PIECES.map(([part, color, qty]) => ({ part, color, qty }));
