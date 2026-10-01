"""The Blender side of the harness: sets up the spec camera and light for a
view, renders every configuration of a scene (finished look, variants,
construction stages, parts) with all passes, and writes them as raw files
plus meta.json for pack.ts. Runs inside Blender (imports bpy).

Scene contract (see tools/art-pipeline/README.md):
- collection `Asset` holds everything rendered; child collections tag what
  they hold: `stage:<stage>` (built in that stage), `scaffold` (stage images
  only), `variant:<name>` (only in that look), `novariant:<name>` (hidden in
  that look), `part:<name>` (a separately drawn part, not in the body);
  `scaffold` inside a `stage:` collection goes up in that stage;
- empties `point:<name>` mark named points, `pivot:<part>` a part's pivot;
- materials that light up at night multiply their emission by the output of
  the node group `Lights` (the harness sets it 0 for colour, 1 for emissive).
"""

from __future__ import annotations

import glob
import json
import math
import os
import re
from dataclasses import dataclass, field, fields

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import rig

STAGES = ["staking", "foundation", "frame", "walls", "roof"]
LIGHTS_GROUP = "Lights"


@dataclass
class Job:
    """What to render: read from the job JSON (see README)."""

    id: str
    out: str = ""
    views: list[str] = field(default_factory=lambda: ["street"])
    tier: int = 4
    samples: int = 128
    emissive_samples: int = 32
    # calibrated (calibrate.py): limewash plaster square to the sun comes out at sRGB 230 (§4).
    # Standard, not AgX: AgX needs ~3 stops more to reach that and washes the colours out
    exposure: float = -0.37
    view_transform: str = "Standard"
    look: str = "None"
    # key light irradiance on a surface facing the sun (Cycles sun strength)
    sun_strength: float = 4.0
    margin: int = 2
    device: str = os.environ.get("ART_DEVICE", "GPU")
    # copied into the manifest entry (ASSET_SPEC §13); pack.ts fills in a default
    source: dict | None = None

    @staticmethod
    def load(path: str) -> "Job":
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        known = {f.name for f in fields(Job)}
        return Job(**{k: v for k, v in data.items() if k in known})


# --- the scene's tags ----------------------------------------------------------


def _tags_by_object() -> dict[str, set[str]]:
    """Every object under `Asset`, with the tags of all collections it sits in (and their parents)."""
    root = bpy.data.collections.get("Asset")
    if root is None:
        raise RuntimeError("the scene has no collection named 'Asset'")
    out: dict[str, set[str]] = {}

    def walk(col: bpy.types.Collection, tags: set[str]) -> None:
        # Blender makes names unique ("scaffold.001"): the tag is the name without that suffix
        name = re.sub(r"\.\d{3}$", "", col.name)
        here = tags | ({name} if ":" in name or name == "scaffold" else set())
        for obj in col.objects:
            out.setdefault(obj.name, set()).update(here)
        for child in col.children:
            walk(child, here)

    walk(root, set())
    return out


@dataclass(frozen=True)
class Config:
    """One image to render: the finished look of a variant, a construction stage, or a part."""

    kind: str  # "look" | "stage" | "part"
    name: str  # variant name, stage name or part name

    @property
    def key(self) -> str:
        return {"look": self.name, "stage": f"stage-{self.name}", "part": f"part-{self.name}"}[self.kind]


def configs_of(tags: dict[str, set[str]], view: str) -> list[Config]:
    """The images a scene gives for a view: every look; stages and parts in the street view only."""
    all_tags = set().union(*tags.values()) if tags else set()
    variants = sorted({t.split(":", 1)[1] for t in all_tags if t.startswith(("variant:", "novariant:"))})
    out = [Config("look", "default")] + [Config("look", v) for v in variants]
    if view == "street":
        present = {t.split(":", 1)[1] for t in all_tags if t.startswith("stage:")}
        if present:
            missing = [s for s in STAGES if s not in present]
            if missing:
                raise RuntimeError(f"stage collections missing: {', '.join(missing)} (all five or none)")
            out += [Config("stage", s) for s in STAGES]
        out += [Config("part", p) for p in sorted({t.split(":", 1)[1] for t in all_tags if t.startswith("part:")})]
    return out


