// 追加機能: コミュニティ / トレンド / 今日の質問 / 緊急データ削除 / 動画の読み込み
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');

// ---------- 今日の質問 ----------
const QUESTIONS = [
  '最近ハマっていることは？',
  '子どもの頃の夢は何でしたか？',
  '無人島に1つだけ持っていくなら？',
  '今いちばん行きたい場所は？',
  '人生で一番おいしかった食べ物は？',
  '最近ちょっと嬉しかったことは？',
  '朝型？夜型？',
  'おすすめの本・漫画を1つ教えて',
  '1日だけ誰かになれるなら誰になる？',
  '今年中にやりたいことは？',
  '好きな季節とその理由は？',
  '最近買ってよかったものは？',
  'ストレス解消法は？',
  'もし宝くじが当たったら最初に何をする？',
  '何度でも見返したくなる映画・アニメは？',
  '自分の小さなこだわりを教えて',
  '最近覚えた豆知識は？',
  '理想の休日の過ごし方は？',
  'タイムマシンがあったら過去と未来どっちに行く？',
  'よく聴いている曲は？',
  '得意料理は？',
  'これだけは譲れない好きな食べ物は？',
  '今の自分に一言アドバイスするなら？',
  '最近はじめて挑戦したことは？',
  '一番好きなアプリは？',
  '超能力を1つもらえるなら？',
  '最近笑ったことは？',
  '住んでみたい街は？',
  '朝ごはんはパン派？ごはん派？',
  '今日の小さな目標は？',
];

// 日本時間の日付 (YYYY-MM-DD)
function todayJst(now = Date.now()) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}
function questionFor(day) {
  const n = Math.floor(Date.parse(day + 'T00:00:00Z') / 86400_000);
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

// ---------- トレンド (ハッシュタグ) ----------
const TAG_RE = /(^|\s)#([^\s#]{1,50})/gu;
function extractTags(text) {
  const tags = new Set();
  for (const m of String(text).matchAll(TAG_RE)) tags.add(m[2].replace(/[、。！!？?,.)」』]+$/u, '').toLowerCase());
  tags.delete('');
  return tags;
}

