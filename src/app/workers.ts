// Workers panel: a DOM table on the left edge listing every villager with
// their number, occupation, where they live, how well fed they are and what
// they are doing right now.

import { HUNGER } from '../game/balance';
import { BUILDINGS } from '../game/buildings';
import { timeOfDay } from '../game/daynight';
import { hungry, mealFood, starving } from '../game/hunger';
import { laneY, type Person } from '../game/people';
import { offDuty } from '../game/worker';
import { makeCollapsible } from './panel';
import { buildingAt, getBuilding, type Building, type World } from '../game/world';

function occupation(p: Person): string {
  if (p.profession) return p.profession;
  if (p.seeker) return p.job?.role ?? 'unemployed';
  return p.look === 'monk' ? 'monk' : 'townswoman';
}

const nameOf = (b: Building) => BUILDINGS[b.type].name.toLowerCase();
/** An animal farm's animals, all together and one of them. */
const HERD_NAME = { chicken: 'hens', cow: 'cows', sheep: 'sheep', horse: 'horses' } as const;
const ONE_NAME = { chicken: 'bird', cow: 'beast', sheep: 'sheep', horse: 'horse' } as const;

/** A workshop's work by its recipe's verb, and where it is done when that is outdoors. */
const WORKING: Record<string, string> = { grind: 'grinding', bake: 'baking', saw: 'sawing', churn: 'churning', smoke: 'smoking', weave: 'weaving', tan: 'tanning', dip: 'dipping', stitch: 'stitching', brew: 'brewing', 'bake-pastries': 'baking', forge: 'forging' };
const WORKED_AT: Record<string, string> = { bake: 'oven', saw: 'saw bench' };
const resource = (action: string, verb: string) => (action.startsWith(`${verb}-`) ? action.slice(verb.length + 1) : null);

/** What stands where someone is: the building whose lot holds world x, else the open street. */
function whereAt(world: World, x: number): string {
  const b = buildingAt(world, x);
  return b ? `the ${nameOf(b)}${b.site ? ' site' : ''}` : 'the street';
}

/** Where someone lives (households.ts): their workplace, a house, the chapel. */
function homeOf(world: World, p: Person): string {
  const home = p.home === undefined ? undefined : getBuilding(world, p.home);
  return home ? `${nameOf(home)} #${home.id}` : '<span style="color:#a89a80">no home</span>';
}

/** How fed someone is (hunger.ts): the days of food in them, or how long they have gone without. */
function fed(p: Person): string {
  if (p.leaving) return '<span style="color:#e07a5f">leaving</span>';
  const days = (d: number) => `${d.toFixed(1)} d`;
  if (starving(p)) return `<span style="color:#e07a5f">starving ${days(-p.food)}</span>`;
  if (hungry(p)) return `<span style="color:#e8c872">hungry ${days(-p.food)}</span>`;
  return `<span style="color:#9ccc7a">fed ${days(p.food)}</span>`;
}

/**
 * What someone is doing, read straight from the simulation: their task, the
 * job ticket it carries (and for a delivery, the job the load came from), why
 * they are off duty (the game's own offDuty), and where they actually stand.
 */
