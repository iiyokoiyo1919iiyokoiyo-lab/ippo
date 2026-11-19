// =====================================================================
// ブリードモンスターズ: モンスターの絵 (SVG。画像ファイルは使わない)
//
// 見た目の遺伝子 look = { body, eyes, horn, wing, tail, mark, crest, h1, h2 } はそのまま (データは変えない)。
// ・body (骨格) ごとに、体型・シルエット・顔の位置から別々に描く
//     0 ジェル (しずくの体・中に核) / 1 ビースト (けもの・耳と鼻先・前足) / 2 グリフォン (鳥・翼と羽毛)
//     3 ドラゴン (直立・角・腹の鱗・太い尾) / 4 ゴーレム (肩の広い岩の体・鉱石) / 5 スピリット (宙に浮く精霊・尾がもや)
// ・属性 (火・水・草・光・闇・王) は色だけでなく、体のつくりに入る (炎のたてがみ・ヒレと透明感・葉と蔓の体・光輪とルーン・トゲと影・王冠と金の鎧)
// ・強さ評価 (C〜Z) で装飾と光り方が増える (C/B 基本 → A 模様 → S オーラと装身具 → SS 金の縁取りと光の粒 → Z 虹の光輪と結晶)
// ・まばたき・呼吸・待機のゆれは CSS (index.html の .ma-*) で動かす
// =====================================================================
'use strict';
(() => {
  let seq = 0;
  const twinkle = (x, y, r, fill, cls = '') => `<path class="${cls}" d="M${x},${y - r}Q${x},${y} ${x + r},${y}Q${x},${y} ${x},${y + r}Q${x},${y} ${x - r},${y}Q${x},${y} ${x},${y - r}Z" fill="${fill}"/>`;
  const TYPE = {
    fire: { h: 18, glow: '#ffb347', fx: '#ff6b35', light: '#fff3bf' },
    water: { h: 200, glow: '#74c0fc', fx: '#339af0', light: '#e7f5ff' },
    grass: { h: 115, glow: '#a9e34b', fx: '#40c057', light: '#ebfbee' },
    light: { h: 48, glow: '#ffe066', fx: '#fab005', light: '#ffffff' },
    dark: { h: 270, glow: '#b197fc', fx: '#7048e8', light: '#e5dbff' },
    king: { h: 40, glow: '#ffd43b', fx: '#f59f00', light: '#fff9db' },
  };
  const TIER = { C: 0, B: 0, A: 1, S: 2, SS: 3, Z: 4 };

  function draw(look, type, rank) {
    const u = 'ma' + (++seq), defs = [];
    const lg = (n, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => { defs.push(`<linearGradient id="${u}${n}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</linearGradient>`); return `url(#${u}${n})`; };
    const rg = (n, stops, cx = 0.38, cy = 0.3, r = 0.85) => { defs.push(`<radialGradient id="${u}${n}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</radialGradient>`); return `url(#${u}${n})`; };
    const clip = (n, d) => { defs.push(`<clipPath id="${u}${n}"><path d="${d}"/></clipPath>`); return `url(#${u}${n})`; };
    const L = look || {}, T = TYPE[type] || TYPE.fire, tier = TIER[rank] ?? 0;
    const hsl = (h, s, l) => `hsl(${Math.round(h)},${s}%,${l}%)`;
    // 体の色は遺伝子の色 (h1) を属性の色へ少し寄せる (家系の色は残しつつ、属性が見た目でわかる)
    const mixH = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };
    const V = (L.viz && typeof L.viz === 'object') ? L.viz : {}; // 突然変異の見た目 (部品の名前だけが来る)
    const h1 = mixH(Number(L.h1) || 0, T.h, 0.35), h2 = Number(L.h2) || 0;
    // 黄色は暗くするとオリーブ色 (にごった緑) になるので、影はオレンジ寄りにずらす
    const yel = (h) => h > 32 && h < 80, sh = (h, k) => (yel(h) ? h - k : h);
    const C = V.tint === 'white' ? { hi: '#ffffff', base: '#eef1f6', mid: '#cfd6e2', dark: '#9aa5b8', ink: '#4a5368', acc: hsl(h2, 82, 60), accL: hsl(h2, 90, 80), accD: hsl(h2, 65, 36) } : { hi: hsl(h1, 85, yel(h1) ? 86 : 80), base: hsl(h1, yel(h1) ? 88 : 68, yel(h1) ? 62 : 58), mid: hsl(sh(h1, 12), yel(h1) ? 78 : 60, yel(h1) ? 50 : 46), dark: hsl(sh(h1, 22), 60, 32), ink: hsl(sh(h1, 28), 55, 18),
      acc: hsl(h2, 82, 60), accL: hsl(h2, 90, 80), accD: hsl(sh(h2, 18), 65, 36) };
    const skin = rg('sk', [[0, C.hi], [0.45, C.base], [1, yel(h1) ? C.mid : C.dark]]);
    const belly = lg('bl', [[0, hsl(h1, 60, 92)], [1, hsl(h1, 45, 76)]]);
    const back = [], body = [], front = [], fx = [];
    const st = `stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"`;
    const thin = `stroke="${C.ink}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"`;
    // 影 (下側を暗く) と光 (左上のつや) を体の形に重ねる → 立体感
    const shade = (d, n) => `<g clip-path="${clip('c' + n, d)}"><path d="${d}" fill="${C.ink}" opacity="${yel(h1) ? 0.14 : 0.28}" transform="translate(7 7)"/><ellipse cx="44" cy="40" rx="20" ry="13" fill="#fff" opacity=".22"/></g>`;
    const shape = (d, n, fill = skin) => `<path d="${d}" fill="${fill}" ${st}/>${shade(d, n)}`;

    // ---------- 体 (骨格ごと) ----------
    const B = Number(L.body) || 0;
    let A; // パーツの付け根: 顔・頭のてっぺん・肩・尾・腹
    if (B === 0) { // ジェル: しずく形・下に雫の足・中に光る核
      const d = 'M60,14 C66,26 98,42 99,74 C100,99 83,110 60,110 C37,110 20,99 21,74 C22,42 54,26 60,14Z';
      body.push(shape(d, 'b'), `<g clip-path="${clip('cj', d)}"><circle cx="60" cy="86" r="16" fill="${rg('core', [[0, '#fff'], [0.4, T.glow], [1, T.fx, 0]], 0.5, 0.5, 0.5)}" class="ma-pulse"/><path d="M20,96 C40,90 80,90 100,96 V112 H20Z" fill="${C.mid}" opacity=".45"/></g>`,
        `<path d="M33,104 q-4,8 2,10 q5,-2 2,-10Z M86,104 q4,8 -2,10 q-5,-2 -2,-10Z" fill="${C.mid}" ${thin}/>`, `<path d="M58,20 C52,30 44,34 38,40" stroke="#fff" stroke-width="3" opacity=".55" fill="none" stroke-linecap="round"/>`);
      A = { fx: 60, fy: 62, s: 1, top: 18, hl: 44, hr: 76, sh: 70, tail: [96, 92], arm: [[24, 78], [96, 78]] };
    } else if (B === 1) { // ビースト: 座ったけもの。大きな頭・とがった耳・鼻先・胸の毛・前足
      body.push(`<path d="M30,108 C24,86 34,70 46,68 L74,68 C86,70 96,86 90,108Z" fill="${skin}" ${st}/>`,
        `<path d="M46,70 C48,84 54,92 60,96 C66,92 72,84 74,70 C66,76 54,76 46,70Z" fill="${belly}" ${thin}/>`,
        `<path d="M40,96 C38,108 50,112 52,104 L50,90Z M80,96 C82,108 70,112 68,104 L70,90Z" fill="${C.base}" ${st}/><path d="M43,108 v-4 M47,109 v-4 M77,108 v-4 M73,109 v-4" ${thin}/>`,
        `<path d="M30,40 L18,6 L46,30Z M90,40 L102,6 L74,30Z" fill="${skin}" ${st}/><path d="M30,34 L23,14 L41,30Z M90,34 L97,14 L79,30Z" fill="${C.accL}"/>`);
      const head = 'M60,22 C84,22 94,36 92,52 C90,66 78,74 60,74 C42,74 30,66 28,52 C26,36 36,22 60,22Z';
      body.push(shape(head, 'h'), `<path d="M44,58 C46,70 74,70 76,58 C72,64 48,64 44,58Z" fill="${belly}" opacity=".9"/><path d="M57,60 q3,-3 6,0 q-3,4 -6,0Z" fill="${C.ink}"/><path d="M60,63 v3 M60,66 q-4,3 -7,0 M60,66 q4,3 7,0" ${thin} fill="none"/>`,
        `<path d="M28,50 l-8,2 l8,4 M92,50 l8,2 l-8,4" ${thin} fill="none"/>`);
      A = { fx: 60, fy: 48, s: 0.95, top: 24, hl: 40, hr: 80, sh: 72, tail: [92, 98], arm: [[34, 86], [86, 86]], mouth: false };
    } else if (B === 2) { // グリフォン: 卵形の体・重なる胸の羽毛・たたんだ翼・くちばし・かぎ爪
      const d = 'M60,20 C86,20 96,48 94,74 C92,100 78,110 60,110 C42,110 28,100 26,74 C24,48 34,20 60,20Z';
      body.push(`<path d="M30,60 C14,66 10,92 22,106 C26,96 30,92 36,90Z M90,60 C106,66 110,92 98,106 C94,96 90,92 84,90Z" fill="${C.mid}" ${st}/>`,
        `<path d="M24,72 l8,6 M20,84 l10,4 M96,72 l-8,6 M100,84 l-10,4" ${thin}/>`, shape(d, 'b'));
      const sc = []; for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - (r % 2); i++) { const x = 44 + i * 10 + (r % 2) * 5, y = 76 + r * 7; sc.push(`<path d="M${x - 6},${y} q6,8 12,0" fill="${r % 2 ? belly : C.accL}" ${thin}/>`); }
      body.push(`<path d="M40,72 C44,104 76,104 80,72 C70,80 50,80 40,72Z" fill="${belly}"/>`, sc.join(''),
        `<path d="M48,108 l-4,6 M52,108 l0,7 M56,108 l3,6 M64,108 l-3,6 M68,108 l0,7 M72,108 l4,6" stroke="${C.accD}" stroke-width="2.4" stroke-linecap="round"/>`,
        `<path d="M40,26 L32,8 L48,22Z M80,26 L88,8 L72,22Z" fill="${C.accL}" ${thin}/>`,
        `<path d="M60,58 l-9,6 l9,9 l9,-9Z" fill="${lg('bk', [[0, '#ffe066'], [1, '#e8590c']])}" ${thin}/><path d="M51,64 h18" ${thin}/>`);
      A = { fx: 60, fy: 48, s: 0.95, top: 22, hl: 42, hr: 78, sh: 66, tail: [90, 96], arm: [[30, 80], [90, 80]], mouth: false };
    } else if (B === 3) { // ドラゴン: 直立・長めの鼻先・腹の鱗・腕と爪
      body.push(`<path d="M86,96 C104,100 114,86 110,70 C108,62 100,64 102,72 C104,82 96,88 84,86Z" fill="${C.mid}" ${st}/>`,
        `<path d="M40,104 C34,90 36,72 44,64 L76,64 C84,72 86,90 80,104Z" fill="${skin}" ${st}/>`,
        `<path d="M50,66 L70,66 L68,104 L52,104Z" fill="${belly}" ${thin}/>${[72, 80, 88, 96].map((y) => `<path d="M51,${y} h18" ${thin} opacity=".7"/>`).join('')}`,
        `<path d="M38,104 C34,112 50,114 50,106Z M82,104 C86,112 70,114 70,106Z" fill="${C.dark}" ${st}/>`,
        `<path d="M42,72 C30,76 28,88 34,92 L40,86Z M78,72 C90,76 92,88 86,92 L80,86Z" fill="${C.base}" ${st}/><path d="M33,92 l-2,4 M36,93 l0,4 M87,92 l2,4 M84,93 l0,4" ${thin}/>`);
      const head = 'M60,16 C80,16 90,30 88,44 C88,54 84,58 78,62 C72,68 48,68 42,62 C36,58 32,54 32,44 C30,30 40,16 60,16Z';
      body.push(shape(head, 'h'), `<path d="M44,54 C46,66 74,66 76,54 C70,60 50,60 44,54Z" fill="${belly}" opacity=".9"/><circle cx="55" cy="56" r="1.6" fill="${C.ink}"/><circle cx="65" cy="56" r="1.6" fill="${C.ink}"/><path d="M48,61 q12,6 24,0" ${thin} fill="none"/><path d="M52,62 l2,3 l2,-3 M64,62 l2,3 l2,-3" fill="#fff" ${thin}/>`);
      A = { fx: 60, fy: 40, s: 0.92, top: 18, hl: 42, hr: 78, sh: 66, tail: [104, 72], arm: [[34, 86], [86, 86]], mouth: false };
    } else if (B === 4) { // ゴーレム: 肩が大きい岩の体・こぶし・胸の鉱石・小さな頭
      body.push(`<path d="M14,52 L30,40 L46,48 L44,82 L30,90 L16,80Z M106,52 L90,40 L74,48 L76,82 L90,90 L104,80Z" fill="${C.mid}" ${st}/>`,
        `<path d="M14,80 L32,90 L30,106 L12,102Z M106,80 L88,90 L90,106 L108,102Z" fill="${C.dark}" ${st}/>`);
      const d = 'M34,44 L86,44 L92,84 L80,106 L40,106 L28,84Z';
      body.push(shape(d, 'b'), `<path d="M34,44 L86,44 L60,52Z" fill="#fff" opacity=".18"/><path d="M40,70 l10,-4 M74,92 l8,-8 M44,96 l12,-2 M70,60 l8,4" ${thin} opacity=".6"/>`,
        `<path d="M60,66 l10,10 l-10,14 l-10,-14Z" fill="${lg('gm', [[0, '#fff'], [0.35, T.light], [1, T.fx]])}" stroke="#fff" stroke-width="1.6" class="ma-pulse"/>`);
      const head = 'M44,22 L76,22 L80,44 L40,44Z';
      body.push(shape(head, 'h'), `<path d="M42,30 H78" stroke="${C.ink}" stroke-width="7" opacity=".85"/>`);
      A = { fx: 60, fy: 30, s: 0.72, top: 22, hl: 46, hr: 74, sh: 46, tail: [92, 96], arm: [[20, 70], [100, 70]], mouth: false, visor: true };
    } else { // スピリット: 宙に浮く。大きな頭・花びらのすそ・小さな腕・尾はもや
      body.push(`<path d="M46,84 C38,96 50,108 60,118 C62,108 76,104 72,92 C70,86 60,82 52,82Z" fill="${lg('ws', [[0, C.base], [1, C.hi, 0]])}" class="ma-wisp"/>`,
        `<path d="M40,80 C30,84 30,96 42,96 C46,94 50,90 60,90 C70,90 74,94 78,96 C90,96 90,84 80,80Z" fill="${C.accL}" ${thin}/><path d="M48,82 C46,90 52,94 56,90 M72,82 C74,90 68,94 64,90" ${thin} fill="${C.acc}"/>`,
        `<path d="M36,70 C26,72 24,80 30,84 M84,70 C94,72 96,80 90,84" stroke="${C.base}" stroke-width="5" stroke-linecap="round" fill="none"/>`);
      const head = 'M60,18 C86,18 98,34 96,54 C94,72 80,82 60,82 C40,82 26,72 24,54 C22,34 34,18 60,18Z';
      body.push(shape(head, 'h'));
      A = { fx: 60, fy: 52, s: 1.08, top: 20, hl: 40, hr: 80, sh: 70, tail: [84, 96], arm: [[30, 82], [90, 82]], float: true };
    }

    // ---------- 属性: 体のつくりに入る ----------
    if (type === 'fire') { // 背中から燃えるたてがみ・熱い体表
      const fl = (x, y, s, a) => `<path transform="translate(${x} ${y}) rotate(${a}) scale(${s})" d="M0,0 C-8,-6 -6,-18 0,-26 C2,-18 10,-16 8,-6 C6,-2 3,0 0,0Z" fill="${lg('fl', [[0, '#fff3bf'], [0.45, '#ffa94d'], [1, '#e8590c']])}" class="ma-flick"/>`;
      back.push(fl(A.hl - 4, A.top + 10, 1, -30), fl(60, A.top + 2, 1.25, 0), fl(A.hr + 4, A.top + 10, 1, 30), fl(A.hl - 12, A.top + 26, 0.8, -55), fl(A.hr + 12, A.top + 26, 0.8, 55));
      fx.push(...[[16, 94], [104, 90], [22, 40], [100, 34]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2 + (i % 2)}" fill="#ffd43b" class="ma-ember d${i}"/>`));
    } else if (type === 'water') { // 耳ビレ・背ビレ・体の中に泡・透明感
      back.push(`<path d="M${A.hl},${A.top + 14} C${A.hl - 20},${A.top} ${A.hl - 24},${A.top + 24} ${A.hl - 14},${A.top + 30} C${A.hl - 8},${A.top + 24} ${A.hl - 4},${A.top + 22} ${A.hl + 2},${A.top + 22}Z M${A.hr},${A.top + 14} C${A.hr + 20},${A.top} ${A.hr + 24},${A.top + 24} ${A.hr + 14},${A.top + 30} C${A.hr + 8},${A.top + 24} ${A.hr + 4},${A.top + 22} ${A.hr - 2},${A.top + 22}Z" fill="${lg('fn', [[0, '#e7f5ff', 0.95], [1, '#4dabf7', 0.8]])}" stroke="#1971c2" stroke-width="1.4"/>`,
        `<path d="M60,${A.top - 2} C52,${A.top - 16} 64,${A.top - 22} 70,${A.top - 14} C66,${A.top - 10} 64,${A.top - 4} 64,${A.top + 2}Z" fill="${lg('df', [[0, '#e7f5ff'], [1, '#339af0']])}" stroke="#1971c2" stroke-width="1.4"/>`);
      front.push(...[[44, 90, 2.6], [52, 98, 1.8], [72, 94, 2.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8"/>`), `<path d="M30,74 C40,70 50,78 60,74 C70,70 80,78 90,74" stroke="#e7f5ff" stroke-width="2" fill="none" opacity=".6"/>`);
      fx.push(...[[14, 40, 4], [106, 52, 3], [20, 100, 5]].map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#d0ebff" stroke="#fff" stroke-width="1" opacity=".8" class="ma-bub d${i}"/>`));
    } else if (type === 'grass') { // 葉の耳・体を這う蔓・頭の花芽
      const leaf = (x, y, a, s = 1) => `<path transform="translate(${x} ${y}) rotate(${a}) scale(${s})" d="M0,0 C10,-8 10,-22 0,-30 C-10,-22 -10,-8 0,0Z" fill="${lg('lf', [[0, '#d3f9d8'], [1, '#2f9e44']])}" stroke="#2b8a3e" stroke-width="1.4"/><path transform="translate(${x} ${y}) rotate(${a}) scale(${s})" d="M0,-2 V-26" stroke="#2b8a3e" stroke-width="1"/>`;
      back.push(leaf(A.hl - 2, A.top + 14, -40), leaf(A.hr + 2, A.top + 14, 40), leaf(60, A.top + 4, 0, 0.8));
      front.push(`<path d="M${A.arm[0][0] + 4},${A.arm[0][1] + 10} C40,${A.sh + 8} 50,${A.sh + 2} 58,${A.sh + 10} C66,${A.sh + 18} 76,${A.sh + 6} ${A.arm[1][0] - 4},${A.arm[1][1] + 6}" stroke="#2b8a3e" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
        ...[[44, A.sh + 6, -30], [72, A.sh + 10, 30]].map(([x, y, a]) => leaf(x, y, a, 0.38)));
      fx.push(...[[16, 96, -40], [104, 92, 40]].map(([x, y, a], i) => `<g class="ma-sway d${i}">${leaf(x, y, a, 0.6)}</g>`));
    } else if (type === 'light') { // 頭上の光輪・体に光るルーン・水晶のかけら
      back.push(`<ellipse cx="60" cy="${A.top - 6}" rx="22" ry="5.5" fill="none" stroke="${lg('hl', [[0, '#fff'], [0.5, '#ffe066'], [1, '#fff']], 0, 0, 1, 0)}" stroke-width="3.5" class="ma-glow"/>`);
      front.push(`<path d="M42,${A.sh + 6} l4,-6 l4,6 l-4,6Z M74,${A.sh + 6} l4,-6 l4,6 l-4,6Z" fill="#fff" stroke="#fab005" stroke-width="1" class="ma-glow"/><path d="M50,${A.sh + 16} h20 M56,${A.sh + 20} h8" stroke="#fff3bf" stroke-width="1.6" stroke-linecap="round" class="ma-glow"/>`);
      fx.push(twinkle(14, 34, 6, '#fff', 'ma-tw'), twinkle(106, 46, 5, '#ffe066', 'ma-tw d2'), twinkle(100, 102, 6, '#fff', 'ma-tw d3'), `<path d="M14,92 l4,-10 l4,10 l-4,6Z" fill="#fff9db" stroke="#fab005" stroke-width="1" class="ma-flo"/>`);
    } else if (type === 'dark') { // 体のトゲ・下からの影・裂けたマント
      back.push(`<path d="M${A.hl - 6},${A.top + 16} L${A.hl - 18},${A.top - 6} L${A.hl + 4},${A.top + 8}Z M${A.hr + 6},${A.top + 16} L${A.hr + 18},${A.top - 6} L${A.hr - 4},${A.top + 8}Z" fill="${C.ink}" stroke="${C.dark}" stroke-width="1.4"/>`,
        `<path d="M24,${A.sh} L8,${A.sh + 30} L18,${A.sh + 26} L14,${A.sh + 42} L30,${A.sh + 28}Z M96,${A.sh} L112,${A.sh + 30} L102,${A.sh + 26} L106,${A.sh + 42} L90,${A.sh + 28}Z" fill="${lg('cp', [[0, '#3b1f6e'], [1, '#14082e']])}" stroke="#1b1035" stroke-width="1.4"/>`);
      front.push(`<path d="M44,${A.sh + 12} l4,4 l4,-4 M68,${A.sh + 12} l4,4 l4,-4" stroke="#e599f7" stroke-width="1.6" fill="none" opacity=".9"/>`);
      fx.push(`<ellipse cx="60" cy="112" rx="40" ry="7" fill="#1b1035" opacity=".55"/>`, ...[[18, 104], [100, 106], [30, 112]].map(([x, y], i) => `<path d="M${x},${y} c-6,-8 4,-14 0,-22 c8,4 10,16 4,22z" fill="#7048e8" opacity=".55" class="ma-flick d${i}"/>`));
    } else if (type === 'king') { // 王冠・金の肩当て・マント
      back.push(`<path d="M22,${A.sh} C8,${A.sh + 30} 18,${A.sh + 42} 36,${A.sh + 40} L60,${A.sh + 30} L84,${A.sh + 40} C102,${A.sh + 42} 112,${A.sh + 30} 98,${A.sh}Z" fill="${lg('cp', [[0, '#c92a2a'], [1, '#7a1414']])}" stroke="#5c0f0f" stroke-width="1.6"/>`);
      front.push(`<path d="M${A.hl - 6},${A.top + 6} L${A.hl - 8},${A.top - 12} L${A.hl + 4},${A.top - 2} L60,${A.top - 16} L${A.hr - 4},${A.top - 2} L${A.hr + 8},${A.top - 12} L${A.hr + 6},${A.top + 6}Z" fill="${lg('cr', [[0, '#fff9db'], [0.5, '#ffd43b'], [1, '#e67700']])}" stroke="#b35c00" stroke-width="1.6"/><circle cx="60" cy="${A.top - 4}" r="3" fill="#e03131" stroke="#fff" stroke-width="1"/>`,
        `<path d="M${A.arm[0][0] - 4},${A.arm[0][1] - 14} q8,-6 16,0 q-8,8 -16,0Z M${A.arm[1][0] - 12},${A.arm[1][1] - 14} q8,-6 16,0 q-8,8 -16,0Z" fill="${lg('pd', [[0, '#fff3bf'], [1, '#f59f00']])}" stroke="#b35c00" stroke-width="1.2"/>`);
      fx.push(twinkle(16, 40, 6, '#ffe066', 'ma-tw'), twinkle(104, 44, 6, '#ffe066', 'ma-tw d2'));
    }

    // ---------- 遺伝のパーツ: 翼・尾・角・とさか・模様 ----------
    const W = Number(L.wing) || 0, TL = Number(L.tail) || 0, H = Number(L.horn) || 0, CR = Number(L.crest) || 0, MK = Number(L.mark) || 0;
    const [ax1, ay1] = A.arm[0], [ax2, ay2] = A.arm[1];
    if (W === 1) back.push(`<path d="M${ax1},${ay1 - 22} C${ax1 - 26},${ay1 - 50} ${ax1 - 34},${ay1 - 20} ${ax1 - 28},${ay1 - 8} C${ax1 - 20},${ay1 - 16} ${ax1 - 18},${ay1 - 10} ${ax1 - 16},${ay1 - 2} C${ax1 - 10},${ay1 - 10} ${ax1 - 6},${ay1 - 8} ${ax1},${ay1 - 6}Z M${ax2},${ay2 - 22} C${ax2 + 26},${ay2 - 50} ${ax2 + 34},${ay2 - 20} ${ax2 + 28},${ay2 - 8} C${ax2 + 20},${ay2 - 16} ${ax2 + 18},${ay2 - 10} ${ax2 + 16},${ay2 - 2} C${ax2 + 10},${ay2 - 10} ${ax2 + 6},${ay2 - 8} ${ax2},${ay2 - 6}Z" fill="${lg('wg', [[0, C.accL], [1, C.accD]])}" ${st} class="ma-flap"/>`);
    if (W === 2) back.push(`<g class="ma-flap"><path d="M${ax1},${ay1 - 18} C${ax1 - 30},${ay1 - 36} ${ax1 - 38},${ay1 - 6} ${ax1 - 24},${ay1 + 2} C${ax1 - 18},${ay1 - 6} ${ax1 - 10},${ay1 - 6} ${ax1},${ay1 - 4}Z M${ax2},${ay2 - 18} C${ax2 + 30},${ay2 - 36} ${ax2 + 38},${ay2 - 6} ${ax2 + 24},${ay2 + 2} C${ax2 + 18},${ay2 - 6} ${ax2 + 10},${ay2 - 6} ${ax2},${ay2 - 4}Z" fill="#fff" stroke="${C.accL}" stroke-width="2"/><path d="M${ax1 - 22},${ay1 - 10} L${ax1 - 4},${ay1 - 12} M${ax2 + 22},${ay2 - 10} L${ax2 + 4},${ay2 - 12}" stroke="${C.accL}" stroke-width="1.4"/></g>`);
    if (W === 3) back.push(`<g class="ma-flap">${[0, 1].map((side) => { const sx = side ? ax2 : ax1, sy = side ? ay2 : ay1, k = side ? 1 : -1; return `<path d="M${sx},${sy - 16} L${sx + k * 34},${sy - 40} L${sx + k * 22},${sy - 14} L${sx + k * 36},${sy - 10} L${sx + k * 16},${sy - 2} L${sx + k * 24},${sy + 10} L${sx},${sy}Z" fill="${lg('wc' + side, [[0, '#fff'], [0.5, C.accL, 0.9], [1, C.acc, 0.75]])}" stroke="#fff" stroke-width="1.4"/>`; }).join('')}</g>`);
    const [tx, ty] = A.tail;
    if (TL === 1) back.push(`<path d="M${tx - 10},${ty} C${tx + 6},${ty + 4} ${tx + 16},${ty - 10} ${tx + 14},${ty - 26} L${tx + 20},${ty - 22} L${tx + 16},${ty - 32} L${tx + 8},${ty - 26} C${tx + 8},${ty - 14} ${tx},${ty - 8} ${tx - 10},${ty - 8}Z" fill="${C.base}" ${st}/>`);
    if (TL === 2) back.push(`<path d="M${tx - 10},${ty} C${tx + 10},${ty + 6} ${tx + 22},${ty - 6} ${tx + 16},${ty - 24} C${tx + 12},${ty - 32} ${tx + 2},${ty - 26} ${tx + 6},${ty - 18} C${tx + 8},${ty - 10} ${tx},${ty - 6} ${tx - 10},${ty - 6}Z" fill="${C.accL}" ${st}/>`);
    if (TL === 3) back.push(`<path d="M${tx - 10},${ty} C${tx + 8},${ty + 2} ${tx + 14},${ty - 8} ${tx + 12},${ty - 20}" stroke="${C.base}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M${tx + 12},${ty - 18} c-8,-6 -4,-18 2,-22 c2,6 10,8 6,18 c-2,4 -6,6 -8,4z" fill="${lg('tf', [[0, '#fff3bf'], [0.5, T.glow], [1, T.fx]])}" class="ma-flick"/>`);
    const tp = A.top, hg = lg('hn', [[0, '#fff'], [0.4, C.accL], [1, C.accD]]);
    if (H === 1) front.push(`<path d="M56,${tp + 4} L60,${tp - 18} L64,${tp + 4}Z" fill="${hg}" ${thin}/>`);
    if (H === 2) front.push(`<path d="M${A.hl + 2},${tp + 6} L${A.hl - 6},${tp - 14} L${A.hl + 10},${tp + 2}Z M${A.hr - 2},${tp + 6} L${A.hr + 6},${tp - 14} L${A.hr - 10},${tp + 2}Z" fill="${hg}" ${thin}/>`);
    if (H === 3) front.push(`<path d="M${A.hl + 4},${tp + 6} C${A.hl},${tp - 6} ${A.hl - 10},${tp - 10} ${A.hl - 14},${tp - 18} M${A.hr - 4},${tp + 6} C${A.hr},${tp - 6} ${A.hr + 10},${tp - 10} ${A.hr + 14},${tp - 18} M${A.hl - 4},${tp - 6} l-8,-2 M${A.hr + 4},${tp - 6} l8,-2" stroke="${C.accD}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
    if (H === 4) front.push(`<path d="M${A.hl + 2},${tp + 8} C${A.hl - 12},${tp - 8} ${A.hl - 20},${tp + 8} ${A.hl - 10},${tp + 16} C${A.hl - 6},${tp + 10} ${A.hl - 2},${tp + 10} ${A.hl + 2},${tp + 12}Z M${A.hr - 2},${tp + 8} C${A.hr + 12},${tp - 8} ${A.hr + 20},${tp + 8} ${A.hr + 10},${tp + 16} C${A.hr + 6},${tp + 10} ${A.hr + 2},${tp + 10} ${A.hr - 2},${tp + 12}Z" fill="${hg}" ${thin}/>`);
    if (H === 5 && type !== 'king') front.push(`<path d="M${A.hl + 2},${tp + 6} L${A.hl},${tp - 10} L${A.hl + 8},${tp - 2} L60,${tp - 14} L${A.hr - 8},${tp - 2} L${A.hr},${tp - 10} L${A.hr - 2},${tp + 6}Z" fill="${lg('cr2', [[0, '#fff3bf'], [1, '#fab005']])}" stroke="#e67700" stroke-width="1.4"/>`);
    if (CR === 1) front.push(`<path d="M52,${tp + 6} C50,${tp - 8} 58,${tp - 10} 60,${tp} C62,${tp - 12} 72,${tp - 8} 68,${tp + 6}Z" fill="${C.acc}" ${thin}/>`);
    if (CR === 2) front.push(`<path d="M60,${tp + 4} C60,${tp - 8} 50,${tp - 12} 46,${tp - 10} C50,${tp - 6} 56,${tp - 4} 60,${tp + 4} C62,${tp - 10} 70,${tp - 14} 74,${tp - 10} C68,${tp - 8} 62,${tp - 4} 60,${tp + 4}Z" fill="#69db7c" stroke="#2b8a3e" stroke-width="1.2"/>`);
    if (CR === 3 && type !== 'light') front.push(`<ellipse cx="60" cy="${tp - 10}" rx="16" ry="4.5" fill="none" stroke="#ffe066" stroke-width="3" class="ma-glow"/>`);
    const { fx: fxx, fy } = A;
    if (MK === 1) front.push(`<path d="M${fxx - 24},${fy + 4} l8,3 M${fxx - 24},${fy + 10} l8,1 M${fxx + 24},${fy + 4} l-8,3 M${fxx + 24},${fy + 10} l-8,1" stroke="${C.accD}" stroke-width="2.2" stroke-linecap="round"/>`);
    if (MK === 2) front.push([[38, A.sh + 14, 3.4], [82, A.sh + 12, 2.8], [78, A.sh + 24, 2], [42, A.sh + 26, 2.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.accD}" opacity=".55"/>`).join(''));
    if (MK === 3) front.push(`<path d="M${fxx},${fy - 16} l2.4,5 l5.6,.8 l-4,4 l1,5.6 l-5,-2.6 l-5,2.6 l1,-5.6 l-4,-4 l5.6,-.8z" fill="${C.accL}" stroke="#fff" stroke-width=".8"/>`);
    if (MK === 4) front.push(`<path d="M30,${A.sh + 14} l6,-8 l6,8 M78,${A.sh + 14} l6,-8 l6,8" stroke="${T.fx}" stroke-width="2.2" fill="none" opacity=".9"/>`);

    // ---------- 突然変異の部品 ----------
    const vb = [], vf = [];
    if (V.aura) vb.push(V.aura === 'rainbow' ? `<circle cx="60" cy="64" r="58" fill="none" stroke="${lg('va', [[0, '#ff6b6b'], [0.25, '#ffd43b'], [0.5, '#69db7c'], [0.75, '#4dabf7'], [1, '#9775fa']], 0, 0, 1, 1)}" stroke-width="8" opacity=".55" class="ma-halo"/>`
      : `<circle cx="60" cy="64" r="56" fill="${rg('vau', [[0, V.aura, 0.55], [1, V.aura, 0]], 0.5, 0.5, 0.5)}" class="ma-pulse"/>`);
    if (V.twin) vb.push(`<g opacity=".35" transform="translate(14 -6) scale(.92)"><path d="M60,20 C88,20 98,50 96,80 C94,104 80,112 60,112 C40,112 26,104 24,80 C22,50 32,20 60,20Z" fill="${C.ink}"/></g>`);
    if (V.wings6) vb.push(`<g class="ma-flap">${[-1, 1].map((k) => [0, 1, 2].map((i) => `<path d="M${60 + k * 22},${50 + i * 12} C${60 + k * (50 + i * 6)},${30 + i * 14} ${60 + k * (58 - i * 4)},${56 + i * 14} ${60 + k * (40 - i * 4)},${62 + i * 12}Z" fill="#fff" stroke="${C.accL}" stroke-width="1.4" opacity="${0.95 - i * 0.15}"/>`).join('')).join('')}</g>`);
    if (V.spikes) vb.push(`<path d="M30,52 L18,30 L38,46 L44,22 L52,44 L60,14 L68,44 L76,22 L82,46 L102,30 L90,52Z" fill="${lg('vs', [[0, '#fff'], [0.4, T.light], [1, T.fx]])}" stroke="#fff" stroke-width="1.2"/>`);
    if (V.tail2) vb.push(`<path d="M${A.tail[0] - 8},${A.tail[1] + 2} C${A.tail[0] + 14},${A.tail[1] + 14} ${A.tail[0] + 24},${A.tail[1] - 2} ${A.tail[0] + 18},${A.tail[1] - 18}" stroke="${C.mid}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M${120 - A.tail[0] + 8},${A.tail[1] + 2} C${120 - A.tail[0] - 14},${A.tail[1] + 14} ${120 - A.tail[0] - 24},${A.tail[1] - 2} ${120 - A.tail[0] - 18},${A.tail[1] - 18}" stroke="${C.mid}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
    if (V.arms) vf.push(`<path d="M${A.arm[0][0] + 2},${A.arm[0][1] - 14} C${A.arm[0][0] - 16},${A.arm[0][1] - 26} ${A.arm[0][0] - 20},${A.arm[0][1] - 8} ${A.arm[0][0] - 10},${A.arm[0][1] - 4} M${A.arm[1][0] - 2},${A.arm[1][1] - 14} C${A.arm[1][0] + 16},${A.arm[1][1] - 26} ${A.arm[1][0] + 20},${A.arm[1][1] - 8} ${A.arm[1][0] + 10},${A.arm[1][1] - 4}" stroke="${C.base}" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="${A.arm[0][0] - 10}" cy="${A.arm[0][1] - 4}" r="4.4" fill="${C.mid}" ${thin}/><circle cx="${A.arm[1][0] + 10}" cy="${A.arm[1][1] - 4}" r="4.4" fill="${C.mid}" ${thin}/>`);
    if (V.horns) vf.push(`<path d="M${A.hl},${A.top + 6} C${A.hl - 10},${A.top - 8} ${A.hl - 4},${A.top - 18} ${A.hl - 12},${A.top - 24} C${A.hl + 4},${A.top - 16} ${A.hl + 8},${A.top - 4} ${A.hl + 8},${A.top + 4}Z M${A.hr},${A.top + 6} C${A.hr + 10},${A.top - 8} ${A.hr + 4},${A.top - 18} ${A.hr + 12},${A.top - 24} C${A.hr - 4},${A.top - 16} ${A.hr - 8},${A.top - 4} ${A.hr - 8},${A.top + 4}Z" fill="${lg('vh', [[0, '#fff9db'], [1, '#495057']])}" ${thin}/>`);
    if (V.halo) vf.push(`<ellipse cx="60" cy="${A.top - 14}" rx="18" ry="4.5" fill="none" stroke="#fff3bf" stroke-width="3" class="ma-glow"/>`);
    if (V.eye3) vf.push(`<g class="ma-eye" style="transform-origin:60px ${A.fy - 14}px"><ellipse cx="60" cy="${A.fy - 14}" rx="4" ry="5.6" fill="#fff" stroke="${C.ink}" stroke-width="1.4"/><ellipse cx="60" cy="${A.fy - 14}" rx="2" ry="3.4" fill="${T.fx}"/></g>`);
    if (V.core) vf.push(`<circle cx="60" cy="${A.sh + 16}" r="7" fill="${rg('vc', [[0, '#fff'], [0.5, '#b197fc'], [1, '#5f3dc4', 0]], 0.5, 0.5, 0.5)}" class="ma-pulse"/>`);
    if (V.pattern === 'crystal') vf.push([[40, A.sh + 6], [80, A.sh + 4], [48, A.sh + 22], [74, A.sh + 20]].map(([x, y]) => `<path d="M${x},${y - 5} l4,5 l-4,5 l-4,-5Z" fill="#fff" stroke="${T.fx}" stroke-width=".8" opacity=".9"/>`).join(''));
    if (V.pattern === 'stars') vf.push([[38, A.sh + 4, 3], [82, A.sh + 8, 2.6], [50, A.sh + 20, 2], [72, A.sh + 22, 2.4], [60, A.sh - 2, 1.8]].map(([x, y, r]) => twinkle(x, y, r, '#fff9db')).join(''));
    if (V.pattern === 'plates') vf.push(`<path d="M36,${A.sh + 6} h14 v8 h-14Z M70,${A.sh + 6} h14 v8 h-14Z M52,${A.sh + 18} h16 v8 h-16Z" fill="${lg('vp', [[0, '#f1f3f5'], [1, '#868e96']])}" ${thin} opacity=".9"/>`);
    if (V.pattern === 'runes') vf.push(`<path d="M38,${A.sh + 6} l4,8 l4,-8 M74,${A.sh + 6} v8 h6 M54,${A.sh + 20} l6,-6 l6,6" stroke="${T.glow}" stroke-width="1.8" fill="none" class="ma-glow"/>`);
    if (V.speedLines) vb.push(`<path d="M6,50 h22 M2,62 h26 M8,74 h18 M92,50 h22 M92,62 h26 M94,74 h18" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`);
    if (V.split) vf.push(`<path d="M60,${A.top} V112" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3" opacity=".7"/>`);

    // ---------- 顔 (まばたきするよう、目は ma-eye にまとめる) ----------
    const E = Number(L.eyes) || 0, s = A.s, ex = 12.5 * s;
    const eye = (x) => {
      if (A.visor) return `<path d="M${x - 5},${fy - 1} h10" stroke="${T.glow}" stroke-width="3.4" stroke-linecap="round" class="ma-glow"/>`;
      if (E === 1) return `<path d="M${x - 8 * s},${fy + 1} Q${x},${fy - 9 * s} ${x + 8 * s},${fy + 1} Q${x},${fy + 5 * s} ${x - 8 * s},${fy + 1}Z" fill="${lg('ey', [[0, '#fff3bf'], [1, T.glow]])}" stroke="#1b1b3a" stroke-width="1.6"/><ellipse cx="${x}" cy="${fy - 1}" rx="${1.8 * s}" ry="${4 * s}" fill="#1b1b3a"/>`;
      if (E === 2) return `<ellipse cx="${x}" cy="${fy}" rx="${6.8 * s}" ry="${8.2 * s}" fill="#1b1b3a"/><ellipse cx="${x}" cy="${fy + 3 * s}" rx="${4.6 * s}" ry="${3.6 * s}" fill="${C.acc}" opacity=".6"/><circle cx="${x - 2.4 * s}" cy="${fy - 3 * s}" r="${2.8 * s}" fill="#fff"/><circle cx="${x + 2.4 * s}" cy="${fy + 3 * s}" r="${1.3 * s}" fill="#fff"/>`;
      if (E === 3) return `<path d="M${x - 6 * s},${fy} Q${x},${fy + 5 * s} ${x + 6 * s},${fy}" stroke="#1b1b3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      if (E === 4) return `<ellipse cx="${x}" cy="${fy}" rx="${6.4 * s}" ry="${7.4 * s}" fill="#fff" stroke="#1b1b3a" stroke-width="1.6"/><ellipse cx="${x + 1}" cy="${fy + 1}" rx="${3.8 * s}" ry="${4.8 * s}" fill="${lg('ir', [[0, C.accL], [1, C.accD]])}"/><circle cx="${x + 1}" cy="${fy + 1}" r="${1.8 * s}" fill="#1b1b3a"/><circle cx="${x - 1}" cy="${fy - 2}" r="${1.4 * s}" fill="#fff"/>`;
      return `<ellipse cx="${x}" cy="${fy}" rx="${6.2 * s}" ry="${7.6 * s}" fill="#1b1b3a"/><ellipse cx="${x}" cy="${fy + 3.4 * s}" rx="${4 * s}" ry="${2.8 * s}" fill="${T.fx}" opacity=".55"/>${twinkle(x - 1.6 * s, fy - 2.4 * s, 3.2 * s, '#fff')}<circle cx="${x + 2.2 * s}" cy="${fy + 2.8 * s}" r="${1.2 * s}" fill="#fff"/>`;
    };
    front.push(`<g class="${E === 3 || A.visor ? '' : 'ma-eye'}" style="transform-origin:60px ${fy}px">${eye(fxx - ex)}${eye(fxx + ex)}</g>`);
    if (V.glowEyes) front.push(`<circle cx="${fxx - ex}" cy="${fy}" r="${9 * s}" fill="${V.glowEyes}" opacity=".35" class="ma-glow"/><circle cx="${fxx + ex}" cy="${fy}" r="${9 * s}" fill="${V.glowEyes}" opacity=".35" class="ma-glow"/>`);
    if (E === 1 && !A.visor) front.push(`<path d="M${fxx - ex - 8},${fy - 10} L${fxx - ex + 6},${fy - 6} M${fxx + ex + 8},${fy - 10} L${fxx + ex - 6},${fy - 6}" stroke="#1b1b3a" stroke-width="2.6" stroke-linecap="round"/>`);
    if (E !== 1 && !A.visor) front.push(`<ellipse cx="${fxx - ex - 7}" cy="${fy + 8}" rx="${4.6 * s}" ry="${2.6 * s}" fill="#ff6b9d" opacity=".45"/><ellipse cx="${fxx + ex + 7}" cy="${fy + 8}" rx="${4.6 * s}" ry="${2.6 * s}" fill="#ff6b9d" opacity=".45"/>`);
    if (A.mouth !== false && !A.visor) front.push(E === 1 ? `<path d="M${fxx - 6},${fy + 11} L${fxx + 6},${fy + 11} Q${fxx + 4},${fy + 17} ${fxx},${fy + 17} Q${fxx - 4},${fy + 17} ${fxx - 6},${fy + 11}Z" fill="#fff" stroke="#1b1b3a" stroke-width="1.4"/>`
      : `<path d="M${fxx - 4},${fy + 11} Q${fxx},${fy + 16} ${fxx + 4},${fy + 11}" stroke="#1b1b3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);

    // ---------- 強さ評価 (C〜Z) の演出 ----------
    const aura = [];
    aura.push(`<circle cx="60" cy="64" r="56" fill="${rg('au', [[0, T.glow, 0.65], [0.55, T.fx, 0.18 + tier * 0.06], [1, T.fx, 0]], 0.5, 0.5, 0.5)}"/>`);
    if (tier >= 2) aura.push(`<g class="ma-rays">${Array.from({ length: 12 }, (_, i) => { const a = (i * 30) * Math.PI / 180, b = a + 0.16; return `<path d="M60,64L${60 + Math.cos(a) * 90},${64 + Math.sin(a) * 90}L${60 + Math.cos(b) * 90},${64 + Math.sin(b) * 90}Z" fill="${T.glow}" opacity="${tier >= 3 ? 0.4 : 0.26}"/>`; }).join('')}</g>`);
    if (tier >= 4) aura.push(`<circle class="ma-halo" cx="60" cy="64" r="54" fill="none" stroke="${lg('rb', [[0, '#ff6b6b'], [0.2, '#ffd43b'], [0.4, '#69db7c'], [0.6, '#4dabf7'], [0.8, '#9775fa'], [1, '#f783ac']], 0, 0, 1, 1)}" stroke-width="4" stroke-dasharray="11 6"/>`);
    if (tier >= 1) front.push(`<path d="M${fxx - 4},${A.sh + 4} l4,-4 l4,4 l-4,4Z" fill="${T.light}" stroke="${T.fx}" stroke-width="1" opacity=".95"/>`); // A 以上: 胸の紋章
    if (tier >= 2) front.push(`<path d="M${ax1 - 4},${ay1 + 2} h10 M${ax2 - 6},${ay2 + 2} h10" stroke="${lg('gd', [[0, '#fff3bf'], [1, '#f59f00']], 0, 0, 1, 0)}" stroke-width="3.4" stroke-linecap="round"/>`); // S 以上: 腕輪
    if (tier >= 3) fx.push(...[[8, 60], [112, 64], [60, 4], [26, 112], [96, 112]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#fff" class="ma-mote d${i % 3}"/>`)); // SS 以上: 光の粒
    if (tier >= 4) fx.push(`<path d="M10,22 l4,-10 l4,10 l-4,6Z M102,20 l4,-10 l4,10 l-4,6Z" fill="#fff" stroke="#9775fa" stroke-width="1" class="ma-flo"/>`); // Z: 結晶

    defs.push(`<filter id="${u}stk" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.2" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="o"/><feDropShadow in="o" dx="0" dy="2.4" stdDeviation="1.8" flood-color="#1b1b3a" flood-opacity=".28" result="os"/><feMerge><feMergeNode in="os"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    const ground = A.float ? `<ellipse cx="60" cy="116" rx="18" ry="3" fill="#1b1b3a" opacity=".12" class="ma-gshadow"/>` : `<ellipse cx="60" cy="113" rx="34" ry="4.5" fill="#1b1b3a" opacity=".18"/>`;
    const sc = Number(V.scale) > 0 ? Math.min(1.15, Number(V.scale)) : 1;
    return `<defs>${defs.join('')}</defs>${aura.join('')}${vb.join('')}${ground}<g class="ma-idle${A.float ? ' float' : ''}"><g transform="translate(60 112) scale(${sc}) translate(-60 -112)"${V.ghost ? ' opacity=".78"' : ''}><g filter="url(#${u}stk)">${back.join('')}${body.join('')}${front.join('')}${vf.join('')}</g></g></g>${fx.join('')}`;
  }

  // 読めなかったとき (データの欠けなど) の代わりの絵: 属性の色の丸と「?」
  function fallback(type) {
    const c = (TYPE[type] || TYPE.fire).fx;
    return `<circle cx="60" cy="62" r="40" fill="${c}" opacity=".25"/><circle cx="60" cy="62" r="30" fill="${c}"/><text x="60" y="74" text-anchor="middle" font-size="34" font-weight="900" fill="#fff" font-family="sans-serif">?</text>`;
  }

  window.MonArt = {
    svg(look, type, { rank = 'B', cls = '', label = '' } = {}) {
      let inner; try { inner = draw(look, type, rank); } catch (e) { inner = fallback(type); }
      return `<svg class="ma-svg ${cls}" viewBox="-4 -10 128 132" ${label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true"'}>${inner}</svg>`;
    },
  };
})();
