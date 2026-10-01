"""Unit tests of the camera and light rigs (ASSET_SPEC §3-4). Plain unittest:
python -m unittest discover tools/art-pipeline/tests"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from harness import rig  # noqa: E402


def close(a, b, eps=1e-9):
    return all(abs(x - y) < eps for x, y in zip(a, b))


class CameraTest(unittest.TestCase):
    def test_axes_are_orthonormal_and_up_is_up(self):
        for view in rig.VIEWS:
            c = rig.camera_for(view)
            for v in (c.right, c.up, c.back):
                self.assertAlmostEqual(math.sqrt(sum(x * x for x in v)), 1.0)
            self.assertAlmostEqual(rig._dot(c.right, c.up), 0.0)
            self.assertAlmostEqual(rig._dot(c.right, c.back), 0.0)
            self.assertAlmostEqual(c.right[2], 0.0, msg="no roll: verticals stay vertical")
            self.assertGreater(c.up[2], 0)

    def test_street_view_is_oblique_front_true_width_level_ground_side_receding_up_right(self):
        c = rig.camera_for("street")
        left, right = c.to_camera((-3, 0, 0)), c.to_camera((3, 0, 0))
        self.assertAlmostEqual(right[0] - left[0], 6.0, msg="front at true width")
        self.assertAlmostEqual(left[1], right[1], msg="level ground line")
        deep = c.to_camera((3, 2, 0))
        self.assertGreater(deep[0], right[0], "depth recedes right")
        self.assertGreater(deep[1], right[1], "and up")
        self.assertAlmostEqual(deep[0] - right[0], 2 * 0.55)
        self.assertGreater(rig._dot((0, 0, 1), c.back), 0, "looking down: roofs visible")
        self.assertAlmostEqual(math.degrees(math.asin(c.back[2])), 15.0)

    def test_rotated_views_have_no_shear(self):
        for view in ("roadsideL", "roadsideR", "side", "backdrop"):
            self.assertEqual(rig.camera_for(view).shear, 0.0)

    def test_roadside_views_turn_the_front_to_face_along_the_road(self):
        front = (0, -1, 0)
        self.assertGreater(rig._dot(front, rig.camera_for("roadsideL").right), 0.9, "L: front faces right")
        self.assertLess(rig._dot(front, rig.camera_for("roadsideR").right), -0.9, "R: front faces left")

    def test_origin_projects_to_the_centre_and_points_round_trip(self):
        c = rig.camera_for("street")
        self.assertTrue(close(c.to_camera((0, 0, 0)), (0, 0, 0)))
        v = (0.3, -0.2, 0.9)
        self.assertTrue(close(c.project(c.to_model(v)), v))


class LightTest(unittest.TestCase):
    def test_sun_is_on_the_viewer_left_at_the_spec_vector_in_every_view(self):
        want = rig._norm(rig.SUN_CAMERA)
        for view in rig.VIEWS:
            c = rig.camera_for(view)
            s = rig.sun_direction(c)
            self.assertTrue(close(c.project(s), want, 1e-9), view)
            self.assertGreater(s[2], 0, "sun above the horizon")

    def test_shadow_falls_away_from_the_sun(self):
        to_sun = rig.sun_direction(rig.camera_for("street"))
        s = rig.shadow_on_ground((0, 0, 3), to_sun)
        self.assertEqual(s[2], 0.0)
        self.assertLess(rig._dot((s[0], s[1], 0), (to_sun[0], to_sun[1], 0)), 0)


class FrameTest(unittest.TestCase):
    def box(self, w, d, h):
        return [(x, y, z) for x in (-w / 2, w / 2) for y in (0, d) for z in (0, h)]

    def test_frame_holds_the_model_and_its_shadow_in_whole_units(self):
        c = rig.camera_for("street")
        pts = self.box(10, 6, 7)
        f = rig.frame_around(c, pts, margin_u=2)
        rendered = [c.sheared(p) for p in pts]
        for q in rendered + [rig.shadow_on_ground(q, rig.sun_direction(c)) for q in rendered]:
            x, y = f.to_image(c.project(q)[:2])
            self.assertTrue(2 <= x <= f.size[0] - 2 and 2 <= y <= f.size[1] - 2, (q, x, y))
        self.assertTrue(all(isinstance(v, int) for v in (f.left, f.right, f.top, f.bottom)))

    def test_anchor_is_where_the_origin_lands(self):
        c = rig.camera_for("street")
        f = rig.frame_around(c, self.box(10, 6, 7))
        self.assertEqual(f.to_image((0, 0)), (float(f.anchor[0]), float(f.anchor[1])))
        self.assertEqual(f.resolution(4), (f.size[0] * 4, f.size[1] * 4))

    def test_blender_camera_shift_centres_the_frame(self):
        f = rig.Frame(left=-100, right=100, bottom=-10, top=150)
        cam = f.blender_camera()
        self.assertAlmostEqual(cam["ortho_scale"], 200 / 20)
        self.assertAlmostEqual(cam["shift_x"], 0.0)
        self.assertAlmostEqual(cam["shift_y"], 70 / 200)


if __name__ == "__main__":
    unittest.main()
