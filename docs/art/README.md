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

Nothing implemented yet. **The next session runs on the user's VM `vmsj13`.** Specs:
x86-64, Ubuntu 22.04, 5 vCPUs (Xeon Platinum 8568Y+), ~13 GB RAM free (shared with a k8s
cluster), 181 GB disk free, **no GPU**. Consequences:
- Render with **Cycles on the CPU**, headless (`blender -b`). EEVEE needs a GPU, so it's not used.
- Run Blender with `nice -n 10` and `--threads 4`, so the VM's other workloads keep a core.
- AI routes (image→3D, big image or video models) aren't possible there; route P doesn't need
  them. If needed later, use paid APIs or a GPU rented by the hour.

The EC2 that hosts the live site can't run Blender (see PLAN §5). It only deploys: pull
`main`, build, copy `dist` to `~/village-game-dist`.

Decisions so far:
- **Buildings are made procedurally** (route P in PLAN.md): a Python generator lays out the
  real architecture in Blender, and the render harness turns it into ASSET_SPEC assets. AI
  only fills gaps.
- **Non-commercial project.** Non-commercial model licences are OK; Hunyuan3D is still
  excluded (EU territory clause).
- **Generation and rendering run on the user's own machines** (vmsj13). No cloud GPUs for now.
- **No corners cut.** The user wants the full pilot, not a throwaway prototype.
- **Style: not decided yet.** Choose between the AoE2 Definitive Edition menu painting (muted,
  hazy, rich materials), the 1999 storybook illustration (saturated, even light), or the
  recommended blend (DE look for buildings, light and backdrops; saturated colours for
  clothing and awnings). The user has both reference images; they are mood references
  only and must not enter the repo or any pipeline.

**Pilot scope: the farm, complete.** Do these in order:
1. **WP2 (game side):** asset loader with procedural fallback, `npm run assets:check`, `?art=preview`.
2. **WP3:** Blender render harness, camera and light per ASSET_SPEC §3–4, all passes.
3. **WP4 pilot:** `tools/building-gen/` core (pure Python, tested) and Blender layer. Outputs:
   the farm street view, the Large-farm variant, 5 construction stages and the roadside views.
4. Show it in the game next to the procedural art, by day and night, at zoom 1 and 0.45, for
   the user's approval.

First checks on the new machine:
- `blender --version`: use Blender 4.5 LTS, linux-x64, unpacked under `~/opt/`.
- `node --version`: Node 22.
- `gh auth status`, or an SSH key that can push to `david-vendel/village-game`.
- `npm ci && npm test && npm run build` in the repo.
