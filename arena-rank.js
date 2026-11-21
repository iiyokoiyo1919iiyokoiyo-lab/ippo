// =====================================================================
// シティバトル: プレイヤーランク (経験値でランクが上がる。下がらない)
//   ・保存する: 表 arena_players (経験値・キル・デス・ヘッドショット・ボットのキル・最高連続キル・拾ったお金・遊んだ時間)
//   ・経験値: 人を倒す 100 (頭 +25・なぐり +15)・ボット 25・連続キル 3/5/10 で +50/+100/+200・拾ったお金の 1/10 (1 回 120 まで)
//     通行人を倒しても経験値はなし (ランクのために一般人をおそわない)。やられても減らない
//   ・ランク: ルーキー → ブロンズ I〜III → シルバー → ゴールド → プラチナ → ダイヤ (各 I〜III) → マスター → レジェンド
// =====================================================================
const MIGRATION = `
CREATE TABLE IF NOT EXISTS arena_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  headshots INTEGER NOT NULL DEFAULT 0,
  bot_kills INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  cash INTEGER NOT NULL DEFAULT 0,
  play_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS arena_players_xp ON arena_players(xp DESC);
`;
const XP = { kill: 100, head: 25, melee: 15, bot: 25, streak: { 3: 50, 5: 100, 10: 200 }, cashDiv: 10, cashMax: 120 };
// [名前, アイコン, 色, この経験値から]
const TIERS = [['ルーキー', '🔰', '#868e96', 0],
  ['ブロンズ I', '🥉', '#b0703c', 300], ['ブロンズ II', '🥉', '#b0703c', 700], ['ブロンズ III', '🥉', '#b0703c', 1200],
  ['シルバー I', '🥈', '#adb5bd', 1800], ['シルバー II', '🥈', '#adb5bd', 2600], ['シルバー III', '🥈', '#adb5bd', 3500],
  ['ゴールド I', '🥇', '#fab005', 4600], ['ゴールド II', '🥇', '#fab005', 5900], ['ゴールド III', '🥇', '#fab005', 7400],
  ['プラチナ I', '💠', '#3bc9db', 9100], ['プラチナ II', '💠', '#3bc9db', 11000], ['プラチナ III', '💠', '#3bc9db', 13200],
  ['ダイヤ I', '💎', '#748ffc', 15600], ['ダイヤ II', '💎', '#748ffc', 18200], ['ダイヤ III', '💎', '#748ffc', 21000],
  ['マスター', '👑', '#e64980', 25000], ['レジェンド', '🔥', '#ff6b00', 32000]];

function rankOf(xp = 0) {
  let i = 0; for (let k = 0; k < TIERS.length; k++) if (xp >= TIERS[k][3]) i = k;
  const [name, icon, color, base] = TIERS[i], next = TIERS[i + 1]?.[3] ?? null;
  return { i, name, icon, color, xp, base, next };
}
const brief = (r) => ({ i: r.i, name: r.name, icon: r.icon, color: r.color });

function install(db) {
  db.migrate('2026-11-21-arena-ranks', MIGRATION);
  const qGet = db.prepare('SELECT * FROM arena_players WHERE user_id = ?');
  const qIns = db.prepare('INSERT OR IGNORE INTO arena_players (user_id, updated_at) VALUES (?, ?)');
  const qSave = db.prepare('UPDATE arena_players SET xp = ?, kills = ?, deaths = ?, headshots = ?, bot_kills = ?, best_streak = ?, cash = ?, play_ms = ?, updated_at = ? WHERE user_id = ?');
  const qTop = db.prepare(`SELECT a.user_id, a.xp, a.kills, a.deaths, a.headshots, u.username, u.display_name FROM arena_players a JOIN users u ON u.id = a.user_id WHERE a.xp > 0 ORDER BY a.xp DESC, a.kills DESC LIMIT ?`);
  const qPlace = db.prepare('SELECT COUNT(*) AS n FROM arena_players WHERE xp > ?');
  return {
    load(uid) { qIns.run(uid, Date.now()); return { ...qGet.get(uid) }; },
    save(s) { qSave.run(s.xp, s.kills, s.deaths, s.headshots, s.bot_kills, s.best_streak, s.cash, s.play_ms, Date.now(), s.user_id); },
    top(n = 20) { return qTop.all(n).map((r, k) => ({ place: k + 1, name: String(r.display_name || r.username).slice(0, 20), username: r.username, xp: r.xp, kills: r.kills, deaths: r.deaths, headshots: r.headshots, rank: brief(rankOf(r.xp)) })); },
    place(xp) { return xp > 0 ? qPlace.get(xp).n + 1 : null; },
  };
}
// 見せる形 (自分の画面)
const view = (s) => ({ ...rankOf(s.xp), kills: s.kills, deaths: s.deaths, headshots: s.headshots, botKills: s.bot_kills, bestStreak: s.best_streak, cash: s.cash, playMin: Math.round(s.play_ms / 60000) });

module.exports = { install, rankOf, brief, view, TIERS, XP };
