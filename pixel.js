// =====================================================================
// PIXEL WORLD — 全校で 1 枚のキャンバスを共有して描く共同ピクセルアート
//
// ・配置ルール: 1 ユーザーにつき 60 秒に 1 ピクセル (サーバー側で最終配置時刻を記録して判定)
// ・リアルタイム同期: WebSocket (/pw) で配置を全員に配信。サーバーのデータを正とする
// ・個人の配置履歴は公開しない (管理者の調査・復元のためにだけ記録する)
// =====================================================================
const { WebSocketServer } = require('ws');

const W = 100, H = 100;
const COOLDOWN_MS = Number(process.env.PW_COOLDOWN_MS || 60_000);
// 16 色の固定パレット (番号・名前つき。色の区別が難しい人も番号と名前で確認できる)
const PALETTE = [
  ['#FFFFFF', '白'], ['#C2C7D0', '明るいグレー'], ['#6B7280', 'グレー'], ['#1A1C24', '黒'],
  ['#E5383B', '赤'], ['#F4802A', 'オレンジ'], ['#FFD43B', '黄'], ['#94D82D', '黄緑'],
  ['#2F9E44', '緑'], ['#4CC9F0', '水色'], ['#3A6FF2', '青'], ['#1F2766', '紺'],
  ['#7B4AE2', '紫'], ['#F06EAA', 'ピンク'], ['#8B5A2B', '茶'], ['#F8C9A0', 'ベージュ'],
].map(([hex, name], i) => ({ id: i, hex, name }));

const MIGRATION = `
CREATE TABLE pw_canvases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  pixels BLOB NOT NULL,                       -- 1 マス 1 バイト (色番号 0〜15)
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  published INTEGER NOT NULL DEFAULT 1,       -- アーカイブの公開状態 (運営者だけが変更)
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL, -- 完成作品へのコメント用の投稿
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  placements INTEGER NOT NULL DEFAULT 0,
  participants INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX pw_one_active ON pw_canvases(status) WHERE status = 'active';
CREATE TABLE pw_placements (                  -- 配置履歴 (調査・復元用。一般には公開しない)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canvas_id INTEGER NOT NULL REFERENCES pw_canvases(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  x INTEGER NOT NULL CHECK (x >= 0 AND x < 100),
  y INTEGER NOT NULL CHECK (y >= 0 AND y < 100),
  color INTEGER NOT NULL CHECK (color >= 0 AND color < 16),
  prev_color INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'place' CHECK (kind IN ('place', 'restore')),
  created_at INTEGER NOT NULL
);
CREATE INDEX pw_placements_canvas ON pw_placements(canvas_id, id);
CREATE INDEX pw_placements_user ON pw_placements(user_id, created_at);
CREATE INDEX pw_placements_xy ON pw_placements(canvas_id, x, y, id);
CREATE INDEX pw_placements_time ON pw_placements(canvas_id, created_at);
CREATE TABLE pw_cooldowns (                   -- 最終配置時刻 (60 秒ルールの判定に使う)
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_placed_at INTEGER NOT NULL
);
CREATE TABLE pw_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE pw_polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE pw_poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL REFERENCES pw_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE pw_votes (
  poll_id INTEGER NOT NULL REFERENCES pw_polls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES pw_poll_options(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
`;

