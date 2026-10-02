import { AlertTriangle, Camera, Check, ChevronRight, CircleHelp, Flashlight, ImageUp, RotateCcw, ScanLine, Search, SwitchCamera, TestTubeDiagonal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorPicker } from '../components/ColorPicker.tsx';
import { PartThumb } from '../components/PartThumb.tsx';
import { Button, ColorDot, IconButton, Sheet, Spinner, Stepper, cx, toast } from '../components/ui.tsx';
import { useCatalog, type PartInfo } from '../lib/catalog.ts';
import { addPieces, type NewPiece } from '../lib/db.ts';
import type { Candidate } from '../lib/scan/identify.ts';
import { LiveFinder } from '../lib/scan/live.ts';
import { captureStill, matchColor, runScan, sampleTray, toCanvas, type Detection } from '../lib/scan/session.ts';
import { Tracker, type Box, type Track } from '../lib/scan/tracker.ts';

type CameraState = 'starting' | 'live' | 'denied' | 'unavailable';

/** The viewfinder's frames are examined at this size (on the longer side), a few times a second. */
const PREVIEW_SIZE = 480;
const PREVIEW_EVERY = 140;

/** Largest box of the given aspect ratio that fits inside the element the returned ref is attached to. */
function useFit(aspect: number) {
  // Held in state so that a replaced element is measured and observed afresh.
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // A hidden element measures as nothing. Keep the last real size, so it is right when shown again.
      if (!w || !h) return;
      setSize(w / h > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, aspect]);
  return [ref, size] as const;
}

