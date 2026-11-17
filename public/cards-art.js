// =====================================================================
// ぶんぼうぐバトラーズ: キャラクターのイラスト (SVG で描く。画像ファイルは使わない)
// ・どのキャラも「つやのある体 + 白いふち (シール風) + 大きなキラキラの目 + ほっぺ」
// ・レア度で背景の演出が変わる: R きらめき / SR 光のオーラ / SSR 回る光線と後光
// =====================================================================
'use strict';
(() => {
  let seq = 0;
  // 4 つの角の星 (きらめき)
  const twinkle = (x, y, r, fill, cls = '') => `<path class="${cls}" d="M${x},${y - r}Q${x},${y} ${x + r},${y}Q${x},${y} ${x},${y + r}Q${x},${y} ${x - r},${y}Q${x},${y} ${x},${y - r}Z" fill="${fill}"/>`;
  const heart = (x, y, s, fill) => `<path d="M${x},${y + 3 * s}C${x - 6 * s},${y - 1 * s} ${x - 3 * s},${y - 6 * s} ${x},${y - 3 * s}C${x + 3 * s},${y - 6 * s} ${x + 6 * s},${y - 1 * s} ${x},${y + 3 * s}Z" fill="${fill}"/>`;

  function draw(id, rarity, coat = '') {
    const u = 'cba' + (++seq);
    const defs = [];
    const lg = (name, stops, x2 = 0, y2 = 1) => { defs.push(`<linearGradient id="${u}${name}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</linearGradient>`); return `url(#${u}${name})`; };
    const rg = (name, stops, cx = 0.35, cy = 0.3, r = 0.85) => { defs.push(`<radialGradient id="${u}${name}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</radialGradient>`); return `url(#${u}${name})`; };
    const clip = (name, shape) => { defs.push(`<clipPath id="${u}${name}">${shape}</clipPath>`); return `url(#${u}${name})`; };

    // ---------- 顔 ----------
    // eyes: sparkle (キラキラ) / happy (にっこり) / brave (きりっ) / cool (半目) / old (細目) / fierce (竜) / star (星の目) / ninja / wink
    function face(x, y, { s = 1, eyes = 'sparkle', mouth = 'smile', blush = true, iris = '#2b2140', brows = false } = {}) {
      const ex = 11.5 * s, out = [];
      const bigEye = (cx, star = false) => `<ellipse cx="${cx}" cy="${y}" rx="${5.6 * s}" ry="${6.8 * s}" fill="${iris}"/>
        <ellipse cx="${cx}" cy="${y + 2.4 * s}" rx="${4 * s}" ry="${3 * s}" fill="#fff" opacity=".18"/>
        ${star ? twinkle(cx - 1.4 * s, y - 2 * s, 3.4 * s, '#fff') : `<circle cx="${cx - 1.9 * s}" cy="${y - 2.6 * s}" r="${2.3 * s}" fill="#fff"/>`}
        <circle cx="${cx + 2 * s}" cy="${y + 2.4 * s}" r="${1.1 * s}" fill="#fff"/>`;
      const arc = (cx, down = false) => `<path d="M${cx - 5 * s},${y + (down ? -1 : 2) * s}Q${cx},${y + (down ? 4 : -5) * s} ${cx + 5 * s},${y + (down ? -1 : 2) * s}" stroke="${iris}" stroke-width="${2.8 * s}" fill="none" stroke-linecap="round"/>`;
      if (eyes === 'sparkle' || eyes === 'brave' || eyes === 'star') out.push(bigEye(x - ex, eyes === 'star'), bigEye(x + ex, eyes === 'star'));
      else if (eyes === 'wink') out.push(bigEye(x - ex), arc(x + ex));
      else if (eyes === 'happy') out.push(arc(x - ex), arc(x + ex));
      else if (eyes === 'old') out.push(arc(x - ex, true), arc(x + ex, true));
      else if (eyes === 'cool') [x - ex, x + ex].forEach((cx) => out.push(`<path d="M${cx - 5.5 * s},${y - 0.5 * s}L${cx + 5.5 * s},${y - 0.5 * s}A${5.5 * s},${5.5 * s} 0 0 1 ${cx - 5.5 * s},${y - 0.5 * s}Z" fill="${iris}"/><circle cx="${cx + 1.6 * s}" cy="${y + 1.6 * s}" r="${1.3 * s}" fill="#fff"/>`));
      else if (eyes === 'ninja') [x - ex, x + ex].forEach((cx) => out.push(`<ellipse cx="${cx}" cy="${y}" rx="${4.2 * s}" ry="${4.6 * s}" fill="${iris}"/><circle cx="${cx - 1.3 * s}" cy="${y - 1.6 * s}" r="${1.5 * s}" fill="#fff"/>`));
      else if (eyes === 'fierce') [x - ex, x + ex].forEach((cx, i) => out.push(`<path d="M${cx - 6.5 * s},${y + 1 * s}Q${cx},${y - 7.5 * s} ${cx + 6.5 * s},${y + 1 * s}Q${cx},${y + 5.5 * s} ${cx - 6.5 * s},${y + 1 * s}Z" fill="#ffd43b" stroke="#2b2140" stroke-width="${1.6 * s}"/><ellipse cx="${cx}" cy="${y}" rx="${1.6 * s}" ry="${4 * s}" fill="#2b2140"/><circle cx="${cx - 2.6 * s}" cy="${y - 1.8 * s}" r="${1.2 * s}" fill="#fff"/>`));
      if (brows || eyes === 'brave' || eyes === 'fierce') out.push(`<path d="M${x - ex - 6 * s},${y - 10 * s}L${x - ex + 4 * s},${y - 7.5 * s}M${x + ex + 6 * s},${y - 10 * s}L${x + ex - 4 * s},${y - 7.5 * s}" stroke="${iris}" stroke-width="${2.6 * s}" stroke-linecap="round"/>`);
      if (blush) out.push(`<ellipse cx="${x - ex - 6.5 * s}" cy="${y + 7 * s}" rx="${4.6 * s}" ry="${2.6 * s}" fill="#ff6b9d" opacity=".5"/><ellipse cx="${x + ex + 6.5 * s}" cy="${y + 7 * s}" rx="${4.6 * s}" ry="${2.6 * s}" fill="#ff6b9d" opacity=".5"/>`);
      const my = y + 9 * s;
      if (mouth === 'smile') out.push(`<path d="M${x - 4 * s},${my - 1 * s}Q${x},${my + 4 * s} ${x + 4 * s},${my - 1 * s}" stroke="#2b2140" stroke-width="${2.2 * s}" fill="none" stroke-linecap="round"/>`);
      else if (mouth === 'open') out.push(`<path d="M${x - 5 * s},${my - 1.5 * s}Q${x},${my - 0.5 * s} ${x + 5 * s},${my - 1.5 * s}Q${x + 4.5 * s},${my + 6 * s} ${x},${my + 6 * s}Q${x - 4.5 * s},${my + 6 * s} ${x - 5 * s},${my - 1.5 * s}Z" fill="#c92a4a"/><ellipse cx="${x}" cy="${my + 4 * s}" rx="${2.6 * s}" ry="${1.6 * s}" fill="#ff8fab"/>`);
      else if (mouth === 'cat') out.push(`<path d="M${x - 5 * s},${my}Q${x - 2.5 * s},${my + 3.5 * s} ${x},${my}Q${x + 2.5 * s},${my + 3.5 * s} ${x + 5 * s},${my}" stroke="#2b2140" stroke-width="${2 * s}" fill="none" stroke-linecap="round"/>`);
      else if (mouth === 'grin') out.push(`<path d="M${x - 6 * s},${my - 1.5 * s}L${x + 6 * s},${my - 1.5 * s}Q${x + 5 * s},${my + 5 * s} ${x},${my + 5 * s}Q${x - 5 * s},${my + 5 * s} ${x - 6 * s},${my - 1.5 * s}Z" fill="#fff" stroke="#2b2140" stroke-width="${1.8 * s}"/><path d="M${x + 2 * s},${my - 1.5 * s}L${x + 3.5 * s},${my + 2.5 * s}L${x + 5 * s},${my - 1.5 * s}" fill="#fff" stroke="#2b2140" stroke-width="${1.2 * s}"/>`);
      else if (mouth === 'o') out.push(`<ellipse cx="${x}" cy="${my + 1 * s}" rx="${2.6 * s}" ry="${3.2 * s}" fill="#c92a4a"/>`);
      return out.join('');
    }
    const shine = (x, y, w, h, r = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#fff" opacity=".5"/>`;
    const gloss = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".55"/>`;

    // ---------- キャラクター ----------
    const C = {
      pencil: () => `
        <path d="M60,9 C60,1 52,-1 48,3 C52,4 56,6 58,10Z M60,9 C61,0 70,-1 73,4 C68,4 64,6 61,10Z" fill="#40c057"/>
        <rect x="40" y="10" width="40" height="16" rx="7" fill="${lg('er', [[0, '#ffd6e7'], [1, '#f783ac']])}"/>
        <rect x="39" y="23" width="42" height="11" rx="3" fill="${lg('bd', [[0, '#f8f9fa'], [0.5, '#ced4da'], [1, '#adb5bd']], 1, 0)}" stroke="#9aa3ad"/>
        <rect x="40" y="31" width="40" height="55" rx="6" fill="${lg('bo', [[0, '#ffec99'], [0.5, '#fcc419'], [1, '#f59f00']], 1, 0)}" stroke="#e8a200" stroke-width="2"/>
        <path d="M53.3,33V84M66.6,33V84" stroke="#000" stroke-opacity=".07" stroke-width="2"/>
        <polygon points="40,85 80,85 60,111" fill="${lg('wd', [[0, '#ffe8cc'], [1, '#e8b57a']])}"/>
        <polygon points="53,101 67,101 60,111" fill="#3b3b4f"/>
        ${shine(44, 35, 5, 44)}${face(60, 56, { mouth: 'open' })}`,
      eraser: () => `
        <rect x="22" y="30" width="76" height="72" rx="15" fill="${lg('wh', [[0, '#ffffff'], [1, '#e9ecef']])}" stroke="#ced4da" stroke-width="2"/>
        <path d="M22,62H98V88Q98,102 84,102H36Q22,102 22,88Z" fill="${lg('sl', [[0, '#74c0fc'], [1, '#1c7ed6']])}"/>
        <rect x="22" y="72" width="76" height="7" fill="#fff" opacity=".9"/>
        ${twinkle(84, 92, 5, '#fff')}${gloss(36, 40, 9, 5)}
        <circle cx="16" cy="104" r="2.5" fill="#dee2e6"/><circle cx="104" cy="106" r="2" fill="#dee2e6"/>
        ${face(60, 47, { mouth: 'cat' })}`,
      sticky: () => `
        <g transform="rotate(10 60 60)"><rect x="26" y="26" width="66" height="66" rx="5" fill="#ffa8c5"/></g>
        <g transform="rotate(-14 60 60)"><rect x="26" y="26" width="66" height="66" rx="5" fill="#99e9f2"/></g>
        <g transform="rotate(-5 60 60)">
          <path d="M24,28Q24,22 30,22H90Q96,22 96,28V78L78,98H30Q24,98 24,92Z" fill="${lg('nt', [[0, '#fff9db'], [1, '#ffe066']])}" stroke="#f2c94c" stroke-width="2"/>
          <path d="M96,78H82Q78,78 78,82V98Z" fill="#f2c94c"/>
          ${face(60, 58, { eyes: 'wink', mouth: 'open' })}
          <path d="M28,24L38,16L40,28ZM48,22L38,16L40,28Z" fill="#f06595"/><circle cx="39" cy="22" r="3.5" fill="#d6336c"/>
        </g>`,
      clip: () => `
        <rect x="30" y="28" width="60" height="80" rx="30" fill="${lg('mt', [[0, '#e7f5ff'], [0.55, '#a5d8ff'], [1, '#4dabf7']], 1, 1)}" stroke="#339af0" stroke-width="2.5"/>
        <path d="M46,98V48A14,14 0 0 1 74,48V92" stroke="#fff" stroke-width="4" fill="none" opacity=".55" stroke-linecap="round"/>
        <path d="M28,44A32,28 0 0 1 92,44L96,48H24Z" fill="${lg('hm', [[0, '#8ce99a'], [1, '#2f9e44']])}" stroke="#2b8a3e" stroke-width="2"/>
        ${twinkle(60, 32, 6, '#ffd43b')}
        ${face(60, 68, { eyes: 'brave', mouth: 'smile' })}`,
      glue: () => `
        <path d="M20,96C16,70 30,42 60,40C90,42 104,70 100,96C100,104 90,106 82,103C76,110 66,104 60,106C54,110 44,104 38,106C28,108 20,105 20,96Z" fill="${lg('sm', [[0, '#c3fae8'], [0.6, '#63e6be'], [1, '#20c997']])}" stroke="#12b886" stroke-width="2"/>
        <ellipse cx="30" cy="108" rx="5" ry="3" fill="#63e6be"/>
        ${gloss(38, 60, 9, 5)}<circle cx="50" cy="54" r="2.5" fill="#fff" opacity=".7"/>
        <g transform="rotate(-12 60 32)"><rect x="46" y="16" width="28" height="22" rx="6" fill="${lg('cp', [[0, '#ffc078'], [1, '#fd7e14']])}"/><rect x="44" y="34" width="32" height="7" rx="3" fill="#e8590c"/>${shine(50, 19, 4, 14, 2)}</g>
        ${face(60, 74, { mouth: 'open' })}`,
      pin: () => `
        <polygon points="56,80 64,80 60,113" fill="${lg('nd', [[0, '#f1f3f5'], [1, '#868e96']], 1, 0)}"/>
        <ellipse cx="60" cy="80" rx="35" ry="9" fill="${lg('rm', [[0, '#ff6b6b'], [1, '#a61e1e']])}"/>
        <ellipse cx="60" cy="56" rx="30" ry="28" fill="${rg('dm', [[0, '#ffa8a8'], [0.5, '#f03e3e'], [1, '#c92a2a']])}"/>
        <path d="M30,48H90V64H30Z" fill="#343a40"/><path d="M88,52L110,44L106,58ZM88,60L108,66L100,72Z" fill="#343a40"/>
        <rect x="37" y="50.5" width="46" height="11" rx="5.5" fill="#f8f9fa"/>
        ${gloss(46, 38, 8, 4)}
        ${face(60, 56, { eyes: 'ninja', mouth: 'none', blush: false })}
        <ellipse cx="42" cy="72" rx="4" ry="2.2" fill="#ffc9c9" opacity=".8"/><ellipse cx="78" cy="72" rx="4" ry="2.2" fill="#ffc9c9" opacity=".8"/>`,
      band: () => {
        const cp = clip('bl', '<circle cx="60" cy="62" r="38"/>');
        return `<circle cx="60" cy="62" r="38" fill="${rg('bb', [[0, '#ffe8cc'], [0.6, '#ffa94d'], [1, '#f76707']])}"/>
        <g clip-path="${cp}" fill="none" stroke-width="5" opacity=".9">
          <ellipse cx="60" cy="62" rx="40" ry="12" transform="rotate(22 60 62)" stroke="#74c0fc"/>
          <ellipse cx="60" cy="62" rx="40" ry="10" transform="rotate(-38 60 62)" stroke="#ff8787"/>
          <ellipse cx="60" cy="62" rx="40" ry="9" transform="rotate(78 60 62)" stroke="#8ce99a"/>
          <ellipse cx="60" cy="62" rx="40" ry="14" transform="rotate(-5 60 62)" stroke="#ffe066"/></g>
        ${gloss(44, 40, 9, 5)}
        <path d="M24,84Q60,104 96,84L96,92Q60,112 24,92Z" fill="#fa5252"/><path d="M88,92L108,104L98,110L82,98Z" fill="#e03131"/>
        ${face(60, 58, { eyes: 'brave', mouth: 'grin' })}`;
      },
      weight: () => `
        <circle cx="60" cy="40" r="9" fill="none" stroke="#6d4c41" stroke-width="5"/>
        <rect x="46" y="44" width="28" height="18" rx="6" fill="${lg('kn', [[0, '#a1887f'], [1, '#6d4c41']])}"/>
        <rect x="16" y="58" width="88" height="46" rx="12" fill="${lg('bz', [[0, '#a1887f'], [0.5, '#795548'], [1, '#4e342e']])}" stroke="#3e2723" stroke-width="2"/>
        ${shine(22, 62, 30, 4, 2)}
        ${face(60, 74, { eyes: 'old', mouth: 'none' })}
        <path d="M38,66Q48,58 56,66M64,66Q72,58 82,66" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M44,86Q52,80 60,85Q68,80 76,86Q72,92 60,90Q48,92 44,86Z" fill="#fff"/>
        <path d="M50,90Q60,112 70,90Q66,104 60,108Q54,104 50,90Z" fill="#f1f3f5"/>`,
      sharp: () => `
        <polygon points="48,92 72,92 60,108" fill="${lg('tp', [[0, '#f1f3f5'], [1, '#868e96']], 1, 0)}"/><path d="M60,104V114" stroke="#343a40" stroke-width="2.5" stroke-linecap="round"/>
        <rect x="42" y="74" width="36" height="20" rx="5" fill="#343a40"/><path d="M44,79H76M44,84H76M44,89H76" stroke="#495057" stroke-width="2"/>
        <rect x="42" y="22" width="36" height="56" rx="8" fill="${lg('sp', [[0, '#a5d8ff'], [0.5, '#339af0'], [1, '#1971c2']], 1, 0)}" stroke="#1864ab" stroke-width="2"/>
        <path d="M60,26V72" stroke="#fff" stroke-width="3" opacity=".35"/><rect x="74" y="24" width="7" height="32" rx="3.5" fill="#ced4da" stroke="#adb5bd"/>
        <path d="M40,28A20,17 0 0 1 80,28Z" fill="${lg('hl', [[0, '#f8f9fa'], [1, '#adb5bd']])}" stroke="#868e96" stroke-width="2"/>
        <path d="M60,12C62,0 80,-2 92,6C82,6 74,12 70,22C68,16 64,13 60,12Z" fill="#fa5252"/><path d="M62,13C66,6 76,5 84,9" stroke="#ffa8a8" stroke-width="2" fill="none"/>
        ${shine(46, 32, 4, 36, 2)}${face(60, 50, { eyes: 'brave', mouth: 'smile', s: 0.95 })}`,
      ruler: () => `
        <path d="M60,12V-2" stroke="#868e96" stroke-width="2"/>
        <path d="M76,10L102,17L76,24Z" fill="#ffd43b" stroke="#f59f00" stroke-width="1.5"/>
        <rect x="42" y="10" width="36" height="100" rx="5" fill="${lg('rl', [[0, '#e3fafc'], [0.5, '#99e9f2'], [1, '#3bc9db']], 1, 0)}" stroke="#15aabf" stroke-width="2"/>
        ${Array.from({ length: 16 }, (_, i) => `<path d="M42,${16 + i * 6}H${i % 2 ? 48 : 53}" stroke="#0c8599" stroke-width="1.6"/>`).join('')}
        ${shine(68, 14, 4, 90, 2)}${face(62, 52, { eyes: 'brave', mouth: 'open', s: 0.88 })}`,
      note: () => `
        <rect x="92" y="20" width="7" height="86" rx="2" fill="#f8f9fa" stroke="#dee2e6"/>
        <rect x="24" y="16" width="72" height="92" rx="8" fill="${lg('nb', [[0, '#8ce99a'], [1, '#2f9e44']], 1, 1)}" stroke="#2b8a3e" stroke-width="2"/>
        ${[26, 38, 50, 62, 74, 86, 98].map((y) => `<ellipse cx="24" cy="${y}" rx="6" ry="3" fill="none" stroke="#adb5bd" stroke-width="3"/>`).join('')}
        <rect x="38" y="32" width="50" height="42" rx="7" fill="#fff" stroke="#d3f9d8" stroke-width="2"/>
        <path d="M63,84L75,88V96Q75,104 63,108Q51,104 51,96V88Z" fill="#ffd43b" stroke="#f59f00" stroke-width="1.5"/>
        ${face(63, 52, { mouth: 'smile', s: 0.95 })}`,
      board: () => `
        <rect x="16" y="12" width="88" height="98" rx="11" fill="${lg('pb', [[0, '#e5dbff'], [0.5, '#b197fc'], [1, '#7950f2']], 1, 1)}" stroke="#6741d9" stroke-width="2.5"/>
        <path d="M22,18H56L22,62Z" fill="#fff" opacity=".35"/>
        ${twinkle(30, 96, 4, '#fff')}${twinkle(92, 26, 5, '#fff')}${twinkle(88, 94, 3, '#fff')}${heart(28, 80, 1, '#fff')}
        ${face(60, 62, { eyes: 'cool', mouth: 'smile' })}`,
      marker: () => `
        <path d="M94,26Q112,62 94,100" stroke="#a0522d" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M94,26V100" stroke="#f1f3f5" stroke-width="1.5"/>
        <ellipse cx="60" cy="70" rx="34" ry="40" fill="#f06595" opacity=".22"/>
        <rect x="36" y="36" width="48" height="70" rx="13" fill="${lg('mk', [[0, '#ffdeeb'], [0.5, '#f06595'], [1, '#d6336c']], 1, 0)}" stroke="#c2255c" stroke-width="2"/>
        <rect x="34" y="12" width="52" height="30" rx="11" fill="${lg('mc', [[0, '#fff3bf'], [1, '#fcc419']])}" stroke="#f59f00" stroke-width="2"/>
        <rect x="78" y="14" width="7" height="24" rx="3.5" fill="#f59f00"/>
        ${shine(42, 44, 5, 52, 2.5)}${face(60, 68, { eyes: 'wink', mouth: 'open' })}`,
      tape: () => `
        <path d="M96,70L112,98L102,104L88,78Z" fill="#fff3bf" opacity=".95" stroke="#f2c94c"/>
        <circle cx="60" cy="62" r="42" fill="${rg('tr', [[0, '#fffbe6'], [0.7, '#ffe8a1'], [1, '#f2c94c']], 0.5, 0.5, 0.6)}" stroke="#e0a800" stroke-width="3"/>
        <circle cx="60" cy="62" r="34" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>
        <circle cx="60" cy="44" r="12" fill="#f8f9fa" stroke="#e9c46a" stroke-width="3"/>
        <path d="M20,66H100V82H20Z" fill="#5f3dc4"/><path d="M22,70L4,62L8,76ZM22,76L6,86L14,88Z" fill="#5f3dc4"/>
        <rect x="34" y="68" width="52" height="11" rx="5.5" fill="#f8f9fa"/>
        ${face(60, 73.5, { eyes: 'ninja', mouth: 'none', blush: false })}
        <ellipse cx="38" cy="92" rx="4" ry="2.2" fill="#ff8fab" opacity=".6"/><ellipse cx="82" cy="92" rx="4" ry="2.2" fill="#ff8fab" opacity=".6"/>`,
      protractor: () => `
        <path d="M12,102A48,48 0 0 1 108,102Z" fill="${lg('pt', [[0, '#fff4e6'], [0.6, '#ffc078'], [1, '#ff922b']])}" opacity=".95" stroke="#f76707" stroke-width="2.5"/>
        <path d="M44,102A16,16 0 0 1 76,102Z" fill="#fff" opacity=".85"/>
        ${Array.from({ length: 11 }, (_, i) => { const a = Math.PI * (i + 1) / 12; return `<path d="M${60 - Math.cos(a) * 48},${102 - Math.sin(a) * 48}L${60 - Math.cos(a) * 41},${102 - Math.sin(a) * 41}" stroke="#d9480f" stroke-width="1.8"/>`; }).join('')}
        <path d="M38,58Q50,40 54,4Q66,30 84,58Z" fill="${lg('wz', [[0, '#9775fa'], [1, '#5f3dc4']])}"/>
        <ellipse cx="61" cy="58" rx="31" ry="6" fill="#5f3dc4"/>
        ${twinkle(60, 36, 4, '#ffd43b')}<path d="M68,24A5,5 0 1 0 72,32A4,4 0 1 1 68,24Z" fill="#ffd43b"/>
        ${face(60, 80, { mouth: 'smile' })}`,
      stapler: () => `
        <rect x="12" y="88" width="96" height="16" rx="7" fill="#343a40"/>
        <path d="M14,86V72Q14,58 28,56L100,48Q110,47 110,58V72Q110,82 100,82L24,90Z" fill="${lg('st', [[0, '#ff8787'], [1, '#c92a2a']])}" stroke="#a61e1e" stroke-width="2"/>
        <circle cx="22" cy="84" r="5" fill="#495057"/>
        <path d="M26,60C14,30 62,14 100,30C84,30 68,36 58,50C54,42 42,44 26,60Z" fill="#212529"/><path d="M40,40C54,28 74,24 90,28" stroke="#495057" stroke-width="3" fill="none"/>
        <rect x="86" y="70" width="12" height="6" rx="2" fill="#ffe8cc" transform="rotate(-20 92 73)"/>
        ${face(66, 68, { eyes: 'brave', mouth: 'grin' })}`,
      compass: () => `
        <g opacity=".75"><circle cx="60" cy="72" r="46" fill="none" stroke="#b197fc" stroke-width="2" stroke-dasharray="4 4"/><circle cx="60" cy="72" r="38" fill="none" stroke="#d0bfff" stroke-width="1.5"/>
        <polygon points="60,36 69,84 27,55 93,55 51,84" fill="none" stroke="#d0bfff" stroke-width="1.5"/></g>
        <path d="M58,50L34,110M62,50L86,110" stroke="${lg('lg', [[0, '#e9ecef'], [1, '#868e96']], 1, 0)}" stroke-width="8" stroke-linecap="round"/>
        <polygon points="82,100 92,100 87,114" fill="#fcc419"/>
        <circle cx="60" cy="40" r="26" fill="${rg('cm', [[0, '#f3f0ff'], [0.6, '#d0bfff'], [1, '#9775fa']])}" stroke="#7048e8" stroke-width="2.5"/>
        <path d="M44,22Q56,0 74,2Q66,12 72,22Z" fill="${lg('ch', [[0, '#9775fa'], [1, '#5f3dc4']])}"/>${twinkle(64, 12, 3.5, '#ffd43b')}
        ${gloss(48, 30, 6, 3.5)}${face(60, 42, { mouth: 'smile', s: 0.95 })}`,
      fountain: () => `
        <path d="M30,40Q16,92 28,110H92Q104,92 90,40Z" fill="${lg('cr', [[0, '#ff8787'], [1, '#c92a2a']])}"/>
        <path d="M46,84H74L60,113Z" fill="${lg('nb2', [[0, '#ffe066'], [1, '#f59f00']], 1, 0)}" stroke="#e67700" stroke-width="1.5"/><path d="M60,95V110" stroke="#5c3d00" stroke-width="1.5"/><circle cx="60" cy="94" r="2" fill="#5c3d00"/>
        <rect x="41" y="16" width="38" height="72" rx="15" fill="${lg('fp', [[0, '#748ffc'], [0.5, '#364fc7'], [1, '#1c2a6b']], 1, 0)}" stroke="#1b2a6b" stroke-width="2"/>
        <rect x="41" y="64" width="38" height="5" fill="#fcc419"/><rect x="41" y="24" width="38" height="4" fill="#fcc419"/>
        <path d="M60,16C56,4 68,-2 78,2C70,4 66,10 64,16Z" fill="#4dabf7"/>
        ${shine(46, 30, 5, 30, 2.5)}${face(60, 46, { eyes: 'brave', mouth: 'smile', iris: '#1b1b3a' })}
        ${twinkle(96, 30, 5, '#fff3bf')}`,
      globe: () => {
        const cp = clip('gl', '<circle cx="60" cy="56" r="38"/>');
        return `<path d="M24,64A38,38 0 0 0 92,92" stroke="#f59f00" stroke-width="6" fill="none" stroke-linecap="round"/>
        <rect x="56" y="94" width="8" height="12" fill="#e67700"/><ellipse cx="60" cy="108" rx="26" ry="6" fill="${lg('gb', [[0, '#ffe066'], [1, '#e67700']])}"/>
        <circle cx="60" cy="56" r="38" fill="${rg('oc', [[0, '#d0ebff'], [0.5, '#4dabf7'], [1, '#1864ab']])}"/>
        <g clip-path="${cp}" fill="#69db7c" stroke="#2f9e44" stroke-width="1.5">
          <path d="M22,40Q34,26 48,32Q50,44 40,50Q30,52 22,48Z"/><path d="M70,22Q90,22 96,40Q86,46 78,40Q68,34 70,22Z"/><path d="M74,74Q92,70 98,82Q88,96 76,90Z"/><path d="M28,78Q38,74 42,84Q36,92 26,88Z"/></g>
        <path d="M30,34Q40,28 52,32" stroke="#fff" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>
        ${face(60, 60, { eyes: 'brave', mouth: 'open' })}`;
      },
      dict: () => `
        <rect x="92" y="20" width="10" height="84" rx="2" fill="#fff8e1" stroke="#e9d8a6"/>${[30, 40, 50, 60, 70, 80, 90].map((y) => `<path d="M94,${y}H101" stroke="#e9d8a6"/>`).join('')}
        <rect x="20" y="14" width="78" height="94" rx="7" fill="${lg('bk', [[0, '#ff6b6b'], [0.5, '#e03131'], [1, '#a61e1e']], 1, 0)}" stroke="#7d1a1a" stroke-width="2"/>
        <rect x="20" y="14" width="12" height="94" rx="5" fill="#a61e1e"/>
        <rect x="40" y="24" width="50" height="8" rx="2" fill="#fcc419"/><rect x="40" y="96" width="50" height="4" rx="2" fill="#fcc419"/>
        ${face(64, 52, { eyes: 'happy', mouth: 'none' })}
        <circle cx="52.5" cy="52" r="8" fill="#fff" fill-opacity=".25" stroke="#343a40" stroke-width="2.5"/><circle cx="75.5" cy="52" r="8" fill="#fff" fill-opacity=".25" stroke="#343a40" stroke-width="2.5"/><path d="M60.5,52H67.5" stroke="#343a40" stroke-width="2.5"/>
        <path d="M50,64Q64,58 78,64Q78,82 64,92Q50,82 50,64Z" fill="#fff"/><path d="M56,68Q64,64 72,68" stroke="#dee2e6" stroke-width="1.5" fill="none"/>`,
      leaf: () => `
        <ellipse cx="60" cy="12" rx="19" ry="5" fill="none" stroke="#fcc419" stroke-width="4"/><ellipse cx="60" cy="12" rx="19" ry="5" fill="none" stroke="#fff3bf" stroke-width="1.5"/>
        <path d="M34,50C10,30 0,56 6,70C10,62 16,62 18,66C14,74 18,84 26,82C24,90 32,92 36,86Z" fill="#fff" stroke="#a5d8ff" stroke-width="2"/>
        <path d="M86,50C110,30 120,56 114,70C110,62 104,62 102,66C106,74 102,84 94,82C96,90 88,92 84,86Z" fill="#fff" stroke="#a5d8ff" stroke-width="2"/>
        <rect x="30" y="22" width="60" height="84" rx="7" fill="${lg('pp', [[0, '#ffffff'], [1, '#f1f3f5']])}" stroke="#d0ebff" stroke-width="2"/>
        ${[34, 50, 66, 82, 98].map((y) => `<circle cx="38" cy="${y}" r="3" fill="#e7f5ff" stroke="#a5d8ff" stroke-width="1.5"/>`).join('')}
        <path d="M46,24V104" stroke="#ff8787" stroke-width="1.5"/>${[40, 76, 85, 94].map((y) => `<path d="M48,${y}H86" stroke="#a5d8ff" stroke-width="1.2"/>`).join('')}
        ${face(66, 56, { mouth: 'smile', s: 0.9 })}${heart(82, 98, 1.1, '#ff8fab')}`,
      gold: () => `
        <path d="M26,44Q12,100 28,112H92Q108,100 94,44Z" fill="${lg('kc', [[0, '#ff6b6b'], [1, '#a61e1e']])}"/>
        <path d="M26,104Q60,116 94,104L94,112Q60,122 26,112Z" fill="#fff"/>${[34, 48, 62, 76, 88].map((x) => `<circle cx="${x}" cy="110" r="1.6" fill="#212529"/>`).join('')}
        <polygon points="40,86 80,86 60,112" fill="${lg('gw', [[0, '#fff3bf'], [1, '#f59f00']])}"/><polygon points="53,102 67,102 60,112" fill="#b8860b"/>
        <rect x="40" y="30" width="40" height="58" rx="6" fill="${lg('gd', [[0, '#fff3bf'], [0.3, '#ffd43b'], [0.6, '#f08c00'], [1, '#ffe066']], 1, 0)}" stroke="#e67700" stroke-width="2"/>
        <path d="M53.3,32V86M66.6,32V86" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
        <path d="M60,72L66,79L60,86L54,79Z" fill="#66d9e8" stroke="#1098ad" stroke-width="1.5"/>
        <path d="M36,32L40,8L52,22L60,2L68,22L80,8L84,32Z" fill="${lg('cw', [[0, '#fff3bf'], [0.5, '#fcc419'], [1, '#f08c00']])}" stroke="#e67700" stroke-width="2"/>
        <circle cx="60" cy="22" r="3.5" fill="#fa5252"/><circle cx="46" cy="25" r="2.6" fill="#4dabf7"/><circle cx="74" cy="25" r="2.6" fill="#51cf66"/>
        ${shine(44, 34, 5, 40, 2.5)}${face(60, 54, { eyes: 'star', mouth: 'open' })}`,
      chalk: () => `
        <path d="M34,58C10,34 2,62 8,80C14,72 20,74 22,80C20,88 28,92 34,86Z" fill="${lg('dw', [[0, '#3a7d6b'], [1, '#1f4e43']])}" stroke="#e9ecef" stroke-width="1.5" stroke-dasharray="3 3"/>
        <path d="M86,58C110,34 118,62 112,80C106,72 100,74 98,80C100,88 92,92 86,86Z" fill="${lg('dw2', [[0, '#3a7d6b'], [1, '#1f4e43']])}" stroke="#e9ecef" stroke-width="1.5" stroke-dasharray="3 3"/>
        <path d="M88,96Q112,100 108,82Q104,74 98,80" stroke="#2f5d50" stroke-width="7" fill="none" stroke-linecap="round"/>
        <ellipse cx="60" cy="70" rx="34" ry="34" fill="${rg('db', [[0, '#5aa591'], [0.6, '#2f6d5d'], [1, '#18413a']])}" stroke="#12352c" stroke-width="2"/>
        <ellipse cx="60" cy="84" rx="18" ry="16" fill="#f1f3f5" opacity=".92"/><path d="M46,80H74M46,88H74M50,96H70" stroke="#ced4da" stroke-width="1.5"/>
        <rect x="34" y="22" width="9" height="24" rx="3" fill="#f8f9fa" stroke="#ced4da" transform="rotate(-24 38 34)"/><rect x="77" y="22" width="9" height="24" rx="3" fill="#fff0f6" stroke="#fcc2d7" transform="rotate(24 82 34)"/>
        <path d="M14,24l4,4m0-4l-4,4M100,18a4,4 0 1 0 0.1,0M16,100q4-6 8,0" stroke="#fff" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round"/>
        ${face(60, 62, { eyes: 'fierce', mouth: 'grin' })}`,
      scissors: () => {
        const petal = (x, y, r) => `<path d="M${x},${y}c-3,-5 -9,-3 -7,2c1,4 7,5 7,-2z" fill="#ffc9de" transform="rotate(${r} ${x} ${y})"/>`;
        return `
        <path class="cb-slash" d="M2,78Q50,-12 116,30Q56,6 2,78Z" fill="${lg('sl', [[0, '#99e9f2', 0], [0.5, '#66d9e8', 0.85], [1, '#e3fafc', 0.2]], 1, 0)}"/>
        ${petal(16, 30, 20)}${petal(104, 92, -30)}${petal(96, 14, 60)}${petal(22, 100, -10)}
        <path d="M45,64Q38,92 58,116L60,66Z" fill="${lg('bl', [[0, '#ffffff'], [0.6, '#ced4da'], [1, '#868e96']], 1, 0)}" stroke="#495057" stroke-width="1.6"/>
        <path d="M75,64Q82,92 62,116L60,66Z" fill="${lg('br', [[0, '#adb5bd'], [0.4, '#e9ecef'], [1, '#ffffff']], 1, 0)}" stroke="#495057" stroke-width="1.6"/>
        <path d="M60,68L59,113M60,68L61,113" stroke="#66d9e8" stroke-width="1.6" opacity=".9"/>
        <path d="M48,70Q44,90 56,108" stroke="#fff" stroke-width="2" fill="none" opacity=".8" stroke-linecap="round"/>
        <circle cx="43" cy="19" r="11" fill="none" stroke="${lg('r1', [[0, '#ff8787'], [1, '#c92a2a']])}" stroke-width="7"/>
        <circle cx="77" cy="19" r="11" fill="none" stroke="${lg('r2', [[0, '#ff8787'], [1, '#c92a2a']])}" stroke-width="7"/>
        <path d="M49,28L53,33M71,28L67,33" stroke="#c92a2a" stroke-width="6" stroke-linecap="round"/>
        <circle cx="60" cy="52" r="23" fill="${rg('dk', [[0, '#ffffff'], [0.55, '#dee2e6'], [1, '#868e96']])}" stroke="#868e96" stroke-width="2"/>
        <path d="M36,40Q60,28 84,40L84,47Q60,35 36,47Z" fill="#e03131"/>
        <path d="M83,41L108,32L101,42L110,49L84,47Z" fill="#e03131"/><path d="M90,40L104,36" stroke="#ff8787" stroke-width="1.5"/>
        <circle cx="60" cy="38.5" r="3.4" fill="#fff"/>
        <circle cx="60" cy="74" r="4" fill="${lg('pv', [[0, '#fff3bf'], [1, '#f59f00']])}" stroke="#e67700"/>
        ${gloss(50, 60, 5, 3)}
        ${face(60, 55, { eyes: 'brave', mouth: 'grin', s: 0.9 })}`;
      },
      case: () => `
        ${heart(18, 30, 1.2, '#ff8fab')}${heart(104, 26, 0.9, '#b197fc')}
        <rect x="12" y="40" width="96" height="62" rx="28" fill="${lg('rb', [[0, '#ffc9c9'], [0.2, '#ffe8cc'], [0.4, '#fff3bf'], [0.6, '#d3f9d8'], [0.8, '#d0ebff'], [1, '#e5dbff']], 1, 0)}" stroke="#f783ac" stroke-width="2.5"/>
        <path d="M22,50H98" stroke="#adb5bd" stroke-width="3" stroke-dasharray="3 3"/>
        <path d="M98,50Q104,54 100,62Q96,58 98,50Z" fill="#fcc419" stroke="#e67700"/>
        <path d="M42,42L46,24L53,34L60,16L67,34L74,24L78,42Z" fill="${lg('tia', [[0, '#f8f9fa'], [1, '#ced4da']])}" stroke="#adb5bd" stroke-width="1.5"/>
        <circle cx="60" cy="26" r="3.5" fill="#f06595"/><circle cx="49" cy="33" r="2.2" fill="#74c0fc"/><circle cx="71" cy="33" r="2.2" fill="#74c0fc"/>
        ${gloss(30, 58, 8, 4)}${face(60, 72, { eyes: 'star', mouth: 'smile' })}`,
    };
    // 競走馬版から連れてきた馬 (毛色で色が変わる)
    const COAT = {
      '鹿毛': ['#c9783a', '#7a3e17', '#2b1a12', '#f0d3b4'], '黒鹿毛': ['#7a4526', '#3b1f10', '#1a110c', '#d1a888'],
      '栗毛': ['#ec9a5a', '#b85a22', '#f2c27a', '#f8dcc0'], '芦毛': ['#ffffff', '#c3c9d1', '#9aa3ad', '#eef0f3'], '青鹿毛': ['#4a4a58', '#1c1c24', '#0e0e14', '#7d7d8c'],
    };
    C.horse = () => {
      const [c1, c2, mane, muz] = COAT[coat] || COAT['鹿毛'];
      const dark = coat === '青鹿毛' || coat === '黒鹿毛';
      return `
        <path d="M44,104V114M54,106V115M66,106V115M76,104V114" stroke="${c2}" stroke-width="7" stroke-linecap="round"/>
        <path d="M44,113H44.1M54,114H54.1M66,114H66.1M76,113H76.1" stroke="#3b2a20" stroke-width="7" stroke-linecap="round"/>
        <ellipse cx="60" cy="94" rx="30" ry="17" fill="${lg('hb', [[0, c1], [1, c2]])}"/>
        <path d="M88,86Q104,84 100,104Q96,96 90,96Z" fill="${mane}"/>
        <path d="M38,30L44,8L54,26Z" fill="${c1}" stroke="${c2}" stroke-width="2"/><path d="M42,26L45,14L50,25Z" fill="#ffb3c7"/>
        <path d="M82,30L76,8L66,26Z" fill="${c1}" stroke="${c2}" stroke-width="2"/><path d="M78,26L75,14L70,25Z" fill="#ffb3c7"/>
        <ellipse cx="60" cy="56" rx="29" ry="31" fill="${rg('hh', [[0, c1], [1, c2]])}"/>
        <path d="M46,30Q52,14 60,22Q66,12 74,28Q66,24 62,34Q56,26 46,30Z" fill="${mane}"/>
        ${dark ? '' : `<path d="M57,32Q60,30 63,32L62,62Q60,64 58,62Z" fill="#fff" opacity=".9"/>`}
        <ellipse cx="60" cy="74" rx="19" ry="13" fill="${muz}"/>
        <ellipse cx="53" cy="74" rx="2.4" ry="3" fill="#3b2a20" opacity=".7"/><ellipse cx="67" cy="74" rx="2.4" ry="3" fill="#3b2a20" opacity=".7"/>
        <path d="M54,81Q60,85 66,81" stroke="#3b2a20" stroke-width="2" fill="none" stroke-linecap="round"/>
        ${gloss(46, 40, 6, 3.5)}
        <path d="M66,20L74,14L76,24ZM82,18L74,14L76,24Z" fill="#ff6b9d"/><circle cx="75" cy="19" r="3" fill="#f06595"/>
        ${face(60, 52, { mouth: 'none', iris: dark ? '#0b0806' : '#2b2140' })}`;
    };
    const body = (String(id).startsWith('h:') ? C.horse : (C[id] || C.pencil))();

    // ---------- レア度の演出 (キャラの後ろ) ----------
    let back = '';
    if (rarity === 'R') back = twinkle(18, 26, 5, '#a5d8ff', 'cb-tw') + twinkle(102, 40, 4, '#a5d8ff', 'cb-tw d2');
    if (rarity === 'SR') back = `<circle cx="60" cy="62" r="56" fill="${rg('au', [[0, '#d0bfff', 0.9], [0.6, '#b197fc', 0.35], [1, '#b197fc', 0]], 0.5, 0.5, 0.5)}"/>` + twinkle(16, 24, 6, '#e5dbff', 'cb-tw') + twinkle(104, 34, 5, '#fff', 'cb-tw d2') + twinkle(100, 98, 4, '#e5dbff', 'cb-tw d3');
    if (rarity === 'SSR' || rarity === 'UR') {
      const ur = rarity === 'UR';
      const rays = Array.from({ length: 12 }, (_, i) => `<path d="M60,60L${60 + Math.cos((i * 30 - 6) * Math.PI / 180) * 90},${60 + Math.sin((i * 30 - 6) * Math.PI / 180) * 90}L${60 + Math.cos((i * 30 + 6) * Math.PI / 180) * 90},${60 + Math.sin((i * 30 + 6) * Math.PI / 180) * 90}Z" fill="${ur ? (i % 2 ? '#ffd43b' : '#ff6b6b') : (i % 2 ? '#ffe066' : '#ffa8d9')}" opacity="${ur ? 0.55 : 0.45}"/>`).join('');
      back = `<g class="cb-rays">${rays}</g><circle cx="60" cy="60" r="50" fill="${rg('ss', [[0, '#fff', 0.95], [0.5, '#fff3bf', 0.5], [1, '#fff3bf', 0]], 0.5, 0.5, 0.5)}"/>`
        + twinkle(14, 20, 7, '#fff', 'cb-tw') + twinkle(106, 28, 6, '#ffe066', 'cb-tw d2') + twinkle(104, 100, 5, '#fff', 'cb-tw d3') + twinkle(14, 98, 5, '#ffd8f0', 'cb-tw d2');
      if (ur) back += `<circle class="cb-halo" cx="60" cy="60" r="54" fill="none" stroke="${lg('hl', [[0, '#fff3bf'], [0.5, '#fab005'], [1, '#e8590c']], 1, 1)}" stroke-width="3" stroke-dasharray="6 5"/>`
        + twinkle(60, 4, 8, '#fff3bf', 'cb-tw') + twinkle(4, 60, 6, '#ffd43b', 'cb-tw d3') + twinkle(116, 64, 6, '#ffd43b', 'cb-tw d2');
    }
    defs.push(`<filter id="${u}stk" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.6" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="o"/><feDropShadow in="o" dx="0" dy="2.2" stdDeviation="1.6" flood-color="#1b1b3a" flood-opacity=".22" result="os"/><feMerge><feMergeNode in="os"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    return `<defs>${defs.join('')}</defs>${back}<ellipse cx="60" cy="113" rx="30" ry="4.5" fill="#1b1b3a" opacity=".13"/><g class="cb-body" filter="url(#${u}stk)">${body}</g>`;
  }

  window.CBArt = {
    svg(id, rarity = 'N', { label = '', cls = '', coat = '' } = {}) {
      return `<svg class="cb-svg ${cls}" viewBox="-4 -6 128 128" ${label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true"'}>${draw(id, rarity, coat)}</svg>`;
    },
  };
})();
