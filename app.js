// TIIAME campus map: tap one building for its card, tap a second for the walking route.
"use strict";

const WALK_M_PER_MIN = 75;
const ROUTE_STYLE = { color: "#ffde00", weight: 7, opacity: 1 };
const ROUTE_EDGE = { color: "#19143f", weight: 12, opacity: 0.9 };

const CATEGORY_COLOR = {
  teaching: "#3b6fd4", lab: "#5b7fb0", lecture: "#3b6fd4", research: "#6a5fc1",
  canteen: "#e3622c", library: "#9b3fb5", dormitory: "#139a8a", sport: "#3e9b3e",
  admin: "#6b6b6b", culture: "#c2417a", it: "#2b8bc6", workshop: "#8a6d3b",
  parking: "#7a7a7a", entrance: "#1e6937",
};

// Common walks for newcomers (start legend no -> end legend no).
const QUICK = [
  { from: 102, to: 16, text: "国际生宿舍 → 雅思楼" },
  { from: 102, to: 22, text: "国际生宿舍 → 食堂" },
  { from: 102, to: 21, text: "国际生宿舍 → 图书馆" },
  { from: 19, to: 16, text: "宿舍 → 雅思楼" },
  { from: 19, to: 22, text: "宿舍 → 食堂" },
  { from: 19, to: 21, text: "宿舍 → 图书馆" },
];

const map = L.map("map", { zoomControl: true }).setView([41.3234, 69.2950], 17);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const els = {
  hint: document.getElementById("hint"),
  quick: document.getElementById("quick"),
  route: document.getElementById("route"),
  cards: document.getElementById("cards"),
  clear: document.getElementById("clear"),
};

let graph, adjacency;
let selected = [];            // up to two place features
let routeLayers = [];
const layerById = new Map();  // osm_id -> Leaflet layer

Promise.all([
  fetch("data/places.candidates.geojson").then((r) => r.json()),
  fetch("data/graph.json").then((r) => r.json()),
  fetch("data/osm-context.geojson").then((r) => r.json()),
]).then(([places, g, ctx]) => {
  graph = g;
  adjacency = buildAdjacency(g);
  drawCampus(ctx);
  drawPlaces(places);
  drawQuick(places);
  openFromHash(places);
}).catch((err) => {
  els.hint.textContent = "地图数据加载失败，请刷新页面重试。";
  console.error(err);
});

function drawCampus(ctx) {
  const campus = ctx.features.find((f) => f.properties.kind === "campus");
  L.geoJSON(campus, { style: { color: "#1e6937", weight: 3, fill: false, dashArray: "6 6" }, interactive: false }).addTo(map);
}

function drawPlaces(places) {
  const labelled = new Set();
  for (const f of places.features) {
    const p = f.properties;
    const color = CATEGORY_COLOR[p.category] || "#555";
    let layer;
    if (f.geometry.type === "Point") {
      layer = L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
        radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
      });
    } else {
      layer = L.geoJSON(f, {
        style: {
          color, weight: 2, fillColor: color, fillOpacity: 0.35,
          dashArray: p.confidence === "low" ? "4 4" : null,
        },
      });
    }
    layer.on("click", () => select(f));
    layer.addTo(map);
    layerById.set(p.osm_id, layer);

    // One label per place name; gates are labelled 入口.
    const name = p.legend_no === 1 ? "入口" : p.name_zh;
    if (!labelled.has(p.legend_no) || p.legend_no === 1) {
      layer.bindTooltip(name, { permanent: true, direction: "center", className: "place-label" });
      labelled.add(p.legend_no);
    }
  }
  const toggle = () => {
    const c = map.getContainer().classList;
    const z = map.getZoom();
    c.toggle("hide-labels", z < 17);
    c.toggle("zoom-18", z === 18);
    c.toggle("zoom-19", z >= 19);
  };
  map.on("zoomend", toggle);
  toggle();
}

