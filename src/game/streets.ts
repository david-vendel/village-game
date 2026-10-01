// The street network. The village begins as one street; a crossroads (the
// `intersection` building) opens a new street across it at right angles, and a
// crossroads on that street opens another, and so on.
//
// Every street is still a line, and along it things have an x as before. Each
// street has its own stretch of x (street i starts at i × STREET_STRIDE and is
// STREET_LENGTH long), so one number still says where anything is: on which
// street, and how far along it.
//
// On the ground (map px, y pointing north) every street lies on one grid: its
// plots are PLOT_SPACING apart and a new street crosses the old one at a plot,
// so wherever two streets meet, they meet at a plot of each. A new street is
// laid out from its crossroads plot by plot in both directions (world.ts
// layStreet), up to STREET_LENGTH long. Where it comes to another street
// crossing its way, it joins it if that street's plot there is free (a
// crossroads is made there, and the street runs on across), and otherwise ends
// one plot short of it; it also ends one plot short of a street running along
// the same line. So streets can close into loops.
//
// Where two streets meet is a `Junction`: the one spot, with an x on each.
// Someone bound for another street walks to a corner and carries on from the
// same spot on the next street (`route`, the shortest way through the
// junctions); distances between places are measured along the streets
// (`streetDist`).
//
// Each street is seen from its right-hand side, so the lots behind it, where
// the buildings stand, lie to its left (`backOf`), and a new street runs off
// into what lay behind the old one.

import { BUILDINGS } from './buildings';
import { behindRoad, FIELD_ROWS, FIRST_PLOT_X, GROUND_Y, PLOT_SPACING, ROAD_BOTTOM, QUARRIES, quarryLand, STREET_BAND_HALF, STREET_LENGTH } from './layout';
import type { World } from './world';

/** Distance in x between the starts of neighbouring streets (more than a street's length). */
export const STREET_STRIDE = 10000;
/** Plots a street can have: every PLOT_SPACING from FIRST_PLOT_X. */
export const PLOTS_PER_STREET = Math.ceil((STREET_LENGTH - 200 - FIRST_PLOT_X) / PLOT_SPACING);
/** Which plot of a new street is where it crosses the street it branches off: the middle one. */
export const CROSS_PLOT = 12;
/** Half the width of a road running into the street at a crossroads (px). */
export const SIDE_ROAD_HALF = 30;
/** A street's band across the ground (layout.ts): where another street crosses, none of this one's fields lie within it. */
export { STREET_BAND_HALF };
/** How far past its first and last plot a street runs on (px). */
const STREET_END = 180;
export interface Vec {
  x: number;
  y: number;
}

export interface Street {
  index: number;
  /** The crossroads (an intersection building) it was opened from; null for the main street. */
  from: number | null;
  /** Map position of the street's start (x = its first world x), and the way it runs (unit vector). */
  origin: Vec;
  dir: Vec;
  /** Its first and last plot (0..PLOTS_PER_STREET-1): it may end short where it met another street. */
  lo: number;
  hi: number;
  /** Gone (its crossroads was pulled down): no road and no plots, kept only for its place in the list. */
  gone?: true;
}

/** Where two streets meet: the crossroads standing there, and the spot's world x on each street. */
export interface Junction {
  buildingId: number;
  a: number;
  b: number;
}

export function mainStreet(): Street {
  return { index: 0, from: null, origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, lo: 0, hi: PLOTS_PER_STREET - 1 };
}

/** World x where street i starts. */
export const streetStart = (i: number) => i * STREET_STRIDE;

/** World x of plot k (0..PLOTS_PER_STREET-1) of street i. */
export const plotX = (i: number, k: number) => streetStart(i) + FIRST_PLOT_X + k * PLOT_SPACING;

/** The street world x is on. */
export function streetOf(x: number): number {
  return Math.max(0, Math.floor(x / STREET_STRIDE));
}

/** The lots behind a street running along `dir` lie this way (to its left). */
export const backOf = (dir: Vec): Vec => ({ x: -dir.y, y: dir.x });

/** Where world x on street s lies on the map. */
function onMap(s: Street, x: number): Vec {
  const t = x - streetStart(s.index);
  return { x: s.origin.x + s.dir.x * t, y: s.origin.y + s.dir.y * t };
}

/** Where world x lies on the village map. */
export function mapPoint(world: World, x: number): Vec {
  return onMap(world.streets[streetOf(x)] ?? world.streets[0], x);
}

/**
 * Map point of world (x, y): along the road of x's street, and y's depth
 * across it (behind the road for y above ROAD_Y, in front of it below).
 */
export function groundPoint(world: World, x: number, y: number): Vec {
  const s = world.streets[streetOf(x)] ?? world.streets[0];
  const p = onMap(s, x);
  const b = backOf(s.dir);
  const d = behindRoad(y);
  return { x: p.x + b.x * d, y: p.y + b.y * d };
}

