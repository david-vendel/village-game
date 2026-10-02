// The farm: a 13th-14th century Central European farmstead. A timber-framed
// dwelling (oak post-and-beam on a fieldstone footing, limewashed
// wattle-and-daub, a steep thatched roof with a chimney, shuttered window,
// plank door) with a lean-to barn against its right gable.
//
// Fitted to the game: as wide as BUILDINGS.farm.width (7.5 m), the door
// centred on HOME.dx, the grain store's ground (STORE.dx ± 1.25 m) in front
// left clear. The Large farm (variant "upgraded") adds a bay with a second room
// and window right of the hall; the lean-to barn gives up that bay, so the
// footprint doesn't change. farm(seed) gives both looks merged: elements in
// only one look are tagged variant:upgraded / novariant:upgraded. The seed
// varies the stones and boards, so no two farms are quite alike.

import { BUILDINGS } from '../../game/buildings';
import { CELL_W, HOME } from '../../game/layout';
import { Builder, type Element, uniform, type Vec3 } from './elements';

const U = 20; // world units per metre

export interface FarmSpec {
  width: number; // whole farmstead along the street (house + barn)
  depth: number; // house, front to back
  houseX0: number; // left end of the house
  houseX1: number; // right end of the house (the barn takes the rest)
  bayUpgraded: number; // the Large farm's extra bay
  doorX: number;
  doorW: number;
  doorH: number;
  footingH: number;
  footingW: number;
  sill: [number, number]; // width, height
  post: number;
  wallH: number; // sill top to plate bottom
  plate: [number, number];
  tie: [number, number];
  tieOverhang: number;
  pitchDeg: number; // thatch wants 45-55°
  rafter: [number, number];
  rafterSpacing: number;
  eaveOverhang: number;
  gableOverhang: number;
  thatch: number;
  battenSpacing: number;
  windowW: number;
  windowH: number;
  barnDepth: number;
  barnLow: number; // barn eave height at its outer wall
}

export const SPEC: FarmSpec = {
  width: BUILDINGS.farm.width / U,
  // the house fills the plot's depth (BUILDINGS.farm.depth cells), less a little for the eaves
  depth: ((BUILDINGS.farm.depth ?? 2) * CELL_W) / U - 0.25,
  houseX0: -BUILDINGS.farm.width / U / 2,
  houseX1: 0.6,
  bayUpgraded: 1.6,
  doorX: HOME.dx / U,
  doorW: 0.9,
  doorH: 1.8,
  footingH: 0.5,
  footingW: 0.45,
  sill: [0.22, 0.22],
  post: 0.2,
  wallH: 2.0,
  plate: [0.22, 0.2],
  tie: [0.2, 0.24],
  tieOverhang: 0.35,
  pitchDeg: 45,
  rafter: [0.13, 0.16],
  rafterSpacing: 0.95,
  eaveOverhang: 0.55,
  gableOverhang: 0.35,
  thatch: 0.34,
  battenSpacing: 0.32,
  windowW: 0.7,
  windowH: 0.6,
  barnDepth: ((BUILDINGS.farm.depth ?? 2) * CELL_W) / U - 0.75,
  barnLow: 2.1,
};

const sillTop = (s: FarmSpec) => s.footingH + s.sill[1];
const plateBottom = (s: FarmSpec) => sillTop(s) + s.wallH;
/** Top of the wall plates: where the tie beams sit. */
const eaveZ = (s: FarmSpec) => plateBottom(s) + s.plate[1];
/** Centre line of the front wall timbers (the back wall mirrors it). */
const wallY = (s: FarmSpec) => 0.05 + s.sill[0] / 2;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where the chimney stands: x, and y from the ridge line (behind it). */
const CHIMNEY: [number, number] = [-1.9, 0.7];

/** Heights of the roof: rafter feet and apex (centre line), the thatch's outer ridge, the chimney top. */
export function roofLevels(s: FarmSpec = SPEC): { rafterFoot: number; rafterApex: number; ridgeOuter: number; chimneyTop: number } {
  const pitch = rad(s.pitchDeg);
  const foot = eaveZ(s) + s.tie[1];
  const apex = foot + (s.depth / 2 + s.eaveOverhang) * Math.tan(pitch);
  const lift = (s.rafter[1] / 2 + 0.04 + s.thatch) / Math.cos(pitch);
  return { rafterFoot: foot, rafterApex: apex, ridgeOuter: apex + lift, chimneyTop: apex + lift + 0.75 };
}