function drawQuick(places) {
  const first = (no) => places.features.find((f) => f.properties.legend_no === no && f.geometry.type === "Polygon")
    || places.features.find((f) => f.properties.legend_no === no);
  for (const q of QUICK) {
    const a = first(q.from);
    const b = first(q.to);
    if (!a || !b) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = q.text;
    btn.addEventListener("click", () => { selected = []; select(a); select(b); });
    els.quick.append(btn);
  }
}

// A link ending in #19-16 opens the walk from place 19 to place 16 (legend numbers).
function openFromHash(places) {
  const m = location.hash.match(/^#(\d+)-(\d+)$/);
  if (!m) return;
  const first = (no) => places.features.find((f) => f.properties.legend_no === no && f.geometry.type === "Polygon")
    || places.features.find((f) => f.properties.legend_no === no);
  const a = first(Number(m[1]));
  const b = first(Number(m[2]));
  if (a && b) { select(a); select(b); }
}

function select(f) {
  if (selected.length === 2) selected = [];
  if (selected.length === 1 && selected[0].properties.osm_id === f.properties.osm_id) return;
  selected.push(f);
  renderCards();
  clearRoute();
  if (selected.length === 2) showRoute(selected[0], selected[1]);
  else els.hint.textContent = `已选：${label(f)}。再点第二栋楼看步行路线`;
  els.clear.hidden = false;
}

els.clear.addEventListener("click", () => {
  selected = [];
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

function clearRoute() {
  routeLayers.forEach((l) => l.remove());
  routeLayers = [];
  els.route.hidden = true;
}

function showRoute(a, b) {
  const s = graph.places[a.properties.osm_id];
  const t = graph.places[b.properties.osm_id];
  const path = shortestPath(s, t);
  if (!path) {
    els.route.hidden = false;
    els.route.textContent = "没有找到这两处之间的步行路线。";
    return;
  }
  const latlngs = path.nodes.map((i) => [graph.nodes[i][1], graph.nodes[i][0]]);
  // Short walking links from each building to the path network.
  const centre = (f) => {
    const layer = layerById.get(f.properties.osm_id);
    return layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng();
  };
  const full = [centre(a), ...latlngs, centre(b)];
  routeLayers.push(L.polyline(full, ROUTE_EDGE).addTo(map));
  routeLayers.push(L.polyline(full, ROUTE_STYLE).addTo(map));
  map.fitBounds(L.latLngBounds(full).pad(0.25));

  const minutes = Math.max(1, Math.round(path.metres / WALK_M_PER_MIN));
  els.route.hidden = false;
  els.route.innerHTML = "";
  els.route.append(`${label(a)} → ${label(b)}：约 ${Math.round(path.metres / 10) * 10} 米，步行约 ${minutes} 分钟`);
  const note = document.createElement("small");
  note.textContent = "路线按 OpenStreetMap 上的校内道路计算，实际以现场为准。";
  els.route.append(note);
  els.hint.textContent = "黄线是步行路线。点任意一栋楼重新开始。";
}

function buildAdjacency(g) {
  const adj = g.nodes.map(() => []);
  for (const [u, v, m, cost] of g.edges) {
    adj[u].push([v, m, cost]);
    adj[v].push([u, m, cost]);
  }
  return adj;
}

// Dijkstra on cost; returns node list and real walking length in metres.
function shortestPath(s, t) {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const metres = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const heap = [[0, s]];
  dist[s] = 0;
  while (heap.length) {
    const [d, u] = heapPop(heap);
    if (u === t) break;
    if (d > dist[u]) continue;
    for (const [v, m, cost] of adjacency[u]) {
      const nd = d + cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        metres[v] = metres[u] + m;
        prev[v] = u;
        heapPush(heap, [nd, v]);
      }
    }
  }
  if (dist[t] === Infinity) return null;
  const nodes = [];
  for (let u = t; u !== -1; u = prev[u]) nodes.push(u);
  return { nodes: nodes.reverse(), metres: metres[t] };
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
