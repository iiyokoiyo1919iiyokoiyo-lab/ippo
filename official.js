// =====================================================================
// IppO 公式アカウント (アップデート情報を自動で投稿する) と、イベントの告知バナー
// ・公式アカウントはサーバーが起動時に用意する。パスワードはだれも知らない (ログインできない) ので、乗っ取られない
// ・認証マーク「公式」つき。似たユーザー名 (ippo_official など) は新しく登録できない
// ・投稿の予定は、カードゲームの設定 (新キャラの登場・クエスト・ピックアップ・セール) と、下のアップデート情報から自動で作る。
//   時刻になったら 1 回だけ投稿する (投稿したものは記録に残すので、再起動しても二重に投稿しない)。
//   期限 (until) を過ぎた予定は投稿しない (あとで起動したときに古いお知らせを出さない)
// =====================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cards = require('./cards');
const { cleanJpeg } = require('./avatar');
// ドパバナー (告知画像): tools/make_banners.js で作って public/banners/ に置く。あれば投稿とアプリのバナーに使う
const BANNER_DIR = path.join(__dirname, 'public', 'banners');
const bannerName = (kind, id) => `${kind}-${String(id).replace(/[^a-z0-9-]/gi, '')}`;
const bannerFile = (name) => { const f = path.join(BANNER_DIR, name + '.jpg'); return fs.existsSync(f) ? f : null; };

const MIGRATION = `
CREATE TABLE official_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE official_posts (
  key TEXT PRIMARY KEY,                                   -- 予定の ID (同じ予定は 1 回だけ)
  post_id INTEGER,                                        -- 投稿 (消されたら NULL のまま記録だけ残る)
  posted_at INTEGER NOT NULL
);
`;
const NAMES = ['IppO_official', 'IppO_koushiki', 'IppO_info'];           // 公式アカウントのユーザー名 (使えるものを順に)
const DISPLAY = 'IppO 公式';
const BIO = 'IppO の公式アカウントです。アップデート情報・新キャラ・イベントのお知らせを自動でお届けします📢';
const RESERVED = /^ippo_?(official|koushiki|info|unei|kousiki|admin|staff)/i;  // なりすまし防止: 新しく登録できないユーザー名
const TAG = '#ぶんぼうぐバトラーズ';
const H = 3600_000, D = 24 * H;

// 手で書くアップデート情報 (key は変えない。at から until までの間に 1 回だけ投稿)
// ガチャの告知 (その時のセール・ピックアップ・確率アップをまとめて知らせる)。id は変えない。at になったらドパバナーつきで投稿し、until までアプリにバナーを出す
const GACHA_NOTICES = [
  { id: '2026-11-18', at: Date.parse('2026-11-18T08:40:00+09:00'), until: Date.parse('2026-11-19T08:35:00+09:00') },
  { id: '2026-11-19', at: Date.parse('2026-11-19T08:35:00+09:00'), until: Date.parse('2026-11-20T08:29:00+09:00') }, // タドコロ ピックアップ + セール
  { id: '2026-11-23', at: Date.parse('2026-11-23T08:00:00+09:00'), until: Date.parse('2026-11-24T08:00:00+09:00') }, // 毎週月曜のIppO祭: 限定キャラ 魔法使いすえつぐ ピックアップ 2% (+ 16:45 までのセール)
  { id: '2026-11-20', at: Date.parse('2026-11-20T08:00:00+09:00'), until: Date.parse('2026-11-21T08:30:00+09:00'), skip: ['tadokoro'] }, // 8:00 に告知: 筆の剣士 ピックアップ (8:35〜) + セール。もうすぐ終わるタドコロ PU は載せない (8:29 でタドコロ・ハサミ丸は排出終了)
];
// その告知の時点でのガチャの情報 (セール・これからのピックアップ・確率アップ)。skip: 載せないピックアップのキャラ
function gachaInfo(n) {
  const { SALES, PICKUPS, RATE_UPS, CARDS } = cards;
  const sale = SALES.find((x) => n.at < x.end && x.start < n.until) || null;
  const pickups = PICKUPS.filter((x) => (!x.end || x.end > n.at) && x.start < n.until && !(n.skip || []).includes(x.id)).map((x) => ({ ...x, card: CARDS[x.id] }));
  const rateUps = RATE_UPS.filter((x) => n.at >= x.start && (!x.end || x.end > n.at)).map((x) => ({ ...x, cards: x.ids.map((id) => CARDS[id]) }));
  return { sale, pickups, rateUps };
}
function gachaText(n) {
  const g = gachaInfo(n), lines = ['🎰【ガチャのお知らせ】'];
  if (g.sale) lines.push(`🔥 ${g.sale.name}: 1 回 ${g.sale.pull} コイン・10 回 ${g.sale.ten} コイン (${fmt(g.sale.end)} まで)`);
  for (const p of g.pickups) lines.push(`🎯 ${p.card.rarity}「${p.card.name}」ピックアップ 1 体 ${p.rate}% (${p.start > n.at ? fmt(p.start) + ' 〜 ' : ''}${p.end ? fmt(p.end) + ' まで' : ''})`);
  for (const r of g.rateUps) lines.push(`🎉 ${r.name} (${r.cards.map((c) => c.name).join('・')})${r.end ? ` ${fmt(r.end)} まで` : ''}`);
  lines.push(TAG);
  return lines.join('\n');
}

