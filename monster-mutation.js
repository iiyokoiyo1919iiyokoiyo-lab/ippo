// =====================================================================
// ブリードモンスターズ: 突然変異 (データと計算。DB には触らない純粋な関数だけ)
//
// ・変異は MUTATIONS に足していけば増やせる (id は変えない)。分類は 外見 / 能力 / 構造 / 種族
// ・1 体に最大 4 つ (直接に出ている変異 + 潜在の変異の合計)。変異ごとにレアリティ (N〜MR) を持つ
// ・能力は「方向性」で変わる (攻撃特化・魔法特化・高速型・特殊型…)。全部が一律に強くなる変異は作らない
// ・能力の変化は保存した能力値に足さず、表示とバトルのときに計算する → 世代を重ねても無限に強くならない
// ・確率は MUTATION_CONFIG。環境変数 MON_MUTATION_CONFIG (JSON) で上書きできる (クライアントからは変えられない)
// ・このファイルの中身 (変異の一覧) は、画面には送らない。送るのは、その個体が持っている変異と、発見ずみの変異だけ
// =====================================================================
const CATEGORIES = { look: '外見変異', stat: '能力変異', body: '構造変異', species: '種族変異' };
const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR', 'MR'];
const RARITY_SCALE = { N: 1, R: 1.15, SR: 1.3, SSR: 1.5, UR: 1.75, MR: 2 }; // レアリティが高いほど、良い効果が大きい (悪い効果はそのまま)

