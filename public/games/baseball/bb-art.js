// =====================================================================
// IppO ベースボール: 選手画像を自動で作る (かっこいいシルエット)
//   ・選手のデータ (id・投手か野手か・守備位置・右投げ/左打ち・体格・背番号・レア度・特殊能力) から、いつも同じ絵ができる
//   ・2D の骨組み (腰・背骨・首・腕・脚・バット) を角度で決めて、太い線でつなぐ → 黒いシルエット + 色のふち光
//   ・背景はレア度の色 (N 青灰・R 青・SR 紫・SSR 金と虹)、斜めの光の線、大きな背番号
//   ・文字 (名前) は XML としてエスケープしてから SVG に入れる
// =====================================================================
(function (root) {
  const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (seed) => { let s = seed || 1; return () => { s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5 | 0; return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; };
  // ポーズ: 角度 (度。0 = 真下、90 = 右、180 = 真上、-90 = 左)。f = 前の脚・腕 (画面の左が前)、b = うしろ
  // spine: 背骨、neck: 首、uaF/faF: 前の腕 (上腕・前腕)、uaB/faB: うしろの腕、thF/shF: 前の脚、thB/shB: うしろの脚、bat: バットの向き (手から)
  // (前 = 画面の左。右打ち・右投げの形で描いて、左打ち・左投げは左右を反転)
  const POSES = {
    swing: { spine: 172, neck: 186, uaF: 222, faF: 168, uaB: 205, faB: 150, thF: -22, shF: -8, thB: 28, shB: 78, bat: 112, glove: false },             // 振りきったフォロー
    stance: { spine: 188, neck: 182, uaF: 58, faF: 168, uaB: 42, faB: 175, thF: -26, shF: 6, thB: 26, shB: -6, bat: 158, glove: false },              // 構え
    load: { spine: 194, neck: 184, uaF: 70, faF: 160, uaB: 52, faB: 170, thF: -60, shF: 25, thB: 20, shB: -4, bat: 140, glove: false },                // 足を上げてタイミング
    kick: { spine: 180, neck: 182, uaF: 15, faF: 165, uaB: -12, faB: 150, thF: -96, shF: 12, thB: 2, shB: 0, glove: true },                           // 投手: 足を高く上げる
    release: { spine: 214, neck: 205, uaF: -35, faF: 25, uaB: 200, faB: 236, thF: -46, shF: -4, thB: 62, shB: 104, glove: true },                    // 投手: リリース
    follow: { spine: 246, neck: 238, uaF: -10, faF: 40, uaB: -48, faB: -8, thF: -38, shF: 8, thB: 112, shB: 158, glove: true },                       // 投手: 投げ終わり
    throw: { spine: 200, neck: 192, uaF: -78, faF: -96, uaB: 140, faB: 112, thF: -48, shF: 6, thB: 44, shB: 92, glove: true },                        // 野手: 送球
    dive: { spine: 268, neck: 262, uaF: -92, faF: -94, uaB: 205, faB: 170, thF: 96, shF: 90, thB: 80, shB: 70, glove: true, lift: 70 },               // 野手: ダイビングキャッチ
  };
  const BG = { N: ['#2b3a55', '#0d1424', '#7a8bb0'], R: ['#1c4fbf', '#081736', '#74c0fc'], SR: ['#6f2dbd', '#1a0838', '#e599f7'], SSR: ['#e08c00', '#2b1200', '#ffe066'] };
  function svg(p, { size = 200, name = true } = {}) {
    const W = 200, H = 260, r = rng(hash(p.id || p.name)), rar = BG[p.rarity] ? p.rarity : 'N', [c1, c2, rim] = BG[rar];
    const look = p.look || {}, build = Math.max(0.85, Math.min(1.2, look.build || 1)), tall = Math.max(0.92, Math.min(1.08, look.h || 1));
    // ポーズを選ぶ (投手は投球、野手は打撃が多め。捕手・内野手はたまに守備)
    const list = p.kind === 'P' ? ['kick', 'release', 'follow'] : ['swing', 'stance', 'load', 'swing', ...(['捕', '遊', '二', '三'].includes(p.pos) ? ['throw', 'dive'] : ['throw'])];
    const pose = POSES[list[Math.floor(r() * list.length)]];
    const lefty = p.kind === 'P' ? r() < 0.25 : look.bat === 'L';
    // 骨組み → 点
    const v = (a, len) => [Math.sin(a * Math.PI / 180) * len, Math.cos(a * Math.PI / 180) * len];
    const S = 1.0 * tall, hip = [100, 152 - (pose.lift || 0) * 0.3];
    const add = (p0, a, len) => { const d = v(a, len * S); return [p0[0] + d[0], p0[1] + d[1]]; };
    const neckB = add(hip, pose.spine, 58), head = add(neckB, pose.neck, 17);
    const shF = add(neckB, pose.spine + 180, 4), shB = add(neckB, pose.spine + 180, 2);
    const elF = add(shF, pose.uaF, 30), haF = add(elF, pose.faF, 28), elB = add(shB, pose.uaB, 30), haB = add(elB, pose.faB, 28);
    const knF = add(hip, pose.thF, 42), ftF = add(knF, pose.shF, 42), knB = add(hip, pose.thB, 42), ftB = add(knB, pose.shB, 42);
    const seg = (a, b, w) => `<path d="M${a[0].toFixed(1)},${a[1].toFixed(1)} L${b[0].toFixed(1)},${b[1].toFixed(1)}" stroke-width="${(w * build).toFixed(1)}"/>`;
    const torso = (() => { // 胴体: 肩が広く腰が細い台形
      const [dx, dy] = v(pose.spine + 90, 1), wS = 18 * build, wH = 13 * build;
      const pts = [[neckB[0] + dx * wS, neckB[1] + dy * wS], [neckB[0] - dx * wS, neckB[1] - dy * wS], [hip[0] - dx * wH, hip[1] - dy * wH], [hip[0] + dx * wH, hip[1] + dy * wH]];
      return `<path d="M${pts.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' L')} Z" stroke-width="8"/>`;
    })();
    const capDir = v(pose.neck + 180, 1);
    const capBrim = [head[0] - 6 + capDir[1] * 0, head[1] - 4];
    const bat = pose.bat !== undefined ? (() => { const mid = [(haF[0] + haB[0]) / 2, (haF[1] + haB[1]) / 2], tip = add(mid, pose.bat, 70); return `<path d="M${mid[0].toFixed(1)},${mid[1].toFixed(1)} L${tip[0].toFixed(1)},${tip[1].toFixed(1)}" stroke-width="5.5"/><circle cx="${tip[0].toFixed(1)}" cy="${tip[1].toFixed(1)}" r="4"/>`; })() : '';
    const glove = pose.glove ? `<ellipse cx="${haF[0].toFixed(1)}" cy="${haF[1].toFixed(1)}" rx="9" ry="11"/>` : '';
    const figure = `<g stroke-linecap="round" stroke-linejoin="round">
      ${seg(hip, knB, 20)}${seg(knB, ftB, 15)}${seg(shB, elB, 14)}${seg(elB, haB, 11)}
      ${torso}${seg(neckB, head, 9)}
      <circle cx="${head[0].toFixed(1)}" cy="${head[1].toFixed(1)}" r="${(13.5 * build).toFixed(1)}"/>
      <path d="M${(head[0] - 13).toFixed(1)},${(head[1] - 2).toFixed(1)} Q${head[0].toFixed(1)},${(head[1] - 20).toFixed(1)} ${(head[0] + 13).toFixed(1)},${(head[1] - 2).toFixed(1)} L${(head[0] - 23).toFixed(1)},${(head[1] - 1).toFixed(1)} Z"/>
      ${seg(hip, knF, 20)}${seg(knF, ftF, 15)}
      <path d="M${ftF[0].toFixed(1)},${ftF[1].toFixed(1)} l-11,2" stroke-width="7"/><path d="M${ftB[0].toFixed(1)},${ftB[1].toFixed(1)} l-11,2" stroke-width="7"/>
      ${seg(shF, elF, 14)}${seg(elF, haF, 11)}${glove}${bat}</g>`;
    // 背景: 光の線・大きな背番号・地面の光
    const streaks = Array.from({ length: 7 }, (_, i) => { const x = -40 + i * 45 + r() * 20, w = 6 + r() * 14; return `<path d="M${x.toFixed(0)},270 L${(x + 120).toFixed(0)},-10 L${(x + 120 + w).toFixed(0)},-10 L${(x + w).toFixed(0)},270Z" fill="${rim}" opacity="${(0.06 + r() * 0.1).toFixed(2)}"/>`; }).join('');
    const u = 'a' + (hash((p.id || '') + size) % 1e8).toString(36);
    const ssr = rar === 'SSR' ? `<rect width="${W}" height="${H}" fill="url(#${u}rb)" opacity=".22"/>` : '';
    const sp = (p.specials || []).length;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${size}" height="${Math.round(size * H / W)}" role="img" aria-label="${X(p.name)}">
<defs>
<radialGradient id="${u}bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>
<linearGradient id="${u}rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".25" stop-color="#ffd43b"/><stop offset=".5" stop-color="#69db7c"/><stop offset=".75" stop-color="#4dabf7"/><stop offset="1" stop-color="#da77f2"/></linearGradient>
<filter id="${u}gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
<linearGradient id="${u}fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="14" fill="url(#${u}bg)"/>${ssr}${streaks}
<text x="${lefty ? 60 : 140}" y="150" text-anchor="middle" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="120" fill="${rim}" opacity=".16">${X(p.number ?? '')}</text>
<ellipse cx="100" cy="${(Math.max(ftF[1], ftB[1]) + 6).toFixed(0)}" rx="62" ry="8" fill="${rim}" opacity=".28" filter="url(#${u}gl)"/>
<g transform="${lefty ? 'translate(200 0) scale(-1 1)' : ''}">
  <g stroke="${rim}" fill="${rim}" opacity=".85" filter="url(#${u}gl)">${figure}</g>
  <g stroke="#06070c" fill="#06070c">${figure}</g>
</g>
<rect y="${H - 70}" width="${W}" height="70" fill="url(#${u}fl)"/>
${name ? `<text x="12" y="${H - 34}" font-family="sans-serif" font-weight="900" font-size="12" fill="${rim}">${X(p.kind === 'P' ? '投手' : '野手')} · ${X(p.pos || '')}${sp ? ' · ★' + sp : ''}</text>
<text x="12" y="${H - 14}" font-family="sans-serif" font-weight="900" font-size="18" fill="#fff">${X(p.name)}</text>` : ''}
<text x="${W - 12}" y="26" text-anchor="end" font-family="'Arial Black',Arial,sans-serif" font-weight="900" font-size="18" fill="${rim}">${X(rar)}</text>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="13" fill="none" stroke="${rim}" stroke-opacity=".6" stroke-width="2"/>
</svg>`;
  }
  root.BBArt = { svg };
  if (typeof module === 'object' && module.exports) module.exports = root.BBArt;
})(typeof self !== 'undefined' ? self : this);
