# 3D assets: one building at a time

Each folder here is one building being made into a finished 3D asset, with its whole project
state. The model itself is always the game's own procedural generator (`src/render/build3d`), so
the asset keeps its construction stages, opening doors, lights, smoke and exact footprint.

```
assets3d/<id>/
├── asset.json        which game building (type, seed, size, look), the reference, the generator files
├── spec.md           building specification: what it is, read from the reference
├── geometry.md       geometry rules: proportions, parts, how they are built, the game's constraints
├── materials.md      materials plan: surfaces, colours, weathering
├── textures.json     texture requirements: name, use, FLUX prompt (painted, made tileable)
├── problems.md       current problems (what is wrong in the latest screenshot)
├── decisions.md      decisions made, and why
├── failed.md         failed experiments, and why they failed
├── screenshots/      the model from the reference's angle, every round (dated)
├── changes.md        code changes: generated from git
└── STATE.md          everything above in one file: generated, to hand to a reviewer
```

## A round of work

1. **Plan** (the director): read `STATE.md`; pick the worst problem in `problems.md`.
2. **Geometry**: change the generator (`src/render/build3d/<type>.ts`, shared parts in `kit/`).
   `npm test` keeps the game's rules (footprint, headroom, stages, doors).
3. **Materials and textures**: change `materials.ts`, or paint what `npm run asset -- <id> textures`
   lists (FLUX on the rented GPU, then `npm run paint:tile`; see `tools/paint/README.md`).
4. **Look**: `npm run asset -- <id> shots` renders the model in Blender from the reference's angle
   and puts it beside the reference (`.art-raw/asset/<id>/compare-*.png`, local; the model alone
   goes in `screenshots/`).
5. **Record**: update `problems.md`, add to `decisions.md` or `failed.md`, then
   `npm run asset -- <id> status` to rewrite `changes.md` and `STATE.md`.

References stay local in `.art-raw/` (gitignored), because this repo is public.
