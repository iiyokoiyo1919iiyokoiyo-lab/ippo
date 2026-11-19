// =====================================================================
// 期間限定クエストの戦闘背景 (SVG) を作る (開発のときだけ使う)
//   node tools/make_quest_bg.js  →  public/bg/<名前>.svg
// cards.js の QUESTS の bg に、ここで作る名前を書くと、そのクエストの対戦の背景になる
// 乱数は種つき (毎回同じ絵になる)
// =====================================================================
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'bg');
const W = 600, H = 900;
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const f = (n) => n.toFixed(1);

// 雷神降臨: 飛行機の窓から見た夜景 (雲の上の夜空・雷雲・地上の街の灯り・主翼と点滅する翼端灯)
function raijinNight() {
  const r = rng(19);
  const stars = Array.from({ length: 90 }, () => `<circle cx="${f(r() * W)}" cy="${f(r() * 330)}" r="${f(0.5 + r() * 1.3)}" fill="#fff" opacity="${f(0.3 + r() * 0.7)}"/>`).join('');
  // 地上の街 (遠いほど小さく密に、近いほど大きく)。道路の光の筋も
  const lights = [];
  for (let i = 0; i < 1500; i++) {
    const d = r() ** 1.6, y = 560 + d * 340, x = r() * W;
    const cluster = Math.sin(x / 47 + y / 23) + Math.sin(x / 13 - y / 31) > 0.2 || r() < 0.12;
    if (!cluster) continue;
    const col = r() < 0.7 ? '#ffd27a' : r() < 0.5 ? '#fff3d6' : r() < 0.5 ? '#ff9f6b' : '#9ad1ff';
    lights.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.5 + d * 1.6)}" fill="${col}" opacity="${f(0.55 + r() * 0.45)}"/>`);
  }
  const roads = Array.from({ length: 7 }, (_, i) => { const x0 = r() * W, x1 = x0 + (r() - 0.5) * 900; return `<path d="M${f(x0)},565 L${f(x1)},900" stroke="#ffcf73" stroke-width="${f(0.6 + i * 0.25)}" opacity=".35"/>`; }).join('');
  const bolt = (x, y, s) => `<path d="M${x},${y} l${-14 * s},${60 * s} l${12 * s},${-6 * s} l${-16 * s},${70 * s}" stroke="#fff6bf" stroke-width="${3 * s}" fill="none" stroke-linejoin="round" filter="url(#gl)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b1f"/><stop offset=".45" stop-color="#14204a"/><stop offset=".6" stop-color="#2a2f63"/><stop offset=".66" stop-color="#2b2340"/><stop offset="1" stop-color="#0b0a18"/></linearGradient>
<radialGradient id="glow" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#ff9f4a" stop-opacity=".3"/><stop offset="1" stop-color="#ff9f4a" stop-opacity="0"/></radialGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f63" stop-opacity="0"/><stop offset=".5" stop-color="#4a3f73" stop-opacity=".75"/><stop offset="1" stop-color="#2b2340" stop-opacity="0"/></linearGradient>
<linearGradient id="wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d4566"/><stop offset="1" stop-color="#151a2e"/></linearGradient>
<radialGradient id="win" cx=".5" cy=".5" r=".75"><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></radialGradient>
<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${stars}
<circle cx="470" cy="110" r="34" fill="#fff8dc" opacity=".9"/><circle cx="484" cy="100" r="30" fill="#14204a" opacity=".9"/>
<g filter="url(#blur)" opacity=".85">
<ellipse cx="120" cy="300" rx="190" ry="55" fill="#2c3466"/><ellipse cx="420" cy="330" rx="230" ry="60" fill="#262d5c"/><ellipse cx="300" cy="380" rx="320" ry="55" fill="#1f2650"/>
</g>
${bolt(180, 250, 1)}${bolt(430, 280, 0.7)}
<rect y="560" width="${W}" height="${H - 560}" fill="url(#glow)"/>
${lights.join('')}
<rect y="520" width="${W}" height="90" fill="url(#haze)"/>
<g filter="url(#blur)" opacity=".55"><ellipse cx="90" cy="520" rx="200" ry="26" fill="#3a3f6e"/><ellipse cx="500" cy="545" rx="220" ry="22" fill="#3a3f6e"/></g>
<path d="M-20,640 L380,720 L410,745 L-20,760 Z" fill="url(#wing)"/>
<path d="M-20,640 L380,720" stroke="#6b7499" stroke-width="2"/>
<path d="M360,716 L392,672 L404,676 L384,724 Z" fill="#2b3150"/>
<circle cx="398" cy="676" r="5" fill="#ff4d4d" filter="url(#gl)"><animate attributeName="opacity" values="1;0.15;1" dur="1.4s" repeatCount="indefinite"/></circle>
<circle cx="404" cy="740" r="3" fill="#fff" filter="url(#gl)"><animate attributeName="opacity" values="0;1;0;0" dur="2.1s" repeatCount="indefinite"/></circle>
<rect width="${W}" height="${H}" fill="url(#win)"/>
<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="150" fill="none" stroke="#c9cede" stroke-width="22" opacity=".18"/>
</svg>`;
}

