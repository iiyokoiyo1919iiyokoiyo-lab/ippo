const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');
const vb = require('./vbrowser');

const PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;

const app = express();
app.disable('x-powered-by');
// Fly.io / Render / nginx 等のリバースプロキシ配下で HTTPS 判定とクライアント IP を正しく扱う
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

// セキュリティヘッダー
app.use((req, res, next) => {
  // ミニゲーム (/games/) だけは IppO 自身の画面の中 (同じドメインの iframe) に表示できる。ほかのサイトには埋め込めない
  const framable = req.path.startsWith('/games/');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
    "frame-src 'self' https://www.youtube-nocookie.com; " +
    `frame-ancestors ${framable ? "'self'" : "'none'"}; base-uri 'none'; form-action 'self'; object-src 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', framable ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));
// 画面のファイルの版 (index.html の中身から作る)。開きっぱなしの画面が、更新されたら読み込み直すのに使う
const ASSET_VERSION = require('crypto').createHash('sha1').update(require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'))).digest('hex').slice(0, 12);
app.get('/api/version', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ v: ASSET_VERSION }); });
app.use(express.json({ limit: '32kb' }));
// 更新がすぐ反映されるよう、毎回サーバーに変更有無を確認させる (変更がなければ 304 で軽く済む)
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

// 簡易レート制限 (メモリ内。複数台構成にする場合は Redis 等へ)
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req), now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.n > max) return res.status(429).json({ error: '操作が多すぎます。しばらく待ってから再度お試しください' });
    next();
  };
}
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => 'u' + (req.user?.id ?? req.ip) });

// ---------- 認証 ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const qSession = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > ?');
function userFromReq(req) {
  const token = parseCookies(req.headers.cookie).ippo_session;
  return token ? qSession.get(token, Date.now() - SESSION_DAYS * 86400_000) || null : null;
}
// 期限切れセッションを定期削除
setInterval(() => db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_DAYS * 86400_000), 3600_000).unref();

app.use((req, res, next) => { req.user = userFromReq(req); next(); });
const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'ログインが必要です' }));

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  res.setHeader('Set-Cookie', `ippo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${86400 * SESSION_DAYS}${req.secure ? '; Secure' : ''}`);
}

// 公開するユーザー情報 (管理者かどうかも含める: 名前の横に管理者バッジを出すため)
const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, createdAt: u.created_at, isAdmin: isAdmin(u),
  avatar: ctx.avatarOf ? ctx.avatarOf(u.id) : null, // アイコン (写真 / 絵文字)。未設定なら null
  verified: ctx.verifiedOf ? ctx.verifiedOf(u) : null, // 認証マーク (管理者が付与)
  titles: ctx.titlesOf ? ctx.titlesOf(u) : [] }; // 称号 (高難易度クエストの最速クリアなど)
// 管理者: 環境変数 ADMIN_USERS (カンマ区切りのユーザー名) で指定する。未設定なら RCN413
const ADMINS = new Set(String(process.env.ADMIN_USERS ?? 'RCN413').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isAdmin = (u) => !!u && ADMINS.has(String(u.username).toLowerCase());
// 自分自身の情報 (管理者かどうかも含む)
const selfUser = (u) => u && { ...publicUser(u), isAdmin: isAdmin(u) };

app.post('/api/register', authLimit, (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!/^[A-Za-z0-9_]{3,15}$/.test(username || '')) return res.status(400).json({ error: 'ユーザー名は英数字と_で3〜15文字です' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
  if (ctx.isReservedName && ctx.isReservedName(username)) return res.status(400).json({ error: 'このユーザー名は公式アカウント用のため使えません。別のユーザー名にしてください' });
  if (ctx.isBannedName && ctx.isBannedName(username)) return res.status(400).json({ error: 'このユーザー名は使えません。別のユーザー名にしてください' });
  const name = String(displayName || username).trim().slice(0, 50) || username;
  // 招待制: 有効な招待コードが必要 (まだ誰もいない時の最初の1人だけは不要)
  const invite = ctx.checkInvite(req.body?.invite);
  if (invite.error) return res.status(403).json({ error: invite.error, needInvite: true });
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    db.exec('BEGIN');
    const r = db.prepare('INSERT INTO users (username, display_name, pass_hash, salt, created_at, invited_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, name, hashPw(password, salt), salt, Date.now(), invite.creatorId || null);
    if (invite.code) {
      const u = db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').run(r.lastInsertRowid, Date.now(), invite.code);
      if (u.changes !== 1) throw new Error('invite already used');
    }
    db.exec('COMMIT');
    createSession(req, res, Number(r.lastInsertRowid));
    res.json({ user: selfUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    if (String(e.message).includes('invite')) return res.status(403).json({ error: 'この招待コードはすでに使われています', needInvite: true });
    res.status(409).json({ error: 'そのユーザー名は使われています' });
  }
});

app.post('/api/login', authLimit, (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!u || typeof password !== 'string' ||
      !crypto.timingSafeEqual(Buffer.from(hashPw(password, u.salt), 'hex'), Buffer.from(u.pass_hash, 'hex')))
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  createSession(req, res, u.id);
  res.json({ user: selfUser(u) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).ippo_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'ippo_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: selfUser(req.user) }));

// ---------- 投稿の整形 ----------
const qPost = db.prepare('SELECT * FROM posts WHERE id = ?');
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
const qCounts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM likes WHERE post_id = $id) AS likes,
  (SELECT COUNT(*) FROM posts WHERE repost_of = $id) AS reposts,
  (SELECT COUNT(*) FROM posts WHERE reply_to = $id) AS replies,
  EXISTS(SELECT 1 FROM likes WHERE post_id = $id AND user_id = $me) AS liked,
  EXISTS(SELECT 1 FROM posts WHERE repost_of = $id AND user_id = $me) AS reposted,
  (SELECT COUNT(*) FROM posts WHERE quote_of = $id AND repost_of IS NULL AND reply_to IS NULL) AS quotes`);

function hydrate(row, me, depth = 0) {
  if (!row) return null;
  if (row.repost_of) {
    const orig = hydrate(qPost.get(row.repost_of), me);
    if (!orig) return null;
    return { id: row.id, type: 'repost', createdAt: row.created_at, by: publicUser(qUser.get(row.user_id)), post: orig };
  }
  const c = qCounts.get({ $id: row.id, $me: me ? me.id : 0 });
  let community = null;
  if (row.community_id) { const cm = qCommunity.get(row.community_id); if (cm) community = { slug: cm.slug, name: cm.name }; }
  let replyToUser = null;
  if (row.reply_to) {
    const parent = qPost.get(row.reply_to);
    if (parent) replyToUser = qUser.get(parent.user_id)?.username || null;
  }
  let quoted = null;
  if (row.quote_of && depth < 1) {
    const qr = qPost.get(row.quote_of);
    if (qr && !qr.repost_of) quoted = hydrate(qr, me, depth + 1);
    else if (qr) quoted = { unavailable: true };
    else quoted = { unavailable: true }; // 元投稿が削除された
  } else if (row.quote_of) {
    quoted = { unavailable: true };
  }
  return {
    id: row.id, type: 'post', content: row.content, createdAt: row.created_at, replyTo: row.reply_to, replyToUser,
    author: publicUser(qUser.get(row.user_id)),
    counts: { likes: c.likes, reposts: c.reposts, replies: c.replies, quotes: c.quotes },
    liked: !!c.liked, reposted: !!c.reposted,
    community, question: !!row.question_day, quoted,
    images: ctx.imagesOf ? ctx.imagesOf(row.id) : [],
  };
}
const qCommunity = db.prepare('SELECT slug, name FROM communities WHERE id = ?');
const hydrateAll = (rows, me) => rows.map((r) => hydrate(r, me)).filter(Boolean);
const beforeId = (req) => Number(req.query.before) || Number.MAX_SAFE_INTEGER;

// ---------- タイムライン ----------
app.get('/api/timeline', (req, res) => {
  const following = req.query.mode === 'following' && req.user;
  const rows = following
    ? db.prepare(`SELECT * FROM posts WHERE id < ? AND community_id IS NULL AND (user_id = ? OR user_id = ? OR user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
        ORDER BY id DESC LIMIT 30`).all(beforeId(req), req.user.id, ctx.officialId?.() || 0, req.user.id) // 公式アカウントのお知らせは、フォローしていなくても出す
    : db.prepare('SELECT * FROM posts WHERE id < ? AND reply_to IS NULL AND community_id IS NULL ORDER BY id DESC LIMIT 30').all(beforeId(req));
  res.json({ posts: hydrateAll(rows, req.user) });
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ posts: [], users: [] });
  const esc = (t) => '%' + t.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
  const like = esc(q);
  // ハッシュタグは半角 # と全角 ＃ のどちらで書かれた投稿も見つける
  const alt = /^[#＃]/.test(q) ? esc((q[0] === '#' ? '＃' : '#') + q.slice(1)) : like;
  const posts = db.prepare(`SELECT * FROM posts WHERE repost_of IS NULL AND (content LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 30`).all(like, alt);
  const users = db.prepare(`SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 10`).all(like, like);
  res.json({ posts: hydrateAll(posts, req.user), users: users.map(publicUser) });
});

