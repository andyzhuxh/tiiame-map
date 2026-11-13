"""Draw docs/campus-view.png: a tilted 2.5D view of the campus.

The view matches the Yandex Maps screenshot the project started from: looking
roughly south-south-west, so Osiyo ko'chasi runs along the bottom and the
dormitory sits at the lower right. Buildings are raised by their OSM
building:levels (3.2 m a level; 2 levels when unknown).

Usage: python3 scripts/build_view_map.py
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PLACES = json.loads((ROOT / "data/places.candidates.geojson").read_text())
CONTEXT = json.loads((ROOT / "data/osm-context.geojson").read_text())
MAIN_PATHS = json.loads((ROOT / "data/main-paths.geojson").read_text())

CENTER = (69.2952, 41.3236)      # lon, lat of the view centre
BEARING = 202                    # compass direction that points up the image
TILT = 0.55                      # ground depth squash (1 = straight down)
CAMERA = 1400                    # metres; smaller = stronger perspective
SCALE = 3.1                      # pixels per metre at the centre
LEVEL_M = 3.2
W, H = 2400, 1500
ORIGIN = (W * 0.48, H * 0.60)

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
f_label = ImageFont.truetype(FONT, 24, index=1)
f_street = ImageFont.truetype(FONT, 22)
f_title = ImageFont.truetype(FONT, 26, index=1)
f_small = ImageFont.truetype(FONT, 20)

GROUND = (244, 245, 247)
CAMPUS_GROUND = (232, 236, 244)
STREET = (120, 135, 235)
PATH = (165, 125, 85)
ROOF = {"campus": (214, 212, 232), "place": (190, 200, 240), "other": (226, 216, 204)}
WALL = {"campus": (176, 172, 200), "place": (150, 162, 215), "other": (196, 184, 170)}

STREET_LABELS = {"Qori Niyoziy ko'chasi": "Qori Niyoziy 街", "Osiyo ko'chasi": "Osiyo 街",
                 "Niyozbek yo'li ko'chasi": "Niyozbek yo'li 街", "Lashkarbegi ko'chasi": "Lashkarbegi 街"}


def to_metres(lon, lat):
    return ((lon - CENTER[0]) * 83_500, (lat - CENTER[1]) * 111_000)


b = math.radians(BEARING)
UP = (math.sin(b), math.cos(b))
RIGHT = (math.cos(b), -math.sin(b))


def screen(lon, lat, z=0.0):
    x, y = to_metres(lon, lat)
    across = x * RIGHT[0] + y * RIGHT[1]
    depth = x * UP[0] + y * UP[1]          # metres away from the viewer, + is farther
    k = CAMERA / (CAMERA + depth)
    return (ORIGIN[0] + across * SCALE * k, ORIGIN[1] - (depth * TILT + z) * SCALE * k)


def depth_of(coords):
    return sum(to_metres(*c)[0] * UP[0] + to_metres(*c)[1] * UP[1] for c in coords) / len(coords)


def inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def main():
    im = Image.new("RGB", (W, H), GROUND)
    dr = ImageDraw.Draw(im)
    ctx = CONTEXT["features"]
    campus = next(f for f in ctx if f["properties"]["kind"] == "campus")
    ring = campus["geometry"]["coordinates"][0]

    dr.polygon([screen(*c) for c in ring], fill=CAMPUS_GROUND, outline=(150, 170, 150))

    roads = [f for f in ctx if f["properties"]["kind"] == "road"]
    for f in roads:
        hw = f["properties"]["highway"]
        if hw in ("secondary", "tertiary"):
            width = 12
        elif hw in ("residential", "unclassified", "living_street"):
            width = 6
        else:
            continue
        dr.line([screen(*c) for c in f["geometry"]["coordinates"]], fill=STREET, width=width, joint="curve")
    for f in MAIN_PATHS["features"]:
        a, c = (screen(*q) for q in f["geometry"]["coordinates"])
        dr.line([a, c], fill=PATH, width=6)
        for x, y in (a, c):
            dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=PATH)

    place_ids = {f["properties"]["osm_id"] for f in PLACES["features"]}
    blds = []
    for f in ctx:
        p = f["properties"]
        if p["kind"] != "building":
            continue
        pts = f["geometry"]["coordinates"][0]
        levels = float(p.get("levels") or 2)
        kind = "place" if p["osm_id"] in place_ids else ("campus" if inside(pts[0], ring) else "other")
        blds.append((depth_of(pts), pts, levels * LEVEL_M, kind))

    # Painter's algorithm: far buildings first.
    for _, pts, h, kind in sorted(blds, key=lambda t: -t[0]):
        walls = []
        for a, c in zip(pts, pts[1:]):
            walls.append((depth_of([a, c]), [screen(*a), screen(*c), screen(*c, h), screen(*a, h)]))
        for _, quad in sorted(walls, key=lambda t: -t[0]):
            dr.polygon(quad, fill=WALL[kind], outline=tuple(v - 25 for v in WALL[kind]))
        dr.polygon([screen(*c, h) for c in pts], fill=ROOF[kind], outline=tuple(v - 40 for v in ROOF[kind]))

    heights = {}
    for f in ctx:
        p = f["properties"]
        if p["kind"] == "building":
            heights[p["osm_id"]] = float(p.get("levels") or 2) * LEVEL_M

    # One label per place, on its tallest part; gates are labelled once as 大门.
    labels = {}
    for f in PLACES["features"]:
        p = f["properties"]
        if f["geometry"]["type"] == "Point":
            lon, lat = f["geometry"]["coordinates"]
            z = 0
        else:
            cs = f["geometry"]["coordinates"][0]
            lon = sum(c[0] for c in cs) / len(cs)
            lat = sum(c[1] for c in cs) / len(cs)
            z = heights.get(p["osm_id"], 6)
        no = p["legend_no"]
        name = "大门" if no == 1 else p["name_zh"].split("（")[0]
        entry = (screen(lon, lat, z), z, name, f["geometry"]["type"])
        if no == 1:
            labels.setdefault(("gate", p["osm_id"]), entry)
        elif no not in labels or z > labels[no][1]:
            labels[no] = entry

    placed = []
    for key, ((x, y), _, name, gtype) in sorted(labels.items(), key=lambda kv: kv[1][0][1]):
        no = 1 if isinstance(key, tuple) else key
        text = f"{no} {name}"
        tw = dr.textlength(text, font=f_label)
        bx, by = x - tw / 2, y - 40
        while any(abs(by - py) < 34 and bx < px2 and bx + tw > px1 for px1, px2, py in placed):
            by -= 34
        placed.append((bx - 8, bx + tw + 8, by))
        dr.line([x, y, x, by + 16], fill=(90, 90, 120), width=2)
        dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(90, 90, 120))
        dr.rounded_rectangle([bx - 8, by - 16, bx + tw + 8, by + 16], radius=8, fill="white", outline=(110, 100, 170), width=2)
        dr.text((bx, by), text, font=f_label, fill=(35, 30, 60), anchor="lm")

    # Each street name goes at the point of that street nearest the campus centre on the ground.
    best = {}
    for f in roads:
        name = f["properties"]["name"]
        if name in STREET_LABELS:
            for c in f["geometry"]["coordinates"]:
                q = screen(*c)
                if 120 < q[0] < W - 120 and 90 < q[1] < H - 80:
                    d = math.hypot(*to_metres(*c))
                    if d < best.get(name, (1e9,))[0]:
                        best[name] = (d, q)
    for name, (_, (x, y)) in best.items():
        if True:
            tw = dr.textlength(STREET_LABELS[name], font=f_street)
            dr.rounded_rectangle([x - tw / 2 - 6, y - 14, x + tw / 2 + 6, y + 14], radius=6, fill=(235, 238, 255))
            dr.text((x, y), STREET_LABELS[name], font=f_street, fill=(40, 55, 160), anchor="mm")

    dr.rectangle([0, 0, W, 56], fill="white")
    dr.text((24, 28), "TIIAME 校园（倾斜视角，上方约为西南）  地点待实地核对", font=f_title, fill=(30, 30, 50), anchor="lm")
    dr.text((W - 24, 28), "底图数据 © OpenStreetMap contributors", font=f_small, fill=(90, 90, 90), anchor="rm")
    dr.rectangle([0, H - 48, W, H], fill="white")
    x = 24
    for col, text in ((ROOF["place"], "已标注地点的楼"), (ROOF["campus"], "校内其他楼"),
                      (ROOF["other"], "校外建筑"), (PATH, "主要通道"), (STREET, "街道")):
        dr.rectangle([x, H - 34, x + 30, H - 14], fill=col)
        dr.text((x + 40, H - 24), text, font=f_small, fill="black", anchor="lm")
        x += 260

    out = ROOT / "docs/campus-view.png"
    im.save(out)
    print(out, im.size)


if __name__ == "__main__":
    main()
