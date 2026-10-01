"""Scene builder for the render harness: the farm (core/farm.py) in Blender.

    npm run art:render -- tools/building-gen/scenes/farm.py tools/building-gen/scenes/farm.job.json
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from blender.build import build_scene  # noqa: E402
from core.farm import SPEC, farm, points  # noqa: E402


def build() -> None:
    pts = points()
    build_scene(farm(SPEC), pts, pivots={"doorOpen": pts["door"]})
