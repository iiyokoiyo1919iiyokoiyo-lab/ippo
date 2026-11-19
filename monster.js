// =====================================================================
// ミニゲーム「ブリードモンスターズ」 (モンスターの配合・育成・コマンドバトル・セリ)
//
// ・はじめにランダムで 3 体 (オスとメスが両方いるように)。コインは「ぶんぼうぐバトラーズ」と共用
// ・配合: 繁殖入りしたメス (母) × 繁殖入りしたオス / 種モン (父)。母 1 体につき生涯 5 体まで
//   子は父と母のいちばん強い技を、それぞれ 70% の確率で受けつぐ。見た目も父と母をまぜて決まる
// ・育成: 生まれた子は 10 ターン育てる。1 ターンごとに「直殴り」か「魔法」をえらんで、能力が上がり、ときどき技を覚える
// ・バトル: コイントスで先攻を決め、毎ラウンド 10 秒で十字キーのコマンドを入力 → 決定。先攻から技を出す
//   直殴りは 2〜4 キー (そのモンスターの属性)、魔法は 3〜8 キー、大技は 10 キー前後 (どちらも技ごとの属性)
// ・繁殖入りすると、もう戦えない。市場価値 (戦績スコア) が一定以上のオスは種モンとして、ほかの人のメスと配合できる
// ・メスが産んだ子は、毎時 5 分のセリ (リアルタイム) に出せる。父と母の戦績と受けついだ技が見られる
// ・市場価値は対人戦で上がる。CPU 戦でも上がるが 0.6 倍
// ・乱数・判定はすべてサーバー側 (端末から来るのは、押したキーの並びと選んだものだけ)
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---------- 属性と相性 ----------
// 火 > 草 > 水 > 火 (1.5 倍 / 逆は 0.7 倍)、光 ⇄ 闇 (おたがい 1.5 倍)、王は光と闇に強い (1.3 倍)・火水草からは少し多く受ける (1.2 倍)
const TYPES = { fire: { name: '火', icon: '🔥' }, water: { name: '水', icon: '💧' }, grass: { name: '草', icon: '🌿' }, light: { name: '光', icon: '✨' }, dark: { name: '闇', icon: '🌑' }, king: { name: '王', icon: '👑' } };
const TYPE_IDS = Object.keys(TYPES);
const BEATS = { fire: 'grass', grass: 'water', water: 'fire' };
function typeMult(a, d) {
  if (BEATS[a] === d) return 1.5;
  if (BEATS[d] === a) return 0.7;
  if ((a === 'light' && d === 'dark') || (a === 'dark' && d === 'light')) return 1.5;
  if (a === 'king' && (d === 'light' || d === 'dark')) return 1.3;
  if (d === 'king' && BEATS[a]) return 1.2;
  return 1;
}

// ---------- 技 ----------
// kind: punch (直殴り: 使うモンスターの属性) / magic (魔法) / ult (大技)。cmd: 十字キーの並び (U↑ D↓ L← R→)。power: 威力
// 技はアップデートで増やしていく (release: この時刻から覚えられる・種モンが持って登場する)
const SKILL_LIST = [
  // 直殴り (2〜4 キー)
  ['jab', 'ジャブ', 'punch', null, 'RR'], ['straight', 'ストレート', 'punch', null, 'LR'], ['lowkick', 'ローキック', 'punch', null, 'DR'],
  ['headbutt', 'ずつき', 'punch', null, 'UDR'], ['onetwo', 'ワンツー', 'punch', null, 'RLR'], ['claw', 'ツメきり裂き', 'punch', null, 'ULR'], ['tackle', 'タックル', 'punch', null, 'LLR'],
  ['upper', 'アッパーカット', 'punch', null, 'DDUR'], ['rush', '連打ラッシュ', 'punch', null, 'RLRL'], ['heelfall', 'かかと落とし', 'punch', null, 'UUDD'], ['kneekick', '飛びひざ蹴り', 'punch', null, 'DURR'],
  // 魔法 (3〜8 キー)
  ['fireball', 'ファイアボール', 'magic', 'fire', 'DRU'], ['flamewhirl', '火炎旋風', 'magic', 'fire', 'URDLU'], ['inferno', '紅蓮インフェルノ', 'magic', 'fire', 'DRURDLUR'],
  ['watershot', 'ウォーターショット', 'magic', 'water', 'DLU'], ['whirlpool', '渦潮スパイラル', 'magic', 'water', 'LULDR'], ['tsunami', '大津波', 'magic', 'water', 'LDRULDR'],
  ['leafcut', 'リーフカッター', 'magic', 'grass', 'ULD'], ['thornwhip', 'いばらの鞭', 'magic', 'grass', 'RDLD'], ['forest', '森羅の嵐', 'magic', 'grass', 'UDLRUD'],
  ['lightarrow', 'ライトアロー', 'magic', 'light', 'URU'], ['holyflash', '聖なる閃光', 'magic', 'light', 'RURUL'], ['judgment', '天光の審判', 'magic', 'light', 'UURDDLUR'],
  ['shadowball', 'シャドウボール', 'magic', 'dark', 'DLD'], ['darkmist', '暗黒の霧', 'magic', 'dark', 'LDLU'], ['abyss', '奈落の咆哮', 'magic', 'dark', 'DDLURDL'],
  ['royalglare', '王の威光', 'magic', 'king', 'UUDR'], ['decree', '覇王の号令', 'magic', 'king', 'RUURDD'],
  // 大技 (10 キー前後。とてもかっこいい)
  ['ult_fire', '煉獄竜王撃', 'ult', 'fire', 'DRURDRULRU'], ['ult_water', '深淵海神の怒り', 'ult', 'water', 'LDRDLURDLU'],
  ['ult_grass', '世界樹ガイアブレイク', 'ult', 'grass', 'UDUDLRLRDU'], ['ult_light', '極光セラフィムレイ', 'ult', 'light', 'URULURDRUU'],
  ['ult_dark', '冥王ナイトメアエンド', 'ult', 'dark', 'DLDRDLULDD'], ['ult_king', '天地開闢キングダム', 'ult', 'king', 'UUURRRDDDL'],
  // 新技 (種モンが持って登場。11〜12 キーで、ふつうの大技より強い)
  ['ult_nova', '太陽フレア・ノヴァ', 'ult', 'fire', 'RURDRURDLUR', '2026-11-20T08:00:00+09:00'],
  ['ult_ragnarok', '終焉ラグナロク', 'ult', 'dark', 'LDLDRURULDLR', '2026-11-20T08:00:00+09:00'],
];
const POWER = { punch: { 2: 16, 3: 22, 4: 28 }, magic: { 3: 20, 4: 27, 5: 34, 6: 42, 7: 50, 8: 58 }, ult: { 9: 82, 10: 92, 11: 100, 12: 108 } };
const SKILLS = Object.fromEntries(SKILL_LIST.map(([id, name, kind, type, cmd, release]) => [id, { id, name, kind, type, cmd, power: POWER[kind][cmd.length], release: release ? Date.parse(release) : 0 }]));
for (const id of Object.keys(SKILLS)) { const v = Number(process.env['MON_SKILL_' + id.toUpperCase()]); if (Number.isFinite(v) && v > 0) SKILLS[id].release = v; }
{ const seen = new Set(); for (const s of Object.values(SKILLS)) { if (seen.has(s.cmd)) throw new Error('技のコマンドが重なっています: ' + s.cmd); seen.add(s.cmd); } }
const skillOk = (id, now = Date.now()) => SKILLS[id] && now >= SKILLS[id].release;
const MAX_SKILLS = 8;