def visible(obj_tags: set[str], cfg: Config) -> bool:
    """Whether an object is in the body image of a configuration (parts are drawn separately)."""
    parts = [t for t in obj_tags if t.startswith("part:")]
    variant = "default" if cfg.kind != "look" else cfg.name
    for t in obj_tags:
        if t.startswith("variant:") and t.split(":", 1)[1] != variant:
            return False
        if t.startswith("novariant:") and t.split(":", 1)[1] == variant:
            return False
    if cfg.kind == "part":
        return f"part:{cfg.name}" in obj_tags
    if parts:
        return False
    if cfg.kind == "stage":
        # what was built (or put up, for scaffolding and stakes) by the end of this stage
        stage = next((t.split(":", 1)[1] for t in obj_tags if t.startswith("stage:")), None)
        return stage is None or STAGES.index(stage) <= STAGES.index(cfg.name)
    return "scaffold" not in obj_tags


def apply_visibility(tags: dict[str, set[str]], cfg: Config) -> None:
    for name, t in tags.items():
        obj = bpy.data.objects[name]
        if obj.type == "EMPTY":
            continue
        # a part renders alone: the game draws it over the body
        obj.hide_render = not visible(t, cfg)


# --- render settings, camera, light --------------------------------------------


def setup_render(job: Job) -> None:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    if job.device == "GPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"  # GTX 1070: CUDA beats OptiX (no RT cores), see docs/art/README.md
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "CUDA"
        sc.cycles.device = "GPU"
    else:
        sc.cycles.device = "CPU"
    sc.cycles.samples = job.samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.film_transparent = True
    sc.render.use_persistent_data = True  # keep the scene on the GPU between the many renders
    sc.render.resolution_percentage = 100
    sc.render.pixel_aspect_x = sc.render.pixel_aspect_y = 1
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "16"
    sc.render.image_settings.compression = 15
    sc.view_settings.view_transform = job.view_transform
    sc.view_settings.look = job.look
    sc.view_settings.exposure = job.exposure
    sc.view_settings.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    sc.sequencer_colorspace_settings.name = "sRGB"
    sc.frame_set(1)

    vl = sc.view_layers[0]
    vl.use_pass_normal = True
    vl.use_pass_z = True
    vl.use_pass_ambient_occlusion = True
    vl.use_pass_emit = True
    vl.use_pass_diffuse_color = True
    vl.cycles.use_pass_shadow_catcher = True
    if "mask" not in vl.aovs:
        aov = vl.aovs.add()
        aov.name = "mask"
        aov.type = "COLOR"
    sc.world = sc.world or bpy.data.worlds.new("World")
    sc.world.light_settings.distance = 1.0  # AO distance, metres


def _blackbody(nodes: bpy.types.Nodes, kelvin: float) -> bpy.types.Node:
    bb = nodes.new("ShaderNodeBlackbody")
    bb.inputs["Temperature"].default_value = kelvin
    return bb


def _sun(name: str, direction: tuple[float, float, float], strength: float, kelvin: float, angle_deg: float) -> None:
    data = bpy.data.lights.get(name) or bpy.data.lights.new(name, "SUN")
    data.energy = strength
    data.angle = math.radians(angle_deg)
    data.use_nodes = True
    nodes = data.node_tree.nodes
    nodes.clear()
    emit = nodes.new("ShaderNodeEmission")
    out = nodes.new("ShaderNodeOutputLight")
    data.node_tree.links.new(_blackbody(nodes, kelvin).outputs[0], emit.inputs["Color"])
    data.node_tree.links.new(emit.outputs[0], out.inputs[0])
    obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, data)
    if obj.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(obj)
    # a sun shines along its -Z: point -Z away from the sun
    obj.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()