function activity(world: World, p: Person): string {
  if (!p.job) {
    const s = p.stroll;
    const v = p.visit;
    const at = v && getBuilding(world, v.at);
    if (v && at) {
      const there = `the ${nameOf(at)}`;
      if (v.why === 'sleep') return v.left === undefined ? `going home for the night to ${there}` : `asleep in ${there}`;
      if (v.left === undefined) return `going to ${there} to eat ${v.food}`;
      return v.outdoors ? `eating ${v.food} at ${there}` : `eating ${v.food} in ${there}`;
    }
    if (s.y !== laneY(p.id)) return 'walking back to the street';
    const night = !timeOfDay(world).daylight;
    const why = p.seeker ? (night ? ', looking for work in the morning' : ', looking for work') : !p.profession ? '' : night ? ', off for the night' : ', no work going';
    return (s.idle > 0 ? 'standing about' : 'strolling') + why;
  }
  const b = getBuilding(world, p.job.buildingId);
  if (!b) return 'between jobs';
  const x = b.x;
  const place = `the ${nameOf(b)}${b.site ? ' site' : ''}`;
  const w = p.job.worker;
  const t = w.task;
  const here = whereAt(world, x + w.dx);
  const off = offDuty(w, timeOfDay(world), { dayLabour: p.job.role === 'builder' || p.job.role === 'serf', allHours: p.job.role === 'builder' || p.job.role === 'serf' });
  const warehouse = (id: number) => {
    const wh = getBuilding(world, id);
    return wh ? `the ${nameOf(wh)}` : 'a storage yard';
  };
  const named = (id: number | undefined) => {
    const o = id === undefined ? undefined : getBuilding(world, id);
    return o ? `the ${nameOf(o)}` : 'somewhere';
  };
  switch (t.kind) {
    case 'job': {
      const a = t.job.action;
      if (a === 'sow') return 'sowing a field';
      if (a === 'harvest') return 'harvesting a field';
      if (a === 'chop') return 'felling a tree';
      if (a === 'cut') return 'cutting stone at the quarry';
      const kept = BUILDINGS[b.type].livestock;
      if (kept && a === 'feed') return t.carried ? `feeding the ${HERD_NAME[kept.animal]} at the trough` : `taking ${kept.feed} off the store`;
      if (kept && a === 'butcher') return `butchering an old ${ONE_NAME[kept.animal]} for meat`;
      if (kept && a === 'halter') return 'haltering a grown horse to lead away';
      const recipe = BUILDINGS[b.type].makes;
      if (recipe && a === recipe.verb) {
        const doing = `${WORKING[recipe.verb] ?? recipe.verb} ${recipe.from} into ${recipe.to}`;
        if (t.carried) return t.indoors ? `${doing} inside` : `${doing} at the ${WORKED_AT[recipe.verb] ?? 'oven'}`;
        return `taking ${recipe.from === 'wood' ? 'a log' : `a sack of ${recipe.from}`} off the store`;
      }
      if (a === 'build') return `building ${place}`;
      if (resource(a, 'draw')) return `drawing ${resource(a, 'draw')} at ${named(t.job.target)}`;
      if (resource(a, 'ship') || resource(a, 'supply')) return `picking up ${resource(a, 'ship') ?? resource(a, 'supply')} at ${named(t.job.target)}`;
      if (resource(a, 'take')) return `picking up ${resource(a, 'take')} from the pile`;
      if (resource(a, 'fetch')) return `loading ${resource(a, 'fetch')} at ${warehouse(t.job.target)}`;
      return a;
    }
    case 'walk': {
      const a = t.job?.action ?? '';
      if (t.then === 'deliver') {
        const load = w.carrying ? `${w.carrying.amount} ${w.carrying.resource}` : 'nothing';
        if (a === 'harvest') return `carrying a sheaf to the ${nameOf(b)} store`;
        if (a === 'chop') return `carrying a log back to ${place}`;
        if (a === 'cut') return `carrying a block of stone back to ${place}`;
        const recipe = BUILDINGS[b.type].makes;
        if (recipe && a === recipe.verb) return w.carrying?.resource === recipe.from ? `carrying ${load} ${recipe.at ? `to the ${WORKED_AT[recipe.verb] ?? 'oven'}` : `in to ${place}`}` : `putting ${load} out in its place`;
        if (resource(a, 'draw')) return t.job!.to === t.job!.target ? `setting ${load} down by ${named(t.job!.to)}` : `carrying ${load} from ${named(t.job!.target)} to ${named(t.job!.to)}`;
        if (resource(a, 'ship') || resource(a, 'supply')) return `carrying ${load} from ${named(t.job!.target)} to ${named(t.job!.to)}`;
        if (resource(a, 'take')) return `carrying ${load} from the pile to its place at ${place}`;
        if (resource(a, 'fetch')) return `carrying ${load} to its place at ${place}`;
        return `carrying ${load}`;
      }
      if (t.then === 'home') {
        const from = here === place ? '' : ` from ${here}`;
        if (off === 'lunch') return `going in for lunch${from}`;
        if (off === 'sleep') return `going in for the night${from}`;
        return `heading back to ${place}${from}`;
      }
      if (t.then === 'eat') return `going to ${named(t.job!.target)} to eat ${mealFood(t.job!)}`;
      if (a === 'sow') return 'walking to sow a field';
      if (a === 'harvest') return 'walking to harvest a field';
      if (a === 'chop') return 'walking out to fell a tree';
      if (a === 'cut') return 'walking to the quarry';
      if (resource(a, 'draw')) return `going to ${named(t.job!.target)} to draw ${resource(a, 'draw')}`;
      if (resource(a, 'ship') || resource(a, 'supply')) return `going to ${named(t.job!.target)} for ${resource(a, 'ship') ?? resource(a, 'supply')} to take to ${named(t.job!.to)}`;
      if (a === 'build') return `going to build at ${place}`;
      if (resource(a, 'take')) return `going to the pile for ${resource(a, 'take')}`;
      if (resource(a, 'fetch')) return `walking to ${warehouse(t.job!.target)} for ${resource(a, 'fetch')}`;
      return `walking to work at ${place}`;
    }
    case 'home':
      return t.activity === 'sleep' ? `asleep in ${place}` : `having lunch in ${place}`;
    case 'enter':
      if (t.job) return `going into ${place} with ${w.carrying?.resource ?? 'a load'}`;
      return off === 'lunch' ? 'going indoors for lunch' : off === 'sleep' ? 'going indoors for the night' : 'going indoors';
    case 'exit':
      return t.job && w.carrying ? `coming out of ${place} with ${w.carrying.amount} ${w.carrying.resource}` : `stepping out of ${place}`;
    case 'idle':
      return here === place ? `waiting at ${place}` : `pausing at ${here}`;
    case 'meal':
      return t.indoors ? `eating ${mealFood(t.job)} in ${named(t.job.target)}` : `eating ${mealFood(t.job)} at ${named(t.job.target)}`;
  }
}

