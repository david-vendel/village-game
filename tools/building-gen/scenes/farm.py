"""Scene builder for the render harness: the farm in Blender.

    npm run art:render -- tools/building-gen/scenes/farm.py tools/building-gen/scenes/farm.job.json

The pieces come from the game's own generator (src/render/build3d/farm.ts) as
JSON (tools/building-gen/elements.ts), so the sprites and the real-time 3D are
the same building.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from blender.build import build_scene  # noqa: E402
from core.elements import load_generated  # noqa: E402


def build() -> None:
    elements, points = load_generated("farm", seed=7)
    build_scene(elements, points, pivots={"doorOpen": points["door"]})
