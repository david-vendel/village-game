# Asset format specification (v1)

This is the contract between whoever **makes** art (any pipeline: 3D renders, AI
generation, photos, hand painting) and the **game**, which places and animates it.
If an asset follows this spec, the game can use it without code changes. How it was
made doesn't matter.

- Machine-readable schema: [`asset-manifest.schema.json`](asset-manifest.schema.json)
- Worked example: [`example-manifest.json`](example-manifest.json)
- Why it's shaped like this: [`PLAN.md`](PLAN.md)

Words: **must** = rejected by the validator if violated. **Should** = reviewed by a person.

---

## 1. Units and coordinates

| Term | Definition |
| --- | --- |
| **World unit (u)** | The game's coordinate unit. **20 u = 1 m.** A villager is about 37 u tall (1.8 m); a plot is 250 u (12.5 m); a land-grid cell is 25 u. |
| **Axes** | x to the right, y **down** (screen convention). The ground line of the street's buildings is `BASE_Y` in `src/game/layout.ts`. |
| **Size** | Every image has a `size` in world units, `[w, h]`. Its pixel size is `size × tier` (§2), rounded. |
| **Anchor** | The point of the image, in world units from its **top-left**, that the game places at the object's position. For anything standing on the ground: the **ground contact point** (see per kind). |
| **Points** | Named positions in the same frame as the anchor (from the image's top-left, in u), e.g. `door`, `chimney`, `handR`. |

`src/game/layout.ts` is the source of truth for positions the simulation uses: plots,
storage slots (`SHEAF_SLOTS`, `YARD_ITEMS`, `TAVERN_SLOTS`, one item per `PILE_UNIT` = 10),
work spots, and the farmhouse door (`HOME`). Art must **look right at those spots**.
For example, the grain store's pallet must be where `SHEAF_SLOTS` puts the sheaves.
Art does not move them. If art needs a spot moved, change `layout.ts` in the same change
and say so in the PR.

## 2. Resolution tiers

| Tier | px per u | Use |
| --- | --- | --- |
| `@2x` | 2 | **Required.** Default for phones and 1080p. |
| `@4x` | 4 | **Required for buildings, people, rider, hero backdrop pieces.** Hi-DPI and zoomed in. Masters are produced at this tier. |
| `@1x` | 1 | Optional. Far backdrop layers (parallax ≤ 0.24) may ship *only* `@1x` and `@2x`. |

The game picks the smallest tier ≥ (screen px per u). At zoom 1 on a 1080p screen that's
1.8 px/u, so `@2x`.

## 3. Cameras (views)

All views use an **orthographic** camera. The game adds the ground's one-point perspective
itself, by scaling things with depth. A sprite must **not** contain its own perspective
convergence. Angles are given in model space: up is +Z, and the object's **front faces −Y**
(towards the street/viewer at yaw 0).

| View id | Used for | Yaw (camera orbit about Z, from front) | Pitch (looking down) | Notes |
| --- | --- | --- | --- | --- |
| `street` | Buildings, props, nature, items on the street | **+25°** (camera to the front-**right**: the building's right side wall is visible, as in today's art) | **15°** | Required for all buildings |
| `roadsideL` / `roadsideR` | Buildings seen up a side road at a crossroads (`render/scene.ts`, receding) | **−75° / +75°**. L stands left of the receding road with its front facing right, R the mirror case | 15° | Optional. Without it the game squashes the `street` view, as it does today |
| `side` | People, rider, animals walking along the street | **+15°** (slightly in front of the walker, so faces read) | **10°** | Required. Facing rules in §5 |
| `backdrop` | Parallax layers | 0° | **5°** | Very long lens feel. No visible vertical convergence |

**Ground contact in the `street` view:** the model origin is the **centre of the
building's front wall at ground level**. Its projection is the anchor, and the game puts
it on the plot centre at `BASE_Y`. The footprint's width along x **must** match
`BUILDINGS[type].width` in `src/game/buildings.ts` within ±10 u (eaves and steps may overhang).

## 4. Lighting key (baked)

All baked passes are lit by **the same key**. It matches today's art: the sun is on the
viewer's left, so right-hand faces are in shade.

| Element | Value |
| --- | --- |
| Sun direction (camera space) | From the **left** (−x), slightly towards the viewer, **35° elevation**. As a vector pointing *to* the sun: `(-0.71, 0.57, 0.41)` in (x right, y up, z towards camera) |
| Sun colour and strength | Warm late afternoon, ≈ **4300 K**, key:fill ≈ 3:1 |
| Fill (sky) | ≈ **9000 K**, soft, from above-right |
| Shadow softness | Sun angular diameter ≈ 2° (slightly soft edges) |
| Exposure | Plaster in sun at sRGB ≈ 225–235; nothing clipped except speculars and emissive |

The colour pass includes ambient occlusion and self-shadowing, but **not** the shadow cast
onto the ground (that's the `shadow` layer). The game tints everything for dusk and night
(`render/sky.ts`) and adds `emissive` on top. Separate night bakes aren't needed in v1.

## 5. Facing and mirroring

- **Buildings, props, nature, items, backdrops are never mirrored.** The game draws them as delivered.
- **People, the rider and animals** walk both ways. Because the sun is fixed on the left, a
  mirrored image would be lit from the wrong side. So:
  - `right` facing is **required** for every clip;
  - `left` facing **should** be delivered: render the model turned around, same camera and light;
  - if `left` is missing, the game mirrors `right`. It's accepted as a fallback and flagged by the validator.

## 6. Layers (render passes)

Every image of an asset (each view, variant, stage, part and frame) comes as a set of
**pixel-aligned** layers with identical dimensions.

| Layer | Required | Content | Encoding | Colour space |
| --- | --- | --- | --- | --- |
| `color` | **yes** | Final look under the §4 key, including AO and self-shadowing. **Straight (non-premultiplied) alpha.** | WebP lossy q ≥ 85 with alpha (AVIF allowed) | sRGB |
| `shadow` | should (buildings, people, rider, trees) | The shadow it casts on the ground under the §4 sun. Black, strength in alpha. Extends beyond the object; the image `size` covers both | WebP/PNG | linear alpha |
| `emissive` | when it has lights | Light-emitting parts (windows, forge, lanterns, oven mouth) on black. Added at night | WebP | sRGB |
| `normal` | should (route B: always) | View-space normals: +x right, +y up, +z towards camera (OpenGL), encoded `n·0.5+0.5` | **lossless** WebP or PNG | linear |
| `albedo` | optional | Unlit base colour | WebP | sRGB |
| `ao` | optional | Ambient occlusion, white = open | lossless, 8-bit | linear |
| `depth` | optional | Distance from the anchor plane towards the camera, in u. `depthRange` gives the 0–65535 mapping | 16-bit PNG | linear |
| `mask` | people (recolour) | Recolour regions: R = top (tunic/dress/robe), G = legs, B = hat/hood/coif, A = apron/belt. Values 0–255 = coverage | lossless | linear |

Rules:
- **Alpha bleed:** colour must be dilated ≥ 4 px into fully transparent pixels, so scaling
  doesn't produce halos.
- Fully transparent margin ≤ 8 px beyond the union of colour and shadow.
- Normal pixels where alpha > 0 must be unit length within ±5%.
- The renderer uses tier A (Canvas 2D) `color + shadow + emissive` now, and the rest in
  tier B (WebGL) later. **Deliver route-B passes anyway:** they're free from the renderer and
  expensive to make later.

## 7. Asset kinds

Asset ids are stable strings. The game maps its state to ids (§11).

### 7.1 `building`
- `views.street` is required; `roadsideL`/`roadsideR` are optional.
- **`variants`**: alternative looks chosen by game state. The base look is `default`.
  Today: `farm` → `upgraded` (Large farm, second window and room).
- **`construction`**, one of:
  - `{"mode":"reveal"}`: the game reveals `color` bottom-up behind its own scaffolding (today's behaviour);
  - `{"mode":"stages", "stages":{…}}`: one image set per stage key **`staking`, `foundation`,
    `frame`, `walls`, `roof`** (`ConstructionStage` in `src/game/world.ts`); `done` is the
    finished building. Each stage image uses the same `size` and anchor as the finished view,
    so it doesn't jump. The game crossfades within a stage by progress. Route B: cut the
    model with clip planes and add scaffolding.
- **`parts`**: separately drawn pieces with their own layers and a `pivot`:
  - `rotate`: mill sails, with `radPerSecond`
  - `loop`: a sprite sheet, for a flag or a well bucket
  - `swing`: a bell or tavern sign, with an amplitude in radians and a period
  - `emissivePulse`: forge glow flicker, ovens

  Parts draw in `z` order relative to the body (`"behind"` or `"front"`).
- **`points`**, used by the renderer: `smoke:*` (chimney tops, where procedural smoke
  starts), `door` (where people appear/disappear), `sign`, `bell`, `window:*` (optional).
- **`behind` / `front`**: extra layers drawn in the background or foreground passes (e.g.
  a farm's yard props). Farm fields are not part of the building (see 7.6).

### 7.2 `person`
One asset per look × trade, e.g. `person.peasant.farmer`, `person.woman.none`, `person.monk.none`.
- `clips`: required for every person: `idle`, `walk`; carry clips by load type:
  `walk.carry.sack`, `walk.carry.basket`, `walk.carry.log`, `walk.carry.stone`,
  `walk.carry.sheaf`; door clips `door.in`, `door.out`. Plus the clips for the trade:

  | Trade | Work clips |
  | --- | --- |
  | farmer | `work.sow`, `work.scythe` |
  | builder | `work.hammer`, `work.lay` |
  | miller | (works indoors; seen at a window: `work.window`) |
  | baker | `work.peel` |
  | woodcutter | `work.chop` |
  | stonecutter | `work.quarry` |
  | serf / none | none beyond the carry clips |

  Carried loads are **baked into** carry clips, so hands wrap them believably.
- Each clip has `facings.right` (required) and `.left` (should), plus:
  - `frames`: count. Walk 12, idle 8–12, work 10–16.
  - `grid`: `[cols, rows]`, sheet row-major. Every frame has the same `frameSize` and anchor.
  - `driver`: `{"type":"distance","uPerCycle":…}` for walking (feet must not slide: one cycle =
    two steps). For the villager walk use `uPerCycle` = the stride the art was made with. Or
    `{"type":"time","fps":…}` for idle and work.
  - `loop`: true or false.
  - `events`: frame indices for sound sync, e.g. `{"hit":[5]}` for a hammer or `{"step":[0,6]}`.
    `src/app/sound.ts` keys sounds to these.
  - `points` per frame: `handR`, `handL`, `head`; and `contact` flags per frame for the feet.
- `variants`: 2–6 baked identities (face, hair, skin) per asset. The game picks by the person's
  `seed`, then recolours clothes through the `mask` layer from its palette.
- Height: standing person 34–38 u. Anchor: midpoint between the feet on the ground.

### 7.3 `rider`
`rider.king`: clips `idle`, `walk`, `trot`, each `driver: distance` with
**`uPerCycle` = 48** (`STRIDE` in `src/render/horse.ts`; change both together). Events
`hoof` for each hoof contact. Anchor on the ground between the hooves. Facings as §5. The
king's cloak flows behind with speed: bake it per clip (walk vs trot).

### 7.4 `animal`
`animal.chicken`: `idle`, `walk`, `peck`.

### 7.5 `item`
Goods lying in stores and yards: `item.wood`, `item.stone`, `item.grain` (sheaf),
`item.flour` (sack), `item.bread` (basket). One image = **one pile unit** (`PILE_UNIT` = 10 of the
resource). Anchor at bottom centre. It must fit the slot spacing in `layout.ts` without
touching its neighbours. 2–4 `variants` (picked by slot index) avoid a copy-paste look.

### 7.6 `field`
Farm plot ground per land-grid cell (25 u wide) for each zone, `field.back` and `field.front`.
`states`: `grass`, `tilled`, `sown`, `sprout`, `green`, `golden`, `ripe`, `stubble`.
- Each state is a **horizontally tileable strip** one cell wide and as deep as the zone
  (`BACK_FIELD` / front field depth in `layout.ts`), in the `street` view.
- The renderer fits it into the ground perspective. Crops taller than the strip go in a
  separate `crops` layer anchored on the strip's near edge.
- 2–3 `variants` per state.

### 7.7 `nature`
- `tree`: `stages` `sapling`, `young`, `mature`, `stump`; `felling` clip (`driver: progress`,
  frames over 0–1); variants ≥ 4.
- `quarry`: `stages` by depletion (`full`, `worked`, `deep`, `spent`).

### 7.8 `backdrop`
Ids match today's parallax layers in `render/background.ts`:

| Id | Parallax factor | Notes |
| --- | --- | --- |
| `backdrop.mountains` | 0.05 | |
| `backdrop.castle` | 0.14 | **Hero sprite, not tiled**, with `layerX` (position in its layer) |
| `backdrop.castleHills` | 0.14 | |
| `backdrop.farHills` | 0.24 | |
| `backdrop.distantVillage` | 0.42 | |
| `backdrop.treeLine` | 0.66 | |
| `ground.verge`, `ground.road`, `ground.sideRoad` | 1.0 | |
| `backdrop.foreground` | 1.2 | |

Each tiled layer is a horizontally **seamless** strip: `tileWidth` in u, `anchorY` (the world
y its bottom edge sits at, at zoom 1) and `height`. The left and right edges must match
exactly. The validator compares edge columns. The sky stays procedural (sun, moon, stars,
gradients). Clouds may be delivered as `backdrop.cloud` variants.

## 8. Manifest

`public/assets/manifest.json` lists every asset. File paths are relative to
`public/assets/`, and `{tier}` is replaced by `1`, `2` or `4`.

File naming: `<kind>/<id>/<view|clip>/<variant>/<layer>@{tier}x.<ext>`, for example
`building/farm/street/default/color@{tier}x.webp`.

```jsonc
{
  "specVersion": 1,
  "unitsPerMeter": 20,
  "assets": {
    "building.farm": {
      "kind": "building",
      "footprintWidth": 200,
      "views": {
        "street": {
          "size": [430, 175], "anchor": [215, 160],
          "tiers": [2, 4],
          "layers": {
            "color": "building/farm/street/default/color@{tier}x.webp",
            "shadow": "building/farm/street/default/shadow@{tier}x.webp",
            "emissive": "building/farm/street/default/emissive@{tier}x.webp",
            "normal": "building/farm/street/default/normal@{tier}x.webp"
          },
          "points": { "door": [196, 150], "smoke:0": [240, 32] }
        }
      },
      "variants": { "upgraded": { "views": { "street": { "...": "same shape" } } } },
      "construction": { "mode": "stages", "stages": { "staking": { "...": "view-shaped" } } },
      "source": { "method": "render3d", "models": [{ "name": "TRELLIS.2", "version": "…", "licence": "MIT" }] }
    }
  }
}
```

The full example is in [`example-manifest.json`](example-manifest.json); every field is
defined in the schema.

## 9. File formats
- `color`, `emissive`, `albedo`: WebP (lossy, q 85–92, with alpha), or AVIF with the same quality. 8-bit sRGB, ICC profile stripped (assumed sRGB).
- `normal`, `ao`, `mask`: lossless WebP or PNG, 8-bit linear. Lossy compression is forbidden: it breaks normals and masks.
- `depth`: 16-bit greyscale PNG.
- `shadow`: lossless WebP or PNG; colour channels black, strength in alpha.
- Max dimension 4096 px per image or sheet. Larger sheets must be split into several sheets.
- No metadata with personal info (strip EXIF and GPS from anything that started as a photo).

## 10. Budgets
| | `@2x` | `@4x` |
| --- | --- | --- |
| First load (backdrops + rider + starting village) | ≤ 20 MB | ≤ 45 MB, loaded after `@2x` |
| Whole asset set | ≤ 80 MB | ≤ 200 MB |
| Decoded memory at once (phone) | ≤ 300 MB | n/a (desktop only) |

The game loads building, person and item assets lazily, when one exists in the world. It
loads backdrops and the rider up front.

## 11. Mapping game state to assets

| Game state (`src/game`) | Asset |
| --- | --- |
| `Building.type` | `building.<type>`, `variant` = `upgraded` if `Building.upgraded`, else `default` |
| Construction progress (`constructionStage()`) | `construction.stages[stage]`, or reveal of `color` |
| Building at a crossroads seen up the side road | `views.roadsideL/R`, else squashed `street` |
| `Person.look` + trade (`figureOf`: profession, else serf if seeker, else job role) | `person.<look>.<role\|none>`; `variant` = `seed mod variants`; clothes recoloured via `mask` |
| What a person is doing (`WorkerTask`, carried resource) | `idle` / `walk` / `walk.carry.<item>` / `work.<verb>` / `door.in`/`out` |
| Rider speed (`vx`) | `idle` < 2% of max speed ≤ `walk` < 60% ≤ `trot` |
| `Animal` | `animal.chicken` |
| Store contents (`stock`, per slot) | `item.<resource>`, variant by slot index |
| Farm plot state + growth | `field.<zone>` state `grass`…`stubble` |
| Tree growth / felling progress; quarry depletion | `nature.tree` stage / `felling` frame; `nature.quarry` stage |

New game state that should be visible needs a row here and the asset kinds it implies,
in the same PR.

## 12. Validation (`npm run assets:check`, to be built in WP2)

An asset is rejected if:
- it doesn't match the schema;
- a referenced file is missing;
- image pixel sizes ≠ `size × tier` (±1 px);
- layers of one image differ in size;
- `color` has no alpha;
- the anchor lies outside the image;
- a building's `footprintWidth` differs from `BUILDINGS[type].width` by more than 10 u;
- a person's height is outside 34–38 u;
- sheet frame counts don't match the grid;
- a `distance` driver has no `uPerCycle`;
- a seamless strip's edges differ (mean ΔE > 2 on the edge columns);
- normals aren't unit length;
- lossy compression was used on `normal` or `mask`;
- alpha-bleed is missing (halo check).

These get warnings, for review:
- `left` facing missing;
- no `shadow` or `normal` on route-B assets;
- the colour pass disagrees with the §4 light direction (shading vs normals);
- palette outside the style bible's ranges.

## 13. Versioning
- `specVersion` is bumped for breaking changes. The game supports the current and previous versions.
- Every asset carries `source` (method, models + versions + licences, reference inputs with
  their licence and attribution, author, approval).
- Assets without an approved `source.approvedBy` don't ship to the production build.
