// =====================================================================
// ミニゲーム「ぶんぼうぐバトラーズ」 (カード集め + オンライン対戦)
//
// ・ガチャ: ゲーム内のコインだけで引ける (お金では買えない)。排出率は画面に表示。80 回で SSR 確定 (天井)
//   コインは毎日のログインボーナスと対戦の報酬でもらえる
// ・対戦: 3 枚のデッキで戦う。お互いが同時に行動を選び、サーバーがまとめて判定する (端末の言うことは「選んだ行動」だけ)
//   CPU 戦 / ランダム対戦 (レート戦・ランキング) / 部屋コードで友だちと対戦
// ・乱数はすべてサーバー側 (crypto)。ガチャの結果は記録に残す
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---------- カード ----------
// 相性: きる > つつむ > おもい > きる (グー・チョキ・パーと同じ関係)
const TYPES = { cut: { name: 'きる', icon: '✂️' }, wrap: { name: 'つつむ', icon: '📄' }, heavy: { name: 'おもい', icon: '🪨' } };
const BEATS = { cut: 'wrap', wrap: 'heavy', heavy: 'cut' };
const SKILLS = {
  power: { name: 'フルパワー', desc: '1.8 倍のダメージ' },
  pierce: { name: 'つらぬく', desc: 'ガードと防御を無視して 1.3 倍のダメージ' },
  drain: { name: 'すいとる', desc: '1.2 倍のダメージ。与えたダメージの半分回復' },
  heal: { name: 'なおす', desc: '最大 HP の 45% 回復して、このターンのダメージを半分にする' },
  barrier: { name: 'バリア', desc: 'このターンのダメージを 0 にして、0.8 倍で反撃' },
  sweep: { name: 'しっぷうぎり', desc: '控えもふくめた相手の全員に、0.8 倍の無属性こうげき (疾風剣士ハサミ丸だけのわざ)' },
};
// レア度とレベルで強くなる: R +4% / SR +8% / SSR +12%、レベル 1 つにつき +2% (Lv5 で +8%)。
// この強さなら、はじめのデッキでも SSR のデッキに 1〜2 割は勝てる (作戦と相性で逆転できる) ことをシミュレーションで確かめた。
// カードの基本の強さは、同じレア度どうしの 1 対 1 で勝率がほぼ 50% になるよう調整してある
const RARITY = { N: { rate: 50, mult: 1.0 }, R: { rate: 35, mult: 1.04 }, SR: { rate: 12, mult: 1.08 }, SSR: { rate: 3, mult: 1.12 } };
const LEVEL_BONUS = 0.02;
// [id, 名前, 絵文字, レア度, 相性, HP, 攻撃, 防御, 素早さ, わざ]
const CARD_LIST = [
  ['pencil', 'えんぴつ見習い', '✏️', 'N', 'cut', 61, 16, 9, 12, 'power'],
  ['eraser', '消しゴムくん', '🧽', 'N', 'heavy', 70, 14, 12, 7, 'heal'],
  ['sticky', 'ふせんちゃん', '📝', 'N', 'wrap', 74, 18, 12, 14, 'drain'],
  ['clip', 'クリップ兵', '📎', 'N', 'cut', 61, 16, 10, 13, 'pierce'],
  ['glue', 'のりスライム', '🫧', 'N', 'wrap', 86, 18, 13, 8, 'heal'],
  ['pin', '画びょうニンジャ', '📌', 'N', 'cut', 49, 16, 7, 16, 'pierce'],
  ['band', '輪ゴムレンジャー', '➰', 'N', 'wrap', 70, 18, 9, 13, 'power'],
  ['weight', '文鎮じいさん', '🗿', 'N', 'heavy', 76, 14, 13, 4, 'barrier'],
  ['sharp', 'シャーペンナイト', '🖊️', 'R', 'cut', 57, 16, 9, 13, 'power'],
  ['ruler', '定規ランサー', '📏', 'R', 'cut', 53, 15, 9, 15, 'pierce'],
  ['note', 'ノートシールダー', '📓', 'R', 'wrap', 81, 15, 14, 8, 'barrier'],
  ['board', '下じきウォール', '🛡️', 'R', 'heavy', 77, 14, 14, 6, 'barrier'],
  ['marker', 'マーカーアーチャー', '🖍️', 'R', 'cut', 49, 15, 7, 16, 'power'],
  ['tape', 'セロテープ忍', '🎞️', 'R', 'wrap', 71, 18, 12, 15, 'drain'],
  ['protractor', '分度器メイジ', '📐', 'R', 'wrap', 74, 21, 11, 12, 'heal'],
  ['stapler', 'ホチキス番長', '🦖', 'R', 'heavy', 60, 14, 10, 7, 'power'],
  ['compass', 'コンパス魔術師', '🧭', 'SR', 'cut', 57, 16, 9, 14, 'drain'],
  ['fountain', '万年筆の騎士', '🖋️', 'SR', 'cut', 61, 18, 10, 12, 'pierce'],
  ['globe', '地球儀タイタン', '🌏', 'SR', 'heavy', 71, 14, 12, 5, 'heal'],
  ['dict', '辞書の賢者', '📚', 'SR', 'heavy', 59, 14, 10, 8, 'pierce'],
  ['leaf', 'ルーズリーフ天使', '🪽', 'SR', 'wrap', 75, 19, 12, 14, 'heal'],
  ['gold', '黄金えんぴつ王', '👑', 'SSR', 'cut', 52, 16, 9, 14, 'power'],
  ['chalk', '伝説の黒板竜', '🐉', 'SSR', 'heavy', 67, 14, 12, 7, 'drain'],
  ['case', '虹色ペンケース姫', '🌈', 'SSR', 'wrap', 63, 16, 11, 15, 'barrier'],
  ['scissors', '疾風剣士ハサミ丸', '✂️', 'SSR', 'cut', 50, 15, 8, 17, 'sweep'], // 2026-11-18 10:25 (日本時間) 登場
];
const CARDS = Object.fromEntries(CARD_LIST.map(([id, name, emoji, rarity, type, hp, atk, def, spd, skill]) => [id, { id, name, emoji, rarity, type, hp, atk, def, spd, skill }]));
const BY_RARITY = Object.fromEntries(Object.keys(RARITY).map((r) => [r, CARD_LIST.filter((c) => c[3] === r).map((c) => c[0])]));
// ---------- 新キャラの登場日時 (この時刻より前は、ガチャにも図鑑にも出さない。端末にも送らない) ----------
// テストのときは環境変数 CB_RELEASE_<ID> (ミリ秒の時刻) で上書きできる
const RELEASES = { scissors: Date.parse('2026-11-18T10:25:00+09:00') }; // 疾風剣士ハサミ丸: 2026 年 11 月 18 日 午前 10 時 25 分 (日本時間)
for (const id of Object.keys(RELEASES)) { const v = Number(process.env['CB_RELEASE_' + id.toUpperCase()]); if (Number.isFinite(v) && v > 0) RELEASES[id] = v; }
const NEW_DAYS = 7; // 登場から 7 日間は「新キャラ登場！」を出す
const isReleased = (id, now = Date.now()) => !RELEASES[id] || now >= RELEASES[id];
const releasedIds = (now = Date.now()) => CARD_LIST.map((c) => c[0]).filter((id) => isReleased(id, now));
const poolOf = (r, now = Date.now()) => BY_RARITY[r].filter((id) => isReleased(id, now));
const STARTER = ['pencil', 'eraser', 'sticky']; // はじめにもらえる 3 枚 (相性が 1 つずつ)
const MAX_LEVEL = 5;

