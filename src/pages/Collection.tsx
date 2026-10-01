import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownWideNarrow, ExternalLink, Hammer, LayoutGrid, Package, Palette, Plus, ScanLine, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AddSheet, type AddMode } from '../components/AddSheet.tsx';
import { ColorPicker } from '../components/ColorPicker.tsx';
import { PartThumb } from '../components/PartThumb.tsx';
import { PartView } from '../components/PartView.tsx';
import { SetImage } from '../components/SetImage.tsx';
import { Button, Chip, ColorDot, EmptyState, IconButton, PageHeader, Segmented, Sheet, Stepper, toast } from '../components/ui.tsx';
import { useCatalog, type Catalog } from '../lib/catalog.ts';
import { db, recolor, removeSet, setQuantity, type InventoryRow, type OwnedSetRow } from '../lib/db.ts';
import { rowName, useInventory, useStats } from '../lib/inventory.ts';

type GroupBy = 'type' | 'color' | 'none';
type SortBy = 'count' | 'recent' | 'name';

/** Shape-based traits a builder sorts by, derived from the catalog entry. */
const TRAITS: { id: string; label: string; test: (row: InventoryRow, catalog: Catalog) => boolean }[] = [
  { id: 'buildable', label: 'Ready to build', test: (r, c) => c.isBuildable(r.part) },
  { id: 'studded', label: 'Studs on top', test: (r, c) => c.shapes[r.part]?.stud.some((s) => s >= 0) ?? false },
  { id: 'smooth', label: 'Smooth top', test: (r, c) => (c.shapes[r.part] ? c.shapes[r.part].stud.every((s) => s < 0) : /\btile\b/i.test(rowName(r, c))) },
  { id: 'sloped', label: 'Sloped', test: (r, c) => /slope|wedge/i.test(rowName(r, c)) },
  { id: 'round', label: 'Round', test: (r, c) => /round|cone|cylinder|dish|curved|arch/i.test(rowName(r, c)) },
  { id: 'trans', label: 'Transparent', test: (r, c) => c.color(r.color).trans },
  { id: 'printed', label: 'Printed', test: (r, c) => /\bprint|pattern|sticker/i.test(rowName(r, c)) },
];

