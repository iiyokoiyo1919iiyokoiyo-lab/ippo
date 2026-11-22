// =====================================================================
// 音声通話 (1 対 1 とグループ・WebRTC)
//   ・音声はブラウザどうしが直接つなぐ (WebRTC。グループは全員がおたがいにつなぐ「メッシュ」で、最大 6 人)。
//     サーバーは「かける・出る・切る」と、つなぐための情報 (SDP・ICE) を中継するだけ。音声はサーバーを通らない
//   ・合図は DM のリアルタイム接続 (/rt) で送る (realtime.js が call- で始まるメッセージをここに渡す)
//   ・通話は「ルーム」。かけた人がルームを作り、相手を呼ぶ。通話中に「＋」でほかの人も呼べる
//   ・呼べる相手: 呼ぶ人に DM を送ったことがある人か、呼ぶ人をフォローしている人だけ (知らない人からいきなりかかってこないように)
//   ・バックグラウンド: アプリが閉じていたり裏にいたりしても、Web プッシュ (push.js) で着信を知らせる。
//     画面が裏に回って /rt が切れても、音声は直接つながっているので通話は続く (45 秒いないに /rt がつながり直せばそのまま)
//   ・呼び出しは 30 秒で「不在着信」。1 対 1 の通話の記録 (通話時間・不在着信) は DM の会話に残る
//   ・つながりにくい回線のための中継サーバー (TURN) は環境変数 TURN_URL・TURN_USER・TURN_PASS (なければ STUN だけ)
// =====================================================================
const crypto = require('crypto');

const RING_MS = 30_000, MAX_SIGNAL = 12 * 1024, MAX_CALL_MS = 3 * 3600_000, MAX_MEMBERS = 6, GRACE_MS = 45_000;

