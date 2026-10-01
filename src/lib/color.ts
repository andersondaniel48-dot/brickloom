// Color science for matching a photographed piece to the official color palette.
import type { CatalogColor } from './catalog.ts';

export type Lab = [number, number, number];

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** sRGB (0..255) to CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const hexToLab = (hex: string): Lab => rgbToLab(...hexToRgb(hex));

/** Perceived lightness 0..1, for choosing readable text and outline colors on a swatch. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 color difference. */
export function deltaE(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a;
  const [L2, a2, b2] = b;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (x: number, y: number) => {
    if (x === 0 && y === 0) return 0;
    const h = (Math.atan2(y, x) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lpm = (L1 + L2) / 2;
  const Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 - 0.17 * Math.cos(rad(hpm - 30)) + 0.24 * Math.cos(rad(2 * hpm)) + 0.32 * Math.cos(rad(3 * hpm + 6)) - 0.2 * Math.cos(rad(4 * hpm - 63));
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export interface ColorMatch {
  color: CatalogColor;
  distance: number;
}

const labCache = new Map<string, Lab>();
const labOf = (c: CatalogColor) => {
  let lab = labCache.get(c.rgb);
  if (!lab) labCache.set(c.rgb, (lab = hexToLab(c.rgb)));
  return lab;
};

/**
 * Ranks palette colors by closeness to a measured color.
 * `likely` are colors the part is known to exist in; they are preferred unless clearly a worse match.
 */
export function rankColors(sample: Lab, palette: CatalogColor[], likely: Set<number> = new Set()): ColorMatch[] {
  const matches: ColorMatch[] = [];
  for (const color of palette) {
    const known = likely.has(color.id);
    // Transparent, chrome and other special finishes photograph unpredictably, and palettes from other
    // product lines sit very close to the standard colors; only offer either when the part comes in them.
    const special = color.trans || /chrome|metallic|pearl|glitter|glow|speckle|opal|satin/i.test(color.name);
    const otherLine = /^(modulex|duplo|fabuland|ho |vintage|clikits|pastel)/i.test(color.name);
    if ((special || otherLine) && !known) continue;
    let distance = deltaE(sample, labOf(color));
    // Room lighting shifts a photographed color a long way, so the colors a part is known to exist in
    // win unless something else is a far better match.
    if (likely.size && !known) distance += 16;
    if (special) distance += 6;
    matches.push({ color, distance });
  }
  return matches.sort((a, b) => a.distance - b.distance);
}

/** Black or white, whichever reads better on the given color. */
export const inkOn = (hex: string) => (luminance(hex) > 0.36 ? '#15171c' : '#ffffff');
