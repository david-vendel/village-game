"""The farm: a 13th-14th century Central European farmstead.

A timber-framed dwelling (oak post-and-beam on a fieldstone footing,
limewashed wattle-and-daub infill, a steep thatched roof with a chimney,
shuttered window, plank door) with a lean-to barn against its right gable.

Fitted to the game (src/game): 10 m wide (BUILDINGS.farm.width = 200 u), the
door centred on HOME.dx (-0.95 m), the grain store's ground in front of the
left room (STORE.dx ± 1.2 m) left clear. The Large farm (variant "upgraded")
adds a bay with a second room and window to the right of the hall; the barn
gives up that bay, so the footprint stays 10 m.

farm(seed) returns both looks merged: elements only in one look are tagged
variant:upgraded or novariant:upgraded.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace

from .elements import Element, Vec3

# --- dimensions (metres) ---------------------------------------------------------


@dataclass(frozen=True)
class FarmSpec:
    width: float = 10.0  # whole farmstead along the street (house + barn)
    depth: float = 5.0  # house, front to back
    house_x0: float = -5.0  # left end of the house
    house_x1: float = 1.0  # right end of the house (the barn takes the rest)
    bay_upgraded: float = 2.0  # the Large farm's extra bay
    door_x: float = -0.95  # HOME.dx / 20
    door_w: float = 0.9
    door_h: float = 1.85
    footing_h: float = 0.5
    footing_w: float = 0.45
    sill: tuple[float, float] = (0.22, 0.22)  # width, height
    post: float = 0.2
    wall_h: float = 2.2  # sill top to plate bottom
    plate: tuple[float, float] = (0.22, 0.2)
    tie: tuple[float, float] = (0.2, 0.24)
    tie_overhang: float = 0.35
    pitch_deg: float = 50.0  # thatch wants 45-55°
    rafter: tuple[float, float] = (0.13, 0.16)
    rafter_spacing: float = 0.95
    eave_overhang: float = 0.55
    gable_overhang: float = 0.35
    thatch: float = 0.34
    batten_spacing: float = 0.32
    window_w: float = 0.7
    window_h: float = 0.6
    barn_depth: float = 4.4
    barn_low: float = 2.3  # barn eave height at its outer wall
    seed: int = 7

    @property
    def sill_top(self) -> float:
        return self.footing_h + self.sill[1]

    @property
    def plate_bottom(self) -> float:
        return self.sill_top + self.wall_h

    @property
    def eave_z(self) -> float:
        """Top of the wall plates: where the tie beams sit."""
        return self.plate_bottom + self.plate[1]

    @property
    def wall_y(self) -> float:
        """Centre line of the front wall timbers (the back wall mirrors it)."""
        return 0.05 + self.sill[0] / 2


SPEC = FarmSpec()


class Builder:
    """Collects elements with running order numbers per stage, and seeded variation."""

    def __init__(self, spec: FarmSpec) -> None:
        self.spec = spec
        self.out: list[Element] = []
        self.counts: dict[str, int] = {}

    def rng(self, key: str) -> random.Random:
        """A random source for one element: the same in both looks, so shared elements stay identical."""
        return random.Random(f"{self.spec.seed}:{key}")

    def add(self, e: Element) -> Element:
        self.counts[e.stage] = self.counts.get(e.stage, 0) + 1
        e.order = self.counts[e.stage]
        e.params.setdefault("seed", self.rng(e.id).randrange(1 << 30))
        self.out.append(e)
        return e

    def beam(self, id_: str, kind: str, a: Vec3, b: Vec3, wh: tuple[float, float], stage: str, on: list[str], material: str = "oak", tags: set[str] | None = None) -> Element:
        return self.add(Element(id_, kind, material, stage, shape="beam", a=a, b=b, size=(wh[0], wh[1], 0), on=on, tags=tags or set()))

    def box(self, id_: str, kind: str, at: Vec3, size: Vec3, material: str, stage: str, on: list[str], rot: Vec3 = (0, 0, 0), shape: str = "box", tags: set[str] | None = None) -> Element:
        return self.add(Element(id_, kind, material, stage, shape=shape, at=at, size=size, rot=rot, on=on, tags=tags or set()))


# --- the house ---------------------------------------------------------------------


def _front_posts(s: FarmSpec, x1: float) -> list[float]:
    """Front wall post centres: corners, a post between the room and the hall, the two door jambs, and bay posts."""
    half = s.post / 2
    x0c = s.house_x0 + 0.05 + half
    door_l = s.door_x - s.door_w / 2 - half
    door_r = s.door_x + s.door_w / 2 + half
    xs = [x0c, -2.8, door_l, door_r, s.house_x1 - 0.05 - half]
    if x1 > s.house_x1 + 1e-9:
        xs.append(x1 - 0.05 - half)
    return xs


def _back_posts(s: FarmSpec, x1: float) -> list[float]:
    half = s.post / 2
    xs = [s.house_x0 + 0.05 + half, -2.8, s.door_x, s.house_x1 - 0.05 - half]
    if x1 > s.house_x1 + 1e-9:
        xs.append(x1 - 0.05 - half)
    return xs


def _footing(b: Builder, x0: float, x1: float, y0: float, y1: float, prefix: str) -> list[str]:
    """Fieldstone footing in two courses round a rectangle (outer faces at the given lines)."""
    s = b.spec
    ids: list[str] = []
    w = s.footing_w
    course_h = s.footing_h / 2
    runs = [
        ("f", (x0, y0 + w / 2), (x1, y0 + w / 2)),  # front
        ("b", (x0, y1 - w / 2), (x1, y1 - w / 2)),  # back
        ("l", (x0 + w / 2, y0 + w), (x0 + w / 2, y1 - w)),  # left
        ("r", (x1 - w / 2, y0 + w), (x1 - w / 2, y1 - w)),  # right
    ]
    for name, (ax, ay), (bx, by) in runs:
        length = math.hypot(bx - ax, by - ay)
        along_x = abs(bx - ax) > abs(by - ay)
        for course in range(2):
            r = b.rng(f"{prefix}{name}{course}")
            t = 0.0 if course == 0 else r.uniform(0.15, 0.3)  # the upper course starts short: joints don't line up
            i = 0
            while t < length - 1e-6:
                l = min(length - t, r.uniform(0.32, 0.62))
                if length - t - l < 0.18:
                    l = length - t  # don't leave a sliver
                cx = (ax + (bx - ax) * (t + l / 2) / length) if along_x else ax
                cy = ay if along_x else (ay + (by - ay) * (t + l / 2) / length)
                h = course_h * r.uniform(0.92, 1.08)
                d = w * r.uniform(0.88, 1.0)
                size = (l - 0.02, d, h) if along_x else (d, l - 0.02, h)
                sid = f"{prefix}{name}{course}.{i}"
                b.box(sid, "footing-stone", (cx, cy, course * course_h + h / 2), size, "fieldstone", "foundation", on=[], shape="stone", rot=(0, 0, r.uniform(-0.04, 0.04)))
                ids.append(sid)
                t += l
                i += 1
    return ids


def _house(b: Builder, upgraded: bool) -> None:
    s = b.spec
    x0 = s.house_x0
    x1 = s.house_x1 + (s.bay_upgraded if upgraded else 0.0)
    D = s.depth
    half = s.post / 2
    wy_f = s.wall_y
    wy_b = D - s.wall_y

    # staking: the corners pegged out and strung (taken away when the walls go up)
    for i, (px, py) in enumerate([(x0, 0), (x1, 0), (x1, D), (x0, D)]):
        b.box(f"stake{i}", "stake", (px, py, 0.3), (0.05, 0.05, 0.6), "pole", "staking", on=[], tags={"scaffold"})
    for i, ((ax, ay), (bx, by)) in enumerate([((x0, 0), (x1, 0)), ((x1, 0), (x1, D)), ((x1, D), (x0, D)), ((x0, D), (x0, 0))]):
        b.beam(f"line{i}", "line", (ax, ay, 0.45), (bx, by, 0.45), (0.012, 0.012), "staking", on=[f"stake{i}"], material="rope", tags={"scaffold"})

    # foundation: the footing, and a step stone before the door
    footing = _footing(b, x0, x1, 0.0, D, "ft")
    b.box("step", "step-stone", (s.door_x, -0.3, 0.09), (1.1, 0.55, 0.18), "fieldstone", "foundation", on=[], shape="stone")

    # frame: sills on the footing
    sz = s.sill
    sills = {
        "sill.f": ((x0 + 0.05, wy_f, s.footing_h + sz[1] / 2), (x1 - 0.05, wy_f, s.footing_h + sz[1] / 2)),
        "sill.b": ((x0 + 0.05, wy_b, s.footing_h + sz[1] / 2), (x1 - 0.05, wy_b, s.footing_h + sz[1] / 2)),
        "sill.l": ((x0 + 0.05 + half, wy_f + sz[0] / 2, s.footing_h + sz[1] / 2), (x0 + 0.05 + half, wy_b - sz[0] / 2, s.footing_h + sz[1] / 2)),
        "sill.r": ((x1 - 0.05 - half, wy_f + sz[0] / 2, s.footing_h + sz[1] / 2), (x1 - 0.05 - half, wy_b - sz[0] / 2, s.footing_h + sz[1] / 2)),
    }
    for sid, (a, c) in sills.items():
        b.beam(sid, "sill", a, c, sz, "frame", on=footing[:1])

    # posts: front, back, and the gable middles
    pz0, pz1 = s.sill_top, s.plate_bottom
    posts: dict[str, tuple[float, float, str]] = {}
    for i, px in enumerate(_front_posts(s, x1)):
        posts[f"post.f{i}"] = (px, wy_f, "sill.f")
    for i, px in enumerate(_back_posts(s, x1)):
        posts[f"post.b{i}"] = (px, wy_b, "sill.b")
    posts["post.l"] = (x0 + 0.05 + half, D / 2, "sill.l")
    posts["post.r"] = (x1 - 0.05 - half, D / 2, "sill.r")
    for pid, (px, py, sill_id) in posts.items():
        b.box(pid, "post", (px, py, (pz0 + pz1) / 2), (s.post, s.post, pz1 - pz0), "oak", "frame", on=[sill_id])

    # wall plates on the posts, front and back
    pl = s.plate
    pzc = s.plate_bottom + pl[1] / 2
    b.beam("plate.f", "plate", (x0 + 0.05, wy_f, pzc), (x1 - 0.05, wy_f, pzc), pl, "frame", on=[p for p in posts if p.startswith("post.f")])
    b.beam("plate.b", "plate", (x0 + 0.05, wy_b, pzc), (x1 - 0.05, wy_b, pzc), pl, "frame", on=[p for p in posts if p.startswith("post.b")])
    # gable plates (end girts at the top of the gable walls)
    b.beam("plate.l", "plate", (x0 + 0.05 + half, wy_f + pl[0] / 2, pzc), (x0 + 0.05 + half, wy_b - pl[0] / 2, pzc), pl, "frame", on=["post.l"])
    b.beam("plate.r", "plate", (x1 - 0.05 - half, wy_f + pl[0] / 2, pzc), (x1 - 0.05 - half, wy_b - pl[0] / 2, pzc), pl, "frame", on=["post.r"])

    # girts and braces in the front wall, bay by bay
    fx = _front_posts(s, x1)
    win_bays = [(fx[0], fx[1])] + ([(fx[4], fx[5])] if upgraded else [])
    door_bay = (fx[2], fx[3])
    mid = s.sill_top + s.wall_h * 0.5
    win_sill = s.sill_top + 0.95
    win_head = win_sill + s.window_h
    for i in range(len(fx) - 1):
        a, c = fx[i] + half, fx[i + 1] - half
        bay = (fx[i], fx[i + 1])
        on = [f"post.f{i}", f"post.f{i + 1}"]
        if bay == door_bay:
            b.beam(f"girt.f{i}.head", "girt", (a, wy_f, s.sill_top + s.door_h + 0.06), (c, wy_f, s.sill_top + s.door_h + 0.06), (0.18, 0.14), "frame", on=on)
            continue
        if bay in win_bays:
            b.beam(f"girt.f{i}.wsill", "girt", (a, wy_f, win_sill - 0.06), (c, wy_f, win_sill - 0.06), (0.18, 0.12), "frame", on=on)
            b.beam(f"girt.f{i}.whead", "girt", (a, wy_f, win_head + 0.06), (c, wy_f, win_head + 0.06), (0.18, 0.12), "frame", on=on)
        else:
            b.beam(f"girt.f{i}", "girt", (a, wy_f, mid), (c, wy_f, mid), (0.18, 0.14), "frame", on=on)
            # a brace triangulating the bay: from the foot of one post to the head of the other
            rising_right = (i % 2 == 0)
            lo = (a if rising_right else c, wy_f, s.sill_top + 0.02)
            hi = (c if rising_right else a, wy_f, s.plate_bottom - 0.02)
            b.beam(f"brace.f{i}", "brace", lo, hi, (0.16, 0.12), "frame", on=on + ["sill.f", "plate.f"])
    # back wall: a girt per bay
    bx = _back_posts(s, x1)
    for i in range(len(bx) - 1):
        a, c = bx[i] + half, bx[i + 1] - half
        b.beam(f"girt.b{i}", "girt", (a, wy_b, mid), (c, wy_b, mid), (0.18, 0.14), "frame", on=[f"post.b{i}", f"post.b{i + 1}"])
    # gable walls: girts, and a brace in each half
    for side, gx, pid in (("l", x0 + 0.05 + half, "post.l"), ("r", x1 - 0.05 - half, "post.r")):
        corner_f = f"post.f0" if side == "l" else f"post.f{len(fx) - 1}"
        corner_b = f"post.b0" if side == "l" else f"post.b{len(bx) - 1}"
        for j, (ya, yc, cp) in enumerate(((wy_f + half, D / 2 - half, corner_f), (D / 2 + half, wy_b - half, corner_b))):
            b.beam(f"girt.{side}{j}", "girt", (gx, ya, mid), (gx, yc, mid), (0.18, 0.14), "frame", on=[pid, cp])
            lo_y, hi_y = (ya, yc) if j == 0 else (yc, ya)
            b.beam(f"brace.{side}{j}", "brace", (gx, lo_y, s.sill_top + 0.02), (gx, hi_y, s.plate_bottom - 0.02), (0.16, 0.12), "frame", on=[pid, cp, f"sill.{side}", f"plate.{side}"])

    # tie beams across the house over each front/back post pair, a little proud of the walls
    tz = s.eave_z + s.tie[1] / 2
    # over every front post but the door jambs, and one over the door (a back post carries it there)
    tie_xs = sorted({round(x, 4) for x in fx if x not in (fx[2], fx[3])} | {s.door_x})
    for i, tx in enumerate(tie_xs):
        b.beam(f"tie{i}", "tie-beam", (tx, -s.tie_overhang, tz), (tx, D + s.tie_overhang, tz), s.tie, "frame", on=["plate.f", "plate.b"])

    # rafters: pairs at even spacing, from beyond the eaves to the ridge; collars at two-thirds height
    pitch = math.radians(s.pitch_deg)
    foot_z = s.eave_z + s.tie[1]
    run = D / 2 + s.eave_overhang
    ridge_z = foot_z + run * math.tan(pitch)
    n = max(2, round((x1 - x0) / s.rafter_spacing))
    rx = [x0 + 0.12 + (x1 - x0 - 0.24) * k / n for k in range(n + 1)]
    for k, px in enumerate(rx):
        for side, y_eave, sgn in (("f", -s.eave_overhang, 1), ("b", D + s.eave_overhang, -1)):
            b.beam(f"rafter{k}{side}", "rafter", (px, y_eave, foot_z), (px, D / 2, ridge_z), s.rafter, "frame", on=["plate.f" if side == "f" else "plate.b"])
        cz = foot_z + (ridge_z - foot_z) * 0.62
        cy = (ridge_z - cz) / math.tan(pitch)
        b.beam(f"collar{k}", "collar", (px, D / 2 - cy, cz), (px, D / 2 + cy, cz), (0.1, 0.14), "frame", on=[f"rafter{k}f", f"rafter{k}b"])

    # walls: limewashed wattle-and-daub in every panel, the door, the window(s) with shutters
    def panel(pid: str, xa: float, xc: float, za: float, zc: float, y: float, along_x: bool, on: list[str]) -> None:
        t = 0.12
        if along_x:
            b.box(pid, "daub", ((xa + xc) / 2, y + 0.015, (za + zc) / 2), (xc - xa, t, zc - za), "daub", "walls", on=on)
        else:
            b.box(pid, "daub", (y - 0.015 if xa < 0 else y + 0.015, (xa + xc) / 2, (za + zc) / 2), (t, xc - xa, zc - za), "daub", "walls", on=on)

    st, pb = s.sill_top, s.plate_bottom
    for i in range(len(fx) - 1):
        a, c = fx[i] + half, fx[i + 1] - half
        bay = (fx[i], fx[i + 1])
        on = [f"post.f{i}", f"post.f{i + 1}"]
        if bay == door_bay:
            dz = st + s.door_h + 0.13
            panel(f"daub.f{i}.over", a, c, dz, pb, wy_f, True, on)
            b.box("door", "door", (s.door_x, wy_f - 0.02, st + s.door_h / 2), (s.door_w, 0.06, s.door_h), "planks", "walls", on=on)
            b.box("door.lintel.dark", "door-frame", (s.door_x, wy_f + 0.01, st + s.door_h + 0.03), (s.door_w, 0.08, 0.06), "oak", "walls", on=on)
        elif bay in win_bays:
            w_i = win_bays.index(bay)
            wc = (a + c) / 2
            ww = s.window_w
            panel(f"daub.f{i}.low", a, c, st, win_sill - 0.12, wy_f, True, on)
            panel(f"daub.f{i}.high", a, c, win_head + 0.12, pb, wy_f, True, on)
            panel(f"daub.f{i}.wl", a, wc - ww / 2, win_sill, win_head, wy_f, True, on)
            panel(f"daub.f{i}.wr", wc + ww / 2, c, win_sill, win_head, wy_f, True, on)
            # the opening: dark inside, lamp-lit at night (the Lights group drives it)
            b.box(f"window{w_i}", "window", (wc, wy_f + 0.06, (win_sill + win_head) / 2), (ww, 0.04, s.window_h), "window", "walls", on=on)
            # shutters, opened flat against the wall on either side
            for k, sx in enumerate((-1, 1)):
                b.box(f"shutter{w_i}.{k}", "shutter", (wc + sx * (ww / 2 + ww / 4 + 0.03), wy_f - 0.1, (win_sill + win_head) / 2), (ww / 2, 0.04, s.window_h + 0.04), "planks", "walls", on=on)
        else:
            panel(f"daub.f{i}.low", a, c, st, mid - 0.07, wy_f, True, on)
            panel(f"daub.f{i}.high", a, c, mid + 0.07, pb, wy_f, True, on)
    for i in range(len(bx) - 1):
        a, c = bx[i] + half, bx[i + 1] - half
        on = [f"post.b{i}", f"post.b{i + 1}"]
        panel(f"daub.b{i}.low", a, c, st, mid - 0.07, wy_b, True, on)
        panel(f"daub.b{i}.high", a, c, mid + 0.07, pb, wy_b, True, on)
    for side, gx in (("l", x0 + 0.05 + half), ("r", x1 - 0.05 - half)):
        for j, (ya, yc) in enumerate(((wy_f + half, D / 2 - half), (D / 2 + half, wy_b - half))):
            gxs = gx - 0.015 if side == "l" else gx + 0.015
            b.box(f"daub.{side}{j}.low", "daub", (gxs, (ya + yc) / 2, (st + mid - 0.07) / 2), (0.12, yc - ya, mid - 0.07 - st), "daub", "walls", on=[f"post.{side}"])
            b.box(f"daub.{side}{j}.high", "daub", (gxs, (ya + yc) / 2, (mid + 0.07 + pb) / 2), (0.12, yc - ya, pb - mid - 0.07), "daub", "walls", on=[f"post.{side}"])
        # the gable triangle above the tie beam: vertical boards
        b.add(Element(f"gable.{side}", "gable-boards", "boards", "walls", shape="gable", params={
            "x": gx + (0.02 if side == "r" else -0.02), "y0": 0.0, "y1": D, "z0": s.eave_z + s.tie[1], "z_ridge": ridge_z - 0.2, "thickness": 0.04,
            "min": [gx - 0.05, 0.0, s.eave_z], "max": [gx + 0.05, D, ridge_z]}, on=[f"rafter0f" if side == "l" else f"rafter{n}f"]))

    # roof: battens across the rafters, the thatch over them, the chimney through it
    slope = run / math.cos(pitch)
    rows = int(slope / s.batten_spacing)
    for side, sgn in (("f", 1), ("b", -1)):
        for j in range(rows):
            t = (j + 0.5) / rows
            y = (-s.eave_overhang + run * t) if sgn > 0 else (D + s.eave_overhang - run * t)
            z = foot_z + run * t * math.tan(pitch) + 0.1
            b.beam(f"batten.{side}{j}", "batten", (x0 - 0.05, y, z), (x1 + 0.05, y, z), (0.06, 0.04), "roof", on=[f"rafter0{side}", f"rafter{n}{side}"])
    # the thatch lies on the battens: its outer surface runs parallel to the rafters, raised by
    # half a rafter, a batten and its own thickness; the eaves reach a little past the rafter feet
    lv = roof_levels(s)
    y_front, y_back = -s.eave_overhang - 0.15, D + s.eave_overhang + 0.15
    eave_outer = lv["ridge_outer"] - (D / 2 - y_front) * math.tan(pitch)
    b.add(Element("thatch", "thatch", "thatch", "roof", shape="roof", params={
        "x0": x0 - s.gable_overhang, "x1": x1 + s.gable_overhang, "y_front": y_front, "y_back": y_back,
        "eave_z": eave_outer, "ridge_y": D / 2, "ridge_z": lv["ridge_outer"], "thickness": s.thatch, "pitch_deg": s.pitch_deg,
        "min": [x0 - s.gable_overhang, y_front, eave_outer - s.thatch / math.cos(pitch)], "max": [x1 + s.gable_overhang, y_back, lv["ridge_outer"]]},
        on=[f"batten.f{rows - 1}", f"batten.b{rows - 1}"]))
    rz = lv["ridge_outer"] - 0.04
    b.add(Element("ridge", "ridge", "thatch", "roof", shape="beam", a=(x0 - s.gable_overhang + 0.1, D / 2, rz), b=(x1 + s.gable_overhang - 0.1, D / 2, rz), size=(0.62, 0.3, 0), on=["thatch"]))
    # the chimney rises from the hearth between the room and the hall
    cx, cy = CHIMNEY_XY[0], D / 2 + CHIMNEY_XY[1]
    roof_z_at = lv["ridge_outer"] - abs(cy - D / 2) * math.tan(pitch)
    top = lv["chimney_top"]
    b.box("chimney", "chimney", (cx, cy, (roof_z_at - 0.6 + top) / 2), (0.62, 0.62, top - roof_z_at + 0.6), "clay-stone", "roof", on=["tie2"])
    b.box("chimney.cap", "chimney", (cx, cy, top + 0.04), (0.76, 0.76, 0.08), "fieldstone", "roof", on=["chimney"])

    # scaffolding along the front while the walls and roof are made
    for k, sx in enumerate((x0 - 0.5, (x0 + x1) / 2, x1 + 0.3)):
        b.box(f"scaffold.pole{k}", "scaffold", (sx, -0.95, 2.2), (0.09, 0.09, 4.4), "pole", "walls", on=[], tags={"scaffold"})
    for k, z in enumerate((1.6, 3.2)):
        b.box(f"scaffold.board{k}", "scaffold", ((x0 + x1) / 2 - 0.1, -0.85, z), (x1 - x0 + 1.0, 0.36, 0.05), "boards", "walls", on=[], tags={"scaffold"})
        b.beam(f"scaffold.ledger{k}", "scaffold", (x0 - 0.5, -0.95, z - 0.06), (x1 + 0.3, -0.95, z - 0.06), (0.07, 0.07), "walls", on=[], material="pole", tags={"scaffold"})

    # the open door (drawn while someone steps through): the dark doorway and the leaf swung out
    b.box("door.open.dark", "doorway", (s.door_x, wy_f - 0.05, st + s.door_h / 2), (s.door_w, 0.02, s.door_h), "doorway", "walls", on=["door"], tags={"part:doorOpen"})
    hinge = s.door_x - s.door_w / 2
    b.box("door.open.leaf", "door", (hinge + 0.03, wy_f - 0.05 - s.door_w / 2, st + s.door_h / 2), (0.06, s.door_w, s.door_h), "planks", "walls", on=["door"], tags={"part:doorOpen"})


# where the chimney stands: x, and y from the ridge line (behind it)
CHIMNEY_XY = (-2.2, 0.7)


def roof_levels(s: FarmSpec) -> dict[str, float]:
    """Heights of the roof: rafter feet and apex (centre line), the thatch's outer ridge, the chimney top."""
    pitch = math.radians(s.pitch_deg)
    foot = s.eave_z + s.tie[1]
    apex = foot + (s.depth / 2 + s.eave_overhang) * math.tan(pitch)
    lift = (s.rafter[1] / 2 + 0.04 + s.thatch) / math.cos(pitch)
    return {"rafter_foot": foot, "rafter_apex": apex, "ridge_outer": apex + lift, "chimney_top": apex + lift + 0.75}


