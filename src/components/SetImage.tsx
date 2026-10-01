import { Package } from 'lucide-react';
import { useState } from 'react';
import { cx } from './ui.tsx';

/** Box picture of a set, with a quiet placeholder for the sets that have none. */
export function SetImage({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cx('flex items-center justify-center overflow-hidden bg-white', className)}>
      {failed ? (
        <Package className="size-2/5 text-[#b9bec7]" strokeWidth={1.5} />
      ) : (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="size-full object-contain p-1" />
      )}
    </span>
  );
}
