# Village Crown: notes for agents

Read ARCHITECTURE.md for how the game is put together.

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
- `src/render/build3d/**`, `world3d.ts`, `life3d.ts`, `gallery3d.ts`, `showroom.ts`.
- `tools/paint/**`, `tools/building-gen/**`, `public/textures/**`.

Shared by both (edit with care, and keep changes small): `src/render/scene.ts`,
`src/render/sky.ts`, `src/render/background.ts`, `src/game/hearth.ts`, `src/game/layout.ts`.

The repo is public: never commit `public/showroom/` or `.art-raw/`. Both are gitignored, and some
of that art comes from screenshots of other games.