// ---------- 投稿 ----------
app.post('/api/posts', requireAuth, writeLimit, (req, res) => {
  const content = String(req.body?.content || '').trim();
  const replyTo = req.body?.replyTo ? Number(req.body.replyTo) : null;
  const imgs = ctx.checkImages(req.user, req.body?.imageIds);
  if (imgs.error) return res.status(400).json({ error: imgs.error });
  if (!content && !imgs.ids.length) return res.status(400).json({ error: '本文を入力するか、写真を選んでください' });
  if ([...content].length > 280) return res.status(400).json({ error: '280文字以内で投稿してください' });
  const parent = replyTo ? qPost.get(replyTo) : null;
  if (replyTo && !parent) return res.status(404).json({ error: '返信先が見つかりません' });
  // 引用リポスト: 元投稿を埋め込む。元が引用・リポストでも、たどって本体を引用する (入れ子を防ぐ)
  let quoteOf = null;
  if (!replyTo && req.body?.quoteOf) {
    let target = qPost.get(Number(req.body.quoteOf));
    if (target && target.repost_of) target = qPost.get(target.repost_of);     // 素のリポストは元をたどる
    if (target && target.quote_of && !target.content) target = qPost.get(target.quote_of);
    if (!target || target.repost_of) return res.status(404).json({ error: '引用する投稿が見つかりません' });
    quoteOf = target.id;
    if (!content && !imgs.ids.length) return res.status(400).json({ error: 'ひとこと添えるか、写真を選んでください' });
  }
  // コミュニティへの投稿 (返信は返信先のコミュニティを引き継ぐ)。参加者だけが投稿できる
  let communityId = parent ? parent.community_id : null;
  if (!parent && req.body?.community) {
    const r = ctx.resolveCommunity(req.body.community, req.user);
    if (r.error) return res.status(r.error[0]).json({ error: r.error[1] });
    communityId = r.id;
  }
  if (communityId && !ctx.isCommunityMember(communityId, req.user)) return res.status(403).json({ error: 'コミュニティに参加すると投稿できます' });
  const questionDay = !parent && req.body?.question ? ctx.todayJst() : null;
  const r = db.prepare('INSERT INTO posts (user_id, content, reply_to, community_id, question_day, quote_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, content, replyTo, communityId, questionDay, quoteOf, Date.now());
  if (imgs.ids.length) ctx.attachImages(Number(r.lastInsertRowid), req.user, imgs.ids);
  ctx.invalidateTrends();
  const created = qPost.get(r.lastInsertRowid);
  // FF (相互フォロー) に「投稿しました」を知らせる (返信・コミュニティ内の投稿は除く)
  if (!created.reply_to && !created.community_id && ctx.mutualsOf && ctx.rt?.sendToUsers) {
    ctx.rt.sendToUsers(ctx.mutualsOf(req.user.id), { t: 'ff-post', from: req.user.username, name: req.user.display_name, postId: created.id,
      preview: created.content ? created.content.slice(0, 40) : '📷 写真' });
  }
  res.json({ post: hydrate(created, req.user) });
});

app.get('/api/posts/:id', (req, res) => {
  const row = qPost.get(Number(req.params.id));
  if (!row || row.repost_of) return res.status(404).json({ error: '投稿が見つかりません' });
  const ancestors = [];
  let cur = row;
  while (cur.reply_to && ancestors.length < 20) {
    cur = qPost.get(cur.reply_to);
    if (!cur) break;
    ancestors.unshift(cur);
  }
  const replies = db.prepare('SELECT * FROM posts WHERE reply_to = ? ORDER BY id ASC LIMIT 100').all(row.id);
  res.json({ post: hydrate(row, req.user), ancestors: hydrateAll(ancestors, req.user), replies: hydrateAll(replies, req.user) });
});

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  // 自分の投稿は本人が、他人の投稿は管理者だけが削除できる
  const r = isAdmin(req.user)
    ? db.prepare('DELETE FROM posts WHERE id = ?').run(Number(req.params.id))
    : db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (r.changes > 0) ctx.invalidateTrends();
  res.json({ ok: r.changes > 0 });
});

