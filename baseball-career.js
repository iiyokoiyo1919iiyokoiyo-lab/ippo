// =====================================================================
// IppO ベースボール: 選手の一生とリーグの出来事 (baseball.js から呼ぶ)
//   ・年齢とキャリア年数・シーズンごとの成長と衰え・引退 (選手図鑑に永久保存)・殿堂入り
//   ・覚醒 (試合のあとに稀に。能力・変化球・特殊能力。前後の比較を画面で見せる)
//   ・新人王 (その季にドラフトで入った選手)・記録達成 (通算の節目・1 試合の大記録)
//   ・球団ニュース (出来事から記事を作って保存。表 bb_news)
//   ・プレイヤー間トレード (申請 → 承認/拒否。出した選手はほかのトレードに使えない (bb_trade_locks)。期限つき・履歴を保存)
//   ・スカウト (ドラフト候補の推定能力を幅つきで見せる。スカウトのレベルで精度が上がる)・隠し逸材 (目玉とは別枠)
//   ・数値は baseball-config.js (環境変数 BB_CONFIG で上書き)。大事な計算はすべてサーバーで行う
//   ・チーム名などは生のまま保存し、画面でエスケープする
// =====================================================================
const crypto = require('crypto');
const CFG = require('./baseball-config.js');

const MIGRATION = `
ALTER TABLE bb_players ADD COLUMN age INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bb_players ADD COLUMN seasons INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bb_players ADD COLUMN rookie_season INTEGER;
ALTER TABLE bb_players ADD COLUMN retired_at INTEGER;
ALTER TABLE bb_stats ADD COLUMN sb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bb_teams ADD COLUMN scout_lv INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS bb_stats_player ON bb_stats(player_id);
CREATE TABLE IF NOT EXISTS bb_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, season INTEGER NOT NULL, cat TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  user_id INTEGER, team TEXT NOT NULL DEFAULT '', player_id TEXT, player TEXT NOT NULL DEFAULT '', imp INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS bb_news_at ON bb_news(at DESC);
CREATE INDEX IF NOT EXISTS bb_news_user ON bb_news(user_id, at DESC);
CREATE TABLE IF NOT EXISTS bb_awaken (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, season INTEGER NOT NULL,
  before TEXT NOT NULL, after TEXT NOT NULL, gains TEXT NOT NULL, new_pitch TEXT, new_special TEXT, seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bb_awaken_user ON bb_awaken(user_id, seen);
CREATE INDEX IF NOT EXISTS bb_awaken_player ON bb_awaken(player_id);
CREATE TABLE IF NOT EXISTS bb_retired (
  player_id TEXT PRIMARY KEY, user_id INTEGER, team TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, pos TEXT NOT NULL, rarity TEXT NOT NULL, number INTEGER NOT NULL,
  look TEXT NOT NULL DEFAULT '{}', age INTEGER NOT NULL, seasons INTEGER NOT NULL, retired_season INTEGER NOT NULL, retired_at INTEGER NOT NULL,
  totals TEXT NOT NULL, titles TEXT NOT NULL, hof INTEGER NOT NULL DEFAULT 0, hof_reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS bb_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_uid INTEGER NOT NULL, to_uid INTEGER NOT NULL, give TEXT NOT NULL, get TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS bb_trades_from ON bb_trades(from_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS bb_trades_to ON bb_trades(to_uid, created_at DESC);
CREATE TABLE IF NOT EXISTS bb_trade_locks (player_id TEXT PRIMARY KEY, trade_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bb_scout (day TEXT NOT NULL, user_id INTEGER NOT NULL, player_id TEXT NOT NULL, report TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (day, user_id, player_id));
CREATE TABLE IF NOT EXISTS bb_milestones (player_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (player_id, key));
`;

const CAT = { draft: 'ドラフト速報', game: '試合結果', awaken: '覚醒', retire: '引退', hof: '殿堂入り', rookie: '新人王', trade: 'トレード', record: '記録達成', promote: '昇格', king: 'KING', season: 'シーズン', special: '特殊能力' };
const STAT_NAME = { meet: 'ミート', power: 'パワー', speed: '走力', tech: '守備・技術', velo: '球速', brk: '変化力', stuff: '球威', stamina: 'スタミナ' };
const MS = { B: { h: [100, 200, 300, 500, 700, 1000, 1500, 2000], hr: [25, 50, 100, 150, 200, 300, 400, 500], rbi: [100, 300, 500, 1000], sb: [50, 100, 200] },
  P: { w: [25, 50, 100, 150, 200], k: [250, 500, 1000, 1500, 2000, 3000], sv: [50, 100, 200, 300], hld: [50, 100, 200] } };
const MS_UNIT = { h: '安打', hr: '本塁打', rbi: '打点', sb: '盗塁', w: '勝', k: '奪三振', sv: 'セーブ', hld: 'ホールド' };
const hashN = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const fmtAvg = (h, ab) => (ab ? (h / ab).toFixed(3).replace(/^0/, '') : '-');
const fmtEra = (er, outs) => (outs ? (er * 27 / outs).toFixed(2) : '-');
const ipStr = (outs) => `${Math.floor(outs / 3)}${outs % 3 ? ' ' + (outs % 3) + '/3' : ''}`;

// 総合評価 (0〜99)
function ovr(p) {
  const s = p.stats || {};
  if (p.kind === 'P') return Math.round(Math.max(1, Math.min(99, Math.max(0, Math.min(100, ((s.velo || 130) - 120) / 45 * 100)) * 0.28 + (s.brk || 0) * 0.3 + (s.stuff || 0) * 0.3 + (s.stamina || 0) * 0.07 + Math.min(9, (p.pitches || []).length) * 0.6)));
  return Math.round(Math.max(1, Math.min(99, (s.meet || 0) * 0.3 + (s.power || 0) * 0.3 + (s.speed || 0) * 0.15 + (s.tech || 0) * 0.25)));
}
const grade = (v) => (v >= 85 ? 'S' : v >= 75 ? 'A' : v >= 65 ? 'B' : v >= 55 ? 'C' : v >= 45 ? 'D' : 'E');

