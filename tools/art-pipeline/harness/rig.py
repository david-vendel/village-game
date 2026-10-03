"""Camera and light rigs of docs/art/ASSET_SPEC.md §3-4, as plain maths.

Pure Python (no Blender, no numpy), so it is unit-tested on its own
(tests/test_rig.py) and the Blender layer only applies what it computes.

Model space: metres, +Z up, the object's front faces -Y, origin at the centre
of the front wall on the ground. Camera space: x right, y up, z towards the
camera (Blender's camera looks down its -Z), in metres.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

UNITS_PER_METER = 20

# yaw: camera orbit about Z from the front (+ = to the front-right); pitch: looking down;
# shear: oblique projection, the model sheared x += shear * depth before the camera sees it (§3).
# The street view is oblique, like today's art: the front at true width on a level ground line,
# the right side wall receding up-right (0.55 right per unit of depth, as OX in render/buildings.ts).
VIEWS: dict[str, tuple[float, float, float]] = {
    "street": (0.0, 15.0, 0.55),
    "roadsideL": (-75.0, 15.0, 0.0),
    "roadsideR": (75.0, 15.0, 0.0),
    "side": (15.0, 10.0, 0.0),
    "backdrop": (0.0, 5.0, 0.0),
    # front-right three-quarter, as the reference pictures of an asset are drawn (tools/asset)
    "threequarter": (32.0, 14.0, 0.0),
}

# §4: direction *to* the sun in camera space; the fill from above-right
SUN_CAMERA = (-0.71, 0.57, 0.41)
FILL_CAMERA = (0.55, 0.75, 0.37)
SUN_KELVIN = 4300.0
FILL_KELVIN = 9000.0
SUN_ANGLE_DEG = 2.0
KEY_TO_FILL = 3.0

# far enough that nothing of the model is behind the camera
CAMERA_DISTANCE = 60.0

Vec3 = tuple[float, float, float]


def _norm(v: Vec3) -> Vec3:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    return (v[0] / n, v[1] / n, v[2] / n)


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


@dataclass(frozen=True)
class Camera:
    """An orthographic camera looking at the origin: its axes in model space."""

    yaw: float
    pitch: float
    shear: float
    right: Vec3
    up: Vec3
    back: Vec3  # towards the camera (camera +z)

    @property
    def position(self) -> Vec3:
        return tuple(c * CAMERA_DISTANCE for c in self.back)  # type: ignore[return-value]

    def sheared(self, p: Vec3) -> Vec3:
        """A model point as rendered: sheared along x by its depth (y) for an oblique view."""
        return (p[0] + self.shear * p[1], p[1], p[2])

    def project(self, q: Vec3) -> Vec3:
        """A point of the rendered (sheared) scene -> camera space."""
        return (_dot(q, self.right), _dot(q, self.up), _dot(q, self.back))

    def to_camera(self, p: Vec3) -> Vec3:
        """Model point -> camera space (x right, y up, z towards the camera), metres, origin at the model origin."""
        return self.project(self.sheared(p))

    def shear_matrix(self) -> list[list[float]]:
        """4x4 model -> rendered-scene matrix (the oblique shear; identity for a plain view)."""
        return [[1.0, self.shear, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]

    def to_model(self, v: Vec3) -> Vec3:
        """Camera-space direction -> model-space direction."""
        return tuple(v[0] * self.right[i] + v[1] * self.up[i] + v[2] * self.back[i] for i in range(3))  # type: ignore[return-value]

    def matrix(self) -> list[list[float]]:
        """4x4 camera-to-model matrix (columns: right, up, back, position), as Blender's matrix_world."""
        p = self.position
        return [
            [self.right[0], self.up[0], self.back[0], p[0]],
            [self.right[1], self.up[1], self.back[1], p[1]],
            [self.right[2], self.up[2], self.back[2], p[2]],
            [0.0, 0.0, 0.0, 1.0],
        ]


def camera_for(view: str) -> Camera:
    """The camera of a spec view (§3)."""
    yaw, pitch, shear = VIEWS[view]
    y = math.radians(yaw)
    p = math.radians(pitch)
    # yaw 0 looks at the front from -Y; + yaw orbits to the front-right (+X)
    back = _norm((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    right = _norm(_cross((0.0, 0.0, 1.0), back))
    up = _cross(back, right)
    return Camera(yaw, pitch, shear, right, up, back)


def sun_direction(cam: Camera) -> Vec3:
    """Model-space direction towards the sun: the key is fixed relative to the camera (§4)."""
    return _norm(cam.to_model(_norm(SUN_CAMERA)))


def fill_direction(cam: Camera) -> Vec3:
    return _norm(cam.to_model(_norm(FILL_CAMERA)))


def shadow_on_ground(p: Vec3, to_sun: Vec3) -> Vec3:
    """Where point p's shadow falls on the ground plane z = 0."""
    if p[2] <= 0 or to_sun[2] <= 1e-6:
        return (p[0], p[1], 0.0)
    t = p[2] / to_sun[2]
    return (p[0] - to_sun[0] * t, p[1] - to_sun[1] * t, 0.0)


@dataclass(frozen=True)
class Frame:
    """The image rectangle in camera space, in world units (u), snapped to whole units.

    left/right/bottom/top are camera-space x/y of the edges (y up). The model
    origin projects to (0, 0), so the anchor is (-left, top) from the top-left.
    """

    left: int
    right: int
    bottom: int
    top: int

    @property
    def size(self) -> tuple[int, int]:
        return (self.right - self.left, self.top - self.bottom)

    @property
    def anchor(self) -> tuple[int, int]:
        return (-self.left, self.top)

    def to_image(self, cam_xy: tuple[float, float]) -> tuple[float, float]:
        """Camera-space point (metres) -> image position in u from the top-left, y down."""
        x = cam_xy[0] * UNITS_PER_METER
        y = cam_xy[1] * UNITS_PER_METER
        return (x - self.left, self.top - y)

    def blender_camera(self) -> dict[str, float]:
        """Ortho scale and lens shift for a Blender camera at the origin's projection centre."""
        w, h = self.size
        big = max(w, h)
        cx = (self.left + self.right) / 2
        cy = (self.bottom + self.top) / 2
        return {"ortho_scale": big / UNITS_PER_METER, "shift_x": cx / big, "shift_y": cy / big}

    def resolution(self, tier: int) -> tuple[int, int]:
        w, h = self.size
        return (w * tier, h * tier)


def frame_around(cam: Camera, points: list[Vec3], margin_u: int = 2, with_shadow: bool = True) -> Frame:
    """The smallest whole-unit frame holding every model point (and, with_shadow, its ground shadow), plus a margin."""
    if not points:
        raise ValueError("nothing to frame")
    to_sun = sun_direction(cam)
    xs: list[float] = []
    ys: list[float] = []
    for p in points:
        s = cam.sheared(p)  # shadows fall in the rendered (sheared) scene
        for q in (s, shadow_on_ground(s, to_sun)) if with_shadow else (s,):
            c = cam.project(q)
            xs.append(c[0] * UNITS_PER_METER)
            ys.append(c[1] * UNITS_PER_METER)
    return Frame(
        left=math.floor(min(xs)) - margin_u,
        right=math.ceil(max(xs)) + margin_u,
        bottom=math.floor(min(ys)) - margin_u,
        top=math.ceil(max(ys)) + margin_u,
    )


def depth_u(cam_z: float) -> float:
    """Camera-space z (metres, towards the camera) -> depth layer value: u from the anchor plane towards the camera."""
    return cam_z * UNITS_PER_METER