function toggle(sqlOn, sqlOff) {
  return (on) => (req, res) => {
    const id = Number(req.params.id);
    const row = qPost.get(id);
    if (!row || row.repost_of) return res.status(404).json({ error: '投稿が見つかりません' });
    db.prepare(on ? sqlOn : sqlOff).run(req.user.id, id, ...(on && sqlOn.includes('created_at') ? [Date.now()] : []));
    res.json({ post: hydrate(row, req.user) });
  };
}
const like = toggle('INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)', 'DELETE FROM likes WHERE user_id = ? AND post_id = ?');
const repost = toggle('INSERT OR IGNORE INTO posts (user_id, repost_of, created_at) VALUES (?, ?, ?)', 'DELETE FROM posts WHERE user_id = ? AND repost_of = ?');
app.post('/api/posts/:id/like', requireAuth, writeLimit, like(true));
app.delete('/api/posts/:id/like', requireAuth, writeLimit, like(false));
app.post('/api/posts/:id/repost', requireAuth, writeLimit, repost(true));
app.delete('/api/posts/:id/repost', requireAuth, writeLimit, repost(false));

// ---------- ユーザー ----------
const qFollowStats = db.prepare(`SELECT
  (SELECT COUNT(*) FROM follows WHERE followee_id = $id) AS followers,
  (SELECT COUNT(*) FROM follows WHERE follower_id = $id) AS following,
  (SELECT COUNT(*) FROM posts WHERE user_id = $id AND repost_of IS NULL) AS posts,
  EXISTS(SELECT 1 FROM follows WHERE follower_id = $me AND followee_id = $id) AS followed`);

