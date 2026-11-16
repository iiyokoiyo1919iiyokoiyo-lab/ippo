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
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));

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

const publicUser = (u) => u && { id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, createdAt: u.created_at };

app.post('/api/register', authLimit, (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!/^[A-Za-z0-9_]{3,15}$/.test(username || '')) return res.status(400).json({ error: 'ユーザー名は英数字と_で3〜15文字です' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
  const name = String(displayName || username).trim().slice(0, 50) || username;
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const r = db.prepare('INSERT INTO users (username, display_name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username, name, hashPw(password, salt), salt, Date.now());
    createSession(req, res, Number(r.lastInsertRowid));
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  } catch {
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
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).ippo_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'ippo_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- 投稿の整形 ----------
const qPost = db.prepare('SELECT * FROM posts WHERE id = ?');
const qUser = db.prepare('SELECT * FROM users WHERE id = ?');
const qCounts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM likes WHERE post_id = $id) AS likes,
  (SELECT COUNT(*) FROM posts WHERE repost_of = $id) AS reposts,
  (SELECT COUNT(*) FROM posts WHERE reply_to = $id) AS replies,
  EXISTS(SELECT 1 FROM likes WHERE post_id = $id AND user_id = $me) AS liked,
  EXISTS(SELECT 1 FROM posts WHERE repost_of = $id AND user_id = $me) AS reposted`);

function hydrate(row, me) {
  if (!row) return null;
  if (row.repost_of) {
    const orig = hydrate(qPost.get(row.repost_of), me);
    if (!orig) return null;
    return { id: row.id, type: 'repost', createdAt: row.created_at, by: publicUser(qUser.get(row.user_id)), post: orig };
  }
  const c = qCounts.get({ $id: row.id, $me: me ? me.id : 0 });
  let replyToUser = null;
  if (row.reply_to) {
    const parent = qPost.get(row.reply_to);
    if (parent) replyToUser = qUser.get(parent.user_id)?.username || null;
  }
  return {
    id: row.id, type: 'post', content: row.content, createdAt: row.created_at, replyTo: row.reply_to, replyToUser,
    author: publicUser(qUser.get(row.user_id)),
    counts: { likes: c.likes, reposts: c.reposts, replies: c.replies },
    liked: !!c.liked, reposted: !!c.reposted,
  };
}
const hydrateAll = (rows, me) => rows.map((r) => hydrate(r, me)).filter(Boolean);
const beforeId = (req) => Number(req.query.before) || Number.MAX_SAFE_INTEGER;

// ---------- タイムライン ----------
app.get('/api/timeline', (req, res) => {
  const following = req.query.mode === 'following' && req.user;
  const rows = following
    ? db.prepare(`SELECT * FROM posts WHERE id < ? AND (user_id = ? OR user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
        ORDER BY id DESC LIMIT 30`).all(beforeId(req), req.user.id, req.user.id)
    : db.prepare('SELECT * FROM posts WHERE id < ? AND reply_to IS NULL ORDER BY id DESC LIMIT 30').all(beforeId(req));
  res.json({ posts: hydrateAll(rows, req.user) });
});

app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ posts: [], users: [] });
  const like = '%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
  const posts = db.prepare(`SELECT * FROM posts WHERE repost_of IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 30`).all(like);
  const users = db.prepare(`SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 10`).all(like, like);
  res.json({ posts: hydrateAll(posts, req.user), users: users.map(publicUser) });
});

// ---------- 投稿 ----------
app.post('/api/posts', requireAuth, writeLimit, (req, res) => {
  const content = String(req.body?.content || '').trim();
  const replyTo = req.body?.replyTo ? Number(req.body.replyTo) : null;
  if (!content) return res.status(400).json({ error: '本文を入力してください' });
  if ([...content].length > 280) return res.status(400).json({ error: '280文字以内で投稿してください' });
  if (replyTo && !qPost.get(replyTo)) return res.status(404).json({ error: '返信先が見つかりません' });
  const r = db.prepare('INSERT INTO posts (user_id, content, reply_to, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, content, replyTo, Date.now());
  res.json({ post: hydrate(qPost.get(r.lastInsertRowid), req.user) });
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
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
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
  res.json({ user: profile(u, req.user), posts: hydrateAll(rows, req.user) });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const name = String(req.body?.displayName ?? req.user.display_name).trim().slice(0, 50) || req.user.username;
  const bio = String(req.body?.bio ?? req.user.bio).slice(0, 160);
  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.id);
  res.json({ user: publicUser(qUser.get(req.user.id)) });
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

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- 仮想ブラウザ WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/vb') return socket.destroy();
  // CSRF 的な他サイトからの接続を拒否
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
  const user = userFromReq(req);
  if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => vb.handleConnection(ws, u.searchParams.get('url'), user.id, {
    mobile: u.searchParams.get('m') === '1', width: u.searchParams.get('w'), height: u.searchParams.get('h'),
  }));
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`IppO running on http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await vb.shutdown(); process.exit(0); });
