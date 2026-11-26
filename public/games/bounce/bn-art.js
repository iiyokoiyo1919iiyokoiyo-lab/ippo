// =====================================================================
// PROJECT BOUNCE: キャラの絵 (SVG)。アストレアは専用イラスト、ユミコは IppO のユミコの絵 (cards-art.js) を使う。
// ほかのキャラは属性の色と種族の記号で作る紋章
// =====================================================================
(function (root) {
  const D = root.BNData;
  let uid = 0;
  const RACE_ICON = { 騎士: '⚔️', 魔導士: '🔮', 獣: '🐾', 魔族: '🦇', 聖職者: '✝️', 兵士: '🛡️', エルフ: '🏹', 妖精: '🧚', ゴーレム: '🪨', 植物: '🌱', 星神: '✦', 人間: '⚡' };
  function astraea(id) { // 終焉を統べる星神 アストレア: 星の冠・流れる銀河の髪・星座の衣・背後に巨大な星の魔法陣
    const stars = Array.from({ length: 46 }, (_, i) => { const x = (i * 73) % 400, y = (i * 151) % 500, r = (i % 5) * 0.4 + 0.5; return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.3 + (i % 4) * 0.18}"/>`; }).join('');
    const ring = (r, n, rot) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + rot; return `<circle cx="${200 + Math.cos(a) * r}" cy="${190 + Math.sin(a) * r}" r="2.4" fill="#fff3bf"/>`; }).join('');
    const star = (cx, cy, r) => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; p.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); } return `M${p.join(' L')}Z`; };
    return `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="アストレア"><defs>
      <radialGradient id="${id}bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#3b2a7a"/><stop offset=".55" stop-color="#140a3a"/><stop offset="1" stop-color="#05030f"/></radialGradient>
      <linearGradient id="${id}hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7f5ff"/><stop offset=".5" stop-color="#a5b4fc"/><stop offset="1" stop-color="#6d28d9" stop-opacity=".2"/></linearGradient>
      <linearGradient id="${id}robe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset=".6" stop-color="#312e81"/><stop offset="1" stop-color="#0b0a26"/></linearGradient>
      <radialGradient id="${id}glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff9db" stop-opacity=".95"/><stop offset="1" stop-color="#ffd43b" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1e6"/><stop offset="1" stop-color="#f3d2c1"/></linearGradient>
    </defs>
    <rect width="400" height="500" fill="url(#${id}bg)"/>${stars}
    <g opacity=".75" fill="none" stroke="#ffe066" stroke-width="1.6"><circle cx="200" cy="190" r="150"/><circle cx="200" cy="190" r="128" stroke-dasharray="4 7"/><path d="${star(200, 190, 140)}" stroke-width="1.2"/></g>
    ${ring(150, 24, 0)}${ring(112, 12, 0.3)}
    <circle cx="200" cy="160" r="110" fill="url(#${id}glow)" opacity=".55"/>
    <path d="M120,210 C80,300 70,400 40,500 L150,500 C150,420 160,330 170,250Z M280,210 C320,300 330,400 360,500 L250,500 C250,420 240,330 230,250Z" fill="url(#${id}hair)" opacity=".9"/>
    <path d="M150,250 C140,330 120,420 110,500 L290,500 C280,420 260,330 250,250 C235,236 165,236 150,250Z" fill="url(#${id}robe)"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${130 + (i * 37) % 140}" cy="${300 + (i * 53) % 190}" r="${1 + (i % 3)}" fill="#fff3bf" opacity=".9"/>`).join('')}
    <path d="M150,330 L190,300 L230,340 L260,310" stroke="#fff3bf" stroke-width="1" fill="none" opacity=".7"/>
    <path d="M176,232 Q200,250 224,232 L220,262 Q200,270 180,262Z" fill="url(#${id}skin)"/>
    <path d="M160,140 C150,100 175,72 200,72 C225,72 250,100 240,140 C246,190 232,226 200,236 C168,226 154,190 160,140Z" fill="url(#${id}skin)"/>
    <path d="M150,150 C140,95 170,60 200,60 C232,60 262,95 250,150 C246,120 232,100 200,98 C172,100 156,118 150,150Z M150,150 C142,200 128,240 118,280 C150,250 162,210 166,170Z M250,150 C258,200 272,240 282,280 C250,250 238,210 234,170Z" fill="url(#${id}hair)"/>
    <path d="M178,170 Q186,164 194,170 M206,170 Q214,164 222,170" stroke="#3b2a7a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="186" cy="176" rx="5.5" ry="6.5" fill="#7c3aed"/><ellipse cx="214" cy="176" rx="5.5" ry="6.5" fill="#7c3aed"/><circle cx="188" cy="174" r="2" fill="#fff"/><circle cx="216" cy="174" r="2" fill="#fff"/>
    <path d="M193,205 Q200,209 207,205" stroke="#c2255c" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <g fill="#ffd43b" stroke="#fff3bf" stroke-width="1"><path d="${star(200, 62, 20)}"/><path d="${star(166, 74, 11)}"/><path d="${star(234, 74, 11)}"/></g>
    <path d="M120,300 C90,280 70,250 74,226" stroke="#ffe066" stroke-width="3" fill="none"/><path d="${star(74, 220, 16)}" fill="#fff9db"/>
    <circle cx="74" cy="220" r="26" fill="url(#${id}glow)"/>
    </svg>`;
  }
  function orb(c, id) {
    const a = D.ATTRS[c.attr], rc = D.RARITY_COLOR[c.rarity];
    return `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}"><defs>
      <radialGradient id="${id}bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="${a.color}" stop-opacity=".9"/><stop offset=".6" stop-color="#14112b"/><stop offset="1" stop-color="#07061a"/></radialGradient>
      <radialGradient id="${id}o" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${a.color}"/><stop offset="1" stop-color="#1b1446"/></radialGradient></defs>
      <rect width="400" height="500" fill="url(#${id}bg)"/>
      <circle cx="200" cy="230" r="150" fill="none" stroke="${rc}" stroke-width="3" opacity=".6"/><circle cx="200" cy="230" r="120" fill="url(#${id}o)"/>
      <text x="200" y="270" text-anchor="middle" font-size="120">${RACE_ICON[c.race] || a.icon}</text>
      <text x="200" y="440" text-anchor="middle" font-size="44" font-weight="900" fill="#fff" font-family="sans-serif" opacity=".9">${a.icon}</text></svg>`;
  }
  function svg(charId) {
    const c = D.CHAR[charId]; if (!c) return '';
    const id = 'bn' + (uid++);
    if (c.art === 'astraea') return astraea(id);
    if (c.art === 'yumiko' && root.CBArt) return `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ユミコ"><defs><radialGradient id="${id}y" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#5f3dc4"/><stop offset=".6" stop-color="#1a0b2e"/><stop offset="1" stop-color="#05020c"/></radialGradient></defs><rect width="400" height="500" fill="url(#${id}y)"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${40 + i * 64},0 l-18,90 h22 l-26,110" stroke="#ffe066" stroke-width="3" fill="none" opacity="${0.25 + (i % 3) * 0.15}"/>`).join('')}<g transform="translate(20 60) scale(3)">${root.CBArt.svg('yumiko', 'SSR').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g></svg>`;
    return orb(c, id);
  }
  root.BNArt = { svg, RACE_ICON };
})(typeof self !== 'undefined' ? self : this);
