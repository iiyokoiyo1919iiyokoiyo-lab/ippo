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
      // 疾風剣士ハサミ丸: エメラルドの疾風をまとった刀のハサミ。燃える赤金のリング、なびく鉢巻、星の目でニカッと笑う
      scissors: () => {
        const leaf = (x, y, r, c) => `<path d="M${x},${y}c-5,-8 3,-15 10,-11c-1,7 -5,11 -10,11z" fill="${c}" stroke="#fff" stroke-width="1" transform="rotate(${r} ${x} ${y})"/>`;
        const bolt = (x, y, sc) => `<path d="M${x},${y}l${4 * sc},${-9 * sc}l${-1 * sc},${6 * sc}l${5 * sc},${-1 * sc}l${-5 * sc},${10 * sc}l${1 * sc},${-6 * sc}z" fill="#ffe066" stroke="#f08c00" stroke-width="1"/>`;
        return `
        <g class="cb-slash">
          <path d="M-2,92Q24,6 118,14Q56,18 18,78Z" fill="${lg('w1', [[0, '#96f2d7', 0.5], [0.45, '#12b886', 1], [1, '#63e6be', 0.7]], 1, 0)}"/>
          <path d="M122,34Q108,108 10,112Q72,98 108,44Z" fill="${lg('w2', [[0, '#63e6be', 0.6], [0.55, '#0ca678', 1], [1, '#96f2d7', 0.5]], 1, 0)}"/>
          <path d="M6,56L40,44M80,8L104,2M96,96L120,88M2,104L22,100" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
        </g>
        ${leaf(10, 28, 20, '#69db7c')}${leaf(104, 100, -30, '#38d9a9')}${leaf(100, 12, 60, '#8ce99a')}${leaf(16, 96, -10, '#63e6be')}${leaf(112, 62, 80, '#b2f2bb')}
        ${bolt(20, 52, 1.3)}${bolt(102, 76, 1.1)}
        <path d="M44,62Q36,92 58,117L60,64Z" fill="${lg('bl', [[0, '#ffffff'], [0.5, '#dee2e6'], [1, '#868e96']], 1, 0)}" stroke="#087f5b" stroke-width="2"/>
        <path d="M76,62Q84,92 62,117L60,64Z" fill="${lg('br', [[0, '#adb5bd'], [0.45, '#f1f3f5'], [1, '#ffffff']], 1, 0)}" stroke="#087f5b" stroke-width="2"/>
        <path d="M46.5,66Q40,92 57,112" stroke="#63e6be" stroke-width="3" fill="none" stroke-linecap="round" opacity=".95"/>
        <path d="M73.5,66Q80,92 63,112" stroke="#63e6be" stroke-width="3" fill="none" stroke-linecap="round" opacity=".95"/>
        <path d="M50,72Q46,90 56,104" stroke="#fff" stroke-width="2" fill="none" opacity=".9" stroke-linecap="round"/>
        <path d="M60,66L60,114" stroke="#20c997" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="42" cy="18" r="12.5" fill="none" stroke="#fcc419" stroke-width="10.5"/>
        <circle cx="78" cy="18" r="12.5" fill="none" stroke="#fcc419" stroke-width="10.5"/>
        <circle cx="42" cy="18" r="12.5" fill="none" stroke="${lg('r1', [[0, '#ff8787'], [0.6, '#e03131'], [1, '#a61e1e']])}" stroke-width="7"/>
        <circle cx="78" cy="18" r="12.5" fill="none" stroke="${lg('r2', [[0, '#ff8787'], [0.6, '#e03131'], [1, '#a61e1e']])}" stroke-width="7"/>
        <path d="M35,9Q40,6 46,8M71,9Q76,6 82,8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85"/>
        <path d="M48,28L53,34M72,28L67,34" stroke="#c92a2a" stroke-width="7" stroke-linecap="round"/>
        <circle cx="60" cy="52" r="25" fill="#63e6be" opacity=".35"/>
        <circle cx="60" cy="52" r="23" fill="${rg('dk', [[0, '#ffffff'], [0.55, '#e9ecef'], [1, '#adb5bd']])}" stroke="#495057" stroke-width="2"/>
        <path d="M84,40Q102,30 118,38Q108,42 112,50Q100,44 86,48Z" fill="#e03131"/><path d="M86,44Q100,40 112,48" stroke="#ff8787" stroke-width="1.6" fill="none"/>
        <path d="M84,46Q98,52 106,64Q96,60 86,56Z" fill="#c92a2a"/>
        <path d="M35,40Q60,27 85,40L85,48Q60,35 35,48Z" fill="#e03131" stroke="#a61e1e" stroke-width="1"/>
        <path d="M37,42Q60,31 83,42" stroke="#ff8787" stroke-width="1.4" fill="none"/>
        <path d="M53,32L67,32L65,43L55,43Z" fill="${lg('pl', [[0, '#e9ecef'], [1, '#868e96']])}" stroke="#495057" stroke-width="1"/>
        <path d="M60,33L63,37.5L60,42L57,37.5Z" fill="#20c997" stroke="#087f5b" stroke-width="1"/><circle cx="59" cy="36" r="0.9" fill="#fff"/>
        <circle cx="60" cy="74" r="4.5" fill="${lg('pv', [[0, '#fff3bf'], [1, '#f59f00']])}" stroke="#e67700"/><circle cx="58.6" cy="72.6" r="1.2" fill="#fff"/>
        ${gloss(49, 60, 5, 3)}
        ${face(60, 57, { eyes: 'star', brows: true, mouth: 'grin', s: 0.9, iris: '#0b7285' })}
        ${twinkle(98, 24, 7, '#ffe066')}${twinkle(16, 76, 5, '#fff')}${twinkle(110, 108, 4, '#c3fae8')}`;
      },
      // 星キャンディー (MR): 星の形のキャンディー。両はしにセロハンのつつみ、虹のうずまき、星の目、流れ星のステッキ
      star: () => {
        const pts = Array.from({ length: 10 }, (_, i) => { const a = (-90 + i * 36) * Math.PI / 180, r = i % 2 ? 21 : 41; return `${(60 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`; }).join(' ');
        const swirl = Array.from({ length: 5 }, (_, i) => `<path d="M60,64Q${60 + Math.cos((i * 72 - 60) * Math.PI / 180) * 30},${64 + Math.sin((i * 72 - 60) * Math.PI / 180) * 30} ${60 + Math.cos((i * 72 - 18) * Math.PI / 180) * 40},${64 + Math.sin((i * 72 - 18) * Math.PI / 180) * 40}" stroke="${['#ff8fd8', '#ffe066', '#8ce99a', '#74c0fc', '#d0a8ff'][i]}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>`).join('');
        return `
        <path d="M30,66L4,52Q0,66 6,82Z" fill="${lg('wl', [[0, '#ffd6f5', 0.95], [1, '#c5b3ff', 0.75]], 1, 0)}" stroke="#ffffff" stroke-width="2"/>
        <path d="M8,58L24,66M8,74L24,68" stroke="#fff" stroke-width="1.6" opacity=".9"/>
        <path d="M90,66L116,52Q120,66 114,82Z" fill="${lg('wr', [[0, '#c5f6fa', 0.75], [1, '#ffd6f5', 0.95]], 1, 0)}" stroke="#ffffff" stroke-width="2"/>
        <path d="M112,58L96,66M112,74L96,68" stroke="#fff" stroke-width="1.6" opacity=".9"/>
        <polygon points="${pts}" fill="${rg('sc', [[0, '#fffbe6'], [0.45, '#ffd8f3'], [0.8, '#ffa8e2'], [1, '#e599f7']], 0.45, 0.4, 0.75)}" stroke="#ffffff" stroke-width="7" stroke-linejoin="round"/>
        <polygon points="${pts}" fill="none" stroke="${lg('se', [[0, '#ff6bd6'], [0.33, '#ffd43b'], [0.66, '#63e6be'], [1, '#845ef7']], 1, 1)}" stroke-width="2.6" stroke-linejoin="round"/>
        <g clip-path="${clip('sx', `<polygon points="${pts}"/>`)}">${swirl}<circle cx="60" cy="64" r="11" fill="#fff" opacity=".55"/></g>
        ${gloss(44, 40, 7, 4)}<circle cx="78" cy="50" r="2.2" fill="#fff"/><circle cx="40" cy="82" r="1.6" fill="#fff"/>
        <path d="M84,96L104,72" stroke="${lg('wd', [[0, '#ffe066'], [1, '#f59f00']])}" stroke-width="4" stroke-linecap="round"/>
        ${twinkle(106, 69, 9, '#ffe066')}${twinkle(106, 69, 4, '#fff')}
        <path d="M100,40Q108,32 116,22" stroke="#fff" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round" fill="none"/>
        ${face(60, 62, { eyes: 'star', mouth: 'open', s: 0.95, iris: '#4c2a85' })}`;
      },
      // タドコロ (SSR・おもい): 色えんぴつを包むキャンバス地のペンロール。ひもでくるっと巻いて、元気に笑う
      tadokoro: () => {
        const pen = (x, c, h) => `<rect x="${x}" y="${30 - h}" width="9" height="${h + 10}" rx="1.5" fill="${c}" stroke="#fff" stroke-width="1"/><path d="M${x},${30 - h}L${x + 4.5},${22 - h}L${x + 9},${30 - h}Z" fill="#f8e7c9"/><path d="M${x + 3},${26 - h}L${x + 4.5},${22 - h}L${x + 6},${26 - h}Z" fill="${c}"/>`;
        const drop = (x, y, s) => `<path d="M${x},${y}q${3 * s},${5 * s} 0,${7 * s}q${-3 * s},${-2 * s} 0,${-7 * s}z" fill="#b197fc" stroke="#7048e8" stroke-width=".8"/>`;
        return `
        ${pen(30, '#ff6b6b', 6)}${pen(41, '#fcc419', 12)}${pen(52, '#51cf66', 4)}${pen(63, '#339af0', 10)}${pen(74, '#cc5de8', 5)}
        <rect x="20" y="30" width="80" height="76" rx="14" fill="${lg('cv', [[0, '#f4c98b'], [0.55, '#e8a95c'], [1, '#c97d34']])}" stroke="#9c5a1c" stroke-width="2.4"/>
        <path d="M20,44Q60,52 100,44" stroke="#9c5a1c" stroke-width="2" fill="none"/>
        <path d="M26,36V100M94,36V100" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3" opacity=".75"/>
        <path d="M84,30Q112,40 104,78Q100,96 86,104" fill="none" stroke="#c97d34" stroke-width="8" stroke-linecap="round"/>
        <path d="M84,30Q112,40 104,78Q100,96 86,104" fill="none" stroke="#f4c98b" stroke-width="3" stroke-linecap="round" opacity=".8"/>
        <path d="M20,86H100" stroke="#7048e8" stroke-width="5"/>
        <path d="M60,86q-14,-12 -16,2q2,10 16,-2zM60,86q14,-12 16,2q-2,10 -16,-2z" fill="#9775fa" stroke="#5f3dc4" stroke-width="1.4"/>
        <circle cx="60" cy="86" r="4" fill="#b197fc" stroke="#5f3dc4" stroke-width="1.4"/>
        <path d="M58,90q-4,10 -10,16M62,90q4,10 10,16" stroke="#7048e8" stroke-width="3" stroke-linecap="round" fill="none"/>
        ${gloss(34, 52, 6, 3.5)}
        ${face(60, 64, { eyes: 'sparkle', mouth: 'open', s: 0.95 })}
        ${drop(10, 70, 1.3)}${drop(108, 24, 1.1)}${drop(14, 30, 0.9)}
        ${twinkle(106, 100, 5, '#ffe066')}${twinkle(8, 104, 4, '#fff')}`;
      },
      // 雷神クリりん (MR・きる): 雷の魔人。頭のてっぺん〜後頭部はつるっとハゲていて (光る)、横だけ稲妻のギザギザ髪。
      // 背中に雷太鼓の輪、えんぴつのバチ、クリップのベルト。落雷を呼ぶ
      raijin: () => {
        const drum = (a) => { const x = 60 + Math.cos(a * Math.PI / 180) * 49, y = 56 + Math.sin(a * Math.PI / 180) * 45;
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" fill="${lg('dr', [[0, '#495057'], [1, '#212529']])}" stroke="#fcc419" stroke-width="2"/><path d="M${(x - 3).toFixed(1)},${(y - 1).toFixed(1)}a3,3 0 1 1 6,0a3,3 0 0 1 -3,3" stroke="#fcc419" stroke-width="1.6" fill="none"/>`; };
        const bolt = (x, y, k, c = '#ffe066') => `<path d="M${x},${y}l${-6 * k},${12 * k}h${5 * k}l${-4 * k},${11 * k}l${11 * k},${-15 * k}h${-5 * k}l${4 * k},${-8 * k}z" fill="${c}" stroke="#f08c00" stroke-width="1.2" stroke-linejoin="round"/>`;
        const hair = lg('wh', [[0, '#ffffff'], [0.6, '#e9ecef'], [1, '#a5b4fc']]);
        return `
        <path d="M13,66A48,45 0 0 1 107,66" fill="none" stroke="#fcc419" stroke-width="3"/>
        ${[185, 215, 245, 295, 325, 355].map(drum).join('')}
        <path d="M8,106L30,86" stroke="${lg('pc', [[0, '#ffec99'], [1, '#f59f00']], 1, 0)}" stroke-width="6" stroke-linecap="round"/><path d="M30,86l5,-5l-8,1z" fill="#3b3b4f"/>
        <path d="M112,106L90,86" stroke="${lg('pc2', [[0, '#ffec99'], [1, '#f59f00']], 1, 0)}" stroke-width="6" stroke-linecap="round"/><path d="M90,86l-5,-5l8,1z" fill="#3b3b4f"/>
        <path d="M30,98Q24,114 42,115H78Q96,114 90,98Z" fill="${lg('bd', [[0, '#343a40'], [1, '#141517']])}" stroke="#fcc419" stroke-width="2"/>
        <path d="M44,98L60,112L76,98" fill="none" stroke="#fcc419" stroke-width="2.4"/>
        <path d="M32,104H88" stroke="${lg('cl', [[0, '#e9ecef'], [0.5, '#adb5bd'], [1, '#e9ecef']], 1, 0)}" stroke-width="4"/>
        <path d="M52,101h16a3,3 0 0 1 0,7h-14a2,2 0 0 1 0,-4h12" fill="none" stroke="#868e96" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M30,52L4,40L18,56L0,60L20,66L6,78L26,76L14,92L34,82Z" fill="${hair}" stroke="#748ffc" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M90,52L116,40L102,56L120,60L100,66L114,78L94,76L106,92L86,82Z" fill="${hair}" stroke="#748ffc" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M44,28Q40,8 32,4Q42,16 38,32Z M76,28Q80,8 88,4Q78,16 82,32Z" fill="${lg('hn', [[0, '#fff9db'], [1, '#f59f00']])}" stroke="#e67700" stroke-width="1.4"/>
        <ellipse cx="60" cy="60" rx="33" ry="36" fill="${rg('sk', [[0, '#bac8ff'], [0.55, '#748ffc'], [1, '#3b5bdb']], 0.45, 0.3, 0.85)}" stroke="#364fc7" stroke-width="2.2"/>
        <path d="M27,50Q24,64 32,74Q30,62 36,58Z M93,50Q96,64 88,74Q90,62 84,58Z" fill="${hair}" stroke="#748ffc" stroke-width="1.2"/>
        <ellipse cx="50" cy="34" rx="12" ry="5.5" fill="#fff" opacity=".8" transform="rotate(-20 50 34)"/>
        ${twinkle(72, 28, 6, '#fff')}
        <path d="M38,52L54,57M82,52L66,57" stroke="#141517" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M40,60Q47,55 54,60Q47,64 40,60Z M80,60Q73,55 66,60Q73,64 80,60Z" fill="#fff3bf" stroke="#141517" stroke-width="1.8"/>
        <circle cx="48" cy="60" r="2.2" fill="#f59f00"/><circle cx="72" cy="60" r="2.2" fill="#f59f00"/>
        <ellipse cx="47" cy="60" rx="9" ry="5" fill="#ffe066" opacity=".25"/><ellipse cx="73" cy="60" rx="9" ry="5" fill="#ffe066" opacity=".25"/>
        <path d="M52,74Q60,79 68,73" stroke="#141517" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M64,75l2,4l2,-5z" fill="#fff" stroke="#141517" stroke-width="1"/>
        <path d="M42,80Q50,88 60,84Q70,88 78,80Q72,96 60,94Q48,96 42,80Z" fill="${hair}" stroke="#748ffc" stroke-width="1.2"/>
        <path d="M58,46l-4,7h4l-3,6l8,-9h-4l3,-4z" fill="#ffe066" stroke="#e67700" stroke-width=".8"/>
        ${bolt(16, 0, 1)}${bolt(112, 70, 0.9)}${bolt(104, 0, 0.75, '#fff3bf')}${bolt(8, 92, 0.6, '#fff3bf')}`;
      },
      // 筆の剣士 (SSR・きる・疾風斬り): ほかのキャラより少し大きい。刀のようにかまえた大筆、金の帯、なびくハチマキ、緑の墨の斬撃
      brush: () => {
        const drop = (x, y, r) => `<path d="M${x},${y - r * 1.6} C${x + r},${y - r * 0.2} ${x + r},${y + r} ${x},${y + r} C${x - r},${y + r} ${x - r},${y - r * 0.2} ${x},${y - r * 1.6}Z" fill="#0b3d2e"/>`;
        return `<g transform="translate(60 60) scale(1.12) translate(-60 -60)">
        <path d="M4,84 C20,40 64,14 112,18" fill="none" stroke="${lg('sl1', [[0, '#e6fcf5', 0], [0.4, '#63e6be'], [0.8, '#12b886'], [1, '#e6fcf5', 0]], 1, 0)}" stroke-width="9" stroke-linecap="round" opacity=".85"/>
        <path d="M10,104 C44,92 84,66 116,36" fill="none" stroke="${lg('sl2', [[0, '#fff', 0], [0.5, '#96f2d7'], [1, '#fff', 0]], 1, 0)}" stroke-width="5" stroke-linecap="round" opacity=".9"/>
        <path d="M18,30 C30,22 42,24 50,30 C40,28 30,30 18,30Z M88,96 C98,90 108,92 114,98 C104,96 96,96 88,96Z" fill="#20c997" opacity=".7"/>
        ${drop(16, 58, 4)}${drop(104, 86, 3.4)}${drop(98, 14, 2.6)}${drop(24, 106, 2.4)}
        <g transform="rotate(-26 60 60)">
          <rect x="47" y="8" width="26" height="10" rx="5" fill="#5c3317"/><circle cx="60" cy="6" r="4.5" fill="none" stroke="#e03131" stroke-width="2.4"/>
          <rect x="43" y="16" width="34" height="52" rx="11" fill="${lg('bw', [[0, '#d9a066'], [0.5, '#a9744f'], [1, '#6b3d1f']], 1, 0)}" stroke="#4a2a12" stroke-width="2.2"/>
          <rect x="43" y="22" width="34" height="5" fill="${lg('gb1', [[0, '#fff3bf'], [0.5, '#fab005'], [1, '#e67700']], 1, 0)}"/>
          <rect x="43" y="58" width="34" height="5" fill="${lg('gb2', [[0, '#fff3bf'], [0.5, '#fab005'], [1, '#e67700']], 1, 0)}"/>
          <rect x="47" y="28" width="5" height="28" rx="2.5" fill="#fff" opacity=".35"/>
          <rect x="41" y="66" width="38" height="10" rx="3" fill="${lg('fm', [[0, '#f8f9fa'], [0.5, '#ced4da'], [1, '#868e96']], 1, 0)}" stroke="#868e96"/>
          <path d="M41,76 C39,90 53,102 60,110 C67,102 81,90 79,76Z" fill="${lg('ink', [[0, '#343a40'], [0.55, '#0b3d2e'], [1, '#20c997']])}"/>
          <path d="M50,80 C52,92 57,99 60,105" stroke="#63e6be" stroke-width="1.8" fill="none" opacity=".7"/>
          <path d="M43,33 H77" stroke="#e03131" stroke-width="5"/>
          ${face(60, 46, { eyes: 'brave', mouth: 'grin', s: 0.95 })}
        </g>
        <path d="M74,26 C88,18 98,24 112,16 C104,30 92,28 78,32Z M76,30 C88,36 96,42 110,40 C100,50 90,44 78,36Z" fill="#e03131" stroke="#a61e1e" stroke-width="1.2"/>
        ${twinkle(104, 60, 7, '#fff')}${twinkle(12, 40, 5, '#c3fae8')}${twinkle(36, 112, 4, '#fff')}</g>`;
      },
      // ウォーターミッドナイト (MR・つつむ・説教): 真夜中色の水筆ペン。しずく形の水タンクの中に夜の海と星、
      // 頭に三日月のキャップ、まるメガネ、指し棒をかまえて説教する
      watermid: () => {
        const drop = `M60,10 C78,34 98,52 98,76 C98,100 81,112 60,112 C39,112 22,100 22,76 C22,52 42,34 60,10Z`;
        const ring = (r, w, o, dash) => `<circle cx="60" cy="72" r="${r}" fill="none" stroke="${lg('rg' + r, [[0, '#74c0fc'], [0.5, '#e5dbff'], [1, '#3bc9db']], 1, 1)}" stroke-width="${w}" opacity="${o}" stroke-dasharray="${dash}"/>`;
        const splash = (x, y, a, s) => `<path transform="translate(${x} ${y}) rotate(${a}) scale(${s})" d="M0,0 C-6,-10 -2,-22 0,-28 C2,-22 6,-10 0,0Z" fill="${lg('sp', [[0, '#e7f5ff'], [1, '#4dabf7']])}" stroke="#fff" stroke-width="1"/>`;
        return `<g transform="translate(60 66) scale(.96) translate(-60 -60)">
        <path d="M14,104 C30,92 44,108 60,100 C76,92 90,108 106,98 C102,112 86,118 60,118 C34,118 18,112 14,104Z" fill="${lg('wv', [[0, '#a5d8ff'], [1, '#1c7ed6']])}" stroke="#fff" stroke-width="2"/>
        ${splash(18, 100, -38, 0.9)}${splash(102, 98, 38, 0.9)}${splash(30, 92, -18, 0.6)}${splash(90, 90, 18, 0.6)}
        <path d="M100,44 L120,6" stroke="${lg('pt', [[0, '#8d5a2b'], [1, '#e8b57a']])}" stroke-width="4.5" stroke-linecap="round"/>
        ${twinkle(120, 6, 9, '#ffe066')}${twinkle(120, 6, 4, '#fff')}
        <path d="${drop}" fill="${lg('wm', [[0, '#74c0fc'], [0.4, '#1c4fbf'], [1, '#0b1238']])}" stroke="#fff" stroke-width="3"/>
        <path d="${drop}" fill="none" stroke="#3bc9db" stroke-width="1.2" opacity=".8" transform="translate(60 61) scale(.93) translate(-60 -61)"/>
        <g clip-path="${clip('wc', `<path d="${drop}"/>`)}">
          <path d="M14,80 C30,72 44,86 60,78 C76,70 90,84 106,76 V120 H14Z" fill="${lg('sea', [[0, '#3bc9db', 0.9], [0.4, '#1971c2', 0.95], [1, '#0b1238', 1]])}"/>
          <path d="M14,80 C30,72 44,86 60,78 C76,70 90,84 106,76" stroke="#e3fafc" stroke-width="2.6" fill="none"/>
          ${[[34, 96, 2.4], [50, 104, 1.8], [76, 98, 2.2], [88, 90, 1.6], [62, 92, 1.4], [44, 88, 1.2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e7f5ff"/>`).join('')}
          ${twinkle(70, 104, 3.4, '#ffe066')}${twinkle(40, 34, 2.6, '#fff')}${twinkle(82, 40, 2, '#fff')}
          <path d="M30,30 C36,22 44,18 50,16" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>
          <ellipse cx="38" cy="52" rx="6" ry="10" fill="#fff" opacity=".18" transform="rotate(20 38 52)"/>
        </g>
        <path d="M44,8 C50,-6 68,-6 74,4 C66,-2 56,0 54,10 C52,6 48,6 44,8Z" fill="${lg('mn', [[0, '#fff9db'], [1, '#fab005']])}" stroke="#e67700" stroke-width="1.4"/>
        ${twinkle(80, 0, 5, '#fff3bf')}${twinkle(30, 8, 3.4, '#fff')}${twinkle(8, 56, 4, '#c5f6fa')}${twinkle(112, 70, 3.4, '#fff')}
        <circle cx="47" cy="58" r="11" fill="#e7f5ff" fill-opacity=".22" stroke="#fcc419" stroke-width="3.2"/><circle cx="73" cy="58" r="11" fill="#e7f5ff" fill-opacity=".22" stroke="#fcc419" stroke-width="3.2"/><path d="M58,58 h4" stroke="#fab005" stroke-width="2.6"/>
        <path d="M42,59 Q47,54 52,59 Q47,62 42,59Z M68,59 Q73,54 78,59 Q73,62 68,59Z" fill="#c5f6fa"/><circle cx="47" cy="58.5" r="2" fill="#0b1238"/><circle cx="73" cy="58.5" r="2" fill="#0b1238"/><circle cx="46" cy="57.5" r=".8" fill="#fff"/><circle cx="72" cy="57.5" r=".8" fill="#fff"/>
        <path d="M38,46 L54,51 M82,46 L66,51" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <path d="M54,72 Q60,68 66,72" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M94,62 C106,56 108,46 100,40" stroke="#1c4fbf" stroke-width="6.5" stroke-linecap="round" fill="none"/><path d="M94,62 C106,56 108,46 100,40" stroke="#74c0fc" stroke-width="2" stroke-linecap="round" fill="none"/>
        <g transform="rotate(-8 18 26)"><rect x="2" y="16" width="38" height="22" rx="10" fill="#fff" stroke="#1c7ed6" stroke-width="2.4"/><path d="M26,38 l6,8 l-1,-9z" fill="#fff" stroke="#1c7ed6" stroke-width="2"/><text x="19" y="31.5" font-size="11" font-weight="900" text-anchor="middle" fill="#e03131" font-family="sans-serif">コラ!!</text></g>
        </g>`;
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
    // ---------- 2026-11 に追加した 50 体: 形 (体) + 種類ごとの飾り + アクセサリーを組み合わせて描く ----------
    // spec = [形, 種類, 色1, 色2, アクセサリー, 目, 口]
    const GEN = {"crayon": ["stick", "crayon", "#ff6b6b", "#c92a2a", "cap", "sparkle", "open"], "cutter": ["stick", "cutter", "#ffd43b", "#f08c00", "headband", "brave", "grin"], "sharpener": ["box", "sharpener", "#74c0fc", "#1c7ed6", "", "happy", "open"], "binder": ["box", "rings", "#69db7c", "#2f9e44", "helmet", "brave", "smile"], "envelope": ["box", "env", "#fff3bf", "#fab005", "", "sparkle", "cat"], "stamp": ["round", "stamp", "#e8590c", "#a33d06", "", "old", "smile"], "inkpad": ["box", "pad", "#9775fa", "#5f3dc4", "bow", "wink", "smile"], "clipboard": ["box", "clip", "#c9a26b", "#8d5a2b", "", "cool", "grin"], "highlighter": ["stick", "marker", "#c0eb75", "#5c940d", "bow", "sparkle", "open"], "brush": ["stick", "brush", "#a9744f", "#6b3d1f", "headband", "brave", "smile"], "palette": ["round", "palette", "#ffe8cc", "#d9480f", "beret", "happy", "smile"], "calc": ["box", "calc", "#868e96", "#343a40", "antenna", "sparkle", "o"], "notecard": ["box", "cards", "#ffffff", "#adb5bd", "", "sparkle", "smile"], "masking": ["round", "tape", "#ffa8a8", "#e64980", "bow", "wink", "open"], "ballpen": ["stick", "pen", "#4dabf7", "#1864ab", "helmet", "brave", "grin"], "punch": ["box", "punch", "#495057", "#212529", "crown-s", "cool", "grin"], "bookmark": ["tri", "bookmark", "#ffc9e3", "#d6336c", "wings", "sparkle", "smile"], "lead": ["box", "leadcase", "#e9ecef", "#495057", "", "ninja", "smile"], "dust": ["round", "dust", "#f1f3f5", "#adb5bd", "", "happy", "cat"], "tapecut": ["box", "dispenser", "#fa5252", "#a61e1e", "kabuto", "brave", "grin"], "fudebako": ["box", "pencase", "#5c7cfa", "#364fc7", "shield", "brave", "smile"], "drafting": ["stick", "pen", "#343a40", "#000000", "wizard", "cool", "smile"], "colors": ["stick", "rainbow", "#ff8787", "#e03131", "headband", "brave", "open"], "sketch": ["box", "spiral", "#ffe066", "#e67700", "beard", "old", "smile"], "magnet": ["u", "magnet", "#fa5252", "#4dabf7", "", "brave", "grin"], "whiteboard": ["box", "board", "#f8f9fa", "#868e96", "helmet", "brave", "smile"], "abacus": ["box", "abacus", "#c08552", "#5c3317", "beard", "sparkle", "smile"], "inkbottle": ["bottle", "ink", "#4263eb", "#1c2c8f", "witch", "wink", "smile"], "quill": ["stick", "quill", "#e5dbff", "#7048e8", "beret", "happy", "open"], "label": ["box", "label", "#20c997", "#087f5b", "glasses", "sparkle", "o"], "gluestick": ["bottle", "glue", "#ffd43b", "#e67700", "crown-s", "brave", "grin"], "calendar": ["box", "cal", "#ffffff", "#e03131", "", "sparkle", "smile"], "lamp": ["bottle", "lamp", "#ffe066", "#f59f00", "", "sparkle", "open"], "clock": ["round", "clock", "#ff8787", "#c92a2a", "", "brave", "o"], "setsquare": ["tri", "ruler", "#66d9e8", "#0c8599", "", "happy", "open"], "origami": ["tri", "origami", "#ff922b", "#d9480f", "horns", "fierce", "grin"], "seal": ["round", "wax", "#c92a2a", "#7a1414", "tophat", "cool", "smile"], "diary": ["box", "book", "#f783ac", "#a61e4d", "tiara", "sparkle", "smile"], "sensu": ["tri", "fan", "#ffc9c9", "#c2255c", "flower", "wink", "smile"], "gem": ["round", "gem", "#99e9f2", "#1098ad", "", "sparkle", "smile"], "rainbowpen": ["stick", "rainbow", "#ffd43b", "#e8590c", "crown", "fierce", "grin"], "meteorruler": ["tri", "ruler", "#4c6ef5", "#1c2c8f", "comet", "brave", "open"], "sumiryu": ["stick", "brush", "#212529", "#000000", "horns", "fierce", "grin"], "crystal": ["round", "gem", "#d0bfff", "#7048e8", "halo", "sparkle", "smile"], "gyokuji": ["round", "stamp", "#ffd43b", "#e67700", "crown", "cool", "smile"], "phoenix": ["stick", "quill", "#ff922b", "#e03131", "flame", "brave", "open"], "galaxy": ["round", "galaxy", "#5f3dc4", "#1b1035", "halo", "star", "o"], "raimei": ["box", "stapler", "#fcc419", "#e67700", "horns", "fierce", "grin"], "hyoketsu": ["stick", "fountain", "#a5d8ff", "#1971c2", "snow", "cool", "smile"], "sakura": ["stick", "brush", "#ffc9e3", "#d6336c", "petals", "wink", "smile"]};
    function gen([shape, kind, c1, c2, acc, eyes, mouth]) {
      const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
      const body = lg('gb', [[0, c1], [1, c2]]), bodyX = lg('gx', [[0, c1], [0.55, c1], [1, c2]], 1, 0);
      const out = []; let fx = 60, fy = 60, fs = 1;
      const metal = lg('gm', [[0, '#f8f9fa'], [0.5, '#ced4da'], [1, '#868e96']], 1, 0);
      if (shape === 'stick') {
        const top = kind === 'quill' ? 30 : 22, bot = 88;
        if (kind === 'quill') out.push(`<path d="M60,4 C86,10 90,40 70,54 L60,62 L50,54 C30,40 34,10 60,4Z" fill="${lg('fe', [[0, '#fff'], [0.4, c1], [1, c2]])}" stroke="${c2}" stroke-width="1.6"/><path d="M60,8 V60" stroke="#fff" stroke-width="1.6" opacity=".8"/>${[16, 26, 36, 46].map((y) => `<path d="M60,${y} L${46 + y / 6},${y + 8} M60,${y} L${74 - y / 6},${y + 8}" stroke="#fff" stroke-width="1" opacity=".6"/>`).join('')}`);
        if (kind === 'rainbow') { const cols = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa']; out.push(`<g>${cols.map((c, i) => `<rect x="${40 + i * 7}" y="22" width="7" height="68" fill="${c}"/>`).join('')}</g><rect x="40" y="22" width="42" height="68" rx="6" fill="none" stroke="${c2}" stroke-width="2"/>`); }
        else out.push(`<rect x="${kind === 'quill' ? 48 : 41}" y="${kind === 'quill' ? 54 : top}" width="${kind === 'quill' ? 24 : 38}" height="${bot - (kind === 'quill' ? 54 : top)}" rx="${kind === 'quill' ? 6 : 8}" fill="${bodyX}" stroke="${c2}" stroke-width="2"/>`);
        if (kind === 'quill') { fy = 40; fs = 0.72; }
        if (kind === 'pen' || kind === 'fountain' || kind === 'cutter') out.push(`<rect x="39" y="14" width="42" height="20" rx="8" fill="${c2}"/><rect x="74" y="16" width="5" height="34" rx="2.5" fill="${metal}" stroke="#868e96"/>`);
        if (kind === 'marker' || kind === 'crayon') out.push(`<rect x="39" y="12" width="42" height="18" rx="7" fill="${c2}"/>`);
        if (kind === 'crayon') out.push(`<rect x="41" y="40" width="38" height="34" fill="#fff" opacity=".85"/><path d="M45,46 q15,8 30,0 M45,58 q15,8 30,0" stroke="${c2}" stroke-width="2" fill="none" opacity=".6"/>`);
        // 先っぽ
        if (kind === 'brush') out.push(`<rect x="44" y="86" width="32" height="10" fill="${metal}"/><path d="M44,96 C44,110 58,116 60,120 C62,116 76,110 76,96Z" fill="${c2 === '#000000' ? '#212529' : c2}"/><path d="M52,98 C54,108 58,112 60,116" stroke="#fff" stroke-width="1.4" opacity=".4" fill="none"/>`);
        else if (kind === 'marker') out.push(`<path d="M45,88 L75,88 L70,104 L50,104Z" fill="${c2}"/><path d="M52,104 L68,104 L64,114 L56,110Z" fill="${c1}" stroke="${c2}"/>`);
        else if (kind === 'crayon') out.push(`<path d="M43,88 L77,88 L60,114Z" fill="${c1}" stroke="${c2}" stroke-width="2"/>`);
        else if (kind === 'cutter') out.push(`<path d="M46,88 L74,88 L74,100 L46,118Z" fill="${metal}" stroke="#868e96"/><path d="M50,96 L70,96 M50,104 L66,100" stroke="#adb5bd"/>`);
        else if (kind === 'fountain') out.push(`<path d="M46,88 L74,88 L60,118Z" fill="${lg('nb', [[0, '#fff3bf'], [1, '#e67700']])}" stroke="#b35c00"/><path d="M60,96 V110" stroke="#b35c00" stroke-width="1.5"/><circle cx="60" cy="98" r="2" fill="#b35c00"/>`);
        else if (kind === 'quill') out.push(`<path d="M52,88 L68,88 L60,112Z" fill="${metal}" stroke="#868e96"/>`);
        else out.push(`<path d="M44,88 L76,88 L60,112Z" fill="${kind === 'rainbow' ? '#ffe8cc' : metal}" stroke="${kind === 'rainbow' ? '#e8b57a' : '#868e96'}"/><path d="M55,104 L65,104 L60,112Z" fill="${kind === 'rainbow' ? '#e64980' : '#343a40'}"/>`);
        out.push(`<rect x="45" y="30" width="5" height="50" rx="2.5" fill="#fff" opacity=".45"/>`);
        if (kind !== 'quill') fy = 56;
      } else if (shape === 'box') {
        const x = 22, y = 30, w = 76, h = 70;
        if (kind === 'dispenser') out.push(`<path d="M20,100 L100,100 L96,64 C92,40 60,34 50,48 L24,70Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="64" cy="58" r="20" fill="#e7f5ff" opacity=".7" stroke="#fff" stroke-width="2"/><path d="M96,66 l10,-4 l-2,8z" fill="${metal}"/>`);
        else if (kind === 'stapler') out.push(`<path d="M14,98 L106,98 L106,88 L20,84Z" fill="#495057"/><path d="M18,82 C18,56 40,42 70,44 L104,52 L104,82Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/>`);
        else out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${body}" stroke="${c2}" stroke-width="2.4"/>`);
        if (kind === 'rings') out.push([44, 60, 80].map((yy) => `<circle cx="24" cy="${yy}" r="6" fill="none" stroke="${metal}" stroke-width="3.5"/>`).join(''));
        if (kind === 'spiral') out.push(Array.from({ length: 8 }, (_, i) => `<path d="M${30 + i * 8.5},26 q3,-6 6,0 v8" stroke="#495057" stroke-width="2.4" fill="none"/>`).join(''));
        if (kind === 'env') out.push(`<path d="M22,34 L60,66 L98,34" fill="none" stroke="${c2}" stroke-width="2.4"/><circle cx="60" cy="66" r="7" fill="#e03131"/>`);
        if (kind === 'clip') out.push(`<rect x="44" y="20" width="32" height="18" rx="4" fill="${metal}" stroke="#868e96"/><rect x="34" y="48" width="52" height="46" rx="4" fill="#fff" opacity=".9"/>`);
        if (kind === 'cal') out.push(`<rect x="22" y="30" width="76" height="20" rx="10" fill="${c2}"/><rect x="22" y="40" width="76" height="10" fill="${c2}"/>${[38, 60, 82].map((xx) => `<rect x="${xx - 3}" y="22" width="6" height="14" rx="3" fill="#495057"/>`).join('')}<text x="86" y="94" font-size="14" font-weight="900" fill="${c2}" text-anchor="middle" font-family="sans-serif">19</text>`);
        if (kind === 'label') out.push(`<rect x="96" y="56" width="22" height="12" fill="#fff" stroke="${c2}"/><rect x="32" y="36" width="56" height="12" rx="3" fill="#212529"/>`);
        if (kind === 'board') out.push(`<rect x="22" y="30" width="76" height="70" rx="12" fill="none" stroke="#adb5bd" stroke-width="5"/><rect x="34" y="100" width="52" height="6" rx="3" fill="#868e96"/><rect x="40" y="96" width="16" height="5" rx="2" fill="#e03131"/><rect x="62" y="96" width="16" height="5" rx="2" fill="#1c7ed6"/>`);
        if (kind === 'book') out.push(`<rect x="22" y="30" width="14" height="70" rx="6" fill="${c2}"/><path d="M78,40 l5,10 l11,1 l-8,7 l3,11 l-11,-6 l-11,6 l3,-11 l-8,-7 l11,-1z" fill="#fff3bf" opacity=".9" transform="translate(-4,34) scale(.55) translate(60,10)"/>`);
        if (kind === 'calc') { out.push(`<rect x="32" y="38" width="56" height="30" rx="5" fill="#d3f9d8" stroke="#2b8a3e"/>`); out.push(Array.from({ length: 8 }, (_, i) => `<rect x="${34 + (i % 4) * 13}" y="${74 + Math.floor(i / 4) * 12}" width="10" height="9" rx="2" fill="${i === 7 ? '#fa5252' : '#dee2e6'}"/>`).join('')); fy = 52; fs = 0.82; }
        if (kind === 'abacus') { out.push(`<rect x="28" y="36" width="64" height="58" rx="4" fill="#fff4e6" opacity=".25"/>`); out.push([40, 94].map((yy, r) => `<path d="M26,${yy} H94" stroke="#5c3317" stroke-width="1.6"/>${[34, 46, 74, 86].map((xx, k) => `<ellipse cx="${xx + ((r + k) % 2) * 3}" cy="${yy}" rx="5" ry="4" fill="${k % 2 ? '#ffa94d' : '#e8590c'}"/>`).join('')}`).join('')); }
        if (kind === 'cards') out.push(`<rect x="28" y="24" width="64" height="70" rx="10" fill="#fff" stroke="#adb5bd" transform="rotate(-8 60 60)"/><circle cx="34" cy="38" r="5" fill="none" stroke="${metal}" stroke-width="3"/>`);
        if (kind === 'pad') out.push(`<rect x="30" y="40" width="60" height="44" rx="8" fill="${c2}" opacity=".85"/>`);
        if (kind === 'sharpener') out.push(`<circle cx="98" cy="64" r="9" fill="${metal}" stroke="#868e96"/><path d="M98,64 l12,8" stroke="#495057" stroke-width="4" stroke-linecap="round"/><circle cx="40" cy="44" r="6" fill="#212529"/>`);
        if (kind === 'punch') out.push(`<rect x="22" y="28" width="76" height="14" rx="6" fill="#868e96"/><circle cx="44" cy="94" r="4" fill="#000"/><circle cx="76" cy="94" r="4" fill="#000"/>`);
        if (kind === 'leadcase') out.push(`<rect x="22" y="30" width="76" height="18" rx="9" fill="${c2}"/>${[36, 48, 60, 72, 84].map((xx) => `<rect x="${xx - 1.5}" y="18" width="3" height="18" rx="1.5" fill="#343a40"/>`).join('')}`);
        if (kind === 'pencase') out.push(`<path d="M22,44 H98" stroke="${metal}" stroke-width="3" stroke-dasharray="3 2"/><rect x="92" y="40" width="10" height="8" rx="2" fill="${metal}"/>${['#ff6b6b', '#ffd43b', '#51cf66'].map((c, i) => `<rect x="${36 + i * 14}" y="16" width="8" height="18" rx="1.5" fill="${c}"/>`).join('')}`);
        if (kind === 'stapler') { fx = 62; fy = 66; fs = 0.9; }
        if (kind === 'dispenser') { fx = 64; fy = 60; fs = 0.8; }
        if (kind !== 'calc' && kind !== 'stapler' && kind !== 'dispenser') fy = kind === 'cal' ? 72 : 66;
        out.push(`<ellipse cx="38" cy="${kind === 'cal' ? 60 : 46}" rx="7" ry="4" fill="#fff" opacity=".5"/>`);
      } else if (shape === 'round') {
        if (kind === 'stamp') out.push(`<rect x="50" y="10" width="20" height="24" rx="10" fill="${c2}"/><rect x="40" y="30" width="40" height="12" rx="6" fill="${c2}"/><rect x="26" y="40" width="68" height="62" rx="18" fill="${body}" stroke="${c2}" stroke-width="2.4"/><rect x="24" y="98" width="72" height="10" rx="4" fill="#e03131"/>`);
        else if (kind === 'clock') out.push(`<circle cx="36" cy="28" r="12" fill="${c2}"/><circle cx="84" cy="28" r="12" fill="${c2}"/><path d="M40,104 L32,114 M80,104 L88,114" stroke="${c2}" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="64" r="40" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="60" cy="64" r="32" fill="#fff"/>${Array.from({ length: 12 }, (_, i) => `<circle cx="${60 + Math.cos(i * Math.PI / 6) * 28}" cy="${64 + Math.sin(i * Math.PI / 6) * 28}" r="1.6" fill="#495057"/>`).join('')}`);
        else if (kind === 'palette') out.push(`<path d="M60,24 C96,24 108,52 100,74 C94,90 80,82 76,92 C72,104 54,106 40,100 C18,92 14,64 22,48 C30,32 44,24 60,24Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="86" cy="80" r="7" fill="#fff" stroke="${c2}"/>${[['#fa5252', 40, 40], ['#4dabf7', 58, 34], ['#ffd43b', 78, 40], ['#51cf66', 30, 62]].map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`).join('')}`);
        else if (kind === 'tape') out.push(`<circle cx="60" cy="62" r="42" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="60" cy="62" r="18" fill="#fff" stroke="${c2}" stroke-width="2"/>${Array.from({ length: 10 }, (_, i) => `<circle cx="${60 + Math.cos(i * 0.63) * 31}" cy="${62 + Math.sin(i * 0.63) * 31}" r="2.6" fill="#fff" opacity=".7"/>`).join('')}<path d="M98,74 L114,96 L104,100Z" fill="${c1}" stroke="${c2}"/>`);
        else if (kind === 'dust') out.push(`<path d="M30,96 C10,96 10,70 26,66 C22,44 46,36 56,48 C62,30 92,34 90,56 C110,58 110,92 92,96Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="20" cy="104" r="4" fill="${c1}" stroke="${c2}"/><circle cx="102" cy="104" r="3" fill="${c1}" stroke="${c2}"/>`);
        else if (kind === 'wax') out.push(`<path d="${Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, r = i % 2 ? 40 : 45; return `${i ? 'L' : 'M'}${(60 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`; }).join('')}Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><circle cx="60" cy="64" r="30" fill="none" stroke="#ffc9c9" stroke-width="2" opacity=".6"/>`);
        else if (kind === 'gem') out.push(`<path d="M60,20 L98,48 L84,104 L36,104 L22,48Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><path d="M60,20 L60,104 M22,48 L98,48 M36,104 L60,48 L84,104" stroke="#fff" stroke-width="1.4" opacity=".55" fill="none"/>`);
        else if (kind === 'galaxy') out.push(`<path d="M30,104 h60 M60,104 v-8" stroke="#ced4da" stroke-width="6" stroke-linecap="round"/><circle cx="60" cy="58" r="40" fill="${rg('gx2', [[0, '#e599f7'], [0.4, c1], [1, c2]], 0.4, 0.35, 0.8)}" stroke="#d0bfff" stroke-width="2.4"/><ellipse cx="60" cy="58" rx="52" ry="12" fill="none" stroke="#ffd43b" stroke-width="3" transform="rotate(-18 60 58)"/>${[[40, 40], [80, 48], [52, 80], [76, 76], [34, 66]].map(([x, y]) => twinkle(x, y, 3, '#fff')).join('')}`);
        if (kind === 'stamp') fy = 70; else if (kind === 'clock') fy = 66; else if (kind === 'tape') { fy = 62; fs = 0.6; } else if (kind === 'dust') fy = 74; else if (kind === 'gem') fy = 64; else if (kind === 'galaxy') fy = 58; else if (kind === 'palette') fy = 66; else fy = 64;
        out.push(`<ellipse cx="44" cy="44" rx="7" ry="4" fill="#fff" opacity=".5"/>`);
      } else if (shape === 'bottle') {
        if (kind === 'ink') out.push(`<rect x="44" y="14" width="32" height="16" rx="4" fill="#212529"/><path d="M48,30 h24 v8 C94,44 98,60 96,82 C94,104 80,108 60,108 C40,108 26,104 24,82 C22,60 26,44 48,38Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><path d="M28,78 C40,72 50,86 60,80 C70,74 82,84 92,78" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/>`);
        else if (kind === 'glue') out.push(`<rect x="40" y="12" width="40" height="20" rx="6" fill="#fff" stroke="${c2}" stroke-width="2"/><rect x="36" y="30" width="48" height="76" rx="10" fill="${body}" stroke="${c2}" stroke-width="2.4"/><rect x="36" y="44" width="48" height="16" fill="#fff" opacity=".8"/><text x="60" y="56" font-size="10" font-weight="900" text-anchor="middle" fill="${c2}" font-family="sans-serif">のり</text>`);
        else if (kind === 'lamp') out.push(`<path d="M34,108 h52" stroke="#495057" stroke-width="8" stroke-linecap="round"/><path d="M60,104 L44,72 L70,46" stroke="#868e96" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50,48 L98,22 L110,56 Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><path d="M104,40 l12,30 l-30,-10z" fill="#fff9db" opacity=".7"/>`);
        if (kind === 'ink') fy = 74; else if (kind === 'glue') fy = 82; else { fx = 80; fy = 40; fs = 0.7; }
      } else if (shape === 'tri') {
        if (kind === 'ruler') out.push(`<path d="M20,104 L100,104 L20,24Z" fill="${body}" stroke="${c2}" stroke-width="2.4" opacity=".92"/><path d="M34,92 L66,92 L34,60Z" fill="#fff" opacity=".7"/>${Array.from({ length: 8 }, (_, i) => `<path d="M${26 + i * 9},104 v${i % 2 ? -5 : -9}" stroke="${c2}" stroke-width="1.4"/>`).join('')}`);
        else if (kind === 'origami') out.push(`<path d="M60,30 L100,70 L60,108 L20,70Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><path d="M60,30 L60,108 M20,70 L100,70" stroke="#fff" stroke-width="1.4" opacity=".5"/><path d="M100,70 L118,46 L106,74Z M20,70 L2,46 L14,74Z" fill="${c1}" stroke="${c2}" stroke-width="1.6"/><path d="M48,108 l-6,10 M72,108 l6,10" stroke="${c2}" stroke-width="3" stroke-linecap="round"/>`);
        else if (kind === 'fan') out.push(`<path d="M60,104 L10,46 A66,66 0 0 1 110,46Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/>${Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1.15 + i * 0.0875); return `<path d="M60,104 L${(60 + Math.cos(a) * 64).toFixed(1)},${(104 + Math.sin(a) * 64).toFixed(1)}" stroke="${c2}" stroke-width="1" opacity=".5"/>`; }).join('')}<circle cx="60" cy="104" r="5" fill="#495057"/>${[[36, 50], [80, 46], [58, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#fff" opacity=".7"/>`).join('')}`);
        else if (kind === 'bookmark') out.push(`<path d="M38,20 H82 V108 L60,92 L38,108Z" fill="${body}" stroke="${c2}" stroke-width="2.4"/><path d="M60,20 C56,8 66,4 64,14" stroke="${c2}" stroke-width="2" fill="none"/><circle cx="60" cy="34" r="4" fill="#fff" stroke="${c2}"/>`);
        if (kind === 'ruler') { fx = 46; fy = 80; fs = 0.8; } else if (kind === 'origami') fy = 70; else if (kind === 'fan') fy = 74; else fy = 58;
      } else if (shape === 'u') {
        out.push(`<path d="M24,24 V70 A36,36 0 0 0 96,70 V24 H74 V70 A14,14 0 0 1 46,70 V24Z" fill="${lg('mg', [[0, c1], [0.5, c1], [0.5, c2], [1, c2]], 1, 0)}" stroke="#495057" stroke-width="2.4"/><rect x="24" y="14" width="22" height="14" fill="${metal}" stroke="#868e96"/><rect x="74" y="14" width="22" height="14" fill="${metal}" stroke="#868e96"/>`);
        fy = 86; fs = 0.75;
      }
      out.push(face(fx, fy, { eyes: eyes || 'sparkle', mouth: mouth || 'smile', s: fs, iris: kind === 'galaxy' || lum(c1) < 0.32 ? '#fff' : '#2b2140', blush: eyes !== 'cool' && eyes !== 'fierce' }));
      // アクセサリー
      const hy = kind === 'stapler' ? 50 : shape === 'box' ? 30 : shape === 'tri' ? 34 : 22;
      const A = {
        crown: `<path d="M38,22 L42,4 L52,16 L60,0 L68,16 L78,4 L82,22Z" fill="${lg('cr', [[0, '#fff3bf'], [1, '#fab005']])}" stroke="#e67700" stroke-width="1.6"/><circle cx="60" cy="8" r="3" fill="#e03131"/>`,
        'crown-s': `<path d="M46,26 L48,14 L54,20 L60,10 L66,20 L72,14 L74,26Z" fill="#ffd43b" stroke="#e67700" stroke-width="1.4"/>`,
        tiara: `<path d="M42,28 Q60,10 78,28" fill="none" stroke="#ced4da" stroke-width="4"/><path d="M54,22 L60,12 L66,22Z" fill="#f06595"/>`,
        helmet: `<path d="M38,30 C38,10 82,10 82,30Z" fill="${metal}" stroke="#868e96" stroke-width="1.6"/><path d="M60,8 v-6" stroke="#e03131" stroke-width="4" stroke-linecap="round"/>`,
        kabuto: `<path d="M34,32 C34,12 86,12 86,32Z" fill="#343a40"/><path d="M44,16 L30,0 M76,16 L90,0" stroke="#fab005" stroke-width="5" stroke-linecap="round"/>`,
        headband: `<path d="M38,${fy - 14}H82" stroke="#e03131" stroke-width="5"/><path d="M82,${fy - 14} l12,-6 M82,${fy - 14} l12,4" stroke="#e03131" stroke-width="3"/>`,
        cap: `<path d="M40,16 C40,4 80,4 80,16Z" fill="#228be6"/><path d="M76,14 h16" stroke="#1864ab" stroke-width="4" stroke-linecap="round"/>`,
        beret: `<ellipse cx="56" cy="${shape === 'stick' && kind === 'quill' ? 6 : 22}" rx="24" ry="9" fill="#c92a2a"/><circle cx="56" cy="${shape === 'stick' && kind === 'quill' ? -2 : 14}" r="3" fill="#c92a2a"/>`,
        wizard: `<path d="M38,16 L60,-14 L82,16Z" fill="#5f3dc4"/><ellipse cx="60" cy="16" rx="26" ry="5" fill="#4c2a85"/>${twinkle(62, 0, 4, '#ffe066')}`,
        witch: `<path d="M40,30 L66,-8 L76,30Z" fill="#212529"/><ellipse cx="60" cy="30" rx="30" ry="6" fill="#343a40"/><rect x="48" y="24" width="24" height="4" fill="#9775fa"/>`,
        tophat: `<rect x="44" y="4" width="32" height="24" rx="3" fill="#212529"/><ellipse cx="60" cy="28" rx="26" ry="5" fill="#212529"/><rect x="44" y="20" width="32" height="4" fill="#c92a2a"/>`,
        bow: `<path d="M60,${shape === 'box' ? 30 : 22} l-14,-8 v16z M60,${shape === 'box' ? 30 : 22} l14,-8 v16z" fill="#f06595"/><circle cx="60" cy="${shape === 'box' ? 30 : 22}" r="4" fill="#d6336c"/>`,
        antenna: `<path d="M60,30 V12" stroke="#495057" stroke-width="3"/><circle cx="60" cy="10" r="5" fill="#fa5252"/>`,
        beard: `<path d="M${fx - 14},${fy + 10} Q${fx},${fy + 34} ${fx + 14},${fy + 10} Q${fx},${fy + 18} ${fx - 14},${fy + 10}Z" fill="#fff" stroke="#dee2e6"/>`,
        glasses: `<circle cx="${fx - 11}" cy="${fy}" r="8" fill="none" stroke="#212529" stroke-width="2"/><circle cx="${fx + 11}" cy="${fy}" r="8" fill="none" stroke="#212529" stroke-width="2"/><path d="M${fx - 3},${fy} h6" stroke="#212529" stroke-width="2"/>`,
        shield: `<path d="M92,70 l16,-4 l0,16 c0,10 -8,16 -16,20 c-8,-4 -16,-10 -16,-20 l0,-16z" fill="${metal}" stroke="#495057" stroke-width="1.6" transform="translate(4,0)"/>`,
        wings: `<path d="M36,60 C16,40 4,56 14,70 C4,76 14,90 34,76Z M84,60 C104,40 116,56 106,70 C116,76 106,90 86,76Z" fill="#fff" stroke="#d0bfff" stroke-width="1.6"/>`,
        horns: `<path d="M42,${hy} L34,${hy - 22} L50,${hy - 4}Z M78,${hy} L86,${hy - 22} L70,${hy - 4}Z" fill="${lg('hn', [[0, '#fff9db'], [1, '#f59f00']])}" stroke="#e67700" stroke-width="1.4"/>`,
        halo: `<ellipse cx="60" cy="10" rx="20" ry="5" fill="none" stroke="#ffe066" stroke-width="3.5"/>`,
        flower: `<g transform="translate(80,24)">${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-6" rx="4" ry="6" fill="#ffa8d0" transform="rotate(${a})"/>`).join('')}<circle r="3" fill="#ffd43b"/></g>`,
        comet: `<path d="M96,14 L118,2" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>${twinkle(94, 16, 8, '#ffe066')}${twinkle(14, 96, 5, '#fff')}`,
        flame: `<path d="M20,100 C10,80 22,70 18,54 C30,62 30,74 34,80 M100,100 C110,80 98,70 102,54 C90,62 90,74 86,80" fill="#ff922b" stroke="#e8590c" stroke-width="1.6" opacity=".9"/>`,
        snow: `${[[16, 30, 6], [104, 40, 5], [14, 92, 4], [106, 96, 6]].map(([x, y, r]) => `<path d="M${x - r},${y} h${2 * r} M${x},${y - r} v${2 * r} M${x - r * 0.7},${y - r * 0.7} l${1.4 * r},${1.4 * r} M${x + r * 0.7},${y - r * 0.7} l${-1.4 * r},${1.4 * r}" stroke="#a5d8ff" stroke-width="2" stroke-linecap="round"/>`).join('')}`,
        petals: `${[[16, 28], [102, 36], [12, 80], [108, 90], [28, 108]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="3.4" fill="#ffc9e3" stroke="#f783ac" transform="rotate(${i * 40} ${x} ${y})"/>`).join('')}`,
      };
      return out.join('') + (A[acc] || '');
    }
    for (const k of Object.keys(GEN)) if (!C[k]) C[k] = () => gen(GEN[k]);
    // ブリードモンスターズのモンスター ('m:'): サーバーが同じ絵 (SVG) を描いて返す。'm:x' は見本のマーク
    const monId = String(id).startsWith('m:') ? String(id).slice(2) : null;
    const body = monId ? (monId === 'x' ? '<text x="60" y="84" font-size="68" text-anchor="middle">🧬</text>' : `<image href="/api/cards/mon-art/${encodeURIComponent(monId)}" x="-2" y="-4" width="124" height="128"/>`)
      : (String(id).startsWith('h:') ? C.horse : (C[id] || C.pencil))();

    // ---------- レア度の演出 (キャラの後ろ) ----------
    let back = '';
    if (rarity === 'R') back = twinkle(18, 26, 5, '#a5d8ff', 'cb-tw') + twinkle(102, 40, 4, '#a5d8ff', 'cb-tw d2');
    if (rarity === 'SR') back = `<circle cx="60" cy="62" r="56" fill="${rg('au', [[0, '#d0bfff', 0.9], [0.6, '#b197fc', 0.35], [1, '#b197fc', 0]], 0.5, 0.5, 0.5)}"/>` + twinkle(16, 24, 6, '#e5dbff', 'cb-tw') + twinkle(104, 34, 5, '#fff', 'cb-tw d2') + twinkle(100, 98, 4, '#e5dbff', 'cb-tw d3');
    if (rarity === 'MR') { // 夜空・虹の輪・流れ星
      const stars = [[12, 18, 3], [28, 8, 2], [96, 12, 2.5], [112, 30, 2], [8, 44, 2], [114, 88, 3], [20, 104, 2.5], [100, 108, 2], [50, 6, 1.6], [76, 112, 1.8]];
      back = `<circle cx="60" cy="60" r="60" fill="${rg('nv', [[0, '#7b4dff', 0.85], [0.55, '#3b1f8f', 0.75], [1, '#140b3a', 0]], 0.5, 0.5, 0.5)}"/>`
        + `<circle class="cb-halo" cx="60" cy="62" r="52" fill="none" stroke="${lg('rb2', [[0, '#ff6bd6'], [0.25, '#ffd43b'], [0.5, '#63e6be'], [0.75, '#4dabf7'], [1, '#b197fc']], 1, 1)}" stroke-width="3.5" stroke-dasharray="10 6"/>`
        + `<circle cx="60" cy="62" r="44" fill="${rg('gl', [[0, '#fff', 0.85], [0.6, '#ffd6f5', 0.35], [1, '#ffd6f5', 0]], 0.5, 0.5, 0.5)}"/>`
        + stars.map(([x, y, r], i) => twinkle(x, y, r * 2, i % 3 ? '#fff' : '#ffe066', 'cb-tw' + (i % 3 ? ' d' + (i % 3 + 1) : ''))).join('')
        + [[0, 30, 34, 0], [70, 0, 36, 1], [86, 86, 26, 2]].map(([x, y, l, i]) => `<g class="cb-meteor m${i}"><path d="M${x},${y}l${l},${l * 0.55}" stroke="${lg('mt' + i, [[0, '#fff', 0], [1, '#fff', 1]], 1, 0.55)}" stroke-width="2.4" stroke-linecap="round"/>${twinkle(x + l, y + l * 0.55, 4, '#fff')}</g>`).join('');
    }
    if (rarity === 'LR') { // LR: 虹色の光線が回り、虹の輪が 2 重・星がいっぱい
      const RB = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
      const rays = Array.from({ length: 14 }, (_, i) => `<path d="M60,60L${60 + Math.cos((i * 25.7 - 6) * Math.PI / 180) * 95},${60 + Math.sin((i * 25.7 - 6) * Math.PI / 180) * 95}L${60 + Math.cos((i * 25.7 + 6) * Math.PI / 180) * 95},${60 + Math.sin((i * 25.7 + 6) * Math.PI / 180) * 95}Z" fill="${RB[i % RB.length]}" opacity=".55"/>`).join('');
      back = `<circle cx="60" cy="60" r="62" fill="${rg('lrb', [[0, '#fff', 1], [0.35, '#fff0f6', 0.9], [0.7, '#e5dbff', 0.5], [1, '#d0ebff', 0]], 0.5, 0.5, 0.5)}"/><g class="cb-rays">${rays}</g>`
        + `<circle cx="60" cy="60" r="44" fill="${rg('lrc', [[0, '#fff', 0.95], [0.6, '#fff', 0.4], [1, '#fff', 0]], 0.5, 0.5, 0.5)}"/>`
        + `<circle class="cb-halo" cx="60" cy="60" r="55" fill="none" stroke="${lg('lr1', RB.map((c, i) => [i / (RB.length - 1), c]), 1, 1)}" stroke-width="4" stroke-dasharray="10 5"/>`
        + `<circle class="cb-halo rev" cx="60" cy="60" r="49" fill="none" stroke="${lg('lr2', RB.slice().reverse().map((c, i) => [i / (RB.length - 1), c]), 1, 0)}" stroke-width="2" stroke-dasharray="3 6"/>`
        + [[10, 14, 8, '#fff'], [110, 18, 7, '#ffe066'], [6, 100, 6, '#c5f6fa'], [112, 104, 8, '#ffd6f5'], [60, 0, 6, '#fff'], [0, 58, 5, '#ffe066'], [120, 58, 5, '#d0bfff']].map(([x, y, r, c], i) => twinkle(x, y, r, c, 'cb-tw' + (i % 3 ? ' d' + (i % 3 + 1) : ''))).join('');
    }
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