// ---------- ルール ----------
const MAX_CHILDREN = 5, TRAIN_TURNS = 10, INHERIT_RATE = 0.7, STUD_SCORE = 600, MAX_MONSTERS = 40;
const SCORE = { pvp: { win: 120, lose: 20 }, cpuMult: 0.6 };      // 市場価値 (戦績スコア)。CPU 戦は 0.6 倍
const COINS = { pvp: { win: 50, lose: 10 }, cpu: { win: 15, lose: 3 } }; // 対戦でもらえるコイン (ぶんばとと共用)
const INPUT_MS = Number(process.env.MON_INPUT_MS) || 10_000, SHOW_MS = Number(process.env.MON_SHOW_MS) || 3500, RECONNECT_MS = 30_000;
const RANKS = [['Z', 560], ['SS', 470], ['S', 410], ['A', 365], ['B', 320], ['C', 0]]; // 強さ評価 (powerOf の値で決める)

const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NAMES1 = ['ブレ', 'ガル', 'リュ', 'ミル', 'ザン', 'フィ', 'ドラ', 'ノア', 'ルミ', 'ガイ', 'シエ', 'バル', 'クロ', 'セラ', 'ヴォ', 'ティア', 'レオ', 'ネビュ', 'カイ', 'モル'];
const NAMES2 = ['ザード', 'モン', 'ドン', 'キュア', 'ガ', 'ノス', 'リオン', 'ルフ', 'ミア', 'ギア', 'ロス', 'ネス', 'ディア', 'バーン', 'ラ', 'ウス', 'ファング', 'ピィ'];
const randomName = () => pick(NAMES1) + pick(NAMES2);

// 見た目の遺伝子 (子は父か母のどちらかを受けつぐ。ときどき突然変異。色は両親をまぜる)
const LOOK_KEYS = { body: 6, eyes: 5, horn: 6, wing: 4, tail: 4, mark: 5, crest: 4 };
function randomLook(type) {
  const base = { fire: 12, water: 205, grass: 120, light: 48, dark: 275, king: 42 }[type];
  const look = Object.fromEntries(Object.entries(LOOK_KEYS).map(([k, n]) => [k, Math.floor(rnd() * n)]));
  look.h1 = (base + Math.round((rnd() - 0.5) * 50) + 360) % 360; look.h2 = (look.h1 + 120 + Math.round(rnd() * 120)) % 360;
  return look;
}
function mixLook(f, m, type) {
  const look = {};
  for (const [k, n] of Object.entries(LOOK_KEYS)) look[k] = rnd() < 0.1 ? Math.floor(rnd() * n) : (rnd() < 0.5 ? f[k] : m[k]);
  const mixHue = (a, b) => { const d = ((b - a + 540) % 360) - 180; return Math.round((a + d * (0.3 + rnd() * 0.4) + 360) % 360); };
  look.h1 = mixHue(f.h1, m.h1); look.h2 = rnd() < 0.5 ? f.h2 : m.h2;
  if (rnd() < 0.08) look.h2 = Math.floor(rnd() * 360);
  look.f = { body: f.body, h1: f.h1 }; look.m = { body: m.body, h1: m.h1 }; // 親の面影 (絵で少しだけ使う)
  void type; return look;
}

function strongestSkill(skills) { return skills.map((id) => SKILLS[id]).filter(Boolean).sort((a, b) => b.power - a.power || b.cmd.length - a.cmd.length)[0] || null; }
function powerOf(m) { const best = strongestSkill(m.skills); return Math.round(m.hp / 4 + m.atk + m.mag + m.def + m.spd / 2 + (best ? best.power * 0.8 : 0)); }
const rankOf = (m) => RANKS.find(([, v]) => powerOf(m) >= v)[0];

// はじめの 3 体・CPU のモンスター
function newMonster({ type = pick(TYPE_IDS), sex = rnd() < 0.5 ? 'm' : 'f', level = 1 } = {}) {
  const v = (x) => Math.round(x * (0.88 + rnd() * 0.24) * level);
  const punches = Object.values(SKILLS).filter((s) => s.kind === 'punch' && s.cmd.length <= 3 && skillOk(s.id)).map((s) => s.id);
  const magics = Object.values(SKILLS).filter((s) => s.kind === 'magic' && s.type === type && s.cmd.length <= 5).map((s) => s.id);
  const skills = [...new Set([pick(punches), pick(punches), pick(magics), `ult_${type}`])];
  return { name: randomName(), sex, type, gen: 0, look: randomLook(type), hp: v(280), atk: v(55), mag: v(55), def: v(55), spd: v(50), skills };
}

