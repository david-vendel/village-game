import { describe, expect, it } from 'vitest';
import { yAt } from './layout';
import { clearLand, PLANT_NEAR, treesInTheWay, treesOnFields, WOOD_REACH } from './nature';
import { storageOf } from './buildings';
import { streetDist, streetStart } from './streets';
import { CELL_W } from './layout';
import { createWorld, placeBuilding, setConstructionEnabled, update, type Building, type World } from './world';

const idle = { left: false, right: false };

function runFor(world: World, seconds: number, until = () => false): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds && !until(); t += dt) update(world, dt, idle);
}

/** A grown tree standing on site b's land, at the back of it (clear of the road's verges). */
function treeOn(w: World, b: Building) {
  for (let d = 200; d > 0; d -= 5) {
    const t = { id: w.nextId++, x: b.x, y: yAt(d), state: 'grown' as const, age: 0 };
    w.trees.push(t);
    if (treesInTheWay(w, b).includes(t)) return t;
    w.trees.pop();
  }
  throw new Error('no land to stand a tree on');
}

describe('trees in the way of building', () => {
  it("are felled by the site's builders before anything is built, and the log is kept", () => {
    const w = createWorld();
    const b = placeBuilding(w, 2162.5, 'well', { free: true })!;
    const tree = treeOn(w, b);
    clearLand(w);
    expect(w.trees).toContain(tree); // the building is not blocked, nor the tree taken away: it waits for the axe
    let logLaidDown = false;
    const standing = () => w.trees.includes(tree);
    for (let t = 0; t < 120 && b.status !== 'done'; t += 1 / 30) {
      update(w, 1 / 30, idle);
      if (standing()) expect(b.progress).toBe(0);
      // the well's materials are all on site already: the log goes down by the road for serfs
      if (w.piles.some((p) => p.resource === 'wood' && Math.abs(p.x - b.x) < 100)) logLaidDown = true;
    }
    expect(b.status).toBe('done');
    expect(standing()).toBe(false);
    expect(logLaidDown).toBe(true);
  });

  it("a crossroads' builders clear the road of the street it opens before it is finished", () => {
    const w = createWorld();
    const b = placeBuilding(w, streetStart(0) + 28.5 * CELL_W, 'intersection', { free: true })!;
    // in front of the main street, where the new street's road runs on across it
    const tree = { id: w.nextId++, x: b.x, y: yAt(-90), state: 'grown' as const, age: 0 };
    w.trees.push(tree);
    expect(treesInTheWay(w, b)).toContain(tree);
    runFor(w, 300, () => b.status === 'done' || !w.trees.includes(tree));
    expect(b.status).toBe('constructing');
    expect(w.trees).not.toContain(tree);
    runFor(w, 300, () => b.status === 'done');
    expect(b.status).toBe('done');
  });

  it('switching construction off clears what still stands on the land', () => {
    const w = createWorld();
    const b = placeBuilding(w, 2162.5, 'well', { free: true })!;
    const tree = treeOn(w, b);
    setConstructionEnabled(w, false);
    expect(w.trees).not.toContain(tree);
  });
});

describe("trees on a farm's fields", () => {
  it('are felled by its farmer, the log left by the road', () => {
    const w = createWorld({ village: false });
    setConstructionEnabled(w, false);
    placeBuilding(w, 1000, 'house', { free: true });
    runFor(w, 5);
    const farm = placeBuilding(w, 1600, 'farm', { free: true })!;
    let tree = null;
    for (let x = farm.x - 200; x < farm.x + 200 && !tree; x += 10) {
      for (let d = -300; d < 300 && !tree; d += 10) {
        const t = { id: w.nextId++, x, y: yAt(d), state: 'grown' as const, age: 0 };
        w.trees.push(t);
        clearLand(w);
        if (treesOnFields(w, farm).includes(t) && w.trees.includes(t)) tree = t;
        else w.trees = w.trees.filter((o) => o !== t);
      }
    }
    expect(tree).not.toBeNull();
    clearLand(w);
    expect(w.trees).toContain(tree);
    let logLaidDown = false;
    for (let t = 0; t < 200 && w.trees.includes(tree!); t += 1 / 30) update(w, 1 / 30, idle);
    expect(w.trees).not.toContain(tree);
    for (let t = 0; t < 30 && !logLaidDown; t += 1 / 30) {
      update(w, 1 / 30, idle);
      if (w.piles.some((p) => p.resource === 'wood')) logLaidDown = true;
    }
    expect(logLaidDown).toBe(true);
  });
});

describe('woodcutter', () => {
  it('with nothing to fell, walks out and plants saplings round about', () => {
    const w = createWorld({ village: false });
    setConstructionEnabled(w, false);
    placeBuilding(w, 1000, 'house', { free: true });
    runFor(w, 5);
    const hut = placeBuilding(w, 2500, 'woodcutter', { free: true })!;
    w.trees = [];
    const planted = new Set<string>();
    for (let t = 0; t < 200; t += 1 / 30) {
      update(w, 1 / 30, idle);
      for (const p of w.people) {
        const task = p.job?.buildingId === hut.id ? p.job.worker.task : null;
        if (task?.kind === 'job' && task.job.action === 'plant') planted.add(`${task.job.target},${yAt(task.job.slot ?? 0)}`);
      }
    }
    expect(planted.size).toBeGreaterThan(2);
    for (const at of planted) {
      const [x, y] = at.split(',').map(Number);
      const t = w.trees.find((o) => o.x === x && o.y === y);
      expect(t?.state).toBe('growing');
      expect(streetDist(w, hut.x, x)).toBeLessThanOrEqual(WOOD_REACH);
    }
  });

  it('plants near home, and goes on planting with his store full', () => {
    const w = createWorld({ village: false });
    setConstructionEnabled(w, false);
    placeBuilding(w, 1000, 'house', { free: true });
    runFor(w, 5);
    const hut = placeBuilding(w, 2500, 'woodcutter', { free: true })!;
    hut.stock.wood = storageOf(hut).wood!; // no storage yard to take it to: it stays full
    const planted = new Set<number>();
    for (let t = 0; t < 200; t += 1 / 30) {
      update(w, 1 / 30, idle);
      for (const p of w.people) {
        const task = p.job?.buildingId === hut.id ? p.job.worker.task : null;
        if (task?.kind === 'job' && task.job.action === 'plant') planted.add(task.job.target);
      }
    }
    expect(hut.stock.wood).toBe(storageOf(hut).wood);
    expect(planted.size).toBeGreaterThan(2);
    for (const x of planted) expect(Math.abs(x - hut.x)).toBeLessThanOrEqual(PLANT_NEAR.along);
  });
});