def setup_light(cam: rig.Camera, job: Job) -> None:
    """Key sun from the left (§4), soft fill from above-right and a sky, key:fill about 3:1."""
    _sun("rig.key", rig.sun_direction(cam), job.sun_strength, rig.SUN_KELVIN, rig.SUN_ANGLE_DEG)
    fill_total = job.sun_strength / rig.KEY_TO_FILL
    # half the fill from a broad sun above-right, half from the sky (uniform sky of radiance L gives πL)
    _sun("rig.fill", rig.fill_direction(cam), fill_total / 2, rig.FILL_KELVIN, 40.0)
    w = bpy.context.scene.world
    w.use_nodes = True
    nodes = w.node_tree.nodes
    nodes.clear()
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = (fill_total / 2) / math.pi
    out = nodes.new("ShaderNodeOutputWorld")
    w.node_tree.links.new(_blackbody(nodes, rig.FILL_KELVIN).outputs[0], bg.inputs["Color"])
    w.node_tree.links.new(bg.outputs[0], out.inputs[0])


def setup_ground(frame_size_m: float) -> bpy.types.Object:
    """A shadow-catching ground plane at z = 0, large enough for any frame."""
    obj = bpy.data.objects.get("rig.ground")
    if obj is None:
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
        obj = bpy.context.object
        obj.name = "rig.ground"
        mat = bpy.data.materials.new("rig.ground")
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.30, 0.22, 1)
        mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        obj.data.materials.append(mat)
    obj.scale = (frame_size_m * 4, frame_size_m * 4, 1)
    obj.is_shadow_catcher = True
    obj.hide_render = False
    return obj


def setup_camera(cam: rig.Camera, frame: rig.Frame, tier: int) -> bpy.types.Object:
    data = bpy.data.cameras.get("rig.camera") or bpy.data.cameras.new("rig.camera")
    obj = bpy.data.objects.get("rig.camera") or bpy.data.objects.new("rig.camera", data)
    if obj.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(obj)
    data.type = "ORTHO"
    data.sensor_fit = "AUTO"
    params = frame.blender_camera()
    data.ortho_scale = params["ortho_scale"]
    data.shift_x = params["shift_x"]
    data.shift_y = params["shift_y"]
    data.clip_start = 0.1
    data.clip_end = rig.CAMERA_DISTANCE * 2
    obj.matrix_world = Matrix(cam.matrix())
    sc = bpy.context.scene
    sc.camera = obj
    sc.render.resolution_x, sc.render.resolution_y = frame.resolution(tier)
    return obj


def set_lights(on: bool) -> None:
    group = bpy.data.node_groups.get(LIGHTS_GROUP)
    if group is None:
        return
    for node in group.nodes:
        if node.type == "VALUE":
            node.outputs[0].default_value = 1.0 if on else 0.0


def apply_shear(tags: dict[str, set[str]], cam: rig.Camera) -> list[bpy.types.Object]:
    """Shear the scene for an oblique view: root objects get a parent whose parent-inverse
    matrix is the shear (object transforms can't hold a shear themselves). Returns them."""
    if cam.shear == 0:
        return []
    pivot = bpy.data.objects.get("rig.shear") or bpy.data.objects.new("rig.shear", None)
    if pivot.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(pivot)
    roots = [bpy.data.objects[n] for n in tags if bpy.data.objects[n].parent is None and bpy.data.objects[n].type != "EMPTY"]
    shear = Matrix(cam.shear_matrix())
    for obj in roots:
        obj.parent = pivot
        obj.matrix_parent_inverse = shear
    return roots


def remove_shear(roots: list[bpy.types.Object]) -> None:
    for obj in roots:
        obj.parent = None
        obj.matrix_parent_inverse = Matrix.Identity(4)


