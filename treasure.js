// =====================================================================
// ミニゲーム「宝探し」: キャンパスにかくれた宝箱を、みんなで早いもの勝ちで探す (3D・オンライン・戦いなし)
//   ・WebSocket /tr。ログインしている人ならだれでも。1 つのキャンパスに 20 人まで
//   ・ラウンド制: 4 分で 12 個の宝箱をかくす (ふつう 1 点・銀 2 点・虹 5 点)。全部見つかるか時間切れで終わり → 12 秒休んで次へ
//   ・動きはブラウザが送り、サーバーが速さ (ワープ) をたしかめる。宝を拾えたかもサーバーが決める (1.6m いない)
//   ・宝の場所は、近く (22m いない) のものだけ送る。遠くの宝はヒント (あつい・あたたかい・すずしい・つめたい) だけ
//   ・記録 (見つけた数・点・ラウンド 1 位の回数) は表 treasure_players に保存。ランキングあり。コインなどの報酬はなし
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const A = require('./public/games/arena/arena-map.js');
const Campus = require('./public/games/treasure/campus-map.js');

// メンテナンス中: 管理者のほかは遊べない (環境変数 TREASURE_MAINT=0 で解除)
const MAINT = process.env.TREASURE_MAINT !== '0';
const MAX = 20, TICK_MS = 100, ROUND_MS = 4 * 60 * 1000, REST_MS = 12000, COUNT = 12, GRAB = 1.6, SEE = 22, MAX_SPEED = 9.5;
const KINDS = { bronze: { pts: 1, name: '宝箱', p: 0.6 }, silver: { pts: 2, name: '銀の宝箱', p: 0.3 }, rainbow: { pts: 5, name: '虹の宝箱', p: 0.1 } };
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac', '#a9e34b', '#748ffc'];
const MIGRATION = `
CREATE TABLE IF NOT EXISTS treasure_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  found INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  rainbow INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS treasure_players_points ON treasure_players(points DESC);
`;