function profile(u, me) {
  const s = qFollowStats.get({ $id: u.id, $me: me ? me.id : 0 });
  return { ...publicUser(u), stats: { followers: s.followers, following: s.following, posts: s.posts }, followed: !!s.followed };
}

app.get('/api/users', (req, res) => {
  const me = req.user;
  const rows = me
    ? db.prepare('SELECT * FROM users WHERE id != ? AND id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?) ORDER BY id DESC LIMIT 5').all(me.id, me.id)
    : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 5').all();
  res.json({ users: rows.map((u) => profile(u, me)) });
});

app.get('/api/users/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  const rows = db.prepare('SELECT * FROM posts WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 30').all(u.id, beforeId(req));
  res.json({ user: profile(u, req.user), posts: hydrateAll(rows, req.user), horse: ctx.horseSummaryOf ? ctx.horseSummaryOf(u.id) : null });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const name = String(req.body?.displayName ?? req.user.display_name).trim().slice(0, 50) || req.user.username;
  const bio = String(req.body?.bio ?? req.user.bio).slice(0, 160);
  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.id);
  res.json({ user: selfUser(qUser.get(req.user.id)) });
});

function follow(on) {
  return (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
    if (!u) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (u.id === req.user.id) return res.status(400).json({ error: '自分はフォローできません' });
    db.prepare(on ? 'INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)' : 'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .run(req.user.id, u.id);
    res.json({ user: profile(u, req.user) });
  };
}
app.post('/api/users/:username/follow', requireAuth, writeLimit, follow(true));
app.delete('/api/users/:username/follow', requireAuth, writeLimit, follow(false));

// ---------- 追加機能 (コミュニティ / トレンド / 今日の質問 / 緊急データ削除 / 動画) ----------
const ctx = { db, hydrate, hydrateAll, requireAuth, rateLimit, publicUser, beforeId, hashPw, vb, isAdmin };
require('./features')(app, ctx);
require('./pixel')(app, ctx); // PIXEL WORLD
require('./realtime')(app, ctx); // DM のオンライン表示・入力中・既読
require('./avatar')(app, ctx); // プロフィールのアイコン
require('./announce')(app, ctx); // 運営からのお知らせ
require('./images')(app, ctx); // 投稿の写真
require('./verify')(app, ctx); // 認証マーク
require('./horse')(app, ctx); // ミニゲーム「117万分の1 競走馬版」
require('./race')(app, ctx); // 競走馬版: 図鑑の馬でレース (オンライン対戦)
require('./games')(app, ctx); // ミニゲーム「暗算ダッシュ」(ランキングつき)
require('./cards')(app, ctx); // ミニゲーム「ぶんぼうぐバトラーズ」(ガチャ・オンライン対戦)
require('./official')(app, ctx); // IppO 公式アカウント (アップデート情報の自動投稿) と、イベントの告知バナー
require('./poker')(app, ctx); // ミニゲーム「レート戦ポーカー」(1 対 1 のテキサスホールデム。お金・コインは賭けない)

// ---------- ダイレクトメッセージ ----------
// 会話は当事者2人しか読めない (すべてのクエリで自分が送信者か受信者であることを条件にする)
const dmLimit = rateLimit({ windowMs: 60 * 1000, max: 30, key: (req) => 'dm' + req.user.id });
const qLastRead = db.prepare('SELECT last_read_id FROM dm_reads WHERE user_id = ? AND peer_id = ?');
const qUnreadFrom = db.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE sender_id = ? AND recipient_id = ? AND id > ?');
const qMarkRead = db.prepare(`INSERT INTO dm_reads (user_id, peer_id, last_read_id) VALUES (?, ?, ?)
  ON CONFLICT(user_id, peer_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`);
const dmOut = (m, me) => ({ id: m.id, content: m.content, createdAt: m.created_at, mine: m.sender_id === me.id });

function unreadFrom(me, peerId) {
  const last = qLastRead.get(me.id, peerId)?.last_read_id || 0;
  return qUnreadFrom.get(peerId, me.id, last).n;
}

// 会話一覧
app.get('/api/dm', requireAuth, (req, res) => {
  const me = req.user;
  const rows = db.prepare(`SELECT peer, MAX(id) AS last_id FROM (
      SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS peer, id
      FROM dm_messages WHERE sender_id = ? OR recipient_id = ?)
    GROUP BY peer ORDER BY last_id DESC LIMIT 50`).all(me.id, me.id, me.id);
  const conversations = rows.map((r) => {
    const peer = qUser.get(r.peer);
    if (!peer) return null;
    return { user: publicUser(peer), last: dmOut(db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(r.last_id), me), unread: unreadFrom(me, peer.id),
      online: ctx.rt.presenceOf(me.id, peer.id).online };
  }).filter(Boolean);
  res.json({ conversations });
});

// 未読の合計 (ナビのバッジ用)
app.get('/api/dm/unread', requireAuth, (req, res) => {
  const me = req.user;
  const peers = db.prepare('SELECT DISTINCT sender_id AS peer FROM dm_messages WHERE recipient_id = ?').all(me.id);
  res.json({ unread: peers.reduce((n, p) => n + unreadFrom(me, p.peer), 0) });
});

function findPeer(req, res) {
  const peer = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!peer) { res.status(404).json({ error: 'ユーザーが見つかりません' }); return null; }
  if (peer.id === req.user.id) { res.status(400).json({ error: '自分にはメッセージを送れません' }); return null; }
  return peer;
}

