"""Build data/graph.json, the walking network the web map routes on.

Output:
  nodes   [[lon, lat], ...]
  edges   [[from, to, metres, cost], ...]   cost = metres, x1.5 outside the campus fence
  places  {osm_id: node index}               where each place joins the network

Usage: python3 scripts/build_graph.py
"""
import json
from pathlib import Path

import networkx as nx

from build_main_paths import OUTSIDE_PENALTY, ORIGIN_LEGEND, WALKABLE, inside, key, metres

ROOT = Path(__file__).resolve().parent.parent
PLACES = json.loads((ROOT / "data/places.candidates.geojson").read_text())
CONTEXT = json.loads((ROOT / "data/osm-context.geojson").read_text())


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
            m = metres(a, b)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            g.add_edge(a, b, m=m, cost=m * (1 if inside(mid, ring) else OUTSIDE_PENALTY))
    g = g.subgraph(max(nx.connected_components(g), key=len)).copy()

    nodes = list(g)
    index = {n: i for i, n in enumerate(nodes)}
    campus_nodes = [n for n in nodes if inside(n, ring)]

    places = {}
    for f in PLACES["features"]:
        geom = f["geometry"]
        verts = [geom["coordinates"]] if geom["type"] == "Point" else geom["coordinates"][0]
        outside = not inside((sum(v[0] for v in verts) / len(verts), sum(v[1] for v in verts) / len(verts)), ring)
        cand = nodes if f["properties"]["legend_no"] in ORIGIN_LEGEND or outside else campus_nodes
        best = min(cand, key=lambda n: min(metres(n, v) for v in verts))
        places[f["properties"]["osm_id"]] = index[best]

    # The dormitory blocks stand side by side: walk from whichever block's
    # joining point is nearest the campus, as students do.
    cx = sum(c[0] for c in ring) / len(ring)
    cy = sum(c[1] for c in ring) / len(ring)
    dorm = [f["properties"]["osm_id"] for f in PLACES["features"] if f["properties"]["legend_no"] == 19]
    best = min((places[d] for d in dorm), key=lambda i: metres(nodes[i], (cx, cy)))
    for d in dorm:
        places[d] = best

    out = ROOT / "data/graph.json"
    out.write_text(json.dumps({
        "attribution": "© OpenStreetMap contributors, ODbL",
        "nodes": [list(n) for n in nodes],
        "edges": [[index[a], index[b], round(d["m"], 1), round(d["cost"], 1)] for a, b, d in g.edges(data=True)],
        "places": places,
    }, separators=(",", ":")))
    print(out, len(nodes), "nodes", g.number_of_edges(), "edges", len(places), "places")


if __name__ == "__main__":
    main()
