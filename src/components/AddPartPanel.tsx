import { ArrowLeft, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useCatalog, type PartInfo } from '../lib/catalog.ts';
import { addPieces } from '../lib/db.ts';
import type { AddPanel } from './AddSheet.tsx';
import { ColorPicker } from './ColorPicker.tsx';
import { PartThumb } from './PartThumb.tsx';
import { Button, IconButton, Stepper, toast } from './ui.tsx';

const NEUTRAL = 71; // Light Bluish Gray: shows a part's shape clearly

/** Search the whole catalog and add a single kind of piece by hand. */
export function usePartPanel(active: boolean): AddPanel {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [picked, setPicked] = useState<PartInfo | null>(null);
  const [color, setColor] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [made, setMade] = useState<number[]>([]);

  const results = useMemo(() => (active ? catalog.search(deferred, { limit: 40 }) : []), [catalog, deferred, active]);

  useEffect(() => {
    if (!active) {
      setPicked(null);
      setQuery('');
    }
  }, [active]);

  const pick = async (part: PartInfo) => {
    setPicked(part);
    setQty(1);
    setColor(null);
    setMade([]);
    const colors = await catalog.colorsFor(part.id);
    setMade(colors);
    if (colors.length === 1) setColor(colors[0]);
  };

  if (picked) {
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
        <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
          <div className="studs flex aspect-square items-center justify-center rounded-3xl bg-surface-2">
            <PartThumb part={picked.id} color={color ?? NEUTRAL} eager className="size-full p-5" />
          </div>
          <ColorPicker value={color} onChange={setColor} suggested={made.slice(0, 40)} suggestedLabel="Made in these colors" />
        </div>
      ),
      footer: (
        <div className="flex items-center justify-between gap-3">
          <Stepper value={qty} min={1} onChange={setQty} />
          <Button
            variant="accent"
            disabled={color === null}
            onClick={async () => {
              await addPieces([{ part: picked.id, color: color!, qty }]);
              toast(`Added ${qty} × ${picked.name}`);
              setPicked(null);
            }}
          >
            {color === null ? 'Choose a color' : `Add ${qty} to collection`}
          </Button>
        </div>
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
            placeholder="Name or part number: brick 2x4, 3001, arch..."
            className="h-13 w-full rounded-[20px] border border-line bg-surface-2 pl-12 pr-4 text-base outline-none placeholder:text-ink-3 focus:border-ink"
          />
        </label>
        {deferred.trim() === '' ? (
          <p className="py-12 text-center text-ink-2">Search all {catalog.size.toLocaleString()} parts in the catalog.</p>
        ) : results.length === 0 ? (
          <p className="py-12 text-center text-ink-2">No part matches "{deferred}".</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {results.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => void pick(part)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-left transition hover:border-line-strong hover:shadow-soft"
                >
                  <span className="studs-fine size-16 shrink-0 rounded-xl bg-surface-2">
                    <PartThumb part={part.id} color={NEUTRAL} className="size-full p-1.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">{part.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      <span className="font-mono">{part.id}</span> · {catalog.categoryName(part.category)}
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
