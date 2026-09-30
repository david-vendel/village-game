// Resources: what buildings cost, store and produce. A `Stock` holds an amount
// of every resource (the village's stockpile, or a building's own store);
// `Amounts` lists just some of them (a building cost, a store's capacity).

export type Resource = 'wood' | 'stone' | 'grain' | 'flour' | 'bread';
export const RESOURCES: readonly Resource[] = ['wood', 'stone', 'grain', 'flour', 'bread'];

export type Stock = Record<Resource, number>;
export type Amounts = Partial<Record<Resource, number>>;

/** What one person carries at a time. */
export interface Load {
  resource: Resource;
  amount: number;
}

/** Total amount across all resources. */
export function total(a: Amounts): number {
  return RESOURCES.reduce((sum, r) => sum + (a[r] ?? 0), 0);
}

export function stockOf(amounts: Amounts = {}): Stock {
  return { wood: amounts.wood ?? 0, stone: amounts.stone ?? 0, grain: amounts.grain ?? 0, flour: amounts.flour ?? 0, bread: amounts.bread ?? 0 };
}

/** What is still missing to pay `cost` (empty when affordable). */
export function shortfall(have: Stock, cost: Amounts): Amounts {
  const out: Amounts = {};
  for (const r of RESOURCES) {
    const need = (cost[r] ?? 0) - have[r];
    if (need > 0) out[r] = need;
  }
  return out;
}

export function canAfford(have: Stock, cost: Amounts): boolean {
  return Object.keys(shortfall(have, cost)).length === 0;
}

/** Take `cost` out of `have`; does nothing and returns false if it can't be afforded. */
export function pay(have: Stock, cost: Amounts): boolean {
  if (!canAfford(have, cost)) return false;
  for (const r of RESOURCES) have[r] -= cost[r] ?? 0;
  return true;
}

/** Room left for a resource in a store with these capacities. */
export function room(have: Stock, capacity: Amounts, r: Resource): number {
  return Math.max(0, (capacity[r] ?? 0) - have[r]);
}
