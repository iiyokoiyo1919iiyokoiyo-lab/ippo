// =====================================================================
// PROJECT BOUNCE: 設定ファイル (サーバーとブラウザで共通)
//   キャラ・連携コンボ・必殺技・アビリティ・ギミック・ステージ・ガチャ・育成の数値はすべてここで管理する。
//   ここを書きかえて再起動すれば調整できる (ガチャの排出率は管理者が画面から上書きもできる → 表 bn_config)
//   用語: 「連携コンボ」= 味方にふれると出るわざ、「必殺技」= ためて撃つショット (ターン数でたまる)
// =====================================================================
(function (root) {
  const ATTRS = { fire: { name: '火', color: '#ff6b6b', icon: '🔥' }, water: { name: '水', color: '#4dabf7', icon: '💧' }, wood: { name: '木', color: '#51cf66', icon: '🍃' }, light: { name: '光', color: '#ffd43b', icon: '✨' }, dark: { name: '闇', color: '#b197fc', icon: '🌙' } };
  // 有利な相性 (攻撃側 → 受ける側) は 1.5 倍・不利は 0.67 倍。光と闇はおたがいに有利
  const ADV = { fire: 'wood', wood: 'water', water: 'fire', light: 'dark', dark: 'light' };
  const attrMult = (a, d) => (ADV[a] === d ? 1.5 : ADV[d] === a && !(a === 'light' || a === 'dark') ? 0.67 : 1);
  const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'];
  const RARITY_COLOR = { N: '#adb5bd', R: '#74c0fc', SR: '#b197fc', SSR: '#ffd43b', UR: '#ff8cc6' };

  // 連携コンボの種類 (kind)。power は「Lv1 の攻撃力のとき」の威力。実際のダメージは power × (今の攻撃力 ÷ Lv1 の攻撃力) で、育てるほど上がる
  //   laser: 味方から横一直線 / explode: 味方のまわり / homing: ランダムな敵へ追尾弾 / heal: チームの HP 回復 / barrier: 次に受けるダメージを減らす
  //   nova: 全方向 8 本 / orbital: 敵全体へ星光レーザー (敵の数で分ける・ボスに追加・星蝕) / thunder: 敵 1 体へ天から雷
  const COMBOS = {
    laser_s: { kind: 'laser', name: 'レーザー', power: 2400, width: 26 },
    laser_l: { kind: 'laser', name: '超強レーザー', power: 5200, width: 40 },
    explode_s: { kind: 'explode', name: '爆発', power: 3000, radius: 90 },
    explode_l: { kind: 'explode', name: '超爆発', power: 6200, radius: 130 },
    homing_s: { kind: 'homing', name: '追尾弾 4', power: 900, shots: 4 },
    homing_l: { kind: 'homing', name: '追尾弾 8', power: 1300, shots: 8 },
    heal_s: { kind: 'heal', name: '回復', rate: 0.06 },
    barrier_s: { kind: 'barrier', name: 'バリア', amount: 3000 },
    nova_s: { kind: 'nova', name: '全方向レーザー', power: 1800, width: 20 },
    orbital: { kind: 'orbital', name: '星界崩壊・オービタルレイ', power: 36000, bossBonus: 1.5, eclipseChance: 0.3 },
    abc: { kind: 'thunder', name: 'ABC', power: 18000 },
  };

  // 必殺技 (ためて撃つ)。turns: 使えるまでのターン数 (使ったらまたためる)。type ごとに戦闘の処理がつながっている
  //   boost: 速さ × speed のショット / meteor: 敵全体にダメージ / akashic_zero: 敵全体に大ダメージ + 味方の攻撃 +30% (3 ターン) + HP 20% 回復
  //   akashic_record: 速さアップ + 全ギミック対応 + 貫通になる (継続ターン duration。終わったら元の反射にもどる)
  const SPECIALS = {
    dash: { type: 'boost', name: 'ダッシュ', turns: 8, speed: 1.5, desc: 'スピードが 1.5 倍になる' },
    meteor: { type: 'meteor', name: 'メテオ', turns: 12, power: 30000, desc: '敵全体に隕石を落とす' },
    akashic_zero: { type: 'akashic_zero', name: '天地創造・アカシックゼロ', turns: 16, power: 120000, atkUp: 0.3, heal: 0.2, buffTurns: 3,
      desc: '宇宙が広がり、星の魔法陣から星が降りそそぐ。敵全体に大ダメージ・味方全員の攻撃力 30% アップ (3 ターン)・味方全員の HP 20% 回復' },
    akashic_record: { type: 'akashic_record', name: 'アカシックレコード', turns: 10, speed: 1.6, duration: 1,
      desc: 'スピードアップ・すべてのギミックに対応・貫通タイプに変化 (このショットのあいだ。終わると反射にもどる)' },
  };

  // 固有アビリティ
  //   attr_up: その属性の攻撃力アップ / resist: 状態異常を一定の確率で防ぐ / combo_up: 連携コンボの威力アップ / immune: 指定したギミックに対応
  const ABILITIES = {
    star_blessing: { kind: 'attr_up', name: '星神の加護', attr: 'light', rate: 0.2, desc: '光属性の攻撃力 20% アップ' },
    fate: { kind: 'resist', name: '運命干渉', chance: 0.5, desc: '状態異常を 50% の確率で無効化' },
    resonance: { kind: 'combo_up', name: '星界共鳴', rate: 0.3, desc: '連携コンボの威力 30% アップ' },
    anti_gravity: { kind: 'immune', name: '重力対応', gimmicks: ['gravity'], desc: '重力ゾーンの減速を受けない' },
    anti_floor: { kind: 'immune', name: 'ダメージ床対応', gimmicks: ['damage_floor'], desc: 'ダメージ床でダメージを受けない' },
    anti_warp: { kind: 'immune', name: 'ワープ対応', gimmicks: ['warp'], desc: 'ワープに吸いこまれない' },
    anti_slow: { kind: 'immune', name: '減速壁対応', gimmicks: ['slow_wall'], desc: '減速壁で遅くならない' },
    fire_up: { kind: 'attr_up', name: '火の心', attr: 'fire', rate: 0.15, desc: '火属性の攻撃力 15% アップ' },
    water_up: { kind: 'attr_up', name: '水の心', attr: 'water', rate: 0.15, desc: '水属性の攻撃力 15% アップ' },
    wood_up: { kind: 'attr_up', name: '木の心', attr: 'wood', rate: 0.15, desc: '木属性の攻撃力 15% アップ' },
    dark_up: { kind: 'attr_up', name: '闇の心', attr: 'dark', rate: 0.15, desc: '闇属性の攻撃力 15% アップ' },
  };

  // キャラ。shot: reflect (反射) / pierce (貫通)。hp・atk・spd は Lv1・進化前の値。maxLv はレア度で決まる (LEVEL_CAP)
  //   art: 絵の作り方 (bn-art.js)。limited: 限定キャラ (登場演出が特別)
  const CHARS = [
    { id: 'limited_astraea_001', name: 'アストレア', title: '終焉を統べる星神', rarity: 'UR', attr: 'light', race: '星神', type: 'スピード型', shot: 'reflect',
      hp: 28500, atk: 35200, spd: 520, combo: 'orbital', special: 'akashic_zero', abilities: ['star_blessing', 'fate', 'resonance'], limited: true, art: 'astraea',
      profile: '星々の終わりと始まりを見届けてきた星神。その指先ひとつで、世界は無に還り、また生まれる。' },
    { id: 'yumiko', name: 'ユミコ', title: '2048年のユミコ', rarity: 'UR', attr: 'dark', race: '人間', type: 'スピード型', shot: 'reflect',
      hp: 24600, atk: 30800, spd: 480, combo: 'abc', special: 'akashic_record', abilities: ['fate'], limited: true, art: 'image', stand: 'img/yumiko-stand.jpg', sprite: 'img/yumiko-game.png', // 立ち絵 (詳細・ガチャ) とゲーム中の絵 (戦闘・アイコン) は利用者が用意した画像
      profile: 'IppO のユミコ (キャラ ID・図鑑はそのまま)。天から雷を呼び、アカシックレコードですべての障害をすり抜ける。' },
    { id: 'ember_knight', name: 'エンバーナイト', title: '紅蓮の騎士', rarity: 'SSR', attr: 'fire', race: '騎士', type: 'バランス型', shot: 'reflect', hp: 21800, atk: 24600, spd: 360, combo: 'explode_l', special: 'dash', abilities: ['fire_up', 'anti_floor'], art: 'orb' },
    { id: 'tide_mage', name: 'タイドメイジ', title: '潮騒の魔導士', rarity: 'SSR', attr: 'water', race: '魔導士', type: 'スピード型', shot: 'pierce', hp: 19200, atk: 23400, spd: 420, combo: 'laser_l', special: 'meteor', abilities: ['water_up', 'anti_gravity'], art: 'orb' },
    { id: 'verdant_beast', name: 'ヴァーダントビースト', title: '翠緑の獣王', rarity: 'SSR', attr: 'wood', race: '獣', type: 'パワー型', shot: 'reflect', hp: 23600, atk: 26100, spd: 300, combo: 'homing_l', special: 'dash', abilities: ['wood_up', 'anti_warp'], art: 'orb' },
    { id: 'night_queen', name: 'ナイトクイーン', title: '宵闇の女王', rarity: 'SSR', attr: 'dark', race: '魔族', type: 'パワー型', shot: 'pierce', hp: 22400, atk: 25800, spd: 330, combo: 'nova_s', special: 'meteor', abilities: ['dark_up', 'anti_slow'], art: 'orb' },
    { id: 'sun_priest', name: 'サンプリースト', title: '陽光の司祭', rarity: 'SR', attr: 'light', race: '聖職者', type: 'バランス型', shot: 'reflect', hp: 17600, atk: 16400, spd: 320, combo: 'heal_s', special: 'dash', abilities: ['anti_gravity'], art: 'orb' },
    { id: 'flare_fox', name: 'フレアフォックス', title: '火の尾の狐', rarity: 'SR', attr: 'fire', race: '獣', type: 'スピード型', shot: 'pierce', hp: 14800, atk: 17200, spd: 400, combo: 'homing_s', special: 'dash', abilities: ['anti_warp'], art: 'orb' },
    { id: 'aqua_guard', name: 'アクアガード', title: '水盾の守り手', rarity: 'SR', attr: 'water', race: '兵士', type: 'バランス型', shot: 'reflect', hp: 18800, atk: 15100, spd: 300, combo: 'barrier_s', special: 'dash', abilities: ['anti_floor'], art: 'orb' },
    { id: 'leaf_archer', name: 'リーフアーチャー', title: '森の射手', rarity: 'SR', attr: 'wood', race: 'エルフ', type: 'スピード型', shot: 'pierce', hp: 15300, atk: 16900, spd: 390, combo: 'laser_s', special: 'dash', abilities: ['anti_slow'], art: 'orb' },
    { id: 'shade_imp', name: 'シェイドインプ', title: '影の小悪魔', rarity: 'R', attr: 'dark', race: '魔族', type: 'スピード型', shot: 'reflect', hp: 11200, atk: 10800, spd: 350, combo: 'explode_s', special: 'dash', abilities: [], art: 'orb' },
    { id: 'spark_sprite', name: 'スパークスプライト', title: '光の妖精', rarity: 'R', attr: 'light', race: '妖精', type: 'スピード型', shot: 'pierce', hp: 10400, atk: 11300, spd: 370, combo: 'laser_s', special: 'dash', abilities: [], art: 'orb' },
    { id: 'coal_golem', name: 'コールゴーレム', title: '炭の巨人', rarity: 'R', attr: 'fire', race: 'ゴーレム', type: 'パワー型', shot: 'reflect', hp: 13800, atk: 11900, spd: 260, combo: 'explode_s', special: 'dash', abilities: [], art: 'orb' },
    { id: 'bubble_frog', name: 'バブルフロッグ', title: '泡のかえる', rarity: 'N', attr: 'water', race: '獣', type: 'バランス型', shot: 'reflect', hp: 8800, atk: 7600, spd: 300, combo: 'heal_s', special: 'dash', abilities: [], art: 'orb' },
    { id: 'sprout', name: 'スプラウト', title: '若葉の子', rarity: 'N', attr: 'wood', race: '植物', type: 'バランス型', shot: 'reflect', hp: 9200, atk: 7200, spd: 280, combo: 'homing_s', special: 'dash', abilities: [], art: 'orb' },
  ];
  const CHAR = Object.fromEntries(CHARS.map((c) => [c.id, c]));

  // 育成
  const LEVEL_CAP = { N: 20, R: 40, SR: 60, SSR: 80, UR: 99 };
  const GROW = {
    perLevel: 0.012,            // 1 レベルごとに HP・攻撃 +1.2%
    expFor: (lv) => Math.round(40 * lv * lv + 60 * lv), // そのレベルから次のレベルまでの経験値
    evo: { max: 2, mult: 0.12 },                        // 進化 1 段ごとに +12% (素材は evoCost)
    limitBreak: { max: 5, mult: 0.04 },                 // 限界突破 1 回ごとに +4% (同じキャラが出たとき)
    skillMin: 0.5,                                       // スキル強化で必殺技のターン数は最大 50% まで短くなる
  };
  // 進化の素材: 属性の結晶 (進化 1 段目は小 ×3・2 段目は大 ×3)
  const MATERIALS = {
    exp_s: { name: '経験の書 (小)', icon: '📘', exp: 500 }, exp_l: { name: '経験の書 (大)', icon: '📗', exp: 3000 },
    skill_book: { name: 'スキルの書', icon: '📜' }, star_shard: { name: '星のかけら', icon: '🌠' },
    ...Object.fromEntries(Object.keys(ATTRS).flatMap((a) => [[`crystal_${a}_s`, { name: `${ATTRS[a].name}の結晶 (小)`, icon: ATTRS[a].icon }], [`crystal_${a}_l`, { name: `${ATTRS[a].name}の結晶 (大)`, icon: ATTRS[a].icon + '💎' }]])),
  };
  const evoCost = (c, stage) => ({ [`crystal_${c.attr}_${stage === 0 ? 's' : 'l'}`]: 3 });
  const SYNTH = Object.fromEntries(Object.keys(ATTRS).map((a) => [`crystal_${a}_l`, { from: `crystal_${a}_s`, n: 3 }])); // 素材合成: 小 3 → 大 1
  SYNTH.exp_l = { from: 'exp_s', n: 5 };

  // ギミック (共通のしくみ)。type ごとに「当たったときの処理」を bn-core.js の GIMMICK_RULES に書く。
  //   キャラは immune (対応) を持つと、そのギミックを無視できる。'*' はすべてのギミック (今後ふえるものも) に対応
  const GIMMICK_TYPES = { gravity: '重力ゾーン', damage_floor: 'ダメージ床', warp: 'ワープ', block: 'ブロック', slow_wall: '減速壁' };

  // 敵の絵は bn-field.js の ENEMY_ART (id ごと)。img: 'img/xxx.png' を書けば画像に差しかえられる
  // 敵。attack: { every: 何ターンごと, kind: 'hit' | 'laser' | 'curse', power } (curse は次のショットを遅くする状態異常)
  const ENEMIES = {
    slime_f: { name: 'ほのおスライム', attr: 'fire', hp: 30000, r: 26, attack: { every: 3, kind: 'hit', power: 1200 } },
    slime_w: { name: 'みずスライム', attr: 'water', hp: 30000, r: 26, attack: { every: 3, kind: 'hit', power: 1200 } },
    slime_g: { name: 'くさスライム', attr: 'wood', hp: 30000, r: 26, attack: { every: 3, kind: 'hit', power: 1200 } },
    bat_d: { name: 'やみコウモリ', attr: 'dark', hp: 55000, r: 24, attack: { every: 3, kind: 'curse', power: 1500 } },
    wisp_l: { name: 'ひかりウィスプ', attr: 'light', hp: 55000, r: 24, attack: { every: 3, kind: 'hit', power: 2500 } },
    golem: { name: 'いわゴーレム', attr: 'wood', hp: 150000, r: 34, attack: { every: 3, kind: 'hit', power: 4500 } },
    knight_d: { name: 'くろき騎士', attr: 'dark', hp: 220000, r: 32, attack: { every: 3, kind: 'laser', power: 6000 } },
    // ボス
    dragon_f: { name: '紅竜イグニス', attr: 'fire', hp: 420000, r: 56, boss: true, attack: { every: 3, kind: 'laser', power: 7000 } },
    leviathan: { name: '深淵リヴァイア', attr: 'water', hp: 1600000, r: 60, boss: true, attack: { every: 2, kind: 'laser', power: 11000 } },
    void_king: { name: '虚無王ネヴァン', attr: 'dark', hp: 3000000, r: 62, boss: true, attack: { every: 2, kind: 'curse', power: 16000 } },
    gold_slime: { name: 'ゴールドスライム', attr: 'light', hp: 400000, r: 30, attack: { every: 4, kind: 'hit', power: 2000 } },
  };

  // フィールドは 360 × 600 (論理座標)。g: ギミック [{ type, x, y, w, h, ... }]。waves: 敵の出方 [[enemyId, x, y], ...]
  const W = 360, H = 600;
  const G = {
    grav: (x, y, w, h) => ({ type: 'gravity', x, y, w, h }), floor: (x, y, w, h, power = 2500) => ({ type: 'damage_floor', x, y, w, h, power }),
    warp: (x, y, tx, ty) => ({ type: 'warp', x, y, r: 18, tx, ty }), block: (x, y, w, h) => ({ type: 'block', x, y, w, h }), slow: (x, y, w, h) => ({ type: 'slow_wall', x, y, w, h }),
  };
  // bg: 戦闘フィールドの見た目 (bn-field.js の THEMES: meadow / cave / volcano / abyss / void / starlit / sand)。bgImage: 'img/xxx.jpg' を書けば画像に差しかえ
  // mode: story / raid / hard / event / material。stamina: 消費スタミナ。reward: クリア報酬 (gems・coins・exp・items)。drops: 素材 (確率)
  const STAGES = [
    { id: 's1-1', bg: 'meadow', mode: 'story', name: '1-1 はじまりの草原', stamina: 5, diff: 1, reward: { gems: 5, coins: 500, exp: 300 }, drops: [['exp_s', 0.6]],
      waves: [[['slime_g', 120, 140], ['slime_g', 240, 140]], [['slime_f', 180, 120], ['slime_w', 90, 220], ['slime_g', 270, 220]]] },
    { id: 's1-2', bg: 'cave', mode: 'story', name: '1-2 ふしぎな洞くつ', stamina: 6, diff: 2, reward: { gems: 5, coins: 700, exp: 450 }, drops: [['exp_s', 0.7], ['crystal_wood_s', 0.3]],
      g: [G.grav(110, 250, 140, 90)], waves: [[['bat_d', 100, 150], ['bat_d', 260, 150]], [['golem', 180, 140], ['slime_g', 80, 260], ['slime_g', 280, 260]]] },
    { id: 's1-3', bg: 'volcano', mode: 'story', name: '1-3 炎の門番', stamina: 8, diff: 3, reward: { gems: 10, coins: 1000, exp: 700 }, drops: [['crystal_fire_s', 0.5]],
      g: [G.floor(0, 300, 360, 40, 1200), G.block(150, 210, 60, 20)], waves: [[['slime_f', 100, 140], ['slime_f', 260, 140]], [['dragon_f', 180, 150]]] },
    { id: 'raid-leviathan', bg: 'abyss', mode: 'raid', name: 'ボスレイド 深淵リヴァイア', stamina: 15, diff: 6, reward: { gems: 20, coins: 3000, exp: 1800 }, drops: [['crystal_water_l', 0.4], ['skill_book', 0.3]],
      g: [G.warp(60, 360, 300, 200), G.warp(300, 360, 60, 200), G.grav(130, 260, 100, 80)], waves: [[['leviathan', 180, 150]]] },
    { id: 'hard-void', bg: 'void', mode: 'hard', name: '高難易度 虚無の玉座', stamina: 25, diff: 9, reward: { gems: 50, coins: 8000, exp: 4000 }, drops: [['crystal_dark_l', 0.5], ['skill_book', 0.5]],
      g: [G.slow(0, 0, 8, 600), G.slow(352, 0, 8, 600), G.floor(0, 260, 360, 30, 6000), G.block(60, 330, 80, 18), G.block(220, 330, 80, 18), G.warp(40, 200, 320, 420), G.grav(120, 200, 120, 60)],
      waves: [[['knight_d', 100, 160], ['knight_d', 260, 160]], [['void_king', 180, 150], ['bat_d', 70, 260], ['bat_d', 290, 260]]] },
    { id: 'event-star', bg: 'starlit', mode: 'event', name: 'イベント 星降る夜', stamina: 10, diff: 4, reward: { gems: 30, coins: 2000, exp: 1200 }, drops: [['star_shard', 0.8], ['crystal_light_s', 0.5]],
      g: [G.grav(60, 220, 80, 80), G.grav(220, 220, 80, 80)], waves: [[['wisp_l', 90, 150], ['wisp_l', 270, 150], ['bat_d', 180, 250]], [['knight_d', 180, 150], ['wisp_l', 80, 260], ['wisp_l', 280, 260]]] },
    { id: 'mat-gold', bg: 'sand', mode: 'material', name: '素材 ゴールドラッシュ', stamina: 8, diff: 2, reward: { gems: 0, coins: 5000, exp: 2500 }, drops: [['exp_l', 0.8], ['exp_s', 1]],
      waves: [[['gold_slime', 120, 160], ['gold_slime', 240, 160], ['gold_slime', 180, 260]]] },
    { id: 'mat-crystal', bg: 'cave', mode: 'material', name: '素材 結晶の洞', stamina: 8, diff: 3, reward: { gems: 0, coins: 1500, exp: 600 },
      drops: [['crystal_fire_s', 0.5], ['crystal_water_s', 0.5], ['crystal_wood_s', 0.5], ['crystal_light_s', 0.5], ['crystal_dark_s', 0.5]],
      g: [G.slow(0, 280, 120, 14), G.slow(240, 280, 120, 14)], waves: [[['slime_f', 80, 150], ['slime_w', 180, 150], ['slime_g', 280, 150]], [['golem', 180, 160]]] },
  ];
  const MODES = { story: 'メインストーリー', raid: 'ボスレイド', hard: '高難易度ダンジョン', event: 'イベントクエスト', material: '素材収集クエスト' };

  // ガチャ。rates はレア度ごとの % (合計 100)。pickup: その期間の目玉 (UR の中で rate% はこのキャラ)。pity: この回数でピックアップ確定
  const GACHA = {
    single: 50, ten: 500, pity: 100, dupToShard: 1,
    banners: [
      { id: 'astraea-launch', name: '星神降臨ガチャ', pickup: 'limited_astraea_001', pickupRate: 1.5, rates: { UR: 3, SSR: 12, SR: 30, R: 35, N: 20 }, limited: ['limited_astraea_001', 'yumiko'],
        text: '初回限定 UR「終焉を統べる星神 アストレア」登場！ ピックアップ 1.5%・100 回で確定' },
      { id: 'standard', name: '通常ガチャ', rates: { UR: 0, SSR: 6, SR: 25, R: 40, N: 29 }, text: 'いつでも引ける通常ガチャ' },
    ],
  };
  // ログインボーナス (7 日でひとまわり)・ミッション・実績・プレイヤーランク
  // ショップ (コイン・ジェムで買う)
  const SHOP = [
    { id: 'stamina', name: 'スタミナ全回復', icon: '⚡', price: { gems: 50 }, give: { stamina: 'full' } },
    { id: 'exp_s5', name: '経験の書 (小) ×5', icon: '📘', price: { coins: 2000 }, give: { items: { exp_s: 5 } } },
    { id: 'exp_l1', name: '経験の書 (大) ×1', icon: '📗', price: { coins: 5000 }, give: { items: { exp_l: 1 } } },
    { id: 'skill1', name: 'スキルの書 ×1', icon: '📜', price: { gems: 100 }, give: { items: { skill_book: 1 } } },
    { id: 'shard10', name: '星のかけら ×10', icon: '🌠', price: { gems: 150 }, give: { items: { star_shard: 10 } } },
  ];
  const LOGIN_BONUS = [{ gems: 50 }, { coins: 3000 }, { items: { exp_s: 5 } }, { gems: 50 }, { items: { skill_book: 1 } }, { coins: 10000 }, { gems: 150 }];
  const MISSIONS = {
    daily: [
      { key: 'd_quest3', name: 'クエストを 3 回クリア', stat: 'clear', goal: 3, reward: { gems: 10 } },
      { key: 'd_combo10', name: '連携コンボを 10 回出す', stat: 'combo', goal: 10, reward: { coins: 2000 } },
      { key: 'd_multi1', name: 'マルチプレイで 1 回クリア', stat: 'multi', goal: 1, reward: { gems: 15 } },
      { key: 'd_gacha1', name: 'ガチャを 1 回引く', stat: 'gacha', goal: 1, reward: { items: { exp_s: 3 } } },
    ],
    weekly: [
      { key: 'w_quest20', name: 'クエストを 20 回クリア', stat: 'clear', goal: 20, reward: { gems: 80 } },
      { key: 'w_boss5', name: 'ボスを 5 体たおす', stat: 'boss', goal: 5, reward: { items: { skill_book: 2 } } },
      { key: 'w_special10', name: '必殺技を 10 回使う', stat: 'special', goal: 10, reward: { gems: 50 } },
    ],
  };
  const ACHIEVEMENTS = [
    { key: 'a_first', name: 'はじめの一歩', stat: 'clear', goal: 1, reward: { gems: 30 } },
    { key: 'a_clear50', name: 'ベテラン', stat: 'clear', goal: 50, reward: { gems: 150 } },
    { key: 'a_boss10', name: 'ボスハンター', stat: 'boss', goal: 10, reward: { gems: 100 } },
    { key: 'a_combo500', name: 'コンボマスター', stat: 'combo', goal: 500, reward: { gems: 100 } },
    { key: 'a_multi10', name: '最高の仲間', stat: 'multi', goal: 10, reward: { gems: 100 } },
    { key: 'a_ur', name: 'UR を手に入れた', stat: 'ur', goal: 1, reward: { gems: 50 } },
  ];
  const RANK = { expFor: (r) => 200 + r * 120, staminaAt: (r) => 50 + r * 2 };
  const NEWS = [
    { at: '2026-11-27', title: 'PROJECT BOUNCE テスト開始', text: 'ひっぱって弾くアクション RPG のテストを始めました。いまはテスターだけが遊べます。' },
    { at: '2026-11-27', title: '初回限定 UR「アストレア」登場', text: '星神降臨ガチャで、終焉を統べる星神 アストレアが登場。ピックアップ 1.5%・100 回で確定。' },
  ];

  const DATA = { ATTRS, ADV, attrMult, RARITIES, RARITY_COLOR, COMBOS, SPECIALS, ABILITIES, CHARS, CHAR, LEVEL_CAP, GROW, MATERIALS, evoCost, SYNTH, GIMMICK_TYPES, ENEMIES, W, H, STAGES, MODES, GACHA, SHOP, LOGIN_BONUS, MISSIONS, ACHIEVEMENTS, RANK, NEWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA; else root.BNData = DATA;
})(typeof self !== 'undefined' ? self : this);
