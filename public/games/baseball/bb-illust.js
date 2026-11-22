// =====================================================================
// IppO ベースボール: 選手のイラスト (6〜7 等身の人のキャラ・アニメ調) を自動で描く
//   ・選手のデータ (id・投手/野手・右/左・体格・肌・髪・背番号・レア度) から、いつも同じ絵になる
//   ・頭 1 つぶん = 34。足もとから頭のてっぺんまで約 6.6 頭身。正面向きの立ちポーズ (野手: バットを肩に・バットを掲げる / 投手: ボールを見せる・グラブを胸に)
//   ・顔: 目 (まつげ・虹彩・ハイライト)・眉・鼻・口。髪は帽子の下から出る (5 種類 × 色)。帽子・ユニフォーム (胸のロゴ・背番号・アンダーシャツ)・ベルト・ストッキング・スパイク
//   ・チームの色は選手ごとに決まる。背景はレア度の色。crop: 'face' で顔のアップ (一覧の小さな絵)
//   ・文字 (名前) は XML としてエスケープしてから入れる
// =====================================================================
(function (root) {
  const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (seed) => { let s = seed || 1; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5 | 0; return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const SKIN = [['#ffe2cc', '#e8b896'], ['#f6cfac', '#d9a27a'], ['#d9a274', '#b07a4f'], ['#9a6440', '#734528']];
  const HAIR = ['#1b1a22', '#3a2a22', '#5c3b28', '#8a5a34', '#c9a063', '#2c3550', '#5a2230'];
  const TEAMS = [['#1c3f94', '#f8f9fa', '#e03131'], ['#c92a2a', '#f8f9fa', '#1b1b2a'], ['#1b1b2a', '#ffd43b', '#f08c00'], ['#2b8a3e', '#f8f9fa', '#ffd43b'], ['#5f3dc4', '#f8f9fa', '#f783ac'], ['#0b7285', '#f8f9fa', '#ff922b'], ['#e8590c', '#1b1b2a', '#ffffff'], ['#364fc7', '#ffd43b', '#e03131']];
  const BG = { N: ['#33415c', '#111827', '#9fb0d0'], R: ['#1c5fd6', '#081736', '#8cc8ff'], SR: ['#7b2fd0', '#1a0838', '#e599f7'], SSR: ['#f08c00', '#2b1200', '#ffe066'] };
  const LINE = '#1d1b2c';

  function svg(p, { size = 200, name = true, crop = null } = {}) {
    const r = rng(hash(p.id || p.name)), look = p.look || {}, rar = BG[p.rarity] ? p.rarity : 'N', [b1, b2, rim] = BG[rar];
    const [sk, skD] = SKIN[(look.skin ?? 0) % 4], hairC = HAIR[(look.hair ?? Math.floor(r() * 7)) % HAIR.length], [tc, tc2, tc3] = TEAMS[hash((p.id || '') + 't') % TEAMS.length];
    const lefty = p.kind === 'P' ? hash((p.id || '') + 'L') % 4 === 0 : look.bat === 'L';
    const bw = Math.max(0.9, Math.min(1.18, look.build || 1)), ht = Math.max(0.94, Math.min(1.06, look.h || 1));
    const hairStyle = hash((p.id || '') + 'h') % 5, eyeStyle = hash((p.id || '') + 'e') % 3, poseN = hash((p.id || '') + 'p') % 2;
    const u = 'i' + (hash((p.id || '') + size + (crop || '')) % 1e9).toString(36);
    const g = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
    const st = `stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;
    // ---------- ポーズ (腕・脚の関節) ----------
    const CX = 100, HEAD = 34, top = 16;              // 頭のてっぺん y=16・頭 1 つぶん 34 → 足もと 16 + 34 * 6.6 ≈ 240
    const sy = top + HEAD * 1.55, hipY = top + HEAD * 3.25, kneeY = top + HEAD * 4.75, ankY = top + HEAD * 6.25, footY = top + HEAD * 6.6;
    const shX = 29 * bw, hipX = 12 * bw;
    let A; // 腕: [肩, ひじ, 手] (左右: L = 画面の左 = 選手の右手)
    if (p.kind === 'P') A = poseN === 0
      ? { L: [[CX - shX, sy], [CX - shX - 14, sy + 34], [CX - shX + 4, sy + 6]], R: [[CX + shX, sy], [CX + shX + 6, sy + 38], [CX + 12, sy + 48]], ball: 'L', glove: 'R' }  // 右手でボールを見せる・グラブは胸の前
      : { L: [[CX - shX, sy], [CX - shX - 8, sy + 40], [CX - shX - 6, sy + 78]], R: [[CX + shX, sy], [CX + shX + 10, sy + 38], [CX + shX - 2, sy + 70]], glove: 'R', ball: 'L' };
    else A = poseN === 0
      ? { L: [[CX - shX, sy], [CX - shX - 16, sy + 30], [CX - shX - 4, sy + 4]], R: [[CX + shX, sy], [CX + shX + 14, sy + 34], [CX + shX - 4, sy + 62]], bat: [[CX - shX - 4, sy + 4], 300, 100] }  // バットを肩にかつぐ・左手は腰
      : { L: [[CX - shX, sy], [CX - shX - 20, sy - 16], [CX - shX - 30, sy - 48]], R: [[CX + shX, sy], [CX + shX + 14, sy + 34], [CX + shX - 4, sy + 62]], bat: [[CX - shX - 30, sy - 48], 205, 92] };      // バットを空へ掲げる
    if (lefty) { const m = (q) => [2 * CX - q[0], q[1]]; const L0 = A.L, R0 = A.R; A.L = R0.map(m); A.R = L0.map(m); if (A.bat) A.bat = [m(A.bat[0]), 360 - A.bat[1], A.bat[2]]; if (A.ball) A.ball = A.ball === 'L' ? 'R' : 'L'; if (A.glove) A.glove = A.glove === 'L' ? 'R' : 'L'; }
    const legs = { L: [[CX - hipX, hipY], [CX - hipX - 5, kneeY], [CX - hipX - 10, ankY]], R: [[CX + hipX, hipY], [CX + hipX + 5, kneeY], [CX + hipX + 10, ankY]] };
    // 太さがだんだん細くなる手足 (a → b)
    const limb = (a, b, w1, w2, fill, extra = '') => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      return `<path d="M${f(a[0] + nx * w1)},${f(a[1] + ny * w1)} L${f(b[0] + nx * w2)},${f(b[1] + ny * w2)} A${f(w2)},${f(w2)} 0 0 1 ${f(b[0] - nx * w2)},${f(b[1] - ny * w2)} L${f(a[0] - nx * w1)},${f(a[1] - ny * w1)} A${f(w1)},${f(w1)} 0 0 1 ${f(a[0] + nx * w1)},${f(a[1] + ny * w1)}Z" fill="${fill}" ${st}${extra}/>`; };
    // ---------- 脚・スパイク ----------
    const leg3 = (pts, ws, fill) => { const side = (sg) => pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [q[0] - dy / L * ws[i] * sg, q[1] + dx / L * ws[i] * sg]; });
      const o = side(1), i2 = side(-1).reverse(); return `<path d="M${o.map((q) => f(q[0]) + ',' + f(q[1])).join(' L')} L${i2.map((q) => f(q[0]) + ',' + f(q[1])).join(' L')}Z" fill="${fill}" ${st}/>`; };
    const legSvg = ['L', 'R'].map((k) => { const [h, kn, an] = legs[k], s = k === 'L' ? -1 : 1;
      const sockTop = [kn[0] + (an[0] - kn[0]) * 0.35, kn[1] + (an[1] - kn[1]) * 0.35];
      return leg3([an, sockTop], [7.5, 9.6], tc) + leg3([h, kn, sockTop], [14.5 * bw, 11.5 * bw, 10.2 * bw], `url(#${u}pants)`)
        + `<path d="M${f(kn[0] + s * 1)},${f(hipY + 6)} L${f(kn[0] + s * 1)},${f(kn[1])}" stroke="${tc}" stroke-width="2.2" opacity=".8"/>` // パンツの線
        + `<path d="M${f(an[0] - 9 + s * 3)},${f(an[1] - 3)} q${f(s * 10)},-6 ${f(s * 18 + 1)},2 l0,${f(footY - an[1] - 2)} l${f(-s * 22)},0 q-1,-6 ${f(s * 3)},-${f(footY - an[1] - 3)}Z" fill="#17171f" ${st}/><path d="M${f(an[0] - 4 + s * 3)},${f(footY - 4)} l${f(s * 12)},-3" stroke="#fff" stroke-width="1.6"/>`; }).join('');
    // ---------- 胴体 (ユニフォーム)・ベルト ----------
    const chestW = 31 * bw, waistW = 22 * bw;
    const torso = `<path d="M${f(CX - shX - 4)},${f(sy + 2)} Q${f(CX - chestW - 3)},${f(sy + 30)} ${f(CX - waistW)},${f(hipY - 2)} L${f(CX + waistW)},${f(hipY - 2)} Q${f(CX + chestW + 3)},${f(sy + 30)} ${f(CX + shX + 4)},${f(sy + 2)} Q${f(CX + 14)},${f(sy - 9)} ${CX},${f(sy - 6)} Q${f(CX - 14)},${f(sy - 9)} ${f(CX - shX - 4)},${f(sy + 2)}Z" fill="url(#${u}jersey)" ${st}/>`
      + `<path d="M${CX},${f(sy - 5)} L${CX},${f(hipY - 3)}" stroke="${tc}" stroke-width="2.4"/><path d="M${f(CX - 9)},${f(sy - 6)} Q${CX},${f(sy + 8)} ${f(CX + 9)},${f(sy - 6)}" fill="none" stroke="${tc}" stroke-width="2.6"/>`
      + [0, 1, 2, 3].map((i) => `<circle cx="${CX + 3}" cy="${f(sy + 12 + i * 12)}" r="1.3" fill="${tc}"/>`).join('')
      + `<text x="${CX}" y="${f(sy + 26)}" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-style="italic" font-size="${f(15 * bw)}" fill="${tc}" stroke="${tc3}" stroke-width=".8" paint-order="stroke">IppO</text>`
      + `<text x="${f(CX + 16 * bw)}" y="${f(sy + 48)}" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="15" fill="${tc3}" stroke="${tc}" stroke-width="1" paint-order="stroke">${X(p.number ?? '')}</text>`
      + `<path d="M${f(CX - waistW - 1)},${f(hipY - 4)} L${f(CX + waistW + 1)},${f(hipY - 4)} L${f(CX + waistW + 2)},${f(hipY + 4)} L${f(CX - waistW - 2)},${f(hipY + 4)}Z" fill="#1b1b2a" ${st}/><rect x="${CX - 5}" y="${f(hipY - 3.5)}" width="10" height="7" rx="1.5" fill="#e9ecef" stroke="${LINE}" stroke-width="1"/>`
      + `<path d="M${f(CX - waistW - 2)},${f(hipY + 4)} L${f(CX - hipX - 14 * bw)},${f(hipY + 16)} L${f(CX + hipX + 14 * bw)},${f(hipY + 16)} L${f(CX + waistW + 2)},${f(hipY + 4)}Z" fill="url(#${u}pants)" ${st}/>`;
    // ---------- 腕 (袖・アンダーシャツ・手)・バット・グラブ・ボール ----------
    const tube = (pts, w, color) => { const d = 'M' + pts.map((q) => f(q[0]) + ',' + f(q[1])).join(' L'); return `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="${f(w * 2 + 3.2)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${f(w * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`; };
    const under = tc2 === '#1b1b2a' ? '#2a2a3a' : tc, sleeve = tc2 === '#1b1b2a' ? '#2c2c3c' : '#f4f5f8';
    const arm = (k) => { const [s0, e, h] = A[k]; const mid = [s0[0] + (e[0] - s0[0]) * 0.6, s0[1] + (e[1] - s0[1]) * 0.6];
      return tube([s0, e, h], 7.6 * bw, under) + tube([s0, mid], 10 * bw, sleeve) + `<path d="M${f(mid[0] - 7)},${f(mid[1])} L${f(mid[0] + 7)},${f(mid[1])}" stroke="${tc}" stroke-width="2"/>` + `<circle cx="${f(h[0])}" cy="${f(h[1])}" r="6.8" fill="${sk}" ${st}/>`; };
    const bat = A.bat ? (() => { const [h, ang, len] = A.bat, a = ang * Math.PI / 180, tip = [h[0] + Math.sin(a) * len, h[1] - Math.cos(a) * len], knob = [h[0] - Math.sin(a) * 12, h[1] + Math.cos(a) * 12];
      const mid = [knob[0] + (tip[0] - knob[0]) * 0.45, knob[1] + (tip[1] - knob[1]) * 0.45]; return tube([knob, mid], 2.6, '#d9ab6a') + tube([mid, tip], 5.4, '#e6bd80') + `<circle cx="${f(knob[0])}" cy="${f(knob[1])}" r="3.6" fill="#7a4a1f" ${st}/>`; })() : '';
    const glove = A.glove ? (() => { const h = A[A.glove][2]; return `<path d="M${f(h[0] - 13)},${f(h[1] + 6)} Q${f(h[0] - 16)},${f(h[1] - 16)} ${f(h[0] - 2)},${f(h[1] - 18)} Q${f(h[0] + 14)},${f(h[1] - 16)} ${f(h[0] + 13)},${f(h[1] + 4)} Q${f(h[0])},${f(h[1] + 14)} ${f(h[0] - 13)},${f(h[1] + 6)}Z" fill="url(#${u}glove)" ${st}/><path d="M${f(h[0] - 6)},${f(h[1] - 10)} l0,14 M${f(h[0])},${f(h[1] - 12)} l0,16 M${f(h[0] + 6)},${f(h[1] - 10)} l0,14" stroke="#5c3415" stroke-width="1.2"/>`; })() : '';
    const ball = A.ball ? (() => { const h = A[A.ball][2]; return `<circle cx="${f(h[0])}" cy="${f(h[1] - 7)}" r="6" fill="#fbfbf6" ${st}/><path d="M${f(h[0] - 4)},${f(h[1] - 11)} q3,4 0,8 M${f(h[0] + 4)},${f(h[1] - 11)} q-3,4 0,8" stroke="#e03131" stroke-width="1" fill="none"/>`; })() : '';
    // ---------- 首・頭・顔・髪・帽子 ----------
    const hc = [CX, top + HEAD * 0.62], hw = HEAD * 0.4;
    const neck = `<path d="M${f(CX - 7)},${f(hc[1] + 14)} L${f(CX - 8)},${f(sy - 3)} Q${CX},${f(sy + 2)} ${f(CX + 8)},${f(sy - 3)} L${f(CX + 7)},${f(hc[1] + 14)}Z" fill="${skD}" ${st}/>`;
    const face = `<path d="M${f(CX - hw)},${f(hc[1] - 6)} Q${f(CX - hw - 1)},${f(hc[1] + 10)} ${f(CX - 6)},${f(hc[1] + 18)} Q${CX},${f(hc[1] + 21)} ${f(CX + 6)},${f(hc[1] + 18)} Q${f(CX + hw + 1)},${f(hc[1] + 10)} ${f(CX + hw)},${f(hc[1] - 6)} Q${CX},${f(hc[1] - 22)} ${f(CX - hw)},${f(hc[1] - 6)}Z" fill="url(#${u}skin)" ${st}/>`
      + `<path d="M${f(CX - hw - 1)},${f(hc[1] - 1)} q-5,1 -3,8 q2,3 4,2 M${f(CX + hw + 1)},${f(hc[1] - 1)} q5,1 3,8 q-2,3 -4,2" fill="${sk}" ${st}/>`; // 耳
    const eye = (sx) => { const ex = CX + sx * 7.6, ey = hc[1] + 4.2; return `<g transform="translate(${f(ex)} ${f(ey)}) scale(1.22) translate(${f(-ex)} ${f(-ey)})">` + eye0(sx, ex, ey) + '</g>'; };
    const eye0 = (sx, ex, ey) => {
      const shape = eyeStyle === 0 ? `M${f(ex - 5)},${f(ey)} Q${f(ex)},${f(ey - 5.5)} ${f(ex + 5)},${f(ey - 0.5)} Q${f(ex)},${f(ey + 3)} ${f(ex - 5)},${f(ey)}Z` // するどい
        : eyeStyle === 1 ? `M${f(ex - 4.5)},${f(ey)} Q${f(ex)},${f(ey - 5)} ${f(ex + 4.5)},${f(ey)} Q${f(ex)},${f(ey + 4)} ${f(ex - 4.5)},${f(ey)}Z` // まるい
          : `M${f(ex - 5.2)},${f(ey + 0.5)} Q${f(ex)},${f(ey - 4.5)} ${f(ex + 5.2)},${f(ey - 1)} Q${f(ex)},${f(ey + 2.5)} ${f(ex - 5.2)},${f(ey + 0.5)}Z`; // 切れ長
      return `<path d="${shape}" fill="#fff" stroke="${LINE}" stroke-width="1.1"/><circle cx="${f(ex + sx * 0.4)}" cy="${f(ey - 0.6)}" r="2.7" fill="url(#${u}iris)"/><circle cx="${f(ex + sx * 0.4)}" cy="${f(ey - 0.6)}" r="0.9" fill="#0b0b12"/><circle cx="${f(ex - 0.8)}" cy="${f(ey - 1.8)}" r=".9" fill="#fff"/>`
        + `<path d="M${f(ex - 5.6 * sx)},${f(ey - 0.5)} Q${f(ex)},${f(ey - (eyeStyle === 1 ? 5.4 : 6))} ${f(ex + 5.4 * sx)},${f(ey - 1.4)}" fill="none" stroke="${LINE}" stroke-width="1.5"/>` // 上まぶた (まつげ)
        + `<path d="M${f(ex - 5 * sx)},${f(ey - 8.2)} L${f(ex + 5 * sx)},${f(ey - (eyeStyle === 0 ? 10.2 : 9.2))}" stroke="${hairC}" stroke-width="1.8"/>`; }; // 眉
    const mouthStyle = hash((p.id || '') + 'm') % 3;
    const mouth = mouthStyle === 0 ? `<path d="M${f(CX - 3.5)},${f(hc[1] + 13.5)} Q${CX},${f(hc[1] + 16)} ${f(CX + 3.5)},${f(hc[1] + 13)}" fill="none" stroke="${LINE}" stroke-width="1.3"/>` // ほほえみ
      : mouthStyle === 1 ? `<path d="M${f(CX - 3)},${f(hc[1] + 13.5)} L${f(CX + 3)},${f(hc[1] + 13.5)}" stroke="${LINE}" stroke-width="1.3"/>` // きりっと
        : `<path d="M${f(CX - 4)},${f(hc[1] + 12.5)} Q${CX},${f(hc[1] + 17)} ${f(CX + 4)},${f(hc[1] + 12.5)}Z" fill="#7a1f2b" stroke="${LINE}" stroke-width="1"/><path d="M${f(CX - 3)},${f(hc[1] + 12.8)} h6" stroke="#fff" stroke-width="1.2"/>`; // にっ
    const facial = eye(-1) + eye(1) + `<path d="M${f(CX + 0.5)},${f(hc[1] + 6)} l-1.5,4 l2,0.5" fill="none" stroke="${skD}" stroke-width="1.2"/>` + mouth
      + `<ellipse cx="${f(CX - 9)}" cy="${f(hc[1] + 9)}" rx="3" ry="1.4" fill="#ff8787" opacity=".25"/><ellipse cx="${f(CX + 9)}" cy="${f(hc[1] + 9)}" rx="3" ry="1.4" fill="#ff8787" opacity=".25"/>`
      + (look.beard ? `<path d="M${f(CX - 10)},${f(hc[1] + 12)} Q${CX},${f(hc[1] + 24)} ${f(CX + 10)},${f(hc[1] + 12)} Q${CX},${f(hc[1] + 18)} ${f(CX - 10)},${f(hc[1] + 12)}Z" fill="${hairC}" opacity=".8"/>` : '');
    // 髪 (帽子の下から出るところ): 0 短い・1 もみあげ長め・2 うしろが長い・3 外はね・4 ぼうず
    const hb = hc[1] - 9, hairBack = hairStyle === 2 ? `<path d="M${f(CX - hw - 3)},${f(hb)} Q${f(CX - hw - 8)},${f(hc[1] + 22)} ${f(CX - hw + 2)},${f(hc[1] + 26)} L${f(CX + hw - 2)},${f(hc[1] + 26)} Q${f(CX + hw + 8)},${f(hc[1] + 22)} ${f(CX + hw + 3)},${f(hb)}Z" fill="${hairC}" ${st}/>` : '';
    const sideHair = hairStyle === 4 ? '' : [-1, 1].map((s) => `<path d="M${f(CX + s * (hw + 1))},${f(hb - 2)} Q${f(CX + s * (hw + (hairStyle === 3 ? 7 : 2)))},${f(hc[1] + (hairStyle === 1 ? 12 : 6))} ${f(CX + s * (hw - 3))},${f(hc[1] + (hairStyle === 1 ? 13 : 5))} Q${f(CX + s * (hw - 2))},${f(hb + 4)} ${f(CX + s * (hw - 6))},${f(hb)}Z" fill="${hairC}" ${st}/>`).join('');
    const bangs = hairStyle === 4 ? '' : `<path d="M${f(CX - hw + 2)},${f(hb + 1)} L${f(CX - 9)},${f(hb + 6.5)} L${f(CX - 5)},${f(hb + 2)} L${f(CX + 1)},${f(hb + 7)} L${f(CX + 4)},${f(hb + 2)} L${f(CX + 10)},${f(hb + 6)} L${f(CX + hw - 2)},${f(hb + 1)}Z" fill="${hairC}" ${st}/>`;
    const cap = `<path d="M${f(CX - hw - 2)},${f(hb + 1)} Q${f(CX - hw - 2)},${f(top - 2)} ${CX},${f(top - 3)} Q${f(CX + hw + 2)},${f(top - 2)} ${f(CX + hw + 2)},${f(hb + 1)}Z" fill="url(#${u}cap)" ${st}/>`
      + `<path d="M${f(CX - hw - 4)},${f(hb + 1)} Q${CX},${f(hb - 3)} ${f(CX + hw + 4)},${f(hb + 1)} Q${f(CX + hw + 9)},${f(hb + 5)} ${CX},${f(hb + 5.5)} Q${f(CX - hw - 9)},${f(hb + 5)} ${f(CX - hw - 4)},${f(hb + 1)}Z" fill="${tc}" ${st}/>` // つば
      + `<text x="${CX}" y="${f(top + 15)}" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="12" fill="${tc3}">i</text><circle cx="${CX}" cy="${f(top - 2)}" r="2" fill="${tc}"/>`;
    const head = neck + hairBack + face + facial + sideHair + bangs + cap;
    const front = lefty ? 'R' : 'L', back = lefty ? 'L' : 'R'; // バット・ボールを持つ腕を手前に
    const body = `<g transform="translate(${CX} ${f(footY)}) scale(${f(ht)}) translate(${-CX} ${f(-footY)})">${legSvg}${torso}${arm(back)}${bat}${arm(front)}${A.glove ? glove : ''}${ball}${head}</g>`;
    // ---------- 背景 ----------
    const W = 200, Hh = 260;
    const rays = Array.from({ length: 10 }, (_, i) => { const a = -80 + i * 17; return `<path d="M100,130 L${f(100 + Math.cos(a * Math.PI / 180) * 260)},${f(130 + Math.sin(a * Math.PI / 180) * 260)} L${f(100 + Math.cos((a + 7) * Math.PI / 180) * 260)},${f(130 + Math.sin((a + 7) * Math.PI / 180) * 260)}Z" fill="${rim}" opacity=".08"/>`; }).join('');
    const vb = crop === 'face' ? `62 2 76 80` : `0 0 ${W} ${Hh}`;
    const sp = (p.specials || []).length;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${Math.round(size * (crop === 'face' ? 80 / 76 : Hh / W))}" role="img" aria-label="${X(p.name)}">
<defs>
<radialGradient id="${u}bg" cx="50%" cy="38%" r="78%"><stop offset="0" stop-color="${b1}"/><stop offset="1" stop-color="${b2}"/></radialGradient>
${g('jersey', [[0, tc2 === '#1b1b2a' ? '#3a3a4c' : '#ffffff'], [0.6, tc2], [1, tc2 === '#1b1b2a' ? '#121218' : '#c9ced8']], 1, 1)}
${g('pants', [[0, '#ffffff'], [1, '#c3c8d2']], 1, 0)}
${g('cap', [[0, tc], [1, '#0d0d16']])}
${g('skin', [[0, sk], [1, skD]])}
${g('bat', [[0, '#f0d29a'], [1, '#b07a3c']], 1, 0)}
${g('glove', [[0, '#c27a3c'], [1, '#6b3a16']])}
<radialGradient id="${u}iris" cx="50%" cy="65%" r="70%"><stop offset="0" stop-color="${rim}"/><stop offset=".6" stop-color="${rim}"/><stop offset="1" stop-color="#3b3560"/></radialGradient>
${g('rb', [[0, '#ff6b6b'], [0.25, '#ffd43b'], [0.5, '#69db7c'], [0.75, '#4dabf7'], [1, '#da77f2']], 1, 1)}
${g('fl', [[0, '#000', 0], [1, '#000', 0.78]])}
<filter id="${u}gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter>
</defs>
<rect width="${W}" height="${Hh}" rx="14" fill="url(#${u}bg)"/>${rar === 'SSR' ? `<rect width="${W}" height="${Hh}" fill="url(#${u}rb)" opacity=".2"/>` : ''}${rays}
<text x="${lefty ? 52 : 148}" y="140" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="110" fill="${rim}" opacity=".14">${X(p.number ?? '')}</text>
<ellipse cx="100" cy="${f(footY * ht + (1 - ht) * footY)}" rx="58" ry="7" fill="#000" opacity=".35" filter="url(#${u}gl)"/>
<g>
  <g opacity=".7" filter="url(#${u}gl)" fill="${rim}" stroke="${rim}" stroke-width="6">${body.replace(/fill="[^"]*"/g, `fill="${rim}"`).replace(/url\(#[^)]*\)/g, rim)}</g>
  ${body}
</g>
${crop === 'face' ? '' : `<rect y="${Hh - 66}" width="${W}" height="66" fill="url(#${u}fl)"/>
${name ? `<text x="12" y="${Hh - 32}" font-family="sans-serif" font-weight="900" font-size="11.5" fill="${rim}">${X(p.kind === 'P' ? '投手' : '野手')} · ${X(p.pos || '')}${sp ? ' · ★' + sp : ''}</text>
<text x="12" y="${Hh - 13}" font-family="sans-serif" font-weight="900" font-size="18" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${X(p.name)}</text>` : ''}
<text x="${W - 12}" y="26" text-anchor="end" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="18" fill="${rim}" stroke="#000" stroke-width="2.5" paint-order="stroke">${X(rar)}</text>`}
<rect x="1.5" y="1.5" width="${W - 3}" height="${Hh - 3}" rx="13" fill="none" stroke="${rim}" stroke-opacity=".7" stroke-width="2.5"/>
</svg>`;
  }
  root.BBIllust = { svg };
  if (typeof module === 'object' && module.exports) module.exports = root.BBIllust;
})(typeof self !== 'undefined' ? self : this);