const UPDATES = [
  { key: 'update-2026-11-18', at: Date.parse('2026-11-18T07:30:00+09:00'), until: Date.parse('2026-11-20T07:30:00+09:00'),
    text: `📢【本日のアップデート】
・8:00〜 期間限定クエスト「星降る夜のクエスト」
・10:25〜 新キャラ SSR「疾風剣士ハサミ丸」ガチャに登場 (ピックアップ 3%)
・試合でもらえる「レベルアップ書」でカードのレベル上げ
・ガチャ限定 SSR は 3 枚で UR に昇格
ゲーム → ぶんぼうぐバトラーズ ${TAG}` },
  { key: 'preview-y-2026-11-22', at: Date.parse('2026-11-22T03:40:00+09:00'), until: Date.parse('2026-11-22T08:00:00+09:00'), banner: 'quest-y-2026',
    text: `🎤【高難易度クエスト予告】今日 11/22(日) 8:00 から 11/25(水) 8:00 まで、「Y降臨」開催！
敵は Y・星キャンディー・不死鳥の羽ペン (全員 Lv20)
💀 新わざ「死の歌声─一方的な愛─」: 1.2 倍のこうげき。歌を受けたそのターンに Y を倒すと、こちらのカードが 1 枚道連れに…！
敵は つつむ 2 体 + きる 1 体 → ✂️きるが有利。最速・準最速クリアには称号🎤 ${TAG}` },
  { key: 'update-fes-lr-2026-11-21', at: Date.parse('2026-11-21T12:00:00+09:00'), until: Date.parse('2026-11-23T08:00:00+09:00'),
    text: `🌈【新凸システム】IppO祭の限定キャラ (疾風剣士ハサミ丸・タドコロ・魔法使いすえつぐ) は、同じカードを 15 枚集めると LR に昇格！ (能力 +35%・虹色のデザイン)
UR のあとのダブりも、LR までは枚数に数えます。これまでレベルアップ書に変わったぶんも、ガチャの記録から枚数にもどしました (書はそのまま) ${TAG}` },
  { key: 'preview-suetsugu-2026-11-23', at: Date.parse('2026-11-21T21:00:00+09:00'), until: Date.parse('2026-11-23T08:00:00+09:00'), banner: 'char-suetsugu',
    text: `📣【新ガチャ予告】11/23(月) 8:00 から「毎週月曜のIppO祭」スタート！
🩷 期間限定 SSR「魔法使いすえつぐ」がピックアップ 2% で登場 (11/24 8:00 まで。終わるとガチャに出なくなります)
わざ「DNAを取り出す」: 1.8 倍のこうげき + 相手の場のカードは、そのバトル中ずっとわざが使えない！
💗 パッシブ「セントラルドグマ」: 控えで生きているあいだ、毎ターン味方全員の HP を 10% 回復
自分を魔法少女だと思っているおばさん…その魔法はホンモノ！？ ${TAG}` },
  { key: 'preview-tadokoro-2026-11-18', at: Date.parse('2026-11-18T11:25:00+09:00'), until: Date.parse('2026-11-19T08:35:00+09:00'), banner: 'char-tadokoro',
    text: `📣【新キャラ予告】明日 11/19(木) 10:30、SSR「タドコロ」がガチャに登場！
わざ「野獣の眼光」: 相手を毒にして、次のターン怯ませる
🔥 パッシブ「士気」: たおれると味方の攻撃 1.4 倍・防御 1.3 倍
お楽しみに！ ${TAG}` },
  { key: 'preview-raijin-2026-11-18', at: Date.parse('2026-11-18T11:55:00+09:00'), until: Date.parse('2026-11-19T08:00:00+09:00'), banner: 'quest-raijin-2026',
    text: `⚡【高難易度クエスト予告】明日 11/19(木) 8:00 から 3 日間、「雷神降臨」開催！
敵は 雷神クリりん・疾風剣士ハサミ丸・黄金えんぴつ王 (全員 Lv20)。先を読む強い CPU が相手！
わざ「落雷」は、どんな相性でも 2.3 倍の無属性こうげき。
クリアすると MR「雷神クリりん」が仲間に！ 11/22(日) 8:00 まで ${TAG}` },
  { key: 'schedule-2026-11-19', at: Date.parse('2026-11-19T07:30:00+09:00'), until: Date.parse('2026-11-19T08:35:00+09:00'), banner: 'quest-raijin-2026',
    text: `📅【今日 11/19(木) のスケジュール】
⚡ 8:00〜 高難易度クエスト「雷神降臨」(〜11/22 8:00) 最速・準最速討伐者に称号！ おもいのタドコロが有利
🧪 8:30〜 雷神降臨でアイテム解禁 (回復薬・全回復薬・アイスティー)
🎒 8:35〜 SSR「タドコロ」登場！ ピックアップ 2% (〜11/20 16:45) ※予告の 10:30 から早まりました
🔥 3日間限定セール・🌠 星降る夜のクエストも開催中 ${TAG}` },
  { key: 'sale-extend-2026-11-19', at: Date.parse('2026-11-19T23:15:00+09:00'), until: Date.parse('2026-11-23T16:45:00+09:00'), banner: 'gacha-2026-11-20',
    text: `🔥【セール延長決定！】ガチャの割引 (1 回 30 コイン・10 回 270 コイン) を 11/23(月) 16:45 まで延長します！
🎒 タドコロのピックアップは 11/20(金) 8:29 まで
🖌️ 11/20(金) 8:35 から SSR「筆の剣士」ピックアップ 2% (〜11/21 8:30) ${TAG}` },
  { key: 'preview-suishinya-2026-11-19', at: Date.parse('2026-11-19T23:45:00+09:00'), until: Date.parse('2026-11-20T08:00:00+09:00'), banner: 'quest-suishinya-2026',
    text: `🌊【高難易度クエスト予告】明日 11/20(金) 8:00 から 3 日間、「水深夜」開催！
敵は ウォーターミッドナイト・星キャンディー・虹色ペンケース姫 (全員 Lv20・能力 1.5 倍)
📢 新わざ「説教」: 相手の攻撃力を 0.6 倍にして、味方の毒を治す！
紙属性クエスト: 敵は全員つつむ → ✂️きるが有利。最速・準最速クリアには称号🌊 ${TAG}` },
  { key: 'preview-taika-2026-11-20', at: Date.parse('2026-11-20T23:12:00+09:00'), until: Date.parse('2026-11-20T23:30:00+09:00'), banner: 'quest-taika-2026',
    text: `👑【高難易度クエスト予告】今夜 11/20(金) 23:30 から 11/24(火) 8:00 まで、「大化の改新」開催！
敵は 中大兄皇子・疾風剣士ハサミ丸・雷鳴ホチキス (全員 Lv20)
📜 新わざ「大化の改新」: 1.2 倍のこうげき + 味方の状態異常とデバフを全部取りのぞく！
敵は おもい 2 体 + きる 1 体 → 📄つつむが有利。最速・準最速クリアには称号👑 ${TAG}` },
  { key: 'update-lr-2026-11-20', at: Date.parse('2026-11-20T01:40:00+09:00'), until: Date.parse('2026-11-23T08:30:00+09:00'), banner: 'update-lr-2026-11-20',
    text: `🌈【新レア度「LR」登場！】
高難易度クエストの報酬キャラ (雷神クリりん・ウォーターミッドナイト) を 25 枚集めると、LR に昇格！ 能力 +35%・虹色に輝く最強のカードに✨
高難易度クエストは勝つたびに報酬キャラが 1 枚もらえるようになりました (レベルアップ書も 4 冊)
図鑑とクエストの画面で「LR まで あと何枚」が見られます！ ${TAG}` },
];

