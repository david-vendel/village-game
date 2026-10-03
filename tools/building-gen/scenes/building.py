"""Scene builder for the render harness: any building, exactly as the game builds it.

    BUILDING=house SEED=31 SIZE=1 STYLE=painterly \\
      npm run art:render -- tools/building-gen/scenes/building.py tools/building-gen/scenes/building.job.json

The triangles come from the game's own generator and mesher (tools/building-gen/mesh.ts),
grouped into the harness's collections (stage:<stage>, scaffold, variant:…), so every
construction stage and look renders. Materials: the style's base colour times each piece's
tint (the game's vertex colours), with a little surface breakup and bump for the light to
catch; these renders are the base the paint-over works on (tools/paint).
"""

import json
import os
import subprocess
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def _linear(hex_: str) -> tuple[float, float, float, float]:
    def c(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    h = hex_.lstrip("#")
    return (c(int(h[0:2], 16)), c(int(h[2:4], 16)), c(int(h[4:6], 16)), 1.0)


_mats: dict[str, bpy.types.Material] = {}


def _material(g: dict) -> bpy.types.Material:
    key = f"{g['material']}|{g['color']}"
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = g["rough"]
    bsdf.inputs["Metallic"].default_value = g["metal"]
    # base colour × the piece's tint, broken up a little by noise
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "tint"
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = _linear(g["color"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(rgb.outputs[0], mul.inputs["A"])
    nt.links.new(attr.outputs["Color"], mul.inputs["B"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 9.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 0.88
    ramp.inputs["To Max"].default_value = 1.08
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Value"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    nt.links.new(mul.outputs["Result"], shade.inputs["A"])
    nt.links.new(ramp.outputs["Result"], shade.inputs["B"])
    nt.links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if g.get("glow"):
        bsdf.inputs["Emission Color"].default_value = _linear(g["glow"])
        bsdf.inputs["Emission Strength"].default_value = 0.0
    _mats[key] = m
    return m


_cols: dict[str, bpy.types.Collection] = {}


def _collection(root: bpy.types.Collection, path: list[str]) -> bpy.types.Collection:
    col = root
    key = ""
    for name in path:
        key += "/" + name
        if key not in _cols:
            c = bpy.data.collections.new(name)
            col.children.link(c)
            _cols[key] = c
        col = _cols[key]
    return col


def build() -> None:
    btype = os.environ.get("BUILDING", "house")
    seed = os.environ.get("SEED", "7")
    size = os.environ.get("SIZE", "1")
    style = os.environ.get("STYLE", "painterly")
    tsx = os.path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs")
    script = os.path.join(REPO, "tools", "building-gen", "mesh.ts")
    out = subprocess.run(["node", tsx, script, btype, seed, size, style], capture_output=True, text=True, cwd=REPO, check=True)
    data = json.loads(out.stdout)
    root = bpy.data.collections.get("Asset") or bpy.data.collections.new("Asset")
    if root.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(root)
    for i, g in enumerate(data["groups"]):
        pos = g["pos"]
        n = len(pos) // 3
        verts = [(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]) for k in range(n)]
        faces = [(k, k + 1, k + 2) for k in range(0, n, 3)]
        mesh = bpy.data.meshes.new(f"{g['material']}.{i}")
        mesh.from_pydata(verts, [], faces)
        nor = g["nor"]
        mesh.normals_split_custom_set_from_vertices([(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]) for k in range(n)])
        col = g["col"]
        attr = mesh.color_attributes.new("tint", "FLOAT_COLOR", "POINT")
        for k in range(n):
            attr.data[k].color = (col[k * 3], col[k * 3 + 1], col[k * 3 + 2], 1.0)
        mesh.materials.append(_material(g))
        obj = bpy.data.objects.new(mesh.name, mesh)
        _collection(root, g["path"]).objects.link(obj)
    for name, at in data["points"].items():
        emp = bpy.data.objects.new(f"point:{name}", None)
        emp.location = at
        bpy.context.scene.collection.objects.link(emp)


if __name__ == "__main__" and "bpy" in sys.modules:
    pass
