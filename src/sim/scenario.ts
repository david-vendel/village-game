// Scenarios: a game played from a script, one command a line, instantly and
// headless, with the village printed as text (textmap.ts) wherever asked. It
// drives the same game functions the player's keys do, and after every
// command checks the rules every world must keep (checkInvariants), so a
// script is both a way to look at a situation and a test of it.
//
//   new village | new empty [seed N]   start a world (empty: no buildings, people or stock)
//   construction on|off                off: buildings stand finished at once
//   free on|off                        on: buildings cost nothing
//   stock wood=500 stone=300           set what the oldest storage yard holds
//   build farm at s0:40                build where a building would start at cell 40 of street 0
//   build house next                   right after the last one built (or `before`)
//   build farm here                    at the rider, through the build menu, as the player does
//   demolish at s0:40 | demolish section at s0:40 | upgrade at s0:40
//   ride s1:30 | ride #12 | ride +6    put the rider somewhere (+/- cells along the street)
//   turn up|down                       turn at the crossroads the rider is at
//   run 30s | run 2d | run until built [max 3d]
//   map [ids] [trees] [B30:-C60]       the land from above; ids: which building is which
//   menu                               what the menu Space opens at the rider offers
//   list | streets | status            buildings, streets, time / stock / people
//   expect count house 1               how many there are of a type
//   expect at s0:40 house size 3 done  what stands at a cell (any of: <type> size N done constructing upgraded)
//   expect fields at s0:40 24          how many fields the farm there has
//   expect cannot build farm at s0:40 [why text]
//   expect street s1 / expect streets 3
//   # comment, echo text
//
// Places are `s<street>:<cell>`: cell i along that street (0 at its start;
// `streets` shows each street's cells), or `#id` for a building (`#last`: the
// last one built).

import { BUILDING_TYPES, BUILDINGS, type BuildingType } from '../game/buildings';
import { DAY_LENGTH, dayMinutes } from '../game/daynight';
import { buildShortfall, warehouses } from '../game/economy';
import { footprintOf } from '../game/grid';
import { CELL_W } from '../game/layout';
import { RESOURCES } from '../game/resources';
import { streetOf, streetStart } from '../game/streets';
import {
  buildingAt,
  confirmMenu,
  createWorld,
  demolish,
  demolishSection,
  getBuilding,
  openMenu,
  placeBuilding,
  selectMenu,
  setConstructionEnabled,
  turnAtCrossroads,
  update,
  upgradeBuilding,
  whyNotBuild,
  type Building,
  type World,
} from '../game/world';
import { checkInvariants, listBuildings, listStreets, renderMap, summary, where, type MapOptions } from './textmap';

export interface ScenarioResult {
  /** Everything printed, command by command. */
  output: string;
  /** Failed expectations, refused commands and broken rules. */
  failures: string[];
  world: World;
}

export interface ScenarioOptions {
  /** Simulation step (s). */
  dt?: number;
  /** Check the rules every this many simulated seconds while running (and after every command). */
  checkEvery?: number;
}

const ALIASES: Record<string, BuildingType> = { crossroads: 'intersection', yard: 'warehouse', storage: 'warehouse', hut: 'woodcutter' };

class Fail extends Error {}

