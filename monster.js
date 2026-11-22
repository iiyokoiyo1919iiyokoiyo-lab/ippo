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
// ・メスが産んだ子は、15 分ごと (毎時 5・20・35・50 分) のセリ (リアルタイム) に出せる。父と母の戦績と受けついだ技が見られる
// ・市場価値は対人戦で上がる。CPU 戦でも上がるが 0.6 倍
// ・乱数・判定はすべてサーバー側 (端末から来るのは、押したキーの並びと選んだものだけ)
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const MUT = require('./monster-mutation'); // 突然変異 (データと計算)

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
// 防御: どのモンスターも最初から使える。相手が「同じラウンドの同じ回」に技を撃ってきたら、その技を無効にする (撃ってこなければ空振り)
const GUARD = { id: 'guard', name: 'ぼうぎょ', kind: 'guard', cmd: 'DD' };
{ const seen = new Set([GUARD.cmd]); for (const s of Object.values(SKILLS)) { if (seen.has(s.cmd)) throw new Error('技のコマンドが重なっています: ' + s.cmd); seen.add(s.cmd); } }
const skillOk = (id, now = Date.now()) => SKILLS[id] && now >= SKILLS[id].release;
const MAX_SKILLS = 8;

// ---------- ルール ----------
const MAX_CHILDREN = 5, TRAIN_TURNS = 10, INHERIT_RATE = 0.7, STUD_SCORE = 600, MAX_MONSTERS = 40;
// 売却: 強さの 8% + 市場価値の 2% (10〜500 コイン)。ショップのメス (B で約 200) を買って産ませて全部売っても得をしない値段
const SELL = { power: 0.16, score: 0.04, min: 20, max: 1000 }; // 2026-11-22: 買取金額を倍に (8%・2%・10〜500 → 16%・4%・20〜1000)
const EXTRACT_COST = 1000; // 変異抽出装置: 自分のモンスターの変異を、別の自分のモンスターに写す (元はそのまま)
const sellPrice = (m) => clamp(Math.round(powerOf(m) * SELL.power + Math.max(0, m.score || 0) * SELL.score), SELL.min, SELL.max);
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
// state: { mons: [a, b] (hp・能力・技・属性), first: 0|1, round }。cmds[i]: そのラウンドに確定したコマンドの並び (いくつでも)
// 先攻の 1 つ目 → 後攻の 1 つ目 → 先攻の 2 つ目 … と交互に出す (片方が多ければ、残りはそのあと続けて出す)
function matchSkill(mon, keys) { return mon.skills.map((id) => SKILLS[id]).find((s) => s && s.cmd === keys) || null; }
function damage(att, def, skill, r) {
  let type = skill.kind === 'punch' ? att.type : skill.type;
  // キメラ種: 直殴りは、自分の属性と 2 つ目の属性のうち有利な方
  if (skill.kind === 'punch' && att.fx?.type2 && typeMult(att.fx.type2, def.type) > typeMult(type, def.type)) type = att.fx.type2;
  const a = skill.kind === 'punch' ? att.atk : att.mag;
  const mult = typeMult(type, def.type);
  const fx = (att.fx?.[skill.kind] || 1) * (def.fx?.taken || 1);
  const dmg = Math.max(1, Math.round(skill.power * (a / Math.max(20, def.def)) * mult * fx * (0.9 + r() * 0.2)));
  return { dmg, mult, type };
}
function resolveRound(state, cmds, r = rnd) {
  const ev = [];
  const lists = cmds.map((c) => (Array.isArray(c) ? c : c ? [c] : []).map(String));
  const steps = [];
  for (let k = 0; k < Math.max(lists[0].length, lists[1].length, 1); k++) for (const p of [state.first, 1 - state.first]) if (k < lists[p].length || (k === 0 && !lists[p].length)) steps.push([p, lists[p][k] || '', k]);
  // 防御: 同じ回 (k 番目) に相手が技を撃ってきたら無効
  const guarding = (p, k) => lists[p][k] === GUARD.cmd;
  const attacks = (p, k) => !!(lists[p][k] && matchSkill(state.mons[p], lists[p][k]));
  for (const [p, keys, k] of steps) {
    const me = state.mons[p], foe = state.mons[1 - p];
    if (me.hp <= 0 || foe.hp <= 0) continue;
    if (keys === GUARD.cmd) {
      const hitBy = attacks(1 - p, k);
      // 相手がこのあと撃ってくるなら構えを見せる。もう防いだ後なら何も出さない。撃ってこなければ空振り
      const already = ev.some((e) => e.k === 'blocked' && e.p === 1 - p && e.slot === k);
      if (!already) ev.push({ k: 'guard', p, slot: k, idle: !hitBy });
      continue;
    }
    const sk = keys ? matchSkill(me, keys) : null;
    if (!sk) { ev.push({ k: 'miss', p, keys, empty: !keys }); continue; }
    if (guarding(1 - p, k)) { ev.push({ k: 'blocked', p, slot: k, skill: sk.id, name: sk.name, kind: sk.kind, type: sk.kind === 'punch' ? me.type : sk.type }); continue; }
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
// CPU: 10 秒で打てるだけ打つ (1 キーおよそ 0.6 秒 + 決定)。長いコマンドほど失敗しやすい
function cpuCommands(mon, r = rnd, ms = 10_000) {
  const out = []; let t = 600 + r() * 900;
  for (let i = 0; i < 8; i++) { const c = r() < 0.12 ? GUARD.cmd : cpuCommand(mon, r); const need = c.length * (500 + r() * 300) + 400; if (t + need > ms) break; t += need; out.push(c); }
  return out;
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
  status TEXT NOT NULL,                  -- training (育成中) / active (戦える) / breeding (繁殖入り) / listed (セリに出品中) / sold (売却済み。血統のためにデータは残す)
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

// 突然変異 (2026-11-20): 個体の変異・発見の記録 (書きかえ・削除できない)・変異と遺伝の履歴・配合の二重実行の防止
const MUTATION_MIGRATION = `
ALTER TABLE mon_monsters ADD COLUMN init_score INTEGER NOT NULL DEFAULT 0;   -- 生まれたときの市場価値 (変異の初期値)。種モンの条件には数えない
CREATE TABLE mon_mutations (
  monster_id TEXT NOT NULL REFERENCES mon_monsters(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  rarity TEXT NOT NULL,                  -- N / R / SR / SSR / UR / MR
  mode TEXT NOT NULL,                    -- direct (表に出ている) / latent (潜在)
  origin TEXT NOT NULL,                  -- new (突然変異) / father / mother
  param TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (monster_id, mutation_id)  -- 同じ変異の重複登録を防ぐ
);
CREATE TABLE mon_discoveries (
  key TEXT PRIMARY KEY,                  -- m:<変異 id> / c:<id+id…> (組み合わせ)
  kind TEXT NOT NULL,                    -- mutation / combo
  mutation_ids TEXT NOT NULL,            -- JSON
  rarity TEXT,
  user_id INTEGER,                       -- 初発見者 (退会しても数字は残す)
  monster_id TEXT NOT NULL, father_id TEXT, mother_id TEXT,
  lineage TEXT NOT NULL,                 -- 血統 (JSON)
  first INTEGER NOT NULL DEFAULT 1,
  discovered_at INTEGER NOT NULL
);
CREATE TRIGGER mon_discoveries_no_update BEFORE UPDATE ON mon_discoveries BEGIN SELECT RAISE(ABORT, '発見の記録は変更できません'); END;
CREATE TRIGGER mon_discoveries_no_delete BEFORE DELETE ON mon_discoveries BEGIN SELECT RAISE(ABORT, '発見の記録は削除できません'); END;
CREATE TABLE mon_mutation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monster_id TEXT NOT NULL, event TEXT NOT NULL, mutation_id TEXT, rarity TEXT, detail TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX mon_mutation_log_monster ON mon_mutation_log(monster_id);
CREATE TABLE mon_breed_requests (
  user_id INTEGER NOT NULL, request_id TEXT NOT NULL, monster_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
`;

// 公式の種モン (新技を持って登場。だれでも配合に使える)
const OFFICIAL_STUDS = [
  { id: 'stud-nova', name: 'ソルフレア', type: 'fire', skills: ['ult_nova', 'ult_fire', 'inferno', 'upper'], fee: 300, release: '2026-11-20T08:00:00+09:00', look: { body: 3, eyes: 2, horn: 4, wing: 2, tail: 3, mark: 2, crest: 3, h1: 18, h2: 48 } },
  { id: 'stud-ragna', name: 'ラグナヴォルグ', type: 'dark', skills: ['ult_ragnarok', 'ult_dark', 'abyss', 'kneekick'], fee: 300, release: '2026-11-20T08:00:00+09:00', look: { body: 1, eyes: 4, horn: 5, wing: 3, tail: 2, mark: 4, crest: 2, h1: 270, h2: 320 } },
];

// 共通の種モン (属性ごとに 1 体。いつでも、だれでも、安い種付け料で配合に使える)
const COMMON_STUD_FEE = 30;
const COMMON_STUDS = [
  { id: 'common-fire', name: 'ヒノコ', type: 'fire', look: { body: 1, eyes: 0, horn: 2, wing: 0, tail: 3, mark: 1, crest: 0, h1: 14, h2: 44 } },
  { id: 'common-water', name: 'アクアン', type: 'water', look: { body: 0, eyes: 2, horn: 0, wing: 2, tail: 2, mark: 2, crest: 0, h1: 204, h2: 180 } },
  { id: 'common-grass', name: 'モリノ', type: 'grass', look: { body: 2, eyes: 0, horn: 0, wing: 1, tail: 0, mark: 0, crest: 2, h1: 118, h2: 70 } },
  { id: 'common-light', name: 'ヒカリン', type: 'light', look: { body: 5, eyes: 2, horn: 1, wing: 2, tail: 0, mark: 3, crest: 3, h1: 50, h2: 20 } },
  { id: 'common-dark', name: 'ヨルノ', type: 'dark', look: { body: 1, eyes: 1, horn: 3, wing: 1, tail: 1, mark: 4, crest: 0, h1: 268, h2: 300 } },
  { id: 'common-king', name: 'オウサマ', type: 'king', look: { body: 3, eyes: 0, horn: 5, wing: 3, tail: 1, mark: 3, crest: 0, h1: 40, h2: 0 } },
];
// メスモンスターショップ: 毎朝 7 時に 6 体が並ぶ。先着順 (売り切れたら終わり)・1 人 1 日 1 体まで
const SHOP_LEVELS = [1, 1, 1, 1.16, 1.16, 1.34], SHOP_RANKS = ['B', 'B', 'B', 'A', 'A', 'S'], SHOP_OPEN_HOUR = 7;
const shopDay = (now = Date.now()) => new Date(now + (9 - SHOP_OPEN_HOUR) * 3600_000).toISOString().slice(0, 10);
const nextShopAt = (now = Date.now()) => Date.parse(shopDay(now) + `T0${SHOP_OPEN_HOUR}:00:00+09:00`) + 86400_000;
const SHOP_MIGRATION = `
CREATE TABLE mon_shop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, slot INTEGER NOT NULL,
  data TEXT NOT NULL,                          -- 売るモンスター (JSON)
  price INTEGER NOT NULL,
  buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, monster_id TEXT, bought_at INTEGER,
  UNIQUE (day, slot)
);
`;

// フォルダ (自分のモンスターを分けて整理する。モンスターの表は変えない)
const FOLDER_MIGRATION = `
CREATE TABLE IF NOT EXISTS mon_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mon_folders_user ON mon_folders(user_id, sort);
CREATE TABLE IF NOT EXISTS mon_folder_items (
  monster_id TEXT PRIMARY KEY,                 -- 1 体は 1 つのフォルダだけ (入っていなければ「未分類」)
  folder_id INTEGER NOT NULL REFERENCES mon_folders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS mon_folder_items_folder ON mon_folder_items(folder_id);
`;
const FOLDER_MAX = 20, FOLDER_NAME_MAX = 12;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-20-monster-breeders', MIGRATION);
  db.migrate('2026-11-20-monster-mutations', MUTATION_MIGRATION);
  db.migrate('2026-11-21-monster-folders', FOLDER_MIGRATION);
  // テスト中: 遊べるのはテスターだけ (環境変数 MON_TESTERS = カンマ区切りのユーザー名。未設定なら RCN413)。ほかの人には API もバトルも開かない
  const TESTERS = new Set(String(process.env.MON_TESTERS ?? 'RCN413').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  // 一般解放: 2026-11-20 8:25 (日本時間) からはログインしている全員が遊べる (環境変数 MON_OPEN_AT = ミリ秒の時刻で上書き)
  const OPEN_AT = Number(process.env.MON_OPEN_AT) || Date.parse('2026-11-20T08:25:00+09:00');
  const isTester = (u) => !!u && (Date.now() >= OPEN_AT || TESTERS.has('*') || TESTERS.has(String(u.username).toLowerCase()));
  app.get('/api/mon/access', (req, res) => res.json({ ok: isTester(req.user) }));
  app.use('/api/mon', (req, res, next) => (isTester(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: 'ブリードモンスターズはまだ準備中です' })));
  const coins = ctx.cbCoins;
  // ぶんぼうぐバトラーズにモンスターを連れていくための元 (自分のもの・売却していないもの)。絵はサーバーでも同じ mon-art.js で描く
  let MonArtSrv = null;
  try { const sb = { window: {} }; require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, 'public/games/monster/mon-art.js'), 'utf8'), sb); MonArtSrv = sb.window.MonArt; }
  catch (e) { console.error('[mon] 絵の読みこみに失敗', e.message); }
  ctx.monArtSvg = (look, type, rank) => MonArtSrv ? MonArtSrv.svg(look, type, { rank }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="264" ') : null;
  const writeLimit = rateLimit({ windowMs: 60_000, max: 90, key: (req) => 'mon' + req.user.id });
  const newId = () => crypto.randomBytes(6).toString('hex');
  const qMon = db.prepare('SELECT * FROM mon_monsters WHERE id = ?');
  const qMuts = db.prepare('SELECT mutation_id AS id, rarity, mode, origin, param FROM mon_mutations WHERE monster_id = ? ORDER BY created_at, mutation_id');
  const parse = (row) => {
    if (!row) return row;
    const m = { ...row, look: JSON.parse(row.look), skills: JSON.parse(row.skills), inherited: row.inherited ? JSON.parse(row.inherited) : null };
    m.base = { hp: row.hp, atk: row.atk, mag: row.mag, def: row.def, spd: row.spd }; // 配合で子に渡すのは、変異の分を入れない能力
    m.mutations = qMuts.all(row.id);
    if (m.mutations.length) { const e = MUT.effectsOf(m.mutations, m.type); Object.assign(m, MUT.applyStats(m.base, e.stat)); m.fx = e.fx; m.syn = e.syn; }
    return m;
  };
  const getMon = (id) => parse(qMon.get(String(id || '')));
  const userView = (id) => { if (!id) return { id: 0, username: '', displayName: 'IppO 公式', avatar: { kind: 'emoji', emoji: '🏛️', color: '#4b55f0' } }; const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, verified: u.verified, titles: u.titles || [] }; };
  const skillView = (id) => SKILLS[id] && { id, name: SKILLS[id].name, kind: SKILLS[id].kind, type: SKILLS[id].type, cmd: SKILLS[id].cmd, power: SKILLS[id].power };
  const parentBrief = (id) => { const p = getMon(id); return p ? { id: p.id, name: p.name, type: p.type, look: p.look, rank: rankOf(p), score: p.score, wins: p.wins, losses: p.losses, pvpWins: p.pvp_wins, pvpLosses: p.pvp_losses, owner: p.owner_id ? null : '公式' } : null; };
  const monView = (m, { full = false } = {}) => m && {
    id: m.id, name: m.name, sex: m.sex, type: m.type, gen: m.gen, look: m.look, status: m.status, trainLeft: m.train_left,
    hp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, skills: m.skills.map(skillView).filter(Boolean),
    score: m.score, wins: m.wins, losses: m.losses, pvpWins: m.pvp_wins, pvpLosses: m.pvp_losses, children: m.children, isStud: !!m.is_stud, studFee: m.stud_fee,
    listPrice: m.list_price, sellPrice: sellPrice(m), rank: rankOf(m), power: powerOf(m), inherited: m.inherited, ownerId: m.owner_id, createdAt: m.created_at,
    ...(m.mutations?.length ? { mutations: m.mutations.map((x) => MUT.viewOf(x, TYPES)).filter(Boolean), synergies: (m.syn || []).map((s) => ({ name: s.name, desc: s.desc })),
      mutantRarity: MUT.topRarity(m.mutations), look: { ...m.look, viz: MUT.vizOf(m.mutations) }, baseStats: m.base, initScore: m.init_score } : {}),
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
  for (const s of COMMON_STUDS) {
    if (qMon.get(s.id)) continue;
    const base = newMonster({ type: s.type, sex: 'm', level: 1.02 });
    insertMon({ ...base, name: s.name, look: s.look }, null, { id: s.id, status: 'breeding', isStud: true, fee: COMMON_STUD_FEE });
  }
  const isCommon = (id) => COMMON_STUDS.some((s) => s.id === id);
  const studReleased = (m, now = Date.now()) => { const s = OFFICIAL_STUDS.find((x) => x.id === m.id); return !s || now >= Date.parse(s.release); };
  const mine = (uid) => db.prepare("SELECT * FROM mon_monsters WHERE owner_id = ? AND status != 'sold' ORDER BY created_at").all(uid).map(parse);
  ctx.monCardSource = (uid) => mine(uid).map((m) => { const v = monView(m); return { id: m.id, name: m.name, type: m.type, rank: v.rank, look: v.look, hp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, status: m.status, mutant: v.mutantRarity || null }; });
  const owned = (uid, id) => { const m = getMon(id); return m && m.owner_id === uid && m.status !== 'sold' ? m : null; };

  // ---------- 状態 ----------
  app.get('/api/mon/catalog', (req, res) => res.json({
    types: TYPES, typeTable: Object.fromEntries(TYPE_IDS.map((a) => [a, Object.fromEntries(TYPE_IDS.map((d) => [d, typeMult(a, d)]))])),
    skills: Object.values(SKILLS).filter((s) => skillOk(s.id)).map((s) => skillView(s.id)), ranks: RANKS,
    rules: { maxChildren: MAX_CHILDREN, trainTurns: TRAIN_TURNS, inheritRate: INHERIT_RATE, studScore: STUD_SCORE, score: SCORE, coins: COINS, inputMs: INPUT_MS, maxSkills: MAX_SKILLS, extractCost: EXTRACT_COST, maxMutations: MUT.MAX_MUTATIONS }, guard: GUARD,
  }));
  app.get('/api/mon/me', requireAuth, (req, res) => {
    const uid = req.user.id, started = !!db.prepare('SELECT 1 FROM mon_players WHERE user_id = ?').get(uid);
    const where = folderMap(uid);
    res.json({ started, coins: coins.get(uid), monsters: mine(uid).map((m) => ({ ...monView(m), folderId: where.get(m.id) || 0 })), folders: foldersOf(uid), next: nextSlot() });
  });
  // ---------- フォルダ (自分だけが見る整理用。ほかの人には見えない) ----------
  const foldersOf = (uid) => db.prepare('SELECT id, name FROM mon_folders WHERE user_id = ? ORDER BY sort, id').all(uid);
  const folderMap = (uid) => new Map(db.prepare('SELECT monster_id, folder_id FROM mon_folder_items WHERE user_id = ?').all(uid).map((r) => [r.monster_id, r.folder_id]));
  const myFolder = (uid, id) => db.prepare('SELECT * FROM mon_folders WHERE id = ? AND user_id = ?').get(Number(id) || 0, uid);
  const folderName = (v) => String(v || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, FOLDER_NAME_MAX);
  const folderReply = (uid) => ({ folders: foldersOf(uid), where: Object.fromEntries(folderMap(uid)) });
  app.post('/api/mon/folders', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, name = folderName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'フォルダの名前を入れてください' });
    const n = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), 0) AS s FROM mon_folders WHERE user_id = ?').get(uid);
    if (n.n >= FOLDER_MAX) return res.status(400).json({ error: `フォルダは ${FOLDER_MAX} 個までです` });
    const r = db.prepare('INSERT INTO mon_folders (user_id, name, sort, created_at) VALUES (?, ?, ?, ?)').run(uid, name, n.s + 1, Date.now());
    res.json({ id: Number(r.lastInsertRowid), ...folderReply(uid) });
  });
  app.post('/api/mon/folders/:id/rename', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, f = myFolder(uid, req.params.id), name = folderName(req.body?.name);
    if (!f) return res.status(404).json({ error: 'そのフォルダはありません' });
    if (!name) return res.status(400).json({ error: 'フォルダの名前を入れてください' });
    db.prepare('UPDATE mon_folders SET name = ? WHERE id = ?').run(name, f.id);
    res.json(folderReply(uid));
  });
  app.post('/api/mon/folders/:id/delete', requireAuth, writeLimit, (req, res) => { // 中のモンスターは「未分類」にもどる (モンスターは消えない)
    const uid = req.user.id, f = myFolder(uid, req.params.id);
    if (!f) return res.status(404).json({ error: 'そのフォルダはありません' });
    db.prepare('DELETE FROM mon_folder_items WHERE folder_id = ?').run(f.id); db.prepare('DELETE FROM mon_folders WHERE id = ?').run(f.id);
    res.json(folderReply(uid));
  });
  // まとめて移す: { ids: [モンスター], folder: フォルダ (0 = 未分類) }
  app.post('/api/mon/folders/move', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 200) : [], fid = Number(req.body?.folder) || 0;
    if (!ids.length) return res.status(400).json({ error: 'モンスターをえらんでください' });
    if (fid && !myFolder(uid, fid)) return res.status(404).json({ error: 'そのフォルダはありません' });
    const okIds = ids.filter((id) => owned(uid, id));
    if (!okIds.length) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    db.exec('BEGIN');
    try {
      for (const id of okIds) { db.prepare('DELETE FROM mon_folder_items WHERE monster_id = ?').run(id); if (fid) db.prepare('INSERT INTO mon_folder_items (monster_id, folder_id, user_id) VALUES (?, ?, ?)').run(id, fid, uid); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ moved: okIds.length, ...folderReply(uid) });
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
  // 売却: コインに換える (セリ・バトル中は売れない。最後の 1 体は売れない)。種モンは種モンをやめる
  app.post('/api/mon/monster/:id/sell', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, m = owned(uid, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (['listed', 'auction'].includes(m.status)) return res.status(400).json({ error: 'セリに出しているモンスターは売れません (先に出品をやめてください)' });
    if ([...battleOf.values()].some((b) => !b.ended && b.monIds.includes(m.id))) return res.status(400).json({ error: 'バトル中のモンスターは売れません' });
    if (mine(uid).length <= 1) return res.status(400).json({ error: '最後の 1 体は売れません' });
    const price = sellPrice(m);
    db.exec('BEGIN');
    try {
      const r = db.prepare("UPDATE mon_monsters SET prev_status = status, status = 'sold', is_stud = 0 WHERE id = ? AND owner_id = ? AND status NOT IN ('listed', 'auction', 'sold')").run(m.id, uid);
      if (!r.changes) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'もう売れません' }); }
      coins.add(uid, price);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`[mon] @${req.user.username} が ${m.name} を ${price} コインで売却`);
    res.json({ price, coins: coins.get(uid) });
  });
  // 変異抽出装置 (1000 コイン): 自分のほかのモンスター (from) の変異 (mutation) を、このモンスターに写す。元のモンスターの変異はそのまま (コピー)。
  // 写した変異は元と同じレアリティ・同じ出方 (表 / 潜在)。1 体 4 つまで・同じ変異は 1 つだけ
  app.post('/api/mon/monster/:id/extract', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, to = owned(uid, req.params.id), from = owned(uid, String(req.body?.from || '')), mid = String(req.body?.mutation || '');
    if (!to || !from) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (to.id === from.id) return res.status(400).json({ error: '同じモンスターには写せません' });
    if (['listed', 'auction'].includes(to.status)) return res.status(400).json({ error: 'セリに出しているモンスターには写せません' });
    const src = (from.mutations || []).find((x) => x.id === mid);
    if (!src || !MUT.BY_ID[mid]) return res.status(400).json({ error: 'その変異は持っていません' });
    if ((to.mutations || []).some((x) => x.id === mid)) return res.status(400).json({ error: 'もうその変異を持っています' });
    if ((to.mutations || []).length >= MUT.MAX_MUTATIONS) return res.status(400).json({ error: `変異は 1 体 ${MUT.MAX_MUTATIONS} つまでです` });
    db.exec('BEGIN');
    try {
      if (!coins.spend(uid, EXTRACT_COST)) { db.exec('ROLLBACK'); return res.status(400).json({ error: `コインが足りません (${EXTRACT_COST} コイン)` }); }
      const now = Date.now();
      db.prepare('INSERT INTO mon_mutations (monster_id, mutation_id, rarity, mode, origin, param, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(to.id, mid, src.rarity, src.mode, 'extract', src.param || null, now);
      db.prepare('INSERT INTO mon_mutation_log (monster_id, event, mutation_id, rarity, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(to.id, 'extract', mid, src.rarity, JSON.stringify({ from: from.id, cost: EXTRACT_COST }), now);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`[mon] @${req.user.username} 変異抽出: ${from.id} の ${mid} → ${to.id}`);
    res.json({ monster: monView(getMon(to.id)), coins: coins.get(uid) });
  });
  app.post('/api/mon/monster/:id/retire', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (m.status !== 'active') return res.status(400).json({ error: m.status === 'training' ? '育成が終わってから繁殖入りできます' : 'このモンスターは繁殖入りできません' });
    db.prepare("UPDATE mon_monsters SET status = 'breeding' WHERE id = ?").run(m.id);
    res.json({ monster: monView(getMon(m.id)) });
  });
  app.post('/api/mon/monster/:id/stud', requireAuth, writeLimit, (req, res) => {
    const m = owned(req.user.id, req.params.id); if (!m) return res.status(404).json({ error: 'そのモンスターは持っていません' });
    if (m.sex !== 'm') return res.status(400).json({ error: '種モンになれるのはオスだけです' });
    if (m.score - (m.init_score || 0) < STUD_SCORE) return res.status(400).json({ error: `種モンになるには、対戦で上げた市場価値が ${STUD_SCORE} 以上必要です (いま ${m.score - (m.init_score || 0)})` });
    if (!['active', 'breeding'].includes(m.status)) return res.status(400).json({ error: 'このモンスターは種モンにできません' });
    const fee = clamp(Math.round(Number(req.body?.fee) || 0), 0, 100000);
    db.prepare("UPDATE mon_monsters SET status = 'breeding', is_stud = 1, stud_fee = ? WHERE id = ?").run(fee, m.id);
    res.json({ monster: monView(getMon(m.id)) });
  });
  app.get('/api/mon/studs', (req, res) => {
    const list = db.prepare("SELECT * FROM mon_monsters WHERE is_stud = 1 AND status = 'breeding' ORDER BY score DESC LIMIT 60").all().map(parse).filter((m) => studReleased(m));
    const common = db.prepare("SELECT * FROM mon_monsters WHERE id LIKE 'common-%'").all().map(parse);
    res.json({ studs: [...common, ...list.filter((m) => !isCommon(m.id))].map((m) => ({ ...monView(m), owner: userView(m.owner_id), official: !m.owner_id, common: isCommon(m.id) })) });
  });

  // ---------- メスモンスターショップ (先着順) ----------
  db.migrate('2026-11-20-monster-shop', SHOP_MIGRATION);
  function ensureShop(day) {
    if (db.prepare('SELECT 1 FROM mon_shop WHERE day = ? LIMIT 1').get(day)) return;
    db.exec('BEGIN');
    try {
      SHOP_LEVELS.forEach((lv, slot) => {
        const want = SHOP_RANKS[slot]; let m;
        for (let i = 0; i < 40; i++) { m = newMonster({ sex: 'f', level: lv }); if (rankOf(m) === want) break; } // B 3 体・A 2 体・S 1 体になるように
        const price = Math.max(50, Math.round((powerOf(m) * 0.6 * lv) / 10) * 10);
        db.prepare('INSERT OR IGNORE INTO mon_shop (day, slot, data, price) VALUES (?, ?, ?, ?)').run(day, slot, JSON.stringify(m), price);
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  app.get('/api/mon/shop', (req, res) => {
    const day = shopDay(); ensureShop(day);
    const rows = db.prepare('SELECT * FROM mon_shop WHERE day = ? ORDER BY slot').all(day);
    const bought = req.user ? rows.find((r) => r.buyer_id === req.user.id) : null;
    res.json({ day, next: nextShopAt(), bought: !!bought, items: rows.map((r) => {
      const m = JSON.parse(r.data);
      return { id: r.id, price: r.price, sold: !!r.buyer_id, mine: !!req.user && r.buyer_id === req.user.id, buyer: r.buyer_id ? userView(r.buyer_id) : null,
        monster: { name: m.name, sex: m.sex, type: m.type, gen: 0, look: m.look, hp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, skills: m.skills.map(skillView).filter(Boolean), rank: rankOf(m), power: powerOf(m) } };
    }) });
  });
  app.post('/api/mon/shop/:id/buy', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, day = shopDay(); ensureShop(day);
    const row = db.prepare('SELECT * FROM mon_shop WHERE id = ? AND day = ?').get(Number(req.params.id), day);
    if (!row) return res.status(404).json({ error: 'その商品は見つかりません (品ぞろえが入れかわったかも)' });
    if (row.buyer_id) return res.status(409).json({ error: 'ざんねん！ ひと足先に売り切れました' });
    if (db.prepare('SELECT 1 FROM mon_shop WHERE day = ? AND buyer_id = ?').get(day, uid)) return res.status(400).json({ error: '今日はもう 1 体買いました (明日の 7 時にまた並びます)' });
    if (db.prepare("SELECT COUNT(*) AS n FROM mon_monsters WHERE owner_id = ? AND status NOT IN ('breeding', 'sold')").get(uid).n >= MAX_MONSTERS) return res.status(400).json({ error: `持てるモンスターは ${MAX_MONSTERS} 体までです` });
    let id;
    db.exec('BEGIN');
    try {
      if (!coins.spend(uid, row.price)) throw Object.assign(new Error(`コインが足りません (${row.price} コイン)`), { user: 400 });
      // 先着順: まだだれも買っていないときだけ買える (同時に押しても 1 人だけ)
      if (!db.prepare('UPDATE mon_shop SET buyer_id = ?, bought_at = ? WHERE id = ? AND buyer_id IS NULL').run(uid, Date.now(), row.id).changes) throw Object.assign(new Error('ざんねん！ ひと足先に売り切れました'), { user: 409 });
      id = insertMon(JSON.parse(row.data), uid, { status: 'active' });
      db.prepare('UPDATE mon_shop SET monster_id = ? WHERE id = ?').run(id, row.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); if (e.user) return res.status(e.user).json({ error: e.message }); throw e; }
    console.log(`[mon] @${req.user.username} がショップでメスを買った (${row.price} コイン)`);
    res.json({ monster: monView(getMon(id)), coins: coins.get(uid) });
  });

  // ---------- 配合 ----------
  app.post('/api/mon/breed', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id;
    const mo = owned(uid, req.body?.mother), fa = getMon(req.body?.father);
    if (!mo || mo.sex !== 'f' || mo.status !== 'breeding') return res.status(400).json({ error: '母は、繁殖入りした自分のメスをえらんでください' });
    if (mo.children >= MAX_CHILDREN) return res.status(400).json({ error: `この母はもう ${MAX_CHILDREN} 体産みました` });
    if (!fa || fa.sex !== 'm' || fa.status !== 'breeding' || (fa.owner_id !== uid && !fa.is_stud) || !studReleased(fa)) return res.status(400).json({ error: '父は、繁殖入りした自分のオスか、種モンをえらんでください' });
    if (fa.id === mo.father_id || fa.id === mo.id) return res.status(400).json({ error: '親子では配合できません' });
    if (db.prepare("SELECT COUNT(*) AS n FROM mon_monsters WHERE owner_id = ? AND status NOT IN ('breeding', 'sold')").get(uid).n >= MAX_MONSTERS) return res.status(400).json({ error: `持てるモンスターは ${MAX_MONSTERS} 体までです (セリに出すか繁殖入りさせてください)` });
    const fee = fa.owner_id === uid ? 0 : fa.stud_fee;
    // 二重実行の防止: 同じリクエスト ID なら、さっき生まれた子を返す (コインもう一度は払わない)
    const reqId = String(req.body?.requestId || '').slice(0, 64);
    if (reqId) { const done = db.prepare('SELECT monster_id FROM mon_breed_requests WHERE user_id = ? AND request_id = ?').get(uid, reqId); if (done) return res.json({ child: monView(getMon(done.monster_id), { full: true }), fee: 0, coins: coins.get(uid), repeated: true }); }
    // 子を作る: 属性は父か母 (まれに別の属性)、能力は両親の平均 + ばらつき、技は両親のいちばん強い技を 70% ずつ
    const type = rnd() < 0.06 ? pick(TYPE_IDS) : rnd() < 0.5 ? fa.type : mo.type;
    const avg = (k) => Math.round(((fa.base[k] + mo.base[k]) / 2) * (0.94 + rnd() * 0.14)); // 変異の分は入れない (無限に強くならない)
    const inherited = [];
    for (const [who, p] of [['父', fa], ['母', mo]]) { const best = strongestSkill(p.skills); if (best && rnd() < INHERIT_RATE) inherited.push({ from: who, skill: best.id }); }
    const punches = Object.values(SKILLS).filter((s) => s.kind === 'punch' && s.cmd.length === 2).map((s) => s.id);
    const skills = [...new Set([pick(punches), ...inherited.map((x) => x.skill)])];
    if (!skills.some((id) => SKILLS[id].kind === 'ult')) skills.push(`ult_${type}`); // どのモンスターも大技を 1 つは持つ
    const child = { name: randomName(), sex: rnd() < 0.5 ? 'm' : 'f', type, gen: Math.max(fa.gen, mo.gen) + 1, father_id: fa.id, mother_id: mo.id, look: mixLook(fa.look, mo.look, type),
      hp: avg('hp'), atk: avg('atk'), mag: avg('mag'), def: avg('def'), spd: avg('spd'), skills, inherited };
    db.exec('BEGIN');
    let id, found = { newOnes: [], discoveries: [] };
    try {
      if (fee && !coins.spend(uid, fee)) throw Object.assign(new Error(`コインが足りません (種付け料 ${fee} コイン)`), { user: true });
      if (fee && fa.owner_id) coins.add(fa.owner_id, fee);
      if (!db.prepare('UPDATE mon_monsters SET children = children + 1 WHERE id = ? AND children < ?').run(mo.id, MAX_CHILDREN).changes) throw Object.assign(new Error('この母はもう産めません'), { user: true });
      id = insertMon(child, uid, { status: 'training', trainLeft: TRAIN_TURNS });
      if (reqId && !db.prepare('INSERT OR IGNORE INTO mon_breed_requests (user_id, request_id, monster_id, created_at) VALUES (?, ?, ?, ?)').run(uid, reqId, id, Date.now()).changes) throw Object.assign(new Error('この配合はもう処理しました'), { user: true });
      found = mutateChild(id, child, fa, mo, uid);     // 突然変異と遺伝 (同じトランザクションの中で)
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); if (e.user) return res.status(400).json({ error: e.message }); throw e; }
    console.log(`[mon] @${req.user.username} 配合 ${fa.name}×${mo.name} → ${child.name}${found.newOnes.length ? ` (突然変異 ${found.newOnes.length})` : ''}`);
    res.json({ child: monView(getMon(id), { full: true }), fee, coins: coins.get(uid), mutation: found.newOnes.length || found.discoveries.length ? { new: found.newOnes.map((x) => MUT.viewOf(x, TYPES)), discoveries: found.discoveries, title: found.title } : null });
  });

  // ---------- 突然変異 (配合のトランザクションの中で呼ぶ) ----------
  const lineageOf = (fa, mo) => { const brief = (p) => p && { id: p.id, name: p.name, gen: p.gen, father: p.father_id, mother: p.mother_id, mutations: (p.mutations || []).map((x) => ({ id: x.id, rarity: x.rarity, mode: x.mode })) }; return { father: brief(fa), mother: brief(mo), gen: Math.max(fa.gen, mo.gen) + 1 }; };
  function mutateChild(id, child, fa, mo, uid) {
    // テストのときだけ (MON_MUTATION_FORCE=1) 必ず突然変異させる。本番の確率は MUT.CONFIG (上限 2%)
    const r = MUT.rollChild(fa, mo, rnd, TYPE_IDS, process.env.MON_MUTATION_FORCE === '1' ? { ...MUT.CONFIG, base: 1, max: 1 } : MUT.CONFIG);
    const now = Date.now(), ins = db.prepare('INSERT OR IGNORE INTO mon_mutations (monster_id, mutation_id, rarity, mode, origin, param, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const x of r.list) ins.run(id, x.id, x.rarity, x.mode, x.origin, x.param || null, now);
    const lg = db.prepare('INSERT INTO mon_mutation_log (monster_id, event, mutation_id, rarity, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const e of r.log) lg.run(id, e.event, e.id, e.rarity || null, JSON.stringify({ ...e, chance: e.event === 'mutation' ? r.chance : undefined }), now);
    // 市場価値の初期値: R 以上の変異を (表に) 1 つでも持って生まれたら 1000 (生まれたときに 1 回だけ。サーバーで決める)
    const direct = r.list.filter((x) => x.mode === 'direct');
    if (direct.some((x) => MUT.rarityRank(x.rarity) >= MUT.rarityRank(MUT.CONFIG.initScoreMin))) db.prepare('UPDATE mon_monsters SET score = ?, init_score = ? WHERE id = ?').run(MUT.CONFIG.initScore, MUT.CONFIG.initScore, id);
    // 発見の記録: 変異 1 種類ごと (はじめて出たとき) と、新しい組み合わせ (表の変異 2 つ以上)
    const discoveries = [], lineage = JSON.stringify(lineageOf(fa, mo));
    const disc = db.prepare('INSERT OR IGNORE INTO mon_discoveries (key, kind, mutation_ids, rarity, user_id, monster_id, father_id, mother_id, lineage, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const x of r.newOnes) if (disc.run('m:' + x.id, 'mutation', JSON.stringify([x.id]), x.rarity, uid, id, fa.id, mo.id, lineage, now).changes) discoveries.push({ kind: 'mutation', name: MUT.BY_ID[x.id].name, cat: MUT.CATEGORIES[MUT.BY_ID[x.id].cat], rarity: x.rarity });
    const ck = MUT.comboKey(r.list);
    if (ck && disc.run('c:' + ck, 'combo', JSON.stringify(ck.split('+')), MUT.topRarity(r.list), uid, id, fa.id, mo.id, lineage, now).changes) discoveries.push({ kind: 'combo', name: ck.split('+').map((k) => MUT.BY_ID[k].name).join(' × ') });
    let title = null;
    if (discoveries.length) { // 発見者の称号 (はじめて発見したとき 1 回だけ)
      title = '🧬変異の第一発見者';
      try { db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title, source, granted_at) VALUES (?, ?, ?, ?)').run(uid, title, 'mon:discoverer', now); } catch {}
    }
    void child;
    return { newOnes: r.newOnes, discoveries, title };
  }
  // 血統書: 本人・両親・祖父母 (3 世代)。だれのモンスターでも見られる (公開の情報だけ)
  app.get('/api/mon/monster/:id/pedigree', (req, res) => {
    const node = (id, depth) => {
      const m = id && getMon(id); if (!m) return null;
      const v = monView(m);
      return { id: m.id, name: m.name, sex: m.sex, type: m.type, gen: m.gen, look: v.look, rank: v.rank, score: m.score, wins: m.wins, losses: m.losses, pvpWins: m.pvp_wins,
        mutantRarity: v.mutantRarity || null, mutations: (v.mutations || []).filter((x) => x.mode === 'direct').map((x) => ({ name: x.name, rarity: x.rarity })), official: !m.owner_id,
        ...(depth > 0 ? { father: node(m.father_id, depth - 1), mother: node(m.mother_id, depth - 1) } : {}) };
    };
    const root = node(req.params.id, 2); if (!root) return res.status(404).json({ error: 'そのモンスターは見つかりません' });
    const m = getMon(req.params.id);
    res.json({ pedigree: root, owner: userView(m.owner_id), skills: m.skills.map(skillView).filter(Boolean).map((s) => s.name) });
  });
  // 図鑑: 発見ずみの変異と組み合わせだけ (総数・未発見のものは出さない)
  app.get('/api/mon/dex', (req, res) => {
    const rows = db.prepare('SELECT * FROM mon_discoveries ORDER BY discovered_at').all();
    const mine = req.user ? new Set(db.prepare("SELECT DISTINCT mu.mutation_id AS id FROM mon_mutations mu JOIN mon_monsters m ON m.id = mu.monster_id WHERE m.owner_id = ?").all(req.user.id).map((x) => x.id)) : new Set();
    const item = (d) => { const ids = JSON.parse(d.mutation_ids); return { kind: d.kind, rarity: d.rarity, at: d.discovered_at, monsterId: d.monster_id, discoverer: d.user_id ? (userView(d.user_id) || { displayName: '退会したブリーダー' }) : null, lineage: JSON.parse(d.lineage),
      mutations: ids.map((k) => MUT.BY_ID[k] && { id: k, name: MUT.BY_ID[k].name, cat: MUT.BY_ID[k].cat, catName: MUT.CATEGORIES[MUT.BY_ID[k].cat], desc: MUT.BY_ID[k].desc, viz: MUT.BY_ID[k].viz }).filter(Boolean), owned: ids.every((k) => mine.has(k)) }; };
    res.json({ mutations: rows.filter((d) => d.kind === 'mutation').map(item), combos: rows.filter((d) => d.kind === 'combo').map(item) });
  });
  app.get('/api/mon/discoverers', (req, res) => {
    const rows = db.prepare('SELECT user_id, COUNT(*) AS n, SUM(kind = \'mutation\') AS muts, MIN(discovered_at) AS first FROM mon_discoveries WHERE user_id IS NOT NULL GROUP BY user_id ORDER BY n DESC, first LIMIT 30').all();
    res.json({ top: rows.map((r, i) => ({ rank: i + 1, user: userView(r.user_id) || { displayName: '退会したブリーダー' }, count: r.n, mutations: r.muts })) });
  });

  // ---------- ランキング (市場価値) ----------
  app.get('/api/mon/ranking', (req, res) => {
    const rows = db.prepare("SELECT * FROM mon_monsters WHERE owner_id IS NOT NULL AND status != 'sold' AND score > 0 AND wins + losses > 0 ORDER BY score DESC, pvp_wins DESC LIMIT 30").all().map(parse);
    res.json({ top: rows.map((m, i) => ({ rank: i + 1, monster: monView(m), owner: userView(m.owner_id) })) });
  });

  // ======================= セリ (15 分ごと: 毎時 5・20・35・50 分・リアルタイム) =======================
  // テストのときは MON_AUCTION_PERIOD_MS / MON_AUCTION_OFFSET_MS で間隔を変えられる
  const PERIOD = Number(process.env.MON_AUCTION_PERIOD_MS) || 15 * 60_000, OFFSET = Number(process.env.MON_AUCTION_OFFSET_MS) || 5 * 60_000;
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
  // 15 分ごと (毎時 5・20・35・50 分) にセリを始める
  let slotTimer = null;
  const armSlot = () => { clearTimeout(slotTimer); const at = nextSlot(); slotTimer = setTimeout(() => { if (!auction) startAuction(at); armSlot(); }, Math.max(100, at - Date.now())); slotTimer.unref?.(); };
  armSlot();

  // ======================= バトル (WebSocket /mb) =======================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const conns = new Map(); const battleOf = new Map();
  let queue = null; const rooms = new Map();
  const sendTo = (uid, msg) => { const ws = conns.get(uid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const boardText = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  const fighter = (m) => ({ id: m.id, name: m.name, type: m.type, sex: m.sex, look: m.mutations?.length ? { ...m.look, viz: MUT.vizOf(m.mutations) } : m.look, rank: rankOf(m), hp: m.hp, maxHp: m.hp, atk: m.atk, mag: m.mag, def: m.def, spd: m.spd, skills: [...m.skills], ...(m.fx ? { fx: m.fx } : {}) });
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
    b.cmds = [[], []];
    if (!b.uids[1]) b.cmds[1] = cpuCommands(b.state.mons[1], rnd, INPUT_MS);
    b.deadline = Date.now() + INPUT_MS;
    b.uids.forEach((u) => u && sendTo(u, { t: 'input', round: b.state.round + 1, deadline: b.deadline, ms: INPUT_MS, state: pub(b) }));
    clearTimeout(b.timer); b.timer = setTimeout(() => resolve(b), INPUT_MS + 400);
  }
  function resolve(b) {
    if (b.ended) return;
    clearTimeout(b.timer);
    const events = resolveRound(b.state, b.cmds);
    b.uids.forEach((u) => u && sendTo(u, { t: 'result', events, cmds: b.cmds, state: pub(b) }));
    // 画面で技の演出 (撃ちこむ・大技のビーム) が終わるまで待ってから次のラウンドへ
    const showMs = Math.max(SHOW_MS, events.reduce((t, e) => t + (e.k === 'skill' || e.k === 'blocked' ? (e.kind === 'ult' ? 4400 : e.kind === 'magic' ? 3100 : 2600) : e.k === 'guard' ? 1000 : e.k === 'miss' ? 1000 : e.k === 'ko' ? 1300 : 0), 700));
    if (b.state.winner !== null) { b.timer = setTimeout(() => finish(b, b.state.winner), showMs); return; }
    b.timer = setTimeout(() => nextRound(b), showMs);
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
    if (b && !b.ended) { const i = b.uids.indexOf(uid); clearTimeout(b.left[i]); b.left[i] = null; sendTo(uid, { t: 'start', mode: b.mode, you: i, players: b.players, state: pub(b), resumed: true }); if (b.deadline > Date.now()) sendTo(uid, { t: 'input', round: b.state.round + 1, deadline: b.deadline, ms: INPUT_MS, state: pub(b), queued: b.cmds[i] }); }
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
        // 入力時間のあいだは、確定しても続けて何個でも打てる (1 ラウンド 12 個まで)。時間になったらまとめて出す
        const i = bb.uids.indexOf(uid); if (Date.now() > bb.deadline + 300 || bb.cmds[i].length >= 12) return;
        const keys = String(m.keys || '').toUpperCase().replace(/[^UDLR]/g, '').slice(0, 16); if (!keys) return;
        bb.cmds[i].push(keys);
        sendTo(uid, { t: 'queued', n: bb.cmds[i].length });
        const o = bb.uids[1 - i]; if (o) sendTo(o, { t: 'opponentReady', n: bb.cmds[i].length });
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
    db.prepare('DELETE FROM mon_mutations WHERE monster_id IN (SELECT id FROM mon_monsters WHERE owner_id = ?)').run(uid);
    db.prepare('DELETE FROM mon_breed_requests WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM mon_monsters WHERE owner_id = ?').run(uid);
    db.prepare('DELETE FROM mon_players WHERE user_id = ?').run(uid);
    db.prepare('UPDATE mon_battles SET p1 = NULL WHERE p1 = ?').run(uid);
    db.prepare('UPDATE mon_battles SET p2 = NULL WHERE p2 = ?').run(uid);
  };
  // テスト用: セリをすぐ始める (MON_AUCTION_TEST=1 のときだけ)
  if (process.env.MON_AUCTION_TEST === '1') app.post('/api/mon/auction/test-start', (req, res) => { if (!auction) startAuction(Date.now()); res.json(auctionView()); });
};
Object.assign(module.exports, { GUARD, TYPES, typeMult, SKILLS, POWER, resolveRound, cpuCommand, cpuCommands, matchSkill, newMonster, mixLook, randomLook, powerOf, rankOf, strongestSkill, RANKS, INHERIT_RATE, MAX_CHILDREN, STUD_SCORE });
