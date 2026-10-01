"""Construction elements for the Blender layer, loaded from the game's own
generator (src/render/build3d) through tools/building-gen/elements.ts, so the
architecture rules live in one place. Plain Python (no Blender).

Model space per ASSET_SPEC §3: metres, +Z up, the front faces -Y, origin at
the centre of the building's front on the ground.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from dataclasses import dataclass, field

STAGES = ("staking", "foundation", "frame", "walls", "roof")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

Vec3 = tuple[float, float, float]


@dataclass
class Element:
    """One piece of the building (see src/render/build3d/elements.ts). Beams arrive as boxes
    (centre, size, rotation already worked out); roofs, gables and lean-tos keep their params."""

    id: str
    kind: str
    material: str
    stage: str
    shape: str = "box"
    at: Vec3 = (0.0, 0.0, 0.0)
    size: Vec3 = (0.0, 0.0, 0.0)
    rot: Vec3 = (0.0, 0.0, 0.0)
    params: dict = field(default_factory=dict)
    tags: set[str] = field(default_factory=set)
    rand: float = 0.5

    @property
    def seed(self) -> int:
        return int(self.rand * 1_000_000)


def beam_transform(a: Vec3, b: Vec3, w: float, h: float) -> tuple[Vec3, Vec3, Vec3]:
    """Centre, size and XYZ euler rotation of a squared timber from a to b (as the game's beamTransform)."""
    d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    length = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    yaw = math.atan2(d[1], d[0])
    pitch = math.atan2(d[2], math.hypot(d[0], d[1]))
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), (length, w, h), (0.0, -pitch, yaw)


def load_generated(building: str, seed: int = 7) -> tuple[list[Element], dict[str, Vec3]]:
    """A building's elements and named points from the game's generator (runs Node)."""
    tsx = os.path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs")
    script = os.path.join(REPO, "tools", "building-gen", "elements.ts")
    out = subprocess.run(["node", tsx, script, building, str(seed)], capture_output=True, text=True, cwd=REPO, check=True)
    data = json.loads(out.stdout)
    elements = [
        Element(
            id=e["id"], kind=e["kind"], material=e["material"], stage=e["stage"],
            shape="box" if e["shape"] == "beam" else e["shape"],
            at=tuple(e["at"]), size=tuple(e["size"]), rot=tuple(e["rot"]),
            params=e["params"], tags=set(e["tags"]), rand=e["rand"],
        )
        for e in data["elements"]
    ]
    return elements, {k: tuple(v) for k, v in data["points"].items()}
