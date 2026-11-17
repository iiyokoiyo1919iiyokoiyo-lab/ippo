// =====================================================================
// 認証マーク (管理者がユーザーに付ける「本人確認済み」の印)
// ・権限は何も増えない。表示だけの安心材料
// ・メモ (例: 生徒会・先生) を付けられる
// ・なりすまし対策: 認証した時の表示名から変えると、管理者が確認し直すまでマークを外す
// =====================================================================
const MIGRATION = `
CREATE TABLE user_verifications (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',           -- 例: 生徒会 / 先生 (空でもよい)
  verified_name TEXT NOT NULL,              -- 認証した時の表示名
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at INTEGER NOT NULL
);
`;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, isAdmin } = ctx;
  db.migrate('2026-11-18-verifications', MIGRATION);

  const qV = db.prepare('SELECT label, verified_name, verified_at FROM user_verifications WHERE user_id = ?');
  // 公開するユーザー情報に付ける。表示名が変わっていたら付けない
  ctx.verifiedOf = (u) => {
    const v = qV.get(u.id);
    if (!v || v.verified_name !== u.display_name) return null;
    return { label: v.label, at: v.verified_at };
  };
  // 管理者画面用: 状態 (verified / pending=表示名が変わって保留中 / none)
  ctx.verificationStatus = (u) => {
    const v = qV.get(u.id);
    if (!v) return { status: 'none' };
    return { status: v.verified_name === u.display_name ? 'verified' : 'pending', label: v.label, verifiedName: v.verified_name };
  };

  const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: '管理者だけが使える機能です' }));
  const limit = rateLimit({ windowMs: 60_000, max: 60, key: (req) => 'vf' + req.user.id });
  const findUser = (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
    if (!u) res.status(404).json({ error: 'ユーザーが見つかりません' });
    return u;
  };

  // 認証マークを付ける (付け直すと、今の表示名で確認し直したことになる)
  app.put('/api/admin/users/:username/verify', requireAuth, requireAdmin, limit, (req, res) => {
    const u = findUser(req, res); if (!u) return;
    const label = String(req.body?.label || '').trim().slice(0, 20);
    db.prepare(`INSERT INTO user_verifications (user_id, label, verified_name, verified_by, verified_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET label = excluded.label, verified_name = excluded.verified_name, verified_by = excluded.verified_by, verified_at = excluded.verified_at`)
      .run(u.id, label, u.display_name, req.user.id, Date.now());
    console.log(`[admin] ${req.user.username} が @${u.username} に認証マークを付与${label ? ` (${label})` : ''}`);
    res.json({ ok: true, ...ctx.verificationStatus(u) });
  });
  // 認証マークを外す
  app.delete('/api/admin/users/:username/verify', requireAuth, requireAdmin, limit, (req, res) => {
    const u = findUser(req, res); if (!u) return;
    const r = db.prepare('DELETE FROM user_verifications WHERE user_id = ?').run(u.id);
    if (r.changes) console.log(`[admin] ${req.user.username} が @${u.username} の認証マークを解除`);
    res.json({ ok: r.changes > 0 });
  });
};
