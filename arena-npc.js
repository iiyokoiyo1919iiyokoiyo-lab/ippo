// =====================================================================
// シティバトル: 通行人 (NPC)
//   ・歩道を歩く (ブロックの角を結ぶ道と横断歩道)。体の状態は arena-body.js (プレイヤーと共通)
//   ・行動: Walking (歩く) / Alert (異常に気づく) / Fleeing (逃げる) / Hiding (隠れる) / Surrender (手を上げる: 強盗)
//     倒れたら AI から外す
//   ・性格: 臆病 (すぐ逃げる)・冷静 (様子を見てから動く)・好奇心 (離れたところから見る)・無関心 (ふだんどおり)
//   ・異常 (銃声・被弾・転倒・悲鳴・倒れた人) は近くに伝わる。反応するまでの時間は人ごとにちがう
//     逃げだした人・悲鳴はまわりに伝える (3 段まで) → 連鎖する
//   ・エリアのパニックレベル (arena-incidents.js) が高いと、異常を見ていない人も不安になって動く
//   ・逃げる向きは人ごとにばらける (好みの向き・行き先の混み具合)。つまったら別の道をさがす
//   ・ぶつからないように、まわりの NPC・プレイヤー・倒れた人・車から離れる
//   ・パニックが下がると、落ち着く → 少し様子を見る → ふだんの歩きにもどる (段階的に)
//   ・警官・救急隊員も NPC (role)。動きは arena-services.js が決める (ここでは歩く・ぶつからないだけ)
//   ・軽くするため: プレイヤーから遠い NPC はたまにしか動かさない・1 回に動かす数に上限 (npcMaxActive)
// =====================================================================
const crypto = require('crypto');
const Body = require('./arena-body');
const M = require('./public/games/arena/arena-map.js');

const BLOCK = 18, ROAD = 8, N = 5, INSET = 0.5;
// 行動の番号 (ブラウザに送る): 4 手を上げる・5 処置 (しゃがむ)・6 注意をうながす・7 運ぶ
const MODE = { walking: 0, alert: 1, fleeing: 2, hiding: 3, surrender: 4, treat: 5, warn: 6, carry: 7 };
const PERSONA = {
  timid: { alertMs: [150, 450], delay: [60, 400], flee: 0.95, hide: 0.05, run: 5.4, calmMs: 18000, scream: 0.75, sense: 1.3, panic: 1.4 },
  calm: { alertMs: [900, 1700], delay: [300, 900], flee: 0.3, hide: 0.6, run: 4.4, calmMs: 10000, scream: 0.12, sense: 0.9, panic: 0.8 },
  curious: { alertMs: [500, 1000], delay: [150, 700], flee: 0.2, hide: 0.1, run: 4.8, calmMs: 8000, scream: 0.25, sense: 1.1, watch: 14, panic: 0.9 },
  indifferent: { alertMs: [800, 1600], delay: [600, 1500], flee: 0.04, hide: 0, run: 4, calmMs: 4000, scream: 0.02, sense: 0.35, panic: 0.2, indifferent: true },
};
const PERSONA_POOL = ['timid', 'timid', 'timid', 'calm', 'calm', 'calm', 'curious', 'curious', 'indifferent', 'indifferent'];
const PERSONAS = Object.keys(PERSONA);
const EVENT = { shot: { r: 34, k: 1 }, impact: { r: 9, k: 0.8 }, hit: { r: 22, k: 1.3 }, down: { r: 18, k: 1.2 }, scream: { r: 14, k: 0.7 }, body: { r: 9, k: 0.6 }, panic: { r: 11, k: 0.55 }, robbery: { r: 14, k: 0.9 }, crash: { r: 20, k: 1.1 } };
const rand = (a, b) => a + Math.random() * (b - a);

