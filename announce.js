// =====================================================================
// 運営からのお知らせ
// ・管理者だけが書ける (作成・編集・削除)。表示上の発信者は「IppO 運営」
// ・重要度 (通常 / 重要) と、ホームの上部に固定するかどうかを選べる
// ・既読の位置はユーザーごとにサーバーへ保存 (端末をまたいで共有)
// ・新しいお知らせは、開いている人にリアルタイムで知らせる
// =====================================================================
const MIGRATION = `
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'important')),
  pinned INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 記録用 (画面には出さない)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX announcements_created ON announcements(created_at);
CREATE TABLE announcement_seen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_id INTEGER NOT NULL DEFAULT 0
);
`;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, isAdmin } = ctx;
  db.migrate('2026-11-18-announcements', MIGRATION);

  const out = (a) => ({ id: a.id, title: a.title, body: a.body, level: a.level, pinned: !!a.pinned, createdAt: a.created_at, updatedAt: a.updated_at, edited: a.updated_at > a.created_at + 1000 });
  const lastSeen = (user) => (user ? db.prepare('SELECT last_seen_id FROM announcement_seen WHERE user_id = ?').get(user.id)?.last_seen_id || 0 : 0);
  const readLimit = rateLimit({ windowMs: 60_000, max: 120 });

  // 一覧 (誰でも読める)
  app.get('/api/announcements', readLimit, (req, res) => {
    const rows = db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, id DESC LIMIT 50').all();
    res.json({ announcements: rows.map(out), lastSeenId: lastSeen(req.user), canManage: isAdmin(req.user) });
  });
  app.get('/api/announcements/:id(\\d+)', readLimit, (req, res) => {
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'お知らせが見つかりません' });
    res.json({ announcement: out(a), canManage: isAdmin(req.user) });
  });
  // 未読の数と、ホームに出すバナー (固定されたもの / 未読の重要なもの)
  app.get('/api/announcements/summary', readLimit, (req, res) => {
    const seen = lastSeen(req.user);
    const unread = req.user ? db.prepare('SELECT COUNT(*) AS n FROM announcements WHERE id > ?').get(seen).n : 0;
    const banner = db.prepare(`SELECT * FROM announcements WHERE pinned = 1 OR (level = 'important' AND id > ?) ORDER BY pinned DESC, id DESC LIMIT 1`).get(req.user ? seen : 0);
    res.json({ unread, banner: banner ? out(banner) : null, lastSeenId: seen });
  });
  // 既読にする (指定した番号まで)
  app.post('/api/announcements/seen', requireAuth, (req, res) => {
    const max = db.prepare('SELECT MAX(id) AS m FROM announcements').get().m || 0;
    const upTo = Math.min(Number(req.body?.upTo) || max, max);
    db.prepare(`INSERT INTO announcement_seen (user_id, last_seen_id) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET last_seen_id = MAX(last_seen_id, excluded.last_seen_id)`).run(req.user.id, upTo);
    res.json({ lastSeenId: lastSeen(req.user) });
  });

  // ---------- 管理者 ----------
  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: '管理者だけが使える機能です' }));
  const writeLimit = rateLimit({ windowMs: 60_000, max: 30, key: (req) => 'an' + req.user.id });
  function validate(body) {
    const title = String(body?.title || '').trim(), text = String(body?.body || '').trim();
    const level = body?.level === 'important' ? 'important' : 'info';
    if (!title || [...title].length > 60) return { error: 'タイトルは 1〜60 文字で入力してください' };
    if (!text || [...text].length > 2000) return { error: '本文は 1〜2000 文字で入力してください' };
    return { title, text, level, pinned: body?.pinned ? 1 : 0 };
  }
  app.post('/api/admin/announcements', requireAuth, requireAdmin, writeLimit, (req, res) => {
    const v = validate(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const now = Date.now();
    const r = db.prepare('INSERT INTO announcements (title, body, level, pinned, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.title, v.text, v.level, v.pinned, req.user.id, now, now);
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(r.lastInsertRowid);
    console.log(`[admin] ${req.user.username} がお知らせ #${a.id}「${a.title}」を公開`);
    ctx.rt?.broadcast({ t: 'announce', id: a.id, title: a.title, level: a.level });
    res.json({ announcement: out(a) });
  });
  app.patch('/api/admin/announcements/:id', requireAuth, requireAdmin, writeLimit, (req, res) => {
    const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'お知らせが見つかりません' });
    const v = validate(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    db.prepare('UPDATE announcements SET title = ?, body = ?, level = ?, pinned = ?, updated_at = ? WHERE id = ?').run(v.title, v.text, v.level, v.pinned, Date.now(), a.id);
    console.log(`[admin] ${req.user.username} がお知らせ #${a.id} を編集`);
    ctx.rt?.broadcast({ t: 'announce-update', id: a.id });
    res.json({ announcement: out(db.prepare('SELECT * FROM announcements WHERE id = ?').get(a.id)) });
  });
  app.delete('/api/admin/announcements/:id', requireAuth, requireAdmin, writeLimit, (req, res) => {
    const r = db.prepare('DELETE FROM announcements WHERE id = ?').run(Number(req.params.id));
    if (r.changes) { console.log(`[admin] ${req.user.username} がお知らせ #${req.params.id} を削除`); ctx.rt?.broadcast({ t: 'announce-update', id: Number(req.params.id) }); }
    res.json({ ok: r.changes > 0 });
  });
};
