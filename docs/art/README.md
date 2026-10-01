# Art: realistic graphics initiative

Plan and contract for replacing the procedural art with near-realistic art (target
look: the *Age of Empires II* main-menu village), made with AI-assisted pipelines.

| Doc | For |
| --- | --- |
| [PLAN.md](PLAN.md) | Research, chosen approach (pre-rendered 3D, as AoE2 did, built with AI 3D generation), pipeline, licences, and **work packages WP1–WP10** to hand to agents |
| [ASSET_SPEC.md](ASSET_SPEC.md) | **The asset format.** Units, cameras, lighting key, layers, kinds, manifest, budgets, validation. Every asset must follow it |
| [asset-manifest.schema.json](asset-manifest.schema.json) | JSON Schema (draft-07) for `public/assets/manifest.json` |
| [example-manifest.json](example-manifest.json) | Worked example: farm (variants, stages, side-road view), mill with rotating sails, farmer clips, rider, item, field, backdrops. Validates against the schema |

Status: nothing implemented yet. Start with WP1 (style bible), WP2 (runtime loader with
procedural fallback) and WP3 (Blender render harness) in parallel.
