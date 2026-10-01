"""Blender entry point of the render harness:

    blender -b -P tools/art-pipeline/render.py -- --scene <scene.blend|builder.py> --job <job.json>

A builder .py defines build(), which makes the scene from nothing (see
fixtures/). Renders every view and configuration of the job into job.out as
raw passes and meta.json; pack.ts turns those into assets. Usually run through
`npm run art:render`, which also packs and validates."""

import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

from harness import blender_render  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--out", help="overrides the job's out folder")
    args = ap.parse_args(argv)

    if args.scene.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=args.scene)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        spec = importlib.util.spec_from_file_location("scene_builder", args.scene)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.build()
    job = blender_render.Job.load(args.job)
    if args.out:
        job.out = args.out
    if not job.out:
        raise SystemExit("no output folder: give --out or set out in the job")
    meta = blender_render.run(job)
    n = sum(len(v["images"]) for v in meta["views"].values())
    print(f"art-pipeline: rendered {n} image(s) of {job.id} into {job.out}")


try:
    main()
except Exception:
    import traceback

    traceback.print_exc()
    sys.exit(1)