export function CollectionPage() {
  const catalog = useCatalog();
  const rows = useInventory();
  const stats = useStats(rows, catalog);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('type');
  const [sortBy, setSortBy] = useState<SortBy>('count');
  const [colorFilter, setColorFilter] = useState<number | null>(null);
  const [traits, setTraits] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddMode | null>(null);
  const [lastMode, setLastMode] = useState<AddMode>('pieces');
  const [openSet, setOpenSet] = useState<string | null>(null);
  const ownedSets = useLiveQuery(() => db.sets.orderBy('addedAt').reverse().toArray(), []);
  const [params, setParams] = useSearchParams();

  const startAdding = (mode: AddMode) => {
    setLastMode(mode);
    setAdding(mode);
  };

  // Other screens link here with ?add=sets or ?add=pieces to open the sheet straight away.
  const requested = params.get('add');
  useEffect(() => {
    if (requested !== 'sets' && requested !== 'pieces') return;
    setLastMode(requested);
    setAdding(requested);
    setParams({}, { replace: true });
  }, [requested, setParams]);

  const groups = useMemo(() => {
    if (!rows) return [];
    const words = query.toLowerCase().replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ').split(/\s+/).filter(Boolean);
    const active = TRAITS.filter((t) => traits.has(t.id));
    const filtered = rows.filter((row) => {
      if (colorFilter !== null && row.color !== colorFilter) return false;
      if (active.some((t) => !t.test(row, catalog))) return false;
      if (!words.length) return true;
      const text = `${row.part} ${rowName(row, catalog)} ${catalog.color(row.color).name}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });

    const sorters: Record<SortBy, (a: InventoryRow, b: InventoryRow) => number> = {
      count: (a, b) => b.qty - a.qty || rowName(a, catalog).localeCompare(rowName(b, catalog), 'en', { numeric: true }),
      recent: (a, b) => b.updatedAt - a.updatedAt,
      name: (a, b) => rowName(a, catalog).localeCompare(rowName(b, catalog), 'en', { numeric: true }) || a.color - b.color,
    };
    filtered.sort(sorters[sortBy]);

    if (groupBy === 'none') return [{ id: 'all', title: '', dot: null, rows: filtered, qty: 0 }];
    const map = new Map<number, InventoryRow[]>();
    for (const row of filtered) {
      const key = groupBy === 'color' ? row.color : (catalog.part(row.part)?.category ?? -1);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map]
      .map(([key, list]) => ({
        id: String(key),
        title: groupBy === 'color' ? catalog.color(key).name : key === -1 ? 'Not in catalog' : catalog.categoryName(key),
        dot: groupBy === 'color' ? catalog.color(key) : null,
        rows: list,
        qty: list.reduce((n, r) => n + r.qty, 0),
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [rows, query, groupBy, sortBy, colorFilter, traits, catalog]);

  if (!rows) return null;
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const open = openKey ? rows.find((r) => r.key === openKey) : undefined;

  const toggleTrait = (id: string) =>
    setTraits((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Collection"
        subtitle={rows.length ? `${stats.pieces.toLocaleString()} pieces across ${stats.elements.toLocaleString()} elements` : undefined}
        action={
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => startAdding('sets')} aria-label="Add a set">
              <Package className="size-5" /> <span className="hidden sm:inline">Add a set</span>
            </Button>
            <Button variant="primary" onClick={() => startAdding('pieces')} aria-label="Add pieces">
              <Plus className="size-5" /> <span className="hidden sm:inline">Add pieces</span>
            </Button>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-8" />}
          title="Nothing here yet"
          body="Scan a handful of bricks, add a whole set you own by its number, or pick single pieces from the catalog of every part ever made."
          action={
            <>
              <Button variant="accent" onClick={() => navigate('/scan')}>
                <ScanLine className="size-5" /> Scan bricks
              </Button>
              <Button onClick={() => startAdding('sets')}>
                <Package className="size-5" /> Add a set
              </Button>
              <Button onClick={() => startAdding('pieces')}>
                <Search className="size-5" /> Search pieces
              </Button>
            </>
          }
        />
      ) : (
        <>
          {/* Search */}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your pieces: 2x4, slope, red..."
              className="h-13 w-full rounded-[20px] border border-line bg-surface pl-12 pr-11 text-base shadow-soft outline-none placeholder:text-ink-3 focus:border-ink"
            />
            {query && (
              <IconButton label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <X className="size-4" />
              </IconButton>
            )}
          </label>

          {/* Sets that were added whole */}
          {ownedSets && ownedSets.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8">
              {ownedSets.map((set) => (
                <button
                  key={set.num}
                  type="button"
                  onClick={() => setOpenSet(set.num)}
                  className="card flex w-60 shrink-0 items-center gap-3 p-2 text-left transition-shadow hover:shadow-card"
                >
                  <SetImage src={set.image} className="size-14 shrink-0 rounded-xl" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{set.name}</span>
                    <span className="block truncate text-xs text-ink-3">
                      <span className="font-mono">{set.num}</span>
                      {set.copies > 1 && ` · ${set.copies} copies`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Arrange */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-ink-3" aria-hidden />
              <Segmented
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: 'type', label: 'Type' },
                  { value: 'color', label: 'Color' },
                  { value: 'none', label: 'All' },
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <ArrowDownWideNarrow className="size-4 text-ink-3" aria-hidden />
              <Segmented
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: 'count', label: 'Most' },
                  { value: 'recent', label: 'Newest' },
                  { value: 'name', label: 'A to Z' },
                ]}
              />
            </div>
          </div>

          {/* Filter */}
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8">
            {TRAITS.map((trait) => (
              <Chip key={trait.id} active={traits.has(trait.id)} onClick={() => toggleTrait(trait.id)}>
                {trait.id === 'buildable' && <Hammer className="size-3.5" />}
                {trait.label}
              </Chip>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 mt-2 flex items-center gap-1 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
            <Palette className="mr-1.5 size-4 shrink-0 text-ink-3" aria-hidden />
            {stats.byColor.map(({ color }) => (
              <button
                key={color}
                type="button"
                aria-label={catalog.color(color).name}
                aria-pressed={colorFilter === color}
                onClick={() => setColorFilter(colorFilter === color ? null : color)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110"
              >
                <ColorDot color={catalog.color(color)} size={26} selected={colorFilter === color} />
              </button>
            ))}
          </div>

          {/* Pieces */}
          {shown === 0 ? (
            <p className="py-16 text-center text-ink-2">No pieces match. Try fewer filters.</p>
          ) : (
            groups.map((group) => (
              <section key={group.id} className="mt-5">
                {group.title && (
                  <h2 className="sticky top-0 z-10 -mx-4 flex items-center gap-2.5 bg-bg/90 px-4 py-2.5 text-lg font-semibold backdrop-blur-md sm:-mx-8 sm:px-8">
                    {group.dot && <ColorDot color={group.dot} size={18} />}
                    {group.title}
                    <span className="tabular rounded-full bg-ink/7 px-2 py-0.5 text-xs font-bold text-ink-2">{group.qty.toLocaleString()}</span>
                  </h2>
                )}
                <div className="grid grid-cols-2 gap-3 xs:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {group.rows.map((row) => (
                    <ElementCard key={row.key} row={row} onOpen={() => setOpenKey(row.key)} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}

      <ElementSheet row={open} onClose={() => setOpenKey(null)} onMoved={setOpenKey} />
      <OwnedSetSheet set={ownedSets?.find((s) => s.num === openSet)} onClose={() => setOpenSet(null)} />
      <AddSheet open={adding !== null} mode={adding ?? lastMode} onClose={() => setAdding(null)} />
    </>
  );
}

function ElementCard({ row, onOpen }: { row: InventoryRow; onOpen: () => void }) {
  const catalog = useCatalog();
  const color = catalog.color(row.color);
  return (
    <button type="button" onClick={onOpen} className="card group flex flex-col overflow-hidden text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <div className="studs-fine relative aspect-[5/4] w-full bg-surface-2">
        <PartThumb part={row.part} color={row.color} image={row.image} className="size-full p-3 transition-transform duration-300 group-hover:scale-105" />
        <span className="tabular absolute right-2.5 top-2.5 rounded-full bg-ink px-2.5 py-0.5 font-display text-sm font-bold text-bg">×{row.qty}</span>
        {catalog.isBuildable(row.part) && (
          <span title="The designer can build with this piece" className="absolute left-2.5 top-2.5 flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Hammer className="size-3.5" strokeWidth={2.5} />
          </span>
        )}
      </div>
      <div className="flex min-h-[68px] flex-col justify-between gap-1 p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-snug">{rowName(row, catalog)}</div>
        <div className="flex items-center gap-1.5 text-xs text-ink-3">
          <ColorDot color={color} size={11} />
          <span className="truncate">{color.name}</span>
          <span className="ml-auto shrink-0 font-mono">{row.part}</span>
        </div>
      </div>
    </button>
  );
}

function OwnedSetSheet({ set, onClose }: { set: OwnedSetRow | undefined; onClose: () => void }) {
  const total = set?.pieces.reduce((n, p) => n + p[2], 0) ?? 0;
  return (
    <Sheet
      open={Boolean(set)}
      onClose={onClose}
      title={set?.name}
      footer={
        set && (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              if (!confirm(`Take the ${total.toLocaleString()} pieces of "${set.name}" back out of your collection?`)) return;
              const removed = await removeSet(set.num);
              toast(`Removed ${removed.toLocaleString()} pieces`);
              onClose();
            }}
          >
            <Trash2 className="size-4" /> Remove this set and its pieces
          </Button>
        )
      }
    >
      {set && (
        <>
          <div className="flex items-center gap-4">
            <SetImage src={set.image} className="size-28 shrink-0 rounded-3xl border border-line" />
            <div className="min-w-0">
              <div className="font-mono text-sm text-ink-3">{set.num}</div>
              <div className="text-[15px] font-semibold">
                {set.year} · {set.theme}
              </div>
              <div className="tabular mt-1.5 font-display text-3xl font-bold">{total.toLocaleString()}</div>
              <div className="text-sm text-ink-2">
                pieces added{set.copies > 1 ? ` from ${set.copies} copies` : ''} on {new Date(set.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          </div>
          <p className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
            Removing the set takes the same pieces back out. Pieces you have since removed by hand are simply skipped.
          </p>
        </>
      )}
    </Sheet>
  );
}

function ElementSheet({ row, onClose, onMoved }: { row: InventoryRow | undefined; onClose: () => void; onMoved: (key: string) => void }) {
  const catalog = useCatalog();
  const [pickingColor, setPickingColor] = useState(false);
  const [partColors, setPartColors] = useState<number[]>([]);

  if (!row) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const info = catalog.part(row.part);
  const color = catalog.color(row.color);
  const shape = catalog.shapes[row.part];

  const openColors = async () => {
    setPartColors(await catalog.colorsFor(row.part));
    setPickingColor(true);
  };

  return (
    <>
      <Sheet
        open={!pickingColor}
        onClose={onClose}
        title={rowName(row, catalog)}
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="danger"
              onClick={async () => {
                await setQuantity(row.key, 0);
                toast('Removed from collection');
                onClose();
              }}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
            <Stepper value={row.qty} min={1} onChange={(qty) => void setQuantity(row.key, qty)} />
          </div>
        }
      >
        <div className="studs relative mb-4 aspect-[4/3] overflow-hidden rounded-3xl bg-surface-2">
          <PartView part={row.part} color={row.color} image={row.image} className="size-full" />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">Part number</dt>
            <dd className="font-mono font-semibold">{row.part}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">Type</dt>
            <dd className="font-semibold">{info ? catalog.categoryName(info.category) : 'Not in catalog'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">Color</dt>
            <dd>
              <button type="button" onClick={openColors} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pl-1.5 pr-3 font-semibold hover:border-line-strong">
                <ColorDot color={color} size={20} /> {color.name}
              </button>
            </dd>
          </div>
          {shape && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-3">Size</dt>
              <dd className="font-semibold">
                {Math.min(shape.w, shape.d)} × {Math.max(shape.w, shape.d)} studs, {shape.h % 3 === 0 ? `${shape.h / 3} brick${shape.h === 3 ? '' : 's'}` : `${shape.h} plate${shape.h === 1 ? '' : 's'}`} tall
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
          <Hammer className="mt-0.5 size-4 shrink-0" />
          {shape ? 'The designer can use this piece in new builds.' : 'The designer cannot place this piece yet. It still counts toward your collection.'}
        </p>
        {info && (
          <a
            href={`https://rebrickable.com/parts/${encodeURIComponent(row.part)}/`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink"
          >
            View on Rebrickable <ExternalLink className="size-3.5" />
          </a>
        )}
      </Sheet>

      <Sheet open={pickingColor} onClose={() => setPickingColor(false)} title="Change color">
        <ColorPicker
          value={row.color}
          suggested={partColors.slice(0, 40)}
          suggestedLabel="Made in these colors"
          onChange={async (next) => {
            await recolor(row.key, next);
            onMoved(`${row.part}|${next}`);
            setPickingColor(false);
          }}
        />
      </Sheet>
    </>
  );
}
