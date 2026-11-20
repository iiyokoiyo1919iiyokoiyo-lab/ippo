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

const MAX_HUMANS = 16, TICK_MS = 50, RESPAWN_MS = 3000, PROTECT_MS = 2000, HP = 100;
const FIRE_MS = 130, RANGE = 90, DMG = { body: 22, head: 45 }, BOT_DMG = { body: 12, head: 24 };
const BOTS_MAX = process.env.ARENA_BOTS != null ? Math.max(0, Number(process.env.ARENA_BOTS) || 0) : 3; // テスト用: ARENA_BOTS=0 でボットなし
const PUNCH = { range: 2.4, cos: Math.cos((55 * Math.PI) / 180), dmg: 35, ms: 600, kb: 7 }; // なぐる: 前 2.4m・左右 55° いないの相手に 35 ダメージ + ふっとばし
const MAX_SPEED = 9.5; // 走る速さ (8) + ゆとり
const BOT_NAMES = ['ボット・ミケ', 'ボット・ポチ', 'ボット・タマ', 'ボット・ハチ', 'ボット・コロ'];
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac', '#a9e34b', '#748ffc'];

module.exports = function install(app, ctx) {
  const { db } = ctx;
  const map = M.build();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });
  const players = new Map(); // sid → プレイヤー (人間・ボット)
  let loop = null, botSeq = 0;
  const nameOf = (uid) => { const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(uid); return u ? String(u.display_name || u.username).slice(0, 20) : '???'; };
  const humans = () => [...players.values()].filter((p) => !p.bot);
  const pub = (p) => ({ sid: p.sid, name: p.name, color: p.color, bot: !!p.bot, kills: p.kills, deaths: p.deaths });
  const send = (p, m) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
  const all = (m) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); };
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

  // 出てくる場所: 交差点のうち、ほかのプレイヤーからいちばん遠いところ (候補 8 つから)
  function spawn(p) {
    const others = [...players.values()].filter((q) => q !== p && q.alive);
    let best = null, bestD = -1;
    for (let k = 0; k < 8; k++) {
      const n = map.nodes[crypto.randomInt(0, map.nodes.length)];
      const d = others.length ? Math.min(...others.map((q) => dist2(q, n))) : 1;
      if (d > bestD) { bestD = d; best = n; }
    }
    Object.assign(p, { x: best.x, y: 0, z: best.z, yaw: Math.random() * Math.PI * 2, pitch: 0, hp: HP, alive: true, protectUntil: Date.now() + PROTECT_MS, lastPosAt: Date.now() });
    if (p.bot) Object.assign(p, { node: best, goal: null, stuckAt: Date.now(), stuckPos: { x: p.x, z: p.z } });
    all({ t: 'spawn', sid: p.sid, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
  }

  // 撃つ: o (撃った位置) から d (向き) へ。壁より手前のいちばん近いプレイヤーに当たる
  function fire(p, o, d, dmgTable) {
    const wallT = M.rayWorld(map, o, d, RANGE);
    let hit = null;
    for (const q of players.values()) {
      if (q === p || !q.alive || q.protectUntil > Date.now()) continue;
      const r = M.rayPlayer(o, d, q);
      if (r && r.t < wallT && (!hit || r.t < hit.t)) hit = { ...r, q };
    }
    const t = hit ? hit.t : wallT;
    all({ t: 'shot', sid: p.sid, o: o.map((v) => +v.toFixed(2)), e: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t].map((v) => +v.toFixed(2)), hit: !!hit });
    if (!hit) return;
    damage(p, hit.q, hit.head ? dmgTable.head : dmgTable.body, { head: hit.head });
  }
  function damage(p, q, dmg, { head = false, melee = false, kb = null } = {}) {
    q.hp = Math.max(0, q.hp - dmg);
    all({ t: 'hit', sid: p.sid, to: q.sid, dmg, head, melee, kb, hp: q.hp });
    if (q.hp <= 0) {
      q.alive = false; q.deaths++; p.kills++; q.respawnAt = Date.now() + RESPAWN_MS;
      all({ t: 'kill', killer: p.sid, victim: q.sid, head, melee, score: [pub(p), pub(q)] });
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
    for (const q of players.values()) {
      if (q === p || !q.alive || q.protectUntil > now) continue;
      const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz);
      if (L > PUNCH.range || Math.abs(q.y - p.y) > 1.5) continue;
      if (L > 0.3 && (dx * fx + dz * fz) / L < PUNCH.cos) continue;
      const o = [p.x, p.y + 1.1, p.z], d = [dx / (L || 1), (q.y - p.y) / (L || 1), dz / (L || 1)], dl = Math.hypot(...d);
      if (L > 0.3 && M.rayWorld(map, o, d.map((v) => v / dl), L) < L - 0.4) continue;
      if (!best || L < best.L) best = { q, L, dx, dz };
    }
    if (!best) return;
    const n = best.L || 1;
    damage(p, best.q, p.bot ? Math.round(PUNCH.dmg * 0.6) : PUNCH.dmg, { melee: true, kb: [+(best.dx / n * PUNCH.kb).toFixed(2), +(best.dz / n * PUNCH.kb).toFixed(2)] });
  }

  // ボット: 道路の交差点をめぐり、見える相手がいたら撃つ (人間より弱い)
  function botThink(b, now, dt) {
    if (!b.alive) return;
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
  function tick() {
    const now = Date.now(), dt = TICK_MS / 1000;
    for (const p of players.values()) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt) { p.respawnAt = 0; spawn(p); }
      if (p.bot) botThink(p, now, dt);
    }
    all({ t: 's', p: [...players.values()].map((p) => [p.sid, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +(p.pitch || 0).toFixed(3), p.hp, p.alive ? 1 : 0, p.protectUntil > now ? 1 : 0]) });
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
    send(p, { t: 'welcome', you: p.sid, me: { x: p.x, y: p.y, z: p.z, yaw: p.yaw }, players: [...players.values()].map(pub), rules: { hp: HP, respawnMs: RESPAWN_MS, protectMs: PROTECT_MS, fireMs: FIRE_MS, dmg: DMG, punch: { ms: PUNCH.ms, dmg: PUNCH.dmg, range: PUNCH.range } } });
    all({ t: 'join', p: pub(p) });
    console.log(`[arena] @${user.username} が入った (人間 ${humans().length} 人)`);
    ws.on('message', (raw) => {
      // メッセージの数を制限 (1 秒に 60 まで)
      const now = Date.now(); if (now - p.msgWin > 1000) { p.msgWin = now; p.msgs = 0; } if (++p.msgs > 60) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'pos' && p.alive) {
        const x = Number(m.x), y = Number(m.y), z = Number(m.z), yaw = Number(m.yaw), pitch = Number(m.pitch);
        if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
        // 速すぎる動き (ワープ) は受けつけず、サーバーの位置にもどす
        const dts = Math.min(0.5, Math.max(0.03, (now - p.lastPosAt) / 1000)); p.lastPosAt = now;
        const allow = MAX_SPEED * dts + 0.6, moved = Math.hypot(x - p.x, z - p.z);
        const np = { x, y: Math.max(0, Math.min(40, y)), z };
        M.collide(map, np);
        if (moved > allow || np.y > M.groundAt(map, np.x, np.z, np.y) + 3.2) { send(p, { t: 'fix', x: p.x, y: p.y, z: p.z }); return; }
        Object.assign(p, np, { yaw, pitch: Math.max(-1.4, Math.min(1.4, pitch)) });
      } else if (m.t === 'punch' && p.alive) {
        punch(p);
      } else if (m.t === 'shoot' && p.alive) {
        if (now - (p.lastShot || 0) < FIRE_MS - 20) return; p.lastShot = now;
        const o = Array.isArray(m.o) ? m.o.map(Number) : [], d = Array.isArray(m.d) ? m.d.map(Number) : [];
        if (o.length !== 3 || d.length !== 3 || ![...o, ...d].every(Number.isFinite)) return;
        if (Math.hypot(o[0] - p.x, o[1] - (p.y + 1.4), o[2] - p.z) > 2.5) return; // 自分の体から撃つ
        const L = Math.hypot(...d); if (L < 0.5) return;
        p.protectUntil = 0; // 撃ったら無敵は終わり
        fire(p, o, d.map((v) => v / L), DMG);
      }
    });
    ws.on('close', () => {
      if (players.get(p.sid) !== p) return;
      players.delete(p.sid); all({ t: 'leave', sid: p.sid }); syncBots(); stopLoop();
    });
  });
  ctx.arenaUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  app.get('/api/arena/status', (req, res) => res.json({ humans: humans().length, max: MAX_HUMANS }));
};
