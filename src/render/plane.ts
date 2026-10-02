// The village is a plane (the map, game/streets.ts), and the view is a camera
// standing in front of the street the rider is on, looking across it at the
// lots behind. Everything on the plane is seen in true perspective from there:
// the further away, the smaller and the nearer the horizon. Buildings, trees
// and people are flat pictures that always face the camera.
//
// The street being looked at is drawn as it always was (scene.ts): its world
// y *is* where things at that depth come out on screen, and ground.ts groundX
// is this same perspective along it. Every other street (behind it, crossing
// it, running off from it) is projected here from map positions: its road and
// fields as shapes on the ground, and everything standing on it as a picture
// scaled by distance.

import { BUILDINGS } from '../game/buildings';
import { crossroadsPlaces, sizeOfBuilding } from '../game/grid';
import { BASE_Y, CELL_W, EYE_DIST, FIELD_ROWS, QUARRIES, quarryLand, ROAD_FAR_Y, ROAD_NEAR_Y, STREET_LINE_Y, TREE_Y } from '../game/layout';
import { employees } from '../game/people';
import { laidOut, onSite, upgrading } from '../game/site';
import { backOf, crossings, groundPoint, mapPoint, SIDE_ROAD_HALF, streetOf, streetRange, type Street, type Vec } from '../game/streets';
import { getBuilding, type Building, type World } from '../game/world';
import { drawCrossroadsSign, type DrawArgs } from './buildings';
import type { ViewId } from './manifest';
import { drawBuilding } from './sprites';
import { drawConstruction, drawDemolition, drawUpgrade } from './construction';
import { cropRowAt, drawWorker, farmerScale } from './farm';
import { figureOf } from './figure';
import { GROUND_REF_Y, HORIZON_Y } from './ground';
import { beingFelled, drawQuarry, drawTreeAt } from './nature';
import { drawVillager, walker } from './people';
import { cameraDistance, cameraHeight, viewHorizon } from './ground';
import { has3d } from './world3d';
import { type Ctx, mix } from './util';

const SPAN = GROUND_REF_Y - HORIZON_Y;
/** Distance from the camera of ground at depth y of the street being looked at. */
export const distAt = (y: number) => (EYE_DIST * SPAN) / (y - HORIZON_Y);
const ROAD_DIST = distAt(STREET_LINE_Y);
/** Nothing nearer than this is drawn (it is below the bottom of the screen anyway). */
const NEAR_DRAWN = 150;
/** The same cut-off in the game's distances (z): the drawing camera may stand further back (ground.ts). */
const nearZ = () => NEAR_DRAWN - (cameraDistance() - EYE_DIST);
/** Crops on other streets' fields are drawn while they come out at least this big; smaller, the field's colour stands for them. */
const CROP_MIN_SCALE = 0.12;
/** …and no bigger than this (this street's front field tops out at about 1.55). */
const CROP_MAX_SIZE = 1.6;
/** Things this far off are too small to make out. */
const FAR = 9000;
/** Pictures further than this are behind the tree line of the street being looked at… */
export const TREE_LINE_DIST = distAt(TREE_Y);
/** …and further than this behind its buildings. */
export const BUILDING_LINE_DIST = distAt(BASE_Y - 4);

/** The camera: on the map in front of the middle of the view, looking along `back` of the street. */
export interface Eye {
  street: number;
  /** Map point on the road line at the middle of the view. */
  at: Vec;
  dir: Vec;
  back: Vec;
  /** Screen x of the middle of the view (the vanishing point). */
  vpX: number;
  viewW: number;
}

export function eyeOf(world: World, camX: number, viewW: number): Eye {
  const x = camX + viewW / 2;
  const s = world.streets[streetOf(x)] ?? world.streets[0];
  return { street: s.index, at: mapPoint(world, x), dir: s.dir, back: backOf(s.dir), vpX: viewW / 2, viewW };
}

const ground = groundPoint;

/** Sideways (u) and away (z) from the camera. */
function toEye(eye: Eye, p: Vec): { u: number; z: number } {
  const dx = p.x - eye.at.x;
  const dy = p.y - eye.at.y;
  return { u: dx * eye.dir.x + dy * eye.dir.y, z: ROAD_DIST + dx * eye.back.x + dy * eye.back.y };
}

