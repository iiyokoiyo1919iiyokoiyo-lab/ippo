// =====================================================================
// ミニゲーム「シティバトル」: 街を舞台にしたオンラインの撃ち合い (3D・デスマッチ)
//   ・WebSocket /ab。ログインしている人ならだれでも。1 つの街に 16 人まで
//   ・動きはブラウザが送り、サーバーが速さ・位置をたしかめる。弾の当たり判定はサーバーがする (壁・頭・体)
//   ・やられたら 3 秒で復活 (復活してから 2 秒は無敵)。血などの表現はなし
//   ・人が少ないときはボットが入る (人間 + ボットで 4 人になるように。最大 3 体)
//   ・コインなどの報酬はなし (その場のキル数・デス数だけ)
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const M = require('./public/games/arena/arena-map.js');
const Body = require('./arena-body');
const Config = require('./arena-config');
const { NpcSystem } = require('./arena-npc');
const { Traffic } = require('./arena-traffic');
const { Incidents } = require('./arena-incidents');
const { Services } = require('./arena-services');

const MAX_HUMANS = 16, TICK_MS = 50, RESPAWN_MS = 3000, PROTECT_MS = 2000, HP = 100;
const FIRE_MS = 130, RANGE = 90, DMG = { body: 22, head: 45 }, BOT_DMG = { body: 12, head: 24 };
// 被弾の衝撃 (転倒するかどうか。arena-config の downImpact 以上で転倒): 体 18・頭 40・パンチ 34。ボットは弱め
const IMPACT = { body: 18, head: 40 }, BOT_IMPACT = { body: 10, head: 26 }, PUNCH_IMPACT = 34;
// 武器: ライフル (連射) と スナイパー (1 発が重い・遠くまで)。連射の間かく・ダメージ・衝撃・届く距離はサーバーが決める
const WEAPONS = {
  rifle: { ms: FIRE_MS, dmg: DMG, imp: IMPACT, range: RANGE },
  sniper: { ms: 1300, dmg: { body: 75, head: 200 }, imp: { body: 60, head: 95 }, range: 220 },
};
const SWITCH_MS = 450; // 持ちかえてから撃てるまで
const BOTS_MAX = process.env.ARENA_BOTS != null ? Math.max(0, Number(process.env.ARENA_BOTS) || 0) : 3; // テスト用: ARENA_BOTS=0 でボットなし
const PUNCH = { range: 2.4, cos: Math.cos((55 * Math.PI) / 180), dmg: 35, ms: 600, kb: 7 }; // なぐる: 前 2.4m・左右 55° いないの相手に 35 ダメージ + ふっとばし
const MAX_SPEED = 9.5; // 走る速さ (8) + ゆとり
const CAR = { max: 34, enter: 4.4, run: 3, civ: 6 }; // 車: 速さの上限 (m/s)・乗れる距離・はねる速さ・乗れる車の数
const ROB = { range: 10, cos: Math.cos((10 * Math.PI) / 180), need: 0.9, cash: [20, 200], keepMs: 90000 }; // 強盗: 10m いない・照準から 10° いないで 0.9 秒向けつづける
const BOT_NAMES = ['ボット・ミケ', 'ボット・ポチ', 'ボット・タマ', 'ボット・ハチ', 'ボット・コロ'];
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac', '#a9e34b', '#748ffc'];

