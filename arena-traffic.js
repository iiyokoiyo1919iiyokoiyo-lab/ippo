// =====================================================================
// シティバトル: 車 (パトカー・救急車・乗れる一般車)
//   ・道路は 6×6 の交差点の格子。車は格子の道をたどって走る (ワープしない)
//   ・左側の車線を走る。止まっている車 (マップの箱) の手前で反対の車線へよけて、通りすぎたらもどる
//   ・前に人・プレイヤー・車がいたら減速して止まる (ぶつからない)
//   ・プレイヤーから遠い車は、まわりを見ずに道だけたどる (軽くする)
//   ・一般車はプレイヤーが運転する (位置はプレイヤーのブラウザが送る。arena.js がたしかめる)
// =====================================================================
const M = require('./public/games/arena/arena-map.js');

const BLOCK = 18, ROAD = 8, N = M.N, STEP = BLOCK + ROAD, LANE = 1.9;
const line = (i) => -M.HALF + ROAD / 2 + i * STEP;
const KIND = { civ: 0, police: 1, ambulance: 2 };
const LEN = { civ: 1.35, police: 1.4, ambulance: 1.75 }; // 当たりの円 3 つの間かく (前後)
const CAR_R = 1.05;
const DIM = { civ: { w: 1.9, l: 4.4, h: 1.5 }, police: { w: 1.9, l: 4.4, h: 1.55 }, ambulance: { w: 2.1, l: 5.4, h: 2.45 } }; // 弾が当たる箱
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

