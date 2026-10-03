// World geometry: the positions that the art and the game logic must agree on.
// This is the one shared spatial contract between src/game and src/render.
// Moving something here moves it for both; e.g. if the farmhouse is redrawn
// wider, move HOME/STORE so the farmer still walks to its door and store.

// --- Street (vertical layout, world units) --------------------------------------

/** Length of a street (px); its plots start at FIRST_PLOT_X from its start. */
export const STREET_LENGTH = 6400;
/**
 * The first crossroads place along a street: the middle of cells 16..18, the
 * first block of three cells starting at a cell 3n + 1 (where buildings start
 * too; grid.ts), so a road crossing there runs down the block.
 */
export const FIRST_PLOT_X = 437.5;

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

// --- Depth on the ground ---------------------------------------------------------
// World y says how far across the street something is, the way the street is
// seen: from a camera EYE_DIST in front of the building line, with the horizon
// at HORIZON_Y (render/ground.ts, render/plane.ts). So it stands for a real
// distance on the ground, the village being a plane (game/streets.ts).

/** Where the horizon is (world y), and how far the camera stands from the building line (map px). */
export const HORIZON_Y = 200;
export const EYE_DIST = 400;
/** Distance from the camera of ground at depth y. */
const eyeDist = (y: number) => (EYE_DIST * (BASE_Y - HORIZON_Y)) / (y - HORIZON_Y);
/**
 * Distance from the camera of the middle of the road: its far edge (half its
 * three lanes of 25 px behind the middle, see ROAD_HALF) is just in front of
 * the buildings, which stand right by the road.
 */
const LINE_DIST = eyeDist(GROUND_Y + 6) - 1.5 * 25;
/** How far in front of the middle of the road (map px) ground can lie and still have a depth (yAt): the camera stands there. */
export const FRONT_LIMIT = LINE_DIST;
/** How far behind the middle of the road (map px) ground at depth y lies (negative: in front of it). */
export const behindRoad = (y: number) => eyeDist(y) - LINE_DIST;
/** The depth y of ground lying d map px behind the middle of the road (the inverse of behindRoad). */
export const yAt = (d: number) => HORIZON_Y + (EYE_DIST * (BASE_Y - HORIZON_Y)) / (d + LINE_DIST);
/** Depth (world y) of the middle of the road: the street's line on the map. */
export const STREET_LINE_Y = yAt(0);
/**
 * Half the width of a street's whole band across the ground (map px): its
 * road, the lots and fields along it. Streets on the grid lie two bands apart.
 */
export const STREET_BAND_HALF = 125;

// --- The land grid --------------------------------------------------------------------
// All the land is cut into square cells CELL_W across (game/grid.ts), the same
// grid everywhere on the plane. Seen from a street, cells lie in rows along it:
// row j is j cells behind the middle of the road (negative: in front of it).
// The road takes rows -1, 0 and 1, its three lanes. Buildings stand right by
// it, from row LOT_ROW back, as many rows deep as they are.

export const CELL_W = 25;
/** World x of the left edge of cell 0 along a street (streets start on cell edges). */
export const GRID_X0 = 0;
/** Half the road's width (map px): three lanes of one cell each. */
export const ROAD_HALF = 1.5 * CELL_W;
/** Depths (world y) of the road's far and near edges, and of the lines between its lanes. */
export const ROAD_FAR_Y = yAt(ROAD_HALF);
export const ROAD_NEAR_Y = yAt(-ROAD_HALF);
export const LANE_YS = [yAt(CELL_W / 2), yAt(-CELL_W / 2)];
/** The first row buildings stand in: the one next to the road. */
export const LOT_ROW = 2;
/** Map px behind the middle of the road where row j's near and far edges lie. */
export const rowNear = (j: number) => (j - 0.5) * CELL_W;
export const rowFar = (j: number) => (j + 0.5) * CELL_W;
/** Distance between the places along a street where a crossroads can be built: every block of three cells. */
export const PLOT_SPACING = 3 * CELL_W;
/** Buildings are whole blocks of BLOCK cells wide, starting at a cell BLOCK·n + 1 along their street. */
export const BLOCK = 3;

// --- Farm (x relative to the farm's centre, y in world units) ----------------------

export type FieldZone = 'back' | 'front';

/**
 * The rows of cells a farm's fields can lie in, far to near: behind the road
 * the three rows of the lots, beside the buildings; in front of it the two
 * rows next to the road. Each field is one cell.
 */
export const FIELD_ROW_J: Record<FieldZone, number[]> = { back: [LOT_ROW + 2, LOT_ROW + 1, LOT_ROW], front: [-2, -3] };

