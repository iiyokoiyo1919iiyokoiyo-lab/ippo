// =====================================================================
// 新キャラ・期間限定クエストの「ドパバナー」(告知画像) を作る
//   node tools/make_banners.js            … まだ画像がないものだけ作る
//   node tools/make_banners.js --force    … 全部作り直す
// ・カードゲームの設定 (cards.js の RELEASES / QUESTS / PICKUPS) から自動で作る。キャラの絵は public/cards-art.js をそのまま使う
// ・出来上がりは public/banners/<名前>.jpg (1200×675)。公式アカウントの投稿と、アプリの告知バナーで使う
// ・作るのにブラウザ (Playwright) を使うのは開発のときだけ。サーバーには入れない
// 新キャラ・新クエストを追加したら、このスクリプトを実行して画像もいっしょにコミットすること
// =====================================================================
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cards = require('../cards');
const { bannerName, GACHA_NOTICES, gachaInfo } = require('../official');

const OUT = path.join(__dirname, '..', 'public', 'banners');
const ART = fs.readFileSync(path.join(__dirname, '..', 'public', 'cards-art.js'), 'utf8');
const force = process.argv.includes('--force');
const fmt = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BASE = `
*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;overflow:hidden;font-family:"Hiragino Maru Gothic ProN","Noto Sans CJK JP","Noto Sans JP",sans-serif;font-weight:900}
.bn{position:relative;width:1200px;height:675px;overflow:hidden}
.rays{position:absolute;left:50%;top:50%;width:2400px;height:2400px;margin:-1200px 0 0 -1200px;background:repeating-conic-gradient(from 0deg,var(--r1) 0 7.5deg,var(--r2) 7.5deg 15deg);opacity:.55}
.glow{position:absolute;border-radius:50%;filter:blur(30px)}
.art{position:absolute;filter:drop-shadow(0 18px 30px rgba(0,0,0,.35))}
.art svg{width:100%;height:100%}
.stroke{-webkit-text-stroke:var(--sw,10px) var(--sc,#fff);paint-order:stroke fill}
.spark{position:absolute;color:#fff;text-shadow:0 0 18px #fff}
.conf{position:absolute;width:18px;height:30px;border-radius:4px}
.ribbon{position:absolute;padding:10px 70px;transform:rotate(-12deg);font-size:46px;letter-spacing:.06em;color:#fff;box-shadow:0 10px 0 rgba(0,0,0,.18)}
.badge{position:absolute;display:grid;place-items:center;text-align:center;color:#fff;clip-path:polygon(50% 0,61% 13%,77% 7%,79% 24%,95% 27%,89% 42%,100% 54%,87% 64%,92% 81%,75% 82%,68% 98%,53% 89%,38% 99%,31% 83%,13% 84%,16% 67%,0 56%,11% 43%,4% 27%,21% 24%,23% 7%,39% 13%)}
.date{position:absolute;padding:10px 26px;border-radius:999px;font-size:30px}
`;
const confetti = (n, cols) => Array.from({ length: n }, (_, i) => `<i class="conf" style="left:${(i * 137) % 1200}px;top:${(i * 89) % 675}px;background:${cols[i % cols.length]};transform:rotate(${(i * 47) % 360}deg)"></i>`).join('');
const sparks = (n) => Array.from({ length: n }, (_, i) => `<span class="spark" style="left:${(i * 263 + 40) % 1160}px;top:${(i * 151 + 20) % 640}px;font-size:${28 + (i % 4) * 14}px">✦</span>`).join('');