# --- geometry for framing --------------------------------------------------------


def model_points(tags: dict[str, set[str]], cfgs: list[Config]) -> list[tuple[float, float, float]]:
    """World-space vertices of everything any configuration shows (bounding boxes, for speed)."""
    pts: list[tuple[float, float, float]] = []
    for name, t in tags.items():
        obj = bpy.data.objects[name]
        if obj.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        if not any(visible(t, c) for c in cfgs):
            continue
        for corner in obj.bound_box:
            pts.append(tuple(obj.matrix_world @ Vector(corner)))
    return pts


def named_points(cam: rig.Camera, frame: rig.Frame, prefix: str) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for obj in bpy.data.objects:
        if obj.type == "EMPTY" and obj.name.startswith(prefix):
            x, y = frame.to_image(cam.to_camera(tuple(obj.matrix_world.translation))[:2])
            out[obj.name[len(prefix):]] = [round(x, 2), round(y, 2)]
    return out


# --- passes ----------------------------------------------------------------------


def _file_output(dir_: str) -> None:
    """Compositor: write the data passes as float EXRs next to the colour PNG."""
    sc = bpy.context.scene
    sc.use_nodes = True
    tree = sc.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], comp.inputs["Image"])
    fo = tree.nodes.new("CompositorNodeOutputFile")
    fo.base_path = dir_
    fo.format.file_format = "OPEN_EXR"
    fo.format.color_depth = "32"
    fo.format.exr_codec = "ZIP"
    fo.file_slots.clear()
    for socket, name in [("Normal", "normal"), ("Depth", "depth"), ("AO", "ao"), ("Emit", "emit"), ("DiffCol", "albedo"), ("Shadow Catcher", "catcher"), ("mask", "mask"), ("Alpha", "alpha")]:
        if socket not in rl.outputs or not rl.outputs[socket].enabled:
            continue
        fo.file_slots.new(name + "_")
        tree.links.new(rl.outputs[socket], fo.inputs[name + "_"])


