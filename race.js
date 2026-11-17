// =====================================================================
// 117万分の1 競走馬版: 図鑑の馬でレース (オンライン対戦)
//
// ・出走できるのは、ログイン中に生まれた馬 (サーバーが乱数の種から一生を計算し直した馬) だけ。
//   強さはサーバーの記録 (成績・品種・種) から決める。図鑑 (端末から送られる記録) は馬の名前にだけ使う
// ・レースはサーバーが最後まで計算し、全員に同じ映像 (各馬の位置の記録) を送る。端末が決めるのは「馬」と「脚質」だけ
// ・オンラインレース: 最大 8 人。集まるまで少し待ち、空いた枠は CPU の馬が埋める。2 人以上の人が走るとレートが動く
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const RK_LABEL = { g1: 'UR', g2: 'SSR', g3: 'SR', l: 'R', n: 'N' };
// 成績・品種ごとの地力と、得意なこと
const BASE = { 'G1馬': 92, 'G2馬': 88, 'G3馬': 85, 'リステッド馬': 82, '勝ち上がり馬': 78, '未勝利馬': 73, '未出走馬': 70,
  '乗用・競技馬': 68, '牧場・作業馬': 64, 'ばんえい・農耕馬(重種)': 62, 'ポニー・小型馬': 58 };
const BREED_MOD = { 'ばんえい・農耕馬(重種)': { speed: -6, stamina: 16, guts: 6 }, 'ポニー・小型馬': { kick: 10, stamina: -6 }, '乗用・競技馬': { guts: 6 }, '牧場・作業馬': { stamina: 6 } };
const DISTANCES = [{ m: 1200, name: '短距離' }, { m: 1600, name: 'マイル' }, { m: 2000, name: '中距離' }, { m: 2400, name: '長距離' }];
const STYLES = {
  // 前半 35%・中盤 35%・終盤 30% の力の配分 (どの脚質も合計は同じ)
  nige: { name: '逃げ', desc: '最初から先頭に立って、そのまま逃げ切る。前に馬がいないので風を受ける', effort: [1.05, 1.0, 0.958] },
  senko: { name: '先行', desc: '前のほうにつけて、最後にもうひと伸び', effort: [1.02, 1.0, 0.977] },
  sashi: { name: '差し', desc: '中団で力をため、前の馬を風よけにして直線で差す', effort: [0.98, 0.995, 1.031] },
  oikomi: { name: '追込', desc: '後ろでじっと待って、最後に一気に追い込む。前がつまることも', effort: [0.955, 0.985, 1.07] },
};
let SPEED_K = 0.026, DRAFT = 0.006, WIND = 0.002;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 種の記録から能力を決める (同じ馬はいつも同じ能力)
function statsOf(seedRow) {
  const r = mulberry32((seedRow.seed ^ 0x5eed) >>> 0);
  const base = BASE[seedRow.headline] ?? (seedRow.breed === 'サラブレッド' ? 72 : 64);
  const mod = BREED_MOD[seedRow.headline] || BREED_MOD[seedRow.breed] || {};
  const v = (k) => Math.round(Math.max(40, Math.min(110, base + (mod[k] || 0) + (r() * 10 - 5))));
  return { speed: v('speed'), stamina: v('stamina'), kick: v('kick'), guts: v('guts'), best: DISTANCES[Math.floor(r() * DISTANCES.length)].m };
}
// ---------- レースの計算 ----------
// 0.5 秒ごとに全員を進める。1 秒ごとの位置を記録して、端末で再生する
function simulate(horses, distance, rnd) {
  const dt = 0.5, n = horses.length;
  // 調子: レースごとに ±3% くらい (人気薄の大駆けもある)
  const st = horses.map(() => ({ pos: 0, sta: 1, done: false, time: 0, form: 1 + (rnd() + rnd() + rnd() - 1.5) * 0.04 }));
  const frames = [], order = [];
  let t = 0;
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += rnd(); return (u - 2) / 1.15; };
  while (order.length < n && t < 400) {
    t += dt;
    const lead = Math.max(...st.map((s) => s.pos));
    horses.forEach((h, i) => {
      const s = st[i]; if (s.done) return;
      const f = s.pos / distance, phase = f < 0.35 ? 0 : f < 0.7 ? 1 : 2;
      const style = STYLES[h.style] || STYLES.senko;
      let effort = style.effort[phase];
      let v = (15.6 + (h.stats.speed - 70) * SPEED_K) * s.form;                         // 地力と調子
      v *= 1 + (Math.abs(h.stats.best - distance) <= 200 ? 0.012 : Math.abs(h.stats.best - distance) >= 800 ? -0.01 : 0); // 得意な距離
      if (phase === 2) v += (h.stats.kick - 70) * 0.014 * Math.max(0, (f - 0.7) / 0.3); // 末脚
      const rival = st.some((o, k) => k !== i && !o.done && Math.abs(o.pos - s.pos) < 3);
      if (f > 0.82 && rival) v += (h.stats.guts - 70) * 0.012;                        // 競り合いの根性
      const ahead = st.some((o, k) => k !== i && o.pos > s.pos && o.pos - s.pos < 8);
      if (ahead && f < 0.85) v *= 1 + DRAFT;                                          // 前の馬が風よけになる
      if (!ahead && phase < 2) v *= 1 - WIND;                                         // 先頭は風を受ける
      if (s.sta < 0.15) v *= 0.9;                                                     // ばてた
      v = v * effort + gauss() * 0.22;
      s.sta -= dt * effort * effort * (distance / 1600) * 0.0072 * (95 / Math.max(45, h.stats.stamina));
      const next = s.pos + Math.max(8, v) * dt;
      if (next >= distance) { s.time = t - dt + (distance - s.pos) / Math.max(8, v); s.pos = distance; s.done = true; order.push(i); }
      else s.pos = next;
    });
    if (Math.abs(t - Math.round(t)) < 1e-9) frames.push(st.map((s) => Math.round((s.pos / distance) * 1000)));
    void lead;
  }
  frames.push(st.map(() => 1000));
  order.sort((a, b) => st[a].time - st[b].time);
  return { frames, order, times: st.map((s) => Math.round(s.time * 10) / 10) };
}

