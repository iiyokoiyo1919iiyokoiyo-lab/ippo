// 追加機能: コミュニティ / トレンド / 今日の質問 / 緊急データ削除 / 動画の読み込み
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const qrcode = require('qrcode-generator');

// QR コードを SVG で作る (真ん中に IppO のマーク。誤り訂正レベル H なので一部を隠しても読み取れる)
function qrSvg(text) {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  let logo = Math.round(n * 0.22); if (logo % 2 === 0) logo += 1;          // マークの大きさ (モジュール数)
  const c0 = Math.floor((n - logo) / 2), c1 = c0 + logo;                    // マークを置く範囲
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x >= c0 - 1 && x <= c1 && y >= c0 - 1 && y <= c1) continue;         // マークの周りは空ける
    if (qr.isDark(y, x)) d += `M${x + q} ${y + q}h1v1h-1z`;
  }
  const cx = size / 2, r = logo / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<path d="${d}" fill="#1f2766"/>` +
    `<rect x="${cx - r - 0.5}" y="${cx - r - 0.5}" width="${logo + 1}" height="${logo + 1}" rx="${(logo + 1) * 0.28}" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${r * 0.68}" fill="none" stroke="#4b55f0" stroke-width="${r * 0.36}" shape-rendering="geometricPrecision"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${r * 0.2}" fill="#4b55f0" shape-rendering="geometricPrecision"/>` +
    `</svg>`;
}

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

// ---------- トレンド (投稿の文章に出てくる言葉) ----------
// 日本語は単語の間にスペースがないので Intl.Segmenter (ICU の辞書) で単語に分け、
// 漢字が続く部分は1語につなげる (例: 生徒 / 会長 / 選挙 → 生徒会長選挙)
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const KANJI = /^[\p{Script=Han}々〆ヶ]+$/u;
const HIRAGANA = /^[\p{Script=Hiragana}ー]+$/u;
const STOP_WORDS = new Set((
  '今日 明日 昨日 今年 去年 来年 今週 来週 先週 今月 毎日 今回 前回 次回 最近 今度 自分 本当 本気 感じ 気持 時間 一番 全部 普通 ' +
  '大丈夫 一緒 結構 意味 場合 以上 以下 関係 何 人 私 僕 俺 皆 誰 投稿 IppO 予定 時 年 月 日 ' +
  'the and for you are this that with have was not but just like what from your all can get its http https www com'
).toLowerCase().split(/\s+/));

