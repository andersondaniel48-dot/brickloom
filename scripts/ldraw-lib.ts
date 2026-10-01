// Random-access reader for the LDraw parts library, straight out of complete.zip, for the build scripts.
// The library is ~37k small files; reading them from the zip avoids unpacking 550 MB to disk.
import yauzl from 'yauzl';

export interface PackedPart {
  /** Reference name of the root file, e.g. "3001.dat". */
  main: string;
  /** Every file the part needs, keyed by the name other files use to reference it ("s/3001s01.dat", "stud.dat"). */
  files: Record<string, string>;
}

const SEARCH_DIRS = ['parts/', 'p/', 'models/'];

/** "S\\3001S01.DAT" -> "s/3001s01.dat" */
export const normalizeRef = (ref: string) => ref.trim().replace(/\\/g, '/').toLowerCase();

/** File name referenced by an LDraw type-1 (sub-file) line, or null for any other line. */
export function subfileRef(line: string): string | null {
  const m = /^\s*1\s+\S+(?:\s+\S+){12}\s+(.+?)\s*$/.exec(line);
  return m ? normalizeRef(m[1]) : null;
}

/** Drops comments and bookkeeping meta lines; keeps geometry, BFC, colour and file-type lines the renderer needs. */
export function minify(text: string): string {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i > 0 && line[0] === '0' && !/^0\s+(BFC|!LDRAW_ORG|!COLOUR)\b/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

export class LDrawLibrary {
  private entries = new Map<string, yauzl.Entry>();
  private texts = new Map<string, Promise<string>>();

  private constructor(private zip: yauzl.ZipFile) {}

  static open(zipPath: string): Promise<LDrawLibrary> {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error(`cannot open ${zipPath}`));
        const lib = new LDrawLibrary(zip);
        zip.on('entry', (entry: yauzl.Entry) => {
          // Entries are stored as "ldraw/parts/3001.dat"; index them without the root folder.
          const name = entry.fileName.toLowerCase();
          if (name.startsWith('ldraw/') && !name.endsWith('/')) lib.entries.set(name.slice(6), entry);
          zip.readEntry();
        });
        zip.on('end', () => resolve(lib));
        zip.on('error', reject);
        zip.readEntry();
      });
    });
  }

  close() {
    this.zip.close();
  }

  /** Library-relative path ("parts/s/3001s01.dat") for a reference name, or null if the library lacks it. */
  resolve(ref: string): string | null {
    const name = normalizeRef(ref);
    for (const dir of SEARCH_DIRS) {
      if (this.entries.has(dir + name)) return dir + name;
    }
    return this.entries.has(name) ? name : null;
  }

  hasPart(partId: string): boolean {
    return this.entries.has(`parts/${partId.toLowerCase()}.dat`);
  }

  /** Ids of every top-level part file (no sub-parts or primitives). */
  partIds(): string[] {
    const ids: string[] = [];
    for (const name of this.entries.keys()) {
      const m = /^parts\/([^/]+)\.dat$/.exec(name);
      if (m) ids.push(m[1]);
    }
    return ids;
  }

  read(path: string): Promise<string> {
    let text = this.texts.get(path);
    if (!text) {
      text = this.readEntry(path);
      this.texts.set(path, text);
    }
    return text;
  }

  private readEntry(path: string): Promise<string> {
    const entry = this.entries.get(path);
    if (!entry) return Promise.reject(new Error(`LDraw file not found: ${path}`));
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error(`cannot read ${path}`));
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      });
    });
  }

  /** Reads a file by reference name, or null when the library does not contain it. */
  async readRef(ref: string): Promise<string | null> {
    const path = this.resolve(ref);
    return path ? this.read(path) : null;
  }

  /** Collects a part and everything it references so a client can render it without further requests. */
  async pack(partId: string): Promise<PackedPart | null> {
    const main = `${partId.toLowerCase()}.dat`;
    if (!this.resolve(main)) return null;

    const files: Record<string, string> = {};
    const queue = [main];
    const seen = new Set(queue);
    while (queue.length) {
      const batch = queue.splice(0);
      const texts = await Promise.all(batch.map((ref) => this.readRef(ref)));
      batch.forEach((ref, i) => {
        const text = texts[i];
        // A file the library lacks is packed as empty, so the renderer has an answer and never goes looking for it.
        files[ref] = text === null ? '' : minify(text);
        for (const line of files[ref].split('\n')) {
          const child = subfileRef(line);
          if (child && !seen.has(child)) {
            seen.add(child);
            queue.push(child);
          }
        }
      });
    }
    return { main, files };
  }
}