// stat: 能力への影響 (割合)。fx: バトルの効果 (punch/magic/ult = 与えるダメージ倍率、taken = 受けるダメージ倍率、type2 = 直殴りに 2 つ目の属性)
// viz: 見た目 (絵の部品の名前だけ。変異の名前は画面の絵のコードに入れない)
const MUTATIONS = [
  // 外見変異: 見た目が大きく変わる。能力の変化は小さめ
  { id: 'gem_skin', cat: 'look', name: '宝石肌', desc: '体の表面が宝石のように硬く光る', stat: { def: 0.12 }, viz: { pattern: 'crystal' } },
  { id: 'aurora', cat: 'look', name: '極光の毛並み', desc: 'オーロラ色にゆらめく体', stat: { mag: 0.1, spd: 0.05 }, viz: { aura: 'rainbow' } },
  { id: 'shadow_twin', cat: 'look', name: '影写し', desc: '背後にもう 1 体の影がよりそう', stat: { spd: 0.12, hp: -0.05 }, viz: { twin: true } },
  { id: 'third_eye', cat: 'look', name: '第三の眼', desc: '額にひらく第三の目。魔法の狙いがするどい', stat: {}, fx: { magic: 1.08 }, viz: { eye3: true } },
  { id: 'starry', cat: 'look', name: '星屑模様', desc: '夜空を写したような星の模様', stat: { mag: 0.08 }, viz: { pattern: 'stars' } },
  { id: 'albino', cat: 'look', name: '白化', desc: '雪のように白い体。生命力が強い', stat: { hp: 0.08 }, viz: { tint: 'white' } },
  // 能力変異: 方向性がはっきりした強さ。得意をのばす代わりに、どこかが下がる
  { id: 'berserker', cat: 'stat', name: '狂戦士', desc: '攻撃に全てをかける。守りはおろそか', stat: { atk: 0.25, def: -0.12 }, fx: { punch: 1.1 }, viz: { glowEyes: '#ff4d4d' } },
  { id: 'arcane', cat: 'stat', name: '魔導核', desc: '体内に魔力の核を宿す。腕力は落ちる', stat: { mag: 0.25, atk: -0.1 }, fx: { magic: 1.1 }, viz: { core: true } },
  { id: 'swift', cat: 'stat', name: '疾風脚', desc: '目にもとまらぬ速さ。体は軽く打たれ弱い', stat: { spd: 0.3, hp: -0.08 }, viz: { speedLines: true } },
  { id: 'iron', cat: 'stat', name: '鉄壁', desc: '鉄のような守り。動きは重くなる', stat: { def: 0.28, spd: -0.12 }, viz: { pattern: 'plates' } },
  { id: 'vital', cat: 'stat', name: '超回復体質', desc: '底なしの体力', stat: { hp: 0.22, atk: -0.05 }, viz: { aura: '#69db7c' } },
  { id: 'focus', cat: 'stat', name: '一点集中', desc: '大技にすべてを込める', stat: { atk: -0.05, mag: -0.05 }, fx: { ult: 1.18 }, viz: { glowEyes: '#ffe066' } },
  // 構造変異: 体のつくりそのものが変わる
  { id: 'extra_arms', cat: 'body', name: '四本腕', desc: '腕が 4 本。直殴りの手数がちがう', stat: { atk: 0.08 }, fx: { punch: 1.15 }, viz: { arms: true } },
  { id: 'twin_tail', cat: 'body', name: '双尾', desc: '2 本の尾でバランスをとる', stat: { spd: 0.1 }, viz: { tail2: true } },
  { id: 'crystal_spine', cat: 'body', name: '結晶背骨', desc: '背中から結晶が突き出す', stat: { def: 0.15 }, fx: { taken: 0.92 }, viz: { spikes: true } },
  { id: 'giant', cat: 'body', name: '巨大化', desc: 'ふつうよりひとまわり大きい体', stat: { hp: 0.3, spd: -0.15 }, viz: { scale: 1.1 } },
  { id: 'hollow', cat: 'body', name: '空洞骨格', desc: '中が空洞の軽い骨。速いがもろい', stat: { spd: 0.2, def: -0.1 }, viz: { ghost: true } },
  { id: 'six_wings', cat: 'body', name: '六枚翼', desc: '背中に 6 枚の翼', stat: { spd: 0.12, mag: 0.06 }, viz: { wings6: true } },
  // 種族変異: 別の種族の血が目覚める
  { id: 'chimera', cat: 'species', name: 'キメラ種', desc: '2 つの属性の血を持つ。直殴りに有利な方の属性が乗る', stat: {}, fx: { type2: true }, viz: { split: true } },
  { id: 'dragonkin', cat: 'species', name: '竜族', desc: '竜の血。攻撃も魔法も強いが鱗がうすい', stat: { atk: 0.12, mag: 0.12, def: -0.08 }, viz: { horns: true } },
  { id: 'phantom', cat: 'species', name: '幻霊種', desc: '実体があいまいで攻撃がすり抜ける。体力は少ない', stat: { hp: -0.15 }, fx: { taken: 0.85 }, viz: { ghost: true, aura: '#b197fc' } },
  { id: 'ancient', cat: 'species', name: '古代種', desc: '太古の生き物。重く、しぶとく、大技が重い', stat: { hp: 0.1, def: 0.1, spd: -0.1 }, fx: { ult: 1.1 }, viz: { pattern: 'runes' } },
  { id: 'celestial', cat: 'species', name: '天上種', desc: '天の加護。魔法が冴えわたる', stat: { mag: 0.15 }, fx: { magic: 1.08 }, viz: { halo: true } },
  { id: 'abyssal', cat: 'species', name: '深淵種', desc: '深淵の力。攻めは鋭いが、自分も傷つきやすい', stat: { atk: 0.15 }, fx: { punch: 1.08, taken: 1.05 }, viz: { aura: '#3b1f6e' } },
];
// 相乗効果: needs の変異をすべて (直接に) 持っていると発動。1 体につき 2 つまで (上から順に)
// needs には変異の id か { cat: 分類 } か { cats: 何種類の分類 } を書ける
const SYNERGIES = [
  { id: 'arcane_peak', name: '魔導の極み', needs: ['arcane', 'third_eye'], desc: '魔法のダメージ 1.12 倍', fx: { magic: 1.12 } },
  { id: 'kishin', name: '鬼神', needs: ['berserker', 'extra_arms'], desc: '直殴りのダメージ 1.12 倍', fx: { punch: 1.12 } },
  { id: 'fortress', name: '不落要塞', needs: ['iron', 'crystal_spine'], desc: '受けるダメージ 0.9 倍', fx: { taken: 0.9 } },
  { id: 'gale', name: '疾風迅雷', needs: ['swift', 'hollow'], desc: '素早さ +10%', stat: { spd: 0.1 } },
  { id: 'divine_dragon', name: '神竜', needs: ['dragonkin', 'celestial'], desc: '大技のダメージ 1.15 倍', fx: { ult: 1.15 } },
  { id: 'star_child', name: '星の申し子', needs: ['starry', 'aurora'], desc: '魔力 +10%', stat: { mag: 0.1 } },
  { id: 'tri_resonance', name: '三相共鳴', needs: [{ cats: 3 }], desc: '3 つの分類の変異が共鳴: 全能力 +4%', stat: { hp: 0.04, atk: 0.04, mag: 0.04, def: 0.04, spd: 0.04 } },
];
const MAX_MUTATIONS = 4, MAX_SYNERGIES = 2;
const STAT_CAP = { min: -0.3, max: 0.6 }; // 能力の変化の上限 (変異と相乗効果の合計)。無限には強くならない
const FX_CAP = { dealMax: 1.45, takenMin: 0.72 };

