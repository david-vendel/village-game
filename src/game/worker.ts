// A worker's day, for any job. The routine is the same everywhere: work in
// daylight, go home for an hour's lunch at 11:30, sleep at night, go in and out
// through the door, and carry goods to the store. What the work *is* comes from
// the workplace (a `Workplace`, e.g. farm.ts): which job is next, how long it
// takes, and what it produces.
//
// Positions are relative to the workplace's centre (dx) and in world y.
// Nothing moves by magic: a worker walks to the exact spot where a thing lies
// to pick it up, and to the exact spot where it will lie to put it down, the
// fastest way across the land (`Nav`, paths.ts): round buildings, along roads
// where that is quicker, slower through fields; to another street too.

import type { TimeOfDay } from './daynight';
import { behindRoad, yAt, type Spot } from './layout';
import type { Load } from './resources';

/** A job at a workplace: what to do (its own vocabulary, e.g. 'sow') and to which of its things. */
export interface JobTicket {
  action: string;
  target: number;
  /** Where the load from this job goes down, if the workplace has several places for it (a site's work spots). */
  slot?: number;
  /** The building a load from this job is carried to, for jobs that carry between buildings (transport). */
  to?: number;
}

export type WorkerTask =
  | { kind: 'idle'; wait: number }
  /** Walking somewhere; `job` is the job to do there, or (for a delivery) the job the load came from. */
  | { kind: 'walk'; toDx: number; toY: number; then: 'job' | 'deliver' | 'home'; job: JobTicket | null }
  /**
   * Doing a job: t seconds done out of duration. `carried`: working on the load
   * they brought (Workplace.workOn), where they stand or, `indoors`, inside.
   */
  | { kind: 'job'; job: JobTicket; t: number; duration: number; carried?: true; indoors?: true }
  /**
   * Stepping in through the door (t: seconds so far, up to DOOR_TIME); with a
   * `job`, carrying its load in to work on it inside for `duration` seconds.
   */
  | { kind: 'enter'; t: number; job?: JobTicket; duration?: number }
  /** Indoors, out of sight. At lunch, `left` counts the game hours still to eat. */
  | { kind: 'home'; activity: 'lunch' | 'sleep'; left: number }
  /** Stepping out of the door, back to work; with a `job`, carrying out what was made inside, to its place. */
  | { kind: 'exit'; t: number; job?: JobTicket };

export interface Worker {
  dx: number;
  y: number;
  facing: 1 | -1;
  /** What the worker is carrying, if anything (they walk slower with a load). */
  carrying: Load | null;
  task: WorkerTask;
  /** Distance walked, drives the walk cycle. */
  stride: number;
  /** Day number of the last lunch (once a day). */
  lunchDay: number;
}

/** What a workplace tells its workers. */
export interface Workplace {
  /**
   * Day labour (a construction site): no lunch break, and at nightfall the
   * workers are let go rather than going indoors (the world does that).
   */
  dayLabour?: boolean;
  /** Work goes on day and night (builders): never off duty. */
  allHours?: boolean;
  /**
   * Work by the errand (transport): a worker with no errand to run is let go
   * where they stand (the world does that), instead of waiting at the door.
   */
  temporary?: boolean;
  /** Multiplies the walking speed, loaded and empty-handed (default 1). */
  walkSpeed?: number;
  /** The front door, where workers go in and out and wait for work. */
  door: Spot;
  /** The next job for this worker (not one in `taken`, which others are on), with where to do it. */
  nextJob(worker: Worker, taken: JobTicket[]): { job: JobTicket; dx: number; y: number } | null;
  /**
   * Where a job is done now, if that can change while the worker walks there
   * (picking up the top item of a pile others take from too).
   */
  jobSpot?(job: JobTicket): Spot | null;
  /** Arrived at a job: start it and return how long it takes (s), or null if it no longer needs doing. */
  begin(job: JobTicket): number | null;
  /**
   * A job is done: returns what the worker now carries, if anything. For work
   * done inside, `carried` is the load they took in (and no longer hold after).
   */
  finish(job: JobTicket, carried?: Load | null): Load | null;
  /**
   * Work on a carried load: a worker bringing `load` from `job` to its drop
   * spot works on it there instead of putting it down (null: just put it
   * down), for `seconds`; `indoors`, the drop spot is the door and they take
   * it inside to work on (and come back out). Then they carry what `finish`
   * makes of it to its drop spot.
   */
  workOn?(job: JobTicket, load: Load): { seconds: number; indoors: boolean } | null;
  /** The exact spot where the load from `job` will lie once put down (asked again on the way, as piles change). */
  dropSpot(job: JobTicket, load: Load): Spot;
  /** The worker has carried the load from `job` to its drop spot and puts it down. */
  deliver(load: Load, job: JobTicket): void;
}

