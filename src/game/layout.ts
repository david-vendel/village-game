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
/** How far (px from the farm centre) a farm's fields may reach, in both rows. */
export const FIELD_REACH = 225;
/** A field plot spans 2..MAX cells; a lone free cell stays grass. */
export const PLOT_CELLS = { min: 2, max: 3 };

/** Where the farmer stands in each zone while working a plot. */
export const WORK_Y: Record<FieldZone, number> = {
  back: BASE_Y - 15,
  front: (FRONT_FIELD.top + FRONT_FIELD.bottom) / 2 + 8,
};
/** The farmyard: the farmer's home spot, by the farmhouse door. */
export const HOME = { dx: -24, y: BASE_Y + 3 };
/** The grain store, between the farmhouse and the street. */
export const STORE = { dx: -76, y: BASE_Y + 3 };