// 新キャラ
function charHtml(id, at) {
  const c = cards.CARDS[id], sk = cards.SKILLS[c.skill], pk = cards.PICKUPS.find((x) => x.id === id);
  return `<div class="bn" style="background:radial-gradient(circle at 30% 50%,#fff7d6,#ffd43b 35%,#ff6b9d 75%,#c2255c);--r1:#fff3bf;--r2:transparent">
    <div class="rays" style="left:30%"></div>${confetti(36, ['#ff6b6b', '#ffd43b', '#74c0fc', '#8ce99a', '#fff', '#b197fc'])}${sparks(14)}
    <div class="glow" style="left:60px;top:90px;width:520px;height:520px;background:radial-gradient(#fff,rgba(255,255,255,0))"></div>
    <div class="art" style="left:40px;top:60px;width:560px;height:560px">${'%%ART%%'}</div>
    <div class="ribbon" style="left:-40px;top:34px;background:linear-gradient(90deg,#e03131,#f76707)">NEW!! 新キャラ登場</div>
    <div style="position:absolute;left:560px;top:120px;width:620px">
      <div class="stroke" style="--sw:12px;--sc:#fff;font-size:44px;color:#c2255c">${esc(c.rarity)} ★ ${esc(cards.TYPES?.[c.type]?.name || '')}</div>
      <div class="stroke" style="--sw:16px;--sc:#fff;font-size:${[...c.name].length > 7 ? 74 : 88}px;line-height:1.1;color:#d6336c;text-shadow:0 8px 0 rgba(120,0,60,.35);white-space:nowrap">${esc(c.name)}</div>
      <div style="margin-top:18px;padding:14px 20px;border-radius:20px;background:rgba(80,0,50,.55);color:#fff;width:560px"><div style="font-size:30px;color:#ffe066">わざ「${esc(sk.name)}」</div>
      <div style="margin-top:6px;font-size:22px;line-height:1.45;font-weight:700">${esc(sk.desc.replace(/\s*\([^()]*だけのわざ\)/, ''))}</div></div>
    </div>
    ${pk ? `<div class="badge" style="right:40px;bottom:30px;width:230px;height:230px;background:radial-gradient(#ff8787,#e03131)"><div><div style="font-size:26px">ピックアップ</div><div style="font-size:72px;line-height:1">${pk.rate}%</div></div></div>` : ''}
    <div class="date" style="left:600px;bottom:44px;background:#fff;color:#c2255c;box-shadow:0 6px 0 rgba(120,0,60,.25)">${esc(fmt(at))}〜 ガチャに登場</div>
  </div>`;
}
// 期間限定クエスト
function questHtml(q) {
  const r = cards.CARDS[q.reward];
  const meteors = Array.from({ length: 9 }, (_, i) => `<i style="position:absolute;left:${(i * 151 + 80) % 1200}px;top:${(i * 71) % 300 - 40}px;width:5px;height:${120 + (i % 3) * 50}px;border-radius:5px;background:linear-gradient(transparent,#fff 80%,#ffe066);transform:rotate(-38deg);box-shadow:0 0 14px #fff"></i>`).join('');
  return `<div class="bn" style="background:radial-gradient(circle at 25% 55%,#7b4dff,#3b1f8f 45%,#140b3a 80%);">
    <div style="position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.9) 0 1.5px,transparent 2px) 0 0/46px 46px,radial-gradient(circle,rgba(255,224,102,.9) 0 1.5px,transparent 2px) 23px 17px/61px 61px"></div>
    ${meteors}${sparks(12)}
    <div class="glow" style="left:60px;top:100px;width:520px;height:520px;background:radial-gradient(rgba(255,214,245,.9),rgba(255,107,214,0))"></div>
    <div class="art" style="left:40px;top:70px;width:560px;height:560px">%%ART%%</div>
    <div class="ribbon" style="left:-40px;top:34px;background:linear-gradient(90deg,#7048e8,#d6336c)">🌠 期間限定クエスト</div>
    <div style="position:absolute;left:570px;top:130px;width:610px">
      <div class="stroke" style="--sw:14px;--sc:#2a1a6e;font-size:${[...q.name].length > 7 ? 68 : 84}px;line-height:1.12;color:#fff;text-shadow:0 0 30px #ff6bd6;white-space:nowrap">${esc(q.name)}</div>
      <div style="margin-top:22px;font-size:36px;color:#ffe066;text-shadow:0 3px 0 #2a1a6e">クリアで <span style="color:#ff8fd8;font-size:54px;text-shadow:0 0 16px #ff6bd6,0 3px 0 #2a1a6e">${esc(r.rarity)}</span> ${esc(r.name)} GET!!</div>
      <div style="margin-top:14px;display:inline-block;padding:8px 16px;border-radius:14px;background:rgba(20,11,58,.7);font-size:22px;color:#e5dbff;font-weight:700">敵: ${q.enemy.map(([id, lv]) => `${esc(cards.CARDS[id].name)} Lv${lv}`).join('・')}</div>
    </div>
    <div class="date" style="left:600px;bottom:44px;background:linear-gradient(90deg,#ffe066,#ffa8e2);color:#2a1a6e">${esc(fmt(q.start))} 〜 ${esc(fmt(q.end))}</div>
  </div>`;
}