export function ScanPage() {
  const catalog = useCatalog();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const capturing = useRef(false);
  const tracker = useRef(new Tracker());

  const [camera, setCamera] = useState<CameraState>('starting');
  const [attempt, setAttempt] = useState(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torch, setTorch] = useState<boolean | null>(null); // null: not supported
  const [aspect, setAspect] = useState(4 / 3);
  const [live, setLive] = useState<Track[]>([]);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewRef, viewSize] = useFit(aspect);

  // ---------------------------------------------------------------- camera

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // The camera stays open for as long as this page does, including while a scan is being reviewed:
  // "Retake" is then instant, and phones that ask for permission every time the camera opens ask once.
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    let cancelled = false;
    setCamera('starting');
    navigator.mediaDevices
      // As much detail as the camera will give: recognition depends on how many pixels each piece gets.
      .getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (cancelled) return;
        setAspect(video.videoWidth / video.videoHeight || 4 / 3);
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }) | undefined;
        setTorch(capabilities?.torch ? false : null);
        if (capabilities?.focusMode?.includes('continuous')) {
          void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
        setCamera('live');
      })
      .catch((err: DOMException) => !cancelled && setCamera(err.name === 'NotAllowedError' ? 'denied' : 'unavailable'));
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [facing, attempt, stopCamera]);

  // The picture changes shape when the phone is turned.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onResize = () => video.videoWidth && video.videoHeight && setAspect(video.videoWidth / video.videoHeight);
    video.addEventListener('resize', onResize);
    return () => video.removeEventListener('resize', onResize);
  }, []);

  // Phones cut the camera off while the app is in the background. Pick it back up on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') setAttempt((n) => n + 1);
      else void videoRef.current?.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Live preview of what a capture would pick up: each frame's finds are fed to the tracker,
  // which keeps hold of a piece through the odd frame that misses it.
  useEffect(() => {
    if (camera !== 'live' || photo) return;
    const finder = new LiveFinder();
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const started = performance.now();
        const video = videoRef.current;
        if (video && video.readyState >= 2 && !document.hidden) {
          const found = await finder.find(video, PREVIEW_SIZE);
          if (stopped) break;
          setLive(tracker.current.update(found));
        }
        await new Promise((resolve) => setTimeout(resolve, Math.max(30, PREVIEW_EVERY - (performance.now() - started))));
      }
    })();
    return () => {
      stopped = true;
      finder.close();
    };
  }, [camera, photo]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorch(!torch);
  };

  // ---------------------------------------------------------------- scanning

  const scan = useCallback(
    (canvas: HTMLCanvasElement, lockedOn: Box[] = []) => {
      scanAbort.current?.abort();
      const abort = new AbortController();
      scanAbort.current = abort;
      setPhoto(canvas);
      setDetections([]);
      setBusy(true);
      void runScan(canvas, catalog, setDetections, abort.signal, lockedOn).finally(() => !abort.signal.aborted && setBusy(false));
    },
    [catalog],
  );

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || capturing.current) return;
    capturing.current = true;
    navigator.vibrate?.(12);
    try {
      scan(await captureStill(video), tracker.current.locked());
    } finally {
      capturing.current = false;
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      scan(toCanvas(bitmap));
      bitmap.close();
    } catch {
      toast('That file could not be read as a photo', 'error');
    }
  };

  const reset = () => {
    scanAbort.current?.abort();
    setPhoto(null);
    setDetections([]);
    setBusy(false);
    tracker.current.reset();
    setLive([]);
    // Some browsers pause a video while it is hidden.
    void videoRef.current?.play().catch(() => undefined);
  };

  useEffect(() => () => scanAbort.current?.abort(), []);

  const update = (id: number, patch: Partial<Detection>) => setDetections((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const lockedOn = live.filter((t) => t.locked).length;
  const included = detections.filter((d) => d.included && d.candidates[d.choice] && d.color !== null);
  const total = included.reduce((n, d) => n + d.qty, 0);

  const addAll = async () => {
    const pieces: NewPiece[] = included.map((d) => {
      const candidate = d.candidates[d.choice];
      return candidate.part
        ? { part: candidate.part.id, color: d.color!, qty: d.qty }
        : // Not in our catalog (a minifigure, a rare part): keep it under the recognizer's id with its picture.
          { part: `bl-${candidate.externalId}`, color: d.color!, qty: d.qty, name: candidate.name, image: candidate.image };
    });
    await addPieces(pieces);
    toast(`Added ${total} piece${total === 1 ? '' : 's'} to your collection`);
    reset();
  };

  // ---------------------------------------------------------------- render

  const fileInput = (
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (void onFile(e.target.files?.[0]), (e.target.value = ''))} />
  );

  return (
    <>
    {photo && <Review photo={photo} detections={detections} busy={busy} total={total} onUpdate={update} onRetake={reset} onAdd={addAll} />}
    <div className={cx('relative h-dvh flex-col bg-[#0b0c0f] text-white short:flex-row', photo ? 'hidden' : 'flex')}>
      {fileInput}

      {/* Viewfinder */}
      <div ref={viewRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div className="relative" style={viewSize}>
          <video ref={videoRef} playsInline muted className={cx('size-full object-contain', camera !== 'live' && 'invisible')} />
          {camera === 'live' &&
            live.map((t) => (
              <div
                key={t.id}
                className={cx(
                  'pointer-events-none absolute rounded-xl border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] transition-all duration-150 ease-linear',
                  // Locked on: solid. Only just seen: faint, until it has been seen a few times.
                  t.locked ? 'border-accent' : 'border-white/55',
                  t.held && 'opacity-70',
                )}
                style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%` }}
              />
            ))}
        </div>

        {camera !== 'live' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            {camera === 'starting' ? (
              <div className="flex flex-col items-center gap-4 text-white/70">
                <Spinner className="size-8" />
                Starting the camera
              </div>
            ) : (
              <div className="max-w-sm text-center">
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[22px] bg-accent text-accent-ink">
                  <Camera className="size-8" />
                </div>
                <h1 className="text-2xl font-semibold">{camera === 'denied' ? 'Camera access is off' : 'No camera here'}</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-white/65">
                  {camera === 'denied'
                    ? 'Allow camera access for this site in your browser settings to scan live. You can still scan from a photo.'
                    : 'You can scan from a photo instead: lay pieces on a plain surface and take a picture from above.'}
                </p>
                <div className="mt-6 flex flex-col items-center gap-3">
                  <Button variant="accent" size="lg" onClick={() => fileRef.current?.click()}>
                    <ImageUp className="size-5" /> Choose a photo
                  </Button>
                  <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={async () => scan(await sampleTray(catalog))}>
                    <TestTubeDiagonal className="size-5" /> Try a sample tray
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Guidance */}
        {camera === 'live' && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-4 short:pt-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={lockedOn ? 'count' : live.length ? 'steady' : 'hint'}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-full bg-black/55 px-4 py-2 text-sm font-semibold backdrop-blur-md"
              >
                {lockedOn ? (
                  <span className="flex items-center gap-2">
                    <span className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink">{lockedOn}</span>
                    piece{lockedOn === 1 ? '' : 's'} locked on
                  </span>
                ) : live.length ? (
                  'Hold steady'
                ) : (
                  'Spread pieces on a plain surface, not touching'
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="relative z-10 flex shrink-0 items-center justify-center gap-10 bg-[#0b0c0f] px-6 pb-28 pt-5 short:flex-col-reverse short:gap-7 short:px-5 short:pb-0 short:pt-0 lg:pb-8">
        <IconButton label="Scan from a photo" onClick={() => fileRef.current?.click()} className="size-12 bg-white/10 text-white hover:bg-white/20 hover:text-white">
          <ImageUp className="size-5" />
        </IconButton>
        <button
          type="button"
          aria-label="Scan these pieces"
          disabled={camera !== 'live'}
          onClick={capture}
          className="group flex size-[84px] items-center justify-center rounded-full border-[5px] border-white/90 transition-transform active:scale-90 disabled:opacity-30"
        >
          <span className="flex size-[64px] items-center justify-center rounded-full bg-accent text-accent-ink transition-transform group-hover:scale-105">
            <ScanLine className="size-8" strokeWidth={2.4} />
          </span>
        </button>
        {torch !== null ? (
          <IconButton label="Light" onClick={toggleTorch} className={cx('size-12 hover:text-white', torch ? 'bg-accent text-accent-ink hover:bg-accent hover:text-accent-ink' : 'bg-white/10 text-white hover:bg-white/20')}>
            <Flashlight className="size-5" />
          </IconButton>
        ) : (
          <IconButton
            label="Switch camera"
            disabled={camera !== 'live'}
            onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
            className="size-12 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <SwitchCamera className="size-5" />
          </IconButton>
        )}
      </div>
    </div>
    </>
  );
}

// ---------------------------------------------------------------- review

/** The captured photo, drawn at screen size. Much quicker than encoding a full-resolution capture as an image. */
function Photo({ source, className }: { source: HTMLCanvasElement; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const scale = Math.min(1, 1400 / Math.max(source.width, source.height));
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [source]);
  return <canvas ref={ref} role="img" aria-label="Your scan" className={className} />;
}

function Review({
  photo,
  detections,
  busy,
  total,
  onUpdate,
  onRetake,
  onAdd,
}: {
  photo: HTMLCanvasElement;
  detections: Detection[];
  busy: boolean;
  total: number;
  onUpdate: (id: number, patch: Partial<Detection>) => void;
  onRetake: () => void;
  onAdd: () => void;
}) {
  const catalog = useCatalog();
  const aspect = photo.width / photo.height;
  const [matching, setMatching] = useState<number | null>(null);
  const [coloring, setColoring] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const done = detections.filter((d) => d.status !== 'identifying').length;
  // A region covering the entire frame is the fallback for when nothing could be told apart from the background.
  const wholeFrame = detections.length === 1 && detections[0].region.w === 1 && detections[0].region.h === 1;
  const matchTarget = detections.find((d) => d.id === matching);
  const colorTarget = detections.find((d) => d.id === coloring);

  const choose = async (d: Detection, patch: { choice?: number; manual?: PartInfo }) => {
    const next: Detection = { ...d, included: true, status: 'done' };
    if (patch.manual) {
      // A part picked from the catalog by hand becomes the accepted candidate.
      const manual: Candidate = { externalId: patch.manual.id, name: patch.manual.name, score: 1, image: '', part: patch.manual };
      next.candidates = [manual, ...d.candidates.filter((c) => c.part?.id !== patch.manual!.id)];
      next.choice = 0;
    } else if (patch.choice !== undefined) {
      next.choice = patch.choice;
    }
    await matchColor(next, catalog);
    // Keep a color the builder already corrected.
    if (d.color !== null && d.colors[0]?.color.id !== d.color) next.color = d.color;
    onUpdate(d.id, next);
    setMatching(null);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-44 pt-5 [--photo-height:44dvh] short:grid short:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] short:gap-5 short:pb-24 short:[--photo-height:62dvh] sm:px-8 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8 lg:pb-28 lg:pt-8">
      {/* The photo, with each found piece numbered */}
      <div className="short:sticky short:top-5 short:self-start lg:sticky lg:top-8 lg:self-start">
        {/* Sized so the box always has exactly the photo's shape: the piece outlines are placed as fractions of it. */}
        <div className="relative mx-auto overflow-hidden rounded-3xl bg-black shadow-card" style={{ aspectRatio: aspect, width: `min(100%, calc(var(--photo-height) * ${aspect}))` }}>
          <Photo source={photo} className="block size-full" />
          {busy && <div className="pointer-events-none absolute inset-x-0 top-0 h-1/4 animate-[scan-sweep_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-accent/35 to-transparent" />}
          {detections.length > 1 &&
            detections.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-label={`Piece ${d.id + 1}`}
                onClick={() => {
                  setFocus(d.id);
                  document.getElementById(`piece-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                className={cx(
                  'absolute rounded-lg border-2 transition-colors',
                  !d.included ? 'border-white/40' : d.status === 'identifying' ? 'border-white/80' : focus === d.id ? 'border-white' : 'border-accent',
                )}
                style={{ left: `${d.region.x * 100}%`, top: `${d.region.y * 100}%`, width: `${d.region.w * 100}%`, height: `${d.region.h * 100}%` }}
              >
                <span
                  className={cx(
                    'tabular absolute -left-0.5 -top-0.5 flex size-5 items-center justify-center rounded-md text-[11px] font-bold',
                    d.included ? 'bg-accent text-accent-ink' : 'bg-white/60 text-black',
                  )}
                >
                  {d.id + 1}
                </span>
              </button>
            ))}
        </div>
        <p className="mt-3 text-center text-xs text-ink-3">Each piece is cropped and sent to Brickognize to be identified.</p>
      </div>

      {/* Results */}
      <div className="mt-5 short:mt-0 lg:mt-0">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold leading-tight">
              {busy ? `Identifying ${done} of ${detections.length || '...'}` : `${detections.length} piece${detections.length === 1 ? '' : 's'} found`}
            </h1>
            <p className="text-[15px] text-ink-2">Tap a match or a color to correct it.</p>
          </div>
        </div>

        {wholeFrame && (
          <p className="mb-3 flex items-start gap-2.5 rounded-2xl border border-brick-amber/30 bg-brick-amber/10 p-3.5 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brick-amber" />
            <span>
              No separate pieces could be picked out, so the whole photo was read as one piece. To scan several at once, spread them on a plain surface so that none are touching.
            </span>
          </p>
        )}

        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {detections.map((d) => (
              <motion.li key={d.id} id={`piece-${d.id}`} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(d.id * 0.03, 0.4) }}>
                <DetectionCard
                  detection={d}
                  focused={focus === d.id}
                  numbered={detections.length > 1}
                  onMatch={() => setMatching(d.id)}
                  onChoose={(choice) => void choose(d, { choice })}
                  onColor={() => setColoring(d.id)}
                  onQty={(qty) => onUpdate(d.id, { qty })}
                  onToggle={() => onUpdate(d.id, { included: !d.included })}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      {/* Action bar */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 px-4 pt-3 backdrop-blur-xl short:left-[var(--rail)] lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center gap-3 sm:px-4">
          <Button onClick={onRetake} size="lg" className="px-5">
            <RotateCcw className="size-5" /> <span className="hidden xs:inline">Retake</span>
          </Button>
          <Button variant="accent" size="lg" className="flex-1" disabled={busy || total === 0} onClick={onAdd}>
            {busy ? (
              <>
                <Spinner /> Identifying
              </>
            ) : (
              <>
                <Check className="size-5" strokeWidth={3} /> Add {total} piece{total === 1 ? '' : 's'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Pick a different match */}
      <Sheet open={Boolean(matchTarget)} onClose={() => setMatching(null)} title="Which piece is it?" wide>
        {matchTarget && <MatchPicker detection={matchTarget} onChoose={(patch) => void choose(matchTarget, patch)} />}
      </Sheet>

      {/* Pick a different color */}
      <Sheet open={Boolean(colorTarget)} onClose={() => setColoring(null)} title="Which color is it?">
        {colorTarget && (
          <ColorPicker
            value={colorTarget.color}
            suggested={colorTarget.colors.map((c) => c.color.id)}
            suggestedLabel="Closest to the photo"
            onChange={(color) => {
              onUpdate(colorTarget.id, { color });
              setColoring(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function DetectionCard({
  detection: d,
  focused,
  numbered,
  onMatch,
  onChoose,
  onColor,
  onQty,
  onToggle,
}: {
  detection: Detection;
  focused: boolean;
  numbered: boolean;
  onMatch: () => void;
  onChoose: (choice: number) => void;
  onColor: () => void;
  onQty: (qty: number) => void;
  onToggle: () => void;
}) {
  const catalog = useCatalog();
  const candidate: Candidate | undefined = d.candidates[d.choice];
  const color = d.color !== null ? catalog.color(d.color) : null;
  const unsure = d.status === 'done' && candidate && candidate.score < 0.6;
  // When the best match is shaky, or a runner-up is nearly as good, offer the runners-up right on the card.
  const runnersUp = candidate
    ? d.candidates
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => i !== d.choice && c.image && (unsure || candidate.score - c.score < 0.12))
        .slice(0, 3)
    : [];

  return (
    <div className={cx('card p-2.5 transition-[opacity,box-shadow]', !d.included && 'opacity-55', focused && 'ring-2 ring-ink')}>
    {/* On a phone the color and count drop to a row of their own, leaving the width to the name. */}
    <div className="flex flex-wrap items-stretch gap-x-3 gap-y-2 sm:flex-nowrap">
      {/* What the camera saw */}
      <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-black sm:size-[72px]">
        <img src={d.crop} alt="" className="size-full object-cover" />
        {numbered && <span className="tabular absolute left-1 top-1 flex size-5 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-ink">{d.id + 1}</span>}
      </div>

      {d.status === 'identifying' ? (
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <div className="shimmer h-4 w-3/4 rounded-full" />
          <div className="shimmer h-3 w-1/2 rounded-full" />
        </div>
      ) : !candidate ? (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink-2">
            <CircleHelp className="size-5 shrink-0" />
            {d.status === 'error' ? 'Could not reach the recognizer' : 'Not recognized'}
          </div>
          <Button size="sm" onClick={onMatch}>
            <Search className="size-4" /> Find it
          </Button>
        </div>
      ) : (
        <>
          {/* What it was matched to */}
          <button type="button" onClick={onMatch} className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left">
            <span className="studs-fine size-16 shrink-0 rounded-2xl bg-surface-2 sm:size-[72px]">
              {candidate.part ? (
                <PartThumb part={candidate.part.id} color={d.color ?? 71} image={candidate.image} eager className="size-full p-1.5" />
              ) : (
                <img src={candidate.image} alt="" className="size-full rounded-2xl bg-white object-contain p-1" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{candidate.part?.name ?? candidate.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                <span className="font-mono">{candidate.part?.id ?? candidate.externalId}</span>
                {d.crowded ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brick-amber/15 px-1.5 py-0.5 font-semibold text-brick-amber" title="This area is much larger than the other pieces. Separate the pieces and scan again, or include it if it really is one piece.">
                    <AlertTriangle className="size-3" /> Several pieces touching?
                  </span>
                ) : unsure ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brick-amber/15 px-1.5 py-0.5 font-semibold text-brick-amber">
                    <AlertTriangle className="size-3" /> Check this
                  </span>
                ) : (
                  <span className="tabular">{Math.round(candidate.score * 100)}% sure</span>
                )}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
          </button>

          <div className="flex shrink-0 basis-full items-center justify-end gap-3 sm:basis-auto sm:flex-col sm:items-end sm:justify-between sm:gap-1.5">
            <div className="flex items-center gap-1">
              {color && (
                <button type="button" onClick={onColor} title={`${color.name} (tap to change)`} className="flex size-8 items-center justify-center rounded-full hover:bg-ink/5">
                  <ColorDot color={color} size={22} />
                </button>
              )}
              <IconButton label={d.included ? 'Leave this piece out' : 'Include this piece'} onClick={onToggle} className="size-8">
                {d.included ? <X className="size-4" /> : <RotateCcw className="size-4" />}
              </IconButton>
            </div>
            <Stepper size="sm" value={d.qty} min={1} onChange={onQty} />
          </div>
        </>
      )}
    </div>
    {runnersUp.length > 0 && (
      <div className="mt-2.5 flex items-center gap-2 overflow-x-auto border-t border-line pt-2.5">
        <span className="shrink-0 text-xs font-semibold text-ink-3">Or is it</span>
        {runnersUp.map(({ c, i }) => (
          <button
            key={i}
            type="button"
            onClick={() => onChoose(i)}
            title={c.part?.name ?? c.name}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-xs font-semibold hover:border-line-strong"
          >
            <img src={c.image} alt="" loading="lazy" className="size-9 rounded-full bg-white object-contain p-0.5" />
            <span className="font-mono">{c.part?.id ?? c.externalId}</span>
          </button>
        ))}
      </div>
    )}
    </div>
  );
}

function MatchPicker({ detection, onChoose }: { detection: Detection; onChoose: (patch: { choice?: number; manual?: PartInfo }) => void }) {
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const results = query.trim() ? catalog.search(query, { limit: 24 }) : [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-2.5">
        <img src={detection.crop} alt="" className="size-16 rounded-xl object-cover" />
        <p className="text-sm text-ink-2">Choose the piece that matches your photo, or search the full catalog.</p>
      </div>

      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or number"
          className="h-12 w-full rounded-2xl border border-line bg-surface-2 pl-12 pr-4 text-base outline-none placeholder:text-ink-3 focus:border-ink"
        />
      </label>

      <ul className="grid gap-2 sm:grid-cols-2">
        {query.trim()
          ? results.map((part) => (
              <li key={part.id}>
                <button type="button" onClick={() => onChoose({ manual: part })} className="flex w-full items-center gap-3 rounded-2xl border border-line p-2 text-left hover:border-line-strong">
                  <span className="studs-fine size-16 shrink-0 rounded-xl bg-surface-2">
                    <PartThumb part={part.id} color={detection.color ?? 71} className="size-full p-1.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">{part.name}</span>
                    <span className="font-mono text-xs text-ink-3">{part.id}</span>
                  </span>
                </button>
              </li>
            ))
          : detection.candidates.map((c, i) => (
              <li key={`${c.externalId}-${i}`}>
                <button
                  type="button"
                  onClick={() => onChoose({ choice: i })}
                  className={cx('flex w-full items-center gap-3 rounded-2xl border p-2 text-left', i === detection.choice ? 'border-ink bg-surface-2' : 'border-line hover:border-line-strong')}
                >
                  <span className="size-16 shrink-0 overflow-hidden rounded-xl bg-white">{c.image && <img src={c.image} alt="" className="size-full object-contain p-1" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">{c.part?.name ?? c.name}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <span className="font-mono">{c.part?.id ?? c.externalId}</span>
                      <span className="tabular">{Math.round(c.score * 100)}%</span>
                      {!c.part && <span className="rounded-full bg-ink/7 px-1.5 py-0.5">Not in the catalog</span>}
                    </span>
                  </span>
                  {i === detection.choice && <Check className="size-5 shrink-0" strokeWidth={3} />}
                </button>
              </li>
            ))}
      </ul>
      {query.trim() && results.length === 0 && <p className="py-8 text-center text-ink-2">No part matches "{query}".</p>}
    </div>
  );
}
