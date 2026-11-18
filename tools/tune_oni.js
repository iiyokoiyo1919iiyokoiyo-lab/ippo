// =====================================================================
// CPU 戦「鬼難」のデッキの強さ (boost) を決める (開発のときだけ使う)
//   node tools/tune_oni.js            … 5 種類を並べて調整して、結果を表示
//   node tools/tune_oni.js <デッキの id> … 1 種類だけ (内部用)
// 相手 (プレイヤー) は「Lv18 の SSR・MR でそろえたデッキ」(SSR 4 体 + MR から毎回ランダムに 3 体)。
// プレイヤーもCPU も、先を読む強い CPU と同じ考え方で動かして、プレイヤーの勝率が 25% になる boost を探す
// 結果の boost を cards.js の ONI_DECKS に書きこむ。高難易度クエスト (QUESTS の hard) の boost も同じやり方で決める ('quest:<id>')
// =====================================================================
const { spawn } = require('child_process');
const path = require('path');
const C = require('../cards');
const TARGET = 0.25, PLAYER_POOL = ['gold', 'chalk', 'case', 'scissors', 'tadokoro', 'star', 'raijin'], PLAYER_LV = 18;

function winRate(deck, boost, games) {
  let w = 0;
  for (let g = 0; g < games; g++) {
    const ids = [...PLAYER_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    const s = { turn: 0, winner: null, sides: [C.newSide(ids.map((id) => C.questBonus(deck.enemy ? deck : null, C.statsOf(id, PLAYER_LV)))), C.newSide(deck.enemy ? C.questEnemyStats(deck, boost) : C.oniDeckStats(deck, boost))] };
    while (s.winner === null) C.resolveTurn(s, [C.smartAct(s, 0, Math.random), C.smartAct(s, 1, Math.random)], Math.random);
    w += s.winner === 0 ? 1 : s.winner === -1 ? 0.5 : 0;
  }
  return w / games;
}

const id = process.argv[2];
if (id) {
  const deck = id.startsWith('quest:') ? C.QUESTS.find((q) => q.id === id.slice(6)) : C.ONI_DECKS.find((d) => d.id === id);
  let lo = 0.6, hi = 2.2, boost = 1, rate = winRate(deck, boost, 300);
  // プレイヤーの勝率が高すぎれば強くする (boost を上げる)。二分探索
  for (let i = 0; i < 9; i++) {
    if (rate > TARGET) lo = boost; else hi = boost;
    boost = (lo + hi) / 2;
    rate = winRate(deck, boost, 300);
  }
  const fin = winRate(deck, boost, 1500);
  process.stdout.write(JSON.stringify({ id, boost: Math.round(boost * 1000) / 1000, rate: fin }) + '\n');
} else {
  Promise.all([...C.ONI_DECKS.map((d) => d.id), ...C.QUESTS.filter((q) => q.hard).map((q) => 'quest:' + q.id)].map((d) => new Promise((ok) => {
    const ch = spawn(process.execPath, [__filename, d], { cwd: path.join(__dirname, '..') });
    let out = ''; ch.stdout.on('data', (x) => { out += x; }); ch.on('close', () => ok(JSON.parse(out.trim())));
  }))).then((rs) => rs.forEach((r) => console.log(`${r.id.padEnd(20)} boost ${r.boost}  プレイヤーの勝率 ${(r.rate * 100).toFixed(1)}%`)));
}
