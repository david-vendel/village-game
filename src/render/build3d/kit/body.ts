// The common body of a building: a rectangle of walls on a footing, one or
// two storeys (rubble stone, a timber frame filled with wattle and daub, or
// logs; an upper storey can be jettied out over the street on joists), doors
// and windows in them, a pitched roof, chimneys, and the interior seen through
// the openings. Built in order: the plan staked out, the trenches dug, the
// footing laid, each storey's walls (stone course by course, timber member by
// member), the roof timbers, battens and covering, the chimneys, and the
// scaffolding along the front while it goes up.

import type { RoofStyle, Stage, Vec3 } from '../elements';
import type { ModelBuilder } from '../model';
import { chimney, footing, type Opening, type Side, stoneShell } from './masonry';
import { bush, door, type DoorSpec, gate, ivy, type WallRef, window_ } from './openings';
import { lantern } from './props';
import { gableRoof, type RoofInfo } from './roof';
import { dig, scaffold, stakeOut, type Rect } from './site';
import { frameStorey, joists, logWalls } from './timber';

export interface Storey {
  kind: 'stone' | 'frame' | 'log';
  /** Floor to wall head (for a frame: underside of the sill to the top of the plate). */
  h: number;
  /** How far this storey stands out over the one below at the front (a jetty). */
  jetty?: number;
  infill?: 'daub' | 'brick' | 'boards';
  /** Stone material, or the daub's colour for a frame. */
  material?: string;
  thick?: number;
  quoins?: string;
}

export interface OpeningSpec {
  /** A door (one leaf), a window, or a gateway (two wide leaves: a barn's, a cart shed's). */
  kind: 'door' | 'window' | 'gate';
  side: Side;
  /** Middle along the wall (x for front/back, y for the sides). */
  u: number;
  w: number;
  h: number;
  storey: number;
  /** Window: sill height above the storey's floor. */
  sill?: number;
  name: string;
  shutters?: 'pair' | 'single' | 'none';
  hinge?: 'left' | 'right';
  arched?: boolean;
  /** In a stone storey: a round arch of voussoirs over it (h then reaches the crown); its leaves round-topped. */
  arch?: boolean;
  glass?: 'linen' | 'stained';
}

export interface BodySpec {
  rect: Rect;
  footing: { h: number; w?: number };
  storeys: Storey[];
  roof: { style: RoofStyle; pitchDeg: number; eaves: number; overL: number; overR: number; material?: string; gableFill?: 'boards' | 'daub'; gaps?: Array<{ x0: number; x1: number; z: number }> };
  openings: OpeningSpec[];
  /** Chimney stacks: x along the building, y (default just behind the ridge), size. */
  chimneys?: Array<{ x: number; y?: number; w?: number; d?: number; material?: string; lean?: number; rough?: boolean; above?: number }>;
  /** Stone gable ends on the sides (a stone top storey): left, right. */
  stoneGables?: { left: boolean; right: boolean };
  /** No scaffolding (a low hut). */
  noScaffold?: boolean;
  prefix?: string;
  /** No ivy and bushes of its own (the generator places its greenery itself). */
  noGreenery?: boolean;
  /** Where the spoil heaps go (default: inside, either side of the middle). */
  heaps?: Array<[number, number]>;
}

export interface BodyInfo {
  /** Floor height of each storey and the wall head above the last. */
  floors: number[];
  wallTop: number;
  roof: RoofInfo;
  /** Each storey's outer faces (a jettied one stands out at the front). */
  rects: Rect[];
  /** Smoke points of the chimneys. */
  smoke: Vec3[];
  /** Window middles by name. */
  windows: Record<string, Vec3>;
  doors: Record<string, Vec3>;
}

const wallRef = (r: Rect, side: Side, thick: number): WallRef => ({ side, thick, face: side === 'front' ? r.y0 : side === 'back' ? r.y1 : side === 'left' ? r.x0 : r.x1 });

