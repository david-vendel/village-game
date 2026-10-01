# Art: realistic graphics initiative

Plan and contract for replacing the procedural art with near-realistic art (target
look: the *Age of Empires II* main-menu village), made with AI-assisted pipelines.

| Doc | For |
| --- | --- |
| [PLAN.md](PLAN.md) | Research, chosen approach (pre-rendered 3D, as AoE2 did, built with AI 3D generation), pipeline, licences, and **work packages WP1–WP10** to hand to agents |
| [ASSET_SPEC.md](ASSET_SPEC.md) | **The asset format.** Units, cameras, lighting key, layers, kinds, manifest, budgets, validation. Every asset must follow it |
| [asset-manifest.schema.json](asset-manifest.schema.json) | JSON Schema (draft-07) for `public/assets/manifest.json` |
| [example-manifest.json](example-manifest.json) | Worked example: farm (variants, stages, side-road view), mill with rotating sails, farmer clips, rider, item, field, backdrops. Validates against the schema |

## Status and hand-off (2026-10-01)

**WP2 is done** (game side, see below); WP3 is next. Work runs on the user's own PC. Specs: Windows 10
Pro x64; Intel Core 6th gen (Skylake, ~3.5 GHz, 4 cores); 16 GB RAM; **NVIDIA GTX 1070 8 GB**.
Consequences:
- Use **Blender 4.5 LTS** (supports Pascal GPUs until 2027) and render **Cycles on the GPU**
  (OptiX, else CUDA), headless (`blender.exe -b`). Driver: the latest 580-series NVIDIA driver,
  the last branch for GTX 10. Use 2K textures, which keeps scenes well within 8 GB.
- Windows: Claude Code needs Git for Windows. Blender lives at
  `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe`. Keep the pipeline's paths
  and shell scripts OS-neutral: Python entry points, not bash-only scripts.
- The GTX 1070 is not suitable for the AI routes (no bf16, slow fp16, 8 GB). Route P doesn't
  need them. If needed later, use paid APIs or a GPU rented by the hour.
- **Fallback render machine:** the user's VM `vmsj13` (Ubuntu 22.04, 5 vCPU Xeon, ~13 GB free,
  no GPU: Cycles on the CPU, `nice -n 10 --threads 4`, roughly 4–6× slower than the 1070).

The EC2 that hosts the live site can't run Blender (see PLAN §5). It only deploys: pull
`main`, build, copy `dist` to `~/village-game-dist`.

Decisions so far:
- **Buildings are made procedurally** (route P in PLAN.md): a Python generator lays out the
  real architecture in Blender, and the render harness turns it into ASSET_SPEC assets. AI
  only fills gaps.
- **Non-commercial project.** Non-commercial model licences are OK; Hunyuan3D is still
  excluded (EU territory clause).
- **Generation and rendering run on the user's own machines** (PC with the GTX 1070; vmsj13 as
  fallback). No cloud GPUs for now.
- **No corners cut.** The user wants the full pilot, not a throwaway prototype.
- **Style: the blend** (decided 2026-10-01; the user's target is "AoE2"): the Definitive
  Edition menu look for buildings, light and backdrops (muted, hazy, rich materials), with
  saturated colours for clothing and awnings so people still read at zoom 0.45. The reference
  images are mood references only and must not enter the repo or any pipeline.
- **Cycles renders on CUDA, not OptiX**: on the GTX 1070 (no RT cores) CUDA measured ~6.7 s
  against OptiX ~8.1 s on the same scene. Set in Blender's user preferences.

**Pilot scope: the farm, complete.** Do these in order:
1. ~~**WP2 (game side):** asset loader with procedural fallback, `npm run assets:check`, `?art=preview`.~~
   Done: `src/render/assets.ts` / `manifest.ts` / `sprites.ts` / `preview.ts`, `tools/assets/`
   (validator, procedural export), `tests/assets.test.ts`. Buildings are hooked up (views,
   variants, stages, roadside views, parts, points, shadow, emissive at night); people, the
   horse, items, fields, nature and backdrops still draw procedurally, and get their hooks with
   their own work packages (WP5–WP8). `npm run assets:export` writes today's farm as
   placeholder assets: the game looks the same on them. They are unapproved, so production
   builds leave them out, and they aren't committed.
2. **WP3:** Blender render harness, camera and light per ASSET_SPEC §3–4, all passes.
3. **WP4 pilot:** `tools/building-gen/` core (pure Python, tested) and Blender layer. Outputs:
   the farm street view, the Large-farm variant, 5 construction stages and the roadside views.
4. Show it in the game next to the procedural art, by day and night, at zoom 1 and 0.45, for
   the user's approval.

First checks on the new machine:
- `blender --version`: Blender 4.5 LTS. In Preferences → System, the GTX 1070 appears under OptiX/CUDA.
- `node --version`: Node 22.
- `gh auth status`, or an SSH key that can push to `david-vendel/village-game`.
- `npm ci && npm test && npm run build` in the repo.
