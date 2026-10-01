"""Turns construction elements (core/) into a Blender scene that follows the
render harness's contract (tools/art-pipeline/README.md): meshes with
materials and weathering, sorted into stage/variant/scaffold/part collections,
and the named points as empties. Runs inside Blender.
"""

from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Vector

from core.elements import Element

from . import materials

BEVEL = 0.012  # sawn timber and boards: just enough edge to catch the light


# --- meshes ---------------------------------------------------------------------------

_mesh_cache: dict[tuple, bpy.types.Mesh] = {}


def _box_mesh(size: tuple[float, float, float], bevel: float, material: str) -> bpy.types.Mesh:
    """A box of this size, edges bevelled; shared by every element of the same size and material."""
    key = ("box", round(size[0], 3), round(size[1], 3), round(size[2], 3), bevel, material)
    if key in _mesh_cache:
        return _mesh_cache[key]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    b = min(bevel, min(size) * 0.3)
    if b > 0.001:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=2, profile=0.6, affect="EDGES")
    mesh = bpy.data.meshes.new("box")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(materials.get(material))
    _mesh_cache[key] = mesh
    return mesh


def _stone_mesh(size: tuple[float, float, float], seed: int) -> bpy.types.Mesh:
    """A rough fieldstone: a rounded box with its surface pushed in and out."""
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=True)
    for v in bm.verts:
        # round it towards a pebble, then jitter
        c = v.co
        n = c.normalized()
        c = c.lerp(n * 0.62, 0.35)
        jitter = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * 0.06
        v.co = Vector(((c.x + jitter.x) * size[0], (c.y + jitter.y) * size[1], (c.z + jitter.z) * size[2]))
    mesh = bpy.data.meshes.new("stone")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return mesh


def _outward(mesh: bpy.types.Mesh) -> bpy.types.Mesh:
    """Make every face of a closed mesh point outwards (renderers that draw one side need it)."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def _roof_mesh(p: dict) -> bpy.types.Mesh:
    """The thatch shell: a thick gable roof profile run along x, cut in segments so it can sag and bulge."""
    t = p["thickness"]
    pitch = math.radians(p["pitch_deg"])
    drop = t / math.cos(pitch)
    yf, yb, ez, ry, rz = p["y_front"], p["y_back"], p["eave_z"], p["ridge_y"], p["ridge_z"]
    # outer surface front eave → ridge → back eave, then the underside back; dense, so the
    # lumps can work on it and the ridge keeps its line (a slight rounding over the top)
    steps = 14

    def slope(y0: float, z0: float, y1: float, z1: float) -> list[tuple[float, float]]:
        return [(y0 + (y1 - y0) * k / steps, z0 + (z1 - z0) * k / steps) for k in range(steps)]

    round_ = 0.18  # how far down the slope the ridge is rounded
    top = [(ry - round_, rz - round_ * math.tan(pitch) * 0.55), (ry, rz), (ry + round_, rz - round_ * math.tan(pitch) * 0.55)]
    outer = slope(yf, ez, ry - round_, rz - round_ * math.tan(pitch)) + top + slope(ry + round_, rz - round_ * math.tan(pitch), yb, ez)[1:] + [(yb, ez)]
    under = slope(yb + 0.05, ez - drop, ry, rz - drop) + slope(ry, rz - drop, yf - 0.05, ez - drop) + [(yf - 0.05, ez - drop)]
    profile = outer + under
    segs = 40
    xs = [p["x0"] + (p["x1"] - p["x0"]) * i / segs for i in range(segs + 1)]
    verts = [(x, y, z) for x in xs for (y, z) in profile]
    n = len(profile)
    faces = []
    for i in range(segs):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.append(tuple(range(n))[::-1])
    faces.append(tuple(segs * n + k for k in range(n)))
    mesh = bpy.data.meshes.new("thatch")
    mesh.from_pydata(verts, [], faces)
    _outward(mesh)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return mesh


def _gable_mesh(p: dict) -> bpy.types.Mesh:
    """The gable triangle of boards above the tie beam."""
    x, t = p["x"], p["thickness"]
    y0, y1, z0, zr = p["y0"], p["y1"], p["z0"], p["z_ridge"]
    ym = (y0 + y1) / 2
    tri = [(y0 + 0.3, z0), (y1 - 0.3, z0), (ym, zr)]
    verts = [(x - t / 2, y, z) for y, z in tri] + [(x + t / 2, y, z) for y, z in tri]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new("gable")
    mesh.from_pydata(verts, [], faces)
    return _outward(mesh)


def _leanto(e: Element) -> tuple[bpy.types.Mesh, Vector, tuple]:
    """The barn's mono-pitch roof slab: a box from the house down to the outer wall."""
    from core.elements import beam_transform

    p = e.params
    yc = (p["y0"] + p["y1"]) / 2
    at, size, rot = beam_transform((p["x0"], yc, p["z0"]), (p["x1"], yc, p["z1"]), p["y1"] - p["y0"], p["thickness"])
    return _box_mesh(size, BEVEL, e.material), Vector(at), rot


