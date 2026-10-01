# Blender render harness (WP3)

Turns a 3D scene into game assets that follow [ASSET_SPEC](../../docs/art/ASSET_SPEC.md):
the spec cameras and light, every pass, every look and construction stage, packed and validated.

```sh
npm run art:render -- tools/art-pipeline/fixtures/cube_house.py tools/art-pipeline/fixtures/cube_house.job.json
npm run art:test     # unit tests of the camera/light maths (plain Python)
```

`art:render` runs Blender headless (`render.py`), packs the raw passes (`pack.ts`) into
`public/assets/` (or `--assets <folder>`), merges the asset into its manifest and runs the
validator. Raw renders go to `.art-raw/<id>/` (git-ignored). Then look at `?art=preview`.

Needs Blender 4.5 LTS (`$BLENDER`, else the default install path). Cycles renders on the GPU
with CUDA (on the GTX 1070 CUDA is faster than OptiX). Set `ART_DEVICE=CPU` on a machine
without a GPU.

## How it works

| Step | Where | What |
| --- | --- | --- |
| Camera and light | `harness/rig.py` (pure Python, tested) | Orthographic camera per view (§3: yaw/pitch about the model origin, no roll). Key sun fixed in camera space: from the left, 35° up, 4300 K, 2° wide; fill 9000 K from above-right plus a sky, key:fill 3:1 (§4). The frame: the smallest whole-unit rectangle holding every look, stage and part of the view **and their ground shadows**, plus a 2 u margin, so all images of a view share size and anchor. |
| Exposure | `calibrate.py` | Renders limewash plaster square to the sun and finds the exposure that puts it at sRGB 230 (§4: 225–235): −0.37 with the Standard view transform. AgX needs about 3 stops more and washes colours out, so the harness uses Standard. |
| Render | `harness/blender_render.py` | Per image: colour (Cycles, transparent film, colour-managed 16-bit PNG, lights off) and data passes written as float EXR by the compositor, converted with numpy and saved as `.npy`: view-space normals, depth (u towards the camera from the anchor plane), AO, albedo, the ground shadow (shadow-catcher pass) and the `mask` AOV. A second, cheap render with the lights on gives the emissive layer. |
| Pack | `pack.ts` | @4x is the render; @2x is box-filtered from it (colour premultiplied, data passes weighted by coverage, normals renormalised). Colour gets 6 px of alpha bleed. Encodings per §6/§9: colour, albedo, emissive lossy WebP q90; shadow, normal, AO, mask lossless WebP; depth 16-bit PNG with its `depthRange`. Writes the manifest entry. |
| Validate | `tools/assets/validate.ts` | ASSET_SPEC §12, including the light-direction check (colour shading against normals and the key). |

## The scene contract

A scene is a `.blend` file or a Python builder with a `build()` function that makes it from an
empty file (see `fixtures/cube_house.py`). Model space is metres (20 u = 1 m), +Z up, **the
front faces −Y**, and the origin is the centre of the front wall on the ground (§3). The
ground plane, camera and lights are the harness's own: don't add them.

| Element | Meaning |
| --- | --- |
| Collection `Asset` | Everything rendered. Child collections tag what they hold (tags nest; Blender's `.001` suffixes are ignored): |
| `stage:<stage>` | Built during that stage (`staking`, `foundation`, `frame`, `walls`, `roof`): all five or none. Stage image *k* shows stages 0…*k*. No stage collections → `construction: reveal`. |
| `scaffold` | Stage images only (scaffolding, stakes). Inside a `stage:` collection it goes up in that stage. |
| `variant:<name>` / `novariant:<name>` | Only in / hidden in that look (`upgraded` is the Large farm). |
| `part:<name>` | A separately drawn part, rendered alone in the body's frame. Needs an empty `pivot:<name>`. Today: `doorOpen`, shown while someone steps through the door. |
| Empty `point:<name>` | A named point: `door` (bottom centre of the doorway, on the ground), `smoke:<i>` (chimney tops), `sleep:<i>`, `window:<i>`, … |
| Node group `Lights` | Materials that light up at night multiply their emission by its output. The harness sets it to 0 for the daylight passes and 1 for the emissive render. |

The job file (JSON) names the asset and how to render it:

```json
{ "id": "building.farm", "views": ["street", "roadsideL", "roadsideR"], "samples": 128 }
```

Optional: `out`, `tier` (4), `emissive_samples` (32), `exposure` (−0.37), `view_transform` (`Standard`),
`look`, `sun_strength`, `margin` (2), `device`, `source` (copied into the manifest).
