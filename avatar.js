// =====================================================================
// プロフィールのアイコン (写真 / 絵文字)
//
// ・写真: 端末で 256×256 の JPEG に切り抜いて送る。サーバーでも JPEG かどうか・大きさを確かめ、
//   撮影場所 (GPS) などのメタデータ (EXIF など) を取り除いてから保存する
// ・絵文字: 決まった絵文字と背景色の組み合わせ
// ・管理者は不適切なアイコンを削除できる
// =====================================================================
const express = require('express');

const MIGRATION = `
CREATE TABLE user_avatars (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'emoji')),
  image BLOB,                 -- kind = 'image' の時: メタデータを除いた JPEG
  emoji TEXT,                 -- kind = 'emoji' の時
  color TEXT,
  updated_at INTEGER NOT NULL
);
`;

// 選べる絵文字と背景色 (自由入力にしない)
const EMOJIS = ['😀', '😎', '🥳', '😺', '🐶', '🐻', '🐼', '🐰', '🦊', '🐸', '🐧', '🦄', '🐙', '🦖', '🌸', '🌻', '🍀', '🌈', '⭐', '🌙', '🔥', '⚡', '🎵', '🎨', '📚', '⚽', '🏀', '🎾', '🎮', '📷', '🍙', '🍓', '🍩', '☕', '🚀', '✈️', '🌊', '🗻', '🏫', '💡'];
const COLORS = ['#4b55f0', '#1f2766', '#6a4fd6', '#2f7fd1', '#1495a0', '#16946c', '#7cb342', '#f2b347', '#c9622f', '#c9466b', '#e0446a', '#8a8f9e'];

// JPEG からメタデータ (APP1〜APP15・コメント) を取り除き、画像の大きさを返す
function cleanJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('JPEG ではありません');
  const out = [buf.subarray(0, 2)];
  let i = 2, width = 0, height = 0, sos = false;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) throw new Error('壊れた JPEG です');
    const marker = buf[i + 1];
    if (marker === 0xFF) { i++; continue; }                         // 詰め物
    if (marker === 0xDA) { out.push(buf.subarray(i)); sos = true; break; } // 画像データ本体 (ここから最後まで)
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { out.push(buf.subarray(i, i + 2)); i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new Error('壊れた JPEG です');
    const seg = buf.subarray(i, i + 2 + len);
    const isMeta = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) { height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); }
    if (!isMeta) out.push(seg);
    i += 2 + len;
  }
  if (!sos || buf[buf.length - 2] !== 0xFF || buf[buf.length - 1] !== 0xD9) throw new Error('壊れた JPEG です');
  return { jpeg: Buffer.concat(out), width, height };
}

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, isAdmin } = ctx;
  db.migrate('2026-11-18-avatars', MIGRATION);

  const qAvatar = db.prepare('SELECT kind, emoji, color, updated_at FROM user_avatars WHERE user_id = ?');
  // 公開するユーザー情報に付けるアイコン情報 (画像そのものは別の URL から)
  ctx.avatarOf = (userId) => {
    const a = qAvatar.get(userId);
    if (!a) return null;
    return a.kind === 'image' ? { kind: 'image', v: a.updated_at } : { kind: 'emoji', emoji: a.emoji, color: a.color, v: a.updated_at };
  };

  // 画像の配信 (?v= で更新時刻を付けるので長くキャッシュしてよい)
  app.get('/api/avatars/:id', (req, res) => {
    const r = db.prepare("SELECT image FROM user_avatars WHERE user_id = ? AND kind = 'image'").get(Number(req.params.id));
    if (!r) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(r.image));
  });

  app.get('/api/avatar-options', (req, res) => res.json({ emojis: EMOJIS, colors: COLORS }));

  const avatarLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, key: (req) => 'av' + req.user.id });
  const save = (userId, kind, image, emoji, color) => db.prepare(`INSERT INTO user_avatars (user_id, kind, image, emoji, color, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET kind = excluded.kind, image = excluded.image, emoji = excluded.emoji, color = excluded.color, updated_at = excluded.updated_at`)
    .run(userId, kind, image, emoji, color, Date.now());

  // 写真 (端末で 256×256 の JPEG にしたもの)
  app.put('/api/me/avatar/image', requireAuth, avatarLimit, express.raw({ type: 'image/jpeg', limit: '300kb' }), (req, res) => {
    let cleaned;
    try { cleaned = cleanJpeg(req.body); } catch (e) { return res.status(400).json({ error: '画像を読み込めませんでした。別の写真を選んでください' }); }
    if (cleaned.width < 64 || cleaned.height < 64 || cleaned.width > 1024 || cleaned.height > 1024) {
      return res.status(400).json({ error: '画像の大きさが正しくありません' });
    }
    save(req.user.id, 'image', cleaned.jpeg, null, null);
    res.json({ avatar: ctx.avatarOf(req.user.id) });
  });
  // 絵文字 + 背景色
  app.put('/api/me/avatar/emoji', requireAuth, avatarLimit, (req, res) => {
    const { emoji, color } = req.body || {};
    if (!EMOJIS.includes(emoji) || !COLORS.includes(color)) return res.status(400).json({ error: '絵文字か色が正しくありません' });
    save(req.user.id, 'emoji', null, emoji, color);
    res.json({ avatar: ctx.avatarOf(req.user.id) });
  });
  // 元に戻す (頭文字のアイコン)
  app.delete('/api/me/avatar', requireAuth, (req, res) => {
    db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(req.user.id);
    res.json({ avatar: null });
  });
  // 管理者: 不適切なアイコンを削除
  app.delete('/api/admin/users/:username/avatar', requireAuth, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけが使える機能です' });
    const u = db.prepare('SELECT id, username FROM users WHERE username = ?').get(req.params.username);
    if (!u) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    const r = db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(u.id);
    console.log(`[admin] ${req.user.username} が @${u.username} のアイコンを削除`);
    res.json({ ok: r.changes > 0 });
  });
};

module.exports.cleanJpeg = cleanJpeg;