module.exports = function install(app, ctx) {
  const { db } = ctx;
  db.migrate('2026-11-21-treasure', MIGRATION);
  const map = Campus.build();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });
  const players = new Map();
  let loop = null, round = null, seq = 0;
  const nameOf = (uid) => { const u = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(uid); return u ? String(u.display_name || u.username).slice(0, 20) : '???'; };
  const send = (p, m) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); };
  const all = (m) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
  const pub = (p) => ({ sid: p.sid, name: p.name, color: p.color, score: p.score });
  const qIns = db.prepare('INSERT OR IGNORE INTO treasure_players (user_id, updated_at) VALUES (?, ?)');
  const qAdd = db.prepare('UPDATE treasure_players SET found = found + ?, points = points + ?, rainbow = rainbow + ?, updated_at = ? WHERE user_id = ?');
  const qRound = db.prepare('UPDATE treasure_players SET rounds = rounds + 1, wins = wins + ?, updated_at = ? WHERE user_id = ?');
  const qTop = db.prepare('SELECT t.*, u.username, u.display_name FROM treasure_players t JOIN users u ON u.id = t.user_id WHERE t.points > 0 ORDER BY t.points DESC, t.found DESC LIMIT ?');
  const qMe = db.prepare('SELECT * FROM treasure_players WHERE user_id = ?');
  const top = (n = 10) => qTop.all(n).map((r, k) => ({ place: k + 1, name: String(r.display_name || r.username).slice(0, 20), username: r.username, points: r.points, found: r.found, wins: r.wins }));
  const meStats = (uid) => { qIns.run(uid, Date.now()); const r = qMe.get(uid); return { found: r.found, points: r.points, rainbow: r.rainbow, wins: r.wins, rounds: r.rounds }; };

  // ---------- ラウンド ----------
  function pickKind() { const r = Math.random(); let a = 0; for (const [k, v] of Object.entries(KINDS)) { a += v.p; if (r < a) return k; } return 'bronze'; }
  function startRound(now) {
    const spots = [...map.spots].sort(() => Math.random() - 0.5).slice(0, COUNT);
    round = { id: ++seq, start: now, end: now + ROUND_MS, rest: 0, treasures: new Map(spots.map((s, k) => { const id = 't' + k, kind = pickKind(); return [id, { id, kind, x: s.x, z: s.z, name: s.name, by: null }]; })) };
    for (const p of players.values()) { p.score = 0; p.seen = new Set(); }
    all({ t: 'round', id: round.id, end: round.end, count: COUNT, players: [...players.values()].map(pub) });
  }
  function endRound(now) {
    round.rest = now + REST_MS;
    const ranked = [...players.values()].sort((a, b) => b.score - a.score), best = ranked[0] && ranked[0].score > 0 ? ranked[0].score : null;
    for (const p of players.values()) qRound.run(best !== null && p.score === best ? 1 : 0, now, p.uid);
    all({ t: 'roundend', next: round.rest, ranking: ranked.map((p) => ({ name: p.name, score: p.score, sid: p.sid })), left: [...round.treasures.values()].filter((t) => !t.by).map((t) => ({ x: t.x, z: t.z, name: t.name, kind: t.kind })), top: top(10) });
    for (const p of players.values()) send(p, { t: 'me', stats: meStats(p.uid) });
  }
  // 近くの宝・ヒント (1 人ずつ)
  function hintFor(p) {
    let nd = Infinity; const near = [];
    for (const t of round.treasures.values()) { if (t.by) continue; const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < nd) nd = d; if (d < SEE) near.push({ id: t.id, kind: t.kind, x: t.x, z: t.z }); }
    const heat = nd < 8 ? 3 : nd < 20 ? 2 : nd < 40 ? 1 : 0; // 3 あつい・2 あたたかい・1 すずしい・0 つめたい
    return { near, heat, d: nd === Infinity ? null : Math.round(nd) };
  }
  function grab(p, now) {
    if (!round || round.rest) return;
    for (const t of round.treasures.values()) {
      if (t.by || Math.hypot(t.x - p.x, t.z - p.z) > GRAB || p.y > 2.5) continue;
      t.by = p.sid; const pts = KINDS[t.kind].pts; p.score += pts;
      qAdd.run(1, pts, t.kind === 'rainbow' ? 1 : 0, now, p.uid);
      all({ t: 'found', id: t.id, sid: p.sid, name: p.name, kind: t.kind, pts, score: p.score, where: t.name, left: [...round.treasures.values()].filter((x) => !x.by).length });
    }
    if ([...round.treasures.values()].every((t) => t.by)) endRound(now);
  }
  function tick() {
    const now = Date.now();
    if (!round || (round.rest && now >= round.rest)) startRound(now);
    else if (!round.rest && now >= round.end) endRound(now);
    const rows = [...players.values()].map((p) => [p.sid, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3)]);
    const withHint = (now / TICK_MS | 0) % 5 === 0; // ヒントは 0.5 秒に 1 回
    for (const p of players.values()) send(p, { t: 's', p: rows, ...(withHint && !round.rest ? { h: hintFor(p) } : {}) });
  }
  const startLoop = () => { if (!loop) loop = setInterval(tick, TICK_MS); };
  const stopLoop = () => { if (loop && !players.size) { clearInterval(loop); loop = null; round = null; } };

  const isAdmin = (u) => !!(ctx.isAdmin && ctx.isAdmin(u));
  wss.on('connection', (ws, req, user) => {
    if (MAINT && !isAdmin(user)) { ws.send(JSON.stringify({ t: 'maint' })); return ws.close(4003, 'maintenance'); } // メンテ中
    for (const p of players.values()) if (p.uid === user.id) { try { p.ws.close(4000, 'other-tab'); } catch {} }
    if ([...players.values()].filter((p) => p.uid !== user.id).length >= MAX) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(); }
    const sp = map.spawns[crypto.randomInt(0, map.spawns.length)];
    const p = { sid: crypto.randomBytes(6).toString('base64url'), uid: user.id, ws, name: nameOf(user.id), color: COLORS[user.id % COLORS.length], x: sp.x, y: 0, z: sp.z, yaw: 0, score: 0, lastPosAt: Date.now(), msgs: 0, msgWin: Date.now(), seen: new Set() };
    players.set(p.sid, p); startLoop();
    if (!round) startRound(Date.now());
    send(p, { t: 'welcome', you: p.sid, me: { x: p.x, z: p.z }, players: [...players.values()].map(pub), round: { id: round.id, end: round.end, rest: round.rest, count: COUNT, left: [...round.treasures.values()].filter((t) => !t.by).length }, kinds: KINDS, stats: meStats(user.id), top: top(10), rules: { grab: GRAB, see: SEE, roundMs: ROUND_MS } });
    all({ t: 'join', p: pub(p) });
    ws.on('message', (raw) => {
      const now = Date.now(); if (now - p.msgWin > 1000) { p.msgWin = now; p.msgs = 0; } if (++p.msgs > 40) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || m.t !== 'pos') return;
      const x = Number(m.x), y = Number(m.y), z = Number(m.z), yaw = Number(m.yaw);
      if (![x, y, z, yaw].every(Number.isFinite)) return;
      const dts = Math.min(0.5, Math.max(0.03, (now - p.lastPosAt) / 1000)); p.lastPosAt = now;
      const np = { x, y: Math.max(0, Math.min(12, y)), z }; A.collide(map, np);
      if (Math.hypot(np.x - p.x, np.z - p.z) > MAX_SPEED * dts + 0.6 || np.y > A.groundAt(map, np.x, np.z, np.y) + 3.2) { send(p, { t: 'fix', x: p.x, y: p.y, z: p.z }); return; } // 速すぎる動き (ワープ) はもどす
      Object.assign(p, np, { yaw });
      grab(p, now);
    });
    ws.on('close', () => { if (players.get(p.sid) !== p) return; players.delete(p.sid); all({ t: 'leave', sid: p.sid }); stopLoop(); });
  });
  ctx.treasureUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  app.get('/api/treasure/ranking', (req, res) => res.json({ ranking: top(20) }));
  app.get('/api/treasure/status', (req, res) => res.json({ players: players.size, max: MAX, maint: MAINT, admin: isAdmin(req.user) }));
  ctx.treasureDebug = { players, get round() { return round; }, map };
};
