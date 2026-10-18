// What a 3D building shows of the life in and around it, from the game state:
// how far it is built (or pulled down), which neighbours' walls it meets, how
// weathered it is, whether its door and shutters stand open, the light in its
// windows and the fire in its hearth and furnace (game/hearth.ts), and what
// lies in its store. And the live details drawn over its picture: the smoke
// from its chimneys (only while something burns inside), sleepers snoring,
// the farm's fences.

import { BUILDINGS, type BuildingType } from '../game/buildings';
import { DAY_LENGTH } from '../game/daynight';
import { footprintOf } from '../game/grid';
import { type Hearth, hearthOf } from '../game/hearth';
import { employees } from '../game/people';
import { BUILD_CHUNK, builders, siteWork } from '../game/site';
import { total } from '../game/resources';
import type { Worker } from '../game/worker';
import type { Building, World } from '../game/world';
import { type Progress } from './build3d/elements';
import type { Sides } from './build3d/plot';
import type { DrawArgs } from './buildings';
import { doorProgress, drawBackFences } from './farm';
import { type Ctx, hash, smoke } from './util';
import type { Building3d } from './world3d';

/** Buildings whose walls can stand against a neighbour's: a closed building with a pitched roof along the street. */
const PARTY: ReadonlySet<BuildingType> = new Set(['house', 'tavern', 'bakery', 'blacksmith', 'stonecutter', 'woodcutter', 'farm', 'chapel']);

/** Which sides of a building another finished building's walls touch (both able to share a wall). */
export function sidesOf(world: World, b: Building): Sides {
  const out = { left: false, right: false };
  if (!PARTY.has(b.type)) return out;
  const f = footprintOf(b);
  if (!f) return out;
  for (const o of world.buildings) {
    if (o === b || o.status !== 'done' || o.demolition || !PARTY.has(o.type)) continue;
    const g = footprintOf(o);
    if (!g || g.street !== f.street || g.j0 > f.j1 || g.j1 < f.j0) continue;
    if (g.i1 + 1 === f.i0) out.left = true;
    if (g.i0 === f.i1 + 1) out.right = true;
  }
  return out;
}

/** How weathered a building looks: the starting village's were there long before; others age over game weeks. */
export function ageOf(world: World, b: Building): number {
  if (b.completedAt === null) return 0;
  const old = b.completedAt <= -100 ? 0.45 + 0.35 * hash(b.id, 31) : 0;
  const days = (world.time - Math.max(0, b.completedAt)) / DAY_LENGTH;
  return Math.min(1, old + days / 40 + 0.08 * hash(b.id, 32));
}

/**
 * How far a building is shown built. The game moves its progress on in a jump each time a builder
 * finishes a spell of work (site.ts BUILD_CHUNK); shown, the stones and timbers go up while each
 * builder hammers: the game's progress plus each one's share of their spell done so far, so when the
 * spell ends and the game counts it, nothing jumps.
 */
const shown = new Map<number, { p: number; time: number }>();
/** Seconds the shown progress takes to make up most of what is left (a little give, no jumps). */
const FOLLOW = 0.25;

/** Builders hammering at this frame's sites, at the world time they were seen (they show no work ring then). */
const hammering = new WeakMap<Worker, number>();

/** True if this worker's work shows on a 3D building going up, rather than on a ring over their head. */
export function buildShown3d(w: Worker, time: number): boolean {
  return hammering.get(w) === time;
}

/** What the builders at work on a site have done of their spells so far, not yet counted by the game. */
function underway(world: World, b: Building): number {
  const site = b.site;
  if (!site || b.demolition) return 0;
  const work = siteWork(b);
  const cost = total(work.cost);
  if (cost <= 0 || work.buildTime <= 0) return 0;
  // as site.ts works it in: a spell's share of the materials, at most what lies at the spot
  const perJob = (BUILD_CHUNK * world.params.buildSpeed * cost) / work.buildTime;
  let p = 0;
  for (const person of builders(world, b)) {
    const w = person.job!.worker;
    const t = w.task;
    if (t.kind !== 'job' || t.job.action !== 'build') continue;
    hammering.set(w, world.time);
    const here = total(site.laid[t.job.target] ?? {});
    p += (Math.min(here, perJob) / cost) * Math.max(0, Math.min(1, t.t / t.duration));
  }
  return p;
}

function shownProgress(world: World, b: Building): number {
  const target = Math.min(1, b.progress + underway(world, b));
  const s = shown.get(b.id);
  // new, or a jump no one could have built (a loaded game, construction switched off): as it is
  if (!s || Math.abs(target - s.p) > 0.5) {
    shown.set(b.id, { p: target, time: world.time });
    return target;
  }
  const dt = Math.max(0, Math.min(0.5, world.time - s.time));
  s.time = world.time;
  const gap = target - s.p;
  const step = Math.max(Math.abs(gap) * Math.min(1, dt / FOLLOW), 0.03 * dt);
  s.p = Math.abs(gap) <= step ? target : s.p + Math.sign(gap) * step;
  return s.p;
}

/**
 * The stages as the 3D building shows them, each ending at this much of the work. The game's own
 * (world.ts STAGE_BOUNDS) give staking and the foundation a quarter of it; shown, they go by
 * quickly and the walls and the roof, the part worth watching, take two thirds.
 */
const STAGES_3D: Array<[Progress['stage'], number]> = [
  ['staking', 0.05],
  ['foundation', 0.13],
  ['frame', 0.33],
  ['walls', 0.72],
  ['roof', 1],
];

function stage3d(p: number): Progress | undefined {
  let start = 0;
  for (const [stage, end] of STAGES_3D) {
    if (p < end) return { stage, t: (p - start) / (end - start) };
    start = end;
  }
  return undefined;
}

