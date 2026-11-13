// TIIAME campus map: tap one building for its card, tap a second for the walking route.
// The map can be rotated and tilted to see the campus from any side.
"use strict";

const WALK_M_PER_MIN = 75;
const LEVEL_M = 3.2;
const DEFAULT_LEVELS = 2;
const CENTRE = [69.2945, 41.3242];
const OFFICIAL_VIEW = { bearing: 202, pitch: 55, center: [69.2946, 41.3233], zoom: 16.9 };   // matches the official campus map

const CATEGORY_COLOR = {
  teaching: "#3b6fd4", lab: "#5b7fb0", lecture: "#3b6fd4", research: "#6a5fc1",
  canteen: "#e3622c", library: "#9b3fb5", dormitory: "#139a8a", sport: "#3e9b3e",
  admin: "#6b6b6b", culture: "#c2417a", it: "#2b8bc6", workshop: "#8a6d3b",
  parking: "#7a7a7a", entrance: "#1e6937",
};

// Quick routes for newcomers: pick a start, then a destination (legend numbers).
const QUICK_FROM = [
  { no: 102, text: "国际生宿舍" },
  { no: 104, text: "8 号宿舍楼" },
  { no: 19, text: "学生宿舍" },
];
const QUICK_TO = [
  { no: 16, text: "雅思楼" },
  { no: 22, text: "食堂" },
  { no: 21, text: "图书馆" },
  { no: 8, text: "B 教学楼" },
];

const map = new maplibregl.Map({
  container: "map",
  center: CENTRE,
  zoom: 16.6,
  pitch: 45,
  bearing: 0,
  maxPitch: 70,
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.35 } }],
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

const els = {
  hint: document.getElementById("hint"),
  quick: document.getElementById("quick"),
  route: document.getElementById("route"),
  cards: document.getElementById("cards"),
  clear: document.getElementById("clear"),
  tilt: document.getElementById("tilt"),
};

let graph, adjacency, places;
let selected = [];               // up to two place features
const byId = new Map();          // osm_id -> place feature
const labelMarkers = [];

const loaded = new Promise((resolve) => map.on("load", resolve));
Promise.all([
  fetch("data/places.candidates.geojson").then((r) => r.json()),
  fetch("data/graph.json").then((r) => r.json()),
  fetch("data/osm-context.geojson").then((r) => r.json()),
  loaded,
]).then(([p, g, ctx]) => {
  places = p;
  graph = g;
  adjacency = buildAdjacency(g);
  for (const f of places.features) byId.set(f.properties.osm_id, f);
  drawLayers(ctx);
  drawLabels();
  drawQuick();
  openFromHash();
}).catch((err) => {
  els.hint.textContent = "地图数据加载失败，请刷新页面重试。";
  console.error(err);
});

const height = (levels) => (Number(levels) || DEFAULT_LEVELS) * LEVEL_M;

