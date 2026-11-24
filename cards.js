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
const STORY = require('./card-stories.js'); // 限定キャラ・MR のサイドストーリー
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
  starlight: { name: 'スターライトマーチ', desc: '流星を降らせる: 5 ターンのあいだ、ターンの終わりに相手の場のカードへ最大 HP の 30% のダメージ (ガード無視。かけ直すと 5 ターンにもどる)' },
  venom: { name: '野獣の眼光', desc: '相手の場のカードを毒 (毎ターン最大 HP の 8%・3 ターン) にして怯ませる (こうげき・わざができない)。相手より先に使えばそのターン、後なら次のターン' },
  sermon: { name: '説教', desc: '相手の場のカードの攻撃力を 0.6 倍にする (1 枚につき 1 回まで・交代しても戻らない) + 味方全員の毒を治す' },
  taika: { name: '大化の改新', desc: '1.2 倍のこうげき + 味方全員の状態異常とデバフをすべて取りのぞく (毒・怯み・眠り・説教の攻撃ダウン・流星)' },
  dna: { name: 'DNAを取り出す', desc: '1.8 倍のこうげき + 相手の場のカードの DNA を取り出して、そのバトル中ずっとわざを使えなくする (交代しても・大化の改新でも戻らない)' },
  order: { name: '社長命令', desc: '相手の場のカードに 1.5 倍、控えのカードに 0.7 倍の無属性こうげき' },
  deathsong: { name: '死の歌声─一方的な愛─', desc: '1.2 倍のこうげき。このターンにこのわざを受けた相手が、そのターンのうちに使い手を倒すと、相手の場と控えのカードからランダムで 1 枚を道連れにする' },
  thunder: { name: '落雷', desc: '相手の場のカードに雷を落とす: 2.3 倍の無属性こうげき (相性に関係なく同じダメージ)' },
  buchigire: { name: 'ブチギレおばさん', desc: '相手の場のカードを道連れにして、自分も倒れる (ガード・バリア・絶対権力に関係なく)' },
  sweep: { name: '疾風斬り', desc: '相手の場のカードに 1.4 倍、控えのカードに 0.8 倍の無属性こうげき + 全員に毒 (毎ターン最大 HP の 8%・3 ターン)' },
};
// パッシブ (いつでも働く力)。morale = 士気: このカードが倒れると、生き残っている味方の攻撃 1.4 倍・防御 1.3 倍 (1 回だけ)
// dogma = セントラルドグマ: このカードが控えで生きているあいだ、ターンの終わりに生きている味方全員の HP を最大 HP の 10% 回復
const PASSIVES = { morale: { name: '士気', desc: 'たおれると、生き残っている味方の士気が上がり、攻撃 1.4 倍・防御 1.3 倍' }, dogma: { name: 'セントラルドグマ', desc: '控えで生きているあいだ、毎ターン味方全員の HP を最大 HP の 10% 回復' } };
const DOGMA_RATE = 0.1;
const MORALE_ATK = 1.4, MORALE_DEF = 1.3;
const CARD_PASSIVE = { tadokoro: 'morale', suetsugu: 'dogma' };
// レア度とレベルで強くなる: R +4% / SR +8% / SSR +12%、レベル 1 つにつき +2% (Lv15 で +28%)。
// この強さなら、はじめのデッキでも SSR のデッキに 1〜2 割は勝てる (作戦と相性で逆転できる) ことをシミュレーションで確かめた。
// カードの基本の強さは、同じレア度どうしの 1 対 1 で勝率がほぼ 50% になるよう調整してある
const RARITY = { N: { rate: 50, mult: 1.0 }, R: { rate: 35, mult: 1.04 }, SR: { rate: 12, mult: 1.08 }, SSR: { rate: 3, mult: 1.12 } };
const UR_MULT = 1.2; // UR (昇格したカード・馬) の能力の倍率
const LEVEL_BONUS = 0.02;
// 能力の全体の倍率 (2026-11-20: 育てたモンスターのカードが強くなったので、文房具・馬・クエストや鬼難の敵の HP・攻撃・防御を 4 倍に)。
// HP・攻撃・防御をそろえて同じ倍率にするので、ダメージの計算 (攻撃×2 − 防御×0.6) の割合は変わらず、これまでのバランス (鬼難の boost など) はそのまま。素早さは変えない
const STAT_SCALE = 4;
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
  ['scissors', '疾風剣士ハサミ丸', '✂️', 'SSR', 'cut', 54, 15, 6.9, 17, 'sweep'], // 2026-11-18 10:25 (日本時間) 登場
  ['yumiko', 'ユミコ', '💢', 'SSR', 'heavy', 62, 16, 11, 14, 'buchigire'], // 2026-11-24 13:15 (日本時間) 登場の限定キャラ (ユミコのブチギレ祭 ピックアップ 2%・11/25 13:15 で排出終了)。ブチギレると止まらないおばさん。わざ「ブチギレおばさん」で相手の場のカードと相打ち (自分も倒れる)。体は弱め
  ['suetsugu', '魔法使いすえつぐ', '🩷', 'SSR', 'wrap', 44.64, 20.09, 8.04, 16, 'dna'], // 2026-11-23 8:00 (日本時間) 登場の限定キャラ (毎週月曜のIppO祭 ピックアップ 2%)。自分を魔法少女だと思っている人型のおばさん。Lv1 で HP 200・攻撃 90・防御 36・速さ 16 (×SSR 1.12×STAT_SCALE 4)。わざ封じとセントラルドグマが強いので、能力を下げた (HP 200・攻撃 90・速さ 16) (はじめは HP 270・攻撃 95・防御 45・速さ 18 で約 74%)
  ['tadokoro', 'タドコロ', '🎒', 'SSR', 'heavy', 74, 20, 14, 12, 'venom'], // 2026-11-19 8:35 (日本時間) 登場 (ピックアップ 2%)。パッシブ「士気」
  // ---- 2026-11-19 大量追加: R 20 体・SR 20 体・SSR 10 体 (すべて恒常。能力は既存カードと 1 対 1 で勝率 50% 前後に合わせた) ----
  ['crayon', 'クレヨン坊や', '🖍️', 'R', 'cut', 59, 16, 10, 12, 'power'],
  ['cutter', 'カッター少年', '🔪', 'R', 'cut', 68, 17, 10, 11, 'pierce'],
  ['sharpener', 'えんぴつけずりん', '⚙️', 'R', 'heavy', 58, 13, 9, 10, 'power'],
  ['binder', 'バインダー兵', '📁', 'R', 'wrap', 64, 17, 12, 14, 'barrier'],
  ['envelope', 'ふうとうポスト', '✉️', 'R', 'wrap', 84, 18, 13, 10, 'drain'],
  ['stamp', 'はんこ親分', '🔴', 'R', 'heavy', 57, 14, 10, 9, 'power'],
  ['inkpad', 'スタンプ台ちゃん', '🟣', 'R', 'wrap', 77, 20, 13, 11, 'heal'],
  ['clipboard', 'クリップボード番長', '📋', 'R', 'heavy', 72, 14, 12, 7, 'barrier'],
  ['highlighter', '蛍光ペンガール', '🖊️', 'R', 'cut', 54, 17, 9, 14, 'drain'],
  ['brush', '筆の剣士', '🖌️', 'SSR', 'cut', 63, 18, 10, 16, 'sweep'], // R から SSR に変更、わざは疾風斬り (ハサミ丸と同じ)。速さ 12 → 16
  ['palette', 'パレット画伯', '🎨', 'R', 'wrap', 79, 19, 14, 12, 'heal'],
  ['calc', '電卓ロボ', '🧮', 'R', 'heavy', 67, 13, 12, 5, 'pierce'],
  ['notecard', '単語カード', '🗂️', 'R', 'wrap', 79, 18, 12, 12, 'drain'],
  ['masking', 'マステちゃん', '🎀', 'R', 'wrap', 79, 20, 13, 11, 'heal'],
  ['ballpen', 'ボールペン兵', '🖊️', 'R', 'cut', 54, 16, 8, 14, 'power'],
  ['punch', '穴あけパンチ王', '🕳️', 'R', 'heavy', 60, 15, 12, 4, 'pierce'],
  ['bookmark', 'しおりの妖精', '🔖', 'R', 'wrap', 85, 18, 13, 11, 'heal'],
  ['lead', 'シャー芯ブラザーズ', '✏️', 'R', 'cut', 54, 17, 10, 14, 'pierce'],
  ['dust', 'けしかす小僧', '🌫️', 'R', 'heavy', 68, 14, 11, 9, 'drain'],
  ['tapecut', 'テープカッター将軍', '🎞️', 'R', 'heavy', 57, 13, 11, 9, 'power'],
  ['fudebako', '筆箱ガーディアン', '🧰', 'SR', 'heavy', 61, 15, 12, 8, 'barrier'],
  ['drafting', '製図ペンの魔導士', '✒️', 'SR', 'cut', 54, 14, 8, 17, 'pierce'],
  ['colors', '色えんぴつ戦隊', '🌈', 'SR', 'cut', 51, 15, 9, 15, 'power'],
  ['sketch', 'スケッチブック仙人', '📔', 'SR', 'wrap', 79, 20, 14, 9, 'heal'],
  ['magnet', 'マグネット番長', '🧲', 'SR', 'heavy', 60, 15, 11, 10, 'drain'],
  ['whiteboard', 'ホワイトボード騎士', '⬜', 'SR', 'heavy', 63, 15, 11, 7, 'barrier'],
  ['abacus', 'そろばん師範', '🧮', 'SR', 'heavy', 64, 14, 12, 6, 'pierce'],
  ['inkbottle', 'インク瓶の魔女', '🫙', 'SR', 'wrap', 75, 18, 13, 14, 'drain'],
  ['quill', '羽ペンの吟遊詩人', '🪶', 'SR', 'cut', 54, 18, 11, 16, 'heal'],
  ['label', 'ラベルライター博士', '🏷️', 'SR', 'wrap', 74, 18, 12, 11, 'pierce'],
  ['gluestick', 'スティックのり大将', '🧴', 'SR', 'wrap', 64, 16, 11, 15, 'barrier'],
  ['calendar', '卓上カレンダー', '📅', 'SR', 'wrap', 79, 19, 12, 13, 'heal'],
  ['lamp', 'デスクライト', '💡', 'SR', 'heavy', 64, 14, 12, 4, 'power'],
  ['clock', '目覚まし時計', '⏰', 'SR', 'heavy', 63, 15, 11, 7, 'drain'],
  ['setsquare', '三角定規コンビ', '📐', 'SR', 'cut', 66, 16, 11, 12, 'pierce'],
  ['origami', '折り紙ドラゴン', '🐲', 'SR', 'wrap', 65, 17, 11, 14, 'power'],
  ['seal', '封蝋の伯爵', '🧧', 'SR', 'heavy', 61, 15, 11, 7, 'barrier'],
  ['diary', '日記帳の姫', '📖', 'SR', 'wrap', 78, 19, 15, 11, 'heal'],
  ['sensu', '扇子の舞姫', '🪭', 'SR', 'cut', 54, 17, 10, 13, 'drain'],
  ['gem', '宝石ペーパーウェイト', '💠', 'SR', 'heavy', 65, 15, 12, 7, 'heal'],
  ['rainbowpen', '七色ボールペン覇王', '🌈', 'SSR', 'cut', 60, 15, 10, 13, 'power'],
  ['meteorruler', '流星定規', '☄️', 'SSR', 'cut', 56, 14, 10, 16, 'pierce'],
  ['sumiryu', '墨龍の大筆', '🐉', 'SSR', 'wrap', 76, 17, 15, 14, 'drain'],
  ['crystal', '水晶コンパス', '💎', 'SSR', 'cut', 66, 19, 11, 11, 'heal'],
  ['gyokuji', '皇帝の玉璽', '👑', 'SSR', 'heavy', 67, 15, 12, 6, 'barrier'],
  ['phoenix', '不死鳥の羽ペン', '🔥', 'SSR', 'cut', 67, 19, 11, 11, 'heal'],
  ['galaxy', '銀河儀', '🌌', 'SSR', 'heavy', 65, 14, 12, 10, 'heal'],
  ['raimei', '雷鳴ホチキス', '⚡', 'SSR', 'heavy', 64, 15, 10, 5, 'power'],
  ['hyoketsu', '氷結万年筆', '❄️', 'SSR', 'wrap', 70, 18, 11, 11, 'pierce'],
  ['sakura', '桜吹雪の筆', '🌸', 'SSR', 'wrap', 67, 17, 13, 11, 'barrier'],
  ['star', '星キャンディー', '🍬', 'MR', 'wrap', 80, 19, 13, 13, 'starlight'], // MR: 期間限定クエストのクリア報酬 (ガチャには出ない)
  ['watermid', 'ウォーターミッドナイト', '🌊', 'MR', 'wrap', 108, 13, 21, 9, 'sermon'], // MR: 高難易度クエスト「水深夜」のクリア報酬 (2026-11-20 8:00 から)。体力と防御が高く、攻撃が低い
  ['raijin', '雷神クリりん', '⚡', 'MR', 'cut', 62, 14, 10, 19, 'thunder'], // MR: 高難易度クエスト「雷神降臨」のクリア報酬 (2026-11-19 8:00 から)
  ['nakanoooe', '中大兄皇子', '👑', 'MR', 'heavy', 92, 16, 18, 8, 'taika'],
  ['yhime', 'Y', '🎤', 'MR', 'wrap', 84, 17, 12, 14, 'deathsong'],
  ['ando', 'プレジデントあんどう', '👔', 'MR', 'heavy', 96, 18, 15, 9, 'order'], // MR: 高難易度クエスト「社長室の決戦」のクリア報酬 (2026-11-22 12:00 から)。社長の万年筆。クエストのボスのときだけ「絶対権力」 // MR: 高難易度クエスト「Y降臨」のクリア報酬 (2026-11-22 8:00 から)。歌姫にあこがれる歌のへたなマイク。わざ「死の歌声─一方的な愛─」 // MR: 高難易度クエスト「大化の改新」のクリア報酬 (2026-11-20 23:30 から)。硯 (すずり) の皇子。かたくて攻撃もそこそこ
];
// ガチャに出ないレア度 (クエストの報酬など) の能力の倍率
const EXTRA_RARITY = { MR: { mult: 1.2 } };
const rarityMult = (r) => (RARITY[r] || EXTRA_RARITY[r]).mult;
const CARDS = Object.fromEntries(CARD_LIST.map(([id, name, emoji, rarity, type, hp, atk, def, spd, skill]) => [id, { id, name, emoji, rarity, type, hp, atk, def, spd, skill }]));
const BY_RARITY = Object.fromEntries(Object.keys(RARITY).map((r) => [r, CARD_LIST.filter((c) => c[3] === r).map((c) => c[0])]));
// ---------- 新キャラの登場日時 (この時刻より前は、ガチャにも図鑑にも出さない。端末にも送らない) ----------
// テストのときは環境変数 CB_RELEASE_<ID> (ミリ秒の時刻) で上書きできる
const RELEASES = { scissors: Date.parse('2026-11-18T10:25:00+09:00'), star: Date.parse('2026-11-18T08:00:00+09:00'), tadokoro: Date.parse('2026-11-19T08:35:00+09:00'), raijin: Date.parse('2026-11-19T08:00:00+09:00'), watermid: Date.parse('2026-11-20T08:00:00+09:00'), nakanoooe: Date.parse('2026-11-20T23:30:00+09:00'), yhime: Date.parse('2026-11-22T08:00:00+09:00'), ando: Date.parse('2026-11-22T12:00:00+09:00'), suetsugu: Date.parse('2026-11-23T08:00:00+09:00'), yumiko: Date.parse('2026-11-24T13:15:00+09:00') }; // 疾風剣士ハサミ丸: 2026 年 11 月 18 日 午前 10 時 25 分 (日本時間)
// まとめて追加したキャラ (1 体ずつではなく、まとめて 1 回だけお知らせする)
const BULK_RELEASES = [
  { id: 'mega-2026-11', name: '新キャラ 50 体 大量追加', at: Date.parse('2026-11-19T23:30:00+09:00'), ids: ["crayon", "cutter", "sharpener", "binder", "envelope", "stamp", "inkpad", "clipboard", "highlighter", "brush", "palette", "calc", "notecard", "masking", "ballpen", "punch", "bookmark", "lead", "dust", "tapecut", "fudebako", "drafting", "colors", "sketch", "magnet", "whiteboard", "abacus", "inkbottle", "quill", "label", "gluestick", "calendar", "lamp", "clock", "setsquare", "origami", "seal", "diary", "sensu", "gem", "rainbowpen", "meteorruler", "sumiryu", "crystal", "gyokuji", "phoenix", "galaxy", "raimei", "hyoketsu", "sakura"] },
];
for (const g of BULK_RELEASES) { const v = Number(process.env['CB_BULK_' + g.id.toUpperCase().replace(/-/g, '_')]); if (Number.isFinite(v) && v > 0) g.at = v; for (const id of g.ids) RELEASES[id] = g.at; }
const BULK_IDS = new Set(BULK_RELEASES.flatMap((g) => g.ids));
for (const id of Object.keys(RELEASES)) { const v = Number(process.env['CB_RELEASE_' + id.toUpperCase()]); if (Number.isFinite(v) && v > 0) RELEASES[id] = v; }
const NEW_DAYS = 7; // 登場から 7 日間は「新キャラ登場！」を出す
const isReleased = (id, now = Date.now()) => !RELEASES[id] || now >= RELEASES[id];
const releasedIds = (now = Date.now()) => CARD_LIST.map((c) => c[0]).filter((id) => isReleased(id, now));
// 期間限定キャラの排出終了 (この時刻からガチャに出ない。図鑑・持っているカード・デッキはそのまま)
const GACHA_ENDS = { suetsugu: Date.parse('2026-11-24T08:00:00+09:00'), yumiko: Date.parse('2026-11-25T13:15:00+09:00'), tadokoro: Date.parse('2026-11-20T08:29:00+09:00'), scissors: Date.parse('2026-11-20T08:29:00+09:00') }; // タドコロ・疾風剣士ハサミ丸: タドコロ ピックアップの終わりと同時に排出終了
const inGacha = (id, now = Date.now()) => isReleased(id, now) && !(GACHA_ENDS[id] && now >= GACHA_ENDS[id]);
const poolOf = (r, now = Date.now()) => (BY_RARITY[r] || []).filter((id) => inGacha(id, now));
const STARTER = ['pencil', 'eraser', 'sticky']; // はじめにもらえる 3 枚 (相性が 1 つずつ)
// レベル: Lv15 までは、同じカードを引くか、レベルアップ書 (今のレベルと同じ枚数) で上がる。
// Lv16〜20 はレベルアップ書だけで上がり、1 つにつき 50 枚 (同じカードを引いても Lv15 より上には上がらない)
const MAX_LEVEL = 20, DUP_MAX_LEVEL = 15, HIGH_LEVEL_COST = 50;
// 高難易度 (ゲキムズ) クエストのコイン: 挑戦は無料。クリアするたびに 60・はじめてのクリアは別に +1000・最速 (1 番目) +3000・準最速 (2 番目) +1500
const HARD_QUEST_WIN = 60, HARD_QUEST_FIRST = 1000, HARD_QUEST_RANK_BONUS = { 1: 3000, 2: 1500 };
const levelCost = (lv) => (lv < DUP_MAX_LEVEL ? lv : HIGH_LEVEL_COST); // Lv lv → lv+1 に使うレベルアップ書の枚数

