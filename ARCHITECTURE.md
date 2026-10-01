# Architecture

Vite + TypeScript + Canvas 2D. No engine. Every building, the horse, people and the
landscape are drawn procedurally in code. Sprite assets (docs/art/ASSET_SPEC.md) replace that
art piece by piece where `public/assets/manifest.json` has them; the procedural art stays as the
fallback.

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

src/sim      the game as text, headless       imports only src/game (like render, reads state; its scripts play the game)
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
| Change hills, castle, road, grass | `render/background.ts` (trees: `render/nature.ts`, placed by `render/plane.ts`) |
| Change day length, working hours, lunch | `game/daynight.ts` |
| Change crops, fields, the farmer's look or animation, the sheaf pile | `render/farm.ts` |
| Change the horse/rider, villagers | `render/horse.ts`, `render/people.ts` |
| Change construction visuals (scaffolding, stages' look) | `render/construction.ts` |
| Replace art with sprite assets | put them in `public/assets/` per `docs/art/ASSET_SPEC.md`; check with `npm run assets:check`, look at `?art=preview` |
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
| Save something new, or change the save format | `game/save.ts` (bump `SAVE_VERSION` and extend the validator; older saves are discarded, not migrated) |
| Change where/when the game is saved | `app/persistence.ts` |
| Change zoom behaviour or screen scaling | `app/viewport.ts`, `app/screen.ts` |
| Try a situation out, or test a flow, without graphics | a script in `tests/scenarios/*.scn` (`npm run sim -- <file>`); commands in `sim/scenario.ts` |
| Add a rule every world must keep | `checkInvariants` in `sim/textmap.ts` |

## Files

### `src/game`: logic
- `buildings.ts`: building registry: name, purpose, footprint width, build time, **cost** (wood,
  stone), **storage** (what its own store holds, and how much) and **jobs** (roles and how many).
  Behaviour of one kind of building lives in its own module (a farm's fields in `farm.ts`).
- `world.ts`: world state and `update()`: plots, buildings (each with its own `stock` store),
  people and animals, the village `stock`pile, rider physics, build menu, construction progress
  and stages, the construction toggle, events. `workplaceOf` says what work a building gives its
  workers. Tested by `world.test.ts`.
- `resources.ts`: resources (wood, stone, grain, flour, bread), `Stock` (an amount of each) and `Amounts` (some
  of them, e.g. a cost), with affordability and payment helpers.
- `economy.ts`: the village's materials are what its warehouses hold (the `warehouse` building is
  shown as an open storage yard: all it holds lies in its piles, `YARD_ITEMS` in `layout.ts`, which
  also set its capacity) (the starting warehouse
  has `WAREHOUSE_START`). A new building can start only if the warehouses hold its cost beyond
  what other sites are still owed. `storeSlots`/`storeSpot` say where each item lies in any
  building's store (warehouse stacks, a farm's sheaves, the mill's sacks) and how much one
  person carries off at a time.
- `transport.ts`: errands, one trip each: what a building `ships` goes from its store straight to
  the nearest building that `needs` it and has room (the mill's flour to the bakery), and only
  otherwise to the nearest warehouse with room; what it `needs` comes from the nearest place that has it, a
  building that makes it (a farm's store, the mill's flour) or a warehouse, and at equal distance
  straight from the maker. Everyone on an errand is counted, so no two people go for the same
  load. `errandWork` is how anyone runs one. Serfs are the people looking for work, hired by the
  transport hub (the oldest warehouse) while there are errands (up to `SERFS_MAX`, daylight only)
  and let go where they stand when there are none.
- `workshop.ts`: any building with a `makes` recipe (`buildings.ts`: from, to, batch, per, seconds,
  verb, door) as a workplace: the mill (grain → flour) and the bakery (flour → twice as much
  bread). The worker takes a sack off the store and carries it to where it is worked: the recipe's
  `at` spot outdoors (the baker at the oven, with a peel) or else in through the door (the miller,
  seen at the upstairs window), then puts what was made in its place in the store. With
  nothing to make and none of the input, they fetch it themselves from the nearest source,
  unless someone is already bringing it. A new production building needs only a recipe, store
  places (`storeSlots`) and its art.
- `tavern.ts`: the tavern `needs` bread (serfs bring it from a warehouse to the baskets on its
  bench, `TAVERN_SLOTS`); its guests eat a loaf every `LOAF_HOURS` game hours, worked out from the
  day clock.
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
  what it yields and where that goes down (`dropSpot`, asked again on the way as piles change),
  and whether a load is taken indoors to be worked on there (`inside`).
- `farm.ts`: the farm's fields, and the farm as a `Workplace`. Tested by `farm.test.ts`. Each
  field is one land-grid cell (see `land.ts`) in one of the field rows (`FIELD_ROWS` in
  `layout.ts`): the three lot rows behind the road, two in front of it. A new
  farm is just the farmstead: a field stays grass until the farmer first works it (`tilled`). Each
  field keeps its own state (fallow → growing → ripe) and age (150 s to ripe). Jobs: harvest while
  the farm store has room for the sheaf, else sow, nearest first; each takes `sowPerCell` /
  `harvestPerCell` seconds (tuning sliders). A harvest yields a sheaf, stacked in its own place in the
  store (`SHEAF_SLOTS`), from where serfs carry them to a warehouse (`transport.ts`).
- `daynight.ts`: time of day, from `world.dayClock`, which runs at the `timeSpeed` knob (a day is
  `DAY_LENGTH` = 300 s at 1×). The `nightHours` knob (0–12) shapes the sun's path: fewer hours
  lift it, like a summer far north; 0 is the midnight sun. `timeOfDay` gives villagers what they plan
  by: daylight (enough light to work: from half an hour after sunrise to half an hour before
  sunset, `WORK_MARGIN`), day number, hour, and game hours per second.
- `nature.ts`: the woods and the quarries. Trees stand anywhere on the land with room (`treeRoom`):
  in clumps behind the streets and a little in front, never on a road, a building's lot, a field or a
  quarry, nor crowding each other; each keeps its place as a world x along a street and a depth y.
  Land that gets taken (a building, a farm's fields, a new road) is cleared (`clearLand`). Saplings
  sprout mostly near grown trees. A woodcutter walks out to the nearest grown tree in reach (along the
  streets, then across the land) and fells it; a stonecutter cuts at the face of the nearest quarry.
  Workers walk at real ground speed: depth y is turned into ground px for every step (`worker.ts`).
- `streets.ts`: the street network. A crossroads (the `intersection` building, 10 wood) opens a
  new street across its own at right angles, crossing it at the new street's middle plot
  (`CROSS_PLOT`). Each street is still a line with its own stretch of world x (street i starts at
  i × `STREET_STRIDE`, plot k of street i is `plots[i × PLOTS_PER_STREET + k]`), so one x says where
  anything is. On the map all streets lie on one 250 px grid, so they meet at plots: a new street is
  laid out plot by plot both ways (`layStreet` in `world.ts`); meeting a street that crosses its way
  it joins it if that plot is free (a crossroads is made there, `Building.junction`, and it runs on
  across) and ends one plot short otherwise, and it ends one plot short of a street along the same
  line. A road runs on past a street's last plot, so a street ends as many plots shorter again as
  keeps that end off any road it doesn't meet, with a cell of grass between (`planStreet`); a
  crossroads whose road can't keep off one that way can't be built. Plots past a street's ends are `off`. So streets close into loops. `Junction`s are where
  streets meet; `route` is the shortest way between two x's through them (to the corner, then on
  from the same spot on the next street; `worker.ts` walks it) and `streetDist` the walking distance
  every "nearest" is measured by. Each street is seen from its right-hand side, so its lots lie to
  its left (`backOf`) and a new street runs off into what lay behind the old one. The rider turns at
  a crossroads (`turnAtCrossroads`): ↑ onto the road away from the viewer, ↓ towards them. A new
  street gets its own woods; trees are cut where roads run off, and no field is sown across one.
- `grid.ts`: the land grid, tested by `land.test.ts`. The whole plane is cut into 25 px cells,
  north up: columns numbered 0, 1, 2… east (-1, -2… west), rows lettered A, B, C… north (-A, -B…
  south), so a cell is named like B3. Roads take three cells across (one per lane), every street's
  middle lane running down a row or column of cells; buildings take `width` (rounded up to cells)
  × `depth` (default 2) cells; fields one cell each; quarries their rocky land (`landUse`). Seen
  from a street, cells lie in rows j along it (`LOT_ROW` in `layout.ts`): the road is rows -1..1,
  buildings stand right by it, from row 2 back. Buildings are whole blocks of three cells wide
  (3, 6, 9…) and start at a cell 3n + 1 along their street (`siteX`); a building goes at any such
  place where it fits on free cells (`whyNotHere`). Crossroads stand on the plots, one per block,
  so their roads take a block and streets meet at a plot of each. Houses come small (3), medium
  (6) and large (9): a small house finished right beside a house becomes part of it
  (`mergeNeighbours` in `world.ts`, `Building.size`), and so does what is left of a merged one
  when a section of it is pulled down.
- `land.ts`: the farms' fields on the grid. A farm works the free cells nearest to it, up to
  `FIELD_REACH` cells to either side and `FIELD_CELLS` in all (more once upgraded). Building over a
  field, or a new road, re-lays the fields (`syncFarmFields`): fields keep their crops where their
  cells are still theirs, and the farm takes the next nearest free cells instead.
- `layout.ts`: the shared world geometry (see above), including the grid constants.
  World y is a real depth on the ground (`behindRoad`: the camera's perspective, `HORIZON_Y`,
  `EYE_DIST`), so the village is a plane; a quarry takes real land behind the main street
  (`quarryLand`), which streets stop short of and no tree or field grows on.
- `save.ts`: save games, tested by `save.test.ts`. `saveWorld` snapshots the simulation state
  (time, buildings with their stores and farms, people with their jobs and working day, animals,
  the stockpile, rider, RNG, id counter) as versioned JSON-safe data; `loadWorld` validates
  untrusted data field by field, runs `MIGRATIONS` from older versions, and rebuilds the world
  under the current rules (plots and field layout are derived, not stored; a job at a building
  that doesn't offer it is dropped). It refuses corrupt or newer saves with a reason instead of
  throwing. Not saved: the open menu, pending events, and tuning knobs (the URL owns those).

### `src/sim`: the game as text
The whole game can be played and looked at without graphics, instantly: the text is a view of the
same state, and the same geometry (`grid.ts` `landUse`, `footprintOf`, `fieldCell`), that the
renderer draws, so a layout that is right in text is right on screen.
- `textmap.ts`: `renderMap`, the land grid from above, north up, one character per cell (roads
  `=` `|`, crossings `+`, rocks `#`, a letter per building type, upper case standing and lower
  case being built, fields `,` `_` `"` `*` by state, the rider `@`; `ids` mode gives each building
  its own letter and its fields the lower case, to show which is which, e.g. merged houses);
  `listBuildings`, `listStreets`, `summary`; and `checkInvariants`, the rules every world keeps
  (no two buildings on a cell, nothing on a road or the rocks, buildings start at a cell 3n + 1,
  every field on free land and one farm's, within reach; small houses and yards side by side are
  merged; roads cross only at a crossroads; every job at a building that is there).
- `scenario.ts`: `runScenario`, a script played one command a line through the game's own
  functions (`build farm at s0:40`, `build house next`, `ride #last`, `turn up`, `build farm
  here` through the build menu as the player does, `run until built`, `map ids`, `expect …`).
  Places are `s<street>:<cell along it>`. The rules are checked after every command and every
  few simulated seconds while running. `tools/sim.ts` is the command line (`npm run sim`).
  `tests/scenarios.test.ts` plays every `tests/scenarios/*.scn`: no failure allowed, and the
  output must match its `.out` snapshot (update with `npx vitest run tests/scenarios.test.ts -u`).

### `src/render`: graphics
- `index.ts`: the renderer's public API: `renderFrame()` (world pass, then screen UI pass),
  `cameraX()`, and the UI layout/hit-test helpers used for input.
- `scene.ts`: world draw order: backdrop → back fields → farmers in the back field → plot
  markers → buildings → front fields → people → rider → foreground → world-anchored labels.
- `sky.ts`: daylight. Turns the time of day into sky colours, the sun crossing the sky, moon and
  stars at night, cloud colours, and a tint that darkens the land at night and warms it at dusk.
  The land is drawn first and tinted, then the sky (drawn on an offscreen canvas) is composited
  behind it, so the night sky stays bright while the land darkens.
- `background.ts`: the backdrop on the horizon (mountains, the castle on its hill, low hills),
  panning with the camera and turning with it at a crossroads; the land plane from the horizon down;
  the haze of distance; the street being looked at and the foreground grass; where a street ends
  short; and (`drawSideRoad`) the road of a crossroads still being built.
- `plane.ts`: the village as a plane seen in perspective. The camera stands in front of the street
  the rider is on, looking across it (`Eye`); everything on every other street is projected from its
  map position (streets.ts): roads and farm fields as shapes on the ground (clipped near the
  camera), buildings, sites, fingerposts, trees, quarries and people as pictures that always face
  the camera, smaller and nearer the horizon with distance. A building on a street running away from
  the camera stands beside that road. Things further off than this street's woods are drawn before
  them, nearer ones in among this street's people by screen depth.
- `buildings.ts`: "2D picture of a 3D building" primitives (front face, shaded side face, gable
  roof with thatch/tile/slate, timber framing) and `BUILDING_ART`: per building `draw`, optional
  `behind`/`front` art, and the drawn `height`. Art split for sprites also has `body` (the static
  picture a sprite replaces), `overlay` (live details: open door, stock, sleepers, drawn over the
  body or its sprite at named points), `points` and `lights` (for the exported emissive layer).
- `sprites.ts`: `drawBuilding`, which everything that draws a finished building calls: the
  building's sprite (shadow, colour, parts, smoke, then its `overlay`) when one is decoded, else
  its procedural `draw`. Stage sprites for construction, roadside views for buildings seen up a
  side road, and the build menu's previews.
- `assets.ts`: sprite assets at run time: loads the manifest (`?art=procedural` ignores it;
  production builds keep only approved assets), decodes images lazily at the tier the current
  transform needs, draws an image's layers at its anchor, and queues emissive layers, which the
  scene adds after the night tint. `manifest.ts`: the manifest's types and pure lookups, shared
  with the asset tools. `preview.ts`: the `?art=preview` contact sheet (each sprite beside the
  procedural art it replaces; `&night=1`, `&zoom=0.45`).
- `construction.ts`: generic staged construction for any building: stakes → foundation →
  timber frame → walls → roof. The finished art is revealed bottom-up behind scaffolding, or,
  for a building with stage sprites, each stage's image fades in over the one before.
- `grid.ts`: the land-grid overlay (G, or `?grid=1`) on the street being looked at: its rows of
  cells tinted by use (road, building, field, quarry) and named where the names fit; and the cells
  the building chosen in the build menu would take, green where it fits, red where not. From above
  (`topview.ts`) the grid covers the whole plane, with column numbers and row letters at the edges.
- `topview.ts`: the village from above (Tab, or the small map's spot on screen), at its own zoom: the
  plane north up around the rider, with streets, fields, the quarries' rocky land, roofs exactly on
  their footprint cells, sites as frames filling in, the mill's sails turning, trees where they stand,
  and people (stepping, carrying their loads), chickens and the rider moving about. With the land
  grid on it shows every street's cells by use, the quarries' cells and each plot's lot.
- `ground.ts`: the ground perspective (the camera's, with the horizon on screen at `HORIZON_Y`;
  plane.ts uses the same projection for the rest of the village). Anything lying or standing on the land (fields, the land
  grid, ruts and stones in the road, the grass edge, foreground grass, the farmer, villagers and
  the rider) maps its x through `groundX`; repeating ground details use `groundTiles`, so lines into the scene converge on a vanishing point in
  the middle of the view and fan out towards the screen edges as the camera moves. The ground is
  true width at the building line, so buildings need no correction. `HORIZON_Y` sets how strong
  the effect is.
- `farm.ts`: field plots in the ground perspective, crops by growth stage, the farmer (walk, sow,
  scythe, carry), and the sheaf store.
- `horse.ts`: rider with a 4-beat walk and a diagonal trot, plus idle animation. `people.ts`:
  villagers and chickens.
- `ui.ts`: HUD, touch buttons (with ▲ ▼ to turn at a crossroads), the village map in the top right
  corner (streets and building icons, north up, the rider as a gold arrow), build menu, labels,
  progress bars and toasts, plus
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
- `panel.ts`: makes the side panels (workers list, tuning) collapsible to a small expand chip,
  remembered per browser.
- `src/main.ts`: bootstrap and the frame loop.

## Rules

- Plots sit every 250 px along each 6400 px street. A plot holds at most one building; a crossroads
  stands on a plot of each of its two streets.
- With construction ON, a building takes its `buildTime` (6–18 s). With it OFF, buildings
  appear finished immediately, and turning it off also finishes anything under construction.

## Not done yet / ideas

- Realistic art: in progress. The game side (asset loader, validator, preview) is done; the
  art itself is not. See [docs/art/](docs/art/README.md) for the plan, the work packages, and the
  asset format spec that sprite-based art must follow.

- Wood and stone can't be produced yet (no woodcutter or quarry), so the starting warehouse is
  all there is.  New people don't arrive
  (houses could house newcomers), and there is no way to fire or reassign a worker.
- No music. No lit windows or lanterns at night yet. One save slot; no offline progress while the page is closed.
