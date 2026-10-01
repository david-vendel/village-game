"""Exposure calibration for the lighting key (ASSET_SPEC §4: plaster in sun at sRGB 225-235).

    blender -b -P tools/art-pipeline/calibrate.py

Renders a limewash plaster card square to the sun (full sun), in the street view, at several
exposures and prints the sRGB it comes out at, and the exposure that gives 230.
Set that as Job.exposure's default in harness/blender_render.py."""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from harness import blender_render as br, rig  # noqa: E402

# limewashed plaster, as the building generator's material library uses
PLASTER = (0.80, 0.76, 0.66)
TARGET = 230.0

bpy.ops.wm.read_factory_settings(use_empty=True)
root = bpy.data.collections.new("Asset")
bpy.context.scene.collection.children.link(root)
bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 1.0))
card = bpy.context.object
# face the sun: the plane's normal (+Z) along the direction to the sun
from mathutils import Vector  # noqa: E402

card.rotation_euler = Vector(rig.sun_direction(rig.camera_for("street"))).to_track_quat("Z", "Y").to_euler()
for c in card.users_collection:
    c.objects.unlink(card)
root.objects.link(card)
mat = bpy.data.materials.new("plaster")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*PLASTER, 1)
mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
card.data.materials.append(mat)

job = br.Job(id="calibration", out=tempfile.mkdtemp(), samples=32, view_transform=os.environ.get("VT", "Standard"), look=os.environ.get("LOOK", "None"))
br.setup_render(job)
cam = rig.camera_for("street")
frame = rig.Frame(-24, 24, 0, 40)
br.setup_light(cam, job)
br.setup_camera(cam, frame, 1)
sc = bpy.context.scene
sc.use_nodes = False


def measure(exposure: float) -> float:
    sc.view_settings.exposure = exposure
    path = os.path.join(job.out, "card.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"  # the encoded sRGB values, not linearised
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4)
    centre = px[h // 2 - 3 : h // 2 + 3, w // 2 - 3 : w // 2 + 3, :3]
    return float(centre.mean() * 255)


lo, hi = -2.0, 4.0
for e in (-1.0, 0.0, 0.5, 1.0, 1.5):
    print(f"calibrate: exposure {e:+.2f} -> plaster sRGB {measure(e):.0f}")
for _ in range(8):
    mid = (lo + hi) / 2
    if measure(mid) < TARGET:
        lo = mid
    else:
        hi = mid
print(f"calibrate: {job.view_transform}/{job.look}: exposure {(lo + hi) / 2:.3f} gives plaster in sun at sRGB {measure((lo + hi) / 2):.0f} (target {TARGET:.0f})")