// ガチャ限定の SSR は、同じカードを 3 枚引くと UR に昇格する (UR の倍率は下の UR_MULT)
const UR_PROMOTE = { from: 'SSR', copies: 3 };
const UR_DUP_SCROLLS = 50; // UR に昇格したあとのダブりは、レベルアップ書 50 冊に変換
const isPromoted = (cardId, copies) => CARDS[cardId]?.rarity === UR_PROMOTE.from && copies >= UR_PROMOTE.copies;
// 高難易度クエストの報酬キャラは、25 枚集めると LR に昇格 (高難易度クエストは勝つたびに 1 枚もらえる)
const LR_PROMOTE = { copies: 25, mult: 1.35 };
const lrEligible = (cardId) => QUESTS.some((q) => q.hard && q.reward === cardId);
// IppO祭の限定キャラ (ガチャ限定の SSR)。3 枚で UR、同じカードを 15 枚集めると LR に昇格 (新凸)。UR のあとのダブりも LR まではカードの枚数として数える
const FES_LIMITED = ['scissors', 'tadokoro', 'suetsugu', 'yumiko'];
const FES_LR = { copies: 15 };
const isFes = (cardId) => FES_LIMITED.includes(cardId);
const lrNeed = (cardId) => (isFes(cardId) ? FES_LR.copies : lrEligible(cardId) ? LR_PROMOTE.copies : null); // LR に必要な枚数 (LR にならないカードは null)
const isLR = (cardId, copies) => { const n = lrNeed(cardId); return n !== null && copies >= n; };
// もう昇格しきっていて、ダブりをレベルアップ書に変える状態か (祭の限定キャラは LR まで、ほかの SSR は UR まで)
const dupMaxed = (cardId, copies) => (isFes(cardId) ? isLR(cardId, copies) : isPromoted(cardId, copies));
// レベル (同じカードを引くと上がる) とレア度で強さが決まる。ur: UR に昇格したカード (true) / LR に昇格したカード ('LR')
function statsOf(cardId, level = 1, ur = false) {
  const c = CARDS[cardId], lr = ur === 'LR', m = (lr ? LR_PROMOTE.mult : ur ? UR_MULT : rarityMult(c.rarity)) * (1 + LEVEL_BONUS * (Math.min(level, MAX_LEVEL) - 1));
  return { id: c.id, name: c.name, emoji: c.emoji, rarity: lr ? 'LR' : ur ? 'UR' : c.rarity, ...(ur ? { baseRarity: c.rarity, promoted: true } : {}), type: c.type, skill: c.skill, level,
    maxHp: Math.round(c.hp * m * STAT_SCALE), atk: Math.round(c.atk * m * STAT_SCALE), def: Math.round(c.def * m * STAT_SCALE), spd: c.spd, ...(CARD_PASSIVE[c.id] ? { passive: CARD_PASSIVE[c.id] } : {}) };
}

// ---------- ガチャ ----------
const PULL_COST = 100, TEN_COST = 900, PITY = 80;
// ---------- 期間限定のガチャのセール (この期間だけ値段が変わる。終わると自動で元にもどる) ----------
// テストのときは環境変数 CB_SALE_START / CB_SALE_END (ミリ秒の時刻) で上書きできる
const SALES = [
  { name: '限定セール', start: Date.parse('2026-11-17T16:45:00+09:00'), end: Date.parse('2026-11-23T16:45:00+09:00'), pull: 30, ten: 270 }, // 11/20 16:45 まで → 11/23 16:45 まで延長
];
if (Number(process.env.CB_SALE_START) && Number(process.env.CB_SALE_END)) Object.assign(SALES[0], { start: Number(process.env.CB_SALE_START), end: Number(process.env.CB_SALE_END) });
function pricesNow(now = Date.now()) {
  const s = SALES.find((x) => now >= x.start && now < x.end);
  return s ? { pull: s.pull, ten: s.ten, sale: { name: s.name, end: s.end, pull: PULL_COST, ten: TEN_COST } } : { pull: PULL_COST, ten: TEN_COST, sale: null };
}
// ---------- 確率アップ (特定のキャラの出る確率を何倍かにする) ----------
// 1 体あたりの確率 = (そのレア度の本来の確率 ÷ そのレア度の種類数) × 倍率。上がった分だけ、ほかのレア度の確率が同じ割合で下がる
// テストのときは環境変数 CB_RATEUP_START / CB_RATEUP_END (ミリ秒の時刻、END は 0 で終わりなし) で上書きできる
const RATE_UPS = [
  { name: '恒常SSR 確率2倍', ids: ['gold', 'chalk', 'case'], mult: 2, start: Date.parse('2026-11-17T16:50:00+09:00'), end: Date.parse('2026-11-18T10:25:00+09:00') }, // 新キャラ (ハサミ丸) の登場で終わり、元の確率にもどる
];
// ---------- ピックアップ (そのキャラ 1 体の確率を決まった % にする。ほかのキャラは元の確率のまま。ふえた分は、ほかのレア度が同じ割合で下がる) ----------
// テストのときは環境変数 CB_PICKUP_START (ミリ秒の時刻) で上書きできる
const PICKUPS = [
  { name: '新キャラ ピックアップ', id: 'scissors', rate: 3, start: Date.parse('2026-11-18T10:25:00+09:00'), end: Date.parse('2026-11-19T08:35:00+09:00') }, // 疾風剣士ハサミ丸 1 体で 3% (タドコロの登場 11/19 8:35 まで)
  { name: 'タドコロ ピックアップ', id: 'tadokoro', rate: 2, start: Date.parse('2026-11-19T08:35:00+09:00'), end: Date.parse('2026-11-20T08:29:00+09:00') }, // タドコロ 1 体で 2% (11/20 8:29 まで。8:30 から筆の剣士)
  { name: 'ユミコのブチギレ祭', id: 'yumiko', rate: 2, start: Date.parse('2026-11-24T13:15:00+09:00'), end: Date.parse('2026-11-25T13:15:00+09:00') }, // 限定キャラ ユミコ 1 体で 2% (11/24 13:15〜11/25 13:15・そのあと排出終了)
  { name: '毎週月曜のIppO祭', id: 'suetsugu', rate: 2, start: Date.parse('2026-11-23T08:00:00+09:00'), end: Date.parse('2026-11-24T08:00:00+09:00') }, // 限定キャラ 魔法使いすえつぐ 1 体で 2% (11/23(月) 8:00〜11/24 8:00)
  { name: '筆の剣士 ピックアップ', id: 'brush', rate: 2, start: Date.parse('2026-11-20T08:35:00+09:00'), end: Date.parse('2026-11-21T08:30:00+09:00') }, // 筆の剣士 1 体で 2% (11/20 8:35〜11/21 8:30。8:30 開始から 8:35 に変更)
];
if (Number(process.env.CB_PICKUP_START)) PICKUPS[0].start = Number(process.env.CB_PICKUP_START);
if (Number(process.env.CB_PICKUP_END)) PICKUPS[0].end = Number(process.env.CB_PICKUP_END);
const pickupsNow = (now = Date.now()) => PICKUPS.filter((x) => now >= x.start && (!x.end || now < x.end) && inGacha(x.id, now));
if (process.env.CB_RATEUP_START) Object.assign(RATE_UPS[0], { start: Number(process.env.CB_RATEUP_START), end: Number(process.env.CB_RATEUP_END) || null });
const rateUpsNow = (now = Date.now()) => RATE_UPS.filter((x) => now >= x.start && (!x.end || now < x.end));
const weightOf = (id, now = Date.now()) => rateUpsNow(now).reduce((w, x) => (x.ids.includes(id) ? w * x.mult : w), 1);
// いまの確率 (%): レア度ごとと、1 体ごと
function ratesNow(now = Date.now()) {
  const raw = {}, fixed1 = Object.fromEntries(pickupsNow(now).map((x) => [x.id, x.rate])), fixedIn = {};
  for (const [r, v] of Object.entries(RARITY)) {
    const pool = poolOf(r, now).filter((id) => !(id in fixed1));               // ピックアップのキャラは別に数える
    fixedIn[r] = poolOf(r, now).filter((id) => id in fixed1).reduce((a, id) => a + fixed1[id], 0);
    raw[r] = (pool.length ? v.rate * pool.reduce((a, id) => a + weightOf(id, now), 0) / pool.length : 0) + fixedIn[r];
  }
  const boosted = Object.keys(RARITY).filter((r) => raw[r] !== RARITY[r].rate || fixedIn[r]);
  const fixed = boosted.reduce((a, r) => a + raw[r], 0), restBase = Object.keys(RARITY).filter((r) => !boosted.includes(r)).reduce((a, r) => a + RARITY[r].rate, 0);
  const rates = {};
  for (const r of Object.keys(RARITY)) rates[r] = boosted.includes(r) ? raw[r] : RARITY[r].rate * (100 - fixed) / restBase;
  const perCard = {};
  for (const r of Object.keys(RARITY)) {
    const pool = poolOf(r, now).filter((id) => !(id in fixed1)), tw = pool.reduce((a, id) => a + weightOf(id, now), 0);
    for (const id of pool) perCard[id] = (rates[r] - fixedIn[r]) * weightOf(id, now) / tw;
    for (const id of poolOf(r, now)) if (id in fixed1) perCard[id] = fixed1[id];
  }
  return { rates, perCard };
}
function rollRarity(rnd, now = Date.now()) {
  const { rates } = ratesNow(now);
  let u = rnd() * 100;
  for (const r of Object.keys(RARITY)) { u -= rates[r]; if (u < 0) return r; }
  return 'N';
}
// そのレア度の中から 1 体えらぶ (確率アップのキャラは重みが大きい)
function pickIn(r, rnd, now) {
  const pc = ratesNow(now).perCard, list = poolOf(r, now), w = list.map((id) => pc[id] || 0);
  let u = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { u -= w[i]; if (u < 0) return list[i]; }
  return list[list.length - 1];
}
// n 回引く。pity は「最後に SSR が出てからの回数」。10 連の最後の 1 枚は SR 以上
function pull(n, pity, rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32, now = Date.now()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = rollRarity(rnd, now);
    if (pity + 1 >= PITY) r = 'SSR';                                         // 天井
    else if (n === 10 && i === 9 && !out.some((x) => x.rarity === 'SR' || x.rarity === 'SSR') && (r === 'N' || r === 'R')) r = 'SR';
    pity = r === 'SSR' ? 0 : pity + 1;
    out.push({ id: pickIn(r, rnd, now), rarity: r }); // まだ登場していないキャラは出ない
  }
  return { cards: out, pity };
}