module.exports = function install(app, ctx) {
  const { db, hydrate, hydrateAll, requireAuth, rateLimit, publicUser, beforeId, hashPw, vb } = ctx;

  // ======================= 今日の質問 =======================
  app.get('/api/question', (req, res) => {
    const day = todayJst();
    const answers = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE question_day = ?').get(day).n;
    const answered = req.user ? !!db.prepare('SELECT 1 FROM posts WHERE question_day = ? AND user_id = ?').get(day, req.user.id) : false;
    res.json({ day, text: questionFor(day), answers, answered });
  });

  app.get('/api/question/answers', (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : todayJst();
    const rows = db.prepare('SELECT * FROM posts WHERE question_day = ? AND id < ? ORDER BY id DESC LIMIT 30').all(day, beforeId(req));
    res.json({ day, text: questionFor(day), posts: hydrateAll(rows, req.user) });
  });

  // ======================= トレンド =======================
  let trendCache = { at: 0, data: null };
  ctx.invalidateTrends = () => { trendCache = { at: 0, data: null }; }; // ハッシュタグ付きの投稿があったら集計し直す
  app.get('/api/trends', (req, res) => {
    if (trendCache.data && Date.now() - trendCache.at < 60_000) return res.json(trendCache.data);
    const compute = (sinceMs) => {
      const rows = db.prepare(`SELECT user_id, content FROM posts WHERE created_at > ? AND repost_of IS NULL AND content LIKE '%#%'
        ORDER BY id DESC LIMIT 5000`).all(Date.now() - sinceMs);
      const counts = new Map(); // タグ → { posts, users }
      for (const r of rows) {
        for (const t of extractTags(r.content)) {
          const c = counts.get(t) || { posts: 0, users: new Set() };
          c.posts++; c.users.add(r.user_id);
          counts.set(t, c);
        }
      }
      // 同じ人の連投で上位にならないよう、使った人数を重視する
      return [...counts.entries()]
        .map(([tag, c]) => ({ tag, posts: c.posts, users: c.users.size, score: c.users.size * 3 + c.posts }))
        .sort((a, b) => b.score - a.score).slice(0, 10)
        .map(({ tag, posts, users }) => ({ tag, posts, users }));
    };
    let trends = compute(24 * 3600_000), period = '24時間';
    if (trends.length < 3) { trends = compute(7 * 24 * 3600_000); period = '7日間'; }
    trendCache = { at: Date.now(), data: { period, trends } };
    res.json(trendCache.data);
  });

  // ======================= コミュニティ =======================
  const qCommunityBySlug = db.prepare('SELECT * FROM communities WHERE slug = ?');
  const qIsMember = db.prepare('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?');
  const qMembers = db.prepare('SELECT COUNT(*) AS n FROM community_members WHERE community_id = ?');
  const communityOut = (c, me) => ({
    slug: c.slug, name: c.name, description: c.description, createdAt: c.created_at,
    owner: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(c.owner_id)),
    members: qMembers.get(c.id).n,
    joined: me ? !!qIsMember.get(c.id, me.id) : false,
    isOwner: me ? me.id === c.owner_id : false,
  });
  const communityLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => 'cc' + req.user.id });

  app.get('/api/communities', (req, res) => {
    const mine = req.query.mine === '1' && req.user;
    const rows = mine
      ? db.prepare(`SELECT c.* FROM communities c JOIN community_members m ON m.community_id = c.id WHERE m.user_id = ? ORDER BY m.joined_at DESC`).all(req.user.id)
      : db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM community_members WHERE community_id = c.id) AS n FROM communities c ORDER BY n DESC, c.id DESC LIMIT 50`).all();
    res.json({ communities: rows.map((c) => communityOut(c, req.user)) });
  });

  app.post('/api/communities', requireAuth, communityLimit, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    const slug = String(req.body?.slug || '').trim();
    const description = String(req.body?.description || '').trim().slice(0, 300);
    if (!name) return res.status(400).json({ error: 'コミュニティ名を入力してください' });
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(slug)) return res.status(400).json({ error: 'IDは英数字と - _ で3〜30文字です' });
    try {
      const r = db.prepare('INSERT INTO communities (slug, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(slug, name, description, req.user.id, Date.now());
      db.prepare('INSERT INTO community_members (community_id, user_id, joined_at) VALUES (?, ?, ?)').run(r.lastInsertRowid, req.user.id, Date.now());
      res.json({ community: communityOut(db.prepare('SELECT * FROM communities WHERE id = ?').get(r.lastInsertRowid), req.user) });
    } catch {
      res.status(409).json({ error: 'そのIDはすでに使われています' });
    }
  });

  app.get('/api/communities/:slug', (req, res) => {
    const c = qCommunityBySlug.get(req.params.slug);
    if (!c) return res.status(404).json({ error: 'コミュニティが見つかりません' });
    const rows = db.prepare('SELECT * FROM posts WHERE community_id = ? AND reply_to IS NULL AND id < ? ORDER BY id DESC LIMIT 30').all(c.id, beforeId(req));
    res.json({ community: communityOut(c, req.user), posts: hydrateAll(rows, req.user) });
  });

  app.post('/api/communities/:slug/join', requireAuth, (req, res) => {
    const c = qCommunityBySlug.get(req.params.slug);
    if (!c) return res.status(404).json({ error: 'コミュニティが見つかりません' });
    db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id, joined_at) VALUES (?, ?, ?)').run(c.id, req.user.id, Date.now());
    res.json({ community: communityOut(c, req.user) });
  });

  app.delete('/api/communities/:slug/join', requireAuth, (req, res) => {
    const c = qCommunityBySlug.get(req.params.slug);
    if (!c) return res.status(404).json({ error: 'コミュニティが見つかりません' });
    if (c.owner_id === req.user.id) return res.status(400).json({ error: '作成者は退出できません（コミュニティを削除してください）' });
    db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(c.id, req.user.id);
    res.json({ community: communityOut(c, req.user) });
  });

  app.delete('/api/communities/:slug', requireAuth, (req, res) => {
    const c = qCommunityBySlug.get(req.params.slug);
    if (!c) return res.status(404).json({ error: 'コミュニティが見つかりません' });
    if (c.owner_id !== req.user.id) return res.status(403).json({ error: '削除できるのは作成者だけです' });
    db.prepare('DELETE FROM communities WHERE id = ?').run(c.id); // 投稿・メンバーも一緒に消える
    res.json({ ok: true });
  });

  // 投稿時のコミュニティ確認 (server.js の投稿処理から使う)
  ctx.resolveCommunity = (slug, user) => {
    const c = qCommunityBySlug.get(String(slug));
    if (!c) return { error: [404, 'コミュニティが見つかりません'] };
    if (!qIsMember.get(c.id, user.id)) return { error: [403, 'コミュニティに参加すると投稿できます'] };
    return { id: c.id };
  };
  ctx.isCommunityMember = (communityId, user) => !!qIsMember.get(communityId, user.id);
  ctx.todayJst = todayJst;

  // ======================= 緊急データ削除 =======================
  // mode = 'content': 投稿・いいね・リポスト・DM・フォロー・コミュニティなどの履歴をすべて消す (アカウントは残す)
  // mode = 'account': アカウントごとすべて消す
  const wipeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => 'wipe' + req.user.id });
  app.post('/api/me/wipe', requireAuth, wipeLimit, (req, res) => {
    const u = req.user;
    const { password, mode } = req.body || {};
    if (mode !== 'content' && mode !== 'account') return res.status(400).json({ error: '削除の種類を選んでください' });
    if (typeof password !== 'string' ||
        !crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex')))
      return res.status(401).json({ error: 'パスワードが違います' });

    vb.closeUser(u.id); // 開いている仮想ブラウザも閉じて破棄
    ctx.invalidateTrends();
    db.exec('BEGIN');
    try {
      // 自分が作ったコミュニティ (他の人の投稿も含めて) を削除
      db.prepare('DELETE FROM communities WHERE owner_id = ?').run(u.id);
      // 自分の投稿 (リポスト含む)。他人のリポスト・いいねも外部キーで一緒に消える
      db.prepare('DELETE FROM posts WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM likes WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').run(u.id, u.id);
      // DM は相手側の画面からも消す
      db.prepare('DELETE FROM dm_messages WHERE sender_id = ? OR recipient_id = ?').run(u.id, u.id);
      db.prepare('DELETE FROM dm_reads WHERE user_id = ? OR peer_id = ?').run(u.id, u.id);
      db.prepare('DELETE FROM community_members WHERE user_id = ?').run(u.id);
      if (mode === 'account') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      } else {
        db.prepare("UPDATE users SET bio = '' WHERE id = ?").run(u.id);
        // 他の端末のログインも切る (この端末だけ残す)
        const token = (req.headers.cookie || '').match(/ippo_session=([0-9a-f]+)/)?.[1] || '';
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, token);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: '削除に失敗しました。もう一度お試しください' });
    }
    // 消したデータが WAL (書き込み途中のファイル) に残らないよう、本体に書き戻して空にする
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    if (mode === 'account') res.setHeader('Set-Cookie', 'ippo_session=; Path=/; Max-Age=0');
    res.json({ ok: true, mode });
  });

  // ======================= 動画の読み込み (中継) =======================
  // 動画はサーバーが代わりに取得して流す。利用者の IP アドレスは動画の配信元に伝わらない。
  // 内部ネットワーク宛は DNS 解決の段階で遮断する (仮想ブラウザと同じ方針)
  function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, { all: true }, (err, addrs) => {
      if (err) return callback(err);
      if (!vb.ALLOW_PRIVATE && (!addrs.length || addrs.some((a) => vb.isBlockedIp(a.address)))) {
        return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
      }
      if (options && options.all) return callback(null, addrs);
      callback(null, addrs[0].address, addrs[0].family);
    });
  }

  const mediaLimit = rateLimit({ windowMs: 60 * 1000, max: 600, key: (req) => 'media' + req.user.id });
  app.get('/api/media', requireAuth, mediaLimit, (req, res) => {
    const fail = (code, msg) => { if (!res.headersSent) res.status(code).json({ error: msg }); else res.destroy(); };
    const go = (raw, depth) => {
      let u;
      try { u = new URL(String(raw)); } catch { return fail(400, 'URLが正しくありません'); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(400, 'http/https のみ対応しています');
      // IP アドレスが直接書かれた URL は DNS 解決 (safeLookup) を通らないので、ここで内部アドレスを遮断する
      const host = u.hostname.replace(/^\[|\]$/g, '');
      if (!vb.ALLOW_PRIVATE && net.isIP(host) && vb.isBlockedIp(host)) return fail(403, '内部ネットワークのアドレスは読み込めません');
      const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; IppO-media/1.0)', Accept: 'video/*,*/*;q=0.5' };
      if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.Range = req.headers.range;
      const up = (u.protocol === 'https:' ? https : http).get(u, { headers, lookup: safeLookup, timeout: 15_000 }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
          r.resume();
          return depth >= 3 ? fail(502, 'リダイレクトが多すぎます') : go(new URL(r.headers.location, u).href, depth + 1);
        }
        const type = String(r.headers['content-type'] || '').toLowerCase();
        if (r.statusCode >= 400) { r.resume(); return fail(502, '動画を読み込めませんでした'); }
        if (!type.startsWith('video/') && !type.startsWith('application/octet-stream') && !type.startsWith('binary/octet-stream')) {
          r.resume(); return fail(415, '動画ファイルではありません');
        }
        res.status(r.statusCode === 206 ? 206 : 200);
        res.setHeader('Content-Type', type.startsWith('video/') ? r.headers['content-type'] : 'video/mp4');
        for (const h of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) if (r.headers[h]) res.setHeader(h, r.headers[h]);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Content-Disposition', 'inline');
        r.pipe(res);
        res.on('close', () => r.destroy());
      });
      up.on('timeout', () => up.destroy(new Error('timeout')));
      up.on('error', (e) => fail(e.code === 'EBLOCKED' ? 403 : 502, e.code === 'EBLOCKED' ? '内部ネットワークのアドレスは読み込めません' : '動画を読み込めませんでした'));
    };
    go(req.query.url, 0);
  });
};