/** How far a building has got: building it, building on its upgrade, or pulling it down. */
function progressOf(world: World, b: Building): Progress | undefined {
  if (b.status === 'done' && !b.demolition) {
    shown.delete(b.id);
    return undefined;
  }
  return stage3d(shownProgress(world, b));
}

/** Its door stands open while someone steps through it (or a new house's people come out). */
function doorOpen(world: World, b: Building): number {
  if (b.arriving) return 1;
  return employees(world, b).some((p) => {
    const d = doorProgress(p.job!.worker);
    return d > 0 && d < 1;
  })
    ? 1
    : 0;
}

/** Everything the 3D renderer needs to show a building now. */
export function building3d(world: World, b: Building, at?: Building3d['at']): Building3d & { hearth: Hearth } {
  const h = hearthOf(world, b);
  const build = progressOf(world, b);
  return {
    id: b.id,
    type: b.type,
    seed: b.id * 97,
    x: b.x,
    size: (b.size ?? 1) as 1 | 2 | 3,
    sides: sidesOf(world, b),
    upgraded: !!b.upgraded,
    build,
    age: ageOf(world, b),
    door: build ? 0 : doorOpen(world, b),
    shutters: h.shutters,
    light: h.light,
    fire: h.furnace,
    lantern: h.lantern,
    stock: b.stock,
    at,
    hearth: h,
  };
}

/** A warm light shining out into the night: drawn after the night tint (flushGlows), so it stays bright. */
interface Glow {
  x: number;
  y: number;
  /** Radius (world units on screen) and strength 0..1. */
  r: number;
  k: number;
  /** Fire (orange) or lamplight (yellow). */
  fire: boolean;
}

const glows: Glow[] = [];

/**
 * Draw the lights gathered this frame (lit windows, lanterns, an oven's mouth, the forge) as glows
 * spilling onto the walls and ground round them, over the darkened land; then forget them.
 */
export function flushGlows(ctx: Ctx, night: number, time: number): void {
  if (night <= 0.02) {
    glows.length = 0;
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const g of glows) {
    const flicker = 0.9 + 0.1 * Math.sin(time * 8.3 + g.x * 0.37) + (g.fire ? 0.08 * Math.sin(time * 19 + g.y) : 0);
    const a = g.k * night * flicker;
    if (a <= 0.01) continue;
    const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
    const [r, gg, b] = g.fire ? [255, 130, 50] : [255, 196, 110];
    grad.addColorStop(0, `rgba(${r},${gg},${b},${0.55 * a})`);
    grad.addColorStop(0.25, `rgba(${r},${gg},${b},${0.22 * a})`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
  }
  ctx.restore();
  glows.length = 0;
}

/** The live details over a 3D building: smoke from whatever burns inside, sleepers snoring, the farm's fences. */
export function overlay3d(ctx: Ctx, world: World, b: Building, m: Building3d & { hearth: Hearth }, at: (name: string) => [number, number] | null, a?: DrawArgs): void {
  const h = m.hearth;
  if (b.type === 'farm' && a && !m.build) drawBackFences(ctx, a, a.farm);
  // lights for the night: lamplight in the windows (a little even through closed shutters), the lanterns
  // by the doors, the fire in an oven's mouth or a forge, a brazier
  if (!m.build) {
    for (let i = 0; ; i++) {
      const p = at(`window:${i}`);
      if (!p) break;
      if (m.light > 0) glows.push({ x: p[0], y: p[1], r: 26, k: m.light * (0.35 + 0.65 * m.shutters), fire: false });
    }
    for (let i = 0; i <= 9; i++) {
      const p = at(`lamp:${i}`);
      if (p && h.lantern > 0) glows.push({ x: p[0], y: p[1], r: 42, k: 0.9 * h.lantern, fire: false });
    }
    for (const name of ['oven', 'forge', 'flue:0']) {
      const p = at(name);
      if (p && m.fire > 0 && (name !== 'flue:0' || b.type === 'watchtower')) glows.push({ x: p[0], y: p[1], r: 48, k: m.fire, fire: true });
    }
  }
  // smoke only while a fire burns: the hearth's from the chimneys, a furnace's from its flue
  for (let i = 0; ; i++) {
    const p = at(`smoke:${i}`);
    if (!p) break;
    if (h.hearth > 0.02) smoke(ctx, p[0], p[1], world.time, b.id * 7 + i, Math.min(1.4, h.hearth * 1.1));
  }
  for (let i = 0; ; i++) {
    const p = at(`flue:${i}`);
    if (!p) break;
    if (h.furnace > 0.02) smoke(ctx, p[0], p[1], world.time, b.id * 11 + i, Math.min(1.5, h.furnace * 1.3));
  }
  // sleepers
  const sleeping = Math.min(h.asleep, 2);
  for (let i = 0; i < sleeping; i++) {
    const p = at(`sleep:${i}`) ?? at('sleep:0');
    if (p) drawSnore(ctx, p[0] + i * 6, p[1], world.time + i * 1.3);
  }
}

/** Little z's drifting up from a sleeper's window. */
function drawSnore(ctx: Ctx, x: number, y: number, time: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.35 + i / 3) % 1;
    ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9;
    ctx.fillStyle = '#f3ead8';
    ctx.font = `bold ${8 + t * 8}px Georgia, serif`;
    ctx.fillText('z', x + t * 18 + Math.sin(t * 6) * 3, y - t * 34);
  }
  ctx.restore();
}

/** Whether a type has workers who live in it (they sleep there). */
export const housesWorkers = (type: BuildingType) => Object.keys(BUILDINGS[type].jobs).length > 0;