// 1つの会話のメッセージ (after: それより新しいもの / before: それより古いもの)
app.get('/api/dm/:username', requireAuth, (req, res) => {
  const me = req.user, peer = findPeer(req, res);
  if (!peer) return;
  const after = Number(req.query.after) || 0;
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const pair = '((sender_id = $me AND recipient_id = $peer) OR (sender_id = $peer AND recipient_id = $me))';
  const rows = after
    ? db.prepare(`SELECT * FROM dm_messages WHERE ${pair} AND id > $after ORDER BY id ASC LIMIT 100`).all({ $me: me.id, $peer: peer.id, $after: after })
    : db.prepare(`SELECT * FROM (SELECT * FROM dm_messages WHERE ${pair} AND id < $before ORDER BY id DESC LIMIT 50) ORDER BY id ASC`).all({ $me: me.id, $peer: peer.id, $before: before });
  if (rows.length) {
    const lastId = rows[rows.length - 1].id;
    const prev = qLastRead.get(me.id, peer.id)?.last_read_id || 0;
    qMarkRead.run(me.id, peer.id, lastId);
    // 相手から届いたメッセージを新しく読んだ時だけ「既読」を知らせる
    if (lastId > prev && rows.some((m) => m.sender_id === peer.id && m.id > prev)) ctx.rt.read(me, peer, lastId);
  }
  res.json({ user: profile(peer, me), messages: rows.map((m) => dmOut(m, me)), hasMore: !after && rows.length === 50,
    peer: { ...ctx.rt.presenceOf(me.id, peer.id), readUpTo: ctx.rt.readByPeer(me.id, peer.id) } });
});

