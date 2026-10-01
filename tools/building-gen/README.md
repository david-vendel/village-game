# Building generator (WP4, route P)

Buildings made the way they were built: architecture rules lay out every footing stone,
timber, panel, batten and thatch course of a 13th-14th century Central European building,
and Blender renders them through the [render harness](../art-pipeline/README.md).

```sh
npm run art:render -- tools/building-gen/scenes/farm.py tools/building-gen/scenes/farm.job.json
npm test              # the rules (tests/build3d-*.test.ts)
npm run art:test      # the harness maths (plain Python)
```

| Layer | What |
| --- | --- |
| **The rules** | Live in the game: `src/render/build3d/` (`elements.ts`, `farm.ts`, tested in `tests/build3d-*.test.ts`). The game builds buildings from them in real-time 3D; `elements.ts` here prints them as JSON for Blender. |
| `core/elements.py` | Loads that JSON into `Element`s for the Blender layer (runs Node). |
| `blender/` (needs bpy) | `build.py`: elements → meshes (bevelled timber and boards shared by size, rough fieldstones, the thatch shell, gable boards, the lean-to roof), sorted into the harness's collections, points as empties. `materials.py`: procedural materials (no image textures), varied per element. |
| `scenes/` | Builders for the harness (`build()`) and their render jobs. |

## The farm

Fitted to the game: 10 m wide (`BUILDINGS.farm.width` = 200 u), the door centred on `HOME.dx`,
the grain store's ground (`STORE.dx` ± 1.25 m) in front of the left room kept clear.

- **Foundation:** a fieldstone footing in two courses, a step stone at the door, pad stones under the barn posts.
- **Frame:** oak sills, posts (corners, room/hall, door jambs, bay posts), girts, braces that
  triangulate each plain bay, wall plates, tie beams proud of the walls, rafter pairs at 50°
  (thatch wants 45–55°) with collars; the barn's posts, rails and rafters.
- **Walls:** limewashed wattle-and-daub panels, a plank door, the window with open shutters
  (lamp-lit at night), gable boards; the barn's vertical planks and Z-braced double doors.
  Scaffolding goes up along the front.
- **Roof:** battens, a thatch shell lying on them (gently lumpy), a straw ridge roll, the
  chimney; shingles on the barn.

The **Large farm** adds a bay right of the hall with a second room and window; the lean-to barn
gives up that bay, so the footprint stays 10 m. Elements both looks share are identical, so the
upgrade reveal doesn't jump.

Tests (`tests/build3d-farm.test.ts`) check the footprint and the game's spots, posts on sills carrying the
plates, braces at brace angles, the pitch and rafter pairs, the thatch lying on the battens, that
nothing is built before what it rests on, and the looks and the open-door part.
