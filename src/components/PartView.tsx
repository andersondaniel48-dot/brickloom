import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../lib/catalog.ts';
import { Stage } from '../lib/stage.ts';
import { PartThumb } from './PartThumb.tsx';
import { cx } from './ui.tsx';

/** A single part you can spin around. Falls back to a still picture when the part has no 3D model. */
export function PartView({ part, color, image, className }: { part: string; color: number; image?: string; className?: string }) {
  const catalog = useCatalog();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const geometry = catalog.part(part)?.geometry ?? null;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const stage = new Stage(canvasRef.current);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !geometry) return;
    let live = true;
    void stage.setPart(geometry, color).then((ok) => {
      if (!live) return;
      setShown(ok);
      stage.autoRotate = ok;
    });
    return () => {
      live = false;
    };
  }, [geometry, color]);

  return (
    <div className={className}>
      <div className="relative size-full">
        <canvas ref={canvasRef} className={cx('absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing', !shown && 'invisible')} />
        {!shown && <PartThumb part={part} color={color} image={image} eager className="absolute inset-0 p-6" />}
      </div>
    </div>
  );
}
