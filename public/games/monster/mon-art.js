// =====================================================================
// ブリードモンスターズ: モンスターの絵 (SVG。画像ファイルは使わない)
// look (見た目の遺伝子) = { body, eyes, horn, wing, tail, mark, crest, h1, h2 }
// 子は父か母のパーツを受けつぎ、色は両親をまぜる → 両親の面影がある子になる
// 属性 (火・水・草・光・闇・王) で後ろの演出、強さ評価 (C〜Z) で光り方が変わる
// =====================================================================
'use strict';
(() => {
  let seq = 0;
  const twinkle = (x, y, r, fill, cls = '') => `<path class="${cls}" d="M${x},${y - r}Q${x},${y} ${x + r},${y}Q${x},${y} ${x},${y + r}Q${x},${y} ${x - r},${y}Q${x},${y} ${x},${y - r}Z" fill="${fill}"/>`;
  const TYPE_COL = { fire: ['#ff6b35', '#ffd43b'], water: ['#1c7ed6', '#74c0fc'], grass: ['#2f9e44', '#a9e34b'], light: ['#fab005', '#fff3bf'], dark: ['#5f3dc4', '#e599f7'], king: ['#e67700', '#ffe066'] };

  function draw(look, type, rank) {
    const u = 'ma' + (++seq), defs = [];
    const lg = (n, stops, x2 = 0, y2 = 1) => { defs.push(`<linearGradient id="${u}${n}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</linearGradient>`); return `url(#${u}${n})`; };
    const rg = (n, stops, cx = 0.4, cy = 0.32, r = 0.8) => { defs.push(`<radialGradient id="${u}${n}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</radialGradient>`); return `url(#${u}${n})`; };
    const L = look || {}, h1 = Number(L.h1) || 0, h2 = Number(L.h2) || 0;
    const c = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
    const main = c(h1, 72, 56), light = c(h1, 85, 74), dark = c(h1, 60, 34), acc = c(h2, 80, 58), accL = c(h2, 90, 78), accD = c(h2, 65, 38);
    const skin = rg('sk', [[0, light], [0.55, main], [1, dark]]);
    const [tc1, tc2] = TYPE_COL[type] || TYPE_COL.fire;
    const back = [], body = [], front = [];

    // ---------- 属性の演出 (うしろ) ----------
    const R = 'ABCSZ'.includes(rank) ? rank : 'B';
    const rays = (n, col, op) => Array.from({ length: n }, (_, i) => { const a = (i * 360 / n) * Math.PI / 180, b = a + Math.PI / n * 0.6; return `<path d="M60,62L${60 + Math.cos(a) * 80},${62 + Math.sin(a) * 80}L${60 + Math.cos(b) * 80},${62 + Math.sin(b) * 80}Z" fill="${col}" opacity="${op}"/>`; }).join('');
    back.push(`<circle cx="60" cy="62" r="56" fill="${rg('au', [[0, tc2, 0.85], [0.55, tc1, 0.35], [1, tc1, 0]], 0.5, 0.5, 0.5)}"/>`);
    if (rank === 'S' || rank === 'SS' || rank === 'Z') back.push(`<g class="ma-rays">${rays(14, tc2, rank === 'S' ? 0.35 : 0.5)}</g>`);
    if (rank === 'Z') back.push(`<circle class="ma-halo" cx="60" cy="62" r="54" fill="none" stroke="${lg('rb', [[0, '#ff6bd6'], [0.25, '#ffd43b'], [0.5, '#63e6be'], [0.75, '#4dabf7'], [1, '#b197fc']], 1, 1)}" stroke-width="4" stroke-dasharray="12 6"/>`);
    if (type === 'fire') back.push(...[[16, 92, 1], [102, 88, 1.1], [24, 34, 0.7], [98, 30, 0.8]].map(([x, y, s]) => `<path class="ma-flick" d="M${x},${y} c${-8 * s},${-10 * s} ${-2 * s},${-20 * s} ${2 * s},${-26 * s} c${2 * s},${8 * s} ${10 * s},${12 * s} ${6 * s},${22 * s} c${-2 * s},${5 * s} ${-6 * s},${6 * s} ${-8 * s},${4 * s}Z" fill="${lg('fl', [[0, '#fff3bf'], [0.5, '#ffa94d'], [1, '#e8590c']])}"/>`));
    if (type === 'water') back.push(...[[14, 40, 5], [104, 52, 4], [20, 96, 6], [100, 98, 3.5], [60, 8, 3]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c(200, 90, 85)}" opacity=".7" stroke="#fff" stroke-width="1.2"/>`), `<path d="M6,106 q10,-8 20,0 t20,0 t20,0 t20,0 t20,0 t20,0" fill="none" stroke="#a5d8ff" stroke-width="3" opacity=".8"/>`);
    if (type === 'grass') back.push(...[[14, 36, -30], [104, 40, 40], [16, 96, -70], [104, 96, 70]].map(([x, y, a]) => `<path transform="translate(${x} ${y}) rotate(${a})" d="M0,0 C8,-8 8,-18 0,-24 C-8,-18 -8,-8 0,0Z" fill="#69db7c" stroke="#2b8a3e" stroke-width="1.2"/>`));
    if (type === 'light') back.push(twinkle(14, 30, 8, '#fff3bf', 'ma-tw'), twinkle(106, 40, 6, '#fff', 'ma-tw d2'), twinkle(100, 100, 7, '#ffe066', 'ma-tw d3'), twinkle(18, 98, 5, '#fff', 'ma-tw d2'));
    if (type === 'dark') back.push(`<path d="M96,14 a14,14 0 1 0 10,24 a11,11 0 1 1 -10,-24z" fill="#e5dbff" opacity=".85"/>`, ...[[14, 88], [104, 92], [22, 30]].map(([x, y]) => `<path class="ma-flick" d="M${x},${y} c-6,-8 4,-12 0,-20 c8,4 10,14 4,20z" fill="#9775fa" opacity=".7"/>`));
    if (type === 'king') back.push(`<path d="M44,12 L48,2 L54,9 L60,0 L66,9 L72,2 L76,12Z" fill="${lg('kc', [[0, '#fff3bf'], [1, '#fab005']])}" stroke="#e67700" stroke-width="1.2" opacity=".85"/>`, twinkle(16, 40, 6, '#ffe066', 'ma-tw'), twinkle(104, 46, 6, '#ffe066', 'ma-tw d2'));

    // ---------- 羽・しっぽ (体のうしろ) ----------
    const wing = Number(L.wing) || 0, tail = Number(L.tail) || 0;
    if (wing === 1) body.push(`<path d="M34,56 C14,30 2,48 6,60 C10,54 16,58 14,66 C20,62 26,66 26,74Z M86,56 C106,30 118,48 114,60 C110,54 104,58 106,66 C100,62 94,66 94,74Z" fill="${lg('wg', [[0, accL], [1, accD]])}" stroke="${accD}" stroke-width="1.6"/>`);
    if (wing === 2) body.push(`<path d="M34,58 C10,46 0,62 8,72 C2,76 8,84 18,80 C14,88 26,90 32,80Z M86,58 C110,46 120,62 112,72 C118,76 112,84 102,80 C106,88 94,90 88,80Z" fill="#fff" stroke="${accL}" stroke-width="2"/><path d="M14,70 L30,66 M106,70 L90,66" stroke="${accL}" stroke-width="1.6"/>`);
    if (wing === 3) body.push(`<path d="M36,56 L6,34 L18,58 L2,62 L22,70 L10,84 L34,72Z M84,56 L114,34 L102,58 L118,62 L98,70 L110,84 L86,72Z" fill="${lg('wc', [[0, '#fff'], [0.5, accL, 0.9], [1, acc, 0.8]])}" stroke="#fff" stroke-width="1.4"/>`);
    if (tail === 1) body.push(`<path d="M80,92 C98,96 108,84 110,72 L116,76 L112,66 L104,70 C102,80 94,86 82,84Z" fill="${main}" stroke="${dark}" stroke-width="1.6"/><path d="M106,70 l4,-8 l3,8z" fill="${acc}"/>`);
    if (tail === 2) body.push(`<path d="M80,90 C100,98 116,88 110,70 C108,62 96,64 100,74 C102,82 92,86 82,82Z" fill="${accL}" stroke="${accD}" stroke-width="1.4"/><circle cx="106" cy="68" r="7" fill="#fff" opacity=".8"/>`);
    if (tail === 3) body.push(`<path d="M80,92 C98,96 104,82 102,70" stroke="${main}" stroke-width="7" fill="none" stroke-linecap="round"/><path class="ma-flick" d="M102,72 c-8,-6 -4,-18 2,-22 c2,6 10,8 6,18 c-2,4 -6,6 -8,4z" fill="${lg('tf', [[0, '#fff3bf'], [0.5, tc2], [1, tc1]])}"/>`);

    // ---------- 体 (6 種類) ----------
    const bodyType = Number(L.body) || 0;
    let fx = 60, fy = 62, fs = 1;
    if (bodyType === 0) { // スライム
      body.push(`<path d="M60,22 C86,22 100,52 100,78 C100,98 84,106 60,106 C36,106 20,98 20,78 C20,52 34,22 60,22Z" fill="${skin}" stroke="${dark}" stroke-width="2.4"/><path d="M24,92 C30,104 46,108 60,108 C74,108 90,104 96,92 C88,98 76,100 60,100 C44,100 32,98 24,92Z" fill="${dark}" opacity=".35"/>`);
      fy = 66;
    } else if (bodyType === 1) { // けもの
      body.push(`<path d="M30,40 L22,16 L44,30Z M90,40 L98,16 L76,30Z" fill="${main}" stroke="${dark}" stroke-width="2"/><path d="M30,36 L26,22 L40,30Z M90,36 L94,22 L80,30Z" fill="${accL}"/>`);
      body.push(`<ellipse cx="38" cy="100" rx="11" ry="8" fill="${dark}"/><ellipse cx="82" cy="100" rx="11" ry="8" fill="${dark}"/><ellipse cx="60" cy="66" rx="40" ry="36" fill="${skin}" stroke="${dark}" stroke-width="2.4"/><ellipse cx="60" cy="80" rx="20" ry="13" fill="${accL}" opacity=".9"/><ellipse cx="60" cy="74" rx="5" ry="3.5" fill="${dark}"/>`);
      fy = 60;
    } else if (bodyType === 2) { // とり
      body.push(`<ellipse cx="60" cy="68" rx="36" ry="38" fill="${skin}" stroke="${dark}" stroke-width="2.4"/><ellipse cx="60" cy="82" rx="22" ry="20" fill="${accL}" opacity=".85"/><path d="M52,104 l-4,10 M58,104 l0,10 M68,104 l4,10" stroke="${acc}" stroke-width="3" stroke-linecap="round"/><path d="M60,68 l-8,6 l8,6 l8,-6z" fill="${lg('bk', [[0, '#ffe066'], [1, '#f08c00']])}" stroke="#d9480f" stroke-width="1.2"/>`);
      fy = 56;
    } else if (bodyType === 3) { // ドラゴン
      body.push(`<path d="M30,86 C24,58 36,28 60,28 C84,28 96,58 90,86 C86,104 74,108 60,108 C46,108 34,104 30,86Z" fill="${skin}" stroke="${dark}" stroke-width="2.4"/><path d="M44,72 C44,64 76,64 76,72 L74,104 C66,108 54,108 46,104Z" fill="${accL}" opacity=".9"/>${[78, 86, 94].map((y) => `<path d="M48,${y} H72" stroke="${accD}" stroke-width="1" opacity=".5"/>`).join('')}<path d="M48,64 C52,72 68,72 72,64 C66,66 54,66 48,64Z" fill="${dark}" opacity=".4"/><circle cx="54" cy="66" r="1.6" fill="${dark}"/><circle cx="66" cy="66" r="1.6" fill="${dark}"/><path d="M28,84 l-8,4 l8,2 M92,84 l8,4 l-8,2" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`);
      fy = 52;
    } else if (bodyType === 4) { // ゴーレム
      body.push(`<path d="M28,40 L44,24 L80,24 L94,40 L98,92 L84,106 L36,106 L22,92Z" fill="${skin}" stroke="${dark}" stroke-width="2.4" stroke-linejoin="round"/><path d="M28,40 L44,24 L80,24 L94,40 L60,44Z" fill="#fff" opacity=".2"/><path d="M36,78 L48,72 M74,90 L84,80 M40,96 L54,92" stroke="${dark}" stroke-width="1.6" opacity=".6"/><path d="M60,74 l8,8 l-8,8 l-8,-8z" fill="${lg('gm', [[0, '#fff'], [0.4, accL], [1, acc]])}" stroke="#fff" stroke-width="1.4"/>`);
      fy = 54;
    } else { // ようせい
      body.push(`<path d="M44,96 C40,110 52,114 60,104 C68,114 80,110 76,96 C80,86 70,80 60,82 C50,80 40,86 44,96Z" fill="${accL}" stroke="${accD}" stroke-width="1.6"/><circle cx="60" cy="58" r="34" fill="${skin}" stroke="${dark}" stroke-width="2.4"/>`);
      fy = 60; fs = 1.05;
    }
    body.push(`<ellipse cx="${fx - 16}" cy="${fy - 20}" rx="9" ry="5.5" fill="#fff" opacity=".55" transform="rotate(-24 ${fx - 16} ${fy - 20})"/>`);

    // ---------- 模様 ----------
    const mark = Number(L.mark) || 0;
    if (mark === 1) body.push(`<path d="M30,60 l10,4 M28,70 l10,2 M90,60 l-10,4 M92,70 l-10,2" stroke="${accD}" stroke-width="3" stroke-linecap="round" opacity=".8"/>`);
    if (mark === 2) body.push([[36, 84, 4], [84, 82, 3.4], [80, 94, 2.4], [40, 96, 2.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${accD}" opacity=".55"/>`).join(''));
    if (mark === 3) body.push(`<path d="M${fx},${fy - 30} l3,6 l7,1 l-5,5 l1,7 l-6,-3 l-6,3 l1,-7 l-5,-5 l7,-1z" fill="${accL}" stroke="#fff" stroke-width="1"/>`);
    if (mark === 4) body.push(`<path d="M30,78 l6,-8 l6,8 M78,78 l6,-8 l6,8" stroke="${tc2}" stroke-width="2.4" fill="none" opacity=".9"/>`);

    // ---------- 顔 ----------
    const eyes = Number(L.eyes) || 0, ex = 13 * fs;
    const eye = (x) => {
      if (eyes === 1) return `<path d="M${x - 8},${fy + 1} Q${x},${fy - 9} ${x + 8},${fy + 1} Q${x},${fy + 5} ${x - 8},${fy + 1}Z" fill="${lg('ey', [[0, '#fff3bf'], [1, tc2]])}" stroke="#1b1b3a" stroke-width="1.6"/><ellipse cx="${x}" cy="${fy - 1}" rx="1.8" ry="4" fill="#1b1b3a"/>`;
      if (eyes === 2) return `<ellipse cx="${x}" cy="${fy}" rx="6.5" ry="8" fill="#1b1b3a"/><circle cx="${x - 2.4}" cy="${fy - 3}" r="2.8" fill="#fff"/><circle cx="${x + 2.2}" cy="${fy + 3}" r="1.3" fill="#fff"/><ellipse cx="${x}" cy="${fy + 4}" rx="4" ry="2" fill="${acc}" opacity=".5"/>`;
      if (eyes === 3) return `<path d="M${x - 6},${fy} Q${x},${fy + 5} ${x + 6},${fy}" stroke="#1b1b3a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
      if (eyes === 4) return `<ellipse cx="${x}" cy="${fy}" rx="6" ry="7" fill="#fff" stroke="#1b1b3a" stroke-width="1.6"/><ellipse cx="${x + 1}" cy="${fy + 1}" rx="3.4" ry="4.4" fill="${accD}"/><circle cx="${x}" cy="${fy - 1}" r="1.4" fill="#fff"/>`;
      return `<ellipse cx="${x}" cy="${fy}" rx="6" ry="7.4" fill="#1b1b3a"/>${twinkle(x - 1.6, fy - 2.4, 3.2, '#fff')}<circle cx="${x + 2.2}" cy="${fy + 2.6}" r="1.2" fill="#fff"/>`;
    };
    front.push(eye(fx - ex), eye(fx + ex));
    if (eyes === 1) front.push(`<path d="M${fx - ex - 8},${fy - 10} L${fx - ex + 6},${fy - 6} M${fx + ex + 8},${fy - 10} L${fx + ex - 6},${fy - 6}" stroke="#1b1b3a" stroke-width="2.6" stroke-linecap="round"/>`);
    if (eyes !== 1) front.push(`<ellipse cx="${fx - ex - 7}" cy="${fy + 8}" rx="5" ry="2.8" fill="#ff6b9d" opacity=".5"/><ellipse cx="${fx + ex + 7}" cy="${fy + 8}" rx="5" ry="2.8" fill="#ff6b9d" opacity=".5"/>`);
    if (bodyType !== 2) front.push(eyes === 1 ? `<path d="M${fx - 6},${fy + 10} L${fx + 6},${fy + 10} Q${fx + 4},${fy + 16} ${fx},${fy + 16} Q${fx - 4},${fy + 16} ${fx - 6},${fy + 10}Z" fill="#fff" stroke="#1b1b3a" stroke-width="1.4"/><path d="M${fx - 3},${fy + 10} l1.5,4 l1.5,-4 M${fx + 1},${fy + 10} l1.5,4 l1.5,-4" stroke="#1b1b3a" stroke-width=".8" fill="none"/>`
      : `<path d="M${fx - 4},${fy + 10} Q${fx},${fy + 15} ${fx + 4},${fy + 10}" stroke="#1b1b3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);

    // ---------- 角・とさか ----------
    const horn = Number(L.horn) || 0, top = { 0: 24, 1: 30, 2: 32, 3: 30, 4: 26, 5: 26 }[bodyType] || 26;
    const hg = lg('hn', [[0, '#fff'], [0.4, accL], [1, accD]]);
    if (horn === 1) front.push(`<path d="M56,${top + 2} L60,${top - 20} L64,${top + 2}Z" fill="${hg}" stroke="${accD}" stroke-width="1.4"/>`);
    if (horn === 2) front.push(`<path d="M42,${top + 6} L36,${top - 14} L50,${top + 2}Z M78,${top + 6} L84,${top - 14} L70,${top + 2}Z" fill="${hg}" stroke="${accD}" stroke-width="1.4"/>`);
    if (horn === 3) front.push(`<path d="M44,${top + 4} C40,${top - 10} 30,${top - 14} 26,${top - 22} M76,${top + 4} C80,${top - 10} 90,${top - 14} 94,${top - 22} M38,${top - 8} l-8,-2 M82,${top - 8} l8,-2" stroke="${accD}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
    if (horn === 4) front.push(`<path d="M42,${top + 6} C30,${top - 8} 22,${top + 6} 30,${top + 14} C34,${top + 8} 38,${top + 8} 42,${top + 10}Z M78,${top + 6} C90,${top - 8} 98,${top + 6} 90,${top + 14} C86,${top + 8} 82,${top + 8} 78,${top + 10}Z" fill="${hg}" stroke="${accD}" stroke-width="1.4"/>`);
    if (horn === 5) front.push(`<path d="M42,${top + 4} L40,${top - 12} L50,${top - 2} L60,${top - 16} L70,${top - 2} L80,${top - 12} L78,${top + 4}Z" fill="${lg('cr', [[0, '#fff3bf'], [1, '#fab005']])}" stroke="#e67700" stroke-width="1.4"/><circle cx="60" cy="${top - 4}" r="3" fill="${acc}"/>`);
    const crest = Number(L.crest) || 0;
    if (crest === 1) front.push(`<path d="M52,${top + 2} C50,${top - 10} 58,${top - 12} 60,${top - 2} C62,${top - 14} 72,${top - 10} 68,${top + 2}Z" fill="${acc}" stroke="${accD}" stroke-width="1.2"/>`);
    if (crest === 2) front.push(`<path d="M60,${top + 2} C60,${top - 8} 52,${top - 12} 48,${top - 10} C52,${top - 6} 56,${top - 4} 60,${top + 2} C62,${top - 10} 70,${top - 14} 74,${top - 10} C68,${top - 8} 62,${top - 4} 60,${top + 2}Z" fill="#69db7c" stroke="#2b8a3e" stroke-width="1.2"/>`);
    if (crest === 3) front.push(`<ellipse cx="60" cy="${top - 10}" rx="16" ry="4.5" fill="none" stroke="#ffe066" stroke-width="3"/>`);

    defs.push(`<filter id="${u}stk" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="o"/><feDropShadow in="o" dx="0" dy="2.4" stdDeviation="1.8" flood-color="#1b1b3a" flood-opacity=".25" result="os"/><feMerge><feMergeNode in="os"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    return `<defs>${defs.join('')}</defs>${back.join('')}<ellipse cx="60" cy="114" rx="30" ry="4.5" fill="#1b1b3a" opacity=".16"/><g filter="url(#${u}stk)">${body.join('')}${front.join('')}</g>`;
  }

  window.MonArt = {
    svg(look, type, { rank = 'B', cls = '', label = '' } = {}) {
      return `<svg class="ma-svg ${cls}" viewBox="-4 -6 128 128" ${label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true"'}>${draw(look, type, rank)}</svg>`;
    },
  };
})();
