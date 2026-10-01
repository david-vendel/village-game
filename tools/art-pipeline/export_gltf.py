"""Export a scene (builder .py or .blend) as a glTF model for the real-time 3D renderer:

    blender -b -P tools/art-pipeline/export_gltf.py -- --scene <builder.py|scene.blend> --out <model.glb>

Same scene contract as render.py (README): each object carries its tags (the
collection path: stage:, scaffold, variant:/novariant:, part:) and a random
number in its glTF extras, so the game can show a look or a construction stage
by visibility and vary each piece; the named points come along as empty nodes
("point:door"). Materials export by name only: the game has its own shaders.
Modifiers (the thatch's lumps) are applied. Model space stays the spec's
(metres, front towards -Y; glTF turns it to +Y up, front towards +Z).
"""

import argparse
import importlib.util
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402


def tags_of(obj) -> list[str]:
    root = bpy.data.collections.get("Asset")
    out: list[str] = []

    def walk(col, tags):
        name = re.sub(r"\.\d{3}$", "", col.name)
        here = tags + ([name] if ":" in name or name == "scaffold" else [])
        if obj.name in col.objects:
            out.extend(here)
            return True
        return any(walk(c, here) for c in col.children)

    walk(root, [])
    return sorted(set(out))


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    if args.scene.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=args.scene)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        spec = importlib.util.spec_from_file_location("scene_builder", args.scene)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.build()
    r = random.Random(1)
    for obj in bpy.data.objects:
        # named points: three.js drops ':' from node names, so the name rides in the extras too
        if obj.type == "EMPTY" and obj.name.startswith("point:"):
            obj["point"] = obj.name[len("point:") :]
        if obj.type == "MESH":
            obj["tags"] = ",".join(tags_of(obj))
            obj["rand"] = round(r.random(), 4)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f"art-pipeline: exported {sum(1 for o in bpy.data.objects if o.type == 'MESH')} meshes to {args.out}")


try:
    main()
except Exception:
    import traceback

    traceback.print_exc()
    sys.exit(1)