# --- the lean-to barn -------------------------------------------------------------


def _barn(b: Builder, upgraded: bool) -> None:
    s = b.spec
    x0 = s.house_x1 + (s.bay_upgraded if upgraded else 0.0)
    x1 = s.house_x0 + s.width
    y0 = (s.depth - s.barn_depth) / 2
    y1 = y0 + s.barn_depth
    hi_z = s.eave_z - 0.05  # tucked under the house's eaves
    lo_z = s.barn_low
    pre = "barnU." if upgraded else "barn."

    # pad stones under the posts
    post_xy = [(x1 - 0.12, y0 + 0.12), (x1 - 0.12, y1 - 0.12), (x1 - 0.12, (y0 + y1) / 2), (x0 + 0.25, y0 + 0.12), (x0 + 0.25, y1 - 0.12), ((x0 + x1) / 2 + 0.6, y0 + 0.12), ((x0 + x1) / 2 + 0.6, y1 - 0.12)]
    for i, (px, py) in enumerate(post_xy):
        b.box(f"{pre}pad{i}", "pad-stone", (px, py, 0.1), (0.34, 0.34, 0.2), "fieldstone", "foundation", on=[], shape="stone")
    # posts: their height follows the roof line down from the house to the outer wall
    def roof_z(x: float) -> float:
        return hi_z + (lo_z - hi_z) * (x - x0) / (x1 - x0)

    for i, (px, py) in enumerate(post_xy):
        top = roof_z(px) - 0.08
        b.box(f"{pre}post{i}", "post", (px, py, (0.2 + top) / 2), (0.18, 0.18, top - 0.2), "oak", "frame", on=[f"{pre}pad{i}"])
    # rails top and middle along the front, back and outer side, and rafters on them
    for side, y in (("f", y0 + 0.12), ("b", y1 - 0.12)):
        b.beam(f"{pre}rail{side}", "plate", (x0 + 0.1, y, roof_z(x0 + 0.1) - 0.08), (x1, y, roof_z(x1) - 0.08), (0.16, 0.16), "frame", on=[f"{pre}post0"])
        b.beam(f"{pre}rail{side}.mid", "girt", (x0 + 0.25, y, 1.2), (x1 - 0.12, y, 1.2), (0.14, 0.12), "frame", on=[f"{pre}post0"])
    b.beam(f"{pre}rail.out", "plate", (x1 - 0.12, y0 + 0.12, lo_z - 0.08), (x1 - 0.12, y1 - 0.12, lo_z - 0.08), (0.16, 0.16), "frame", on=[f"{pre}post0", f"{pre}post1"])
    n = max(3, round((y1 - y0) / 0.8))
    for k in range(n + 1):
        y = y0 + 0.05 + (y1 - y0 - 0.1) * k / n
        b.beam(f"{pre}rafter{k}", "rafter", (x0 + 0.05, y, hi_z + 0.02), (x1 + 0.45, y, lo_z - 0.12), (0.1, 0.12), "frame", on=[f"{pre}railf", f"{pre}railb"])

    # walls: vertical planks on the front (with the wide doors), back and outer side
    r = b.rng(pre + "planks")
    pw = 0.24
    door_x0, door_x1 = (x0 + x1) / 2 - 1.0, (x0 + x1) / 2 + 1.0
    if upgraded:
        door_x0, door_x1 = x0 + 0.35, x1 - 0.35
    for side, y in (("f", y0), ("b", y1)):
        k = 0
        x = x0 + 0.12
        while x < x1 - 1e-6:
            w = min(pw * r.uniform(0.85, 1.15), x1 - x)
            if side == "f" and door_x0 - 0.01 < x + w / 2 < door_x1 + 0.01:
                x += w
                continue
            top = roof_z(x + w / 2) - 0.12
            b.box(f"{pre}plank{side}{k}", "plank", (x + w / 2, y + (-0.02 if side == "f" else 0.02), (0.05 + top) / 2), (w - 0.012, 0.035, top - 0.05), "boards", "walls", on=[f"{pre}rail{side}"])
            x += w
            k += 1
    k = 0
    y = y0
    while y < y1 - 1e-6:
        w = min(pw * r.uniform(0.85, 1.15), y1 - y)
        b.box(f"{pre}plank.o{k}", "plank", (x1 + 0.02, y + w / 2, (0.05 + lo_z - 0.12) / 2), (0.035, w - 0.012, lo_z - 0.17), "boards", "walls", on=[f"{pre}rail.out"])
        y += w
        k += 1
    # the doors: two leaves of boards with a Z brace each
    dh = roof_z(door_x1) - 0.35
    for k, (a, c) in enumerate(((door_x0, (door_x0 + door_x1) / 2), ((door_x0 + door_x1) / 2, door_x1))):
        b.box(f"{pre}door{k}", "barn-door", ((a + c) / 2, y0 - 0.04, (0.08 + dh) / 2), (c - a - 0.02, 0.05, dh - 0.08), "planks", "walls", on=[f"{pre}railf"])
        b.beam(f"{pre}door{k}.brace", "brace", (a + 0.08, y0 - 0.075, 0.25), (c - 0.08, y0 - 0.075, dh - 0.2), (0.1, 0.03), "walls", on=[f"{pre}door{k}"], material="planks")
    b.beam(f"{pre}lintel", "girt", (door_x0 - 0.1, y0 - 0.03, dh + 0.06), (door_x1 + 0.1, y0 - 0.03, dh + 0.06), (0.14, 0.14), "walls", on=[f"{pre}railf"])

    # roof: boards (shingles) on the rafters
    b.add(Element(f"{pre}roof", "shingles", "shingles", "roof", shape="leanto", params={
        "x0": x0 - 0.05, "x1": x1 + 0.5, "y0": y0 - 0.35, "y1": y1 + 0.35, "z0": hi_z + 0.1, "z1": lo_z - 0.06, "thickness": 0.07,
        "min": [x0 - 0.05, y0 - 0.35, lo_z - 0.13], "max": [x1 + 0.5, y1 + 0.35, hi_z + 0.1]}, on=[f"{pre}rafter0", f"{pre}rafter{n}"]))