// 星降る夜のクエスト: キャンディー色の星雲と流れ星の夜空
function starlight() {
  const r = rng(7);
  const stars = Array.from({ length: 160 }, () => `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(0.5 + r() * 1.6)}" fill="${r() < 0.2 ? '#ffe066' : '#fff'}" opacity="${f(0.35 + r() * 0.65)}"/>`).join('');
  const meteors = Array.from({ length: 6 }, (_, i) => { const x = 60 + r() * 480, y = 40 + r() * 600, l = 90 + r() * 90;
    return `<path d="M${f(x)},${f(y)} l${f(l)},${f(l * 0.55)}" stroke="url(#mt)" stroke-width="2.4" stroke-linecap="round"><animate attributeName="opacity" values="0;1;0" dur="${f(2 + i * 0.7)}s" begin="${f(i * 0.9)}s" repeatCount="indefinite"/></path>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140b3a"/><stop offset=".55" stop-color="#3b1f8f"/><stop offset="1" stop-color="#8f2a7a"/></linearGradient>
<radialGradient id="n1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff8fd8" stop-opacity=".55"/><stop offset="1" stop-color="#ff8fd8" stop-opacity="0"/></radialGradient>
<radialGradient id="n2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#63e6be" stop-opacity=".35"/><stop offset="1" stop-color="#63e6be" stop-opacity="0"/></radialGradient>
<linearGradient id="mt" x1="0" y1="0" x2="1" y2=".55"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<ellipse cx="160" cy="260" rx="260" ry="160" fill="url(#n1)"/><ellipse cx="470" cy="600" rx="240" ry="190" fill="url(#n2)"/>
${stars}${meteors}
</svg>`;
}

// 水深夜: 真夜中の深海 (水面の上に月、差しこむ月の光の筋、泡、魚の影、海藻)
function suishinya() {
  const r = rng(23);
  const bubbles = Array.from({ length: 40 }, () => { const x = r() * W, y = 200 + r() * 680, rr = 1.5 + r() * 5;
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="none" stroke="#a5d8ff" stroke-width="1.2" opacity="${f(0.3 + r() * 0.5)}"><animate attributeName="cy" values="${f(y)};${f(y - 120)}" dur="${f(5 + r() * 6)}s" repeatCount="indefinite"/></circle>`; }).join('');
  const fish = Array.from({ length: 7 }, () => { const x = r() * W, y = 300 + r() * 450, s = 0.6 + r() * 0.9, d = r() < 0.5 ? 1 : -1;
    return `<path transform="translate(${f(x)} ${f(y)}) scale(${f(s * d)} ${f(s)})" d="M-20,0 C-10,-9 10,-9 18,0 C10,9 -10,9 -20,0Z M18,0 L30,-8 L28,0 L30,8Z" fill="#0a1a3f" opacity=".7"/>`; }).join('');
  const weeds = Array.from({ length: 9 }, (_, i) => { const x = 20 + i * 68 + r() * 20, h = 80 + r() * 120;
    return `<path d="M${f(x)},900 C${f(x - 20)},${f(900 - h * 0.4)} ${f(x + 20)},${f(900 - h * 0.7)} ${f(x)},${f(900 - h)}" stroke="#0f3d3e" stroke-width="${f(6 + r() * 6)}" fill="none" stroke-linecap="round" opacity=".9"/>`; }).join('');
  const stars = Array.from({ length: 40 }, () => `<circle cx="${f(r() * W)}" cy="${f(r() * 120)}" r="${f(0.5 + r() * 1.2)}" fill="#fff" opacity="${f(0.4 + r() * 0.6)}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1a4a"/><stop offset=".18" stop-color="#103a7a"/><stop offset=".5" stop-color="#0b2a5e"/><stop offset="1" stop-color="#040b22"/></linearGradient>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05081c"/><stop offset="1" stop-color="#14204a"/></linearGradient>
<linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d0ebff" stop-opacity=".35"/><stop offset="1" stop-color="#d0ebff" stop-opacity="0"/></linearGradient>
<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sea)"/>
<rect width="${W}" height="140" fill="url(#sky)"/>${stars}
<circle cx="430" cy="60" r="30" fill="#fff9db" filter="url(#gl)" opacity=".7"/><circle cx="430" cy="60" r="24" fill="#fff9db"/>
<path d="M0,140 C60,130 120,150 180,140 C240,130 300,150 360,140 C420,130 480,150 540,140 C570,135 590,140 600,140" stroke="#a5d8ff" stroke-width="3" fill="none" opacity=".7"/>
<path d="M330,140 L230,900 L470,900 L420,140Z" fill="url(#ray)"/><path d="M450,140 L420,900 L600,900 L500,140Z" fill="url(#ray)" opacity=".7"/><path d="M120,140 L20,700 L160,700 L170,140Z" fill="url(#ray)" opacity=".5"/>
${fish}${bubbles}${weeds}
<path d="M0,870 C100,850 200,880 300,862 C400,846 500,872 600,858 V900 H0Z" fill="#071530"/>
</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries({ 'raijin-night': raijinNight, starlight, suishinya })) {
  const svg = fn(); fs.writeFileSync(path.join(OUT, name + '.svg'), svg);
  console.log('作った:', `public/bg/${name}.svg`, svg.length, 'bytes');
}
