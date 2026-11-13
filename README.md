# TIIAME Campus Map

A mobile-friendly campus map that helps new international students at TIIAME
(Tashkent Institute of Irrigation and Agricultural Mechanization Engineers)
find teaching buildings, the canteen, the library and other places, starting from:

- the main gate
- the international dormitory
- dormitory No. 8

帮助 TIIAME 国际新生从大门口、国际宿舍和 8 号宿舍出发，找到教学楼、食堂、图书馆等地点。

## Data / 数据

- `data/places.candidates.geojson` — candidate locations, **not yet verified on site**.
  Each feature has `legend_no` (number on the official campus map), names in
  English / O‘zbekcha / 中文, `confidence` (high / medium / low) and `verified`.
- `data/osm-context.geojson` — campus boundary, nearby buildings, streets and footpaths from OpenStreetMap.
- `data/main-paths.geojson` — main walking paths: the shortest part of the network that still connects every place, built by `python3 scripts/build_main_paths.py`.
- `docs/campus-view.png` — tilted 2.5D view of the campus (looking south-south-west), built by `python3 scripts/build_view_map.py`.
- `docs/verify-map.png` — map for on-site checking, built by `python3 scripts/build_verify_map.py`.

Building outlines and some names come from OpenStreetMap,
© OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
Building numbers and names follow the campus map in the TIIAME 2025 conference program.