/**
 * The house's wall bays for a house ending at x1: front and back post centres, the window bays
 * (the room left of the door; the Large farm's room on the right) and the door bay. The room
 * gets a post of its own between it and the hall only where it is wide enough for one.
 */
function bays(s: FarmSpec, x1: number): { front: number[]; back: number[]; windows: Array<[number, number]>; door: [number, number] } {
  const half = s.post / 2;
  const corner = s.houseX0 + 0.05 + half;
  const doorL = s.doorX - s.doorW / 2 - half;
  const doorR = s.doorX + s.doorW / 2 + half;
  const end = s.houseX1 - 0.05 - half;
  const room = doorL - corner > 2.6 ? corner + (doorL - corner) * 0.6 : null;
  const bay = x1 > s.houseX1 + 1e-9 ? x1 - 0.05 - half : null;
  const front = [corner, ...(room !== null ? [room] : []), doorL, doorR, end, ...(bay !== null ? [bay] : [])];
  const back = [corner, ...(room !== null ? [room] : []), s.doorX, end, ...(bay !== null ? [bay] : [])];
  const windows: Array<[number, number]> = [[corner, room ?? doorL], ...(bay !== null ? [[end, bay] as [number, number]] : [])];
  return { front, back, windows, door: [doorL, doorR] };
}

/** Fieldstone footing in two courses round a rectangle (outer faces at the given lines). */
function footing(b: Builder, s: FarmSpec, x0: number, x1: number, y0: number, y1: number, prefix: string): string[] {
  const ids: string[] = [];
  const w = s.footingW;
  const courseH = s.footingH / 2;
  const runs: Array<[string, [number, number], [number, number]]> = [
    ['f', [x0, y0 + w / 2], [x1, y0 + w / 2]],
    ['b', [x0, y1 - w / 2], [x1, y1 - w / 2]],
    ['l', [x0 + w / 2, y0 + w], [x0 + w / 2, y1 - w]],
    ['r', [x1 - w / 2, y0 + w], [x1 - w / 2, y1 - w]],
  ];
  for (const [name, [ax, ay], [bx, by]] of runs) {
    const length = Math.hypot(bx - ax, by - ay);
    const alongX = Math.abs(bx - ax) > Math.abs(by - ay);
    for (let course = 0; course < 2; course++) {
      const r = b.rng(`${prefix}${name}${course}`);
      let t = course === 0 ? 0 : uniform(r, 0.15, 0.3); // the upper course starts short: joints don't line up
      for (let i = 0; t < length - 1e-6; i++) {
        let l = Math.min(length - t, uniform(r, 0.32, 0.62));
        if (length - t - l < 0.18) l = length - t; // don't leave a sliver
        const cx = alongX ? ax + ((bx - ax) * (t + l / 2)) / length : ax;
        const cy = alongX ? ay : ay + ((by - ay) * (t + l / 2)) / length;
        const h = courseH * uniform(r, 0.92, 1.08);
        const d = w * uniform(r, 0.88, 1);
        const size: Vec3 = alongX ? [l - 0.02, d, h] : [d, l - 0.02, h];
        const id = `${prefix}${name}${course}.${i}`;
        b.box(id, 'footing-stone', [cx, cy, course * courseH + h / 2], size, 'fieldstone', 'foundation', [], { shape: 'stone', rot: [0, 0, uniform(r, -0.04, 0.04)] });
        ids.push(id);
        t += l;
      }
    }
  }
  return ids;
}

