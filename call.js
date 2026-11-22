// =====================================================================
// 音声通話 (1 対 1・WebRTC)
//   ・音声はブラウザどうしが直接つなぐ (WebRTC)。サーバーは「かける・出る・切る」と、つなぐための情報 (SDP・ICE) を中継するだけ。音声はサーバーを通らない
//   ・合図は DM のリアルタイム接続 (/rt) で送る (realtime.js が call- で始まるメッセージをここに渡す)
//   ・かけられる相手: 自分に DM を送ってくれたことがある人か、自分をフォローしている人だけ (知らない人からいきなりかかってこないように)
//   ・同時に 1 つの通話だけ。呼び出しは 30 秒で「不在着信」。通話の記録 (不在着信・通話時間) は DM の会話に残る
//   ・つながりにくい回線のための中継サーバー (TURN) は環境変数 TURN_URL・TURN_USER・TURN_PASS (なければ STUN だけ)
// =====================================================================
const crypto = require('crypto');

const RING_MS = 30_000, MAX_SIGNAL = 12 * 1024, MAX_CALL_MS = 3 * 3600_000;

module.exports = function install(app, ctx) {
  const { db, requireAuth } = ctx;
  const calls = new Map();   // id → { id, from, to, fromWs, toWs, state: 'ringing' | 'active', at, startedAt, timer }
  const byUser = new Map();  // userId → callId
  const qUser = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?');
  const qByName = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?');
  const qDmFrom = db.prepare('SELECT 1 FROM dm_messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1');
  const qFollows = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?');
  // かけてよい相手か: 相手が自分に DM を送ったことがある・または相手が自分をフォローしている
  const canCall = (fromId, toId) => !!(qDmFrom.get(toId, fromId) || qFollows.get(toId, fromId));
  const view = (u) => ({ username: u.username, displayName: u.display_name || u.username });
  const sendWs = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  // 通話の記録を DM に残す (かけた人から相手への 1 通として)
  function logToDm(c, text) {
    try {
      const r = db.prepare('INSERT INTO dm_messages (sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?)').run(c.from, c.to, text, Date.now());
      const row = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(r.lastInsertRowid);
      const a = qUser.get(c.from), b = qUser.get(c.to);
      if (a && b && ctx.dmOut) ctx.rt.dmSent(a, b, row, ctx.dmOut);
    } catch (e) { console.error('[call] 記録に失敗', e.message); }
  }
  const fmtDur = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function end(c, reason, by = null) {
    if (!calls.has(c.id)) return;
    calls.delete(c.id); clearTimeout(c.timer);
    if (byUser.get(c.from) === c.id) byUser.delete(c.from);
    if (byUser.get(c.to) === c.id) byUser.delete(c.to);
    const msg = { t: 'call-end', id: c.id, reason };
    sendWs(c.fromWs, msg);
    if (c.toWs) sendWs(c.toWs, msg); else ctx.rt.sendToUsers([c.to], msg); // まだ出ていなければ、相手の全部の端末の呼び出しを止める
    if (c.state === 'active') logToDm(c, `📞 音声通話 ${fmtDur(Date.now() - c.startedAt)}`);
    else if (reason === 'missed' || reason === 'canceled') logToDm(c, '📞 不在着信');
    else if (reason === 'declined') logToDm(c, '📞 通話に出られませんでした');
  }
  const mine = (ws, id) => { const c = calls.get(String(id || '')); return c && (c.fromWs === ws || c.toWs === ws || (c.state === 'ringing' && ws.userId === c.to)) ? c : null; };

  // realtime.js から呼ばれる (call- で始まるメッセージ)
  ctx.callMessage = (ws, user, m) => {
    const now = Date.now();
    ws.callMsgs = (ws.callWin && now - ws.callWin < 1000) ? (ws.callMsgs || 0) + 1 : 1; if (ws.callMsgs === 1) ws.callWin = now;
    if (ws.callMsgs > 60) return; // 1 秒に 60 通まで (ICE の候補はまとめて来るので少し多め)
    if (m.t === 'call-invite') {
      const peer = qByName.get(String(m.to || ''));
      if (!peer || peer.id === user.id) return sendWs(ws, { t: 'call-fail', reason: 'nouser' });
      if (!canCall(user.id, peer.id)) return sendWs(ws, { t: 'call-fail', reason: 'notallowed' });
      if (byUser.has(user.id)) return sendWs(ws, { t: 'call-fail', reason: 'self-busy' });
      if (byUser.has(peer.id)) return sendWs(ws, { t: 'call-fail', reason: 'busy' });
      if (!ctx.rt.isOnline(peer.id)) { logToDm({ from: user.id, to: peer.id }, '📞 不在着信'); return sendWs(ws, { t: 'call-fail', reason: 'offline' }); }
      const c = { id: crypto.randomBytes(9).toString('base64url'), from: user.id, to: peer.id, fromWs: ws, toWs: null, state: 'ringing', at: now };
      calls.set(c.id, c); byUser.set(user.id, c.id); byUser.set(peer.id, c.id);
      c.timer = setTimeout(() => end(c, 'missed'), RING_MS);
      sendWs(ws, { t: 'call-ringing', id: c.id, peer: view(peer) });
      ctx.rt.sendToUsers([peer.id], { t: 'call-incoming', id: c.id, from: view(qUser.get(user.id)) });
      return;
    }
    const c = mine(ws, m.id); if (!c) return;
    if (m.t === 'call-accept') {
      if (c.state !== 'ringing' || ws.userId !== c.to) return;
      c.state = 'active'; c.toWs = ws; c.startedAt = now; clearTimeout(c.timer);
      c.timer = setTimeout(() => end(c, 'limit'), MAX_CALL_MS);
      sendWs(c.fromWs, { t: 'call-accepted', id: c.id });
      ctx.rt.sendToUsersExcept([c.to], ws, { t: 'call-end', id: c.id, reason: 'elsewhere' }); // ほかの端末の呼び出しを止める
    } else if (m.t === 'call-decline') {
      if (c.state === 'ringing' && ws.userId === c.to) end(c, 'declined');
    } else if (m.t === 'call-hangup') {
      end(c, c.state === 'ringing' && ws === c.fromWs ? 'canceled' : 'hangup');
    } else if (m.t === 'call-signal') {
      if (c.state !== 'active') return;
      const data = m.data;
      if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_SIGNAL) return;
      const out = {};
      if (data.sdp && typeof data.sdp === 'object' && ['offer', 'answer'].includes(data.sdp.type) && typeof data.sdp.sdp === 'string') out.sdp = { type: data.sdp.type, sdp: data.sdp.sdp };
      if (data.candidate && typeof data.candidate === 'object') out.candidate = { candidate: String(data.candidate.candidate || ''), sdpMid: data.candidate.sdpMid == null ? null : String(data.candidate.sdpMid), sdpMLineIndex: Number.isInteger(data.candidate.sdpMLineIndex) ? data.candidate.sdpMLineIndex : null };
      if (!out.sdp && !out.candidate) return;
      sendWs(ws === c.fromWs ? c.toWs : c.fromWs, { t: 'call-signal', id: c.id, data: out });
    }
  };
  // 接続が切れたら、その接続の通話は終わり (呼び出し中の相手が別の端末で出られるよう、出る前の切断は無視)
  ctx.callClosed = (ws) => { for (const c of [...calls.values()]) if (c.fromWs === ws || c.toWs === ws) end(c, 'dropped'); };

  // 通話の設定 (STUN / TURN)。ログインが必要
  app.get('/api/call/config', requireAuth, (req, res) => {
    const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
    res.json({ iceServers: ice, ringMs: RING_MS });
  });
  // この相手にかけられるか (DM の画面の 📞 ボタン用)
  app.get('/api/call/can/:username', requireAuth, (req, res) => {
    const peer = qByName.get(req.params.username);
    if (!peer || peer.id === req.user.id) return res.json({ ok: false });
    res.json({ ok: canCall(req.user.id, peer.id), online: ctx.rt.isOnline(peer.id) });
  });
  ctx.callDebug = { calls, byUser };
};