// レベル (同じカードを引くと上がる) とレア度で強さが決まる
function statsOf(cardId, level = 1) {
  const c = CARDS[cardId], m = RARITY[c.rarity].mult * (1 + LEVEL_BONUS * (Math.min(level, MAX_LEVEL) - 1));
  return { id: c.id, name: c.name, emoji: c.emoji, rarity: c.rarity, type: c.type, skill: c.skill, level,
    maxHp: Math.round(c.hp * m), atk: Math.round(c.atk * m), def: Math.round(c.def * m), spd: c.spd };
}

// ---------- ガチャ ----------
const PULL_COST = 100, TEN_COST = 900, PITY = 80;
// ---------- 期間限定のガチャのセール (この期間だけ値段が変わる。終わると自動で元にもどる) ----------
// テストのときは環境変数 CB_SALE_START / CB_SALE_END (ミリ秒の時刻) で上書きできる
const SALES = [
  { name: '3日間限定セール', start: Date.parse('2026-11-17T16:45:00+09:00'), end: Date.parse('2026-11-20T16:45:00+09:00'), pull: 30, ten: 270 },
];
if (Number(process.env.CB_SALE_START) && Number(process.env.CB_SALE_END)) Object.assign(SALES[0], { start: Number(process.env.CB_SALE_START), end: Number(process.env.CB_SALE_END) });
function pricesNow(now = Date.now()) {
  const s = SALES.find((x) => now >= x.start && now < x.end);
  return s ? { pull: s.pull, ten: s.ten, sale: { name: s.name, end: s.end, pull: PULL_COST, ten: TEN_COST } } : { pull: PULL_COST, ten: TEN_COST, sale: null };
}
function rollRarity(rnd) {
  let u = rnd() * 100;
  for (const [r, v] of Object.entries(RARITY)) { u -= v.rate; if (u < 0) return r; }
  return 'N';
}
// n 回引く。pity は「最後に SSR が出てからの回数」。10 連の最後の 1 枚は SR 以上
function pull(n, pity, rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32, now = Date.now()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rollRarity(rnd);
    if (pity + 1 >= PITY) r = 'SSR';                                         // 天井
    else if (n === 10 && i === 9 && !out.some((x) => x.rarity === 'SR' || x.rarity === 'SSR') && (r === 'N' || r === 'R')) r = 'SR';
    pity = r === 'SSR' ? 0 : pity + 1;
    const list = poolOf(r, now); // まだ登場していないキャラは出ない
    out.push({ id: list[Math.floor(rnd() * list.length)], rarity: r });
  }
  return { cards: out, pity };
}