function house(b: Builder, s: FarmSpec, upgraded: boolean): void {
  const x0 = s.houseX0;
  const x1 = s.houseX1 + (upgraded ? s.bayUpgraded : 0);
  const D = s.depth;
  const half = s.post / 2;
  const wyF = wallY(s);
  const wyB = D - wallY(s);
  const st = sillTop(s);
  const pb = plateBottom(s);

  // staking: the corners pegged out and strung (taken away when the walls go up)
  const corners: Array<[number, number]> = [
    [x0, 0],
    [x1, 0],
    [x1, D],
    [x0, D],
  ];
  corners.forEach(([px, py], i) => b.box(`stake${i}`, 'stake', [px, py, 0.3], [0.05, 0.05, 0.6], 'pole', 'staking', [], { tags: ['scaffold'] }));
  corners.forEach(([ax, ay], i) => {
    const [bx, by] = corners[(i + 1) % 4];
    b.beam(`line${i}`, 'line', [ax, ay, 0.45], [bx, by, 0.45], [0.012, 0.012], 'staking', [`stake${i}`], 'rope', ['scaffold']);
  });

  // foundation: the footing, and a step stone before the door
  const foot = footing(b, s, x0, x1, 0, D, 'ft');
  b.box('step', 'step-stone', [s.doorX, -0.3, 0.09], [1.1, 0.55, 0.18], 'fieldstone', 'foundation', [], { shape: 'stone' });

  // frame: sills on the footing
  const sz = s.sill;
  const sc = s.footingH + sz[1] / 2;
  const sills: Record<string, [Vec3, Vec3]> = {
    'sill.f': [[x0 + 0.05, wyF, sc], [x1 - 0.05, wyF, sc]],
    'sill.b': [[x0 + 0.05, wyB, sc], [x1 - 0.05, wyB, sc]],
    'sill.l': [[x0 + 0.05 + half, wyF + sz[0] / 2, sc], [x0 + 0.05 + half, wyB - sz[0] / 2, sc]],
    'sill.r': [[x1 - 0.05 - half, wyF + sz[0] / 2, sc], [x1 - 0.05 - half, wyB - sz[0] / 2, sc]],
  };
  for (const [id, [a, c]] of Object.entries(sills)) b.beam(id, 'sill', a, c, sz, 'frame', foot.slice(0, 1));

  // posts: front, back, and the gable middles
  const posts: Record<string, [number, number, string]> = {};
  const { front: fx, back: bx, windows: winBays, door: doorBay } = bays(s, x1);
  fx.forEach((px, i) => (posts[`post.f${i}`] = [px, wyF, 'sill.f']));
  bx.forEach((px, i) => (posts[`post.b${i}`] = [px, wyB, 'sill.b']));
  posts['post.l'] = [x0 + 0.05 + half, D / 2, 'sill.l'];
  posts['post.r'] = [x1 - 0.05 - half, D / 2, 'sill.r'];
  for (const [id, [px, py, sill]] of Object.entries(posts)) b.box(id, 'post', [px, py, (st + pb) / 2], [s.post, s.post, pb - st], 'oak', 'frame', [sill]);

  // wall plates on the posts, front and back, and at the gables
  const pl = s.plate;
  const pzc = pb + pl[1] / 2;
  const ids = Object.keys(posts);
  b.beam('plate.f', 'plate', [x0 + 0.05, wyF, pzc], [x1 - 0.05, wyF, pzc], pl, 'frame', ids.filter((p) => p.startsWith('post.f')));
  b.beam('plate.b', 'plate', [x0 + 0.05, wyB, pzc], [x1 - 0.05, wyB, pzc], pl, 'frame', ids.filter((p) => p.startsWith('post.b')));
  b.beam('plate.l', 'plate', [x0 + 0.05 + half, wyF + pl[0] / 2, pzc], [x0 + 0.05 + half, wyB - pl[0] / 2, pzc], pl, 'frame', ['post.l']);
  b.beam('plate.r', 'plate', [x1 - 0.05 - half, wyF + pl[0] / 2, pzc], [x1 - 0.05 - half, wyB - pl[0] / 2, pzc], pl, 'frame', ['post.r']);

  // girts and braces in the front wall, bay by bay
  const isBay = (i: number, pair: [number, number]) => fx[i] === pair[0] && fx[i + 1] === pair[1];
  const mid = st + s.wallH * 0.5;
  const winSill = st + 0.95;
  const winHead = winSill + s.windowH;
  for (let i = 0; i < fx.length - 1; i++) {
    const a = fx[i] + half;
    const c = fx[i + 1] - half;
    const on = [`post.f${i}`, `post.f${i + 1}`];
    if (isBay(i, doorBay)) {
      b.beam(`girt.f${i}.head`, 'girt', [a, wyF, st + s.doorH + 0.06], [c, wyF, st + s.doorH + 0.06], [0.18, 0.14], 'frame', on);
    } else if (winBays.some((w) => isBay(i, w))) {
      b.beam(`girt.f${i}.wsill`, 'girt', [a, wyF, winSill - 0.06], [c, wyF, winSill - 0.06], [0.18, 0.12], 'frame', on);
      b.beam(`girt.f${i}.whead`, 'girt', [a, wyF, winHead + 0.06], [c, wyF, winHead + 0.06], [0.18, 0.12], 'frame', on);
    } else {
      b.beam(`girt.f${i}`, 'girt', [a, wyF, mid], [c, wyF, mid], [0.18, 0.14], 'frame', on);
      // a brace triangulating the bay: from the foot of one post to the head of the other
      const risingRight = i % 2 === 0;
      b.beam(`brace.f${i}`, 'brace', [risingRight ? a : c, wyF, st + 0.02], [risingRight ? c : a, wyF, pb - 0.02], [0.16, 0.12], 'frame', [...on, 'sill.f', 'plate.f']);
    }
  }
  // back wall: a girt per bay
  for (let i = 0; i < bx.length - 1; i++) b.beam(`girt.b${i}`, 'girt', [bx[i] + half, wyB, mid], [bx[i + 1] - half, wyB, mid], [0.18, 0.14], 'frame', [`post.b${i}`, `post.b${i + 1}`]);
  // gable walls: girts, and a brace in each half
  for (const [side, gx, pid] of [
    ['l', x0 + 0.05 + half, 'post.l'],
    ['r', x1 - 0.05 - half, 'post.r'],
  ] as const) {
    const cornerF = side === 'l' ? 'post.f0' : `post.f${fx.length - 1}`;
    const cornerB = side === 'l' ? 'post.b0' : `post.b${bx.length - 1}`;
    const halves: Array<[number, number, string]> = [
      [wyF + half, D / 2 - half, cornerF],
      [D / 2 + half, wyB - half, cornerB],
    ];
    halves.forEach(([ya, yc, cp], j) => {
      b.beam(`girt.${side}${j}`, 'girt', [gx, ya, mid], [gx, yc, mid], [0.18, 0.14], 'frame', [pid, cp]);
      const [lo, hi] = j === 0 ? [ya, yc] : [yc, ya];
      b.beam(`brace.${side}${j}`, 'brace', [gx, lo, st + 0.02], [gx, hi, pb - 0.02], [0.16, 0.12], 'frame', [pid, cp, `sill.${side}`, `plate.${side}`]);
    });
  }

  // tie beams across the house over every front post but the door jambs, and one over the door
  const tz = eaveZ(s) + s.tie[1] / 2;
  const tieXs = [...new Set([...fx.filter((x) => x !== doorBay[0] && x !== doorBay[1]), s.doorX].map((x) => Math.round(x * 1e4) / 1e4))].sort((p, q) => p - q);
  tieXs.forEach((tx, i) => b.beam(`tie${i}`, 'tie-beam', [tx, -s.tieOverhang, tz], [tx, D + s.tieOverhang, tz], s.tie, 'frame', ['plate.f', 'plate.b']));

  // rafters: pairs at even spacing, from beyond the eaves to the ridge; collars at two-thirds height
  const pitch = rad(s.pitchDeg);
  const lv = roofLevels(s);
  const footZ = lv.rafterFoot;
  const ridgeZ = lv.rafterApex;
  const run = D / 2 + s.eaveOverhang;
  const n = Math.max(2, Math.round((x1 - x0) / s.rafterSpacing));
  for (let k = 0; k <= n; k++) {
    const px = x0 + 0.12 + ((x1 - x0 - 0.24) * k) / n;
    b.beam(`rafter${k}f`, 'rafter', [px, -s.eaveOverhang, footZ], [px, D / 2, ridgeZ], s.rafter, 'frame', ['plate.f']);
    b.beam(`rafter${k}b`, 'rafter', [px, D + s.eaveOverhang, footZ], [px, D / 2, ridgeZ], s.rafter, 'frame', ['plate.b']);
    const cz = footZ + (ridgeZ - footZ) * 0.62;
    const cy = (ridgeZ - cz) / Math.tan(pitch);
    b.beam(`collar${k}`, 'collar', [px, D / 2 - cy, cz], [px, D / 2 + cy, cz], [0.1, 0.14], 'frame', [`rafter${k}f`, `rafter${k}b`]);
  }

  // walls: limewashed wattle-and-daub in every panel, the door, the window(s) with shutters
  const panel = (id: string, xa: number, xc: number, za: number, zc: number, y: number, on: string[]) =>
    b.box(id, 'daub', [(xa + xc) / 2, y + 0.015, (za + zc) / 2], [xc - xa, 0.12, zc - za], 'daub', 'walls', on);
  for (let i = 0; i < fx.length - 1; i++) {
    const a = fx[i] + half;
    const c = fx[i + 1] - half;
    const on = [`post.f${i}`, `post.f${i + 1}`];
    const wi = winBays.findIndex((w) => isBay(i, w));
    if (isBay(i, doorBay)) {
      panel(`daub.f${i}.over`, a, c, st + s.doorH + 0.13, pb, wyF, on);
      b.box('door', 'door', [s.doorX, wyF - 0.02, st + s.doorH / 2], [s.doorW, 0.06, s.doorH], 'planks', 'walls', on);
      b.box('door.lintel.dark', 'door-frame', [s.doorX, wyF + 0.01, st + s.doorH + 0.03], [s.doorW, 0.08, 0.06], 'oak', 'walls', on);
    } else if (wi >= 0) {
      const wc = (a + c) / 2;
      const ww = s.windowW;
      panel(`daub.f${i}.low`, a, c, st, winSill - 0.12, wyF, on);
      panel(`daub.f${i}.high`, a, c, winHead + 0.12, pb, wyF, on);
      panel(`daub.f${i}.wl`, a, wc - ww / 2, winSill, winHead, wyF, on);
      panel(`daub.f${i}.wr`, wc + ww / 2, c, winSill, winHead, wyF, on);
      // the opening: dark inside, lamp-lit at night
      b.box(`window${wi}`, 'window', [wc, wyF + 0.06, (winSill + winHead) / 2], [ww, 0.04, s.windowH], 'window', 'walls', on);
      // shutters, opened flat against the wall on either side
      [-1, 1].forEach((sx, k) => b.box(`shutter${wi}.${k}`, 'shutter', [wc + sx * (ww / 2 + ww / 4 + 0.03), wyF - 0.1, (winSill + winHead) / 2], [ww / 2, 0.04, s.windowH + 0.04], 'planks', 'walls', on));
    } else {
      panel(`daub.f${i}.low`, a, c, st, mid - 0.07, wyF, on);
      panel(`daub.f${i}.high`, a, c, mid + 0.07, pb, wyF, on);
    }
  }
  for (let i = 0; i < bx.length - 1; i++) {
    const on = [`post.b${i}`, `post.b${i + 1}`];
    panel(`daub.b${i}.low`, bx[i] + half, bx[i + 1] - half, st, mid - 0.07, wyB, on);
    panel(`daub.b${i}.high`, bx[i] + half, bx[i + 1] - half, mid + 0.07, pb, wyB, on);
  }
  for (const [side, gx] of [
    ['l', x0 + 0.05 + half],
    ['r', x1 - 0.05 - half],
  ] as const) {
    const gxs = side === 'l' ? gx - 0.015 : gx + 0.015;
    [
      [wyF + half, D / 2 - half],
      [D / 2 + half, wyB - half],
    ].forEach(([ya, yc], j) => {
      b.box(`daub.${side}${j}.low`, 'daub', [gxs, (ya + yc) / 2, (st + mid - 0.07) / 2], [0.12, yc - ya, mid - 0.07 - st], 'daub', 'walls', [`post.${side}`]);
      b.box(`daub.${side}${j}.high`, 'daub', [gxs, (ya + yc) / 2, (mid + 0.07 + pb) / 2], [0.12, yc - ya, pb - mid - 0.07], 'daub', 'walls', [`post.${side}`]);
    });
    // the gable triangle above the tie beam: vertical boards
    const x = gx + (side === 'r' ? 0.02 : -0.02);
    b.add({
      id: `gable.${side}`, kind: 'gable-boards', material: 'boards', stage: 'walls', shape: 'gable',
      params: { x, y0: 0, y1: D, z0: eaveZ(s) + s.tie[1], zRidge: ridgeZ - 0.2, thickness: 0.04, minX: x - 0.02, minY: 0.3, minZ: eaveZ(s) + s.tie[1], maxX: x + 0.02, maxY: D - 0.3, maxZ: ridgeZ - 0.2 },
      on: [side === 'l' ? 'rafter0f' : `rafter${n}f`],
    });
  }

  // roof: battens across the rafters, the thatch over them, the chimney through it
  const rows = Math.floor(run / Math.cos(pitch) / s.battenSpacing);
  for (const [side, sgn] of [
    ['f', 1],
    ['b', -1],
  ] as const) {
    for (let j = 0; j < rows; j++) {
      const t = (j + 0.5) / rows;
      const y = sgn > 0 ? -s.eaveOverhang + run * t : D + s.eaveOverhang - run * t;
      const z = footZ + run * t * Math.tan(pitch) + 0.1;
      b.beam(`batten.${side}${j}`, 'batten', [x0 - 0.05, y, z], [x1 + 0.05, y, z], [0.06, 0.04], 'roof', [`rafter0${side}`, `rafter${n}${side}`]);
    }
  }
  // the thatch lies on the battens: its outer surface parallel to the rafters, raised by half a
  // rafter, a batten and its own thickness; the eaves reach a little past the rafter feet
  const yFront = -s.eaveOverhang - 0.15;
  const yBack = D + s.eaveOverhang + 0.15;
  const eaveOuter = lv.ridgeOuter - (D / 2 - yFront) * Math.tan(pitch);
  b.add({
    id: 'thatch', kind: 'thatch', material: 'thatch', stage: 'roof', shape: 'roof',
    params: {
      x0: x0 - s.gableOverhang, x1: x1 + s.gableOverhang, yFront, yBack, eaveZ: eaveOuter, ridgeY: D / 2, ridgeZ: lv.ridgeOuter, thickness: s.thatch, pitchDeg: s.pitchDeg,
      minX: x0 - s.gableOverhang, minY: yFront, minZ: eaveOuter - s.thatch / Math.cos(pitch), maxX: x1 + s.gableOverhang, maxY: yBack, maxZ: lv.ridgeOuter,
    },
    on: [`batten.f${rows - 1}`, `batten.b${rows - 1}`],
  });
  const rz = lv.ridgeOuter - 0.04;
  b.add({ id: 'ridge', kind: 'ridge', material: 'thatch', stage: 'roof', shape: 'beam', a: [x0 - s.gableOverhang + 0.1, D / 2, rz], b: [x1 + s.gableOverhang - 0.1, D / 2, rz], size: [0, 0.62, 0.3], on: ['thatch'] });
  // the chimney rises from the hearth between the room and the hall
  const [cx, cyOff] = CHIMNEY;
  const cy = D / 2 + cyOff;
  const roofAt = lv.ridgeOuter - Math.abs(cy - D / 2) * Math.tan(pitch);
  const top = lv.chimneyTop;
  b.box('chimney', 'chimney', [cx, cy, (roofAt - 0.6 + top) / 2], [0.62, 0.62, top - roofAt + 0.6], 'clay-stone', 'roof', ['tie2']);
  b.box('chimney.cap', 'chimney', [cx, cy, top + 0.04], [0.76, 0.76, 0.08], 'fieldstone', 'roof', ['chimney']);

  // scaffolding along the front while the walls and roof are made
  [x0 - 0.5, (x0 + x1) / 2, x1 + 0.3].forEach((sx, k) => b.box(`scaffold.pole${k}`, 'scaffold', [sx, -0.95, 2.2], [0.09, 0.09, 4.4], 'pole', 'walls', [], { tags: ['scaffold'] }));
  [1.6, 3.2].forEach((z, k) => {
    b.box(`scaffold.board${k}`, 'scaffold', [(x0 + x1) / 2 - 0.1, -0.85, z], [x1 - x0 + 1, 0.36, 0.05], 'boards', 'walls', [], { tags: ['scaffold'] });
    b.beam(`scaffold.ledger${k}`, 'scaffold', [x0 - 0.5, -0.95, z - 0.06], [x1 + 0.3, -0.95, z - 0.06], [0.07, 0.07], 'walls', [], 'pole', ['scaffold']);
  });

  // the open door (while someone steps through): the dark doorway and the leaf swung out
  b.box('door.open.dark', 'doorway', [s.doorX, wyF - 0.05, st + s.doorH / 2], [s.doorW, 0.02, s.doorH], 'doorway', 'walls', ['door'], { tags: ['part:doorOpen'] });
  const hinge = s.doorX - s.doorW / 2;
  b.box('door.open.leaf', 'door', [hinge + 0.03, wyF - 0.05 - s.doorW / 2, st + s.doorH / 2], [0.06, s.doorW, s.doorH], 'planks', 'walls', ['door'], { tags: ['part:doorOpen'] });
}

