// Keeps hold of the pieces seen in the viewfinder from one camera frame to the next.
//
// Any single frame can miss a piece: the focus drifts, a hand shakes, the exposure shifts, and a
// pale piece on a pale surface sits right at the limit of what can be told apart. Shown raw, the
// outlines flicker. So each piece found is followed across frames: once it has been seen a few
// times it is "locked", and then stays on show through the frames in which it goes unseen,
// moving with the rest of the scene. What is locked when the shutter is pressed is scanned even
// if the photo itself, taken on its own, would have missed it.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Track extends Box {
  /** The same from frame to frame, for as long as the piece is followed. */
  id: number;
  /** Seen often enough to be relied on. */
  locked: boolean;
  /** Not found in the latest frame: shown where it should be by now. */
  held: boolean;
}

interface Followed extends Track {
  hits: number;
  missed: number;
  /** Where its middle was actually found last (the outline on show trails behind a little, for steadiness). */
  cx: number;
  cy: number;
  /** Overlapping pieces it has been found alongside, in one and the same frame. */
  beside: Set<number>;
}

/** Sightings before a piece is locked. */
const LOCK_AFTER = 3;
/** Frames a locked piece stays on show unseen: longer in the middle of the view, where it cannot simply have left the frame. */
const HOLD = 5;
const HOLD_CENTRAL = 10;
/** Frames a piece not yet locked is remembered (but not shown) while unseen, so that one seen every other frame still gets there. */
const GRACE = 2;

const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w <= 0 || h <= 0 ? 0 : w * h;
};

/** Overlap of two boxes as a share of the area they cover together. */
const together = (a: Box, b: Box) => {
  const shared = overlap(a, b);
  return shared / (a.w * a.h + b.w * b.h - shared);
};

/** Do two outlines cover much the same ground: most of the smaller lies within the other? */
const sameSpot = (a: Box, b: Box) => overlap(a, b) > Math.min(a.w * a.h, b.w * b.h) * 0.5;

const rivals = (a: Followed, b: Followed) => sameSpot(a, b) && !a.beside.has(b.id);

const median = (values: number[]) => (values.length ? values.sort((a, b) => a - b)[values.length >> 1] : 0);

export class Tracker {
  private followed: Followed[] = [];
  private nextId = 1;

  reset(): void {
    this.followed = [];
  }

  /** Takes the pieces found in the newest frame, and returns what to show. */
  update(found: Box[]): Track[] {
    // Pair up what was being followed with what was found, best matches first.
    const pairs: { track: Followed; box: Box; score: number }[] = [];
    for (const track of this.followed) {
      for (const box of found) {
        // The same piece is about the same size from one frame to the next. An outline twice as
        // large over the same spot is another reading of what is there (two pieces found as one).
        const size = (box.w * box.h) / (track.w * track.h);
        const score = together(track, box);
        if (score > 0.25 && size > 0.5 && size < 2) pairs.push({ track, box, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const matched = new Map<Followed, Box>();
    const taken = new Set<Box>();
    for (const { track, box } of pairs) {
      if (matched.has(track) || taken.has(box)) continue;
      matched.set(track, box);
      taken.add(box);
    }

    // How far the whole scene has moved (the hand holding the camera), from the pieces that were found again.
    const moves = [...matched].filter(([track]) => !track.missed).map(([track, box]) => ({ dx: box.x + box.w / 2 - track.cx, dy: box.y + box.h / 2 - track.cy }));
    const dx = median(moves.map((m) => m.dx));
    const dy = median(moves.map((m) => m.dy));
    // Next to nothing found again: the camera is looking at something else now.
    const locked = this.followed.filter((t) => t.hits >= LOCK_AFTER);
    const elsewhere = locked.length >= 3 && locked.filter((t) => matched.has(t)).length < locked.length * 0.25;

    const next: Followed[] = [];
    for (const track of this.followed) {
      const box = matched.get(track);
      if (box) {
        // Ease toward the new outline: steady enough not to jitter, quick enough to keep up.
        const ease = 0.65;
        track.x += (box.x - track.x) * ease;
        track.y += (box.y - track.y) * ease;
        track.w += (box.w - track.w) * ease;
        track.h += (box.h - track.h) * ease;
        track.cx = box.x + box.w / 2;
        track.cy = box.y + box.h / 2;
        track.hits++;
        track.missed = 0;
        next.push(track);
        continue;
      }
      track.missed++;
      track.x += dx;
      track.y += dy;
      track.cx += dx;
      track.cy += dy;
      const cx = track.x + track.w / 2;
      const cy = track.y + track.h / 2;
      if (cx < 0 || cx > 1 || cy < 0 || cy > 1 || elsewhere) continue;
      const central = cx > 0.2 && cx < 0.8 && cy > 0.2 && cy < 0.8;
      if (track.missed <= (track.hits < LOCK_AFTER ? GRACE : central ? HOLD_CENTRAL : HOLD)) next.push(track);
    }
    for (const box of found) {
      if (!taken.has(box)) next.push({ id: this.nextId++, x: box.x, y: box.y, w: box.w, h: box.h, locked: false, held: false, hits: 1, missed: 0, cx: box.x + box.w / 2, cy: box.y + box.h / 2, beside: new Set() });
    }
    // Outlines that overlap and turn up in the same frame are different pieces (a brick lying
    // across another). Outlines that overlap and never do are two readings of one spot.
    const seen = next.filter((t) => !t.missed);
    for (const a of seen) for (const b of seen) if (a !== b && sameSpot(a, b)) a.beside.add(b.id);

    // Two pieces that touch may be found as two in one frame and as one in the next. Whichever
    // reading was locked first stands for as long as it keeps being seen; a rival reading of the
    // same spot waits its turn, or the two would take turns on screen.
    const standing = next.filter((t) => t.locked);
    for (const track of next) {
      track.held = track.missed > 0;
      if (track.locked || track.hits < LOCK_AFTER || standing.some((l) => rivals(l, track))) continue;
      track.locked = true;
      standing.push(track);
    }
    this.followed = next;
    return this.shown();
  }

  /** The pieces to draw: everything locked, and newcomers that are not just a locked piece seen differently. */
  private shown(): Track[] {
    const locked = this.followed.filter((t) => t.locked);
    const fresh = this.followed.filter((t) => !t.locked && !t.held && !locked.some((l) => rivals(l, t)));
    return [...locked, ...fresh].map(({ id, x, y, w, h, locked, held }) => ({ id, x, y, w, h, locked, held }));
  }

  /** The pieces that have been locked onto, wherever they are by now. */
  locked(): Track[] {
    return this.followed.filter((t) => t.locked).map(({ id, x, y, w, h, locked, held }) => ({ id, x, y, w, h, locked, held }));
  }
}
