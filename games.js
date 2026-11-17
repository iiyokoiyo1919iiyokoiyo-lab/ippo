// =====================================================================
// ミニゲーム「暗算ダッシュ」 (60 秒でどれだけ計算できるか。ランキングつき)
//
// ・問題はサーバーが作り、答えもサーバーに記録する
// ・終わったら、端末は「入力した答え」と「入力した時刻 (開始からのミリ秒)」だけを送る
//   → 点数はサーバーが計算し直す (送られた点数は使わない)。時間切れのあとや、間隔が短すぎる入力は受け付けない
// ・ランキングは 1 人 1 つ (その期間の自己ベスト)。今日・今週 (日本時間) と、これまでの全部
// =====================================================================
const crypto = require('crypto');

const GAME_MS = 60_000;          // 1 回の時間
const COUNTDOWN_MS = 3_000;      // 始まる前の 3・2・1
const GRACE_MS = 15_000;         // 通信の遅れを見込んだ余裕
const MIN_GAP_MS = 300;          // 1 問にかかる最短の時間 (これより速い入力は人の手ではないとみなす)
const PROBLEMS = 150;            // 1 回に出す問題の数
const MIGRATION = `
CREATE TABLE game_runs (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,                                 -- 'math' (暗算ダッシュ)
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- ゲストの練習は NULL (記録には残らない)
  answers TEXT NOT NULL,                              -- 正解の一覧 (JSON)。端末に送った問題と同じ順番
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  score INTEGER,
  correct INTEGER,
  answered INTEGER,
  best_combo INTEGER
);
CREATE INDEX game_runs_rank ON game_runs(game, finished_at, score);
CREATE INDEX game_runs_user ON game_runs(user_id, game, finished_at);
`;

const rint = (a, b) => crypto.randomInt(a, b + 1);
// i 問目の問題 (後ろほど難しい)。答えはいつも 0 以上の整数
function makeProblem(i) {
  const pick = (arr) => arr[rint(0, arr.length - 1)];
  let a, b, op;
  if (i < 8) { op = pick(['+', '-']); a = rint(2, 9); b = rint(1, 9); }
  else if (i < 20) { op = pick(['+', '-']); a = rint(11, 49); b = rint(2, 9); }
  else if (i < 35) { op = '×'; a = rint(2, 9); b = rint(2, 9); }
  else if (i < 55) { op = pick(['+', '-']); a = rint(21, 99); b = rint(12, 89); }
  else if (i < 75) { op = pick(['×', '÷']); a = rint(3, 12); b = rint(3, 12); }
  else { op = pick(['+', '-', '×', '÷']); if (op === '×') { a = rint(12, 39); b = rint(3, 9); } else if (op === '÷') { a = rint(4, 15); b = rint(6, 15); } else { a = rint(101, 499); b = rint(25, 299); } }
  if (op === '-' && b > a) [a, b] = [b, a];
  if (op === '÷') { const ans = a; a = ans * b; return { q: `${a} ÷ ${b}`, a: ans }; } // 割り切れる問題だけ
  return { q: `${a} ${op} ${b}`, a: op === '+' ? a + b : op === '-' ? a - b : a * b };
}
// 点数: 正解 10 点 + 連続正解のボーナス (2 問目から 2 点ずつ増え、最大 +18)。間違えると連続が途切れる
function scoreOf(answers, given) {
  let score = 0, correct = 0, combo = 0, best = 0;
  given.forEach((g, i) => {
    if (g.v === answers[i]) { correct++; combo++; best = Math.max(best, combo); score += 10 + Math.min(combo - 1, 9) * 2; }
    else combo = 0;
  });
  return { score, correct, answered: given.length, bestCombo: best };
}

