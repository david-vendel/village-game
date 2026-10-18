# Decisions made

- **2026-10-03: The director is Claude, in the session.** It reads and writes this folder. The
  state is kept in plain files, so another model (for example GPT-6 Astra) can review it at
  checkpoints.
- **2026-10-03: The asset is the game's procedural model, not a fixed Blender mesh.**
  - It must keep the construction stages, opening doors, lights and smoke, the exact footprint and
    the Large farm look.
  - Blender renders it, for comparison only.
- **2026-10-03: FLUX paints the textures.**
  - It uses the oil LoRA that worked best (dtthanh, at 0.8).
  - It runs on a rented AWS g5.2xlarge, with a budget of up to $5.
  - `npm run paint:tile` makes the results seamless.
- **2026-10-03: The reference is showroom #8** (`flux1.png`). It stays local, in `.art-raw`.
- **2026-10-03: Geometry first, textures after.** Most of what is wrong is shape (roof, chimney,
  arches, jetty), which textures can't fix. The GPU is rented once the shape is right.