// ガチャの告知 (セール・ピックアップ・確率アップ)
function gachaHtml(n) {
  const g = gachaInfo(n), pk = g.pickups[0];
  return `<div class="bn" style="background:radial-gradient(circle at 26% 50%,#fff3bf,#ffd43b 30%,#ff922b 60%,#e03131 90%);--r1:rgba(255,255,255,.55);--r2:transparent">
    <div class="rays" style="left:26%"></div>${confetti(44, ['#fff', '#ffd43b', '#74c0fc', '#b197fc', '#8ce99a', '#ff8787'])}${sparks(16)}
    <div class="glow" style="left:40px;top:80px;width:540px;height:540px;background:radial-gradient(#fff,rgba(255,255,255,0))"></div>
    <div class="art" style="left:30px;top:70px;width:540px;height:540px">%%ART%%</div>
    <div class="ribbon" style="left:-40px;top:34px;background:linear-gradient(90deg,#c92a2a,#7048e8)">🎰 ガチャのお知らせ</div>
    <div style="position:absolute;left:560px;top:96px;width:620px;display:grid;gap:14px">
      ${g.sale ? `<div style="padding:16px 22px;border-radius:24px;background:rgba(120,0,30,.72);color:#fff">
        <div style="font-size:30px;color:#ffe066">🔥 ${esc(g.sale.name)}</div>
        <div style="font-size:30px;margin-top:4px">1回 <s style="opacity:.75">100</s> → <span style="font-size:76px;color:#ffe066;line-height:1">${g.sale.pull}</span>🪙
          <span style="font-size:26px;margin-left:10px">10回 <s style="opacity:.75">900</s> → <b style="font-size:40px;color:#ffe066">${g.sale.ten}</b></span></div>
        <div style="font-size:22px;margin-top:2px;font-weight:700">${esc(fmt(g.sale.end))} まで</div></div>` : ''}
      ${g.pickups.map((p) => `<div style="padding:12px 22px;border-radius:24px;background:rgba(255,255,255,.92);color:#c2255c;box-shadow:0 6px 0 rgba(120,0,30,.25)">
        <div style="font-size:30px">🎯 ${esc(p.card.rarity)}「${esc(p.card.name)}」ピックアップ <span style="font-size:48px;color:#e03131">${p.rate}%</span></div>
        <div style="font-size:22px;color:#862e9c;font-weight:700">${p.start > n.at ? esc(fmt(p.start)) + ' 〜 ' : ''}${p.end ? esc(fmt(p.end)) + ' まで' : ''}</div></div>`).join('')}
      ${g.rateUps.map((r) => `<div style="padding:10px 22px;border-radius:20px;background:rgba(40,20,90,.7);color:#fff;font-size:24px">🎉 ${esc(r.name)}${r.end ? ` <span style="font-size:20px;color:#ffe066">${esc(fmt(r.end))} まで</span>` : ''}</div>`).join('')}
    </div>
  </div>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (const [id, at] of Object.entries(cards.RELEASES)) if (cards.RARITY[cards.CARDS[id]?.rarity]) jobs.push({ name: bannerName('char', id), html: charHtml(id, at), art: [id, cards.CARDS[id].rarity] });
  for (const q of cards.QUESTS) jobs.push({ name: bannerName('quest', q.id), html: questHtml(q), art: [q.reward, cards.CARDS[q.reward].rarity] });
  for (const n of GACHA_NOTICES) { const pk = gachaInfo(n).pickups[0]; jobs.push({ name: bannerName('gacha', n.id), html: gachaHtml(n), art: pk ? [pk.id, pk.card.rarity] : ['case', 'SSR'] }); }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
  for (const j of jobs) {
    const file = path.join(OUT, j.name + '.jpg');
    if (fs.existsSync(file) && !force) { console.log('あり:', j.name); continue; }
    await p.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}</style><body>${j.html}</body>`);
    await p.addScriptTag({ content: ART });
    await p.evaluate(([id, r]) => { document.querySelector('.art').innerHTML = window.CBArt.svg(id, r); document.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; }); }, j.art);
    await p.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log('作った:', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
  }
  await b.close();
})();
