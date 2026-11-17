// =====================================================================
// リアルタイム (DM のオンライン表示・入力中・既読・新着メッセージの即時配信)
//
// ・ログイン中のアプリは WebSocket (/rt) でサーバーとつながる。つながっている間を「オンライン」とする
// ・プライバシー: 「オンライン・入力中」「既読」はそれぞれ設定で隠せる。
//   隠した人は、相手の同じ情報も見られない (お互いさま)
// ・サーバーから送るだけでなく、クライアントからは「入力中」の合図だけを受け付ける
// =====================================================================
const { WebSocketServer } = require('ws');

const MIGRATION = `
CREATE TABLE user_privacy (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_presence INTEGER NOT NULL DEFAULT 1,  -- オンライン・入力中を相手に見せる
  show_read INTEGER NOT NULL DEFAULT 1       -- 既読を相手に見せる
);
`;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-17-dm-presence', MIGRATION);

  const qPrivacy = db.prepare('SELECT show_presence, show_read FROM user_privacy WHERE user_id = ?');
  const privacy = (userId) => { const r = qPrivacy.get(userId); return { presence: r ? !!r.show_presence : true, read: r ? !!r.show_read : true }; };
  // 見る人・見られる人の両方が許可している時だけ見せる
  const canSeePresence = (viewerId, targetId) => privacy(viewerId).presence && privacy(targetId).presence;
  const canSeeRead = (viewerId, targetId) => privacy(viewerId).read && privacy(targetId).read;

  // ---------- 接続の管理 ----------
  const sockets = new Map();   // userId → Set<ws>
  const lastSeen = new Map();  // userId → 最後にオンラインだった時刻 (サーバーのメモリ上だけ)
  const isOnline = (userId) => (sockets.get(userId)?.size || 0) > 0;
  const sendTo = (userId, msg) => { const set = sockets.get(userId); if (!set) return; const s = JSON.stringify(msg); for (const ws of set) if (ws.readyState === 1) ws.send(s); };
  const usernameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  // オンライン状態が変わったら、その人の会話画面を開いている人 (watch している人) に知らせる
  function announcePresence(userId) {
    const name = usernameOf(userId);
    if (!name) return;
    for (const [viewerId, set] of sockets) {
      if (viewerId === userId) continue;
      for (const ws of set) {
        // 見せない設定の時も「不明 (null)」を送り、表示を消してもらう
        if (ws.watching === userId && ws.readyState === 1) {
          ws.send(JSON.stringify({ t: 'presence', user: name, ...presenceOf(viewerId, userId) }));
        }
      }
    }
  }
  function presenceOf(viewerId, targetId) {
    if (!canSeePresence(viewerId, targetId)) return { online: null, lastSeenAt: null };
    return { online: isOnline(targetId), lastSeenAt: isOnline(targetId) ? null : lastSeen.get(targetId) || null };
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 });
  wss.on('connection', (ws, req, user) => {
    ws.userId = user.id;
    ws.alive = true;
    ws.typingAt = 0;
    const first = !isOnline(user.id);
    if (!sockets.has(user.id)) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    if (first) announcePresence(user.id);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.t === 'watch') {
        // 会話画面を開いた相手 (この相手のオンライン状態の変化を受け取る)
        const peer = db.prepare('SELECT id FROM users WHERE username = ?').get(String(m.user || ''));
        ws.watching = peer && peer.id !== user.id ? peer.id : null;
        if (ws.watching) ws.send(JSON.stringify({ t: 'presence', user: m.user, ...presenceOf(user.id, ws.watching) }));
      } else if (m.t === 'typing') {
        // 入力中の合図: 0.4 秒に 1 回まで (画面側でも 2.5 秒に 1 回に抑えている)。両方が「オンライン・入力中」を許可している時だけ相手に届ける
        const now = Date.now();
        if (now - ws.typingAt < 400) return;
        ws.typingAt = now;
        const peer = db.prepare('SELECT id FROM users WHERE username = ?').get(String(m.to || ''));
        if (!peer || peer.id === user.id || !canSeePresence(peer.id, user.id)) return;
        sendTo(peer.id, { t: 'typing', from: user.username });
      }
    });
    ws.on('close', () => {
      const set = sockets.get(user.id);
      if (set) { set.delete(ws); if (!set.size) { sockets.delete(user.id); lastSeen.set(user.id, Date.now()); announcePresence(user.id); } }
    });
    ws.send(JSON.stringify({ t: 'hello' }));
  });
  setInterval(() => {
    for (const set of sockets.values()) for (const ws of set) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} }
  }, 30_000).unref();

  // /rt への接続 (ログインが必要)
  ctx.realtimeUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));

  // ---------- DM から呼ばれる通知 ----------
  ctx.rt = {
    presenceOf,
    broadcast(msg) { const s = JSON.stringify(msg); for (const set of sockets.values()) for (const ws of set) if (ws.readyState === 1) ws.send(s); },
    sendToUsers(ids, msg) { for (const id of new Set(ids)) sendTo(id, msg); },
    // 相手が自分のメッセージをどこまで読んだか (見せてよい時だけ)
    readByPeer(viewerId, peerId) {
      if (!canSeeRead(viewerId, peerId)) return null;
      return db.prepare('SELECT last_read_id FROM dm_reads WHERE user_id = ? AND peer_id = ?').get(peerId, viewerId)?.last_read_id || 0;
    },
    // 新しいメッセージを、受け取る人と送った人の他の端末に即時配信
    dmSent(sender, recipient, message, out) {
      sendTo(recipient.id, { t: 'dm', from: sender.username, message: out(message, recipient) });
      sendTo(sender.id, { t: 'dm', to: recipient.username, message: out(message, sender) });
    },
    // 読んだことを相手に知らせる (両方が既読表示を許可している時だけ)
    read(reader, peer, lastReadId) {
      if (canSeeRead(peer.id, reader.id)) sendTo(peer.id, { t: 'read', by: reader.username, lastReadId });
    },
  };

  // ---------- プライバシー設定 ----------
  app.get('/api/me/privacy', requireAuth, (req, res) => {
    const p = privacy(req.user.id);
    res.json({ showPresence: p.presence, showRead: p.read });
  });
  const privLimit = rateLimit({ windowMs: 60_000, max: 30, key: (req) => 'pv' + req.user.id });
  app.patch('/api/me/privacy', requireAuth, privLimit, (req, res) => {
    const cur = privacy(req.user.id);
    const presence = typeof req.body?.showPresence === 'boolean' ? req.body.showPresence : cur.presence;
    const read = typeof req.body?.showRead === 'boolean' ? req.body.showRead : cur.read;
    db.prepare(`INSERT INTO user_privacy (user_id, show_presence, show_read) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET show_presence = excluded.show_presence, show_read = excluded.show_read`).run(req.user.id, presence ? 1 : 0, read ? 1 : 0);
    if (presence !== cur.presence) announcePresence(req.user.id);
    res.json({ showPresence: presence, showRead: read });
  });
};
