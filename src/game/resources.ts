// Resources: what buildings cost, store and produce. A `Stock` holds an amount
// of every resource (the village's stockpile, or a building's own store);
// `Amounts` lists just some of them (a building cost, a store's capacity).

export type Resource = 'wood' | 'stone' | 'planks' | 'grain' | 'hay' | 'flour' | 'bread' | 'water' | 'milk' | 'wool' | 'eggs' | 'meat' | 'cheese' | 'smokedmeat' | 'cloth' | 'hides' | 'tallow' | 'leather' | 'candles' | 'harness' | 'horse' | 'ale' | 'pastries' | 'iron' | 'tools' | 'salt';
export const RESOURCES: readonly Resource[] = ['wood', 'stone', 'planks', 'grain', 'hay', 'flour', 'bread', 'water', 'milk', 'wool', 'eggs', 'meat', 'cheese', 'smokedmeat', 'cloth', 'hides', 'tallow', 'leather', 'candles', 'harness', 'horse', 'ale', 'pastries', 'iron', 'tools', 'salt'];

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
  return Object.fromEntries(RESOURCES.map((r) => [r, amounts[r] ?? 0])) as Stock;
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