class Traffic {
  constructor(map) {
    this.map = map; this.vehicles = new Map(); this.seq = 0;
    // 止まっている車 (道ばたの車も乗れる車。動いていない車を「よける車」として使う)
    this.nodes = []; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) this.nodes.push({ i, j, x: line(i), z: line(j), nb: [] });
    // 通れる道 (大きな公園の中の道路はない)
    this.edges = [];
    for (const a of this.nodes) for (const [di, dj] of [[1, 0], [0, 1]]) { const b = this.node(a.i + di, a.j + dj); if (b === a || a.i + di > N || a.j + dj > N || !M.roadOpen(a, b)) continue; a.nb.push(b); b.nb.push(a); this.edges.push([a, b]); }
    this.open = this.nodes.filter((n) => n.nb.length);
  }
  node(i, j) { return this.nodes[clamp(i, 0, N) * (N + 1) + clamp(j, 0, N)]; }
  nearestNode(x, z) { let b = this.open[0], bd = 1e9; for (const n of this.open) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; b = n; } } return b; }
  // いちばん近い「通れる道路」のまん中の線の上の点 (どの区間か: edge)
  roadPoint(x, z) {
    let best = null, bd = 1e9;
    for (const [a, b] of this.edges) {
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez, t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1), px = a.x + ex * t, pz = a.z + ez * t, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd) { bd = d; best = { x: px, z: pz, edge: [a, b] }; }
    }
    return best;
  }
  // 交差点の道順: 通れる道だけで、いちばん近い道 (同じ長さなら毎回少しちがう道)
  nodePath(a, b) {
    if (a === b) return [a];
    const prev = new Map([[a, null]]); let q = [a];
    while (q.length && !prev.has(b)) { const nq = []; for (const n of q) for (const m of [...n.nb].sort(() => Math.random() - 0.5)) if (!prev.has(m)) { prev.set(m, n); nq.push(m); } q = nq; }
    if (!prev.has(b)) return [a];
    const out = []; for (let n = b; n; n = prev.get(n)) out.unshift(n); return out;
  }
  // 道順 → 走る点 (左の車線)。止まっている車があれば、反対の車線へよける点を足す
  waypoints(from, pts) {
    const out = []; let prev = from;
    for (const p of pts) {
      const dx = p.x - prev.x, dz = p.z - prev.z, L = Math.hypot(dx, dz);
      if (L < 0.5) { prev = p; continue; }
      const ux = dx / L, uz = dz / L, ox = uz * LANE, oz = -ux * LANE; // 左の車線
      // この区間の止まっている車 (車線の上・区間の中)
      const blocks = [];
      for (const b of this.parkedBoxes()) {
        const rx = b.x - prev.x, rz = b.z - prev.z, along = rx * ux + rz * uz, side = rx * ox / LANE + rz * oz / LANE;
        if (along < -3 || along > L + 3) continue;
        if (Math.abs(side - LANE) < 1.6) blocks.push(along);
      }
      blocks.sort((a, b) => a - b);
      for (const a of blocks) { // 反対の車線へ出て、通りすぎたらもどる
        const a0 = Math.max(0, a - 6), a1 = Math.min(L, a + 6);
        out.push({ x: prev.x + ux * a0 - ox * 0.1, z: prev.z + uz * a0 - oz * 0.1 }, { x: prev.x + ux * (a0 + 2.5) - ox, z: prev.z + uz * (a0 + 2.5) - oz }, { x: prev.x + ux * a1 - ox, z: prev.z + uz * a1 - oz });
      }
      out.push({ x: p.x + ox, z: p.z + oz, end: !!p.end });
      prev = p;
    }
    return out;
  }
  // (x, z) から (tx, tz) の近くの道路の点まで
  plan(v, tx, tz) {
    const dest = this.roadPoint(tx, tz), a = this.nearestNode(v.x, v.z);
    // 行き先の区間の両はしのうち、近いほうの交差点まで → そこから行き先へ
    const [e0, e1] = dest.edge, p0 = this.nodePath(a, e0), p1 = this.nodePath(a, e1), nodes = p0.length <= p1.length ? p0 : p1;
    // 最後の交差点と行き先が同じ道の上にあるように (ちがえば 1 つ手前の交差点で曲がる)
    const pts = nodes.map((n) => ({ x: n.x, z: n.z }));
    pts.push({ x: dest.x, z: dest.z, end: true });
    v.wp = this.waypoints({ x: v.x, z: v.z }, pts); v.wi = 0; v.arrived = false; v.dest = dest;
    return dest;
  }
  // いま止まっている一般車を、向きに合わせた箱にする (道をよけるため)
  parkedBoxes() { const out = []; for (const v of this.vehicles.values()) { if (v.kind !== 'civ' || v.driver || v.hidden || Math.abs(v.speed) > 0.5) continue; const ax = Math.abs(Math.sin(v.yaw)) > 0.7; out.push({ x: v.x, z: v.z, w: ax ? 4.4 : 1.9, d: ax ? 1.9 : 4.4 }); } return out; }
  // 弾が車に当たるまでの距離 (車は弾よけになる)
  rayHit(o, d, max) { let best = max; for (const v of this.vehicles.values()) { if (v.hidden) continue; const dx = v.x - o[0], dz = v.z - o[2]; if (dx * dx + dz * dz > (max + 4) ** 2) continue; const t = M.rayOBB(o, d, { x: v.x, z: v.z, yaw: v.yaw, ...DIM[v.kind] }); if (t < best) best = t; } return best; }
  add(kind, x, z, yaw = 0, extra = {}) {
    const v = { id: 'v' + (++this.seq), kind, x, z, yaw, speed: 0, hidden: false, siren: false, driver: null, wp: [], wi: 0, arrived: true, blockedMs: 0, color: extra.color || null, ...extra };
    this.vehicles.set(v.id, v); return v;
  }
  circles(v) { const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), L = LEN[v.kind] || 1.4; return [-L, 0, L].map((k) => ({ x: v.x + fx * k, z: v.z + fz * k, r: CAR_R })); }
  // 近くの車の円 (NPC がよける)
  near(x, z, r) { const out = []; for (const v of this.vehicles.values()) { if (v.hidden || (v.x - x) ** 2 + (v.z - z) ** 2 > (r + 4) ** 2) continue; out.push(...this.circles(v)); } return out; }
  // 1 回ぶん走る。obstacles: [{x, z}] (人・プレイヤー)。far: まわりを見ない
  drive(v, dt, { cruise = 10, obstacles = [], far = false } = {}) {
    if (v.hidden || v.driver) return;
    let want = 0;
    if (!v.arrived && v.wp && v.wi < v.wp.length) {
      let p = v.wp[v.wi]; const last = v.wi === v.wp.length - 1;
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < (last ? 1.6 : 3.2)) { v.wi++; if (v.wi >= v.wp.length) { v.arrived = true; } else p = v.wp[v.wi]; }
      if (!v.arrived) {
        const des = Math.atan2(-(p.x - v.x), -(p.z - v.z)), diff = wrap(des - v.yaw);
        const turn = 2.1 * dt * Math.min(1, Math.abs(v.speed) / 4 + 0.35);
        v.yaw = wrap(v.yaw + clamp(diff, -turn, turn));
        const dd = Math.hypot(p.x - v.x, p.z - v.z);
        want = cruise;
        if (Math.abs(diff) > 0.6) want = Math.min(want, 4.5);                     // 曲がるときはゆっくり
        if (v.wi === v.wp.length - 1) want = Math.min(want, Math.max(1.5, dd * 0.9)); // 着く前は減速
      }
    }
    // 前に何かいたら止まる
    if (!far && want > 0) {
      const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx;
      let stopAt = Infinity;
      const check = (o, wide = 1.4) => { const dx = o.x - v.x, dz = o.z - v.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * rx + dz * rz); if (ahead > 0 && ahead < 11 && side < wide) stopAt = Math.min(stopAt, ahead); };
      for (const o of obstacles) check(o);
      if (v.blockedMs < 5000) for (const u of this.vehicles.values()) { if (u === v || u.hidden) continue; check(u, 1.8); } // 5 秒以上つまったら車は無視 (おたがいにゆずり合って動けなくならない)
      if (stopAt < Infinity) { want = Math.min(want, Math.max(0, (stopAt - 3.6) * 1.5)); }
      v.blockedMs = want < 0.3 && stopAt < Infinity ? v.blockedMs + dt * 1000 : 0;
      if (v.blockedMs > 7000) v.blockedMs = 0;
    }
    const acc = want > v.speed ? 5 : 10;
    v.speed += clamp(want - v.speed, -acc * dt, acc * dt);
    if (Math.abs(v.speed) > 0.01) {
      v.x += -Math.sin(v.yaw) * v.speed * dt; v.z += -Math.cos(v.yaw) * v.speed * dt;
      if (!far) { const c = { x: v.x, y: 0, z: v.z }; M.collide(this.map, c, 1.0); v.x = c.x; v.z = c.z; } // 建物にはめりこまない
    }
  }
  // 運転していない一般車をとめる (プレイヤーが降りたあと)
  park(v) { v.speed = 0; v.arrived = true; v.wp = []; }
  list() { return [...this.vehicles.values()].map((v) => ({ id: v.id, k: KIND[v.kind], color: v.color })); }
  // [id, x, z, yaw, 速さ, flags (1: 見えない・2: サイレン・4: 赤色灯), 運転している人]
  snapshot() { const out = []; for (const v of this.vehicles.values()) out.push([v.id, +v.x.toFixed(2), +v.z.toFixed(2), +v.yaw.toFixed(3), +v.speed.toFixed(1), (v.hidden ? 1 : 0) | (v.siren ? 2 : 0) | (v.lights ? 4 : 0), v.driver || 0]); return out; }
  // 端の道 (マップから出入りする場所): いちばん近い外周の交差点
  edgeNode(x, z) { let best = null, bd = 1e9; for (const n of this.open) { if (n.i !== 0 && n.i !== N && n.j !== 0 && n.j !== N) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; }
}
module.exports = { Traffic, KIND, LANE, line, N, CAR_R, DIM };
