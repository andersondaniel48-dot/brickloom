// Grid model of a part: how it sits on the stud lattice, where its studs and sockets are.
// Shapes are derived from LDraw geometry by scripts/build-catalog.ts and drive both the
// build validator and the conversion of a design back into LDraw coordinates.

/** LDraw units per stud pitch and per plate height. */
export const STUD = 20;
export const PLATE = 8;

export interface PartShape {
  id: string;
  name: string;
  /** Footprint in studs along x and z at rotation 0. */
  w: number;
  d: number;
  /** Height in plates (a standard brick is 3). */
  h: number;
  /**
   * Per footprint cell, row-major (index = z * w + x). All heights are plates above the part's bottom.
   * lo/hi: the span the part occupies in that column, or -1/-1 where the footprint is empty.
   * stud: height of the stud on top of that column, or -1 when there is none.
   * recv: 1 when the underside of that column accepts a stud.
   */
  lo: number[];
  hi: number[];
  stud: number[];
  recv: number[];
  /** Body bounding-box corner (min x, bottom y, min z) relative to the LDraw part origin, in LDU. */
  ox: number;
  oy: number;
  oz: number;
}

export type Rotation = 0 | 1 | 2 | 3;

export interface Cell {
  x: number;
  z: number;
  lo: number;
  hi: number;
  stud: number;
  recv: boolean;
}

/** Footprint size after rotating by `rot` quarter turns. */
export function rotatedSize(shape: PartShape, rot: Rotation): { w: number; d: number } {
  return rot % 2 === 0 ? { w: shape.w, d: shape.d } : { w: shape.d, d: shape.w };
}

/**
 * Occupied cells of a shape after rotation, in footprint-local coordinates.
 * Rotation matches the LDraw matrices in `rotationMatrix`: one quarter turn maps local (x, z) to (z, -x).
 */
export function rotatedCells(shape: PartShape, rot: Rotation): Cell[] {
  const { w, d } = shape;
  const cells: Cell[] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (shape.hi[i] < 0) continue;
      let rx = x;
      let rz = z;
      if (rot === 1) [rx, rz] = [z, w - 1 - x];
      else if (rot === 2) [rx, rz] = [w - 1 - x, d - 1 - z];
      else if (rot === 3) [rx, rz] = [d - 1 - z, x];
      cells.push({ x: rx, z: rz, lo: shape.lo[i], hi: shape.hi[i], stud: shape.stud[i], recv: shape.recv[i] === 1 });
    }
  }
  return cells;
}

/** LDraw 3x3 rotation (row-major) for `rot` quarter turns about the vertical axis. */
export function rotationMatrix(rot: Rotation): number[] {
  switch (rot) {
    case 1:
      return [0, 0, 1, 0, 1, 0, -1, 0, 0];
    case 2:
      return [-1, 0, 0, 0, 1, 0, 0, 0, -1];
    case 3:
      return [0, 0, -1, 0, 1, 0, 1, 0, 0];
    default:
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

/**
 * LDraw position of a part whose rotated footprint has its min corner at grid cell (x, z)
 * and whose underside rests `layer` plates above the ground. LDraw's -Y axis points up.
 */
export function ldrawPosition(shape: PartShape, rot: Rotation, x: number, z: number, layer: number) {
  const maxX = shape.ox + shape.w * STUD;
  const maxZ = shape.oz + shape.d * STUD;
  let minX = shape.ox;
  let minZ = shape.oz;
  if (rot === 1) [minX, minZ] = [shape.oz, -maxX];
  else if (rot === 2) [minX, minZ] = [-maxX, -maxZ];
  else if (rot === 3) [minX, minZ] = [-maxZ, shape.ox];
  return { x: x * STUD - minX, y: -layer * PLATE - shape.oy, z: z * STUD - minZ };
}

/** True for plain boxes: every cell full height, studded on top, open underneath. */
export function isPlainBlock(shape: PartShape): boolean {
  for (let i = 0; i < shape.w * shape.d; i++) {
    if (shape.lo[i] !== 0 || shape.hi[i] !== shape.h || shape.stud[i] !== shape.h || shape.recv[i] !== 1) return false;
  }
  return true;
}