// ---------- 対戦の判定 (同じ入力なら同じ結果になる純粋な関数。乱数は外から渡す) ----------
const TURN_LIMIT = 30, SKILL_CD = 2; // わざを使うと、次の 2 ターンは使えない
function newSide(cards) { return { cards: cards.map((c) => ({ ...c, hp: c.maxHp, cd: 0 })), active: 0 }; }
const alive = (side) => side.cards.filter((c) => c.hp > 0).length;
function typeMult(a, d) { return BEATS[a] === d ? 1.5 : BEATS[d] === a ? 0.7 : 1; }
// 1 ターンを進める。acts[i] = { a: 'attack' | 'guard' | 'skill' | 'switch', i?: 番号 }
function resolveTurn(state, acts, rnd) {
  const ev = [];
  const sides = state.sides;
  const usedSkill = new Set();
  const act = [0, 1].map((p) => {
    const s = sides[p], a = acts[p] || { a: 'guard' };
    const me = s.cards[s.active];
    if (a.a === 'switch' && Number.isInteger(a.i) && a.i !== s.active && s.cards[a.i]?.hp > 0) return a;
    if (a.a === 'skill' && me.cd === 0) return a;
    if (a.a === 'attack' || a.a === 'skill') return { a: 'attack' };
    return { a: 'guard' };
  });
  // 1. 交代はいちばん先
  [0, 1].forEach((p) => { if (act[p].a === 'switch') { sides[p].active = act[p].i; ev.push({ k: 'switch', p, card: sides[p].cards[act[p].i].name }); } });
  // 2. ガード・バリア
  const skillOf = (p) => act[p].a === 'skill' ? sides[p].cards[sides[p].active].skill : null;
  const guard = [0, 1].map((p) => act[p].a === 'guard' ? 0.4 : skillOf(p) === 'barrier' ? 0 : skillOf(p) === 'heal' ? 0.5 : 1);
  // 3. 素早い順に行動 (同じなら乱数)
  const order = [0, 1].sort((x, y) => {
    const a = sides[x].cards[sides[x].active].spd, b = sides[y].cards[sides[y].active].spd;
    return b - a || (rnd() < 0.5 ? -1 : 1);
  });
  // opt.target: 相手の何枚目に当てるか (なければ場に出ているカード)。opt.typeless: 相性をかけない (無属性)
  const hit = (p, power, opt = {}) => {
    const me = sides[p].cards[sides[p].active], o = 1 - p;
    const ti = opt.target ?? sides[o].active, foe = sides[o].cards[ti], bench = ti !== sides[o].active;
    const tm = opt.typeless ? 1 : typeMult(me.type, foe.type);
    const base = opt.pierce ? me.atk * power * 2 : me.atk * power * 2 - foe.def * 0.6; // 1 枚あたり 3〜4 回の攻撃で倒れるくらい
    let dmg = Math.max(1, Math.round(base * tm * (0.9 + rnd() * 0.2)));
    const g = bench ? 1 : guard[o];                                   // ガード・バリアが守るのは場に出ているカードだけ
    if (!opt.pierce) dmg = Math.round(dmg * g);
    dmg = Math.min(dmg, foe.hp);
    foe.hp -= dmg;
    ev.push({ k: 'hit', p, card: me.name, target: foe.name, dmg, eff: tm > 1 ? 'good' : tm < 1 ? 'bad' : '', guarded: !opt.pierce && g < 1, bench, typeless: !!opt.typeless });
    if (foe.hp <= 0) ev.push({ k: 'ko', p: o, card: foe.name, bench });
    return dmg;
  };
  for (const p of order) {
    const s = sides[p], me = s.cards[s.active];
    if (me.hp <= 0 || act[p].a === 'switch' || act[p].a === 'guard') { if (act[p].a === 'guard' && me.hp > 0) ev.push({ k: 'guard', p, card: me.name }); continue; }
    if (act[p].a === 'attack') hit(p, 1);
    else {
      me.cd = SKILL_CD; usedSkill.add(me);
      ev.push({ k: 'skill', p, card: me.name, skill: SKILLS[me.skill].name });
      if (me.skill === 'power') hit(p, 1.8);
      else if (me.skill === 'pierce') hit(p, 1.3, { pierce: true });
      else if (me.skill === 'drain') { const d = hit(p, 1.2); const h = Math.min(me.maxHp - me.hp, Math.round(d / 2)); me.hp += h; if (h) ev.push({ k: 'heal', p, card: me.name, amount: h }); }
      else if (me.skill === 'heal') { const h = Math.min(me.maxHp - me.hp, Math.round(me.maxHp * 0.45)); me.hp += h; ev.push({ k: 'heal', p, card: me.name, amount: h }); }
      else if (me.skill === 'barrier') hit(p, 0.8);
      else if (me.skill === 'sweep') { const o = 1 - p; sides[o].cards.forEach((c, i) => { if (c.hp > 0) hit(p, 0.8, { target: i, typeless: true }); }); } // 控えもふくめた全員に
    }
  }
  // 4. わざの待ち時間を減らし、倒れたカードは次のカードに交代
  [0, 1].forEach((p) => {
    const s = sides[p];
    s.cards.forEach((c) => { if (c.cd > 0 && !usedSkill.has(c)) c.cd--; });
    if (s.cards[s.active].hp <= 0) { const next = s.cards.findIndex((c) => c.hp > 0); if (next >= 0) { s.active = next; ev.push({ k: 'switch', p, card: s.cards[next].name, forced: true }); } }
  });
  state.turn++;
  // 5. 勝ち負け
  const left = [alive(sides[0]), alive(sides[1])];
  if (!left[0] || !left[1]) state.winner = !left[0] && !left[1] ? -1 : left[0] ? 0 : 1;
  else if (state.turn >= TURN_LIMIT) {
    const pct = sides.map((s) => s.cards.reduce((a, c) => a + c.hp / c.maxHp, 0));
    state.winner = Math.abs(pct[0] - pct[1]) < 1e-9 ? -1 : pct[0] > pct[1] ? 0 : 1;
    ev.push({ k: 'timeup' });
  }
  return ev;
}
// CPU の行動: わざが使えれば使う (回復は HP が減っているときだけ)。相性が悪ければ時々交代
function cpuAct(state, p, rnd) {
  const s = state.sides[p], me = s.cards[s.active], foe = state.sides[1 - p].cards[state.sides[1 - p].active];
  if (me.cd === 0 && (me.skill !== 'heal' || me.hp < me.maxHp * 0.55) && rnd() < 0.8) return { a: 'skill' };
  if (typeMult(foe.type, me.type) > 1 && rnd() < 0.5) {
    const i = s.cards.findIndex((c, k) => k !== s.active && c.hp > c.maxHp * 0.4 && typeMult(c.type, foe.type) >= 1);
    if (i >= 0) return { a: 'switch', i };
  }
  return { a: rnd() < 0.8 ? 'attack' : 'guard' };
}

