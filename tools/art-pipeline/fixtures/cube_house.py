"""Test scene for the harness (WP3 "test cube house"): a plain gabled house
with a lean-to, built in the five construction stages, a Large variant (an
extra bay with a second window), an open-door part, a window that lights up
at night, and the farm's points. Boxes only: it tests the pipeline, not looks.

Model space per ASSET_SPEC §3: metres, front faces -Y, origin at the centre of
the front wall on the ground."""

import bpy


def collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    parent.children.link(col)
    return col


def material(name: str, rgb, rough=0.8, glow=None) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    if glow:
        # emission strength = Lights (0 by day, 1 at night) x 6
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        g = nodes.new("ShaderNodeGroup")
        g.node_tree = lights_group()
        mul = nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = 6.0
        links.new(g.outputs[0], mul.inputs[0])
        bsdf.inputs["Emission Color"].default_value = (*glow, 1)
        links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
    return mat


def lights_group() -> bpy.types.NodeTree:
    g = bpy.data.node_groups.get("Lights")
    if g:
        return g
    g = bpy.data.node_groups.new("Lights", "ShaderNodeTree")
    g.interface.new_socket("Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
    v = g.nodes.new("ShaderNodeValue")
    v.outputs[0].default_value = 0.0
    out = g.nodes.new("NodeGroupOutput")
    g.links.new(v.outputs[0], out.inputs[0])
    return g


def box(name, size, at, mat, col, rot_z=0.0):
    """A box of size (x, y, z) with its bottom-front-left... centred on `at` in x and y, standing on at.z."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(at[0], at[1], at[2] + size[2] / 2))
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.rotation_euler[2] = rot_z
    obj.data.materials.append(mat)
    for c in obj.users_collection:
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def roof(name, width, depth, eave_z, rise, at_x, mat, col):
    """A gable roof prism, ridge along x, overhanging the walls a little."""
    w, d = width / 2 + 0.3, depth / 2 + 0.35
    verts = [(-w, -d, 0), (w, -d, 0), (w, d, 0), (-w, d, 0), (-w, 0, rise), (w, 0, rise)]
    faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (at_x, depth / 2, eave_z)
    obj.data.materials.append(mat)
    col.objects.link(obj)
    return obj


def empty(name, at):
    obj = bpy.data.objects.new(name, None)
    obj.location = at
    bpy.context.scene.collection.objects.link(obj)


def build() -> None:
    root = bpy.data.collections.new("Asset")
    bpy.context.scene.collection.children.link(root)
    plaster = material("plaster", (0.78, 0.72, 0.60))
    timber = material("timber", (0.16, 0.10, 0.06))
    stone = material("stone", (0.45, 0.42, 0.38), 0.95)
    thatch = material("thatch", (0.50, 0.38, 0.20), 1.0)
    pole = material("pole", (0.40, 0.30, 0.20))
    glass = material("window", (0.05, 0.05, 0.06), 0.3, glow=(1.0, 0.62, 0.25))
    door_wood = material("door", (0.30, 0.20, 0.12))
    dark = material("doorway", (0.02, 0.015, 0.01), 1.0)

    W, D, H = 7.0, 5.0, 3.0  # house: 7 m wide (140 u), 5 m deep, 3 m to the eaves
    st = {s: collection(f"stage:{s}", root) for s in ["staking", "foundation", "frame", "walls", "roof"]}
    stakes = collection("scaffold", st["staking"])
    for x in (-W / 2, W / 2):
        for y in (0, D):
            box(f"stake{x}{y}", (0.08, 0.08, 0.6), (x, y, 0), pole, stakes)
    box("plinth", (W + 0.2, D + 0.2, 0.4), (0, D / 2, 0), stone, st["foundation"])
    for i, x in enumerate((-W / 2 + 0.1, 0, W / 2 - 0.1)):
        for y in (0.1, D - 0.1):
            box(f"post{i}{y}", (0.22, 0.22, H - 0.4), (x, y, 0.4), timber, st["frame"])
    box("plate", (W, 0.24, 0.22), (0, 0.1, H - 0.22), timber, st["frame"])
    box("walls", (W - 0.1, D - 0.1, H - 0.4), (0, D / 2, 0.4), plaster, st["walls"])
    box("door", (1.0, 0.08, 2.0), (-1.0, -0.02, 0.4), door_wood, st["walls"])
    box("window", (0.9, 0.06, 0.8), (-2.4, -0.03, 1.6), glass, st["walls"])
    scaff = collection("scaffold", st["walls"])
    for x in (-W / 2 - 0.6, 0, W / 2 + 0.6):
        box(f"pole{x}", (0.1, 0.1, H + 0.8), (x, -0.8, 0), pole, scaff)
    box("board", (W + 1.6, 0.4, 0.06), (0, -0.8, 1.8), pole, scaff)
    roof("roof", W, D, H, 3.2, 0, thatch, st["roof"])
    box("chimney", (0.5, 0.5, 2.6), (1.6, D / 2 + 0.6, H + 1.4), stone, st["roof"])

    big = collection("variant:upgraded", root)
    box("bay", (2.4, D - 0.4, H - 0.6), (W / 2 + 1.2, D / 2, 0), plaster, big)
    box("bayRoof", (2.8, D, 0.25), (W / 2 + 1.25, D / 2, H - 0.6), thatch, big)
    box("window2", (0.8, 0.06, 0.7), (W / 2 + 1.2, 0.17, 1.3), glass, big)

    door_open = collection("part:doorOpen", root)
    box("doorway", (1.0, 0.02, 2.0), (-1.0, -0.07, 0.4), dark, door_open)
    leaf = box("doorLeaf", (1.0, 0.08, 2.0), (-1.5 + 0.04, -0.5, 0.4), door_wood, door_open, rot_z=1.45)

    empty("point:door", (-1.0, 0.0, 0.0))
    empty("point:smoke:0", (1.6, D / 2 + 0.6, H + 4.0))
    empty("point:sleep:0", (-2.4, 0.0, 3.6))
    empty("pivot:doorOpen", (-1.0, 0.0, 0.0))
