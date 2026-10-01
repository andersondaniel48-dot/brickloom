import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCatalog, type CatalogColor } from '../lib/catalog.ts';
import { hexToRgb } from '../lib/color.ts';
import { ColorDot, cx } from './ui.tsx';

/** Hue-ordered sort key so the swatch grid reads as a spectrum, with neutrals first. */
function spectrumKey(c: CatalogColor): number {
  const [r, g, b] = hexToRgb(c.rgb).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const light = (max + min) / 2;
  if (d < 0.09) return light; // neutrals: 0..1, dark to light
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  if (hue < 0) hue += 6;
  return 10 + Math.round(hue * 4) * 10 + (1 - light);
}

/**
 * Swatch grid for choosing a color. `suggested` colors (for example the closest matches to a photo,
 * or the colors a part was made in) are offered first.
 */
export function ColorPicker({
  value,
  onChange,
  suggested = [],
  suggestedLabel = 'Suggested',
}: {
  value: number | null;
  onChange: (color: number) => void;
  suggested?: number[];
  suggestedLabel?: string;
}) {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');

  const all = useMemo(() => catalog.colorList.slice().sort((a, b) => Number(a.trans) - Number(b.trans) || spectrumKey(a) - spectrumKey(b)), [catalog]);
  const q = query.trim().toLowerCase();
  const filtered = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;

  const swatch = (c: CatalogColor) => (
    <button
      key={c.id}
      type="button"
      onClick={() => onChange(c.id)}
      title={c.name}
      aria-label={c.name}
      aria-pressed={c.id === value}
      className={cx('flex size-11 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95')}
    >
      <ColorDot color={c} size={34} selected={c.id === value} />
    </button>
  );

  return (
    <div>
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search colors"
          className="h-11 w-full rounded-2xl border border-line bg-surface-2 pl-10 pr-4 text-[15px] outline-none placeholder:text-ink-3 focus:border-ink"
        />
      </label>
      {!q && suggested.length > 0 && (
        <>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">{suggestedLabel}</h3>
          <div className="mb-4 flex flex-wrap gap-1">{suggested.map((id) => swatch(catalog.color(id)))}</div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-3">All colors</h3>
        </>
      )}
      <div className="flex flex-wrap gap-1">{filtered.map(swatch)}</div>
      {filtered.length === 0 && <p className="py-6 text-center text-ink-3">No color called "{query}".</p>}
      {value !== null && <p className="mt-4 text-center text-sm font-semibold">{catalog.color(value).name}</p>}
    </div>
  );
}
