// =====================================================================
// 投稿の動画 (1 投稿 1 本・写真とはどちらか一方)
//
// ・MP4 / MOV (iPhone) / WebM。50MB・3 分まで (MP4 / MOV は中の長さもサーバーで確かめる)
// ・撮影場所 (GPS) などのメタデータは消す: MP4 / MOV の udta・meta・uuid (XMP) の箱を、大きさを変えずに
//   中身を 0 にして種類を free (空き) に書きかえる (中の位置がずれないので再エンコード不要)
// ・ファイルはデータベースの隣の videos/ に保存 (Railway のボリューム)。配信は Range 対応 (iPhone で再生できるように)
// ・投稿に使われなかった動画は 1 時間後に自動で削除。投稿を消すと動画も消える (10 分ごとの掃除)
// =====================================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 50 * 1024 * 1024, MAX_SEC = 180;
const PENDING_MS = 60 * 60 * 1000;
const DIR = process.env.VIDEO_DIR || path.join(path.dirname(path.resolve(process.env.DB_PATH || path.join(__dirname, 'ippo.db'))), 'videos');
const MIGRATION = `
CREATE TABLE post_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,   -- 投稿前は NULL
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file TEXT NOT NULL,                                      -- videos/ の中のファイル名
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX post_videos_post ON post_videos(post_id);
CREATE INDEX post_videos_pending ON post_videos(user_id, post_id, created_at);
`;

