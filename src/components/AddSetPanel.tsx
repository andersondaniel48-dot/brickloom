import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { MINIFIG, SPARE, selectPieces, type SetPiece } from '../../shared/sets.ts';
import { useCatalog } from '../lib/catalog.ts';
import { addSet, db } from '../lib/db.ts';
import { fetchSetPieces, loadSets, type SetCatalog, type SetInfo } from '../lib/sets.ts';
import type { AddPanel } from './AddSheet.tsx';
import { PartThumb } from './PartThumb.tsx';
import { SetImage } from './SetImage.tsx';
import { Button, IconButton, Spinner, Stepper, Toggle, toast } from './ui.tsx';

const EXAMPLES = ['Creative Brick Box', '31058', 'Millennium Falcon', 'Creator 3-in-1', 'Hogwarts'];
const PREVIEW = 36;

/** Find a set by number or name and add everything in its box to the collection. */
export function useSetPanel(active: boolean): AddPanel {
  const catalog = useCatalog();
  const [sets, setSets] = useState<SetCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [picked, setPicked] = useState<SetInfo | null>(null);
  const [pieces, setPieces] = useState<SetPiece[] | null>(null);
  const [piecesError, setPiecesError] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [spares, setSpares] = useState(false);
  const [minifigs, setMinifigs] = useState(true);
  const [adding, setAdding] = useState(false);
  const owned = useLiveQuery(() => db.sets.toArray(), []);

  useEffect(() => {
    if (!active) {
      setPicked(null);
      setQuery('');
      return;
    }
    if (sets) return;
    let live = true;
    loadSets().then(
      (loaded) => live && setSets(loaded),
      () => live && setLoadError('The list of sets could not be loaded. Run `npm run data` to download and build it.'),
    );
    return () => {
      live = false;
    };
  }, [active, sets]);

  const results = useMemo(() => (active && sets ? sets.search(deferred) : []), [sets, deferred, active]);
  const selected = useMemo(() => (pieces ? selectPieces(pieces, { spares, minifigs }) : []), [pieces, spares, minifigs]);
  const count = (flag: number) => (pieces ?? []).reduce((n, p) => n + (p[3] & flag ? p[2] : 0), 0);
  const perCopy = selected.reduce((n, p) => n + p.qty, 0);
  const buildable = selected.reduce((n, p) => n + (catalog.isBuildable(p.part) ? p.qty : 0), 0);
  const ownedCopies = (num: string) => owned?.find((s) => s.num === num)?.copies ?? 0;

  const pick = (set: SetInfo) => {
    setPicked(set);
    setPieces(null);
    setPiecesError(null);
    setCopies(1);
    setSpares(false);
    setMinifigs(true);
    fetchSetPieces(set.num).then(setPieces, (err: Error) => setPiecesError(err.message));
  };

  const add = async () => {
    if (!picked || !perCopy) return;
    setAdding(true);
    try {
      await addSet(
        { num: picked.num, name: picked.name, year: picked.year, theme: picked.theme, image: picked.image, copies },
        selected.map((p) => ({ ...p, qty: p.qty * copies })),
      );
      toast(`Added ${(perCopy * copies).toLocaleString()} pieces from ${picked.name}`);
      setPicked(null);
    } finally {
      setAdding(false);
    }
  };

  if (picked) {
    const spareCount = count(SPARE);
    const figCount = (pieces ?? []).reduce((n, p) => n + (p[3] & MINIFIG && !(p[3] & SPARE) ? p[2] : 0), 0);
    const already = ownedCopies(picked.num);
    return {
      title: (
        <span className="flex items-center gap-1">
          <IconButton label="Back to search" onClick={() => setPicked(null)} className="-ml-2">
            <ArrowLeft className="size-5" />
          </IconButton>
          <span className="truncate">{picked.name}</span>
        </span>
      ),
      body: (
        <div>
          <div className="flex items-center gap-4">
            <SetImage src={picked.image} className="size-28 shrink-0 rounded-3xl border border-line sm:size-36" />
            <div className="min-w-0">
              <div className="font-mono text-sm text-ink-3">{picked.num}</div>
              <div className="text-[15px] font-semibold">
                {picked.year} · {picked.theme}
              </div>
              <div className="tabular mt-1.5 font-display text-3xl font-bold">{picked.count.toLocaleString()}</div>
              <div className="text-sm text-ink-2">pieces in the box</div>
            </div>
          </div>

          {already > 0 && (
            <p className="mt-4 flex items-center gap-2.5 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brick-green text-white">
                <Check className="size-3.5" strokeWidth={3.5} />
              </span>
              Already in your collection{already > 1 ? ` (${already} copies)` : ''}. Adding it again adds another copy.
            </p>
          )}

          {piecesError ? (
            <p className="mt-6 rounded-2xl bg-brick-red/10 p-4 text-[15px] text-brick-red">{piecesError}</p>
          ) : !pieces ? (
            <div className="flex items-center justify-center gap-3 py-14 text-ink-2">
              <Spinner /> Opening the box
            </div>
          ) : (
            <>
              <div className="mt-4 divide-y divide-line rounded-3xl border border-line px-4">
                <div className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-[15px] font-semibold">How many of this set do you have?</span>
                  <Stepper value={copies} min={1} onChange={setCopies} />
                </div>
                {figCount > 0 && (
                  <Toggle checked={minifigs} onChange={setMinifigs} label="Include minifigures" hint={`${figCount} minifigure pieces, added as separate parts`} />
                )}
                {spareCount > 0 && (
                  <Toggle checked={spares} onChange={setSpares} label="Include spare pieces" hint={`${spareCount} small extras that come in the box`} />
                )}
              </div>

              <h3 className="mb-2 mt-5 flex flex-col gap-x-3 sm:flex-row sm:items-baseline sm:justify-between">
                <span className="text-lg font-semibold">What you are adding</span>
                <span className="text-sm text-ink-3">
                  {selected.length} different pieces, {(buildable * copies).toLocaleString()} ready to build with
                </span>
              </h3>
              <div className="grid grid-cols-4 gap-2 xs:grid-cols-5 sm:grid-cols-6">
                {selected.slice(0, PREVIEW).map((p) => (
                  <div
                    key={`${p.part}|${p.color}`}
                    title={`${catalog.part(p.part)?.name ?? p.part}, ${catalog.color(p.color).name}`}
                    className="studs-fine relative aspect-square rounded-2xl border border-line bg-surface-2"
                  >
                    <PartThumb part={p.part} color={p.color} className="size-full p-1.5" />
                    <span className="tabular absolute bottom-1 right-1 rounded-full bg-ink px-1.5 text-[11px] font-bold leading-5 text-bg">{p.qty * copies}</span>
                  </div>
                ))}
              </div>
              {selected.length > PREVIEW && <p className="mt-2.5 text-center text-sm text-ink-3">and {selected.length - PREVIEW} more kinds of piece</p>}
            </>
          )}
        </div>
      ),
      footer: (
        <Button variant="accent" size="lg" className="w-full" disabled={!pieces || !perCopy || adding} onClick={add}>
          {adding ? <Spinner /> : pieces ? `Add ${(perCopy * copies).toLocaleString()} pieces to collection` : 'Opening the box'}
        </Button>
      ),
    };
  }

  return {
    title: null,
    body: (
      <>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Set number or name: 75192, creative brick box..."
            className="h-13 w-full rounded-[20px] border border-line bg-surface-2 pl-12 pr-4 text-base outline-none placeholder:text-ink-3 focus:border-ink"
          />
        </label>
        {loadError ? (
          <p className="py-12 text-center text-ink-2">{loadError}</p>
        ) : !sets ? (
          <div className="flex items-center justify-center gap-3 py-12 text-ink-2">
            <Spinner /> Loading sets
          </div>
        ) : deferred.trim() === '' ? (
          <div className="py-10 text-center">
            <p className="text-ink-2">Find a set you own among {sets.size.toLocaleString()} sets. The number is printed on the box and the instructions.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuery(example)}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink-2 transition hover:border-line-strong hover:text-ink active:scale-95"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <p className="py-12 text-center text-ink-2">No set matches "{deferred}".</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {results.map((set) => (
              <li key={set.num}>
                <button
                  type="button"
                  onClick={() => pick(set)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-left transition hover:border-line-strong hover:shadow-soft"
                >
                  <SetImage src={set.image} className="size-[72px] shrink-0 rounded-xl" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">{set.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      <span className="font-mono">{set.num}</span> · {set.year} · {set.theme}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-ink-2">
                      {set.count.toLocaleString()} pieces
                      {ownedCopies(set.num) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brick-green/15 px-1.5 py-0.5 text-brick-green">
                          <Check className="size-3" strokeWidth={3} /> In collection
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    ),
  };
}