function drawLayers(ctx) {
  const placeIds = new Set(places.features.map((f) => f.properties.osm_id));
  const campus = ctx.features.find((f) => f.properties.kind === "campus");
  const others = ctx.features
    .filter((f) => f.properties.kind === "building" && !placeIds.has(f.properties.osm_id))
    .map((f) => ({ ...f, properties: { h: height(f.properties.levels) } }));
  const polys = places.features
    .filter((f) => f.geometry.type === "Polygon")
    .map((f) => ({ ...f, properties: { ...f.properties, h: height(f.properties.levels), color: CATEGORY_COLOR[f.properties.category] || "#555" } }));
  const points = places.features
    .filter((f) => f.geometry.type === "Point")
    .map((f) => ({ ...f, properties: { ...f.properties, color: CATEGORY_COLOR[f.properties.category] || "#555" } }));

  map.addSource("campus", { type: "geojson", data: campus });
  map.addSource("others", { type: "geojson", data: { type: "FeatureCollection", features: others } });
  map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: polys } });
  map.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: points } });
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("route-outside", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({ id: "campus-fill", type: "fill", source: "campus", paint: { "fill-color": "#fff8d6", "fill-opacity": 0.35 } });
  map.addLayer({ id: "campus-line", type: "line", source: "campus", paint: { "line-color": "#1e6937", "line-width": 3, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "route-outside", type: "line", source: "route-outside", layout: { "line-join": "round" }, paint: { "line-color": "#6b6b6b", "line-width": 5, "line-dasharray": [1.5, 1.2] } });
  map.addLayer({ id: "route-edge", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#19143f", "line-width": 12 } });
  map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffde00", "line-width": 7 } });
  map.addLayer({
    id: "others-3d", type: "fill-extrusion", source: "others",
    paint: { "fill-extrusion-color": "#d9d2c7", "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.75 },
  });
  map.addLayer({
    id: "places-3d", type: "fill-extrusion", source: "places",
    paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.85 },
  });
  map.addLayer({
    id: "places-selected", type: "fill-extrusion", source: "places", filter: ["in", ["get", "osm_id"], ["literal", []]],
    paint: { "fill-extrusion-color": "#ffde00", "fill-extrusion-height": ["+", ["get", "h"], 0.5], "fill-extrusion-opacity": 0.95 },
  });
  map.addLayer({
    id: "points", type: "circle", source: "points",
    paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });

  for (const layer of ["places-3d", "places-selected", "points"]) {
    map.on("click", layer, (e) => {
      const id = e.features[0].properties.osm_id;
      if (byId.has(id)) select(byId.get(id));
    });
    map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
  }
}

function centreOf(f) {
  if (f.geometry.type === "Point") return f.geometry.coordinates;
  const ring = f.geometry.coordinates[0];
  return [ring.reduce((s, c) => s + c[0], 0) / ring.length, ring.reduce((s, c) => s + c[1], 0) / ring.length];
}

// One HTML label per place, so Chinese text needs no map font server.
function drawLabels() {
  const done = new Set();
  for (const f of places.features) {
    const p = f.properties;
    if (done.has(p.legend_no) && p.legend_no !== 1) continue;
    done.add(p.legend_no);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "place-label";
    el.textContent = label(f);
    el.addEventListener("click", (e) => { e.stopPropagation(); select(f); });
    const anchorH = f.geometry.type === "Point" ? 0 : height(p.levels);
    labelMarkers.push({ marker: new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -anchorH * 0.6] }).setLngLat(centreOf(f)).addTo(map), h: anchorH });
  }
  const resize = () => {
    const z = map.getZoom();
    const size = Math.max(5, Math.min(13, 6 * Math.pow(1.5, z - 17)));
    document.documentElement.style.setProperty("--label-size", `${size.toFixed(1)}px`);
    map.getContainer().classList.toggle("hide-labels", z < 15.8);
  };
  map.on("zoom", resize);
  resize();
}

function drawQuick() {
  let from = QUICK_FROM[0].no;
  const row = (title, items, onPick, isOn) => {
    const wrap = document.createElement("div");
    wrap.className = "quick-row";
    const t = document.createElement("span");
    t.textContent = title;
    wrap.append(t);
    for (const q of items) {
      if (!first(q.no)) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = q.text;
      btn.dataset.no = q.no;
      btn.setAttribute("aria-pressed", String(isOn(q.no)));
      btn.addEventListener("click", () => onPick(q.no, btn, wrap));
      wrap.append(btn);
    }
    return wrap;
  };
  const press = (wrap, btn) => wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  const fromRow = row("出发", QUICK_FROM, (no, btn, wrap) => { from = no; press(wrap, btn); }, (no) => no === from);
  els.quick.append(
    fromRow,
    row("去", QUICK_TO, (no, btn, wrap) => { press(wrap, btn); selected = []; select(first(from)); select(first(no)); }, () => false),
  );
  // Keep the start buttons in step when a route opens from a link.
  els.quick.syncFrom = (no) => {
    if (!QUICK_FROM.some((q) => q.no === no)) return;
    from = no;
    fromRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.no) === no)));
  };
}

