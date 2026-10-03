# Village Crown: notes for agents

Read ARCHITECTURE.md for how the game is put together. Things waiting on the human are in `Human TODO.md`: add to it when you need a decision or an action only they can take.

## Graphics and mechanics

Two lines of work run side by side. To keep merges painless, each one has its own files.

**Advanced graphics** is the work on the game's look: 3D buildings and their styles, painted
textures, the showroom of art tests, building numbers. It sits behind one switch in the Menu,
"Advanced graphics", which is **off by default**. With it off, the game is the base game with its
2D art. You can also set it from the address: `?gfx=1` or `?gfx=0`.

- **Game mechanics work** (on `main`): keep advanced graphics off. Don't edit the graphics files
  below. If a mechanic needs something new drawn, draw it in 2D in the base render files.
- **Graphics work** (on the `graphics` branch, merged into `main` often): stay inside the graphics
  files. When a base file must change, keep it to a call into a graphics file, so its lines rarely
  clash with mechanics work.

Graphics files:
- `src/app/graphics.ts`: the switch, its Menu rows, the V key, preferences.
- `src/render/scene3d.ts`: everything advanced graphics draws in a frame. `scene.ts` calls it at
  fixed points.
- `src/render/build3d/**`, `world3d.ts`, `life3d.ts`, `gallery3d.ts`, `showroom.ts`, `stages.ts` (with `stages.html`).
- `tools/paint/**`, `tools/building-gen/**`, `public/textures/**`.

Shared by both (edit with care, and keep changes small): `src/render/scene.ts`,
`src/render/sky.ts`, `src/render/background.ts`, `src/game/hearth.ts`, `src/game/layout.ts`.

The repo is public: never commit `public/showroom/` or `.art-raw/`. Both are gitignored, and some
of that art comes from screenshots of other games.

## Committing

When a piece of work is done and `npm test` and `npm run typecheck` pass, commit it to `main`
yourself, without asking. Don't push unless asked.

## Saves

The game is in development: old saves are not supported. A save format change bumps
`SAVE_VERSION` in `src/game/save.ts` and older saves are simply refused. Never write migrations or
compatibility code for them.

## Tools for agents (Windows machine)

Check here first instead of searching. All of these are already installed:

| Need | Use |
| --- | --- |
| Screenshot the game or any page | `npm run shot -- "?scenario=showcase&gfx=0" --out shot.png` (tools/screenshot.ts: headless Edge over the DevTools protocol, starts and stops the dev server itself). Options: `--wait <ms>`, `--size 1600x900`, `--keys d:1500` (hold keys: d/a ride), `--port`. Then Read the PNG. Pages: `stages.html?type=sawmill` (a building stage by stage, 2D and 3D), `?view=3d` (3D gallery), `?art=preview` (sprites). |
| Put the game in a given state for a shot | a scenario: write `tests/scenarios/<name>.scn` (commands in `src/sim/scenario.ts`, e.g. `build sawmill at s0:112`, `ride s0:113`), open `?scenario=<name>`; delete it after if it was only for looking |
| Play the game headless, as text | `npm run sim -- tests/scenarios/<file>.scn` (map, building list, stock, invariants) |
| Tests / types / build | `npm test`, `npm run typecheck`, `npm run build`; update scenario snapshots with `npx vitest run tests/scenarios.test.ts -u` |
| Draw a canvas in Node without a browser | `@napi-rs/canvas` (dev dependency); images: `sharp` |
| 3D / Blender work | Blender 4.5 in `C:/Program Files/Blender Foundation/` (not on PATH) |
| Other CLIs | `node` 22 (has `fetch` and `WebSocket`), `gh`, `python` (not `python3`), `rg`, `git`. Not installed: `jq`, ImageMagick, ffmpeg (use `node -e` or `sharp`) |

Shells: the Bash tool is Git Bash; PowerShell 5.1 is there too (no `&&`). A dev server started in
the background can outlive its task: free a port with
`Get-NetTCPConnection -LocalPort <port>` and stop its owning process.