export function installWorkersPanel(world: World): void {
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;left:12px;top:50%;transform:translateY(-50%);color:#f3ead8;' +
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'background:rgba(20,14,8,0.78);border:1px solid rgba(232,200,114,0.25);' +
    'border-radius:8px;padding:8px 12px 10px;user-select:none;pointer-events:none';
  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse';
  makeCollapsible(root, table, 'left', 'village-game:workers-open', false, 'Workers');
  document.body.appendChild(root);

  const render = () => {
    const rows = ['<tr style="color:#e8c872;text-align:left"><th>#</th><th style="padding:0 12px">occupation</th><th style="padding-right:12px">home</th><th style="padding-right:12px">fed</th><th>doing</th></tr>'];
    for (const p of world.people) {
      rows.push(
        `<tr><td>${p.id}</td><td style="padding:0 12px">${occupation(p)}</td><td style="padding-right:12px;white-space:nowrap">${homeOf(world, p)}</td><td style="padding-right:12px;white-space:nowrap">${fed(p)}</td><td>${activity(world, p)}</td></tr>`,
      );
    }
    rows.push(
      `<tr style="color:#a89a80"><td colspan="5" style="padding-top:6px">fed: days of food left in them; hungry, they eat at home or the tavern; starving after ${HUNGER.starving} d, anywhere; after ${HUNGER.leave} d they leave the village</td></tr>`,
    );
    table.innerHTML = rows.join('');
  };
  render();
  setInterval(render, 250);
}