// ---------- 対戦の判定 (同じ入力なら同じ結果になる純粋な関数。乱数は外から渡す) ----------
const TURN_LIMIT = 30, SKILL_CD = 2; // わざを使うと、次の 2 ターンは使えない
const SWEEP_ACTIVE = 1.4, SWEEP_BENCH = 0.8; // 疾風斬り: 場のカードに 1.4 倍、控えに 0.8 倍
const POISON_RATE = 0.08, POISON_TURNS = 3; // 毒: ターンの終わりに最大 HP の 8%、3 ターン (かけ直すと 3 ターンにもどる。重ねがけはしない)
const THUNDER_POWER = 2.3; // 落雷: 2.3 倍の無属性こうげき
const SERMON_ATK = 0.6;   // 説教: 相手の攻撃力を 0.6 倍
const TAIKA_POWER = 1.2;  // 大化の改新: 1.2 倍のこうげき + 味方の状態異常・デバフをすべて取りのぞく
const ORDER_ACTIVE = 1.5, ORDER_BENCH = 0.7; // 社長命令: 場のカードに 1.5 倍・控えに 0.7 倍の無属性こうげき
// 絶対権力 (クエスト「社長室の決戦」のボスだけ): わざを封じられる (DNAを取り出す) までは、どんなダメージも受けない
const immune = (c) => !!c.tyrant && !(c.sealed > 0);
const TYRANT_PIERCE = Number(process.env.CB_TYRANT_PIERCE) || 1; // ただし「つらぬく」は絶対権力をつらぬく (すえつぐなしの、難しい勝ち筋。Lv18 で つらぬく 2 枚のデッキは勝率 約 13%・1 枚は 約 6%、すえつぐ入りは 25%)
const DEATHSONG_POWER = 1.2; // 死の歌声─一方的な愛─: 1.2 倍のこうげき + このターンに受けた相手が使い手を倒すと、相手のカードをランダムで 1 枚道連れ
const DNA_POWER = 1.8; // DNAを取り出す: 1.8 倍のこうげき + 相手の場のカードは、そのバトル中ずっとわざを使えない (わざ封じ。交代しても・大化の改新でも戻らない)
// ボスクエスト (高難易度クエスト) で使えるアイテム。対戦中にコインで買って、その場で使う (そのターンの行動になる)
const ITEMS = {
  potion: { name: '回復薬', emoji: '🧪', price: 300, desc: '場のカードの HP を最大 HP の 30% 回復' },
  elixir: { name: '全回復薬', emoji: '💖', price: 1000, desc: '場のカードの HP を全回復' },
  tea: { name: 'アイスティー', emoji: '🧋', price: 1200, desc: '相手の場のカードを眠らせる: 次のターン動けない (怯みと同じ)' },
};
const ITEMS_AFTER = 30 * 60_000; // クエストが始まってから 30 分後から使える
const METEOR_TURNS = 5, METEOR_RATE = 0.3; // 流星: 5 ターン、ターンの終わりに相手の場のカードへ最大 HP の 30% (ガード無視)
function newSide(cards) { return { cards: cards.map((c) => ({ ...c, hp: c.maxHp, cd: 0, poison: 0 })), active: 0, meteor: null }; }
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
    if (a.a === 'item' && ITEMS[a.item]) return a; // アイテムは怯んでいても使える (使うのはプレイヤー)
    if (me.flinch === 1) return { a: 'flinch' }; // 怯み: 交代のほかは何もできない
    if (a.a === 'skill' && me.cd === 0 && !(me.sealed > 0)) return a; // わざ封じ (DNAを取り出す) のあいだは、わざのかわりにこうげき
    if (a.a === 'attack' || a.a === 'skill') return { a: 'attack' };
    return { a: 'guard' };
  });
  // 1. 交代はいちばん先
  [0, 1].forEach((p) => { if (act[p].a === 'switch') { sides[p].active = act[p].i; ev.push({ k: 'switch', p, card: sides[p].cards[act[p].i].name }); } });
  // 1.5 アイテム (交代の次、こうげきより先)
  [0, 1].forEach((p) => {
    if (act[p].a !== 'item') return;
    const it = act[p].item, me = sides[p].cards[sides[p].active];
    if (it === 'potion' || it === 'elixir') {
      const h = Math.min(me.maxHp - me.hp, it === 'elixir' ? me.maxHp : Math.round(me.maxHp * 0.3));
      me.hp += h; ev.push({ k: 'item', p, item: it, name: ITEMS[it].name, card: me.name, amount: h });
    } else if (it === 'tea') {
      const o = 1 - p, foe = sides[o].cards[sides[o].active];
      ev.push({ k: 'item', p, item: it, name: ITEMS[it].name, target: foe.name });
      if (foe.hp > 0) { foe.flinch = 2; foe.sleep = true; ev.push({ k: 'flinched', p: o, card: foe.name, sleep: true }); }
    }
  });
  // 2. ガード・バリア
  const skillOf = (p) => act[p].a === 'skill' ? sides[p].cards[sides[p].active].skill : null;
  const guard = [0, 1].map((p) => act[p].a === 'guard' ? 0.4 : skillOf(p) === 'barrier' ? 0 : skillOf(p) === 'heal' ? 0.5 : 1);
  // 3. 素早い順に行動 (同じなら乱数)
  const order = [0, 1].sort((x, y) => {
    const a = sides[x].cards[sides[x].active].spd, b = sides[y].cards[sides[y].active].spd;
    return b - a || (rnd() < 0.5 ? -1 : 1);
  });
  const loved = new Map(); // 死の歌声: 歌を受けたカード → 歌ったカード (このターンだけ)
  // opt.target: 相手の何枚目に当てるか (なければ場に出ているカード)。opt.typeless: 相性をかけない (無属性)
  const hit = (p, power, opt = {}) => {
    const me = sides[p].cards[sides[p].active], o = 1 - p;
    const ti = opt.target ?? sides[o].active, foe = sides[o].cards[ti], bench = ti !== sides[o].active;
    const tyr = immune(foe);
    if (tyr && !opt.pierce) { ev.push({ k: 'immune', p: o, card: foe.name, bench }); return 0; } // 絶対権力: ダメージなし (つらぬく だけは通る)
    const tm = opt.typeless ? 1 : typeMult(me.type, foe.type);
    const base = opt.pierce ? me.atk * power * 2 : me.atk * power * 2 - foe.def * 0.6; // 1 枚あたり 3〜4 回の攻撃で倒れるくらい
    let dmg = Math.max(1, Math.round(base * tm * (0.9 + rnd() * 0.2)));
    const g = bench ? 1 : guard[o];                                   // ガード・バリアが守るのは場に出ているカードだけ
    if (!opt.pierce) dmg = Math.round(dmg * g);
    if (tyr) dmg = Math.max(1, Math.round(dmg * TYRANT_PIERCE)); // つらぬく: 絶対権力をつらぬく
    dmg = Math.min(dmg, foe.hp);
    foe.hp -= dmg;
    const wasLoved = foe.hp <= 0 && loved.get(me) === foe; // 一方的な愛: 歌を受けた me が、歌った foe をこのターンに倒した
    ev.push({ k: 'hit', p, card: me.name, target: foe.name, dmg, ...(tyr ? { tyrantPierce: true } : {}), eff: tm > 1 ? 'good' : tm < 1 ? 'bad' : '', guarded: !opt.pierce && g < 1, bench, typeless: !!opt.typeless });
    if (foe.hp <= 0) ev.push({ k: 'ko', p: o, card: foe.name, bench });
    if (wasLoved) { // 道連れ: 倒した側 (p) の場と控えの生きているカードから、ランダムで 1 枚を倒す
      loved.delete(me);
      const live = sides[p].cards.map((c, i) => [c, i]).filter(([c]) => c.hp > 0); /* 絶対権力 (あんどう) も道連れにできる */
      if (live.length) { const [v, vi] = live[Math.floor(rnd() * live.length)]; v.hp = 0; v.poison = 0;
        ev.push({ k: 'curse', p, by: foe.name, card: v.name, bench: vi !== sides[p].active }); ev.push({ k: 'ko', p, card: v.name, bench: vi !== sides[p].active }); }
    }
    return dmg;
  };
  // 行動できなくする わざ (野獣の眼光) を相手より先に使ったら、相手はそのターンもう動けない (こうげき・わざができない。ガードと交代はそのまま)
  const stunNow = new Set(), acted = new Set();
  for (const p of order) {
    const s = sides[p], me = s.cards[s.active];
    acted.add(p);
    if (stunNow.has(p) && (act[p].a === 'attack' || act[p].a === 'skill')) { if (me.hp > 0) ev.push({ k: 'flinch', p, card: me.name }); continue; }
    if (act[p].a === 'flinch') { if (me.hp > 0) ev.push({ k: 'flinch', p, card: me.name, sleep: !!me.sleep }); continue; }
    if (act[p].a === 'item') continue;
    if (me.hp <= 0 || act[p].a === 'switch' || act[p].a === 'guard') { if (act[p].a === 'guard' && me.hp > 0) ev.push({ k: 'guard', p, card: me.name }); continue; }
    if (act[p].a === 'attack') hit(p, 1);
    else {
      me.cd = SKILL_CD; usedSkill.add(me);
      ev.push({ k: 'skill', p, card: me.name, skill: SKILLS[me.skill].name, id: me.skill });
      if (me.skill === 'power') hit(p, 1.8);
      else if (me.skill === 'pierce') hit(p, 1.3, { pierce: true });
      else if (me.skill === 'drain') { const d = hit(p, 1.2); const h = Math.min(me.maxHp - me.hp, Math.round(d / 2)); me.hp += h; if (h) ev.push({ k: 'heal', p, card: me.name, amount: h }); }
      else if (me.skill === 'heal') { const h = Math.min(me.maxHp - me.hp, Math.round(me.maxHp * 0.45)); me.hp += h; ev.push({ k: 'heal', p, card: me.name, amount: h }); }
      else if (me.skill === 'barrier') hit(p, 0.8);
      else if (me.skill === 'sweep') { // 場のカードに 1.4 倍・控えに 0.8 倍の無属性こうげき + 全員に毒
        const o = 1 - p, got = [], act0 = sides[o].active;
        sides[o].cards.forEach((c, i) => { if (c.hp > 0) { hit(p, i === act0 ? SWEEP_ACTIVE : SWEEP_BENCH, { target: i, typeless: true }); if (c.hp > 0) { c.poison = POISON_TURNS; got.push(c.name); } } });
        if (got.length) ev.push({ k: 'poisoned', p: o, cards: got });
      } else if (me.skill === 'thunder') hit(p, THUNDER_POWER, { typeless: true }); // 落雷: 2.3 倍の無属性こうげき
      else if (me.skill === 'sermon') { // 説教: 相手の場のカードの攻撃力を 0.6 倍 (1 枚につき 1 回) + 味方全員の毒を治す
        const o = 1 - p, foe = sides[o].cards[sides[o].active];
        let from = null;
        if (foe.hp > 0 && !foe.scolded) { from = foe.atk; foe.atk = Math.max(1, Math.round(foe.atk * SERMON_ATK)); foe.scolded = true; }
        const cured = sides[p].cards.filter((c) => c.hp > 0 && c.poison > 0); cured.forEach((c) => { c.poison = 0; });
        ev.push({ k: 'sermon', p, card: me.name, target: foe.name, from, to: from === null ? null : foe.atk, cured: cured.map((c) => c.name) });
      }
      else if (me.skill === 'taika') { // 大化の改新: 1.2 倍のこうげき → 味方全員の毒・怯み・眠り・説教の攻撃ダウン・流星を取りのぞく
        hit(p, TAIKA_POWER);
        const fixed = [];
        sides[p].cards.forEach((c) => {
          if (c.hp <= 0) return;
          const got = [];
          if (c.poison > 0) { c.poison = 0; got.push('毒'); }
          if (c.flinch) { c.flinch = 0; got.push(c.sleep ? '眠り' : '怯み'); } c.sleep = false;
          if (c.scolded) { c.atk = Math.round(c.atk / SERMON_ATK); c.scolded = false; got.push('攻撃ダウン'); } // 説教の分をもどす (また説教されることはある)
          if (got.length) fixed.push({ card: c.name, what: got });
        });
        const meteor = !!sides[p].meteor; if (meteor) { sides[p].meteor = null; }
        ev.push({ k: 'taika', p, card: me.name, fixed, meteor });
      }
      else if (me.skill === 'order') { // 社長命令: 場のカードに 1.5 倍・控えに 0.7 倍の無属性こうげき
        const o = 1 - p, act0 = sides[o].active;
        sides[o].cards.forEach((c, i) => { if (c.hp > 0) hit(p, i === act0 ? ORDER_ACTIVE : ORDER_BENCH, { target: i, typeless: true }); });
      }
      else if (me.skill === 'deathsong') { // 死の歌声─一方的な愛─: 1.2 倍のこうげき → 受けた相手に「一方的な愛」の印 (このターンだけ)
        const o = 1 - p, foe = sides[o].cards[sides[o].active];
        hit(p, DEATHSONG_POWER);
        if (foe.hp > 0 && me.hp > 0) { loved.set(foe, me); ev.push({ k: 'deathsong', p, card: me.name, target: foe.name }); }
      }
      else if (me.skill === 'buchigire') { // ブチギレおばさん: 相手の場のカードを道連れにして、自分も倒れる (ガード・バリア・絶対権力に関係なく)
        const o = 1 - p, foe = sides[o].cards[sides[o].active];
        if (foe.hp > 0) {
          foe.hp = 0; foe.poison = 0; me.hp = 0; me.poison = 0;
          ev.push({ k: 'buchigire', p, card: me.name, target: foe.name });
          ev.push({ k: 'ko', p: o, card: foe.name }); ev.push({ k: 'ko', p, card: me.name });
        }
      }
      else if (me.skill === 'dna') { // DNAを取り出す: 相手の場のカードのわざを、そのバトル中ずっと封じる → 1.8 倍のこうげき
        // 先に封じる (絶対権力もここで崩れるので、DNA のこうげきからダメージが通る)
        const o = 1 - p, foe = sides[o].cards[sides[o].active];
        if (foe.hp > 0) { const again = foe.sealed > 0; foe.sealed = 1; ev.push({ k: 'sealed', p: o, card: foe.name, by: me.name, again }); if (foe.tyrant && !again) ev.push({ k: 'tyrantdown', p: o, card: foe.name }); }
        hit(p, DNA_POWER);
      }
      else if (me.skill === 'venom') { // 野獣の眼光: 場のカードを毒にして怯ませる (ダメージはなし)。相手より先なら、そのターンの相手の行動を止める・後なら次のターン
        const o = 1 - p, foe = sides[o].cards[sides[o].active];
        if (foe.hp > 0) {
          const now = !acted.has(o); foe.poison = POISON_TURNS;
          if (now) stunNow.add(o); else foe.flinch = 2;
          ev.push({ k: 'poisoned', p: o, cards: [foe.name] }); ev.push({ k: 'flinched', p: o, card: foe.name, now });
        }
      } else if (me.skill === 'starlight') { // 相手の盤面に流星を降らせる (このターンの終わりから 5 ターン)
        const o = 1 - p;
        sides[o].meteor = { left: METEOR_TURNS, atk: me.atk, by: me.name };
        ev.push({ k: 'starfall', p, target: o, card: me.name, turns: METEOR_TURNS });
      }
    }
  }
  // 4. 流星 (ターンの終わりに、相手の場のカードへ。使ったカードが倒れても続く)
  [0, 1].forEach((p) => {
    const m = sides[p].meteor; if (!m || m.left <= 0) return;
    let i = sides[p].active; if (sides[p].cards[i].hp <= 0) i = sides[p].cards.findIndex((c) => c.hp > 0);
    m.left--;
    if (i >= 0) {
      const c = sides[p].cards[i];
      if (immune(c)) { ev.push({ k: 'immune', p, card: c.name }); if (m.left <= 0) sides[p].meteor = null; return; }
      const dmg = Math.min(c.hp, Math.max(1, Math.round(c.maxHp * METEOR_RATE)));
      c.hp -= dmg;
      ev.push({ k: 'meteor', p, card: c.name, dmg, left: m.left });
      if (c.hp <= 0) { c.poison = 0; ev.push({ k: 'ko', p, card: c.name, bench: i !== sides[p].active }); }
    }
    if (m.left <= 0) sides[p].meteor = null;
  });
  // 4. 毒 (ターンの終わりに、毒のあるカードは最大 HP の 8% のダメージ。控えのカードも)
  [0, 1].forEach((p) => {
    sides[p].cards.forEach((c, i) => {
      if (!(c.poison > 0) || c.hp <= 0) return;
      if (immune(c)) { c.poison--; return; } // 絶対権力: 毒も効かない
      const dmg = Math.min(c.hp, Math.max(1, Math.round(c.maxHp * POISON_RATE)));
      c.hp -= dmg; c.poison--;
      ev.push({ k: 'poison', p, card: c.name, dmg, left: c.poison, bench: i !== sides[p].active });
      if (c.hp <= 0) { c.poison = 0; ev.push({ k: 'ko', p, card: c.name, bench: i !== sides[p].active }); }
    });
  });
  // 4.4 パッシブ「セントラルドグマ」: 控えで生きているあいだ、味方全員 (生きているカード) の HP を最大 HP の 10% 回復 (控えに何枚いても 1 回だけ)
  [0, 1].forEach((p) => {
    const s = sides[p], src = s.cards.find((c, i) => c.passive === 'dogma' && c.hp > 0 && i !== s.active);
    if (!src) return;
    const healed = [];
    s.cards.forEach((c) => { if (c.hp <= 0 || c.hp >= c.maxHp) return; const h = Math.min(c.maxHp - c.hp, Math.max(1, Math.round(c.maxHp * DOGMA_RATE))); c.hp += h; healed.push({ card: c.name, amount: h }); });
    if (healed.length) ev.push({ k: 'dogma', p, card: src.name, healed });
  });
  // 4.5 パッシブ「士気」: 倒れたカードに士気があれば、生き残っている味方の攻撃・防御が上がる (1 回だけ)
  [0, 1].forEach((p) => {
    sides[p].cards.forEach((c) => {
      if (c.passive !== 'morale' || c.hp > 0 || c.moraleDone) return;
      c.moraleDone = true;
      const up = sides[p].cards.filter((x) => x !== c && x.hp > 0);
      up.forEach((x) => { x.atk = Math.round(x.atk * MORALE_ATK); x.def = Math.round(x.def * MORALE_DEF); x.morale = true; });
      if (up.length) ev.push({ k: 'morale', p, card: c.name, cards: up.map((x) => x.name) });
    });
  });
  // 5. わざの待ち時間を減らし、倒れたカードは次のカードに交代
  [0, 1].forEach((p) => {
    const s = sides[p];
    s.cards.forEach((c) => { if (c.cd > 0 && !usedSkill.has(c)) c.cd--; if (c.flinch > 0) c.flinch--; if (!c.flinch) c.sleep = false; });
    if (s.cards[s.active].hp <= 0) { const next = s.cards.findIndex((c) => c.hp > 0); if (next >= 0) { s.active = next; ev.push({ k: 'switch', p, card: s.cards[next].name, forced: true }); } }
  });
  state.turn++;
  // 5. 勝ち負け
  const left = [alive(sides[0]), alive(sides[1])];
  if (!left[0] || !left[1]) state.winner = !left[0] && !left[1] ? -1 : left[0] ? 0 : 1;
  else if (state.turn >= TURN_LIMIT) {
    const pct = sides.map((s) => s.cards.reduce((a, c) => a + c.hp / c.maxHp, 0));
    state.winner = Number.isInteger(state.timeupWinner) ? state.timeupWinner : Math.abs(pct[0] - pct[1]) < 1e-9 ? -1 : pct[0] > pct[1] ? 0 : 1; // timeupWinner: 時間切れなら負け のクエスト
    ev.push({ k: 'timeup' });
  }
  return ev;
}
// CPU の行動: わざが使えれば使う (回復は HP が減っているときだけ)。相性が悪ければ時々交代
function cpuAct(state, p, rnd) {
  const s = state.sides[p], me = s.cards[s.active], foe = state.sides[1 - p].cards[state.sides[1 - p].active];
  const meteorLeft = state.sides[1 - p].meteor?.left || 0;
  const sermonUseful = !foe.scolded || s.cards.some((c) => c.hp > 0 && c.poison > 0);
  if (me.cd === 0 && !(me.sealed > 0) && (me.skill !== 'heal' || me.hp < me.maxHp * 0.55) && (me.skill !== 'starlight' || meteorLeft <= 1) && (me.skill !== 'sermon' || sermonUseful) && rnd() < 0.8) return { a: 'skill' };
  if (typeMult(foe.type, me.type) > 1 && rnd() < 0.5) {
    const i = s.cards.findIndex((c, k) => k !== s.active && c.hp > c.maxHp * 0.4 && typeMult(c.type, foe.type) >= 1);
    if (i >= 0) return { a: 'switch', i };
  }
  return { a: rnd() < 0.8 ? 'attack' : 'guard' };
}
// 強い CPU: 行動の候補 (こうげき・ガード・わざ・交代) ごとに、この先の試合を何回もシミュレーションして、いちばん勝ちやすいものを選ぶ。
// 相手が選んだ行動は見ない (ターンの初めに決める)。見るのは画面にも出ている情報 (HP・わざの待ち時間・毒・流星) だけ
const CPU_ROLLOUTS = Number(process.env.CB_CPU_ROLLOUTS) || 48, CPU_DEPTH = 12;
function score(state, p) { // 0 (負け) 〜 1 (勝ち)。決着していなければ、残りの HP の割合で見積もる
  if (state.winner !== null) return state.winner === p ? 1 : state.winner === -1 ? 0.5 : 0;
  const hp = (s) => s.cards.reduce((x, c) => x + Math.max(0, c.hp) / c.maxHp, 0) + s.cards.filter((c) => c.hp > 0).length * 0.35;
  const a = hp(state.sides[p]), b = hp(state.sides[1 - p]);
  return 0.5 + 0.5 * (a - b) / Math.max(1, a + b);
}
function candidates(state, p) {
  const s = state.sides[p], me = s.cards[s.active], out = [{ a: 'attack' }, { a: 'guard' }];
  if (me.cd === 0 && !(me.sealed > 0)) out.push({ a: 'skill' });
  s.cards.forEach((c, i) => { if (i !== s.active && c.hp > 0) out.push({ a: 'switch', i }); });
  return out;
}
function smartAct(state, p, rnd, rollouts = CPU_ROLLOUTS) {
  const opts = candidates(state, p);
  if (opts.length === 1) return opts[0];
  let best = opts[0], bestV = -1;
  for (const opt of opts) {
    let v = 0;
    for (let r = 0; r < rollouts; r++) {
      const st = structuredClone(state); st.winner = null;
      // 相手の行動は「ふつうの CPU」が選びそうなものと、ときどきでたらめなもので見積もる
      const o = 1 - p, oc = candidates(st, o), oa = rnd() < 0.25 ? oc[Math.floor(rnd() * oc.length)] : cpuAct(st, o, rnd);
      const acts = []; acts[p] = opt; acts[o] = oa;
      resolveTurn(st, acts, rnd);
      for (let d = 0; d < CPU_DEPTH && st.winner === null; d++) resolveTurn(st, [cpuAct(st, 0, rnd), cpuAct(st, 1, rnd)], rnd);
      v += score(st, p);
    }
    v /= rollouts;
    if (v > bestV + 1e-9) { bestV = v; best = opt; }
  }
  return best;
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
  count INTEGER NOT NULL DEFAULT 1,            -- 持っている枚数 (レベル = 枚数 + レベルアップ書の分。最大 15)
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

// 競走馬版から連れてきた馬のカード (1 日 3 頭まで・同じ馬は 1 回だけ)。能力・わざ・相性は連れてきたときにサーバーが決めて保存する
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
// ブリードモンスターズのモンスターを連れてきたカード (カードの ID は 'm:' + id)。連れてきた時の姿・強さを写しとる (あとから「最新の強さにする」で写し直せる)
const MONCARD_MIGRATION = `
CREATE TABLE card_monsters (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monster_id TEXT NOT NULL,                              -- ブリードモンスターズのモンスター
  name TEXT NOT NULL, look TEXT NOT NULL, mon_type TEXT NOT NULL, mon_rank TEXT NOT NULL,   -- 絵と表示用
  type TEXT NOT NULL, skill TEXT NOT NULL, rarity TEXT NOT NULL,
  hp INTEGER NOT NULL, atk INTEGER NOT NULL, def INTEGER NOT NULL, spd INTEGER NOT NULL,   -- Lv1・レア度の倍率をかける前
  level INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, monster_id)
);
CREATE INDEX card_monsters_user ON card_monsters(user_id, created_at);
`;
// モンスターの評価 → カードのレア度。能力はモンスターの能力に比例 (上限なし。育てるほど強い)。はじめのモンスター (HP280・攻55・防55・速50) が R の平均くらい
// 突然変異 R 以上のモンスターは「限定級」: 能力は恒常の SSR (ガチャにずっと出る SSR) の平均くらいにそろえる (平均の 95%〜100%。上限あり)。倍率は SSR と同じ 1.12
const MONCARD_FORMULA = 6; // 6: 変異なし (限定級でない) を +5% (MONCARD_PLAIN_BONUS) // 3: 限定級の下限を STAT_SCALE に合わせた・4: 限定級を弱く (下限 90%・倍率 1.2 → 1.12)・5: 限定級を恒常 SSR の平均くらいに (上限 100%・倍率は評価 Z でも 1.12) // 能力の計算のしかたの版 (上げると、起動時に連れてきたカードを計算し直す)
const MONCARD_SCALE = { hp: 66.6 / 280, atk: 16.2 / 55, def: 11.1 / 55, spd: 10.8 / 50 };
const MONCARD_PLAIN_BONUS = 1.05; // 2026-11-22: 変異なしのモンスターのカードは HP・攻撃・防御・速さ +5%
const MONCARD_LIMITED = ['tadokoro', 'scissors', 'star', 'raijin', 'watermid'], MONCARD_LIMITED_MULT = 1.12, MONCARD_LIMITED_FLOOR = 0.95, MONCARD_LIMITED_CAP = 1.0;
const MUT_ORDER = ['N', 'R', 'SR', 'SSR', 'UR', 'MR'];
const MONCARD_RARITY = { C: 'N', B: 'R', A: 'SR', S: 'SSR', SS: 'SSR', Z: 'MR' }; // Z だけ MR (強さは SSR の平均 × MR の倍率 1.2)
// 属性 → 相性 (火 > 草 > 水 > 火 が、きる > つつむ > おもい > きる と同じ向きになるように)
const MONCARD_TYPE = { fire: 'cut', grass: 'wrap', water: 'heavy', light: 'cut', dark: 'wrap', king: 'heavy' };
const MONCARD_SKILL = { fire: 'power', water: 'heal', grass: 'drain', light: 'barrier', dark: 'pierce', king: 'power' };
function monCardBase(m) {
  const rarity = MONCARD_RARITY[m.rank] || 'N';
  const limited = MUT_ORDER.indexOf(m.mutant) >= 1; // 突然変異 R 以上
  const own = { hp: m.hp * MONCARD_SCALE.hp, atk: Math.max(m.atk, m.mag) * MONCARD_SCALE.atk, def: m.def * MONCARD_SCALE.def, spd: m.spd * MONCARD_SCALE.spd };
  // 恒常の SSR = ガチャに出る SSR のうち、排出が終わる限定キャラ (GACHA_ENDS) と限定キャラ (MONCARD_LIMITED) をのぞいたもの
  const std = CARD_LIST.filter((c) => c[3] === 'SSR' && !GACHA_ENDS[c[0]] && !MONCARD_LIMITED.includes(c[0]) && !PICKUPS.some((p) => p.id === c[0] && /祭/.test(p.name))), savg = (i) => std.reduce((a, c) => a + c[i], 0) / std.length;
  const base = { hp: savg(5) * STAT_SCALE, atk: savg(6) * STAT_SCALE, def: savg(7) * STAT_SCALE, spd: savg(8) };
  const st = (k) => Math.max(1, Math.round(limited ? Math.min(base[k] * MONCARD_LIMITED_CAP, Math.max(own[k], base[k] * MONCARD_LIMITED_FLOOR)) : own[k] * MONCARD_PLAIN_BONUS));
  return { rarity, limited, type: MONCARD_TYPE[m.type] || 'cut', skill: MONCARD_SKILL[m.type] || 'power', hp: st('hp'), atk: st('atk'), def: st('def'), spd: st('spd') };
}
// キャラ専用のわざ (馬には付けない): 疾風斬り = 疾風剣士ハサミ丸、スターライトマーチ = 星キャンディー
const EXCLUSIVE_SKILLS = ['sweep', 'starlight', 'venom', 'thunder', 'sermon', 'taika', 'dna', 'deathsong', 'order', 'buchigire'];
// すでに専用わざが付いてしまった馬は、ふつうのわざ (ランダム) に付け直す (起動時に 1 回だけ。能力はそのまま)
const HORSE_SKILL_FIX = `UPDATE card_horses SET skill = CASE abs(random()) % 5 WHEN 0 THEN 'power' WHEN 1 THEN 'pierce' WHEN 2 THEN 'drain' WHEN 3 THEN 'heal' ELSE 'barrier' END
  WHERE skill IN ('sweep', 'starlight');`;
// SSR の文房具の平均を基準に、それぞれ ±12% でランダム (SSR と同じ +12% もつく)
function rollHorse(rnd) {
  const ssr = ['gold', 'chalk', 'case'].map((id) => CARDS[id]);
  const avg = (k) => ssr.reduce((a, c) => a + c[k], 0) / ssr.length;
  const r = (k) => avg(k) * (0.88 + rnd() * 0.24);
  const types = Object.keys(TYPES), skills = Object.keys(SKILLS).filter((k) => !EXCLUSIVE_SKILLS.includes(k));
  return { type: types[Math.floor(rnd() * types.length)], skill: skills[Math.floor(rnd() * skills.length)],
    hp: Math.round(r('hp')), atk: Math.round(r('atk')), def: Math.round(r('def')), spd: Math.max(3, Math.round(avg('spd') * (0.7 + rnd() * 0.6))) };
}
// 連れてきた馬が UR に昇格する確率 (競走馬版でのランクが高いほど高い)。UR は能力 +20% (SSR は +12%)
const HORSE_UR_CHANCE = { UR: 0.15, SSR: 0.08, SR: 0.04, R: 0.02, N: 0.01 };
const HORSE_UR_MIGRATION = `ALTER TABLE card_horses ADD COLUMN rarity TEXT NOT NULL DEFAULT 'SSR';`; // 'SSR' か 'UR'
// レベルアップ書: 試合をこなすともらえる (3 ターン以上戦った試合だけ。勝ち 2 枚・負けと引き分け 1 枚、こうさんした側は 0)。
// レベル n → n+1 に n 枚使う。同じカードを引いて上がるレベル (枚数) と合わせて最大 Lv15
const SCROLL_REWARD = { win: 2, lose: 1, draw: 1 }, SCROLL_MIN_TURNS = 3;
const HARD_QUEST_SCROLLS = 4; // 高難易度クエストで勝つと、レベルアップ書 4 冊
const COINS_PER_SCROLL = 50;  // コインでもレベルを上げられる: レベルアップ書 1 冊ぶん = 50 コイン
// Lv15 より上に上げた分 (レベルアップ書だけで上がる。同じカードを引いた分とは別に数える)
const HIGH_LEVEL_MIGRATION = `ALTER TABLE card_owned ADD COLUMN lv_high INTEGER NOT NULL DEFAULT 0;`;
// 称号 (高難易度クエストの最速クリアなど)。title は表示する名前、source はどこでもらったか
const TITLE_MIGRATION = `
CREATE TABLE user_titles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, source)
);
`;
// 試合ごとに使ったデッキ (カードの ID の JSON。CPU の側は NULL) を残して、採用率を「その期間の試合で使われた回数」で出す
const BATTLE_DECK_MIGRATION = `
ALTER TABLE card_battles ADD COLUMN d1 TEXT;
ALTER TABLE card_battles ADD COLUMN d2 TEXT;
CREATE INDEX card_battles_created ON card_battles(created_at);
`;
const SCROLL_MIGRATION = `
ALTER TABLE card_players ADD COLUMN scrolls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE card_owned ADD COLUMN lv_bonus INTEGER NOT NULL DEFAULT 0;   -- レベルアップ書で上げた分
ALTER TABLE card_horses ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
`;
// ---------- 期間限定クエスト ----------
// 決まった敵のデッキ (CPU) に勝つとクリア。はじめてクリアしたときだけ報酬のカードがもらえる。期間はサーバーの時刻で決める
// テストのときは環境変数 CB_QUEST_START / CB_QUEST_END (ミリ秒の時刻) で上書きできる
const QUESTS = [
  { id: 'starlight-2026', name: '星降る夜のクエスト', boss: '流れ星の三騎士', emoji: '🌠', reward: 'star', bg: 'starlight', // bg: 対戦の背景 (public/bg/<bg>.svg。tools/make_quest_bg.js で作る)
    pr: 'わざ「スターライトマーチ」は 5 ターンのあいだ流星を降らせる！',
    text: '夜空から現れた 3 体のキャラクター。勝てば MR「星キャンディー」が仲間になる！',
    tip: '星キャンディーの「スターライトマーチ」は、5 ターンのあいだ毎ターン流星でダメージを与えてきます。相性 (✂️きる は 📄つつむ に強い) を考えてデッキを組もう！',
    enemy: [['star', 2], ['leaf', 3], ['gold', 1]],
    start: Date.parse('2026-11-18T08:00:00+09:00'), end: Date.parse('2026-11-22T03:25:00+09:00') }, // 11/25 8:00 まで → 11/22 3:25 で終わり
  // 高難易度 (hard): 敵は先を読む強い CPU。能力に boost をかける (雷神降臨は 1.1 倍。Lv18 の SSR・MR デッキで勝率 タドコロ入り 23% / なし 13% くらい)
  { id: 'raijin-2026', name: '雷神降臨', boss: '雷神クリりん', emoji: '⚡', reward: 'raijin', bg: 'raijin-night', award: '雷鳴が止んだ…伝説の始まりだ🔥🔥🔥', hard: true, boost: 1.1,
    hint: '敵は全員 ✂️きる → 🪨おもいのタドコロが有利！',
    pr: 'わざ「落雷」は、どんな相性でも 2.3 倍の無属性こうげき！ 敵は先を読む強い CPU。\n敵は全員 ✂️きる。🪨おもいのタドコロが大活躍！ 野獣の眼光で怯ませれば落雷も止められる！',
    text: '雷鳴とともに現れた魔人「雷神クリりん」。落雷はどんな相性でも 2.3 倍！ 勝てば MR「雷神クリりん」が仲間になる',
    tip: '敵は 3 体とも ✂️きる タイプ。🪨おもい のカード、とくにタドコロが有利！ タドコロの「野獣の眼光」で怯ませると、次のターンの落雷 (相性に関係なく 2.3 倍) を止められる。敵は先を読む強い CPU なので、ガードと交代のタイミングが勝負！',
    enemy: [['raijin', 20], ['scissors', 20], ['gold', 20]],
    titles: { 1: '栗りん最速クリア🌰', 2: '栗りん準最速クリア🌰' }, // 1 番目・2 番目にクリアした人の称号 (プロフィールなどに出る)
    start: Date.parse('2026-11-19T08:00:00+09:00'), end: Date.parse('2026-11-22T08:00:00+09:00') },
  { id: 'suishinya-2026', name: '水深夜', boss: 'ウォーターミッドナイト', emoji: '🌊', reward: 'watermid', bg: 'suishinya', hard: true, boost: 1.5, // 敵の能力 1.5 倍 (1.1 → 1.5 に強化)
    award: '深海に静けさが戻った…伝説の始まりだ🌊🌊🌊',
    hint: '紙属性クエスト: 敵は全員 📄つつむ → ✂️きるが有利！',
    pr: 'わざ「説教」は相手の攻撃力を 0.6 倍にして、味方の毒を治す！ 敵は先を読む強い CPU。\n紙属性クエスト: 敵は全員つつむ。✂️きるのキャラが有利！',
    text: '真夜中の深海から現れた説教好きの「ウォーターミッドナイト」。かたくてしぶとい… 勝てば MR「ウォーターミッドナイト」が仲間になる',
    tip: '紙属性クエスト: 敵は 3 体とも 📄つつむ。✂️きる (ハサミ丸・筆の剣士など) が有利！ ウォーターミッドナイトの「説教」で攻撃力が 0.6 倍に下がる (1 枚につき 1 回) うえ、毒も治される。毒より一気に削るのがコツ。敵は先を読む強い CPU',
    enemy: [['watermid', 20], ['star', 20], ['case', 20]],
    titles: { 1: '水深夜最速クリア🌊', 2: '水深夜準最速クリア🌊' },
    start: Date.parse('2026-11-20T08:00:00+09:00'), end: Date.parse('2026-11-23T08:30:00+09:00') }, // 8:30 開始 → 8:00 に前倒し (終わりはそのまま)
  { id: 'taika-2026', name: '大化の改新', boss: '中大兄皇子', emoji: '👑', reward: 'nakanoooe', bg: 'taika', hard: true, boost: 1.0, // 敵の能力 1.0 倍 (1.3 → 1.0 に変更)
    award: '新しい時代の幕開けだ…伝説の始まりだ👑👑👑',
    hint: '敵は 🪨おもい 2 体 + ✂️きる 1 体 → 📄つつむが有利 (ハサミ丸に注意)',
    pr: 'わざ「大化の改新」は 1.2 倍のこうげき + 味方の状態異常とデバフを全部取りのぞく！ 毒も怯みも説教も効かない… 敵は先を読む強い CPU。\n敵は おもい 2 体 (中大兄皇子・雷鳴ホチキス) と きる 1 体 (ハサミ丸)。📄つつむ が有利！',
    text: '飛鳥の都に現れた硯 (すずり) の皇子「中大兄皇子」。わざ「大化の改新」で、かけた毒も怯みも説教もすべて取りのぞいてしまう… 勝てば MR「中大兄皇子」が仲間になる',
    tip: '敵は 🪨おもい の中大兄皇子・雷鳴ホチキスと、✂️きる の疾風剣士ハサミ丸 (全員 Lv20)。📄つつむ のカードが有利だが、ハサミ丸には ✂️きる が効くので気をつけて！ 中大兄皇子の「大化の改新」は味方の毒・怯み・眠り・説教の攻撃ダウン・流星をすべて取りのぞく。状態異常にたよらず、わざのあと (2 ターン使えない) に一気に削るのがコツ',
    enemy: [['nakanoooe', 20], ['scissors', 20], ['raimei', 20]],
    titles: { 1: '大化最速クリア👑', 2: '大化準最速クリア👑' },
    start: Date.parse('2026-11-20T23:30:00+09:00'), end: Date.parse('2026-11-24T08:00:00+09:00') }, // 11/21 8:00 開始 → 11/20 23:30 に前倒し (終わりはそのまま)
  { id: 'y-2026', name: 'Y降臨', boss: 'Y', emoji: '🎤', reward: 'yhime', bg: 'ystage', hard: true, boost: 1.185, // tools/tune_oni.js quest:y-2026 → 1.185 (Lv18 の SSR・MR デッキで勝率 26.5%)
    award: '歌声がやんだ…伝説の始まりだ🎤🎤🎤',
    hint: '敵は 📄つつむ 2 体 + ✂️きる 1 体 → ✂️きるが有利 (不死鳥には 🪨おもい)',
    pr: 'わざ「死の歌声─一方的な愛─」は 1.2 倍のこうげき。でも、このわざを受けたそのターンに Y を倒すと… 場と控えから 1 枚が道連れに！ 敵は先を読む強い CPU。\n敵は つつむ 2 体 (Y・星キャンディー) と きる 1 体 (不死鳥の羽ペン)。✂️きる が有利！',
    text: '歌姫にあこがれる、歌のへたなマイク「Y」が降臨。わざ「死の歌声─一方的な愛─」を受けたそのターンに倒すと、道連れにされてしまう… 勝てば MR「Y」が仲間になる',
    tip: '敵は 📄つつむ の Y・星キャンディーと、✂️きる の不死鳥の羽ペン (全員 Lv20)。✂️きる のカードが有利だが、不死鳥には 🪨おもい が効く。Y の「死の歌声」を受けたターンに Y を倒すと、こちらのカードが 1 枚道連れになる。歌を受けたターンはガードでしのいで、次のターンに倒すのがコツ',
    enemy: [['yhime', 20], ['star', 20], ['phoenix', 20]],
    titles: { 1: 'Y降臨最速クリア🎤', 2: 'Y降臨準最速クリア🎤' },
    start: Date.parse('2026-11-22T08:00:00+09:00'), end: Date.parse('2026-11-25T08:00:00+09:00') },
  // すえつぐがいないと絶対にクリアできないクエスト: ボスは「絶対権力」(わざを封じられるまでダメージを受けない)・時間切れは負け (timeupLose)
  { id: 'ando-2026', name: '社長室の決戦', boss: 'プレジデントあんどう', emoji: '👔', reward: 'ando', bg: 'shachou', hard: true, boost: 0.99, // tune_oni quest:ando-2026 (DNA の修正・死の歌声の道連れがあんどうにも効くようにしたあと 2026-11-23 に測り直し。すえつぐ入りの Lv18 SSR・MR デッキで勝率 24%。すえつぐなしは 0.6 倍でも 0%)
    must: 'suetsugu', timeupLose: true, bossPassive: { ando: 'tyrant' },
    award: '社長の椅子が空いた…伝説の始まりだ👔👔👔',
    hint: '🩷 すえつぐの DNA で権力崩壊！ いなければ「つらぬく」だけが通る',
    pr: 'ボスのプレジデントあんどうは「絶対権力」で、どんなこうげきも毒も効かない…！ 魔法使いすえつぐの「DNAを取り出す」でわざを封じたときだけ、権力を失ってダメージが通る。「つらぬく」だけは権力をつらぬける。時間切れは負け。\n敵は おもい 2 体 (あんどう・皇帝の玉璽) と きる 1 体 (七色ボールペン覇王)。📄つつむ のすえつぐが有利！',
    text: '巨大企業の頂点に立つ社長の万年筆「プレジデントあんどう」。絶対権力で、どんな攻撃も受けつけない… 魔法使いすえつぐが DNA を取り出したときだけ、権力がくずれる。勝てば MR「プレジデントあんどう」が仲間になる',
    tip: 'いちばんの攻略法は魔法使いすえつぐ。あんどうは「絶対権力」で、すえつぐの「DNAを取り出す」を受けるまでダメージ・毒・流星・道連れが効かない。すえつぐがいなければ、わざ「つらぬく」(流星定規・氷結万年筆など) だけがダメージを通せる (難しい)。時間切れ (30 ターン) は負け。すえつぐを守りながら、あんどうが場にいるときに DNA を取り出そう。社長命令は控えにもダメージが入るので、控えのすえつぐも削られる',
    enemy: [['ando', 20], ['gyokuji', 20], ['rainbowpen', 20]],
    titles: { 1: '社長室最速クリア👔', 2: '社長室準最速クリア👔' },
    start: Date.parse('2026-11-22T12:00:00+09:00'), end: Date.parse('2026-11-26T12:00:00+09:00') },
];
if (Number(process.env.CB_QUEST_START)) Object.assign(QUESTS[0], { start: Number(process.env.CB_QUEST_START), end: Number(process.env.CB_QUEST_END) || QUESTS[0].end });
// テスト用: CB_QUEST_<ID>_START / _END (ID は大文字、- は _)
for (const q of QUESTS) { const k = 'CB_QUEST_' + q.id.toUpperCase().replace(/-/g, '_'); if (Number(process.env[k + '_START'])) q.start = Number(process.env[k + '_START']); if (Number(process.env[k + '_END'])) q.end = Number(process.env[k + '_END']); }
// 特効: クエストの bonus にあるカードは、そのクエストの中だけ HP・攻撃・防御が上がる (UR に昇格したものも)
const questBonus = (q, c) => { const k = !c.horse && q?.bonus?.[c.id]; return k ? { ...c, maxHp: Math.round(c.maxHp * k), atk: Math.round(c.atk * k), def: Math.round(c.def * k), bonus: k } : c; };
const QUEST_AWARD_RANKS = 2; // 高難易度クエストで、公式アカウントが表彰する人数 (クリアした順)
// クエストの敵のカード (高難易度は boost をかける。速さはそのまま)
const questEnemyStats = (q, boost = q.boost || 1) => q.enemy.map(([id, lv]) => { const s0 = statsOf(id, lv), s = q.bossPassive?.[id] === 'tyrant' ? { ...s0, tyrant: true } : s0; return boost === 1 ? s : { ...s, maxHp: Math.round(s.maxHp * boost), atk: Math.round(s.atk * boost), def: Math.round(s.def * boost) }; });
const questsNow = (now = Date.now()) => QUESTS.filter((q) => now >= q.start && now < q.end);
const QUEST_MIGRATION = `
CREATE TABLE card_quests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  cleared_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, quest_id)
);
`;
const START_COINS = 1000, DAILY_COINS = 300;
const REWARD = { easy: { win: 20, lose: 5 }, cpu: { win: 30, lose: 10 }, oni: { win: 40, lose: 10 }, random: { win: 100, lose: 30 }, room: { win: 50, lose: 20 } };
// ---------- CPU 戦「鬼難」: 決まった 5 種類のデッキ ----------
// どのデッキも「Lv18 の SSR・MR でそろえたデッキ」で、先を読むプレイヤーが戦って勝率 25% くらいになるよう、
// シミュレーションで boost (能力の倍率) を決めた (tools/tune_oni.js)。CPU は先を読む強い CPU
const ONI_DECKS = [
  { id: 'shippu', name: '疾風忍軍', emoji: '🌪️', text: '素早さで押し切る忍びの軍団', cards: [['scissors', 20], ['pin', 20], ['tape', 20]], boost: 0.943 },
  { id: 'hoshi', name: '星降る夜の騎士団', emoji: '🌠', text: '流星で削ってから回復で粘る', cards: [['star', 20], ['leaf', 20], ['case', 20]], boost: 1.054 },
  { id: 'ougon', name: '黄金の王国', emoji: '👑', text: '王と騎士の一撃必殺', cards: [['gold', 20], ['fountain', 20], ['sharp', 20]], boost: 1.401 },
  { id: 'teppeki', name: '鉄壁要塞', emoji: '🏯', text: '固くて倒れない、おもい軍団', cards: [['chalk', 20], ['board', 20], ['weight', 20]], boost: 1.94 },
  { id: 'niji', name: '虹の魔導団', emoji: '🌈', text: '吸収と回復の魔法使いたち', cards: [['case', 20], ['compass', 20], ['protractor', 20]], boost: 1.471 },
];
// 鬼難のデッキのカード (boost をかける)。速さはそのまま
const oniDeckStats = (d, boost = d.boost) => d.cards.map(([id, lv]) => { const s = statsOf(id, lv); return { ...s, maxHp: Math.round(s.maxHp * boost), atk: Math.round(s.atk * boost), def: Math.round(s.def * boost) }; });
const REWARDS_PER_DAY = 15;
// 対戦募集掲示板: 部屋を作るときに、ひとこと (40 文字まで) とタグを付けて掲示板に出せる。待っているあいだ (10 分まで) だけ載る
const BOARD_TAGS = ['気軽に', 'ガチ勝負', '初心者歓迎', '新キャラ試したい', 'クエスト前の練習'];
const BOARD_MAX = 40, ROOM_MS = 10 * 60_000;
// 掲示板の対戦はレート戦 (ランダム対戦と同じレートと報酬)。同じ相手と何回でもできる。
// ただし、同じ 2 人のレート戦が 10 戦以上で、どちらかが 1 回も勝っていなければ (勝率 0%)、その 2 人は掲示板で対戦できなくなる (レート稼ぎの防止)
const PAIR_BAN_GAMES = 10;
const boardText = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BOARD_MAX);
const TURN_MS = Number(process.env.CB_TURN_MS || 25_000);
const RECONNECT_MS = Number(process.env.CB_RECONNECT_MS || 30_000);
const jstDay = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);