/** Row j of cells as a band of world y (depth): far edge and near edge. */
const rowBand = (j: number) => ({ far: yAt(rowFar(j)), near: yAt(rowNear(j)) });

/**
 * Rows of field cells in each zone, far to near, as world-y bands (FIELD_ROW_J).
 */
export const FIELD_ROWS: Record<FieldZone, Array<{ far: number; near: number }>> = {
  back: FIELD_ROW_J.back.map(rowBand),
  front: FIELD_ROW_J.front.map(rowBand),
};

/** Back field: from the far edge of the lots to the road. */
export const BACK_FIELD = { front: FIELD_ROWS.back[FIELD_ROWS.back.length - 1].near, back: FIELD_ROWS.back[0].far };
/** Front field: between the road and the viewer, so it takes more screen height. */
export const FRONT_FIELD = { top: FIELD_ROWS.front[0].far, bottom: FIELD_ROWS.front[FIELD_ROWS.front.length - 1].near };

/** Where the farmer stands while working a plot in this row: the middle of it. */
export function workY(zone: FieldZone, row: number): number {
  const r = FIELD_ROWS[zone][row];
  return (r.far + r.near) / 2;
}
/** The farmyard: the farmer's home spot, by the farmhouse door. */
export const HOME = { dx: -19, y: BASE_Y + 3 };
/** The grain store, in front of the farmhouse at the left end of the farmstead (its stooks inside the farm's cells). */
export const STORE = { dx: -52, y: BASE_Y + 3 };

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

/**
 * How much of a resource one item in a pile stands for: a wood is a log and a
 * stone a block (one item each, what one person carries), grain, flour and
 * bread come in sacks and baskets of PILE_UNIT.
 */
export const PILE_UNIT = 10;
/** How much of resource r one item in a pile holds (PILE_UNIT). */
export const unitOf = (r: string) => (r === 'wood' || r === 'stone' ? 1 : PILE_UNIT);

/** What a sack holds (grain or flour) in a workshop's store; one sack per place. */
export const SACK = 10;
/** Loaves in a basket; one basket per place in a store. */
export const BASKET = 10;

/** Items in a pile holding `amount` of r (a part-filled item counts). */
export const pileItems = (amount: number, r = 'wood') => Math.ceil(amount / unitOf(r) - 1e-9);

