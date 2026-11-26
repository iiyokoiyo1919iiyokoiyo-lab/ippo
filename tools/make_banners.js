// =====================================================================
// 新キャラ・期間限定クエストの「ドパバナー」(告知画像) を作る
//   node tools/make_banners.js            … まだ画像がないものだけ作る
//   node tools/make_banners.js --force    … 全部作り直す
//   node tools/make_banners.js --only <名前> … その 1 枚だけ作り直す (例: char-suetsugu)
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
const CUSTOM = new Set(['char-yumiko2048']); // 利用者が用意したバナー (作り直さない)
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null; // --only <名前>: その画像だけ作り直す
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

// 祭 (例: 毎週月曜のIppO祭) のドパデザイン: ネオンピンク × 紫 × 水色、ハートとキラキラ、虹色のロゴ。キャラの可愛さが主役
// right: 右側の中身 (キャラのバナーはわざ、ガチャのお知らせはセールとピックアップ)
const festName = (pk) => { const m = /^(.*?)([^のな]*祭)$/.exec(pk.name); return m ? [m[1], m[2]] : ['', pk.name]; };
function festHtml(pk, at, right, { stamp = '期間限定' } = {}) {
  const [pre, main] = festName(pk);
  const hearts = Array.from({ length: 26 }, (_, i) => `<span style="position:absolute;left:${(i * 173 + 30) % 1180}px;top:${(i * 97 + 10) % 660}px;font-size:${22 + (i % 5) * 9}px;color:${['#fff', '#ffe066', '#ff8cc6', '#a5f3ff', '#d0bfff'][i % 5]};transform:rotate(${(i * 31) % 50 - 25}deg);opacity:${0.55 + (i % 3) * 0.2};text-shadow:0 0 12px rgba(255,255,255,.8)">${i % 3 ? '♥' : '★'}</span>`).join('');
  const glitter = Array.from({ length: 22 }, (_, i) => `<span class="spark" style="left:${(i * 211 + 70) % 1160}px;top:${(i * 131 + 40) % 640}px;font-size:${18 + (i % 4) * 16}px;color:${i % 2 ? '#fff' : '#fff3bf'}">✦</span>`).join('');
  return `<div class="bn" style="background:radial-gradient(circle at 26% 58%,#fff 0,#ffd6ec 14%,#ff5fae 36%,#c13dff 66%,#5a2bd8 100%)">
    <div class="rays" style="left:26%;top:58%;--r1:rgba(255,255,255,.5);--r2:transparent;opacity:.6"></div>
    <div style="position:absolute;inset:0;background:radial-gradient(rgba(255,255,255,.35) 2.4px,transparent 3px) 0 0/22px 22px;-webkit-mask:linear-gradient(115deg,transparent 45%,#000 75%);mask:linear-gradient(115deg,transparent 45%,#000 75%)"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(115deg,transparent 52%,rgba(120,240,255,.35) 66%,rgba(255,240,120,.25) 76%,transparent 90%)"></div>
    ${hearts}${glitter}
    <svg style="position:absolute;left:24px;top:110px;width:560px;height:540px;filter:blur(10px)" viewBox="0 0 100 92"><path d="M50,88 C10,62 0,40 6,24 C14,4 40,4 50,22 C60,4 86,4 94,24 C100,40 90,62 50,88Z" fill="#fff" opacity=".85"/></svg>
    <svg style="position:absolute;left:44px;top:128px;width:520px;height:500px" viewBox="0 0 100 92"><path d="M50,88 C10,62 0,40 6,24 C14,4 40,4 50,22 C60,4 86,4 94,24 C100,40 90,62 50,88Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="1 3" stroke-linecap="round"/></svg>
    <div class="art" style="left:70px;top:150px;width:470px;height:470px;filter:drop-shadow(0 0 22px rgba(255,255,255,.9)) drop-shadow(0 14px 18px rgba(90,0,80,.35))">%%ART%%</div>
    <div style="position:absolute;left:26px;top:14px;transform:rotate(-5deg);transform-origin:left top">
      ${pre ? `<div style="display:inline-block;padding:4px 22px;border-radius:999px;background:linear-gradient(90deg,#ffe066,#ff922b);color:#7a1450;font-size:30px;box-shadow:0 5px 0 rgba(120,0,60,.35);border:3px solid #fff">${esc(pre)}</div>` : ''}
      <div style="position:relative;height:118px;margin-top:-4px;font-size:112px;line-height:1.05;letter-spacing:.02em;white-space:nowrap">
        <span style="position:absolute;left:0;top:0;color:#fff;-webkit-text-stroke:26px #fff;paint-order:stroke fill;text-shadow:0 10px 0 #7b2cbf,0 0 40px #ff5fae">${esc(main)}</span>
        <span style="position:absolute;left:0;top:0;-webkit-text-stroke:8px #7b2cbf;paint-order:stroke fill;color:#7b2cbf">${esc(main)}</span>
        <span style="position:absolute;left:0;top:0;background:linear-gradient(180deg,#ffe3f1 0,#ff5fae 30%,#ff2e93 50%,#ffd43b 51%,#ff922b 75%,#ff5fae 100%);-webkit-background-clip:text;background-clip:text;color:transparent">${esc(main)}</span>
      </div>
    </div>
    <div class="badge" style="left:396px;top:438px;width:196px;height:196px;background:radial-gradient(#fff9db,#ffe066 45%,#fab005);color:#c2255c;filter:drop-shadow(0 6px 0 rgba(120,0,60,.3))"><div style="transform:rotate(-8deg)"><div style="font-size:22px">ピックアップ</div><div style="font-size:64px;line-height:1;-webkit-text-stroke:6px #fff;paint-order:stroke fill">${pk.rate.toFixed(1)}<small style="font-size:34px">%</small></div></div></div>
    <div style="position:absolute;left:470px;top:26px;transform:rotate(10deg);padding:6px 16px;border:5px solid #fff;border-radius:14px;color:#fff;font-size:34px;background:linear-gradient(135deg,#ff2e93,#c13dff);box-shadow:0 0 0 4px #ff2e93,0 8px 0 rgba(90,0,80,.35)">${esc(stamp)}</div>
    <div style="position:absolute;left:610px;top:138px;width:570px;display:grid;gap:10px">${right}</div>
    <div class="date" style="right:26px;bottom:22px;background:linear-gradient(90deg,#fff,#fff0f6);color:#c2255c;border:4px solid #ff5fae;box-shadow:0 0 22px rgba(255,255,255,.8),0 6px 0 rgba(90,0,80,.3)">${esc(fmt(at))}〜 ガチャに登場</div>
  </div>`;
}
function festCharRight(c, sk, { withSkill = true } = {}) {
  const ps = withSkill && cards.CARD_PASSIVE[c.id], n = [...c.name], cut = c.name.startsWith('魔法使い') ? 4 : Math.ceil(n.length / 2), l1 = n.slice(0, cut).join(''), l2 = n.slice(cut).join('');
  const big = (t, fs) => `<div style="font-size:${fs}px;line-height:1.08;white-space:nowrap;color:#ff2e93;-webkit-text-stroke:16px #fff;paint-order:stroke fill;text-shadow:0 8px 0 #7b2cbf,0 0 30px rgba(255,255,255,.7)">${esc(t)}</div>`;
  return `<div><span style="display:inline-block;padding:4px 18px;border-radius:999px;background:linear-gradient(90deg,#ffd43b,#ff8cc6,#b197fc,#74c0fc);color:#fff;font-size:30px;-webkit-text-stroke:6px #7b2cbf;paint-order:stroke fill;border:3px solid #fff">✨ ${esc(c.rarity)} ★ ${esc(cards.TYPES?.[c.type]?.name || '')}</span></div>
    <div>${n.length <= 4 ? big(c.name, ps ? 96 : 120) /* 短い名前は 1 行で大きく */ : big(l1, ps ? 52 : 64) + big(l2, ps ? 84 : 104)}</div>
    ${withSkill ? `    <div style="padding:${ps ? '10px 18px' : '14px 20px'};border-radius:24px;background:linear-gradient(135deg,rgba(70,10,110,.78),rgba(160,20,110,.7));border:3px solid #ffb3d9;box-shadow:0 0 24px rgba(255,140,198,.8),inset 0 0 18px rgba(255,255,255,.15);color:#fff">
      <div style="font-size:31px;color:#ffe066;text-shadow:0 0 12px rgba(255,224,102,.7)">${c.skill === 'dna' ? '🧬' : esc(c.emoji || '✨')} わざ「${esc(sk.name)}」</div>
      <div style="margin-top:4px;font-size:22px;line-height:1.45;font-weight:800">${esc(sk.desc.replace(/\s*\([^()]*\)\s*$/, ''))}</div>
      ${cards.CARD_PASSIVE[c.id] ? `<div style="margin-top:6px;font-size:25px;color:#a5f3ff;text-shadow:0 0 12px rgba(165,243,255,.7)">${({ knife: '🔪', morale: '🔥', hold: '🖤' })[cards.CARD_PASSIVE[c.id]] || '💗'} パッシブ「${esc(cards.PASSIVES[cards.CARD_PASSIVE[c.id]].name)}」</div><div style="font-size:20px;line-height:1.35;font-weight:800">${esc(cards.PASSIVES[cards.CARD_PASSIVE[c.id]].desc)}</div>` : ''}</div>` : ''}`;
}
// 新キャラ
function charHtml(id, at) {
  const c = cards.CARDS[id], sk = cards.SKILLS[c.skill], pk = cards.PICKUPS.find((x) => x.id === id);
  if (pk && /祭/.test(pk.name)) return festHtml(pk, at, festCharRight(c, sk));
  return `<div class="bn" style="background:radial-gradient(circle at 30% 50%,#fff7d6,#ffd43b 35%,#ff6b9d 75%,#c2255c);--r1:#fff3bf;--r2:transparent">
    <div class="rays" style="left:30%"></div>${confetti(36, ['#ff6b6b', '#ffd43b', '#74c0fc', '#8ce99a', '#fff', '#b197fc'])}${sparks(14)}
    <div class="glow" style="left:60px;top:90px;width:520px;height:520px;background:radial-gradient(#fff,rgba(255,255,255,0))"></div>
    <div class="art" style="left:40px;top:60px;width:560px;height:560px">${'%%ART%%'}</div>
    <div class="ribbon" style="left:-40px;top:34px;background:linear-gradient(90deg,#e03131,#f76707)">${pk && /祭/.test(pk.name) ? `🎊 ${esc(pk.name)} 期間限定` : 'NEW!! 新キャラ登場'}</div>
    <div style="position:absolute;left:560px;top:120px;width:620px">
      <div class="stroke" style="--sw:12px;--sc:#fff;font-size:44px;color:#c2255c">${esc(c.rarity)} ★ ${esc(cards.TYPES?.[c.type]?.name || '')}</div>
      <div class="stroke" style="--sw:16px;--sc:#fff;font-size:${[...c.name].length > 7 ? 58 : 88}px;line-height:1.1;color:#d6336c;text-shadow:0 8px 0 rgba(120,0,60,.35);white-space:nowrap">${esc(c.name)}</div>
      <div style="margin-top:18px;padding:14px 20px;border-radius:20px;background:rgba(80,0,50,.55);color:#fff;width:560px"><div style="font-size:30px;color:#ffe066">わざ「${esc(sk.name)}」</div>
      <div style="margin-top:6px;font-size:22px;line-height:1.45;font-weight:700">${esc(sk.desc.replace(/\s*\([^()]*だけのわざ\)/, ''))}</div>
      ${cards.CARD_PASSIVE[id] ? `<div style="margin-top:10px;font-size:26px;color:#ffc078">🔥 パッシブ「${esc(cards.PASSIVES[cards.CARD_PASSIVE[id]].name)}」</div><div style="font-size:21px;line-height:1.45;font-weight:700">${esc(cards.PASSIVES[cards.CARD_PASSIVE[id]].desc)}</div>` : ''}</div>
    </div>
    ${pk ? `<div class="badge" style="right:${[...c.name].length > 7 ? 14 : 30}px;top:${[...c.name].length > 7 ? 10 : 24}px;width:${[...c.name].length > 7 ? 168 : 210}px;height:${[...c.name].length > 7 ? 168 : 210}px;background:radial-gradient(#ff8787,#e03131)"><div><div style="font-size:26px">ピックアップ</div><div style="font-size:72px;line-height:1">${pk.rate}%</div></div></div>` : ''}
    <div class="date" style="left:600px;bottom:44px;background:#fff;color:#c2255c;box-shadow:0 6px 0 rgba(120,0,60,.25)">${esc(fmt(at))}〜 ガチャに登場</div>
  </div>`;
}
// 期間限定クエスト
function questHtml(q) {
  const r = cards.CARDS[q.reward];
  if (q.hard) return hardQuestHtml(q, r);
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

// 高難易度クエスト: 雷雲と稲妻
function hardQuestHtml(q, r) {
  const bolt = (x, y, s, o = 1) => `<svg style="position:absolute;left:${x}px;top:${y}px;width:${90 * s}px;height:${220 * s}px;opacity:${o};filter:drop-shadow(0 0 18px #ffd43b) drop-shadow(0 0 40px #fab005)" viewBox="0 0 90 220"><path d="M50,0L10,110H40L20,220L85,80H52L72,0Z" fill="#fff3bf" stroke="#ffd43b" stroke-width="4"/></svg>`;
  const water = q.bg === 'suishinya', taika = q.bg === 'taika', ys = q.bg === 'ystage', sc = q.bg === 'shachou';
  const bubble = (x, y, d) => `<i style="position:absolute;left:${x}px;top:${y}px;width:${d}px;height:${d}px;border-radius:50%;border:3px solid rgba(208,235,255,.8);box-shadow:inset -6px -6px 0 rgba(255,255,255,.25)"></i>`;
  const cloud = (x, y, s) => `<div style="position:absolute;left:${x}px;top:${y}px;transform:scale(${s});width:220px;height:60px"><i style="position:absolute;left:0;top:20px;width:200px;height:16px;border-radius:9px;background:#ffd43b;box-shadow:0 0 0 4px #fff3bf inset"></i><i style="position:absolute;left:40px;top:0;width:120px;height:14px;border-radius:9px;background:#ffd43b"></i><i style="position:absolute;left:70px;top:42px;width:150px;height:14px;border-radius:9px;background:#ffd43b"></i></div>`;
  const note = (x, y, s, c, ch) => `<span style="position:absolute;left:${x}px;top:${y}px;font-size:${s}px;color:${c};text-shadow:0 0 18px ${c};transform:rotate(${(x % 40) - 20}deg)">${ch}</span>`;
  const deco = sc ? `${Array.from({ length: 14 }, (_, i) => `<div style="position:absolute;left:${560 + i * 48}px;bottom:0;width:40px;height:${120 + ((i * 53) % 160)}px;background:linear-gradient(#1a1a1a,#000);box-shadow:inset 0 0 0 1px rgba(255,212,59,.25)">${Array.from({ length: 6 }, (_, k) => `<i style="position:absolute;left:${6 + (k % 2) * 16}px;top:${10 + Math.floor(k / 2) * 22}px;width:10px;height:12px;background:${(i + k) % 3 ? '#ffd43b' : 'rgba(255,212,59,.2)'}"></i>`).join('')}</div>`).join('')}<div style="position:absolute;left:520px;top:30px;font-size:64px;opacity:.8">💼</div><div style="position:absolute;left:1110px;top:24px;font-size:54px;opacity:.8">📈</div>`
    : ys ? `<div style="position:absolute;left:640px;top:-40px;width:260px;height:760px;background:linear-gradient(rgba(255,140,198,.45),rgba(255,140,198,0));clip-path:polygon(40% 0,60% 0,100% 100%,0 100%);transform:rotate(18deg)"></div><div style="position:absolute;left:980px;top:-40px;width:240px;height:760px;background:linear-gradient(rgba(177,151,252,.4),rgba(177,151,252,0));clip-path:polygon(40% 0,60% 0,100% 100%,0 100%);transform:rotate(-16deg)"></div>${note(540, 40, 70, '#ff8cc6', '♪')}${note(1120, 150, 60, '#b197fc', '♫')}${note(60, 560, 56, '#ff8cc6', '💀')}${note(980, 520, 50, '#ff8cc6', '♪')}${note(30, 40, 48, '#b197fc', '♬')}<div style="position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(#3b0a2a,#12000c)"></div>`
    : water ? [[520, 60, 60], [600, 150, 30], [1100, 40, 50], [1050, 300, 26], [80, 40, 40], [140, 600, 34], [980, 520, 44], [560, 560, 22]].map((b) => bubble(...b)).join('')
    : taika ? `${cloud(560, 20, 1)}${cloud(980, 80, 0.8)}${cloud(30, 560, 0.9)}${cloud(1020, 560, 0.7)}<div style="position:absolute;left:600px;bottom:0;width:640px;height:90px;background:linear-gradient(#3b2a1a,#1f160d)"></div>${[0, 1, 2, 3, 4, 5].map((i) => `<div style="position:absolute;left:${640 + i * 100}px;bottom:90px;width:24px;height:120px;background:linear-gradient(90deg,#a61e1e,#e8590c,#a61e1e)"></div>`).join('')}`
    : `${bolt(520, -20, 1.4)}${bolt(1080, 10, 1, 0.85)}${bolt(40, -30, 0.9, 0.7)}`;
  return `<div class="bn" style="background:${sc ? 'radial-gradient(circle at 25% 55%,#ffe066,#c08400 30%,#3b2a00 62%,#0b0800 100%)' : ys ? 'radial-gradient(circle at 25% 55%,#ff8cc6,#9c1f6b 36%,#3b0a3a 70%,#0d0012 100%)' : water ? 'linear-gradient(180deg,#05081c 0,#103a7a 22%,#0b2a5e 60%,#040b22 100%)' : taika ? 'radial-gradient(circle at 25% 55%,#ffe066,#e8590c 38%,#7a1414 72%,#3b0a1a 100%)' : 'radial-gradient(circle at 25% 55%,#4c3aa8,#24164f 45%,#0b0720 80%)'};">
    ${water ? '<div style="position:absolute;left:820px;top:30px;width:90px;height:90px;border-radius:50%;background:#fff9db;box-shadow:0 0 50px #fff3bf"></div><div style="position:absolute;left:0;right:0;top:150px;height:4px;background:rgba(165,216,255,.7)"></div><div style="position:absolute;left:700px;top:150px;width:300px;height:525px;background:linear-gradient(rgba(208,235,255,.3),rgba(208,235,255,0));clip-path:polygon(30% 0,70% 0,100% 100%,0 100%)"></div>'
      : taika || ys || sc ? '' : '<div style="position:absolute;left:-60px;top:-80px;width:1400px;height:260px;background:radial-gradient(ellipse at 20% 60%,#3d3566 0 30%,transparent 31%),radial-gradient(ellipse at 45% 40%,#2f2857 0 28%,transparent 29%),radial-gradient(ellipse at 75% 60%,#3d3566 0 30%,transparent 31%);opacity:.9"></div>'}
    ${deco}${sparks(10)}
    <div class="glow" style="left:60px;top:100px;width:520px;height:520px;background:radial-gradient(rgba(255,236,153,.85),rgba(250,176,5,0))"></div>
    <div class="art" style="left:40px;top:70px;width:560px;height:560px">%%ART%%</div>
    <div class="ribbon" style="left:-40px;top:34px;background:${sc ? 'linear-gradient(90deg,#212529,#a07400)' : ys ? 'linear-gradient(90deg,#a61e4d,#5f3dc4)' : water ? 'linear-gradient(90deg,#1c7ed6,#5f3dc4)' : taika ? 'linear-gradient(90deg,#a61e1e,#5c2d00)' : 'linear-gradient(90deg,#e67700,#c92a2a)'}">${esc(q.emoji || '⚡')} 高難易度クエスト</div>
    <div style="position:absolute;left:600px;top:120px;width:580px">
      <div class="stroke" style="--sw:14px;--sc:#3b1d00;font-size:100px;line-height:1.1;color:#ffe066;text-shadow:0 0 34px #fab005;white-space:nowrap">${esc(q.name)}</div>
      <div style="margin-top:18px;font-size:36px;color:#fff;text-shadow:0 3px 0 #1b1035">クリアで <span style="color:#ff8fd8;font-size:54px;text-shadow:0 0 16px #ff6bd6,0 3px 0 #1b1035">${esc(r.rarity)}</span> ${esc(r.name)} GET!!</div>
      <div style="margin-top:12px;font-size:28px;color:#ffd43b;font-weight:900;text-shadow:0 3px 0 #1b1035">${q.bg === 'yousai' ? '🧱 体力・防御けた外れ！ 30 ターンで崩せ' : sc ? '👔 絶対権力 = すえつぐの DNA を取り出すまでダメージ無効！' : ys ? '💀 死の歌声 = 受けたターンに Y を倒すと 1 枚道連れ！' : water ? '📢 説教 = 相手の攻撃 0.6 倍・毒を治す！' : taika ? '📜 大化の改新 = 1.2 倍こうげき・味方の状態異常とデバフを全部解除！' : `⚡ 落雷 = どんな相性でも ${cards.THUNDER_POWER} 倍！`}</div>
      ${q.hint ? `<div style="margin-top:10px;display:inline-block;padding:6px 16px;border-radius:14px;background:linear-gradient(90deg,#fff3bf,#ffc078);font-size:26px;color:#7a3e00;font-weight:900">${esc(q.hint)}</div><br>` : ''}
      <div style="margin-top:12px;display:inline-block;padding:8px 16px;border-radius:14px;background:rgba(11,7,32,.75);font-size:22px;color:#fff3bf;font-weight:700">敵: ${q.enemy.map(([id, lv]) => `${esc(cards.CARDS[id].name)} Lv${lv}`).join('・')}</div>
    </div>
    <div class="date" style="left:600px;bottom:40px;background:linear-gradient(90deg,#ffe066,#fab005);color:#3b1d00">${esc(fmt(q.start))} 〜 ${esc(fmt(q.end))}</div>
  </div>`;
}

// 高難易度クエストの表彰 (1 番目・2 番目の討伐者)。金ピカ (2 番目は銀) の「討伐速報」
function awardHtml(q, rank) {
  const r = cards.CARDS[q.reward], gold = rank === 1;
  const c1 = gold ? '#fff3bf' : '#f8f9fa', c2 = gold ? '#ffd43b' : '#ced4da', c3 = gold ? '#f08c00' : '#868e96', ink = gold ? '#5c2d00' : '#212529';
  const bolt = (x, y, s, o = 1) => `<svg style="position:absolute;left:${x}px;top:${y}px;width:${90 * s}px;height:${220 * s}px;opacity:${o};filter:drop-shadow(0 0 18px #fff3bf) drop-shadow(0 0 40px #fab005)" viewBox="0 0 90 220"><path d="M50,0L10,110H40L20,220L85,80H52L72,0Z" fill="#fff9db" stroke="#ffd43b" stroke-width="4"/></svg>`;
  return `<div class="bn" style="background:radial-gradient(circle at 28% 52%,${c1},${c2} 30%,${c3} 62%,#3b1d00 100%);--r1:rgba(255,255,255,.6);--r2:transparent">
    <div class="rays" style="left:28%"></div>${confetti(60, gold ? ['#fff', '#ffd43b', '#fab005', '#fff3bf', '#ff922b'] : ['#fff', '#dee2e6', '#adb5bd', '#e9ecef', '#74c0fc'])}${sparks(22)}
    ${q.bg === 'suishinya' || q.bg === 'taika' || q.bg === 'ystage' || q.bg === 'shachou' ? '' : `${bolt(560, -30, 1.2, 0.9)}${bolt(1090, 380, 0.9, 0.8)}`}
    <div class="glow" style="left:30px;top:70px;width:560px;height:560px;background:radial-gradient(#fff,rgba(255,255,255,0))"></div>
    <div class="art" style="left:40px;top:90px;width:520px;height:520px">%%ART%%</div>
    <div style="position:absolute;left:400px;top:430px;font-size:170px;line-height:1;transform:rotate(12deg);filter:drop-shadow(0 8px 0 rgba(0,0,0,.25))">${gold ? '🏆' : '🥈'}</div>
    <div class="ribbon" style="left:-40px;top:${[...r.name].length > 8 ? 44 : 34}px;${[...r.name].length > 8 ? 'font-size:34px;' : ''}background:linear-gradient(90deg,#c92a2a,#e67700)">${esc(q.emoji || '⚡')} ${esc(r.name)} 討伐速報</div>
    <div style="position:absolute;left:560px;top:110px;width:620px;text-align:center">
      <div class="stroke" style="--sw:16px;--sc:${ink};font-size:${gold ? 132 : 112}px;line-height:1.05;color:${gold ? '#fff9db' : '#fff'};text-shadow:0 0 40px ${gold ? '#ffd43b' : '#fff'};white-space:nowrap">${gold ? '最速討伐' : '準最速討伐'}</div>
      <div class="stroke" style="--sw:12px;--sc:${ink};margin-top:16px;font-size:64px;color:${gold ? '#ffe066' : '#e9ecef'};white-space:nowrap">${gold ? '👑 誕生！！ 👑' : '✨ 現る！！ ✨'}</div>
      <div style="margin-top:22px;display:inline-block;padding:12px 26px;border-radius:999px;background:linear-gradient(90deg,#fff9db,#ffd43b,#fab005);color:#5c2d00;font-size:34px;font-weight:900;box-shadow:0 6px 0 rgba(90,40,0,.35)">称号「${esc(q.titles?.[rank] || '')}」</div>
      <div style="margin-top:20px;font-size:30px;color:#fff;font-weight:900;text-shadow:0 3px 0 ${ink}">高難易度クエスト「${esc(q.name)}」</div>
    </div>
  </div>`;
}

// LR 昇格のお知らせ (虹色)
function lrHtml() {
  const RB = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
  return `<div class="bn" style="background:conic-gradient(from 0deg at 30% 50%,${RB.join(',')},${RB[0]});--r1:rgba(255,255,255,.6);--r2:transparent">
    <div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 50%,rgba(255,255,255,.95),rgba(255,255,255,.35) 35%,rgba(40,10,80,.35) 75%)"></div>
    <div class="rays" style="left:30%"></div>${confetti(50, ['#fff', ...RB])}${sparks(22)}
    <div class="art" style="left:20px;top:110px;width:330px;height:330px"></div>
    <div class="art" style="left:290px;top:230px;width:330px;height:330px"></div>
    <div class="ribbon" style="left:-40px;top:30px;background:linear-gradient(90deg,#e03131,#7048e8)">🌈 新しいレア度</div>
    <div style="position:absolute;left:600px;top:70px;width:580px;text-align:center">
      <div class="stroke" style="--sw:18px;--sc:#3b1060;font-size:220px;line-height:1;color:#fff;text-shadow:${RB.map((c, i) => `${(i + 1) * 3}px ${(i + 1) * 3}px 0 ${c}`).join(',')},0 0 50px #fff">LR</div>
      <div class="stroke" style="--sw:12px;--sc:#3b1060;font-size:58px;color:#fff;white-space:nowrap">に昇格できる！！</div>
      <div style="margin-top:14px;display:inline-block;padding:10px 22px;border-radius:999px;background:rgba(40,10,80,.8);color:#fff;font-size:28px">高難易度クエストの報酬キャラを<br><span style="font-size:44px;color:#ffe066">25 枚</span> 集めると LR に</div>
      <div style="margin-top:12px;font-size:30px;color:#3b1060;font-weight:900">能力 +35%・虹色のカード</div>
    </div>
  </div>`;
}

// まとめて追加した新キャラ (SSR を大きく並べ、SR を小さく)
function bulkHtml(g) {
  const n = (r) => g.ids.filter((id) => cards.CARDS[id].rarity === r).length;
  const ssrN = n('SSR'), pos = [];
  const per = Math.ceil(ssrN / 2), gap = Math.min(150, 700 / per), size = Math.min(190, gap + 40);
  for (let i = 0; i < ssrN; i++) { const row = i < per ? 0 : 1, col = row ? i - per : i; pos.push([30 + col * gap + row * gap / 2, 150 + row * 170, size]); }
  for (let i = 0; i < 6; i++) pos.push([830 + (i % 3) * 120, 452 + Math.floor(i / 3) * 100, 110]);
  return `<div class="bn" style="background:radial-gradient(circle at 40% 45%,#fff9db,#ffd43b 30%,#ff6b6b 65%,#7048e8 100%);--r1:rgba(255,255,255,.55);--r2:transparent">
    <div class="rays" style="left:40%"></div>${confetti(56, ['#fff', '#ffd43b', '#74c0fc', '#b197fc', '#8ce99a', '#ff8787'])}${sparks(18)}
    ${pos.map(([x, y, s]) => `<div class="art" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px"></div>`).join('')}
    <div class="ribbon" style="left:-40px;top:30px;background:linear-gradient(90deg,#e03131,#7048e8)">🎉 大型アップデート</div>
    <div style="position:absolute;left:700px;top:40px;width:480px;text-align:center">
      <div class="stroke" style="--sw:14px;--sc:#5c1a1a;font-size:76px;line-height:1.05;color:#fff;white-space:nowrap">新キャラ</div>
      <div class="stroke" style="--sw:16px;--sc:#5c1a1a;font-size:150px;line-height:1;color:#ffe066;white-space:nowrap;text-shadow:0 0 30px #fff3bf">${g.ids.length}<span style="font-size:80px">体</span></div>
      <div class="stroke" style="--sw:12px;--sc:#5c1a1a;font-size:56px;color:#fff;white-space:nowrap">大量追加！！</div>
      <div style="margin-top:8px;display:inline-block;padding:8px 20px;border-radius:999px;background:rgba(60,10,40,.75);color:#fff;font-size:26px">R ${n('R')}・SR ${n('SR')}・SSR ${n('SSR')}・すべて恒常</div>
    </div>
    <div class="date" style="left:40px;bottom:30px;background:#fff;color:#c2255c;box-shadow:0 6px 0 rgba(120,0,60,.25)">${esc(fmt(g.at))}〜 ガチャに登場</div>
  </div>`;
}

// ガチャの告知 (セール・ピックアップ・確率アップ)
function gachaHtml(n) {
  const g = gachaInfo(n), pk = g.pickups[0];
  const fp = g.pickups.find((p) => /祭/.test(p.name));
  if (fp) return festHtml(fp, fp.start, `${festCharRight(fp.card, cards.SKILLS[fp.card.skill], { withSkill: false })}
      ${g.sale ? `<div style="padding:10px 20px;border-radius:22px;background:linear-gradient(135deg,rgba(70,10,110,.8),rgba(160,20,110,.72));border:3px solid #ffe066;box-shadow:0 0 22px rgba(255,224,102,.7);color:#fff">
        <div style="font-size:28px;color:#ffe066">🔥 ${esc(g.sale.name)} <span style="font-size:20px;color:#fff">${esc(fmt(g.sale.end))} まで</span></div>
        <div style="font-size:28px">1回 <s style="opacity:.7">100</s> → <span style="font-size:60px;color:#ffe066;line-height:1">${g.sale.pull}</span>🪙 <span style="font-size:24px;margin-left:6px">10回 <b style="font-size:36px;color:#ffe066">${g.sale.ten}</b></span></div></div>` : ''}
      <div style="font-size:24px;color:#fff;text-shadow:0 2px 0 #7b2cbf">🎯 ピックアップ ${fp.rate.toFixed(1)}% · ${esc(fmt(fp.end))} まで</div>`, { stamp: '🎰 新ガチャ' });
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
  jobs.push({ name: 'update-lr-2026-11-20', html: lrHtml(), art: null, arts: [['raijin', 'LR'], ['watermid', 'LR']] });
  for (const g of cards.BULK_RELEASES) jobs.push({ name: bannerName('bulk', g.id), html: bulkHtml(g), art: null, arts: g.ids.filter((id) => cards.CARDS[id].rarity === 'SSR').concat(g.ids.filter((id) => cards.CARDS[id].rarity === 'SR').slice(0, 6)).map((id) => [id, cards.CARDS[id].rarity]) });
  for (const [id, at] of Object.entries(cards.RELEASES)) if (cards.RARITY[cards.CARDS[id]?.rarity] && !cards.BULK_IDS.has(id)) jobs.push({ name: bannerName('char', id), html: charHtml(id, at), art: [id, cards.CARDS[id].rarity] });
  for (const q of cards.QUESTS) jobs.push({ name: bannerName('quest', q.id), html: questHtml(q), art: [q.reward, cards.CARDS[q.reward].rarity] });
  for (const q of cards.QUESTS) for (const rank of Object.keys(q.titles || {})) jobs.push({ name: bannerName('award', `${q.id}-${rank}`), html: awardHtml(q, Number(rank)), art: [q.reward, cards.CARDS[q.reward].rarity] });
  for (const n of GACHA_NOTICES) { const ps = gachaInfo(n).pickups, pk = ps.find((x) => x.start >= n.at) || ps[0]; /* その告知で始まるピックアップのキャラを大きく */ jobs.push({ name: bannerName('gacha', n.id), html: gachaHtml(n), art: pk ? [pk.id, pk.card.rarity] : ['case', 'SSR'] }); }
  // 絵の抜けがないか確かめる (cards-art.js にないキャラは、えんぴつの絵になってしまう)
  {
    const vm = require('vm'), sandbox = { window: {} }; vm.runInNewContext(ART, sandbox);
    const norm = (id) => sandbox.window.CBArt.svg(id, 'N').replace(/cba\d+/g, '');
    const missing = cards.CARD_LIST.map((c) => c[0]).filter((id) => id !== 'pencil' && norm(id) === norm('pencil'));
    if (missing.length) { console.error('絵がないキャラがあります (cards-art.js に追加してください):', missing.join(', ')); process.exit(1); }
  }
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1 });
  for (const j of jobs) {
    const file = path.join(OUT, j.name + '.jpg');
    if (only && j.name !== only) continue;
    if (CUSTOM.has(j.name) && only !== j.name) { console.log('手づくり (作り直さない):', j.name); continue; } // 利用者が用意したバナーは --force でも上書きしない
    if (fs.existsSync(file) && !force && !only) { console.log('あり:', j.name); continue; }
    await p.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}</style><body>${j.html}</body>`);
    await p.addScriptTag({ content: ART });
    if (j.arts) await p.evaluate((arts) => { document.querySelectorAll('.art').forEach((e, i) => { if (arts[i]) e.innerHTML = window.CBArt.svg(arts[i][0], arts[i][1]); }); document.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; }); }, j.arts);
    else await p.evaluate(([id, r]) => { document.querySelector('.art').innerHTML = window.CBArt.svg(id, r); document.querySelectorAll('*').forEach((e) => { e.style.animation = 'none'; }); }, j.art);
    await p.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log('作った:', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
  }
  await b.close();
})();
