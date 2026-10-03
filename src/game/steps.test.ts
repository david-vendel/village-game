// The design's steps 2–6 (docs/DESIGN.md): keeping food, what butchering
// leaves, horses at work, the castle, the merchant.

import { describe, expect, it } from 'vitest';
import { ANIMALS, CASTLE_REQUESTS, MARKET, TOOL_SPEED } from './balance';
import { upgradesDone } from './buildings';
import { CART_LOAD } from './carts';
import { stillAsked, whyLocked } from './castle';
import { clock, timeOfDay } from './daynight';
import { villageStock } from './economy';
import { householdNeeds, residentsOf, roomIn } from './households';
import { herdOf } from './livestock';
import { merchantHere } from './market';
import { employees } from './people';
import { createWorld, placeBuilding, toolSpeed, update, upgradeBuilding, workplaceOf, type Building, type World } from './world';

const tick = (w: World, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += 1 / 30) {
    update(w, 1 / 30, { left: false, right: false });
    each?.();
  }
};
const dayOf = (w: World) => 24 / timeOfDay(w).hoursPerSecond;
const yard = (w: World) => w.buildings.find((b) => b.type === 'warehouse')!;
const place = (w: World, x: number, type: Building['type']) => placeBuilding(w, x, type, { instant: true, free: true })!;

describe('step 2: keeping food', () => {
  it('a dairy makes a cheese of every two pails of milk, never of one', () => {
    const w = createWorld();
    const dairy = place(w, 2587.5, 'dairy');
    dairy.stock.milk = 3;
    tick(w, 60, () => (dairy.stock.milk = Math.min(dairy.stock.milk, 3)));
    expect(dairy.stock.cheese + villageStock(w).cheese).toBe(1);
    expect(dairy.stock.milk).toBe(1);
  });

  it('cheese goes to a storehouse: it is one of the village stores', () => {
    const w = createWorld();
    const store = place(w, 2812.5, 'storehouse');
    const dairy = place(w, 2587.5, 'dairy');
    dairy.stock.cheese = 2;
    tick(w, 60);
    expect(store.stock.cheese).toBe(2);
    expect(villageStock(w).cheese).toBe(2);
  });

  it('a farmstead takes a charter; then its family needs cheese or smoked meat and cloth, and it holds one more', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    const house = w.buildings.find((b) => b.type === 'house' && !b.size)!;
    w.constructionEnabled = false;
    yard(w).stock.wood = yard(w).stock.stone = 20;
    expect(upgradeBuilding(w, house)).toBe(false);
    w.castle.charters = 1;
    expect(upgradeBuilding(w, house)).toBe(true);
    expect(upgradesDone(house)).toBe(1);
    expect(householdNeeds(house).flatMap((n) => n.goods)).toEqual(expect.arrayContaining(['cheese', 'smokedmeat', 'cloth']));
    expect(roomIn(house)).toBe(4);
  });

  it('weaving is skilled: only a freeman (whose home is a farmstead) takes it', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    const weaver = place(w, 2587.5, 'weaver');
    tick(w, 5);
    expect(employees(w, weaver)).toHaveLength(0);
    // a seeker's house becomes a farmstead
    const seeker = w.people.find((p) => p.seeker && p.home !== undefined)!;
    const home = w.buildings.find((b) => b.id === seeker.home)!;
    home.level = 1;
    home.upgraded = true;
    tick(w, 5);
    expect(employees(w, weaver).map((p) => p.home)).toEqual([home.id]);
  });
});

describe('step 3: what butchering leaves', () => {
  it('a butchered animal leaves its hide and tallow by the paddock', () => {
    const w = createWorld();
    const farm = place(w, 2587.5, 'chickenfarm');
    farm.stock.grain = 3;
    herdOf(farm).animals = [{ sex: 'female', age: ANIMALS.chicken.lifespan }];
    tick(w, 20);
    const lying = (r: string) => w.piles.filter((p) => p.resource === r).reduce((n, p) => n + p.amount, 0);
    const carried = (r: string) => w.people.filter((p) => p.job?.worker.carrying?.resource === r).length;
    expect(lying('hides') + carried('hides') + villageStock(w).hides).toBeGreaterThanOrEqual(1);
    expect(lying('tallow') + carried('tallow') + villageStock(w).tallow).toBeGreaterThanOrEqual(1);
  });

  it('the chandler dips two candles from each tallow', () => {
    const w = createWorld();
    const shop = place(w, 2587.5, 'chandler');
    shop.stock.tallow = 1;
    tick(w, 40);
    expect(shop.stock.candles + villageStock(w).candles).toBe(2);
  });
});

