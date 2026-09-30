# Architecture

Vite + TypeScript + Canvas 2D. No engine and no image assets: every building, the
horse, people and the landscape are drawn procedurally in code.

## Layers

The code is split so **graphics** and **game logic/mechanics** can be worked on
separately, even at the same time.

```
src/game     rules, state, simulation        no DOM, no canvas, imports only src/game
   ▲
   │ reads state (never changes it)
src/render   everything you see              imports src/game + src/render
   ▲
   │ renderFrame(), layouts
src/app      input, screen/zoom, actions     main.ts wires it all into the loop
```

| Layer | Owns | Must not |
| --- | --- | --- |
| `src/game` | World state, rules, timings, simulation (rider physics, construction, farms, villagers), gameplay data (building names, purposes, footprints, build times) | Touch the DOM or canvas; import from `render` or `app`; hold display-only data (colours, drawn heights, captions) |
| `src/render` | All visuals: art, animation, draw order, camera framing, HUD/menu look and layout, on-screen wording | Change game state (only read it); import from `app` |
| `src/app` | Keyboard/touch/wheel input, zoom and screen scaling, the player actions input maps onto, turning game events into messages | Draw anything itself; reach into `render` internals (use `src/render/index.ts`) |

**The shared contract.** The two sides meet in two places only:

1. **State types** in `src/game` (`World`, `Building`, `FarmState`, `Farmer`, `FieldPlot`, …).
   The renderer draws whatever these say. A new mechanic that needs to be visible adds a
   field here, and the renderer then draws it.
2. **`src/game/layout.ts`**: world positions that art and logic must agree on, such as the
   road line, where the farm plots are, the farmhouse door and the grain store. If you
   redraw the farmhouse wider, move `HOME`/`STORE` there, and the farmer walks to the new spots.
   It also says where every stored thing lies (`SHEAF_SLOTS`, `warehouseSlot`, `siteSlot`,
   one item per `PILE_UNIT`): the art draws each item there, and workers walk to that exact
   spot to put it down or pick it up.

**Nothing jumps.** People are always somewhere (x and depth y) and only ever walk: hired,
they set off from where they stand; let go (a site finished, nightfall), they stay put and
walk back to their lane of the street. Goods move only in someone's arms, from the place
they lie to the place they will lie. Keep it that way when adding a mechanic.

**Enforced.** `npm test` includes `tests/architecture.test.ts`, which fails if:
- a game file imports render/app code or uses browser APIs;
- a render file imports app code or calls a state-changing game function (`update`,
  `placeBuilding`, `openMenu`, …);
- app code imports render internals instead of `src/render/index.ts`.

`npm run build` also compiles `src/game` on its own with no DOM types
(`tsconfig.game.json`).

## Where to make a change

