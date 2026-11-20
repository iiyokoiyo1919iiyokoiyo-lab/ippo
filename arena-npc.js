// =====================================================================
// シティバトル: 通行人 (NPC)
//   ・歩道を歩く (ブロックの角を結ぶ道と横断歩道)。体の状態は arena-body.js (プレイヤーと共通)
//   ・行動: Walking (歩く) / Alert (異常に気づく) / Fleeing (逃げる) / Hiding (隠れる)。倒れたら AI から外す
//   ・性格: 臆病 (すぐ逃げる)・冷静 (様子を見てから隠れる)・好奇心 (離れたところから見る)
//   ・異常 (銃声・被弾・転倒・悲鳴・倒れた人) は近くに伝わる。悲鳴はさらにまわりへ伝わる (3 段まで)
//   ・ぶつからないように、まわりの NPC・プレイヤー・倒れた人から離れる
//   ・しばらく何もなければ、ふだんの歩きにもどる
//   ・軽くするため: プレイヤーから遠い NPC はたまにしか動かさない・1 回に動かす数に上限 (npcMaxActive)
// =====================================================================
const crypto = require('crypto');
const Body = require('./arena-body');
const M = require('./public/games/arena/arena-map.js');

const BLOCK = 18, ROAD = 8, N = 5, INSET = 0.5;
const MODE = { walking: 0, alert: 1, fleeing: 2, hiding: 3 };
const PERSONA = {
  timid: { alertMs: [150, 450], flee: 0.95, hide: 0.05, run: 5.4, calmMs: 18000, scream: 0.75, sense: 1.3 },
  calm: { alertMs: [900, 1700], flee: 0.3, hide: 0.6, run: 4.4, calmMs: 10000, scream: 0.12, sense: 0.9 },
  curious: { alertMs: [500, 1000], flee: 0.2, hide: 0.1, run: 4.8, calmMs: 8000, scream: 0.25, sense: 1.1, watch: 14 },
};
const PERSONAS = Object.keys(PERSONA);
const EVENT = { shot: { r: 34, k: 1 }, impact: { r: 9, k: 0.8 }, hit: { r: 22, k: 1.3 }, down: { r: 18, k: 1.2 }, scream: { r: 14, k: 0.7 }, body: { r: 9, k: 0.6 } };
const rand = (a, b) => a + Math.random() * (b - a);

