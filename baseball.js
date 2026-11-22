// =====================================================================
// IppO ベースボール (ミニゲーム): マイチーム (自動試合でリーグの昇格をめざす) とリアルタイム対戦 (投球カーソル・ミートカーソル)
//   ・選手はすべて架空 (実在の選手の名前は使わない)。ドラフト・ガチャで集める。通貨は「たましい」(マイチームの試合で増える)
//   ・マイチーム: 毎時 5 分に同じリーグのチームと自動で 1 試合 (相手がいなければ CPU)。勝ち 100 たましい・負け 30
//     リーグ: ブロンズ → シルバー → ゴールド → エリート → チャンピオン (12 勝で昇格)。チャンピオンはレート戦。
//     シーズンは 3 日ごと。終わると、チャンピオンでレートがいちばん高い人に「King of season N」の称号と KING。打率・本塁打などの表彰 → その選手に特殊能力
//   ・ドラフト会議: 毎日 9:35 (参加券 1500 たましい・9:30 まで)。1 巡目 9:35-9:40 (かぶったら抽選・9:41 発表)、2 巡目 9:45-9:50 (参加券を早く買った順)
//   ・ガチャ: 1 回 200 たましい。前日の試合で活躍した選手 (架空) が入る
//   ・リアルタイム対戦: WebSocket /bb。2 イニング + 延長タイブレーク (無死一・二塁から)。レート戦。相手がいなければ CPU と練習 (レートは変わらない)
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const C = require('./public/games/baseball/bb-core.js');
const CAREER = require('./baseball-career.js'); // 年齢・覚醒・引退・殿堂・新人王・ニュース・トレード・スカウト

const H = 3600_000, D = 24 * H;
const EPOCH = Date.parse('2026-11-22T00:00:00+09:00'), SEASON_MS = 3 * D;
const LEAGUES = ['bronze', 'silver', 'gold', 'elite', 'champion'];
const LEAGUE_NAME = { bronze: 'ブロンズ', silver: 'シルバー', gold: 'ゴールド', elite: 'エリート', champion: 'チャンピオン', king: 'KING' };
const WINDUP = 0.9; // リアルタイム対戦: 投げる合図からボールが手をはなれるまでの動き (秒)
const PROMOTE_WINS = 12, WIN_SOULS = 100, LOSE_SOULS = 30, START_SOULS = 1500, TICKET = 1500, GACHA = 200, ROSTER_MAX = 40;
const POS = ['捕', '一', '二', '三', '遊', '左', '中', '右', '指'];
const SURN = ['佐伯', '大河内', '神宮寺', '早乙女', '鳳', '千早', '霧島', '朝比奈', '東雲', '白鷺', '黒瀬', '真壁', '久遠', '天城', '若槻', '雪村', '橘', '御影', '桐生', '一ノ瀬', '如月', '有栖川', '風間', '氷室', '藤堂', '鷹野', '日向', '宗像', '鏑木', '葛城', '芹沢', '比嘉', '南雲', '北條', '西園寺', '小鳥遊', '五十嵐', '轟', '百瀬', '安曇'];
const GIVEN = ['翔', '蓮', '大和', '颯', '湊', '陽向', '律', '悠真', '蒼', '晴', '隼人', '慧', '拓海', '奏太', '樹', '凌', '健信', '琥珀', '迅', '昴', '雅人', '剛', '岳', '新', '玄', '旭', '尊', '暁', '凱', '航', '透', '宗一郎', '虎太郎', '龍之介', '鉄平', '伊織', '千尋', '恭平', '直哉', '鷹之'];
// 特殊能力 (架空・実名に関わらず、まれに持つ。ドラフトの目玉は必ず持つ。表彰されるとその称号の能力がつく)
const SPECIALS = {
  ibushi: { name: '燻し銀', kind: 'B', desc: '2 試合続けてノーヒットにはならない' },
  pinch: { name: 'ピンチヒッター', kind: 'B', desc: 'ピンチ (得点圏に走者) の場面で能力が大きく上がる' },
  clutch: { name: '勝負強さ', kind: 'B', desc: '終盤の接戦で能力が上がる' },
  idaten: { name: '韋駄天', kind: 'B', desc: '走塁がとても速い' },
  meishu: { name: '名手', kind: 'B', desc: '守備がとてもうまい (チームの守備が上がる)' },
  gouwan: { name: '剛腕', kind: 'P', desc: '三振を取りやすい' },
  nigedama: { name: '逃げ球', kind: 'P', desc: '長打を打たれにくい' },
  tetsuwan: { name: '鉄腕', kind: 'P', desc: 'スタミナがある (長いイニングを投げられる)' },
  kaibutsu: { name: '怪物', kind: '*', desc: 'すべての能力が少し上がる' },
  // 表彰の称号の能力
  t_avg: { name: '首位打者', kind: 'B', desc: '表彰: ミートが上がる', award: true },
  t_hr: { name: '本塁打王', kind: 'B', desc: '表彰: パワーが上がる', award: true },
  t_def: { name: 'ゴールデングラブ', kind: 'B', desc: '表彰: 守備がうまくなる', award: true },
  t_win: { name: '最多勝', kind: 'P', desc: '表彰: 球威が上がる', award: true },
  t_sv: { name: 'セーブ王', kind: 'P', desc: '表彰: 9 回に強くなる', award: true },
  t_hld: { name: 'ホールド王', kind: 'P', desc: '表彰: 7・8 回に強くなる', award: true },
  t_rookie: { name: '新人王', kind: '*', desc: '表彰: 新人王 (能力が少し上がる)', award: true },
};
const AWARDS = [
  { id: 't_avg', name: '首位打者', stat: 'avg', unit: '打率', fmt: (v) => v.toFixed(3).replace(/^0/, '') },
  { id: 't_hr', name: '本塁打王', stat: 'hr', unit: '本塁打' },
  { id: 't_def', name: 'ゴールデングラブ (守備評価)', stat: 'def', unit: '守備評価' },
  { id: 't_sv', name: 'セーブ王', stat: 'sv', unit: 'セーブ' },
  { id: 't_hld', name: 'ホールド王', stat: 'hld', unit: 'ホールド' },
  { id: 't_win', name: '最多勝', stat: 'w', unit: '勝' },
];

const MIGRATION = `
CREATE TABLE IF NOT EXISTS bb_teams (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, souls INTEGER NOT NULL DEFAULT 0, league TEXT NOT NULL DEFAULT 'bronze',
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, lwins INTEGER NOT NULL DEFAULT 0, rate INTEGER NOT NULL DEFAULT 1500,
  rt_rate INTEGER NOT NULL DEFAULT 1500, rt_w INTEGER NOT NULL DEFAULT 0, rt_l INTEGER NOT NULL DEFAULT 0,
  season INTEGER NOT NULL DEFAULT 0, lineup TEXT NOT NULL DEFAULT '[]', rotation TEXT NOT NULL DEFAULT '[]', bullpen TEXT NOT NULL DEFAULT '{}', rot_idx INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_players (
  id TEXT PRIMARY KEY, owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, pos TEXT NOT NULL, number INTEGER NOT NULL,
  stats TEXT NOT NULL, pitches TEXT NOT NULL DEFAULT '[]', specials TEXT NOT NULL DEFAULT '[]', rarity TEXT NOT NULL, origin TEXT NOT NULL,
  hidden TEXT NOT NULL DEFAULT '{}', games INTEGER NOT NULL DEFAULT 0, look TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_players_owner ON bb_players(owner_id);
CREATE TABLE IF NOT EXISTS bb_stats (
  season INTEGER NOT NULL, player_id TEXT NOT NULL, user_id INTEGER NOT NULL,
  g INTEGER NOT NULL DEFAULT 0, pa INTEGER NOT NULL DEFAULT 0, ab INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0, hr INTEGER NOT NULL DEFAULT 0, rbi INTEGER NOT NULL DEFAULT 0,
  bb INTEGER NOT NULL DEFAULT 0, so INTEGER NOT NULL DEFAULT 0, def INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, sv INTEGER NOT NULL DEFAULT 0, hld INTEGER NOT NULL DEFAULT 0, outs INTEGER NOT NULL DEFAULT 0, er INTEGER NOT NULL DEFAULT 0, k INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, player_id)
);
CREATE TABLE IF NOT EXISTS bb_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER NOT NULL, at INTEGER NOT NULL, league TEXT NOT NULL,
  home_uid INTEGER, away_uid INTEGER, home_name TEXT NOT NULL, away_name TEXT NOT NULL, hs INTEGER NOT NULL, as_ INTEGER NOT NULL, box TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bb_games_home ON bb_games(home_uid, at);
CREATE INDEX IF NOT EXISTS bb_games_away ON bb_games(away_uid, at);
CREATE TABLE IF NOT EXISTS bb_draft (day TEXT NOT NULL, user_id INTEGER NOT NULL, bought_at INTEGER NOT NULL, pick1 TEXT, pick2 TEXT, got1 TEXT, got2 TEXT, PRIMARY KEY (day, user_id));
CREATE TABLE IF NOT EXISTS bb_draft_pool (day TEXT PRIMARY KEY, pool TEXT NOT NULL, r1 INTEGER NOT NULL DEFAULT 0, r2 INTEGER NOT NULL DEFAULT 0, lots TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS bb_hot (day TEXT NOT NULL, player TEXT NOT NULL, score REAL NOT NULL);
CREATE INDEX IF NOT EXISTS bb_hot_day ON bb_hot(day, score DESC);
CREATE TABLE IF NOT EXISTS bb_seasons (season INTEGER PRIMARY KEY, king_uid INTEGER, done_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bb_awards (season INTEGER NOT NULL, award TEXT NOT NULL, player_id TEXT NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (season, award));
CREATE TABLE IF NOT EXISTS bb_rt_games (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, p1 INTEGER NOT NULL, p2 INTEGER, s1 INTEGER NOT NULL, s2 INTEGER NOT NULL, rated INTEGER NOT NULL, d1 INTEGER NOT NULL DEFAULT 0, d2 INTEGER NOT NULL DEFAULT 0);
`;