const DEFAULT_CONFIG = {
  base: 0.005, max: 0.02,                          // 発生率: 基本 0.5%・上限 2.0%
  bonus: { parentDirect: 0.004, parentLatent: 0.003, bothParents: 0.003, deepLine: 0.002 }, // 補正 (それぞれ 1 回だけ数える)
  deepLineGen: 5,                                  // この世代以上の血統で補正
  count: [[1, 0.85], [2, 0.12], [3, 0.025], [4, 0.005]],   // 発生したときの変異の数
  rarity: [['N', 0.66], ['R', 0.15], ['SR', 0.10], ['SSR', 0.05], ['UR', 0.03], ['MR', 0.01]],
  inherit: { direct: 0.3, latent: 0.2 },           // 親の変異 (直接) の遺伝: 直接 30%・潜在 20%・なし 50%
  inheritLatent: { direct: 0.15, latent: 0.25 },   // 親の潜在形質の遺伝: 表に出る 15%・潜在のまま 25%・なし 60%
  initScore: 1000, initScoreMin: 'R',              // R 以上の変異を (直接に) 持って生まれたら、市場価値の初期値 1000
};
function loadConfig() {
  let o = {}; try { o = JSON.parse(process.env.MON_MUTATION_CONFIG || '{}'); } catch {}
  const c = { ...DEFAULT_CONFIG, ...o, bonus: { ...DEFAULT_CONFIG.bonus, ...(o.bonus || {}) }, inherit: { ...DEFAULT_CONFIG.inherit, ...(o.inherit || {}) }, inheritLatent: { ...DEFAULT_CONFIG.inheritLatent, ...(o.inheritLatent || {}) } };
  c.max = Math.min(0.02, Math.max(0, Number(c.max) || 0.02)); // 最終確率は 2.0% を超えない
  return c;
}
const CONFIG = loadConfig();
const BY_ID = Object.fromEntries(MUTATIONS.map((m) => [m.id, m]));
const rarityRank = (r) => RARITIES.indexOf(r);

function pickWeighted(list, r) { let u = r(); for (const [v, p] of list) { u -= p; if (u < 0) return v; } return list[list.length - 1][0]; }

// 発生率 (ハイブリッド型: 基本 + 補正。同じ条件は 1 回だけ数える・上限あり)
function chanceOf(father, mother, cfg = CONFIG) {
  const parents = [father, mother];
  const direct = parents.map((p) => (p.mutations || []).some((x) => x.mode === 'direct'));
  const latent = parents.map((p) => (p.mutations || []).some((x) => x.mode === 'latent'));
  let c = cfg.base;
  const used = [];
  if (direct.some(Boolean)) { c += cfg.bonus.parentDirect; used.push('parentDirect'); }
  if (latent.some(Boolean)) { c += cfg.bonus.parentLatent; used.push('parentLatent'); }
  if (direct.every(Boolean)) { c += cfg.bonus.bothParents; used.push('bothParents'); }
  if (Math.max(father.gen || 0, mother.gen || 0) + 1 >= cfg.deepLineGen) { c += cfg.bonus.deepLine; used.push('deepLine'); }
  return { chance: Math.min(cfg.max, c), used };
}