function barn(b: Builder, s: FarmSpec, upgraded: boolean): void {
  const x0 = s.houseX1 + (upgraded ? s.bayUpgraded : 0);
  const x1 = s.houseX0 + s.width;
  const y0 = (s.depth - s.barnDepth) / 2;
  const y1 = y0 + s.barnDepth;
  const hiZ = eaveZ(s) - 0.05; // tucked under the house's eaves
  const loZ = s.barnLow;
  const pre = upgraded ? 'barnU.' : 'barn.';
  const roofZ = (x: number) => hiZ + ((loZ - hiZ) * (x - x0)) / (x1 - x0);

  // pad stones and posts; post heights follow the roof line down from the house to the outer wall
  const postXY: Array<[number, number]> = [
    [x1 - 0.12, y0 + 0.12],
    [x1 - 0.12, y1 - 0.12],
    [x1 - 0.12, (y0 + y1) / 2],
    [x0 + 0.25, y0 + 0.12],
    [x0 + 0.25, y1 - 0.12],
    ...(x1 - x0 > 2.5
      ? ([
          [(x0 + x1) / 2 + 0.6, y0 + 0.12],
          [(x0 + x1) / 2 + 0.6, y1 - 0.12],
        ] as Array<[number, number]>)
      : []),
  ];
  postXY.forEach(([px, py], i) => b.box(`${pre}pad${i}`, 'pad-stone', [px, py, 0.1], [0.34, 0.34, 0.2], 'fieldstone', 'foundation', [], { shape: 'stone' }));
  postXY.forEach(([px, py], i) => {
    const top = roofZ(px) - 0.08;
    b.box(`${pre}post${i}`, 'post', [px, py, (0.2 + top) / 2], [0.18, 0.18, top - 0.2], 'oak', 'frame', [`${pre}pad${i}`]);
  });
  // rails along the front, back and outer side, and rafters on them
  for (const [side, y] of [
    ['f', y0 + 0.12],
    ['b', y1 - 0.12],
  ] as const) {
    b.beam(`${pre}rail${side}`, 'plate', [x0 + 0.1, y, roofZ(x0 + 0.1) - 0.08], [x1, y, roofZ(x1) - 0.08], [0.16, 0.16], 'frame', [`${pre}post0`]);
    b.beam(`${pre}rail${side}.mid`, 'girt', [x0 + 0.25, y, 1.2], [x1 - 0.12, y, 1.2], [0.14, 0.12], 'frame', [`${pre}post0`]);
  }
  b.beam(`${pre}rail.out`, 'plate', [x1 - 0.12, y0 + 0.12, loZ - 0.08], [x1 - 0.12, y1 - 0.12, loZ - 0.08], [0.16, 0.16], 'frame', [`${pre}post0`, `${pre}post1`]);
  const n = Math.max(3, Math.round((y1 - y0) / 0.8));
  for (let k = 0; k <= n; k++) {
    const y = y0 + 0.05 + ((y1 - y0 - 0.1) * k) / n;
    b.beam(`${pre}rafter${k}`, 'rafter', [x0 + 0.05, y, hiZ + 0.02], [x1 + 0.45, y, loZ - 0.12], [0.1, 0.12], 'frame', [`${pre}railf`, `${pre}railb`]);
  }

  // walls: vertical planks on the front (round the wide doors), back and outer side
  const r = b.rng(pre + 'planks');
  const pw = 0.24;
  const [doorX0, doorX1] = upgraded ? [x0 + 0.35, x1 - 0.35] : [(x0 + x1) / 2 - 1, (x0 + x1) / 2 + 1];
  for (const [side, y] of [
    ['f', y0],
    ['b', y1],
  ] as const) {
    let k = 0;
    for (let x = x0 + 0.12; x < x1 - 1e-6; ) {
      const w = Math.min(pw * uniform(r, 0.85, 1.15), x1 - x);
      if (!(side === 'f' && doorX0 - 0.01 < x + w / 2 && x + w / 2 < doorX1 + 0.01)) {
        const top = roofZ(x + w / 2) - 0.12;
        b.box(`${pre}plank${side}${k}`, 'plank', [x + w / 2, y + (side === 'f' ? -0.02 : 0.02), (0.05 + top) / 2], [w - 0.012, 0.035, top - 0.05], 'boards', 'walls', [`${pre}rail${side}`]);
        k++;
      }
      x += w;
    }
  }
  for (let y = y0, k = 0; y < y1 - 1e-6; k++) {
    const w = Math.min(pw * uniform(r, 0.85, 1.15), y1 - y);
    b.box(`${pre}plank.o${k}`, 'plank', [x1 + 0.02, y + w / 2, (0.05 + loZ - 0.12) / 2], [0.035, w - 0.012, loZ - 0.17], 'boards', 'walls', [`${pre}rail.out`]);
    y += w;
  }
  // the doors: two leaves of boards with a Z brace each
  const dh = roofZ(doorX1) - 0.35;
  const leaves: Array<[number, number]> = [
    [doorX0, (doorX0 + doorX1) / 2],
    [(doorX0 + doorX1) / 2, doorX1],
  ];
  leaves.forEach(([a, c], k) => {
    b.box(`${pre}door${k}`, 'barn-door', [(a + c) / 2, y0 - 0.04, (0.08 + dh) / 2], [c - a - 0.02, 0.05, dh - 0.08], 'planks', 'walls', [`${pre}railf`]);
    b.beam(`${pre}door${k}.brace`, 'brace', [a + 0.08, y0 - 0.075, 0.25], [c - 0.08, y0 - 0.075, dh - 0.2], [0.1, 0.03], 'walls', [`${pre}door${k}`], 'planks');
  });
  b.beam(`${pre}lintel`, 'girt', [doorX0 - 0.1, y0 - 0.03, dh + 0.06], [doorX1 + 0.1, y0 - 0.03, dh + 0.06], [0.14, 0.14], 'walls', [`${pre}railf`]);

  // roof: shingles on the rafters
  b.add({
    id: `${pre}roof`, kind: 'shingles', material: 'shingles', stage: 'roof', shape: 'leanto',
    params: { x0: x0 - 0.05, x1: x1 + 0.5, y0: y0 - 0.35, y1: y1 + 0.35, z0: hiZ + 0.1, z1: loZ - 0.06, thickness: 0.07, minX: x0 - 0.05, minY: y0 - 0.35, minZ: loZ - 0.13, maxX: x1 + 0.5, maxY: y1 + 0.35, maxZ: hiZ + 0.1 },
    on: [`${pre}rafter0`, `${pre}rafter${n}`],
  });
}