class NpcSystem {
  constructor(map, cfg, { send }) {
    this.map = map; this.cfg = cfg; this.send = send;
    this.npcs = new Map(); this.events = []; this.seq = 0; this.rr = 0;
    this.load = new Map(); // 逃げる行き先の混み具合 (node → 人数)
    // ほかのしくみから: パニックレベル・近くの事件・近くの車 (arena.js がつなぐ)
    this.panicAt = () => 0; this.threatNear = () => null; this.vehicleNear = () => [];
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
  // 隠れる場所: ビル・壁の角のそば (歩道の上)。cap: 1 か所に隠れられる人数
  buildCover() {
    this.cover = [];
    for (const b of this.map.solid) {
      if (!['building', 'wall'].includes(b.kind)) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = { x: b.x + sx * (b.w / 2 + 0.6), z: b.z + sz * (b.d / 2 + 0.6), y: 0 };
        const q = M.collide(this.map, { ...p }); if (Math.hypot(q.x - p.x, q.z - p.z) < 0.05) this.cover.push({ x: p.x, z: p.z, box: b, used: 0 });
      }
    }
  }
  // ---------- 出入り ----------
  civilians() { return [...this.npcs.values()].filter((x) => !x.gone && !x.role); }
  sync(players) {
    const want = Math.max(0, Math.round(this.cfg.npcCount));
    let n = this.civilians().length;
    while (n < want) { this.spawn(players); n++; }
    for (const x of this.civilians()) { if (n <= want) break; if (!Body.isDown(x.body) && !x.awaitEMS) { this.remove(x); n--; } }
  }
  make(fields) {
    const npc = { id: 'n' + (++this.seq), seed: crypto.randomInt(1, 2 ** 31), y: 0, yaw: Math.random() * 6.28, mode: 'walking', from: null, goal: null, speed: rand(1.1, 1.6),
      lastThreat: null, lastThreatAt: 0, acc: 0, bodyEmitAt: 0, bias: Math.random() * Math.PI * 2, gen: 0, ...fields };
    npc.body = Object.assign(Body.create(fields.hp || this.cfg.npcHp), { incapMs: this.cfg.npcIncapMs });
    this.npcs.set(npc.id, npc);
    this.send({ t: 'npcnew', n: this.pub(npc) });
    return npc;
  }
  spawn(players) {
    let node = null;
    for (let k = 0; k < 10 && !node; k++) { const c = this.nodes[crypto.randomInt(0, this.nodes.length)]; if (players.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 25) || k === 9) node = c; }
    const persona = PERSONA_POOL[crypto.randomInt(0, PERSONA_POOL.length)];
    return this.make({ persona, P: PERSONA[persona], x: node.x, z: node.z, node });
  }
  // 警官・救急隊員 (車に乗っているあいだは hidden)
  spawnRole(role, x, z) { return this.make({ role, persona: 'calm', P: PERSONA.calm, x, z, node: this.nearest({ x, z }), mode: 'walking', hidden: true, hp: role === 'police' ? 100 : 80 }); }
  remove(npc) { this.npcs.delete(npc.id); npc.gone = true; this.unload(npc); this.send({ t: 'npcgone', id: npc.id }); }
  injured(n) { return n.body.hp < n.body.maxHp * 0.5 ? 1 : 0; } // 深手: 足を引きずる
  flags(n) { return (n.hidden ? 1 : 0) | (n.carriedBy ? 2 : 0); }
  pub(n) { return { id: n.id, seed: n.seed, x: +n.x.toFixed(2), z: +n.z.toFixed(2), yaw: +n.yaw.toFixed(2), m: MODE[n.mode] ?? 0, s: Body.CODE[n.body.state], inj: this.injured(n), r: n.role || '', f: this.flags(n) }; }
  list() { return [...this.npcs.values()].map((n) => this.pub(n)); }
  // スナップショット (近いものだけ。[id, x, z, yaw, 行動, 体の状態, 深手, flags (1 見えない・2 運ばれている)])
  snapshot(near, R2) { const out = []; for (const n of this.npcs.values()) { if (near && (n.x - near.x) ** 2 + (n.z - near.z) ** 2 > R2) continue; out.push([n.id, +n.x.toFixed(2), +n.z.toFixed(2), +n.yaw.toFixed(2), MODE[n.mode] ?? 0, Body.CODE[n.body.state], this.injured(n), this.flags(n)]); } return out; }
  targets() { return [...this.npcs.values()].filter((n) => n.body.state !== Body.S.DEAD && !n.hidden && !n.carriedBy); }

  // ---------- 異常 ----------
  emit(type, x, z, extra = {}) { const e = EVENT[type]; if (e) this.events.push({ type, x, z, r: e.r, k: e.k, gen: 0, ...extra }); }
  hit(npc, info) {
    const res = Body.hit(npc.body, info, this.cfg);
    if (!res) return null;
    this.emit(res === 'stagger' ? 'hit' : 'down', npc.x, npc.z);
    if (res === 'down' && info.dir) { npc.x += info.dir[0] * 0.5; npc.z += info.dir[2] * 0.5; M.collide(this.map, npc); }
    if (npc.mode === 'surrender') npc.mode = 'fleeing';
    this.threat(npc, info.from || { x: npc.x - (info.dir?.[0] || 0) * 5, z: npc.z - (info.dir?.[2] || 0) * 5 }, Date.now());
    return res;
  }
  threat(n, at, now) { n.lastThreat = { x: at.x, z: at.z }; n.lastThreatAt = now; }
  // 異常を知る: 歩いている人は、人ごとの時間をおいて反応する (pend)
  react(n, ev, now) {
    if (n.role || n.hidden || n.carriedBy || Body.isDown(n.body) || n.body.state === Body.S.STAGGERED || n.mode === 'surrender') return;
    const d = Math.hypot(n.x - ev.x, n.z - ev.z), close = 1 - d / ev.r;
    if (close <= 0) return;
    if (n.P.indifferent && d > 6 && ev.type !== 'hit' && ev.type !== 'down') return; // 無関心: すぐそばでないと気にしない
    const p = Math.min(1, ev.k * n.P.sense * this.cfg.npcReact * (0.45 + close));
    if (n.mode === 'walking') {
      if (n.pend || Math.random() > p) return;
      n.pend = { x: ev.x, z: ev.z, type: ev.type, gen: ev.gen || 0, at: now + rand(...n.P.delay) * (ev.type === 'panic' ? 1.6 : 1) };
      return;
    }
    this.threat(n, ev, now);
    if (n.mode === 'alert' && n.watching && d < 10 && ev.type !== 'body') { this.flee(n, now); } // 見ていたら近くで起きた → 逃げる
    else if (n.mode === 'alert' && n.calmTo) { n.calmTo = 0; n.decideAt = now + rand(...n.P.alertMs); } // 落ち着きかけていたが、また起きた
    else if (n.mode === 'fleeing' && ev.type !== 'body') this.setRoute(n, null); // 逃げる向きを考え直す
  }
  // 時間がきたら反応する
  applyPend(n, now) {
    const ev = n.pend; n.pend = null;
    if (n.mode !== 'walking' || !Body.canMove(n.body)) return;
    this.threat(n, ev, now); n.gen = ev.gen;
    n.mode = 'alert'; n.decideAt = now + rand(...n.P.alertMs); n.goal = null; n.calmTo = 0; n.yaw = Math.atan2(-(ev.x - n.x), -(ev.z - n.z));
    if (ev.type !== 'body' && ev.type !== 'panic' && Math.random() < 0.7) this.send({ t: 'nfx', id: n.id, k: 'gasp' });
  }
  decide(n, now) {
    const P = n.P, t = n.lastThreat, d = t ? Math.hypot(n.x - t.x, n.z - t.z) : 99, lvl = this.panicAt(n.x, n.z);
    const fleeP = Math.min(1, P.flee * (this.cfg.npcFlee / 0.6) * (1 + Math.max(0, lvl - 1) * 0.35 * P.panic));
    const r = Math.random();
    if ((d < 7 && !P.indifferent) || r < fleeP) return this.flee(n, now);
    if (r < fleeP + P.hide) return this.hide(n, now);
    if (P.watch && d > 6) { n.watching = true; n.decideAt = 0; return; } // 遠くから見る
    n.decideAt = 0; n.watching = false; // 立ち止まって見る
    if (P.indifferent) { n.calmTo = now + rand(1500, 3000); } // 無関心: すぐ歩きだす
  }
  flee(n, now) {
    n.mode = 'fleeing'; n.watching = false; n.calmTo = 0; this.setRoute(n, null); n.speed = rand(n.P.run - 0.5, n.P.run + 0.4); n.evac = false;
    if (Math.random() < n.P.scream) { this.send({ t: 'nfx', id: n.id, k: 'scream' }); this.events.push({ type: 'scream', x: n.x, z: n.z, r: EVENT.scream.r, k: EVENT.scream.k, gen: (n.gen || 0) + 1 }); }
    // 逃げだした人は、まわりに知らせる (連鎖。3 段まで)
    if ((n.gen || 0) < 3) this.events.push({ type: 'panic', x: n.x, z: n.z, r: EVENT.panic.r, k: EVENT.panic.k, gen: (n.gen || 0) + 1 });
    void now;
  }
  hide(n, now) {
    const t = n.lastThreat; let best = null, bs = -1e9;
    for (const c of this.cover) {
      const d = Math.hypot(c.x - n.x, c.z - n.z); if (d > 18 || c.used >= 2 || c === n.badCover) continue; // 1 か所に 2 人まで (入口でつまらない)
      const dx = c.x - t.x, dz = c.z - t.z, L = Math.hypot(dx, dz) || 1;
      const blocked = M.rayWorld(this.map, [t.x, 1, t.z], [dx / L, 0, dz / L], L) < L - 0.5; // 異常の場所から見えない
      const s = (blocked ? 30 : 0) + L * 0.3 - d;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) return this.flee(n, now);
    this.releaseCover(n);
    n.mode = 'hiding'; n.hideAt = best; best.used++; n.hidden2 = false; n.speed = rand(n.P.run - 1, n.P.run);
  }
  releaseCover(n) { if (n.hideAt) { n.hideAt.used = Math.max(0, n.hideAt.used - 1); n.hideAt = null; } }
  setRoute(n, node) { this.unload(n); n.route = node; if (node) this.load.set(node, (this.load.get(node) || 0) + 1); }
  unload(n) { if (n.route) { const c = (this.load.get(n.route) || 1) - 1; if (c <= 0) this.load.delete(n.route); else this.load.set(n.route, c); } }
  // 警官の注意: 近くの人はその場から離れる (見物していた人も)
  warn(x, z, r, now) {
    for (const n of this.npcs.values()) {
      if (n.role || n.hidden || !Body.canMove(n.body) || n.mode === 'surrender') continue;
      if ((n.x - x) ** 2 + (n.z - z) ** 2 > r * r) continue;
      if (n.mode === 'fleeing' && !n.evac) continue; // もう逃げている
      this.threat(n, { x, z }, now - Math.max(0, n.P.calmMs - 7000)); // 7 秒ほど離れたら落ち着く
      n.mode = 'fleeing'; n.evac = true; n.watching = false; n.calmTo = 0; n.pend = null; this.releaseCover(n); this.setRoute(n, null); n.speed = rand(1.8, 2.6);
    }
  }
  // 強盗: 銃を向けられて手を上げる → しばらくしてお金を落とす (arena.js の onDrop) → 逃げる
  holdup(n, robber, now) {
    if ((n.role && n.role !== 'clerk') || n.robbed || !Body.canMove(n.body)) return false; // 店員も強盗できる
    n.mode = 'surrender'; n.robber = { x: robber.x, z: robber.z, sid: robber.sid }; n.dropAt = now + 1400; n.robbed = true; n.pend = null; this.releaseCover(n);
    n.yaw = Math.atan2(-(robber.x - n.x), -(robber.z - n.z));
    this.send({ t: 'nfx', id: n.id, k: 'gasp' }); this.emit('robbery', n.x, n.z);
    return true;
  }

  // ---------- 毎回の更新 ----------
  update(now, dt, players) {
    const cfg = this.cfg, list = [...this.npcs.values()];
    // 体の状態 (倒れた人は時間で起き上がる・行動不能 → 死亡 → しばらくして消える。救急を待っている人は、運ばれるまで残す)
    for (const n of list) {
      const ch = Body.update(n.body, now);
      if (ch === Body.S.NORMAL && !n.role) { n.mode = 'fleeing'; this.setRoute(n, null); n.speed = n.P.run; this.threat(n, n.lastThreat || n, now); }
      if (n.body.state === Body.S.DEAD && now - n.body.since > cfg.corpseMs && !n.carriedBy && (!n.awaitEMS || now - n.body.since > 150000)) this.remove(n);
      if (Body.isDown(n.body) && !n.carriedBy && now - n.bodyEmitAt > 2500) { n.bodyEmitAt = now; this.emit('body', n.x, n.z); }
      if (n.pend && now >= n.pend.at) this.applyPend(n, now);
    }
    for (const p of players) if (p.downEmitAt == null || (p.down && now - p.downEmitAt > 2500)) { if (p.down) { p.downEmitAt = now; this.emit('body', p.x, p.z); } }
    // 異常を伝える (近い NPC だけ: 格子で探す)
    const grid = new Map(), C = 12, cell = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
    for (const n of this.npcs.values()) { if (n.hidden) continue; const k = cell(n.x, n.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
    const near = (x, z, r) => { const out = [], cx = Math.floor(x / C), cz = Math.floor(z / C), s = Math.ceil(r / C); for (let i = -s; i <= s; i++) for (let j = -s; j <= s; j++) for (const n of grid.get(`${cx + i},${cz + j}`) || []) out.push(n); return out; };
    this.near = near;
    const evs = this.events.splice(0, 300);
    for (const ev of evs) for (const n of near(ev.x, ev.z, ev.r)) {
      const before = n.mode; this.react(n, ev, now);
      // 悲鳴は伝わる (3 段まで)
      if (ev.type === 'scream' && before === 'walking' && n.pend && ev.gen < 3 && Math.random() < 0.5 * cfg.npcReact) this.events.push({ type: 'scream', x: n.x, z: n.z, r: EVENT.scream.r * 0.8, k: EVENT.scream.k * 0.8, gen: ev.gen + 1 });
    }
    // 動かす: 近い順に npcMaxActive まで。遠い NPC (プレイヤーから 80m 以上) は 0.5 秒に 1 回
    const pd = (n) => { let b = 1e9; for (const p of players) { const d = (p.x - n.x) ** 2 + (p.z - n.z) ** 2; if (d < b) b = d; } return players.length ? b : 1e9; };
    // 待たされた (0.4 秒以上) 人を先に。上限で毎回後回しになる人が出ないように
    const order = list.filter((n) => !n.gone && !n.role).map((n) => ({ n, d: pd(n), late: n.acc >= 0.4 ? 0 : 1 })).sort((a, b) => a.late - b.late || a.d - b.d);
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
  // パニックレベルで動く (異常を見ていなくても、まわりの空気で不安になる)。1 秒に 1 回
  panicTick(n, now) {
    if (now < (n.panicAt || 0)) return; n.panicAt = now + 900 + Math.random() * 300;
    const L = this.panicAt(n.x, n.z), P = n.P; n.lvl = L;
    if (L < 2) return;
    const src = () => { const e = this.threatNear(n.x, n.z, 45); return e ? { x: e.x, z: e.z } : { x: n.x + Math.cos(n.bias) * 10, z: n.z + Math.sin(n.bias) * 10 }; };
    if (n.mode === 'walking' && !n.pend && Math.random() < 0.12 * (L - 1) * P.panic) n.pend = { ...src(), type: 'panic', gen: 2, at: now + rand(...P.delay) };
    else if (n.mode === 'alert' && L >= 3 && !n.watching && Math.random() < (L === 4 ? 0.5 : 0.25) * P.panic) { this.threat(n, src(), now); this.flee(n, now); }
    else if (n.mode === 'alert' && n.watching && L >= 4 && Math.random() < 0.3) { this.threat(n, src(), now); this.flee(n, now); }
    if (n.mode !== 'walking' && L >= 3) n.lastThreatAt = Math.max(n.lastThreatAt, now - P.calmMs * 0.5); // パニックが続くあいだは落ち着かない
  }
  think(n, now, dt, far, near, players) {
    if (!Body.canMove(n.body) || n.hidden) return; // 硬直・転倒・行動不能・死亡: 歩行 AI は動かさない
    const P = n.P;
    this.panicTick(n, now);
    let vx = 0, vz = 0, sp = n.speed;
    // 落ち着く: 時間がたち、まわりのパニックも下がったら (高いままでも、とても長くたてば) → 少し様子を見る → 歩きだす
    if (n.mode !== 'walking' && n.mode !== 'surrender' && !n.calmTo) {
      const quiet = now - n.lastThreatAt, lvl = n.lvl ?? 0;
      if ((quiet > P.calmMs && lvl <= 1) || quiet > P.calmMs * 3) { this.releaseCover(n); this.setRoute(n, null); n.mode = 'alert'; n.watching = false; n.hidden2 = false; n.evac = false; n.decideAt = 0; n.calmTo = now + rand(2000, 5000); }
    }
    if (n.mode === 'alert' && n.calmTo && now >= n.calmTo) { n.mode = 'walking'; n.calmTo = 0; n.speed = rand(1.0, 1.5); n.goal = null; n.node = this.nearest(n); n.gen = 0; }
    if (n.mode === 'surrender') { // 手を上げて立つ → お金を落とす → 逃げる
      if (n.robber) n.yaw = Math.atan2(-(n.robber.x - n.x), -(n.robber.z - n.z));
      if (now >= n.dropAt && !n.dropped) { n.dropped = true; this.onDrop?.(n); }
      if (n.dropped && now >= n.dropAt + 600) { this.threat(n, n.robber || n, now); this.flee(n, now); }
      return;
    }
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
      if (!n.route || Math.hypot(n.route.x - n.x, n.route.z - n.z) < 0.6) { // 異常から遠ざかる道を選ぶ (人ごとの好みの向き・混み具合でばらける)
        const cur = n.route || this.nearest(n), cand = cur.nb.length ? cur.nb : [cur], bx = Math.cos(n.bias), bz = Math.sin(n.bias);
        const score = (c) => { const dx = c.x - n.x, dz = c.z - n.z, L = Math.hypot(dx, dz) || 1; return Math.hypot(c.x - t.x, c.z - t.z) + ((dx * bx + dz * bz) / L) * 3 + Math.random() * 2.5 - (this.load.get(c) || 0) * 1.6; };
        let best = cand[0], bs = -1e9; for (const c of cand) { const s = score(c); if (s > bs) { bs = s; best = c; } }
        if (Math.hypot(best.x - t.x, best.z - t.z) < Math.hypot(n.x - t.x, n.z - t.z) - 1 && cur !== best && n.route) best = cur; // 近づく道しかなければ、その場の角へ
        this.setRoute(n, best);
      }
      const dx = n.route.x - n.x, dz = n.route.z - n.z, L = Math.hypot(dx, dz) || 1; vx = dx / L; vz = dz / L;
    } else if (n.mode === 'hiding') {
      const c = n.hideAt; if (!c) { this.flee(n, now); return; }
      const dx = c.x - n.x, dz = c.z - n.z, L = Math.hypot(dx, dz);
      if (L > 0.4) { vx = dx / L; vz = dz / L; n.hidden2 = false; } else { n.hidden2 = true; if (n.lastThreat) n.yaw = Math.atan2(-(n.lastThreat.x - n.x), -(n.lastThreat.z - n.z)); }
    }
    this.avoid(n, far, near, players, (ax, az) => { vx += ax; vz += az; });
    this.unstick(n, now, vx || vz);
    if (this.injured(n)) sp *= 0.5; // 深手は遅い
    if (n.jitter && now < n.jitter.until) { vx += n.jitter.x; vz += n.jitter.z; }
    this.step(n, vx, vz, sp, dt, far, n.mode !== 'alert' || !n.watching);
  }
  // ぶつからない: まわりの NPC・プレイヤー・倒れた人・車からはなれる (遠い NPC はとばす)
  avoid(n, far, near, players, add) {
    if (far || !near) return;
    for (const o of near(n.x, n.z, 2.5)) {
      if (o === n || o.carriedBy) continue; const dx = n.x - o.x, dz = n.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      const r = Body.isDown(o.body) ? 2.2 : 0.9; if (d < r) { const k = (r - d) / r; add((dx / d) * k * 1.5, (dz / d) * k * 1.5); }
    }
    for (const p of players) { if (p.car) continue; const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz) || 0.01, r = p.down ? 2.2 : 1.0; if (d < r) { const k = (r - d) / r; add((dx / d) * k * 1.5, (dz / d) * k * 1.5); } }
    for (const c of this.vehicleNear(n.x, n.z, 3)) { const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot(dx, dz) || 0.01, r = c.r + 0.8; if (d < r) { const k = (r - d) / r; add((dx / d) * k * 3, (dz / d) * k * 3); } }
  }
  // つまり: 動こうとしているのに 1.2 秒で 0.3m も進まない → 別の道・横へずれる
  unstick(n, now, moving) {
    if (!moving || n.mode === 'walking' || n.mode === 'alert') { n.stk = null; return; }
    if (!n.stk) { n.stk = { x: n.x, z: n.z, t: now }; return; }
    if (now - n.stk.t < 1200) return;
    if (Math.hypot(n.x - n.stk.x, n.z - n.stk.z) < 0.3) {
      const a = Math.random() * Math.PI * 2; n.jitter = { x: Math.cos(a) * 0.8, z: Math.sin(a) * 0.8, until: now + 600 };
      if (n.mode === 'fleeing') { const cur = this.nearest(n); this.setRoute(n, cur.nb[crypto.randomInt(0, cur.nb.length)] || cur); }
      else if (n.mode === 'hiding') { n.badCover = n.hideAt; this.releaseCover(n); this.hide(n, now); }
    }
    n.stk = { x: n.x, z: n.z, t: now };
  }
  step(n, vx, vz, sp, dt, far, turn = true) {
    const L = Math.hypot(vx, vz);
    if (L > 0.01) {
      const s = Math.min(sp * dt, 2) / Math.max(1, L);
      n.x += vx * s; n.z += vz * s;
      if (turn) n.yaw = Math.atan2(-vx, -vz);
      if (!far) M.collide(this.map, n);
    }
    n.y = 0;
  }
  // 警官・救急隊員を (x, z) へ歩かせる (arena-services.js から)。着いたら true
  walkTo(n, x, z, sp, dt, players, r = 0.5) {
    if (!Body.canMove(n.body) || n.hidden) return false;
    const dx = x - n.x, dz = z - n.z, L = Math.hypot(dx, dz);
    if (L < r) return true;
    let vx = dx / L, vz = dz / L;
    this.avoid(n, false, this.near, players, (ax, az) => { vx += ax * 0.5; vz += az * 0.5; });
    this.step(n, vx, vz, sp, dt, false);
    return false;
  }
  nearest(n) { let b = this.nodes[0], bd = 1e9; for (const c of this.nodes) { const d = (c.x - n.x) ** 2 + (c.z - n.z) ** 2; if (d < bd) { bd = d; b = c; } } return b; }
  debug() {
    const by = {}, per = {}, roles = {};
    for (const n of this.npcs.values()) {
      const st = n.body.state === 'normal' ? n.mode : n.body.state;
      if (n.role) { roles[n.role] = (roles[n.role] || 0) + 1; continue; }
      by[st] = (by[st] || 0) + 1; per[n.persona] = (per[n.persona] || 0) + 1;
    }
    const sample = [...this.npcs.values()].slice(0, 60).map((n) => ({ id: n.id, role: n.role || '', p: n.persona, mode: n.mode, st: n.body.state, hp: n.body.hp, x: Math.round(n.x), z: Math.round(n.z), lvl: n.lvl ?? 0, hidden: !!n.hidden }));
    return { total: this.npcs.size, civilians: this.civilians().length, byState: by, byPersona: per, roles, sample };
  }
}
module.exports = { NpcSystem, MODE, PERSONA, PERSONAS };