const jst = (t = Date.now()) => new Date(t + 9 * H);
const dayKey = (t = Date.now()) => jst(t).toISOString().slice(0, 10);
const seasonOf = (t = Date.now()) => Math.max(1, Math.floor((t - EPOCH) / SEASON_MS) + 1);
const seasonEnd = (s) => EPOCH + s * SEASON_MS;
const rint = (r, a, b) => Math.floor(a + r() * (b - a + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];

// ---------- 選手をつくる ----------
const RAR = { N: [25, 55], R: [38, 68], SR: [52, 80], SSR: [66, 92] };
function makePlayer(r, { kind = r() < 0.45 ? 'P' : 'B', rarity = 'N', pos = null, special = null, origin = 'gen' } = {}) {
  const [lo, hi] = RAR[rarity] || RAR.N, st = () => rint(r, lo, hi);
  const p = { id: crypto.randomBytes(6).toString('hex'), name: pick(r, SURN) + ' ' + pick(r, GIVEN), kind, rarity, origin, number: rint(r, 0, 99), specials: [], hidden: {},
    look: { skin: rint(r, 0, 3), hair: rint(r, 0, 4), h: 0.95 + r() * 0.12, build: 0.9 + r() * 0.25, beard: r() < 0.15, bat: r() < 0.3 ? 'L' : 'R' } };
  if (kind === 'P') {
    const n = Math.max(3, Math.min(9, Math.round(6 + (r() - 0.5) * 3 + (rarity === 'SSR' ? 1 : 0)))); // 平均 6 種類
    const pool = C.PITCH_IDS.filter((x) => x !== 'straight' && x !== 'fireball' && x !== 'fourseam');
    const ps = ['straight']; while (ps.length < n) { const x = pick(r, pool); if (!ps.includes(x)) ps.push(x); }
    if (rarity !== 'N' && r() < 0.18) ps[0] = 'fireball'; else if (r() < 0.3) ps[0] = 'fourseam';
    p.pos = pos || (r() < 0.6 ? '先' : '中'); p.pitches = ps;
    p.stats = { velo: rint(r, 128 + (lo - 25) * 0.35, 142 + (hi - 55) * 0.5), brk: st(), stuff: st(), stamina: rint(r, 30, 95) };
  } else {
    p.pos = pos || pick(r, POS.slice(0, 8)); p.pitches = [];
    p.stats = { meet: st(), power: st(), speed: st(), tech: st() };
  }
  const sp = special || (r() < (rarity === 'SSR' ? 0.5 : rarity === 'SR' ? 0.2 : 0.06) ? pick(r, Object.keys(SPECIALS).filter((k) => !SPECIALS[k].award && (SPECIALS[k].kind === kind || SPECIALS[k].kind === '*'))) : null);
  if (sp) p.specials.push(sp);
  return p;
}
// 特殊能力・表彰を入れた試合用の能力
function eff(p) {
  const s = { ...p.stats }, has = (k) => p.specials.includes(k), up = (k, v) => { s[k] = Math.min(99, (s[k] || 0) + v); };
  if (has('kaibutsu')) for (const k of Object.keys(s)) if (k !== 'velo' && k !== 'stamina') up(k, 5);
  if (has('kaibutsu') && p.kind === 'P') s.velo += 3;
  if (has('t_avg')) up('meet', 6); if (has('t_hr')) up('power', 6); if (has('t_def') || has('meishu')) up('tech', has('t_def') ? 8 : 6);
  if (has('t_rookie')) for (const k of Object.keys(s)) if (k !== 'velo' && k !== 'stamina') up(k, 2);
  if (has('idaten')) up('speed', 10); if (has('t_win')) up('stuff', 6); if (has('tetsuwan')) up('stamina', 15);
  return s;
}

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-22-baseball', MIGRATION);
  db.migrate('2026-11-23-bb-career', CAREER.MIGRATION); // 列と表の追加 (年齢・キャリア・引退・盗塁・スカウト・ニュース・トレードなど)
  const sr = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31; // サーバーの乱数
  let career = null; // baseball-career.js (下で用意する)
  const limit = rateLimit({ windowMs: 60_000, max: 60, key: (req) => 'bb' + req.user.id });
  // しばらくはテスターだけ (環境変数 BB_TESTERS = カンマ区切りのユーザー名。未設定なら RCN413。* で全員)。ほかの人には API も対戦も開かない
  const TESTERS = new Set(String(process.env.BB_TESTERS ?? 'RCN413').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const isTester = (u) => !!u && (TESTERS.has('*') || TESTERS.has(String(u.username).toLowerCase()));
  const isAdmin = (u) => !!(ctx.isAdmin && ctx.isAdmin(u));
  app.get('/api/bb-access', (req, res) => res.json({ ok: isTester(req.user) }));
  app.use('/api/bb', (req, res, next) => (isTester(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: 'IppO ベースボールはまだ準備中です' })));

  const rowToPlayer = (r) => r && { id: r.id, ownerId: r.owner_id, name: r.name, kind: r.kind, pos: r.pos, number: r.number, stats: JSON.parse(r.stats), pitches: JSON.parse(r.pitches), specials: JSON.parse(r.specials), rarity: r.rarity, origin: r.origin, hidden: JSON.parse(r.hidden), games: r.games, look: JSON.parse(r.look), age: r.age || 0, seasons: r.seasons || 0, rookieSeason: r.rookie_season ?? null, retiredAt: r.retired_at ?? null, ...(JSON.parse(r.hidden).real ? { real: JSON.parse(r.hidden).real } : {}) };
  const qIns = db.prepare('INSERT INTO bb_players (id, owner_id, name, kind, pos, number, stats, pitches, specials, rarity, origin, hidden, games, look, created_at, age, rookie_season) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)');
  const savePlayer = (p, owner) => { career.ensure(p); return qIns.run(p.id, owner, p.name, p.kind, p.pos, p.number, JSON.stringify(p.stats), JSON.stringify(p.pitches || []), JSON.stringify(p.specials || []), p.rarity, p.origin, JSON.stringify(p.hidden || {}), JSON.stringify(p.look || {}), Date.now(), p.age, p.rookieSeason ?? null); };
  const playersOf = (uid) => db.prepare('SELECT * FROM bb_players WHERE owner_id = ? AND retired_at IS NULL ORDER BY created_at').all(uid).map(rowToPlayer); // 引退した選手は図鑑へ (一覧には出さない)
  const teamRow = (uid) => db.prepare('SELECT * FROM bb_teams WHERE user_id = ?').get(uid);
  // 公開する選手の形 (隠している「大化け」は見せない)
  const pubPlayer = (p) => ({ ...(p.real ? { real: { team: p.real.team || '', note: p.real.note || '' } } : {}), id: p.id, name: p.name, kind: p.kind, pos: p.pos, number: p.number, stats: p.stats, pitches: (p.pitches || []).map((x) => ({ id: x, name: C.PITCHES[x]?.name })), specials: (p.specials || []).map((k) => ({ id: k, ...SPECIALS[k] })), rarity: p.rarity, origin: p.origin, games: p.games, look: p.look, awakened: !!p.hidden?.awakened,
    age: p.age || 0, seasons: p.seasons || 0, ovr: CAREER.ovr(p), grade: CAREER.grade(CAREER.ovr(p)), rookie: p.rookieSeason != null && p.rookieSeason === seasonOf(), retired: !!p.retiredAt, awakenN: p.hidden?.awakenN || 0 });

  // ---------- チーム ----------
  function autoLineup(uid) {
    const ps = playersOf(uid), bats = ps.filter((p) => p.kind === 'B'), pits = ps.filter((p) => p.kind === 'P');
    const ov = (p) => { const s = eff(p); return p.kind === 'B' ? s.meet + s.power * 0.9 + s.speed * 0.4 + s.tech * 0.5 : (s.velo - 120) * 1.5 + s.brk + s.stuff; };
    const lineup = bats.sort((a, b) => ov(b) - ov(a)).slice(0, 9);
    // 打順: 1・2 番は速さとミート、3〜5 番はパワー
    const order = [...lineup].sort((a, b) => (eff(b).power - eff(a).power)), cleanup = order.slice(0, 3), rest = lineup.filter((p) => !cleanup.includes(p)).sort((a, b) => (eff(b).speed + eff(b).meet) - (eff(a).speed + eff(a).meet));
    const lu = [rest[0], rest[1], cleanup[1], cleanup[0], cleanup[2], ...rest.slice(2)].filter(Boolean).map((p) => p.id);
    const sp = pits.filter((p) => p.pos === '先').sort((a, b) => ov(b) - ov(a)), rp = pits.filter((p) => p.pos !== '先').sort((a, b) => ov(b) - ov(a));
    const rotation = [...sp, ...rp].slice(0, 5).map((p) => p.id), relievers = pits.filter((p) => !rotation.includes(p.id)).sort((a, b) => ov(b) - ov(a));
    const bullpen = { closer: relievers[0]?.id || null, setup: relievers.slice(1, 3).map((p) => p.id) };
    db.prepare('UPDATE bb_teams SET lineup = ?, rotation = ?, bullpen = ? WHERE user_id = ?').run(JSON.stringify(lu), JSON.stringify(rotation), JSON.stringify(bullpen), uid);
  }
  // 試合用のチーム (自分のチーム・CPU のチーム)
  function teamForGame(uid) {
    const t = teamRow(uid); if (!t) return null;
    const ps = new Map(playersOf(uid).map((p) => [p.id, p]));
    let lineup = JSON.parse(t.lineup).map((id) => ps.get(id)).filter((p) => p && p.kind === 'B');
    if (lineup.length < 9) { autoLineup(uid); return teamForGame(uid); }
    const rot = JSON.parse(t.rotation).map((id) => ps.get(id)).filter(Boolean), bp = JSON.parse(t.bullpen);
    const starter = rot[t.rot_idx % Math.max(1, rot.length)] || [...ps.values()].find((p) => p.kind === 'P');
    return { uid, name: t.name, league: t.league, lineup, starter, setup: (bp.setup || []).map((id) => ps.get(id)).filter(Boolean), closer: ps.get(bp.closer) || null, ace: rot[0] || starter };
  }
  const CPU_RAR = { bronze: ['N', 'N', 'R'], silver: ['N', 'R', 'R'], gold: ['R', 'R', 'SR'], elite: ['R', 'SR', 'SR'], champion: ['SR', 'SR', 'SSR'], king: ['SR', 'SSR', 'SSR'] };
  const CPU_NAMES = ['港北ドルフィンズ', '山の手ベアーズ', '湾岸シャークス', '高原イーグルス', '下町ブルズ', '学園ウィザーズ', '北風ホークス', '桜坂スターズ', '荒川タイタンズ', '月影ナイツ'];
  function cpuTeam(league, r) {
    const rr = () => pick(r, CPU_RAR[league] || CPU_RAR.bronze);
    const lineup = POS.map((pos) => makePlayer(r, { kind: 'B', rarity: rr(), pos, origin: 'cpu' }));
    const starter = makePlayer(r, { kind: 'P', rarity: rr(), pos: '先', origin: 'cpu' });
    return { uid: null, name: 'CPU ' + pick(r, CPU_NAMES), league, lineup, starter, setup: [makePlayer(r, { kind: 'P', rarity: rr(), pos: '中', origin: 'cpu' })], closer: makePlayer(r, { kind: 'P', rarity: rr(), pos: '抑', origin: 'cpu' }) };
  }

  // ---------- 自動試合 (9 回) ----------
  function simGame(home, away, r) {
    const box = new Map(); const B = (p, tm) => { if (!box.has(p.id)) box.set(p.id, { p, team: tm, g: 1, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0, sb: 0, def: 0, w: 0, l: 0, sv: 0, hld: 0, outs: 0, er: 0, k: 0 }); return box.get(p.id); };
    const sides = [away, home].map((t, i) => ({ t, i, idx: 0, pitcher: t.starter, used: [t.starter], runs: 0, line: [], defAvg: t.lineup.reduce((a, p) => a + eff(p).tech, 0) / t.lineup.length, hitsByPlayer: new Map() }));
    const spd = (side) => (id) => eff(side.t.lineup.find((p) => p.id === id) || { stats: { speed: 50 }, specials: [] }).speed || 50;
    let inning = 1, lead = null;
    const lastHitless = new Set(); for (const s of sides) for (const p of s.t.lineup) if (p.hidden?.lastHitless) lastHitless.add(p.id);
    const changePitcher = (def, off) => {
      const cur = def.pitcher, st = B(cur, def.t), pe = eff(cur);
      const diff = def.runs - off.runs; // 守っているチームのリード
      if (cur === def.t.starter && (st.outs >= 15 + Math.round(pe.stamina / 8) || (st.er >= 5 && st.outs >= 6))) {
        const next = inning >= 9 && diff > 0 && diff <= 3 && def.t.closer ? def.t.closer : def.t.setup.find((p) => !def.used.includes(p)) || def.t.closer;
        if (next && !def.used.includes(next)) { def.used.push(next); def.pitcher = next; def.relieverEntry = { p: next, lead: diff }; }
      } else if (inning >= 9 && diff > 0 && diff <= 3 && def.t.closer && !def.used.includes(def.t.closer)) { def.used.push(def.t.closer); def.pitcher = def.t.closer; def.relieverEntry = { p: def.t.closer, lead: diff }; }
      else if (cur !== def.t.starter && cur !== def.t.closer && B(cur, def.t).outs >= 3) { const next = def.t.setup.find((p) => !def.used.includes(p)); if (next) { def.used.push(next); def.pitcher = next; def.relieverEntry = { p: next, lead: diff }; } }
    };
    const halves = [];
    for (; inning <= 12; inning++) {
      for (const h of [0, 1]) {
        const off = sides[h], def = sides[1 - h];
        if (inning >= 9 && h === 1 && off.runs > def.runs) break; // 裏の攻撃はいらない
        changePitcher(def, off);
        const g = { outs: 0, bases: [null, null, null] }; let runs = 0;
        while (g.outs < 3) {
          // 盗塁: 一塁に走者・二塁が空いているとき、足の速い走者がときどき走る (成功率は走力しだい)
          if (g.bases[0] && !g.bases[1]) { const rid = g.bases[0], rp = off.t.lineup.find((p) => p.id === rid), rsp = rp ? eff(rp).speed : 50;
            if (rsp >= 58 && r() < (rsp - 48) / 260) { if (r() < 0.5 + rsp / 250) { g.bases[1] = rid; g.bases[0] = null; if (rp) B(rp, off.t).sb++; } else { g.bases[0] = null; g.outs++; B(def.pitcher, def.t).outs++; if (g.outs >= 3) break; } } }
          const b = off.t.lineup[off.idx % 9]; off.idx++;
          const be = eff(b), pe = eff(def.pitcher), bs = B(b, off.t), ps = B(def.pitcher, def.t);
          const risp = !!(g.bases[1] || g.bases[2]), late = inning >= 7 && Math.abs(off.runs - def.runs) <= 2;
          let mult = 1;
          if (risp && b.specials.includes('pinch')) mult *= 1.3;
          if (late && b.specials.includes('clutch')) mult *= 1.15;
          let pp = { ...pe, pitches: def.pitcher.pitches };
          if (def.pitcher.specials.includes('gouwan')) pp.stuff += 10;
          if (inning === 9 && def.pitcher.specials.includes('t_sv')) { pp.stuff += 8; pp.brk += 8; }
          if ((inning === 7 || inning === 8) && def.pitcher.specials.includes('t_hld')) { pp.stuff += 8; pp.brk += 8; }
          // 燻し銀: 前の試合がノーヒットなら、この試合は最後の打席までにかならず 1 本打つ
          const lastChance = lastHitless.has(b.id) && b.specials.includes('ibushi') && !off.hitsByPlayer.get(b.id) && bs.pa >= 3;
          let res = lastChance ? { kind: 'hit', bases: 1, dir: (r() - 0.5) * 60, dist: 40 } : C.autoPA({ ...be }, pp, def.defAvg, r, { mult });
          if (res.kind === 'hit' && res.bases === 4 && def.pitcher.specials.includes('nigedama') && r() < 0.3) res = { ...res, bases: 2 };
          bs.pa++; ps.k += res.kind === 'k' ? 1 : 0;
          if (res.kind !== 'bb') bs.ab++; else bs.bb++;
          if (res.kind === 'k') bs.so++;
          if (res.kind === 'hit') { bs.h++; off.hitsByPlayer.set(b.id, (off.hitsByPlayer.get(b.id) || 0) + 1); if (res.bases === 4) bs.hr++; }
          if (res.kind === 'out') { const f = def.t.lineup[Math.floor(r() * 9)], fs = B(f, def.t); fs.def += 1 + (res.q > 0.6 ? 2 : 0) + (eff(f).tech > 75 && r() < 0.2 ? 2 : 0); } // 守備評価ポイント
          const before = g.outs, rr = C.advance(g, res, b.id, spd(off), r);
          ps.outs += g.outs - before; runs += rr; bs.rbi += res.kind === 'out' && res.outType === 'ground' && g.outs - before >= 2 ? 0 : rr; ps.er += rr;
          if (inning >= 9 && h === 1 && off.runs + runs > def.runs) break; // サヨナラ
        }
        off.runs += runs; off.line.push(runs); halves.push(runs);
        if (inning >= 9 && h === 1 && off.runs !== def.runs) break;
      }
      if (inning >= 9 && sides[0].runs !== sides[1].runs) break;
    }
    // 勝ち・負け・セーブ・ホールド
    const [A, Hm] = sides, winner = Hm.runs > A.runs ? Hm : A.runs > Hm.runs ? A : null;
    if (winner) {
      const loser = winner === Hm ? A : Hm;
      const wst = B(winner.t.starter, winner.t);
      const wp = wst.outs >= 15 ? winner.t.starter : winner.used.filter((p) => p !== winner.t.closer).slice(-1)[0] || winner.t.starter;
      B(wp, winner.t).w++; B(loser.t.starter, loser.t).l++;
      const last = winner.pitcher;
      if (last !== wp && winner.relieverEntry?.p === last && winner.relieverEntry.lead > 0 && winner.relieverEntry.lead <= 3) B(last, winner.t).sv++;
      for (const p of winner.used.slice(1)) if (p !== last && p !== wp && B(p, winner.t).outs >= 3) B(p, winner.t).hld++;
    }
    return { hs: Hm.runs, as: A.runs, lineHome: Hm.line, lineAway: A.line, box: [...box.values()], innings: Math.max(A.line.length, 9) };
  }

  // 試合の結果を保存 (自分のチームの選手の成績・たましい・リーグ・レート)
  const qStat = db.prepare(`INSERT INTO bb_stats (season, player_id, user_id, g, pa, ab, h, hr, rbi, bb, so, def, w, l, sv, hld, outs, er, k, sb) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(season, player_id) DO UPDATE SET g = g + 1, pa = pa + excluded.pa, ab = ab + excluded.ab, h = h + excluded.h, hr = hr + excluded.hr, rbi = rbi + excluded.rbi, bb = bb + excluded.bb, so = so + excluded.so, sb = sb + excluded.sb,
    def = def + excluded.def, w = w + excluded.w, l = l + excluded.l, sv = sv + excluded.sv, hld = hld + excluded.hld, outs = outs + excluded.outs, er = er + excluded.er, k = k + excluded.k`);
  function recordGame(home, away, res, league, season, now) {
    const boxOut = res.box.map((x) => ({ id: x.p.id, name: x.p.name, team: x.team === home ? 'home' : 'away', kind: x.p.kind, pos: x.p.pos, pa: x.pa, ab: x.ab, h: x.h, hr: x.hr, rbi: x.rbi, bb: x.bb, so: x.so, sb: x.sb || 0, def: x.def, outs: x.outs, er: x.er, k: x.k, w: x.w, l: x.l, sv: x.sv, hld: x.hld }));
    const gid = Number(db.prepare('INSERT INTO bb_games (season, at, league, home_uid, away_uid, home_name, away_name, hs, as_, box) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(season, now, league, home.uid, away.uid, home.name, away.name, res.hs, res.as, JSON.stringify({ lineHome: res.lineHome, lineAway: res.lineAway, box: boxOut })).lastInsertRowid);
    for (const x of res.box) {
      if (x.team.uid) {
        qStat.run(season, x.p.id, x.team.uid, x.pa, x.ab, x.h, x.hr, x.rbi, x.bb, x.so, x.def, x.w, x.l, x.sv, x.hld, x.outs, x.er, x.k, x.sb || 0);
        // 試合数・燻し銀のための記録・大化け (隠していた能力が目覚める)
        const row = db.prepare('SELECT hidden, stats, games FROM bb_players WHERE id = ?').get(x.p.id); if (!row) continue;
        const hid = JSON.parse(row.hidden); hid.lastHitless = x.p.kind === 'B' ? x.ab > 0 && x.h === 0 : false;
        let stats = JSON.parse(row.stats);
        if (hid.bloom && !hid.awakened && row.games + 1 >= hid.bloom) { hid.awakened = true; for (const k of Object.keys(stats)) stats[k] = k === 'velo' ? stats[k] + 10 : k === 'stamina' ? stats[k] : Math.min(99, stats[k] + 22); }
        db.prepare('UPDATE bb_players SET games = games + 1, hidden = ?, stats = ? WHERE id = ?').run(JSON.stringify(hid), JSON.stringify(stats), x.p.id);
        try { career.afterGame(x.p.id, x.team.uid, x); } catch (e) { console.error('[bb] 覚醒・記録', e.message); } // 覚醒・記録達成
      }
      // 前日の活躍選手 (ガチャに入る): 打者は安打・本塁打・打点、投手は勝ち・セーブ・三振
      const sc = x.p.kind === 'B' ? x.h * 1 + x.hr * 3 + x.rbi * 0.8 : x.w * 3 + x.sv * 2 + x.k * 0.5 - x.er * 0.6;
      if (sc >= 4.5) db.prepare('INSERT INTO bb_hot (day, player, score) VALUES (?, ?, ?)').run(dayKey(now), JSON.stringify({ ...x.p, hidden: {}, ownerId: undefined }), sc);
    }
    try { career.gameNews(home, away, res, gid); } catch (e) { console.error('[bb] 試合のニュース', e.message); }
    return gid;
  }
  function rateChange(a, b, aWon) { const ea = 1 / (1 + 10 ** ((b - a) / 400)); return Math.round(24 * ((aWon ? 1 : 0) - ea)); }
  function applyResult(t, won, oppRate, season) {
    const row = teamRow(t.uid); if (!row) return;
    let { league, lwins, rate } = row;
    lwins += won ? 1 : 0;
    if ((league === 'champion' || league === 'king') && oppRate) rate += rateChange(rate, oppRate, won);
    else if (won && lwins >= PROMOTE_WINS && LEAGUES.indexOf(league) < LEAGUES.indexOf('champion')) { league = LEAGUES[LEAGUES.indexOf(league) + 1]; lwins = 0; }
    if (league !== row.league && t.uid) setTimeout(() => { try { career.onPromote(t.uid, league); } catch {} }, 0); // 昇格のニュース
    db.prepare('UPDATE bb_teams SET wins = wins + ?, losses = losses + ?, lwins = ?, league = ?, rate = ?, souls = souls + ?, rot_idx = rot_idx + 1, season = ? WHERE user_id = ?')
      .run(won ? 1 : 0, won ? 0 : 1, lwins, league, rate, won ? WIN_SOULS : LOSE_SOULS, season, t.uid);
  }
  // 毎時 5 分: 全チームが同じリーグの相手と 1 試合
  function runRound(now = Date.now()) {
    const season = seasonOf(now), teams = db.prepare('SELECT user_id, league, rate FROM bb_teams').all();
    const groups = {};
    for (const t of teams) { const lg = t.league === 'king' ? 'champion' : t.league; (groups[lg] ||= []).push(t); }
    let n = 0;
    for (const [lg, list] of Object.entries(groups)) {
      list.sort(() => sr() - 0.5);
      for (let i = 0; i < list.length; i += 2) {
        const a = list[i], b = list[i + 1];
        try {
          const ta = teamForGame(a.user_id), tb = b ? teamForGame(b.user_id) : cpuTeam(lg, sr);
          if (!ta || !tb) continue;
          const home = sr() < 0.5 ? ta : tb, away = home === ta ? tb : ta;
          let res = simGame(home, away, sr); let guard = 0;
          while (res.hs === res.as && guard++ < 3) res = simGame(home, away, sr); // 引き分けはやり直し (12 回まで同点のとき)
          if (res.hs === res.as) res.hs++;
          recordGame(home, away, res, lg, season, now);
          const homeWon = res.hs > res.as, cpuRate = 1500 + (lg === 'champion' ? 100 : 0);
          if (home.uid) applyResult(home, homeWon, away.uid ? teams.find((x) => x.user_id === away.uid)?.rate : cpuRate, season);
          if (away.uid) applyResult(away, !homeWon, home.uid ? teams.find((x) => x.user_id === home.uid)?.rate : cpuRate, season);
          n++;
        } catch (e) { console.error('[bb] 試合のエラー', e.message); }
      }
    }
    if (n) console.log(`[bb] ${new Date(now).toISOString()} 自動試合 ${n} 試合`);
    return n;
  }

  // ---------- シーズンの終わり: 表彰・KING・リセット ----------
  function closeSeason(s) {
    if (db.prepare('SELECT 1 FROM bb_seasons WHERE season = ?').get(s)) return;
    const now = Date.now();
    db.exec('BEGIN');
    try {
      const rows = db.prepare('SELECT * FROM bb_stats WHERE season = ?').all(s);
      const minPA = Math.max(10, Math.round((rows.reduce((m, x) => Math.max(m, x.g), 0)) * 2.5));
      for (const a of AWARDS) {
        let best = null, bv = -1;
        for (const x of rows) {
          const v = a.stat === 'avg' ? (x.pa >= minPA && x.ab ? x.h / x.ab : -1) : x[a.stat];
          if (v > bv && v > 0) { bv = v; best = x; }
        }
        if (!best) continue;
        const p = db.prepare('SELECT name, specials FROM bb_players WHERE id = ?').get(best.player_id); if (!p) continue;
        db.prepare('INSERT OR IGNORE INTO bb_awards (season, award, player_id, user_id, name, value) VALUES (?, ?, ?, ?, ?, ?)').run(s, a.id, best.player_id, best.user_id, p.name, bv);
        const sp = JSON.parse(p.specials); if (!sp.includes(a.id)) { sp.push(a.id); db.prepare('UPDATE bb_players SET specials = ? WHERE id = ?').run(JSON.stringify(sp), best.player_id); }
      }
      // KING: チャンピオン (と KING) でレートがいちばん高いチーム
      const king = db.prepare("SELECT user_id, rate FROM bb_teams WHERE league IN ('champion', 'king') ORDER BY rate DESC LIMIT 1").get();
      db.prepare("UPDATE bb_teams SET league = 'champion' WHERE league = 'king'").run();
      if (king) {
        db.prepare("UPDATE bb_teams SET league = 'king' WHERE user_id = ?").run(king.user_id);
        try { db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title, source, granted_at) VALUES (?, ?, ?, ?)').run(king.user_id, `King of season ${s}`, 'bb:king:' + s, now); } catch {}
      }
      career.onSeasonClose(s, king); // 新人王・年齢と成長・引退・殿堂入り・ニュース
      db.prepare('UPDATE bb_teams SET wins = 0, losses = 0, lwins = 0').run();
      db.prepare('INSERT INTO bb_seasons (season, king_uid, done_at) VALUES (?, ?, ?)').run(s, king?.user_id || null, now);
      db.exec('COMMIT');
      console.log(`[bb] シーズン ${s} 終了 (KING: ${king?.user_id || 'なし'})`);
    } catch (e) { db.exec('ROLLBACK'); console.error('[bb] シーズンの締めに失敗', e.message); }
  }

  // ---------- ドラフト会議 ----------
  const DRAFT_AT = (() => { const m = /^(\d{1,2}):(\d{2})$/.exec(process.env.BB_DRAFT_TIME || '09:35'); return m ? Number(m[1]) * 60 + Number(m[2]) : 575; })(); // 分 (日本時間)
  function draftTimes(day = dayKey()) {
    const base = Date.parse(day + 'T00:00:00+09:00') + DRAFT_AT * 60_000, M = 60_000;
    return { deadline: base - 5 * M, r1: base, r1End: base + 5 * M, reveal: base + 6 * M, r2: base + 10 * M, r2End: base + 15 * M };
  }
  function draftPhase(now = Date.now()) {
    const t = draftTimes(dayKey(now));
    return now < t.deadline ? 'entry' : now < t.r1 ? 'closed' : now < t.r1End ? 'r1' : now < t.reveal ? 'r1wait' : now < t.r2 ? 'reveal' : now < t.r2End ? 'r2' : 'done';
  }
  function draftPool(day = dayKey()) {
    let row = db.prepare('SELECT * FROM bb_draft_pool WHERE day = ?').get(day);
    if (!row) {
      const r = C.rng(Number(day.replace(/-/g, '')) * 7 + 13), pool = [];
      const nStar = r() < 0.5 ? 1 : 2;
      for (let i = 0; i < nStar; i++) { const p = makePlayer(r, { rarity: 'SSR', origin: 'draft', special: i === 0 ? 'kaibutsu' : 'none' }); if (p.specials[0] === 'none') p.specials = []; if (!p.specials.length) p.specials.push(pick(r, Object.keys(SPECIALS).filter((k) => !SPECIALS[k].award && (SPECIALS[k].kind === p.kind || SPECIALS[k].kind === '*') && k !== 'kaibutsu'))); p.star = true; pool.push(p); }
      const bloomer = makePlayer(r, { rarity: 'N', origin: 'draft' }); bloomer.hidden = { bloom: 8 + rint(r, 0, 6) }; pool.push(bloomer); // 大化けする選手 (見せない)
      career.addGems(pool, r, makePlayer); // 隠し逸材 (目玉とは別枠・毎回は出ない)
      while (pool.length < 24) pool.push(makePlayer(r, { rarity: pick(r, ['N', 'N', 'R', 'R', 'R', 'SR']), origin: 'draft' }));
      for (const p of pool) career.ensure(p);
      pool.sort(() => r() - 0.5); pool.sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0));
      db.prepare('INSERT OR IGNORE INTO bb_draft_pool (day, pool) VALUES (?, ?)').run(day, JSON.stringify(pool));
      row = db.prepare('SELECT * FROM bb_draft_pool WHERE day = ?').get(day);
    }
    return { ...row, pool: JSON.parse(row.pool), lots: JSON.parse(row.lots) };
  }
  function giveDraftPlayer(uid, p) { const np = { ...p, hidden: { ...(p.hidden || {}) }, id: crypto.randomBytes(6).toString('hex'), origin: 'draft', rookieSeason: seasonOf() }; delete np.star; savePlayer(np, uid); return np; }
  function resolveDraft(now = Date.now()) {
    const day = dayKey(now), t = draftTimes(day), dp = draftPool(day);
    if (!dp.r1 && now >= t.reveal) {
      // 1 巡目: 同じ選手がかぶったら抽選
      const entries = db.prepare('SELECT * FROM bb_draft WHERE day = ? AND pick1 IS NOT NULL').all(day), by = {}, lots = [];
      for (const e of entries) (by[e.pick1] ||= []).push(e);
      db.exec('BEGIN');
      try {
        for (const [pid, list] of Object.entries(by)) {
          const p = dp.pool.find((x) => x.id === pid); if (!p) continue;
          const win = list[Math.floor(sr() * list.length)], np = giveDraftPlayer(win.user_id, p);
          db.prepare('UPDATE bb_draft SET got1 = ? WHERE day = ? AND user_id = ?').run(np.id, day, win.user_id);
          lots.push({ player: pid, name: p.name, entrants: list.length, winner: win.user_id });
        }
        db.prepare('UPDATE bb_draft_pool SET r1 = 1, lots = ? WHERE day = ?').run(JSON.stringify(lots), day);
        db.exec('COMMIT');
        try { career.onDraftR1(day, lots, dp.pool); } catch (e) { console.error('[bb] ドラフトのニュース', e.message); }
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (!dp.r2 && now >= t.r2End) {
      // 2 巡目: 参加券を早く買った人から。ほしい選手がもういなければ、残りからランダム。えらばなかった人にも残りから 1 人
      const taken = new Set(dp.lots.map((l) => l.player));
      const entries = db.prepare('SELECT * FROM bb_draft WHERE day = ? ORDER BY bought_at').all(day), picks = [];
      db.exec('BEGIN');
      try {
        for (const e of entries) {
          let p = e.pick2 && !taken.has(e.pick2) ? dp.pool.find((x) => x.id === e.pick2) : null;
          if (!p) { const rest = dp.pool.filter((x) => !taken.has(x.id) && !x.star); p = rest[Math.floor(sr() * rest.length)]; }
          if (!p) continue;
          taken.add(p.id); const np = giveDraftPlayer(e.user_id, p);
          db.prepare('UPDATE bb_draft SET got2 = ? WHERE day = ? AND user_id = ?').run(np.id, day, e.user_id); picks.push({ uid: e.user_id, name: p.name });
        }
        db.prepare('UPDATE bb_draft_pool SET r2 = 1 WHERE day = ?').run(day);
        db.exec('COMMIT');
        try { career.onDraftR2(day, picks); } catch (e) { console.error('[bb] ドラフトのニュース', e.message); }
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  }

  // ---------- 選手の一生とリーグの出来事 (baseball-career.js) ----------
  career = CAREER(app, ctx, { sr, limit, C, SPECIALS, AWARDS, LEAGUE_NAME, POS, rowToPlayer, pubPlayer, playersOf, teamRow, autoLineup, seasonOf, dayKey, ROSTER_MAX, TICKET,
    draftPool: (d) => draftPool(d), draftPhase: (n) => draftPhase(n), draftTimes: (d) => draftTimes(d), meView: (u) => meView(u) });

  // テスト用 (環境変数 BB_TEST=1 のときの管理者だけ。本番では設定しない): 自動試合・シーズンの締め・ドラフトの締め・年齢を進める
  if (process.env.BB_TEST === '1') {
    const T = (fn) => (req, res) => { if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけ' }); try { res.json(fn(req.body || {}) || { ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } };
    app.post('/api/bb/test/round', requireAuth, T((b) => { let n = 0; for (let i = 0; i < Math.min(50, Number(b.n) || 1); i++) n += runRound(Date.now()); return { games: n }; }));
    app.post('/api/bb/test/close-season', requireAuth, T((b) => { const s = Number(b.s) || seasonOf(); db.prepare('DELETE FROM bb_seasons WHERE season = ?').run(s); closeSeason(s); return { ok: true }; }));
    app.post('/api/bb/test/draft', requireAuth, T((b) => { const t = draftTimes(dayKey()); resolveDraft(b.at === 'r2' ? t.r2End + 1000 : t.reveal + 1000); return { ok: true }; }));
    app.post('/api/bb/test/player', requireAuth, T((b) => { const row = db.prepare('SELECT * FROM bb_players WHERE id = ?').get(String(b.id)); if (!row) throw new Error('none'); const hid = { ...JSON.parse(row.hidden), ...(b.hidden || {}) };
      db.prepare('UPDATE bb_players SET age = COALESCE(?, age), games = COALESCE(?, games), hidden = ?, rookie_season = COALESCE(?, rookie_season) WHERE id = ?').run(b.age ?? null, b.games ?? null, JSON.stringify(hid), b.rookieSeason ?? null, row.id); return { ok: true }; }));
  }

  // ---------- 時計 (毎時 5 分の試合・ドラフトの締め・シーズンの締め) ----------
  let lastRound = null;
  function tick() {
    const now = Date.now(), j = jst(now);
    try { resolveDraft(now); } catch (e) { console.error('[bb] ドラフト', e.message); }
    try { career.expireTrades(now); } catch (e) { console.error('[bb] トレードの期限', e.message); }
    const prev = seasonOf(now) - 1; if (prev >= 1) closeSeason(prev);
    const key = j.toISOString().slice(0, 13);
    if (j.getUTCMinutes() >= 5 && j.getUTCMinutes() < 30 && lastRound !== key) {
      lastRound = key;
      const done = db.prepare("SELECT 1 FROM bb_games WHERE at >= ? AND league != 'rt' LIMIT 1").get(Date.parse(key + ':05:00Z') - 9 * H);
      if (!done) runRound(now);
    }
  }
  setInterval(tick, 20_000).unref(); setTimeout(tick, 3000).unref();

  // ---------- API ----------
  function meView(uid) {
    const t = teamRow(uid); if (!t) return { started: false };
    const s = seasonOf(), ps = playersOf(uid), st = new Map(db.prepare('SELECT * FROM bb_stats WHERE season = ? AND user_id = ?').all(s, uid).map((x) => [x.player_id, x]));
    const games = db.prepare('SELECT id, at, league, home_uid, away_uid, home_name, away_name, hs, as_ FROM bb_games WHERE (home_uid = ? OR away_uid = ?) ORDER BY at DESC LIMIT 12').all(uid, uid)
      .map((g) => { const home = g.home_uid === uid; const my = home ? g.hs : g.as_, op = home ? g.as_ : g.hs; return { id: g.id, at: g.at, opp: home ? g.away_name : g.home_name, my, op, won: my > op }; });
    const j = jst(); const next = Date.now() + ((j.getUTCMinutes() < 5 ? 5 - j.getUTCMinutes() : 65 - j.getUTCMinutes()) * 60 - j.getUTCSeconds()) * 1000;
    return { started: true, team: { name: t.name, souls: t.souls, league: t.league, leagueName: LEAGUE_NAME[t.league], wins: t.wins, losses: t.losses, lwins: t.lwins, need: PROMOTE_WINS, rate: t.rate, rtRate: t.rt_rate, rtW: t.rt_w, rtL: t.rt_l,
      lineup: JSON.parse(t.lineup), rotation: JSON.parse(t.rotation), bullpen: JSON.parse(t.bullpen) },
      players: ps.map((p) => ({ ...pubPlayer(p), season: st.get(p.id) || null })), games, season: { id: s, end: seasonEnd(s) }, nextGame: next,
      rules: { promote: PROMOTE_WINS, win: WIN_SOULS, lose: LOSE_SOULS, ticket: TICKET, gacha: GACHA, roster: ROSTER_MAX }, specials: SPECIALS, pitches: Object.fromEntries(C.PITCH_IDS.map((k) => [k, C.PITCHES[k].name])) };
  }
  app.get('/api/bb/me', requireAuth, (req, res) => res.json({ ...meView(req.user.id), admin: isAdmin(req.user) }));
  app.post('/api/bb/start', requireAuth, limit, (req, res) => {
    const uid = req.user.id; if (teamRow(uid)) return res.status(400).json({ error: 'もう始めています' });
    const name = String(req.body?.name || '').trim().slice(0, 14) || `${req.user.username} ナイン`;
    const r = sr;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO bb_teams (user_id, name, souls, created_at, season) VALUES (?, ?, ?, ?, ?)').run(uid, name, START_SOULS, Date.now(), seasonOf());
      for (const pos of POS) savePlayer(makePlayer(r, { kind: 'B', rarity: r() < 0.25 ? 'R' : 'N', pos, origin: 'start' }), uid);
      for (let i = 0; i < 5; i++) savePlayer(makePlayer(r, { kind: 'P', rarity: r() < 0.25 ? 'R' : 'N', pos: '先', origin: 'start' }), uid);
      for (let i = 0; i < 3; i++) savePlayer(makePlayer(r, { kind: 'P', rarity: 'N', pos: '中', origin: 'start' }), uid);
      for (let i = 0; i < 3; i++) savePlayer(makePlayer(r, { kind: 'B', rarity: 'N', origin: 'start' }), uid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    autoLineup(uid);
    res.json(meView(uid));
  });
  app.post('/api/bb/rename', requireAuth, limit, (req, res) => { const name = String(req.body?.name || '').trim().slice(0, 14); if (!name) return res.status(400).json({ error: '名前を入れてください' }); db.prepare('UPDATE bb_teams SET name = ? WHERE user_id = ?').run(name, req.user.id); res.json(meView(req.user.id)); });
  app.post('/api/bb/auto-lineup', requireAuth, limit, (req, res) => { if (!teamRow(req.user.id)) return res.status(400).json({ error: 'まだ始めていません' }); autoLineup(req.user.id); res.json(meView(req.user.id)); });
  app.post('/api/bb/lineup', requireAuth, limit, (req, res) => {
    const uid = req.user.id; if (!teamRow(uid)) return res.status(400).json({ error: 'まだ始めていません' });
    const mine = new Map(playersOf(uid).map((p) => [p.id, p])), ids = (a) => (Array.isArray(a) ? a : []).map(String);
    const lineup = ids(req.body?.lineup), rotation = ids(req.body?.rotation), setup = ids(req.body?.setup), closer = req.body?.closer ? String(req.body.closer) : null;
    if (lineup.length !== 9 || new Set(lineup).size !== 9 || !lineup.every((id) => mine.get(id)?.kind === 'B')) return res.status(400).json({ error: 'スタメンは野手 9 人をえらんでください' });
    const pit = [...rotation, ...setup, ...(closer ? [closer] : [])];
    if (!rotation.length || rotation.length > 5 || new Set(pit).size !== pit.length || !pit.every((id) => mine.get(id)?.kind === 'P')) return res.status(400).json({ error: '先発 (1〜5 人)・中継ぎ・抑えは、ちがう投手をえらんでください' });
    db.prepare('UPDATE bb_teams SET lineup = ?, rotation = ?, bullpen = ? WHERE user_id = ?').run(JSON.stringify(lineup), JSON.stringify(rotation), JSON.stringify({ setup: setup.slice(0, 3), closer }), uid);
    res.json(meView(uid));
  });
  app.post('/api/bb/release/:id', requireAuth, limit, (req, res) => {
    const uid = req.user.id, t = teamRow(uid); if (!t) return res.status(400).json({ error: 'まだ始めていません' });
    const p = rowToPlayer(db.prepare('SELECT * FROM bb_players WHERE id = ? AND owner_id = ? AND retired_at IS NULL').get(req.params.id, uid)); if (!p) return res.status(404).json({ error: 'その選手はいません' });
    if (career.isLocked(p.id)) return res.status(400).json({ error: 'その選手はトレードに出しています (トレードを取り消してから手放してください)' });
    const ps = playersOf(uid); if (ps.filter((x) => x.kind === p.kind).length <= (p.kind === 'B' ? 9 : 5)) return res.status(400).json({ error: p.kind === 'B' ? '野手は 9 人より少なくできません' : '投手は 5 人より少なくできません' });
    const back = { N: 20, R: 50, SR: 120, SSR: 300 }[p.rarity] || 20;
    db.prepare('UPDATE bb_players SET owner_id = NULL WHERE id = ?').run(p.id);
    db.prepare('UPDATE bb_teams SET souls = souls + ? WHERE user_id = ?').run(back, uid);
    const lu = JSON.parse(t.lineup), rot = JSON.parse(t.rotation), bp = JSON.parse(t.bullpen);
    if (lu.includes(p.id) || rot.includes(p.id) || (bp.setup || []).includes(p.id) || bp.closer === p.id) autoLineup(uid);
    res.json({ back, ...meView(uid) });
  });
  app.get('/api/bb/game/:id', requireAuth, (req, res) => {
    const g = db.prepare('SELECT * FROM bb_games WHERE id = ?').get(Number(req.params.id)); if (!g) return res.status(404).json({ error: '試合が見つかりません' });
    res.json({ id: g.id, at: g.at, league: LEAGUE_NAME[g.league] || g.league, home: g.home_name, away: g.away_name, hs: g.hs, as: g.as_, mine: g.home_uid === req.user.id ? 'home' : g.away_uid === req.user.id ? 'away' : null, ...JSON.parse(g.box) });
  });
  // 自分のリーグの順位 (同じリーグのチーム)
  app.get('/api/bb/league', requireAuth, (req, res) => {
    const t = teamRow(req.user.id); if (!t) return res.json({ teams: [] });
    const lg = t.league === 'king' ? ['champion', 'king'] : [t.league];
    const teams = db.prepare(`SELECT b.user_id, b.name, b.wins, b.losses, b.lwins, b.rate, b.league, u.username FROM bb_teams b JOIN users u ON u.id = b.user_id WHERE b.league IN (${lg.map(() => '?').join(',')}) ORDER BY ${t.league === 'champion' || t.league === 'king' ? 'b.rate DESC' : 'b.lwins DESC, b.wins DESC'} LIMIT 50`).all(...lg)
      .map((x) => ({ name: x.name, username: x.username, wins: x.wins, losses: x.losses, lwins: x.lwins, rate: x.rate, king: x.league === 'king', me: x.user_id === req.user.id }));
    const awards = db.prepare('SELECT a.*, u.username FROM bb_awards a LEFT JOIN users u ON u.id = a.user_id ORDER BY season DESC LIMIT 18').all().map((a) => { const A = AWARDS.find((x) => x.id === a.award); return { season: a.season, title: A?.name || ({ rookie_b: '新人王 (野手)', rookie_p: '新人王 (投手)' })[a.award] || a.award, player: a.name, owner: a.username, value: A?.fmt ? A.fmt(a.value) : a.value, unit: A?.unit }; });
    const kings = db.prepare('SELECT s.season, u.username, b.name FROM bb_seasons s LEFT JOIN users u ON u.id = s.king_uid LEFT JOIN bb_teams b ON b.user_id = s.king_uid ORDER BY s.season DESC LIMIT 5').all();
    res.json({ league: t.league, leagueName: LEAGUE_NAME[t.league], teams, awards, kings, season: { id: seasonOf(), end: seasonEnd(seasonOf()) } });
  });
  // ドラフト
  app.get('/api/bb/draft', requireAuth, (req, res) => {
    const now = Date.now(), day = dayKey(now), dp = draftPool(day), phase = draftPhase(now), t = draftTimes(day);
    const mine = db.prepare('SELECT * FROM bb_draft WHERE day = ? AND user_id = ?').get(day, req.user.id);
    const teams = db.prepare('SELECT b.name, u.username, d.bought_at FROM bb_draft d JOIN bb_teams b ON b.user_id = d.user_id JOIN users u ON u.id = d.user_id WHERE d.day = ? ORDER BY d.bought_at').all(day);
    const taken1 = new Set(dp.lots.map((l) => l.player));
    const pool = dp.pool.map((p) => ({ ...career.poolView(p, req.user.id, day), taken: taken1.has(p.id) })); // 能力はスカウトで調べる (幅つきの推定)
    const got = mine ? [mine.got1, mine.got2].filter(Boolean).map((id) => rowToPlayer(db.prepare('SELECT * FROM bb_players WHERE id = ?').get(id))).filter(Boolean).map(pubPlayer) : [];
    res.json({ day, phase, times: t, ticket: TICKET, pool, teams, scout: career.scoutInfo(req.user.id), mine: mine ? { boughtAt: mine.bought_at, pick1: mine.pick1, pick2: mine.pick2, got } : null,
      lots: phase === 'r1' || phase === 'r1wait' || phase === 'closed' || phase === 'entry' ? [] : dp.lots.map((l) => ({ name: l.name, entrants: l.entrants, winner: db.prepare('SELECT name FROM bb_teams WHERE user_id = ?').get(l.winner)?.name || '', me: l.winner === req.user.id })) });
  });
  app.post('/api/bb/draft/ticket', requireAuth, limit, (req, res) => {
    const uid = req.user.id, day = dayKey(); if (!teamRow(uid)) return res.status(400).json({ error: 'まだ始めていません' });
    if (draftPhase() !== 'entry') return res.status(400).json({ error: '今日の参加券の受付は終わりました (9:30 まで)' });
    if (db.prepare('SELECT 1 FROM bb_draft WHERE day = ? AND user_id = ?').get(day, uid)) return res.status(400).json({ error: 'もう参加券を買っています' });
    db.exec('BEGIN');
    try {
      const u = db.prepare('UPDATE bb_teams SET souls = souls - ? WHERE user_id = ? AND souls >= ?').run(TICKET, uid, TICKET);
      if (!u.changes) { db.exec('ROLLBACK'); return res.status(400).json({ error: `たましいが足りません (${TICKET})` }); }
      db.prepare('INSERT INTO bb_draft (day, user_id, bought_at) VALUES (?, ?, ?)').run(day, uid, Date.now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ ok: true });
  });
  app.post('/api/bb/draft/pick', requireAuth, limit, (req, res) => {
    const uid = req.user.id, day = dayKey(), phase = draftPhase(), round = Number(req.body?.round), pid = String(req.body?.player || '');
    const mine = db.prepare('SELECT * FROM bb_draft WHERE day = ? AND user_id = ?').get(day, uid); if (!mine) return res.status(400).json({ error: '参加券を持っていません' });
    const dp = draftPool(day), p = dp.pool.find((x) => x.id === pid); if (!p) return res.status(400).json({ error: 'その選手はいません' });
    if (round === 1) { if (phase !== 'r1') return res.status(400).json({ error: '1 巡目の指名は 9:35〜9:40 です' }); db.prepare('UPDATE bb_draft SET pick1 = ? WHERE day = ? AND user_id = ?').run(pid, day, uid); }
    else if (round === 2) { if (phase !== 'r2') return res.status(400).json({ error: '2 巡目の指名は 9:45〜9:50 です' }); if (dp.lots.some((l) => l.player === pid)) return res.status(400).json({ error: 'その選手は 1 巡目で指名されました' }); db.prepare('UPDATE bb_draft SET pick2 = ? WHERE day = ? AND user_id = ?').run(pid, day, uid); }
    else return res.status(400).json({ error: '何巡目かが正しくありません' });
    res.json({ ok: true });
  });
  // ガチャ (前日の活躍選手が入る)
  app.get('/api/bb/gacha', requireAuth, (req, res) => {
    const y = dayKey(Date.now() - D), hot = db.prepare('SELECT player, score FROM bb_hot WHERE day = ? ORDER BY score DESC LIMIT 12').all(y).map((x) => ({ ...pubPlayer(JSON.parse(x.player)), score: x.score }));
    res.json({ price: GACHA, hot, rates: { hot: 30, SSR: 3, SR: 12, R: 30, N: 25 } });
  });
  // 前日の活躍選手 (実名) を管理者が登録する: ガチャの「活躍選手」に入る (表 bb_hot。day は前日)
  const num = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
  app.post('/api/bb/admin/hot', requireAuth, limit, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけができます' });
    const b = req.body || {}, kind = b.kind === 'P' ? 'P' : 'B', name = String(b.name || '').trim().slice(0, 24);
    if (!name) return res.status(400).json({ error: '選手の名前を入れてください' });
    const team = String(b.team || '').trim().slice(0, 20), note = String(b.note || '').trim().slice(0, 60);
    const rarity = ['N', 'R', 'SR', 'SSR'].includes(b.rarity) ? b.rarity : 'SR';
    const p = { id: crypto.randomBytes(6).toString('hex'), name, kind, rarity, origin: 'real', number: num(b.number, 0, 99, 0), specials: [], hidden: {}, real: { team, note },
      look: { skin: num(b.skin, 0, 3, 0), hair: 0, h: 1, build: 1, beard: false, bat: b.bat === 'L' ? 'L' : 'R' } };
    if (kind === 'P') {
      p.pos = ['先', '中', '抑'].includes(b.pos) ? b.pos : '先';
      p.stats = { velo: num(b.velo, 120, 170, 145), brk: num(b.brk, 1, 99, 60), stuff: num(b.stuff, 1, 99, 60), stamina: num(b.stamina, 1, 99, 60) };
      const ps = (Array.isArray(b.pitches) ? b.pitches : []).map(String).filter((x) => C.PITCHES[x]); p.pitches = ps.length ? [...new Set(ps)].slice(0, 9) : ['straight', 'slider', 'fork'];
    } else {
      p.pos = POS.includes(b.pos) ? b.pos : '中';
      p.stats = { meet: num(b.meet, 1, 99, 60), power: num(b.power, 1, 99, 60), speed: num(b.speed, 1, 99, 50), tech: num(b.tech, 1, 99, 50) }; p.pitches = [];
    }
    const sp = (Array.isArray(b.specials) ? b.specials : []).map(String).filter((k) => SPECIALS[k] && !SPECIALS[k].award && (SPECIALS[k].kind === kind || SPECIALS[k].kind === '*')); p.specials = [...new Set(sp)].slice(0, 3);
    db.prepare('INSERT INTO bb_hot (day, player, score) VALUES (?, ?, ?)').run(dayKey(Date.now() - D), JSON.stringify(p), 100 + num(b.order, 0, 99, 0));
    console.log(`[bb] @${req.user.username} が実名の活躍選手を登録: ${name}`);
    res.json({ ok: true });
  });
  // ガチャに入れた選手のイラストを編集する (管理者)。ガチャの「活躍選手」と、すでに引かれた写しにも反映する
  const HEXC = /^#[0-9a-f]{6}$/i;
  function cleanLook(old, L = {}) {
    const n = (v, a, b) => (Number.isInteger(Number(v)) && Number(v) >= a && Number(v) <= b ? Number(v) : undefined);
    const o = { ...old };
    for (const [k, a, b] of [['skin', 0, 3], ['hairStyle', 0, 4], ['eyes', 0, 2], ['mouth', 0, 2], ['pose', 0, 1]]) { if (L[k] === null) { delete o[k]; continue; } const v = n(L[k], a, b); if (v !== undefined) o[k] = v; } // null = おまかせにもどす
    for (const k of ['hairHex', 'eyeHex']) if (L[k] === null || L[k] === '') delete o[k]; else if (HEXC.test(String(L[k] || ''))) o[k] = String(L[k]);
    if (L.team === null) delete o.team; else if (Array.isArray(L.team) && L.team.length === 3 && L.team.every((c) => HEXC.test(String(c)))) o.team = L.team.map(String);
    if (typeof L.beard === 'boolean') o.beard = L.beard;
    if (L.bat === 'L' || L.bat === 'R') o.bat = L.bat;
    const bw = Number(L.build), h = Number(L.h);
    if (Number.isFinite(bw)) o.build = Math.max(0.9, Math.min(1.18, bw)); if (Number.isFinite(h)) o.h = Math.max(0.94, Math.min(1.06, h));
    return o;
  }
  app.post('/api/bb/admin/hot/look', requireAuth, limit, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけができます' });
    const id = String(req.body?.id || ''), y = dayKey(Date.now() - D);
    const rows = db.prepare('SELECT rowid, player FROM bb_hot WHERE day >= ?').all(dayKey(Date.now() - 7 * D)), hit = rows.find((r) => JSON.parse(r.player).id === id);
    if (!hit) return res.status(404).json({ error: 'その選手が見つかりません' });
    const hp = JSON.parse(hit.player); hp.look = cleanLook({ ...(hp.look || {}), seed: hp.look?.seed || hp.id }, req.body?.look || {});
    if (typeof req.body?.number !== 'undefined') hp.number = num(req.body.number, 0, 99, hp.number);
    db.prepare('UPDATE bb_hot SET player = ? WHERE rowid = ?').run(JSON.stringify(hp), hit.rowid);
    // 写し: 元の id (hidden.src) が同じもの。前に引かれた写し (src なし) は、実名・名前・球団が同じもの
    const copies = db.prepare("SELECT id, look, hidden, name FROM bb_players WHERE origin IN ('hot', 'real')").all().filter((c) => { const hd = JSON.parse(c.hidden); return hd.src === hp.id || (!hd.src && hp.real && c.name === hp.name && hd.real?.team === hp.real.team); });
    for (const c of copies) db.prepare('UPDATE bb_players SET look = ?, number = ? WHERE id = ?').run(JSON.stringify(hp.look), hp.number, c.id);
    console.log(`[bb] @${req.user.username} がイラストを編集: ${hp.name} (写し ${copies.length} 人にも反映)`);
    res.json({ ok: true, player: pubPlayer(hp), copies: copies.length });
  });
  app.post('/api/bb/admin/hot/delete', requireAuth, limit, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけができます' });
    const id = String(req.body?.id || ''), y = dayKey(Date.now() - D);
    const rows = db.prepare('SELECT rowid, player FROM bb_hot WHERE day = ?').all(y), hit = rows.find((r) => JSON.parse(r.player).id === id);
    if (hit) db.prepare('DELETE FROM bb_hot WHERE rowid = ?').run(hit.rowid);
    res.json({ ok: !!hit });
  });
  app.post('/api/bb/gacha', requireAuth, limit, (req, res) => {
    const uid = req.user.id, n = Number(req.body?.n) === 10 ? 10 : 1, cost = GACHA * n;
    if (!teamRow(uid)) return res.status(400).json({ error: 'まだ始めていません' });
    if (playersOf(uid).length + n > ROSTER_MAX) return res.status(400).json({ error: `選手は ${ROSTER_MAX} 人までです (選手を手放してください)` });
    const y = dayKey(Date.now() - D), hot = db.prepare('SELECT player FROM bb_hot WHERE day = ? ORDER BY score DESC LIMIT 12').all(y).map((x) => JSON.parse(x.player));
    const out = [];
    db.exec('BEGIN');
    try {
      const u = db.prepare('UPDATE bb_teams SET souls = souls - ? WHERE user_id = ? AND souls >= ?').run(cost, uid, cost);
      if (!u.changes) { db.exec('ROLLBACK'); return res.status(400).json({ error: `たましいが足りません (${cost})` }); }
      for (let i = 0; i < n; i++) {
        const x = hot.length ? sr() : 0.3 + sr() * 0.7; let p; // 活躍選手がいない日は、その 30% をふつうの排出に
        if (hot.length && x < 0.3) { const h = hot[Math.floor(sr() * hot.length)]; p = { ...h, id: crypto.randomBytes(6).toString('hex'), origin: h.origin === 'real' ? 'real' : 'hot', hidden: { ...(h.real ? { real: h.real } : {}), src: h.id }, look: { ...(h.look || {}), seed: h.look?.seed || h.id } }; } // 写しも元と同じ絵 (seed)。src: 元の id (イラストの編集を反映する)
        else p = makePlayer(sr, { rarity: x < 0.33 ? 'SSR' : x < 0.45 ? 'SR' : x < 0.75 ? 'R' : 'N', origin: 'gacha' });
        savePlayer(p, uid); out.push(pubPlayer(p));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ results: out, ...meView(uid) });
  });
  app.get('/api/bb/ranking', requireAuth, (req, res) => {
    const rt = db.prepare('SELECT b.name, b.rt_rate, b.rt_w, b.rt_l, u.username FROM bb_teams b JOIN users u ON u.id = b.user_id WHERE b.rt_w + b.rt_l > 0 ORDER BY b.rt_rate DESC LIMIT 30').all();
    const champ = db.prepare("SELECT b.name, b.rate, b.league, u.username FROM bb_teams b JOIN users u ON u.id = b.user_id WHERE b.league IN ('champion', 'king') ORDER BY b.rate DESC LIMIT 30").all();
    res.json({ rt, champ });
  });

  // ---------- リアルタイム対戦 (WebSocket /bb) ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const queue = []; const matchOf = new Map(); // ws → match
  const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  function rtTeam(uid) {
    const t = teamForGame(uid); if (!t) return null;
    const pp = (p) => ({ id: p.id, name: p.name, kind: p.kind, pos: p.pos, number: p.number, specials: p.specials, look: p.look, ...eff(p), pitches: p.pitches });
    return { uid, name: t.name, lineup: t.lineup.map(pp), pitcher: pp(t.ace || t.starter), rate: teamRow(uid).rt_rate, def: t.lineup.reduce((a, p) => a + eff(p).tech, 0) / 9 };
  }
  function cpuRtTeam() { const t = cpuTeam('gold', sr); const pp = (p) => ({ id: p.id, name: p.name, kind: p.kind, pos: p.pos, number: p.number, specials: p.specials, look: p.look, ...eff(p), pitches: p.pitches }); return { uid: null, name: t.name, lineup: t.lineup.map(pp), pitcher: pp(t.starter), rate: 1500, def: 55 }; }
  function startMatch(a, b) {
    const ta = rtTeam(a.user.id), tb = b ? rtTeam(b.user.id) : cpuRtTeam(); if (!ta || !tb) return;
    const m = { id: crypto.randomBytes(5).toString('hex'), ws: [a, b], teams: [ta, tb], inning: 1, half: 0, outs: 0, bases: [null, null, null], score: [0, 0], line: [[], []], idx: [0, 0], count: { b: 0, s: 0 }, pc: null, phase: 'pitch', rated: !!b, timer: null, swing: null, seq: 0, log: [] };
    for (const w of m.ws) if (w) matchOf.set(w, m);
    m.ws.forEach((w, i) => send(w, { t: 'start', you: i, teams: m.teams.map((t) => ({ name: t.name, lineup: t.lineup, pitcher: t.pitcher, rate: t.rate })), rated: m.rated }));
    setTimeout(() => nextPitch(m), 1500);
  }
  const offIdx = (m) => m.half, defIdx = (m) => 1 - m.half;
  const stateOf = (m) => ({ inning: m.inning, half: m.half, outs: m.outs, bases: m.bases.map((x) => !!x), score: m.score, count: m.count, batter: m.teams[offIdx(m)].lineup[m.idx[offIdx(m)] % 9], pitcher: m.teams[defIdx(m)].pitcher, line: m.line });
  function nextPitch(m) {
    if (m.over) return;
    m.phase = 'pitch'; m.pc = null; m.swing = null; m.seq++;
    const st = stateOf(m), d = defIdx(m);
    m.ws.forEach((w, i) => send(w, { t: 'turn', role: i === d ? 'pitch' : 'bat', state: st, seq: m.seq }));
    clearTimeout(m.timer);
    if (!m.ws[d]) setTimeout(() => cpuPitch(m, m.seq), 900 + sr() * 900);
    else m.timer = setTimeout(() => doPitch(m, { pitch: 'straight', x: (sr() - 0.5) * 0.3, y: 0.6 + sr() * 0.4, release: 0.5 + (sr() - 0.5) * 0.3 }), 20_000); // 20 秒たったら自動で投げる
  }
  function cpuPitch(m, seq) {
    if (m.seq !== seq || m.phase !== 'pitch') return;
    const p = m.teams[defIdx(m)].pitcher, zoneish = sr() < 0.62;
    doPitch(m, { pitch: pick(sr, p.pitches || ['straight']), x: zoneish ? (sr() - 0.5) * 0.38 : (sr() < 0.5 ? -1 : 1) * (0.25 + sr() * 0.12), y: zoneish ? 0.55 + sr() * 0.45 : sr() < 0.5 ? 0.35 : 1.2, release: 0.5 + (sr() - 0.5) * 0.34 });
  }
  function doPitch(m, msg) {
    if (m.phase !== 'pitch') return;
    const p = m.teams[defIdx(m)].pitcher, id = (p.pitches || []).includes(msg.pitch) ? msg.pitch : (p.pitches || ['straight'])[0];
    m.pc = C.makePitch({ velo: p.velo, brk: p.brk, stuff: p.stuff }, id, { x: Number(msg.x), y: Number(msg.y) }, Number(msg.release), crypto.randomInt(1, 2 ** 31));
    m.phase = 'flight'; clearTimeout(m.timer);
    m.ws.forEach((w) => send(w, { t: 'pitched', pc: m.pc, seq: m.seq, windup: WINDUP }));
    const o = offIdx(m);
    if (!m.ws[o]) { // CPU のバッター
      const b = m.teams[o].lineup[m.idx[o] % 9], z = C.inZone(m.pc.end), sw = z ? sr() < 0.78 : sr() < 0.28;
      if (sw) { const err = (100 - b.meet) / 100; m.swing = { x: m.pc.end.x + (sr() - 0.5) * 0.18 * err + (sr() - 0.5) * 0.06, y: m.pc.end.y + (sr() - 0.5) * 0.16 * err + (sr() - 0.5) * 0.05, t: m.pc.T + (sr() - 0.5) * (0.2 + err * 0.18) }; }
    }
    m.timer = setTimeout(() => resolvePitch(m), (WINDUP + m.pc.T) * 1000 + 1500); // バッターの合図を待つ (投げる動き・通信の遅れの分も)
  }
  function resolvePitch(m) {
    if (m.phase !== 'flight') return;
    m.phase = 'result'; clearTimeout(m.timer);
    const o = offIdx(m), d = defIdx(m), b = m.teams[o].lineup[m.idx[o] % 9];
    const risp = !!(m.bases[1] || m.bases[2]);
    let res = C.swingResult(b, m.pc, m.swing, m.teams[d].def, m.pc.seed, { boost: risp && b.specials?.includes('pinch') ? 1.2 : 1, stuff: m.teams[d].pitcher.stuff });
    let ev = null, runs = 0;
    if (res.kind === 'take') { if (res.call === 'strike') m.count.s++; else m.count.b++; }
    else if (res.kind === 'miss') m.count.s++;
    else if (res.kind === 'foul') { if (m.count.s < 2) m.count.s++; }
    if (m.count.b >= 4) ev = { kind: 'bb' };
    else if (m.count.s >= 3) ev = { kind: 'k' };
    else if (res.kind === 'hit' || res.kind === 'out') ev = res;
    if (ev) {
      const g = { outs: m.outs, bases: m.bases };
      runs = C.advance(g, ev, b.id, () => 60, sr); m.outs = g.outs; m.bases = g.bases; m.score[o] += runs; m.line[o][m.inning - 1] = (m.line[o][m.inning - 1] || 0) + runs;
      m.idx[o]++; m.count = { b: 0, s: 0 };
    }
    const walkoff = m.half === 1 && m.inning >= 2 && m.score[1] > m.score[0];
    m.ws.forEach((w) => send(w, { t: 'result', res, ev, runs, state: stateOf(m), batter: b.name, walkoff }));
    if (walkoff) return setTimeout(() => endMatch(m), 2500);
    if (m.outs >= 3) setTimeout(() => endHalf(m), 2600); else setTimeout(() => nextPitch(m), ev ? 2800 : 1600);
  }
  function endHalf(m) {
    if (m.over) return;
    const inn = m.inning;
    m.line[m.half][inn - 1] = m.line[m.half][inn - 1] || 0;
    if (m.half === 0 && inn >= 2 && m.score[1] > m.score[0]) return endMatch(m);              // 裏の攻撃はいらない
    if (m.half === 1 && inn >= 2 && m.score[0] !== m.score[1]) return endMatch(m);
    if (m.half === 1 && inn >= 6) return endMatch(m);                                            // 6 回で引き分け
    if (m.half === 0) m.half = 1; else { m.half = 0; m.inning++; }
    m.outs = 0; m.count = { b: 0, s: 0 };
    // 延長はタイブレーク: 無死一・二塁から (前の打者 2 人が走者)
    if (m.inning >= 3) { const o = offIdx(m), L = m.teams[o].lineup, i = m.idx[o]; m.bases = [L[(i + 8) % 9].id, L[(i + 7) % 9].id, null]; } else m.bases = [null, null, null];
    m.ws.forEach((w) => send(w, { t: 'half', state: stateOf(m), tiebreak: m.inning >= 3 }));
    setTimeout(() => nextPitch(m), 2200);
  }
  function endMatch(m, forfeit = null) {
    if (m.over) return; m.over = true; clearTimeout(m.timer);
    let winner = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
    if (forfeit !== null) winner = 1 - forfeit;
    let deltas = [0, 0];
    if (m.rated && m.teams[0].uid && m.teams[1].uid) {
      const [ra, rb] = m.teams.map((t) => teamRow(t.uid).rt_rate), ea = 1 / (1 + 10 ** ((rb - ra) / 400));
      const sa = winner === 0 ? 1 : winner === 1 ? 0 : 0.5, da = Math.round(32 * (sa - ea));
      deltas = [da, -da];
      m.teams.forEach((t, i) => db.prepare('UPDATE bb_teams SET rt_rate = rt_rate + ?, rt_w = rt_w + ?, rt_l = rt_l + ? WHERE user_id = ?').run(deltas[i], winner === i ? 1 : 0, winner === 1 - i ? 1 : 0, t.uid));
    }
    db.prepare('INSERT INTO bb_rt_games (at, p1, p2, s1, s2, rated, d1, d2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), m.teams[0].uid, m.teams[1].uid, m.score[0], m.score[1], m.rated ? 1 : 0, deltas[0], deltas[1]);
    m.ws.forEach((w, i) => { send(w, { t: 'end', winner, you: i, score: m.score, line: m.line, delta: deltas[i], rated: m.rated, forfeit }); if (w) matchOf.delete(w); });
  }
  wss.on('connection', (ws, req, user) => {
    if (!isTester(user)) { send(ws, { t: 'error', error: 'IppO ベースボールはまだ準備中です' }); return ws.close(); }
    if (!teamRow(user.id)) { send(ws, { t: 'error', error: 'マイチームを作ってから遊べます' }); return ws.close(); }
    ws.user = user;
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const mt = matchOf.get(ws);
      if (m.t === 'queue') {
        if (mt || queue.includes(ws)) return;
        const other = queue.find((w) => w.user.id !== user.id && w.readyState === 1);
        if (other) { queue.splice(queue.indexOf(other), 1); startMatch(other, ws); }
        else { queue.push(ws); send(ws, { t: 'queued' }); }
      } else if (m.t === 'cpu') { if (mt) return; const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1); startMatch(ws, null); }
      else if (m.t === 'cancel') { const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1); }
      else if (!mt) return;
      else if (m.t === 'pitch' && mt.ws[defIdx(mt)] === ws && mt.phase === 'pitch') doPitch(mt, m);
      else if (m.t === 'swing' && mt.ws[offIdx(mt)] === ws && mt.phase === 'flight' && !mt.swing) {
        const t = Number(m.tt); if (!Number.isFinite(t)) return;
        mt.swing = { x: C.clamp(Number(m.x) || 0, -0.6, 0.6), y: C.clamp(Number(m.y) || 0.8, 0, 1.6), t: C.clamp(t, 0, mt.pc.T + 1) };
        // 合図が来たら、すぐに結果を出す (ボールが届くまでは待つ)
        clearTimeout(mt.timer); mt.timer = setTimeout(() => resolvePitch(mt), Math.max(0, (mt.pc.T - t) * 1000) + 250);
      } else if (m.t === 'resign') endMatch(mt, mt.ws.indexOf(ws));
    });
    ws.on('close', () => {
      const i = queue.indexOf(ws); if (i >= 0) queue.splice(i, 1);
      const mt = matchOf.get(ws); if (mt && !mt.over) endMatch(mt, mt.ws.indexOf(ws)); // 切れたら負け
    });
  });
  ctx.baseballUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  ctx.bbDebug = { runRound, closeSeason, resolveDraft, simGame, teamForGame, cpuTeam, makePlayer, draftPhase };
};