// ---------- MP4 / MOV の箱 (box / atom) ----------
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
const STRIP = new Set(['udta', 'meta', 'uuid', 'XMP_', 'Xtra']);
function walk(buf, start, end, fn, depth = 0) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p), head = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { if (p + 16 > end) throw new Error('bad'); size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    else if (size === 0) size = end - p;
    if (size < head || p + size > end) throw new Error('bad box');
    fn(type, p, size, head, depth);
    if (CONTAINERS.has(type) && depth < 8) walk(buf, p + head, p + size, fn, depth + 1);
    p += size;
  }
  if (p !== end) throw new Error('trailing');
}
// メタデータを消して、長さ・縦横を読む。MP4 / MOV でなければ例外
function cleanMp4(buf) {
  if (buf.length < 16 || buf.toString('latin1', 4, 8) !== 'ftyp') throw new Error('not mp4');
  let duration = 0, width = 0, height = 0, hasMoov = false, hasVideo = false;
  walk(buf, 0, buf.length, (type, p, size, head, depth) => {
    if (type === 'moov') hasMoov = true;
    if (STRIP.has(type)) {
      buf.fill(0, p + head, p + size); buf.write('free', p + 4, 'latin1'); // 中身を消して「空き」に
      return;
    }
    if (type === 'mvhd') {
      const v = buf[p + head];
      const scale = v === 1 ? buf.readUInt32BE(p + head + 20) : buf.readUInt32BE(p + head + 12);
      const dur = v === 1 ? Number(buf.readBigUInt64BE(p + head + 24)) : buf.readUInt32BE(p + head + 16);
      if (scale > 0) duration = dur / scale;
    }
    if (type === 'tkhd') {
      const v = buf[p + head], off = p + head + (v === 1 ? 88 : 76); // 幅・高さ (16.16 の固定小数点) は tkhd の最後
      if (off + 8 <= p + size) { const w = buf.readUInt32BE(off) >>> 16, h = buf.readUInt32BE(off + 4) >>> 16; if (w && h) { hasVideo = true; width = Math.max(width, w); height = Math.max(height, h); } }
    }
  });
  if (!hasMoov) throw new Error('no moov');
  return { duration, width, height, hasVideo };
}
const isWebm = (buf) => buf.length > 4 && buf.readUInt32BE(0) === 0x1A45DFA3;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-24-post-videos', MIGRATION);
  fs.mkdirSync(DIR, { recursive: true });

  const qVideos = db.prepare('SELECT id, width, height, duration FROM post_videos WHERE post_id = ? ORDER BY id');
  ctx.videosOf = (postId) => qVideos.all(postId).map((r) => ({ id: r.id, w: r.width, h: r.height, dur: Math.round(r.duration) }));

  // 投稿に付ける前の確認: 自分がアップロードした、まだ使っていない動画か (1 本まで)
  ctx.checkVideos = (user, ids) => {
    if (ids == null) return { ids: [] };
    if (!Array.isArray(ids) || ids.length > 1 || !ids.every(Number.isInteger)) return { error: '動画は 1 つの投稿に 1 本までです' };
    for (const id of ids) {
      const r = db.prepare('SELECT user_id, post_id, created_at FROM post_videos WHERE id = ?').get(id);
      if (!r || r.user_id !== user.id || r.post_id !== null || Date.now() - r.created_at > PENDING_MS) return { error: '動画をもう一度選び直してください' };
    }
    return { ids };
  };
  ctx.attachVideos = (postId, user, ids) => {
    ids.forEach((id) => db.prepare('UPDATE post_videos SET post_id = ? WHERE id = ? AND user_id = ? AND post_id IS NULL').run(postId, id, user.id));
  };

  // アップロード (投稿前)。1 回 1 本
  const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => 'vid' + req.user.id });
  const raw = express.raw({ type: ['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'], limit: MAX_BYTES });
  app.post('/api/uploads/video', requireAuth, uploadLimit, raw, (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 64) return res.status(400).json({ error: '動画を読み込めませんでした' });
    let info = { duration: Number(req.query.dur) || 0, width: Number(req.query.w) || 0, height: Number(req.query.h) || 0 }, mime;
    try {
      if (isWebm(buf)) mime = 'video/webm';
      else { const m = cleanMp4(buf); if (!m.hasVideo) throw new Error('no video'); info = m; mime = req.headers['content-type'] === 'video/quicktime' ? 'video/quicktime' : 'video/mp4'; }
    } catch { return res.status(400).json({ error: 'この動画は使えません (MP4・MOV・WebM の動画を選んでください)' }); }
    if (!(info.duration > 0) || info.duration > MAX_SEC + 1) return res.status(400).json({ error: `動画は ${MAX_SEC / 60} 分までです` });
    const w = Math.max(0, Math.min(8192, Math.round(info.width))), h = Math.max(0, Math.min(8192, Math.round(info.height)));
    const pending = db.prepare('SELECT COUNT(*) AS n FROM post_videos WHERE user_id = ? AND post_id IS NULL AND created_at > ?').get(req.user.id, Date.now() - PENDING_MS).n;
    if (pending >= 3) return res.status(429).json({ error: '投稿していない動画が多すぎます。しばらくしてからお試しください' });
    const file = `${Date.now().toString(36)}-${require('crypto').randomBytes(8).toString('hex')}.${mime === 'video/webm' ? 'webm' : 'mp4'}`;
    try { fs.writeFileSync(path.join(DIR, file), buf); } catch { return res.status(500).json({ error: '動画を保存できませんでした' }); }
    const r = db.prepare('INSERT INTO post_videos (user_id, file, mime, size, width, height, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, file, mime, buf.length, w, h, info.duration, Date.now());
    res.json({ video: { id: Number(r.lastInsertRowid), w, h, dur: Math.round(info.duration) } });
  });
  // 投稿前に取り消し
  app.delete('/api/uploads/video/:id', requireAuth, (req, res) => {
    const r = db.prepare('SELECT file FROM post_videos WHERE id = ? AND user_id = ? AND post_id IS NULL').get(Number(req.params.id), req.user.id);
    if (!r) return res.json({ ok: false });
    db.prepare('DELETE FROM post_videos WHERE id = ?').run(Number(req.params.id));
    fs.unlink(path.join(DIR, r.file), () => {});
    res.json({ ok: true });
  });

  // 配信 (Range 対応)。投稿済みは誰でも、投稿前はアップロードした本人だけ
  app.get('/api/videos/:id', (req, res) => {
    const r = db.prepare('SELECT post_id, user_id, file, mime FROM post_videos WHERE id = ?').get(Number(req.params.id));
    if (!r || (r.post_id === null && r.user_id !== req.user?.id) || !/^[a-z0-9-]+\.(mp4|webm)$/.test(r.file)) return res.status(404).end();
    res.sendFile(path.join(DIR, r.file), {
      headers: { 'Content-Type': r.mime === 'video/quicktime' ? 'video/mp4' : r.mime, 'Cache-Control': r.post_id === null ? 'private, no-store' : 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' },
      acceptRanges: true, lastModified: false, etag: true,
    }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // 掃除 (10 分ごと): 投稿に使われなかった動画・消えた投稿の動画のファイル
  const sweep = () => {
    try {
      db.prepare('DELETE FROM post_videos WHERE post_id IS NULL AND created_at < ?').run(Date.now() - PENDING_MS);
      const keep = new Set(db.prepare('SELECT file FROM post_videos').all().map((r) => r.file));
      for (const f of fs.readdirSync(DIR)) {
        if (keep.has(f) || !/^[a-z0-9-]+\.(mp4|webm)$/.test(f)) continue;
        const st = fs.statSync(path.join(DIR, f));
        if (Date.now() - st.mtimeMs > 10 * 60 * 1000) fs.unlinkSync(path.join(DIR, f)); // 保存した直後 (まだ表に入る前) は残す
      }
    } catch {}
  };
  setInterval(sweep, 10 * 60 * 1000).unref();
};
module.exports.cleanMp4 = cleanMp4;