/** A point on the village map (map px). */
export interface MapPoint {
  x: number;
  y: number;
}

/**
 * The land around the workplace, for walking it (world.ts, paths.ts). Workers'
 * positions (dx, y) are seen from the workplace's street; someone who walks off
 * to another street is seen from that street instead (dx past this street's end).
 */
export interface Nav {
  /** Where (dx, y) lies on the map. */
  toMap(dx: number, y: number): MapPoint;
  /** Map point p as (dx, y), seen from the street the worker at `nearDx` is on, or one nearer p. */
  fromMap(p: MapPoint, nearDx: number): { dx: number; y: number };
  /** The next point on the fastest way from `from` to `to` (to itself at the end), for this worker. */
  next(w: Worker, from: MapPoint, to: MapPoint): MapPoint;
  /** How fast someone walks at p, as a share of their speed on grass. */
  speedAt(p: MapPoint): number;
}

/** Walking speed with a load, and with empty hands (px/s). */
export const WALK_SPEED = 42;
export const WALK_SPEED_EMPTY = WALK_SPEED * 2;
/** Seconds to step through a door, in or out. */
export const DOOR_TIME = 0.9;
/** Workers head home for lunch from this hour (finishing the job in hand first)… */
export const LUNCH_AT = 11.5;
/** …and eat for this many game hours once inside. */
export const LUNCH_HOURS = 1;
/** Past this hour a missed lunch is skipped for the day. */
const LUNCH_LATEST = 15;

/** Midday in bright light: for workplaces run outside a world (tests). */
export const MIDDAY: TimeOfDay = { daylight: true, day: 1, hour: 10, hoursPerSecond: 24 / 300 };

/** A new worker, stepping out of the workplace's door. */
export function createWorker(place: Pick<Workplace, 'door'>): Worker {
  return { dx: place.door.dx, y: place.door.y, facing: 1, carrying: null, task: { kind: 'exit', t: 0 }, stride: 0, lunchDay: 0 };
}

/** The job a worker is doing or on the way to, if any. */
export function currentJob(w: Worker): JobTicket | null {
  const t = w.task;
  if (t.kind === 'job') return t.job;
  if (t.kind === 'walk' && t.then === 'job') return t.job;
  return null;
}

/** The job the load a worker is carrying came from, while they carry it to its place. */
export function delivering(w: Worker): JobTicket | null {
  const t = w.task;
  return t.kind === 'walk' && t.then === 'deliver' ? t.job : null;
}

/** Point a worker's current job somewhere else (its target moved), or drop it (null: walk home). */
export function retarget(w: Worker, place: Pick<Workplace, 'door'>, job: JobTicket | null, at?: { dx: number; y: number }): void {
  const t = w.task;
  if (t.kind !== 'job' && !(t.kind === 'walk' && t.then === 'job')) return;
  if (!job) {
    goHome(w, place);
    return;
  }
  t.job = job;
  if (t.kind === 'walk' && at) {
    t.toDx = at.dx;
    t.toY = at.y;
  }
}

function walkTo(w: Worker, toDx: number, toY: number, then: 'job' | 'deliver' | 'home', job: JobTicket | null): void {
  w.task = { kind: 'walk', toDx, toY, then, job };
}