// 日本時間の「今日 0 時」
const jstDayStart = (now = Date.now()) => { const d = new Date(now + 9 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 9 * 3600_000; };
const jstMinutes = (now = Date.now()) => { const d = new Date(now + 9 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const parseHM = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser, isAdmin, hydrate } = ctx;

  // ---------- マイグレーション ----------
  db.migrate('2026-11-17-pixel-world', MIGRATION);
  if (!db.prepare("SELECT 1 FROM pw_canvases WHERE status = 'active'").get()) {
    db.prepare("INSERT INTO pw_canvases (title, theme, width, height, pixels, status, started_at) VALUES (?, '', ?, ?, ?, 'active', ?)")
      .run('第1回 PIXEL WORLD', W, H, Buffer.alloc(W * H, 0), Date.now());
  }

  const q = {
    active: db.prepare("SELECT * FROM pw_canvases WHERE status = 'active'"),
    canvas: db.prepare('SELECT * FROM pw_canvases WHERE id = ?'),
    cooldown: db.prepare('SELECT last_placed_at FROM pw_cooldowns WHERE user_id = ?'),
    setCooldown: db.prepare('INSERT INTO pw_cooldowns (user_id, last_placed_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_placed_at = excluded.last_placed_at'),
    hasPlaced: db.prepare("SELECT 1 FROM pw_placements WHERE canvas_id = ? AND user_id = ? AND kind = 'place' LIMIT 1"),
    insertPlacement: db.prepare('INSERT INTO pw_placements (canvas_id, user_id, x, y, color, prev_color, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    savePixels: db.prepare('UPDATE pw_canvases SET pixels = ?, placements = placements + ?, participants = participants + ? WHERE id = ?'),
    lastSeq: db.prepare('SELECT MAX(id) AS seq FROM pw_placements WHERE canvas_id = ?'),
    getSetting: db.prepare('SELECT value FROM pw_settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO pw_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };
  const setting = (k, d = null) => { const r = q.getSetting.get(k); return r ? JSON.parse(r.value) : d; };
  const setSetting = (k, v) => q.setSetting.run(k, JSON.stringify(v));

  // 一時停止の状態 (管理者が停止中 / 夜間などの休止時間帯)
  function pauseState(now = Date.now()) {
    const p = setting('pause', { on: false, reason: '' });
    if (p.on) return { paused: true, reason: p.reason || '運営により一時停止しています' };
    const quiet = setting('quiet', null);
    if (quiet) {
      const s = parseHM(quiet.start), e = parseHM(quiet.end), m = jstMinutes(now);
      if (s !== null && e !== null && s !== e && (s < e ? m >= s && m < e : m >= s || m < e)) {
        return { paused: true, reason: `${quiet.start}〜${quiet.end} は休止時間です`, quiet: true };
      }
    }
    return { paused: false, reason: '' };
  }

  // ---------- リアルタイム配信 (WebSocket) ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const clients = new Set();
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const ws of clients) if (ws.readyState === 1) ws.send(s); };
  let onlineTimer = null;
  const announceOnline = () => { clearTimeout(onlineTimer); onlineTimer = setTimeout(() => broadcast({ t: 'online', n: clients.size }), 400); };
  wss.on('connection', (ws) => {
    ws.alive = true;
    clients.add(ws);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', () => {}); // クライアントからの書き込みは受け付けない (配置は認証つき HTTP で行う)
    ws.on('close', () => { clients.delete(ws); announceOnline(); });
    ws.send(JSON.stringify({ t: 'hello', n: clients.size }));
    announceOnline();
  });
  // 切れた接続を掃除 (30 秒ごとに生存確認)
  setInterval(() => { for (const ws of clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 30_000).unref();
  ctx.pixelUpgrade = (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));

  // ---------- 状態の取得 ----------
  function stats(c) {
    const now = Date.now(), day = jstDayStart(now);
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
      online: clients.size,
      todayParticipants: n("SELECT COUNT(DISTINCT user_id) AS n FROM pw_placements WHERE canvas_id = ? AND kind = 'place' AND created_at >= ?", c.id, day),
      todayPlacements: n("SELECT COUNT(*) AS n FROM pw_placements WHERE canvas_id = ? AND kind = 'place' AND created_at >= ?", c.id, day),
      hourPlacements: n("SELECT COUNT(*) AS n FROM pw_placements WHERE canvas_id = ? AND kind = 'place' AND created_at >= ?", c.id, now - 3600_000),
      participants: c.participants,
      placements: c.placements,
    };
  }
  // 最近の更新 (誰が置いたかは出さない: 座標・色・時刻のみ)
  const recent = (c, limit = 12) => db.prepare('SELECT id, x, y, color, created_at FROM pw_placements WHERE canvas_id = ? ORDER BY id DESC LIMIT ?')
    .all(c.id, limit).map((r) => ({ seq: r.id, x: r.x, y: r.y, c: r.color, at: r.created_at }));
  const canvasOut = (c) => ({
    id: c.id, title: c.title, theme: c.theme, width: c.width, height: c.height, status: c.status,
    startedAt: c.started_at, endedAt: c.ended_at, placements: c.placements, participants: c.participants,
    published: !!c.published, postId: c.post_id, pixels: Buffer.from(c.pixels).toString('base64'),
  });
  const myCooldown = (user, now = Date.now()) => {
    if (!user) return null;
    const last = q.cooldown.get(user.id)?.last_placed_at || 0;
    return { lastPlacedAt: last || null, nextAt: last ? last + COOLDOWN_MS : 0 };
  };

  const readLimit = rateLimit({ windowMs: 60_000, max: 90 });
  app.get('/api/pw/state', readLimit, (req, res) => {
    const c = q.active.get(), now = Date.now();
    res.json({
      serverNow: now, cooldownMs: COOLDOWN_MS, palette: PALETTE,
      canvas: { ...canvasOut(c), seq: q.lastSeq.get(c.id).seq || 0 },
      ...pauseState(now), quiet: setting('quiet', null),
      me: myCooldown(req.user, now), stats: stats(c), recent: recent(c),
    });
  });
  app.get('/api/pw/stats', readLimit, (req, res) => {
    const c = q.active.get();
    res.json({ serverNow: Date.now(), stats: stats(c), ...pauseState() });
  });

  // ---------- ピクセルの配置 ----------
  // 認証確認 → 休止確認 → 60 秒ルール確認 → 保存 → 最終配置時刻の記録 を 1 つのトランザクションで行う。
  // node:sqlite は同期処理なので、同時に来たリクエストも 1 件ずつ順番に処理され、2 件目は必ず 60 秒ルールで拒否される。
  const placeLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => 'pw' + req.user.id });
  app.post('/api/pw/pixels', requireAuth, placeLimit, (req, res) => {
    const { x, y, color } = req.body || {};
    if (![x, y, color].every(Number.isInteger) || x < 0 || x >= W || y < 0 || y >= H || color < 0 || color >= PALETTE.length) {
      return res.status(400).json({ error: '座標または色が正しくありません' });
    }
    const now = Date.now();
    const pause = pauseState(now);
    if (pause.paused) return res.status(423).json({ error: pause.reason, paused: true });
    let result;
    db.exec('BEGIN IMMEDIATE');
    try {
      const last = q.cooldown.get(req.user.id)?.last_placed_at || 0;
      if (now - last < COOLDOWN_MS) {
        db.exec('ROLLBACK');
        return res.status(429).json({ error: `次に置けるまであと${Math.ceil((last + COOLDOWN_MS - now) / 1000)}秒です`, nextAt: last + COOLDOWN_MS, serverNow: now });
      }
      const c = q.active.get();
      const pixels = Buffer.from(c.pixels);
      const idx = y * W + x, prev = pixels[idx];
      if (prev === color) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'そのマスはすでにその色です', serverNow: now }); }
      pixels[idx] = color;
      const first = !q.hasPlaced.get(c.id, req.user.id);
      const r = q.insertPlacement.run(c.id, req.user.id, x, y, color, prev, 'place', now);
      q.savePixels.run(pixels, 1, first ? 1 : 0, c.id);
      q.setCooldown.run(req.user.id, now);
      db.exec('COMMIT');
      result = { seq: Number(r.lastInsertRowid), canvasId: c.id };
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      return res.status(500).json({ error: '配置に失敗しました。もう一度お試しください' });
    }
    broadcast({ t: 'px', canvas: result.canvasId, seq: result.seq, x, y, c: color, at: now });
    res.json({ ok: true, seq: result.seq, x, y, color, serverNow: now, nextAt: now + COOLDOWN_MS });
  });

  // ---------- テーマ投票 ----------
  function pollOut(p, user) {
    if (!p) return null;
    const options = db.prepare('SELECT o.id, o.label, (SELECT COUNT(*) FROM pw_votes v WHERE v.option_id = o.id) AS votes FROM pw_poll_options o WHERE o.poll_id = ? ORDER BY o.position').all(p.id);
    const mine = user ? db.prepare('SELECT option_id FROM pw_votes WHERE poll_id = ? AND user_id = ?').get(p.id, user.id)?.option_id || null : null;
    return { id: p.id, question: p.question, status: p.status, createdAt: p.created_at, closedAt: p.closed_at,
      options, total: options.reduce((s, o) => s + o.votes, 0), myVote: mine };
  }
  app.get('/api/pw/poll', readLimit, (req, res) => {
    const p = db.prepare("SELECT * FROM pw_polls ORDER BY (status = 'open') DESC, id DESC LIMIT 1").get();
    res.json({ poll: pollOut(p, req.user) });
  });
  const voteLimit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => 'pv' + req.user.id });
  app.post('/api/pw/poll/:id/vote', requireAuth, voteLimit, (req, res) => {
    const p = db.prepare('SELECT * FROM pw_polls WHERE id = ?').get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: '投票が見つかりません' });
    if (p.status !== 'open') return res.status(400).json({ error: 'この投票は締め切られました' });
    const opt = db.prepare('SELECT id FROM pw_poll_options WHERE id = ? AND poll_id = ?').get(Number(req.body?.optionId), p.id);
    if (!opt) return res.status(400).json({ error: '選択肢が正しくありません' });
    db.prepare('INSERT INTO pw_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, created_at = excluded.created_at')
      .run(p.id, req.user.id, opt.id, Date.now());
    const out = pollOut(p, req.user);
    broadcast({ t: 'poll' });
    res.json({ poll: out });
  });

  // ---------- 作品アーカイブ ----------
  app.get('/api/pw/archives', readLimit, (req, res) => {
    const admin = isAdmin(req.user);
    const rows = db.prepare(`SELECT * FROM pw_canvases WHERE status = 'archived' ${admin ? '' : 'AND published = 1'} ORDER BY ended_at DESC LIMIT 30`).all();
    res.json({ archives: rows.map(canvasOut), canManage: admin, palette: PALETTE });
  });
  app.get('/api/pw/archives/:id', readLimit, (req, res) => {
    const c = q.canvas.get(Number(req.params.id));
    if (!c || c.status !== 'archived' || (!c.published && !isAdmin(req.user))) return res.status(404).json({ error: '作品が見つかりません' });
    res.json({ archive: canvasOut(c), canManage: isAdmin(req.user), palette: PALETTE });
  });

  // =================== 管理者 ===================
  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: '管理者だけが使える機能です' }));
  const adminLimit = rateLimit({ windowMs: 60_000, max: 120, key: (req) => 'pwa' + req.user.id });
  const log = (req, msg) => console.log(`[pixel-admin] ${req.user.username}: ${msg}`);

  // 一時停止 / 再開
  app.post('/api/pw/admin/pause', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const on = !!req.body?.paused, reason = String(req.body?.reason || '').slice(0, 100);
    setSetting('pause', { on, reason });
    log(req, on ? `一時停止 (${reason})` : '再開');
    const p = pauseState();
    broadcast({ t: 'pause', ...p });
    res.json(p);
  });
  // 休止時間帯 (毎日。例 22:00〜06:00)。空なら解除
  app.post('/api/pw/admin/quiet', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const { start, end } = req.body || {};
    if (!start && !end) { db.prepare("DELETE FROM pw_settings WHERE key = 'quiet'").run(); }
    else {
      if (parseHM(start) === null || parseHM(end) === null || start === end) return res.status(400).json({ error: '時刻は 00:00〜23:59 の形式で、開始と終了を別の時刻にしてください' });
      setSetting('quiet', { start, end });
    }
    log(req, `休止時間帯: ${start || 'なし'}〜${end || ''}`);
    const p = pauseState();
    broadcast({ t: 'pause', ...p });
    res.json({ quiet: setting('quiet', null), ...p });
  });
  // 調査: あるマスの履歴 (誰がいつ何色にしたか。管理者だけ)
  app.get('/api/pw/admin/pixel', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const x = Number(req.query.x), y = Number(req.query.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= W || y < 0 || y >= H) return res.status(400).json({ error: '座標が正しくありません' });
    const c = q.active.get();
    const rows = db.prepare(`SELECT p.*, u.username FROM pw_placements p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.canvas_id = ? AND p.x = ? AND p.y = ? ORDER BY p.id DESC LIMIT 30`).all(c.id, x, y);
    res.json({ history: rows.map((r) => ({ at: r.created_at, color: r.color, prev: r.prev_color, kind: r.kind, user: r.username || '(削除されたユーザー)' })) });
  });
  // 調査: 特定のユーザーの配置 (現在のキャンバス)
  app.get('/api/pw/admin/user', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.query.username || ''));
    if (!u) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    const c = q.active.get();
    const rows = db.prepare("SELECT * FROM pw_placements WHERE canvas_id = ? AND user_id = ? AND kind = 'place' ORDER BY id DESC LIMIT 200").all(c.id, u.id);
    res.json({ user: publicUser(u), placements: rows.map((r) => ({ x: r.x, y: r.y, color: r.color, prev: r.prev_color, at: r.created_at })) });
  });
  // 復元: 特定のユーザーが指定時刻以降に置いたピクセルを元に戻す
  // (その後に別の人が上書きしたマスはそのまま残す)
  app.post('/api/pw/admin/revert', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body?.username || ''));
    if (!u) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    const since = Number(req.body?.since) || 0;
    const now = Date.now();
    const events = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      const c = q.active.get();
      const pixels = Buffer.from(c.pixels);
      const rows = db.prepare("SELECT * FROM pw_placements WHERE canvas_id = ? AND user_id = ? AND kind = 'place' AND created_at >= ? ORDER BY id DESC").all(c.id, u.id, since);
      for (const r of rows) {
        const idx = r.y * W + r.x;
        // そのマスで、この配置より後に誰かが置いていたら戻さない
        const later = db.prepare('SELECT 1 FROM pw_placements WHERE canvas_id = ? AND x = ? AND y = ? AND id > ? LIMIT 1').get(c.id, r.x, r.y, r.id);
        if (later || pixels[idx] !== r.color) continue;
        pixels[idx] = r.prev_color;
        const ins = q.insertPlacement.run(c.id, req.user.id, r.x, r.y, r.prev_color, r.color, 'restore', now);
        events.push({ t: 'px', canvas: c.id, seq: Number(ins.lastInsertRowid), x: r.x, y: r.y, c: r.prev_color, at: now });
      }
      q.savePixels.run(pixels, 0, 0, c.id);
      db.exec('COMMIT');
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return res.status(500).json({ error: '復元に失敗しました' });
    }
    events.forEach(broadcast);
    log(req, `@${u.username} の配置を ${events.length} マス元に戻した (${new Date(since).toISOString()} 以降)`);
    res.json({ ok: true, restored: events.length });
  });
  // 作品を完成させる: 今のキャンバスをアーカイブし、コメント用の投稿を作り、新しいキャンバスを始める
  app.post('/api/pw/admin/archive', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 60);
    const nextTitle = String(req.body?.nextTitle || '').trim().slice(0, 60);
    const nextTheme = String(req.body?.nextTheme || '').trim().slice(0, 60);
    if (!title || !nextTitle) return res.status(400).json({ error: '作品名と次のキャンバスの名前を入力してください' });
    const now = Date.now();
    let archivedId;
    db.exec('BEGIN IMMEDIATE');
    try {
      const c = q.active.get();
      const fmt = (t) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '/');
      const content = `🎨 PIXEL WORLD「${title}」が完成しました！\n${fmt(c.started_at)}〜${fmt(now)} · 参加 ${c.participants}人 · 配置 ${c.placements}回\n作品への感想はこの投稿にコメントしてください #PIXELWORLD`;
      const post = db.prepare('INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)').run(req.user.id, content, now);
      db.prepare("UPDATE pw_canvases SET status = 'archived', title = ?, ended_at = ?, post_id = ? WHERE id = ?").run(title, now, post.lastInsertRowid, c.id);
      db.prepare("INSERT INTO pw_canvases (title, theme, width, height, pixels, status, started_at) VALUES (?, ?, ?, ?, ?, 'active', ?)")
        .run(nextTitle, nextTheme, W, H, Buffer.alloc(W * H, 0), now);
      db.exec('COMMIT');
      archivedId = c.id;
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return res.status(500).json({ error: 'アーカイブに失敗しました' });
    }
    ctx.invalidateTrends?.();
    log(req, `作品「${title}」をアーカイブし、「${nextTitle}」を開始`);
    broadcast({ t: 'reload' });
    res.json({ ok: true, archiveId: archivedId });
  });
  // アーカイブの公開 / 非公開
  app.patch('/api/pw/admin/archives/:id', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const c = q.canvas.get(Number(req.params.id));
    if (!c || c.status !== 'archived') return res.status(404).json({ error: '作品が見つかりません' });
    db.prepare('UPDATE pw_canvases SET published = ? WHERE id = ?').run(req.body?.published ? 1 : 0, c.id);
    log(req, `作品 #${c.id} を${req.body?.published ? '公開' : '非公開'}に`);
    res.json({ archive: canvasOut(q.canvas.get(c.id)) });
  });
  // テーマ投票を作る (開いている投票は 1 つだけ。新しく作ると前の投票は締め切る)
  app.post('/api/pw/admin/polls', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 80);
    const options = [...new Set((Array.isArray(req.body?.options) ? req.body.options : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))].slice(0, 8);
    if (!question || options.length < 2) return res.status(400).json({ error: '質問と 2 つ以上の選択肢を入力してください' });
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE pw_polls SET status = 'closed', closed_at = ? WHERE status = 'open'").run(now);
      const p = db.prepare('INSERT INTO pw_polls (question, created_at) VALUES (?, ?)').run(question, now);
      options.forEach((label, i) => db.prepare('INSERT INTO pw_poll_options (poll_id, label, position) VALUES (?, ?, ?)').run(p.lastInsertRowid, label, i));
      db.exec('COMMIT');
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      return res.status(500).json({ error: '投票を作成できませんでした' });
    }
    log(req, `テーマ投票を作成: ${question}`);
    broadcast({ t: 'poll' });
    res.json({ ok: true });
  });
  app.post('/api/pw/admin/polls/:id/close', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const r = db.prepare("UPDATE pw_polls SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'").run(Date.now(), Number(req.params.id));
    broadcast({ t: 'poll' });
    res.json({ ok: r.changes > 0 });
  });
};
