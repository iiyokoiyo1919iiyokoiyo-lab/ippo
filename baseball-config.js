// =====================================================================
// IppO ベースボール: 調整できる数値 (覚醒・成長・引退・殿堂入り・新人王・スカウト・隠し逸材・トレード)
//   ・環境変数 BB_CONFIG (JSON) で上書きできる (例: BB_CONFIG='{"awaken":{"base":0.001}}')。足りないところはここの値
// =====================================================================
const DEFAULTS = {
  // 覚醒: 試合のあとに 1 人ずつ判定。確率 = (base + perf × 活躍点) × 成長性 × 年齢 (上限 max)
  awaken: {
    base: 0.0002, perf: 0.0008, max: 0.05,
    minGames: 5,          // これより少ない試合数では起きない
    cooldownGames: 25,    // 覚醒のあと、この試合数は起きない
    maxPerPlayer: 3,      // 1 人が生涯で覚醒できる回数
    gain: [3, 8],         // 能力の上がり幅 (1 つあたり)
    velo: [1, 4],         // 球速の上がり幅 (km/h)
    overPot: 8,           // 成長の限界をこえて上がれる分
    newPitch: 0.35,       // 投手が新しい変化球を覚える確率
    newSpecial: 0.2,      // 特殊能力を新しく得る確率
    veloCap: 165,
  },
  // 成長と衰え (シーズンの終わり。1 シーズン = 1 年)
  growth: { young: 23, prime: 27, decline: 32, youngGain: [1, 4], primeGain: [0, 2], oldLoss: [1, 3], veteranLoss: [2, 5], veteranAge: 35 },
  // 引退 (シーズンの終わり。年齢ごとの確率。成績が良いと下がる)
  retire: { minAge: 31, curve: [[31, 0.03], [33, 0.08], [35, 0.18], [37, 0.35], [39, 0.6], [41, 1]], goodRelief: 0.5, maxAge: 42 },
  // 殿堂入り (引退のときに判定。どれか 1 つを満たせば殿堂入り)
  hof: {
    B: { h: 700, hr: 180, rbi: 650, titles: 3 },
    P: { w: 60, sv: 120, k: 900, titles: 3 },
  },
  // 新人王 (ドラフトで入った選手。その季に指名された人)
  rookie: { minPA: 20, minOuts: 27 },
  // スカウト
  scout: { free: 3, cost: 100, levelCost: [0, 1000, 2500, 5000, 9000], maxLv: 5, width: [18, 13, 10, 7, 4], gemFind: [0.2, 0.35, 0.5, 0.65, 0.8], spFind: [0.45, 0.6, 0.72, 0.84, 0.95] },
  // 隠し逸材 (ドラフト候補に混ざる。目玉とは別。毎回は出ない)
  gem: { chance: 0.5, second: 0.12, pot: [92, 99] },
  // トレード
  trade: { expireHours: 24, maxSide: 3, maxPending: 5 },
};
function merge(a, b) { if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b; const o = { ...a }; for (const k of Object.keys(b)) o[k] = a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; return o; }
let over = {}; try { over = JSON.parse(process.env.BB_CONFIG || '{}'); } catch { console.error('[bb] BB_CONFIG が JSON として読めません (無視します)'); }
module.exports = merge(DEFAULTS, over);
module.exports.DEFAULTS = DEFAULTS;