function goHome(w: Worker, place: Pick<Workplace, 'door'>): void {
  walkTo(w, place.door.dx, place.door.y, 'home', null);
}

const atDoor = (w: Worker, place: Workplace) => Math.abs(w.dx - place.door.dx) < 0.5 && Math.abs(w.y - place.door.y) < 0.5;

/** Why the worker should stop for now, if they should. */
export function offDuty(w: Worker, now: TimeOfDay, place: Pick<Workplace, 'dayLabour' | 'allHours'>): 'lunch' | 'sleep' | null {
  if (place.allHours) return null;
  if (!now.daylight) return 'sleep';
  if (!place.dayLabour && now.hour >= LUNCH_AT && now.hour < LUNCH_LATEST && w.lunchDay !== now.day) return 'lunch';
  return null;
}

/**
 * Walk the fastest way across the land towards (toDx, toY) for `reach` px of
 * grass (further on the road, less in fields). Returns whether they got there.
 */
function walkOnLand(w: Worker, toDx: number, toY: number, reach: number, nav: Nav): boolean {
  const to = nav.toMap(toDx, toY);
  let p = nav.toMap(w.dx, w.y);
  let left = reach;
  let walked = 0;
  // a few legs of the way in one step at most: corners close together
  for (let legs = 0; legs < 8 && left > 1e-9; legs++) {
    const q = nav.next(w, p, to);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const v = nav.speedAt(p);
    if (d > left * v) {
      p = { x: p.x + ((q.x - p.x) / d) * left * v, y: p.y + ((q.y - p.y) / d) * left * v };
      walked += left * v;
      left = 0;
      break;
    }
    p = q;
    walked += d;
    left -= d / v;
    if (q.x === to.x && q.y === to.y) {
      w.stride += walked;
      return true;
    }
  }
  const at = nav.fromMap(p, w.dx);
  // facing the way they go along the street (not when they come to be seen from another street)
  const ddx = at.dx - w.dx;
  if (Math.abs(ddx) > 0.05 && Math.abs(ddx) < 100) w.facing = ddx > 0 ? 1 : -1;
  w.dx = at.dx;
  w.y = at.y;
  w.stride += walked;
  return false;
}

/** Without a map (a workplace on its own, in tests): straight towards (toDx, toY) on the ground. Returns whether they got there. */
function walkStraight(w: Worker, toDx: number, toY: number, step: number): boolean {
  // y is a depth across the street, so the step is measured in ground px (layout.ts behindRoad)
  const ddx = toDx - w.dx;
  const depth = behindRoad(w.y);
  const ddy = behindRoad(toY) - depth;
  const d = Math.hypot(ddx, ddy);
  if (Math.abs(ddx) > 0.5) w.facing = ddx > 0 ? 1 : -1;
  if (d > step) {
    w.dx += (ddx / d) * step;
    w.y = yAt(depth + (ddy / d) * step);
    w.stride += step;
    return false;
  }
  w.stride += d;
  return true;
}

