import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Placement } from '../../shared/build.ts';
import { useCatalog } from '../lib/catalog.ts';
import { Stage, type StepState } from '../lib/stage.ts';
import { Spinner } from './ui.tsx';

export interface ModelViewHandle {
  resetView: () => void;
  snapshot: (width: number, height: number) => string | null;
}

/** Interactive 3D view of a build. With `step`, shows the model as it stands at that point in the instructions. */
export function ModelView({
  parts,
  step,
  autoRotate,
  className,
  ref,
  onReady,
}: {
  parts: Placement[];
  step?: StepState | null;
  autoRotate?: boolean;
  className?: string;
  ref?: Ref<ModelViewHandle>;
  onReady?: () => void;
}) {
  const catalog = useCatalog();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const stage = new Stage(canvasRef.current!);
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let live = true;
    setReady(false);
    void stage.setModel(parts, catalog.shapes).then(() => {
      if (!live) return;
      setReady(true);
      setVersion((v) => v + 1);
      onReadyRef.current?.();
    });
    return () => {
      live = false;
    };
  }, [parts, catalog]);

  useEffect(() => {
    if (ready) stageRef.current?.showStep(step ?? null);
    // `version` re-applies the step after a new model has been built.
  }, [ready, version, step?.index, step?.emphasize, step?.steps]);

  useEffect(() => {
    if (stageRef.current) stageRef.current.autoRotate = Boolean(autoRotate) && ready;
  }, [autoRotate, ready]);

  useImperativeHandle(ref, () => ({
    resetView: () => stageRef.current?.resetView(),
    snapshot: (width, height) => stageRef.current?.snapshot(width, height) ?? null,
  }));

  return (
    // The caller positions and sizes the outer box; the canvas fills it without ever influencing its size.
    <div className={className}>
      <div className="relative size-full">
        <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-3">
            <Spinner className="size-7" />
          </div>
        )}
      </div>
    </div>
  );
}
