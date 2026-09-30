// World geometry: the positions that the art and the game logic must agree on.
// This is the one shared spatial contract between src/game and src/render.
// Moving something here moves it for both; e.g. if the farmhouse is redrawn
// wider, move HOME/STORE so the farmer still walks to its door and store.

// --- Street (vertical layout, world units) --------------------------------------

/** Scene height that zoom 1 fits to the screen. */
export const VIEW_H = 600;
/** Top of the road; buildings stand just behind it. */
export const GROUND_Y = 432;
/** Ground line buildings stand on. */
export const BASE_Y = GROUND_Y + 4;
/** Rider / villager foot line on the road. */
export const ROAD_Y = 474;
/** Bottom edge of the road; the land in front of it runs to VIEW_H. */
export const ROAD_BOTTOM = 500;

// --- Farm (x relative to the farm's plot centre, y in world units) ---------------

export type FieldZone = 'back' | 'front';

/** Back field: a shallow strip behind the farmstead (seen from a low angle). */
export const BACK_FIELD = { front: BASE_Y - 3, back: BASE_Y - 30 };
/** Front field: between the road and the viewer, so it takes more screen height. */
export const FRONT_FIELD = { top: 512, bottom: VIEW_H - 14 };

// --- Land grid ---------------------------------------------------------------------
// The street is cut into cells CELL_W wide, in two rows: 'back' (the lots behind
// the road, where buildings stand) and 'front' (the land between the road and the
// viewer). A building's footprint covers whole cells, and farm fields may only
// use cells that no building covers. Building plot centres fall on cell edges.

export const CELL_W = 25;
/** World x of the left edge of cell 0. */
export const GRID_X0 = 20;
/** Distance between building plot centres: each plot owns a lot this wide. */
export const PLOT_SPACING = 250;
/**
 * How far (px from the farm centre) a farm's fields may reach. Behind the road
 * they stop at the next building anyway; in front of it a farm may borrow the
 * land in front of both neighbouring lots, which it sows only once all of its
 * own land is in use.
 */
export const FIELD_REACH: Record<FieldZone, number> = { back: 225, front: PLOT_SPACING * 1.5 };
/** A field plot spans 2..MAX cells; a lone free cell stays grass. */
export const PLOT_CELLS = { min: 2, max: 3 };

/** Where the front field splits into its far (road side) and near row; the near row looks deeper. */
const FRONT_SPLIT = FRONT_FIELD.top + (FRONT_FIELD.bottom - FRONT_FIELD.top) * 0.42;

/**
 * Rows of plots in each zone, far to near, as world-y bands. Every column of
 * field land has one plot per row: one behind the road, two in front of it.
 */
export const FIELD_ROWS: Record<FieldZone, Array<{ far: number; near: number }>> = {
  back: [{ far: BACK_FIELD.back, near: BACK_FIELD.front }],
  front: [
    { far: FRONT_FIELD.top, near: FRONT_SPLIT },
    { far: FRONT_SPLIT, near: FRONT_FIELD.bottom },
  ],
};

/** Where the farmer stands while working a plot in this row: the middle of it. */
export function workY(zone: FieldZone, row: number): number {
  const r = FIELD_ROWS[zone][row];
  return (r.far + r.near) / 2;
}
/** The farmyard: the farmer's home spot, by the farmhouse door. */
export const HOME = { dx: -19, y: BASE_Y + 3 };
/** The grain store, between the farmhouse and the street. */
export const STORE = { dx: -76, y: BASE_Y + 3 };

// --- Where things lie ----------------------------------------------------------------
// Every stored thing has its own place on the ground: each sheaf in a farm's
// store, each log, block and sack at a warehouse, each piece in a construction
// site's pile. Workers walk to the exact place to put a thing down or pick it
// up, and the art draws it right there. Positions: dx from the building's
// centre; `lift` is how far up the stack an item sits (px above the ground).

/** A place on the ground: dx from a building's centre, and world y (depth). */
export interface Spot {
  dx: number;
  y: number;
}

export interface Slot {
  dx: number;
  lift: number;
}

/** Where someone stands to reach things lying along the building line. */
export const STAND_Y = BASE_Y + 3;

/** How much of a resource one item in a pile stands for: a log, a block of stone, a sack. */
export const PILE_UNIT = 10;

/** What a sack holds (grain or flour) in a workshop's store; one sack per place. */
export const SACK = 10;
/** Loaves in a basket; one basket per place in a store. */
export const BASKET = 10;

/** Items in a pile holding `amount` (a part-filled item counts). */
export const pileItems = (amount: number) => Math.ceil(amount / PILE_UNIT - 1e-9);