/** Whether map point p is on a quarry's land, or within `margin` of it. */
export function onQuarryLand(p: Vec, margin = 0): boolean {
  return QUARRIES.some((q) => {
    const r = quarryLand(q);
    return p.x > r.x0 - margin && p.x < r.x1 + margin && p.y > r.y0 - margin && p.y < r.y1 + margin;
  });
}

/** Map point d map px behind the middle of the road at world x (in front for negative d). */
export function streetPoint(world: World, x: number, d: number): Vec {
  const s = world.streets[streetOf(x)] ?? world.streets[0];
  const p = onMap(s, x);
  const b = backOf(s.dir);
  return { x: p.x + b.x * d, y: p.y + b.y * d };
}

/** Map point p seen from street i: the world x along it, and how far behind its road (d). */
export function fromStreet(world: World, i: number, p: Vec): { x: number; d: number } {
  const s = world.streets[i];
  const dx = p.x - s.origin.x;
  const dy = p.y - s.origin.y;
  const b = backOf(s.dir);
  return { x: streetStart(i) + dx * s.dir.x + dy * s.dir.y, d: dx * b.x + dy * b.y };
}

/**
 * Whether the stretch of street s from t0 to t1 along it (px from its start),
 * d0..d1 behind its road (negative: in front), takes any of a quarry's land.
 */
function onQuarry(s: Street, t0: number, t1: number, d0: number, d1: number): boolean {
  const b = backOf(s.dir);
  const pts = [t0, t1].flatMap((t) => [d0, d1].map((d) => ({ x: s.origin.x + s.dir.x * t + b.x * d, y: s.origin.y + s.dir.y * t + b.y * d })));
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  return QUARRIES.some((q) => {
    const r = quarryLand(q);
    return x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0;
  });
}

/** How far behind the middle of the road the road's edges are (negative: its near edge, in front). */
const ROAD_ACROSS = { near: behindRoad(ROAD_BOTTOM), far: behindRoad(GROUND_Y + 6) };
/** The lot behind the road a building stands on: as deep as the building row, as wide as the widest building. */
const LOT_ACROSS = { near: behindRoad(FIELD_ROWS.back[0].near), far: behindRoad(FIELD_ROWS.back[0].far) };
const LOT_HALF_W = Math.max(...Object.values(BUILDINGS).map((d) => d.width)) / 2;

/**
 * Whether laying street s on to plot k (coming from the plot before it, `step`
 * the way it is being laid) would run its road over a quarry's land, the road
 * past the plot to the street's end included. A quarry beside the road is no
 * matter: only the lots on it can't be built on (lotOnQuarry).
 */
export function roadOnQuarry(s: Street, k: number, step: 1 | -1): boolean {
  const t = plotX(s.index, k) - streetStart(s.index);
  return onQuarry(s, t - step * PLOT_SPACING, t + step * STREET_END, ROAD_ACROSS.near, ROAD_ACROSS.far);
}

/** Whether plot k of street s has its lot (behind the road) on a quarry's land, so nothing can be built there. */
export function lotOnQuarry(s: Street, k: number): boolean {
  const t = plotX(s.index, k) - streetStart(s.index);
  return onQuarry(s, t - LOT_HALF_W, t + LOT_HALF_W, LOT_ACROSS.near, LOT_ACROSS.far);
}

/** How far a street runs past its last plot, and so how clear of the rocks it stops. */
export const STREET_END_RUN = STREET_END;

/** Map point of plot k of street s. */
export const plotPoint = (s: Street, k: number) => onMap(s, plotX(s.index, k));

/** The stretch of street i that is there (world x): its plots, and a little road past each end. */
export function streetRange(world: World, i: number): { min: number; max: number } {
  const s = world.streets[i] ?? world.streets[0];
  return { min: plotX(s.index, s.lo) - STREET_END, max: plotX(s.index, s.hi) + STREET_END };
}

/**
 * A new street across the one at world x `at`, opened from crossroads `from`:
 * where it lies and which way it runs. It is just its crossroads plot so far
 * (world.ts layStreet lays out the rest).
 */