function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-20-card-battlers', MIGRATION);
  db.migrate('2026-11-22-card-horses', HORSE_MIGRATION);
  db.migrate('2026-11-23-card-horses-ur', HORSE_UR_MIGRATION);
  db.migrate('2026-11-23-card-scrolls', SCROLL_MIGRATION);
  db.migrate('2026-11-24-card-quests', QUEST_MIGRATION);
  { const n = db.prepare("SELECT COUNT(*) AS n FROM card_horses WHERE skill IN ('sweep', 'starlight')").get().n;
    db.migrate('2026-11-25-horse-exclusive-skills', HORSE_SKILL_FIX);
    db.migrate('2026-11-26-card-high-level', HIGH_LEVEL_MIGRATION);
    db.migrate('2026-11-27-card-battle-decks', BATTLE_DECK_MIGRATION);
    db.migrate('2026-11-28-user-titles', TITLE_MIGRATION);
    db.migrate('2026-11-29-card-monsters', MONCARD_MIGRATION);
    db.migrate('2026-11-30-card-monsters-limited', 'ALTER TABLE card_monsters ADD COLUMN limited INTEGER NOT NULL DEFAULT 0; ALTER TABLE card_monsters ADD COLUMN formula INTEGER NOT NULL DEFAULT 1;');
    // 新凸: IppO祭の限定キャラは UR のあとのダブりも数えるので、これまでにレベルアップ書に変換されたぶんを、ガチャの記録 (card_pulls) から枚数にもどす (書はそのまま)
    db.migrate('2026-11-21-fes-lr-copies', `UPDATE card_owned SET count = MAX(count, (SELECT COUNT(*) FROM card_pulls p WHERE p.user_id = card_owned.user_id AND p.card_id = card_owned.card_id)) WHERE card_id IN (${FES_LIMITED.map((id) => `'${id}'`).join(', ')});`);
    // 2026-11-23: 高難易度クエストの最速・準最速クリアにコイン (3000・1500) を配るようにしたので、これまでのクエストの 1 番目・2 番目にも 1 回だけ配る
    db.migrate('2026-11-23-hard-quest-rank-coins', QUESTS.filter((q) => q.hard).map((q) => [1, 2].map((rank) => `UPDATE card_players SET coins = coins + ${HARD_QUEST_RANK_BONUS[rank]} WHERE user_id = (SELECT user_id FROM card_quests WHERE quest_id = '${q.id.replace(/'/g, "''")}' ORDER BY cleared_at, rowid LIMIT 1 OFFSET ${rank - 1});`).join('\n')).join('\n'));
    db.migrate('2026-11-29-card-monsters-z-mr', "UPDATE card_monsters SET rarity = 'MR' WHERE rarity = 'UR';"); // 評価 Z は UR → MR に (倍率はどちらも 1.2)
    if (n) console.log(`[cards] 専用わざが付いていた馬 ${n} 頭を、ふつうのわざに付け直しました`); }
  const clearedOf = (uid) => new Set(db.prepare('SELECT quest_id FROM card_quests WHERE user_id = ?').all(uid).map((r) => r.quest_id));
  const questView = (q, uid) => ({ id: q.id, name: q.name, boss: q.boss, emoji: q.emoji, text: q.text, start: q.start, end: q.end, hard: !!q.hard, coinRewards: q.hard ? { win: HARD_QUEST_WIN, first: HARD_QUEST_FIRST, rank: HARD_QUEST_RANK_BONUS } : null, tip: q.tip || '', items: q.hard ? { from: q.start + ITEMS_AFTER, list: Object.entries(ITEMS).map(([id, x]) => ({ id, ...x })) } : null, bonus: Object.entries(q.bonus || {}).map(([id, k]) => ({ ...statsOf(id, 1), mult: k, skillName: SKILLS[CARDS[id].skill].name })).filter((c) => isReleased(c.id)), bonusSoon: Object.entries(q.bonus || {}).filter(([id]) => !isReleased(id)).map(([id, k]) => ({ name: CARDS[id].name, mult: k, at: RELEASES[id] })), boostPct: q.hard ? Math.round(((q.boost || 1) - 1) * 100) : 0,
    enemy: q.enemy.map(([id, lv]) => ({ ...statsOf(id, 1), lv, skillName: SKILLS[CARDS[id].skill].name, skillDesc: SKILLS[CARDS[id].skill].desc })),
    reward: { ...statsOf(q.reward, 1), skillName: SKILLS[CARDS[q.reward].skill].name, skillDesc: SKILLS[CARDS[q.reward].skill].desc },
    cleared: uid ? clearedOf(uid).has(q.id) : false });
  const qHorse = db.prepare('SELECT * FROM card_horses WHERE id = ?');
  const horsesOwned = (uid) => db.prepare('SELECT * FROM card_horses WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  // 馬のカードの能力 (文房具の statsOf と同じ形)
  const horseStats = (h) => { const ur = h.rarity === 'UR', lv = Math.min(h.level || 1, MAX_LEVEL), m = (ur ? UR_MULT : RARITY.SSR.mult) * (1 + LEVEL_BONUS * (lv - 1)); return { id: 'h:' + h.id, name: h.name, emoji: '🐴', rarity: ur ? 'UR' : 'SSR', type: h.type, skill: h.skill, level: lv, horse: true, coat: h.coat, origin: h.origin,
    maxHp: Math.round(h.hp * m * STAT_SCALE), atk: Math.round(h.atk * m * STAT_SCALE), def: Math.round(h.def * m * STAT_SCALE), spd: h.spd, skillName: SKILLS[h.skill].name, skillDesc: SKILLS[h.skill].desc }; };
  const qMonCard = db.prepare('SELECT * FROM card_monsters WHERE id = ?');
  const monCardsOwned = (uid) => db.prepare('SELECT * FROM card_monsters WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  // モンスターのカードの能力 (文房具の statsOf と同じ形)
  const monCardStats = (c) => { const lv = Math.min(c.level || 1, MAX_LEVEL), m = (c.limited ? MONCARD_LIMITED_MULT : c.rarity === 'UR' ? UR_MULT : rarityMult(c.rarity)) * (1 + LEVEL_BONUS * (lv - 1)); // MR は rarityMult で 1.2・限定級は評価にかかわらず 1.12 (恒常の SSR と同じ)
    return { id: 'm:' + c.id, name: c.name, emoji: '🧬', rarity: c.rarity, type: c.type, skill: c.skill, level: lv, monster: true, limitedLevel: !!c.limited, monsterId: c.monster_id, monRank: c.mon_rank, monType: c.mon_type, updatedAt: c.updated_at,
      maxHp: Math.round(c.hp * m), atk: Math.round(c.atk * m), def: Math.round(c.def * m), spd: c.spd, skillName: SKILLS[c.skill].name, skillDesc: SKILLS[c.skill].desc }; };
  const cardStats = (uid, id, o) => {
    if (id.startsWith('h:')) { const h = qHorse.get(id.slice(2)); return h && h.user_id === uid ? horseStats(h) : null; }
    if (id.startsWith('m:')) { const c = qMonCard.get(id.slice(2)); return c && c.user_id === uid ? monCardStats(c) : null; }
    return CARDS[id] ? statsOf(id, Math.min(o[id] || 1, MAX_LEVEL), promoOf(uid, id)) : null;
  };
  const dayStart = () => { const d = new Date(Date.now() + 9 * 3600_000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 9 * 3600_000; };
  const HORSES_PER_DAY = 3; // 1 日に連れてこられる馬の数 (日本時間の 0 時に回復)
  const horsesLeft = (uid) => Math.max(0, HORSES_PER_DAY - db.prepare('SELECT COUNT(*) AS n FROM card_horses WHERE user_id = ? AND created_at >= ?').get(uid, dayStart()).n);
  // 称号: プロフィール・対戦の名前の横に出す (古いものから)
  const qTitles = db.prepare('SELECT title, source, granted_at FROM user_titles WHERE user_id = ? ORDER BY granted_at');
  ctx.titlesOf = (u) => qTitles.all(u.id).map((r) => ({ name: r.title, source: r.source, at: r.granted_at }));
  const userView = (id) => { const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); return u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, isAdmin: u.isAdmin, verified: u.verified, titles: u.titles || [] }; };

  // はじめて遊ぶ人には、コインとはじめの 3 枚を渡す
  const qPlayer = db.prepare('SELECT * FROM card_players WHERE user_id = ?');
  // ほかのミニゲーム (ブリードモンスターズ) とコインを共用する
  ctx.cbCoins = {
    get: (uid) => player(uid).coins,
    add: (uid, n) => { player(uid); db.prepare('UPDATE card_players SET coins = coins + ? WHERE user_id = ?').run(Math.round(n), uid); },
    spend: (uid, n) => { player(uid); return db.prepare('UPDATE card_players SET coins = coins - ? WHERE user_id = ? AND coins >= ?').run(Math.round(n), uid, Math.round(n)).changes > 0; },
  };
  function player(uid) {
    let p = qPlayer.get(uid);
    if (!p) {
      db.prepare('INSERT INTO card_players (user_id, coins, deck, created_at) VALUES (?, ?, ?, ?)').run(uid, START_COINS, JSON.stringify(STARTER), Date.now());
      for (const c of STARTER) db.prepare('INSERT OR IGNORE INTO card_owned (user_id, card_id, count) VALUES (?, ?, 1)').run(uid, c);
      p = qPlayer.get(uid);
    }
    return p;
  }
  const copiesOf = (uid) => Object.fromEntries(db.prepare('SELECT card_id, count FROM card_owned WHERE user_id = ?').all(uid).map((r) => [r.card_id, r.count]));
  const urOf = (uid) => Object.entries(copiesOf(uid)).filter(([id, n]) => isPromoted(id, n)).map(([id]) => id);
  const lrOf = (uid) => Object.entries(copiesOf(uid)).filter(([id, n]) => isLR(id, n)).map(([id]) => id);
  const promoOf = (uid, id) => (lrOf(uid).includes(id) ? 'LR' : urOf(uid).includes(id)); // statsOf の 3 つ目に渡す
  const lrCountOf = (uid) => { const cp = copiesOf(uid); return Object.fromEntries(CARD_LIST.map((c) => c[0]).filter((id) => lrNeed(id) && isReleased(id)).map((id) => [id, cp[id] || 0])); };
  const levelOfRow = (r) => Math.min(DUP_MAX_LEVEL, r.count + r.lv_bonus) + Math.min(MAX_LEVEL - DUP_MAX_LEVEL, r.lv_high || 0);
  const owned = (uid) => Object.fromEntries(db.prepare('SELECT card_id, count, lv_bonus, lv_high FROM card_owned WHERE user_id = ?').all(uid).map((r) => [r.card_id, levelOfRow(r)]));
  const deckStats = (uid) => { const p = player(uid), o = owned(uid); return JSON.parse(p.deck).map((id) => cardStats(uid, id, o) || statsOf(STARTER[0], 1)); };
  function me(uid) {
    const p = player(uid), o = owned(uid);
    return { coins: p.coins, pity: p.pity, deck: JSON.parse(p.deck), owned: o, ur: urOf(uid), lr: lrOf(uid), lrCount: lrCountOf(uid), lrNeed: Object.fromEntries(Object.keys(lrCountOf(uid)).map((id) => [id, lrNeed(id)])), horses: horsesOwned(uid).map(horseStats), monsters: monCardsOwned(uid).map(monCardStats), horseReady: horsesLeft(uid) > 0, horseLeft: horsesLeft(uid), horsesPerDay: HORSES_PER_DAY,
      rating: p.rating, wins: p.wins, losses: p.losses, draws: p.draws, scrolls: p.scrolls,
      quests: questsNow().map((q) => ({ id: q.id, name: q.name, emoji: q.emoji, end: q.end, reward: q.reward, hard: !!q.hard, cleared: clearedOf(uid).has(q.id) })),
      prices: pricesNow(), dailyReady: p.daily_day !== jstDay(), rewardsLeft: REWARDS_PER_DAY - (p.reward_day === jstDay() ? p.reward_count : 0) };
  }

  // カードの一覧・排出率 (誰でも見られる)
  app.get('/api/cards/catalog', (req, res) => res.json({
    cards: releasedIds().map((id) => ({ ...statsOf(id, 1), ...(RARITY[CARDS[id].rarity] ? {} : { questOnly: true }),
      ...(CARD_PASSIVE[id] ? { passiveName: PASSIVES[CARD_PASSIVE[id]].name, passiveDesc: PASSIVES[CARD_PASSIVE[id]].desc } : {}), skillName: SKILLS[CARDS[id].skill].name, skillDesc: SKILLS[CARDS[id].skill].desc,
      ...(CARDS[id].rarity === UR_PROMOTE.from ? { urStats: (({ maxHp, atk, def }) => ({ maxHp, atk, def }))(statsOf(id, 1, true)) } : {}),
      ...(isFes(id) ? { fes: true } : {}), ...(lrNeed(id) ? { lrNeed: lrNeed(id) } : {}),
      ...(lrNeed(id) ? { lrStats: (({ maxHp, atk, def }) => ({ maxHp, atk, def }))(statsOf(id, 1, 'LR')) } : {}) })),
    newCards: releasedIds().filter((id) => RELEASES[id] && !BULK_IDS.has(id) && RARITY[CARDS[id].rarity] && inGacha(id) && Date.now() - RELEASES[id] < NEW_DAYS * 86400_000),
    newBulk: BULK_RELEASES.filter((g) => Date.now() >= g.at && Date.now() - g.at < NEW_DAYS * 86400_000).map((g) => ({ id: g.id, name: g.name, at: g.at, ids: g.ids, count: Object.fromEntries(['R', 'SR', 'SSR'].map((r) => [r, g.ids.filter((id) => CARDS[id].rarity === r).length])) })),
    ...(() => { const x = ratesNow(); return { rates: x.rates, perCard: x.perCard }; })(),
    pickups: pickupsNow().map((x) => ({ name: x.name, id: x.id, rate: x.rate, end: x.end })),
    rateUps: rateUpsNow().map((x) => ({ name: x.name, ids: x.ids.filter((id) => isReleased(id)), mult: x.mult, end: x.end })), types: TYPES, beats: BEATS,
    urPromote: UR_PROMOTE, lrPromote: { copies: LR_PROMOTE.copies, bonus: Math.round((LR_PROMOTE.mult - 1) * 100) }, fesLr: { copies: FES_LR.copies, ids: FES_LIMITED.filter((id) => isReleased(id)) }, urDupScrolls: UR_DUP_SCROLLS, scrollReward: SCROLL_REWARD, hardQuestScrolls: HARD_QUEST_SCROLLS, coinsPerScroll: COINS_PER_SCROLL, scrollMinTurns: SCROLL_MIN_TURNS, pullCost: pricesNow().pull, tenCost: pricesNow().ten, sale: pricesNow().sale, pity: PITY, urBonus: Math.round((UR_MULT - 1) * 100), horseUrChance: HORSE_UR_CHANCE, levelBonus: LEVEL_BONUS, rarityBonus: Object.fromEntries(Object.entries({ ...RARITY, ...EXTRA_RARITY }).map(([k, v]) => [k, Math.round((v.mult - 1) * 100)])), dailyCoins: DAILY_COINS, maxLevel: MAX_LEVEL, dupMaxLevel: DUP_MAX_LEVEL, highLevelCost: HIGH_LEVEL_COST, reward: REWARD, rewardsPerDay: REWARDS_PER_DAY,
  }));
  app.get('/api/cards/me', requireAuth, (req, res) => res.json(me(req.user.id)));
  // サイドストーリー (限定キャラ・MR)。読めない話は題名と条件だけ送り、本文は送らない
  app.get('/api/cards/stories', requireAuth, (req, res) => {
    const uid = req.user.id, o = owned(uid), promoted = new Set([...urOf(uid), ...lrOf(uid)]);
    const list = Object.entries(STORY.STORIES).filter(([id]) => CARDS[id] && isReleased(id)).map(([id, st]) => {
      const lv = o[id] || 0, has = lv > 0;
      return { id, name: CARDS[id].name, emoji: CARDS[id].emoji, rarity: CARDS[id].rarity, fes: isFes(id), tagline: st.tagline, warn: st.warn || '', owned: has, level: lv,
        chapters: st.chapters.map((c, i) => { const u = STORY.UNLOCK[i] || STORY.UNLOCK[STORY.UNLOCK.length - 1], open = !!(has && (lv >= u.level || (u.promoted && promoted.has(id))));
          return { n: i + 1, title: c.title, open, need: u.label, ...(open ? { text: c.text } : {}) }; }) };
    });
    res.json({ stories: list });
  });
  // 鬼難のデッキ (CPU が使う 5 種類)
  app.get('/api/cards/oni', (req, res) => res.json({ reward: REWARD.oni, decks: ONI_DECKS.map((d) => ({ id: d.id, name: d.name, emoji: d.emoji, text: d.text, boost: d.boost,
    cards: oniDeckStats(d).map((s, i) => ({ ...s, lv: d.cards[i][1], skillName: SKILLS[CARDS[s.id].skill].name, skillDesc: SKILLS[CARDS[s.id].skill].desc })) })) }));
  // 開催中のクエスト (敵のデッキ・報酬)
  app.get('/api/cards/quests', (req, res) => res.json({ quests: questsNow().map((q) => questView(q, req.user?.id)) }));

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
    const before = owned(req.user.id), copies = copiesOf(req.user.id);
    const r = pull(n, p.pity);
    db.exec('BEGIN');
    try {
      const u = db.prepare('UPDATE card_players SET coins = coins - ?, pity = ? WHERE user_id = ? AND coins >= ?').run(cost, r.pity, req.user.id, cost);
      if (!u.changes) throw new Error('coins');
      const now = Date.now(), cnt = { ...copies };
      for (const c of r.cards) {
        db.prepare('INSERT INTO card_pulls (user_id, card_id, rarity, created_at) VALUES (?, ?, ?, ?)').run(req.user.id, c.id, c.rarity, now);
        if (dupMaxed(c.id, cnt[c.id] || 0)) { c.converted = UR_DUP_SCROLLS; continue; } // もう UR (祭の限定キャラは LR): 枚数はふやさず、レベルアップ書に変換
        cnt[c.id] = (cnt[c.id] || 0) + 1;
        db.prepare('INSERT INTO card_owned (user_id, card_id, count) VALUES (?, ?, 1) ON CONFLICT(user_id, card_id) DO UPDATE SET count = count + 1').run(req.user.id, c.id);
      }
      const conv = r.cards.reduce((s, c) => s + (c.converted || 0), 0);
      if (conv) db.prepare('UPDATE card_players SET scrolls = scrolls + ? WHERE user_id = ?').run(conv, req.user.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'コインが足りません' }); }
    const seen = { ...before };
    const results = r.cards.map((c) => {
      if (c.converted) { const lv = seen[c.id] || 1; return { ...statsOf(c.id, lv, isLR(c.id, copies[c.id]) ? 'LR' : true), level: lv, copies: copies[c.id], converted: c.converted }; }
      const prev = seen[c.id] || 0, n = (copies[c.id] || 0) + 1; seen[c.id] = prev + 1; copies[c.id] = n;
      const lr = isLR(c.id, n), ur = lr ? 'LR' : isPromoted(c.id, n);
      const lv = prev >= DUP_MAX_LEVEL ? prev : prev + 1; // Lv15 より上は、引いても上がらない
      seen[c.id] = lv;
      return { ...statsOf(c.id, lv, ur), level: lv, copies: n, isNew: prev === 0, levelUp: prev > 0 && prev < DUP_MAX_LEVEL, urUp: !!ur && n === UR_PROMOTE.copies, ...(lrNeed(c.id) ? { lrNeed: lrNeed(c.id) } : {}), lrUp: lr && n === lrNeed(c.id) };
    });
    if (results.some((c) => c.converted)) console.log(`[cards] @${req.user.username} UR のダブりをレベルアップ書に変換: ${results.filter((c) => c.converted).length} 枚`);
    if (results.some((c) => c.lrUp)) console.log(`[cards] @${req.user.username} LR に昇格 (新凸): ${results.filter((c) => c.lrUp).map((c) => c.id).join(',')}`);
    if (results.some((c) => c.urUp)) console.log(`[cards] @${req.user.username} UR に昇格: ${results.filter((c) => c.urUp).map((c) => c.id).join(',')}`);
    console.log(`[cards] @${req.user.username} ガチャ ${n} 回: ${r.cards.map((c) => c.rarity).join(',')}`);
    res.json({ results, ...me(req.user.id) });
  });

  // ---------- 競走馬版から馬を連れてくる (1 日 3 頭) ----------
  app.get('/api/cards/horse-candidates', requireAuth, (req, res) => {
    const have = new Set(horsesOwned(req.user.id).map((h) => h.seed_id));
    const list = (ctx.raceHorsesOf ? ctx.raceHorsesOf(req.user.id) : []).filter((h) => !have.has(h.sid))
      .map((h) => ({ sid: h.sid, name: h.name, label: h.label, headline: h.headline, breed: h.breed, coat: h.coat, urChance: HORSE_UR_CHANCE[h.label] ?? 0.01 }));
    res.json({ ready: horsesLeft(req.user.id) > 0, left: horsesLeft(req.user.id), perDay: HORSES_PER_DAY, horses: list });
  });
  // ブリードモンスターズのモンスター (自分のもの・売却していないもの) をカードにする。もう連れてきたものは「最新の強さに写し直す」(レベルはそのまま)
  const saveMonCard = (id, uid, m, b, now) => db.prepare('UPDATE card_monsters SET name = ?, look = ?, mon_type = ?, mon_rank = ?, type = ?, skill = ?, rarity = ?, hp = ?, atk = ?, def = ?, spd = ?, limited = ?, formula = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(m.name, JSON.stringify(m.look), m.type, m.rank, b.type, b.skill, b.rarity, b.hp, b.atk, b.def, b.spd, b.limited ? 1 : 0, MONCARD_FORMULA, now, id, uid);
  // 計算のしかたが変わったら、起動したあとに 1 回だけ、連れてきたカードを今のモンスターから計算し直す (売ったモンスターのカードはそのまま。レベルはそのまま)
  setTimeout(() => {
    try {
      const rows = db.prepare('SELECT * FROM card_monsters WHERE formula < ?').all(MONCARD_FORMULA); if (!rows.length || !ctx.monCardSource) return;
      let n = 0; const src = new Map();
      for (const c of rows) {
        if (!src.has(c.user_id)) src.set(c.user_id, new Map(ctx.monCardSource(c.user_id).map((m) => [m.id, m])));
        const m = src.get(c.user_id).get(c.monster_id); if (!m) continue;
        saveMonCard(c.id, c.user_id, m, monCardBase(m), c.updated_at); n++;
      }
      if (n) console.log(`[cards] モンスターのカード ${n} 枚を新しい計算 (上限なし・限定級) で計算し直しました`);
    } catch (e) { console.error('[cards] モンスターのカードの計算し直しに失敗', e.message); }
  }, 0);
  app.get('/api/cards/monster-candidates', requireAuth, (req, res) => {
    const have = new Map(monCardsOwned(req.user.id).map((c) => [c.monster_id, c]));
    const list = (ctx.monCardSource ? ctx.monCardSource(req.user.id) : []).map((m) => { const b = monCardBase(m), c = have.get(m.id);
      return { id: m.id, name: m.name, type: m.type, rank: m.rank, rarity: b.rarity, limited: b.limited, mutant: m.mutant || null, cardType: b.type, skillName: SKILLS[b.skill].name, status: m.status, have: !!c, cardId: c ? 'm:' + c.id : null }; });
    res.json({ monsters: list });
  });
  app.post('/api/cards/monster', requireAuth, writeLimit, (req, res) => {
    const uid = req.user.id, mid = String(req.body?.monster || '');
    player(uid);
    const m = (ctx.monCardSource ? ctx.monCardSource(uid) : []).find((x) => x.id === mid);
    if (!m) return res.status(404).json({ error: 'そのモンスターは連れてこられません' });
    const b = monCardBase(m), now = Date.now(), cur = db.prepare('SELECT * FROM card_monsters WHERE user_id = ? AND monster_id = ?').get(uid, mid);
    let id = cur?.id;
    if (cur) saveMonCard(cur.id, uid, m, b, now);
    else {
      id = crypto.randomBytes(9).toString('base64url');
      try { db.prepare('INSERT INTO card_monsters (id, user_id, monster_id, name, look, mon_type, mon_rank, type, skill, rarity, hp, atk, def, spd, limited, formula, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, uid, mid, m.name, JSON.stringify(m.look), m.type, m.rank, b.type, b.skill, b.rarity, b.hp, b.atk, b.def, b.spd, b.limited ? 1 : 0, MONCARD_FORMULA, now, now); }
      catch { return res.status(409).json({ error: 'このモンスターはもう連れてきています' }); }
    }
    console.log(`[cards] @${req.user.username} がモンスター「${m.name}」を${cur ? '最新の強さに写し直した' : '連れてきた'} (${b.rarity})`);
    res.json({ card: monCardStats(qMonCard.get(id)), updated: !!cur, ...me(uid) });
  });
  // モンスターのカードの絵 (ブリードモンスターズの絵をそのまま SVG で。文字は入れない)
  app.get('/api/cards/mon-art/:id', (req, res) => {
    const c = qMonCard.get(String(req.params.id).replace(/\.svg$/, ''));
    let svg = null; try { svg = c && ctx.monArtSvg ? ctx.monArtSvg(JSON.parse(c.look), c.mon_type, c.mon_rank) : null; } catch {}
    if (!svg) return res.status(404).end();
    res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' }).send(svg);
  });
  app.post('/api/cards/horse', requireAuth, writeLimit, (req, res) => {
    const sid = String(req.body?.sid || '');
    player(req.user.id);
    if (!horsesLeft(req.user.id)) return res.status(429).json({ error: `今日はもう ${HORSES_PER_DAY} 頭連れてきました。また明日！` });
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

  // ---------- レベルアップ書でレベルを上げる (Lv n → n+1 に n 枚) ----------
  // body: { id, to? }  to を書くと、そのレベルまでまとめて上げる (なければ 1 つ)
  app.post('/api/cards/levelup', requireAuth, writeLimit, (req, res) => {
    const id = String(req.body?.id || ''), uid = req.user.id, p = player(uid);
    let level, apply;
    if (id.startsWith('h:')) {
      const h = qHorse.get(id.slice(2));
      if (!h || h.user_id !== uid) return res.status(404).json({ error: 'そのカードは持っていません' });
      level = Math.min(h.level || 1, MAX_LEVEL);
      apply = (from) => db.prepare('UPDATE card_horses SET level = ? WHERE id = ? AND user_id = ?').run(from + 1, h.id, uid);
    } else if (id.startsWith('m:')) {
      const c = qMonCard.get(id.slice(2));
      if (!c || c.user_id !== uid) return res.status(404).json({ error: 'そのカードは持っていません' });
      level = Math.min(c.level || 1, MAX_LEVEL);
      apply = (from) => db.prepare('UPDATE card_monsters SET level = ? WHERE id = ? AND user_id = ?').run(from + 1, c.id, uid);
    } else {
      const row = db.prepare('SELECT count, lv_bonus, lv_high FROM card_owned WHERE user_id = ? AND card_id = ?').get(uid, id);
      if (!row || !CARDS[id]) return res.status(404).json({ error: 'そのカードは持っていません' });
      level = levelOfRow(row);
      // Lv15 までは lv_bonus、Lv15 より上は lv_high をふやす
      apply = (from) => db.prepare(`UPDATE card_owned SET ${from < DUP_MAX_LEVEL ? 'lv_bonus = lv_bonus + 1' : 'lv_high = lv_high + 1'} WHERE user_id = ? AND card_id = ?`).run(uid, id);
    }
    if (level >= MAX_LEVEL) return res.status(400).json({ error: `もう最大のレベル (Lv${MAX_LEVEL}) です` });
    const to = req.body?.to == null ? level + 1 : Number(req.body.to);
    if (!Number.isInteger(to) || to <= level || to > MAX_LEVEL) return res.status(400).json({ error: `Lv${level + 1}〜${MAX_LEVEL} のあいだで選んでください` });
    let cost = 0; for (let l = level; l < to; l++) cost += levelCost(l);
    const byCoins = req.body?.pay === 'coins', coinCost = cost * COINS_PER_SCROLL; // pay: 'coins' ならコインで (書 1 冊 = 50 コイン)
    if (byCoins ? p.coins < coinCost : p.scrolls < cost) return res.status(400).json({ error: byCoins ? `コインが足りません (あと ${coinCost - p.coins} コイン)` : `レベルアップ書が足りません (あと ${cost - p.scrolls} 枚)` });
    db.exec('BEGIN');
    try {
      if (byCoins) { if (!db.prepare('UPDATE card_players SET coins = coins - ? WHERE user_id = ? AND coins >= ?').run(coinCost, uid, coinCost).changes) throw new Error('coins'); }
      else if (!db.prepare('UPDATE card_players SET scrolls = scrolls - ? WHERE user_id = ? AND scrolls >= ?').run(cost, uid, cost).changes) throw new Error('scrolls');
      for (let l = level; l < to; l++) apply(l);
      db.exec('COMMIT');
    } catch { db.exec('ROLLBACK'); return res.status(400).json({ error: byCoins ? 'コインが足りません' : 'レベルアップ書が足りません' }); }
    const card = id.startsWith('h:') ? horseStats(qHorse.get(id.slice(2))) : id.startsWith('m:') ? monCardStats(qMonCard.get(id.slice(2))) : { ...statsOf(id, to, promoOf(uid, id)), skillName: SKILLS[CARDS[id].skill].name, skillDesc: SKILLS[CARDS[id].skill].desc };
    res.json({ card, from: level, to, used: cost, paid: byCoins ? { coins: coinCost } : { scrolls: cost }, ...me(uid) });
  });

  // デッキ (持っているカード 3 枚。同じカードは 1 枚まで)
  app.put('/api/cards/deck', requireAuth, writeLimit, (req, res) => {
    const d = req.body?.deck, o = owned(req.user.id);
    if (!Array.isArray(d) || d.length !== 3 || new Set(d).size !== 3 || !d.every((id) => typeof id === 'string' && (id.startsWith('h:') || id.startsWith('m:') ? !!cardStats(req.user.id, id, o) : o[id]))) return res.status(400).json({ error: '持っているカードを、ちがうもの 3 枚えらんでください' });
    db.prepare('UPDATE card_players SET deck = ? WHERE user_id = ?').run(JSON.stringify(d), req.user.id);
    res.json(me(req.user.id));
  });

  // ---------- デッキの採用率 (その期間の試合で、そのカードがデッキに入っていた回数と割合。だれのデッキかは出さない) ----------
  // 1 試合で 2 人とも人なら 2 デッキと数える。CPU・クエストの敵のデッキは数えない
  // days: 1 / 7 / 30 / 0 (全期間)、scope: all (全部の対戦) / random (ランダム対戦 = レート戦だけ)
  const usageCache = new Map();
  app.get('/api/cards/usage', rateLimit({ windowMs: 60_000, max: 60 }), (req, res) => {
    const days = [1, 7, 30, 0].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const scope = req.query.scope === 'random' ? 'random' : 'all';
    const key = `${days}:${scope}`, hit = usageCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return res.json(hit.data);
    const since = days ? Date.now() - days * 86400_000 : 0;
    const rows = db.prepare(`SELECT d FROM (SELECT d1 AS d, mode, created_at FROM card_battles UNION ALL SELECT d2 AS d, mode, created_at FROM card_battles)
      WHERE d IS NOT NULL AND created_at >= ? ${scope === 'random' ? "AND mode = 'random'" : ''}`).all(since);
    const count = {}; let horse = 0, monster = 0, n = 0;
    for (const { d } of rows) {
      let deck; try { deck = JSON.parse(d); } catch { continue; }
      if (!Array.isArray(deck)) continue;
      n++;
      if (deck.some((id) => String(id).startsWith('h:'))) horse++;
      if (deck.some((id) => String(id).startsWith('m:'))) monster++;
      for (const id of new Set(deck)) if (CARDS[id]) count[id] = (count[id] || 0) + 1;
    }
    const matches = db.prepare(`SELECT COUNT(*) AS n FROM card_battles WHERE (d1 IS NOT NULL OR d2 IS NOT NULL) AND created_at >= ? ${scope === 'random' ? "AND mode = 'random'" : ''}`).get(since).n;
    const rate = (c) => (n ? (c / n) * 100 : 0);
    const data = { days, scope, decks: n, matches, players: n, updatedAt: Date.now(),
      cards: releasedIds().map((id) => ({ id, count: count[id] || 0, rate: rate(count[id] || 0) })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      horse: { count: horse, rate: rate(horse) }, monster: { count: monster, rate: rate(monster) } };
    usageCache.set(key, { at: Date.now(), data });
    res.json(data);
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

  const publicState = (b) => ({ turn: b.state.turn, sides: b.state.sides.map((s) => ({ active: s.active, meteor: s.meteor ? s.meteor.left : 0, cards: s.cards.map((c) => ({ ...c })) })) });
  function startBattle(mode, uids, quest = null, oni = null, extra = {}) {
    const cpuView = quest ? { id: 0, username: 'quest', displayName: quest.boss, avatar: { kind: 'emoji', emoji: quest.emoji, color: '#3b2f8f' } }
      : oni ? { id: 0, username: 'oni', displayName: `鬼難CPU・${oni.name}`, avatar: { kind: 'emoji', emoji: '👹', color: '#a61e1e' } }
      : mode === 'easy' ? { id: 0, username: 'cpu', displayName: 'CPU (かんたん)', avatar: { kind: 'emoji', emoji: '🐣', color: '#2f9e44' } }
      : { id: 0, username: 'cpu', displayName: 'CPU', avatar: { kind: 'emoji', emoji: '🤖', color: '#64748b' } };
    const b = { id: crypto.randomBytes(8).toString('hex'), mode, uids, quest, oni, acts: [null, null], timer: null, deadline: 0, left: [null, null], ended: false,
      players: uids.map((u) => (u ? userView(u) : cpuView)),
      state: { turn: 0, winner: null, ...(quest?.timeupLose ? { timeupWinner: uids.findIndex((u) => !u) } : {}), sides: uids.map((u) => newSide(u ? deckStats(u).map((c) => questBonus(quest, c)) : quest ? questEnemyStats(quest) : oni ? oniDeckStats(oni) : mode === 'easy' ? easyDeck(uids[0]) : cpuDeck(uids[0]))) } };
    const items = quest?.hard ? { list: Object.entries(ITEMS).map(([id, x]) => ({ id, ...x })), from: quest.start + ITEMS_AFTER } : null;
    uids.forEach((u, i) => { if (u) { battleOf.set(u, b); send(u, { t: 'start', mode, ...extra, ...(items ? { items, coins: player(u).coins } : {}), quest: quest ? { id: quest.id, name: quest.name, emoji: quest.emoji, bg: quest.bg || null, hard: !!quest.hard } : null, oni: oni ? { id: oni.id, name: oni.name } : null, you: i, players: b.players, state: publicState(b) }); } });
    nextTurn(b);
    return b;
  }
  // CPU のデッキ: 相手と同じくらいの強さ (同じレア度の、ちがうカード)
  // CPU (かんたん): SR までのキャラだけ。プレイヤーのカードと同じレベル・レア度 (SR より上には SR を当てる)
  const EASY_RANKS = ['N', 'R', 'SR'];
  function easyDeck(uid) {
    const mine = deckStats(uid);
    return mine.map((c) => {
      const r = EASY_RANKS.includes(c.promoted ? c.baseRarity : c.rarity) ? (c.promoted ? c.baseRarity : c.rarity) : 'SR';
      const pool = poolOf(r).filter((id) => !mine.some((m) => m.id === id));
      return statsOf(pool[Math.floor(rnd() * pool.length)] || 'pencil', c.level);
    });
  }
  function cpuDeck(uid) {
    const mine = deckStats(uid);
    return mine.map((c) => { // UR・MR には、SSR を UR の強さにして当てる
      const top = c.rarity === 'UR' || !RARITY[c.rarity];
      const pool = poolOf(c.promoted ? c.baseRarity : top ? 'SSR' : c.rarity).filter((id) => !mine.some((m) => m.id === id));
      return statsOf(pool[Math.floor(rnd() * pool.length)] || 'gold', c.level, !!c.promoted || (top && !c.horse && !c.monster));
    });
  }
  function nextTurn(b) {
    if (b.ended) return;
    b.acts = [null, null];
    if (!b.uids[1]) b.acts[1] = (b.mode === 'quest' && !b.quest.hard) || b.mode === 'easy' ? cpuAct(b.state, 1, rnd) : smartAct(b.state, 1, rnd); // ふつう・鬼難は先を読む強い CPU (かんたん・クエストの敵は素直な CPU)
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
    if (msg.a === 'item') { // ボスクエストのアイテム: コインを払って使う (足りない・まだ使えないときは、行動を決めなかったことにする)
      const it = ITEMS[msg.item], q = b.quest, now = Date.now();
      const no = (m) => send(uid, { t: 'itemError', msg: m });
      if (!it || !q?.hard) return no('このバトルではアイテムは使えません');
      if (now < q.start + ITEMS_AFTER) return no(`アイテムは ${new Date(q.start + ITEMS_AFTER).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })} から使えます`);
      const side = b.state.sides[p], me = side.cards[side.active];
      if ((msg.item === 'potion' || msg.item === 'elixir') && me.hp >= me.maxHp) return no('HP はもう満タンです');
      if (!db.prepare('UPDATE card_players SET coins = coins - ? WHERE user_id = ? AND coins >= ?').run(it.price, uid, it.price).changes) return no(`コインが足りません (${it.price} コイン)`);
      console.log(`[cards] user ${uid} がアイテム「${it.name}」を使った (${it.price} コイン)`);
      b.acts[p] = { a: 'item', item: msg.item };
      send(uid, { t: 'coins', coins: player(uid).coins });
      if (b.acts[0] && b.acts[1]) resolve(b);
      return;
    }
    const a = ['attack', 'guard', 'skill', 'switch'].includes(msg.a) ? { a: msg.a, i: Number.isInteger(msg.i) ? msg.i : undefined } : { a: 'guard' };
    b.acts[p] = a;
    const o = 1 - p; if (b.uids[o]) send(b.uids[o], { t: 'opponentReady' });
    if (b.acts[0] && b.acts[1]) resolve(b);
  }
  function finish(b, winner, reason = '') {
    if (b.ended) return;
    b.ended = true; clearTimeout(b.timer); b.left.forEach((t) => clearTimeout(t));
    const deckOf = (i) => (b.uids[i] ? JSON.stringify(b.state.sides[i].cards.map((c) => c.id)) : null);
    db.prepare('INSERT INTO card_battles (mode, p1, p2, winner, turns, created_at, d1, d2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(b.mode, b.uids[0], b.uids[1] || null, winner, b.state.turn, Date.now(), deckOf(0), deckOf(1));
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
      const capped = !['easy', 'cpu', 'quest', 'oni'].includes(b.mode); // CPU 戦 (かんたん・ふつう・鬼難)・クエストの報酬は回数制限なし
      let coins = !capped || count < REWARDS_PER_DAY ? (REWARD[b.mode] || REWARD.cpu)[res === 'win' ? 'win' : 'lose'] : 0;
      if (b.quest?.hard && res === 'win') coins = HARD_QUEST_WIN; // 高難易度クエスト: クリアするたびに 60
      let clearBonus = null;
      // クエスト: はじめて勝ったときだけ、報酬のカード
      let questReward = null, questCopy = null;
      const firstClear = b.quest && res === 'win' && db.prepare('INSERT OR IGNORE INTO card_quests (user_id, quest_id, cleared_at) VALUES (?, ?, ?)').run(u, b.quest.id, Date.now()).changes;
      if (b.quest && res === 'win' && (firstClear || b.quest.hard)) { // 高難易度クエストは勝つたびに 1 枚 (25 枚で LR)
        db.prepare('INSERT INTO card_owned (user_id, card_id, count) VALUES (?, ?, 1) ON CONFLICT(user_id, card_id) DO UPDATE SET count = count + 1').run(u, b.quest.reward);
        if (lrEligible(b.quest.reward)) {
          const n = db.prepare('SELECT count FROM card_owned WHERE user_id = ? AND card_id = ?').get(u, b.quest.reward).count;
          questCopy = { id: b.quest.reward, name: CARDS[b.quest.reward].name, copies: n, need: LR_PROMOTE.copies, lrUp: n === LR_PROMOTE.copies, lr: n >= LR_PROMOTE.copies ? { ...statsOf(b.quest.reward, 1, 'LR'), skillName: SKILLS[CARDS[b.quest.reward].skill].name } : null };
          if (questCopy.lrUp) console.log(`[cards] user ${u} 「${CARDS[b.quest.reward].name}」が LR に昇格`);
        }
      }
      if (firstClear) {
        questReward = { ...statsOf(b.quest.reward, 1), skillName: SKILLS[CARDS[b.quest.reward].skill].name, skillDesc: SKILLS[CARDS[b.quest.reward].skill].desc };
        console.log(`[cards] user ${u} クエスト「${b.quest.name}」クリア`);
        // 高難易度クエストは、1 番目と 2 番目にクリアした人を公式アカウントで表彰する
        const rank = b.quest.hard ? db.prepare('SELECT COUNT(*) AS n FROM card_quests WHERE quest_id = ?').get(b.quest.id).n : 0;
        const title = rank >= 1 && b.quest.titles?.[rank];
        if (title) db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title, source, granted_at) VALUES (?, ?, ?, ?)').run(u, title, `quest:${b.quest.id}:${rank}`, Date.now());
        if (b.quest.hard) { // はじめてのクリア +1000・最速 +3000・準最速 +1500
          clearBonus = { first: HARD_QUEST_FIRST, rank: HARD_QUEST_RANK_BONUS[rank] ? rank : 0, rankCoins: HARD_QUEST_RANK_BONUS[rank] || 0 };
          coins += clearBonus.first + clearBonus.rankCoins;
        }
        if (rank >= 1 && rank <= QUEST_AWARD_RANKS) ctx.officialAward?.({ title: title || null, quest: b.quest, rank, user: db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(u), turns: b.state.turn, at: Date.now() });
      }
      const scrolls = b.state.turn < SCROLL_MIN_TURNS || (reason === 'surrender' && res === 'lose') ? 0 : b.quest?.hard && res === 'win' ? HARD_QUEST_SCROLLS : SCROLL_REWARD[res];
      if (scrolls) db.prepare('UPDATE card_players SET scrolls = scrolls + ? WHERE user_id = ?').run(scrolls, u);
      db.prepare(`UPDATE card_players SET coins = coins + ?, rating = rating + ?, reward_day = ?, reward_count = ?,
        wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE user_id = ?`).run(coins, delta[i], today, count + (capped && coins ? 1 : 0),
        b.mode === 'random' && res === 'win' ? 1 : 0, b.mode === 'random' && res === 'lose' ? 1 : 0, b.mode === 'random' && res === 'draw' ? 1 : 0, u);
      battleOf.delete(u);
      send(u, { t: 'end', result: res, reason, coins, clearBonus, scrolls, questCopy, quest: b.quest ? { id: b.quest.id, name: b.quest.name } : null, questReward, scrollMinTurns: SCROLL_MIN_TURNS, rating: b.mode === 'random' ? { delta: delta[i], now: player(u).rating } : null, state: publicState(b) });
    });
  }
  function leave(uid) {
    if (queue === uid) queue = null;
    for (const [code, r] of rooms) if (r.uid === uid) { rooms.delete(code); boardCache = null; }
  }
  // ---------- 対戦募集掲示板 (いま部屋で待っている募集の一覧。だれでも見られる・入るにはログイン) ----------
  let boardCache = null;
  // 2 人のレート戦の成績 (ランダム対戦と掲示板)。banned: 10 戦以上でどちらかの勝率が 0%
  const qPair = db.prepare("SELECT p1, winner FROM card_battles WHERE mode = 'random' AND ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?))");
  const pairStats = (a, b) => {
    const rows = qPair.all(a, b, b, a);
    const winsOf = (u) => rows.filter((r) => (r.p1 === u ? r.winner === 0 : r.winner === 1)).length;
    const wa = winsOf(a), wb = winsOf(b);
    return { games: rows.length, wins: [wa, wb], banned: rows.length >= PAIR_BAN_GAMES && (wa === 0 || wb === 0) };
  };
  app.get('/api/cards/board', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const now = Date.now();
    if (!boardCache || now - boardCache.at > 2000) {
      const list = [];
      for (const [code, r] of rooms) {
        if (!r.board) continue;
        if (now - r.at > ROOM_MS || conns.get(r.uid)?.readyState !== 1 || battleOf.get(r.uid)) { if (now - r.at > ROOM_MS) rooms.delete(code); continue; }
        const user = userView(r.uid); if (!user) continue;
        const deck = deckStats(r.uid).map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, level: c.level, horse: !!c.horse, monster: !!c.monster, coat: c.coat || '' }));
        list.push({ code, user, comment: r.board.comment, tag: r.board.tag, at: r.at, until: r.at + ROOM_MS, deck });
      }
      boardCache = { at: now, list: list.sort((a, b) => b.at - a.at) };
    }
    res.json({ tags: BOARD_TAGS, max: BOARD_MAX, banGames: PAIR_BAN_GAMES, reward: REWARD.random, posts: boardCache.list.map((p) => {
      const mine = !!req.user && p.user.id === req.user.id;
      const ps = req.user && !mine ? pairStats(req.user.id, p.user.id) : null;
      return { ...p, mine, ...(ps ? { vs: { games: ps.games, wins: ps.wins[0], losses: ps.wins[1], banned: ps.banned } } : {}) };
    }) });
  });
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
        if (m.mode === 'easy') return startBattle('easy', [uid, null]);
        if (m.mode === 'oni') { // 鬼難: デッキをえらぶ (なければランダム)
          const d = ONI_DECKS.find((x) => x.id === String(m.deck || '')) || ONI_DECKS[crypto.randomInt(0, ONI_DECKS.length)];
          return startBattle('oni', [uid, null], null, d);
        }
        if (m.mode === 'quest') {
          const q = questsNow().find((x) => x.id === String(m.quest || ''));
          if (!q) return send(uid, { t: 'error', msg: 'そのクエストは今は開催していません' });
          return startBattle('quest', [uid, null], q);
        }
        if (m.mode === 'random') {
          if (queue && queue !== uid && conns.get(queue)?.readyState === 1 && !battleOf.get(queue)) { const o = queue; queue = null; return startBattle('random', [o, uid]); }
          queue = uid; return send(uid, { t: 'waiting', mode: 'random' });
        }
        if (m.mode === 'room-create') {
          let code; do { code = String(crypto.randomInt(1000, 10000)); } while (rooms.has(code));
          const board = m.board && typeof m.board === 'object' ? { comment: boardText(m.board.comment), tag: BOARD_TAGS.includes(m.board.tag) ? m.board.tag : BOARD_TAGS[0] } : null;
          rooms.set(code, { uid, at: Date.now(), board }); if (board) boardCache = null;
          if (board) console.log(`[cards] 掲示板に募集: user ${uid} 「${board.tag}」`);
          return send(uid, { t: 'waiting', mode: 'room', code, board: !!board, ms: ROOM_MS });
        }
        if (m.mode === 'room-join') {
          const code = String(m.code || ''), r = rooms.get(code);
          if (!r || Date.now() - r.at > ROOM_MS || conns.get(r.uid)?.readyState !== 1) { rooms.delete(code); return send(uid, { t: 'error', msg: 'その部屋コードは見つかりません' }); }
          if (r.uid === uid) return send(uid, { t: 'error', msg: '自分の部屋には入れません' });
          if (r.board && pairStats(r.uid, uid).banned) return send(uid, { t: 'error', msg: `この人とは対戦できません (おたがいのレート戦が ${PAIR_BAN_GAMES} 戦以上で、どちらかが 1 回も勝っていないため)` });
          rooms.delete(code); boardCache = null;
          if (r.board) { // 掲示板からの対戦はレート戦 (同じ相手と何回でも)
            const ps = pairStats(uid, r.uid);
            console.log(`[cards] 掲示板のレート戦: user ${r.uid} vs ${uid} (これまで ${ps.games} 戦)`);
            return startBattle('random', [r.uid, uid], null, null, { board: true, rated: true, vs: { games: ps.games, wins: ps.wins[0], losses: ps.wins[1] } });
          }
          return startBattle('room', [r.uid, uid]);
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
    for (const t of ['card_players', 'card_owned', 'card_pulls', 'card_horses', 'card_monsters', 'card_quests', 'user_titles']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
    db.prepare('UPDATE card_battles SET p1 = NULL WHERE p1 = ?').run(uid);
    db.prepare('UPDATE card_battles SET p2 = NULL WHERE p2 = ?').run(uid);
  };
}
module.exports = install;
Object.assign(module.exports, { FES_LIMITED, FES_LR, isFes, lrNeed, dupMaxed, STAT_SCALE, GACHA_ENDS, inGacha, LR_PROMOTE, isLR, lrEligible, BULK_RELEASES, BULK_IDS, ITEMS, ITEMS_AFTER, questBonus, questEnemyStats, THUNDER_POWER, CARD_PASSIVE, PASSIVES, ONI_DECKS, oniDeckStats, REWARD, MAX_LEVEL, DUP_MAX_LEVEL, levelCost, EXCLUSIVE_SKILLS, TYPES, SKILLS, SALES, PICKUPS, pickupsNow, QUESTS, questsNow, METEOR_TURNS, EXTRA_RARITY, UR_PROMOTE, isPromoted, CARDS, CARD_LIST, statsOf, pull, resolveTurn, newSide, cpuAct, smartAct, typeMult, RARITY, PITY, RELEASES, isReleased, ratesNow, RATE_UPS });
