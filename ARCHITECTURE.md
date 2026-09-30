# Architecture

Vite + TypeScript + Canvas 2D. No engine and no image assets: every building, the
horse, people and the landscape are drawn procedurally in code.

## Layout

- `src/game/buildings.ts`: the building registry (pure data: name, purpose, size, build time).
  Adding a building means adding an entry here plus a draw function in `render/buildings.ts`.
- `src/game/world.ts`: pure game state and logic: plots, building entities, rider physics,
  villagers, build menu, construction progress and stages, and the construction toggle.
  It doesn't use the DOM, and `world.test.ts` covers it.
- `src/game/farm.ts`: farm simulation (pure, covered by `farm.test.ts`). A finished farm has
  4 plots behind the farmstead (either side of the house) and 5 wider ones in front of the road
  (same total width; nearer, so they look bigger), a farmer
  and a grain store holding 0–5 sheaves. Each plot keeps its own state (fallow → growing → ripe)
  and age. The farmer works one plot at a time. To sow, he walks out, sows (2.5 s), then walks
  back to the farm, and the plot grows on its own clock (30 s to ripe). When a plot is ripe and
  the store has room, he walks out, harvests (3 s), carries the sheaf back and stacks it.
  Harvesting takes priority over sowing, and the nearest plot is picked first. A full store stops
  harvesting.
- `src/game/layout.ts`: the vertical layout of the scene (road, ground, 600-unit scene height)
  shared by logic and rendering.
- `src/render/`: everything visual.
  - `background.ts`: parallax layers: sky and sun, clouds, mountains, the castle on its hill,
    patchwork fields, the distant village, the tree line, the street and the foreground grass.
  - `buildings.ts`: the "2D picture of a 3D building" primitives (front face, shaded side face,
    gable roof with thatch/tile/slate texture, timber framing) and one art function per building.
    A building can also provide `behind` art (the farm's wheat field) that is drawn before all buildings.
  - `construction.ts`: generic staged construction for any building: stakes → foundation →
    timber frame → walls → roof. The walls and roof stages reveal the finished art from the
    bottom up, behind scaffolding with builders.
  - `horse.ts`: the monarch on horseback: 4-beat walk and diagonal trot leg cycles driven by
    distance travelled, plus idle breathing, head nods, tail swish and hoof pawing.
  - `farm.ts`: back/front field plots with crops drawn by growth stage (sprouts → green → golden
    → ripe with ears), the farmer (walking, sowing with seed cast, scything, carrying a sheaf,
    drawn larger the closer he is to the viewer) and the sheaf store.
  - `people.ts`: villagers and chickens. `ui.ts`: HUD, build menu, labels, progress bars, toasts.
  - `scene.ts`: draw order and the camera.
- `src/viewport.ts`: zoom and coordinate spaces. Zoom 1 fits the 540-unit-tall scene to the
  screen height, and zooming out shows more street and more sky, with the ground kept at the bottom.
  Screen UI has its own scale, so it isn't affected by zoom. On portrait touch screens the street
  is lifted so the buttons sit on meadow. Covered by `viewport.test.ts`.
- `src/main.ts`: keyboard, pointer input (touch buttons, menu taps, pinch, wheel) and the main loop.
  UI layout functions in `ui.ts` (`hudLayout`, `menuLayout`) return rectangles that are used both
  for drawing and for tap hit-testing.

## Rules

- Plots sit every 250 px along a 6400 px street. A plot holds at most one building.
- With construction ON, a building takes its `buildTime` (6–18 s). With it OFF, buildings
  appear finished immediately, and turning it off also finishes anything under construction.

## Not done yet / ideas

- No economy (coins/resources); building is free. Grain isn't used by anything yet, so a farm
  with a full store (5 sheaves) just keeps sowing until every plot is ripe, then waits. A mill
  or market taking grain would be the natural next step.
- No sound, no day/night cycle, no save game.
