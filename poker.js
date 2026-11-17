// =====================================================================
// ミニゲーム「レート戦ポーカー」 (1 対 1 のテキサスホールデム・ノーリミット)
//
// ・お金やコインは一切賭けない。チップはその試合の中だけ (1000 から始めて、どちらかがなくなるまで)
//   勝ち負けで動くのはレートだけ (ランダム対戦のみ)
// ・カードを配る・勝ち負けを決めるのはすべてサーバー。相手の手札はショーダウンまで端末に送らない
// ・ブラインドは 5 ハンドごとに上がる。1 回の行動は 30 秒まで (過ぎたらチェック、できなければフォールド)
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---------- カードと役 ----------
// カードは 0〜51 の数字。rank = c % 13 (0 = 2 … 12 = A)、suit = c / 13 の商 (0 ♠ 1 ♥ 2 ♦ 3 ♣)
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const HAND_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];
const cardStr = (c) => RANKS[c % 13] + SUITS[Math.floor(c / 13)];

// 並んだ数字の中の、いちばん強いストレートの一番上 (なければ -1)。A-2-3-4-5 も数える
function topStraight(set) {
  for (let hi = 12; hi >= 4; hi--) if ([0, 1, 2, 3, 4].every((k) => set.has(hi - k))) return hi;
  return [12, 0, 1, 2, 3].every((r) => set.has(r)) ? 3 : -1; // A-2-3-4-5 (5 が一番上)
}
// 5〜7 枚から、いちばん強い 5 枚の強さを数字で返す (大きいほど強い)。name は役の名前
function evaluate(cards) {
  const byRank = Array.from({ length: 13 }, () => 0), bySuit = [[], [], [], []];
  for (const c of cards) { byRank[c % 13]++; bySuit[Math.floor(c / 13)].push(c % 13); }
  const score = (cat, ks) => { let s = cat; for (let i = 0; i < 5; i++) s = s * 13 + (ks[i] ?? 0); return s; };
  const flush = bySuit.find((s) => s.length >= 5);
  if (flush) {
    const sf = topStraight(new Set(flush));
    if (sf >= 0) return { score: score(8, [sf]), cat: 8, name: sf === 12 ? 'ロイヤルフラッシュ' : HAND_NAMES[8] };
  }
  const groups = []; for (let r = 12; r >= 0; r--) if (byRank[r]) groups.push([byRank[r], r]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kick = (skip, n) => groups.filter(([, r]) => !skip.includes(r)).map(([, r]) => r).slice(0, n);
  if (groups[0][0] === 4) return { score: score(7, [groups[0][1], ...kick([groups[0][1]], 1)]), cat: 7, name: HAND_NAMES[7] };
  if (groups[0][0] === 3 && groups[1] && groups[1][0] >= 2) return { score: score(6, [groups[0][1], groups[1][1]]), cat: 6, name: HAND_NAMES[6] };
  if (flush) return { score: score(5, flush.sort((a, b) => b - a).slice(0, 5)), cat: 5, name: HAND_NAMES[5] };
  const st = topStraight(new Set(cards.map((c) => c % 13)));
  if (st >= 0) return { score: score(4, [st]), cat: 4, name: HAND_NAMES[4] };
  if (groups[0][0] === 3) return { score: score(3, [groups[0][1], ...kick([groups[0][1]], 2)]), cat: 3, name: HAND_NAMES[3] };
  if (groups[0][0] === 2 && groups[1] && groups[1][0] === 2) { const a = groups[0][1], b = groups[1][1]; return { score: score(2, [a, b, ...kick([a, b], 1)]), cat: 2, name: HAND_NAMES[2] }; }
  if (groups[0][0] === 2) return { score: score(1, [groups[0][1], ...kick([groups[0][1]], 3)]), cat: 1, name: HAND_NAMES[1] };
  return { score: score(0, kick([], 5)), cat: 0, name: HAND_NAMES[0] };
}
const shuffled = (rnd) => { const d = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };

// ---------- 1 試合の進行 (サーバーのメモリ上) ----------
const START_STACK = 1000;
const BLINDS = [[10, 20], [20, 40], [30, 60], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000]];
const HANDS_PER_LEVEL = 5;
function newMatch(rnd) { return { rnd, hand: 0, button: rnd() < 0.5 ? 0 : 1, stacks: [START_STACK, START_STACK], over: false }; }
function blindsOf(m) { return BLINDS[Math.min(BLINDS.length - 1, Math.floor((m.hand - 1) / HANDS_PER_LEVEL))]; }
function startHand(m) {
  m.hand++; m.button = 1 - m.button;
  const [sb, bb] = blindsOf(m);
  const deck = shuffled(m.rnd);
  const h = m.h = { sb, bb, deck, hole: [[deck.pop(), deck.pop()], [deck.pop(), deck.pop()]], board: [], street: 0, bets: [0, 0], contrib: [0, 0], acted: [false, false], folded: -1, minRaise: bb, toAct: m.button, last: [null, null], done: false, result: null };
  const post = (p, amt) => { const a = Math.min(amt, m.stacks[p]); m.stacks[p] -= a; h.bets[p] += a; };
  post(m.button, sb); post(1 - m.button, bb);
  h.last[m.button] = `SB ${sb}`; h.last[1 - m.button] = `BB ${bb}`;
  settleIfNoAction(m);
  return h;
}
// p が今できること
function legal(m, p) {
  const h = m.h, o = 1 - p;
  if (!h || h.done || h.toAct !== p) return null;
  const toCall = Math.min(h.bets[o] - h.bets[p], m.stacks[p]);
  const out = { fold: toCall > 0, check: toCall === 0, call: toCall > 0 ? toCall : 0, raise: null };
  if (m.stacks[p] > toCall && m.stacks[o] > 0) {
    const max = h.bets[p] + m.stacks[p];
    const min = Math.min(max, h.bets[o] + Math.max(h.minRaise, h.bb));
    out.raise = { min, max, isBet: h.bets[o] === 0 };
  }
  return out;
}
// 行動する。正しくない行動は、できる範囲で安全な行動にする (チェック → フォールド)
function act(m, p, a) {
  const h = m.h, o = 1 - p, L = legal(m, p);
  if (!L) return false;
  let kind = a?.a;
  if (kind === 'raise' && (!L.raise || !Number.isFinite(a.to))) kind = L.check ? 'check' : 'call';
  if (kind === 'check' && !L.check) kind = 'fold';
  if (kind === 'call' && !L.call) kind = 'check';
  if (kind === 'fold' && !L.fold) kind = 'check';
  if (!['fold', 'check', 'call', 'raise'].includes(kind)) kind = L.check ? 'check' : 'fold';
  if (kind === 'fold') { h.folded = p; h.last[p] = 'フォールド'; return finishHand(m); }
  if (kind === 'check') { h.acted[p] = true; h.last[p] = 'チェック'; }
  if (kind === 'call') { m.stacks[p] -= L.call; h.bets[p] += L.call; h.acted[p] = true; h.last[p] = m.stacks[p] === 0 ? `オールイン ${h.bets[p]}` : `コール ${L.call}`; }
  if (kind === 'raise') {
    const to = Math.max(L.raise.min, Math.min(L.raise.max, Math.floor(a.to)));
    const add = to - h.bets[p], size = to - h.bets[o];
    m.stacks[p] -= add; h.bets[p] = to;
    if (size >= h.minRaise) h.minRaise = size;
    h.acted[p] = true; h.acted[o] = false;
    h.last[p] = m.stacks[p] === 0 ? `オールイン ${to}` : `${L.raise.isBet ? 'ベット' : 'レイズ'} ${to}`;
  }
  h.toAct = o;
  return settleIfNoAction(m) || true;
}
// このストリートが終わったら次へ (オールインならリバーまで配ってショーダウン)
function settleIfNoAction(m) {
  const h = m.h;
  const maxBet = Math.max(...h.bets);
  const streetDone = [0, 1].every((i) => m.stacks[i] === 0 || (h.acted[i] && h.bets[i] === maxBet))
    || (m.stacks[h.toAct] === 0) || ([0, 1].some((i) => m.stacks[i] === 0) && h.bets[h.toAct] >= h.bets[1 - h.toAct]);
  if (!streetDone) return false;
  // 呼ばれなかった分は返す
  const [a, b] = h.bets[0] >= h.bets[1] ? [0, 1] : [1, 0];
  if (h.bets[a] > h.bets[b]) { const back = h.bets[a] - h.bets[b]; m.stacks[a] += back; h.bets[a] -= back; }
  h.contrib[0] += h.bets[0]; h.contrib[1] += h.bets[1]; h.bets = [0, 0];
  const runout = m.stacks[0] === 0 || m.stacks[1] === 0;
  if (h.street === 3) return finishHand(m);
  if (runout) { while (h.board.length < 5) h.board.push(h.deck.pop()); h.street = 3; return finishHand(m); }
  h.street++;
  h.board.push(...(h.street === 1 ? [h.deck.pop(), h.deck.pop(), h.deck.pop()] : [h.deck.pop()]));
  h.acted = [false, false]; h.minRaise = h.bb; h.toAct = 1 - m.button; // フロップからは BB が先
  h.last = [null, null];
  return true;
}
function finishHand(m) {
  const h = m.h; h.done = true;
  h.contrib[0] += h.bets[0]; h.contrib[1] += h.bets[1]; h.bets = [0, 0];
  const pot = h.contrib[0] + h.contrib[1];
  let winners, ev = null;
  if (h.folded >= 0) winners = [1 - h.folded];
  else {
    ev = [0, 1].map((p) => evaluate([...h.hole[p], ...h.board]));
    winners = ev[0].score === ev[1].score ? [0, 1] : [ev[0].score > ev[1].score ? 0 : 1];
  }
  // 引き分けは半分ずつ (端数はボタンでない人に)
  if (winners.length === 2) { const half = Math.floor(pot / 2); m.stacks[0] += half; m.stacks[1] += half; m.stacks[1 - m.button] += pot - half * 2; }
  else m.stacks[winners[0]] += pot;
  h.result = { winners, pot, showdown: h.folded < 0, hands: ev ? ev.map((e) => e.name) : null, cat: ev ? Math.max(ev[0].cat, ev[1].cat) : 0 };
  if (m.stacks[0] === 0 || m.stacks[1] === 0) { m.over = true; m.winner = m.stacks[0] > 0 ? 0 : 1; }
  return true;
}
// p から見た試合の様子 (相手の手札はショーダウンのときだけ)
function viewFor(m, p) {
  const h = m.h, o = 1 - p;
  const [sb, bb] = blindsOf(m);
  const reveal = h?.done && h.result?.showdown;
  return { hand: m.hand, level: Math.floor((m.hand - 1) / HANDS_PER_LEVEL) + 1, sb, bb, button: m.button === p ? 'me' : 'opp',
    stacks: [m.stacks[p], m.stacks[o]], bets: h ? [h.bets[p], h.bets[o]] : [0, 0], pot: h ? h.contrib[0] + h.contrib[1] + h.bets[0] + h.bets[1] : 0,
    board: h ? h.board.map(cardStr) : [], street: h ? h.street : 0, myCards: h ? h.hole[p].map(cardStr) : [], oppCards: reveal ? h.hole[o].map(cardStr) : null,
    myHand: h && h.board.length >= 3 ? evaluate([...h.hole[p], ...h.board]).name : null,
    turn: h && !h.done ? (h.toAct === p ? 'me' : 'opp') : null, legal: legal(m, p), last: h ? [h.last[p], h.last[o]] : [null, null],
    result: h?.done ? { win: h.result.winners.length === 2 ? 'split' : h.result.winners[0] === p ? 'me' : 'opp', pot: h.result.pot, showdown: h.result.showdown,
      myHandName: h.result.hands?.[p] || null, oppHandName: h.result.hands?.[o] || null, folded: h.folded < 0 ? null : h.folded === p ? 'me' : 'opp' } : null };
}