class NpcSystem {
  constructor(map, cfg, { send }) {
    this.map = map; this.cfg = cfg; this.send = send;
    this.npcs = new Map(); this.events = []; this.seq = 0; this.rr = 0;
    this.buildGraph(); this.buildCover();
  }
  // ---------- 歩道の道 (ブロックの 4 つの角・まわり・横断歩道) ----------
  buildGraph() {
    const o = (i) => -M.HALF + ROAD + i * (BLOCK + ROAD), nodes = [], key = (i, j, c) => `${i},${j},${c}`, idx = new Map();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (const [c, dx, dz] of [[0, INSET, INSET], [1, BLOCK - INSET, INSET], [2, BLOCK - INSET, BLOCK - INSET], [3, INSET, BLOCK - INSET]]) {
      idx.set(key(i, j, c), nodes.length); nodes.push({ x: o(i) + dx, z: o(j) + dz, nb: [] });
    }
    const link = (a, b) => { if (a == null || b == null || !this.clear(nodes[a], nodes[b])) return; nodes[a].nb.push(b); nodes[b].nb.push(a); };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      for (let c = 0; c < 4; c++) link(idx.get(key(i, j, c)), idx.get(key(i, j, (c + 1) % 4))); // ブロックのまわり
      if (i + 1 < N) { link(idx.get(key(i, j, 1)), idx.get(key(i + 1, j, 0))); link(idx.get(key(i, j, 2)), idx.get(key(i + 1, j, 3))); } // 横断歩道
      if (j + 1 < N) { link(idx.get(key(i, j, 3)), idx.get(key(i, j + 1, 0))); link(idx.get(key(i, j, 2)), idx.get(key(i, j + 1, 1))); }
    }
    this.nodes = nodes.filter((n) => n.nb.length); this.nodes.forEach((n, k) => { n.k = k; });
    // 消えた点への参照を付け直す
    const re = new Map(nodes.map((n, k) => [k, n])); for (const n of this.nodes) n.nb = n.nb.map((k) => re.get(k)).filter((x) => x && x.nb.length);
  }
  clear(a, b) { const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); return M.rayWorld(this.map, [a.x, 0.6, a.z], [dx / L, 0, dz / L], L) >= L - 0.05; }
  // 隠れる場所: ビル・壁の角のそば (歩道の上)
  buildCover() {
    this.cover = [];
    for (const b of this.map.solid) {
      if (!['building', 'wall'].includes(b.kind)) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = { x: b.x + sx * (b.w / 2 + 0.6), z: b.z + sz * (b.d / 2 + 0.6), y: 0 };
        const q = M.collide(this.map, { ...p }); if (Math.hypot(q.x - p.x, q.z - p.z) < 0.05) this.cover.push({ x: p.x, z: p.z, box: b });
      }
    }
  }
  // ---------- 出入り ----------
  sync(players) {
    const want = Math.max(0, Math.round(this.cfg.npcCount));
    let n = [...this.npcs.values()].filter((x) => !x.gone).length;
    while (n < want) { this.spawn(players); n++; }
    for (const x of [...this.npcs.values()]) { if (n <= want) break; if (!Body.isDown(x.body)) { this.remove(x); n--; } }
  }
  spawn(players) {
    let node = null;
    for (let k = 0; k < 10 && !node; k++) { const c = this.nodes[crypto.randomInt(0, this.nodes.length)]; if (players.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 25) || k === 9) node = c; }
    const persona = PERSONAS[crypto.randomInt(0, PERSONAS.length)];
    const npc = { id: 'n' + (++this.seq), seed: crypto.randomInt(1, 2 ** 31), persona, P: PERSONA[persona], x: node.x, y: 0, z: node.z, yaw: Math.random() * 6.28,
      mode: 'walking', node, from: null, goal: null, speed: rand(1.1, 1.6), body: Body.create(this.cfg.npcHp), lastThreat: null, lastThreatAt: 0, acc: 0, bodyEmitAt: 0 };
    this.npcs.set(npc.id, npc);
    this.send({ t: 'npcnew', n: this.pub(npc) });
    return npc;
  }
  remove(npc) { this.npcs.delete(npc.id); npc.gone = true; this.send({ t: 'npcgone', id: npc.id }); }
  pub(n) { return { id: n.id, seed: n.seed, x: +n.x.toFixed(2), z: +n.z.toFixed(2), yaw: +n.yaw.toFixed(2), m: MODE[n.mode] ?? 0, s: Body.CODE[n.body.state] }; }
  list() { return [...this.npcs.values()].map((n) => this.pub(n)); }
  // スナップショット (近いものだけ。[id, x, z, yaw, 行動, 体の状態])
  snapshot(near, R2) { const out = []; for (const n of this.npcs.values()) { if (near && (n.x - near.x) ** 2 + (n.z - near.z) ** 2 > R2) continue; out.push([n.id, +n.x.toFixed(2), +n.z.toFixed(2), +n.yaw.toFixed(2), MODE[n.mode] ?? 0, Body.CODE[n.body.state]]); } return out; }
  targets() { return [...this.npcs.values()].filter((n) => n.body.state !== Body.S.DEAD); }

  // ---------- 異常 ----------
  emit(type, x, z, extra = {}) { const e = EVENT[type]; if (e) this.events.push({ type, x, z, r: e.r, k: e.k, gen: 0, ...extra }); }
  hit(npc, info) {
    const res = Body.hit(npc.body, info, this.cfg);
    if (!res) return null;
    npc.mode = res === 'stagger' ? npc.mode : npc.mode; // 転倒・行動不能のあいだは AI から外れる (update でとばす)
    this.emit(res === 'stagger' ? 'hit' : 'down', npc.x, npc.z);
    if (res === 'down' && info.dir) { npc.x += info.dir[0] * 0.5; npc.z += info.dir[2] * 0.5; M.collide(this.map, npc); }
    this.threat(npc, info.from || { x: npc.x - (info.dir?.[0] || 0) * 5, z: npc.z - (info.dir?.[2] || 0) * 5 }, Date.now());
    return res;
  }
  threat(n, at, now) { n.lastThreat = { x: at.x, z: at.z }; n.lastThreatAt = now; }
  react(n, ev, now) {
    if (Body.isDown(n.body) || n.body.state === Body.S.STAGGERED) return;
    const d = Math.hypot(n.x - ev.x, n.z - ev.z), close = 1 - d / ev.r;
    if (close <= 0) return;
    const p = Math.min(1, ev.k * n.P.sense * this.cfg.npcReact * (0.45 + close));
    if (n.mode === 'walking' && Math.random() > p) return;
    this.threat(n, ev, now);
    if (n.mode === 'walking') {
      n.mode = 'alert'; n.decideAt = now + rand(...n.P.alertMs); n.goal = null; n.yaw = Math.atan2(-(ev.x - n.x), -(ev.z - n.z));
      if (ev.type !== 'body' && Math.random() < 0.7) this.send({ t: 'nfx', id: n.id, k: 'gasp' });
    } else if (n.mode === 'alert' && n.watching && d < 10 && ev.type !== 'body') { this.flee(n, now, ev); } // 見ていたら近くで起きた → 逃げる
    else if (n.mode === 'fleeing' && ev.type !== 'body') n.route = null; // 逃げる向きを考え直す
  }
  decide(n, now) {
    const P = n.P, t = n.lastThreat, d = t ? Math.hypot(n.x - t.x, n.z - t.z) : 99, fleeP = Math.min(1, P.flee * (this.cfg.npcFlee / 0.6));
    const r = Math.random();
    if (d < 7 || r < fleeP) return this.flee(n, now);
    if (r < fleeP + P.hide) return this.hide(n, now);
    if (P.watch && d > 6) { n.watching = true; n.decideAt = 0; return; } // 遠くから見る
    n.decideAt = 0; n.watching = false; // 立ち止まって見る
  }
  flee(n, now) {
    n.mode = 'fleeing'; n.watching = false; n.route = null; n.speed = rand(n.P.run - 0.5, n.P.run + 0.4);
    if (Math.random() < n.P.scream) { this.send({ t: 'nfx', id: n.id, k: 'scream' }); this.events.push({ type: 'scream', x: n.x, z: n.z, r: EVENT.scream.r, k: EVENT.scream.k, gen: 1 }); }
    void now;
  }
  hide(n, now) {
    const t = n.lastThreat; let best = null, bs = -1e9;
    for (const c of this.cover) {
      const d = Math.hypot(c.x - n.x, c.z - n.z); if (d > 18) continue;
      const dx = c.x - t.x, dz = c.z - t.z, L = Math.hypot(dx, dz) || 1;
      const blocked = M.rayWorld(this.map, [t.x, 1, t.z], [dx / L, 0, dz / L], L) < L - 0.5; // 異常の場所から見えない
      const s = (blocked ? 30 : 0) + L * 0.3 - d;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) return this.flee(n, now);
    n.mode = 'hiding'; n.hideAt = best; n.hidden = false; n.speed = rand(n.P.run - 1, n.P.run);
  }

  // ---------- 毎回の更新 ----------
  update(now, dt, players) {
    const cfg = this.cfg, list = [...this.npcs.values()];
    // 体の状態 (倒れた人は時間で起き上がる・行動不能 → 死亡 → しばらくして消える)
    for (const n of list) {
      const ch = Body.update(n.body, now);
      if (ch === Body.S.NORMAL) { n.mode = 'fleeing'; n.route = null; n.speed = n.P.run; this.threat(n, n.lastThreat || n, now); }
      if (n.body.state === Body.S.DEAD && now - n.body.since > cfg.corpseMs) this.remove(n);
      if (Body.isDown(n.body) && now - n.bodyEmitAt > 2500) { n.bodyEmitAt = now; this.emit('body', n.x, n.z); }
    }
    for (const p of players) if (p.downEmitAt == null || (p.down && now - p.downEmitAt > 2500)) { if (p.down) { p.downEmitAt = now; this.emit('body', p.x, p.z); } }
    // 異常を伝える (近い NPC だけ: 格子で探す)
    const grid = new Map(), C = 12, cell = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
    for (const n of this.npcs.values()) { const k = cell(n.x, n.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
    const near = (x, z, r) => { const out = [], cx = Math.floor(x / C), cz = Math.floor(z / C), s = Math.ceil(r / C); for (let i = -s; i <= s; i++) for (let j = -s; j <= s; j++) for (const n of grid.get(`${cx + i},${cz + j}`) || []) out.push(n); return out; };
    const evs = this.events.splice(0, 200);
    for (const ev of evs) for (const n of near(ev.x, ev.z, ev.r)) {
      const before = n.mode; this.react(n, ev, now);
      // 悲鳴は伝わる (3 段まで)
      if (ev.type === 'scream' && before === 'walking' && n.mode !== 'walking' && ev.gen < 3 && Math.random() < 0.5 * cfg.npcReact) this.events.push({ type: 'scream', x: n.x, z: n.z, r: EVENT.scream.r * 0.8, k: EVENT.scream.k * 0.8, gen: ev.gen + 1 });
    }
    // 動かす: 近い順に npcMaxActive まで。遠い NPC (プレイヤーから 80m 以上) は 0.5 秒に 1 回
    const pd = (n) => players.length ? Math.min(...players.map((p) => (p.x - n.x) ** 2 + (p.z - n.z) ** 2)) : 1e9;
    const order = list.filter((n) => !n.gone).map((n) => ({ n, d: pd(n) })).sort((a, b) => a.d - b.d);
    let budget = Math.max(1, Math.round(cfg.npcMaxActive));
    for (const { n, d } of order) {
      n.acc += dt;
      const far = d > 80 * 80;
      if (far && n.acc < 0.5) continue;
      if (budget-- <= 0) continue; // 上限をこえたぶんは、次の回に (acc がたまっていく)
      const step = Math.min(n.acc, 1); n.acc = 0;
      this.think(n, now, step, far, near, players);
    }
  }
  think(n, now, dt, far, near, players) {
    if (!Body.canMove(n.body)) return; // 硬直・転倒・行動不能・死亡: 歩行 AI は動かさない
    const P = n.P, cfg = this.cfg;
    let vx = 0, vz = 0, sp = n.speed;
    if (n.mode !== 'walking' && now - n.lastThreatAt > P.calmMs) { n.mode = 'walking'; n.watching = false; n.hidden = false; n.speed = rand(1.1, 1.6); n.goal = null; n.node = this.nearest(n); }
    if (n.mode === 'alert') {
      if (n.decideAt && now >= n.decideAt) this.decide(n, now);
      if (n.mode === 'alert' && n.watching && n.lastThreat) { // 好奇心: 離れたところまで行って見る
        const t = n.lastThreat, dx = n.x - t.x, dz = n.z - t.z, L = Math.hypot(dx, dz) || 1;
        if (L > P.watch + 2) { vx = -dx / L; vz = -dz / L; sp = 1.4; } else if (L < P.watch - 3) { vx = dx / L; vz = dz / L; sp = 1.6; }
        n.yaw = Math.atan2(dx / L, dz / L);
      }
    } else if (n.mode === 'walking') {
      if (!n.goal) { const nb = n.node.nb.filter((x) => x !== n.from); const pick = nb.length ? nb : n.node.nb; n.goal = pick[crypto.randomInt(0, pick.length)]; }
      const dx = n.goal.x - n.x, dz = n.goal.z - n.z, L = Math.hypot(dx, dz);
      if (L < 0.4) { n.from = n.node; n.node = n.goal; n.goal = null; } else { vx = dx / L; vz = dz / L; }
    } else if (n.mode === 'fleeing') {
      const t = n.lastThreat || n;
      if (!n.route || Math.hypot(n.route.x - n.x, n.route.z - n.z) < 0.6) { // 異常から遠ざかる道を選ぶ
        const cur = n.route || this.nearest(n);
        const cand = cur.nb.length ? cur.nb : [cur];
        n.route = cand.reduce((b, c) => (Math.hypot(c.x - t.x, c.z - t.z) + Math.random() * 3 > Math.hypot(b.x - t.x, b.z - t.z) ? c : b), cand[0]);
        if (Math.hypot(n.route.x - t.x, n.route.z - t.z) < Math.hypot(n.x - t.x, n.z - t.z) - 1 && cur !== n.route) n.route = cur; // 近づく道しかなければ、その場の角へ
      }
      const dx = n.route.x - n.x, dz = n.route.z - n.z, L = Math.hypot(dx, dz) || 1; vx = dx / L; vz = dz / L;
    } else if (n.mode === 'hiding') {
      const c = n.hideAt, dx = c.x - n.x, dz = c.z - n.z, L = Math.hypot(dx, dz);
      if (L > 0.4) { vx = dx / L; vz = dz / L; n.hidden = false; } else { n.hidden = true; if (n.lastThreat) n.yaw = Math.atan2(-(n.lastThreat.x - n.x), -(n.lastThreat.z - n.z)); }
    }
    // ぶつからない: まわりの NPC・プレイヤー・倒れた人からはなれる (遠い NPC はとばす)
    if (!far) {
      for (const o of near(n.x, n.z, 2.5)) {
        if (o === n) continue; const dx = n.x - o.x, dz = n.z - o.z, d = Math.hypot(dx, dz) || 0.01;
        const r = Body.isDown(o.body) ? 2.2 : 0.9; if (d < r) { const k = (r - d) / r; vx += (dx / d) * k * 1.5; vz += (dz / d) * k * 1.5; }
      }
      for (const p of players) { const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 0.01, r = p.down ? 2.2 : 1.0; if (d < r) { const k = (r - d) / r; vx += (dx / d) * k * 1.5; vz += (dz / d) * k * 1.5; } }
    }
    const L = Math.hypot(vx, vz);
    if (L > 0.01) {
      const s = Math.min(sp * dt, 2) / Math.max(1, L);
      n.x += vx * s; n.z += vz * s;
      if (n.mode !== 'alert' || !n.watching) n.yaw = Math.atan2(-vx, -vz);
      if (!far) M.collide(this.map, n);
    }
    n.y = 0; void cfg;
  }
  nearest(n) { let b = this.nodes[0], bd = 1e9; for (const c of this.nodes) { const d = (c.x - n.x) ** 2 + (c.z - n.z) ** 2; if (d < bd) { bd = d; b = c; } } return b; }
}
module.exports = { NpcSystem, MODE, PERSONA };
