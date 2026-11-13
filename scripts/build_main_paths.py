"""Pick the main walking paths out of the full OpenStreetMap road network.

Keeps the shortest network that still connects every place in
places.candidates.geojson (an approximate Steiner tree), so every place can be
reached from every other one and the many short side paths are dropped.

Usage: python3 scripts/build_main_paths.py   -> data/main-paths.geojson
"""
import json
import math
from pathlib import Path

import networkx as nx
from networkx.algorithms.approximation import steiner_tree

ROOT = Path(__file__).resolve().parent.parent
PLACES = json.loads((ROOT / "data/places.candidates.geojson").read_text())
CONTEXT = json.loads((ROOT / "data/osm-context.geojson").read_text())

# Gates (legend 1), the dormitory (legend 19) and any place outside the campus
# fence may join the network at street nodes too.
ORIGIN_LEGEND = {1, 19}
# Walking outside the campus fence costs more, so routes stay inside when they can.
OUTSIDE_PENALTY = 1.5
WALKABLE = {"footway", "service", "living_street", "path", "pedestrian", "residential",
            "unclassified", "tertiary", "secondary"}


def metres(a, b):
    return math.hypot((a[0] - b[0]) * 83_500, (a[1] - b[1]) * 111_000)


def inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def key(c):
    return (round(c[0], 7), round(c[1], 7))


def main():
    ctx = CONTEXT["features"]
    ring = next(f for f in ctx if f["properties"]["kind"] == "campus")["geometry"]["coordinates"][0]

    g = nx.Graph()
    for f in ctx:
        p = f["properties"]
        if p["kind"] != "road" or p["highway"] not in WALKABLE:
            continue
        pts = [key(c) for c in f["geometry"]["coordinates"]]
        for a, b in zip(pts, pts[1:]):
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            in_campus = inside(mid, ring)
            w = metres(a, b) * (1 if in_campus else OUTSIDE_PENALTY)
            g.add_edge(a, b, weight=w, osm_id=p["osm_id"], highway=p["highway"], in_campus=in_campus)

    # A few OSM paths are not joined to the rest; work on the main connected network.
    g = g.subgraph(max(nx.connected_components(g), key=len)).copy()
    campus_nodes = [n for n in g if inside(n, ring)]
    all_nodes = list(g)

    def snap(feature):
        geom = feature["geometry"]
        verts = [geom["coordinates"]] if geom["type"] == "Point" else geom["coordinates"][0]
        outside = not inside((sum(v[0] for v in verts) / len(verts), sum(v[1] for v in verts) / len(verts)), ring)
        cand = all_nodes if feature["properties"]["legend_no"] in ORIGIN_LEGEND or outside else campus_nodes
        return min(cand, key=lambda n: min(metres(n, v) for v in verts))

    # One terminal per building; the dormitory blocks stand side by side, so one
    # connection serves them all.
    groups = {}
    for f in PLACES["features"]:
        p = f["properties"]
        groups.setdefault("dorm" if p["legend_no"] == 19 else p["osm_id"], []).append(f)
    terminals = set()
    for feats_ in groups.values():
        terminals.add(min((snap(f) for f in feats_),
                          key=lambda n: nx.shortest_path_length(g, n, snap(PLACES["features"][0]), weight="weight")))
    tree = steiner_tree(g, terminals, weight="weight", method="mehlhorn")
    used = {frozenset(e) for e in tree.edges}

    feats = []
    for e in used:
        a, b = tuple(e)
        d = g.edges[a, b]
        feats.append({
            "type": "Feature",
            "properties": {"osm_id": d["osm_id"], "highway": d["highway"], "in_campus": d["in_campus"]},
            "geometry": {"type": "LineString", "coordinates": [list(a), list(b)]},
        })
    out = ROOT / "data/main-paths.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection",
                               "attribution": "© OpenStreetMap contributors, ODbL",
                               "features": feats}))
    total = sum(metres(*f["geometry"]["coordinates"]) for f in feats)
    print(f"{out}: {len(feats)} segments, {total:.0f} m, connecting {len(terminals)} places")


if __name__ == "__main__":
    main()