/** Screen position and scale of a point u across and z away from the game's camera, as the drawing camera sees it (ground.ts). */
function project(eye: Eye, u: number, z: number): { x: number; y: number; s: number } {
  const cam = cameraDistance();
  const s = cam / (z + cam - EYE_DIST);
  return { x: eye.vpX + u * s, y: viewHorizon() + cameraHeight() * s, s };
}

/** A shape lying on the ground (map points), cut off where it comes nearer than the near cut-off. */
function groundShape(ctx: Ctx, eye: Eye, pts: Vec[], fill: string): void {
  const NEAR = nearZ();
  const v = pts.map((p) => toEye(eye, p));
  const out: Array<{ u: number; z: number }> = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    if (a.z >= NEAR) out.push(a);
    if (a.z >= NEAR !== b.z >= NEAR) {
      const t = (NEAR - a.z) / (b.z - a.z);
      out.push({ u: a.u + (b.u - a.u) * t, z: NEAR });
    }
  }
  if (out.length < 3) return;
  // the lens bends lines that run away from the camera a little: cut long edges into short steps
  const steps: Array<{ u: number; z: number }> = [];
  out.forEach((a, i) => {
    const b = out[(i + 1) % out.length];
    const n = Math.min(40, Math.max(1, Math.ceil(Math.abs(b.z - a.z) / 60)));
    for (let k = 0; k < n; k++) steps.push({ u: a.u + ((b.u - a.u) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  });
  ctx.beginPath();
  steps.forEach((p, i) => {
    const q = project(eye, p.u, Math.min(p.z, FAR * 4));
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

const others = (world: World, eye: Eye) => world.streets.filter((s) => s.index !== eye.street && !s.gone);

/** The roads of the other streets, and the fields of the farms along them, on the ground. */
export function drawOtherGround(ctx: Ctx, world: World, eye: Eye): void {
  const road = (s: Street) => {
    const { min, max } = streetRange(world, s.index);
    return [ground(world, min, ROAD_FAR_Y), ground(world, max, ROAD_FAR_Y), ground(world, max, ROAD_NEAR_Y), ground(world, min, ROAD_NEAR_Y)];
  };
  const far = (pts: Vec[]) => Math.max(...pts.map((p) => toEye(eye, p).z));
  const shapes: Array<{ pts: Vec[]; fill: string }> = others(world, eye).map((s) => ({ pts: road(s), fill: '#a8875b' }));
  // the quarries' rocky land
  for (const q of QUARRIES) {
    const r = quarryLand(q);
    shapes.push({ pts: [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], fill: '#9d9585' });
  }
  for (const b of world.buildings) {
    const x = b.x;
    if (!b.farm || streetOf(x) === eye.street) continue;
    for (const p of b.farm.plots) {
      if (!p.tilled) continue;
      const row = FIELD_ROWS[p.zone][p.row];
      const x0 = x + p.dx - p.width / 2 + 2;
      const x1 = x + p.dx + p.width / 2 - 2;
      // near enough for its crop to be drawn (standingOn), the field is tilled soil under it; far off, its colour
      const mid = toEye(eye, ground(world, x + p.dx, (row.far + row.near) / 2));
      const cropsDrawn = p.state !== 'fallow' && project(eye, mid.u, Math.max(mid.z, 1)).s >= CROP_MIN_SCALE;
      const fill = cropsDrawn ? '#6f5234' : p.state === 'ripe' ? '#d4b24c' : p.state === 'growing' ? mix('#8a7048', '#7f9a44', Math.min(1, p.age / 90)) : '#8a6a44';
      shapes.push({ pts: [ground(world, x0, row.far), ground(world, x1, row.far), ground(world, x1, row.near), ground(world, x0, row.near)], fill });
    }
  }
  for (const sh of shapes.sort((a, b) => far(b.pts) - far(a.pts))) groundShape(ctx, eye, sh.pts, sh.fill);
}

/** Something standing on another street: how far away it is, where it comes out on screen, and how to draw it there. */
export interface Standing {
  z: number;
  y: number;
  draw: () => void;
}

/**
 * Everything standing on the plane except this street's buildings and people,
 * far to near, as pictures scaled by distance: the other streets' buildings,
 * building sites, crossroads' fingerposts and people, and every tree and quarry.
 */
/** Whether a building on another street is drawn in 3D (elsewhere3d) rather than as a picture. */
const in3d = (b: Building) => has3d(b.type) && !b.demolition && !upgrading(b);

/** A building on another street drawn in 3D: where it stands from the camera (plane.ts u, z) and which way it faces. */
export interface Elsewhere3d {
  b: Building;
  u: number;
  z: number;
  /** Turn about the vertical (radians) from facing the camera: its front faces its own street. */
  rot: number;
}

/**
 * The buildings on other streets that have a 3D model: at their true place on the map, turned to
 * face their street (world3d.ts draws them), instead of pictures turned to the camera.
 */
export function elsewhere3d(world: World, eye: Eye): Elsewhere3d[] {
  const out: Elsewhere3d[] = [];
  for (const b of world.buildings) {
    if (streetOf(b.x) === eye.street || !in3d(b)) continue;
    const { u, z } = toEye(eye, ground(world, b.x, BASE_Y));
    if (z < NEAR_DRAWN || z > FAR) continue;
    // its front faces its road: away from its lots
    const back = backOf(world.streets[streetOf(b.x)].dir);
    const fu = -(back.x * eye.dir.x + back.y * eye.dir.y);
    const fz = -(back.x * eye.back.x + back.y * eye.back.y);
    out.push({ b, u, z, rot: Math.atan2(fu, -fz) });
  }
  return out;
}

export function standingOn(ctx: Ctx, world: World, eye: Eye): Standing[] {
  const out: Standing[] = [];
  const add = (p: Vec, width: number, draw: () => void) => {
    const { u, z } = toEye(eye, p);
    // standing things keep the game camera's cut-off: what stood behind it shouldn't loom up in front
    if (z < NEAR_DRAWN || z > FAR) return;
    const q = project(eye, u, z);
    const half = (width / 2 + 40) * q.s;
    if (q.x + half < 0 || q.x - half > eye.viewW) return;
    out.push({
      z,
      y: q.y,
      draw: () => {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.scale(q.s, q.s);
        draw();
        ctx.restore();
      },
    });
  };
  const elsewhere = (x: number) => streetOf(x) !== eye.street;
  /** Which way to mirror something facing +x along street s, as seen from the camera. */
  const facingOf = (s: Street | undefined) => (s && s.dir.x * eye.dir.x + s.dir.y * eye.dir.y < -0.5 ? -1 : 1);

  // buildings stand on their lots behind their street; one on a street running away from the camera is
  // seen end-on, so it is moved over beside the road rather than standing across it
  // (seen that way it shows its roadside view: L on the left of the road, its front facing right)
  const lot = (b: Building, x: number): { at: Vec; view: ViewId } => {
    const s = world.streets[streetOf(x)];
    const back = backOf(s.dir);
    const across = Math.abs(back.x * eye.dir.x + back.y * eye.dir.y) > 0.5;
    if (!across) return { at: ground(world, x, BASE_Y), view: 'street' };
    const p = mapPoint(world, x);
    const d = SIDE_ROAD_HALF + 10 + (sizeOfBuilding(b).w * CELL_W) / 2;
    const at = { x: p.x + back.x * d, y: p.y + back.y * d };
    return { at, view: toEye(eye, at).u < toEye(eye, p).u ? 'roadsideL' : 'roadsideR' };
  };
  for (const b of world.buildings) {
    const x = b.x;
    if (!elsewhere(x) || in3d(b)) continue;
    const a: DrawArgs = {
      x: 0,
      base: 0,
      time: world.time,
      seed: b.id * 97,
      farm: b.farm,
      upgraded: !!b.upgraded,
      width: sizeOfBuilding(b).w * CELL_W,
      stock: b.stock,
      workers: employees(world, b).map((p) => p.job!.worker),
      onSite: onSite(b),
      laid: laidOut(b),
      vpX: 0,
    };
    const { at, view } = lot(b, x);
    add(at, BUILDINGS[b.type].width, () => {
      if (b.demolition && b.demolition.from >= 1) drawDemolition(ctx, b.type, a, b.progress); // one still being built comes down through its stages
      else if (upgrading(b)) drawUpgrade(ctx, b.type, a, b.progress);
      else if (b.status === 'done') drawBuilding(ctx, b.type, a, view);
      else drawConstruction(ctx, b.type, a, b.progress);
    });
  }
  // the crops on other streets' fields, row by row, among everything else by distance
  for (const b of world.buildings) {
    if (!b.farm || !elsewhere(b.x)) continue;
    for (const p of b.farm.plots) {
      if (!p.tilled || p.state === 'fallow') continue;
      const { far, near } = FIELD_ROWS[p.zone][p.row];
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const y = far + ((near - far) * (r + 0.5)) / rows;
        const m = toEye(eye, ground(world, b.x + p.dx, y));
        if (m.z < NEAR_DRAWN || m.z > FAR) continue;
        const q = project(eye, m.u, m.z);
        if (q.s < CROP_MIN_SCALE || q.x + p.width * q.s < 0 || q.x - p.width * q.s > eye.viewW) continue;
        out.push({
          z: m.z,
          y: q.y,
          draw: () => {
            // stalks no bigger than this street's nearest crops (farm.ts cropSize): near the camera the field
            // grows denser rather than its stalks taller; far off, sparser
            const k = Math.min(CROP_MAX_SIZE, q.s * 1.1);
            const step = q.s >= 0.6 ? (4.5 * k) / q.s : (4.5 * 0.6) / q.s;
            const at: Array<{ x: number; y: number; s: number }> = [];
            for (let u = p.dx - p.width / 2 + 2; u < p.dx + p.width / 2 - 2; u += step) {
              const e = toEye(eye, ground(world, b.x + u + ((r * 7 + Math.floor(u)) % 3) * 0.6, y));
              if (e.z < NEAR_DRAWN) continue;
              const s = project(eye, e.u, e.z);
              at.push({ x: s.x, y: s.y, s: Math.min(CROP_MAX_SIZE, s.s * 1.1) });
            }
            cropRowAt(ctx, p, at, world.time, r);
          },
        });
      }
    }
  }
  // a crossroads' fingerpost stands at both of its ends
  for (const c of crossings(world)) {
    const b = getBuilding(world, c.buildingId);
    if (!b || !elsewhere(c.x) || b.x === c.x) continue;
    add(ground(world, c.x, BASE_Y), 80, () => drawBuilding(ctx, 'intersection', { x: 0, base: 0, time: world.time, seed: b.id * 97 }));
  }
  // and a signpost where a crossroads can be built
  for (const x of crossroadsPlaces(world)) if (elsewhere(x)) add(ground(world, x, BASE_Y), 80, () => drawCrossroadsSign(ctx, 0, 0, world.time));
  // every tree, wherever it stands (this street's too: they stand at all depths)
  const felling = beingFelled(world);
  for (const t of world.trees) add(ground(world, t.x, t.y), 60, () => drawTreeAt(ctx, world, t, 0, 0, 1, felling));
  // a quarry's crag rises from the front of its land as seen from the main street, over the middle of it from elsewhere
  QUARRIES.forEach((q, i) => {
    const r = quarryLand(q);
    add({ x: q.x, y: eye.street === 0 ? r.y0 : (r.y0 + r.y1) / 2 }, 320, () => drawQuarry(ctx, 0, 0, 1, i));
  });
  // people at work, and those strolling, wherever they are
  for (const p of world.people) {
    const b = p.job && getBuilding(world, p.job.buildingId);
    if (p.job && b) {
      const w = p.job.worker;
      const x = b.x + w.dx;
      if (!elsewhere(x)) continue;
      const f = facingOf(world.streets[streetOf(x)]);
      add(ground(world, x, w.y), 20, () => {
        ctx.scale(f / farmerScale(w.y), 1 / farmerScale(w.y));
        drawWorker(ctx, w, figureOf(p), 0, 0, world.time);
      });
    } else if (!p.job && elsewhere(p.stroll.x)) {
      const f = facingOf(world.streets[streetOf(p.stroll.x)]);
      add(ground(world, p.stroll.x, p.stroll.y), 20, () => {
        ctx.scale(f, 1);
        drawVillager(ctx, walker(p), 0, 0, world.time);
      });
    }
  }
  for (const a of world.animals) {
    if (!elsewhere(a.stroll.x)) continue;
    add(ground(world, a.stroll.x, a.stroll.y), 20, () => drawVillager(ctx, walker(a), 0, 0, world.time));
  }
  return out.sort((a, b) => b.z - a.z);
}