module.exports = function install(app, ctx) {
  const { db } = ctx;
  const map = M.build();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });
  const players = new Map(); // sid → プレイヤー (人間・ボット)
  let loop = null, botSeq = 0, tickN = 0;
  const cfg = Config.load();
  const npcs = new NpcSystem(map, cfg, { send: (m) => all(m) });
  const isAdmin = (u) => !!(ctx.isAdmin && ctx.isAdmin(u));
  const pubCfg = () => ({ ...cfg });
  const nameOf = (uid) => { const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(uid); return u ? String(u.display_name || u.username).slice(0, 20) : '???'; };
  const humans = () => [...players.values()].filter((p) => !p.bot);
  const pub = (p) => ({ sid: p.sid, name: p.name, color: p.color, bot: !!p.bot, kills: p.kills, deaths: p.deaths, w: p.w || 'rifle', car: p.car || 0, cash: p.cash || 0 });
  const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
  const all = (m) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); };
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  // 車・事件・警察と救急 (共通の事件管理 incidents を使う)
  const traffic = new Traffic(map), incidents = new Incidents(cfg);
  const services = new Services({ npcs, traffic, incidents, cfg, send: (m) => all(m) });
  npcs.panicAt = (x, z) => incidents.levelAt(x, z);
  npcs.threatNear = (x, z, r) => incidents.nearest(x, z, r);
  npcs.vehicleNear = (x, z, r) => traffic.near(x, z, r);
  // 乗れる一般車: 道路のまん中あたり (止まっている車から離して)
  { const used = [...traffic.parked]; let k = 0;
    for (let t = 0; t < 200 && k < CAR.civ; t++) {
      const n = traffic.nodes[crypto.randomInt(0, traffic.nodes.length)], dir = crypto.randomInt(0, 4), dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir], L = 9 + Math.random() * 8;
      const x = n.x + dx * L + dz * 1.9, z = n.z + dz * L - dx * 1.9;
      if (Math.abs(x) > M.HALF - 3 || Math.abs(z) > M.HALF - 3 || used.some((b) => Math.hypot(b.x - x, b.z - z) < 7)) continue;
      used.push({ x, z }); traffic.add('civ', x, z, Math.atan2(-dx, -dz), { color: ['#c92a2a', '#1864ab', '#2b8a3e', '#e67700', '#212529', '#862e9c'][k] }); k++;
    } }
  const cash = new Map(); let cashSeq = 0;
  npcs.onDrop = (n) => { // 強盗: お金を落とす
    const c = { id: 'c' + (++cashSeq), x: +n.x.toFixed(2), z: +n.z.toFixed(2), a: crypto.randomInt(ROB.cash[0], ROB.cash[1] + 1), at: Date.now() };
    cash.set(c.id, c); all({ t: 'cash', c });
  };
  let tickMs = 0;

  // 出てくる場所: 交差点のうち、ほかのプレイヤーからいちばん遠いところ (候補 8 つから)
  function spawn(p) {
    const others = [...players.values()].filter((q) => q !== p && q.alive);
    let best = null, bestD = -1;
    for (let k = 0; k < 8; k++) {
      const n = map.nodes[crypto.randomInt(0, map.nodes.length)];
      const d = others.length ? Math.min(...others.map((q) => dist2(q, n))) : 1;
      if (d > bestD) { bestD = d; best = n; }
    }
    if (!p.body) p.body = Body.create(HP); else Body.revive(p.body);
    Object.assign(p, { x: best.x, y: 0, z: best.z, yaw: Math.random() * Math.PI * 2, pitch: 0, hp: HP, alive: true, down: false, protectUntil: Date.now() + PROTECT_MS, lastPosAt: Date.now() });
    if (p.bot) Object.assign(p, { node: best, goal: null, stuckAt: Date.now(), stuckPos: { x: p.x, z: p.z } });
    all({ t: 'spawn', sid: p.sid, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  }

  // 撃つ: o (撃った位置) から d (向き) へ。壁より手前のいちばん近いプレイヤーに当たる
  // 撃つ: o (撃った位置) から d (向き) へ。壁より手前のいちばん近い相手 (プレイヤー・通行人) に当たる
  function fire(p, o, d, dmgTable, weapon = 'rifle') {
    const W = WEAPONS[weapon] || WEAPONS.rifle, wallT = M.rayWorld(map, o, d, W.range);
    let hit = null;
    for (const q of players.values()) {
      if (q === p || !q.alive || q.protectUntil > Date.now()) continue;
      const r = M.rayPlayer(o, d, q);
      if (r && r.t < wallT && (!hit || r.t < hit.t)) hit = { ...r, q };
    }
    for (const n of npcs.targets()) { const r = M.rayPlayer(o, d, Body.isDown(n.body) ? { x: n.x, y: -1.2, z: n.z } : n); if (r && r.t < wallT && (!hit || r.t < hit.t)) hit = { ...r, q: n, npc: true }; }
    const t = hit ? hit.t : wallT, e = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    all({ t: 'shot', sid: p.sid, w: weapon, o: o.map((v) => +v.toFixed(2)), e: e.map((v) => +v.toFixed(2)), hit: !!hit });
    npcs.emit('shot', p.x, p.z); npcs.emit('impact', e[0], e[2]); // 銃声と着弾は、まわりの通行人に伝わる
    incidents.report('shots', p.x, p.z); // 事件として登録 (警察が来る・エリアのパニックが上がる)
    if (!hit) return;
    const imp = dmgTable === BOT_DMG ? BOT_IMPACT : W.imp;
    damage(p, hit.q, hit.head ? dmgTable.head : dmgTable.body, { head: hit.head, impact: hit.head ? imp.head : imp.body, dir: d.map((v) => +v.toFixed(3)), npc: hit.npc, weapon });
  }
  // 当たったとき: 体の状態 (arena-body.js) で、硬直・転倒・行動不能を決める。プレイヤーも通行人も同じ
  function damage(p, q, dmg, { head = false, melee = false, kb = null, impact = 0, dir = null, npc = false, weapon = 'rifle' } = {}) {
    const now = Date.now();
    if (npc) {
      const res = npcs.hit(q, { dmg, impact, dir, from: { x: p.x, z: p.z } });
      if (res) all({ t: 'hit', sid: p.sid, to: q.id, npc: 1, dmg, head, melee, kb, res, dir, impact, hp: q.body.hp, w: weapon });
      if (res === 'incap') { q.awaitEMS = true; incidents.report(q.role === 'police' ? 'officer' : 'injury', q.x, q.z, { victim: q.id }); } // 救急が必要
      else if (res) incidents.report(res === 'down' ? 'down' : 'assault', q.x, q.z);
      return;
    }
    const res = Body.hit(q.body, { dmg, impact, dir }, { ...cfg, staggerMs: cfg.playerStaggerMs }, now); // プレイヤーは被弾しても硬直しない (playerStaggerMs)
    if (!res) return;
    q.hp = q.body.hp; q.down = Body.isDown(q.body);
    if (res === 'down' && dir) { q.x += dir[0] * 0.6; q.z += dir[2] * 0.6; M.collide(map, q); } // 倒れた方向へ少しずれる
    all({ t: 'hit', sid: p.sid, to: q.sid, dmg, head, melee, kb, res, dir, impact, hp: q.hp });
    npcs.emit(res === 'stagger' ? 'hit' : 'down', q.x, q.z); incidents.report(res === 'stagger' ? 'assault' : 'down', q.x, q.z);
    if (res === 'incap') {
      q.alive = false; q.deaths++; if (p.kills != null) p.kills++; q.respawnAt = now + RESPAWN_MS; if (q.car) exitCar(q);
      all({ t: 'kill', killer: p.sid, victim: q.sid, head, melee, w: melee ? 'punch' : weapon, score: [pub(p), pub(q)] });
    }
  }
  // なぐる: 前にいる、いちばん近い相手 (壁ごしはだめ)。当たると相手をふっとばす
  function punch(p) {
    const now = Date.now();
    if (now - (p.lastPunch || 0) < PUNCH.ms - 30) return; p.lastPunch = now;
    p.protectUntil = 0;
    all({ t: 'punch', sid: p.sid });
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = null;
    for (const q of [...players.values(), ...npcs.targets()]) {
      if (q === p || (q.sid && (!q.alive || q.protectUntil > now)) || (!q.sid && Body.isOut(q.body))) continue;
      const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz);
      if (L > PUNCH.range || Math.abs(q.y - p.y) > 1.5) continue;
      if (L > 0.3 && (dx * fx + dz * fz) / L < PUNCH.cos) continue;
      const o = [p.x, p.y + 1.1, p.z], d = [dx / (L || 1), (q.y - p.y) / (L || 1), dz / (L || 1)], dl = Math.hypot(...d);
      if (L > 0.3 && M.rayWorld(map, o, d.map((v) => v / dl), L) < L - 0.4) continue;
      if (!best || L < best.L) best = { q, L, dx, dz };
    }
    if (!best) return;
    const n = best.L || 1;
    damage(p, best.q, p.bot ? Math.round(PUNCH.dmg * 0.6) : PUNCH.dmg, { melee: true, kb: [+(best.dx / n * PUNCH.kb).toFixed(2), +(best.dz / n * PUNCH.kb).toFixed(2)],
      impact: p.bot ? 22 : PUNCH_IMPACT, dir: [+(best.dx / n).toFixed(3), 0, +(best.dz / n).toFixed(3)], npc: !best.q.sid });
  }

  // ボット: 道路の交差点をめぐり、見える相手がいたら撃つ (人間より弱い)
  function botThink(b, now, dt) {
    if (!b.alive || !Body.canAct(b.body)) return;
    if (!b.losAt || now - b.losAt > 300) { // 見える相手をさがす (0.3 秒ごと)
      b.losAt = now; b.target = null;
      let best = 40 * 40;
      for (const q of players.values()) {
        if (q === b || !q.alive) continue;
        const d2 = dist2(b, q); if (d2 > best) continue;
        const o = [b.x, b.y + 1.5, b.z], dx = q.x - b.x, dy = q.y + 1.1 - o[1], dz = q.z - b.z, L = Math.hypot(dx, dy, dz) || 1;
        if (M.rayWorld(map, o, [dx / L, dy / L, dz / L], L) >= L - 0.6) { best = d2; b.target = q; }
      }
    }
    const q = b.target && b.target.alive ? b.target : null;
    if (q) {
      b.yaw = Math.atan2(-(q.x - b.x), -(q.z - b.z));
      // 少し横に動きながら撃つ
      const side = Math.sin(now / 700 + b.seed) * 2.2;
      b.x += Math.cos(b.yaw) * side * dt; b.z -= Math.sin(b.yaw) * side * dt;
      if (Math.hypot(q.x - b.x, q.z - b.z) < 2.1) { if (now - (b.lastPunch || 0) > 800) punch(b); }
      else if (now - (b.lastShot || 0) > 750 + Math.random() * 400) {
        b.lastShot = now;
        const o = [b.x, b.y + 1.5, b.z], tx = q.x - o[0], ty = q.y + 1.1 - o[1], tz = q.z - o[2], L = Math.hypot(tx, ty, tz) || 1;
        const sp = 0.07, d = [tx / L + (Math.random() - 0.5) * sp, ty / L + (Math.random() - 0.5) * sp, tz / L + (Math.random() - 0.5) * sp], dl = Math.hypot(...d);
        fire(b, o, d.map((v) => v / dl), BOT_DMG);
      }
    } else {
      if (!b.goal) { const nb = map.nodes.filter((n) => Math.abs(n.i - b.node.i) + Math.abs(n.j - b.node.j) === 1); b.goal = nb[crypto.randomInt(0, nb.length)]; }
      const dx = b.goal.x - b.x, dz = b.goal.z - b.z, L = Math.hypot(dx, dz);
      if (L < 0.8) { b.node = b.goal; b.goal = null; }
      else { const s = Math.min(L, 4.5 * dt); b.x += (dx / L) * s; b.z += (dz / L) * s; b.yaw = Math.atan2(-dx, -dz); }
      if (now - b.stuckAt > 2000) { if (Math.hypot(b.x - b.stuckPos.x, b.z - b.stuckPos.z) < 0.6) b.goal = null; b.stuckAt = now; b.stuckPos = { x: b.x, z: b.z }; }
    }
    M.collide(map, b); b.y = M.groundAt(map, b.x, b.z, b.y);
  }
  function syncBots() {
    const h = humans().length, want = h ? Math.max(0, Math.min(BOTS_MAX, 4 - h)) : 0, bots = [...players.values()].filter((p) => p.bot);
    for (let i = bots.length; i < want; i++) {
      const used = new Set(bots.map((b) => b.name)), name = BOT_NAMES.find((n) => !used.has(n)) || BOT_NAMES[0];
      const b = { sid: 'b' + (++botSeq), bot: true, name, color: COLORS[(botSeq * 3) % COLORS.length], kills: 0, deaths: 0, seed: Math.random() * 10 };
      players.set(b.sid, b); bots.push(b); all({ t: 'join', p: pub(b) }); spawn(b);
    }
    while (bots.length > want) { const b = bots.pop(); players.delete(b.sid); all({ t: 'leave', sid: b.sid }); }
  }
  // ---------- 車に乗る・降りる・はねる ----------
  function enterCar(p, id) {
    const v = traffic.vehicles.get(id);
    if (!v || v.kind !== 'civ' || v.driver || v.hidden || !p.alive || !Body.canAct(p.body) || p.car) return;
    if (Math.hypot(v.x - p.x, v.z - p.z) > CAR.enter) return;
    v.driver = p.sid; p.car = v.id; p.carAt = Date.now(); p.lastPosAt = Date.now(); all({ t: 'enter', sid: p.sid, id: v.id });
  }
  function exitCar(p) {
    const v = traffic.vehicles.get(p.car); p.car = 0; if (!v) return;
    v.driver = null; traffic.park(v);
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), np = { x: v.x + fz * 1.9, y: 0, z: v.z - fx * 1.9 }; // 左のドアから
    M.collide(map, np); Object.assign(p, { x: np.x, z: np.z, y: 0, lastPosAt: Date.now() });
    all({ t: 'exit', sid: p.sid, id: v.id, x: p.x, z: p.z });
  }
  // 運転している車が人にぶつかった (速いときだけ)
  function runOver(now) {
    for (const v of traffic.vehicles.values()) {
      if (!v.driver || Math.abs(v.speed) < CAR.run) continue;
      const drv = players.get(v.driver); if (!drv) continue;
      const cs = traffic.circles(v), sp = Math.abs(v.speed), fx = -Math.sin(v.yaw) * Math.sign(v.speed), fz = -Math.cos(v.yaw) * Math.sign(v.speed);
      for (const q of [...players.values(), ...npcs.targets()]) {
        if (q === drv || (q.sid && (!q.alive || q.car || q.protectUntil > now)) || (!q.sid && Body.isOut(q.body))) continue;
        if (!cs.some((c) => Math.hypot(c.x - q.x, c.z - q.z) < c.r + 0.45) || now - (q.runAt || 0) < 1000) continue;
        q.runAt = now;
        damage(drv, q, Math.round(sp * 4.5), { impact: sp * 6, dir: [+fx.toFixed(3), 0, +fz.toFixed(3)], npc: !q.sid, weapon: 'car' });
        incidents.report('crash', q.x, q.z); npcs.emit('crash', q.x, q.z);
        if (!q.sid) { q.x += fx * 1.5; q.z += fz * 1.5; M.collide(map, q); }
      }
    }
  }
  // 強盗: 通行人に銃を向けつづける → 手を上げる → お金を落とす。お金は歩いて拾う
  function robbery(now) {
    const aimed = new Set();
    for (const p of players.values()) {
      if (p.bot || !p.alive || p.car || !Body.canAct(p.body) || !npcs.near) continue;
      const cp = Math.cos(p.pitch || 0), f = [-Math.sin(p.yaw) * cp, Math.sin(p.pitch || 0), -Math.cos(p.yaw) * cp], eye = [p.x, p.y + 1.6, p.z];
      let best = null, bc = ROB.cos;
      for (const n of npcs.near(p.x, p.z, ROB.range)) {
        if (n.role || n.robbed || n.hidden || !Body.canMove(n.body)) continue;
        const d = [n.x - eye[0], 1.2 - eye[1], n.z - eye[2]], L = Math.hypot(...d); if (L > ROB.range || L < 0.5) continue;
        const c = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / L; if (c < bc) continue;
        if (M.rayWorld(map, eye, d.map((v) => v / L), L) < L - 0.4) continue;
        bc = c; best = n;
      }
      if (!best) continue;
      aimed.add(best.id);
      best.hu = best.hu && best.hu.sid === p.sid ? { sid: p.sid, t: best.hu.t + 0.1 } : { sid: p.sid, t: 0.1 };
      if (best.hu.t >= ROB.need && npcs.holdup(best, p, now)) { incidents.report('robbery', best.x, best.z); send(p, { t: 'robbed', id: best.id }); }
    }
    for (const n of npcs.npcs.values()) if (n.hu && !aimed.has(n.id)) n.hu = null;
    for (const c of [...cash.values()]) {
      if (now - c.at > ROB.keepMs) { cash.delete(c.id); all({ t: 'cashgone', id: c.id }); continue; }
      for (const p of players.values()) {
        if (p.bot || !p.alive || p.car || Math.hypot(p.x - c.x, p.z - c.z) > 1.4) continue;
        p.cash = (p.cash || 0) + c.a; cash.delete(c.id); all({ t: 'cashgone', id: c.id, sid: p.sid, a: c.a, total: p.cash }); break;
      }
    }
  }
  // ---------- デバッグ (管理者) ----------
  function debugState() {
    return { npc: npcs.debug(), panic: incidents.levels(), heat: [...incidents.heat].map((h) => +h.toFixed(1)), incidents: incidents.debug(), services: services.debug(),
      vehicles: [...traffic.vehicles.values()].map((v) => ({ id: v.id, kind: v.kind, x: Math.round(v.x), z: Math.round(v.z), sp: +v.speed.toFixed(1), hidden: v.hidden, driver: v.driver ? players.get(v.driver)?.name || v.driver : '' })), tickMs: +tickMs.toFixed(2), humans: humans().length };
  }
  function debugCmd(p, m) {
    const at = (x, z) => ({ x: Number.isFinite(Number(x)) ? Number(x) : p.x, z: Number.isFinite(Number(z)) ? Number(z) : p.z });
    if (m.k === 'panic' || m.k === 'random') {
      const pts = m.k === 'panic' ? [at(m.x, m.z)] : Array.from({ length: 3 }, () => { const n = traffic.nodes[crypto.randomInt(0, traffic.nodes.length)]; return { x: n.x + (Math.random() - 0.5) * 10, z: n.z + (Math.random() - 0.5) * 10 }; });
      for (const q of pts) { incidents.report('test', q.x, q.z); for (let i = 0; i < 3; i++) npcs.emit('shot', q.x, q.z); npcs.emit('scream', q.x, q.z); all({ t: 'shot', sid: 'sys', w: 'rifle', o: [q.x, 2, q.z], e: [q.x, 6, q.z], hit: false }); }
    } else if (m.k === 'injure') { // テスト: 近くの通行人を行動不能にする (救急が来る)
      const q = at(m.x, m.z); let best = null, bd = 40 * 40;
      for (const n of npcs.civilians()) { if (!Body.canMove(n.body)) continue; const d = (n.x - q.x) ** 2 + (n.z - q.z) ** 2; if (d < bd) { bd = d; best = n; } }
      if (best) damage({ sid: 'sys', x: best.x - 3, z: best.z }, best, 999, { npc: true, impact: 80, dir: [1, 0, 0] });
    } else if (m.k === 'clear') incidents.clear();
  }
  function tick() {
    const now = Date.now(), dt = TICK_MS / 1000, t0 = process.hrtime.bigint();
    tickN++;
    for (const p of players.values()) {
      Body.update(p.body, now); p.down = Body.isDown(p.body);
      if (!p.alive && p.respawnAt && now >= p.respawnAt) { p.respawnAt = 0; spawn(p); }
      if (p.bot) botThink(p, now, dt);
    }
    // 通行人: 1 秒に 10 回 (人数は 1 秒に 1 回あわせる)
    const pl = [...players.values()].map((p) => ({ x: p.x, z: p.z, down: p.down, car: p.car, sid: p.sid }));
    if (tickN % 20 === 1) npcs.sync(pl);
    const withNpc = tickN % 2 === 0;
    runOver(now);
    if (withNpc) { npcs.update(now, 0.1, pl); incidents.update(now, 0.1); services.update(now, 0.1, pl); robbery(now); }
    if (tickN % 10 === 0) { const d = [...players.values()].filter((p) => p.dbg && p.admin); if (d.length) { const m = { t: 'dbg', d: debugState() }; for (const p of d) send(p, m); } }
    tickMs = tickMs * 0.95 + Number(process.hrtime.bigint() - t0) / 1e6 * 0.05;
    const prow = [...players.values()].map((p) => [p.sid, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +(p.pitch || 0).toFixed(3), p.hp, p.alive ? 1 : 0, p.protectUntil > now ? 1 : 0, Body.CODE[p.body.state]]);
    if (!withNpc) return all({ t: 's', p: prow });
    const v = traffic.snapshot();
    // 通行人が多いときは、その人から 110m いないの通行人だけ送る
    if (npcs.npcs.size <= 60) return all({ t: 's', p: prow, n: npcs.snapshot(), v });
    for (const p of players.values()) if (p.ws) send(p, { t: 's', p: prow, n: npcs.snapshot(p, 110 * 110), v });
  }
  const startLoop = () => { if (!loop) loop = setInterval(tick, TICK_MS); };
  const stopLoop = () => { if (loop && !humans().length) { clearInterval(loop); loop = null; } };

  wss.on('connection', (ws, req, user) => {
    // 同じ人が 2 つ開いたら、古いほうを閉じる
    for (const p of players.values()) if (p.uid === user.id) { try { p.ws.close(4000, 'other-tab'); } catch {} }
    if (humans().filter((p) => p.uid !== user.id).length >= MAX_HUMANS) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(); }
    const p = { sid: crypto.randomBytes(6).toString('base64url'), uid: user.id, ws, name: nameOf(user.id), color: COLORS[user.id % COLORS.length], kills: 0, deaths: 0, msgs: 0, msgWin: Date.now() };
    players.set(p.sid, p);
    syncBots(); startLoop();
    spawn(p);
    npcs.sync([...players.values()].map((q) => ({ x: q.x, z: q.z })));
    p.admin = isAdmin(user);
    send(p, { t: 'welcome', you: p.sid, me: { x: p.x, y: p.y, z: p.z, yaw: p.yaw }, players: [...players.values()].map(pub), npcs: npcs.list(), vehicles: traffic.list(), cash: [...cash.values()], cfg: pubCfg(), admin: p.admin, rules: { hp: HP, respawnMs: RESPAWN_MS, protectMs: PROTECT_MS, fireMs: FIRE_MS, dmg: DMG, weapons: Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, { ms: w.ms, dmg: w.dmg, range: w.range }])), switchMs: SWITCH_MS, punch: { ms: PUNCH.ms, dmg: PUNCH.dmg, range: PUNCH.range } } });
    all({ t: 'join', p: pub(p) });
    console.log(`[arena] @${user.username} が入った (人間 ${humans().length} 人)`);
    ws.on('message', (raw) => {
      // メッセージの数を制限 (1 秒に 60 まで)
      const now = Date.now(); if (now - p.msgWin > 1000) { p.msgWin = now; p.msgs = 0; } if (++p.msgs > 60) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'pos' && p.alive && !p.car && Body.canMove(p.body)) { // 硬直・転倒・行動不能のあいだは動けない
        const x = Number(m.x), y = Number(m.y), z = Number(m.z), yaw = Number(m.yaw), pitch = Number(m.pitch);
        if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
        // 速すぎる動き (ワープ) は受けつけず、サーバーの位置にもどす
        const dts = Math.min(0.5, Math.max(0.03, (now - p.lastPosAt) / 1000)); p.lastPosAt = now;
        const allow = MAX_SPEED * dts + 0.6, moved = Math.hypot(x - p.x, z - p.z);
        const np = { x, y: Math.max(0, Math.min(40, y)), z };
        M.collide(map, np);
        if (moved > allow || np.y > M.groundAt(map, np.x, np.z, np.y) + 3.2) { send(p, { t: 'fix', x: p.x, y: p.y, z: p.z }); return; }
        Object.assign(p, np, { yaw, pitch: Math.max(-1.4, Math.min(1.4, pitch)) });
      } else if (m.t === 'config' && p.admin) { // 管理者だけ: ゲームバランス・通行人の設定を変える (全員に知らせる)
        Object.assign(cfg, Config.sanitize(m.patch)); all({ t: 'config', cfg: pubCfg() });
        console.log(`[arena] 設定を変更: ${JSON.stringify(Config.sanitize(m.patch))}`);
      } else if (m.t === 'drive' && p.car && p.alive) { // 運転: 位置はブラウザが送る。速すぎる動きはもどす
        const v = traffic.vehicles.get(p.car), x = Number(m.x), z = Number(m.z), yaw = Number(m.yaw), sp = Number(m.sp);
        if (!v || ![x, z, yaw, sp].every(Number.isFinite)) return;
        const dts = Math.min(0.5, Math.max(0.03, (now - p.lastPosAt) / 1000)); p.lastPosAt = now;
        const np = { x, y: 0, z }; M.collide(map, np);
        if (Math.hypot(np.x - v.x, np.z - v.z) > CAR.max * dts + 1.2) { send(p, { t: 'cfix', x: v.x, z: v.z, yaw: v.yaw }); return; }
        Object.assign(v, { x: np.x, z: np.z, yaw, speed: Math.max(-12, Math.min(CAR.max, sp)) }); Object.assign(p, { x: v.x, z: v.z, y: 0, yaw });
      } else if (m.t === 'enter' && typeof m.id === 'string') { enterCar(p, m.id);
      } else if (m.t === 'exit' && p.car) { exitCar(p);
      } else if (m.t === 'dbg' && p.admin) { p.dbg = !!m.on; if (p.dbg) send(p, { t: 'dbg', d: debugState() });
      } else if (m.t === 'dbgcmd' && p.admin && typeof m.k === 'string') { debugCmd(p, m); send(p, { t: 'dbg', d: debugState() });
      } else if (m.t === 'punch' && p.alive && !p.car && Body.canAct(p.body)) {
        punch(p);
      } else if (m.t === 'weapon' && WEAPONS[m.w] && m.w !== p.w) { // 武器の持ちかえ (みんなに知らせる)
        p.w = m.w; p.switchAt = now; all({ t: 'weapon', sid: p.sid, w: p.w });
      } else if (m.t === 'shoot' && p.alive && !p.car && Body.canAct(p.body)) {
        const W = WEAPONS[p.w || 'rifle'];
        if (now - (p.lastShot || 0) < W.ms - 20 || now - (p.switchAt || 0) < SWITCH_MS - 20) return; p.lastShot = now;
        const o = Array.isArray(m.o) ? m.o.map(Number) : [], d = Array.isArray(m.d) ? m.d.map(Number) : [];
        if (o.length !== 3 || d.length !== 3 || ![...o, ...d].every(Number.isFinite)) return;
        if (Math.hypot(o[0] - p.x, o[1] - (p.y + 1.4), o[2] - p.z) > 2.5) return; // 自分の体から撃つ
        const L = Math.hypot(...d); if (L < 0.5) return;
        p.protectUntil = 0; // 撃ったら無敵は終わり
        fire(p, o, d.map((v) => v / L), W.dmg, p.w || 'rifle');
      }
    });
    ws.on('close', () => {
      if (players.get(p.sid) !== p) return;
      if (p.car) exitCar(p);
      players.delete(p.sid); all({ t: 'leave', sid: p.sid }); syncBots(); stopLoop();
    });
  });
  ctx.arenaUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  app.get('/api/arena/status', (req, res) => res.json({ humans: humans().length, max: MAX_HUMANS, npcs: npcs.npcs.size }));
  ctx.arenaDebug = { cfg, npcs, players, traffic, incidents, services, debugState, get tickMs() { return tickMs; } }; // テスト用
};