/** Where each sheaf stands in the farm's grain store, in the order they are stacked. */
export const SHEAF_SLOTS: readonly Slot[] = [
  { dx: STORE.dx - 15, lift: 0 },
  { dx: STORE.dx, lift: 0 },
  { dx: STORE.dx + 15, lift: 0 },
  { dx: STORE.dx - 7.5, lift: 13 },
  { dx: STORE.dx + 7.5, lift: 13 },
];

/** Row sizes of a pile stacked in a pyramid (bottom row first). */
function pyramid(i: number, rows: readonly number[]): { row: number; col: number } {
  let start = 0;
  for (let row = 0; row < rows.length; row++) {
    if (i < start + rows[row] || row === rows.length - 1) return { row, col: Math.min(i - start, rows[row] - 1) };
    start += rows[row];
  }
  return { row: 0, col: 0 };
}

/**
 * Items the storage yard (the `warehouse` building) holds, per resource. Everything
 * it stores lies out in the open where it can be seen, so this is also its
 * capacity: YARD_ITEMS × PILE_UNIT (buildings.ts).
 */
export const YARD_ITEMS = { wood: 30, stone: 30, grain: 10, flour: 10, bread: 10 } as const;

/**
 * The storage yard's piles: a stone heap on the left, a log pile on the right,
 * and between them an open-fronted shed with sacks of grain (left) and flour
 * (right) stacked on the ground and baskets of bread on two shelves at the
 * back. Item i (0 = bottom of the stack).
 */
export function warehouseSlot(r: 'wood' | 'stone' | 'grain' | 'flour' | 'bread', i: number): Slot {
  const n = Math.max(0, Math.min(i, YARD_ITEMS[r] - 1));
  if (r === 'wood') {
    const { row, col } = pyramid(n, [7, 6, 5, 4, 3, 3, 2]);
    return { dx: 41 + col * 7 + row * 3.5, lift: 3.4 + row * 6 };
  }
  if (r === 'stone') {
    const { row, col } = pyramid(n, [7, 6, 5, 4, 3, 2, 2, 1]);
    return { dx: -80 + col * 7 + row * 3.5, lift: 2.5 + row * 5 };
  }
  if (r === 'bread') return { dx: -20 + (n % 5) * 10, lift: n < 5 ? 50 : 62 };
  const { row, col } = pyramid(n, [4, 3, 2, 1]);
  return { dx: (r === 'grain' ? -27 : 5) + col * 8 + row * 4, lift: row * 9 };
}

/** Most items a construction site's pile shows, per resource. */
export const SITE_SHOWN = { wood: 8, stone: 12 } as const;

/** A construction site's pile, just past the right end of a building `width` wide: logs, then stones. */
export function siteSlot(width: number, r: 'wood' | 'stone', i: number): Slot {
  const x = width / 2 + 14;
  if (r === 'wood') {
    const { row, col } = pyramid(Math.max(0, Math.min(i, SITE_SHOWN.wood - 1)), [4, 3, 1]);
    return { dx: x + col * 9 + row * 4 + 11, lift: row * 8 - 4 };
  }
  const n = Math.max(0, Math.min(i, SITE_SHOWN.stone - 1));
  return { dx: x + 50 + (n % 3) * 8, lift: Math.floor(n / 3) * 6 - 3 };
}

/** How far to the right of a work spot the materials laid down there lie (beside the builder). */
export const SPOT_PILE_DX = 12;

/** The mill's door, where the miller carries the grain in to grind it upstairs. */
export const MILL_DOOR: Spot = { dx: -6, y: STAND_Y };

/** The mill's store: sacks of grain waiting left of the door, sacks of flour right of it (bottom row first). */
export const MILL_SLOTS: Record<'grain' | 'flour', readonly Slot[]> = {
  grain: [
    { dx: -40, lift: 0 },
    { dx: -28, lift: 0 },
    { dx: -34, lift: 9 },
  ],
  flour: [
    { dx: 28, lift: 0 },
    { dx: 40, lift: 0 },
    { dx: 34, lift: 9 },
  ],
};

/** The bakery's door, where the baker carries the flour in to bake it. */
export const BAKERY_DOOR: Spot = { dx: -9, y: STAND_Y };

/** The bakery's store: sacks of flour waiting left of the door, baskets of loaves right of it (bottom row first). */
export const BAKERY_SLOTS: Record<'flour' | 'bread', readonly Slot[]> = {
  flour: [
    { dx: -42, lift: 0 },
    { dx: -30, lift: 0 },
    { dx: -36, lift: 9 },
  ],
  bread: [
    { dx: 10, lift: 0 },
    { dx: 21, lift: 0 },
    { dx: 32, lift: 0 },
    { dx: 21, lift: 7 },
  ],
};

/** Baskets of loaves on the bench in front of the tavern, where its guests help themselves. */
export const TAVERN_SLOTS: readonly Slot[] = [
  { dx: -62, lift: 10 },
  { dx: -48, lift: 10 },
];