describe('step 4: horses at work', () => {
  it('a horse farm haltered its spare grown horses, keeping a breeding pair', () => {
    const w = createWorld();
    const farm = place(w, 2812.5, 'horsefarm');
    herdOf(farm).animals = [
      { sex: 'female', age: 6 },
      { sex: 'male', age: 6 },
      { sex: 'female', age: 8 },
    ];
    tick(w, 20);
    expect(herdOf(farm).animals.filter((a) => a.age >= ANIMALS.horse.adult)).toHaveLength(2);
    const led = w.people.some((p) => p.job?.worker.carrying?.resource === 'horse');
    expect(farm.stock.horse >= 1 || led).toBe(true);
  });

  it('a serf with a cart from the stable carries four loads at once', () => {
    const w = createWorld();
    const stable = place(w, 2587.5, 'stable');
    stable.stock.horse = 1;
    stable.stock.harness = 1;
    stable.stock.hay = 4;
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    farm.stock.grain = 5;
    let most = 0;
    tick(w, 60, () => {
      for (const p of w.people) if (p.job?.role === 'serf' && p.job.worker.carrying?.resource === 'grain') most = Math.max(most, p.job.worker.carrying.amount);
    });
    expect(most).toBe(CART_LOAD);
  });

  it('a farm with a plough horse works its fields quicker', () => {
    const w = createWorld();
    const farm = w.buildings.find((b) => b.type === 'farm')!;
    const slow = workplaceOf(w, farm, 'farmer')!;
    const plot = farm.farm!.plots[0];
    plot.state = 'fallow';
    const t0 = slow.begin({ action: 'sow', target: 0 })!;
    farm.stock.horse = 1;
    const t1 = workplaceOf(w, farm, 'farmer')!.begin({ action: 'sow', target: 0 })!;
    expect(t1).toBeLessThan(t0);
  });
});

describe('step 5: the castle', () => {
  it('sends a request once there is a reeve; gathered, it gives a charter and coin', () => {
    const w = createWorld();
    tick(w, dayOf(w) * 1.5);
    expect(w.castle.request).toBeNull();
    const reeve = place(w, 2587.5, 'reeve');
    tick(w, dayOf(w) * 1);
    expect(w.castle.request).not.toBeNull();
    // everything asked for is there at once
    for (const [r, n] of Object.entries(stillAsked(w))) reeve.stock[r as keyof typeof reeve.stock] += n!;
    tick(w, 1);
    expect(w.castle.charters).toBe(1);
    expect(w.castle.standing).toBe(1);
    expect(w.treasury).toBeGreaterThanOrEqual(CASTLE_REQUESTS[0].coin);
  });

  it('a request not met by its day lapses, and the castle thinks less of the village', () => {
    const w = createWorld();
    // nothing in the village it asks for
    yard(w).stock.bread = yard(w).stock.planks = 0;
    place(w, 2587.5, 'reeve');
    w.castle.nextOn = 1;
    tick(w, 1);
    const due = w.castle.request!.due;
    // the days go by (the clock moved on), and nothing comes
    while (clock(w).day <= due) w.dayClock += 300 / 24;
    tick(w, 1);
    expect(w.castle.request).toBeNull();
    expect(w.castle.standing).toBe(-1);
    expect(w.castle.charters).toBe(0);
    expect(due).toBeGreaterThan(0);
  });

  it('charters unlock buildings: no dairy for the lord without one', () => {
    const w = createWorld();
    expect(whyLocked(w, 'dairy')).toMatch(/charter/);
    expect(placeBuilding(w, 2587.5, 'dairy', { instant: true })).toBeNull();
    w.castle.charters = 1;
    expect(whyLocked(w, 'dairy')).toBeNull();
  });

  it('the reeve\'s house is the only one', () => {
    const w = createWorld();
    place(w, 2587.5, 'reeve');
    expect(whyLocked(w, 'reeve')).toMatch(/already/);
  });

  it('content burghers pay taxes, and want the chapel near', () => {
    const w = createWorld();
    tick(w, 1 / 30);
    const house = w.buildings.find((b) => b.type === 'house' && residentsOf(w, b).length > 0)!;
    house.level = 2;
    house.upgraded = true;
    const before = w.treasury;
    tick(w, dayOf(w) * 0.3, () => {
      for (const r of ['bread', 'water', 'cheese', 'cloth', 'ale', 'candles', 'pastries'] as const) house.stock[r] = 1;
    });
    expect(w.treasury).toBeGreaterThan(before);
  });
});

describe('step 6: the merchant', () => {
  it('on market days he buys the village\'s surplus and sells iron for its coin', () => {
    const w = createWorld();
    const market = place(w, 2587.5, 'market');
    w.treasury = 50;
    // jump to a market day's morning
    while (!merchantHere(w)) w.dayClock += 300 / 24;
    market.stock.wool = 2;
    tick(w, 30);
    expect(market.stock.wool).toBeLessThan(2);
    expect(market.stock.iron + villageStock(w).iron + w.people.filter((p) => p.job?.worker.carrying?.resource === 'iron').length).toBeGreaterThan(0);
    expect(MARKET.everyDays).toBeGreaterThan(1);
  });

  it('the smith forges iron into tools, and tools in store speed up the work', () => {
    const w = createWorld();
    expect(toolSpeed(w)).toBe(1);
    yard(w).stock.tools = 1;
    expect(toolSpeed(w)).toBe(TOOL_SPEED);
    const smithy = place(w, 2587.5, 'blacksmith');
    w.castle.charters = 3;
    smithy.stock.iron = 1;
    // a freeman to forge
    tick(w, 1 / 30);
    const seeker = w.people.find((p) => p.seeker && p.home !== undefined)!;
    const home = w.buildings.find((b) => b.id === seeker.home)!;
    home.level = 1;
    home.upgraded = true;
    tick(w, 40);
    expect(smithy.stock.tools + villageStock(w).tools).toBeGreaterThanOrEqual(2);
  });

  it('with salt, a smokehouse cures each joint into two', () => {
    const w = createWorld();
    const smoke = place(w, 2587.5, 'smokehouse');
    smoke.stock.meat = 1;
    smoke.stock.salt = 1;
    tick(w, 40, () => (smoke.stock.meat = Math.min(smoke.stock.meat, 1)));
    expect(smoke.stock.smokedmeat + villageStock(w).smokedmeat).toBeGreaterThanOrEqual(2);
  });
});