const jstStart = (kind, now = Date.now()) => {
  const d = new Date(now + 9 * 3600_000); d.setUTCHours(0, 0, 0, 0);
  if (kind === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // 月曜はじまり
  return d.getTime() - 9 * 3600_000;
};

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-20-game-runs', MIGRATION);
  const startLimit = rateLimit({ windowMs: 10 * 60_000, max: 40, key: (req) => 'gs' + (req.user?.id ?? req.ip) });
  const finishLimit = rateLimit({ windowMs: 10 * 60_000, max: 40, key: (req) => 'gf' + (req.user?.id ?? req.ip) });

  // 始める: 問題を作って渡す (ゲストも練習として遊べる。記録には残らない)
  app.post('/api/games/math/start', startLimit, (req, res) => {
    const problems = Array.from({ length: PROBLEMS }, (_, i) => makeProblem(i));
    const id = crypto.randomBytes(12).toString('base64url');
    db.prepare('INSERT INTO game_runs (id, game, user_id, answers, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'math', req.user?.id ?? null, JSON.stringify(problems.map((p) => p.a)), Date.now());
    res.json({ runId: id, problems, gameMs: GAME_MS, countdownMs: COUNTDOWN_MS, ranked: !!req.user });
  });

  // 終わる: 入力した答えと時刻から、サーバーが点数を計算する
  app.post('/api/games/math/finish', finishLimit, (req, res) => {
    const { runId, inputs } = req.body || {};
    const run = typeof runId === 'string' ? db.prepare("SELECT * FROM game_runs WHERE id = ? AND game = 'math'").get(runId) : null;
    if (!run || (run.user_id ?? null) !== (req.user?.id ?? null)) return res.status(404).json({ error: 'このゲームの記録が見つかりません' });
    if (run.finished_at) return res.status(409).json({ error: 'このゲームはもう終わっています' });
    const now = Date.now();
    if (now - run.started_at > COUNTDOWN_MS + GAME_MS + GRACE_MS) return res.status(410).json({ error: '時間がたちすぎたため、記録できませんでした' });
    const answers = JSON.parse(run.answers);
    if (!Array.isArray(inputs) || inputs.length > answers.length) return res.status(400).json({ error: '答えの形が正しくありません' });
    let prev = -Infinity;
    for (const g of inputs) {
      if (!g || !Number.isInteger(g.v) || g.v < 0 || g.v > 1e6 || !Number.isFinite(g.t)) return res.status(400).json({ error: '答えの形が正しくありません' });
      if (g.t < 0 || g.t > GAME_MS + 500) return res.status(400).json({ error: '時間切れのあとの答えは数えません' });
      if (g.t - prev < MIN_GAP_MS) return res.status(400).json({ error: '入力が速すぎます' });
      prev = g.t;
    }
    // 端末の時計で 60 秒ぶん答えたのに、サーバーでは短い時間しかたっていない → 時間をごまかしている
    if (inputs.length && prev - 2000 > now - run.started_at) return res.status(400).json({ error: '時間の記録が正しくありません' });
    const r = scoreOf(answers, inputs);
    db.prepare('UPDATE game_runs SET finished_at = ?, score = ?, correct = ?, answered = ?, best_combo = ?, answers = ? WHERE id = ?')
      .run(now, r.score, r.correct, r.answered, r.bestCombo, '[]', run.id);
    const out = { ...r, ranked: !!run.user_id };
    if (run.user_id) {
      const rank = (kind) => {
        const since = kind === 'all' ? 0 : jstStart(kind, now);
        const mine = db.prepare("SELECT MAX(score) AS s FROM game_runs WHERE game = 'math' AND user_id = ? AND finished_at >= ?").get(run.user_id, since).s;
        const above = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT user_id, MAX(score) AS s FROM game_runs WHERE game = 'math' AND user_id IS NOT NULL AND finished_at >= ? GROUP BY user_id) WHERE s > ?`).get(since, mine).n;
        return { best: mine, rank: above + 1 };
      };
      out.day = rank('day'); out.week = rank('week'); out.all = rank('all');
      out.newBest = r.score > 0 && out.all.best === r.score && db.prepare("SELECT COUNT(*) AS n FROM game_runs WHERE game = 'math' AND user_id = ? AND score = ? AND id != ?").get(run.user_id, r.score, run.id).n === 0;
    }
    res.json(out);
  });

  // ランキング (1 人 1 つ、その期間の自己ベスト。同点なら先に出した人が上)
  const readLimit = rateLimit({ windowMs: 60_000, max: 120 });
  app.get('/api/games/math/ranking', readLimit, (req, res) => {
    const period = ['day', 'week', 'all'].includes(req.query.period) ? req.query.period : 'day';
    const since = period === 'all' ? 0 : jstStart(period);
    const rows = db.prepare(`SELECT user_id, score, correct, best_combo, finished_at FROM game_runs
      WHERE game = 'math' AND user_id IS NOT NULL AND finished_at >= ? AND score IS NOT NULL ORDER BY score DESC, finished_at ASC LIMIT 5000`).all(since);
    const seen = new Set(), list = [];
    for (const r of rows) { if (seen.has(r.user_id)) continue; seen.add(r.user_id); list.push(r); }
    const qU = db.prepare('SELECT * FROM users WHERE id = ?');
    let rank = 0, lastScore = null;
    const ranked = list.map((r, i) => { if (r.score !== lastScore) { rank = i + 1; lastScore = r.score; } return { ...r, rank }; });
    const view = (r) => { const u = publicUser(qU.get(r.user_id)); return u && { rank: r.rank, score: r.score, correct: r.correct, bestCombo: r.best_combo, at: r.finished_at, user: u }; };
    const mine = req.user ? ranked.find((r) => r.user_id === req.user.id) : null;
    res.json({ period, players: ranked.length, top: ranked.slice(0, 50).map(view).filter(Boolean), me: mine ? view(mine) : null });
  });

  // 終わらなかったゲームとゲストの練習は 1 日で消す
  setInterval(() => {
    try { db.prepare('DELETE FROM game_runs WHERE started_at < ? AND (finished_at IS NULL OR user_id IS NULL)').run(Date.now() - 86400_000); } catch {}
  }, 3600_000).unref();

  ctx.eraseGames = (userId) => db.prepare('DELETE FROM game_runs WHERE user_id = ?').run(userId);
};
module.exports.scoreOf = scoreOf;
module.exports.makeProblem = makeProblem;