const fmt = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const hm = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
const jstDay = (t) => new Date(t + 9 * H).toISOString().slice(0, 10);

// カードゲームの設定から、公式の投稿の予定を作る
function schedule() {
  const { CARDS, SKILLS, RELEASES, QUESTS, PICKUPS, SALES } = cards;
  const out = [...UPDATES];
  for (const g of cards.BULK_RELEASES) { // まとめて追加したキャラは、1 回だけお知らせする
    const n = (r) => g.ids.filter((id) => CARDS[id].rarity === r).length;
    const ssr = g.ids.filter((id) => CARDS[id].rarity === 'SSR').map((id) => CARDS[id].name);
    out.push({ key: `bulk:${g.id}`, at: g.at, until: g.at + D, banner: bannerName('bulk', g.id),
      text: `🎉【大型アップデート】新キャラ ${g.ids.length} 体がガチャに登場しました！ (R ${n('R')}・SR ${n('SR')}・SSR ${n('SSR')}、すべて恒常)
🌟 SSR: ${ssr.join('・')}
📜 高難易度クエストで勝つとレベルアップ書 4 冊・🪙 コインでもレベルを上げられるように！ ${TAG}` });
  }
  for (const [id, at] of Object.entries(RELEASES)) {
    const c = CARDS[id]; if (!c || !cards.RARITY[c.rarity] || cards.BULK_IDS.has(id)) continue;        // ガチャに出ないキャラ (クエストの報酬) はクエストの投稿で知らせる
    const pk = PICKUPS.find((x) => x.id === id);
    out.push({ key: `release:${id}`, at, until: at + D, banner: bannerName('char', id),
      text: `${pk && /祭/.test(pk.name) ? `🎊【${pk.name}】期間限定キャラ ` : '🆕【新キャラ登場】'}${c.rarity}「${c.name}」がガチャに登場しました！
わざ「${SKILLS[c.skill].name}」${SKILLS[c.skill].desc.replace(/\s*\([^()]*だけのわざ\)/, '')}${cards.CARD_PASSIVE[id] ? `\n🔥 パッシブ「${cards.PASSIVES[cards.CARD_PASSIVE[id]].name}」${cards.PASSIVES[cards.CARD_PASSIVE[id]].desc}` : ''}${pk ? `\n🎯 ピックアップ中は 1 体 ${pk.rate}%！${pk.end ? ` (${fmt(pk.end)} まで)` : ''}` : ''}\n${TAG}` });
  }
  for (const pk of PICKUPS) {
    if (!pk.end) continue;
    const c = CARDS[pk.id];
    out.push({ key: `pickup-end-soon:${pk.id}:${pk.end}`, at: pk.end - 3 * H, until: pk.end,
      text: `⏰「${c.name}」のピックアップ (1 体 ${pk.rate}%) は ${fmt(pk.end)} までです。お見のがしなく！ ${TAG}` });
    out.push({ key: `pickup-end:${pk.id}:${pk.end}`, at: pk.end, until: pk.end + 3 * H,
      text: `「${c.name}」のピックアップは終了しました。ご参加ありがとうございました！ ${cards.GACHA_ENDS[pk.id] && cards.GACHA_ENDS[pk.id] <= pk.end + 60_000 ? `${c.name}は期間限定キャラなので、ガチャからの排出も終了しました (持っているカードはそのまま使えます)。` : `${c.name}はこれからもガチャに登場します (ふつうの確率)。`} ${TAG}` });
  }
  for (const q of QUESTS) {
    const r = CARDS[q.reward];
    out.push({ key: `quest-start:${q.id}`, at: q.start, until: q.start + D, banner: bannerName('quest', q.id),
      text: `${q.hard ? `${q.emoji || '⚡'}【高難易度クエスト開始】` : '🌠【期間限定クエスト開始】'}「${q.name}」が始まりました！
${q.enemy.map(([id, lv]) => `${CARDS[id].name} Lv${lv}`).join('・')} に勝つと、${r.rarity}「${r.name}」が仲間に！
${q.pr || `わざ「${SKILLS[r.skill].name}」: ${SKILLS[r.skill].desc}`}
${fmt(q.end)} まで ${TAG}` });
    out.push({ key: `quest-end-soon:${q.id}`, at: q.end - D, until: q.end,
      text: `⏰ ${q.hard ? '高難易度' : '期間限定'}クエスト「${q.name}」は ${fmt(q.end)} までです。クリアすると ${r.rarity}「${r.name}」がもらえます！ ${TAG}` });
    out.push({ key: `quest-end:${q.id}`, at: q.end, until: q.end + 3 * H,
      text: `${q.hard ? '高難易度' : '期間限定'}クエスト「${q.name}」は終了しました。挑戦してくれたみなさん、ありがとうございました！ ${TAG}` });
  }
  for (const s of SALES) {
    out.push({ key: `sale-start:${s.start}`, at: s.start, until: s.start + 6 * H,
      text: `🔥【${s.name}】ガチャが 1 回 ${s.pull} コイン・10 回 ${s.ten} コインに！ ${fmt(s.end)} まで ${TAG}` });
    out.push({ key: `sale-end-soon:${s.start}`, at: s.end - 6 * H, until: s.end,
      text: `⏰ ガチャの「${s.name}」は ${fmt(s.end)} までです！ ${TAG}` });
  }
  for (const n of GACHA_NOTICES) out.push({ key: `gacha:${n.id}`, at: n.at, until: n.at + 12 * H, banner: bannerName('gacha', n.id), text: gachaText(n) });
  return out.filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
}

