// =====================================================================
// 投稿の写真 (1 投稿 4 枚まで)
//
// ・端末で長辺 1280px の JPEG に縮めてから送る (1 枚ずつ。投稿前に先にアップロード)
// ・サーバーでも JPEG かどうか・大きさを確かめ、撮影場所 (GPS) などのメタデータを取り除いて保存
// ・投稿に使われなかった写真は 1 時間後に自動で削除。投稿を消すと写真も消える
// =====================================================================
const express = require('express');
const { cleanJpeg } = require('./avatar');

const MAX_PER_POST = 4;
const PENDING_MS = 60 * 60 * 1000;
const MIGRATION = `
CREATE TABLE post_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,   -- 投稿前は NULL
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  image BLOB NOT NULL,                                     -- メタデータを除いた JPEG
  created_at INTEGER NOT NULL
);
CREATE INDEX post_images_post ON post_images(post_id, position);
CREATE INDEX post_images_pending ON post_images(user_id, post_id, created_at);
`;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-18-post-images', MIGRATION);

  const qImages = db.prepare('SELECT id, width, height FROM post_images WHERE post_id = ? ORDER BY position');
  ctx.imagesOf = (postId) => qImages.all(postId).map((r) => ({ id: r.id, w: r.width, h: r.height }));

  // 投稿に付ける前の確認: 自分がアップロードした、まだ使っていない写真か
  ctx.checkImages = (user, ids) => {
    if (ids == null) return { ids: [] };
    if (!Array.isArray(ids) || ids.length > MAX_PER_POST || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) {
      return { error: `写真は ${MAX_PER_POST} 枚までです` };
    }
    for (const id of ids) {
      const r = db.prepare('SELECT user_id, post_id, created_at FROM post_images WHERE id = ?').get(id);
      if (!r || r.user_id !== user.id || r.post_id !== null || Date.now() - r.created_at > PENDING_MS) {
        return { error: '写真をもう一度選び直してください' };
      }
    }
    return { ids };
  };
  ctx.attachImages = (postId, user, ids) => {
    ids.forEach((id, i) => db.prepare('UPDATE post_images SET post_id = ?, position = ? WHERE id = ? AND user_id = ? AND post_id IS NULL').run(postId, i, id, user.id));
  };

  // アップロード (投稿前)。1 回 1 枚
  const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: (req) => 'img' + req.user.id });
  app.post('/api/uploads', requireAuth, uploadLimit, express.raw({ type: 'image/jpeg', limit: '1500kb' }), (req, res) => {
    let c;
    try { c = cleanJpeg(req.body); } catch { return res.status(400).json({ error: '画像を読み込めませんでした。別の写真を選んでください' }); }
    if (c.width < 16 || c.height < 16 || c.width > 2048 || c.height > 2048) return res.status(400).json({ error: '画像の大きさが正しくありません' });
    // 投稿前の写真がたまりすぎないように (1 人 12 枚まで)
    const pending = db.prepare('SELECT COUNT(*) AS n FROM post_images WHERE user_id = ? AND post_id IS NULL AND created_at > ?').get(req.user.id, Date.now() - PENDING_MS).n;
    if (pending >= 12) return res.status(429).json({ error: '投稿していない写真が多すぎます。しばらくしてからお試しください' });
    const r = db.prepare('INSERT INTO post_images (user_id, width, height, image, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, c.width, c.height, c.jpeg, Date.now());
    res.json({ image: { id: Number(r.lastInsertRowid), w: c.width, h: c.height } });
  });
  // 投稿前に取り消し
  app.delete('/api/uploads/:id', requireAuth, (req, res) => {
    const r = db.prepare('DELETE FROM post_images WHERE id = ? AND user_id = ? AND post_id IS NULL').run(Number(req.params.id), req.user.id);
    res.json({ ok: r.changes > 0 });
  });

  // 写真の配信。投稿済みのものは誰でも、投稿前のものはアップロードした本人だけ
  app.get('/api/images/:id', (req, res) => {
    const r = db.prepare('SELECT post_id, user_id, image FROM post_images WHERE id = ?').get(Number(req.params.id));
    if (!r || (r.post_id === null && r.user_id !== req.user?.id)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', r.post_id === null ? 'private, no-store' : 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(r.image));
  });

  // 投稿に使われなかった写真を掃除 (10 分ごと)
  setInterval(() => {
    try { db.prepare('DELETE FROM post_images WHERE post_id IS NULL AND created_at < ?').run(Date.now() - PENDING_MS); } catch {}
  }, 10 * 60 * 1000).unref();
};
