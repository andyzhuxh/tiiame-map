# TIIAME Campus Map

A mobile-friendly campus map that helps new international students at TIIAME
(Tashkent Institute of Irrigation and Agricultural Mechanization Engineers)
find teaching buildings, the canteen, the library and other places, starting from:

- the main gate
- the international dormitory
- dormitory No. 8

帮助 TIIAME 国际新生从大门口、国际宿舍和 8 号宿舍出发，找到教学楼、食堂、图书馆等地点。

## Use the map / 使用地图

Tap one building to see its card and photo, then tap a second building to see
the walking route between them, with distance and walking time. A link ending
in `#19-16` opens the walk from place 19 to place 16 (numbers from the official
campus map).

点一栋楼看介绍和照片，再点第二栋楼看两者之间的步行路线、距离和时间。
网址后面加 `#19-16` 可以直接打开从 19 号到 16 号地点的路线。

Run locally / 本地预览:

```
python3 -m http.server 8765
# open http://localhost:8765/
```

Photos go in `photos/` — see `photos/README.md`. 照片放在 `photos/` 文件夹。

## Data / 数据

- `data/places.candidates.geojson` — candidate locations, **not yet verified on site**.
  Each feature has `legend_no` (number on the official campus map), names in
  English / O‘zbekcha / 中文, `confidence` (high / medium / low) and `verified`.
- `data/osm-context.geojson` — campus boundary, nearby buildings, streets and footpaths from OpenStreetMap.
  The campus outline (`kind: campus`) is widened by `python3 scripts/build_campus_area.py` to take in the
  sport hall, building 12 and the dormitories; the original OSM outline is kept as `kind: campus_osm`.
- `data/main-paths.geojson` — main walking paths: the shortest part of the network that still connects every place, built by `python3 scripts/build_main_paths.py`.
- `data/graph.json` — walking network the map routes on, built by `python3 scripts/build_graph.py`.
- `docs/campus-view.png` — tilted 2.5D view of the campus (looking south-south-west), built by `python3 scripts/build_view_map.py`.
- `docs/verify-map.png` — map for on-site checking, built by `python3 scripts/build_verify_map.py`.

Building outlines and some names come from OpenStreetMap,
© OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
Building numbers and names follow the campus map in the TIIAME 2025 conference program.