/** Advance one worker. `taken`: jobs the workplace's other workers are on; `nav`: the way to other streets. */
export function updateWorker(w: Worker, place: Workplace, dt: number, now: TimeOfDay, taken: JobTicket[], nav?: Nav): void {
  const task = w.task;
  const off = offDuty(w, now, place);

  if (task.kind === 'enter' || task.kind === 'exit') {
    task.t += dt;
    if (task.t < DOOR_TIME) return;
    if (task.kind === 'enter' && task.job) w.task = { kind: 'job', job: task.job, t: 0, duration: task.duration ?? 0, carried: true, indoors: true };
    else if (task.kind === 'exit' && task.job && w.carrying) {
      const to = place.dropSpot(task.job, w.carrying);
      walkTo(w, to.dx, to.y, 'deliver', task.job);
    } else if (task.kind === 'exit') w.task = { kind: 'idle', wait: 0.3 };
    else if (off) w.task = { kind: 'home', activity: off, left: off === 'lunch' ? LUNCH_HOURS : 0 };
    else w.task = { kind: 'exit', t: 0 }; // nothing to stay in for after all
    return;
  }

  if (task.kind === 'home') {
    if (task.activity === 'lunch') {
      task.left -= dt * now.hoursPerSecond;
      if (!now.daylight) {
        w.lunchDay = now.day; // lunch ran into the night: off to bed
        w.task = { kind: 'home', activity: 'sleep', left: 0 };
      } else if (task.left <= 0) {
        w.lunchDay = now.day;
        w.task = { kind: 'exit', t: 0 };
      }
    } else if (now.daylight) {
      w.task = { kind: 'exit', t: 0 }; // morning: back out to work
    }
    return;
  }

  // time to go in: drop plans for work and head home (a job already started
  // is finished first, and goods being carried still go to the store)
  if (off && task.kind === 'walk' && task.then === 'job') goHome(w, place);

  if (task.kind === 'idle') {
    task.wait -= dt;
    if (task.wait > 0) return;
    if (off) {
      if (atDoor(w, place)) w.task = { kind: 'enter', t: 0 };
      else goHome(w, place);
      return;
    }
    const next = place.nextJob(w, taken);
    if (!next) {
      // nothing to do: wait by the door, and look again shortly
      if (atDoor(w, place)) task.wait = 1;
      else goHome(w, place);
      return;
    }
    walkTo(w, next.dx, next.y, 'job', next.job);
    return;
  }

  if (task.kind === 'walk') {
    // piles change while the worker walks: head for where the thing lies (or will lie) now
    const at = task.job && (task.then === 'deliver' ? (w.carrying ? place.dropSpot(task.job, w.carrying) : null) : task.then === 'job' ? place.jobSpot?.(task.job) : null);
    if (at) {
      task.toDx = at.dx;
      task.toY = at.y;
    }
    const speed = (w.carrying ? WALK_SPEED : WALK_SPEED_EMPTY) * (place.walkSpeed ?? 1);
    if (nav ? !walkOnLand(w, task.toDx, task.toY, speed * dt, nav) : !walkStraight(w, task.toDx, task.toY, speed * dt)) return;
    w.dx = task.toDx;
    w.y = task.toY;
    if (task.then === 'job' && task.job) {
      const duration = place.begin(task.job);
      // the job changed on the way (someone else did it, the land was built on): pick another
      w.task = duration === null ? { kind: 'idle', wait: 0.3 } : { kind: 'job', job: task.job, t: 0, duration };
    } else if (task.then === 'deliver') {
      // work on the load here, or in through the door with it
      const work = w.carrying && task.job ? (place.workOn?.(task.job, w.carrying) ?? null) : null;
      if (work) {
        w.task = work.indoors
          ? { kind: 'enter', t: 0, job: task.job!, duration: work.seconds }
          : { kind: 'job', job: task.job!, t: 0, duration: work.seconds, carried: true };
        return;
      }
      if (w.carrying && task.job) place.deliver(w.carrying, task.job);
      w.carrying = null;
      w.task = { kind: 'idle', wait: 0.8 };
    } else if (off) {
      w.task = { kind: 'enter', t: 0 };
    } else {
      w.task = { kind: 'idle', wait: 0.8 };
    }
    return;
  }

  // doing a job
  task.t += dt;
  if (task.t < task.duration) return;
  if (task.carried) {
    // the load worked on becomes what was made (inside: they bring it back out)
    const made = place.finish(task.job, w.carrying);
    w.carrying = made;
    if (task.indoors) w.task = made ? { kind: 'exit', t: 0, job: task.job } : { kind: 'exit', t: 0 };
    else if (made) {
      const to = place.dropSpot(task.job, made);
      walkTo(w, to.dx, to.y, 'deliver', task.job);
    } else w.task = { kind: 'idle', wait: 0.4 };
    return;
  }
  const goods = place.finish(task.job);
  if (goods) {
    w.carrying = goods;
    const to = place.dropSpot(task.job, goods);
    walkTo(w, to.dx, to.y, 'deliver', task.job);
  } else {
    w.task = { kind: 'idle', wait: 0.4 }; // straight on to the next job from here
  }
}