export function body(b: ModelBuilder, spec: BodySpec): BodyInfo {
  const pre = spec.prefix ?? '';
  const r = spec.rect;
  const fw = spec.footing.w ?? 0.45;
  // the plan pegged out, the trenches dug
  stakeOut(b, r, pre);
  const ins = fw / 2;
  dig(
    b,
    [
      { a: [r.x0, r.y0 + ins], b: [r.x1, r.y0 + ins], w: fw + 0.08 },
      { a: [r.x1 - ins, r.y0 + fw], b: [r.x1 - ins, r.y1 - fw], w: fw + 0.08 },
      { a: [r.x1, r.y1 - ins], b: [r.x0, r.y1 - ins], w: fw + 0.08 },
      { a: [r.x0 + ins, r.y1 - fw], b: [r.x0 + ins, r.y0 + fw], w: fw + 0.08 },
    ],
    spec.heaps ?? [
      [r.x0 + (r.x1 - r.x0) * 0.3, (r.y0 + r.y1) / 2],
      [r.x0 + (r.x1 - r.x0) * 0.7, (r.y0 + r.y1) / 2],
    ],
    pre,
  );
  footing(b, r, { h: spec.footing.h, w: fw, prefix: `${pre}ft` });

  // the storeys, bottom up
  const floors: number[] = [];
  const rects: Rect[] = [];
  let z = spec.footing.h;
  let rect: Rect = { ...r };
  const windows: Record<string, Vec3> = {};
  const doors: Record<string, Vec3> = {};
  const top = spec.storeys.length - 1;
  let thickTop = 0.2;
  let doorQueue: Array<() => void> = [];
  spec.storeys.forEach((s, i) => {
    if (s.jetty && i > 0) {
      z = joists(b, { x0: rect.x0, x1: rect.x1, y0: rect.y0, y1: rect.y1, z, out: s.jetty, prefix: `${pre}s${i}.`, stage: 'frame' });
      rect = { ...rect, y0: rect.y0 - s.jetty };
    }
    floors.push(z);
    rects.push({ ...rect });
    const ops = spec.openings.filter((o) => o.storey === i);
    const thick = s.kind === 'stone' ? (s.thick ?? 0.4) : s.kind === 'log' ? 0.26 : 0.2;
    thickTop = thick;
    // opening extents in absolute heights; a frame's door starts on top of its sill
    const sillH = s.kind === 'frame' ? 0.2 : 0;
    const byWall: Partial<Record<Side, Opening[]>> = {};
    const rects_: Record<string, { z0: number; z1: number }> = {};
    for (const o of ops) {
      const z0 = o.kind === 'window' ? z + sillH + (o.sill ?? 0.85) : z + sillH;
      const z1 = z0 + o.h;
      rects_[o.name] = { z0, z1 };
      const arch = !!o.arch && s.kind === 'stone';
      (byWall[o.side] ??= []).push({ u0: o.u - o.w / 2, u1: o.u + o.w / 2, z0, z1, sill: o.kind === 'window', lintel: s.kind === 'stone' && !arch ? 'stone' : 'none', arch });
    }
    let head: number;
    // a stone storey carrying a timber one is built whole before the frame goes up on it
    const carries = s.kind === 'stone' && spec.storeys.slice(i + 1).some((u) => u.kind !== 'stone');
    const stageOf = (zz: number): Stage => (carries || (i === 0 && zz < z + s.h * 0.5) ? 'frame' : 'walls');
    if (s.kind === 'stone') {
      const gables = i === top && spec.stoneGables && (spec.stoneGables.left || spec.stoneGables.right) ? spec.stoneGables : undefined;
      const pitch = (spec.roof.pitchDeg * Math.PI) / 180;
      const apex = z + s.h + ((rect.y1 - rect.y0) / 2) * Math.tan(pitch) - 0.05;
      stoneShell(b, { rect, thick, z0: z, z1: z + s.h, material: s.material ?? 'rubble', quoins: s.quoins, openings: byWall, gables: gables ? { ...gables, apex, pitchDeg: spec.roof.pitchDeg } : undefined, stage: stageOf, prefix: `${pre}s${i}.` });
      head = z + s.h;
      // a timber wall plate along the top of the long walls for the rafters
      if (i === top) {
        for (const [side, y] of [
          ['front', rect.y0 + thick / 2],
          ['back', rect.y1 - thick / 2],
        ] as const)
          b.beam(`${pre}wallplate.${side}`, 'plate', [rect.x0 + 0.05, y, head + 0.07], [rect.x1 - 0.05, y, head + 0.07], [0.2, 0.14], 'walls', []);
        head += 0.14;
      }
    } else if (s.kind === 'frame') {
      const res = frameStorey(b, { rect, z0: z, postH: s.h - 0.2 - 0.18, openings: byWall, infill: s.infill ?? 'daub', daub: s.material, prefix: `${pre}s${i}.`, stage: 'frame', infillStage: 'walls' });
      head = res.plateTop;
    } else {
      head = logWalls(b, { rect, z0: z, z1: z + s.h, openings: byWall, stage: stageOf, prefix: `${pre}s${i}.` });
    }
    // doors and windows go in once the walls are up (queued: they're added after the storey's walls)
    for (const o of ops) {
      const w = wallRef(rect, o.side, thick);
      const { z0 } = rects_[o.name];
      if (o.kind === 'door') {
        const d: DoorSpec = { wall: w, u: o.u, w: o.w, h: o.h, z0, name: o.name, hinge: o.hinge, frame: s.kind !== 'stone', arched: o.arched || (!!o.arch && s.kind === 'stone'), stage: 'walls' };
        doorQueue.push(() => (doors[o.name] = door(b, d)));
      } else if (o.kind === 'gate') {
        doorQueue.push(() => (doors[o.name] = gate(b, { wall: w, u: o.u, w: o.w, h: o.h, z0, name: o.name, arched: !!o.arch && s.kind === 'stone', stage: 'walls' })));
      } else {
        doorQueue.push(() => (windows[o.name] = window_(b, { wall: w, u: o.u, w: o.w, h: o.h, z0, name: o.name, shutters: o.shutters, frame: s.kind !== 'stone', stage: 'walls', glass: o.glass })));
      }
    }
    z = head;
  });
  const wallTop = z;
  for (const f of doorQueue) f();
  doorQueue = [];
  // every window a named point (lamplight shows there at night), and a lantern by each front door
  Object.values(windows).forEach((p) => b.point(`window:${Object.keys(b.points).filter((n) => n.startsWith('window:')).length}`, p));
  spec.openings
    .filter((o) => o.kind === 'door' && o.side === 'front' && o.storey === 0)
    .forEach((o, i) => {
      const r0 = rects[0];
      const side = o.u + o.w / 2 + 0.3 < r0.x1 - 0.15 ? 1 : -1;
      const x = o.u + side * (o.w / 2 + 0.3);
      lantern(b, `${pre}lantern${i}`, x, r0.y0, 2.28);
      b.point(`lamp:${Object.keys(b.points).filter((n) => n.startsWith('lamp:')).length}`, [x, r0.y0 - 0.25, 2.28]);
    });

  // the roof: timber-framed walls have their rafters raised with the frame, stone ones after the walls
  const topStorey = spec.storeys[top];
  const tr = rects[top];
  const roof = gableRoof(b, {
    x0: tr.x0,
    x1: tr.x1,
    y0: tr.y0,
    y1: tr.y1,
    zWall: wallTop,
    pitchDeg: spec.roof.pitchDeg,
    style: spec.roof.style,
    eaves: spec.roof.eaves,
    overL: spec.roof.overL,
    overR: spec.roof.overR,
    stage: topStorey.kind === 'frame' ? 'frame' : 'roof',
    prefix: `${pre}roof.`,
    material: spec.roof.material,
    gaps: spec.roof.gaps,
    gableFill:
      topStorey.kind === 'stone' && spec.stoneGables
        ? { left: spec.stoneGables.left ? 'none' : (spec.roof.gableFill ?? 'boards'), right: spec.stoneGables.right ? 'none' : (spec.roof.gableFill ?? 'boards') }
        : { left: spec.roof.gableFill ?? (topStorey.kind === 'frame' ? 'daub' : 'boards'), right: spec.roof.gableFill ?? (topStorey.kind === 'frame' ? 'daub' : 'boards') },
  });

  // chimneys from the hearth up through the roof
  const smoke: Vec3[] = [];
  (spec.chimneys ?? []).forEach((c, i) => {
    const y = c.y ?? roof.ridgeY + 0.32;
    const roofZ = roof.surface(y);
    smoke.push(chimney(b, { x: c.x, y, w: c.w ?? 0.55, d: c.d ?? 0.5, z0: wallTop - 0.4, z1: roof.ridgeZ + (c.above ?? 0.5), roofZ, material: c.material ?? 'ashlar', prefix: `${pre}chimney${i}.`, lean: c.lean, rough: c.rough }));
  });

  // the rooms inside, dark (lit by the fire and lamps): seen through open doors and windows
  const inT = thickTop + 0.02;
  b.box(`${pre}interior`, 'interior', [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (spec.footing.h + wallTop) / 2], [r.x1 - r.x0 - inT * 2, r.y1 - r.y0 - inT * 2, wallTop - spec.footing.h - 0.02], 'interior', 'roof', []);

  // greenery: ivy up the front where there's room before it, bushes where there's more
  const gap = r.y0 - b.plot.y0;
  const front = wallRef(r, 'front', thickTop);
  const g = b.rng(`${pre}green`);
  if (gap >= 0.1 && !spec.noGreenery) {
    const doorsAt = spec.openings.filter((o) => o.kind === 'door' && o.side === 'front').map((o) => o.u);
    const spots = [r.x0 + 0.35, r.x1 - 0.35, ...doorsAt.map((u) => u + (g() < 0.5 ? -0.75 : 0.75))].filter((u) => u > r.x0 + 0.2 && u < r.x1 - 0.2);
    const n = 1 + Math.floor(g() * 2);
    for (let i = 0; i < Math.min(n, spots.length); i++) {
      const u = spots[Math.floor(g() * spots.length)];
      ivy(b, `${pre}ivy${i}`, front, u, Math.min(wallTop - 0.2, 1.6 + g() * 1.6), 0.35 + g() * 0.35);
    }
    if (gap >= 0.3) {
      const rad = Math.min(0.3, gap / 2 - 0.04);
      const xs = [r.x0 + 0.4, r.x1 - 0.4, ...doorsAt.map((u) => u + 0.8)].filter((x) => !doorsAt.some((d) => Math.abs(d - x) < 0.6));
      for (let i = 0; i < 2 && xs.length; i++) if (g() < 0.65) bush(b, `${pre}bush${i}`, xs[Math.floor(g() * xs.length)], b.plot.y0 + gap / 2, rad * 2);
    }
  }

  if (!spec.noScaffold) {
    const first = spec.storeys[0].kind;
    scaffold(b, { x0: r.x0 + 0.2, x1: r.x1 - 0.2, y: r.y0, out: 0.75, height: wallTop - 0.3, stage: first === 'stone' ? 'frame' : 'walls', prefix: `${pre}scaffold.` });
  }
  return { floors, wallTop, roof, rects, smoke, windows, doors };
}
