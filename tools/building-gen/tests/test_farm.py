"""The farm's architecture rules (docs/art/PLAN.md WP4): proportions, structural
sanity, fit to the game's layout, construction order.

    python -m unittest discover -s tools/building-gen/tests
"""

import math
import os
import re
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))

from core.elements import STAGES, beam_transform, by_id, rotate  # noqa: E402
from core.farm import SPEC, farm, farm_look, points  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def game_const(path: str, pattern: str) -> float:
    with open(os.path.join(REPO, path), encoding="utf-8") as f:
        return float(re.search(pattern, f.read(), re.S).group(1))


U = 20.0  # world units per metre
FARM_WIDTH = game_const("src/game/buildings.ts", r"farm: \{.*?width: (\d+)") / U
HOME_DX = game_const("src/game/layout.ts", r"export const HOME = \{ dx: (-?\d+)") / U
STORE_DX = game_const("src/game/layout.ts", r"export const STORE = \{ dx: (-?\d+)") / U

EPS = 1e-6


def body(elements):
    """What stands in a finished look: no scaffolding, stakes or parts."""
    return [e for e in elements if "scaffold" not in e.tags and not any(t.startswith("part:") for t in e.tags)]


class BeamTest(unittest.TestCase):
    def test_beam_transform_puts_the_box_between_its_ends(self):
        for a, b in [((0, 0, 0), (2, 0, 0)), ((0, 0, 0), (1, 0, 1)), ((1, 2, 0), (1, 5, 3)), ((0, 0, 0), (0, 0, 2))]:
            c, size, rot = beam_transform(a, b, 0.2, 0.1)
            end = rotate((size[0] / 2, 0, 0), rot)
            self.assertTrue(all(abs(c[i] + end[i] - b[i]) < 1e-9 for i in range(3)), (a, b))
            self.assertAlmostEqual(size[0], math.dist(a, b))


class FarmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.all = farm()
        cls.looks = {"default": farm_look(False), "upgraded": farm_look(True)}

    def test_ids_are_unique_and_stages_valid(self):
        ids = by_id(self.all)
        self.assertGreater(len(ids), 150)
        for e in self.all:
            self.assertIn(e.stage, STAGES)

    def test_fits_the_game_footprint_in_both_looks(self):
        self.assertEqual(FARM_WIDTH, 10.0)
        for name, els in self.looks.items():
            walls = [e for e in body(els) if e.kind in ("footing-stone", "pad-stone", "plank", "sill", "post")]
            lo = min(e.bounds()[0][0] for e in walls)
            hi = max(e.bounds()[1][0] for e in walls)
            self.assertAlmostEqual(lo, -FARM_WIDTH / 2, delta=0.25, msg=name)
            self.assertAlmostEqual(hi, FARM_WIDTH / 2, delta=0.25, msg=name)

    def test_door_is_at_the_farmers_home_spot(self):
        door = by_id(self.all)["door"]
        self.assertAlmostEqual(door.at[0], HOME_DX, places=6)
        self.assertAlmostEqual(points()["door"][0], HOME_DX, places=6)

    def test_grain_store_ground_is_clear(self):
        # the pallet spans STORE.dx ± 24 u in front of the house; sheaves stand ~1.7 m tall
        x0, x1 = STORE_DX - 1.25, STORE_DX + 1.25
        for name, els in self.looks.items():
            for e in body(els):
                (ax, ay, az), (bx, by, bz) = e.bounds()
                if e.kind in ("thatch", "ridge", "rafter", "tie-beam", "batten", "shingles"):
                    continue  # the eaves overhang above, out of the way
                in_front = ay < -0.01 and bx > x0 and ax < x1 and az < 2.2
                self.assertFalse(in_front, f"{name}: {e.id} stands on the grain store's ground")

    def test_posts_stand_on_sills_and_carry_the_plates(self):
        for name, els in self.looks.items():
            ids = {e.id: e for e in els}
            for e in els:
                if e.kind != "post" or e.id.startswith("barn"):
                    continue
                sill = ids[e.on[0]]
                self.assertAlmostEqual(e.bottom, sill.top, places=6, msg=f"{name} {e.id}")
                (sx0, sy0, _), (sx1, sy1, _) = sill.bounds()
                self.assertTrue(sx0 - EPS <= e.at[0] <= sx1 + EPS and sy0 - EPS <= e.at[1] <= sy1 + EPS, f"{name}: {e.id} off its sill")
            for e in els:
                if e.kind == "plate" and not e.id.startswith("barn"):
                    for pid in e.on:
                        self.assertAlmostEqual(e.bottom, ids[pid].top, places=6, msg=f"{name} {e.id} on {pid}")

    def test_braces_triangulate_their_bays(self):
        s = SPEC
        for e in self.looks["default"]:
            if e.kind != "brace" or e.id.startswith("barn"):
                continue
            lo, hi = sorted([e.a, e.b], key=lambda p: p[2])
            self.assertAlmostEqual(lo[2], s.sill_top + 0.02, places=6, msg=e.id)
            self.assertAlmostEqual(hi[2], s.plate_bottom - 0.02, places=6, msg=e.id)
            angle = math.degrees(math.atan2(hi[2] - lo[2], math.hypot(hi[0] - lo[0], hi[1] - lo[1])))
            self.assertTrue(30 <= angle <= 75, f"{e.id}: {angle:.0f}° is no brace")

    def test_roof_pitch_suits_thatch_and_rafters_meet_at_the_ridge(self):
        thatch = by_id(self.all)["thatch"]
        self.assertTrue(45 <= thatch.params["pitch_deg"] <= 55)
        rafters = [e for e in self.looks["default"] if e.kind == "rafter" and not e.id.startswith("barn")]
        tops = {(round(e.b[0], 6), round(e.b[1], 6), round(e.b[2], 6)) for e in rafters}
        self.assertEqual(len(tops), len(rafters) // 2, "each front rafter meets a back one")
        for e in rafters:
            rise = e.b[2] - e.a[2]
            run = math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
            self.assertAlmostEqual(math.degrees(math.atan2(rise, run)), SPEC.pitch_deg, places=6)

    def test_thatch_lies_on_the_battens_and_hides_the_roof_timbers(self):
        ids = by_id(self.looks["default"])
        t = ids["thatch"].params
        tan = math.tan(math.radians(t["pitch_deg"]))
        drop = t["thickness"] / math.cos(math.radians(t["pitch_deg"]))

        def outer(y):
            return t["ridge_z"] - abs(y - t["ridge_y"]) * tan

        for e in self.looks["default"]:
            if e.kind in ("batten", "rafter", "collar") and not e.id.startswith("barn"):
                # each end of the timber (its top face) stays under the thatch's underside
                half = e.size[2] / 2 / math.cos(math.radians(t["pitch_deg"])) if e.kind == "rafter" else e.size[2] / 2
                for (_, y, z) in (e.a, e.b):
                    self.assertLessEqual(z + half, outer(y) - drop + 1e-6, e.id)
        self.assertLess(ids["ridge"].bottom, t["ridge_z"], "the ridge roll sits on the thatch")
        self.assertGreater(ids["chimney.cap"].bottom, t["ridge_z"], "the chimney stands clear of the ridge")

    def test_nothing_is_built_before_what_it_rests_on(self):
        ids = by_id(self.all)
        for e in self.all:
            for sid in e.on:
                self.assertIn(sid, ids, f"{e.id} rests on unknown {sid}")
                self.assertLessEqual(STAGES.index(ids[sid].stage), STAGES.index(e.stage), f"{e.id} ({e.stage}) before {sid} ({ids[sid].stage})")

    def test_every_stage_adds_something_and_scaffolding_is_temporary(self):
        for st in STAGES:
            self.assertTrue(any(e.stage == st for e in self.all), st)
        self.assertTrue(all(e.stage in ("staking", "walls") for e in self.all if "scaffold" in e.tags))

    def test_large_farm_adds_a_room_with_a_window_and_the_barn_gives_way(self):
        tags = {e.id: e.tags for e in self.all}
        self.assertIn("variant:upgraded", tags["window1"])
        self.assertNotIn("window1", {e.id for e in self.looks["default"]})

        def barn_start(els):
            return min(e.bounds()[0][0] for e in els if e.kind == "plank")

        self.assertAlmostEqual(barn_start(self.looks["upgraded"]) - barn_start(self.looks["default"]), SPEC.bay_upgraded, delta=0.15)
        # what both looks share is one element, so the upgrade doesn't jump
        self.assertEqual(tags["door"], set())
        self.assertEqual(tags["thatch"], {"novariant:upgraded"})
        self.assertEqual(tags["thatch@upgraded"], {"variant:upgraded"})

    def test_the_open_door_is_a_part_of_its_own(self):
        part = [e for e in self.all if "part:doorOpen" in e.tags]
        self.assertEqual({e.kind for e in part}, {"doorway", "door"})


if __name__ == "__main__":
    unittest.main()
