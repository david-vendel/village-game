# Painting the buildings (route P + paint-over)

The look we're after is a painting: warm golden light, cream plaster between dark timbers,
honey stone, ivy, soft brushwork (the target pictures in docs/art). Real-time 3D can't get there,
so the buildings are **painted pictures** made from our own models:

1. **Model** (the game, `src/render/build3d`): every building, stage, look and size, generated.
2. **Render** (this PC, Blender 4.5 + the harness): `scenes/building.py` builds exactly the game's
   meshes; Cycles renders colour plus depth, normals, AO, the ground shadow and the night
   lights, for every view and construction stage.
   ```sh
   BUILDING=house SEED=31 STYLE=painterly npm run art:render -- tools/building-gen/scenes/building.py tools/building-gen/scenes/building.job.json
   ```
3. **Paint** (a rented GPU running ComfyUI): `npm run paint` repaints each render with an SDXL
   painter (DreamShaper XL), its shape held by ControlNet (the render's depth, and lines found in
   it), a few seeds each. Once one painting is approved it becomes the **style anchor**
   (IP-Adapter, `--anchor`), so every building after it is painted in the same hand. The painting
   is cut back out with the render's exact outline, so stages and looks line up.
   ```sh
   npm run paint -- .art-raw/building.house --server https://<pod>-8188.proxy.runpod.net --look painted --seeds 4
   npm run paint -- .art-raw/building.house --dry   # just the prepared inputs, no server
   ```
   Looks (`tools/paint/workflows.ts`): `painted` (the reference painting) and `kingdom` (flat 2D
   game art, then pixels, as in Kingdom Two Crowns). `--mode repaint` paints from scratch
   (freer) instead of over the render.
4. **Choose and pack**: pick a seed per image from `sheet.png` (the render, then the paintings);
   the chosen ones become sprite assets (ASSET_SPEC, `public/assets/`), which the game already
   draws in place of the procedural art.

## The GPU: RunPod (rented by the hour)

This PC's disk has no room for the models, and its 8 GB card is slow for SDXL with two
ControlNets. A rented GPU keeps the models on its own volume:

1. Make an account at runpod.io and add credit ($10 goes a long way: see below).
2. **Storage → Network volume**: 40 GB in a datacenter that has RTX 4090 or A40 cards
   (about $3 a month while it exists; delete it when done).
3. **Pods → Deploy**: an RTX 4090 (24 GB, about $0.35–0.70 an hour) or A40 (48 GB) with the
   template "RunPod PyTorch 2.x", the network volume attached at `/workspace`, and HTTP port
   **8188** exposed.
4. Open the pod's web terminal and run (first time ~10 minutes of downloads; later seconds):
   ```sh
   curl -sL https://raw.githubusercontent.com/<you>/village-game/main/tools/paint/pod-setup.sh -o pod-setup.sh  # or paste the file
   bash pod-setup.sh
   ```
5. Its ComfyUI address is `https://<pod id>-8188.proxy.runpod.net`; pass it as `--server` (or
   `COMFY_URL`). **Stop the pod when not painting** (billing is per second; the volume keeps the
   models).

Cost: one painting takes 5–15 s on a 4090. The whole village (13 types × a few sizes × 6
stage/look images × 4 seeds, plus the roadside views) is roughly 1,500 paintings: about 3–6 GPU
hours, a few dollars, plus the volume.

## Licences

DreamShaper XL and SDXL base: CreativeML OpenRAIL++-M. ControlNet union (xinsir) and
IP-Adapter (h94): Apache-2.0. The style anchor is always one of our own approved paintings,
never someone else's art (docs/art/PLAN.md, legal guardrails).

## Notes from the runs (2026-10)

- AWS g5.xlarge (A10G 24 GB, 16 GB RAM): add 24 GB of swap and `vm.overcommit_memory=1` before loading FLUX (its 17 GB file won't map otherwise). Plain FLUX: ~45 s a painting. FLUX + a LoRA: ~3.5 min a painting, because with 16 GB of RAM the model is reloaded and re-patched for every one. Use a **g5.2xlarge** (32 GB RAM) for LoRA batches.
- Painted textures (`npm run paint:tile -- <png> <name>`): plaster, oak, planks, stone, tile, thatch and bricks are made. Shingle, slate, earth and bark are still to do (the run timed out).
