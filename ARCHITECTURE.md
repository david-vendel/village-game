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
| Change sky, hills, castle, trees, road, grass | `render/background.ts` |
| Change crops, fields, the farmer's look or animation, the sheaf pile | `render/farm.ts` |
| Change the horse/rider, villagers | `render/horse.ts`, `render/people.ts` |
| Change construction visuals (scaffolding, stages' look) | `render/construction.ts` |
| Change the HUD, menu, labels, captions, button positions | `render/ui.ts` (tap areas follow automatically) |
| Change draw order or camera framing | `render/scene.ts` |
| Add a building type | `game/buildings.ts` (gameplay data) **and** `render/buildings.ts` (art) |
| Change timings, speeds, rules (build times, grow time, store size, rider speed) | `game/buildings.ts`, `game/world.ts`, `game/farm.ts` |
| Change farmer behaviour or the farm cycle | `game/farm.ts` |
| Add a new mechanic | new module in `src/game` + tests, a state field for anything visible, then draw it in `src/render` |
| Move where things stand (plots, farmyard, store, road) | `game/layout.ts` |
| Change controls or add a key/button action | `app/controls.ts`, `app/actions.ts` (plus the button's look in `render/ui.ts`) |
| Change zoom behaviour or screen scaling | `app/viewport.ts`, `app/screen.ts` |

## Files

### `src/game`: logic
- `buildings.ts`: building registry (name, purpose, footprint width, build time).
- `world.ts`: world state and `update()`: plots, building entities, rider physics, villagers,
  build menu, construction progress and stages, the construction toggle, events.
  Tested by `world.test.ts`.
- `farm.ts`: farm simulation, tested by `farm.test.ts`. A finished farm has field plots on the
  free land-grid cells around it (see `land.ts`), a farmer, and a grain store holding 0–5 sheaves. Each plot keeps its own state (fallow → growing → ripe) and
  age. To sow, the farmer walks out, sows (2.5 s), then walks back to the farm, and the plot
  grows on its own clock (30 s to ripe). When a plot is ripe and the store has room, he walks
  out, harvests (3 s), carries the sheaf back and stacks it. Harvesting takes priority over
  sowing, and the nearest plot is picked first. A full store stops harvesting.
- `land.ts`: the land grid, tested by `land.test.ts`. The street is cut into 25 px cells in two
  rows: `back` (behind the road, where buildings stand) and `front` (between the road and the
  viewer). A building claims its footprint cells (its `width` rounded up to whole cells, centred on
  the plot) as soon as it is placed. A farm's back fields fill the free cells up to the next
  building on each side (usually one plot per side); its front fields take any front cells within
  `FIELD_REACH` that are nearer to it than to another farm. Placing a building re-lays neighbouring
  farms' fields (`syncFarmFields`); plots that keep their spot keep their crop.
- `layout.ts`: the shared world geometry (see above), including the grid constants.

### `src/render`: graphics
- `index.ts`: the renderer's public API: `renderFrame()` (world pass, then screen UI pass),
  `cameraX()`, and the UI layout/hit-test helpers used for input.
- `scene.ts`: world draw order: backdrop → back fields → farmers in the back field → plot
  markers → buildings → front fields → people → rider → foreground → world-anchored labels.
- `background.ts`: parallax layers: sky and sun, clouds, mountains, the castle on its hill,
  patchwork fields, the distant village, the tree line, the street and the foreground grass.
- `buildings.ts`: "2D picture of a 3D building" primitives (front face, shaded side face, gable
  roof with thatch/tile/slate, timber framing) and `BUILDING_ART`: per building `draw`, optional
  `behind`/`front` art, and the drawn `height`.
- `construction.ts`: generic staged construction for any building: stakes → foundation →
  timber frame → walls → roof. The finished art is revealed bottom-up behind scaffolding.
- `grid.ts`: the land-grid debug overlay (tuning panel → "land grid", or `?grid=1`): cells tinted
  by use (building footprint red, field green), plot boundaries dashed.
- `farm.ts`: field plots in gentle perspective, crops by growth stage, the farmer (walk, sow,
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
- `controls.ts`: keyboard, touch buttons, menu taps, pinch and wheel → actions and zoom.
- `screen.ts`: canvas size, DPR, zoom and touch mode. `viewport.ts`: the pure zoom/scale maths
  (tested). Zoom 1 fits the 600-unit-tall scene to the screen height. Zooming out shows more
  street and sky, and the UI keeps its own scale. On portrait touch screens the scene is lifted
  above the buttons.
- `sound.ts`: synthesised Web Audio effects, no audio files. It reads game state each frame:
  hoofbeats in step with the gait, menu clicks, a thunk when a building is placed and a chime when
  it's done, hammering during construction, each building's everyday sound, and the farmer's
  sowing, scything and stacking. World sounds pan and fade with distance from the rider. M mutes.
- `tuning.ts`: slider panel on the right (horse speed/accel/braking, build speed, volume).
  Non-default values are kept in the URL query.
- `src/main.ts`: bootstrap and the frame loop.

## Rules

- Plots sit every 250 px along a 6400 px street. A plot holds at most one building.
- With construction ON, a building takes its `buildTime` (6–18 s). With it OFF, buildings
  appear finished immediately, and turning it off also finishes anything under construction.

## Not done yet / ideas

- No economy (coins/resources); building is free. Grain isn't used by anything yet, so a farm
  with a full store (5 sheaves) just keeps sowing until every plot is ripe, then waits. A mill
  or market taking grain would be the natural next step.
- No music, no day/night cycle, no save game.