app.post('/api/dm/:username', requireAuth, dmLimit, (req, res) => {
  const me = req.user, peer = findPeer(req, res);
  if (!peer) return;
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: 'メッセージを入力してください' });
  if ([...content].length > 1000) return res.status(400).json({ error: '1000文字以内で送信してください' });
  const r = db.prepare('INSERT INTO dm_messages (sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?)').run(me.id, peer.id, content, Date.now());
  qMarkRead.run(me.id, peer.id, Number(r.lastInsertRowid));
  const row = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(r.lastInsertRowid);
  ctx.rt.dmSent(me, peer, row, dmOut);
  res.json({ message: dmOut(row, me) });
});

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- 仮想ブラウザ WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/vb' && u.pathname !== '/pw' && u.pathname !== '/rt' && u.pathname !== '/cb' && u.pathname !== '/pk' && u.pathname !== '/rc') return socket.destroy();
  // CSRF 的な他サイトからの接続を拒否
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
  // PIXEL WORLD のリアルタイム配信 (閲覧は誰でも可。書き込みは受け付けない)
  if (u.pathname === '/pw') return ctx.pixelUpgrade(req, socket, head);
  // DM のリアルタイム (オンライン・入力中・既読・新着)。本人確認が必要
  if (u.pathname === '/rt') {
    const rtUser = userFromReq(req);
    if (!rtUser) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    return ctx.realtimeUpgrade(req, socket, head, rtUser);
  }
  // 競走馬版のレース。本人確認が必要
  if (u.pathname === '/rc') {
    const rcUser = userFromReq(req);
    if (!rcUser) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    return ctx.raceUpgrade(req, socket, head, rcUser);
  }
  // レート戦ポーカー。本人確認が必要
  if (u.pathname === '/pk') {
    const pkUser = userFromReq(req);
    if (!pkUser) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    return ctx.pokerUpgrade(req, socket, head, pkUser);
  }
  // ぶんぼうぐバトラーズの対戦。本人確認が必要
  if (u.pathname === '/cb') {
    const cbUser = userFromReq(req);
    if (!cbUser) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    return ctx.cardsUpgrade(req, socket, head, cbUser);
  }
  const user = userFromReq(req);
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => vb.handleConnection(ws, u.searchParams.get('url'), user.id, {
    mobile: u.searchParams.get('m') === '1', width: u.searchParams.get('w'), height: u.searchParams.get('h'),
  }));
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`IppO running on http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await vb.shutdown(); process.exit(0); });