const MIGRATION = `
CREATE TABLE card_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  pity INTEGER NOT NULL DEFAULT 0,             -- 最後に SSR が出てからの回数
  deck TEXT NOT NULL,                          -- デッキ (カード ID 3 つの JSON)
  rating INTEGER NOT NULL DEFAULT 1000,        -- ランダム対戦のレート
  wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
  daily_day TEXT,                              -- ログインボーナスを受け取った日 (日本時間)
  reward_day TEXT, reward_count INTEGER NOT NULL DEFAULT 0,  -- その日に対戦の報酬を受け取った回数
  created_at INTEGER NOT NULL
);
CREATE TABLE card_owned (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,            -- 持っている枚数 (レベル = 枚数。最大 5)
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE card_pulls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL, rarity TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX card_pulls_user ON card_pulls(user_id, id);
CREATE TABLE card_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,                           -- cpu / random / room
  p1 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  p2 INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- CPU 戦は NULL
  winner INTEGER,                               -- 0 = p1, 1 = p2, -1 = 引き分け
  turns INTEGER NOT NULL, created_at INTEGER NOT NULL
);
`;

// 競走馬版から連れてきた馬のカード (1 日 1 頭まで・同じ馬は 1 回だけ)。能力・わざ・相性は連れてきたときにサーバーが決めて保存する
const HORSE_MIGRATION = `
CREATE TABLE card_horses (
  id TEXT PRIMARY KEY,                                   -- カードの ID は 'h:' + この値
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,                                 -- 競走馬版の馬 (サーバーの種の記録)
  name TEXT NOT NULL, coat TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',   -- 馬の名前・毛色・成績 (表示用)
  type TEXT NOT NULL, skill TEXT NOT NULL,
  hp INTEGER NOT NULL, atk INTEGER NOT NULL, def INTEGER NOT NULL, spd INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, seed_id)
);
CREATE INDEX card_horses_user ON card_horses(user_id, created_at);
`;
// SSR の文房具の平均を基準に、それぞれ ±12% でランダム (SSR と同じ +12% もつく)
function rollHorse(rnd) {
  const ssr = ['gold', 'chalk', 'case'].map((id) => CARDS[id]);
  const avg = (k) => ssr.reduce((a, c) => a + c[k], 0) / ssr.length;
  const r = (k) => avg(k) * (0.88 + rnd() * 0.24);
  const types = Object.keys(TYPES), skills = Object.keys(SKILLS);
  return { type: types[Math.floor(rnd() * types.length)], skill: skills[Math.floor(rnd() * skills.length)],
    hp: Math.round(r('hp')), atk: Math.round(r('atk')), def: Math.round(r('def')), spd: Math.max(3, Math.round(avg('spd') * (0.7 + rnd() * 0.6))) };
}
// 連れてきた馬が UR に昇格する確率 (競走馬版でのランクが高いほど高い)。UR は能力 +20% (SSR は +12%)
const HORSE_UR_CHANCE = { UR: 0.15, SSR: 0.08, SR: 0.04, R: 0.02, N: 0.01 };
const UR_MULT = 1.2;
const HORSE_UR_MIGRATION = `ALTER TABLE card_horses ADD COLUMN rarity TEXT NOT NULL DEFAULT 'SSR';`; // 'SSR' か 'UR'
const START_COINS = 1000, DAILY_COINS = 300;
const REWARD = { cpu: { win: 30, lose: 10 }, random: { win: 100, lose: 30 }, room: { win: 50, lose: 20 } };
const REWARDS_PER_DAY = 15;
const TURN_MS = Number(process.env.CB_TURN_MS || 25_000);
const RECONNECT_MS = Number(process.env.CB_RECONNECT_MS || 30_000);
const jstDay = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);

