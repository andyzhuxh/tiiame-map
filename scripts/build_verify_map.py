"""Draw docs/verify-map.png from the data files, for checking places on site.

Usage: python3 scripts/build_verify_map.py
Needs Pillow and macOS system fonts (Hiragino Sans GB).
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PLACES = json.loads((ROOT / "data/places.candidates.geojson").read_text())
CONTEXT = json.loads((ROOT / "data/osm-context.geojson").read_text())

LAT0, LAT1, LON0, LON1 = 41.3212, 41.3262, 69.2922, 69.2982
WIDTH = 1500
KX = WIDTH / ((LON1 - LON0) * 83.5)
HEIGHT = int((LAT1 - LAT0) * 111 * KX)

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
f_label = ImageFont.truetype(FONT, 19, index=1)
f_small = ImageFont.truetype(FONT, 17)
f_street = ImageFont.truetype(FONT, 15)

CONF_LINE = {"high": (46, 160, 90), "medium": (230, 160, 30), "low": (220, 70, 60)}
CONF_FILL = {"high": (205, 235, 215), "medium": (252, 232, 195), "low": (250, 210, 205)}

# highway type -> (width px, color); drawn widest first
ROAD_STYLE = {
    "secondary": (14, (205, 205, 205)),
    "tertiary": (12, (210, 210, 210)),
    "unclassified": (9, (215, 215, 215)),
    "residential": (8, (218, 218, 218)),
    "living_street": (8, (218, 218, 218)),
    "service": (7, (225, 222, 210)),
}
FOOTWAY = (4, (150, 110, 70))
SIDEWALK = (3, (170, 140, 110))

# Only these streets get a name label; the small lanes clutter the map.
STREET_LABELS = {"Qori Niyoziy ko'chasi", "Osiyo ko'chasi", "Dostoyevskiy ko'chasi",
                 "Lashkarbegi ko'chasi", "Niyozbek yo'li ko'chasi"}

# Label anchors for the crowded central complex (pixel positions).
LABEL_OVERRIDE = {21: (1180, 930), 3: (1180, 975), 4: (1180, 1020), 5: (840, 1180)}


def px(lon, lat):
    return ((lon - LON0) * 83.5 * KX, (LAT1 - lat) * 111 * KX)


def main():
    im = Image.new("RGB", (WIDTH, HEIGHT + 100), "white")
    dr = ImageDraw.Draw(im)
    ctx = CONTEXT["features"]

    for f in ctx:
        if f["properties"]["kind"] == "building":
            dr.polygon([px(*c) for c in f["geometry"]["coordinates"][0]], outline=(215, 215, 215))

    roads = [f for f in ctx if f["properties"]["kind"] == "road"]
    for f in sorted(roads, key=lambda f: -ROAD_STYLE.get(f["properties"]["highway"], (0,))[0]):
        p = f["properties"]
        if p["highway"] == "footway":
            w, col = SIDEWALK if p["footway"] == "sidewalk" else FOOTWAY
        else:
            w, col = ROAD_STYLE.get(p["highway"], (5, (225, 225, 225)))
        dr.line([px(*c) for c in f["geometry"]["coordinates"]], fill=col, width=w, joint="curve")

    campus = next(f for f in ctx if f["properties"]["kind"] == "campus")
    dr.polygon([px(*c) for c in campus["geometry"]["coordinates"][0]], outline=(0, 140, 0), width=4)

    # Street names, once each, on the longest segment inside the image.
    best = {}
    for f in roads:
        name = f["properties"]["name"]
        if name not in STREET_LABELS:
            continue
        pts = [px(*c) for c in f["geometry"]["coordinates"]]
        pts = [q for q in pts if 0 < q[0] < WIDTH and 0 < q[1] < HEIGHT]
        if len(pts) >= 2 and len(pts) > len(best.get(name, [])):
            best[name] = pts
    for name, pts in best.items():
        x, y = pts[len(pts) // 2]
        dr.text((x, y), name, font=f_street, fill=(110, 110, 110), anchor="mm")

    labels = {}
    polys = [f for f in PLACES["features"] if f["geometry"]["type"] == "Polygon"]
    points = [f for f in PLACES["features"] if f["geometry"]["type"] == "Point"]
    for f in polys + points:
        p = f["properties"]
        c = p["confidence"]
        if f["geometry"]["type"] == "Polygon":
            pts = [px(*q) for q in f["geometry"]["coordinates"][0]]
            dr.polygon(pts, fill=CONF_FILL[c], outline=CONF_LINE[c], width=2)
            cx = sum(x for x, _ in pts) / len(pts)
            cy = sum(y for _, y in pts) / len(pts)
        else:
            cx, cy = px(*f["geometry"]["coordinates"])
            dr.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=CONF_LINE[c], outline="white", width=2)
        labels.setdefault(p["legend_no"], []).append((cx, cy, p["name_zh"], c, f["geometry"]["type"]))

    for no, items in labels.items():
        for i, (x, y, name, c, kind) in enumerate(items):
            text = f"{no}" if (i > 0 or no == 1) else f"{no} {name}"
            if no in LABEL_OVERRIDE and i == 0:
                lx, ly = LABEL_OVERRIDE[no]
                dr.line([x, y, lx, ly], fill=CONF_LINE[c], width=2)
            else:
                lx, ly = (x + 14 if kind == "Point" else x), y
            bw = dr.textlength(text, font=f_label)
            dr.rounded_rectangle([lx - 4, ly - 13, lx + bw + 4, ly + 13], radius=5, fill="white", outline=CONF_LINE[c])
            dr.text((lx, ly), text, font=f_label, fill=(30, 30, 30), anchor="lm")

    y = HEIGHT + 18
    x = 20
    for key, text in (
        ("high", "高：OSM 有名称或与鸟瞰图明确对应"),
        ("medium", "中：大致对应，位置需确认"),
        ("low", "低：只是推测，必须实地核对"),
    ):
        dr.rectangle([x, y - 9, x + 18, y + 9], fill=CONF_FILL[key], outline=CONF_LINE[key], width=2)
        dr.text((x + 26, y), text, font=f_small, fill="black", anchor="lm")
        x += 470
    y = HEIGHT + 62
    x = 20
    for (w, col), text in (((10, (210, 210, 210)), "街道"), ((7, (225, 222, 210)), "校内车行道"),
                           (FOOTWAY, "步行道"), (SIDEWALK, "人行道")):
        dr.line([x, y, x + 40, y], fill=col, width=w)
        dr.text((x + 50, y), text, font=f_small, fill="black", anchor="lm")
        x += 200
    dr.text((20, 20), "N ↑   TIIAME 校园候选地点（待核对）  底图数据 © OpenStreetMap contributors",
            font=f_small, fill="black")

    out = ROOT / "docs/verify-map.png"
    im.save(out)
    print(out, im.size)


if __name__ == "__main__":
    main()