/** One look of the farm: the default or the Large farm. */
export function farmLook(upgraded: boolean, seed = 7, s: FarmSpec = SPEC): Element[] {
  const b = new Builder(seed);
  house(b, s, upgraded);
  barn(b, s, upgraded);
  return b.out;
}

const same = (a: Element, b: Element) => JSON.stringify({ ...a, order: 0 }) === JSON.stringify({ ...b, order: 0 });

/** Both looks merged: shared elements once, the rest tagged by the look they belong to. */
export function farm(seed = 7, s: FarmSpec = SPEC): Element[] {
  const def = new Map(farmLook(false, seed, s).map((e) => [e.id, e]));
  const up = new Map(farmLook(true, seed, s).map((e) => [e.id, e]));
  const out: Element[] = [];
  for (const [id, e] of def) {
    const u = up.get(id);
    if (u && same(e, u)) {
      out.push(e);
      continue;
    }
    out.push({ ...e, tags: [...e.tags, 'novariant:upgraded'] });
    if (u) out.push({ ...u, id: `${id}@upgraded`, tags: [...u.tags, 'variant:upgraded'] });
  }
  for (const [id, u] of up) if (!def.has(id)) out.push({ ...u, tags: [...u.tags, 'variant:upgraded'] });
  return out;
}

/** Named points (ASSET_SPEC §7.1) in model space. */
export function farmPoints(s: FarmSpec = SPEC): Record<string, Vec3> {
  const [w0] = bays(s, s.houseX1).windows;
  const [, w1] = bays(s, s.houseX1 + s.bayUpgraded).windows;
  const win0 = (w0[0] + w0[1]) / 2;
  const win1 = (w1[0] + w1[1]) / 2;
  const winZ = sillTop(s) + 0.95 + s.windowH / 2;
  return {
    door: [s.doorX, 0, 0],
    'smoke:0': [CHIMNEY[0], s.depth / 2 + CHIMNEY[1], roofLevels(s).chimneyTop + 0.1],
    'window:0': [win0, 0, winZ],
    'window:1': [win1, 0, winZ],
    'sleep:0': [win0, 0, winZ + 1.4],
    'sleep:1': [win1, 0, winZ + 1.4],
  };
}

/** Exposed for tests: the dimensions derived from a spec. */
export const levels = (s: FarmSpec = SPEC) => ({ sillTop: sillTop(s), plateBottom: plateBottom(s), eaveZ: eaveZ(s) });