function first(no) {
  return places.features.find((f) => f.properties.legend_no === no && f.geometry.type === "Polygon")
    || places.features.find((f) => f.properties.legend_no === no);
}

// A link ending in #19-16 opens the walk from place 19 to place 16 (legend numbers).
function openFromHash() {
  const m = location.hash.match(/^#(\d+)-(\d+)$/);
  if (!m) return;
  const a = first(Number(m[1]));
  const b = first(Number(m[2]));
  if (a && b) {
    els.quick.syncFrom?.(Number(m[1]));
    select(a);
    select(b);
  }
}

function select(f) {
  if (selected.length === 2) selected = [];
  if (selected.length === 1 && selected[0].properties.osm_id === f.properties.osm_id) return;
  selected.push(f);
  map.setFilter("places-selected", ["in", ["get", "osm_id"], ["literal", selected.map((s) => s.properties.osm_id)]]);
  renderCards();
  clearRoute();
  if (selected.length === 2) showRoute(selected[0], selected[1]);
  else els.hint.textContent = `已选：${label(f)}。再点第二栋楼看步行路线`;
  els.clear.hidden = false;
}

els.clear.addEventListener("click", () => {
  selected = [];
  map.setFilter("places-selected", ["in", ["get", "osm_id"], ["literal", []]]);
  clearRoute();
  els.cards.replaceChildren();
  els.clear.hidden = true;
  els.hint.textContent = "点一栋楼看介绍，再点第二栋楼看步行路线";
});

function label(f) {
  return f.properties.legend_no === 1 ? "入口" : f.properties.name_zh;
}

function renderCards() {
  els.cards.replaceChildren(...selected.map((f, i) => card(f, i === 0 ? "起点" : "终点")));
}

function card(f, tag) {
  const p = f.properties;
  const el = document.createElement("article");
  el.className = "card";

  const photo = document.createElement("div");
  photo.className = "photo";
  const img = new Image();
  img.alt = `${label(f)}实景照片`;
  img.src = `photos/${p.legend_no}.jpg`;
  img.onerror = () => { photo.textContent = "暂无实景照片。欢迎拍照补充：放到 photos/ 文件夹，按编号命名。"; };
  photo.append(img);

  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = `
    <span class="tag">${tag}</span>
    <h2></h2>
    <span class="alt"></span>
    <p class="desc"></p>`;
  body.querySelector("h2").textContent = label(f);
  body.querySelector(".alt").textContent = [p.name_uz, p.name_en].filter(Boolean).join(" · ");
  const desc = body.querySelector(".desc");
  if (p.desc_zh) desc.textContent = p.desc_zh; else desc.remove();
  if (!p.verified) {
    const warn = document.createElement("p");
    warn.className = "warn";
    warn.textContent = p.confidence === "low" ? "位置是推测的，还没有实地核对。" : "位置还没有实地核对。";
    body.append(warn);
  }
  el.append(photo, body);
  return el;
}

const line = (r) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.coords } });

function metresBetween(p, q) {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320;
  return Math.hypot((p[0] - q[0]) * k, (p[1] - q[1]) * 110570);
}

function clearRoute() {
  map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
  map.getSource("route-outside")?.setData({ type: "FeatureCollection", features: [] });
  els.route.hidden = true;
}