module.exports = function career(app, ctx, B) {
  const { db, requireAuth } = ctx;
  const { sr, limit, C, SPECIALS, AWARDS, LEAGUE_NAME, POS, rowToPlayer, pubPlayer, playersOf, teamRow, autoLineup, seasonOf, dayKey, ROSTER_MAX } = B;
  db.migrate('2026-11-23-bb-career', MIGRATION);
  const rint = (a, b) => Math.floor(a + sr() * (b - a + 1));
  const now0 = () => Date.now();

  // ---------- 年齢・成長性 (前からいる選手にもつける) ----------
  function ensure(p) {
    const h = hashN(p.id || p.name);
    if (!p.age) p.age = p.origin === 'draft' ? 18 + (h % 5) : 20 + (h % 13);
    p.hidden = p.hidden || {};
    if (p.hidden.pot == null) p.hidden.pot = 25 + ((h >>> 8) % 56); // 25〜80
    return p;
  }
  // 前からいる選手 (年齢 0) に年齢と成長性を入れる
  for (const r of db.prepare('SELECT id, origin, hidden FROM bb_players WHERE age = 0').all()) {
    const p = ensure({ id: r.id, origin: r.origin, hidden: JSON.parse(r.hidden) });
    db.prepare('UPDATE bb_players SET age = ?, hidden = ? WHERE id = ?').run(p.age, JSON.stringify(p.hidden), r.id);
  }
  const potLimit = (p) => 60 + 0.39 * (p.hidden?.pot ?? 50);

  // ---------- ニュース ----------
  const qNews = db.prepare('INSERT INTO bb_news (at, season, cat, title, body, user_id, team, player_id, player, imp, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  function news(cat, title, body, { uid = null, team = '', pid = null, player = '', imp = 1, data = {}, at = now0() } = {}) {
    qNews.run(at, seasonOf(at), cat, String(title).slice(0, 120), String(body).slice(0, 1200), uid, team || (uid ? teamName(uid) : ''), pid, player, imp, JSON.stringify(data));
  }
  const teamName = (uid) => db.prepare('SELECT name FROM bb_teams WHERE user_id = ?').get(uid)?.name || '';
  const newsView = (n) => ({ id: n.id, at: n.at, season: n.season, cat: n.cat, catName: CAT[n.cat] || n.cat, title: n.title, body: n.body, team: n.team, player: n.player, playerId: n.player_id, imp: n.imp, mine: false, uid: n.user_id });

  // ---------- 通算成績・タイトル ----------
  const qCareer = db.prepare('SELECT COUNT(*) n, SUM(g) g, SUM(pa) pa, SUM(ab) ab, SUM(h) h, SUM(hr) hr, SUM(rbi) rbi, SUM(bb) bb, SUM(so) so, SUM(sb) sb, SUM(w) w, SUM(l) l, SUM(sv) sv, SUM(hld) hld, SUM(outs) outs, SUM(er) er, SUM(k) k FROM bb_stats WHERE player_id = ?');
  function careerTotals(pid) { const t = qCareer.get(pid) || {}; const o = {}; for (const k of ['g', 'pa', 'ab', 'h', 'hr', 'rbi', 'bb', 'so', 'sb', 'w', 'l', 'sv', 'hld', 'outs', 'er', 'k']) o[k] = Number(t[k] || 0); o.avg = fmtAvg(o.h, o.ab); o.era = fmtEra(o.er, o.outs); return o; }
  const AWARD_NAME = { ...Object.fromEntries(AWARDS.map((a) => [a.id, a.name])), rookie_b: '新人王 (野手)', rookie_p: '新人王 (投手)' };
  const titlesOf = (pid) => db.prepare('SELECT season, award FROM bb_awards WHERE player_id = ? ORDER BY season').all(pid).map((a) => ({ season: a.season, award: a.award, name: AWARD_NAME[a.award] || a.award }));

  // ---------- 記録達成 ----------
  function milestones(p, uid, x) {
    const tot = careerTotals(p.id), side = MS[p.kind] || {};
    for (const [k, list] of Object.entries(side)) {
      const after = tot[k], before = after - (x[k] || 0);
      for (const t of list) if (before < t && after >= t) {
        if (!db.prepare('INSERT OR IGNORE INTO bb_milestones (player_id, key, at) VALUES (?, ?, ?)').run(p.id, `${k}${t}`, now0()).changes) continue;
        const unit = MS_UNIT[k];
        news('record', `${p.name}、通算${t}${unit}を達成`, `${teamName(uid)}の${p.name}(${p.pos})が通算${t}${unit}に到達した。プロ${p.seasons + 1}年目、${p.age}歳。${p.kind === 'B' ? `通算打率${tot.avg}・${tot.hr}本塁打・${tot.rbi}打点。` : `通算${tot.w}勝${tot.l}敗${tot.sv}セーブ・防御率${tot.era}・${tot.k}奪三振。`}`,
          { uid, pid: p.id, player: p.name, imp: t >= (list[2] || 1e9) ? 2 : 1, data: { k, t } });
      }
    }
    // 1 試合の大記録
    const feats = p.kind === 'B' ? [[x.hr >= 3, `1試合${x.hr}本塁打`], [x.h >= 5, `1試合${x.h}安打`], [x.rbi >= 7, `1試合${x.rbi}打点`]] : [[x.k >= 12, `${x.k}奪三振`], [x.outs >= 27 && x.er === 0, '完封勝利']];
    for (const [ok, label] of feats) if (ok) news('record', `${p.name}が${label}の快挙`, `${teamName(uid)}の${p.name}が${label}を記録した。${p.kind === 'B' ? `この試合 ${x.ab}打数${x.h}安打${x.hr}本塁打${x.rbi}打点。` : `${ipStr(x.outs)}回を投げて${x.k}奪三振・${x.er}失点。`}`, { uid, pid: p.id, player: p.name, imp: 2 });
  }

  // ---------- 覚醒 ----------
  function weightedPick(items, wts) { const s = wts.reduce((a, b) => a + b, 0); let x = sr() * s; for (let i = 0; i < items.length; i++) { x -= wts[i]; if (x <= 0) return items[i]; } return items[items.length - 1]; }
  function awaken(p, uid, reason) {
    const A = CFG.awaken, before = { ...p.stats }, stats = { ...p.stats }, gains = {};
    const lim = (k) => (k === 'velo' ? A.veloCap : Math.min(99, Math.round(potLimit(p) + A.overPot)));
    const keys = p.kind === 'B' ? ['meet', 'power', 'speed', 'tech'] : ['velo', 'stuff', 'brk'];
    const wts = keys.map((k) => (k === 'velo' ? 900 : (stats[k] || 1) ** 2)); // 得意な能力ほど伸びやすい (個性を残す)
    const n = sr() < 0.45 ? 2 : 1, chosen = new Set();
    while (chosen.size < n) chosen.add(weightedPick(keys, wts));
    for (const k of chosen) {
      const g = k === 'velo' ? rint(A.velo[0], A.velo[1]) : rint(A.gain[0], A.gain[1]);
      const nv = Math.max(stats[k], Math.min(lim(k), stats[k] + g)); if (nv > stats[k]) { gains[k] = nv - stats[k]; stats[k] = nv; }
    }
    let newPitch = null, newSpecial = null; const pitches = [...(p.pitches || [])], specials = [...(p.specials || [])];
    if (p.kind === 'P' && pitches.length < 9 && sr() < A.newPitch) {
      const pool = C.PITCH_IDS.filter((x) => !pitches.includes(x) && !['straight', 'fourseam', 'fireball'].includes(x));
      if (pool.length) { newPitch = pool[Math.floor(sr() * pool.length)]; pitches.push(newPitch); }
    }
    if (sr() < A.newSpecial && specials.filter((k) => !SPECIALS[k]?.award).length < 3) {
      const pool = Object.keys(SPECIALS).filter((k) => !SPECIALS[k].award && (SPECIALS[k].kind === p.kind || SPECIALS[k].kind === '*') && !specials.includes(k));
      if (pool.length) { newSpecial = pool[Math.floor(sr() * pool.length)]; specials.push(newSpecial); }
    }
    if (!Object.keys(gains).length && !newPitch && !newSpecial) return null;
    const hid = { ...p.hidden, awakenN: (p.hidden.awakenN || 0) + 1, lastAwaken: p.games };
    db.prepare('UPDATE bb_players SET stats = ?, pitches = ?, specials = ?, hidden = ? WHERE id = ?').run(JSON.stringify(stats), JSON.stringify(pitches), JSON.stringify(specials), JSON.stringify(hid), p.id);
    const at = now0();
    db.prepare('INSERT INTO bb_awaken (player_id, user_id, at, season, before, after, gains, new_pitch, new_special) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, uid, at, seasonOf(at), JSON.stringify(before), JSON.stringify(stats), JSON.stringify(gains), newPitch, newSpecial);
    const up = Object.entries(gains).map(([k, g]) => `${STAT_NAME[k]} ${before[k]}→${stats[k]}${k === 'velo' ? 'km' : ''}`).join('、');
    news('awaken', `${p.name}が覚醒！${up ? ' ' + up.split('、')[0] : ''}`, `${teamName(uid)}の${p.name}(${p.age}歳・${p.pos})が覚醒した。${reason}${up ? `${up}にアップ。` : ''}${newPitch ? `新しい変化球「${C.PITCHES[newPitch].name}」を習得。` : ''}${newSpecial ? `特殊能力「${SPECIALS[newSpecial].name}」を獲得。` : ''}`,
      { uid, pid: p.id, player: p.name, imp: 2, data: { gains, newPitch, newSpecial } });
    if (newSpecial) news('special', `${p.name}が「${SPECIALS[newSpecial].name}」を獲得`, `覚醒した${p.name}(${teamName(uid)})が特殊能力「${SPECIALS[newSpecial].name}」を身につけた。${SPECIALS[newSpecial].desc}。`, { uid, pid: p.id, player: p.name, imp: 1 });
    return { gains, newPitch, newSpecial };
  }

  // 試合のあと (自分のチームの選手 1 人ずつ)。recordGame が成績と試合数を入れたあとに呼ぶ
  function afterGame(pid, uid, x) {
    const row = db.prepare('SELECT * FROM bb_players WHERE id = ? AND owner_id = ? AND retired_at IS NULL').get(pid, uid); if (!row) return;
    const p = rowToPlayer(row), A = CFG.awaken;
    const perf = p.kind === 'B' ? x.h + 2 * x.hr + 0.5 * x.rbi + 0.5 * (x.sb || 0) + 0.3 * x.bb - 0.3 * x.so : (x.outs / 3) * 0.45 + x.k * 0.35 - x.er * 0.8 + x.w * 2 + x.sv * 1.5 + x.hld;
    const hid = p.hidden; hid.form = Math.round((0.75 * (hid.form || 0) + 0.25 * perf) * 100) / 100;
    db.prepare('UPDATE bb_players SET hidden = ? WHERE id = ?').run(JSON.stringify(hid), pid);
    try { milestones(p, uid, x); } catch (e) { console.error('[bb] 記録', e.message); }
    if (p.games < A.minGames || (hid.awakenN || 0) >= A.maxPerPlayer || (hid.lastAwaken != null && p.games - hid.lastAwaken < A.cooldownGames)) return;
    const ss = db.prepare('SELECT * FROM bb_stats WHERE season = ? AND player_id = ?').get(seasonOf(), pid);
    const seasonGood = ss && (p.kind === 'B' ? ss.ab >= 30 && ss.h / ss.ab >= 0.3 : ss.outs >= 45 && ss.er * 27 / ss.outs < 3);
    const score = Math.max(0, perf) + Math.max(0, hid.form) + (seasonGood ? 2 : 0);
    const ageF = p.age <= 25 ? 1.3 : p.age >= 33 ? 0.5 : 1;
    const prob = Math.min(A.max, (A.base + A.perf * score) * (0.5 + (hid.pot ?? 50) / 100) * ageF * (hid.gem ? 1.6 : 1));
    if (sr() < prob) {
      const reason = p.kind === 'B' ? (x.hr ? `この日${x.h}安打${x.hr}本塁打の大暴れをきっかけに、` : x.h >= 2 ? `この日のマルチ安打をきっかけに、` : seasonGood ? `今季打率${fmtAvg(ss.h, ss.ab)}と好調を続け、` : '試合を重ねて手応えをつかみ、')
        : (x.w ? `この日の勝利投球をきっかけに、` : x.k >= 6 ? `この日${x.k}奪三振の好投をきっかけに、` : seasonGood ? `今季防御率${fmtEra(ss.er, ss.outs)}と安定した投球を続け、` : '登板を重ねて手応えをつかみ、');
      awaken({ ...p, hidden: hid }, uid, reason);
    }
  }

  // ---------- 試合結果のニュース ----------
  function gameNews(home, away, res, gid) {
    for (const [side, opp, my, op, key] of [[home, away, res.hs, res.as, 'home'], [away, home, res.as, res.hs, 'away']]) {
      if (!side.uid) continue;
      const mine = res.box.filter((x) => x.team === side);
      const sc = (x) => (x.p.kind === 'B' ? x.h * 2 + x.hr * 4 + x.rbi * 1.5 + (x.sb || 0) : x.w * 4 + x.sv * 3 + x.k * 0.6 + x.outs * 0.15 - x.er * 1.5);
      const mvp = mine.sort((a, b) => sc(b) - sc(a))[0];
      const won = my > op, title = `${side.name}、${opp.name}に${my}-${op}で${won ? '勝利' : '敗れる'}`;
      let body = `${side.name}は${opp.name}と対戦し、${my}-${op}で${won ? '勝利した' : '敗れた'}。`;
      if (mvp && sc(mvp) > 2) body += mvp.p.kind === 'B' ? `${mvp.p.name}が${mvp.ab}打数${mvp.h}安打${mvp.hr ? `${mvp.hr}本塁打` : ''}${mvp.rbi}打点${won ? 'と勝利に貢献した' : 'と気を吐いた'}。` : `${mvp.p.name}が${ipStr(mvp.outs)}回${mvp.k}奪三振${mvp.er}失点${mvp.w ? 'で勝利投手になった' : mvp.sv ? 'でセーブを挙げた' : 'の好投を見せた'}。`;
      news('game', title, body, { uid: side.uid, team: side.name, pid: mvp?.p.id || null, player: mvp?.p.name || '', imp: 1, data: { gid, my, op, won } });
    }
  }
  function onPromote(uid, league) { news('promote', `${teamName(uid)}が${LEAGUE_NAME[league]}リーグへ昇格`, `${teamName(uid)}がリーグ戦で${12}勝を挙げ、${LEAGUE_NAME[league]}リーグへの昇格を決めた。`, { uid, imp: 2, data: { league } }); }

  // ---------- 新人王 ----------
  function rookieAwards(s) {
    const R = CFG.rookie, out = [];
    const rows = db.prepare('SELECT p.*, s.pa, s.ab, s.h, s.hr, s.rbi, s.sb, s.outs, s.er, s.w, s.k, s.sv, s.hld, s.user_id suid FROM bb_players p JOIN bb_stats s ON s.player_id = p.id AND s.season = ? WHERE p.rookie_season = ? AND p.retired_at IS NULL AND p.owner_id IS NOT NULL').all(s, s);
    const best = { B: null, P: null };
    for (const r of rows) {
      let sc;
      if (r.kind === 'B') { if (r.pa < R.minPA) continue; sc = (r.ab ? r.h / r.ab : 0) * 200 + r.hr * 3 + r.rbi + r.h * 0.5 + r.sb * 1.5; }
      else { if (r.outs < R.minOuts && r.sv + r.hld < 3) continue; const era = r.outs ? r.er * 27 / r.outs : 9; sc = Math.max(0, 6 - era) * 8 + r.w * 4 + r.k * 0.4 + r.sv * 3 + r.hld * 2; }
      if (!best[r.kind] || sc > best[r.kind].sc) best[r.kind] = { ...r, sc };
    }
    for (const k of ['B', 'P']) {
      const r = best[k]; if (!r) continue;
      const award = k === 'B' ? 'rookie_b' : 'rookie_p';
      db.prepare('INSERT OR IGNORE INTO bb_awards (season, award, player_id, user_id, name, value) VALUES (?, ?, ?, ?, ?, ?)').run(s, award, r.id, r.owner_id, r.name, Math.round(r.sc * 10) / 10);
      const sp = JSON.parse(r.specials); if (!sp.includes('t_rookie')) { sp.push('t_rookie'); db.prepare('UPDATE bb_players SET specials = ? WHERE id = ?').run(JSON.stringify(sp), r.id); }
      const line = k === 'B' ? `打率${fmtAvg(r.h, r.ab)}・${r.hr}本塁打・${r.rbi}打点・${r.h}安打・${r.sb}盗塁` : `${r.w}勝・防御率${fmtEra(r.er, r.outs)}・${r.k}奪三振・${r.sv}セーブ・${r.hld}ホールド`;
      news('rookie', `シーズン${s}新人王に${r.name}(${teamName(r.owner_id)})`, `シーズン${s}の新人王 (${k === 'B' ? '野手' : '投手'}部門) に${teamName(r.owner_id)}の${r.name}が選ばれた。ルーキーイヤーの成績は${line}。新人王の特殊能力を獲得した。`, { uid: r.owner_id, pid: r.id, player: r.name, imp: 2 });
      out.push({ award, id: r.id, name: r.name });
    }
    return out;
  }

  // ---------- 成長と衰え (シーズンの終わり・1 年) ----------
  function grow(p) {
    const G = CFG.growth, a = p.age, pot = p.hidden.pot ?? 50;
    let g;
    if (a <= G.young) g = Math.round(rint(G.youngGain[0], G.youngGain[1]) * (0.5 + pot / 100) + (p.hidden.gem ? rint(3, 6) : 0));
    else if (a <= G.prime) g = Math.round(rint(G.primeGain[0], G.primeGain[1]) * (pot >= 60 ? 1 : 0.5));
    else if (a <= G.decline) g = 0;
    else if (a < G.veteranAge) g = -rint(G.oldLoss[0], G.oldLoss[1]);
    else g = -rint(G.veteranLoss[0], G.veteranLoss[1]);
    if (!g) return null;
    const s = { ...p.stats }, lim = potLimit(p), keys = p.kind === 'B' ? ['meet', 'power', 'speed', 'tech'] : ['brk', 'stuff'];
    const vals = keys.map((k) => s[k]), mx = Math.max(...vals), mn = Math.min(...vals);
    for (const k of keys) {
      const w = 0.7 + 0.6 * (mx === mn ? 0.5 : (s[k] - mn) / (mx - mn)); // 得意なほど伸び、苦手は伸びにくい
      let d = Math.round(g * (g > 0 ? w : 1)) + (g < 0 && k === 'speed' ? -1 : 0);
      if (d > 0) d = Math.max(0, Math.min(d, Math.floor(lim - s[k])));
      s[k] = Math.max(1, Math.min(99, s[k] + d));
    }
    if (p.kind === 'P') { s.velo = Math.max(110, Math.min(CFG.awaken.veloCap, s.velo + Math.trunc(g / 2))); s.stamina = Math.max(1, Math.min(99, s.stamina + Math.trunc(g / 2))); }
    return s;
  }

  // ---------- 引退・殿堂入り ----------
  function retireProb(p, ss) {
    const R = CFG.retire; if (p.age < R.minAge) return 0; if (p.age >= R.maxAge) return 1;
    let pr = 0; for (const [a, v] of R.curve) if (p.age >= a) pr = v;
    const good = ss && (p.kind === 'B' ? ss.ab >= 60 && ss.h / ss.ab >= 0.29 : ss.outs >= 60 && ss.er * 27 / ss.outs < 3.5);
    return good ? pr * R.goodRelief : pr;
  }
  function hofCheck(p, tot, titles) {
    const H = CFG.hof[p.kind] || {}, why = [];
    for (const [k, v] of Object.entries(H)) { if (k === 'titles') { if (titles.length >= v) why.push(`タイトル${titles.length}回`); } else if ((tot[k] || 0) >= v) why.push(`通算${tot[k]}${MS_UNIT[k] || k}`); }
    return why;
  }
  function retirePlayer(p, s, at) {
    const tot = careerTotals(p.id), titles = titlesOf(p.id), team = teamName(p.ownerId), hofWhy = hofCheck(p, tot, titles);
    db.prepare('UPDATE bb_players SET retired_at = ? WHERE id = ?').run(at, p.id);
    db.prepare('INSERT OR REPLACE INTO bb_retired (player_id, user_id, team, name, kind, pos, rarity, number, look, age, seasons, retired_season, retired_at, totals, titles, hof, hof_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.ownerId, team, p.name, p.kind, p.pos, p.rarity, p.number, JSON.stringify(p.look || {}), p.age, p.seasons, s, at, JSON.stringify(tot), JSON.stringify(titles), hofWhy.length ? 1 : 0, hofWhy.join('・'));
    voidTradesFor([p.id], at);
    const line = p.kind === 'B' ? `通算${tot.g}試合・打率${tot.avg}・${tot.h}安打・${tot.hr}本塁打・${tot.rbi}打点` : `通算${tot.w}勝${tot.l}敗${tot.sv}セーブ・防御率${tot.era}・${tot.k}奪三振`;
    news('retire', `${p.name}が現役引退を表明`, `${team}の${p.name}(${p.age}歳・${p.pos})が今季限りでの現役引退を決めた。プロ${p.seasons}年、${line}。${titles.length ? `獲得タイトルは${titles.map((t) => t.name).join('・')}。` : ''}選手図鑑に永久保存される。`, { uid: p.ownerId, team, pid: p.id, player: p.name, imp: 2 });
    if (hofWhy.length) news('hof', `${p.name}、殿堂入り`, `引退した${p.name}(${team})の殿堂入りが決まった。選考理由は${hofWhy.join('・')}。${line}。記念エンブレムが贈られた。`, { uid: p.ownerId, team, pid: p.id, player: p.name, imp: 3 });
    return hofWhy.length > 0;
  }

  // シーズンの終わり (closeSeason の中・同じトランザクション)。表彰のあと、成績をリセットする前に呼ぶ
  function onSeasonClose(s, king) {
    const at = now0();
    for (const a of db.prepare('SELECT * FROM bb_awards WHERE season = ?').all(s)) {
      const A = AWARDS.find((x) => x.id === a.award); if (!A) continue;
      news('special', `${a.name}が${A.name}、特殊能力「${SPECIALS[a.award]?.name || A.name}」を獲得`, `シーズン${s}の${A.name}は${teamName(a.user_id)}の${a.name} (${A.unit} ${A.fmt ? A.fmt(a.value) : a.value})。表彰の特殊能力がついた。`, { uid: a.user_id, pid: a.player_id, player: a.name, imp: 2, at });
    }
    const rookies = rookieAwards(s);
    // 年齢・キャリア・成長と衰え
    const rows = db.prepare('SELECT * FROM bb_players WHERE owner_id IS NOT NULL AND retired_at IS NULL').all().map(rowToPlayer);
    for (const p of rows) {
      ensure(p);
      const ns = grow(p) || p.stats;
      p.age += 1; p.seasons += 1; p.stats = ns;
      db.prepare('UPDATE bb_players SET age = ?, seasons = ?, stats = ?, hidden = ? WHERE id = ?').run(p.age, p.seasons, JSON.stringify(ns), JSON.stringify(p.hidden), p.id);
    }
    // 引退 (チームの最低人数は残す: 野手 9・投手 5)
    const byTeam = {}; for (const p of rows) (byTeam[p.ownerId] ||= []).push(p);
    let nRet = 0, nHof = 0;
    for (const [uid, list] of Object.entries(byTeam)) {
      const cnt = { B: list.filter((p) => p.kind === 'B').length, P: list.filter((p) => p.kind === 'P').length }, min = { B: 9, P: 5 };
      const cand = list.map((p) => ({ p, pr: retireProb(p, db.prepare('SELECT * FROM bb_stats WHERE season = ? AND player_id = ?').get(s, p.id)) })).filter((x) => x.pr > 0 && sr() < x.pr).sort((a, b) => b.p.age - a.p.age);
      let changed = false;
      for (const { p } of cand) { if (cnt[p.kind] - 1 < min[p.kind]) continue; cnt[p.kind]--; if (retirePlayer(p, s, at)) nHof++; nRet++; changed = true; }
      if (changed) autoLineup(Number(uid));
    }
    if (king) news('king', `${teamName(king.user_id)}がシーズン${s}のKINGに`, `チャンピオンリーグのレート1位 (${king.rate}) で${teamName(king.user_id)}がシーズン${s}のKINGに輝いた。称号「King of season ${s}」が贈られた。`, { uid: king.user_id, imp: 3, at });
    const aw = db.prepare('SELECT award, name FROM bb_awards WHERE season = ?').all(s);
    news('season', `シーズン${s}が閉幕`, `シーズン${s}の全日程が終了した。${king ? `KINGは${teamName(king.user_id)}。` : ''}${aw.length ? `表彰: ${aw.map((a) => `${AWARD_NAME[a.award] || a.award} ${a.name}`).join('、')}。` : ''}${nRet ? `この季限りで${nRet}人が現役を引退${nHof ? `し、うち${nHof}人が殿堂入りした` : 'した'}。` : ''}選手たちは1つ年を重ね、新しいシーズンが始まる。`, { imp: 3, at, data: { rookies } });
  }

  // ---------- ドラフト ----------
  function addGems(pool, r, makePlayer) {
    const G = CFG.gem; let n = r() < G.chance ? 1 : 0; if (n && r() < G.second) n = 2;
    for (let i = 0; i < n; i++) {
      const p = makePlayer(r, { rarity: r() < 0.7 ? 'N' : 'R', origin: 'draft' });
      for (const k of Object.keys(p.stats)) if (k !== 'velo' && k !== 'stamina') p.stats[k] = Math.max(15, p.stats[k] - Math.floor(r() * 8));
      p.hidden = { ...p.hidden, gem: true, pot: G.pot[0] + Math.floor(r() * (G.pot[1] - G.pot[0] + 1)) };
      pool.push(p);
    }
  }
  function onDraftR1(day, lots, pool) {
    if (!lots.length) return;
    const lines = lots.map((l) => `${l.name}${l.entrants > 1 ? ` (${l.entrants}球団競合・抽選)` : ''} → ${teamName(l.winner)}`);
    const comp = lots.filter((l) => l.entrants > 1).sort((a, b) => b.entrants - a.entrants)[0];
    news('draft', comp ? `【ドラフト速報】${comp.name}に${comp.entrants}球団が競合、${teamName(comp.winner)}が交渉権` : `【ドラフト速報】1巡目で${lots.length}人が指名`, `${day}のドラフト会議 1巡目の結果。${lines.join('／')}。`, { imp: 2, uid: comp ? comp.winner : null, player: comp?.name || '' });
    for (const l of lots) { const p = pool.find((x) => x.id === l.player); if (p?.star) news('draft', `目玉の${p.name}は${teamName(l.winner)}へ`, `注目の${p.name}(${p.pos})は${l.entrants}球団の指名を受け、${teamName(l.winner)}が交渉権を獲得した。`, { uid: l.winner, player: p.name, imp: 2 }); }
  }
  function onDraftR2(day, picks) { if (picks.length) news('draft', `ドラフト会議が終了、2巡目で${picks.length}人`, `${day}のドラフト会議 2巡目。${picks.map((x) => `${teamName(x.uid)}: ${x.name}`).join('／')}。各球団の新戦力に注目が集まる。`, { imp: 1 }); }

  // ---------- スカウト ----------
  function scoutReport(p, lv) {
    const S = CFG.scout, w = S.width[Math.max(0, Math.min(S.width.length - 1, lv - 1))];
    const est = {};
    for (const [k, v] of Object.entries(p.stats)) {
      const ww = k === 'velo' ? Math.max(2, Math.round(w / 2)) : w, c = v + (sr() - 0.5) * ww * 0.9;
      const lo = Math.round(c - ww / 2), hi = lo + ww;
      est[k] = k === 'velo' ? [Math.max(110, lo), Math.min(170, hi)] : [Math.max(1, lo), Math.min(99, hi)];
    }
    const mids = Object.entries(est).filter(([k]) => k !== 'velo' && k !== 'stamina').map(([k, [a, b]]) => [k, (a + b) / 2]).sort((a, b) => b[1] - a[1]);
    const pot = p.hidden?.pot ?? 50, potEst = pot + (sr() - 0.5) * (36 - lv * 6);
    const gem = !!(p.hidden?.gem), bloom = !!(p.hidden?.bloom);
    const found = (gem || bloom) && sr() < S.gemFind[lv - 1];
    const fake = !gem && !bloom && pot >= 70 && sr() < 0.08;
    let pos = [];
    if (p.kind === 'P') pos = [(est.stamina[0] + est.stamina[1]) / 2 >= 60 ? '先発' : '中継ぎ', ...((est.stuff[0] + est.stuff[1]) / 2 >= 70 ? ['抑え'] : [])];
    else { pos = [p.pos]; const m = (k) => (est[k][0] + est[k][1]) / 2; if (m('tech') >= 68 && !['遊', '二'].includes(p.pos)) pos.push('二'); if (m('speed') >= 70 && p.pos !== '中') pos.push('中'); if (m('power') >= 72 && !['一', '指'].includes(p.pos)) pos.push('一'); }
    const hasSp = (p.specials || []).length > 0, spSeen = sr() < S.spFind[lv - 1];
    return {
      lv, est, strong: STAT_NAME[mids[0][0]], weak: STAT_NAME[mids[mids.length - 1][0]],
      future: grade(Math.max(0, Math.min(100, potEst + (found ? 25 : 0)))), futureNote: found ? (gem ? '🌟 隠れた逸材の可能性。伸びしろは計り知れない' : '🌙 晩成型。試合経験で化けるかもしれない') : fake ? '伸びしろ十分' : '',
      pos: [...new Set(pos)].slice(0, 3),
      special: hasSp ? (spSeen ? (lv >= 4 ? `「${SPECIALS[p.specials[0]]?.name}」を持っている` : '特殊能力を持っている可能性: 高') : '特殊能力の可能性: 不明') : (spSeen ? '特殊能力の可能性: 低' : '特殊能力の可能性: 不明'),
    };
  }
  function poolView(p, uid, day) {
    const rep = db.prepare('SELECT report FROM bb_scout WHERE day = ? AND user_id = ? AND player_id = ?').get(day, uid, p.id);
    const q = ensure({ ...p });
    return { id: p.id, name: p.name, kind: p.kind, pos: p.pos, number: p.number, rarity: p.rarity, look: p.look, age: q.age, star: !!p.star, pitchesN: (p.pitches || []).length,
      specials: p.star ? (p.specials || []).map((k) => ({ id: k, ...SPECIALS[k] })) : [], scout: rep ? JSON.parse(rep.report) : null };
  }
  app.post('/api/bb/scout', requireAuth, limit, (req, res) => {
    const uid = req.user.id, t = teamRow(uid); if (!t) return res.status(400).json({ error: 'まだ始めていません' });
    const day = dayKey(), dp = B.draftPool(day), p = dp.pool.find((x) => x.id === String(req.body?.player || '')); if (!p) return res.status(400).json({ error: 'その選手はいません' });
    if (B.draftPhase() === 'done') return res.status(400).json({ error: '今日のドラフトは終わりました' });
    const old = db.prepare('SELECT report FROM bb_scout WHERE day = ? AND user_id = ? AND player_id = ?').get(day, uid, p.id);
    if (old && JSON.parse(old.report).lv >= t.scout_lv) return res.json({ report: JSON.parse(old.report), cost: 0 });
    const used = db.prepare('SELECT COUNT(*) n FROM bb_scout WHERE day = ? AND user_id = ?').get(day, uid).n, cost = old || used < CFG.scout.free ? 0 : CFG.scout.cost;
    db.exec('BEGIN');
    try {
      if (cost && !db.prepare('UPDATE bb_teams SET souls = souls - ? WHERE user_id = ? AND souls >= ?').run(cost, uid, cost).changes) { db.exec('ROLLBACK'); return res.status(400).json({ error: `たましいが足りません (${cost})` }); }
      const rep = scoutReport(ensure({ ...p, hidden: { ...(p.hidden || {}) } }), t.scout_lv);
      db.prepare('INSERT OR REPLACE INTO bb_scout (day, user_id, player_id, report, at) VALUES (?, ?, ?, ?, ?)').run(day, uid, p.id, JSON.stringify(rep), now0());
      db.exec('COMMIT');
      res.json({ report: rep, cost });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  app.post('/api/bb/scout/upgrade', requireAuth, limit, (req, res) => {
    const uid = req.user.id, t = teamRow(uid); if (!t) return res.status(400).json({ error: 'まだ始めていません' });
    const S = CFG.scout; if (t.scout_lv >= S.maxLv) return res.status(400).json({ error: 'スカウトはもう最高レベルです' });
    const cost = S.levelCost[t.scout_lv];
    const u = db.prepare('UPDATE bb_teams SET souls = souls - ?, scout_lv = scout_lv + 1 WHERE user_id = ? AND souls >= ? AND scout_lv = ?').run(cost, uid, cost, t.scout_lv);
    if (!u.changes) return res.status(400).json({ error: `たましいが足りません (${cost})` });
    res.json({ ok: true, lv: t.scout_lv + 1 });
  });
  const scoutInfo = (uid) => { const t = teamRow(uid), S = CFG.scout, day = dayKey(); return { lv: t?.scout_lv || 1, maxLv: S.maxLv, next: t && t.scout_lv < S.maxLv ? S.levelCost[t.scout_lv] : null, free: S.free, cost: S.cost, used: db.prepare('SELECT COUNT(*) n FROM bb_scout WHERE day = ? AND user_id = ?').get(day, uid).n }; };

  // ---------- 市場価値 (参考) ----------
  function value(p) {
    const o = ovr(p), am = p.age <= 24 ? 1.25 : p.age <= 29 ? 1.1 : p.age <= 32 ? 1 : p.age <= 35 ? 0.75 : 0.5;
    const sp = (p.specials || []).filter((k) => !SPECIALS[k]?.award).length, aw = (p.specials || []).filter((k) => SPECIALS[k]?.award).length;
    return Math.round((50 + o * o * 0.12) * am + sp * 120 + aw * 200 + ({ N: 0, R: 50, SR: 150, SSR: 400 }[p.rarity] || 0));
  }

  // ---------- トレード ----------
  const TR = CFG.trade;
  function releaseLocks(tid) { db.prepare('DELETE FROM bb_trade_locks WHERE trade_id = ?').run(tid); }
  function voidTradesFor(ids, at = now0()) {
    const set = new Set(ids);
    for (const t of db.prepare("SELECT id, give, get FROM bb_trades WHERE status = 'pending'").all()) {
      if ([...JSON.parse(t.give), ...JSON.parse(t.get)].some((id) => set.has(id))) { db.prepare("UPDATE bb_trades SET status = 'void', decided_at = ? WHERE id = ? AND status = 'pending'").run(at, t.id); releaseLocks(t.id); }
    }
  }
  const isLocked = (pid) => !!db.prepare('SELECT 1 FROM bb_trade_locks WHERE player_id = ?').get(pid);
  function expireTrades(now = now0()) {
    for (const t of db.prepare("SELECT id FROM bb_trades WHERE status = 'pending' AND expires_at < ?").all(now)) { db.prepare("UPDATE bb_trades SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'").run(now, t.id); releaseLocks(t.id); }
  }
  const pubP = (p) => ({ ...pubPlayer(p), value: value(p), locked: isLocked(p.id) });
  app.get('/api/bb/trade/teams', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 20).replace(/[%_\\]/g, (c) => '\\' + c);
    const rows = db.prepare(`SELECT b.user_id, b.name, b.league, b.wins, b.losses, b.rate, u.username, (SELECT COUNT(*) FROM bb_players p WHERE p.owner_id = b.user_id AND p.retired_at IS NULL) n
      FROM bb_teams b JOIN users u ON u.id = b.user_id WHERE b.user_id != ? ${q ? "AND (b.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')" : ''} ORDER BY b.rate DESC LIMIT 40`).all(...[req.user.id, ...(q ? [`%${q}%`, `%${q}%`] : [])]);
    res.json({ teams: rows.map((x) => ({ uid: x.user_id, name: x.name, username: x.username, league: x.league, leagueName: LEAGUE_NAME[x.league], wins: x.wins, losses: x.losses, rate: x.rate, players: x.n })) });
  });
  app.get('/api/bb/trade/team/:uid', requireAuth, (req, res) => {
    const uid = Number(req.params.uid), t = teamRow(uid); if (!t) return res.status(404).json({ error: 'そのチームはありません' });
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(uid);
    res.json({ team: { uid, name: t.name, username: u?.username || '', league: t.league, leagueName: LEAGUE_NAME[t.league], wins: t.wins, losses: t.losses, rate: t.rate }, players: playersOf(uid).map(pubP) });
  });
  const tradeView = (t, me) => { const d = JSON.parse(t.detail || '{}'); return { id: t.id, from: { uid: t.from_uid, name: teamName(t.from_uid) || d.fromName }, to: { uid: t.to_uid, name: teamName(t.to_uid) || d.toName }, give: d.give || [], get: d.get || [], message: t.message, status: t.status, createdAt: t.created_at, expiresAt: t.expires_at, decidedAt: t.decided_at, incoming: t.to_uid === me }; };
  app.get('/api/bb/trades', requireAuth, (req, res) => {
    const uid = req.user.id; expireTrades();
    const rows = db.prepare('SELECT * FROM bb_trades WHERE from_uid = ? OR to_uid = ? ORDER BY created_at DESC LIMIT 60').all(uid, uid).map((t) => tradeView(t, uid));
    res.json({ pending: rows.filter((t) => t.status === 'pending'), history: rows.filter((t) => t.status !== 'pending'), rules: TR, mine: playersOf(uid).map(pubP) });
  });
  const ids = (a) => [...new Set((Array.isArray(a) ? a : []).map(String))];
  app.post('/api/bb/trades', requireAuth, limit, (req, res) => {
    const uid = req.user.id, to = Number(req.body?.to), give = ids(req.body?.give), get = ids(req.body?.get), message = String(req.body?.message || '').trim().slice(0, 80);
    if (!teamRow(uid)) return res.status(400).json({ error: 'まだ始めていません' });
    if (!to || to === uid || !teamRow(to)) return res.status(400).json({ error: '相手のチームが正しくありません' });
    if (give.length < 1 || give.length > TR.maxSide || get.length < 1 || get.length > TR.maxSide) return res.status(400).json({ error: `出す選手・ほしい選手はそれぞれ 1〜${TR.maxSide} 人です` });
    expireTrades();
    if (db.prepare("SELECT COUNT(*) n FROM bb_trades WHERE from_uid = ? AND status = 'pending'").get(uid).n >= TR.maxPending) return res.status(400).json({ error: `申請中のトレードは ${TR.maxPending} 件までです` });
    const mine = new Map(playersOf(uid).map((p) => [p.id, p])), theirs = new Map(playersOf(to).map((p) => [p.id, p]));
    if (!give.every((id) => mine.has(id))) return res.status(400).json({ error: '出す選手は自分の (現役の) 選手からえらんでください' });
    if (!get.every((id) => theirs.has(id))) return res.status(400).json({ error: 'ほしい選手は相手の (現役の) 選手からえらんでください' });
    const now = now0(), detail = { fromName: teamName(uid), toName: teamName(to), give: give.map((id) => mine.get(id)).map((p) => ({ id: p.id, name: p.name, kind: p.kind, pos: p.pos, rarity: p.rarity, value: value(p) })), get: get.map((id) => theirs.get(id)).map((p) => ({ id: p.id, name: p.name, kind: p.kind, pos: p.pos, rarity: p.rarity, value: value(p) })) };
    db.exec('BEGIN');
    try {
      const tid = Number(db.prepare("INSERT INTO bb_trades (from_uid, to_uid, give, get, detail, message, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)").run(uid, to, JSON.stringify(give), JSON.stringify(get), JSON.stringify(detail), message, now, now + TR.expireHours * 3600_000).lastInsertRowid);
      for (const id of give) db.prepare('INSERT INTO bb_trade_locks (player_id, trade_id) VALUES (?, ?)').run(id, tid); // 同じ選手は 1 つのトレードにだけ (主キーで二重を防ぐ)
      db.exec('COMMIT');
      res.json({ ok: true, id: tid });
    } catch (e) { db.exec('ROLLBACK'); if (/UNIQUE|PRIMARY/i.test(e.message)) return res.status(409).json({ error: 'その選手は別のトレードに出しています' }); throw e; }
  });
  app.post('/api/bb/trades/:id/:act', requireAuth, limit, (req, res) => {
    const uid = req.user.id, id = Number(req.params.id), act = req.params.act, now = now0();
    const t = db.prepare('SELECT * FROM bb_trades WHERE id = ?').get(id); if (!t) return res.status(404).json({ error: 'そのトレードはありません' });
    if (t.status !== 'pending') return res.status(409).json({ error: 'このトレードはもう終わっています' });
    if (act === 'cancel' || act === 'reject') {
      if ((act === 'cancel' && t.from_uid !== uid) || (act === 'reject' && t.to_uid !== uid)) return res.status(403).json({ error: 'このトレードは操作できません' });
      const u = db.prepare('UPDATE bb_trades SET status = ?, decided_at = ? WHERE id = ? AND status = ?').run(act === 'cancel' ? 'cancelled' : 'rejected', now, id, 'pending');
      if (!u.changes) return res.status(409).json({ error: 'このトレードはもう終わっています' });
      releaseLocks(id); return res.json({ ok: true });
    }
    if (act !== 'accept') return res.status(400).json({ error: '操作が正しくありません' });
    if (t.to_uid !== uid) return res.status(403).json({ error: 'このトレードは操作できません' });
    const give = JSON.parse(t.give), get = JSON.parse(t.get);
    db.exec('BEGIN');
    const fail = (code, msg, status = null) => { if (status) { db.prepare('UPDATE bb_trades SET status = ?, decided_at = ? WHERE id = ? AND status = ?').run(status, now, id, 'pending'); releaseLocks(id); db.exec('COMMIT'); } else db.exec('ROLLBACK'); return res.status(code).json({ error: msg }); };
    try {
      if (t.expires_at < now) return fail(409, 'このトレードは期限が切れました', 'expired');
      const own = (pid, owner) => db.prepare('SELECT kind FROM bb_players WHERE id = ? AND owner_id = ? AND retired_at IS NULL').get(pid, owner);
      if (!give.every((pid) => own(pid, t.from_uid)) || !get.every((pid) => own(pid, t.to_uid))) return fail(409, '選手の所属が変わったため、このトレードは成立できません', 'void');
      const lockedElse = get.find((pid) => { const l = db.prepare('SELECT trade_id FROM bb_trade_locks WHERE player_id = ?').get(pid); return l && l.trade_id !== id; });
      if (lockedElse) return fail(409, 'ほしいと言われた選手を、別のトレードに出しています。そちらを取り消してから承認してください');
      // 人数の確認 (40 人まで・野手 9 人と投手 5 人は残す)
      const count = (owner, minus, plus) => { const ps = playersOf(owner).filter((p) => !minus.includes(p.id)); const add = plus.map((pid) => db.prepare('SELECT kind FROM bb_players WHERE id = ?').get(pid)); const all = [...ps.map((p) => p.kind), ...add.map((a) => a.kind)]; return { n: all.length, B: all.filter((k) => k === 'B').length, P: all.filter((k) => k === 'P').length }; };
      const cf = count(t.from_uid, give, get), ct = count(t.to_uid, get, give);
      for (const [c, who] of [[cf, '申請した側'], [ct, 'あなた']]) { if (c.n > ROSTER_MAX) return fail(400, `${who}の選手が ${ROSTER_MAX} 人をこえます`); if (c.B < 9 || c.P < 5) return fail(400, `${who}のチームが野手 9 人・投手 5 人より少なくなります`); }
      if (!db.prepare("UPDATE bb_trades SET status = 'accepted', decided_at = ? WHERE id = ? AND status = 'pending'").run(now, id).changes) return fail(409, 'このトレードはもう終わっています');
      for (const pid of give) db.prepare('UPDATE bb_players SET owner_id = ? WHERE id = ? AND owner_id = ?').run(t.to_uid, pid, t.from_uid);
      for (const pid of get) db.prepare('UPDATE bb_players SET owner_id = ? WHERE id = ? AND owner_id = ?').run(t.from_uid, pid, t.to_uid);
      releaseLocks(id); voidTradesFor([...give, ...get], now);
      for (const u2 of [t.from_uid, t.to_uid]) { const tr = teamRow(u2), all = [...give, ...get], lu = JSON.parse(tr.lineup), rot = JSON.parse(tr.rotation), bp = JSON.parse(tr.bullpen); if (all.some((pid) => lu.includes(pid) || rot.includes(pid) || (bp.setup || []).includes(pid) || bp.closer === pid)) autoLineup(u2); }
      const d = JSON.parse(t.detail || '{}'), fn = teamName(t.from_uid), tn = teamName(t.to_uid);
      news('trade', `${fn}と${tn}がトレード成立`, `${fn}の${(d.give || []).map((p) => `${p.name}(${p.pos})`).join('・')}と、${tn}の${(d.get || []).map((p) => `${p.name}(${p.pos})`).join('・')}を交換するトレードが成立した。両選手は新天地での活躍を誓った。`, { uid: t.from_uid, team: fn, player: (d.give || [])[0]?.name || '', imp: 2, data: { trade: id, to: t.to_uid } });
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  });

  // ---------- ニュース・ホーム・選手・図鑑・覚醒 ----------
  app.get('/api/bb/news', requireAuth, (req, res) => {
    const cat = CAT[req.query.cat] ? String(req.query.cat) : null, mine = req.query.mine === '1', before = Number(req.query.before) || 1e15, lim = Math.max(1, Math.min(40, Number(req.query.limit) || 20));
    const rows = db.prepare(`SELECT * FROM bb_news WHERE id < ? ${cat ? 'AND cat = ?' : ''} ${mine ? 'AND user_id = ?' : ''} ${!cat && !mine && req.query.all !== '1' ? "AND (cat != 'game' OR user_id = ?)" : ''} ORDER BY id DESC LIMIT ?`)
      .all(...[before, ...(cat ? [cat] : []), ...(mine ? [req.user.id] : []), ...(!cat && !mine && req.query.all !== '1' ? [req.user.id] : []), lim]);
    res.json({ news: rows.map((n) => ({ ...newsView(n), mine: n.user_id === req.user.id })), cats: CAT });
  });
  app.get('/api/bb/news/:id', requireAuth, (req, res) => { const n = db.prepare('SELECT * FROM bb_news WHERE id = ?').get(Number(req.params.id)); if (!n) return res.status(404).json({ error: '記事が見つかりません' }); res.json({ news: { ...newsView(n), mine: n.user_id === req.user.id } }); });
  app.get('/api/bb/home', requireAuth, (req, res) => {
    const uid = req.user.id, me = B.meView(uid); if (!me.started) return res.json({ me });
    expireTrades();
    const t = teamRow(uid), lg = t.league === 'king' ? ['champion', 'king'] : [t.league], champ = t.league === 'champion' || t.league === 'king';
    const order = db.prepare(`SELECT user_id FROM bb_teams WHERE league IN (${lg.map(() => '?').join(',')}) ORDER BY ${champ ? 'rate DESC' : 'lwins DESC, wins DESC'}`).all(...lg).map((x) => x.user_id);
    const headline = db.prepare("SELECT * FROM bb_news WHERE imp >= 2 AND at > ? ORDER BY imp DESC, id DESC LIMIT 1").get(now0() - 3 * 86400_000);
    const latest = db.prepare("SELECT * FROM bb_news WHERE (cat != 'game' OR user_id = ?) ORDER BY id DESC LIMIT 6").all(uid);
    // 直近の活躍 (自分の最近 12 試合)
    const box = new Map();
    for (const g of db.prepare('SELECT box, home_uid FROM bb_games WHERE (home_uid = ? OR away_uid = ?) ORDER BY at DESC LIMIT 12').all(uid, uid)) {
      const side = g.home_uid === uid ? 'home' : 'away';
      for (const x of JSON.parse(g.box).box.filter((y) => y.team === side)) { const o = box.get(x.id) || { id: x.id, name: x.name, kind: x.kind, ab: 0, h: 0, hr: 0, rbi: 0, w: 0, sv: 0, k: 0, outs: 0, er: 0 }; for (const k of ['ab', 'h', 'hr', 'rbi', 'w', 'sv', 'k', 'outs', 'er']) o[k] += x[k] || 0; box.set(x.id, o); }
    }
    const sc = (o) => (o.kind === 'B' ? o.h * 2 + o.hr * 4 + o.rbi * 1.5 : o.w * 4 + o.sv * 3 + o.k * 0.6 + o.outs * 0.15 - o.er * 1.5);
    const stars = [...box.values()].sort((a, b) => sc(b) - sc(a)).slice(0, 3).map((o) => { const p = me.players.find((x) => x.id === o.id); return p ? { player: p, line: o.kind === 'B' ? `${o.ab}打数${o.h}安打 ${o.hr}本 ${o.rbi}打点` : `${ipStr(o.outs)}回 ${o.k}K ${o.w}勝${o.sv ? ` ${o.sv}S` : ''} 防${fmtEra(o.er, o.outs)}` } : null; }).filter(Boolean);
    const now = now0(), day = dayKey(now), times = B.draftTimes(day), next = B.draftPhase(now) === 'done' ? B.draftTimes(dayKey(now + 86400_000)) : times;
    const ticket = !!db.prepare('SELECT 1 FROM bb_draft WHERE day = ? AND user_id = ?').get(day, uid);
    res.json({ me, rank: order.indexOf(uid) + 1, teamsInLeague: order.length, headline: headline ? newsView(headline) : null, news: latest.map((n) => ({ ...newsView(n), mine: n.user_id === uid })), stars,
      draft: { phase: B.draftPhase(now), times: next, ticket, price: B.TICKET }, trades: db.prepare("SELECT COUNT(*) n FROM bb_trades WHERE to_uid = ? AND status = 'pending'").get(uid).n,
      awakenings: awakeningsOf(uid, true) });
  });
  function awakeningsOf(uid, unseen) {
    return db.prepare(`SELECT a.*, p.name, p.kind, p.pos, p.rarity, p.number, p.look FROM bb_awaken a JOIN bb_players p ON p.id = a.player_id WHERE a.user_id = ? ${unseen ? 'AND a.seen = 0' : ''} ORDER BY a.id DESC LIMIT 10`).all(uid)
      .map((a) => ({ id: a.id, at: a.at, player: { id: a.player_id, name: a.name, kind: a.kind, pos: a.pos, rarity: a.rarity, number: a.number, look: JSON.parse(a.look) }, before: JSON.parse(a.before), after: JSON.parse(a.after), gains: JSON.parse(a.gains), newPitch: a.new_pitch ? { id: a.new_pitch, name: C.PITCHES[a.new_pitch]?.name } : null, newSpecial: a.new_special ? { id: a.new_special, ...SPECIALS[a.new_special] } : null }));
  }
  app.post('/api/bb/awaken/seen', requireAuth, limit, (req, res) => { if (req.body?.all) { db.prepare('UPDATE bb_awaken SET seen = 1 WHERE user_id = ?').run(req.user.id); return res.json({ ok: true }); } for (const id of ids(req.body?.ids).slice(0, 20)) db.prepare('UPDATE bb_awaken SET seen = 1 WHERE id = ? AND user_id = ?').run(Number(id), req.user.id); res.json({ ok: true }); });
  app.get('/api/bb/player/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM bb_players WHERE id = ?').get(String(req.params.id)); if (!row) return res.status(404).json({ error: 'その選手は見つかりません' });
    const p = rowToPlayer(row), ret = db.prepare('SELECT * FROM bb_retired WHERE player_id = ?').get(p.id);
    const seasons = db.prepare('SELECT * FROM bb_stats WHERE player_id = ? ORDER BY season').all(p.id).map((s) => ({ season: s.season, g: s.g, pa: s.pa, ab: s.ab, h: s.h, hr: s.hr, rbi: s.rbi, bb: s.bb, so: s.so, sb: s.sb, w: s.w, l: s.l, sv: s.sv, hld: s.hld, outs: s.outs, er: s.er, k: s.k, avg: fmtAvg(s.h, s.ab), era: fmtEra(s.er, s.outs) }));
    const aw = db.prepare('SELECT * FROM bb_awaken WHERE player_id = ? ORDER BY id').all(p.id).map((a) => ({ at: a.at, season: a.season, gains: JSON.parse(a.gains), before: JSON.parse(a.before), after: JSON.parse(a.after), newPitch: a.new_pitch ? C.PITCHES[a.new_pitch]?.name : null, newSpecial: a.new_special ? SPECIALS[a.new_special]?.name : null }));
    const owner = p.ownerId ? db.prepare('SELECT b.name, u.username FROM bb_teams b JOIN users u ON u.id = b.user_id WHERE b.user_id = ?').get(p.ownerId) : null;
    res.json({ player: { ...pubPlayer(p), value: p.retiredAt ? null : value(p), locked: isLocked(p.id) }, mine: p.ownerId === req.user.id && !p.retiredAt, team: ret ? ret.team : owner?.name || '', owner: owner?.username || '', seasons, career: careerTotals(p.id), titles: titlesOf(p.id), awakenings: aw,
      retired: ret ? { season: ret.retired_season, at: ret.retired_at, hof: !!ret.hof, hofReason: ret.hof_reason, age: ret.age, seasons: ret.seasons } : null });
  });
  app.get('/api/bb/zukan', requireAuth, (req, res) => {
    const tab = ['hof', 'retired', 'active'].includes(req.query.tab) ? req.query.tab : 'hof', q = String(req.query.q || '').trim().slice(0, 20);
    if (tab === 'active') {
      const rows = db.prepare(`SELECT p.*, b.name team FROM bb_players p JOIN bb_teams b ON b.user_id = p.owner_id WHERE p.retired_at IS NULL ${q ? "AND p.name LIKE ? ESCAPE '\\'" : ''} ORDER BY p.created_at DESC LIMIT 80`).all(...(q ? [`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`] : []));
      return res.json({ tab, players: rows.map((r) => ({ ...pubPlayer(rowToPlayer(r)), team: r.team })) });
    }
    const rows = db.prepare(`SELECT * FROM bb_retired WHERE 1 = 1 ${tab === 'hof' ? 'AND hof = 1' : ''} ${q ? "AND name LIKE ? ESCAPE '\\'" : ''} ORDER BY retired_at DESC LIMIT 100`).all(...(q ? [`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`] : []));
    res.json({ tab, players: rows.map((r) => ({ id: r.player_id, name: r.name, kind: r.kind, pos: r.pos, rarity: r.rarity, number: r.number, look: JSON.parse(r.look), team: r.team, age: r.age, seasons: r.seasons, retiredSeason: r.retired_season, totals: JSON.parse(r.totals), titles: JSON.parse(r.titles), hof: !!r.hof, hofReason: r.hof_reason })), hofRule: CFG.hof });
  });
  app.get('/api/bb/scout-info', requireAuth, (req, res) => res.json(scoutInfo(req.user.id)));

  return { ensure, ovr, grade, value, isLocked, afterGame, gameNews, onPromote, onSeasonClose, addGems, onDraftR1, onDraftR2, poolView, scoutInfo, expireTrades, news, careerTotals, retirePlayer, CFG };
};
module.exports.ovr = ovr;
module.exports.grade = grade;
module.exports.MIGRATION = MIGRATION;
