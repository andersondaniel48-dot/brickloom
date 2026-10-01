// Client-side list of sets, loaded the first time someone adds pieces by set.
import { SET_IMAGE_BASE, setShard, type SetColumns, type SetPiece } from '../../shared/sets.ts';
import { asset } from './paths.ts';

export interface SetInfo {
  num: string;
  name: string;
  year: number;
  theme: string;
  /** Pieces in the box, not counting spares. */
  count: number;
  image: string;
}

export class SetCatalog {
  private readonly haystack: string[];

  constructor(private readonly cols: SetColumns) {
    this.haystack = cols.nums.map((num, i) => `${num} ${cols.names[i]} ${cols.themeNames[cols.themes[i]]}`.toLowerCase());
  }

  get size() {
    return this.cols.nums.length;
  }

  private row(i: number): SetInfo {
    const num = this.cols.nums[i];
    return {
      num,
      name: this.cols.names[i],
      year: this.cols.years[i],
      theme: this.cols.themeNames[this.cols.themes[i]],
      count: this.cols.counts[i],
      image: this.cols.images[num] ?? `${SET_IMAGE_BASE}${num}.jpg`,
    };
  }

  get(num: string): SetInfo | null {
    const i = this.cols.nums.indexOf(num);
    return i < 0 ? null : this.row(i);
  }

  /**
   * Sets whose number, name or theme contains every word of the query.
   * A set number typed as printed on the box ("75192") matches its catalog number ("75192-1") first.
   */
  search(query: string, limit = 40): SetInfo[] {
    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const hits: { i: number; score: number }[] = [];
    for (let i = 0; i < this.haystack.length; i++) {
      const text = this.haystack[i];
      if (!words.every((w) => text.includes(w))) continue;
      const num = this.cols.nums[i].toLowerCase();
      // Newer and larger sets are the likelier ones to be on someone's shelf.
      let score = (this.cols.years[i] - 1950) / 10 + Math.log10(1 + this.cols.counts[i]);
      if (num === q || num === `${q}-1`) score += 1000;
      else if (num.startsWith(`${q}-`)) score += 500;
      else if (words.length === 1 && num.startsWith(q)) score += 100;
      if (this.cols.names[i].toLowerCase().startsWith(q)) score += 20;
      else if (this.cols.names[i].toLowerCase().includes(q)) score += 10;
      hits.push({ i, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit).map((h) => this.row(h.i));
  }
}

let loading: Promise<SetCatalog> | null = null;

export function loadSets(): Promise<SetCatalog> {
  loading ??= fetch(asset('catalog/sets.json'))
    .then((res) => {
      if (!res.ok) throw new Error(`sets.json: HTTP ${res.status}`);
      return res.json() as Promise<SetColumns>;
    })
    .then((cols) => new SetCatalog(cols))
    .catch((err) => {
      loading = null; // allow a retry
      throw err;
    });
  return loading;
}

// Inventories are spread over 256 files; each is fetched once and kept.
const shards = new Map<string, Promise<Record<string, SetPiece[]>>>();

/** Every piece that comes in a set. */
export async function fetchSetPieces(num: string): Promise<SetPiece[]> {
  const shard = setShard(num);
  let pending = shards.get(shard);
  if (!pending) {
    pending = fetch(asset(`sets/${shard}.json`)).then((res) => {
      if (!res.ok) throw new Error('The contents of this set could not be loaded. Check your connection and try again.');
      return res.json() as Promise<Record<string, SetPiece[]>>;
    });
    pending.catch(() => shards.delete(shard)); // allow a retry later
    shards.set(shard, pending);
  }
  const pieces = (await pending)[num];
  if (!pieces) throw new Error('This set has no list of pieces.');
  return pieces;
}