function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-20-card-battlers', MIGRATION);
  db.migrate('2026-11-22-card-horses', HORSE_MIGRATION);
  db.migrate('2026-11-23-card-horses-ur', HORSE_UR_MIGRATION);
  const qHorse = db.prepare('SELECT * FROM card_horses WHERE id = ?');
  const horsesOwned = (uid) => db.prepare('SELECT * FROM card_horses WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  // 馬のカードの能力 (文房具の statsOf と同じ形)
  const horseStats = (h) => { const ur = h.rarity === 'UR', m = ur ? UR_MULT : RARITY.SSR.mult; return { id: 'h:' + h.id, name: h.name, emoji: '🐴', rarity: ur ? 'UR' : 'SSR', type: h.type, skill: h.skill, level: 1, horse: true, coat: h.coat, origin: h.origin,
    maxHp: Math.round(h.hp * m), atk: Math.round(h.atk * m), def: Math.round(h.def * m), spd: h.spd, skillName: SKILLS[h.skill].name, skillDesc: SKILLS[h.skill].desc }; };
  const cardStats = (uid, id, o) => {
    if (id.startsWith('h:')) { const h = qHorse.get(id.slice(2)); return h && h.user_id === uid ? horseStats(h) : null; }
    return CARDS[id] ? statsOf(id, Math.min(o[id] || 1, MAX_LEVEL)) : null;
  };
  const dayStart = () => { const d = new Date(Date.now() + 9 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 9 * 3600_000; };
  const horseToday = (uid) => db.prepare('SELECT COUNT(*) AS n FROM card_horses WHERE user_id = ? AND created_at >= ?').get(uid, dayStart()).n > 0;
  const userView = (id) => { const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, isAdmin: u.isAdmin, verified: u.verified }; };

  // はじめて遊ぶ人には、コインとはじめの 3 枚を渡す
  const qPlayer = db.prepare('SELECT * FROM card_players WHERE user_id = ?');
  function player(uid) {
    let p = qPlayer.get(uid);
    if (!p) {
      db.prepare('INSERT INTO card_players (user_id, coins, deck, created_at) VALUES (?, ?, ?, ?)').run(uid, START_COINS, JSON.stringify(STARTER), Date.now());
      for (const c of STARTER) db.prepare('INSERT OR IGNORE INTO card_owned (user_id, card_id, count) VALUES (?, ?, 1)').run(uid, c);
      p = qPlayer.get(uid);
    }
    return p;
  }
  const owned = (uid) => Object.fromEntries(db.prepare('SELECT card_id, count FROM card_owned WHERE user_id = ?').all(uid).map((r) => [r.card_id, r.count]));
  const deckStats = (uid) => { const p = player(uid), o = owned(uid); return JSON.parse(p.deck).map((id) => cardStats(uid, id, o) || statsOf(STARTER[0], 1)); };
  function me(uid) {
    const p = player(uid), o = owned(uid);
    return { coins: p.coins, pity: p.pity, deck: JSON.parse(p.deck), owned: o, horses: horsesOwned(uid).map(horseStats), horseReady: !horseToday(uid),
      rating: p.rating, wins: p.wins, losses: p.losses, draws: p.draws,
      prices: pricesNow(), dailyReady: p.daily_day !== jstDay(), rewardsLeft: REWARDS_PER_DAY - (p.reward_day === jstDay() ? p.reward_count : 0) };
  }

  // カードの一覧・排出率 (誰でも見られる)
  app.get('/api/cards/catalog', (req, res) => res.json({
    cards: releasedIds().map((id) => ({ ...statsOf(id, 1), skillName: SKILLS[CARDS[id].skill].name, skillDesc: SKILLS[CARDS[id].skill].desc })),
    newCards: releasedIds().filter((id) => RELEASES[id] && Date.now() - RELEASES[id] < NEW_DAYS * 86400_000),
    rates: Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, v.rate])), types: TYPES, beats: BEATS,
    pullCost: pricesNow().pull, tenCost: pricesNow().ten, sale: pricesNow().sale, pity: PITY, urBonus: Math.round((UR_MULT - 1) * 100), horseUrChance: HORSE_UR_CHANCE, levelBonus: LEVEL_BONUS, rarityBonus: Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, Math.round((v.mult - 1) * 100)])), dailyCoins: DAILY_COINS, maxLevel: MAX_LEVEL, reward: REWARD, rewardsPerDay: REWARDS_PER_DAY,
  }));
  app.get('/api/cards/me', requireAuth, (req, res) => res.json(me(req.user.id)));

  // ログインボーナス (1 日 1 回)
  const writeLimit = rateLimit({ windowMs: 60_000, max: 60, key: (req) => 'cb' + req.user.id });
  app.post('/api/cards/daily', requireAuth, writeLimit, (req, res) => {
    player(req.user.id);
    const r = db.prepare('UPDATE card_players SET coins = coins + ?, daily_day = ? WHERE user_id = ? AND (daily_day IS NULL OR daily_day != ?)').run(DAILY_COINS, jstDay(), req.user.id, jstDay());
    if (!r.changes) return res.status(409).json({ error: '今日のボーナスはもう受け取りました。また明日！' });
    res.json({ got: DAILY_COINS, ...me(req.user.id) });
  });

  // ガチャ (1 回 / 10 回)。コインの引き落とし・抽選・記録を 1 つのトランザクションで
  app.post('/api/cards/gacha', requireAuth, writeLimit, (req, res) => {
    const n = req.body?.n === 10 ? 10 : req.body?.n === 1 ? 1 : 0;
    if (!n) return res.status(400).json({ error: '回数が正しくありません' });
    const price = pricesNow(), cost = n === 10 ? price.ten : price.pull; // セール中はセールの値段 (サーバーの時刻で決める)
    const p = player(req.user.id);
    if (p.coins < cost) return res.status(400).json({ error: `コインが足りません (あと ${cost - p.coins} コイン)` });
    const before = owned(req.user.id);
    const r = pull(n, p.pity);
    db.exec('BEGIN');
    try {
      const u = db.prepare('UPDATE card_players SET coins = coins - ?, pity = ? WHERE user_id = ? AND coins >= ?').run(cost, r.pity, req.user.id, cost);
      if (!u.changes) throw new Error('coins');
      const now = Date.now();
      for (const c of r.cards) {
        db.prepare('INSERT INTO card_owned (user_id, card_id, count) VALUES (?, ?, 1) ON CONFLICT(user_id, card_id) DO UPDATE SET count = count + 1').run(req.user.id, c.id);
        db.prepare('INSERT INTO card_pulls (user_id, card_id, rarity, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, c.id, c.rarity, now);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'コインが足りません' }); }
    const seen = { ...before };
    const results = r.cards.map((c) => { const prev = seen[c.id] || 0; seen[c.id] = prev + 1; return { ...statsOf(c.id, Math.min(prev + 1, MAX_LEVEL)), isNew: prev === 0, levelUp: prev > 0 && prev < MAX_LEVEL }; });
    console.log(`[cards] @${req.user.username} ガチャ ${n} 回: ${r.cards.map((c) => c.rarity).join(',')}`);
    res.json({ results, ...me(req.user.id) });
  });

  // ---------- 競走馬版から馬を連れてくる (1 日 1 頭) ----------
  app.get('/api/cards/horse-candidates', requireAuth, (req, res) => {
    const have = new Set(horsesOwned(req.user.id).map((h) => h.seed_id));
    const list = (ctx.raceHorsesOf ? ctx.raceHorsesOf(req.user.id) : []).filter((h) => !have.has(h.sid))
      .map((h) => ({ sid: h.sid, name: h.name, label: h.label, headline: h.headline, breed: h.breed, coat: h.coat, urChance: HORSE_UR_CHANCE[h.label] ?? 0.01 }));
    res.json({ ready: !horseToday(req.user.id), horses: list });
  });
  app.post('/api/cards/horse', requireAuth, writeLimit, (req, res) => {
    const sid = String(req.body?.sid || '');
    player(req.user.id);
    if (horseToday(req.user.id)) return res.status(429).json({ error: '今日はもう馬を連れてきました。また明日！' });
    const h = (ctx.raceHorsesOf ? ctx.raceHorsesOf(req.user.id) : []).find((x) => x.sid === sid);
    if (!h) return res.status(404).json({ error: 'その馬は連れてこられません' });
    const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
    const r = rollHorse(rand);
    const scale = Number(process.env.CB_HORSE_UR_SCALE) || 1; // テスト用 (本番では使わない): 昇格の確率を何倍にするか
    const promoted = rand() < Math.min(1, (HORSE_UR_CHANCE[h.label] ?? 0.01) * scale); // まれに UR に昇格
    const id = crypto.randomBytes(9).toString('base64url');
    try {
      db.prepare(`INSERT INTO card_horses (id, user_id, seed_id, name, coat, origin, type, skill, hp, atk, def, spd, rarity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, req.user.id, sid, h.name, h.coat || '', `${h.label} ${h.headline}`, r.type, r.skill, r.hp, r.atk, r.def, r.spd, promoted ? 'UR' : 'SSR', Date.now());
    } catch { return res.status(409).json({ error: 'この馬はもう連れてきています' }); }
    console.log(`[cards] @${req.user.username} が馬「${h.name}」を連れてきた${promoted ? ' (UR に昇格)' : ''}`);
    res.json({ card: horseStats(qHorse.get(id)), promoted, ...me(req.user.id) });
  });

  // デッキ (持っているカード 3 枚。同じカードは 1 枚まで)
  app.put('/api/cards/deck', requireAuth, writeLimit, (req, res) => {
    const d = req.body?.deck, o = owned(req.user.id);
    if (!Array.isArray(d) || d.length !== 3 || new Set(d).size !== 3 || !d.every((id) => typeof id === 'string' && (id.startsWith('h:') ? !!cardStats(req.user.id, id, o) : o[id]))) return res.status(400).json({ error: '持っているカードを、ちがうもの 3 枚えらんでください' });
    db.prepare('UPDATE card_players SET deck = ? WHERE user_id = ?').run(JSON.stringify(d), req.user.id);
    res.json(me(req.user.id));
  });

  // レートのランキング (ランダム対戦を 1 回以上した人)
  app.get('/api/cards/ranking', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const rows = db.prepare('SELECT user_id, rating, wins, losses, draws FROM card_players WHERE wins + losses + draws > 0 ORDER BY rating DESC, wins DESC LIMIT 50').all();
    let rank = 0, last = null;
    const top = rows.map((r, i) => { if (r.rating !== last) { rank = i + 1; last = r.rating; } return { rank, rating: r.rating, wins: r.wins, losses: r.losses, draws: r.draws, user: userView(r.user_id) }; }).filter((x) => x.user);
    let mine = null;
    if (req.user) {
      const p = qPlayer.get(req.user.id);
      if (p && p.wins + p.losses + p.draws > 0) mine = { rank: db.prepare('SELECT COUNT(*) AS n FROM card_players WHERE wins + losses + draws > 0 AND rating > ?').get(p.rating).n + 1, rating: p.rating, wins: p.wins, losses: p.losses, draws: p.draws, user: userView(req.user.id) };
    }
    res.json({ top, me: mine });
  });

  // ======================= 対戦 (WebSocket /cb) =======================
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const conns = new Map();     // userId → ws
  const battleOf = new Map();  // userId → battle
  let queue = null;            // ランダム対戦の待ち (1 人)
  const rooms = new Map();     // 部屋コード → { uid, at }
  const send = (uid, msg) => { const ws = conns.get(uid); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

  const publicState = (b) => ({ turn: b.state.turn, sides: b.state.sides.map((s) => ({ active: s.active, cards: s.cards.map((c) => ({ ...c })) })) });
  function startBattle(mode, uids) {
    const b = { id: crypto.randomBytes(8).toString('hex'), mode, uids, acts: [null, null], timer: null, deadline: 0, left: [null, null], ended: false,
      players: uids.map((u) => (u ? userView(u) : { id: 0, username: 'cpu', displayName: 'CPU', avatar: { kind: 'emoji', emoji: '🤖', color: '#64748b' } })),
      state: { turn: 0, winner: null, sides: uids.map((u) => newSide(u ? deckStats(u) : cpuDeck(uids[0]))) } };
    uids.forEach((u, i) => { if (u) { battleOf.set(u, b); send(u, { t: 'start', mode, you: i, players: b.players, state: publicState(b) }); } });
    nextTurn(b);
    return b;
  }
  // CPU のデッキ: 相手と同じくらいの強さ (同じレア度の、ちがうカード)
  function cpuDeck(uid) {
    const mine = deckStats(uid);
    return mine.map((c) => { const pool = poolOf(c.rarity === 'UR' ? 'SSR' : c.rarity).filter((id) => !mine.some((m) => m.id === id)); return statsOf(pool[Math.floor(rnd() * pool.length)] || (CARDS[c.id] ? c.id : 'gold'), c.level); });
  }
  function nextTurn(b) {
    if (b.ended) return;
    b.acts = [null, null];
    if (!b.uids[1]) b.acts[1] = cpuAct(b.state, 1, rnd);
    b.deadline = Date.now() + TURN_MS;
    b.uids.forEach((u) => u && send(u, { t: 'turn', turn: b.state.turn + 1, deadline: b.deadline, ms: TURN_MS, state: publicState(b) }));
    clearTimeout(b.timer);
    b.timer = setTimeout(() => resolve(b), TURN_MS + 300); // 時間切れはガード
  }
  function resolve(b) {
    if (b.ended) return;
    clearTimeout(b.timer);
    const events = resolveTurn(b.state, b.acts, rnd);
    b.uids.forEach((u) => u && send(u, { t: 'result', events, state: publicState(b) }));
    if (b.state.winner !== null) return finish(b, b.state.winner);
    nextTurn(b);
  }
  function act(uid, msg) {
    const b = battleOf.get(uid); if (!b || b.ended) return;
    const p = b.uids.indexOf(uid);
    if (b.acts[p]) return; // 1 ターンに 1 回だけ
    const a = ['attack', 'guard', 'skill', 'switch'].includes(msg.a) ? { a: msg.a, i: Number.isInteger(msg.i) ? msg.i : undefined } : { a: 'guard' };
    b.acts[p] = a;
    const o = 1 - p; if (b.uids[o]) send(b.uids[o], { t: 'opponentReady' });
    if (b.acts[0] && b.acts[1]) resolve(b);
  }
  function finish(b, winner, reason = '') {
    if (b.ended) return;
    b.ended = true; clearTimeout(b.timer); b.left.forEach((t) => clearTimeout(t));
    db.prepare('INSERT INTO card_battles (mode, p1, p2, winner, turns, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(b.mode, b.uids[0], b.uids[1] || null, winner, b.state.turn, Date.now());
    // レート (ランダム対戦だけ)
    let delta = [0, 0];
    if (b.mode === 'random') {
      const r = b.uids.map((u) => player(u).rating), e0 = 1 / (1 + 10 ** ((r[1] - r[0]) / 400));
      const s0 = winner === 0 ? 1 : winner === 1 ? 0 : 0.5, d = Math.round(32 * (s0 - e0));
      delta = [d, -d];
    }
    const today = jstDay();
    b.uids.forEach((u, i) => {
      if (!u) return;
      const p = player(u), res = winner === -1 ? 'draw' : winner === i ? 'win' : 'lose';
      const count = p.reward_day === today ? p.reward_count : 0;
      const capped = b.mode !== 'cpu'; // CPU 戦 (AI 戦) の報酬は回数制限なし
      const coins = !capped || count < REWARDS_PER_DAY ? REWARD[b.mode][res === 'win' ? 'win' : 'lose'] : 0;
      db.prepare(`UPDATE card_players SET coins = coins + ?, rating = rating + ?, reward_day = ?, reward_count = ?,
        wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE user_id = ?`).run(coins, delta[i], today, count + (capped && coins ? 1 : 0),
        b.mode === 'random' && res === 'win' ? 1 : 0, b.mode === 'random' && res === 'lose' ? 1 : 0, b.mode === 'random' && res === 'draw' ? 1 : 0, u);
      battleOf.delete(u);
      send(u, { t: 'end', result: res, reason, coins, rating: b.mode === 'random' ? { delta: delta[i], now: player(u).rating } : null, state: publicState(b) });
    });
  }
  function leave(uid) {
    if (queue === uid) queue = null;
    for (const [code, r] of rooms) if (r.uid === uid) rooms.delete(code);
  }
  wss.on('connection', (ws, req, user) => {
    const uid = user.id;
    const old = conns.get(uid); if (old && old !== ws) { try { old.close(4000, 'replaced'); } catch {} }
    conns.set(uid, ws);
    // 対戦の途中でつなぎ直したら、続きから
    const b = battleOf.get(uid);
    if (b && !b.ended) {
      const p = b.uids.indexOf(uid);
      clearTimeout(b.left[p]); b.left[p] = null;
      send(uid, { t: 'start', mode: b.mode, you: p, players: b.players, state: publicState(b), resumed: true });
      send(uid, { t: 'turn', turn: b.state.turn + 1, deadline: b.deadline, ms: TURN_MS, state: publicState(b), chosen: !!b.acts[p] });
      const o = b.uids[1 - p]; if (o) send(o, { t: 'opponentBack' });
    }
    let hits = 0; const iv = setInterval(() => { hits = 0; }, 1000);
    ws.on('message', (raw) => {
      if (++hits > 20) return; // 1 秒に 20 回まで
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'act') return act(uid, m);
      if (m.t === 'find') {
        if (battleOf.get(uid)) return;
        leave(uid);
        if (m.mode === 'cpu') return startBattle('cpu', [uid, null]);
        if (m.mode === 'random') {
          if (queue && queue !== uid && conns.get(queue)?.readyState === 1 && !battleOf.get(queue)) { const o = queue; queue = null; return startBattle('random', [o, uid]); }
          queue = uid; return send(uid, { t: 'waiting', mode: 'random' });
        }
        if (m.mode === 'room-create') {
          let code; do { code = String(crypto.randomInt(1000, 10000)); } while (rooms.has(code));
          rooms.set(code, { uid, at: Date.now() });
          return send(uid, { t: 'waiting', mode: 'room', code });
        }
        if (m.mode === 'room-join') {
          const code = String(m.code || ''), r = rooms.get(code);
          if (!r || Date.now() - r.at > 10 * 60_000 || conns.get(r.uid)?.readyState !== 1) { rooms.delete(code); return send(uid, { t: 'error', msg: 'その部屋コードは見つかりません' }); }
          if (r.uid === uid) return send(uid, { t: 'error', msg: '自分の部屋には入れません' });
          rooms.delete(code); return startBattle('room', [r.uid, uid]);
        }
      }
      if (m.t === 'cancel') { leave(uid); return send(uid, { t: 'cancelled' }); }
      if (m.t === 'surrender') { const bb = battleOf.get(uid); if (bb) finish(bb, 1 - bb.uids.indexOf(uid), 'surrender'); }
    });
    ws.on('close', () => {
      clearInterval(iv);
      if (conns.get(uid) !== ws) return;
      conns.delete(uid); leave(uid);
      const bb = battleOf.get(uid);
      if (bb && !bb.ended) {
        const p = bb.uids.indexOf(uid), o = bb.uids[1 - p];
        if (!o) return finish(bb, 1, 'left'); // CPU 戦は抜けたら負け
        send(o, { t: 'opponentLeft', ms: RECONNECT_MS });
        bb.left[p] = setTimeout(() => finish(bb, 1 - p, 'left'), RECONNECT_MS); // 戻ってこなければ相手の勝ち
      }
    });
  });
  ctx.cardsUpgrade = (req, socket, head, user) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));

  ctx.eraseCards = (uid) => {
    leave(uid);
    const b = battleOf.get(uid); if (b && !b.ended) finish(b, 1 - b.uids.indexOf(uid), 'left');
    for (const t of ['card_players', 'card_owned', 'card_pulls', 'card_horses']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
    db.prepare('UPDATE card_battles SET p1 = NULL WHERE p1 = ?').run(uid);
    db.prepare('UPDATE card_battles SET p2 = NULL WHERE p2 = ?').run(uid);
  };
}
module.exports = install;
Object.assign(module.exports, { CARDS, CARD_LIST, statsOf, pull, resolveTurn, newSide, cpuAct, typeMult, RARITY, PITY, RELEASES, isReleased });
