// Workers panel: a DOM table on the left edge listing every villager with
// their number, occupation and what they are doing right now.

import { BUILDINGS } from '../game/buildings';
import { timeOfDay } from '../game/daynight';
import { PLOT_SPACING } from '../game/layout';
import { laneY, type Person } from '../game/people';
import { offDuty } from '../game/worker';
import { getBuilding, type Building, type World } from '../game/world';

function occupation(p: Person): string {
  if (p.profession) return p.profession;
  return p.look === 'monk' ? 'monk' : 'townswoman';
}

const nameOf = (b: Building) => BUILDINGS[b.type].name.toLowerCase();
const resource = (action: string, verb: string) => (action.startsWith(`${verb}-`) ? action.slice(verb.length + 1) : null);

/** What stands where someone is: the building whose lot holds world x, else the open street. */
function whereAt(world: World, x: number): string {
  const plot = world.plots.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
  const b = Math.abs(plot.x - x) <= PLOT_SPACING / 2 ? getBuilding(world, plot.buildingId) : undefined;
  return b ? `the ${nameOf(b)}${b.site ? ' site' : ''}` : 'the street';
}

/**
 * What someone is doing, read straight from the simulation: their task, the
 * job ticket it carries (and for a delivery, the job the load came from), why
 * they are off duty (the game's own offDuty), and where they actually stand.
 */
function activity(world: World, p: Person): string {
  if (!p.job) {
    const s = p.stroll;
    if (s.y !== laneY(p.id)) return 'walking back to the street';
    const why = !p.profession ? '' : !timeOfDay(world).daylight ? ', off for the night' : ', no work going';
    return (s.idle > 0 ? 'standing about' : 'strolling') + why;
  }
  const b = getBuilding(world, p.job.buildingId);
  if (!b) return 'between jobs';
  const x = world.plots[b.plotIndex].x;
  const place = `the ${nameOf(b)}${b.site ? ' site' : ''}`;
  const w = p.job.worker;
  const t = w.task;
  const here = whereAt(world, x + w.dx);
  const off = offDuty(w, timeOfDay(world), { dayLabour: !!b.site });
  const warehouse = (id: number) => {
    const wh = getBuilding(world, id);
    return wh ? `the ${nameOf(wh)}` : 'a warehouse';
  };
  switch (t.kind) {
    case 'job': {
      const a = t.job.action;
      if (a === 'sow') return 'sowing a field';
      if (a === 'harvest') return 'harvesting a field';
      if (a === 'haul') return 'lifting a sheaf off the stack';
      if (a === 'build') return `building ${place}`;
      if (resource(a, 'take')) return `picking up ${resource(a, 'take')} from the pile`;
      if (resource(a, 'fetch')) return `loading ${resource(a, 'fetch')} at ${warehouse(t.job.target)}`;
      return a;
    }
    case 'walk': {
      const a = t.job?.action ?? '';
      if (t.then === 'deliver') {
        const load = w.carrying ? `${w.carrying.amount} ${w.carrying.resource}` : 'nothing';
        if (a === 'harvest') return `carrying a sheaf to the ${nameOf(b)} store`;
        if (a === 'haul') return `carrying a sheaf to ${warehouse(t.job!.target)}`;
        if (resource(a, 'take')) return `carrying ${load} to put in place at ${place}`;
        if (resource(a, 'fetch')) return `carrying ${load} to the pile at ${place}`;
        return `carrying ${load}`;
      }
      if (t.then === 'home') {
        const from = here === place ? '' : ` from ${here}`;
        if (off === 'lunch') return `going in for lunch${from}`;
        if (off === 'sleep') return `going in for the night${from}`;
        return `heading back to ${place}${from}`;
      }
      if (a === 'sow') return 'walking to sow a field';
      if (a === 'harvest') return 'walking to harvest a field';
      if (a === 'haul') return 'going for a sheaf to take to the warehouse';
      if (a === 'build') return `going to build at ${place}`;
      if (resource(a, 'take')) return `going to the pile for ${resource(a, 'take')}`;
      if (resource(a, 'fetch')) return `walking to ${warehouse(t.job!.target)} for ${resource(a, 'fetch')}`;
      return `walking to work at ${place}`;
    }
    case 'home':
      return t.activity === 'sleep' ? `asleep in ${place}` : `having lunch in ${place}`;
    case 'enter':
      return off === 'lunch' ? 'going indoors for lunch' : off === 'sleep' ? 'going indoors for the night' : 'going indoors';
    case 'exit':
      return `stepping out of ${place}`;
    case 'idle':
      return here === place ? `waiting at ${place}` : `pausing at ${here}`;
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
  root.append(table);
  document.body.appendChild(root);

  const render = () => {
    const rows = ['<tr style="color:#e8c872;text-align:left"><th>#</th><th style="padding:0 12px">occupation</th><th>doing</th></tr>'];
    for (const p of world.people) {
      rows.push(`<tr><td>${p.id}</td><td style="padding:0 12px">${occupation(p)}</td><td>${activity(world, p)}</td></tr>`);
    }
    table.innerHTML = rows.join('');
  };
  render();
  setInterval(render, 250);
}
