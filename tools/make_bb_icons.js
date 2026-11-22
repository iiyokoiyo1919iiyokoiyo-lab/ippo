// IppO ベースボールのアプリのアイコンとスプラッシュ画面 (PNG) を作る: node tools/make_bb_icons.js
//   → public/games/baseball/icons/ (icon-192・icon-512・maskable-512・apple-touch-icon (PNG)・splash-* (JPEG))
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, '../public/games/baseball/icons');
fs.mkdirSync(OUT, { recursive: true });
// アイコン: ネイビーの地・金のふちの盾・野球のボール・IppO
const icon = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#1d3f8a"/><stop offset="1" stop-color="#060f26"/></radialGradient>
<linearGradient id="gd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dd86"/><stop offset=".55" stop-color="#c9a227"/><stop offset="1" stop-color="#8f6d12"/></linearGradient>
<radialGradient id="ball" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#ecebe4"/><stop offset="1" stop-color="#b8b6ab"/></radialGradient></defs>
<rect width="512" height="512" fill="url(#bg)"/>
<g transform="translate(256 262) scale(${(1 - pad).toFixed(3)}) translate(-256 -262)">
<path d="M256 58 412 102v146c0 100-72 160-156 196-84-36-156-96-156-196V102z" fill="#0a1a44" stroke="url(#gd)" stroke-width="16"/>
<path d="M256 92 382 128v122c0 80-56 130-126 160-70-30-126-80-126-160V128z" fill="none" stroke="url(#gd)" stroke-opacity=".45" stroke-width="4"/>
<circle cx="256" cy="232" r="84" fill="url(#ball)"/>
<path d="M200 170q34 62 0 124M312 170q-34 62 0 124" fill="none" stroke="#d6336c" stroke-width="6" stroke-dasharray="9 7"/>
<text x="256" y="378" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-style="italic" font-weight="700" font-size="74" fill="url(#gd)">IppO</text>
</g></svg>`;
const splash = (w, h) => { const s = Math.min(w, h) * 0.3; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs><radialGradient id="sb" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#1b3a80"/><stop offset="1" stop-color="#07112b"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sb)"/>
<image href="data:image/svg+xml;base64,${Buffer.from(icon(0.04)).toString('base64')}" x="${(w - s) / 2}" y="${h * 0.4 - s / 2}" width="${s}" height="${s}" clip-path="inset(0 round ${s * 0.22}px)"/>
<text x="${w / 2}" y="${h * 0.4 + s / 2 + s * 0.28}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" letter-spacing="${s * 0.04}" font-size="${s * 0.13}" fill="#e9c46a">IppO BASEBALL</text></svg>`; };
(async () => {
  const br = await chromium.launch(), pg = await br.newPage();
  const shot = async (svg, w, h, file) => { await pg.setViewportSize({ width: w, height: h }); await pg.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</body></html>`); await pg.waitForTimeout(80); await pg.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h } }); };
  await shot(icon(0), 192, 192, 'icon-192.png');
  await shot(icon(0), 512, 512, 'icon-512.png');
  await shot(icon(0.2), 512, 512, 'maskable-512.png'); // まわりが切られても盾が残るように小さめ
  await shot(icon(0.06), 180, 180, 'apple-touch-icon.png');
  for (const [w, h] of [[1290, 2796], [1179, 2556], [1284, 2778], [1170, 2532], [1125, 2436], [828, 1792], [750, 1334], [2048, 2732]]) {
    await pg.setViewportSize({ width: Math.round(w / 3), height: Math.round(h / 3) });
    await pg.setContent(`<html><body style="margin:0">${splash(w, h).replace(`width="${w}" height="${h}"`, `width="${Math.round(w / 3)}" height="${Math.round(h / 3)}"`)}</body></html>`);
    await pg.waitForTimeout(80);
    const p2 = await br.newPage({ viewport: { width: Math.round(w / 3), height: Math.round(h / 3) }, deviceScaleFactor: 3 });
    await p2.setContent(`<html><body style="margin:0">${splash(w, h).replace(`width="${w}" height="${h}"`, `width="${Math.round(w / 3)}" height="${Math.round(h / 3)}"`)}</body></html>`);
    await p2.waitForTimeout(80); await p2.screenshot({ path: path.join(OUT, `splash-${w}x${h}.jpg`), type: 'jpeg', quality: 86 }); await p2.close();
  }
  await br.close(); console.log('icons ->', OUT, fs.readdirSync(OUT).join(' '));
})();