export function runScenario(script: string, opts: ScenarioOptions = {}): ScenarioResult {
  const dt = opts.dt ?? 1 / 20;
  const checkEvery = opts.checkEvery ?? 5;
  const out: string[] = [];
  const failures: string[] = [];
  let world = createWorld();
  let free = false;
  let last: Building | null = null;
  let seenBroken = new Set<string>();

  const fail = (msg: string): never => {
    throw new Fail(msg);
  };
  const say = (s: string) => out.push(s.split('\n').map((l) => `  ${l}`).join('\n'));

  const typeOf = (word: string | undefined): BuildingType => {
    const t = (ALIASES[word ?? ''] ?? word) as BuildingType;
    if (!BUILDING_TYPES.includes(t)) fail(`no building type "${word}" (${BUILDING_TYPES.join(', ')})`);
    return t;
  };

  /** World x of a place: s<street>:<cell> (the middle of that cell), #id, or x=<world x>. */
  const xOf = (word: string | undefined): number => {
    const m = /^s(\d+):(-?\d+)$/.exec(word ?? '');
    if (m) {
      const s = world.streets[+m[1]];
      if (!s || s.gone) fail(`there is no street s${m[1]}`);
      return streetStart(+m[1]) + (+m[2] + 0.5) * CELL_W;
    }
    if (word === '#last') return (last && getBuilding(world, last.id)?.x) ?? fail('nothing built is standing');
    const id = /^#(\d+)$/.exec(word ?? '');
    if (id) return getBuilding(world, +id[1])?.x ?? fail(`there is no building #${id[1]}`);
    const x = /^x=(-?[\d.]+)$/.exec(word ?? '');
    if (x) return +x[1];
    return fail(`not a place: "${word}" (use s0:40, #12 or x=1000)`);
  };

  const buildingOf = (word: string | undefined): Building => {
    if (word === '#last') return (last && getBuilding(world, last.id)) ?? fail('nothing built is standing');
    const id = /^#(\d+)$/.exec(word ?? '');
    if (id) return getBuilding(world, +id[1]) ?? fail(`there is no building #${id[1]}`);
    const x = xOf(word);
    return buildingAt(world, x) ?? fail(`nothing stands at ${word}`);
  };

  /** Cells next to the last building: `next` starts right after it, `before` ends right before it (for a building of this type). */
  const besideLast = (type: BuildingType, after: boolean): number => {
    if (!last) return fail('nothing has been built yet');
    const f = footprintOf(last) ?? fail('the last building has no footprint');
    const w = Math.ceil(BUILDINGS[type].width / CELL_W - 1e-6);
    const i = after ? f.i1 + 1 : f.i0 - w;
    return streetStart(f.street) + (i + 0.5) * CELL_W;
  };

  const shortfallText = (type: BuildingType) => {
    const lack = buildShortfall(world, type);
    return RESOURCES.filter((r) => lack[r]).map((r) => `${lack[r]} more ${r}`).join(' and ');
  };

  const build = (type: BuildingType, x: number, label: string): Building => {
    const why = whyNotBuild(world, type, x);
    if (why) fail(`can't build ${type} at ${label}: ${why}`);
    if (!free) {
      const lack = shortfallText(type);
      if (lack) fail(`can't afford ${type}: need ${lack}`);
    }
    const b = placeBuilding(world, x, type, { free }) ?? fail(`placeBuilding refused ${type} at ${label}`);
    world.events.length = 0;
    last = b;
    return b;
  };

  /** Build through the menu at the rider, the way the player does. */
  const buildHere = (type: BuildingType): Building => {
    if (!openMenu(world)) fail(`no build menu opens at the rider (${buildingAt(world, world.rider.x) ? 'a building is here' : 'nothing fits here'})`);
    if (world.menu?.kind !== 'build') fail('the menu here is a building menu, not a build menu');
    const i = BUILDING_TYPES.indexOf(type);
    selectMenu(world, i);
    if (world.menu!.selection !== i) {
      const why = whyNotBuild(world, type, world.menu!.x);
      world.menu = null;
      fail(`${type} can't be chosen here: ${why ?? 'it does not fit'}`);
    }
    if (!free && shortfallText(type)) {
      world.menu = null;
      fail(`can't afford ${type}: need ${shortfallText(type)}`);
    }
    const b = free ? placeBuilding(world, world.menu!.x, type, { free }) : confirmMenu(world);
    world.menu = null;
    if (!b) fail(`the menu did not build ${type}`);
    world.events.length = 0;
    last = b;
    return b!;
  };

  const check = (where: string) => {
    for (const msg of checkInvariants(world)) {
      if (seenBroken.has(msg)) continue;
      seenBroken.add(msg);
      failures.push(`${where}: RULE BROKEN: ${msg}`);
      say(`RULE BROKEN: ${msg}`);
    }
  };

  const seconds = (word: string | undefined): number => {
    const m = /^([\d.]+)(s|m|h|d)?$/.exec(word ?? '');
    if (!m) return fail(`not a time: "${word}" (30s, 5m, 2h, 1d)`);
    const k = { s: 1, m: 60, h: DAY_LENGTH / 24 / world.params.timeSpeed, d: dayMinutes(world.params.timeSpeed, world.params.nightHours) * 60 }[m[2] ?? 's']!;
    return +m[1] * k;
  };

  const runFor = (total: number, until?: () => boolean, label = '') => {
    let t = 0;
    let nextCheck = checkEvery;
    while (t < total) {
      if (until?.()) return true;
      update(world, dt, { left: false, right: false });
      world.events.length = 0;
      t += dt;
      if (t >= nextCheck) {
        check(`${label} at t=${world.time.toFixed(1)}s`);
        nextCheck += checkEvery;
      }
    }
    return until?.() ?? true;
  };

  const lines = script.split('\n');
  lines.forEach((raw, n) => {
    const line = raw.replace(/\s+#(\s.*)?$/, '').trim();
    if (!line) return;
    if (/^#(\s|$)/.test(line)) {
      out.push(line);
      return;
    }
    const label = `line ${n + 1} "${line}"`;
    out.push(`> ${line}`);
    const w = line.split(/\s+/);
    const expectation = w[0] === 'expect';
    try {
      switch (w[0]) {
        case 'new': {
          const seed = w.indexOf('seed') >= 0 ? +w[w.indexOf('seed') + 1] : undefined;
          world = createWorld({ village: w[1] !== 'empty', seed });
          free = false;
          last = null;
          seenBroken = new Set();
          break;
        }
        case 'construction':
          setConstructionEnabled(world, w[1] !== 'off');
          break;
        case 'free':
          free = w[1] !== 'off';
          break;
        case 'stock': {
          let yard = warehouses(world)[0];
          if (!yard) {
            // an empty world: a storage yard far down the main street to hold it
            yard = placeBuilding(world, streetStart(0) + 240.5 * CELL_W, 'warehouse', { instant: true, free: true }) ?? fail('no room for a storage yard');
            say(`(a storage yard #${yard.id} at ${where(world, yard)} holds it)`);
          }
          for (const kv of w.slice(1)) {
            const [r, v] = kv.split('=');
            if (!RESOURCES.includes(r as never)) fail(`no resource "${r}"`);
            yard.stock[r as (typeof RESOURCES)[number]] = +v;
          }
          break;
        }
        case 'build': {
          const type = typeOf(w[1]);
          let b: Building;
          if (w[2] === 'here') b = buildHere(type);
          else if (w[2] === 'next' || w[2] === 'before') b = build(type, besideLast(type, w[2] === 'next'), w[2]);
          else if (w[2] === 'at') b = build(type, xOf(w[3]), w[3]);
          else return fail('build <type> at <place> | next | before | here');
          // a merged house is the older building it joined
          say(`#${b.id} ${b.type}${b.size ? `×${b.size}` : ''} at ${where(world, b)}, ${b.status}`);
          break;
        }
        case 'demolish': {
          const section = w[1] === 'section';
          const b = buildingOf(w[section ? 3 : 2]);
          const ok = section ? demolishSection(world, b, xOf(w[3])) : demolish(world, b);
          if (!ok) fail(`#${b.id} ${b.type} can't be pulled down`);
          say(`pulling down ${section ? 'a section of ' : ''}#${b.id} ${b.type}`);
          break;
        }
        case 'upgrade': {
          const b = buildingOf(w[2]);
          if (!upgradeBuilding(world, b)) fail(`#${b.id} ${b.type} can't be upgraded`);
          say(`upgrading #${b.id} ${b.type}`);
          break;
        }
        case 'ride': {
          const rel = /^([+-]\d+)$/.exec(w[1] ?? '');
          world.rider.vx = 0;
          world.rider.x = rel ? world.rider.x + +rel[1] * CELL_W : xOf(w[1]);
          if (rel) world.rider.facing = +rel[1] >= 0 ? 1 : -1;
          say(summary(world).split('\n')[3]);
          break;
        }
        case 'turn': {
          if (w[1] !== 'up' && w[1] !== 'down') fail('turn up | turn down');
          if (!turnAtCrossroads(world, w[1] as 'up' | 'down')) fail('the rider is not at a finished crossroads');
          say(summary(world).split('\n')[3]);
          break;
        }
        case 'run': {
          if (w[1] === 'until') {
            const max = w.indexOf('max') >= 0 ? seconds(w[w.indexOf('max') + 1]) : seconds('3d');
            if (w[2] !== 'built') fail('run until built [max <time>]');
            const t0 = world.time;
            const ok = runFor(max, () => !world.buildings.some((b) => b.site || b.status !== 'done'), label);
            if (!ok) fail(`still building after ${max}s: ${world.buildings.filter((b) => b.site || b.status !== 'done').map((b) => `#${b.id} ${b.type} ${Math.round(b.progress * 100)}%`).join(', ')}`);
            say(`all built after ${(world.time - t0).toFixed(1)}s`);
          } else runFor(seconds(w[1]), undefined, label);
          break;
        }
        case 'map': {
          const o: MapOptions = { ids: w.includes('ids'), trees: w.includes('trees') };
          const r = w.find((x) => x.includes(':'));
          if (r) o.region = region(r) ?? fail(`not a region: "${r}" (like B30:-C60)`);
          say(renderMap(world, o));
          break;
        }
        case 'menu': {
          // what the build menu offers where the rider is, as Space would open it
          if (!openMenu(world)) {
            say('no menu opens here');
            break;
          }
          const m = world.menu!;
          say(m.kind === 'build' ? `build menu: ${BUILDING_TYPES.filter((_, i) => m.fits[i]).join(', ')}; chosen: ${BUILDING_TYPES[m.selection]}` : `building menu: ${m.options.join(', ')}`);
          world.menu = null;
          break;
        }
        case 'list':
          say(listBuildings(world));
          break;
        case 'streets':
          say(listStreets(world));
          break;
        case 'status':
          say(summary(world));
          break;
        case 'echo':
          say(line.slice(5));
          break;
        case 'expect':
          expect(w.slice(1));
          break;
        default:
          fail(`unknown command "${w[0]}"`);
      }
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      failures.push(`${label}: ${e.message}`);
      say(`${expectation ? 'FAILED' : 'REFUSED'}: ${e.message}`);
    }
    check(label);
  });
  return { output: out.join('\n'), failures, world };

  function expect(w: string[]): void {
    switch (w[0]) {
      case 'count': {
        const type = typeOf(w[1]);
        const n = world.buildings.filter((b) => b.type === type).length;
        if (n !== +w[2]) fail(`${n} ${type}, expected ${w[2]}`);
        say(`ok: ${n} ${type}`);
        return;
      }
      case 'at': {
        const b = buildingOf(w[1]);
        const want = w.slice(2);
        for (let i = 0; i < want.length; i++) {
          const k = want[i];
          if (k === 'size') {
            const n = +want[++i];
            if ((b.size ?? 1) !== n) fail(`#${b.id} ${b.type} is size ${b.size ?? 1}, expected ${n}`);
          } else if (k === 'done' || k === 'constructing' || k === 'demolishing') {
            if (b.status !== k) fail(`#${b.id} ${b.type} is ${b.status}, expected ${k}`);
          } else if (k === 'upgraded') {
            if (!b.upgraded) fail(`#${b.id} ${b.type} is not upgraded`);
          } else if (typeOf(k) !== b.type) fail(`a ${b.type} (#${b.id}) stands at ${w[1]}, expected ${k}`);
        }
        say(`ok: #${b.id} ${b.type}${b.size ? `×${b.size}` : ''} at ${where(world, b)}, ${b.status}`);
        return;
      }
      case 'fields': {
        const b = buildingOf(w[2]);
        const n = b.farm?.plots.length ?? 0;
        if (n !== +w[3]) fail(`#${b.id} ${b.type} has ${n} fields, expected ${w[3]}`);
        say(`ok: #${b.id} has ${n} fields`);
        return;
      }
      case 'cannot': {
        if (w[1] !== 'build') fail('expect cannot build <type> at <place> [reason words]');
        const type = typeOf(w[2]);
        const x = w[3] === 'at' ? xOf(w[4]) : fail('expect cannot build <type> at <place>');
        const why = whyNotBuild(world, type, x) ?? (free ? null : shortfallText(type) || null);
        if (!why) fail(`${type} can be built at ${w[4]}`);
        const reason = w.slice(5).join(' ');
        if (reason && !why!.toLowerCase().includes(reason.toLowerCase())) fail(`${type} can't be built at ${w[4]}, but because "${why}", not "${reason}"`);
        say(`ok: can't build ${type} at ${w[4]}: ${why}`);
        return;
      }
      case 'streets': {
        const n = world.streets.filter((s) => !s.gone).length;
        if (n !== +w[1]) fail(`${n} streets, expected ${w[1]}`);
        say(`ok: ${n} streets`);
        return;
      }
      case 'rider': {
        const s = streetOf(world.rider.x);
        if (w[1] !== `s${s}`) fail(`the rider is on s${s}, expected ${w[1]}`);
        say(`ok: the rider is on s${s}`);
        return;
      }
      default:
        fail(`unknown expectation "${w[0]}" (count, at, fields, cannot, streets, rider)`);
    }
  }
}

/** A region of cells from two corner cells' names, like B30:-C60. */
function region(text: string): MapOptions['region'] | null {
  const parse = (s: string) => {
    const m = /^(-?)([A-Z]+)(-?\d+)$/.exec(s);
    if (!m) return null;
    let n = 0;
    for (const ch of m[2]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return { r: m[1] ? -n : n - 1, c: +m[3] };
  };
  const [a, b] = text.split(':').map(parse);
  if (!a || !b) return null;
  return { c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c), r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r) };
}