export function newStreet(world: World, from: number, at: number): Street {
  const parent = world.streets[streetOf(at)];
  const index = world.streets.length;
  const dir = backOf(parent.dir);
  const p = onMap(parent, at);
  const t = plotX(index, CROSS_PLOT) - streetStart(index);
  return { index, from, origin: { x: p.x - dir.x * t, y: p.y - dir.y * t }, dir, lo: CROSS_PLOT, hi: CROSS_PLOT };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * What a new street finds at map point p, from the streets already there: one
 * running along the same line through p (it must stop short), or one crossing
 * its way there (the plot of that street at p).
 */
export function streetsAt(world: World, dir: Vec, p: Vec): { along: boolean; crossing: { street: number; k: number } | null } {
  let crossing: { street: number; k: number } | null = null;
  for (const s of world.streets) {
    if (s.gone) continue;
    // how far along s the point is, and whether it is on its line at all
    const t = (p.x - s.origin.x) * s.dir.x + (p.y - s.origin.y) * s.dir.y;
    const off = (p.x - s.origin.x) * -s.dir.y + (p.y - s.origin.y) * s.dir.x;
    if (!near(off, 0)) continue;
    const k = (t - FIRST_PLOT_X) / PLOT_SPACING;
    if (!near(k, Math.round(k)) || Math.round(k) < s.lo || Math.round(k) > s.hi) continue;
    if (near(Math.abs(s.dir.x * dir.x + s.dir.y * dir.y), 1)) return { along: true, crossing: null };
    crossing = { street: s.index, k: Math.round(k) };
  }
  return { along: false, crossing };
}

/** Every crossroads, seen from both of its streets: world x here, and the same spot on the other street. */
export function crossings(world: World): Array<{ x: number; to: number; buildingId: number }> {
  return world.junctions.flatMap((j) => [
    { x: j.a, to: j.b, buildingId: j.buildingId },
    { x: j.b, to: j.a, buildingId: j.buildingId },
  ]);
}

// --- Ways between streets ----------------------------------------------------------
// The junctions' ends are the nodes of a graph: the two ends of a junction are
// the same spot, and ends on one street are as far apart as they are along it.
// Shortest distances between all ends are worked out once for each layout of
// the streets (they only change when a street opens).

interface Ways {
  junctions: number;
  /** World x of each end: junction j has ends 2j (on its first street) and 2j + 1. */
  xs: number[];
  /** Shortest walk between ends i and k: dist[i * n + k]. */
  dist: Float64Array;
  /** The ends on each street. */
  ends: Map<number, number[]>;
}

const cache = new WeakMap<World, Ways>();

function ways(world: World): Ways {
  const known = cache.get(world);
  if (known && known.junctions === world.junctions.length) return known;
  const xs = world.junctions.flatMap((j) => [j.a, j.b]);
  const n = xs.length;
  const dist = new Float64Array(n * n).fill(Infinity);
  const ends = new Map<number, number[]>();
  xs.forEach((x, i) => {
    const s = streetOf(x);
    ends.set(s, [...(ends.get(s) ?? []), i]);
  });
  for (let i = 0; i < n; i++) {
    dist[i * n + i] = 0;
    dist[i * n + (i ^ 1)] = 0;
    for (const k of ends.get(streetOf(xs[i]))!) dist[i * n + k] = Math.min(dist[i * n + k], Math.abs(xs[i] - xs[k]));
  }
  for (let m = 0; m < n; m++) {
    for (let i = 0; i < n; i++) {
      const im = dist[i * n + m];
      if (im === Infinity) continue;
      for (let k = 0; k < n; k++) {
        const d = im + dist[m * n + k];
        if (d < dist[i * n + k]) dist[i * n + k] = d;
      }
    }
  }
  const w = { junctions: world.junctions.length, xs, dist, ends };
  cache.set(world, w);
  return w;
}

/**
 * The shortest way from world x `from` on one street to `to` on another: the
 * junction end on this street to turn at first, and how far it is in all.
 */
function bestTurn(world: World, from: number, to: number): { end: number; d: number } | null {
  const g = ways(world);
  const n = g.xs.length;
  let best: { end: number; d: number } | null = null;
  for (const e of g.ends.get(streetOf(from)) ?? []) {
    for (const f of g.ends.get(streetOf(to)) ?? []) {
      // turning at e: over to the other street, then on to f and along to `to`
      const d = Math.abs(from - g.xs[e]) + g.dist[(e ^ 1) * n + f] + Math.abs(g.xs[f] - to);
      if (d < (best?.d ?? Infinity)) best = { end: e, d };
    }
  }
  return best;
}

/**
 * The next stretch of the way from world x `from` to `to`: straight there on
 * the same street; else to the corner (x), and the spot on the next street
 * the corner leads to (turnTo).
 */
export function route(world: World, from: number, to: number): { x: number; turnTo?: number } {
  if (streetOf(from) === streetOf(to)) return { x: to };
  const turn = bestTurn(world, from, to);
  if (!turn) return { x: to };
  const xs = ways(world).xs;
  return { x: xs[turn.end], turnTo: xs[turn.end ^ 1] };
}

/** How far it is to walk from world x `from` to `to`, along the streets. */
export function streetDist(world: World, from: number, to: number): number {
  if (streetOf(from) === streetOf(to)) return Math.abs(to - from);
  return bestTurn(world, from, to)?.d ?? Math.abs(to - from);
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