# --- objects and collections -----------------------------------------------------------


def _collection_for(root: bpy.types.Collection, e: Element) -> bpy.types.Collection:
    """Asset / stage:<stage> / <tag> / <tag> …: the harness reads tags from the collection path."""
    col = _child(root, f"stage:{e.stage}")
    for tag in sorted(e.tags):
        col = _child(col, tag)
    return col


_collections: dict[tuple[str, str], bpy.types.Collection] = {}


def _child(parent: bpy.types.Collection, name: str) -> bpy.types.Collection:
    """The child collection of that name (Blender may suffix it .001; the harness ignores that)."""
    key = (parent.name, name)
    if key not in _collections:
        c = bpy.data.collections.new(name)
        parent.children.link(c)
        _collections[key] = c
    return _collections[key]


def element_object(e: Element) -> bpy.types.Object:
    rot = e.rot
    loc = Vector(e.at)
    if e.shape == "stone":
        mesh = _stone_mesh(e.size, e.params["seed"])
    elif e.shape == "roof":
        mesh, loc, rot = _roof_mesh(e.params), Vector((0, 0, 0)), (0, 0, 0)
    elif e.shape == "gable":
        mesh, loc, rot = _gable_mesh(e.params), Vector((0, 0, 0)), (0, 0, 0)
    elif e.shape == "leanto":
        mesh, loc, rot = _leanto(e)
    elif e.kind == "ridge":
        mesh = _box_mesh(e.size, 0.13, e.material)  # a rounded roll of straw along the ridge
    else:
        mesh = _box_mesh(e.size, 0 if e.kind == "line" else BEVEL, e.material)
    if not mesh.materials:
        mesh.materials.append(materials.get(e.material))
    obj = bpy.data.objects.new(e.id, mesh)
    obj.location = loc
    obj.rotation_euler = rot
    if e.shape == "roof":
        _lumpy(obj, e.params["seed"])
    return obj


def _lumpy(obj: bpy.types.Object, seed: int) -> None:
    """Thatch isn't flat: a gentle displacement so it bulges and sags."""
    tex = bpy.data.textures.new(f"thatch-lumps-{seed}", "CLOUDS")
    tex.noise_scale = 1.4
    disp = obj.modifiers.new("lumps", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.07
    disp.mid_level = 0.5
    disp.texture_coords = "GLOBAL"


def build_scene(elements: list[Element], points: dict[str, tuple[float, float, float]], pivots: dict[str, tuple[float, float, float]] | None = None) -> None:
    """Make the scene for the harness from elements and named points (an empty file to start from)."""
    root = bpy.data.collections.get("Asset") or bpy.data.collections.new("Asset")
    if root.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(root)
    for e in elements:
        obj = element_object(e)
        _collection_for(root, e).objects.link(obj)
    for name, at in points.items():
        emp = bpy.data.objects.new(f"point:{name}", None)
        emp.location = at
        bpy.context.scene.collection.objects.link(emp)
    for name, at in (pivots or {}).items():
        emp = bpy.data.objects.new(f"pivot:{name}", None)
        emp.location = at
        bpy.context.scene.collection.objects.link(emp)