/** Where each sheaf stands in the farm's grain store, in the order they are stacked. */
export const SHEAF_SLOTS: readonly Slot[] = [
  { dx: STORE.dx - 14, lift: 0 },
  { dx: STORE.dx, lift: 0 },
  { dx: STORE.dx + 14, lift: 0 },
  { dx: STORE.dx - 7, lift: 13 },
  { dx: STORE.dx + 7, lift: 13 },
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
 * Items a small storage yard (the `warehouse` building, three cells wide)
 * holds, per resource; a medium or large one (two or three merged) holds
 * twice or three times as much. Everything it stores lies out in the open
 * where it can be seen, so this is also its capacity: YARD_ITEMS × unitOf
 * (buildings.ts).
 */
export const YARD_ITEMS = { wood: 15, stone: 15, grain: 5, flour: 5, bread: 5 } as const;
/** How many items of each the yard's piles are laid out for: a medium yard's. */
const YARD_LAID = { wood: 30, stone: 30, grain: 10, flour: 10, bread: 10 } as const;

/**
 * The storage yard's piles: a stone heap on the left, a log pile on the right,
 * and between them an open-fronted shed with sacks of grain (left) and flour
 * (right) stacked on the ground and baskets of bread on two shelves at the
 * back. Item i (0 = bottom of the stack).
 */
export function warehouseSlot(r: 'wood' | 'stone' | 'grain' | 'flour' | 'bread', i: number, size = 2): Slot {
  // laid out for a medium yard; a small one is squeezed into half the width, a large one spread over half again
  const s = warehouseSlotMedium(r, i);
  return { dx: (s.dx * size * YARD_FIT) / 2, lift: s.lift };
}

/** The yard's piles drawn in from its ends, so every log and block lies on the yard's own cells. */
const YARD_FIT = 0.84;

function warehouseSlotMedium(r: 'wood' | 'stone' | 'grain' | 'flour' | 'bread', i: number): Slot {
  const n = Math.max(0, Math.min(i, YARD_LAID[r] - 1));
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

/** The chapel's door, at the foot of its bell tower on the left. */
export const CHAPEL_DOOR: Spot = { dx: -60, y: STAND_Y };
/** The tavern's door. */
export const TAVERN_DOOR: Spot = { dx: -12, y: STAND_Y };
/** The smithy has no front wall: the middle of its open workshop is the way in. */
export const SMITHY_DOOR: Spot = { dx: 3, y: STAND_Y };

/**
 * A house's door (the middle of it, from the building's x) by its size: a small
 * one's near its left end, a merged one's in the middle of its front.
 * render/buildings.ts draws it there; new villagers come out of it.
 */
export const HOUSE_DOOR_DX: Record<1 | 2 | 3, number> = { 1: -21, 2: -12, 3: -12 };

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

/** The bakery's door, where the baker goes in and out. */
export const BAKERY_DOOR: Spot = { dx: -9, y: STAND_Y };
/** The bakery's bread oven, built on at the right; its mouth at BAKERY_OVEN_MOUTH_DX, the baker working it from its left. */
export const BAKERY_OVEN_MOUTH_DX = 60;
export const BAKERY_OVEN: Spot = { dx: BAKERY_OVEN_MOUTH_DX - 17, y: STAND_Y };

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

// --- Woods and quarries (world x, world y) ------------------------------------------

/** Depth trees stand at: just behind the back fields, where the tree line runs. */
export const TREE_Y = BACK_FIELD.back - 2;
/** Where a woodcutter stands to fell a tree: beside its trunk, in front of it. */
export const CHOP_SPOT = { dx: -11, y: TREE_Y + 4 };

// --- The road grid ----------------------------------------------------------------
// Every street keeps to one grid of squares ROAD_GRID cells across: crossroads
// can only be built where their road runs down a line of it (grid.ts
// onRoadGrid), so every road does: nine blocks of three cells apart. The lines
// are the columns 27n + 2 (the middle of the block of three cells starting at
// cell 27n + 1 of the main street) and the rows 27n (the main street's row, A,
// and every 27th from it).

export const ROAD_GRID = 27;
/** The column and row of the road grid's lines through the origin (map cells). */
export const ROAD_GRID_COL = 2;
export const ROAD_GRID_ROW = 0;
/** World x (on the main street) of the middle of square n of the road grid: n squares east of the line at column ROAD_GRID_COL. */
const squareMiddle = (n: number) => (ROAD_GRID_COL + 0.5 + ROAD_GRID * (n + 0.5)) * CELL_W;

/**
 * Where the rocky hills behind the street come down to the tree line, and a
 * stonecutter can cut stone: each in the middle of a square of the road grid,
 * so that no road can ever run into the rocks (quarryLand stays clear of the
 * grid's lines and the roads along them).
 */
export const QUARRIES: readonly { x: number }[] = [{ x: squareMiddle(2) }, { x: squareMiddle(5) }];
/** A quarry's width along the street (no trees grow in it). */
export const QUARRY_W = 280;
/** Depth of the quarry face, where stonecutters stand to cut. */
export const QUARRY_Y = TREE_Y + 1;
/**
 * The land a quarry takes behind the main street (map px; the main street runs
 * along y = 0, its lots to the north): whole land-grid cells (CELL_W square),
 * from the edge of the main street's band back, about QUARRY_W wide and
 * QUARRY_DEEP deep. No street, building, field or tree is on it.
 */
export const QUARRY_DEEP = 10 * CELL_W;
export function quarryLand(q: { x: number }): { x0: number; x1: number; y0: number; y1: number } {
  const snap = (x: number, up: boolean) => GRID_X0 + (up ? Math.ceil : Math.floor)((x - GRID_X0) / CELL_W) * CELL_W;
  return { x0: snap(q.x - QUARRY_W / 2, false), x1: snap(q.x + QUARRY_W / 2, true), y0: STREET_BAND_HALF, y1: STREET_BAND_HALF + QUARRY_DEEP };
}
/** Places along a quarry's face where a stonecutter works (dx from its centre). */
export const QUARRY_SPOTS: readonly number[] = [-46, 0, 46];

/**
 * The woodcutter's hut door, and its store: the wood yard in front of the hut, a cord of split wood
 * stacked there per load, side by side along the street (bottom row first).
 */
export const WOODCUTTER_DOOR: Spot = { dx: -14, y: STAND_Y };
export const WOODCUTTER_SLOTS: readonly Slot[] = [
  { dx: 16, lift: 0 },
  { dx: 36, lift: 0 },
  { dx: 56, lift: 0 },
];

/** The stonecutter's hut door, and its store: dressed blocks set down on the right. */
export const STONECUTTER_DOOR: Spot = { dx: -14, y: STAND_Y };
export const STONECUTTER_SLOTS: readonly Slot[] = [
  { dx: 32, lift: 0 },
  { dx: 44, lift: 0 },
  { dx: 38, lift: 8 },
];