module.exports = function install(app, ctx) {
  const { db, requireAuth } = ctx;
  const rooms = new Map();   // id → { id, host, members: Map<userId, { ws, at, grace }>, invites: Map<userId, { by, timer }>, ever: Set<userId>, startedAt, limit }
  const roomOf = new Map();  // userId → roomId (ルームに入っている人)
  const qUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?');
  const qByName = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?');
  const qDmFrom = db.prepare('SELECT 1 FROM dm_messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1');
  const qFollows = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?');
  // 呼んでよい相手か: 相手が呼ぶ人に DM を送ったことがある・または相手が呼ぶ人をフォローしている
  const canCall = (fromId, toId) => !!(qDmFrom.get(toId, fromId) || qFollows.get(toId, fromId));
  const view = (id) => { const u = qUser.get(id); return u ? { username: u.username, displayName: u.display_name || u.username } : null; };
  const sendWs = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const toMembers = (r, m, except = null) => { for (const [uid, mem] of r.members) if (uid !== except) sendWs(mem.ws, m); };
  const membersView = (r) => [...r.members.keys()].map(view).filter(Boolean);
  const invitedView = (r) => [...r.invites.keys()].map(view).filter(Boolean);

  // 通話の記録を DM に残す (a から b への 1 通として)
  function logToDm(a, b, text) {
    try {
      const r = db.prepare('INSERT INTO dm_messages (sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?)').run(a, b, text, Date.now());
      const row = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(r.lastInsertRowid);
      const ua = qUser.get(a), ub = qUser.get(b);
      if (ua && ub && ctx.dmOut) ctx.rt.dmSent(ua, ub, row, ctx.dmOut);
    } catch (e) { console.error('[call] 記録に失敗', e.message); }
  }
  const fmtDur = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function closeRoom(r, reason) {
    if (!rooms.has(r.id)) return;
    rooms.delete(r.id); clearTimeout(r.limit);
    for (const [uid, inv] of r.invites) { clearTimeout(inv.timer); ctx.rt.sendToUsers([uid], { t: 'call-end', id: r.id, reason: 'canceled' }); if (r.ever.size <= 1) logToDm(inv.by, uid, '📞 不在着信'); }
    r.invites.clear();
    for (const [uid, mem] of r.members) { clearTimeout(mem.grace); sendWs(mem.ws, { t: 'call-end', id: r.id, reason }); if (roomOf.get(uid) === r.id) roomOf.delete(uid); }
    // 1 対 1 だった通話は、通話時間を DM に残す
    if (r.ever.size === 2 && r.startedAt) { const [a, b] = [...r.ever]; logToDm(a, b, `📞 音声通話 ${fmtDur(Date.now() - r.startedAt)}`); }
  }
  // 1 人しか残っていなくて、呼んでいる人もいなければ終わり
  function settle(r, reason) { if (r.members.size + r.invites.size <= 1 || r.members.size === 0) closeRoom(r, reason); }
  function leave(r, uid, reason = 'hangup') {
    const mem = r.members.get(uid); if (!mem) return;
    clearTimeout(mem.grace); r.members.delete(uid); if (roomOf.get(uid) === r.id) roomOf.delete(uid);
    toMembers(r, { t: 'call-peer-leave', id: r.id, user: view(uid), reason });
    settle(r, 'hangup');
  }
  function invite(r, byId, peer) {
    if (r.members.has(peer.id) || r.invites.has(peer.id)) return 'already';
    if (r.members.size + r.invites.size >= MAX_MEMBERS) return 'full';
    if (!canCall(byId, peer.id)) return 'notallowed';
    if (roomOf.has(peer.id)) return 'busy';
    const online = ctx.rt.isOnline(peer.id), pushable = ctx.push?.has(peer.id);
    if (!online && !pushable) { logToDm(byId, peer.id, '📞 不在着信'); return 'offline'; }
    const inv = { by: byId, timer: setTimeout(() => { r.invites.delete(peer.id); ctx.rt.sendToUsers([peer.id], { t: 'call-end', id: r.id, reason: 'missed' }); toMembers(r, { t: 'call-invite-end', id: r.id, user: view(peer.id), reason: 'missed' }); logToDm(byId, peer.id, '📞 不在着信'); settle(r, 'missed'); }, RING_MS) };
    r.invites.set(peer.id, inv);
    const from = view(byId), msg = { t: 'call-incoming', id: r.id, from, members: membersView(r) };
    ctx.rt.sendToUsers([peer.id], msg);
    // アプリが閉じていたり裏にいたりしても気づけるように、プッシュ通知も送る
    ctx.push?.send(peer.id, { kind: 'call', id: r.id, title: '📞 IppO 着信', body: r.members.size > 1 ? `${from.displayName} さんからグループ通話 (${r.members.size} 人)` : `${from.displayName} さんから音声通話`, url: `/#/dm/${encodeURIComponent(from.username)}` }, { ttl: 30 }).catch(() => {});
    toMembers(r, { t: 'call-invited', id: r.id, user: view(peer.id) });
    return null;
  }
  const myRoom = (ws, id) => { const r = rooms.get(String(id || '')); return r && r.members.get(ws.userId)?.ws === ws ? r : null; };

  // realtime.js から呼ばれる (call- で始まるメッセージ)
  ctx.callMessage = (ws, user, m) => {
    const now = Date.now();
    ws.callMsgs = (ws.callWin && now - ws.callWin < 1000) ? (ws.callMsgs || 0) + 1 : 1; if (ws.callMsgs === 1) ws.callWin = now;
    if (ws.callMsgs > 80) return; // 1 秒に 80 通まで (グループは ICE の候補が多い)
    if (m.t === 'call-invite') {
      const names = (Array.isArray(m.to) ? m.to : [m.to]).slice(0, MAX_MEMBERS).map((x) => String(x || ''));
      let r = m.id ? myRoom(ws, m.id) : null;
      if (m.id && !r) return sendWs(ws, { t: 'call-fail', reason: 'noroom' });
      if (!r) {
        if (roomOf.has(user.id)) return sendWs(ws, { t: 'call-fail', reason: 'self-busy' });
        r = { id: crypto.randomBytes(9).toString('base64url'), host: user.id, members: new Map([[user.id, { ws, at: now }]]), invites: new Map(), ever: new Set([user.id]), startedAt: 0 };
        rooms.set(r.id, r); roomOf.set(user.id, r.id);
        r.limit = setTimeout(() => closeRoom(r, 'limit'), MAX_CALL_MS);
        sendWs(ws, { t: 'call-room', id: r.id });
      }
      for (const name of names) {
        const peer = qByName.get(name);
        const err = !peer || peer.id === user.id ? 'nouser' : invite(r, user.id, peer);
        if (err) sendWs(ws, { t: 'call-fail', id: r.id, user: peer ? view(peer.id) : { username: name, displayName: name }, reason: err });
      }
      settle(r, 'failed');
      return;
    }
    const r = rooms.get(String(m.id || '')); if (!r) return sendWs(ws, { t: 'call-end', id: m.id, reason: 'gone' });
    if (m.t === 'call-accept') {
      if (!r.invites.has(user.id)) return;
      if (roomOf.has(user.id)) return sendWs(ws, { t: 'call-fail', id: r.id, reason: 'self-busy' });
      clearTimeout(r.invites.get(user.id).timer); r.invites.delete(user.id);
      const others = membersView(r);
      r.members.set(user.id, { ws, at: now }); r.ever.add(user.id); roomOf.set(user.id, r.id);
      if (!r.startedAt) r.startedAt = now;
      sendWs(ws, { t: 'call-joined', id: r.id, members: others, invited: invitedView(r) }); // 入った人が、いる人みんなにつなぎに行く
      toMembers(r, { t: 'call-peer-join', id: r.id, user: view(user.id) }, user.id);
      ctx.rt.sendToUsersExcept([user.id], ws, { t: 'call-end', id: r.id, reason: 'elsewhere' }); // ほかの端末の呼び出しを止める
    } else if (m.t === 'call-decline') {
      const inv = r.invites.get(user.id); if (!inv) return;
      clearTimeout(inv.timer); r.invites.delete(user.id);
      ctx.rt.sendToUsersExcept([user.id], ws, { t: 'call-end', id: r.id, reason: 'declined-here' });
      toMembers(r, { t: 'call-invite-end', id: r.id, user: view(user.id), reason: 'declined' });
      if (r.ever.size <= 1) logToDm(inv.by, user.id, '📞 通話に出られませんでした');
      settle(r, 'declined');
    } else if (m.t === 'call-hangup') {
      if (r.members.get(user.id)?.ws === ws) leave(r, user.id, 'hangup');
    } else if (m.t === 'call-resume') {
      // /rt がつながり直した: 新しい接続をルームの自分につけ直す (音声は直接つながっているので、そのまま続く)
      const mem = r.members.get(user.id); if (!mem) return sendWs(ws, { t: 'call-end', id: r.id, reason: 'gone' });
      clearTimeout(mem.grace); mem.grace = null; mem.ws = ws;
      sendWs(ws, { t: 'call-resumed', id: r.id, members: membersView(r).filter((u) => u.username !== user.username), invited: invitedView(r) });
    } else if (m.t === 'call-signal') {
      if (r.members.get(user.id)?.ws !== ws) return;
      const to = qByName.get(String(m.to || '')); const tm = to && r.members.get(to.id); if (!tm || to.id === user.id) return;
      const data = m.data;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_SIGNAL) return;
      const out = {};
      if (data.sdp && typeof data.sdp === 'object' && ['offer', 'answer'].includes(data.sdp.type) && typeof data.sdp.sdp === 'string') out.sdp = { type: data.sdp.type, sdp: data.sdp.sdp };
      if (data.candidate && typeof data.candidate === 'object') out.candidate = { candidate: String(data.candidate.candidate || ''), sdpMid: data.candidate.sdpMid == null ? null : String(data.candidate.sdpMid), sdpMLineIndex: Number.isInteger(data.candidate.sdpMLineIndex) ? data.candidate.sdpMLineIndex : null };
      if (data.muted !== undefined) out.muted = !!data.muted;
      if (!out.sdp && !out.candidate && out.muted === undefined) return;
      sendWs(tm.ws, { t: 'call-signal', id: r.id, from: user.username, data: out });
    }
  };
  // /rt がつながったとき: 呼ばれている途中のルームがあれば、もう一度知らせる (プッシュ通知から開いたとき)
  ctx.callOnConnect = (ws, user) => {
    for (const r of rooms.values()) if (r.invites.has(user.id)) sendWs(ws, { t: 'call-incoming', id: r.id, from: view(r.invites.get(user.id).by), members: membersView(r) });
  };
  // 接続が切れた: その接続でルームに入っていたら、45 秒だけ待つ (裏に回った・電波が切れた。音声は直接つながっている)
  ctx.callClosed = (ws) => {
    const id = roomOf.get(ws.userId), r = id && rooms.get(id), mem = r?.members.get(ws.userId);
    if (!mem || mem.ws !== ws) return;
    mem.grace = setTimeout(() => leave(r, ws.userId, 'dropped'), GRACE_MS);
  };

  // 通話の設定 (STUN / TURN)。ログインが必要
  app.get('/api/call/config', requireAuth, (req, res) => {
    const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
    res.json({ iceServers: ice, ringMs: RING_MS, maxMembers: MAX_MEMBERS });
  });
  // この相手にかけられるか (DM の画面の 📞 ボタン用)
  app.get('/api/call/can/:username', requireAuth, (req, res) => {
    const peer = qByName.get(req.params.username);
    if (!peer || peer.id === req.user.id) return res.json({ ok: false });
    res.json({ ok: canCall(req.user.id, peer.id), online: ctx.rt.isOnline(peer.id) });
  });
  // 通話に呼べる人の一覧 (「＋ 呼ぶ」用): 最近 DM した相手のうち、呼べる人
  app.get('/api/call/candidates', requireAuth, (req, res) => {
    const me = req.user.id;
    const rows = db.prepare(`SELECT peer, MAX(id) AS last FROM (SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS peer, id FROM dm_messages WHERE sender_id = ? OR recipient_id = ?)
      GROUP BY peer ORDER BY last DESC LIMIT 40`).all(me, me, me);
    res.json({ users: rows.filter((r) => r.peer !== me && canCall(me, r.peer)).map((r) => ({ ...view(r.peer), online: !!ctx.rt.presenceOf(me, r.peer).online, busy: roomOf.has(r.peer) })).filter((u) => u.username) });
  });
  ctx.callDebug = { rooms, roomOf };
};
