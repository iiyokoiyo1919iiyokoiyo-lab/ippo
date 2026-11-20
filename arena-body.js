// =====================================================================
// シティバトル: 体の状態 (プレイヤー・ボット・通行人で共通)
//   Normal (通常) → Staggered (硬直) / Downed (転倒) / Incapacitated (行動不能) → Dead (死亡)
//   ・軽い被弾: 硬直 (staggerMs)。強い被弾 (衝撃 >= downImpact): 転倒 (downedMs のあと起き上がる)
//   ・HP が 0、または 1 発のダメージが fatalDamage 以上: すぐに行動不能 → incapMs のあと死亡
//   ・一撃で倒れるモード (oneHitDown) では、どんな被弾でも転倒
//   ・転倒・行動不能・死亡のあいだは、移動も攻撃もできない
// =====================================================================
const S = { NORMAL: 'normal', STAGGERED: 'staggered', DOWNED: 'downed', INCAP: 'incap', DEAD: 'dead' };
const CODE = { normal: 0, staggered: 1, downed: 2, incap: 3, dead: 4 };

function create(hp) { return { hp, maxHp: hp, state: S.NORMAL, until: 0, since: Date.now(), dir: [0, 0, 1] }; }
const canMove = (b) => b.state === S.NORMAL;
const canAct = (b) => b.state === S.NORMAL;
const isDown = (b) => b.state === S.DOWNED || b.state === S.INCAP || b.state === S.DEAD;
const isOut = (b) => b.state === S.INCAP || b.state === S.DEAD;
function set(b, state, now, ms = 0) { b.state = state; b.since = now; b.until = ms ? now + ms : 0; }

// 被弾: { dmg, impact, dir } → 'stagger' / 'down' / 'incap' (もう行動不能なら null)
function hit(b, { dmg, impact, dir }, cfg, now = Date.now()) {
  if (isOut(b)) return null;
  b.hp = Math.max(0, b.hp - dmg);
  if (dir) b.dir = dir;
  if (b.hp <= 0 || dmg >= cfg.fatalDamage) { set(b, S.INCAP, now, b.incapMs || cfg.incapMs); return 'incap'; } // 通行人は長め (苦しむ時間)
  if (cfg.oneHitDown || impact >= cfg.downImpact || b.state === S.DOWNED) { set(b, S.DOWNED, now, cfg.downedMs); return 'down'; }
  set(b, S.STAGGERED, now, cfg.staggerMs); return 'stagger';
}
// 時間で進む: 硬直・転倒 → 通常、行動不能 → 死亡。変わったら新しい状態を返す
function update(b, now = Date.now()) {
  if (!b.until || now < b.until) return null;
  if (b.state === S.STAGGERED || b.state === S.DOWNED) { set(b, S.NORMAL, now); return S.NORMAL; }
  if (b.state === S.INCAP) { set(b, S.DEAD, now); return S.DEAD; }
  return null;
}
function revive(b, now = Date.now()) { b.hp = b.maxHp; set(b, S.NORMAL, now); }

module.exports = { S, CODE, create, hit, update, revive, canMove, canAct, isDown, isOut };