// ---------- バトルの計算 (純粋な関数。テストでも使う) ----------
// state: { mons: [a, b] (hp・能力・技・属性), first: 0|1, round }。cmds[i]: そのラウンドに入力したキーの並び
function matchSkill(mon, keys) { return mon.skills.map((id) => SKILLS[id]).find((s) => s && s.cmd === keys) || null; }
function damage(att, def, skill, r) {
  const type = skill.kind === 'punch' ? att.type : skill.type;
  const a = skill.kind === 'punch' ? att.atk : att.mag;
  const mult = typeMult(type, def.type);
  const dmg = Math.max(1, Math.round(skill.power * (a / Math.max(20, def.def)) * mult * (0.9 + r() * 0.2)));
  return { dmg, mult, type };
}
function resolveRound(state, cmds, r = rnd) {
  const ev = [];
  const order = [state.first, 1 - state.first];
  for (const p of order) {
    const me = state.mons[p], foe = state.mons[1 - p];
    if (me.hp <= 0 || foe.hp <= 0) continue;
    const keys = String(cmds[p] || '');
    const sk = keys ? matchSkill(me, keys) : null;
    if (!sk) { ev.push({ k: 'miss', p, keys, empty: !keys }); continue; }
    const d = damage(me, foe, sk, r);
    foe.hp = Math.max(0, foe.hp - d.dmg);
    ev.push({ k: 'skill', p, skill: sk.id, name: sk.name, kind: sk.kind, type: d.type, dmg: d.dmg, eff: d.mult > 1 ? 'good' : d.mult < 1 ? 'bad' : '', hp: foe.hp });
    if (foe.hp <= 0) ev.push({ k: 'ko', p: 1 - p });
  }
  state.round++;
  const alive = state.mons.map((m) => m.hp > 0);
  if (!alive[0] || !alive[1]) state.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
  else if (state.round >= 30) { const pct = state.mons.map((m) => m.hp / m.maxHp); state.winner = pct[0] === pct[1] ? -1 : pct[0] > pct[1] ? 0 : 1; ev.push({ k: 'timeup' }); }
  return ev;
}
// CPU: 持っている技からえらぶ。長いコマンドほど入力に失敗しやすい
function cpuCommand(mon, r = rnd, skill = 0.5) {
  const list = mon.skills.map((id) => SKILLS[id]).filter(Boolean);
  if (!list.length) return '';
  const s = r() < 0.45 ? strongestSkill(mon.skills) : list[Math.floor(r() * list.length)];
  const okRate = clamp(1.02 - s.cmd.length * (0.075 - skill * 0.03), 0.15, 0.97);
  return r() < okRate ? s.cmd : s.cmd.slice(0, -1);
}

const MIGRATION = `
CREATE TABLE mon_monsters (
  id TEXT PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL = 公式の種モン
  name TEXT NOT NULL,
  sex TEXT NOT NULL,                     -- m / f
  type TEXT NOT NULL,
  gen INTEGER NOT NULL DEFAULT 0,
  father_id TEXT, mother_id TEXT,
  look TEXT NOT NULL,                    -- 見た目の遺伝子 (JSON)
  hp INTEGER NOT NULL, atk INTEGER NOT NULL, mag INTEGER NOT NULL, def INTEGER NOT NULL, spd INTEGER NOT NULL,
  skills TEXT NOT NULL,                  -- 技の ID (JSON)
  inherited TEXT,                        -- 生まれたときに親から受けついだ技 (JSON)
  status TEXT NOT NULL,                  -- training (育成中) / active (戦える) / breeding (繁殖入り) / listed (セリに出品中)
  prev_status TEXT,                      -- セリに出す前の状態
  train_left INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,      -- 市場価値 (戦績スコア)
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, pvp_wins INTEGER NOT NULL DEFAULT 0, pvp_losses INTEGER NOT NULL DEFAULT 0,
  children INTEGER NOT NULL DEFAULT 0,   -- 母として産んだ数 (生涯 5 体まで)
  is_stud INTEGER NOT NULL DEFAULT 0, stud_fee INTEGER NOT NULL DEFAULT 0,
  list_price INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX mon_monsters_owner ON mon_monsters(owner_id, created_at);
CREATE TABLE mon_players (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, started_at INTEGER NOT NULL);
CREATE TABLE mon_auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER NOT NULL, monster_id TEXT NOT NULL,
  seller_id INTEGER, buyer_id INTEGER, price INTEGER, result TEXT NOT NULL,   -- sold / unsold
  created_at INTEGER NOT NULL
);
CREATE TABLE mon_escrow (user_id INTEGER NOT NULL, amount INTEGER NOT NULL, monster_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE mon_battles (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, p1 INTEGER, p2 INTEGER, m1 TEXT, m2 TEXT, winner INTEGER, rounds INTEGER NOT NULL, created_at INTEGER NOT NULL);
`;