# --- both looks ------------------------------------------------------------------------


def farm_look(upgraded: bool, spec: FarmSpec = SPEC) -> list[Element]:
    """One look of the farm: the default or the Large farm."""
    b = Builder(spec)
    _house(b, upgraded)
    _barn(b, upgraded)
    return b.out


def _same(a: Element, b: Element) -> bool:
    return replace(a, order=0) == replace(b, order=0)


def farm(spec: FarmSpec = SPEC) -> list[Element]:
    """Both looks merged: shared elements once, the rest tagged by the look they belong to."""
    default = {e.id: e for e in farm_look(False, spec)}
    upgraded = {e.id: e for e in farm_look(True, spec)}
    out: list[Element] = []
    for eid, e in default.items():
        u = upgraded.get(eid)
        if u is not None and _same(e, u):
            out.append(e)
        else:
            e.tags = e.tags | {"novariant:upgraded"}
            out.append(e)
            if u is not None:
                u.id = eid + "@upgraded"
                u.tags = u.tags | {"variant:upgraded"}
                out.append(u)
    for eid, u in upgraded.items():
        if eid not in default:
            u.tags = u.tags | {"variant:upgraded"}
            out.append(u)
    return out


def points(spec: FarmSpec = SPEC) -> dict[str, Vec3]:
    """Named points (ASSET_SPEC §7.1) in model space."""
    s = spec
    fx_up = _front_posts(s, s.house_x1 + s.bay_upgraded)
    win0 = (_front_posts(s, s.house_x1)[0] + _front_posts(s, s.house_x1)[1]) / 2
    win1 = (fx_up[4] + fx_up[5]) / 2
    win_z = s.sill_top + 0.95 + s.window_h / 2
    return {
        "door": (s.door_x, 0.0, 0.0),
        "smoke:0": (CHIMNEY_XY[0], s.depth / 2 + CHIMNEY_XY[1], roof_levels(s)["chimney_top"] + 0.1),
        "window:0": (win0, 0.0, win_z),
        "window:1": (win1, 0.0, win_z),
        "sleep:0": (win0, 0.0, win_z + 1.4),
        "sleep:1": (win1, 0.0, win_z + 1.4),
    }
