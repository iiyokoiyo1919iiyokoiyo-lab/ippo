// =====================================================================
// IppO ベースボール: 選手のイラスト (写実的な絵) を自動で描く
//   ・選手のデータ (id・投手/野手・右/左・体格・肌・髪・背番号・レア度) から、いつも同じ絵になる
//   ・8 頭身 (頭 1 つぶん 28)。線で囲まず、光 (左上からの主光・うしろからレア度の色のふち光) と影で形をつくる
//     手足と体は円柱の陰影 (その部分ごとのグラデーション)・服のしわ・わきや股の暗がり (AO)・帽子のつばの影・あごの下の影
//   ・顔: 頭の形 (ほお骨・あご)・目 (まぶたに少し隠れる虹彩・瞳・映りこみ・二重の線)・眉・鼻 (鼻筋の光・小鼻・鼻の下の影)・唇 (上下の色)・耳
//   ・肌と布は細かいノイズで質感・ひげは無精ひげ (ノイズ)。背景はナイターの球場 (ぼけた照明・観客席・芝の縞・ぼけの玉)・周辺減光・粒
//   ・look で見た目を変えられる (イラストの編集): seed・skin 0-3・hairStyle 0-4・hairHex・eyes 0-2・eyeHex・mouth 0-2・pose 0-1・beard・build・h・team [メイン, 地, アクセント]
//   ・crop: 'face' で顔のアップ (一覧の小さな絵)。文字 (名前) は XML としてエスケープしてから入れる
// =====================================================================
(function (root) {
  const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (seed) => { let s = seed || 1; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5 | 0; return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const P = (q) => f(q[0]) + ',' + f(q[1]);
  // 色
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const shade = (c, k) => (k > 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k));
  const SKIN = ['#f1cdb4', '#dfab88', '#bd845e', '#86523a'];
  const HAIR = ['#17140f', '#2e2119', '#4a3020', '#6e4a2c', '#a8834f', '#262a36', '#3e1e1e'];
  const TEAMS = [['#1c3f94', '#f8f9fa', '#e03131'], ['#c92a2a', '#f8f9fa', '#1b1b2a'], ['#1b1b2a', '#ffd43b', '#f08c00'], ['#2b8a3e', '#f8f9fa', '#ffd43b'], ['#5f3dc4', '#f8f9fa', '#f783ac'], ['#0b7285', '#f8f9fa', '#ff922b'], ['#e8590c', '#1b1b2a', '#ffffff'], ['#364fc7', '#ffd43b', '#e03131']];
  const BG = { N: ['#33415c', '#111827', '#b8c6e0'], R: ['#1c5fd6', '#081736', '#8cc8ff'], SR: ['#7b2fd0', '#1a0838', '#e599f7'], SSR: ['#f08c00', '#2b1200', '#ffe066'] };
  const HEX = /^#[0-9a-f]{6}$/i, pickN = (v, n, d) => (Number.isInteger(v) && v >= 0 && v < n ? v : d);

  function svg(p, { size = 200, name = true, crop = null } = {}) {
    const look = p.look || {}, sid = look.seed || p.id || p.name;
    p = { ...p, id: sid };
    const id = String(p.id || ''), r = rng(hash(p.id || p.name)), rar = BG[p.rarity] ? p.rarity : 'N', [b1, b2, rim] = BG[rar];
    const sk = SKIN[(look.skin ?? 0) % 4], skS = mix(sk, '#4a2118', 0.4), skH = mix(sk, '#ffffff', 0.28), lip = mix(sk, '#a0524a', 0.3);
    const hairC = HEX.test(look.hairHex || '') ? look.hairHex : HAIR[(look.hair ?? Math.floor(r() * 7)) % HAIR.length];
    const [tc, tc2, tc3] = Array.isArray(look.team) && look.team.length === 3 && look.team.every((c) => HEX.test(c)) ? look.team : TEAMS[hash(id + 't') % TEAMS.length];
    const lefty = p.kind === 'P' ? hash(id + 'L') % 4 === 0 : look.bat === 'L';
    const bw = Math.max(0.9, Math.min(1.18, look.build || 1)), ht = Math.max(0.94, Math.min(1.06, look.h || 1));
    const hairStyle = pickN(look.hairStyle, 5, hash(id + 'h') % 5), eyeStyle = pickN(look.eyes, 3, hash(id + 'e') % 3), poseN = pickN(look.pose, 2, hash(id + 'p') % 2);
    const mouthStyle = pickN(look.mouth, 3, hash(id + 'm') % 3);
    const eyeC = HEX.test(look.eyeHex || '') ? look.eyeHex : '#3b2a1f';
    const darkKit = tc2 === '#1b1b2a', pin = !darkKit && hash(id + 'pin') % 3 === 0, bare = hash(id + 'arm') % 3 === 0;
    const jerseyC = darkKit ? '#272733' : '#f2f1ec', pantsC = darkKit ? '#d7d9de' : '#efeee9', underC = darkKit ? '#23232d' : tc;
    const u = 'i' + (hash(id + size + (crop || '') + JSON.stringify(look)) % 1e9).toString(36);
    const D = []; // defs
    let gid = 0;
    // 円柱の陰影 (光の側 a → 影の側 b)。白と黒を重ねるので、どんな色の上にも使える
    const ov = (a, b, k = 1) => { const n = u + 'o' + (gid++);
      D.push(`<linearGradient id="${n}" gradientUnits="userSpaceOnUse" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"><stop offset="0" stop-color="#000" stop-opacity="${f(0.36 * k)}"/><stop offset=".15" stop-color="#000" stop-opacity="${f(0.08 * k)}"/><stop offset=".33" stop-color="#fff" stop-opacity="${f(0.26 * k)}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="${f(0.16 * k)}"/><stop offset=".9" stop-color="#000" stop-opacity="${f(0.42 * k)}"/><stop offset=".97" stop-color="${rim}" stop-opacity=".55"/><stop offset="1" stop-color="${rim}" stop-opacity=".25"/></linearGradient>`);
      return `url(#${n})`; };
    const clip = (d) => { const n = u + 'c' + (gid++); D.push(`<clipPath id="${n}"><path d="${d}"/></clipPath>`); return `url(#${n})`; };
    const BLS = new Set([1.6, 3, 8]), BL = (s) => { BLS.add(s); return `filter="url(#${u}b${s})"`; };
    // なめらかな管 (点の列・太さの列)。端は丸い
    const tubeD = (pts, ws, flat = false) => { const side = (sg) => pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [q[0] - dy / L * ws[i] * sg, q[1] + dx / L * ws[i] * sg]; });
      const sm = (o) => { let d = ''; for (let i = 1; i < o.length - 1; i++) d += ` Q${P(o[i])} ${P([(o[i][0] + o[i + 1][0]) / 2, (o[i][1] + o[i + 1][1]) / 2])}`; return d + ` L${P(o[o.length - 1])}`; };
      const A = side(1), B = side(-1).reverse(), we = ws[ws.length - 1], w0 = ws[0];
      return `M${P(A[0])}${sm(A)} ${flat ? 'L' : `A${f(we)},${f(we)} 0 0 0`} ${P(B[0])}${sm(B)} A${f(w0)},${f(w0)} 0 0 0 ${P(A[0])}Z`; };
    // 管の陰影の向き (左上が明るい)
    const lit = (a, b, w) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; let nx = -dy / L, ny = dx / L; if (nx * -1 + ny * -0.5 < 0) { nx = -nx; ny = -ny; } const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return [[m[0] + nx * w, m[1] + ny * w], [m[0] - nx * w, m[1] - ny * w]]; };
    const tube = (pts, ws, base, k = 1, extra = '', flat = false) => { const d = tubeD(pts, ws, flat), w = Math.max(...ws), [la, lb] = lit(pts[0], pts[pts.length - 1], w);
      return `<path d="${d}" fill="${base}"/>${extra ? `<g clip-path="${clip(d)}">${extra}</g>` : ''}<path d="${d}" fill="${ov(la, lb, k)}"/>`; };

    // ---------- からだの寸法 (8 頭身) ----------
    const CX = 100, HEAD = 28, top = 18;
    const eyeY = top + HEAD * 0.52, browY = eyeY - 2.7, noseY = top + HEAD * 0.71, mouthY = top + HEAD * 0.82, chinY = top + HEAD;
    const sy = top + HEAD * 1.4, beltY = top + HEAD * 3.55, hipY = top + HEAD * 3.9, kneeY = top + HEAD * 5.85, ankY = top + HEAD * 7.55, footY = top + HEAD * 8;
    const shX = 23 * bw, chestW = 21.5 * bw, waistW = 16.5 * bw, hipX = 9 * bw, hw = 10.6;
    // ---------- ポーズ: 手の位置を決めて、ひじは外へ曲げる (2 関節の IK) ----------
    const UA = 40, FA = 34;
    const ik = (s, h, out) => { let dx = h[0] - s[0], dy = h[1] - s[1], d = Math.hypot(dx, dy) || 1; const dd = Math.max(Math.abs(UA - FA) + 2, Math.min(UA + FA - 1, d)); dx /= d; dy /= d;
      const a = (UA * UA - FA * FA + dd * dd) / (2 * dd), hh = Math.sqrt(Math.max(0, UA * UA - a * a)), base = [s[0] + dx * a, s[1] + dy * a];
      const e1 = [base[0] - dy * hh, base[1] + dx * hh], e2 = [base[0] + dy * hh, base[1] - dx * hh]; const hand = [s[0] + dx * dd, s[1] + dy * dd];
      const pick = Array.isArray(out) ? Math.hypot(e1[0] - out[0], e1[1] - out[1]) < Math.hypot(e2[0] - out[0], e2[1] - out[1]) : (out < 0 ? e1[0] < e2[0] : e1[0] > e2[0]);
      return [s, pick ? e1 : e2, hand]; }; // out: -1 / 1 = ひじを左 / 右へ、[x, y] = ひじをその点の近くへ
    const shL = [CX - shX, sy + 1], shR = [CX + shX, sy + 1];
    let A; // L = 画面の左 (右ききの選手の右手)
    if (p.kind === 'P') A = poseN === 0
      ? { L: ik(shL, [CX - shX - 15, sy - 8], -1), R: ik(shR, [CX + 6, sy + 33], 1), ball: 'L', glove: 'R' }            // 右手でボールを見せる・グラブは胸
      : { L: ik(shL, [CX - 5, sy + 45], -1), R: ik(shR, [CX + 3, sy + 41], 1), ball: 'L', glove: 'R', hide: true };    // セットポジション
    else A = poseN === 0
      ? { L: ik(shL, [CX - shX + 10, sy + 22], [CX - shX - 8, sy + 36]), R: ik(shR, [CX + waistW + 3, beltY - 1], 1), bat: ['L', 302, 96], back: true }   // バットを肩にかつぐ・左手は腰
      : { L: ik(shL, [CX + 1, sy + 50], -1), R: ik(shR, [CX + 3, sy + 43], 1), bat: ['L', 24, 104] };                                 // 両手でバットを立てて持つ
    if (lefty) { const m = (q) => [2 * CX - q[0], q[1]]; const L0 = A.L, R0 = A.R; A.L = R0.map(m); A.R = L0.map(m); if (A.bat) A.bat = ['R', 360 - A.bat[1], A.bat[2]]; if (A.ball) A.ball = 'R'; if (A.glove) A.glove = 'L'; }
    const legs = { L: [[CX - hipX, hipY], [CX - hipX - 3.5, kneeY], [CX - hipX - 7, ankY]], R: [[CX + hipX, hipY], [CX + hipX + 3.5, kneeY], [CX + hipX + 7, ankY]] };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    // ---------- 脚 (ソックス・パンツ)・スパイク ----------
    const legSvg = ['L', 'R'].map((k) => { const [h, kn, an] = legs[k], s = k === 'L' ? -1 : 1;
      const midT = lerp(h, kn, 0.5), calf = lerp(kn, an, 0.3), pantEnd = lerp(kn, an, 0.38);
      const sockStripes = [0.55, 0.62].map((t) => { const q = lerp(kn, an, t); return `<path d="M${f(q[0] - 8)},${f(q[1] - 0.6)} L${f(q[0] + 8)},${f(q[1] + 0.6)}" stroke="${tc2 === '#ffd43b' ? tc2 : '#f1f1ee'}" stroke-width="1.1" opacity=".9"/>`; }).join('');
      const sock = tube([lerp(kn, an, 0.2), calf, lerp(kn, an, 0.7), an], [7.6 * bw, 7.9 * bw, 5.6, 4.4], darkKit ? tc3 === '#ffffff' ? tc : tc : tc, 1, sockStripes);
      const folds = `<path d="M${f(kn[0] - 6)},${f(kn[1] - 3)} q${f(6)},4 ${f(12)},-1" stroke="#000" stroke-opacity=".22" stroke-width="1.3" fill="none" ${BL(1)}/><path d="M${f(midT[0] - s * 4)},${f(midT[1] - 6)} q${f(s * 3)},8 ${f(s * 1)},16" stroke="#000" stroke-opacity=".12" stroke-width="1.6" fill="none" ${BL(1)}/>`
        + `<path d="M${f(pantEnd[0] - 7)},${f(pantEnd[1] - 3)} q7,3 14,0" stroke="#000" stroke-opacity=".25" stroke-width="1.4" fill="none" ${BL(1)}/>`
        + (pin ? '' : `<path d="M${f(h[0] + s * 10.2 * bw)},${f(h[1] + 4)} L${f(kn[0] + s * 8)},${f(kn[1])}" stroke="${tc}" stroke-width="1.3" opacity=".9"/>`)
        + (pin ? pinStripes(h[0] - 14, h[1] - 6, 28, pantEnd[1] - h[1] + 12) : '');
      const pants = tube([h, midT, kn, pantEnd], [11.4 * bw, 10.4 * bw, 8.2 * bw, 8.9 * bw], pantsC, 0.9, folds);
      const ax = an[0], ay = an[1], tx = ax + s * 2.2;
      const shoe = `<path d="M${f(ax - 4.6)},${f(ay - 0.5)} Q${f(ax - 5.4 + s * 0.6)},${f(footY - 3.4)} ${f(tx - 6.6)},${f(footY - 1.6)} L${f(tx + 6.6)},${f(footY - 1.6)} Q${f(ax + 5.4 + s * 0.6)},${f(footY - 3.4)} ${f(ax + 4.6)},${f(ay - 0.5)}Z" fill="#141419"/>`
        + `<path d="M${f(ax - 4.6)},${f(ay - 0.5)} Q${f(ax - 5.4 + s * 0.6)},${f(footY - 3.4)} ${f(tx - 6.6)},${f(footY - 1.6)} L${f(tx + 6.6)},${f(footY - 1.6)} Q${f(ax + 5.4 + s * 0.6)},${f(footY - 3.4)} ${f(ax + 4.6)},${f(ay - 0.5)}Z" fill="${ov([ax - 6, ay], [ax + 6, ay], 1.2)}"/>`
        + `<path d="M${f(tx - 6.8)},${f(footY - 1.8)} L${f(tx + 6.8)},${f(footY - 1.8)} L${f(tx + 6.2)},${f(footY)} L${f(tx - 6.2)},${f(footY)}Z" fill="#d9d9d6"/><path d="M${f(tx - 6.5)},${f(footY - 0.4)} h13" stroke="#000" stroke-opacity=".35" stroke-width=".6"/>`
        + `<path d="M${f(ax - 3.4 + s * 1)},${f(footY - 3.2)} q${f(s * 3.5)},-2.2 ${f(s * 6.5)},-4.6" stroke="#f5f5f2" stroke-width="1" fill="none" opacity=".9"/>`
        + `<path d="M${f(ax - 1.6)},${f(ay + 1.4)} h3.2 M${f(ax - 1.8)},${f(ay + 3)} h3.6" stroke="#ddd" stroke-width=".5" opacity=".7"/>`
        + `<ellipse cx="${f(ax - 1.5)}" cy="${f(ay + 2)}" rx="1.4" ry="2.4" fill="#fff" opacity=".12"/>`;
      return pants + sock + shoe; }).join('');
    function pinStripes(x, y, w, h) { let o = ''; for (let xx = x; xx < x + w; xx += 3.6) o += `<path d="M${f(xx)},${f(y)} v${f(h)}" stroke="${tc}" stroke-width=".35" opacity=".55"/>`; return o; }

    // ---------- 胴体 (ユニフォーム)・ベルト・パンツの腰 ----------
    const jD = `M${f(CX - shX - 3)},${f(sy - 1)} Q${f(CX - 13)},${f(sy - 7.5)} ${f(CX - 7.2)},${f(sy - 6.6)} L${f(CX)},${f(sy + 7)} L${f(CX + 7.2)},${f(sy - 6.6)} Q${f(CX + 13)},${f(sy - 7.5)} ${f(CX + shX + 3)},${f(sy - 1)}`
      + ` C${f(CX + chestW + 4)},${f(sy + 6)} ${f(CX + chestW + 1)},${f(sy + 16)} ${f(CX + chestW - 0.5)},${f(sy + 22)} C${f(CX + chestW - 2)},${f(sy + 40)} ${f(CX + waistW + 1)},${f(beltY - 10)} ${f(CX + waistW + 0.5)},${f(beltY + 1)}`
      + ` L${f(CX - waistW - 0.5)},${f(beltY + 1)} C${f(CX - waistW - 1)},${f(beltY - 10)} ${f(CX - chestW + 2)},${f(sy + 40)} ${f(CX - chestW + 0.5)},${f(sy + 22)} C${f(CX - chestW - 1)},${f(sy + 16)} ${f(CX - chestW - 4)},${f(sy + 6)} ${f(CX - shX - 3)},${f(sy - 1)}Z`;
    const jFolds = (pin ? pinStripes(CX - 30, sy - 10, 60, beltY - sy + 14) : '')
      + `<path d="M${f(CX - chestW + 2)},${f(sy + 16)} Q${f(CX - 10)},${f(sy + 34)} ${f(CX - 3)},${f(beltY - 3)}" stroke="#000" stroke-opacity=".16" stroke-width="2" fill="none" ${BL(1)}/>`
      + `<path d="M${f(CX + chestW - 2)},${f(sy + 16)} Q${f(CX + 10)},${f(sy + 34)} ${f(CX + 3)},${f(beltY - 3)}" stroke="#000" stroke-opacity=".2" stroke-width="2" fill="none" ${BL(1)}/>`
      + `<path d="M${f(CX - 15)},${f(sy + 25)} Q${CX},${f(sy + 29)} ${f(CX + 15)},${f(sy + 25)}" stroke="#000" stroke-opacity=".13" stroke-width="2.4" fill="none" ${BL(2)}/>`
      + `<ellipse cx="${f(CX - 10)}" cy="${f(sy + 10)}" rx="8" ry="6" fill="#fff" opacity=".2" ${BL(2)}/>`
      + [-1, 1].map((s) => `<path d="M${f(CX + s * 4)},${f(beltY - 2)} q${f(s * 3)},-5 ${f(s * 8)},-6" stroke="#000" stroke-opacity=".14" stroke-width="1.2" fill="none" ${BL(1)}/><ellipse cx="${f(CX + s * (chestW - 1))}" cy="${f(sy + 13)}" rx="4" ry="7" fill="#000" opacity=".3" ${BL(2)}/>`).join('')
      + `<path d="M${f(CX - 7.2)},${f(sy - 6.6)} L${f(CX)},${f(sy + 7)} L${f(CX + 7.2)},${f(sy - 6.6)}" stroke="${tc}" stroke-width="1.3" fill="none"/>`
      + `<path d="M${f(CX + 0.7)},${f(sy + 7)} L${f(CX + 0.7)},${f(beltY)}" stroke="${tc}" stroke-width="1.1"/><path d="M${f(CX + 1.6)},${f(sy + 7)} L${f(CX + 1.6)},${f(beltY)}" stroke="#000" stroke-opacity=".18" stroke-width=".7"/>`
      + [0, 1, 2, 3].map((i) => `<circle cx="${f(CX + 2.6)}" cy="${f(sy + 13 + i * 11)}" r=".85" fill="${shade(jerseyC, -0.25)}"/><circle cx="${f(CX + 2.4)}" cy="${f(sy + 12.8 + i * 11)}" r=".35" fill="#fff" opacity=".8"/>`).join('')
      + `<g transform="rotate(-6 ${CX} ${f(sy + 19)})"><text x="${f(CX + 0.8)}" y="${f(sy + 20.2)}" text-anchor="middle" font-family="'Brush Script MT','Segoe Script',cursive,serif" font-style="italic" font-weight="700" font-size="${f(13 * bw)}" fill="#000" opacity=".25" ${BL(0.5)}>IppO</text>`
      + `<text x="${CX}" y="${f(sy + 19.4)}" text-anchor="middle" font-family="'Brush Script MT','Segoe Script',cursive,serif" font-style="italic" font-weight="700" font-size="${f(13 * bw)}" fill="${tc}" stroke="${tc3}" stroke-width=".45" paint-order="stroke">IppO</text></g>`
      + `<text x="${f(CX - 12 * bw)}" y="${f(sy + 35)}" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="9" fill="${tc3}" stroke="${tc}" stroke-width=".7" paint-order="stroke" opacity=".95">${X(p.number ?? '')}</text>`;
    const jersey = `<path d="M${f(CX - 8)},${f(sy - 7)} L${f(CX + 8)},${f(sy - 7)} L${CX},${f(sy + 9)}Z" fill="${underC}"/><path d="M${f(CX - 6.6)},${f(sy - 6.2)} Q${CX},${f(sy - 2)} ${f(CX + 6.6)},${f(sy - 6.2)}" stroke="${shade(underC, -0.3)}" stroke-width="1.4" fill="none"/>`
      + `<path d="${jD}" fill="${jerseyC}"/><g clip-path="${clip(jD)}">${jFolds}</g><path d="${jD}" fill="${ov([CX - chestW - 4, sy + 20], [CX + chestW + 4, sy + 20], 0.85)}"/>`;
    const seatD = `M${f(CX - waistW - 0.5)},${f(beltY + 3)} C${f(CX - waistW - 2)},${f(beltY + 10)} ${f(CX - hipX - 10 * bw)},${f(hipY - 3)} ${f(CX - hipX - 11 * bw)},${f(hipY + 6)} L${f(CX + hipX + 11 * bw)},${f(hipY + 6)} C${f(CX + hipX + 10 * bw)},${f(hipY - 3)} ${f(CX + waistW + 2)},${f(beltY + 10)} ${f(CX + waistW + 0.5)},${f(beltY + 3)}Z`;
    const seat = `<path d="${seatD}" fill="${pantsC}"/><g clip-path="${clip(seatD)}">${pin ? pinStripes(CX - 30, beltY, 60, 30) : ''}<path d="M${f(CX + 0.5)},${f(beltY + 4)} q1,6 -0.5,12" stroke="#000" stroke-opacity=".22" stroke-width="1" fill="none" ${BL(0.5)}/></g><path d="${seatD}" fill="${ov([CX - 30, hipY], [CX + 30, hipY], 0.8)}"/>`
      + `<ellipse cx="${CX}" cy="${f(hipY + 9)}" rx="4" ry="5" fill="#000" opacity=".45" ${BL(2)}/>`;
    const belt = `<path d="M${f(CX - waistW - 0.8)},${f(beltY - 0.5)} L${f(CX + waistW + 0.8)},${f(beltY - 0.5)} L${f(CX + waistW + 1.2)},${f(beltY + 4)} L${f(CX - waistW - 1.2)},${f(beltY + 4)}Z" fill="#17171d"/>`
      + `<path d="M${f(CX - waistW - 0.8)},${f(beltY + 0.2)} L${f(CX + waistW + 0.8)},${f(beltY + 0.2)}" stroke="#fff" stroke-opacity=".18" stroke-width=".5"/>`
      + [-11, 11].map((dx) => `<rect x="${f(CX + dx * bw - 1.1)}" y="${f(beltY - 1)}" width="2.2" height="5.6" fill="${pantsC}"/><rect x="${f(CX + dx * bw - 1.1)}" y="${f(beltY - 1)}" width="2.2" height="5.6" fill="#000" opacity=".15"/>`).join('')
      + `<rect x="${f(CX - 3.6)}" y="${f(beltY - 0.2)}" width="7.2" height="4" rx=".8" fill="#9aa0a8"/><rect x="${f(CX - 3.6)}" y="${f(beltY - 0.2)}" width="7.2" height="1.4" rx=".6" fill="#fff" opacity=".55"/><rect x="${f(CX - 2)}" y="${f(beltY + 0.9)}" width="4" height="1.6" fill="#33363c"/>`;

    // ---------- 腕・手・バット・グラブ・ボール ----------
    const sleeveC = jerseyC;
    const hand = (h, dir, grip) => { const a = Math.atan2(dir[1], dir[0]) * 180 / Math.PI - 90; const n = u + 'h' + (gid++);
      D.push(`<radialGradient id="${n}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${skH}"/><stop offset=".55" stop-color="${sk}"/><stop offset="1" stop-color="${skS}"/></radialGradient>`);
      return `<g transform="translate(${f(h[0])} ${f(h[1])}) rotate(${f(a)})"><path d="M-3.4,-2.6 Q-3.8,2.4 -1.6,4.6 Q1,5.8 3.2,3.8 Q4,0.6 3.2,-2.8 Q0,-4.4 -3.4,-2.6Z" fill="url(#${n})"/>`
        + (grip ? `<path d="M-2.6,0.6 h5.4 M-2.7,2.2 h5.4 M-2.2,3.7 h4.4" stroke="${skS}" stroke-width=".45" opacity=".7"/>` : `<path d="M-2.6,4 q2.6,1 5,-0.4" stroke="${skS}" stroke-width=".5" fill="none" opacity=".7"/>`)
        + `<path d="M-3,-2.4 Q-0.5,-3.9 3,-2.6" stroke="${skH}" stroke-width=".6" fill="none" opacity=".7"/></g>`; };
    const arm = (k) => { const [s0, e, h] = A[k], sleeveEnd = lerp(s0, e, 0.5);
      const wrist = lerp(e, h, 0.86);
      let o = bare ? tube([s0, e], [6.8 * bw, 5.4 * bw], underC, 1) + tube([e, lerp(e, wrist, 0.5), wrist], [5.2 * bw, 4.9 * bw, 3.2], sk, 1,
        `<path d="M${P(lerp(e, wrist, 0.15))} L${P(lerp(e, wrist, 0.7))}" stroke="${skS}" stroke-width="1.2" stroke-opacity=".35" ${BL(0.8)}/>`)
        : tube([s0, e, wrist], [6.8 * bw, 5.2 * bw, 3.4], underC, 1, `<path d="M${P(lerp(e, wrist, 0.2))} q1.5,6 -0.5,12" stroke="#000" stroke-opacity=".25" stroke-width="1" fill="none" ${BL(0.8)}/>`);
      const dd = [sleeveEnd[0] - s0[0], sleeveEnd[1] - s0[1]], L = Math.hypot(...dd) || 1, nx = -dd[1] / L * 8, ny = dd[0] / L * 8;
      o += tube([s0, sleeveEnd], [8.6 * bw, 7.9 * bw], sleeveC, 1, (pin ? pinStripes(Math.min(s0[0], sleeveEnd[0]) - 12, Math.min(s0[1], sleeveEnd[1]) - 12, 34, 34) : '')
        + `<path d="M${f(sleeveEnd[0] + nx)},${f(sleeveEnd[1] + ny)} L${f(sleeveEnd[0] - nx)},${f(sleeveEnd[1] - ny)}" stroke="${tc}" stroke-width="2.2"/><ellipse cx="${f(s0[0])}" cy="${f(s0[1] - 2)}" rx="6" ry="4" fill="#fff" opacity=".18" ${BL(1.5)}/>`, true);
      return o + hand(h, [h[0] - e[0], h[1] - e[1]], !!(A.bat && A.bat[0] === k) || (A.bat && k !== A.bat[0] && !A.back)); };
    const bat = A.bat ? (() => { const h = A[A.bat[0]][2], a = A.bat[1] * Math.PI / 180, dir = [Math.sin(a), -Math.cos(a)], len = A.bat[2];
      const knob = [h[0] - dir[0] * 9, h[1] - dir[1] * 9], tip = [knob[0] + dir[0] * len, knob[1] + dir[1] * len];
      const pts = [knob, lerp(knob, tip, 0.3), lerp(knob, tip, 0.62), lerp(knob, tip, 0.9), tip], ws = [1.4, 1.5, 2.7, 3.7, 3.7];
      const wood = hash(id + 'bat') % 3 === 0 ? '#2a1c14' : hash(id + 'bat') % 3 === 1 ? '#c99657' : '#d8b37a';
      return tube(pts, ws, wood, 1.1, `<path d="M${P(lerp(knob, tip, 0.35))} L${P(lerp(knob, tip, 0.97))}" stroke="#fff" stroke-opacity=".28" stroke-width=".6" transform="translate(${f(-dir[1] * 1.2)} ${f(dir[0] * 1.2)})"/>`
        + `<path d="M${P(knob)} L${P(lerp(knob, tip, 0.22))}" stroke="#1b1b1f" stroke-width="3.6"/><text x="${f(lerp(knob, tip, 0.78)[0])}" y="${f(lerp(knob, tip, 0.78)[1])}" font-size="2.2" font-family="sans-serif" font-weight="900" fill="#000" opacity=".5" text-anchor="middle" transform="rotate(${f(A.bat[1] - 90)} ${P(lerp(knob, tip, 0.78))})">IppO PRO</text>`)
        + `<ellipse cx="${f(knob[0])}" cy="${f(knob[1])}" rx="2.6" ry="1.9" fill="#1b1b1f" transform="rotate(${f(A.bat[1])} ${P(knob)})"/>`; })() : '';
    const glove = A.glove ? (() => { const [gx, gy] = A[A.glove][2], s = A.glove === 'R' ? 1 : -1; const n = u + 'gv';
      D.push(`<radialGradient id="${n}" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#b8763c"/><stop offset=".55" stop-color="#8a4f22"/><stop offset="1" stop-color="#3f210d"/></radialGradient>`);
      const d = `M${f(gx - s * 8)},${f(gy + 7)} C${f(gx - s * 11.5)},${f(gy)} ${f(gx - s * 10.5)},${f(gy - 8)} ${f(gx - s * 7)},${f(gy - 10.5)} Q${f(gx - s * 4.5)},${f(gy - 14)} ${f(gx - s * 2)},${f(gy - 12)} Q${f(gx)},${f(gy - 15)} ${f(gx + s * 2.6)},${f(gy - 12.4)} Q${f(gx + s * 5)},${f(gy - 14.4)} ${f(gx + s * 7)},${f(gy - 11)} Q${f(gx + s * 10)},${f(gy - 11.5)} ${f(gx + s * 10.4)},${f(gy - 6)} C${f(gx + s * 10.6)},${f(gy)} ${f(gx + s * 8.5)},${f(gy + 6)} ${f(gx + s * 4)},${f(gy + 8.5)} Q${f(gx - s * 2)},${f(gy + 10.5)} ${f(gx - s * 8)},${f(gy + 7)}Z`;
      return `<path d="${d}" fill="url(#${n})"/><g clip-path="${clip(d)}">`
        + [-2, 2.6, 7].map((x) => `<path d="M${f(gx + s * x)},${f(gy - 12)} L${f(gx + s * (x * 0.6))},${f(gy - 2)}" stroke="#2a1608" stroke-width=".9" stroke-opacity=".7"/><path d="M${f(gx + s * (x + 0.7))},${f(gy - 12)} L${f(gx + s * (x * 0.6 + 0.7))},${f(gy - 2)}" stroke="#e0a56e" stroke-width=".4" stroke-opacity=".4"/>`).join('')
        + `<ellipse cx="${f(gx + s * 1)}" cy="${f(gy + 1)}" rx="6" ry="5" fill="#2a1608" opacity=".35" ${BL(1.5)}/><path d="M${f(gx - s * 7.5)},${f(gy - 9)} q${f(s * 4)},-5 ${f(s * 9)},-3" stroke="#e8c49a" stroke-width=".6" stroke-dasharray=".8 .9" fill="none" opacity=".8"/>`
        + `<ellipse cx="${f(gx - s * 4)}" cy="${f(gy + 4)}" rx="2.6" ry="1.5" fill="${tc}" opacity=".9"/><ellipse cx="${f(gx - s * 5)}" cy="${f(gy - 6)}" rx="3" ry="4" fill="#fff" opacity=".14" ${BL(1)}/>`
        + `<path d="${d}" fill="none" stroke="#1b0c03" stroke-opacity=".5" stroke-width="1.4" ${BL(0.6)}/></g>`; })() : '';
    const ballSvg = (c, rr = 3.2) => { const n = u + 'bl' + (gid++); D.push(`<radialGradient id="${n}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#ecebe4"/><stop offset="1" stop-color="#a9a79d"/></radialGradient>`);
      return `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${rr}" fill="url(#${n})"/><path d="M${f(c[0] - rr * 0.55)},${f(c[1] - rr * 0.85)} q${f(rr * 0.5)},${f(rr * 0.85)} 0,${f(rr * 1.7)} M${f(c[0] + rr * 0.55)},${f(c[1] - rr * 0.85)} q${f(-rr * 0.5)},${f(rr * 0.85)} 0,${f(rr * 1.7)}" stroke="#c92a2a" stroke-width=".5" stroke-dasharray=".45 .35" fill="none"/>`; };
    const ball = A.ball ? (A.hide ? ballSvg([A[A.ball][2][0] + (lefty ? -2 : 2), A[A.ball][2][1] - 3.5], 2.8) : ballSvg([A[A.ball][2][0], A[A.ball][2][1] - 5.6])) : '';

    // ---------- 首・頭・顔・髪・帽子 ----------
    const neckD = `M${f(CX - 6.6)},${f(chinY - 7)} L${f(CX - 8.2)},${f(sy - 5)} Q${CX},${f(sy - 1)} ${f(CX + 8.2)},${f(sy - 5)} L${f(CX + 6.6)},${f(chinY - 7)}Z`;
    const neck = `<path d="${neckD}" fill="${sk}"/><g clip-path="${clip(neckD)}"><ellipse cx="${f(CX + 1)}" cy="${f(chinY + 1)}" rx="7" ry="3.4" fill="${skS}" opacity=".85" ${BL(1.2)}/><path d="M${f(CX - 3.6)},${f(chinY + 2)} L${f(CX - 1)},${f(sy - 4)} M${f(CX + 3.6)},${f(chinY + 2)} L${f(CX + 1)},${f(sy - 4)}" stroke="${skS}" stroke-width=".8" opacity=".4" ${BL(0.5)}/></g><path d="${neckD}" fill="${ov([CX - 7, chinY], [CX + 7, chinY], 0.9)}"/>`;
    const faceD = `M${f(CX - hw + 0.4)},${f(top + 3)} C${f(CX - hw - 0.9)},${f(eyeY - 2)} ${f(CX - hw - 0.4)},${f(eyeY + 3)} ${f(CX - hw + 0.4)},${f(eyeY + 5)} C${f(CX - hw + 0.6)},${f(mouthY + 0.5)} ${f(CX - 7.6)},${f(chinY - 2.2)} ${f(CX - 4.4)},${f(chinY - 0.5)} Q${CX},${f(chinY + 0.9)} ${f(CX + 4.4)},${f(chinY - 0.5)} C${f(CX + 7.6)},${f(chinY - 2.2)} ${f(CX + hw - 0.6)},${f(mouthY + 0.5)} ${f(CX + hw - 0.4)},${f(eyeY + 5)} C${f(CX + hw + 0.4)},${f(eyeY + 3)} ${f(CX + hw + 0.9)},${f(eyeY - 2)} ${f(CX + hw - 0.4)},${f(top + 3)} Q${CX},${f(top - 2)} ${f(CX - hw + 0.4)},${f(top + 3)}Z`;
    const fg = u + 'fg'; D.push(`<radialGradient id="${fg}" cx="40%" cy="42%" r="70%"><stop offset="0" stop-color="${skH}"/><stop offset=".5" stop-color="${sk}"/><stop offset="1" stop-color="${mix(sk, skS, 0.6)}"/></radialGradient>`);
    const ear = (s) => { const ex = CX + s * (hw + 0.2), d = `M${f(ex - s * 0.8)},${f(eyeY - 1.5)} Q${f(ex + s * 2.6)},${f(eyeY - 3)} ${f(ex + s * 2.3)},${f(eyeY + 1.5)} Q${f(ex + s * 2.2)},${f(noseY + 1)} ${f(ex - s * 0.4)},${f(noseY + 1.6)}Z`;
      return `<path d="${d}" fill="${sk}"/><path d="${d}" fill="${s < 0 ? skH : skS}" opacity=".35"/><path d="M${f(ex + s * 0.3)},${f(eyeY - 0.6)} Q${f(ex + s * 1.6)},${f(eyeY)} ${f(ex + s * 1.1)},${f(noseY - 1)}" stroke="${skS}" stroke-width=".7" fill="none" opacity=".8"/>`; };
    const up = [1.2, 1.55, 0.95][eyeStyle], lo = [0.75, 1.0, 0.6][eyeStyle], tilt = [0.45, 0, 0.25][eyeStyle];
    const eye = (sx) => { const ex = CX + sx * 4.55, ey = eyeY, inner = [ex - sx * 2.0, ey + 0.2], outer = [ex + sx * 2.15, ey - tilt];
      const d = `M${P(inner)} Q${f(ex)},${f(ey - up * 2)} ${P(outer)} Q${f(ex)},${f(ey + lo * 1.5)} ${P(inner)}Z`, cp = clip(d), ix = ex + sx * 0.1, iy = ey - 0.15;
      return `<ellipse cx="${f(ex)}" cy="${f(ey - 0.8)}" rx="3.8" ry="2.4" fill="${skS}" opacity=".5" ${BL(0.9)}/>`
        + `<path d="${d}" fill="#e8e2dc"/><g clip-path="${cp}"><circle cx="${f(ix)}" cy="${f(iy)}" r="1.1" fill="${eyeC}"/><circle cx="${f(ix)}" cy="${f(iy)}" r="1.1" fill="none" stroke="#000" stroke-opacity=".45" stroke-width=".25"/><circle cx="${f(ix)}" cy="${f(iy)}" r=".48" fill="#050505"/><circle cx="${f(ix - 0.38)}" cy="${f(iy - 0.42)}" r=".24" fill="#fff" opacity=".95"/>`
        + `<path d="M${P(inner)} Q${f(ex)},${f(ey - up * 2)} ${P(outer)}" stroke="#000" stroke-opacity=".45" stroke-width="1.2" fill="none" ${BL(0.35)}/></g>`
        + `<path d="M${P(inner)} Q${f(ex)},${f(ey - up * 2)} ${P(outer)}" stroke="#2a1a14" stroke-width=".42" fill="none" opacity=".9"/>`
        + `<path d="M${f(ex - sx * 1.7)},${f(ey - up - 0.75)} Q${f(ex)},${f(ey - up * 2 - 0.45)} ${f(ex + sx * 2.2)},${f(ey - tilt - up * 0.9)}" stroke="${skS}" stroke-width=".4" fill="none" opacity=".75"/>`
        + `<path d="M${f(inner[0])},${f(inner[1] + 0.2)} Q${f(ex)},${f(ey + lo * 1.5 + 0.3)} ${f(outer[0])},${f(outer[1] + 0.3)}" stroke="${skS}" stroke-width=".35" fill="none" opacity=".55"/>`
        + `<path d="M${f(ex - sx * 2.6)},${f(browY + 0.3)} Q${f(ex)},${f(browY - 0.9 - (eyeStyle === 0 ? 0.3 : 0))} ${f(ex + sx * 3.2)},${f(browY + 0.3 - (eyeStyle === 0 ? 0.6 : 0))} L${f(ex + sx * 3)},${f(browY + 0.9 - (eyeStyle === 0 ? 0.5 : 0))} Q${f(ex)},${f(browY + 0.4)} ${f(ex - sx * 2.6)},${f(browY + 1.7)}Z" fill="${shade(hairC, -0.1)}" opacity=".9" ${BL(0.25)}/>`; };
    const mw = mouthStyle === 2 ? 3.4 : 3.0, mc = [-0.35, 0.1, -0.5][mouthStyle];
    const mouth = (mouthStyle === 2
      ? `<path d="M${f(CX - mw)},${f(mouthY + mc)} Q${CX},${f(mouthY - 0.3)} ${f(CX + mw)},${f(mouthY + mc)} Q${CX},${f(mouthY + 2.4)} ${f(CX - mw)},${f(mouthY + mc)}Z" fill="#3a1414"/><path d="M${f(CX - mw + 0.6)},${f(mouthY + mc + 0.15)} Q${CX},${f(mouthY - 0.05)} ${f(CX + mw - 0.6)},${f(mouthY + mc + 0.15)} L${f(CX + mw - 1)},${f(mouthY + 0.9)} Q${CX},${f(mouthY + 1.2)} ${f(CX - mw + 1)},${f(mouthY + 0.9)}Z" fill="#f2eee6"/>`
      : '')
      + `<path d="M${f(CX - mw)},${f(mouthY + mc)} Q${f(CX - 1.4)},${f(mouthY - 1.35)} ${CX},${f(mouthY - 0.8)} Q${f(CX + 1.4)},${f(mouthY - 1.35)} ${f(CX + mw)},${f(mouthY + mc)} Q${CX},${f(mouthY + (mouthStyle === 2 ? -0.35 : 0.25))} ${f(CX - mw)},${f(mouthY + mc)}Z" fill="${mix(lip, sk, 0.25)}"/>`
      + `<path d="M${f(CX - mw + 0.3)},${f(mouthY + mc + (mouthStyle === 2 ? 1.6 : 0.1))} Q${CX},${f(mouthY + 2.7)} ${f(CX + mw - 0.3)},${f(mouthY + mc + (mouthStyle === 2 ? 1.6 : 0.1))} Q${CX},${f(mouthY + (mouthStyle === 2 ? 2.1 : 0.5))} ${f(CX - mw + 0.3)},${f(mouthY + mc + (mouthStyle === 2 ? 1.6 : 0.1))}Z" fill="${lip}"/>`
      + (mouthStyle === 2 ? '' : `<path d="M${f(CX - mw)},${f(mouthY + mc)} Q${CX},${f(mouthY + 0.45)} ${f(CX + mw)},${f(mouthY + mc)}" stroke="#3a1a16" stroke-width=".38" fill="none" opacity=".7"/>`)
      + `<ellipse cx="${f(CX - 0.6)}" cy="${f(mouthY + 1.2)}" rx="1.2" ry=".4" fill="#fff" opacity=".3" ${BL(0.2)}/><ellipse cx="${f(CX + 0.3)}" cy="${f(mouthY + 3)}" rx="2.2" ry=".7" fill="${skS}" opacity=".55" ${BL(0.5)}/>`
      + `<path d="M${f(CX - 0.6)},${f(noseY + 0.8)} L${f(CX - 0.5)},${f(mouthY - 1)} M${f(CX + 0.6)},${f(noseY + 0.8)} L${f(CX + 0.5)},${f(mouthY - 1)}" stroke="${skS}" stroke-width=".35" opacity=".45"/>`;
    const nose = `<path d="M${f(CX + 1.3)},${f(eyeY - 0.5)} Q${f(CX + 1.8)},${f(noseY - 3)} ${f(CX + 2.3)},${f(noseY - 0.6)}" stroke="${skS}" stroke-width="1.1" fill="none" opacity=".55" ${BL(0.5)}/>`
      + `<path d="M${f(CX - 0.4)},${f(eyeY)} L${f(CX - 0.5)},${f(noseY - 1.8)}" stroke="${skH}" stroke-width=".7" opacity=".6" ${BL(0.3)}/><ellipse cx="${f(CX - 0.3)}" cy="${f(noseY - 1.2)}" rx=".9" ry=".7" fill="#fff" opacity=".35" ${BL(0.2)}/>`
      + `<path d="M${f(CX - 2.4)},${f(noseY - 0.9)} q-0.5,1.3 0.6,1.5 M${f(CX + 2.4)},${f(noseY - 0.9)} q0.5,1.3 -0.6,1.5" stroke="${skS}" stroke-width=".55" fill="none" opacity=".85"/>`
      + `<ellipse cx="${f(CX - 1.2)}" cy="${f(noseY + 0.05)}" rx=".62" ry=".33" fill="#2a120c" opacity=".8"/><ellipse cx="${f(CX + 1.2)}" cy="${f(noseY + 0.05)}" rx=".62" ry=".33" fill="#2a120c" opacity=".8"/>`
      + `<ellipse cx="${f(CX + 0.6)}" cy="${f(noseY + 0.9)}" rx="2.3" ry=".7" fill="${skS}" opacity=".45" ${BL(0.4)}/>`;
    const stub = look.beard ? `<path d="M${f(CX - hw + 1.2)},${f(noseY)} C${f(CX - hw + 1.6)},${f(chinY - 2)} ${f(CX - 4)},${f(chinY + 0.8)} ${CX},${f(chinY + 0.6)} C${f(CX + 4)},${f(chinY + 0.8)} ${f(CX + hw - 1.6)},${f(chinY - 2)} ${f(CX + hw - 1.2)},${f(noseY)} Q${f(CX + 6)},${f(mouthY - 1.2)} ${f(CX + 2)},${f(noseY + 1.4)} L${f(CX - 2)},${f(noseY + 1.4)} Q${f(CX - 6)},${f(mouthY - 1.2)} ${f(CX - hw + 1.2)},${f(noseY)}Z" fill="${hairC}" opacity=".75" filter="url(#${u}stub)"/>` : '';
    const faceDetail = `<ellipse cx="${f(CX + hw - 1.5)}" cy="${f(eyeY + 4)}" rx="4.2" ry="10" fill="${skS}" opacity=".5" ${BL(1.6)}/>`
      + `<ellipse cx="${f(CX - hw + 3.4)}" cy="${f(eyeY + 3.2)}" rx="2.6" ry="1.6" fill="#fff" opacity=".2" ${BL(0.8)}/>`
      + [-1, 1].map((s) => `<path d="M${f(CX + s * (hw - 1.8))},${f(eyeY + 6)} Q${f(CX + s * (hw - 3.2))},${f(mouthY)} ${f(CX + s * (hw - 3.6))},${f(chinY - 3)}" stroke="${skS}" stroke-width="1.6" fill="none" opacity="${s > 0 ? '.4' : '.22'}" ${BL(0.9)}/>`).join('')
      + [-1, 1].map((s) => `<path d="M${f(CX + s * 2.8)},${f(noseY + 0.2)} Q${f(CX + s * 4.4)},${f(mouthY - 0.8)} ${f(CX + s * 4)},${f(mouthY + 1.4)}" stroke="${skS}" stroke-width=".55" fill="none" opacity=".45" ${BL(0.35)}/>`).join('')
      + `<ellipse cx="${CX}" cy="${f(chinY - 1.6)}" rx="2" ry="1" fill="#fff" opacity=".18" ${BL(0.5)}/>`
      + eye(-1) + eye(1) + nose + mouth + stub
      + `<rect x="${f(CX - 14)}" y="${f(top - 2)}" width="28" height="${f(browY - top + 1.5)}" fill="#1a0c08" opacity=".5" ${BL(1.1)}/>`; // 帽子のつばの影
    const face = `<path d="${faceD}" fill="url(#${fg})"/><g clip-path="${clip(faceD)}">${faceDetail}</g>`;
    const capBand = top + 8.4;
    // 髪 (帽子の下): 0 短い・1 もみあげ長め・2 えりあしが長い・3 外はね・4 ぼうず
    const strands = (x, y0, y1, s, n) => Array.from({ length: n }, (_, i) => `<path d="M${f(x + s * i * 0.55)},${f(y0)} q${f(s * 0.8)},${f((y1 - y0) * 0.5)} ${f(s * (0.2 + i * 0.12))},${f(y1 - y0)}" stroke="${i % 2 ? shade(hairC, 0.25) : shade(hairC, -0.35)}" stroke-width=".35" fill="none" opacity=".8"/>`).join('');
    const sideHair = hairStyle === 4 ? [-1, 1].map((s) => `<path d="M${f(CX + s * (hw + 0.6))},${f(capBand - 1)} L${f(CX + s * (hw - 0.4))},${f(eyeY + 1)} L${f(CX + s * (hw - 2.2))},${f(capBand)}Z" fill="${hairC}" opacity=".35" ${BL(0.4)}/>`).join('')
      : [-1, 1].map((s) => { const low = hairStyle === 1 ? noseY + 0.5 : hairStyle === 3 ? eyeY + 1.5 : eyeY - 0.6, flare = hairStyle === 3 ? 2.6 : 0.6;
        const d = `M${f(CX + s * (hw + 1.4))},${f(capBand - 1.2)} Q${f(CX + s * (hw + flare + 0.6))},${f(low - 2)} ${f(CX + s * (hw + flare))},${f(low)} L${f(CX + s * (hw - 1))},${f(low - 1)} Q${f(CX + s * (hw - 1.6))},${f(eyeY - 2)} ${f(CX + s * (hw - 2.6))},${f(capBand)}Z`;
        return `<path d="${d}" fill="${hairC}"/>${strands(CX + s * (hw - 1.6), capBand, low - 0.4, s, 5)}<path d="${d}" fill="${ov([CX - hw - 3, eyeY], [CX + hw + 3, eyeY], 0.7)}"/>`; }).join('');
    const hairBack = hairStyle === 2 ? `<path d="M${f(CX - hw - 1.6)},${f(capBand)} Q${f(CX - hw - 2)},${f(chinY - 3)} ${f(CX - hw + 1.5)},${f(chinY - 1)} L${f(CX + hw - 1.5)},${f(chinY - 1)} Q${f(CX + hw + 2)},${f(chinY - 3)} ${f(CX + hw + 1.6)},${f(capBand)}Z" fill="${shade(hairC, -0.15)}"/>${strands(CX - hw - 0.6, capBand + 2, chinY - 1.5, 1, 5)}${strands(CX + hw + 0.6, capBand + 2, chinY - 1.5, -1, 5)}` : '';
    const capD = `M${f(CX - hw - 1.7)},${f(capBand)} C${f(CX - hw - 2)},${f(top - 1)} ${f(CX - 5.4)},${f(top - 3.6)} ${CX},${f(top - 3.6)} C${f(CX + 5.4)},${f(top - 3.6)} ${f(CX + hw + 2)},${f(top - 1)} ${f(CX + hw + 1.7)},${f(capBand)} Q${CX},${f(capBand - 1.6)} ${f(CX - hw - 1.7)},${f(capBand)}Z`;
    const brimD = `M${f(CX - hw - 2.8)},${f(capBand - 0.6)} Q${CX},${f(capBand - 2.6)} ${f(CX + hw + 2.8)},${f(capBand - 0.6)} Q${f(CX + hw + 1.8)},${f(capBand + 2.6)} ${CX},${f(capBand + 3.1)} Q${f(CX - hw - 1.8)},${f(capBand + 2.6)} ${f(CX - hw - 2.8)},${f(capBand - 0.6)}Z`;
    const cap = `<path d="${capD}" fill="${tc}"/><g clip-path="${clip(capD)}">`
      + `<path d="M${CX},${f(top - 3.4)} L${CX},${f(capBand)} M${f(CX - 4.6)},${f(top - 2.6)} Q${f(CX - 6.4)},${f(top + 3)} ${f(CX - 6.6)},${f(capBand)} M${f(CX + 4.6)},${f(top - 2.6)} Q${f(CX + 6.4)},${f(top + 3)} ${f(CX + 6.6)},${f(capBand)}" stroke="#000" stroke-opacity=".3" stroke-width=".4" fill="none"/>`
      + `<text x="${CX}" y="${f(top + 5.6)}" text-anchor="middle" font-family="'Georgia','Times New Roman',serif" font-weight="900" font-size="7.2" fill="${tc3}" stroke="${shade(tc3, -0.4)}" stroke-width=".2">I</text>`
      + `<ellipse cx="${f(CX - 4)}" cy="${f(top + 0.5)}" rx="4.4" ry="3" fill="#fff" opacity=".28" ${BL(1)}/></g>`
      + `<path d="${capD}" fill="${ov([CX - hw - 2, top + 3], [CX + hw + 2, top + 3], 0.9)}"/><circle cx="${CX}" cy="${f(top - 3.3)}" r=".9" fill="${shade(tc, -0.2)}"/>`
      + `<path d="${brimD}" fill="${shade(tc, -0.08)}"/><path d="${brimD}" fill="${ov([CX - hw - 3, capBand], [CX + hw + 3, capBand], 0.8)}"/>`
      + `<path d="M${f(CX - hw - 2.4)},${f(capBand + 0.2)} Q${CX},${f(capBand + 3.9)} ${f(CX + hw + 2.4)},${f(capBand + 0.2)}" stroke="#08080c" stroke-opacity=".75" stroke-width=".9" fill="none"/>`
      + `<path d="M${f(CX - hw)},${f(capBand - 0.9)} Q${CX},${f(capBand - 2.3)} ${f(CX + hw)},${f(capBand - 0.9)}" stroke="#fff" stroke-opacity=".3" stroke-width=".45" fill="none"/>`;
    const head = hairBack + neck + ear(-1) + ear(1) + face + sideHair + cap;
    const front = lefty ? 'R' : 'L', back = lefty ? 'L' : 'R';
    const T = (x) => `<g filter="url(#${u}tex)">${x}</g>`;
    let parts;
    if (p.kind === 'P') parts = T(legSvg + seat + jersey) + belt + head + arm(back) + (A.hide ? ball : '') + arm(front) + glove + (A.hide ? '' : ball);
    else if (A.back) parts = T(legSvg + seat + jersey) + belt + head + arm(back) + bat + arm(front);
    else parts = T(legSvg + seat + jersey) + belt + head + arm(back) + bat + arm(front);
    const body = `<g transform="translate(${CX} ${f(footY)}) scale(${f(ht)}) translate(${-CX} ${f(-footY)})">${parts}</g>`;

    // ---------- 背景: ナイターの球場 (ぼかし) ----------
    const W = 200, Hh = 260;
    const tw = [[16, 30], [184, 24]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="#fff6dc" opacity=".22" ${BL(8)}/>` + Array.from({ length: 12 }, (_, i) => `<circle cx="${f(x - 7.5 + (i % 4) * 5)}" cy="${f(y - 4 + Math.floor(i / 4) * 4.5)}" r="1.5" fill="#fffbee"/>`).join('')
      + `<circle cx="${x}" cy="${y}" r="9" fill="#fff" opacity=".55" ${BL(3)}/><path d="M${x - 8},${y + 4} L${f(CX - 40 + (x > 100 ? 80 : 0))},230 L${f(CX + 10 - (x > 100 ? 20 : 0))},230Z" fill="#fff7dd" opacity=".07" ${BL(3)}/>`).join('');
    const crowd = Array.from({ length: 140 }, () => `<circle cx="${f(r() * 200)}" cy="${f(108 + r() * 40)}" r="${f(0.7 + r() * 0.9)}" fill="${['#e9ecef', '#ffd8a8', tc, '#868e96', '#495057', rim][Math.floor(r() * 6)]}" opacity="${f(0.25 + r() * 0.35)}"/>`).join('');
    const bokeh = Array.from({ length: 16 }, () => `<circle cx="${f(r() * 200)}" cy="${f(10 + r() * 140)}" r="${f(2.5 + r() * 8)}" fill="${mix('#ffffff', rim, 0.3 + r() * 0.5)}" opacity="${f(0.07 + r() * 0.2)}" ${BL(1.2)}/>`).join('');
    const stripes = Array.from({ length: 9 }, (_, i) => `<path d="M${f(-40 + i * 34)},152 L${f(-40 + i * 34 + 17)},152 L${f(-90 + i * 50 + 25)},262 L${f(-90 + i * 50)},262Z" fill="#fff" opacity=".05"/>`).join('');
    const flare = rar === 'SSR' ? `<ellipse cx="184" cy="24" rx="70" ry="1.6" fill="${rim}" opacity=".7" ${BL(1)}/><circle cx="150" cy="70" r="7" fill="${rim}" opacity=".12"/><circle cx="120" cy="120" r="4" fill="${rim}" opacity=".16"/><circle cx="60" cy="210" r="12" fill="${rim}" opacity=".06"/>` : rar === 'SR' ? `<ellipse cx="184" cy="24" rx="46" ry="1.1" fill="${rim}" opacity=".45" ${BL(1)}/>` : '';
    const vb = crop === 'face' ? `${CX - 27} ${top - 8} 54 58` : `0 0 ${W} ${Hh}`;
    const sp = (p.specials || []).length;
    const fy = footY;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${Math.round(size * (crop === 'face' ? 58 / 54 : Hh / W))}" role="img" aria-label="${X(p.name)}">
<defs>
<linearGradient id="${u}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix('#03050c', b1, 0.22)}"/><stop offset=".55" stop-color="${mix('#0d1428', b1, 0.32)}"/><stop offset="1" stop-color="${mix('#0d1428', b2, 0.4)}"/></linearGradient>
<linearGradient id="${u}grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#143820"/><stop offset="1" stop-color="#2d6b37"/></linearGradient>
<radialGradient id="${u}back" cx="56%" cy="30%" r="55%"><stop offset="0" stop-color="${rim}" stop-opacity=".42"/><stop offset=".5" stop-color="${rim}" stop-opacity=".12"/><stop offset="1" stop-color="${rim}" stop-opacity="0"/></radialGradient>
<radialGradient id="${u}vig" cx="50%" cy="45%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>
<linearGradient id="${u}fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".82"/></linearGradient>
${[...BLS].map((s) => `<filter id="${u}b${s}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${s}"/></filter>`).join('')}
<filter id="${u}tex" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="1" seed="${hash(id) % 97}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .34 -.1" result="d"/><feComposite in="d" in2="SourceGraphic" operator="in" result="m"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="m"/></feMerge></filter>
<filter id="${u}stub" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="1" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.6 -1.1" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in" result="s"/><feGaussianBlur in="s" stdDeviation=".12"/></filter>
<filter id="${u}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .07"/></filter>
${D.join('\n')}
</defs>
<rect width="${W}" height="${Hh}" rx="14" fill="url(#${u}sky)"/>
<g>${tw}</g>
<g ${BL(1.6)}><rect x="-10" y="104" width="220" height="50" fill="#070a14" opacity=".9"/>${crowd}<rect x="-10" y="146" width="220" height="6" fill="${shade(tc, -0.55)}"/><rect x="-10" y="150" width="220" height="120" fill="url(#${u}grass)"/>${stripes}<ellipse cx="100" cy="262" rx="120" ry="40" fill="#8a5a36" opacity=".55"/></g>
${bokeh}${flare}
<rect width="${W}" height="${Hh}" fill="url(#${u}back)"/>
<ellipse cx="100" cy="${f(fy - 0.5)}" rx="44" ry="5.5" fill="#000" opacity=".55" ${BL(3)}/>
${body}
<rect width="${W}" height="${Hh}" fill="url(#${u}vig)" pointer-events="none"/>
<rect width="${W}" height="${Hh}" filter="url(#${u}grain)" pointer-events="none"/>
${crop === 'face' ? '' : `<rect y="${Hh - 66}" width="${W}" height="66" fill="url(#${u}fl)"/>
${name ? `<text x="12" y="${Hh - 32}" font-family="sans-serif" font-weight="900" font-size="11.5" fill="${rim}">${X(p.kind === 'P' ? '投手' : '野手')} · ${X(p.pos || '')}${sp ? ' · ★' + sp : ''}</text>
<text x="12" y="${Hh - 13}" font-family="sans-serif" font-weight="900" font-size="18" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${X(p.name)}</text>` : ''}
<text x="${W - 12}" y="26" text-anchor="end" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="18" fill="${rim}" stroke="#000" stroke-width="2.5" paint-order="stroke">${X(rar)}</text>
<rect x="1.5" y="1.5" width="${W - 3}" height="${Hh - 3}" rx="13" fill="none" stroke="${rim}" stroke-opacity=".75" stroke-width="2.5"/>`}
</svg>`;
  }
  root.BBIllust = { svg };
  if (typeof module === 'object' && module.exports) module.exports = root.BBIllust;
})(typeof self !== 'undefined' ? self : this);
