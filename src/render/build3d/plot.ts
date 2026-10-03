// A building's plot in model space: the land-grid cells the game gives it
// (grid.ts sizeOf: BuildingDef width and depth, in cells; a merged house or
// yard `size` times as wide), exactly. Everything a generator puts below head
// height stays on these cells, so the people the game walks round the cells
// (paths.ts) never walk through a wall, a woodpile or a bench; only eaves
// reach out over them, above their heads.
//
// The building line (model y = 0) is the game's BASE_Y, where the camera's
// EYE_DIST is measured to; the plot's front edge (row LOT_ROW's near edge)
// lies a little in front of it.

import { BUILDINGS, type BuildingType } from '../../game/buildings';
import { sizeOf } from '../../game/grid';
import { BASE_Y, behindRoad, CELL_W, LOT_ROW, rowNear } from '../../game/layout';

/** World units per metre (ASSET_SPEC §1): models are in metres, the game in world units. */
export const U = 20;
/** A land-grid cell, in metres. */
export const CELL = CELL_W / U;
/** Model y of a plot's front edge: the near edge of the first row of lots, from the building line. */
export const FRONT_Y = (rowNear(LOT_ROW) - behindRoad(BASE_Y)) / U;
/** Lowest a part may reach out over land that isn't the building's (eaves, a sign): above people's heads. */
export const HEADROOM = 2.1;

/** Which sides of a plot another building stands right against (its walls can touch this one's). */
export interface Sides {
  left: boolean;
  right: boolean;
}

export interface Plot {
  type: BuildingType;
  /** Footprint along the street and back from it, metres. */
  W: number;
  D: number;
  /** Its edges: x from x0 to x1, y from y0 (front, by the road) to y1 (back). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** A merged house or yard: one, two or three blocks wide. */
  size: 1 | 2 | 3;
  /** Neighbours whose walls touch this one's: no eaves overhang on that side, the roof ends flush. */
  sides: Sides;
}

export function plotOf(type: BuildingType, size: 1 | 2 | 3 = 1, sides: Sides = { left: false, right: false }): Plot {
  const { w, d } = sizeOf(type, size);
  const W = w * CELL;
  const D = d * CELL;
  return { type, W, D, x0: -W / 2, x1: W / 2, y0: FRONT_Y, y1: FRONT_Y + D, size, sides };
}

/** Metres from a world-unit offset (a layout.ts dx). */
export const m = (units: number) => units / U;

/** The default plot of a type (tests, the build menu). */
export const defaultPlot = (type: BuildingType) => plotOf(type, 1);

/** Whether a type has a door the game walks people through (BuildingDef.door). */
export const hasDoor = (type: BuildingType) => BUILDINGS[type].door !== null;
