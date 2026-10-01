# Realistic art for Village Crown: research and plan

Status: **plan only**. Nothing here is implemented yet. It is written to be split
into work packages (WP1–WP10 below) and handed to separate agents.
The format every asset must be delivered in is [`ASSET_SPEC.md`](ASSET_SPEC.md).

**Goal:** move from today's procedural vector art to images that look close to real,
or at least to the painterly realism of the *Age of Empires II* main-menu village
scene (warm late-afternoon light, believable materials, a castle on a hill). The
game's mechanics must stay unchanged: every person, load and building state the
simulation tracks must still be visible and animated.

---

## 1. What has to be drawn (inventory from the code, Oct 2026)

| Group | Items | States / animation the game needs |
| --- | --- | --- |
| Buildings (14) | warehouse (storage yard), house, farm (+ *Large farm* upgrade), mill, bakery, blacksmith, market, chapel, tavern, watchtower, well, woodcutter's hut, stonecutter's hut, crossroads | construction stages; per-building motion (mill sails, forge glow, chapel bell, smoke, flags, well bucket); lit windows at night; **two view directions**: along the street, and receding up a side road at a crossroads |
| Stored goods | wood, stone, grain (sheaf), flour (sack), bread (basket) | each item drawn at an exact slot from `game/layout.ts`, one sprite per unit |
| People | looks: peasant, woman, monk; trades: farmer, builder, miller, baker, woodcutter, stonecutter, serf (+ untrained) | idle, walk, walk carrying (sack / basket / log / stone / sheaf / tool), sow, scythe, hammer, chop, quarry, oven peel, door in/out; per-person colour variety |
| Rider | the king on horseback | idle, walk, trot; gait driven by distance (`STRIDE` = 48 units per cycle) |
| Animals | chickens | walk, peck |
| Nature | trees (growth, being felled, stump), two quarries (depletion) | felling progress, regrowth |
| Fields | farm plots per land-grid cell | grass, tilled, sown, sprouting, green, golden, ripe, stubble |
| Backdrop | sky (procedural, keep), clouds, mountains, castle on its hill, far hills with fields, distant village, tree line, street + verge, foreground grass, side road | parallax (factors 0.05 to 1.2), day/night via `render/sky.ts` |

Constraints that shape everything:
- **The camera scrolls sideways.** Each object is drawn as a separate image placed by the game.
  It is not one big painting.
- **The ground has one-point perspective** (`render/ground.ts`): characters scale with depth,
  and buildings are drawn at true size on the building line.
- **The sun moves across the sky during the day, and there is night** (`render/sky.ts`).
  Baked lighting has to read well across that range.
- **It's a web game, including on phones.** That sets a download and memory budget
  (see ASSET_SPEC §10).

---

## 2. What the research says

