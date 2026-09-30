// Workers panel: a DOM table on the left edge listing every villager with
// their number, occupation and what they are doing right now.

import { BUILDINGS } from '../game/buildings';
import type { Person } from '../game/people';
import { getBuilding, type World } from '../game/world';

function occupation(p: Person): string {
  if (p.profession) return p.profession;
  return p.look === 'monk' ? 'monk' : 'townswoman';
}

function activity(world: World, p: Person): string {
  if (!p.job) return p.profession ? 'off duty, waiting for work' : 'strolling';
  const b = getBuilding(world, p.job.buildingId);
  const place = b ? BUILDINGS[b.type].name.toLowerCase() : 'work';
  const w = p.job.worker;
  const t = w.task;
  const load = w.carrying?.resource;
  switch (t.kind) {
    case 'job':
      if (t.job.action === 'sow') return 'sowing a field';
      if (t.job.action === 'harvest') return 'harvesting';
      if (t.job.action === 'build') return `building the ${place}`;
      if (t.job.action === 'haul') return 'lifting a sheaf off the stack';
      if (t.job.action.startsWith('take-')) return `picking up ${t.job.action.replace('take-', '')} from the pile`;
      return `loading ${t.job.action.replace('fetch-', '')} at the warehouse`;
    case 'walk':
      if (t.then === 'deliver') {
        const to = t.job?.action === 'haul' ? 'warehouse' : t.job?.action.startsWith('take-') ? `${place} wall` : t.job?.action.startsWith('fetch-') ? `${place} pile` : `${place} store`;
        return load ? `carrying ${load} to the ${to}` : `walking to the ${to}`;
      }
      if (t.then === 'home') return `heading home from the ${place}`;
      if (t.job?.action === 'haul') return 'going for a sheaf to take to the warehouse';
      if (t.job?.action.startsWith('take-')) return 'going to the pile';
      return t.job?.action.startsWith('fetch-') ? 'walking to the warehouse' : `walking to work at the ${place}`;
    case 'home':
      return t.activity === 'sleep' ? 'sleeping' : 'having lunch';
    case 'enter':
      return 'going indoors';
    case 'exit':
      return 'heading out to work';
    default:
      return load ? `carrying ${load}` : 'waiting';
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
