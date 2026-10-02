// Client-side catalog: every part, color and category, loaded once from /catalog and held in memory.
import { create } from 'zustand';
import type { Shapes } from '../../shared/build.ts';
import type { DesignCatalog } from '../../shared/design.ts';
import { asset } from './paths.ts';

export interface CatalogColor {
  id: number;
  name: string;
  /** "RRGGBB" */
  rgb: string;
  trans: boolean;
}

export interface PartInfo {
  id: string;
  name: string;
  category: number;
  /** LDraw file that draws this part (its own, or a plain/interchangeable mold's), or null when none exists. */
  geometry: string | null;
  /** How many colors the part was produced in; a rough popularity signal. */
  popularity: number;
}

interface PartColumns {
  ids: string[];
  names: string[];
  cats: number[];
  pop: number[];
  geo: (0 | 1 | string)[];
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export class Catalog {
  readonly colors: Map<number, CatalogColor>;
  readonly categories: Map<number, string>;
  private readonly index = new Map<string, number>();
  private readonly haystack: string[];
  private partColors: Promise<Record<string, number[]>> | null = null;
  private colorNames: Map<string, CatalogColor> | null = null;
  private colorShare: Promise<Map<number, number>> | null = null;
  private design: Promise<DesignCatalog> | null = null;

  constructor(
    readonly colorList: CatalogColor[],
    categoryList: { id: number; name: string }[],
    private readonly cols: PartColumns,
    readonly shapes: Shapes,
  ) {
    this.colors = new Map(colorList.map((c) => [c.id, c]));
    this.categories = new Map(categoryList.map((c) => [c.id, c.name]));
    this.haystack = new Array(cols.ids.length);
    for (let i = 0; i < cols.ids.length; i++) {
      this.index.set(cols.ids[i], i);
      this.haystack[i] = `${cols.ids[i]} ${cols.names[i]}`.toLowerCase();
    }
  }

  get size() {
    return this.cols.ids.length;
  }

  private row(i: number): PartInfo {
    const g = this.cols.geo[i];
    return {
      id: this.cols.ids[i],
      name: this.cols.names[i],
      category: this.cols.cats[i],
      geometry: g === 0 ? null : g === 1 ? this.cols.ids[i].toLowerCase() : g,
      popularity: this.cols.pop[i],
    };
  }

  part(id: string): PartInfo | null {
    const i = this.index.get(id);
    return i === undefined ? null : this.row(i);
  }

  has(id: string) {
    return this.index.has(id);
  }

  color(id: number): CatalogColor {
    // 9999 is the catalog's placeholder for parts with no fixed color (stickers, mixed-color assemblies in sets).
    return this.colors.get(id) ?? { id, name: id === 9999 ? 'Any color' : `Color ${id}`, rgb: '9BA19D', trans: false };
  }

  categoryName(id: number) {
    return this.categories.get(id) ?? 'Other';
  }

  isBuildable(id: string) {
    return id in this.shapes;
  }

  /**
   * Finds parts whose id or name contains every word of the query.
   * Exact and prefix id matches come first, then the most widely produced parts.
   */
  search(query: string, options: { category?: number; limit?: number } = {}): PartInfo[] {
    const limit = options.limit ?? 60;
    // "2x4" and "2 x4" should match catalog names written as "2 x 4".
    const q = query
      .toLowerCase()
      .replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ')
      .trim();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length && options.category === undefined) return [];

    const hits: { i: number; score: number }[] = [];
    for (let i = 0; i < this.haystack.length; i++) {
      if (options.category !== undefined && this.cols.cats[i] !== options.category) continue;
      const text = this.haystack[i];
      let ok = true;
      for (const w of words) {
        if (!text.includes(w)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const id = this.cols.ids[i].toLowerCase();
      let score = this.cols.pop[i];
      if (id === q) score += 10000;
      else if (words.length === 1 && id.startsWith(q)) score += 2000;
      // A phrase match ("brick 2 x 4") beats scattered words, and shorter names are the plainer parts.
      if (q.length > 2 && text.includes(q)) score += 300;
      score -= text.length / 4;
      hits.push({ i, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).map((h) => this.row(h.i));
  }

  /** Colors a part was ever produced in (loaded on first use). */
  async colorsFor(partId: string): Promise<number[]> {
    return (await this.allPartColors())[partId] ?? [];
  }

  private allPartColors(): Promise<Record<string, number[]>> {
    return (this.partColors ??= fetch(asset('catalog/part-colors.json')).then((r) => r.json()));
  }

  /**
   * How common each color is, from 0 to 1: how many different parts were made in it, set against
   * the most widely used color. Light bluish gray is near 1; chrome gold is near 0.
   */
  colorUse(): Promise<Map<number, number>> {
    this.colorShare ??= this.allPartColors().then((all) => {
      const counts = new Map<number, number>();
      for (const colors of Object.values(all)) for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
      const most = Math.max(1, ...counts.values());
      return new Map([...counts].map(([color, n]) => [color, Math.sqrt(n / most)]));
    });
    return this.colorShare;
  }

  /** What a designer needs from the catalog, including how printed parts map to plain ones (loaded on first use). */
  forDesign(): Promise<DesignCatalog> {
    this.design ??= fetch(asset('catalog/relations.json'))
      .then((r) => r.json() as Promise<{ printOf: Record<string, string>; variants: Record<string, string[]> }>)
      .then((relations) => ({
        shapes: this.shapes,
        colorNames: Object.fromEntries(this.colorList.map((c) => [c.id, c.name])),
        printOf: relations.printOf,
        variants: relations.variants,
      }));
    this.design.catch(() => (this.design = null)); // allow a retry later
    return this.design;
  }

  /**
   * Maps an identifier from another catalog (BrickLink ids, as returned by the recognition service)
   * onto ours. Most ids are shared; where a mold has lettered variants here, the most common wins.
   */
  resolveExternalId(externalId: string): PartInfo | null {
    const lookup = (id: string): PartInfo | null => {
      const exact = this.part(id);
      if (exact) return exact;
      let best: PartInfo | null = null;
      for (const suffix of ['a', 'b', 'c', 'd']) {
        const candidate = this.part(id + suffix);
        if (candidate && (!best || candidate.popularity > best.popularity)) best = candidate;
      }
      return best;
    };
    const id = externalId.toLowerCase();
    return (
      this.part(externalId) ??
      lookup(id) ??
      // "3660old" / "4085new": the other catalog's way of naming mold revisions.
      lookup(id.replace(/(old|new)$/, '')) ??
      // Printed and patterned parts are numbered differently in the two catalogs; fall back to the plain part.
      lookup(id.replace(/(pb|px|pr|pat)\d.*$/, ''))
    );
  }

  /** The catalog color with this name, ignoring case, spaces and punctuation. Names are shared with the recognition service. */
  colorByName(name: string): CatalogColor | null {
    if (!this.colorNames) {
      this.colorNames = new Map(this.colorList.map((c) => [normalizeName(c.name), c]));
    }
    return this.colorNames.get(normalizeName(name)) ?? null;
  }
}

interface CatalogState {
  catalog: Catalog | null;
  error: string | null;
  load: () => Promise<void>;
}

let loading: Promise<void> | null = null;

export const useCatalogStore = create<CatalogState>((set) => ({
  catalog: null,
  error: null,
  load: () => {
    loading ??= (async () => {
      try {
        const get = async (file: string) => {
          const res = await fetch(asset(`catalog/${file}`));
          if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
          return res.json();
        };
        const [colors, categories, parts, shapes] = await Promise.all([
          get('colors.json'),
          get('categories.json'),
          get('parts.json'),
          get('shapes.json'),
        ]);
        set({ catalog: new Catalog(colors, categories, parts, shapes) });
      } catch (err) {
        loading = null;
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return loading;
  },
}));

/** The loaded catalog. Only call inside the app shell, which renders its children after loading. */
export function useCatalog(): Catalog {
  const catalog = useCatalogStore((s) => s.catalog);
  if (!catalog) throw new Error('catalog not loaded');
  return catalog;
}