function showRoute(a, b) {
  const path = shortestPath(graph.places[a.properties.osm_id], graph.places[b.properties.osm_id]);
  if (!path) {
    els.route.hidden = false;
    els.route.textContent = "没有找到这两处之间的步行路线。";
    return;
  }
  // Short walking links from each building to the path network count as inside
  // when the building is; the rest is split into inside (yellow) and outside (grey) runs.
  const pts = path.nodes.map((i) => graph.nodes[i]);
  const coords = [centreOf(a), ...pts, centreOf(b)];
  const steps = [path.inside[0] ?? true, ...path.inside, path.inside[path.inside.length - 1] ?? true];
  const runs = [];
  let outsideM = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ins = steps[i];
    const last = runs[runs.length - 1];
    if (last && last.ins === ins) last.coords.push(coords[i + 1]);
    else runs.push({ ins, coords: [coords[i], coords[i + 1]] });
    if (!ins) outsideM += metresBetween(coords[i], coords[i + 1]);
  }
  map.getSource("route").setData({ type: "FeatureCollection", features: runs.filter((r) => r.ins).map(line) });
  map.getSource("route-outside").setData({ type: "FeatureCollection", features: runs.filter((r) => !r.ins).map(line) });
  const bounds = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  map.fitBounds(bounds, { padding: 70, bearing: map.getBearing(), pitch: map.getPitch(), maxZoom: 18, duration: 800 });

  const minutes = Math.max(1, Math.round(path.metres / WALK_M_PER_MIN));
  els.route.hidden = false;
  els.route.innerHTML = "";
  els.route.append(`${label(a)} → ${label(b)}：约 ${Math.round(path.metres / 10) * 10} 米，步行约 ${minutes} 分钟`);
  const note = document.createElement("small");
  note.textContent = (outsideM >= 10 ? `其中约 ${Math.round(outsideM / 10) * 10} 米在校外（灰色虚线），因为校内没有路相通。` : "")
    + "路线按 OpenStreetMap 上的道路计算，实际以现场为准。";
  els.route.append(note);
  els.hint.textContent = "黄线是步行路线。点任意一栋楼重新开始。";
}

// View buttons: rotate, face north, flat/3D, and the official map's angle.
// Turns add up from the target angle, so quick repeated taps are not lost mid-animation.
let targetBearing = null;
map.on("moveend", () => { targetBearing = null; });
const turn = (deg) => {
  targetBearing = (targetBearing ?? map.getBearing()) + deg;
  map.easeTo({ bearing: targetBearing });
};
document.querySelectorAll(".view-tools button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    if (v === "left") turn(-45);
    else if (v === "right") turn(45);
    else if (v === "north") map.easeTo({ bearing: 0 });
    else if (v === "tilt") map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 50 });
    else if (v === "official") map.easeTo(OFFICIAL_VIEW);
  });
});
map.on("pitchend", () => { els.tilt.textContent = map.getPitch() > 5 ? "2D" : "3D"; });
map.once("load", () => { els.tilt.textContent = map.getPitch() > 5 ? "2D" : "3D"; });

function buildAdjacency(g) {
  const adj = g.nodes.map(() => []);
  for (const [u, v, m, cost, ins] of g.edges) {
    adj[u].push([v, m, cost, ins]);
    adj[v].push([u, m, cost, ins]);
  }
  return adj;
}

// Dijkstra on cost; returns the node list, which steps are inside the campus,
// and the real walking length in metres.
function shortestPath(s, t) {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const metres = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const prevIn = new Int8Array(n);
  const heap = [[0, s]];
  dist[s] = 0;
  while (heap.length) {
    const [d, u] = heapPop(heap);
    if (u === t) break;
    if (d > dist[u]) continue;
    for (const [v, m, cost, ins] of adjacency[u]) {
      const nd = d + cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        metres[v] = metres[u] + m;
        prev[v] = u;
        prevIn[v] = ins;
        heapPush(heap, [nd, v]);
      }
    }
  }
  if (dist[t] === Infinity) return null;
  const nodes = [];
  const inside = [];             // inside[i]: is the step from nodes[i] to nodes[i + 1] inside the campus
  for (let u = t; u !== -1; u = prev[u]) {
    nodes.push(u);
    if (prev[u] !== -1) inside.push(prevIn[u] === 1);
  }
  return { nodes: nodes.reverse(), inside: inside.reverse(), metres: metres[t] };
}

function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