// 子の変異を決める (遺伝 + 突然変異)。r は乱数 (サーバーの crypto)。戻り値: { list, newOnes, chance, log }
function rollChild(father, mother, r, typeIds, cfg = CONFIG) {
  const log = [], list = [];
  const add = (m) => { if (list.length >= MAX_MUTATIONS || list.some((x) => x.id === m.id)) return false; list.push(m); return true; };
  // 1) 遺伝: 親の変異を 1 つずつ判定 (直接の形質を先に)
  for (const [from, p] of [['father', father], ['mother', mother]]) {
    for (const x of (p.mutations || []).slice().sort((a, b) => (a.mode === 'direct' ? 0 : 1) - (b.mode === 'direct' ? 0 : 1))) {
      const t = x.mode === 'direct' ? cfg.inherit : cfg.inheritLatent, u = r();
      const mode = u < t.direct ? 'direct' : u < t.direct + t.latent ? 'latent' : null;
      log.push({ event: 'inherit', id: x.id, from, parentMode: x.mode, result: mode || 'none' });
      if (!mode || !BY_ID[x.id]) continue;
      const have = list.find((y) => y.id === x.id);
      if (have) { if (mode === 'direct' && have.mode === 'latent') { have.mode = 'direct'; have.origin = from; } if (rarityRank(x.rarity) > rarityRank(have.rarity)) have.rarity = x.rarity; continue; }
      add({ id: x.id, rarity: x.rarity, mode, origin: from, param: x.param || null });
    }
  }
  // 2) 突然変異 (発生しなかったら持ち越しなし)
  const { chance, used } = chanceOf(father, mother, cfg);
  const newOnes = [];
  if (r() < chance) {
    const n = pickWeighted(cfg.count, r);
    const pool = MUTATIONS.filter((m) => !list.some((x) => x.id === m.id));
    for (let i = 0; i < n && pool.length && list.length < MAX_MUTATIONS; i++) {
      const m = pool.splice(Math.floor(r() * pool.length), 1)[0];
      const rarity = pickWeighted(cfg.rarity, r);
      const param = m.fx?.type2 ? typeIds[Math.floor(r() * typeIds.length)] : null;
      const x = { id: m.id, rarity, mode: 'direct', origin: 'new', param };
      if (add(x)) { newOnes.push(x); log.push({ event: 'mutation', id: m.id, rarity }); }
    }
  }
  // 潜在より直接を優先して 4 つまで
  list.sort((a, b) => (a.mode === 'direct' ? 0 : 1) - (b.mode === 'direct' ? 0 : 1));
  return { list: list.slice(0, MAX_MUTATIONS), newOnes, chance, used, log };
}

