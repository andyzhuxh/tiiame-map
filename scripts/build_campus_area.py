"""Widen the campus outline to take in university buildings outside the OSM fence.

The OSM campus polygon leaves out the sport hall and building 12 (west of the
Darxon canal) and the dormitories along Osiyo ko'chasi. This script draws the
campus and those buildings on a 1 m grid, closes gaps narrower than about
2 x CLOSE_M (the canal, the space between blocks), and traces the outline.

The original OSM outline is kept as kind "campus_osm"; kind "campus" becomes
the widened one, which every other script and the web map use.

Usage: python3 scripts/build_campus_area.py
"""
import json
import math
from pathlib import Path

import numpy as np
from matplotlib.path import Path as MplPath
from scipy import ndimage as ndi
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTEXT_FILE = ROOT / "data/osm-context.geojson"
PLACES = json.loads((ROOT / "data/places.candidates.geojson").read_text())

# Places (legend numbers) to bring inside the campus outline.
INCLUDE = {12, 18, 19, 102, 103}
PAD_M = 8          # grow each building by this much
CLOSE_M = 13       # close gaps up to about twice this wide
CELL_M = 1.0
SIMPLIFY_M = 1.5

LAT0 = 41.3240
M_LON = 111_320 * math.cos(math.radians(LAT0))
M_LAT = 110_570


def rdp(pts, eps):
    """Douglas-Peucker line simplification."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.hypot(*ab) or 1e-9
    d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / n for p in pts[1:-1]]
    i = int(np.argmax(d)) + 1
    if d[i - 1] > eps:
        return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def main():
    ctx = json.loads(CONTEXT_FILE.read_text())
    feats = ctx["features"]
    osm = next((f for f in feats if f["properties"]["kind"] == "campus_osm"), None)
    if osm is None:
        osm = next(f for f in feats if f["properties"]["kind"] == "campus")
        osm["properties"]["kind"] = "campus_osm"
    feats[:] = [f for f in feats if f["properties"]["kind"] != "campus"]

    rings = [osm["geometry"]["coordinates"][0]]
    rings += [f["geometry"]["coordinates"][0] for f in PLACES["features"]
              if f["properties"]["legend_no"] in INCLUDE and f["geometry"]["type"] == "Polygon"]

    lon0 = min(c[0] for r in rings for c in r)
    lat0 = min(c[1] for r in rings for c in r)
    to_xy = lambda c: ((c[0] - lon0) * M_LON, (c[1] - lat0) * M_LAT)
    xy_rings = [[to_xy(c) for c in r] for r in rings]
    margin = PAD_M + CLOSE_M + 5
    w = int(max(x for r in xy_rings for x, _ in r) + 2 * margin)
    h = int(max(y for r in xy_rings for _, y in r) + 2 * margin)
    gx, gy = np.meshgrid(np.arange(w) * CELL_M - margin, np.arange(h) * CELL_M - margin)
    pts = np.column_stack([gx.ravel(), gy.ravel()])

    grid = MplPath(xy_rings[0]).contains_points(pts).reshape(h, w)
    disk = lambda r: np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r
    for r in xy_rings[1:]:
        b = MplPath(r).contains_points(pts).reshape(h, w)
        grid |= ndi.binary_dilation(b, structure=disk(PAD_M))
    grid = ndi.binary_closing(np.pad(grid, CLOSE_M + 2), structure=disk(CLOSE_M))[CLOSE_M + 2:-(CLOSE_M + 2), CLOSE_M + 2:-(CLOSE_M + 2)]
    grid = ndi.binary_fill_holes(grid)
    labels, n = ndi.label(grid)
    if n > 1:
        sizes = ndi.sum(grid, labels, range(1, n + 1))
        print(f"warning: {n} separate areas; keeping the largest. Raise CLOSE_M to join them.")
        grid = labels == (int(np.argmax(sizes)) + 1)

    cs = plt.contour(gx, gy, grid.astype(float), levels=[0.5])
    path = max(cs.allsegs[0], key=len)
    plt.close("all")
    # A closed outline starts and ends at the same point; split it at the point
    # farthest from the start so each half can be simplified.
    loop = [tuple(p) for p in path]
    far = int(np.argmax([math.hypot(p[0] - loop[0][0], p[1] - loop[0][1]) for p in loop]))
    simple = rdp(loop[:far + 1], SIMPLIFY_M)[:-1] + rdp(loop[far:], SIMPLIFY_M)
    ring = [[round(x / M_LON + lon0, 7), round(y / M_LAT + lat0, 7)] for x, y in simple]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    feats.append({"type": "Feature",
                  "properties": {"kind": "campus", "osm_id": osm["properties"]["osm_id"],
                                 "name": osm["properties"].get("name"),
                                 "note": "OSM campus outline widened to include legend " + ", ".join(map(str, sorted(INCLUDE)))},
                  "geometry": {"type": "Polygon", "coordinates": [ring]}})
    CONTEXT_FILE.write_text(json.dumps(ctx, ensure_ascii=False))
    area = grid.sum() * CELL_M ** 2
    print(f"campus outline: {len(ring)} points, about {area / 10_000:.1f} ha")


if __name__ == "__main__":
    main()
