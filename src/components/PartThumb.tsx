import { Shapes } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../lib/catalog.ts';
import { useThumb } from '../lib/thumbs.ts';
import { cx } from './ui.tsx';

/**
 * Picture of a part in a color, rendered from its real geometry once it scrolls into view.
 * Falls back to `image` (for example the photo a scan produced) when the part has no 3D model.
 */
export function PartThumb({ part, color, image, className, eager }: { part: string; color: number; image?: string; className?: string; eager?: boolean }) {
  const catalog = useCatalog();
  const holder = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(Boolean(eager));
  const geometry = catalog.part(part)?.geometry ?? null;
  const url = useThumb(geometry, color, seen);

  useEffect(() => {
    if (seen || !holder.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [seen]);

  const src = url ?? (url === null ? image : undefined);
  return (
    <div ref={holder} className={cx('relative flex items-center justify-center', className)}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className={cx('size-full select-none object-contain', url ? 'animate-[pop-in_0.28s_var(--ease-spring)]' : 'rounded-xl bg-white p-1')}
        />
      ) : url === undefined ? (
        <div className="shimmer size-3/5 rounded-2xl" />
      ) : (
        <Shapes className="size-2/5 text-ink-3/60" strokeWidth={1.5} />
      )}
    </div>
  );
}
