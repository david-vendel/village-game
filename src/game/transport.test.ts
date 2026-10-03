import { describe, expect, it } from 'vitest';
import { materialSource, warehouses } from './economy';
import { BOARD_SECONDS, freeNow } from './transport';
import { currentJob } from './worker';
import { createWorld, placeBuilding, update, type Building, type World } from './world';

const step = (w: World) => update(w, 1 / 30, { left: false, right: false });
/** Everyone (serfs, builders) on their way to pick up wood at b. */
const headingFor = (w: World, b: Building) =>
  w.people.filter((p) => {
    const job = p.job && currentJob(p.job.worker);
    return !!job && job.target === b.id && /^(ship|supply|fetch)-wood$/.test(job.action);
  });

describe('reserved loads', () => {
  it('what a serf is on the way to pick up is theirs: builders look elsewhere for it', () => {
    const w = createWorld();
    for (const b of warehouses(w)) b.stock.wood = 0;
    const hut = placeBuilding(w, 2587.5, 'woodcutter', { instant: true, free: true })!;
    hut.stock.wood = 1;
    for (let i = 0; i < 300 && headingFor(w, hut).length === 0; i++) step(w);
    expect(headingFor(w, hut)).toHaveLength(1);
    const free = freeNow(w);
    expect(free(hut, 'wood')).toBe(0);
    expect(materialSource(w, 'wood', hut.x, free)).toBeNull();
  });

  it('nobody else sets off for a log someone is already going for, serf or builder', () => {
    const w = createWorld();
    for (const b of warehouses(w)) b.stock.wood = 0;
    const hut = placeBuilding(w, 2587.5, 'woodcutter', { instant: true, free: true })!;
    hut.stock.wood = 1;
    // a site that needs wood, so builders want the log as much as the serfs do
    expect(placeBuilding(w, 2812.5, 'well')).not.toBeNull();
    let most = 0;
    for (let i = 0; i < 30 * 20 && hut.stock.wood >= 1; i++) {
      step(w);
      most = Math.max(most, headingFor(w, hut).length);
    }
    expect(hut.stock.wood).toBeLessThan(1);
    expect(most).toBe(1);
  });
});

describe('the errand board', () => {
  it('is planned once and used until it is old', () => {
    const w = createWorld();
    step(w);
    const planned = w.errands.at;
    expect(w.errands.jobs.length).toBeGreaterThan(0);
    for (let t = 0; t < BOARD_SECONDS - 0.1; t += 1 / 30) step(w);
    expect(w.errands.at).toBe(planned);
    for (let t = 0; t < 0.2; t += 1 / 30) step(w);
    expect(w.errands.at).toBeGreaterThan(planned);
  });

  it('a new errand waits at most until the board is planned again', () => {
    const w = createWorld();
    step(w);
    placeBuilding(w, 2812.5, 'storehouse', { instant: true, free: true });
    const dairy = placeBuilding(w, 2587.5, 'dairy', { instant: true, free: true })!;
    dairy.stock.cheese = 1;
    expect(w.errands.jobs.some((j) => j.target === dairy.id)).toBe(false);
    for (let t = 0; t < BOARD_SECONDS + 0.1; t += 1 / 30) step(w);
    const onIt = w.people.some((p) => p.job && currentJob(p.job.worker)?.target === dairy.id);
    expect(onIt || w.errands.jobs.some((j) => j.target === dairy.id)).toBe(true);
  });
});
