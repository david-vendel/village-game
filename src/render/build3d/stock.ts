// A building's store, in 3D: each thing it holds at its own place
// (game/layout.ts slots, the same the workers walk to), on the strip of the
// plot in front of the building: the woodcutter's cords of split wood, the
// stonecutter's dressed blocks, the yard's log pile and stone heap, stooks of
// sheaves, sacks of grain and flour, baskets of loaves.

import type { BuildingType } from '../../game/buildings';
import { BAKERY_SLOTS, BASKET, MILL_SLOTS, PILE_UNIT, pileItems, SACK, SHEAF_SLOTS, STONECUTTER_SLOTS, TAVERN_SLOTS, warehouseSlot, WOODCUTTER_SLOTS, YARD_ITEMS, type Slot } from '../../game/layout';
import { Builder, type Element } from './elements';
import { block, breadBasket, cordwood, sack, stook } from './kit/props';
import { m, plotOf } from './plot';

export type StockKind = 'wood' | 'stone' | 'grain' | 'flour' | 'bread';

/** How deep into the plot (from its front edge) each kind of thing lies. */
const FRONT = 0.3;

/** The things a building's store holds, as elements in their places. */
export function stockElements(type: BuildingType, stock: Partial<Record<StockKind, number>>, size: 1 | 2 | 3, seed: number): Element[] {
  const b = new Builder(seed);
  const plot = plotOf(type, size);
  const y = plot.y0 + FRONT;
  const items = (r: StockKind, cap: number, unit = PILE_UNIT) => Math.min(cap, Math.ceil((stock[r] ?? 0) / unit - 1e-9));
  const at = (s: Slot) => m(s.dx);

  if (type === 'warehouse') {
    const k = (r: keyof typeof YARD_ITEMS) => Math.min(YARD_ITEMS[r] * size, pileItems(stock[r] ?? 0));
    for (let i = 0; i < k('wood'); i++) {
      const s = warehouseSlot('wood', i, size);
      const z = m(s.lift) * 0.62;
      b.log(`wood${i}`, 'log', [at(s), y - 0.25, z + 0.11], [at(s), y + 0.5, z + 0.11], 0.11, 'roof', [], 'logs');
    }
    for (let i = 0; i < k('stone'); i++) {
      const s = warehouseSlot('stone', i, size);
      block(b, `stone${i}`, at(s), y + 0.1, m(s.lift) * 0.55 - 0.06, [0.3, 0.3, 0.2], 'roof', (i % 3) * 0.1);
    }
    // grain, flour and bread keep dry in the shed at the back
    for (let i = 0; i < k('grain'); i++) {
      const s = warehouseSlot('grain', i, size);
      stook(b, `grain${i}`, at(s), plot.y1 - 0.75, 'roof', 0.62);
    }
    for (let i = 0; i < k('flour'); i++) {
      const s = warehouseSlot('flour', i, size);
      sack(b, `flour${i}`, at(s), plot.y1 - 0.7 + (s.lift > 0 ? 0.05 : 0), m(s.lift) * 0.85, { flour: true });
    }
    const bread = stock.bread ?? 0;
    for (let i = 0; i < k('bread'); i++) {
      const s = warehouseSlot('bread', i, size);
      breadBasket(b, `bread${i}`, at(s), plot.y1 - 0.42, s.lift > 55 ? 1.6 : 1.12, Math.ceil((Math.min(PILE_UNIT, bread - i * PILE_UNIT) / PILE_UNIT) * 5));
    }
  } else if (type === 'farm') {
    for (let i = 0; i < items('grain', SHEAF_SLOTS.length, 1); i++) {
      const s = SHEAF_SLOTS[i];
      stook(b, `sheaf${i}`, at(s), y + 0.1 + (s.lift > 0 ? 0.25 : 0), 'roof', s.lift > 0 ? 0.85 : 1);
    }
  } else if (type === 'mill' || type === 'bakery') {
    const slots = type === 'mill' ? MILL_SLOTS : BAKERY_SLOTS;
    if (type === 'mill') for (let i = 0; i < items('grain', MILL_SLOTS.grain.length, SACK); i++) stook(b, `grain${i}`, at(MILL_SLOTS.grain[i]), y + 0.05 + (MILL_SLOTS.grain[i].lift > 0 ? 0.3 : 0), 'roof', 0.8);
    for (let i = 0; i < items('flour', slots.flour.length, SACK); i++) {
      const s = slots.flour[i];
      sack(b, `flour${i}`, at(s), y + (s.lift > 0 ? 0.12 : 0), s.lift > 0 ? 0.3 : 0, { flour: true });
    }
    if (type === 'bakery') breadOn(b, BAKERY_SLOTS.bread, stock.bread ?? 0, y, (s) => (s.lift > 0 ? 0.6 : 0.46));
  } else if (type === 'tavern') {
    breadOn(b, TAVERN_SLOTS, stock.bread ?? 0, y + 0.02, () => 0.46);
  } else if (type === 'woodcutter') {
    // a cord of split wood per load, along the front of the yard
    for (let i = 0; i < items('wood', WOODCUTTER_SLOTS.length); i++) {
      const s = WOODCUTTER_SLOTS[i];
      cordwood(b, `cord${i}`, at(s) - 0.48, at(s) + 0.48, plot.y0 + 0.12, 0.92, 0.5, { posts: true });
    }
  } else if (type === 'stonecutter') {
    for (let i = 0; i < items('stone', STONECUTTER_SLOTS.length); i++) {
      const s = STONECUTTER_SLOTS[i];
      block(b, `block${i}`, at(s), y + 0.08, m(s.lift) * 0.8, [0.5, 0.36, 0.32], 'roof', (i - 1) * 0.08);
    }
  }
  return b.out;
}

/** Baskets of loaves in their places, the last one part-full; z: where each basket stands (a bench, a shelf). */
function breadOn(b: Builder, slots: readonly Slot[], bread: number, y: number, z: (s: Slot) => number): void {
  const n = Math.min(slots.length, Math.ceil(bread / BASKET - 1e-9));
  for (let i = 0; i < n; i++) {
    const inBasket = Math.min(BASKET, bread - i * BASKET);
    breadBasket(b, `bread${i}`, m(slots[i].dx), y + 0.05, z(slots[i]), Math.ceil((inBasket / BASKET) * 5));
  }
}
