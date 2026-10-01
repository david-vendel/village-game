"""Construction elements: what a building is made of, in the order it is built.

Pure Python (no Blender): the architecture rules (core/*.py) produce a list
of these, tests check them, and blender/ turns them into meshes.

Model space per ASSET_SPEC §3: metres, +Z up, the front faces -Y (the street),
origin at the centre of the building's front on the ground.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

STAGES = ("staking", "foundation", "frame", "walls", "roof")

Vec3 = tuple[float, float, float]


@dataclass
class Element:
    """One piece of the building.

    shape:
      "box"    a rectangular block: size (x, y, z) about its centre `at`, turned by `rot` (radians, XYZ euler)
      "beam"   a squared timber from `a` to `b` with cross-section (w, h); `at`/`size`/`rot` are derived
      "stone"  an irregular fieldstone filling the box (the Blender layer roughens it)
      "roof"   a thatch shell, from `params` (see roof_params)
      "leanto" a mono-pitch roof slab, from `params`
    """

    id: str
    kind: str  # footing-stone, sill, post, girt, brace, plate, tie-beam, rafter, collar, batten, wattle, daub, thatch, ...
    material: str
    stage: str
    shape: str = "box"
    at: Vec3 = (0.0, 0.0, 0.0)
    size: Vec3 = (0.0, 0.0, 0.0)
    rot: Vec3 = (0.0, 0.0, 0.0)
    a: Vec3 | None = None
    b: Vec3 | None = None
    params: dict = field(default_factory=dict)
    # ids of the elements this one rests on or is fixed to (structural sanity, stage order)
    on: list[str] = field(default_factory=list)
    # "variant:upgraded", "novariant:upgraded", "scaffold", "part:doorOpen"
    tags: set[str] = field(default_factory=set)
    order: int = 0

    def __post_init__(self) -> None:
        if self.stage not in STAGES:
            raise ValueError(f"{self.id}: unknown stage {self.stage!r}")
        if self.shape == "beam":
            assert self.a is not None and self.b is not None
            self.at, self.size, self.rot = beam_transform(self.a, self.b, self.size[0], self.size[1])

    # --- geometry helpers --------------------------------------------------------

    def bounds(self) -> tuple[Vec3, Vec3]:
        """Axis-aligned bounds (min, max) of the element's box (beams included), or of a roof's params."""
        if self.shape in ("roof", "leanto", "gable"):
            return tuple(self.params["min"]), tuple(self.params["max"])  # type: ignore[return-value]
        if any(abs(r) > 1e-9 for r in self.rot):
            # rotated box: bound its corners
            corners = [rotate((sx * self.size[0] / 2, sy * self.size[1] / 2, sz * self.size[2] / 2), self.rot) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
            lo = tuple(self.at[i] + min(c[i] for c in corners) for i in range(3))
            hi = tuple(self.at[i] + max(c[i] for c in corners) for i in range(3))
            return lo, hi  # type: ignore[return-value]
        lo = tuple(self.at[i] - self.size[i] / 2 for i in range(3))
        hi = tuple(self.at[i] + self.size[i] / 2 for i in range(3))
        return lo, hi  # type: ignore[return-value]

    @property
    def bottom(self) -> float:
        return self.bounds()[0][2]

    @property
    def top(self) -> float:
        return self.bounds()[1][2]

    def length(self) -> float:
        assert self.a and self.b
        return math.dist(self.a, self.b)


def rotate(v: Vec3, rot: Vec3) -> Vec3:
    """Rotate v by XYZ euler angles (Blender's default order: X, then Y, then Z)."""
    x, y, z = v
    rx, ry, rz = rot
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x, y, z)


def beam_transform(a: Vec3, b: Vec3, w: float, h: float) -> tuple[Vec3, Vec3, Vec3]:
    """Centre, size and XYZ euler rotation of a squared timber from a to b.

    The box's local X runs along the beam; local Y is its width (horizontal),
    local Z its height (as near vertical as the beam allows)."""
    d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    length = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    centre = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    yaw = math.atan2(d[1], d[0])
    pitch = math.atan2(d[2], math.hypot(d[0], d[1]))
    # local X -> direction: first tilt up about Y (negative: +X towards +Z), then turn about Z
    return centre, (length, w, h), (0.0, -pitch, yaw)


def by_id(elements: list[Element]) -> dict[str, Element]:
    out: dict[str, Element] = {}
    for e in elements:
        if e.id in out:
            raise ValueError(f"duplicate element id {e.id}")
        out[e.id] = e
    return out