def _read_exr(dir_: str, name: str) -> np.ndarray:
    """A pass written by the file output node (name_0001.exr), as float32 HxWx4, top row first."""
    path = sorted(glob.glob(os.path.join(dir_, f"{name}_*.exr")))[-1]
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(path)
    return px.reshape(h, w, 4)[::-1].copy()


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def render_config(cam: rig.Camera, cfg: Config, dir_: str, job: Job) -> dict[str, str]:
    """Render one image's colour and passes into dir_; returns layer -> file name."""
    os.makedirs(dir_, exist_ok=True)
    sc = bpy.context.scene
    files: dict[str, str] = {}

    # daylight: colour, shadow, normals, depth, AO, albedo, mask
    set_lights(False)
    sc.cycles.samples = job.samples
    _file_output(dir_)
    sc.render.filepath = os.path.join(dir_, "color.png")
    bpy.ops.render.render(write_still=True)
    files["color"] = "color.png"

    alpha = _read_exr(dir_, "alpha")[..., 0]
    seen = alpha > 0
    n = _read_exr(dir_, "normal")[..., :3]
    # world -> camera space (x right, y up, z towards the camera), zero where nothing was drawn
    view = np.stack([n @ np.array(cam.right), n @ np.array(cam.up), n @ np.array(cam.back)], axis=-1)
    view[~seen] = 0
    np.save(os.path.join(dir_, "normal.npy"), view.astype(np.float32))
    files["normal"] = "normal.npy"

    z = _read_exr(dir_, "depth")[..., 0]
    depth = rig.depth_u(rig.CAMERA_DISTANCE - z)
    depth[~seen] = 0
    np.save(os.path.join(dir_, "depth.npy"), depth.astype(np.float32))
    files["depth"] = "depth.npy"

    np.save(os.path.join(dir_, "ao.npy"), np.where(seen, _read_exr(dir_, "ao")[..., 0], 1).astype(np.float32))
    files["ao"] = "ao.npy"
    np.save(os.path.join(dir_, "albedo.npy"), _linear_to_srgb(_read_exr(dir_, "albedo")[..., :3]).astype(np.float32))
    files["albedo"] = "albedo.npy"
    catcher = _read_exr(dir_, "catcher")[..., :3].mean(axis=-1)
    np.save(os.path.join(dir_, "shadow.npy"), np.clip(1 - catcher, 0, 1).astype(np.float32))
    files["shadow"] = "shadow.npy"
    if glob.glob(os.path.join(dir_, "mask_*.exr")):
        mask = _read_exr(dir_, "mask")
        if mask[..., :3].max() > 0:
            np.save(os.path.join(dir_, "mask.npy"), np.clip(mask, 0, 1).astype(np.float32))
            files["mask"] = "mask.npy"
    # daylight emission isn't used: the night render has it
    for leftover in glob.glob(os.path.join(dir_, "*.exr")):
        os.remove(leftover)

    # night: only the lights, for the emissive layer (not for a house still being built: nobody lives there)
    if cfg.kind != "stage" and bpy.data.node_groups.get(LIGHTS_GROUP) is not None:
        set_lights(True)
        sc.cycles.samples = job.emissive_samples
        _file_output(dir_)
        sc.render.filepath = os.path.join(dir_, "night.png")
        bpy.ops.render.render(write_still=True)
        emit = _read_exr(dir_, "emit")[..., :3]
        # light brighter than 1 would clip channel by channel and turn white: scale it down, keeping its hue
        emit = _linear_to_srgb(emit / np.maximum(1.0, emit.max(axis=-1, keepdims=True)))
        for leftover in glob.glob(os.path.join(dir_, "*.exr")):
            os.remove(leftover)
        os.remove(os.path.join(dir_, "night.png"))
        set_lights(False)
        if emit.max() > 0.01:
            np.save(os.path.join(dir_, "emissive.npy"), emit.astype(np.float32))
            files["emissive"] = "emissive.npy"
    return files


# --- the whole job --------------------------------------------------------------------


def run(job: Job) -> dict:
    """Render every view and configuration of the open scene; writes job.out/meta.json."""
    setup_render(job)
    tags = _tags_by_object()
    meta: dict = {"id": job.id, "tier": job.tier, "views": {}}
    if job.source:
        meta["source"] = job.source
    for view in job.views:
        cam = rig.camera_for(view)
        cfgs = configs_of(tags, view)
        frame = rig.frame_around(cam, model_points(tags, cfgs), job.margin)
        setup_light(cam, job)
        setup_ground(max(frame.size) / rig.UNITS_PER_METER)
        setup_camera(cam, frame, job.tier)
        sheared = apply_shear(tags, cam)
        images = {}
        for cfg in cfgs:
            apply_visibility(tags, cfg)
            dir_ = os.path.join(job.out, view, cfg.key)
            files = render_config(cam, cfg, dir_, job)
            entry = {"kind": cfg.kind, "name": cfg.name, "dir": f"{view}/{cfg.key}", "files": files}
            if cfg.kind == "part":
                pivot = named_points(cam, frame, "pivot:").get(cfg.name)
                if pivot is None:
                    raise RuntimeError(f"part '{cfg.name}' has no empty 'pivot:{cfg.name}'")
                entry["pivot"] = pivot
            images[cfg.key] = entry
        remove_shear(sheared)
        meta["views"][view] = {
            "frame": {"left": frame.left, "right": frame.right, "bottom": frame.bottom, "top": frame.top},
            "size": list(frame.size),
            "anchor": list(frame.anchor),
            "points": named_points(cam, frame, "point:"),
            "images": images,
        }
    os.makedirs(job.out, exist_ok=True)
    with open(os.path.join(job.out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return meta