| I want to… | Edit |
| --- | --- |
| Change how a building looks, or its drawn height | `render/buildings.ts` (`BUILDING_ART`) |
| Change sky, sun, moon, stars, clouds, night darkness | `render/sky.ts` |
| Change hills, castle, trees, road, grass | `render/background.ts` |
| Change day length, working hours, lunch | `game/daynight.ts` |
| Change crops, fields, the farmer's look or animation, the sheaf pile | `render/farm.ts` |
| Change the horse/rider, villagers | `render/horse.ts`, `render/people.ts` |
| Change construction visuals (scaffolding, stages' look) | `render/construction.ts` |
| Change the HUD, menu, labels, captions, button positions | `render/ui.ts` (tap areas follow automatically) |
| Change draw order or camera framing | `render/scene.ts` |
| Add a building type | `game/buildings.ts` (gameplay data: cost, storage, jobs) **and** `render/buildings.ts` (art) |
| Give a building workers | its `jobs` in `game/buildings.ts`, a `Workplace` for it (like `farmWorkplace`) returned by `workplaceOf` in `game/world.ts`, and a look for the worker in `render/` |
| Change timings, speeds, rules (build times, grow time, store size, rider speed) | `game/buildings.ts`, `game/world.ts`, `game/farm.ts` |
| Change the working day (lunch, sleep, doors) | `game/worker.ts` |
| Change what farmers do, or the crop cycle | `game/farm.ts` |
| Add a new mechanic | new module in `src/game` + tests, a state field for anything visible, then draw it in `src/render` |
| Move where things stand (plots, farmyard, store, road) | `game/layout.ts` |
| Change controls or add a key/button action | `app/controls.ts`, `app/actions.ts` (plus the button's look in `render/ui.ts`) |
| Save something new, or change the save format | `game/save.ts` (bump `SAVE_VERSION`, add a migration, extend the validator) |
| Change where/when the game is saved | `app/persistence.ts` |
| Change zoom behaviour or screen scaling | `app/viewport.ts`, `app/screen.ts` |

## Files

### `src/game`: logic
- `buildings.ts`: building registry: name, purpose, footprint width, build time, **cost** (wood,
  stone), **storage** (what its own store holds, and how much) and **jobs** (roles and how many).
  Behaviour of one kind of building lives in its own module (a farm's fields in `farm.ts`).
- `world.ts`: world state and `update()`: plots, buildings (each with its own `stock` store),
  people and animals, the village `stock`pile, rider physics, build menu, construction progress
  and stages, the construction toggle, events. `workplaceOf` says what work a building gives its
  workers. Tested by `world.test.ts`.
- `resources.ts`: resources (wood, stone, grain, flour), `Stock` (an amount of each) and `Amounts` (some
  of them, e.g. a cost), with affordability and payment helpers.
- `economy.ts`: the village's materials are what its warehouses hold (the starting warehouse
  has `WAREHOUSE_START`). A new building can start only if the warehouses hold its cost beyond
  what other sites are still owed. `storeSlots`/`storeSpot` say where each item lies in any
  building's store (warehouse stacks, a farm's sheaves, the mill's sacks) and how much one
  person carries off at a time.
- `transport.ts`: serfs carry goods between buildings, one errand per trip: what a building
  `ships` from its store to a warehouse (a farm's sheaves, the mill's flour) and what it `needs`
  brought from one (the mill's grain). Serfs are the people looking for work, hired by the
  transport hub (the oldest warehouse) while there are errands (up to `SERFS_MAX`, daylight only)
  and let go where they stand when there are none.
- `mill.ts`: the mill as a workplace: its miller grinds a sack of grain (`SACK`) into flour in
  `GRIND_TIME`, in the mill's store (grain left of the door, flour right, `MILL_SLOTS`).
- `site.ts`: construction. A placed building is a site that hires up to `BUILDERS_PER_SITE`
  idle villagers as builders (day labour: no lunch, let go at nightfall, hired again in the
  morning). They take its cost off the nearest warehouse's stacks `LOAD_SIZE` at a time and
  carry it straight to a work spot along the front of the building (`workSpots`), lay it down
  there and build with what lies at their spot in `BUILD_CHUNK`s of labour (`buildTime` in all,
  scaled by the build-speed slider), using it up. A site's starting materials (a free
  building's) lie on a pile at its side and are carried to a spot first. Progress is the share
  of the cost built in (`Site`: delivered, pile, laid). With construction off,
  buildings are finished at once from the warehouses' stock.
- `people.ts`: every villager is a `Person` with an id number, a name, a look and a `job` (a
  building and role, plus their `Worker` state) or none. The unemployed stroll the street on
  their lane (`laneY`: odd ids the far side, even the near side);
  `staffBuildings` fills open jobs (a finished building's own, builders at sites, serfs at the
  transport hub) with the nearest of them, who walk over from where they are. A profession is
  for life; the one exception is people looking for work (`seeker`): they run errands as serfs,
  and take the first lasting job going (miller, farmer), which becomes their profession. Lasting
  jobs are filled before errands, so a serf between errands is hired away for one. A new
  village has one farmer, five builders, five people looking for work and two townsfolk.
  Chickens are `Animal`s.
- `worker.ts`: the working day, the same for every job: work in daylight, go home at 11:30
  (`LUNCH_AT`) and eat for an hour (`LUNCH_HOURS`) once inside, once a day; sleep at night; step
  in and out of the door (`DOOR_TIME`); carry loads (walking faster with empty hands,
  `WALK_SPEED_EMPTY`) to the exact spot they go down. What the work *is* comes from the
  building as a `Workplace`: its door, the next job and where it is done, how long a job takes,
  what it yields and where that goes down (`dropSpot`, asked again on the way as piles change).
- `farm.ts`: the farm's fields, and the farm as a `Workplace`. Tested by `farm.test.ts`. Plots lie
  on the free land-grid cells around it (see `land.ts`) in rows (`FIELD_ROWS` in `layout.ts`): one
  behind the road, two in front of it. A new farm is just the farmstead: a plot stays grass until
  the farmer first works it (`tilled`), and borrowed land in front of the neighbouring lots
  returns to grass after each harvest. Each plot keeps its own state (fallow → growing → ripe) and
  age (150 s to ripe). Jobs: harvest while the farm store has room for the sheaf, else sow, own
  land before borrowed, nearest first; each takes `sowPerCell` / `harvestPerCell` seconds per grid
  cell of plot width (tuning sliders). A harvest yields a sheaf, stacked in its own place in the
  store (`SHEAF_SLOTS`), from where serfs carry them to a warehouse (`transport.ts`).
- `daynight.ts`: time of day, from `world.dayClock`, which runs at the `timeSpeed` knob (a day is
  `DAY_LENGTH` = 300 s at 1×). The `nightHours` knob (0–12) shapes the sun's path: fewer hours
  lift it, like a summer far north; 0 is the midnight sun. `timeOfDay` gives villagers what they plan
  by: daylight (enough light to work: from half an hour after sunrise to half an hour before
  sunset, `WORK_MARGIN`), day number, hour, and game hours per second.
- `land.ts`: the land grid, tested by `land.test.ts`. The street is cut into 25 px cells in two
  rows: `back` (behind the road, where buildings stand) and `front` (between the road and the
  viewer). A building claims its footprint cells (its `width` rounded up to whole cells, centred on
  the plot) as soon as it is placed. A farm's back fields fill the free cells up to the next
  building on each side (usually one plot per side); its front fields take any front cells within
  `FIELD_REACH` that are nearer to it than to another farm. Placing a building re-lays neighbouring
  farms' fields (`syncFarmFields`): a plot the new building trims keeps its crop on the land
  that is left; only plots whose land is taken entirely are lost.
- `layout.ts`: the shared world geometry (see above), including the grid constants.
- `save.ts`: save games, tested by `save.test.ts`. `saveWorld` snapshots the simulation state
  (time, buildings with their stores and farms, people with their jobs and working day, animals,
  the stockpile, rider, RNG, id counter) as versioned JSON-safe data; `loadWorld` validates
  untrusted data field by field, runs `MIGRATIONS` from older versions, and rebuilds the world
  under the current rules (plots and field layout are derived, not stored; a job at a building
  that doesn't offer it is dropped). It refuses corrupt or newer saves with a reason instead of
  throwing. Not saved: the open menu, pending events, and tuning knobs (the URL owns those).

### `src/render`: graphics
- `index.ts`: the renderer's public API: `renderFrame()` (world pass, then screen UI pass),
  `cameraX()`, and the UI layout/hit-test helpers used for input.
- `scene.ts`: world draw order: backdrop → back fields → farmers in the back field → plot
  markers → buildings → front fields → people → rider → foreground → world-anchored labels.
- `sky.ts`: daylight. Turns the time of day into sky colours, the sun crossing the sky, moon and
  stars at night, cloud colours, and a tint that darkens the land at night and warms it at dusk.
  The land is drawn first and tinted, then the sky (drawn on an offscreen canvas) is composited
  behind it, so the night sky stays bright while the land darkens.
- `background.ts`: parallax land layers: mountains, the castle on its hill,
  patchwork fields, the distant village, the tree line, the street and the foreground grass.
- `buildings.ts`: "2D picture of a 3D building" primitives (front face, shaded side face, gable
  roof with thatch/tile/slate, timber framing) and `BUILDING_ART`: per building `draw`, optional
  `behind`/`front` art, and the drawn `height`.
- `construction.ts`: generic staged construction for any building: stakes → foundation →
  timber frame → walls → roof. The finished art is revealed bottom-up behind scaffolding.
- `grid.ts`: the land-grid debug overlay (tuning panel → "land grid", or `?grid=1`): cells tinted
  by use (building footprint red, field green), plot boundaries dashed.
- `ground.ts`: the ground perspective. Anything lying or standing on the land (fields, the land
  grid, ruts and stones in the road, the grass edge, foreground grass, the farmer, villagers and
  the rider) maps its x through `groundX`; repeating ground details use `groundTiles`, so lines into the scene converge on a vanishing point in
  the middle of the view and fan out towards the screen edges as the camera moves. The ground is
  true width at the building line, so buildings need no correction. `HORIZON_Y` sets how strong
  the effect is.
- `farm.ts`: field plots in the ground perspective, crops by growth stage, the farmer (walk, sow,
  scythe, carry), and the sheaf store.
- `horse.ts`: rider with a 4-beat walk and a diagonal trot, plus idle animation. `people.ts`:
  villagers and chickens.
- `ui.ts`: HUD, touch buttons, build menu, labels, progress bars and toasts, plus
  `hudLayout`/`menuLayout`, which return the rectangles used both for drawing and for tap
  hit-testing.
- `util.ts`: drawing helpers (shapes, colour mixing, smoke, hashing).

### `src/app`: input and screen
- `actions.ts`: player verbs (toggle construction, open/close the menu, choose, build) and
  event → message mapping.
- `controls.ts`: keyboard, touch buttons, menu taps, pinch and wheel → actions and zoom. The
  keyboard works one-handed: A/D ride, S opens the build menu; in the menu WASD moves through the
  card grid (rows follow the drawn layout), Space/Enter builds, Esc/Q closes. Arrows mirror WASD.
- `persistence.ts`: keeps the save in IndexedDB (`village-game` → `saves` → `autosave`). Loads it at
  startup (an unloadable save is kept aside under `unloadable-<time>`, never overwritten) and
  autosaves every half hour of game time (`AUTOSAVE_HOURS`), shortly after anything is built or
  finished, and when the page is hidden or closed. Without IndexedDB the game runs unsaved.
- `screen.ts`: canvas size, DPR, zoom and touch mode. `viewport.ts`: the pure zoom/scale maths
  (tested). Zoom 1 fits the 600-unit-tall scene to the screen height. Zooming out shows more
  street and sky, and the UI keeps its own scale. On portrait touch screens the scene is lifted
  above the buttons.
- `sound.ts`: synthesised Web Audio effects, no audio files. It reads game state each frame:
  hoofbeats in step with the gait, menu clicks, a thunk when a building is placed and a chime when
  it's done, each builder's hammer blow, each building's everyday sound, the farmer's sowing and
  scything, and every load picked up or put down. A sound that goes with something drawn plays
  on the frame it is seen (the hammer lands, the bucket reaches the water), using the same rates
  as the animations in `src/render`, so change both together. World sounds pan and fade with
  distance from the rider. M mutes.
- `tuning.ts`: slider panel on the right (horse speed/accel/braking, build speed, time speed,
  night length, sowing and harvest time per cell, volume), the
  land-grid toggle and the "new village" button (wipes the save and reloads).
  Non-default values are kept in the URL query.
- `src/main.ts`: bootstrap and the frame loop.

## Rules

- Plots sit every 250 px along a 6400 px street. A plot holds at most one building.
- With construction ON, a building takes its `buildTime` (6–18 s). With it OFF, buildings
  appear finished immediately, and turning it off also finishes anything under construction.

## Not done yet / ideas

- Wood and stone can't be produced yet (no woodcutter or quarry), so the starting warehouse is
  all there is. Grain piles up in the warehouse with nothing to use it. New people don't arrive
  (houses could house newcomers), and there is no way to fire or reassign a worker.
- No music. No lit windows or lanterns at night yet. One save slot; no offline progress while the page is closed.