// ---------- CPU (モンテカルロで勝率を見積もって決める) ----------
function equity(hole, board, rnd, sims = 260) {
  let win = 0;
  const used = new Set([...hole, ...board]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < 2 + (5 - board.length); i++) { const j = i + Math.floor(rnd() * (rest.length - i)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const opp = [rest[0], rest[1]], b = [...board, ...rest.slice(2, 2 + 5 - board.length)];
    const me = evaluate([...hole, ...b]).score, op = evaluate([...opp, ...b]).score;
    win += me > op ? 1 : me === op ? 0.5 : 0;
  }
  return win / sims;
}
function cpuDecide(m, p, rnd) {
  const h = m.h, L = legal(m, p); if (!L) return null;
  const eq = equity(h.hole[p], h.board, rnd);
  const pot = h.contrib[0] + h.contrib[1] + h.bets[0] + h.bets[1];
  const odds = L.call ? L.call / (pot + L.call) : 0;
  const raiseTo = (frac) => L.raise ? { a: 'raise', to: Math.max(L.raise.min, Math.min(L.raise.max, h.bets[1 - p] + Math.round(pot * frac))) } : (L.call ? { a: 'call' } : { a: 'check' });
  const bluff = rnd() < 0.08;
  if (eq > 0.8) return rnd() < 0.3 && L.raise ? { a: 'raise', to: L.raise.max } : raiseTo(0.9);
  if (eq > 0.62 || bluff) return rnd() < 0.55 ? raiseTo(0.6) : (L.call ? { a: 'call' } : { a: 'check' });
  if (L.check) return { a: 'check' };
  if (eq > odds + 0.05) return { a: 'call' };
  return { a: 'fold' };
}

const MIGRATION = `
CREATE TABLE poker_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
  hands INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE poker_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,                                       -- cpu / random / room
  p1 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  p2 INTEGER REFERENCES users(id) ON DELETE SET NULL,       -- CPU は NULL
  winner INTEGER, hands INTEGER NOT NULL, reason TEXT, created_at INTEGER NOT NULL
);
`;
const TURN_MS = Number(process.env.PK_TURN_MS || 30_000);
const NEXT_HAND_MS = Number(process.env.PK_NEXT_MS || 3_500);
const RECONNECT_MS = Number(process.env.PK_RECONNECT_MS || 60_000);

function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-21-poker', MIGRATION);
  const userView = (id) => { const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, isAdmin: u.isAdmin, verified: u.verified }; };
  const pl = (uid) => { db.prepare('INSERT OR IGNORE INTO poker_players (user_id) VALUES (?)').run(uid); return db.prepare('SELECT * FROM poker_players WHERE user_id = ?').get(uid); };

  app.get('/api/poker/me', requireAuth, (req, res) => { const p = pl(req.user.id); res.json({ rating: p.rating, wins: p.wins, losses: p.losses, hands: p.hands }); });
  app.get('/api/poker/ranking', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const rows = db.prepare('SELECT * FROM poker_players WHERE wins + losses > 0 ORDER BY rating DESC, wins DESC LIMIT 50').all();
    let rank = 0, last = null;
    const top = rows.map((r, i) => { if (r.rating !== last) { rank = i + 1; last = r.rating; } return { rank, rating: r.rating, wins: r.wins, losses: r.losses, user: userView(r.user_id) }; }).filter((x) => x.user);
    let me = null;
    if (req.user) { const p = db.prepare('SELECT * FROM poker_players WHERE user_id = ?').get(req.user.id); if (p && p.wins + p.losses > 0) me = { rank: db.prepare('SELECT COUNT(*) AS n FROM poker_players WHERE wins + losses > 0 AND rating > ?').get(p.rating).n + 1, rating: p.rating, wins: p.wins, losses: p.losses, user: userView(req.user.id) }; }
    res.json({ top, me });
  });

  // ======================= 対戦 (WebSocket /pk) =======================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });
  const conns = new Map(), tableOf = new Map(), rooms = new Map();
  let queue = null;
  const send = (uid, msg) => { const ws = conns.get(uid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
  const CPU = { id: 0, username: 'cpu', displayName: 'CPU', avatar: { kind: 'emoji', emoji: '🤖', color: '#64748b' } };

  function broadcast(t, extra = {}) { t.uids.forEach((u, i) => u && send(u, { t: 'state', state: viewFor(t.m, i), deadline: t.deadline, ...extra })); }
  function startTable(mode, uids) {
    const t = { mode, uids, m: newMatch(rnd), timer: null, deadline: 0, left: [null, null], ended: false, players: uids.map((u) => (u ? userView(u) : CPU)) };
    uids.forEach((u, i) => { if (u) { tableOf.set(u, t); send(u, { t: 'start', mode, players: [t.players[i], t.players[1 - i]] }); } });
    nextHand(t);
  }
  function nextHand(t) {
    if (t.ended) return;
    startHand(t.m);
    t.uids.forEach((u) => u && db.prepare('UPDATE poker_players SET hands = hands + 1 WHERE user_id = ?').run(u));
    afterAction(t);
  }
  function afterAction(t) {
    clearTimeout(t.timer);
    const m = t.m, h = m.h;
    if (h.done) {
      t.deadline = 0; broadcast(t);
      if (m.over) return t.timer = setTimeout(() => endTable(t, m.winner, 'bust'), 1800);
      return t.timer = setTimeout(() => nextHand(t), NEXT_HAND_MS);
    }
    const p = h.toAct;
    t.deadline = Date.now() + TURN_MS;
    broadcast(t);
    if (!t.uids[p]) { // CPU は少し考えてから
      t.timer = setTimeout(() => { act(m, p, cpuDecide(m, p, rnd)); afterAction(t); }, 700 + rnd() * 900);
    } else t.timer = setTimeout(() => { act(m, p, { a: legal(m, p)?.check ? 'check' : 'fold' }); afterAction(t); }, TURN_MS + 300);
  }
  function onAct(uid, msg) {
    const t = tableOf.get(uid); if (!t || t.ended) return;
    const p = t.uids.indexOf(uid);
    if (t.m.h?.toAct !== p || t.m.h.done) return;
    if (act(t.m, p, { a: msg.a, to: Number(msg.to) })) afterAction(t);
  }
  function endTable(t, winner, reason) {
    if (t.ended) return;
    t.ended = true; clearTimeout(t.timer); t.left.forEach((x) => clearTimeout(x));
    db.prepare('INSERT INTO poker_matches (mode, p1, p2, winner, hands, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(t.mode, t.uids[0], t.uids[1] || null, winner, t.m.hand, reason, Date.now());
    let delta = [0, 0];
    if (t.mode === 'random') {
      const r = t.uids.map((u) => pl(u).rating), e0 = 1 / (1 + 10 ** ((r[1] - r[0]) / 400)), d = Math.round(32 * ((winner === 0 ? 1 : 0) - e0));
      delta = [d, -d];
      t.uids.forEach((u, i) => db.prepare('UPDATE poker_players SET rating = rating + ?, wins = wins + ?, losses = losses + ? WHERE user_id = ?').run(delta[i], winner === i ? 1 : 0, winner === i ? 0 : 1, u));
    }
    t.uids.forEach((u, i) => { if (!u) return; tableOf.delete(u); send(u, { t: 'end', result: winner === i ? 'win' : 'lose', reason, hands: t.m.hand, rating: t.mode === 'random' ? { delta: delta[i], now: pl(u).rating } : null }); });
  }
  function leave(uid) { if (queue === uid) queue = null; for (const [c, r] of rooms) if (r.uid === uid) rooms.delete(c); }

  wss.on('connection', (ws, req, user) => {
    const uid = user.id;
    const old = conns.get(uid); if (old && old !== ws) { try { old.close(4000, 'replaced'); } catch {} }
    conns.set(uid, ws);
    const t0 = tableOf.get(uid);
    if (t0 && !t0.ended) { // つなぎ直し
      const p = t0.uids.indexOf(uid);
      clearTimeout(t0.left[p]); t0.left[p] = null;
      send(uid, { t: 'start', mode: t0.mode, players: [t0.players[p], t0.players[1 - p]], resumed: true });
      send(uid, { t: 'state', state: viewFor(t0.m, p), deadline: t0.deadline });
      const o = t0.uids[1 - p]; if (o) send(o, { t: 'opponentBack' });
    }
    let hits = 0; const iv = setInterval(() => { hits = 0; }, 1000);
    ws.on('message', (raw) => {
      if (++hits > 15) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'act') return onAct(uid, m);
      if (m.t === 'find') {
        if (tableOf.get(uid)) return;
        leave(uid);
        if (m.mode === 'cpu') return startTable('cpu', [uid, null]);
        if (m.mode === 'random') {
          if (queue && queue !== uid && conns.get(queue)?.readyState === 1 && !tableOf.get(queue)) { const o = queue; queue = null; return startTable('random', [o, uid]); }
          queue = uid; return send(uid, { t: 'waiting', mode: 'random' });
        }
        if (m.mode === 'room-create') { let code; do { code = String(crypto.randomInt(1000, 10000)); } while (rooms.has(code)); rooms.set(code, { uid, at: Date.now() }); return send(uid, { t: 'waiting', mode: 'room', code }); }
        if (m.mode === 'room-join') {
          const code = String(m.code || ''), r = rooms.get(code);
          if (!r || Date.now() - r.at > 10 * 60_000 || conns.get(r.uid)?.readyState !== 1) { rooms.delete(code); return send(uid, { t: 'error', msg: 'その部屋コードは見つかりません' }); }
          if (r.uid === uid) return send(uid, { t: 'error', msg: '自分の部屋には入れません' });
          rooms.delete(code); return startTable('room', [r.uid, uid]);
        }
      }
      if (m.t === 'cancel') { leave(uid); return send(uid, { t: 'cancelled' }); }
      if (m.t === 'surrender') { const t = tableOf.get(uid); if (t) endTable(t, 1 - t.uids.indexOf(uid), 'surrender'); }
    });
    ws.on('close', () => {
      clearInterval(iv);
      if (conns.get(uid) !== ws) return;
      conns.delete(uid); leave(uid);
      const t = tableOf.get(uid);
      if (t && !t.ended) {
        const p = t.uids.indexOf(uid), o = t.uids[1 - p];
        if (!o) return endTable(t, 1, 'left');
        send(o, { t: 'opponentLeft', ms: RECONNECT_MS });
        t.left[p] = setTimeout(() => endTable(t, 1 - p, 'left'), RECONNECT_MS);
      }
    });
  });
  ctx.pokerUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  ctx.erasePoker = (uid) => {
    leave(uid);
    const t = tableOf.get(uid); if (t && !t.ended) endTable(t, 1 - t.uids.indexOf(uid), 'left');
    db.prepare('DELETE FROM poker_players WHERE user_id = ?').run(uid);
    db.prepare('UPDATE poker_matches SET p1 = NULL WHERE p1 = ?').run(uid);
    db.prepare('UPDATE poker_matches SET p2 = NULL WHERE p2 = ?').run(uid);
  };
}
module.exports = install;
Object.assign(module.exports, { evaluate, newMatch, startHand, act, legal, viewFor, cpuDecide, equity, cardStr, START_STACK });
