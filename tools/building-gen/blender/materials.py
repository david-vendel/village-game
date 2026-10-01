"""Procedural materials for the medieval building library: no image textures,
so they work at any size and every element can vary (Object Info random).

Colours are linear (Blender's working space), picked for a 13th-14th century
village in late-afternoon sun: weathered oak, limewash with dirt rising from
the ground, golden-grey straw thatch with moss, grey-brown fieldstone, silvered
boards. The style is the blend (docs/art/README.md): the materials are muted
and natural; saturated colour belongs to people's clothes.
"""

from __future__ import annotations

import bpy

LIGHTS_GROUP = "Lights"

_cache: dict[str, bpy.types.Material] = {}


class Tree:
    """A small helper to build a material's node tree."""

    def __init__(self, mat: bpy.types.Material) -> None:
        mat.use_nodes = True
        self.nodes = mat.node_tree.nodes
        self.links = mat.node_tree.links
        self.nodes.clear()
        self.out = self.nodes.new("ShaderNodeOutputMaterial")
        self.bsdf = self.nodes.new("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs[0], self.out.inputs["Surface"])

    def new(self, kind: str, **inputs) -> bpy.types.Node:
        n = self.nodes.new(kind)
        for k, v in inputs.items():
            if hasattr(n, k) and not isinstance(getattr(type(n), k, None), property) and k not in n.inputs:
                setattr(n, k, v)
            else:
                n.inputs[k].default_value = v
        return n

    def link(self, a, b) -> None:
        self.links.new(a, b)

    def ramp(self, fac, stops: list[tuple[float, tuple[float, float, float]]]) -> bpy.types.NodeSocket:
        r = self.nodes.new("ShaderNodeValToRGB")
        els = r.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for el, (pos, col) in zip(els, stops):
            el.position = pos
            el.color = (*col, 1.0)
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def mix(self, fac, a, b, blend: str = "MIX") -> bpy.types.NodeSocket:
        m = self.nodes.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        if isinstance(fac, float):
            m.inputs[0].default_value = fac
        else:
            self.link(fac, m.inputs[0])
        for i, v in ((6, a), (7, b)):
            if isinstance(v, tuple):
                m.inputs[i].default_value = (*v, 1.0)
            else:
                self.link(v, m.inputs[i])
        return m.outputs[2]

    def math(self, op: str, a, b=None) -> bpy.types.NodeSocket:
        m = self.nodes.new("ShaderNodeMath")
        m.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                self.link(v, m.inputs[i])
        return m.outputs[0]

    def noise(self, vector, scale: float, detail: float = 4.0, rough: float = 0.55) -> bpy.types.Node:
        n = self.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        if vector is not None:
            self.link(vector, n.inputs["Vector"])
        return n

    def coords(self, kind: str = "Object", stretch: tuple[float, float, float] = (1, 1, 1)) -> bpy.types.NodeSocket:
        tc = self.nodes.new("ShaderNodeTexCoord")
        m = self.nodes.new("ShaderNodeMapping")
        m.inputs["Scale"].default_value = stretch
        self.link(tc.outputs[kind], m.inputs["Vector"])
        return m.outputs["Vector"]

    def random(self) -> bpy.types.NodeSocket:
        return self.nodes.new("ShaderNodeObjectInfo").outputs["Random"]

    def bump(self, height, strength: float, distance: float = 0.02) -> None:
        b = self.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        self.link(b.outputs["Normal"], self.bsdf.inputs["Normal"])

    def world_z(self) -> bpy.types.NodeSocket:
        geo = self.nodes.new("ShaderNodeNewGeometry")
        sep = self.nodes.new("ShaderNodeSeparateXYZ")
        self.link(geo.outputs["Position"], sep.inputs[0])
        return sep.outputs["Z"]


def _ground_dirt(t: Tree, base, height: float, dirt: tuple[float, float, float]) -> bpy.types.NodeSocket:
    """Splashed dirt and damp near the ground, fading out by `height` metres."""
    z = t.world_z()
    n = t.noise(t.coords("Object", (3, 3, 3)), 4.0).outputs["Fac"]
    edge = t.math("ADD", z, t.math("MULTIPLY", n, 0.25))
    fade = t.math("SUBTRACT", 1.0, t.math("DIVIDE", edge, height))
    fade = t.math("POWER", t.math("MAXIMUM", fade, 0.0), 1.6)
    return t.mix(t.math("MINIMUM", fade, 0.85), base, dirt)


def _oak(mat: bpy.types.Material) -> None:
    """Weathered oak beams: dark brown going silver-grey, with grain along the timber (local X)."""
    t = Tree(mat)
    grain = t.noise(t.coords("Object", (1.5, 30, 30)), 3.0, 6, 0.6)
    tone = t.ramp(t.random(), [(0.0, (0.075, 0.050, 0.032)), (0.6, (0.105, 0.075, 0.050)), (1.0, (0.150, 0.130, 0.110))])
    col = t.mix(t.math("MULTIPLY", grain.outputs["Fac"], 0.6), tone, (0.03, 0.02, 0.013), "MULTIPLY")
    t.link(_ground_dirt(t, col, 0.9, (0.05, 0.04, 0.03)), t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 0.78
    t.bump(grain.outputs["Fac"], 0.35, 0.01)


def _daub(mat: bpy.types.Material) -> None:
    """Limewashed wattle-and-daub: warm off-white, uneven, dirtier towards the ground."""
    t = Tree(mat)
    blotch = t.noise(t.coords("Object", (1, 1, 1)), 2.5, 5, 0.6).outputs["Fac"]
    base = t.ramp(t.math("ADD", t.math("MULTIPLY", t.random(), 0.3), t.math("MULTIPLY", blotch, 0.7)), [
        (0.25, (0.66, 0.60, 0.49)), (0.55, (0.74, 0.69, 0.58)), (0.9, (0.80, 0.76, 0.66))])
    t.link(_ground_dirt(t, base, 1.6, (0.30, 0.25, 0.18)), t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 0.92
    fine = t.noise(t.coords("Object", (1, 1, 1)), 18.0, 8, 0.7).outputs["Fac"]
    t.bump(t.math("ADD", fine, t.math("MULTIPLY", blotch, 0.5)), 0.25, 0.01)


def _fieldstone(mat: bpy.types.Material) -> None:
    """Fieldstone: each stone its own grey-brown, mottled, rough."""
    t = Tree(mat)
    tone = t.ramp(t.random(), [(0.0, (0.16, 0.15, 0.13)), (0.35, (0.24, 0.21, 0.17)), (0.7, (0.20, 0.19, 0.18)), (1.0, (0.30, 0.26, 0.20))])
    mottle = t.noise(t.coords("Object", (1, 1, 1)), 6.0, 6, 0.65).outputs["Fac"]
    col = t.mix(t.math("MULTIPLY", mottle, 0.5), tone, (0.10, 0.10, 0.09), "MULTIPLY")
    moss = t.noise(t.coords("Object", (1, 1, 1)), 3.0).outputs["Fac"]
    col = t.mix(t.math("MULTIPLY", t.math("GREATER_THAN", moss, 0.62), 0.6), col, (0.09, 0.11, 0.04))
    t.link(col, t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 0.9
    t.bump(mottle, 0.6, 0.02)


def _thatch(mat: bpy.types.Material) -> None:
    """Straw thatch: golden-grey, strands running down the slope, darker courses, moss in places."""
    t = Tree(mat)
    # strands: noise stretched along X (the ridge) is fine, along the slope coarse
    strands = t.noise(t.coords("Generated", (180, 6, 6)), 2.0, 8, 0.7).outputs["Fac"]
    courses = t.nodes.new("ShaderNodeTexWave")
    courses.wave_type = "BANDS"
    courses.bands_direction = "Z"
    courses.inputs["Scale"].default_value = 22.0
    courses.inputs["Distortion"].default_value = 4.0
    t.link(t.coords("Generated", (1, 1, 1)), courses.inputs["Vector"])
    patches = t.noise(t.coords("Object", (1, 1, 1)), 0.9, 4).outputs["Fac"]
    base = t.ramp(patches, [(0.3, (0.42, 0.30, 0.12)), (0.55, (0.52, 0.38, 0.16)), (0.8, (0.40, 0.33, 0.20))])
    col = t.mix(t.math("MULTIPLY", strands, 0.35), base, (0.22, 0.15, 0.06), "MULTIPLY")
    col = t.mix(t.math("MULTIPLY", courses.outputs["Fac"], 0.18), col, (0.20, 0.14, 0.06))
    moss = t.noise(t.coords("Object", (1, 1, 1)), 2.2, 5).outputs["Fac"]
    col = t.mix(t.math("MULTIPLY", t.math("GREATER_THAN", moss, 0.66), 0.7), col, (0.07, 0.09, 0.03))
    t.link(col, t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 1.0
    t.bump(t.math("ADD", strands, t.math("MULTIPLY", courses.outputs["Fac"], 0.4)), 0.8, 0.04)


def _planks(mat: bpy.types.Material, grey: float) -> None:
    """Sawn boards (door, shutters, barn): brown going silver with weather, grain along the board."""
    t = Tree(mat)
    grain = t.noise(t.coords("Object", (25, 25, 1.2)), 3.0, 6, 0.6)
    tone = t.ramp(t.random(), [(0.0, (0.15, 0.10, 0.06)), (0.5, (0.19, 0.135, 0.085)), (1.0, (0.20 + grey, 0.17 + grey, 0.14 + grey))])
    col = t.mix(t.math("MULTIPLY", grain.outputs["Fac"], 0.5), tone, (0.05, 0.035, 0.02), "MULTIPLY")
    t.link(_ground_dirt(t, col, 0.7, (0.06, 0.05, 0.035)), t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 0.8
    t.bump(grain.outputs["Fac"], 0.3, 0.01)


def _shingles(mat: bpy.types.Material) -> None:
    """Split wooden shingles on the barn: silver-grey courses."""
    t = Tree(mat)
    brick = t.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 9.0
    brick.inputs["Mortar Size"].default_value = 0.01
    brick.inputs["Brick Width"].default_value = 0.6
    brick.inputs["Row Height"].default_value = 0.3
    brick.inputs["Color1"].default_value = (0.12, 0.105, 0.085, 1)
    brick.inputs["Color2"].default_value = (0.17, 0.15, 0.12, 1)
    brick.inputs["Mortar"].default_value = (0.02, 0.017, 0.014, 1)
    brick.inputs["Mortar Size"].default_value = 0.02
    t.link(t.coords("Object", (1, 1, 1)), brick.inputs["Vector"])
    moss = t.noise(t.coords("Object", (1, 1, 1)), 2.0).outputs["Fac"]
    col = t.mix(t.math("MULTIPLY", t.math("GREATER_THAN", moss, 0.6), 0.6), brick.outputs["Color"], (0.07, 0.09, 0.035))
    t.link(col, t.bsdf.inputs["Base Color"])
    t.bsdf.inputs["Roughness"].default_value = 0.85
    t.bump(brick.outputs["Fac"], 0.8, 0.03)


def _plain(mat: bpy.types.Material, rgb: tuple[float, float, float], rough: float) -> None:
    t = Tree(mat)
    t.bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    t.bsdf.inputs["Roughness"].default_value = rough


def lights_group() -> bpy.types.NodeTree:
    """The harness's switch for night lights (0 by day, 1 at night)."""
    g = bpy.data.node_groups.get(LIGHTS_GROUP)
    if g:
        return g
    g = bpy.data.node_groups.new(LIGHTS_GROUP, "ShaderNodeTree")
    g.interface.new_socket("Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
    v = g.nodes.new("ShaderNodeValue")
    v.outputs[0].default_value = 0.0
    out = g.nodes.new("NodeGroupOutput")
    g.links.new(v.outputs[0], out.inputs[0])
    return g


def _window(mat: bpy.types.Material) -> None:
    """A window opening: dark inside by day; firelight and a rushlight at night (warm, about 2000 K)."""
    t = Tree(mat)
    t.bsdf.inputs["Base Color"].default_value = (0.012, 0.010, 0.008, 1)
    t.bsdf.inputs["Roughness"].default_value = 1.0
    g = t.nodes.new("ShaderNodeGroup")
    g.node_tree = lights_group()
    flicker = t.noise(t.coords("Object", (1, 1, 1)), 3.0).outputs["Fac"]
    strength = t.math("MULTIPLY", g.outputs[0], t.math("ADD", 2.2, t.math("MULTIPLY", flicker, 1.5)))
    bb = t.nodes.new("ShaderNodeBlackbody")
    bb.inputs["Temperature"].default_value = 1900.0
    t.link(bb.outputs[0], t.bsdf.inputs["Emission Color"])
    t.link(strength, t.bsdf.inputs["Emission Strength"])


BUILDERS = {
    "oak": _oak,
    "daub": _daub,
    "fieldstone": _fieldstone,
    "clay-stone": lambda m: _fieldstone(m),
    "thatch": _thatch,
    "planks": lambda m: _planks(m, 0.04),
    "boards": lambda m: _planks(m, 0.08),
    "shingles": _shingles,
    "pole": lambda m: _plain(m, (0.20, 0.14, 0.08), 0.8),
    "rope": lambda m: _plain(m, (0.40, 0.33, 0.20), 0.9),
    "doorway": lambda m: _plain(m, (0.008, 0.006, 0.005), 1.0),
    "window": _window,
}


def get(name: str) -> bpy.types.Material:
    """The material of that name, made on first use."""
    if name in _cache:
        return _cache[name]
    if name not in BUILDERS:
        raise KeyError(f"no material {name!r} in the library (have {', '.join(sorted(BUILDERS))})")
    mat = bpy.data.materials.new(name)
    BUILDERS[name](mat)
    _cache[name] = mat
    return mat
