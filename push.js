// =====================================================================
// Web プッシュ通知 (アプリを閉じていても・バックグラウンドでも届く通知)。いまは通話の着信だけに使う
//   ・ブラウザのサービスワーカー (public/sw.js) が受け取って通知を出す。押すと IppO が開いて、着信の画面になる
//   ・鍵 (VAPID) は環境変数 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY。なければ初回に作って表 push_vapid に保存する
//   ・iPhone は「ホーム画面に追加」した IppO だけが通知を受け取れる (iOS 16.4 以降)
// =====================================================================
const webpush = require('web-push');

const MIGRATION = `
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
CREATE TABLE IF NOT EXISTS push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);
`;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-22-push', MIGRATION);
  let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { public_key: process.env.VAPID_PUBLIC_KEY, private_key: process.env.VAPID_PRIVATE_KEY } : db.prepare('SELECT * FROM push_vapid WHERE id = 1').get();
  if (!keys) { const k = webpush.generateVAPIDKeys(); db.prepare('INSERT INTO push_vapid (id, public_key, private_key) VALUES (1, ?, ?)').run(k.publicKey, k.privateKey); keys = { public_key: k.publicKey, private_key: k.privateKey }; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@ippo.invalid', keys.public_key, keys.private_key);

  const qSubs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?');
  const qDel = db.prepare('DELETE FROM push_subs WHERE endpoint = ?');
  const limit = rateLimit({ windowMs: 60_000, max: 20, key: (req) => 'ps' + req.user.id });

  app.get('/api/push/key', requireAuth, (req, res) => res.json({ key: keys.public_key }));
  app.post('/api/push/subscribe', requireAuth, limit, (req, res) => {
    const s = req.body?.sub || {}, endpoint = String(s.endpoint || ''), p256dh = String(s.keys?.p256dh || ''), auth = String(s.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) return res.status(400).json({ error: '通知の設定が正しくありません' });
    if (qSubs.all(req.user.id).length >= 10 && !db.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').get(endpoint)) db.prepare('DELETE FROM push_subs WHERE id = (SELECT id FROM push_subs WHERE user_id = ? ORDER BY created_at LIMIT 1)').run(req.user.id); // 1 人 10 台まで (古いものから消す)
    db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(req.user.id, endpoint, p256dh, auth, Date.now());
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', requireAuth, limit, (req, res) => {
    db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  // ある人の全部の端末に通知を送る。届いた端末の数を返す (届かなくなった登録は消す)
  ctx.push = {
    has: (userId) => qSubs.all(userId).length > 0,
    async send(userId, payload, { ttl = 60, urgency = 'high' } = {}) {
      let n = 0;
      await Promise.all(qSubs.all(userId).map(async (s) => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: ttl, urgency }); n++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) qDel.run(s.endpoint); else console.error('[push]', e.statusCode || '', String(e.message).slice(0, 120)); }
      }));
      return n;
    },
  };
};