### The core insight: AoE2 itself was made from pre-rendered 3D
AoE2's buildings and units are 2D sprites rendered from fairly detailed 3D models
during development ([gamedev.net](https://www.gamedev.net/forums/topic/545595-is-age-of-empires-ii-3d-or-2d/),
[Steam discussion](https://steamcommunity.com/app/813780/discussions/0/3124912800518801062/)). That is
still the most reliable way to get a consistent look across hundreds of images.
Every asset shares one camera, one light and one scale, and you get depth, normals,
shadows, construction stages and animation frames for free. What's new in 2026 is that
**AI can now produce the 3D models and textures**, which used to be the expensive part.

### State of the tools (verify versions and licences when starting)

| Need | Best candidates (2025–26) | Notes |
| --- | --- | --- |
| Image → textured 3D mesh | **TRELLIS.2** (Microsoft, 4B, MIT, Dec 2025, full PBR) ([project](https://microsoft.github.io/TRELLIS.2/)); Hunyuan3D 2.1 (best open PBR texturing, fine-tunable) ([paper](https://arxiv.org/pdf/2501.12202)) | ⚠️ **Hunyuan3D's licence excludes the EU, UK and South Korea** ([licence](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE)) and forbids using outputs to train other models. **Use TRELLIS.2 as the default.** Comparisons: [triposr.org](https://triposr.org/blog/hunyuan3d-vs-trellis), [cinevva](https://app.cinevva.com/guides/ai-3d-model-generators) |
| Real buildings → 3D | Gaussian splatting from phone or drone video → mesh ([GS4Buildings](https://arxiv.org/pdf/2508.07355), [SF-Recon](https://arxiv.org/pdf/2511.13278), SuGaR) | For "take pictures of real villages": walk around a real building filming it, reconstruct it, then render it with our camera |
| Image generation and editing with consistent style | FLUX.2 (up to 10 reference images); FLUX.1 Kontext (precise iterative edits); Qwen-Image-Edit-2511 (less drift, LoRA support); Nano Banana 2 (likeness) ([comparison](https://ghost.oxen.ai/fine-tuned-qwen-image-edit-vs-nano-banana-and-flux-kontext-dev/), [multi-reference](https://linocut.ai/blogs/multi-reference-ai-image-models/), [QwenStyle](https://arxiv.org/html/2601.06202v1)) | ⚠️ FLUX.2 [dev] and [klein] 9B are **non-commercial**; FLUX.2 [klein] **4B is Apache-2.0** ([HF](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)). Qwen-Image is Apache-2.0. Paid APIs include commercial output rights |
| Cut-outs (alpha) | **SAM 3** (text-prompted segmentation, Nov 2025; [paper](https://arxiv.org/pdf/2511.16719)), BiRefNet / RMBG for fine matting | Mostly unneeded on the 3D path (the renderer gives exact alpha). Needed for photo and 2D-generated assets |
| Split an image into layers | **Qwen-Image-Layered** (RGBA layer decomposition, CVPR 2026; [paper](https://openaccess.thecvf.com/content/CVPR2026/papers/Yin_Qwen-Image-Layered_Towards_Inherent_Editability_via_Layer_Decomposition_CVPR_2026_paper.pdf)) | Splits a backdrop painting into parallax layers. Hidden areas are invented, so review them |
| Depth / normals / albedo from one image | **Marigold V2** (depth, normals, albedo; [paper](https://arxiv.org/pdf/2609.08084), [code](https://github.com/huawei-bayerlab/marigold-v2)), Depth Anything 3 | Normal and albedo maps for 2D-made assets so they can be relit |
| Relighting | IC-Light and successors (PI-Light [paper](https://arxiv.org/html/2601.22135.pdf), PractiLight [paper](https://arxiv.org/pdf/2509.01837), IDArb for intrinsics [paper](https://arxiv.org/html/2412.12083v3)) | Day/dusk/night variants of 2D-made assets. On the 3D path, just re-render instead |
| Auto-rigging | **UniRig** (SIGGRAPH 2025, MIT, humans and quadrupeds) and others; Mixamo-style libraries ([overview](https://app.cinevva.com/guides/free-character-animations-rigging)) | Rig generated villagers and the horse, then retarget library or mocap motions |
| Animation from video models | **Wan 2.2** (Apache-2.0, image→video, pose/depth control; [repo](https://github.com/Wan-Video/Wan2.2)); commercial: Veo, Kling | Use for motions a library lacks. Keeping identity and lighting consistent is harder than rendering a rig |
| AI sprite-sheet services | Ludo, Scenario, AutoSprite and others ([Scenario](https://www.scenario.com/blog/ai-sprite-generator), [Ludo](https://ludo.ai/tools/sprite-animation)) | Fine for stylised or pixel art. Not recommended as the main route for this realistic look |
| Runtime 2D lighting | PixiJS v8 + normal maps ([pixijs-light2d](https://github.com/haiyoucuv/pixijs-light2d)) | For the optional WebGL tier (WP9) |

### Approaches compared

| Approach | How | Consistency (camera, light, scale) | Animation and construction | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Photo or prompt → 2D image directly** | Restyle photos, or generate at the spec camera with style references | Medium. Drifts between images. Light direction and perspective have to be policed | Weak. Every frame or stage is a new generation | Low per asset | Use for **backdrops, ground, crops, items** |
| **B. Photo or prompt → 3D → render (AoE2 method)** | TRELLIS.2 or splatting → Blender cleanup → scripted render with fixed camera and light | **High by construction** | **Strong.** Stages come from cutting the model, animation from rigs. Exact anchors | Medium. Needs a render harness | Use for **buildings, people, horse, props** |
| **C. Video model → frames** | Wan 2.2 with pose control → loop extraction → matting | Low to medium | Good for organic motion, poor for exact sync points | Medium | Fallback for **missing motions** |
| **B + polish** | B, then a light diffusion pass guided by depth and normals to add photographic detail and unify style | High, if the silhouette is locked | Same as B | +20% | **Default for hero assets** |

**Recommendation:** a hybrid, anchored on B.
- B (with the optional polish pass) for everything that stands, moves or changes state.
- A for backdrops, ground and small static items.
- C only for gaps.

All of it goes through one asset format (ASSET_SPEC.md), so the game doesn't care how
an asset was made.

### Using real village photos
- **Real buildings:** film a walk-around (60–200 frames) and reconstruct with Gaussian
  splatting, then convert to a mesh, or feed 1–4 good photos to TRELLIS.2. Clean up in
  Blender and render with our camera.
- **Single photos:** use as reference images for generating concept art at our camera,
  then go through route B.
- **Panoramas** (hills, fields, distant villages): restyle with route A, then split into
  layers.
- **Keep provenance.** Every source photo gets a recorded licence (own photo, CC0, CC-BY
  with attribution). The manifest's `source` field carries it.

### Legal guardrails
- **The AoE2 menu screenshot is a mood reference only.** We describe its qualities (light,
  palette, composition) in the style bible. **Never** use AoE2 art as an img2img input,
  never train a LoRA on it, and never put it in a reference set that gets copied from.
  Style LoRAs train only on **our own approved outputs**.
- **Check each model's licence before use.** TRELLIS.2 is MIT; Qwen-Image is Apache-2.0;
  FLUX.2 klein 4B is Apache-2.0; Wan 2.2 is Apache-2.0. FLUX.2 dev and klein 9B are
  non-commercial, which is allowed since this is a non-commercial project (§5). Hunyuan3D
  excludes the EU, so it's out. Record the model and version per asset in the manifest.

---

## 3. Pipeline (target)

```
references ──► style bible + style anchors (approved hero images)
                    │
       ┌────────────┼──────────────────────────────┐
       ▼            ▼                              ▼
  BUILDINGS/PROPS  PEOPLE / HORSE                BACKDROPS / GROUND / ITEMS
  concept image    concept per trade (front+side)  generate at spec camera
  (photo-guided)   → image→3D → UniRig            (multi-reference, style LoRA)
  → image→3D       → retarget motions             → Qwen-Image-Layered / depth split
  or splat→mesh    (library / mocap / Wan 2.2)    → inpaint disocclusions, make tileable
  → Blender clean  → Blender render: frames,      → Marigold V2 normals (optional)
  → Blender render   both facings, passes,
    (all passes,     anchors from bones
    stages, views)
       │  optional polish pass (depth+normal guided, silhouette locked)
       └────────────┴──────────────┬───────────────┘
                                   ▼
                 pack: px tiers, atlases, WebP/AVIF, manifest.json
                                   ▼
                 validate (schema + image checks) ► preview page ► human approval
                                   ▼
                 public/assets/ in the game repo (procedural art stays as fallback)
```

**Render harness (Blender, headless, scripted).** This is the backbone of route B.
- Fixed camera rigs and a fixed sun rig, as defined in ASSET_SPEC §3–4.
- Outputs every pass the spec lists: colour, albedo, normal, AO, emissive, shadow,
  depth and mask.
- Cuts construction stages with clip planes, or toggles stage collections.
- Renders animation frames for each clip and facing.
- Exports anchors (door, chimney, hands, feet) from named empties and bones, into the manifest.

**Automated quality gates** (fail the asset; don't rely on taste alone):
- Size, alpha and anchors match the spec. Ground contact: the lowest opaque row sits at the anchor.
- Scale: height in metres is within the expected range for its type (a house eave at 3–4 m;
  a person is 1.6–1.85 m).
- **Light direction:** the colour pass correlates with the spec's sun vector against the
  normal pass. Catches mirrored or relit images.
- Camera: vertical edges are vertical, and the horizon/pitch is consistent (line detection).
- Palette: mean colour and contrast stay within the style bible's bounds.
- Clean edges: no halos. Alpha is sharp where the spec says it should be.
- Animation loops: the first and last frame differ by less than a threshold. Anchors move
  smoothly. Feet stay planted during contact frames.
- If a polish pass is used, the silhouette must still match the original (IoU ≥ 0.98).

---

## 4. Work packages (for separate agents)

Each package is independent unless it says otherwise. Each has a definition of done.

**WP1 Style bible and references** *(needs the user's AoE2 screenshot and any real photos)*
- Write `docs/art/STYLE.md`:
  - light: time of day, sun elevation and azimuth, colour temperature, shadow softness
  - palette: Lab ranges per material
  - materials: thatch, oak, plaster, limestone, slate, clay tile
  - level of detail at game zoom
  - era and region: 13th–14th c. Central European village
- Make 6–10 **style anchor** images at the spec camera (route A, multi-reference), approved by the user.
- Store references and their licences outside git, or in LFS.
- *Done when:* the user signs off on the anchors.

**WP2 Runtime support for assets, tier A (Canvas 2D)** *(game code only; can start now)*
- `src/render/assets.ts`: load the manifest, pick a px tier by DPR and zoom, decode
  images, provide a `drawAsset(...)` API with anchors, parts, clips and mirroring rules.
- Hook `BUILDING_ART`, figures, the horse, items, nature and backdrop layers so that each
  uses a sprite **if the manifest has one, otherwise the current procedural art**. This
  allows gradual replacement.
- Night: draw the `emissive` layer after the land tint (additive). Draw the shadow layer
  under the sprite.
- `npm run assets:check`: validate the schema plus image checks.
- A `?art=preview` contact-sheet page.
- **Bootstrap test:** export today's procedural art into the asset format (a script renders
  it to PNG and writes the manifest). This proves the format and loader end to end before
  any AI work.
- Keep `tests/architecture.test.ts` passing: assets are a render concern, and loading never
  touches game state.
- *Done when:* the game runs identically on exported placeholder assets, the validator is in
  CI, and an asset with errors is rejected with a clear message.

**WP3 Blender render harness** *(tooling, separate from the game: `tools/art-pipeline/`)*
- Python, headless Blender 4.x.
- Camera and light rigs exactly per ASSET_SPEC §3–4.
- All passes, stage cutting, clip and frame rendering for both facings, anchor export,
  packing to the spec, manifest writing.
- *Done when:* a test cube house and a test mannequin go in, valid assets come out, and they
  appear in the game.

**WP4 Building pipeline: pilot, then all**
- Pilot: the **farm**, including the *Large farm* variant, construction stages and the
  side-road view.
- Concept image (from a real farmstead photo or the style anchors) → TRELLIS.2 → Blender cleanup
  (scale, origin, door/chimney empties, separate parts such as mill sails) → harness → polish
  pass → review.
- Then the other 13 buildings.
- *Done when:* each passes the gates and the user approves it in game at zoom 1 and 0.45, by day and by night.

**WP5 People**
- Pilot the **farmer**: idle, walk, walk carrying a sack, sow, scythe, door in/out.
- One base body per look (peasant, woman, monk) → UniRig → clips retargeted from a library
  or mocap; Wan 2.2 only for missing motions.
- Outfits as separate meshes, with recolour masks per the spec, so seeds still vary clothes.
- Then the other trades and carry types.
- *Done when:* the farmer works a full sow/harvest cycle in game with feet planted and the
  load in hand, and the sound-sync events land.

**WP6 Horse and king**
- Walk, trot and idle, distance-driven to match `STRIDE`. The king's cloak as a part or baked in.
- *Done when:* gait and hoofbeat sounds line up at all speeds.

**WP7 Backdrops**
- Mountains, the castle on its hill (a hero 3D asset through route B), far hills with fields,
  the distant village, the tree line, foreground grass, clouds.
- Route A → layer split → tileable strips per spec §8. Keep the sky procedural.
- *Done when:* parallax scrolls with no visible seams across 3 tiles, and the scene reads by
  day and at night.

**WP8 Ground, fields, items, nature**
- Road and verge strips; field cell tiles for every growth state; item sprites (log, stone,
  sheaf, flour sack, bread basket, plus carried versions); trees with felling stages; quarries
  with depletion stages; chickens.
- *Done when:* everything the simulation shows has an asset and fits its layout slot.

**WP9 Renderer tier B (WebGL, optional, after tier A ships)**
- PixiJS v8 (or a hand-rolled WebGL2 renderer) behind the same `renderFrame` API.
- Normal-mapped lighting driven by `lightAt(world)`, so shading follows the sun during the
  day and lanterns at night. Cast shadows skew with the sun. Texture atlases, KTX2/Basis compression.
- *Done when:* 60 fps on a mid-range phone with the full village, and visual parity or better
  against tier A.

**WP10 Style consistency at scale**
- After about 30 approved assets, train a style LoRA on **our own approved outputs** (for the
  polish pass and route A).
- Re-run the gates across the whole set and fix outliers.
- *Done when:* a blind review can't tell which assets were made first.

**Suggested order:** WP1 + WP2 + WP3 in parallel → WP4 and WP5 pilots → user review →
the rest of WP4–WP8 in parallel → WP10 → WP9.

---

## 5. Decisions so far, and hardware

**Decided by the user (2026-10-01):**
- **Non-commercial project.** Non-commercial model licences are therefore allowed: FLUX.2 [dev],
  FLUX.2 [klein] 9B. Record the licence per asset anyway (`source.models`). If the game ever
  goes commercial, assets made with non-commercial models must be remade, and the manifest says which.
- **Hunyuan3D stays excluded.** Its licence excludes the EU, UK and South Korea by territory,
  whatever the use. **TRELLIS.2 (MIT) is the 3D model.**
- **Generation runs on the user's own computer** (local GPU), not rented cloud GPUs.
  Tooling must use ComfyUI or plain Python with quantised (GGUF/FP8) weights where needed, and
  run one model at a time (load, run batch, unload).

**Graphics memory (VRAM) needed per tool, as reported for 2026 builds.** System RAM: 32 GB is
workable, 64 GB comfortable (offloading spills into it). Disk: ~150–250 GB for models and caches.
NVIDIA (CUDA) is strongly preferred; Apple Silicon works for some tools via community ports, slower.

| Tool | 8 GB | 12 GB | 16 GB | 24 GB+ |
| --- | --- | --- | --- | --- |
| TRELLIS.2 (image → 3D) | no | 512³ only, tight | 512³–1024³ (peak ~6.4 GB at 1024 res; officially "24 GB+") | ✔ (official minimum) |
| FLUX.2 [klein] 4B (generate/edit) | ✔ FP8 / GGUF | ✔ | ✔ | ✔ |
| FLUX.2 [klein] 9B | INT4 only | ✔ FP8 (~10 GB) | ✔ | ✔ |
| FLUX.2 [dev] 32B (best quality, multi-reference) | no | no | GGUF Q3/Q2 + offload, slow | ✔ GGUF Q4 (~19 GB) |
| Qwen-Image-Edit-2511 | Q2 (low quality) | ✔ GGUF Q4_0 (~12 GB) | ✔ Q4_K_M/Q5 (~13–14 GB) | ✔ FP8 (~20 GB) |
| Wan 2.2 14B image→video (fallback animation) | GGUF + speed LoRA, slow | ✔ GGUF | ✔ GGUF Q5/Q6 | ✔ |
| SAM 3, Marigold V2, UniRig, matting | ✔ | ✔ | ✔ | ✔ |
| Blender render harness (Cycles GPU) | ✔ (small scenes) | ✔ | ✔ | ✔ |

So: **16 GB covers the whole pipeline** (with FLUX.2 klein 9B or Qwen-Image-Edit as the image
model instead of FLUX.2 dev). **24 GB** adds FLUX.2 dev and full-resolution TRELLIS.2. **12 GB** works with
smaller quants and lower 3D resolution. Below 12 GB, use the 4B image model and expect to
rent a GPU for TRELLIS.2.

Sources: [TRELLIS.2 model card](https://huggingface.co/microsoft/TRELLIS.2-4B), [TRELLIS.2 run report](https://medium.com/@ammanakhtar8/one-image-in-3d-out-free-open-source-i-ran-trellis-2-3f7f5ed8e96c),
[FLUX.2 dev VRAM](https://willitrunai.com/image-models/flux-2-dev), [FLUX.2 klein VRAM](https://willitrunai.com/blog/flux-2-klein-9b-vram-requirements),
[Qwen-Image-Edit-2511 VRAM](https://lilting.ch/en/articles/qwen-image-edit-2511-local-specs), [Wan 2.2 low VRAM](https://www.runflow.io/blog/comfyui-wan-2-2-image-to-video).

Other notes:
- The pipeline lives in `tools/art-pipeline/`. Large sources (references, .blend files, meshes)
  stay out of git (LFS or local storage); only packed outputs go in `public/assets/`.
- **This EC2 box is not for generation.** It runs the game, the validator and small Blender renders.
- Rough scale: about 1–3k rendered frames in total. The expensive part is human review,
  hence the automated gates.

## 6. Risks
| Risk | Mitigation |
| --- | --- |
| Style drift between assets | Everything goes through one camera and light rig; style anchors; LoRA on our own outputs; automated palette and light gates |
| "Uncanny" realism clashing with game readability | Style bible sets a target of "painterly realism" (AoE2 menu), not photographs. Check readability at zoom 0.45 on a phone |
| Generated 3D mesh quality (melted details) | Pick the best of several generations; Blender cleanup; polish pass for surface detail; hand-model hero pieces if needed |
| Character animation quality | Rig + library/mocap first; video model only as fallback; foot-plant gate |
| Download size on mobile | px tiers, lazy loading per street, atlases, AVIF/WebP, budget in spec §10 |
| Licences | Licence table above; per-asset provenance in the manifest; no AoE2 inputs |
| Lighting mismatch with the moving sun and night | Tier A: neutral late-afternoon bake + emissive + global tint (as today). Tier B: normal-mapped relighting |