// 公式の種モン (新技を持って登場。だれでも配合に使える)
const OFFICIAL_STUDS = [
  { id: 'stud-nova', name: 'ソルフレア', type: 'fire', skills: ['ult_nova', 'ult_fire', 'inferno', 'upper'], fee: 300, release: '2026-11-20T08:00:00+09:00', look: { body: 3, eyes: 2, horn: 4, wing: 2, tail: 3, mark: 2, crest: 3, h1: 18, h2: 48 } },
  { id: 'stud-ragna', name: 'ラグナヴォルグ', type: 'dark', skills: ['ult_ragnarok', 'ult_dark', 'abyss', 'kneekick'], fee: 300, release: '2026-11-20T08:00:00+09:00', look: { body: 1, eyes: 4, horn: 5, wing: 3, tail: 2, mark: 4, crest: 2, h1: 270, h2: 320 } },
];

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-20-monster-breeders', MIGRATION);
  // テスト中: 遊べるのはテスターだけ (環境変数 MON_TESTERS = カンマ区切りのユーザー名。未設定なら RCN413)。ほかの人には API もバトルも開かない
  const TESTERS = new Set(String(process.env.MON_TESTERS ?? 'RCN413').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const isTester = (u) => !!u && (TESTERS.has('*') || TESTERS.has(String(u.username).toLowerCase()));
  app.get('/api/mon/access', (req, res) => res.json({ ok: isTester(req.user) }));
  app.use('/api/mon', (req, res, next) => (isTester(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: 'ブリードモンスターズはまだ準備中です' })));
  const coins = ctx.cbCoins;
  const writeLimit = rateLimit({ windowMs: 60_000, max: 90, key: (req) => 'mon' + req.user.id });
  const newId = () => crypto.randomBytes(6).toString('hex');
  const qMon = db.prepare('SELECT * FROM mon_monsters WHERE id = ?');
  const parse = (row) => row && { ...row, look: JSON.parse(row.look), skills: JSON.parse(row.skills), inherited: row.inherited ? JSON.parse(row.inherited) : null };
  const getMon = (id) => parse(qMon.get(String(id || '')));
  const userView = (id) => { if (!id) return { id: 0, username: '', displayName: 'IppO 公式', avatar: { kind: 'emoji', emoji: '🏛️', color: '#4b55f0' } }; const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, verified: u.verified, titles: u.titles || [] }; };
  const skillView = (id) => SKILLS[id] && { id, name: SKILLS[id].name, kind: SKILLS[id].kind, type: SKILLS[id].type, cmd: SKILLS[id].cmd, power: SKILLS[id].power };
  const parentBrief = (id) => { const p = getMon(id); return p ? { id: p.id, name: p.name, type: p.type, look: p.look, rank: rankOf(p), score: p.score, wins: p.wins, losses: p.losses, pvpWins: p.pvp_wins, pvpLosses: p.pvp_losses, owner: p.owner_id ? null : '公式' } : null; };
  const monView = (m, { full = false } = {}) => m && {
    id: m.id, name: m.name, sex: m.sex, type: m.type, gen: m.gen, look: m.look, status: m.status, trainLeft: m.train_left,
    hp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, skills: m.skills.map(skillView).filter(Boolean),
    score: m.score, wins: m.wins, losses: m.losses, pvpWins: m.pvp_wins, pvpLosses: m.pvp_losses, children: m.children, isStud: !!m.is_stud, studFee: m.stud_fee,
    listPrice: m.list_price, rank: rankOf(m), power: powerOf(m), inherited: m.inherited, ownerId: m.owner_id, createdAt: m.created_at,
    ...(full ? { father: m.father_id ? parentBrief(m.father_id) : null, mother: m.mother_id ? parentBrief(m.mother_id) : null } : {}),
  };
  function insertMon(m, owner, extra = {}) {
    const id = extra.id || newId();
    db.prepare(`INSERT INTO mon_monsters (id, owner_id, name, sex, type, gen, father_id, mother_id, look, hp, atk, mag, def, spd, skills, inherited, status, train_left, is_stud, stud_fee, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, owner, m.name, m.sex, m.type, m.gen || 0, m.father_id || null, m.mother_id || null, JSON.stringify(m.look),
      m.hp, m.atk, m.mag, m.def, m.spd, JSON.stringify(m.skills), m.inherited ? JSON.stringify(m.inherited) : null, extra.status || 'active', extra.trainLeft || 0, extra.isStud ? 1 : 0, extra.fee || 0, Date.now());
    return id;
  }
  // 公式の種モン (まだなければ作る。登場時刻より前は配合に出さない)
  for (const s of OFFICIAL_STUDS) {
    if (qMon.get(s.id)) continue;
    const base = newMonster({ type: s.type, sex: 'm', level: 1.18 });
    insertMon({ ...base, name: s.name, look: s.look, skills: s.skills }, null, { id: s.id, status: 'breeding', isStud: true, fee: s.fee });
    db.prepare('UPDATE mon_monsters SET score = ? WHERE id = ?').run(1500, s.id);
  }
  const studReleased = (m, now = Date.now()) => { const s = OFFICIAL_STUDS.find((x) => x.id === m.id); return !s || now >= Date.parse(s.release); };
  const mine = (uid) => db.prepare('SELECT * FROM mon_monsters WHERE owner_id = ? ORDER BY created_at').all(uid).map(parse);
  const owned = (uid, id) => { const m = getMon(id); return m && m.owner_id === uid ? m : null; };

  // ---------- 状態 ----------
  app.get('/api/mon/catalog', (req, res) => res.json({
    types: TYPES, typeTable: Object.fromEntries(TYPE_IDS.map((a) => [a, Object.fromEntries(TYPE_IDS.map((d) => [d, typeMult(a, d)]))])),
    skills: Object.values(SKILLS).filter((s) => skillOk(s.id)).map((s) => skillView(s.id)), ranks: RANKS,
    rules: { maxChildren: MAX_CHILDREN, trainTurns: TRAIN_TURNS, inheritRate: INHERIT_RATE, studScore: STUD_SCORE, score: SCORE, coins: COINS, inputMs: INPUT_MS, maxSkills: MAX_SKILLS },
  }));
  app.get('/api/mon/me', requireAuth, (req, res) => {
    const uid = req.user.id, started = !!db.prepare('SELECT 1 FROM mon_players WHERE user_id = ?').get(uid);
    res.json({ started, coins: coins.get(uid), monsters: mine(uid).map((m) => monView(m)), next: nextSlot() });
  });
  app.get('/api/mon/monster/:id', (req, res) => {
    const m = getMon(req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは見つかりません' });
    res.json({ monster: monView(m, { full: true }), owner: userView(m.owner_id) });
  });
  // はじめの 3 体 (ランダム。オスとメスが両方いるように)
  app.post('/api/mon/start', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id;
    if (db.prepare('SELECT 1 FROM mon_players WHERE user_id = ?').get(uid)) return res.status(400).json({ error: 'もう始めています' });
    const sexes = rnd() < 0.5 ? ['m', 'f', rnd() < 0.5 ? 'm' : 'f'] : ['f', 'm', rnd() < 0.5 ? 'm' : 'f'];
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO mon_players (user_id, started_at) VALUES (?, ?)').run(uid, Date.now());
      for (const sex of sexes) insertMon(newMonster({ sex }), uid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`[mon] @${req.user.username} がブリードモンスターズを始めた`);
    res.json({ monsters: mine(uid).map((m) => monView(m)) });
  });
  app.post('/api/mon/monster/:id/rename', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    const name = String(req.body?.name || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 12);
    if (!name) return res.status(400).json({ error: '名前を入れてください' });
    db.prepare('UPDATE mon_monsters SET name = ? WHERE id = ?').run(name, m.id);
    res.json({ monster: monView(getMon(m.id)) });
  });

  // ---------- 育成 (10 ターン。直殴りか魔法をえらぶ) ----------
  app.post('/api/mon/monster/:id/train', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (m.status !== 'training' || m.train_left <= 0) return res.status(400).json({ error: 'このモンスターは育成期間ではありません' });
    const choice = req.body?.choice === 'magic' ? 'magic' : 'punch';
    const g = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const up = choice === 'punch' ? { hp: g(3, 6), atk: g(2, 4), mag: g(0, 1), def: g(1, 2), spd: g(0, 2) } : { hp: g(2, 4), atk: g(0, 1), mag: g(2, 4), def: g(1, 2), spd: g(0, 2) };
    let learned = null, replaced = null;
    if (rnd() < 0.42) { // ときどき技を覚える (弱い技ほど覚えやすい。魔法は自分の属性が出やすい)
      const pool = Object.values(SKILLS).filter((s) => s.kind === choice && skillOk(s.id) && !m.skills.includes(s.id) && (choice === 'punch' || s.type === m.type || rnd() < 0.35));
      if (pool.length) {
        const w = pool.map((s) => 1 / s.cmd.length ** 1.4), tot = w.reduce((a, b) => a + b, 0); let u = rnd() * tot, sk = pool[0];
        for (let i = 0; i < pool.length; i++) { u -= w[i]; if (u <= 0) { sk = pool[i]; break; } }
        learned = sk.id;
        const skills = [...m.skills, sk.id];
        if (skills.length > MAX_SKILLS) { const weakest = skills.filter((id) => SKILLS[id].kind !== 'ult').sort((a, b) => SKILLS[a].power - SKILLS[b].power)[0]; replaced = weakest; skills.splice(skills.indexOf(weakest), 1); }
        m.skills = skills;
      }
    }
    const left = m.train_left - 1;
    db.prepare('UPDATE mon_monsters SET hp = hp + ?, atk = atk + ?, mag = mag + ?, def = def + ?, spd = spd + ?, skills = ?, train_left = ?, status = ? WHERE id = ?')
      .run(up.hp, up.atk, up.mag, up.def, up.spd, JSON.stringify(m.skills), left, left > 0 ? 'training' : 'active', m.id);
    res.json({ choice, up, learned: learned && skillView(learned), replaced: replaced && skillView(replaced), done: left <= 0, monster: monView(getMon(m.id)) });
  });

  // ---------- 繁殖入り・種モン ----------
  app.post('/api/mon/monster/:id/retire', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (m.status !== 'active') return res.status(400).json({ error: m.status === 'training' ? '育成が終わってから繁殖入りできます' : 'このモンスターは繁殖入りできません' });
    db.prepare("UPDATE mon_monsters SET status = 'breeding' WHERE id = ?").run(m.id);
    res.json({ monster: monView(getMon(m.id)) });
  });
  app.post('/api/mon/monster/:id/stud', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (m.sex !== 'm') return res.status(400).json({ error: '種モンになれるのはオスだけです' });
    if (m.score < STUD_SCORE) return res.status(400).json({ error: `種モンになるには市場価値 ${STUD_SCORE} 以上が必要です (いま ${m.score})` });
    if (!['active', 'breeding'].includes(m.status)) return res.status(400).json({ error: 'このモンスターは種モンにできません' });
    const fee = clamp(Math.round(Number(req.body?.fee) || 0), 0, 100000);
    db.prepare("UPDATE mon_monsters SET status = 'breeding', is_stud = 1, stud_fee = ? WHERE id = ?").run(fee, m.id);
    res.json({ monster: monView(getMon(m.id)) });
  });
  app.get('/api/mon/studs', (req, res) => {
    const list = db.prepare("SELECT * FROM mon_monsters WHERE is_stud = 1 AND status = 'breeding' ORDER BY score DESC LIMIT 60").all().map(parse).filter((m) => studReleased(m));
    res.json({ studs: list.map((m) => ({ ...monView(m), owner: userView(m.owner_id), official: !m.owner_id })) });
  });

  // ---------- 配合 ----------
  app.post('/api/mon/breed', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id;
    const mo = owned(uid, req.body?.mother), fa = getMon(req.body?.father);
    if (!mo || mo.sex !== 'f' || mo.status !== 'breeding') return res.status(400).json({ error: '母は、繁殖入りした自分のメスをえらんでください' });
    if (mo.children >= MAX_CHILDREN) return res.status(400).json({ error: `この母はもう ${MAX_CHILDREN} 体産みました` });
    if (!fa || fa.sex !== 'm' || fa.status !== 'breeding' || (fa.owner_id !== uid && !fa.is_stud) || !studReleased(fa)) return res.status(400).json({ error: '父は、繁殖入りした自分のオスか、種モンをえらんでください' });
    if (fa.id === mo.father_id || fa.id === mo.id) return res.status(400).json({ error: '親子では配合できません' });
    if (db.prepare("SELECT COUNT(*) AS n FROM mon_monsters WHERE owner_id = ? AND status != 'breeding'").get(uid).n >= MAX_MONSTERS) return res.status(400).json({ error: `持てるモンスターは ${MAX_MONSTERS} 体までです (セリに出すか繁殖入りさせてください)` });
    const fee = fa.owner_id === uid ? 0 : fa.stud_fee;
    // 子を作る: 属性は父か母 (まれに別の属性)、能力は両親の平均 + ばらつき、技は両親のいちばん強い技を 70% ずつ
    const type = rnd() < 0.06 ? pick(TYPE_IDS) : rnd() < 0.5 ? fa.type : mo.type;
    const avg = (k) => Math.round(((fa[k] + mo[k]) / 2) * (0.94 + rnd() * 0.14));
    const inherited = [];
    for (const [who, p] of [['父', fa], ['母', mo]]) { const best = strongestSkill(p.skills); if (best && rnd() < INHERIT_RATE) inherited.push({ from: who, skill: best.id }); }
    const punches = Object.values(SKILLS).filter((s) => s.kind === 'punch' && s.cmd.length === 2).map((s) => s.id);
    const skills = [...new Set([pick(punches), ...inherited.map((x) => x.skill)])];
    if (!skills.some((id) => SKILLS[id].kind === 'ult')) skills.push(`ult_${type}`); // どのモンスターも大技を 1 つは持つ
    const child = { name: randomName(), sex: rnd() < 0.5 ? 'm' : 'f', type, gen: Math.max(fa.gen, mo.gen) + 1, father_id: fa.id, mother_id: mo.id, look: mixLook(fa.look, mo.look, type),
      hp: avg('hp'), atk: avg('atk'), mag: avg('mag'), def: avg('def'), spd: avg('spd'), skills, inherited };
    db.exec('BEGIN');
    let id;
    try {
      if (fee && !coins.spend(uid, fee)) throw Object.assign(new Error(`コインが足りません (種付け料 ${fee} コイン)`), { user: true });
      if (fee && fa.owner_id) coins.add(fa.owner_id, fee);
      if (!db.prepare('UPDATE mon_monsters SET children = children + 1 WHERE id = ? AND children < ?').run(mo.id, MAX_CHILDREN).changes) throw Object.assign(new Error('この母はもう産めません'), { user: true });
      id = insertMon(child, uid, { status: 'training', trainLeft: TRAIN_TURNS });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); if (e.user) return res.status(400).json({ error: e.message }); throw e; }
    console.log(`[mon] @${req.user.username} 配合 ${fa.name}×${mo.name} → ${child.name}`);
    res.json({ child: monView(getMon(id), { full: true }), fee, coins: coins.get(uid) });
  });

  // ---------- ランキング (市場価値) ----------
  app.get('/api/mon/ranking', (req, res) => {
    const rows = db.prepare('SELECT * FROM mon_monsters WHERE owner_id IS NOT NULL AND score > 0 ORDER BY score DESC, pvp_wins DESC LIMIT 30').all().map(parse);
    res.json({ top: rows.map((m, i) => ({ rank: i + 1, monster: monView(m), owner: userView(m.owner_id) })) });
  });

  // ======================= セリ (毎時 5 分・リアルタイム) =======================
  // テストのときは MON_AUCTION_PERIOD_MS / MON_AUCTION_OFFSET_MS で間隔を変えられる
  const PERIOD = Number(process.env.MON_AUCTION_PERIOD_MS) || 3600_000, OFFSET = Number(process.env.MON_AUCTION_OFFSET_MS) || 5 * 60_000;
  const LOT_MS = Number(process.env.MON_LOT_MS) || 25_000, EXTEND_MS = 8_000, MIN_PRICE = 10;
  function nextSlot(now = Date.now()) { const base = Math.floor((now - OFFSET) / PERIOD) * PERIOD + OFFSET; return base > now ? base : base + PERIOD; }
  // 起動したときに預かったままのコイン (前の起動中のセリ) は返す
  for (const e of db.prepare('SELECT * FROM mon_escrow').all()) coins.add(e.user_id, e.amount);
  db.exec('DELETE FROM mon_escrow');
  db.prepare("UPDATE mon_monsters SET status = COALESCE(prev_status, 'active') WHERE status = 'auction'").run();
  app.post('/api/mon/monster/:id/list', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (!m.mother_id) return res.status(400).json({ error: 'セリに出せるのは、メスが産んだモンスターだけです' });
    if (!['training', 'active'].includes(m.status)) return res.status(400).json({ error: 'このモンスターはセリに出せません (繁殖入り・出品中)' });
    const price = clamp(Math.round(Number(req.body?.price) || MIN_PRICE), MIN_PRICE, 1_000_000);
    db.prepare("UPDATE mon_monsters SET prev_status = status, status = 'listed', list_price = ? WHERE id = ?").run(price, m.id);
    broadcastAuction();
    res.json({ monster: monView(getMon(m.id)), slot: nextSlot() });
  });
  app.post('/api/mon/monster/:id/unlist', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m || m.status !== 'listed') return res.status(400).json({ error: '出品していません' });
    db.prepare("UPDATE mon_monsters SET status = COALESCE(prev_status, 'active'), list_price = NULL WHERE id = ?").run(m.id);
    broadcastAuction();
    res.json({ monster: monView(getMon(m.id)) });
  });
  let auction = null; // { slot, lots: [id], i, lot: { id, price, bidder, endsAt, bids } }
  const auctionView = () => {
    const listed = db.prepare("SELECT * FROM mon_monsters WHERE status = 'listed' ORDER BY created_at").all().map(parse);
    const lotOf = (m) => ({ ...monView(m, { full: true }), seller: userView(m.owner_id) });
    if (!auction) return { live: false, next: nextSlot(), now: Date.now(), queue: listed.map(lotOf) };
    const cur = auction.lot && getMon(auction.lot.id);
    return { live: true, next: nextSlot(), now: Date.now(), slot: auction.slot, index: auction.i, total: auction.lots.length,
      lot: cur ? { monster: lotOf(cur), price: auction.lot.price, start: cur.list_price, bidder: auction.lot.bidder ? userView(auction.lot.bidder) : null, endsAt: auction.lot.endsAt, bids: auction.lot.bids, minNext: minNext() } : null,
      results: auction.results, queue: auction.lots.slice(auction.i + 1).map((id) => getMon(id)).filter(Boolean).map(lotOf) };
  };
  const minNext = () => (auction?.lot?.bidder ? auction.lot.price + Math.max(10, Math.ceil(auction.lot.price * 0.1)) : auction?.lot?.price || MIN_PRICE);
  app.get('/api/mon/auction', (req, res) => res.json(auctionView()));
  const watchers = new Set();
  function broadcastAuction() { const msg = JSON.stringify({ t: 'auction', state: auctionView() }); for (const ws of watchers) if (ws.readyState === 1) ws.send(msg); }
  function startAuction(slot) {
    const lots = db.prepare("SELECT id FROM mon_monsters WHERE status = 'listed' ORDER BY created_at").all().map((r) => r.id);
    if (!lots.length) return;
    db.prepare(`UPDATE mon_monsters SET status = 'auction' WHERE id IN (${lots.map(() => '?').join(',')})`).run(...lots);
    auction = { slot, lots, i: -1, lot: null, results: [] };
    console.log(`[mon] セリ開始 (${lots.length} 体)`);
    nextLot();
  }
  function nextLot() {
    auction.i++;
    if (auction.i >= auction.lots.length) { console.log('[mon] セリ終了'); const done = auction; auction = null; broadcastAuction(); void done; return; }
    const m = getMon(auction.lots[auction.i]);
    if (!m) return nextLot();
    auction.lot = { id: m.id, price: m.list_price || MIN_PRICE, bidder: null, endsAt: Date.now() + LOT_MS, bids: 0 };
    broadcastAuction();
    scheduleLotEnd();
  }
  let lotTimer = null;
  function scheduleLotEnd() { clearTimeout(lotTimer); lotTimer = setTimeout(() => { if (Date.now() >= auction.lot.endsAt - 30) endLot(); else scheduleLotEnd(); }, Math.max(50, auction.lot.endsAt - Date.now())); }
  function endLot() {
    const lot = auction.lot, m = getMon(lot.id);
    if (m) {
      if (lot.bidder) { // 落札: 預かったコインを売り手へ、モンスターを買い手へ
        db.prepare('DELETE FROM mon_escrow WHERE user_id = ? AND monster_id = ?').run(lot.bidder, lot.id);
        if (m.owner_id) coins.add(m.owner_id, lot.price);
        db.prepare("UPDATE mon_monsters SET owner_id = ?, status = COALESCE(prev_status, 'active'), list_price = NULL, prev_status = NULL WHERE id = ?").run(lot.bidder, m.id);
        db.prepare("INSERT INTO mon_auctions (slot, monster_id, seller_id, buyer_id, price, result, created_at) VALUES (?, ?, ?, ?, ?, 'sold', ?)").run(auction.slot, m.id, m.owner_id, lot.bidder, lot.price, Date.now());
        auction.results.push({ id: m.id, name: m.name, price: lot.price, buyer: userView(lot.bidder) });
        console.log(`[mon] セリ: ${m.name} → user ${lot.bidder} (${lot.price} コイン)`);
      } else { // 売れ残り: 持ち主にもどす
        db.prepare("UPDATE mon_monsters SET status = COALESCE(prev_status, 'active'), list_price = NULL, prev_status = NULL WHERE id = ?").run(m.id);
        db.prepare("INSERT INTO mon_auctions (slot, monster_id, seller_id, result, created_at) VALUES (?, ?, ?, 'unsold', ?)").run(auction.slot, m.id, m.owner_id, Date.now());
        auction.results.push({ id: m.id, name: m.name, price: null });
      }
    }
    nextLot();
  }
  function bid(uid, amount) {
    if (!auction?.lot) return 'いまセリは開かれていません';
    const lot = auction.lot, m = getMon(lot.id);
    if (!m || m.owner_id === uid) return '自分のモンスターには入札できません';
    if (lot.bidder === uid) return 'いちばん高い入札はあなたです';
    const need = minNext(); amount = Math.round(Number(amount) || 0);
    if (amount < need) return `${need} コイン以上で入札してください`;
    if (!coins.spend(uid, amount)) return 'コインが足りません';
    db.prepare('INSERT INTO mon_escrow (user_id, amount, monster_id, created_at) VALUES (?, ?, ?, ?)').run(uid, amount, lot.id, Date.now());
    if (lot.bidder) { coins.add(lot.bidder, lot.price); db.prepare('DELETE FROM mon_escrow WHERE user_id = ? AND monster_id = ?').run(lot.bidder, lot.id); sendTo(lot.bidder, { t: 'outbid', name: m.name, coins: coins.get(lot.bidder) }); }
    lot.bidder = uid; lot.price = amount; lot.bids++;
    lot.endsAt = Math.max(lot.endsAt, Date.now() + EXTEND_MS); // 終わりぎわの入札は少し延長
    scheduleLotEnd(); broadcastAuction();
    return null;
  }
  // 毎時 5 分にセリを始める
  let slotTimer = null;
  const armSlot = () => { clearTimeout(slotTimer); const at = nextSlot(); slotTimer = setTimeout(() => { if (!auction) startAuction(at); armSlot(); }, Math.max(100, at - Date.now())); slotTimer.unref?.(); };
  armSlot();

  // ======================= バトル (WebSocket /mb) =======================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const conns = new Map(); const battleOf = new Map();
  let queue = null; const rooms = new Map();
  const sendTo = (uid, msg) => { const ws = conns.get(uid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const boardText = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const fighter = (m) => ({ id: m.id, name: m.name, type: m.type, sex: m.sex, look: m.look, rank: rankOf(m), hp: m.hp, maxHp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, skills: [...m.skills] });
  const pub = (b) => ({ round: b.state.round, first: b.state.first, mons: b.state.mons.map((f) => ({ ...f, skills: f.skills.map(skillView).filter(Boolean) })) });
  function cpuMonster(m) { // 自分と同じくらいの強さの CPU
    const lv = clamp(powerOf(m) / 300, 0.8, 1.8);
    const c = newMonster({ level: lv });
    const extra = Object.values(SKILLS).filter((s) => s.kind === 'magic' && s.type === c.type).sort((a, b) => b.power - a.power)[0];
    if (extra && lv > 1.2) c.skills.push(extra.id);
    return { ...c, id: 'cpu', name: 'CPU・' + c.name };
  }
  function startBattle(mode, uids, mons) {
    const b = { id: newId(), mode, uids, monIds: mons.map((m) => m.id), cmds: [null, null], timer: null, left: [null, null], ended: false,
      state: { round: 0, first: rnd() < 0.5 ? 0 : 1, winner: null, mons: mons.map(fighter) },
      players: uids.map((u) => (u ? userView(u) : { id: 0, username: 'cpu', displayName: 'CPU', avatar: { kind: 'emoji', emoji: '🤖', color: '#64748b' } })) };
    uids.forEach((u, i) => { if (u) { battleOf.set(u, b); sendTo(u, { t: 'start', mode, you: i, players: b.players, state: pub(b), tossMs: 2400 }); } });
    b.timer = setTimeout(() => nextRound(b), 2600); // コイントスの演出のあと
    return b;
  }
  function nextRound(b) {
    if (b.ended) return;
    b.cmds = [null, null];
    if (!b.uids[1]) b.cmds[1] = cpuCommand(b.state.mons[1], rnd, b.mode === 'cpu' ? 0.5 : 0.5);
    b.deadline = Date.now() + INPUT_MS;
    b.uids.forEach((u) => u && sendTo(u, { t: 'input', round: b.state.round + 1, deadline: b.deadline, ms: INPUT_MS, state: pub(b) }));
    clearTimeout(b.timer); b.timer = setTimeout(() => resolve(b), INPUT_MS + 400);
  }
  function resolve(b) {
    if (b.ended) return;
    clearTimeout(b.timer);
    const events = resolveRound(b.state, b.cmds.map((c) => c || ''));
    b.uids.forEach((u) => u && sendTo(u, { t: 'result', events, cmds: b.cmds.map((c) => c || ''), state: pub(b) }));
    if (b.state.winner !== null) { b.timer = setTimeout(() => finish(b, b.state.winner), Math.min(SHOW_MS, 2500)); return; }
    b.timer = setTimeout(() => nextRound(b), SHOW_MS);
  }
  function finish(b, winner, reason = '') {
    if (b.ended) return;
    b.ended = true; clearTimeout(b.timer); b.left.forEach((t) => clearTimeout(t));
    db.prepare('INSERT INTO mon_battles (mode, p1, p2, m1, m2, winner, rounds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(b.mode, b.uids[0], b.uids[1] || null, b.monIds[0], b.monIds[1] || null, winner, b.state.round, Date.now());
    const pvp = !!b.uids[1];
    b.uids.forEach((u, i) => {
      if (!u) return;
      const res = winner === -1 ? 'draw' : winner === i ? 'win' : 'lose';
      const base = SCORE.pvp[res === 'win' ? 'win' : 'lose'] * (res === 'draw' ? 0.5 : 1);
      const score = Math.round(pvp ? base : base * SCORE.cpuMult);
      const gain = (pvp ? COINS.pvp : COINS.cpu)[res === 'win' ? 'win' : 'lose'];
      const tooShort = b.state.round < 2 && reason === 'surrender' && res === 'lose';
      const m = getMon(b.monIds[i]);
      if (m && m.owner_id === u) {
        db.prepare(`UPDATE mon_monsters SET score = score + ?, wins = wins + ?, losses = losses + ?, pvp_wins = pvp_wins + ?, pvp_losses = pvp_losses + ? WHERE id = ?`)
          .run(tooShort ? 0 : score, res === 'win' ? 1 : 0, res === 'lose' ? 1 : 0, pvp && res === 'win' ? 1 : 0, pvp && res === 'lose' ? 1 : 0, m.id);
      }
      if (!tooShort) coins.add(u, gain);
      battleOf.delete(u);
      sendTo(u, { t: 'end', result: res, reason, score: tooShort ? 0 : score, coins: tooShort ? 0 : gain, pvp, monster: m ? monView(getMon(m.id)) : null, state: pub(b) });
    });
  }
  function leave(uid) {
    if (queue?.uid === uid) queue = null;
    for (const [code, r] of rooms) if (r.uid === uid) rooms.delete(code);
  }
  // 掲示板 (いま部屋で待っている募集の一覧)
  app.get('/api/mon/board', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const list = [];
    for (const [code, r] of rooms) {
      if (Date.now() - r.at > 10 * 60_000 || conns.get(r.uid)?.readyState !== 1 || battleOf.get(r.uid)) continue;
      const m = getMon(r.mon); if (!m) continue;
      list.push({ code, user: userView(r.uid), comment: r.comment, at: r.at, monster: monView(m), mine: !!req.user && req.user.id === r.uid });
    }
    res.json({ posts: list.sort((a, b) => b.at - a.at) });
  });
  wss.on('connection', (ws, req, user) => {
    const uid = user.id;
    const old = conns.get(uid); if (old && old !== ws) { try { old.close(4000, 'replaced'); } catch {} }
    conns.set(uid, ws);
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    const iv = setInterval(() => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch {} }, 25_000);
    const b = battleOf.get(uid);
    if (b && !b.ended) { const i = b.uids.indexOf(uid); clearTimeout(b.left[i]); b.left[i] = null; sendTo(uid, { t: 'start', mode: b.mode, you: i, players: b.players, state: pub(b), resumed: true }); if (b.deadline > Date.now()) sendTo(uid, { t: 'input', round: b.state.round + 1, deadline: b.deadline, ms: INPUT_MS, state: pub(b), submitted: !!b.cmds[i] }); }
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'watch') { watchers.add(ws); return ws.send(JSON.stringify({ t: 'auction', state: auctionView() })); }
      if (m.t === 'bid') { const err = bid(uid, m.amount); if (err) sendTo(uid, { t: 'bidError', msg: err }); else sendTo(uid, { t: 'bidOk', coins: coins.get(uid) }); return; }
      if (m.t === 'find') {
        if (battleOf.get(uid)) return;
        leave(uid);
        const mon = owned(uid, m.mon);
        if (!mon || mon.status !== 'active') return sendTo(uid, { t: 'error', msg: '戦えるモンスターをえらんでください (育成中・繁殖入り・出品中は戦えません)' });
        if (m.mode === 'cpu') return startBattle('cpu', [uid, null], [mon, cpuMonster(mon)]);
        if (m.mode === 'random') {
          if (queue && queue.uid !== uid && conns.get(queue.uid)?.readyState === 1 && !battleOf.get(queue.uid)) { const q = queue; queue = null; const qm = getMon(q.mon); if (qm && qm.status === 'active') return startBattle('random', [q.uid, uid], [qm, mon]); }
          queue = { uid, mon: mon.id }; return sendTo(uid, { t: 'waiting', mode: 'random' });
        }
        if (m.mode === 'board') {
          let code; do { code = String(crypto.randomInt(1000, 10000)); } while (rooms.has(code));
          rooms.set(code, { uid, mon: mon.id, at: Date.now(), comment: boardText(m.comment) });
          return sendTo(uid, { t: 'waiting', mode: 'board', code });
        }
        if (m.mode === 'join') {
          const r = rooms.get(String(m.code || ''));
          if (!r || conns.get(r.uid)?.readyState !== 1 || battleOf.get(r.uid)) { rooms.delete(String(m.code || '')); return sendTo(uid, { t: 'error', msg: 'その募集は終わりました' }); }
          if (r.uid === uid) return sendTo(uid, { t: 'error', msg: '自分の募集には入れません' });
          const rm = getMon(r.mon); if (!rm || rm.status !== 'active') return sendTo(uid, { t: 'error', msg: 'その募集は終わりました' });
          rooms.delete(String(m.code)); return startBattle('board', [r.uid, uid], [rm, mon]);
        }
      }
      if (m.t === 'cmd') { // 入力したコマンド (十字キーの並び)。1 ラウンド 1 回
        const bb = battleOf.get(uid); if (!bb || bb.ended) return;
        const i = bb.uids.indexOf(uid); if (bb.cmds[i] !== null) return;
        bb.cmds[i] = String(m.keys || '').toUpperCase().replace(/[^UDLR]/g, '').slice(0, 16);
        const o = bb.uids[1 - i]; if (o) sendTo(o, { t: 'opponentReady' });
        if (bb.cmds[0] !== null && bb.cmds[1] !== null) resolve(bb);
      }
      if (m.t === 'cancel') { leave(uid); sendTo(uid, { t: 'cancelled' }); }
      if (m.t === 'surrender') { const bb = battleOf.get(uid); if (bb) finish(bb, 1 - bb.uids.indexOf(uid), 'surrender'); }
    });
    ws.on('close', () => {
      clearInterval(iv); watchers.delete(ws);
      if (conns.get(uid) !== ws) return;
      conns.delete(uid); leave(uid);
      const bb = battleOf.get(uid);
      if (bb && !bb.ended) {
        const i = bb.uids.indexOf(uid), o = bb.uids[1 - i];
        if (!o) return finish(bb, 1 - i, 'left');
        sendTo(o, { t: 'opponentLeft', ms: RECONNECT_MS });
        bb.left[i] = setTimeout(() => finish(bb, 1 - i, 'left'), RECONNECT_MS);
      }
    });
  });
  ctx.monUpgrade = (req, socket, head, user) => !isTester(user) ? (socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'), socket.destroy()) : wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  ctx.eraseMon = (uid) => {
    leave(uid);
    const b = battleOf.get(uid); if (b && !b.ended) finish(b, 1 - b.uids.indexOf(uid), 'left');
    for (const e of db.prepare('SELECT * FROM mon_escrow WHERE user_id = ?').all(uid)) void e; // 預かりコインは、コインごと消える
    db.prepare('DELETE FROM mon_escrow WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM mon_monsters WHERE owner_id = ?').run(uid);
    db.prepare('DELETE FROM mon_players WHERE user_id = ?').run(uid);
    db.prepare('UPDATE mon_battles SET p1 = NULL WHERE p1 = ?').run(uid);
    db.prepare('UPDATE mon_battles SET p2 = NULL WHERE p2 = ?').run(uid);
  };
  // テスト用: セリをすぐ始める (MON_AUCTION_TEST=1 のときだけ)
  if (process.env.MON_AUCTION_TEST === '1') app.post('/api/mon/auction/test-start', (req, res) => { if (!auction) startAuction(Date.now()); res.json(auctionView()); });
};
Object.assign(module.exports, { TYPES, typeMult, SKILLS, POWER, resolveRound, cpuCommand, matchSkill, newMonster, mixLook, randomLook, powerOf, rankOf, strongestSkill, RANKS, INHERIT_RATE, MAX_CHILDREN, STUD_SCORE });