// ホームとゲームの画面に出す告知バナー (新キャラ・クエスト)。始まる 1 日前から予告、終わったら消える
function banners(now = Date.now()) {
  const { CARDS, SKILLS, RELEASES, QUESTS, PICKUPS } = cards;
  const out = [];
  for (const q of QUESTS) {
    if (now < q.start - D || now >= q.end) continue;
    const live = now >= q.start, r = CARDS[q.reward];
    out.push({ id: 'quest:' + q.id, kind: 'quest', live, image: bannerFile(bannerName('quest', q.id)) ? `/banners/${bannerName('quest', q.id)}.jpg` : null, href: '#/games/cards/quest', art: { id: r.id, rarity: r.rarity },
      tag: live ? '🌠 期間限定クエスト 開催中' : `🌠 ${jstDay(q.start) === jstDay(now) ? '本日' : fmt(q.start).replace(/ .*/, '')} ${hm(q.start)} から 期間限定クエスト`,
      title: q.name, text: `クリアで ${r.rarity}「${r.name}」が仲間に！`, sub: live ? `${fmt(q.end)} まで` : `${fmt(q.start)} 開始`, start: q.start, end: q.end });
  }
  for (const g of cards.BULK_RELEASES) {
    if (now < g.at - D || now >= g.at + 7 * D) continue;
    const live = now >= g.at, top = g.ids.find((id) => CARDS[id].rarity === 'SSR') || g.ids[0];
    out.push({ id: 'bulk:' + g.id, kind: 'char', live, image: bannerFile(bannerName('bulk', g.id)) ? `/banners/${bannerName('bulk', g.id)}.jpg` : null, href: '#/games/cards/gacha', art: { id: top, rarity: CARDS[top].rarity },
      tag: live ? '🎉 新キャラ大量追加！' : `🎉 ${fmt(g.at)} 新キャラ大量追加！`, title: g.name, text: `R・SR・SSR あわせて ${g.ids.length} 体がガチャに登場`, sub: live ? 'すべて恒常 · ガチャに登場中' : `${fmt(g.at)} 登場`, start: g.at, end: g.at + 7 * D });
  }
  for (const [id, at] of Object.entries(RELEASES)) {
    const c = CARDS[id]; if (!c || !cards.RARITY[c.rarity] || cards.BULK_IDS.has(id)) continue;
    const pk = PICKUPS.find((x) => x.id === id), end = pk?.end || at + 7 * D;
    if (now < at - D || now >= end) continue;
    const live = now >= at;
    out.push({ id: 'char:' + id, kind: 'char', live, image: bannerFile(bannerName('char', id)) ? `/banners/${bannerName('char', id)}.jpg` : null, href: '#/games/cards/gacha', art: { id, rarity: c.rarity },
      tag: live ? '🆕 新キャラ登場！' : `🆕 ${jstDay(at) === jstDay(now) ? '本日' : fmt(at).replace(/ .*/, '')} ${hm(at)} 新キャラ登場！`,
      title: `${c.rarity}「${c.name}」`, text: `わざ「${SKILLS[c.skill].name}」${pk ? ` · ピックアップ 1 体 ${pk.rate}%` : ''}`,
      sub: live ? (pk?.end ? `ピックアップは ${fmt(pk.end)} まで` : 'ガチャに登場中') : `${fmt(at)} ガチャに登場`, start: at, end });
  }
  for (const n of GACHA_NOTICES) {
    if (now < n.at || now >= n.until) continue;
    const g = gachaInfo(n), name = bannerName('gacha', n.id);
    out.push({ id: 'gacha:' + n.id, kind: 'char', live: true, href: '#/games/cards/gacha', image: bannerFile(name) ? `/banners/${name}.jpg` : null,
      art: { id: g.pickups[0]?.id || 'case', rarity: g.pickups[0]?.card.rarity || 'SSR' }, tag: '🎰 ガチャのお知らせ', title: g.sale ? g.sale.name : 'ガチャ',
      text: [g.sale ? `1 回 ${g.sale.pull} コイン` : '', ...g.pickups.map((p) => `${p.card.name} ${p.rate}%`)].filter(Boolean).join(' · '), sub: `${fmt(n.until)} まで`, start: n.at - 1, end: n.until });
  }
  // 高難易度クエストが 2 つ以上あるときは、1 つのバナーにまとめる (スライドで切りかえ)
  const hard = out.filter((b) => b.kind === 'quest' && QUESTS.find((q) => 'quest:' + q.id === b.id)?.hard);
  if (hard.length >= 2) {
    const live = hard.filter((b) => b.live).length;
    const set = { id: 'hardset:' + hard.map((b) => b.id.slice(6)).join('+'), kind: 'quest', multi: true, live: live > 0, href: '#/games/cards/quest',
      tag: `⚔️ 高難易度クエスト ${live ? `${live} つ開催中` : 'もうすぐ開始'}`, title: '高難易度クエスト', text: hard.map((b) => b.title).join('・'), sub: '',
      items: hard.map((b) => ({ id: b.id, image: b.image, art: b.art, title: b.title, text: b.text, sub: b.sub, live: b.live, href: b.href })), start: Math.min(...hard.map((b) => b.start)), end: Math.max(...hard.map((b) => b.end)) };
    const rest = out.filter((b) => !hard.includes(b));
    rest.push(set);
    return rest.sort((a, b) => a.start - b.start);
  }
  return out.sort((a, b) => a.start - b.start);
}