// 名詞の後ろに来る助詞など (これが続く1文字の漢字は名詞の一部とみなす: 学園 / 祭 / の → 学園祭)
const PARTICLES = new Set('の が は を に で と も へ や か な ね よ だ です から まで より って とか かな けど'.split(' '));
function extractWords(text) {
  const clean = String(text)
    .replace(/https?:\/\/\S+/g, ' ')        // URL は除く
    .replace(/@[A-Za-z0-9_]+/g, ' ')         // メンションは除く
    .replace(/#/g, ' ');                     // ハッシュタグは中の言葉として数える
  const words = new Map();                   // 小文字にした言葉 → 表示用 (元の書き方)
  let run = '';                              // つなげ中の漢字
  const flush = () => { if (run) { push(run); run = ''; } };
  const push = (w) => {
    w = w.replace(/^第|第$/u, '');            // 「期末考査第」→「期末考査」
    const k = w.toLowerCase();
    if ([...w].length < 2 || [...w].length > 30) return;
    if (HIRAGANA.test(w)) return;            // ひらがなだけ (助詞・語尾など) は除く
    if (/\p{Script=Han}/u.test(w) && /\p{Script=Hiragana}/u.test(w)) return; // 漢字+送り仮名 (動詞・形容詞) は除く
    if (/^[\d.,:/-]+$/.test(w)) return;      // 数字だけは除く
    if (STOP_WORDS.has(k)) return;
    if (!words.has(k)) words.set(k, w);
  };
  const segs = [...segmenter.segment(clean)];
  segs.forEach((s, i) => {
    if (!s.isWordLike) return flush();
    if (KANJI.test(s.segment)) {
      // 1文字の漢字の後に助詞以外のひらがなが続く → 動詞・形容詞の語幹 (見た / 終わった / 難しい) なのでつなげない
      const next = segs[i + 1];
      if ([...s.segment].length === 1 && next && HIRAGANA.test(next.segment) && !PARTICLES.has(next.segment)) return flush();
      run += s.segment;
      return;
    }
    flush();
    push(s.segment);
  });
  flush();
  return words;
}

module.exports = function install(app, ctx) {
  const { db, hydrate, hydrateAll, requireAuth, rateLimit, publicUser, beforeId, hashPw, vb, isAdmin } = ctx;

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
  let trendCache = { at: 0, data: null, dirty: false };
  // 新しい投稿があったら集計し直す (ただし投稿が続く時でも10秒に1回まで)
  ctx.invalidateTrends = () => { trendCache.dirty = true; };
  app.get('/api/trends', (req, res) => {
    const age = Date.now() - trendCache.at;
    if (trendCache.data && (age < 10_000 || (!trendCache.dirty && age < 60_000))) return res.json(trendCache.data);
    const compute = (sinceMs) => {
      const rows = db.prepare(`SELECT user_id, content FROM posts WHERE created_at > ? AND repost_of IS NULL
        ORDER BY id DESC LIMIT 5000`).all(Date.now() - sinceMs);
      const counts = new Map(); // 言葉 → { posts, users }
      for (const r of rows) {
        for (const [t, display] of extractWords(r.content)) {
          const c = counts.get(t) || { posts: 0, users: new Set(), display };
          c.posts++; c.users.add(r.user_id);
          counts.set(t, c);
        }
      }
      // 同じ人の連投で上位にならないよう、使った人数を重視する
      // 1件の投稿にしか出てこない言葉はトレンドにしない
      return [...counts.entries()].filter(([, c]) => c.posts >= 2)
        .map(([, c]) => ({ tag: c.display, posts: c.posts, users: c.users.size, score: c.users.size * 3 + c.posts }))
        .sort((a, b) => b.score - a.score).slice(0, 10)
        .map(({ tag, posts, users }) => ({ tag, posts, users }));
    };
    let trends = compute(24 * 3600_000), period = '24時間';
    if (trends.length < 3) { trends = compute(7 * 24 * 3600_000); period = '7日間'; }
    trendCache = { at: Date.now(), data: { period, trends }, dirty: false };
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
    canDelete: me ? me.id === c.owner_id || isAdmin(me) : false,
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
    if (c.owner_id !== req.user.id && !isAdmin(req.user)) return res.status(403).json({ error: '削除できるのは作成者と管理者だけです' });
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

  // ======================= 通知 =======================
  // 既存のデータ (返信・メンション・リポスト・いいね・フォロー) から読み取るだけ。データベースの構造は変えない。
  // いいね・フォローには日時の記録がないので、追加された順 (rowid) で並べる
  const notifLimit = rateLimit({ windowMs: 60 * 1000, max: 240, key: (req) => 'nt' + req.user.id });
  function notificationsFor(me) {
    const mine = 'SELECT id FROM posts WHERE user_id = $me AND repost_of IS NULL';
    const replies = db.prepare(`SELECT * FROM posts WHERE reply_to IN (${mine}) AND user_id != $me ORDER BY id DESC LIMIT 50`).all({ $me: me.id });
    const reposts = db.prepare(`SELECT * FROM posts WHERE repost_of IN (${mine}) AND user_id != $me ORDER BY id DESC LIMIT 50`).all({ $me: me.id });
    const like = '%@' + me.username.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    const mentions = db.prepare(`SELECT * FROM posts WHERE content LIKE $like ESCAPE '\\' AND user_id != $me AND repost_of IS NULL
      AND (reply_to IS NULL OR reply_to NOT IN (${mine})) ORDER BY id DESC LIMIT 50`).all({ $me: me.id, $like: like })
      .filter((p) => new RegExp('(^|[^\\w])@' + me.username + '(?![A-Za-z0-9_])', 'i').test(p.content));
    const likes = db.prepare(`SELECT l.rowid AS rid, l.user_id, l.post_id FROM likes l JOIN posts p ON p.id = l.post_id
      WHERE p.user_id = $me AND l.user_id != $me ORDER BY l.rowid DESC LIMIT 100`).all({ $me: me.id });
    const follows = db.prepare('SELECT rowid AS rid, follower_id FROM follows WHERE followee_id = ? ORDER BY rowid DESC LIMIT 50').all(me.id);
    return { replies, reposts, mentions, likes, follows };
  }
  app.get('/api/notifications', requireAuth, notifLimit, (req, res) => {
    const me = req.user, n = notificationsFor(me);
    const user = (id) => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    const activity = [
      ...n.replies.map((p) => ({ type: 'reply', at: p.created_at, user: user(p.user_id), post: hydrate(p, me) })),
      ...n.mentions.map((p) => ({ type: 'mention', at: p.created_at, user: user(p.user_id), post: hydrate(p, me) })),
      ...n.reposts.map((p) => ({ type: 'repost', at: p.created_at, user: user(p.user_id), post: hydrate(db.prepare('SELECT * FROM posts WHERE id = ?').get(p.repost_of), me) })),
    ].filter((a) => a.user && a.post).sort((a, b) => b.at - a.at).slice(0, 60);
    // いいねは投稿ごとにまとめる
    const byPost = new Map();
    for (const l of n.likes) {
      if (!byPost.has(l.post_id)) byPost.set(l.post_id, { rid: l.rid, users: [] });
      const g = byPost.get(l.post_id);
      if (g.users.length < 5) g.users.push(user(l.user_id));
      g.total = (g.total || 0) + 1;
    }
    const likes = [...byPost.entries()].map(([postId, g]) => {
      const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
      return p && { rid: g.rid, users: g.users.filter(Boolean), total: g.total, post: hydrate(p, me) };
    }).filter(Boolean);
    const follows = n.follows.map((f) => ({ rid: f.rid, user: user(f.follower_id) })).filter((f) => f.user);
    res.json({
      activity, likes, follows,
      cursor: { at: activity[0]?.at || 0, like: n.likes[0]?.rid || 0, follow: n.follows[0]?.rid || 0 },
    });
  });
  // 未読数 (既読の位置は端末側で記録し、ここに渡す)
  app.get('/api/notifications/unread', requireAuth, notifLimit, (req, res) => {
    const me = req.user, n = notificationsFor(me);
    const at = Number(req.query.at) || 0, likeR = Number(req.query.like) || 0, followR = Number(req.query.follow) || 0;
    const count = [...n.replies, ...n.mentions, ...n.reposts].filter((p) => p.created_at > at).length
      + n.likes.filter((l) => l.rid > likeR).length + n.follows.filter((f) => f.rid > followR).length;
    res.json({ unread: count });
  });

  // ======================= 招待制 =======================
  // INVITE_ONLY=0 にすると誰でも登録できる (既定は招待制)
  const INVITE_ONLY = process.env.INVITE_ONLY !== '0';
  const INVITE_DAYS = 7, MAX_OPEN_INVITES = 5;
  const qInvite = db.prepare('SELECT * FROM invites WHERE code = ?');
  const normCode = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  // 紛らわしい文字 (0/O, 1/I/L) を除いた 10 文字
  const newCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return [...crypto.randomBytes(10)].map((b) => A[b % A.length]).join(''); };

  ctx.checkInvite = (raw) => {
    if (!INVITE_ONLY) return {};
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) return {}; // 最初の1人
    const code = normCode(raw);
    if (!code) return { error: 'IppO は招待制です。招待コードを入力してください' };
    const inv = qInvite.get(code);
    if (!inv) return { error: '招待コードが正しくありません' };
    if (inv.used_by) return { error: 'この招待コードはすでに使われています' };
    if (inv.expires_at < Date.now()) return { error: 'この招待コードは有効期限が切れています' };
    return { code, creatorId: inv.creator_id };
  };

  app.get('/api/config', (req, res) => {
    res.json({ inviteOnly: INVITE_ONLY && db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0 });
  });

  // 招待リンクを開いた時の確認 (誰からの招待か)
  const inviteCheckLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
  app.get('/api/invites/:code/check', inviteCheckLimit, (req, res) => {
    const r = ctx.checkInvite(req.params.code);
    if (r.error) return res.json({ valid: false, error: r.error });
    const from = r.creatorId ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.creatorId)) : null;
    res.json({ valid: true, from });
  });

  const inviteOut = (i) => ({
    code: i.code, createdAt: i.created_at, expiresAt: i.expires_at, usedAt: i.used_at,
    usedBy: i.used_by ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(i.used_by)) : null,
    status: i.used_by ? 'used' : i.used_at ? 'used' : i.expires_at < Date.now() ? 'expired' : 'open',
  });
  app.get('/api/invites', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM invites WHERE creator_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json({ inviteOnly: INVITE_ONLY, max: MAX_OPEN_INVITES, invites: rows.map(inviteOut) });
  });
  const inviteLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => 'inv' + req.user.id });
  app.post('/api/invites', requireAuth, inviteLimit, (req, res) => {
    const open = db.prepare('SELECT COUNT(*) AS n FROM invites WHERE creator_id = ? AND used_by IS NULL AND used_at IS NULL AND expires_at > ?').get(req.user.id, Date.now()).n;
    if (open >= MAX_OPEN_INVITES) return res.status(400).json({ error: `使われていない招待は${MAX_OPEN_INVITES}つまでです。使われるのを待つか、不要なものを削除してください` });
    const code = newCode();
    db.prepare('INSERT INTO invites (code, creator_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(code, req.user.id, Date.now(), Date.now() + INVITE_DAYS * 86400_000);
    res.json({ invite: inviteOut(qInvite.get(code)) });
  });
  // 招待リンクの QR コード (作った本人だけが取得できる。使用済み・期限切れは出さない)
  app.get('/api/invites/:code/qr.svg', requireAuth, (req, res) => {
    const inv = qInvite.get(normCode(req.params.code));
    if (!inv || inv.creator_id !== req.user.id) return res.status(404).end();
    if (inv.used_by || inv.used_at || inv.expires_at < Date.now()) return res.status(410).end();
    const url = `${req.protocol}://${req.get('host')}/#/invite/${inv.code}`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(qrSvg(url));
  });

  app.delete('/api/invites/:code', requireAuth, (req, res) => {
    const r = db.prepare('DELETE FROM invites WHERE code = ? AND creator_id = ? AND used_by IS NULL AND used_at IS NULL').run(normCode(req.params.code), req.user.id);
    res.json({ ok: r.changes > 0 });
  });

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

    const token = (req.headers.cookie || '').match(/ippo_session=([0-9a-f]+)/)?.[1] || '';
    if (!eraseUser(u.id, mode, token)) return res.status(500).json({ error: '削除に失敗しました。もう一度お試しください' });
    if (mode === 'account') res.setHeader('Set-Cookie', 'ippo_session=; Path=/; Max-Age=0');
    res.json({ ok: true, mode });
  });

  // ユーザーのデータを完全に消す。mode = 'content' は履歴のみ、'account' はアカウントごと
  function eraseUser(userId, mode, keepToken = '') {
    const u = { id: userId };
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
      db.prepare('DELETE FROM invites WHERE creator_id = ?').run(u.id); // 作った招待コードも削除
      // PIXEL WORLD: 絵は共同作品なので残し、誰が置いたかの記録・待ち時間・投票を消す
      db.prepare('UPDATE pw_placements SET user_id = NULL WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM pw_cooldowns WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM pw_votes WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM user_privacy WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM announcement_seen WHERE user_id = ?').run(u.id);
      if (mode === 'account') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      } else {
        db.prepare("UPDATE users SET bio = '' WHERE id = ?").run(u.id);
        // 他の端末のログインも切る (この端末だけ残す)
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, keepToken);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return false;
    }
    // 消したデータが WAL (書き込み途中のファイル) に残らないよう、本体に書き戻して空にする
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    return true;
  }

  // ======================= 管理者 =======================
  // すべてサーバー側で管理者か確認する。管理者は ADMIN_USERS で指定 (server.js)
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'ログインが必要です' });
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけが使える機能です' });
    next();
  };
  const adminLimit = rateLimit({ windowMs: 60 * 1000, max: 120, key: (req) => 'adm' + req.user.id });
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;

  app.get('/api/admin/stats', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const day = Date.now() - 86400_000, week = Date.now() - 7 * 86400_000;
    res.json({
      users: count('SELECT COUNT(*) AS n FROM users'),
      usersWeek: count('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', week),
      posts: count('SELECT COUNT(*) AS n FROM posts WHERE repost_of IS NULL'),
      postsDay: count('SELECT COUNT(*) AS n FROM posts WHERE repost_of IS NULL AND created_at > ?', day),
      communities: count('SELECT COUNT(*) AS n FROM communities'),
      dms: count('SELECT COUNT(*) AS n FROM dm_messages'),            // 件数だけ (中身は見ない)
      openInvites: count('SELECT COUNT(*) AS n FROM invites WHERE used_by IS NULL AND used_at IS NULL AND expires_at > ?', Date.now()),
      activeUsers: count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE created_at > ?', week),
    });
  });

  // ユーザー一覧 (誰の招待で登録したかも表示)
  app.get('/api/admin/users', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    const like = '%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    const rows = q
      ? db.prepare(`SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100`).all(like, like)
      : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 100').all();
    const by = db.prepare('SELECT username FROM users WHERE id = ?');
    res.json({ users: rows.map((u) => ({
      ...publicUser(u),
      isAdmin: isAdmin(u),
      invitedBy: u.invited_by ? by.get(u.invited_by)?.username || null : null,
      posts: count('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND repost_of IS NULL', u.id),
      followers: count('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?', u.id),
      invited: count('SELECT COUNT(*) AS n FROM users WHERE invited_by = ?', u.id),
      sessions: count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', u.id),
    })) });
  });

  const targetUser = (req, res) => {
    const t = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
    if (!t) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return null; }
    if (isAdmin(t)) { res.status(400).json({ error: '管理者に対しては実行できません' }); return null; }
    return t;
  };
  // 強制ログアウト (すべての端末)
  app.post('/api/admin/users/:username/logout', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const t = targetUser(req, res); if (!t) return;
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
    vb.closeUser(t.id);
    console.log(`[admin] ${req.user.username} が @${t.username} を強制ログアウト`);
    res.json({ ok: true });
  });
  // アカウント削除 (本人の緊急データ削除と同じく、データを完全に消す)
  app.delete('/api/admin/users/:username', requireAuth, requireAdmin, adminLimit, (req, res) => {
    const t = targetUser(req, res); if (!t) return;
    if (!eraseUser(t.id, 'account')) return res.status(500).json({ error: '削除に失敗しました' });
    console.log(`[admin] ${req.user.username} が @${t.username} のアカウントを削除`);
    res.json({ ok: true });
  });

  // ======================= YouTube (再生ボタンを押すまで利用者の端末は YouTube に接続しない) =======================
  // サムネイルとタイトルは IppO のサーバーが代わりに取得する。接続先は YouTube の固定ホストだけ
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  const ytLimit = rateLimit({ windowMs: 60 * 1000, max: 120 });
  const ytInfo = new Map();   // id → { title, author, at }
  const ytThumb = new Map();  // id → { type, body, at }
  const remember = (map, key, val, max = 300) => { map.set(key, val); if (map.size > max) map.delete(map.keys().next().value); };
  function fetchFixed(url, maxBytes) {
    return new Promise((resolve, reject) => {
      const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IppO/1.0)' }, timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('status ' + res.statusCode)); }
        const chunks = []; let size = 0;
        res.on('data', (c) => { size += c.length; if (size > maxBytes) { r.destroy(); reject(new Error('too large')); } else chunks.push(c); });
        res.on('end', () => resolve({ type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
      });
      r.on('timeout', () => r.destroy(new Error('timeout')));
      r.on('error', reject);
    });
  }
  // タイトル・投稿者 (YouTube の oEmbed)
  app.get('/api/yt/:id', ytLimit, async (req, res) => {
    const id = req.params.id;
    if (!YT_ID.test(id)) return res.status(400).json({ error: 'IDが正しくありません' });
    const hit = ytInfo.get(id);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return res.json(hit.data);
    try {
      const { body } = await fetchFixed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, 64 * 1024);
      const j = JSON.parse(body.toString('utf8'));
      const data = { title: String(j.title || '').slice(0, 200), author: String(j.author_name || '').slice(0, 100) };
      remember(ytInfo, id, { data, at: Date.now() });
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(data);
    } catch {
      res.status(404).json({ error: '動画の情報を取得できませんでした' });
    }
  });
  // サムネイル画像
  app.get('/api/yt/:id/thumb', ytLimit, async (req, res) => {
    const id = req.params.id;
    if (!YT_ID.test(id)) return res.status(400).end();
    let hit = ytThumb.get(id);
    if (!hit || Date.now() - hit.at > 24 * 3600_000) {
      try {
        const r = await fetchFixed(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 512 * 1024);
        if (!/^image\/(jpeg|png|webp)/.test(r.type)) throw new Error('not image');
        hit = { type: r.type, body: r.body, at: Date.now() };
        remember(ytThumb, id, hit, 200);
      } catch { return res.status(404).end(); }
    }
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(hit.body);
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