// 有効な相乗効果 (直接の変異だけで判定・2 つまで)
function synergiesOf(muts) {
  const direct = muts.filter((x) => x.mode === 'direct'), ids = new Set(direct.map((x) => x.id)), cats = new Set(direct.map((x) => BY_ID[x.id]?.cat).filter(Boolean));
  return SYNERGIES.filter((s) => s.needs.every((n) => (typeof n === 'string' ? ids.has(n) : n.cat ? cats.has(n.cat) : n.cats ? cats.size >= n.cats : false))).slice(0, MAX_SYNERGIES);
}
// 能力・バトル効果をまとめる (直接の変異だけ。潜在は効果なし)
function effectsOf(muts, ownType) {
  const stat = { hp: 0, atk: 0, mag: 0, def: 0, spd: 0 }, fx = { punch: 1, magic: 1, ult: 1, taken: 1, type2: null };
  for (const x of muts.filter((y) => y.mode === 'direct')) {
    const m = BY_ID[x.id]; if (!m) continue; const k = RARITY_SCALE[x.rarity] || 1;
    for (const [s, v] of Object.entries(m.stat || {})) stat[s] += v > 0 ? v * k : v;
    for (const key of ['punch', 'magic', 'ult']) if (m.fx?.[key]) fx[key] *= 1 + (m.fx[key] - 1) * k;
    if (m.fx?.taken) fx.taken *= m.fx.taken < 1 ? 1 - (1 - m.fx.taken) * k : m.fx.taken;
    if (m.fx?.type2 && x.param && x.param !== ownType) fx.type2 = x.param;
  }
  const syn = synergiesOf(muts);
  for (const s of syn) { for (const [k, v] of Object.entries(s.stat || {})) stat[k] += v; for (const key of ['punch', 'magic', 'ult']) if (s.fx?.[key]) fx[key] *= s.fx[key]; if (s.fx?.taken) fx.taken *= s.fx.taken; }
  for (const k of Object.keys(stat)) stat[k] = Math.max(STAT_CAP.min, Math.min(STAT_CAP.max, stat[k]));
  for (const key of ['punch', 'magic', 'ult']) fx[key] = Math.min(FX_CAP.dealMax, fx[key]);
  fx.taken = Math.max(FX_CAP.takenMin, Math.min(1.2, fx.taken));
  return { stat, fx, syn };
}
function applyStats(base, stat) { return Object.fromEntries(['hp', 'atk', 'mag', 'def', 'spd'].map((k) => [k, Math.max(1, Math.round(base[k] * (1 + (stat[k] || 0))))])); }
// 見た目 (絵の部品) をまとめる
function vizOf(muts) { const v = {}; for (const x of muts.filter((y) => y.mode === 'direct')) Object.assign(v, BY_ID[x.id]?.viz || {}); return v; }
const topRarity = (muts) => muts.filter((x) => x.mode === 'direct').reduce((best, x) => (rarityRank(x.rarity) > rarityRank(best) ? x.rarity : best), null);
// 組み合わせの記録のキー (直接の変異の id を並べたもの。2 つ以上のとき)
const comboKey = (muts) => { const ids = muts.filter((x) => x.mode === 'direct').map((x) => x.id).sort(); return ids.length >= 2 ? ids.join('+') : null; };

// 画面に出す形 (名前・分類・説明・効果の文)
const STAT_NAME = { hp: 'HP', atk: '攻撃', mag: '魔力', def: '防御', spd: '素早さ' };
function effectText(m, rarity, param, types) {
  const k = RARITY_SCALE[rarity] || 1, out = [];
  for (const [s, v] of Object.entries(m.stat || {})) out.push(`${STAT_NAME[s]} ${v > 0 ? '+' : ''}${Math.round((v > 0 ? v * k : v) * 100)}%`);
  const fxName = { punch: '直殴り', magic: '魔法', ult: '大技' };
  for (const key of ['punch', 'magic', 'ult']) if (m.fx?.[key]) out.push(`${fxName[key]}のダメージ ×${(1 + (m.fx[key] - 1) * k).toFixed(2)}`);
  if (m.fx?.taken) out.push(`受けるダメージ ×${(m.fx.taken < 1 ? 1 - (1 - m.fx.taken) * k : m.fx.taken).toFixed(2)}`);
  if (m.fx?.type2 && param) out.push(`2 つ目の属性: ${types?.[param]?.icon || ''}${types?.[param]?.name || param}`);
  return out;
}
function viewOf(x, types) {
  const m = BY_ID[x.id]; if (!m) return null;
  return { id: m.id, name: m.name, cat: m.cat, catName: CATEGORIES[m.cat], desc: m.desc, rarity: x.rarity, mode: x.mode, origin: x.origin, effects: effectText(m, x.rarity, x.param, types) };
}

module.exports = { MUTATIONS, SYNERGIES, CATEGORIES, RARITIES, CONFIG, DEFAULT_CONFIG, MAX_MUTATIONS, MAX_SYNERGIES, STAT_CAP, BY_ID, rarityRank, chanceOf, rollChild, synergiesOf, effectsOf, applyStats, vizOf, topRarity, comboKey, viewOf };
