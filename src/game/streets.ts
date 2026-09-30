// The street network. The village begins as one street; a crossroads (the
// `intersection` building) opens a new street across it at right angles, and a
// crossroads on that street opens another, so the streets form a tree, each
// branching off the one it crosses.
//
// Every street is still a line, and along it things have an x as before. Each
// street has its own stretch of x (street i starts at i × STREET_STRIDE and is
// STREET_LENGTH long), so one number still says where anything is: on which
// street, and how far along it. Where two streets cross, the one spot has an x
// on each. Someone bound for another street walks to the corner and carries on
// from that same spot on the next street (`route`); distances between places
// are measured along the streets (`streetDist`).
//
// For the village map each street also lies somewhere on the ground (map px,
// y pointing north): its start at `origin`, running along `dir`. The street is
// always seen from its right-hand side, so the lots behind it, where the
// buildings stand, lie to its left (`backOf`). A new street runs off into what
// lay behind the one it branches off.

import { FIRST_PLOT_X, PLOT_SPACING, STREET_LENGTH } from './layout';
import type { World } from './world';

/** Distance in x between the starts of neighbouring streets (more than a street's length). */
export const STREET_STRIDE = 10000;
/** Which plot of a new street is where it crosses the street it branches off: the middle one. */
export const CROSS_PLOT = 12;
/** Where along a new street (px from its start) it crosses its parent. */
export const CROSS_AT = FIRST_PLOT_X + CROSS_PLOT * PLOT_SPACING;
/** Half the width of a road running into the street at a crossroads (px). */
export const SIDE_ROAD_HALF = 30;

export interface Vec {
  x: number;
  y: number;
}

export interface Street {
  index: number;
  /** The crossroads (an intersection building) it branches off at; null for the main street. */
  from: number | null;
  /** The street it branches off (-1 for the main street). */
  parent: number;
  /** Where it crosses its parent: world x on this street, and on the parent. */
  cross: { x: number; parentX: number } | null;
  /** Map position of the street's start, and the way it runs (unit vector). */
  origin: Vec;
  dir: Vec;
}

export function mainStreet(): Street {
  return { index: 0, from: null, parent: -1, cross: null, origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
}

/** World x where street i starts. */
export const streetStart = (i: number) => i * STREET_STRIDE;

/** The street world x is on. */
export function streetOf(x: number): number {
  return Math.max(0, Math.floor(x / STREET_STRIDE));
}

/** The lots behind a street running along `dir` lie this way (to its left). */
export const backOf = (dir: Vec): Vec => ({ x: -dir.y, y: dir.x });

/** Where world x lies on the village map. */
export function mapPoint(world: World, x: number): Vec {
  const s = world.streets[streetOf(x)] ?? world.streets[0];
  const t = x - streetStart(s.index);
  return { x: s.origin.x + s.dir.x * t, y: s.origin.y + s.dir.y * t };
}

/** Lay out a new street crossing the one at world x `at`, branching off at crossroads `from`. Plots are the caller's. */
export function branchStreet(world: World, from: number, at: number): Street {
  const parent = world.streets[streetOf(at)];
  const index = world.streets.length;
  const dir = backOf(parent.dir);
  const p = mapPoint(world, at);
  const street: Street = {
    index,
    from,
    parent: parent.index,
    cross: { x: streetStart(index) + CROSS_AT, parentX: at },
    origin: { x: p.x - dir.x * CROSS_AT, y: p.y - dir.y * CROSS_AT },
    dir,
  };
  world.streets.push(street);
  return street;
}

/** Every crossroads that leads somewhere, seen from both of its streets: world x here, and the same spot on the other street. */
export function crossings(world: World): Array<{ x: number; to: number; buildingId: number }> {
  return world.streets.flatMap((s) =>
    s.cross && s.from !== null
      ? [
          { x: s.cross.parentX, to: s.cross.x, buildingId: s.from },
          { x: s.cross.x, to: s.cross.parentX, buildingId: s.from },
        ]
      : [],
  );
}

/** Street i and the streets it branches off, down to the main street. */
function lineage(world: World, i: number): number[] {
  const out: number[] = [];
  for (let k = i; k >= 0 && world.streets[k]; k = world.streets[k].parent) out.push(k);
  return out;
}

/** The streets walked along from street a to street b, both included. */
function path(world: World, a: number, b: number): number[] {
  const up = lineage(world, a);
  const down = lineage(world, b);
  const common = up.find((k) => down.includes(k)) ?? 0;
  return [...up.slice(0, up.indexOf(common) + 1), ...down.slice(0, down.indexOf(common)).reverse()];
}

/** The corner between neighbouring streets a and b: where it is on a, and on b. */
function corner(world: World, a: number, b: number): { at: number; to: number } {
  const sb = world.streets[b];
  if (sb.parent === a && sb.cross) return { at: sb.cross.parentX, to: sb.cross.x };
  const sa = world.streets[a];
  return { at: sa.cross!.x, to: sa.cross!.parentX };
}

/** Whether a walk from street a to street b can be routed (both streets exist). */
const linked = (world: World, a: number, b: number) => a !== b && !!world.streets[a] && !!world.streets[b];

/**
 * The next stretch of the way from world x `from` to `to`: straight there on
 * the same street; else to the corner (x), and the spot on the next street
 * the corner leads to (turnTo).
 */
export function route(world: World, from: number, to: number): { x: number; turnTo?: number } {
  const a = streetOf(from);
  const b = streetOf(to);
  if (!linked(world, a, b)) return { x: to };
  const p = path(world, a, b);
  const c = corner(world, p[0], p[1]);
  return { x: c.at, turnTo: c.to };
}

/** How far it is to walk from world x `from` to `to`, along the streets. */
export function streetDist(world: World, from: number, to: number): number {
  const a = streetOf(from);
  const b = streetOf(to);
  if (!linked(world, a, b)) return Math.abs(to - from);
  const p = path(world, a, b);
  let d = 0;
  let x = from;
  for (let i = 0; i + 1 < p.length; i++) {
    const c = corner(world, p[i], p[i + 1]);
    d += Math.abs(c.at - x);
    x = c.to;
  }
  return d + Math.abs(to - x);
}

/**
 * Which way along street `to` the rider faces after turning off street
 * `from` at a crossroads: `up` into what lies behind `from` (away from the
 * viewer), `down` towards the viewer.
 */
export function turnFacing(world: World, from: number, to: number, way: 'up' | 'down'): 1 | -1 {
  const b = backOf(world.streets[from].dir);
  const d = world.streets[to].dir;
  const s = d.x * b.x + d.y * b.y >= 0 ? 1 : -1;
  return way === 'up' ? s : (-s as 1 | -1);
}

/** The x range of street i where people may be (its plots, with some verge). */
export function streetRange(i: number): { min: number; max: number } {
  return { min: streetStart(i), max: streetStart(i) + STREET_LENGTH };
}