module.exports = function install(app, ctx) {
  const { db, rateLimit } = ctx;
  db.migrate('2026-11-25-official', MIGRATION);
  const getState = (k) => db.prepare('SELECT value FROM official_state WHERE key = ?').get(k)?.value;
  const setState = (k, v) => db.prepare('INSERT INTO official_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

  // ---------- 公式アカウントを用意する ----------
  function ensureAccount() {
    let u = getState('user_id') && db.prepare('SELECT * FROM users WHERE id = ?').get(Number(getState('user_id')));
    if (!u) {
      const name = NAMES.find((n) => !db.prepare('SELECT 1 FROM users WHERE username = ?').get(n));
      if (!name) { console.warn('[official] 公式アカウントのユーザー名が使えません'); return null; }
      const salt = crypto.randomBytes(16).toString('hex');
      const r = db.prepare('INSERT INTO users (username, display_name, bio, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, DISPLAY, BIO, ctx.hashPw(crypto.randomBytes(32).toString('hex'), salt), salt, Date.now()); // だれも知らないパスワード
      setState('user_id', r.lastInsertRowid);
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
      console.log(`[official] 公式アカウント @${u.username} を作りました`);
    }
    db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(DISPLAY, BIO, u.id);
    db.prepare(`INSERT INTO user_avatars (user_id, kind, image, emoji, color, updated_at) VALUES (?, 'emoji', NULL, '📢', '#4b55f0', ?)
      ON CONFLICT(user_id) DO UPDATE SET kind = 'emoji', image = NULL, emoji = '📢', color = '#4b55f0'`).run(u.id, Date.now());
    db.prepare(`INSERT INTO user_verifications (user_id, label, verified_name, verified_by, verified_at) VALUES (?, '公式', ?, NULL, ?)
      ON CONFLICT(user_id) DO UPDATE SET label = '公式', verified_name = excluded.verified_name`).run(u.id, DISPLAY, Date.now());
    return u.id;
  }
  // まだだれも登録していない (まっさらな) ときは作らない (最初に登録した人が 1 番 = 管理者になるように)
  const hasUsers = () => db.prepare('SELECT 1 FROM users LIMIT 1').get();
  let officialId = hasUsers() ? ensureAccount() : null;
  ctx.officialId = () => officialId;
  ctx.isReservedName = (username) => RESERVED.test(String(username || ''));

  // ---------- 時刻になったら投稿する ----------
  function post(text, banner = null) {
    if (!officialId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(officialId)) officialId = hasUsers() ? ensureAccount() : null;
    if (!officialId) return null;
    const r = db.prepare('INSERT INTO posts (user_id, content, created_at) VALUES (?, ?, ?)').run(officialId, text.slice(0, 280), Date.now());
    const postId = Number(r.lastInsertRowid);
    const f = banner && bannerFile(banner);
    if (f) { // ドパバナーの画像をつける (ふつうの写真と同じように保存)
      try { const c = cleanJpeg(fs.readFileSync(f)); db.prepare('INSERT INTO post_images (post_id, user_id, position, width, height, image, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)').run(postId, officialId, c.width, c.height, c.jpeg, Date.now()); }
      catch (e) { console.warn('[official] バナー画像を付けられませんでした', banner, e.message); }
    }
    ctx.invalidateTrends?.();
    return postId;
  }
  const posted = db.prepare('SELECT 1 FROM official_posts WHERE key = ?');
  function tick(now = Date.now()) {
    if (!officialId && hasUsers()) officialId = ensureAccount();
    if (!officialId) return;
    for (const e of schedule()) {
      if (now < e.at || now >= e.until || posted.get(e.key)) continue;
      const id = post(e.text, e.banner);
      db.prepare('INSERT OR IGNORE INTO official_posts (key, post_id, posted_at) VALUES (?, ?, ?)').run(e.key, id, now);
      console.log(`[official] 投稿しました: ${e.key}`);
    }
  }
  // ---------- 高難易度クエストの表彰 (cards.js が、1 番目・2 番目にクリアした人が出たときに呼ぶ) ----------
  ctx.officialAward = ({ quest, rank, user, turns, at, title }) => {
    const key = `quest-award:${quest.id}:${rank}`;
    if (!user || posted.get(key)) return;
    const mins = Math.max(0, Math.floor((at - quest.start) / 60000)), took = mins >= 1440 ? `${Math.floor(mins / 1440)} 日 ${Math.floor(mins / 60) % 24} 時間` : mins >= 60 ? `${Math.floor(mins / 60)} 時間 ${mins % 60} 分` : `${mins} 分`;
    const r = cards.CARDS[quest.reward];
    const who = `${user.display_name || user.username} (@${user.username})`;
    const e = quest.emoji || '⚡';
    const text = rank === 1 ? `${e}${e}${e}【${quest.boss} 討伐速報】${e}${e}${e}
🏆👑 最速討伐者、誕生！！ 👑🏆
${who} さんが「${quest.name}」で ${quest.boss}を全校最速で討伐ッ！！
⏱ 開始から ${took}・${turns} ターンで撃破
🎁 ${r.rarity}「${r.name}」GET＆称号「${title || '最速討伐'}」授与！！
${quest.award || '伝説の始まりだ🔥🔥🔥'} ${TAG}`
      : `${e}${e}【${quest.boss} 討伐速報・第 2 報】${e}${e}
🥈✨ 準最速討伐者、現る！！ ✨🥈
${who} さんが「${quest.name}」で ${quest.boss}を討伐ッ！！
⏱ 開始から ${took}・${turns} ターンで撃破
🎁 ${r.rarity}「${r.name}」GET＆称号「${title || '準最速討伐'}」授与！！
次の討伐者はキミだ${e}🔥 ${TAG}`;
    const award = bannerName('award', `${quest.id}-${rank}`); // 表彰の金ピカ画像 (なければクエストのバナー)
    const id = post(text, bannerFile(award) ? award : bannerName('quest', quest.id));
    if (id) { db.prepare('INSERT OR IGNORE INTO official_posts (key, post_id, posted_at) VALUES (?, ?, ?)').run(key, id, Date.now()); console.log(`[official] 表彰しました: ${key} @${user.username}`); }
  };

  setTimeout(tick, 3000).unref();
  setInterval(tick, Number(process.env.OFFICIAL_TICK_MS) || 30_000).unref();

  // ---------- 告知バナー ----------
  app.get('/api/events/banners', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
    const u = officialId && db.prepare('SELECT username FROM users WHERE id = ?').get(officialId);
    res.json({ banners: banners(), official: u ? u.username : null });
  });
};
Object.assign(module.exports, { schedule, banners, UPDATES, GACHA_NOTICES, gachaInfo, bannerName });
