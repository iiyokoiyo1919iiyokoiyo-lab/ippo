// =====================================================================
// PROJECT BOUNCE: 戦闘フィールドの見た目 (計算とは別。bn.js の描画から呼ぶ)
//   ・地面: ステージの bg (THEMES) から、乱数の種つきで質感のある地面を一度だけ描いておく (草・石・苔・花・地形のふち・遺跡)
//     ステージに bgImage を書けば画像に差しかえ
//   ・敵の絵: ENEMY_ART (id ごとの SVG)。敵に img を書けば画像に差しかえ
//   ・キャラのボール絵: キャラの sprite (画像) か、bn-art.js の絵を丸く切りぬく
//   ・ギミック: 重力 (紫の渦の場)・ダメージ床 (赤いエネルギー)・ワープ (渦巻く穴)・ブロック (立体の石)・減速壁 (青いエネルギー)
// =====================================================================
(function (root) {
  const D = root.BNData, A = root.BNArt;
  const W = D.W, H = D.H;
  const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  // ---------- 地面のテーマ ----------
  const THEMES = {
    meadow:  { base: ['#6f9a3c', '#4e7a2a'], dirt: '#8a6a3c', grass: ['#8fc24a', '#5f8f2c', '#a9d65c'], stone: '#9aa3a8', moss: '#4b7a2a', flowers: ['#ffd43b', '#fff', '#ff8cc6', '#a5d8ff'], edge: 'bush', ruins: false },
    cave:    { base: ['#4a4a5a', '#2c2c38'], dirt: '#3a3646', grass: ['#5e6b7a', '#44505c'], stone: '#7c7f93', moss: '#3f6a5a', flowers: ['#91a7ff', '#63e6be', '#e599f7'], edge: 'rock', crystals: true },
    volcano: { base: ['#5a2e22', '#2e1612'], dirt: '#3d1d14', grass: ['#7a3a22', '#5a2a18'], stone: '#5c4a44', moss: '#3a1a10', flowers: ['#ff922b', '#ffd43b'], edge: 'rock', lava: true },
    abyss:   { base: ['#1f4a6a', '#0c2438'], dirt: '#173a52', grass: ['#2f8a8a', '#1f6a6a', '#3fb0a0'], stone: '#5a7a8a', moss: '#1f5a4a', flowers: ['#99e9f2', '#e7f5ff'], edge: 'coral', bubbles: true },
    void:    { base: ['#3a2a52', '#16102a'], dirt: '#241a3a', grass: ['#4a3a6a', '#3a2a5a'], stone: '#6a5a8a', moss: '#2a1a4a', flowers: ['#b197fc', '#e599f7'], edge: 'rock', ruins: true, cracks: true },
    starlit: { base: ['#2f4a6a', '#18263c'], dirt: '#243a52', grass: ['#4a7a6a', '#3a6a5a', '#6a9a7a'], stone: '#7a8aa0', moss: '#2a5a4a', flowers: ['#fff3bf', '#ffd43b', '#fff'], edge: 'bush', ruins: true, stars: true },
    sand:    { base: ['#d8b46a', '#b08a44'], dirt: '#c49a52', grass: ['#9a8a4a', '#b0a05a'], stone: '#c8b088', moss: '#8a7a3a', flowers: ['#ffd43b'], edge: 'rock', ruins: true },
  };
  const fieldCache = {};
  // 地面を描いた canvas (ステージごとに 1 回だけ)
  function field(stage, scale = 2) {
    const key = stage.id + ':' + scale; if (fieldCache[key]) return fieldCache[key];
    const cv = document.createElement('canvas'); cv.width = W * scale; cv.height = H * scale;
    const c = cv.getContext('2d'); c.scale(scale, scale);
    if (stage.bgImage) { const im = new Image(); im.onload = () => { c.drawImage(im, 0, 0, W, H); }; im.src = stage.bgImage; fieldCache[key] = cv; return cv; }
    const t = THEMES[stage.bg] || THEMES.meadow, r = rng([...stage.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 2147483646 + 1);
    // 1. 地面の色 (上が明るく下が暗い・中央が少し明るい)
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, t.base[0]); g.addColorStop(1, t.base[1]); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rg = c.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.45, W * 0.9); rg.addColorStop(0, 'rgba(255,255,255,.10)'); rg.addColorStop(1, 'rgba(0,0,0,.22)'); c.fillStyle = rg; c.fillRect(0, 0, W, H);
    // 2. ざらざらの質感 (細かいまだら)
    for (let i = 0; i < 2600; i++) { c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * 0.06})` : `rgba(0,0,0,${r() * 0.09})`; c.fillRect(r() * W, r() * H, 1 + r() * 2.2, 1 + r() * 2.2); }
    // 3. 土のまだら (なめらかな凹凸)
    for (let i = 0; i < 14; i++) { const x = r() * W, y = r() * H, rx = 30 + r() * 70, ry = 18 + r() * 40; const dg = c.createRadialGradient(x, y, 2, x, y, rx); dg.addColorStop(0, hexA(t.dirt, 0.55)); dg.addColorStop(1, hexA(t.dirt, 0)); c.fillStyle = dg; c.beginPath(); c.ellipse(x, y, rx, ry, r() * 3, 0, 7); c.fill(); }
    // 4. 地割れ・溶岩のすじ
    if (t.cracks || t.lava) for (let i = 0; i < 9; i++) { let x = r() * W, y = r() * H; c.strokeStyle = t.lava ? 'rgba(255,120,40,.55)' : 'rgba(10,0,20,.5)'; c.lineWidth = t.lava ? 2.2 : 1.4; c.shadowColor = t.lava ? '#ff6b00' : 'transparent'; c.shadowBlur = t.lava ? 6 : 0; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; c.lineTo(x, y); } c.stroke(); c.shadowBlur = 0; }
    // 5. 苔
    for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H; c.fillStyle = hexA(t.moss, 0.35 + r() * 0.3); for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(x + (r() - 0.5) * 16, y + (r() - 0.5) * 10, 3 + r() * 5, 0, 7); c.fill(); } }
    // 6. 草のしげみ (細い葉)
    for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * H, n = 3 + Math.floor(r() * 4); for (let k = 0; k < n; k++) { c.strokeStyle = t.grass[Math.floor(r() * t.grass.length)]; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x + k * 1.5, y); c.quadraticCurveTo(x + k * 1.5 + (r() - 0.5) * 6, y - 5, x + k * 1.5 + (r() - 0.5) * 8, y - 7 - r() * 6); c.stroke(); } }
    // 7. 石 (影つき)
    for (let i = 0; i < 18; i++) { const x = r() * W, y = r() * H, s = 3 + r() * 7; c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x + 1.5, y + 2, s, s * 0.6, 0, 0, 7); c.fill(); const sg = c.createLinearGradient(x - s, y - s, x + s, y + s); sg.addColorStop(0, lighten(t.stone, 30)); sg.addColorStop(1, t.stone); c.fillStyle = sg; c.beginPath(); c.ellipse(x, y, s, s * 0.65, r(), 0, 7); c.fill(); }
    // 8. 花・水晶
    for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, col = t.flowers[Math.floor(r() * t.flowers.length)];
      if (t.crystals && r() < 0.4) { c.fillStyle = hexA(col, 0.85); c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 3.5, y); c.lineTo(x, y + 3); c.lineTo(x - 3.5, y); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x - 0.5, y - 7, 1, 6); continue; }
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; c.fillStyle = col; c.beginPath(); c.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.6, 0, 7); c.fill(); } c.fillStyle = '#ffe066'; c.beginPath(); c.arc(x, y, 1.1, 0, 7); c.fill(); }
    // 9. 遺跡 (石畳のかけら・折れた柱)
    if (t.ruins) { for (let i = 0; i < 5; i++) { const x = 30 + r() * (W - 60), y = 60 + r() * (H - 160); for (let k = 0; k < 4; k++) { if (r() < 0.3) continue; c.fillStyle = hexA(darken(t.stone, 8 + k * 4), 0.32); c.beginPath(); c.ellipse(x - 7 + (k % 2) * 15, y - 5 + Math.floor(k / 2) * 11, 7 + r() * 2, 5, r() * 0.4, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.18)'; c.stroke(); } } // 石畳のかけら (ブロックとまちがえないよう、うすく・まるく)
      [[16, 40], [W - 16, 80], [20, H - 140], [W - 20, H - 90]].forEach(([x, y]) => { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(x + 3, y + 26, 14, 6, 0, 0, 7); c.fill(); const pg = c.createLinearGradient(x - 10, 0, x + 10, 0); pg.addColorStop(0, lighten(t.stone, 25)); pg.addColorStop(1, darken(t.stone, 25)); c.fillStyle = pg; c.fillRect(x - 10, y - 18, 20, 44); c.fillStyle = lighten(t.stone, 35); c.fillRect(x - 13, y - 22, 26, 6); }); }
    // 10. 星明かり・泡
    if (t.stars) for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,243,191,${0.2 + r() * 0.5})`; c.beginPath(); c.arc(r() * W, r() * H, 0.8 + r() * 1.5, 0, 7); c.fill(); }
    if (t.bubbles) for (let i = 0; i < 26; i++) { c.strokeStyle = `rgba(208,235,255,${0.2 + r() * 0.4})`; c.beginPath(); c.arc(r() * W, r() * H, 2 + r() * 6, 0, 7); c.stroke(); }
    // 11. ふち (しげみ・岩・サンゴ)。地形がフィールドを囲む
    edge(c, t, r);
    // 12. 周辺を少し暗く (立体感)
    const vg = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    fieldCache[key] = cv; return cv;
  }
  function edge(c, t, r) {
    const blob = (x, y, s, col, hi) => { const bg = c.createRadialGradient(x - s * 0.3, y - s * 0.4, 1, x, y, s); bg.addColorStop(0, hi); bg.addColorStop(1, col); c.fillStyle = bg; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); };
    const kinds = { bush: ['#2f5a1c', '#5f9a3a'], rock: [darken(t.stone, 30), lighten(t.stone, 15)], coral: ['#1f4a5a', '#3f8a8a'] }[t.edge] || ['#2f5a1c', '#5f9a3a'];
    const along = (n, fn) => { for (let i = 0; i < n; i++) fn(i / (n - 1)); };
    c.fillStyle = 'rgba(0,0,0,.25)';
    along(16, (k) => { const y = k * H; blob(-4 + r() * 6, y, 12 + r() * 10, kinds[0], kinds[1]); blob(W + 4 - r() * 6, y + 10, 12 + r() * 10, kinds[0], kinds[1]); });
    along(10, (k) => { const x = k * W; blob(x, -6 + r() * 6, 12 + r() * 9, kinds[0], kinds[1]); blob(x + 12, H + 6 - r() * 6, 12 + r() * 9, kinds[0], kinds[1]); });
    if (t.edge === 'coral') along(8, (k) => { const x = k * W; c.strokeStyle = '#ff8787'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, H); c.lineTo(x + 4, H - 14); c.lineTo(x + 9, H - 20); c.stroke(); });
  }
  const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const shade = (h, d) => { const n = parseInt(h.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, v + d)); return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`; };
  const lighten = (h, p) => shade(h, Math.round(p * 2.55)), darken = (h, p) => shade(h, -Math.round(p * 2.55));

  // ---------- 敵の絵 (SVG)。col = 属性の色 ----------
  const eye = (x, y, s = 1, col = '#1a1033') => `<ellipse cx="${x}" cy="${y}" rx="${5 * s}" ry="${6 * s}" fill="#fff"/><circle cx="${x + s}" cy="${y + s}" r="${3 * s}" fill="${col}"/><circle cx="${x + 2 * s}" cy="${y - s}" r="${1.2 * s}" fill="#fff"/>`;
  const ENEMY_ART = {
    slime: (col) => `<defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${col}"/><stop offset="1" stop-color="${darken(col, 35)}"/></radialGradient></defs><path d="M10,78 C6,40 30,12 50,12 C70,12 94,40 90,78 C80,88 20,88 10,78Z" fill="url(#g)" stroke="${darken(col, 45)}" stroke-width="3"/><ellipse cx="34" cy="30" rx="10" ry="6" fill="#fff" opacity=".55"/>${eye(38, 52)}${eye(62, 52)}<path d="M42,66 Q50,72 58,66" stroke="#1a1033" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    bat: (col) => `<path d="M50,40 C30,20 10,22 2,38 C14,36 18,44 22,52 C28,44 34,46 38,54Z M50,40 C70,20 90,22 98,38 C86,36 82,44 78,52 C72,44 66,46 62,54Z" fill="${darken(col, 30)}" stroke="#1a1033" stroke-width="2"/><circle cx="50" cy="50" r="20" fill="${col}" stroke="#1a1033" stroke-width="3"/><path d="M36,34 L40,22 L46,32 M64,34 L60,22 L54,32" fill="${col}" stroke="#1a1033" stroke-width="2"/>${eye(43, 48, 0.8, '#c92a2a')}${eye(57, 48, 0.8, '#c92a2a')}<path d="M44,60 L47,65 L50,60 L53,65 L56,60" stroke="#fff" stroke-width="2" fill="none"/>`,
    wisp: (col) => `<defs><radialGradient id="g" cx=".5" cy=".6" r=".6"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs><path d="M50,8 C60,28 82,36 78,62 C76,82 60,92 50,92 C40,92 24,82 22,62 C18,36 40,28 50,8Z" fill="url(#g)"/>${eye(42, 60, 0.8)}${eye(58, 60, 0.8)}<circle cx="50" cy="74" r="3" fill="#1a1033"/>`,
    golem: (col) => `<rect x="18" y="20" width="64" height="66" rx="12" fill="${darken(col, 10)}" stroke="#2b2b2b" stroke-width="3"/><path d="M18,44 H82 M40,20 V86 M62,52 V86" stroke="rgba(0,0,0,.3)" stroke-width="2"/><rect x="6" y="40" width="16" height="34" rx="6" fill="${darken(col, 20)}" stroke="#2b2b2b" stroke-width="3"/><rect x="78" y="40" width="16" height="34" rx="6" fill="${darken(col, 20)}" stroke="#2b2b2b" stroke-width="3"/><rect x="32" y="34" width="12" height="8" fill="#ffd43b"/><rect x="56" y="34" width="12" height="8" fill="#ffd43b"/><path d="M28,14 l6,8 M70,12 l-4,10" stroke="#5c940d" stroke-width="4" stroke-linecap="round"/>`,
    knight: (col) => `<path d="M24,94 L30,52 H70 L76,94Z" fill="#343a40" stroke="#111" stroke-width="3"/><path d="M28,50 C28,20 72,20 72,50 L72,60 H28Z" fill="#495057" stroke="#111" stroke-width="3"/><rect x="32" y="40" width="36" height="6" fill="#111"/><rect x="36" y="41" width="10" height="4" fill="${col}"/><rect x="54" y="41" width="10" height="4" fill="${col}"/><path d="M50,18 C56,6 66,6 70,12 C62,12 56,16 54,22Z" fill="${col}"/><path d="M82,20 L86,92" stroke="#ced4da" stroke-width="5"/><path d="M76,30 H92" stroke="#868e96" stroke-width="4"/>`,
    dragon: (col) => `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(col, 15)}"/><stop offset="1" stop-color="${darken(col, 35)}"/></linearGradient></defs><path d="M20,40 C2,20 0,50 4,60 C10,52 16,56 22,64Z M80,40 C98,20 100,50 96,60 C90,52 84,56 78,64Z" fill="${darken(col, 25)}" stroke="#2b0a0a" stroke-width="2"/><path d="M50,96 C24,96 18,70 22,52 C26,30 38,22 50,22 C62,22 74,30 78,52 C82,70 76,96 50,96Z" fill="url(#g)" stroke="#2b0a0a" stroke-width="3"/><path d="M34,26 L26,6 L42,22 M66,26 L74,6 L58,22" fill="#ffe8cc" stroke="#2b0a0a" stroke-width="2"/>${eye(40, 46, 0.9, '#ffd43b')}${eye(60, 46, 0.9, '#ffd43b')}<path d="M36,70 Q50,82 64,70 L60,66 L56,72 L52,66 L48,72 L44,66 L40,72Z" fill="#fff" stroke="#2b0a0a" stroke-width="2"/><path d="M40,84 Q50,90 60,84" stroke="#ff922b" stroke-width="3" fill="none"/>`,
    serpent: (col) => `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(col, 20)}"/><stop offset="1" stop-color="${darken(col, 40)}"/></linearGradient></defs><path d="M80,96 C100,70 70,60 58,72 C44,86 18,82 16,60 C14,36 40,28 52,36" fill="none" stroke="url(#g)" stroke-width="18" stroke-linecap="round"/><path d="M80,96 C100,70 70,60 58,72 C44,86 18,82 16,60 C14,36 40,28 52,36" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-dasharray="4 8"/><path d="M40,40 C34,16 56,4 72,12 C86,20 84,40 70,46 C60,50 48,50 40,40Z" fill="url(#g)" stroke="#0b2e4a" stroke-width="3"/><path d="M54,10 L50,-2 L60,8 M70,10 L74,-2 L76,12" fill="#e7f5ff" stroke="#0b2e4a" stroke-width="2"/>${eye(58, 24, 0.8, '#ffd43b')}${eye(72, 26, 0.8, '#ffd43b')}<path d="M48,38 Q62,46 78,38" stroke="#fff" stroke-width="2" fill="none"/>`,
    voidking: (col) => `<defs><radialGradient id="g" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="${lighten(col, 10)}"/><stop offset="1" stop-color="#120a24"/></radialGradient></defs><path d="M14,96 C10,60 28,40 50,40 C72,40 90,60 86,96Z" fill="#1a0f33" stroke="#000" stroke-width="3"/><circle cx="50" cy="40" r="24" fill="url(#g)" stroke="#000" stroke-width="3"/><path d="M28,24 L32,4 L42,18 L50,2 L58,18 L68,4 L72,24Z" fill="#ffd43b" stroke="#7a5a00" stroke-width="2"/><circle cx="50" cy="12" r="3" fill="#e03131"/><path d="M38,40 L46,44 M62,40 L54,44" stroke="#ff2b2b" stroke-width="4" stroke-linecap="round"/><path d="M40,54 Q50,60 60,54" stroke="#b197fc" stroke-width="3" fill="none"/><circle cx="20" cy="70" r="6" fill="${col}" opacity=".8"/><circle cx="80" cy="70" r="6" fill="${col}" opacity=".8"/>`,
  };
  const ENEMY_KIND = { slime_f: 'slime', slime_w: 'slime', slime_g: 'slime', gold_slime: 'slime', bat_d: 'bat', wisp_l: 'wisp', golem: 'golem', knight_d: 'knight', dragon_f: 'dragon', leviathan: 'serpent', void_king: 'voidking' };
  const imgCache = {};
  const svgImage = (key, svg) => { if (imgCache[key]) return imgCache[key]; const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); imgCache[key] = im; return im; };
  function enemyImage(id) {
    const e = D.ENEMIES[id]; if (!e) return null;
    if (e.img) { if (!imgCache['img:' + id]) { const im = new Image(); im.src = e.img; imgCache['img:' + id] = im; } return imgCache['img:' + id]; }
    const col = id === 'gold_slime' ? '#fab005' : D.ATTRS[e.attr].color;
    return svgImage('e:' + id, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">${(ENEMY_ART[ENEMY_KIND[id]] || ENEMY_ART.slime)(col)}</svg>`);
  }
  // キャラのボール絵 (画像のキャラは sprite、ほかは bn-art.js の絵)
  function unitImage(charId) {
    const c = D.CHAR[charId]; if (!c) return null;
    if (c.sprite) { if (!imgCache['s:' + charId]) { const im = new Image(); im.src = c.sprite; imgCache['s:' + charId] = im; } return imgCache['s:' + charId]; }
    return svgImage('u:' + charId, A.svg(charId).replace('<svg ', '<svg width="400" height="500" '));
  }
  const ready = (im) => im && im.complete && im.naturalWidth > 0;

  // ---------- ギミック ----------
  function drawGimmick(c, gm, now) {
    if (gm.type === 'gravity') { // 紫の重力場: ゆっくり回る渦
      const cx = gm.x + gm.w / 2, cy = gm.y + gm.h / 2, rr = Math.max(gm.w, gm.h) / 2;
      const g = c.createRadialGradient(cx, cy, 2, cx, cy, rr); g.addColorStop(0, 'rgba(132,94,247,.55)'); g.addColorStop(0.7, 'rgba(112,72,232,.25)'); g.addColorStop(1, 'rgba(112,72,232,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, gm.w / 2 + 6, gm.h / 2 + 6, 0, 0, 7); c.fill();
      c.save(); c.translate(cx, cy); c.rotate(now / 1400); c.strokeStyle = 'rgba(208,191,255,.45)'; c.lineWidth = 1.6;
      for (let k = 0; k < 3; k++) { c.beginPath(); for (let a = 0; a < Math.PI * 1.6; a += 0.12) { const rad = 4 + a * (rr / 6); c.lineTo(Math.cos(a + k * 2.1) * rad * (gm.w / gm.h > 1 ? 1 : 0.7), Math.sin(a + k * 2.1) * rad * (gm.h / gm.w > 1 ? 1 : 0.7)); } c.stroke(); }
      c.restore(); c.lineWidth = 1;
      for (let k = 0; k < 6; k++) { const a = now / 900 + k; c.fillStyle = 'rgba(229,219,255,.7)'; c.beginPath(); c.arc(cx + Math.cos(a) * gm.w * 0.35, cy + Math.sin(a * 1.3) * gm.h * 0.35, 1.6, 0, 7); c.fill(); }
    } else if (gm.type === 'damage_floor') { // 赤いエネルギーの帯
      const pulse = 0.5 + Math.sin(now / 220) * 0.2;
      const g = c.createLinearGradient(0, gm.y, 0, gm.y + gm.h); g.addColorStop(0, `rgba(255,60,60,${0.15 * pulse})`); g.addColorStop(0.5, `rgba(255,70,40,${0.55 * pulse + 0.1})`); g.addColorStop(1, `rgba(255,60,60,${0.15 * pulse})`);
      c.fillStyle = g; c.fillRect(gm.x, gm.y, gm.w, gm.h);
      c.strokeStyle = `rgba(255,180,120,${0.6 + pulse * 0.3})`; c.lineWidth = 1.4; c.shadowColor = '#ff3b3b'; c.shadowBlur = 10;
      for (const yy of [gm.y + 1, gm.y + gm.h - 1]) { c.beginPath(); for (let x = gm.x; x <= gm.x + gm.w; x += 6) c.lineTo(x, yy + Math.sin(x / 9 + now / 120) * 2); c.stroke(); }
      c.shadowBlur = 0; c.lineWidth = 1;
    } else if (gm.type === 'warp') { // 渦巻く空間の穴
      const draw = (x, y, rr, a) => { const g = c.createRadialGradient(x, y, 1, x, y, rr); g.addColorStop(0, '#05010f'); g.addColorStop(0.55, 'rgba(66,24,140,.95)'); g.addColorStop(1, 'rgba(99,230,190,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
        c.save(); c.translate(x, y); c.rotate(now / 260); c.strokeStyle = `rgba(150,242,215,${a})`; c.lineWidth = 2; for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.arc(rr * 0.35, 0, rr * 0.55, Math.PI * 0.9, Math.PI * 1.6); c.stroke(); } c.restore(); c.lineWidth = 1; };
      draw(gm.x, gm.y, gm.r + 6, 0.9); draw(gm.tx, gm.ty, 10, 0.4);
    } else if (gm.type === 'block') { // 立体の石のブロック
      const d = 6;
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(gm.x + 4, gm.y + 6, gm.w, gm.h);
      c.fillStyle = '#5c5f66'; c.fillRect(gm.x, gm.y + gm.h - 1, gm.w, d); // 側面
      const g = c.createLinearGradient(0, gm.y - d, 0, gm.y + gm.h); g.addColorStop(0, '#b8bcc4'); g.addColorStop(1, '#868b94'); c.fillStyle = g; c.fillRect(gm.x, gm.y - d, gm.w, gm.h); // 上面
      c.strokeStyle = 'rgba(0,0,0,.25)'; for (let x = gm.x + 16; x < gm.x + gm.w; x += 18) { c.beginPath(); c.moveTo(x, gm.y - d); c.lineTo(x, gm.y + gm.h - d); c.stroke(); }
      c.strokeStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.moveTo(gm.x, gm.y - d); c.lineTo(gm.x + gm.w, gm.y - d); c.stroke();
    } else if (gm.type === 'slow_wall') { // 青いエネルギーの壁
      const pulse = 0.6 + Math.sin(now / 260) * 0.2;
      const g = gm.w > gm.h ? c.createLinearGradient(0, gm.y, 0, gm.y + gm.h) : c.createLinearGradient(gm.x, 0, gm.x + gm.w, 0);
      g.addColorStop(0, 'rgba(77,171,247,0)'); g.addColorStop(0.5, `rgba(116,192,252,${pulse})`); g.addColorStop(1, 'rgba(77,171,247,0)');
      c.fillStyle = g; c.shadowColor = '#4dabf7'; c.shadowBlur = 12; c.fillRect(gm.x - 2, gm.y - 2, gm.w + 4, gm.h + 4); c.shadowBlur = 0;
      c.fillStyle = 'rgba(231,245,255,.8)'; const long = Math.max(gm.w, gm.h); for (let k = 0; k < long; k += 22) { const p = (k + now / 20) % long; if (gm.w > gm.h) c.fillRect(gm.x + p, gm.y + gm.h / 2 - 1, 6, 2); else c.fillRect(gm.x + gm.w / 2 - 1, gm.y + p, 2, 6); }
    }
  }

  root.BNField = { THEMES, field, enemyImage, unitImage, ready, drawGimmick, ENEMY_ART, ENEMY_KIND, hexA };
})(typeof self !== 'undefined' ? self : this);
