# Architecture

Vite + TypeScript + Canvas 2D. No engine and no image assets: every building, the
horse, people and the landscape are drawn procedurally in code.

## Layout

- `src/game/buildings.ts`: the building registry (pure data: name, purpose, size, build time).
  Adding a building means adding an entry here plus a draw function in `render/buildings.ts`.
- `src/game/world.ts`: pure game state and logic: plots, building entities, rider physics,
  villagers, build menu, construction progress and stages, and the construction toggle.
  It doesn't use the DOM, and `world.test.ts` covers it.
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
  - `people.ts`: villagers and chickens. `ui.ts`: HUD, build menu, labels, progress bars, toasts.
  - `scene.ts`: draw order and the camera.
- `src/main.ts`: canvas sizing (logical height 540, any width), keyboard input, the main loop.

## Rules

- Plots sit every 250 px along a 6400 px street. A plot holds at most one building.
- With construction ON, a building takes its `buildTime` (6–18 s). With it OFF, buildings
  appear finished immediately, and turning it off also finishes anything under construction.

## Not done yet / ideas

- No economy (coins/resources); building is free.
- No sound, no day/night cycle, no save game, no touch controls.