const MIGRATION = `
CREATE TABLE race_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL DEFAULT 1000,
  races INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, rated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE race_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  horse TEXT NOT NULL, seed_id TEXT, place INTEGER NOT NULL, field INTEGER NOT NULL,
  distance INTEGER NOT NULL, time REAL NOT NULL, rating_delta INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX race_results_user ON race_results(user_id, id);
`;
const LOBBY_MS = Number(process.env.RC_LOBBY_MS || 20_000);
const GATES = 8;
const CPU_NAMES = ['ミライノカゼ', 'ハヤテマル', 'サクラエース', 'ホシノキラメキ', 'ゴールドラッシュ', 'シロガネオー', 'アオゾラダッシュ', 'ユメノツバサ', 'イナズマボーイ', 'ナナイロステップ', 'クロガネタイガ', 'ハルカゼメモリー'];
const SILKS = ['#e03131', '#1c7ed6', '#f59f00', '#2f9e44', '#ae3ec9', '#f06595', '#0c8599', '#495057'];

function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-21-race', MIGRATION);
  const userView = (id) => { const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, isAdmin: u.isAdmin, verified: u.verified }; };
  const rp = (uid) => { db.prepare('INSERT OR IGNORE INTO race_players (user_id) VALUES (?)').run(uid); return db.prepare('SELECT * FROM race_players WHERE user_id = ?').get(uid); };

  // 出走できる馬: サーバーの種の記録と、図鑑のカードを照らし合わせる (確率・品種・成績・出生国が同じもの)
  function horsesOf(uid) {
    const seeds = ctx.horseSeedsOf ? ctx.horseSeedsOf(uid) : [];
    const z = ctx.horseZukanOf ? ctx.horseZukanOf(uid) : null;
    const cards = (z && Array.isArray(z.cards)) ? z.cards : [];
    const used = new Set(), out = [];
    for (const card of cards) {
      const s = seeds.find((x) => !used.has(x.id) && Math.abs(x.p - card.p) <= x.p * 1e-9 && x.breed === card.b && x.headline === card.h && x.country === card.cj);
      if (!s) continue;
      used.add(s.id);
      out.push({ sid: s.id, name: String(card.n || 'ノーネーム').slice(0, 9), rarity: s.rarity, label: RK_LABEL[s.rarity], breed: s.breed, headline: s.headline, country: s.country, gen: s.gen, stats: statsOf(s), coat: card.coat || '' });
    }
    const rank = { g1: 0, g2: 1, g3: 2, l: 3, n: 4 };
    out.sort((a, b) => rank[a.rarity] - rank[b.rarity] || (b.stats.speed + b.stats.stamina + b.stats.kick + b.stats.guts) - (a.stats.speed + a.stats.stamina + a.stats.kick + a.stats.guts));
    return out.slice(0, 200);
  }
  app.get('/api/race/horses', requireAuth, (req, res) => {
    const p = rp(req.user.id);
    res.json({ horses: horsesOf(req.user.id), styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, { name: v.name, desc: v.desc }])), distances: DISTANCES,
      me: { rating: p.rating, races: p.races, wins: p.wins, rated: p.rated } });
  });
  app.get('/api/race/history', requireAuth, (req, res) => {
    res.json({ results: db.prepare('SELECT horse, place, field, distance, time, rating_delta, created_at FROM race_results WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(req.user.id) });
  });
  app.get('/api/race/ranking', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const rows = db.prepare('SELECT * FROM race_players WHERE rated > 0 ORDER BY rating DESC, wins DESC LIMIT 50').all();
    let rank = 0, last = null;
    const top = rows.map((r, i) => { if (r.rating !== last) { rank = i + 1; last = r.rating; } return { rank, rating: r.rating, races: r.races, wins: r.wins, user: userView(r.user_id) }; }).filter((x) => x.user);
    let me = null;
    if (req.user) { const p = db.prepare('SELECT * FROM race_players WHERE user_id = ?').get(req.user.id); if (p && p.rated > 0) me = { rank: db.prepare('SELECT COUNT(*) AS n FROM race_players WHERE rated > 0 AND rating > ?').get(p.rating).n + 1, rating: p.rating, races: p.races, wins: p.wins, user: userView(req.user.id) }; }
    res.json({ top, me });
  });

  // ======================= レース場 (WebSocket /rc) =======================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 });
  const conns = new Map();
  let lobby = null; // { id, distance, entries: [{ uid, horse, style }], closesAt, timer }
  const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
  const send = (uid, m) => { const ws = conns.get(uid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const lobbyView = () => ({ distance: lobby.distance, closesAt: lobby.closesAt, entries: lobby.entries.map((e, i) => ({ gate: i + 1, horse: e.horse.name, label: e.horse.label, style: STYLES[e.style].name, user: userView(e.uid) })) });
  const sendLobby = () => lobby && lobby.entries.forEach((e) => send(e.uid, { t: 'lobby', lobby: lobbyView(), serverNow: Date.now() }));

  function cpuHorse(name, avgBase) {
    const fake = { seed: crypto.randomInt(0, 2 ** 32), headline: '', breed: 'サラブレッド' };
    const st = statsOf(fake);
    const shift = avgBase - 72; // 人の馬と同じくらいの強さにそろえる
    for (const k of ['speed', 'stamina', 'kick', 'guts']) st[k] = Math.round(Math.max(45, Math.min(108, st[k] + shift + (rnd() * 8 - 4))));
    return { name, label: 'CPU', stats: st };
  }
  function runRace(entries, distance, practice) {
    const id = crypto.randomBytes(8).toString('hex');
    const humans = entries.map((e) => ({ ...e }));
    const avg = humans.reduce((a, e) => a + (e.horse.stats.speed + e.horse.stats.stamina + e.horse.stats.kick + e.horse.stats.guts) / 4, 0) / humans.length;
    const field = [...humans];
    const styles = Object.keys(STYLES);
    const names = [...CPU_NAMES]; for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; } // 同じ名前が出ないように
    for (let i = field.length; i < (practice ? 6 : GATES); i++) field.push({ uid: null, horse: cpuHorse(names.pop(), avg), style: styles[Math.floor(rnd() * styles.length)] });
    // 枠順はくじ引き
    for (let i = field.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [field[i], field[j]] = [field[j], field[i]]; }
    const sim = simulate(field.map((e) => ({ stats: e.horse.stats, style: e.style })), distance, rnd);
    const place = new Map(sim.order.map((idx, k) => [idx, k + 1]));
    // レート: 人どうしを 2 頭ずつ比べる (2 人以上のとき)
    const hIdx = field.map((e, i) => (e.uid ? i : -1)).filter((i) => i >= 0);
    const rated = !practice && new Set(hIdx.map((i) => field[i].uid)).size >= 2;
    const delta = new Map(hIdx.map((i) => [i, 0]));
    if (rated) {
      const K = 24 / (hIdx.length - 1);
      for (const a of hIdx) for (const b of hIdx) {
        if (a >= b) continue;
        const ra = rp(field[a].uid).rating, rb = rp(field[b].uid).rating, ea = 1 / (1 + 10 ** ((rb - ra) / 400)), sa = place.get(a) < place.get(b) ? 1 : 0;
        delta.set(a, delta.get(a) + K * (sa - ea)); delta.set(b, delta.get(b) - K * (sa - ea));
      }
    }
    const now = Date.now();
    for (const i of hIdx) {
      const e = field[i], d = Math.round(delta.get(i));
      db.prepare('UPDATE race_players SET rating = rating + ?, races = races + 1, wins = wins + ?, rated = rated + ? WHERE user_id = ?').run(d, place.get(i) === 1 ? 1 : 0, rated ? 1 : 0, e.uid);
      db.prepare('INSERT INTO race_results (race_id, user_id, horse, seed_id, place, field, distance, time, rating_delta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, e.uid, e.horse.name, e.horse.sid, place.get(i), field.length, distance, sim.times[i], d, now);
      delta.set(i, d);
    }
    const race = {
      id, distance, rated, practice,
      horses: field.map((e, i) => ({ gate: i + 1, name: e.horse.name, label: e.horse.label, style: STYLES[e.style].name, silk: SILKS[i % SILKS.length], user: e.uid ? userView(e.uid) : null })),
      frames: sim.frames, order: sim.order, times: sim.times,
    };
    for (const i of hIdx) { const uid = field[i].uid; send(uid, { t: 'race', race, you: i, result: { place: place.get(i), field: field.length, time: sim.times[i], ratingDelta: delta.get(i), rating: rp(uid).rating } }); }
    return race;
  }
  function closeLobby() {
    if (!lobby) return;
    const l = lobby; lobby = null; clearTimeout(l.timer);
    const live = l.entries.filter((e) => conns.get(e.uid)?.readyState === 1);
    if (live.length) runRace(live, l.distance, false);
  }

  wss.on('connection', (ws, req, user) => {
    const uid = user.id;
    const old = conns.get(uid); if (old && old !== ws) { try { old.close(4000, 'replaced'); } catch {} }
    conns.set(uid, ws);
    let hits = 0; const iv = setInterval(() => { hits = 0; }, 1000);
    ws.on('message', (raw) => {
      if (++hits > 10) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || m.t !== 'enter') { if (m?.t === 'leave' && lobby) { lobby.entries = lobby.entries.filter((e) => e.uid !== uid); sendLobby(); } return; }
      const horse = horsesOf(uid).find((h) => h.sid === m.sid);
      if (!horse) return send(uid, { t: 'error', msg: 'その馬はレースに出られません' });
      const style = STYLES[m.style] ? m.style : 'senko';
      if (m.mode === 'cpu') return runRace([{ uid, horse, style }], DISTANCES[Math.floor(rnd() * DISTANCES.length)].m, true);
      if (!lobby) {
        lobby = { distance: DISTANCES[Math.floor(rnd() * DISTANCES.length)].m, entries: [], closesAt: Date.now() + LOBBY_MS };
        lobby.timer = setTimeout(closeLobby, LOBBY_MS);
      }
      const at = lobby.entries.findIndex((e) => e.uid === uid);
      if (at >= 0) lobby.entries[at] = { uid, horse, style }; else lobby.entries.push({ uid, horse, style });
      sendLobby();
      if (lobby.entries.length >= GATES) closeLobby();
    });
    ws.on('close', () => {
      clearInterval(iv);
      if (conns.get(uid) !== ws) return;
      conns.delete(uid);
      if (lobby) { lobby.entries = lobby.entries.filter((e) => e.uid !== uid); if (!lobby.entries.length) { clearTimeout(lobby.timer); lobby = null; } else sendLobby(); }
    });
  });
  ctx.raceUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  ctx.eraseRace = (uid) => {
    if (lobby) lobby.entries = lobby.entries.filter((e) => e.uid !== uid);
    db.prepare('DELETE FROM race_players WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM race_results WHERE user_id = ?').run(uid);
  };
}
module.exports = install;
Object.assign(module.exports, { simulate, statsOf, STYLES, DISTANCES, tune: (o) => { ({ SPEED_K = SPEED_K, DRAFT = DRAFT, WIND = WIND } = o); } });
