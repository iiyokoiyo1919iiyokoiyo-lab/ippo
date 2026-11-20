// =====================================================================
// シティバトル: ゲームバランスと NPC の設定
//   ・はじめの値は DEFAULTS。環境変数 ARENA_CONFIG (JSON) で上書きできる (開発用)
//   ・管理者はゲームの中の設定画面からも変えられる (サーバーを再起動すると、はじめの値にもどる)
// =====================================================================
const DEFAULTS = {
  oneHitDown: false,     // 一撃で倒れる (どんな被弾でも転倒)
  staggerMs: 450,        // 軽い被弾の硬直
  downedMs: 2800,        // 転倒して地面にいる時間 (そのあと起き上がる)
  downImpact: 30,        // この強さ以上の被弾で転倒 (体 18・頭 40・パンチ 34)
  fatalDamage: 80,       // 1 発でこれ以上のダメージなら、HP が残っていても行動不能
  incapMs: 1500,         // 行動不能 → 死亡 になるまで (プレイヤーはそのあと復活)
  npcCount: 20,          // 通行人の数
  npcMaxActive: 40,      // 1 回の更新で動かす NPC の最大数 (多すぎるときは順番に)
  npcReact: 1,           // NPC の反応頻度 (0〜2。0 だと反応しない)
  npcFlee: 0.6,          // NPC の逃走頻度 (0〜1)
  npcHp: 60,
  corpseMs: 25000,       // 死亡した NPC が消えるまで
};
const LIMITS = { npcCount: [0, 200], npcMaxActive: [5, 400], npcReact: [0, 2], npcFlee: [0, 1], downImpact: [1, 200], fatalDamage: [1, 500], staggerMs: [0, 3000], downedMs: [500, 10000] };
function sanitize(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    if (typeof DEFAULTS[k] === 'boolean') out[k] = !!v;
    else { const n = Number(v); if (!Number.isFinite(n)) continue; const [lo, hi] = LIMITS[k] || [0, 1e6]; out[k] = Math.max(lo, Math.min(hi, n)); }
  }
  return out;
}
function load() {
  let env = {}; try { env = JSON.parse(process.env.ARENA_CONFIG || '{}'); } catch { console.error('[arena] ARENA_CONFIG が JSON ではありません'); }
  return { ...DEFAULTS, ...sanitize(env) };
}
module.exports = { DEFAULTS, LIMITS, sanitize, load };
