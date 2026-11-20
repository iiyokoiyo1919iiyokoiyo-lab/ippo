// =====================================================================
// シティバトル: 見た目 (リアルな街・キャラクター・光と影・画面の仕上げ)
//   ・画像ファイルは使わず、壁・アスファルト・歩道・草などの質感はすべてプログラムで描く (手続き的なテクスチャ)
//   ・PBR (MeshStandardMaterial)・空 (Sky)・空からの映りこみ (PMREM)・太陽の影・ACES の色・ブルーム・AO・FXAA
//   ・画質は 4 段階 (low / medium / high / ultra)。スマホは high、パソコンは ultra (最高) から始まる (画面の ⚙️ で変えられる)
//   ・最高: MSAA 4x + SMAA・影 4096・テクスチャ 1024・街の映りこみ・色の仕上げ・公園の草 (風でゆれる)
//   ・重くなったら解像度を自動で下げ、軽くなったら上げる (動的解像度)
//   ・当たり判定 (arena-map.js) は変えない。見た目だけ
// =====================================================================
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from './vendor/jsm/postprocessing/GTAOPass.js';
import { FXAAShader } from './vendor/jsm/shaders/FXAAShader.js';
import { SMAAPass } from './vendor/jsm/postprocessing/SMAAPass.js';
import { Sky } from './vendor/jsm/objects/Sky.js';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';

const BLOCK = 18, ROAD = 8, CURB = 0.15;
let N = 9; // ブロックの数 (arena-map.js の N。createGraphics で受けとる)
const QUALITY = {
  low: { pr: 1, shadow: 0, bloom: false, ao: false, texSize: 256, props: 0.5 },
  medium: { pr: 1.5, shadow: 1024, bloom: true, ao: false, texSize: 512, props: 1 },
  high: { pr: 2, shadow: 2048, bloom: true, ao: true, texSize: 512, props: 1, envCity: true, grade: true },
  ultra: { pr: 3, shadow: 4096, shadowRange: 60, bloom: true, ao: true, texSize: 1024, props: 1, envCity: true, grade: true, msaa: 4, smaa: true, grass: true },
};
let ANISO = 8; // テクスチャのななめから見たときのくっきりさ (GPU の最大にする)

// ---------- 乱数・ノイズ ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function speckle(g, w, h, n, r, cols, alpha, R) { for (let i = 0; i < n; i++) { g.globalAlpha = alpha * (0.4 + R() * 0.6); g.fillStyle = cols[Math.floor(R() * cols.length)]; const s = r * (0.5 + R()); g.fillRect(R() * w, R() * h, s, s); } g.globalAlpha = 1; }
// 高さ (明るさ) の絵から法線マップを作る (でこぼこの陰影)
function normalFrom(heightCanvas, strength = 2) {
  const w = heightCanvas.width, h = heightCanvas.height, src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), g = out.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength, L = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (dx / L * 0.5 + 0.5) * 255; d[i + 1] = (dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return out;
}
function tex(c, { srgb = true, repeat = true, aniso = ANISO } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t;
}

// ---------- 質感 (手続き的なテクスチャ) ----------
function makeMaterials(S, R) {
  const M = {};
  // アスファルト: 粒・つぎはぎ・ひび
  { const c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d');
    g.fillStyle = '#34363b'; g.fillRect(0, 0, S, S); hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(${20 + R() * 30},${20 + R() * 30},${25 + R() * 30},.25)`; g.beginPath(); g.ellipse(R() * S, R() * S, S * (0.1 + R() * 0.2), S * (0.05 + R() * 0.15), R() * 3, 0, 7); g.fill(); }
    speckle(g, S, S, S * 40, 1.6, ['#1f2024', '#4a4c52', '#5c5e63', '#2a2b2f'], 0.7, R); speckle(hg, S, S, S * 40, 1.6, ['#606060', '#a0a0a0'], 0.8, R);
    g.strokeStyle = 'rgba(15,15,18,.55)'; hg.strokeStyle = '#303030'; for (let k = 0; k < 5; k++) { let x = R() * S, y = R() * S; g.beginPath(); hg.beginPath(); g.moveTo(x, y); hg.moveTo(x, y); for (let s = 0; s < 14; s++) { x += (R() - 0.5) * 22; y += (R() - 0.5) * 22; g.lineTo(x, y); hg.lineTo(x, y); } g.lineWidth = hg.lineWidth = 1.2; g.stroke(); hg.stroke(); }
    const rc = canvas(S), rg = rc.getContext('2d'); rg.fillStyle = '#ededed'; rg.fillRect(0, 0, S, S); speckle(rg, S, S, S * 10, 2, ['#d0d0d0', '#ffffff'], 0.6, R);
    M.asphalt = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: tex(normalFrom(hc, 3), { srgb: false }), roughnessMap: tex(rc, { srgb: false }), roughness: 0.95, metalness: 0, envMapIntensity: 1.2 }); }
  // 歩道: タイル・目地・よごれ
  { const c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d'), n = 4, cell = S / n;
    g.fillStyle = '#a9a69e'; g.fillRect(0, 0, S, S); hg.fillStyle = '#c0c0c0'; hg.fillRect(0, 0, S, S);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 150 + R() * 30; g.fillStyle = `rgb(${v},${v - 3},${v - 10})`; g.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4); }
    speckle(g, S, S, S * 18, 1.3, ['#8a877f', '#bdbab2', '#6f6c66'], 0.5, R);
    hg.strokeStyle = '#404040'; hg.lineWidth = 4; g.strokeStyle = '#77736b'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, S); g.moveTo(0, i * cell); g.lineTo(S, i * cell); g.stroke(); hg.beginPath(); hg.moveTo(i * cell, 0); hg.lineTo(i * cell, S); hg.moveTo(0, i * cell); hg.lineTo(S, i * cell); hg.stroke(); }
    M.sidewalk = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: tex(normalFrom(hc, 2.5), { srgb: false }), roughness: 0.85 });
    M.curb = new THREE.MeshStandardMaterial({ color: '#b8b4ab', roughness: 0.8 }); }
  // 草
  { const c = canvas(S), g = c.getContext('2d'); g.fillStyle = '#4f7a2d'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 30; i++) { const x = R() * S, y = R() * S, l = 3 + R() * 6; g.strokeStyle = ['#5f8f34', '#3f6624', '#76a443', '#4a7329'][Math.floor(R() * 4)]; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y - l); g.stroke(); } g.globalAlpha = 1;
    M.grass = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 1 }); }
  // 屋上: 防水シート
  { const c = canvas(S / 2), g = c.getContext('2d'); g.fillStyle = '#6b6d70'; g.fillRect(0, 0, S / 2, S / 2); speckle(g, S / 2, S / 2, S * 8, 2, ['#5a5c5f', '#7d7f82', '#4e5053'], 0.6, R);
    M.roof = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.95 }); }
  // 木箱
  { const c = canvas(S / 2), g = c.getContext('2d'), s = S / 2; g.fillStyle = '#9a6b3f'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#8b5e35' : '#a5743f'; g.fillRect(0, (i * s) / 6, s, s / 6 - 2); }
    for (let i = 0; i < s * 6; i++) { g.fillStyle = 'rgba(60,35,15,.25)'; g.fillRect(R() * s, R() * s, 6 + R() * 18, 1); }
    g.strokeStyle = '#5c3b1e'; g.lineWidth = s / 14; g.strokeRect(0, 0, s, s); g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.stroke();
    M.crate = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.8 }); }
  // コンクリートの壁 (公園の壁・まわりの壁)
  { const c = canvas(S / 2), g = c.getContext('2d'), s = S / 2; g.fillStyle = '#9d9a94'; g.fillRect(0, 0, s, s); speckle(g, s, s, s * 30, 1.5, ['#8a8781', '#aeaba5', '#7c7973'], 0.5, R);
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(70,65,60,.18)'; g.fillRect(R() * s, 0, 2 + R() * 4, s); }
    g.strokeStyle = 'rgba(60,58,55,.6)'; g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2);
    M.concrete = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.9 }); }
  return M;
}

// ビルの外壁: 1 マス = 幅 3m × 1 階 (3m)。4 つの種類 (れんが・コンクリート・ガラス・しっくい)
function makeFacade(style, S, R, tint) {
  const c = canvas(S), g = c.getContext('2d'), hc = canvas(S), hg = hc.getContext('2d'), rc = canvas(S), rg = rc.getContext('2d'), ec = canvas(S), eg = ec.getContext('2d');
  const wall = new THREE.Color(tint), wallCss = `#${wall.getHexString()}`;
  hg.fillStyle = '#909090'; hg.fillRect(0, 0, S, S); rg.fillStyle = '#e6e6e6'; rg.fillRect(0, 0, S, S); eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
  const win = { x: S * 0.18, y: S * 0.2, w: S * 0.64, h: S * 0.52 };
  if (style === 'glass') { win.x = S * 0.04; win.y = S * 0.06; win.w = S * 0.92; win.h = S * 0.84; }
  if (style === 'concrete') { win.x = S * 0.1; win.w = S * 0.8; win.h = S * 0.46; }
  // 壁
  g.fillStyle = wallCss; g.fillRect(0, 0, S, S);
  if (style === 'brick') {
    const bw = S / 8, bh = S / 22;
    for (let y = 0; y < S; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < S; x += bw) {
      const v = wall.clone().offsetHSL(0, 0, (R() - 0.5) * 0.08); g.fillStyle = `#${v.getHexString()}`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      hg.fillStyle = '#b0b0b0'; hg.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
    g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#cfc6b8'; g.fillRect(0, 0, S, S); g.globalCompositeOperation = 'source-over';
  } else {
    speckle(g, S, S, S * 14, 1.5, [`#${wall.clone().offsetHSL(0, 0, -0.06).getHexString()}`, `#${wall.clone().offsetHSL(0, 0, 0.05).getHexString()}`], 0.5, R);
    if (style === 'concrete') { g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.strokeRect(1, 1, S - 2, S - 2); hg.strokeStyle = '#505050'; hg.lineWidth = 3; hg.strokeRect(1, 1, S - 2, S - 2); }
  }
  // 雨のしみ (下にのびる)
  for (let i = 0; i < 3; i++) { const x = R() * S, gr = g.createLinearGradient(0, win.y + win.h, 0, S); gr.addColorStop(0, 'rgba(40,35,30,.18)'); gr.addColorStop(1, 'rgba(40,35,30,0)'); g.fillStyle = gr; g.fillRect(x, win.y + win.h, 6 + R() * 10, S); }
  // 窓: 枠・ガラス (空が映ったようなグラデーション)・一部はカーテンや室内の明かり
  const frame = style === 'glass' ? '#2b3036' : '#e9e6df';
  g.fillStyle = frame; g.fillRect(win.x - 6, win.y - 6, win.w + 12, win.h + 12);
  const gl = g.createLinearGradient(win.x, win.y, win.x + win.w * 0.4, win.y + win.h);
  const glassTop = style === 'glass' ? '#5d7f9a' : '#6e8aa3', glassBot = style === 'glass' ? '#22313f' : '#1d2630';
  gl.addColorStop(0, glassTop); gl.addColorStop(0.55, glassBot); gl.addColorStop(1, '#141a20'); g.fillStyle = gl; g.fillRect(win.x, win.y, win.w, win.h);
  if (R() < 0.45 && style !== 'glass') { g.fillStyle = ['#d8c9a8', '#b9c4cf', '#c9a59a'][Math.floor(R() * 3)]; g.globalAlpha = 0.85; g.fillRect(win.x, win.y, win.w * (0.3 + R() * 0.3), win.h); g.globalAlpha = 1; }
  // 窓の明かり (夕方なので、ところどころ点いている)
  if (R() < 0.3) { eg.fillStyle = '#ffcf8a'; eg.globalAlpha = 0.55; eg.fillRect(win.x, win.y, win.w, win.h); }
  g.strokeStyle = frame; g.lineWidth = style === 'glass' ? 5 : 4; g.beginPath(); g.moveTo(win.x + win.w / 2, win.y); g.lineTo(win.x + win.w / 2, win.y + win.h); if (style !== 'glass') { g.moveTo(win.x, win.y + win.h * 0.35); g.lineTo(win.x + win.w, win.y + win.h * 0.35); } g.stroke();
  g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(win.x, win.y + win.h * 0.7); g.lineTo(win.x + win.w * 0.35, win.y); g.lineTo(win.x + win.w * 0.5, win.y); g.lineTo(win.x, win.y + win.h); g.fill(); // 映りこみ
  if (style !== 'glass') { g.fillStyle = '#d6d2c8'; g.fillRect(win.x - 10, win.y + win.h + 4, win.w + 20, S * 0.03); hg.fillStyle = '#e0e0e0'; hg.fillRect(win.x - 10, win.y + win.h + 4, win.w + 20, S * 0.03); } // 窓台
  if (style === 'plaster' && R() < 0.6) { g.strokeStyle = '#2f3337'; g.lineWidth = 3; for (let x = win.x - 8; x <= win.x + win.w + 8; x += 14) { g.beginPath(); g.moveTo(x, win.y + win.h * 0.62); g.lineTo(x, win.y + win.h + 6); g.stroke(); } g.fillStyle = '#2f3337'; g.fillRect(win.x - 10, win.y + win.h * 0.6, win.w + 20, 4); } // ベランダの手すり
  // 窓はへこみ (法線)・つるつる (ラフネス)
  hg.fillStyle = '#303030'; hg.fillRect(win.x, win.y, win.w, win.h);
  rg.fillStyle = style === 'glass' ? '#1a1a1a' : '#262626'; rg.fillRect(win.x, win.y, win.w, win.h);
  const m = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: tex(normalFrom(hc, style === 'brick' ? 2.5 : 1.5), { srgb: false }), roughnessMap: tex(rc, { srgb: false }), roughness: 1,
    metalness: style === 'glass' ? 0.35 : 0.05, emissiveMap: tex(ec), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, envMapIntensity: style === 'glass' ? 1.6 : 1 });
  return m;
}

// 箱の UV を、面の大きさ (m) ÷ tile にする (外壁のマスが同じ大きさでならぶ)
function tiledBox(w, h, d, tile = 3) {
  const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(dims[f][0] / tile)), uv.getY(i) * Math.max(1, Math.round(dims[f][1] / tile))); }
  return geo;
}

// 建物の中の質感: 室内の壁・床 (タイル / 木)・天井・カウンター・棚と商品・看板 (少し明るめ: 中は日が当たらない)
function makeInteriorMaterials(R) {
  const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: color, emissiveIntensity: 0.05, envMapIntensity: 0.35, ...extra });
  const tileC = canvas(128), tg = tileC.getContext('2d'); tg.fillStyle = '#e9ecef'; tg.fillRect(0, 0, 128, 128); tg.strokeStyle = '#ced4da'; tg.lineWidth = 3; tg.strokeRect(0, 0, 128, 128); speckle(tg, 128, 128, 300, 1.5, ['#dee2e6', '#f8f9fa'], 0.5, R);
  const woodC = canvas(128), wg = woodC.getContext('2d'); wg.fillStyle = '#9c6b3f'; wg.fillRect(0, 0, 128, 128); for (let i = 0; i < 8; i++) { wg.fillStyle = i % 2 ? '#8a5c34' : '#a9774a'; wg.fillRect(0, i * 16, 128, 15); } for (let i = 0; i < 300; i++) { wg.fillStyle = 'rgba(60,35,15,.2)'; wg.fillRect(R() * 128, R() * 128, 10 + R() * 20, 1); }
  const goodsC = canvas(256, 64), gg = goodsC.getContext('2d'); gg.fillStyle = '#f1f3f5'; gg.fillRect(0, 0, 256, 64); for (let x = 2; x < 256; x += 10 + R() * 8) { const w = 6 + R() * 8, h = 30 + R() * 30; gg.fillStyle = ['#e03131', '#1971c2', '#f08c00', '#2f9e44', '#ae3ec9', '#ffd43b', '#0c8599'][Math.floor(R() * 7)]; gg.fillRect(x, 64 - h, w, h); gg.fillStyle = 'rgba(255,255,255,.5)'; gg.fillRect(x + 1, 64 - h + 3, w - 2, 4); }
  const signMat = (text, bg, fg) => { const c = canvas(512, 110), g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 512, 110); g.fillStyle = fg; g.font = '900 64px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 58); const t = tex(c, { repeat: false }); return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.5 }); };
  const tile = lit('#e6e6e6', { map: tex(tileC), roughness: 0.35 }), wood = lit('#ffffff', { map: tex(woodC), emissiveIntensity: 0.04 });
  return { wall: lit('#d9d2c5'), ceiling: lit('#e9ecef', { emissiveIntensity: 0.1 }), tile, wood,
    counter: lit('#495057'), counterTop: lit('#dee2e6', { roughness: 0.3 }), shelf: lit('#adb5bd', { metalness: 0.4 }), metal: lit('#868e96', { metalness: 0.7, roughness: 0.4 }),
    goods: lit('#ffffff', { map: tex(goodsC, { repeat: false }), emissiveIntensity: 0.18 }), leaf: lit('#2f9e44', { flatShading: true }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff8e6', emissiveIntensity: 1.4 }),
    sign: { shop: signMat('コンビニ 24h', '#2b8a3e', '#ffffff'), cafe: signMat('CAFE ☕', '#5c3d2e', '#ffe8cc'), lobby: signMat('OFFICE', '#1c2b4a', '#e7f5ff') } };
}

// ---------- 描画のしくみ ----------
export function createGraphics({ canvasEl, isTouch, map, A }) {
  N = A.N;
  const inParkBlock = (i, j) => i >= A.PARK.i0 && i <= A.PARK.i1 && j >= A.PARK.j0 && j <= A.PARK.j1;
  const inHankaBlock = (i, j) => i >= A.HANKA.i0 && i <= A.HANKA.i1 && j >= A.HANKA.j0 && j <= A.HANKA.j1;
  let qName = (() => { try { return localStorage.getItem('arena_quality'); } catch { return null; } })();
  if (!QUALITY[qName]) qName = isTouch ? 'high' : 'ultra';
  const Q = QUALITY[qName];
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
  ANISO = Q.texSize >= 1024 ? renderer.capabilities.getMaxAnisotropy() : Q.texSize >= 512 ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 2;
  const PR_MAX = Math.min(devicePixelRatio, Q.pr); let PR = PR_MAX; // PR: いまの解像度 (重いと下げる)
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = !!Q.shadow; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
  const R = rng(9137);

  // 空と太陽 (夕方の少し前・あたたかい光)
  const sky = new Sky(); sky.scale.setScalar(1000); sky.userData.keep = true; scene.add(sky);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(215));
  sky.material.uniforms.turbidity.value = 3.2; sky.material.uniforms.rayleigh.value = 2.4; sky.material.uniforms.mieCoefficient.value = 0.004; sky.material.uniforms.mieDirectionalG.value = 0.86;
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  // 空を映りこみ (環境光) にする
  const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), sky2 = new Sky(); sky2.scale.setScalar(1000);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = sky.material.uniforms[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sunDir); envScene.add(sky2);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.fog = new THREE.FogExp2('#a9b6c4', 0.0042);
  const sun = new THREE.DirectionalLight('#ffd6a0', 2.6); sun.position.copy(sunDir).multiplyScalar(90); scene.add(sun, sun.target);
  if (Q.shadow) {
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const SR = Q.shadowRange || 40; Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 260 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  }
  scene.add(new THREE.HemisphereLight('#bcd3ee', '#4b4036', 0.35));

  const S = Q.texSize, M = makeMaterials(S, R);
  const shadowy = (o) => { if (Q.shadow) { o.castShadow = true; o.receiveShadow = true; } return o; };
  const receive = (o) => { if (Q.shadow) o.receiveShadow = true; return o; };

  // 地面 (道路のアスファルト。1 枚で 4m ごとにくりかえし)
  { const geo = new THREE.PlaneGeometry(A.SIZE + 40, A.SIZE + 40); geo.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (A.SIZE + 40) / 6; });
    const g = receive(new THREE.Mesh(geo, M.asphalt)); g.rotation.x = -Math.PI / 2; scene.add(g); }
  // 歩道 (ブロックごとに少し高く)・公園の草・白線・横断歩道
  const blockOrigin = (i) => -A.HALF + ROAD + i * (BLOCK + ROAD);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (inParkBlock(i, j)) continue; // 大きな公園は、あとで草の地面をまとめて
    const geo = tiledBox(BLOCK, CURB, BLOCK, 2); const sw = receive(new THREE.Mesh(geo, [M.curb, M.curb, M.sidewalk, M.curb, M.curb, M.curb]));
    sw.position.set(blockOrigin(i) + BLOCK / 2, CURB / 2, blockOrigin(j) + BLOCK / 2); scene.add(sw);
  }
  for (const b of map.boxes.filter((x) => x.kind === 'grass')) {
    if (b.bigpark) { // 大きな公園: 歩道と同じ高さの草の地面 (ふちは縁石)
      const geo = tiledBox(b.w, CURB, b.d, 4), gm = receive(new THREE.Mesh(geo, [M.curb, M.curb, M.grass, M.curb, M.curb, M.curb])); gm.position.set(b.x, CURB / 2, b.z); scene.add(gm);
      continue;
    }
    const geo = new THREE.PlaneGeometry(b.w - 3, b.d - 3); geo.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (b.w - 3) / 4; });
    const gm = receive(new THREE.Mesh(geo, M.grass)); gm.rotation.x = -Math.PI / 2; gm.position.set(b.x, CURB + 0.01, b.z); scene.add(gm);
  }
  { // 白線 (破線)・横断歩道: まとめて 1 つ (InstancedMesh)
    const lineMat = new THREE.MeshStandardMaterial({ color: '#cfcabe', roughness: 0.75 }), dash = [], cross = [];
    for (let i = 0; i <= N; i++) {
      const c = -A.HALF + ROAD / 2 + i * (BLOCK + ROAD);
      for (let t = -A.HALF + 1; t < A.HALF - 1; t += 3) {
        const local = ((t + A.HALF) % (BLOCK + ROAD)); if (local < ROAD + 1 || local > ROAD + BLOCK - 1) continue; // 交差点はぬかす
        if (!A.inPark(c, t, 1)) dash.push([c, t, 0]); if (!A.inPark(t, c, 1)) dash.push([t, c, Math.PI / 2]); // 大きな公園の中には道路がない
      }
      for (let j = 0; j <= N; j++) { // 横断歩道 (交差点の 4 方向)
        const cz = -A.HALF + ROAD / 2 + j * (BLOCK + ROAD);
        if (A.inPark(c, cz, 6)) continue;
        for (let s = -3; s <= 3; s += 1) { cross.push([c + s, cz + ROAD / 2 + 1.1, 0], [c + s, cz - ROAD / 2 - 1.1, 0], [c + ROAD / 2 + 1.1, cz + s, Math.PI / 2], [c - ROAD / 2 - 1.1, cz + s, Math.PI / 2]); }
      }
    }
    const put = (list, w, l) => { const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, l), lineMat, list.length), o = new THREE.Object3D();
      list.forEach(([x, z, r], k) => { o.position.set(x, 0.012, z); o.rotation.set(-Math.PI / 2, 0, r); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); receive(im); scene.add(im); };
    put(dash, 0.15, 1.5); put(cross, 0.5, 2.2);
  }


  // ---------- 当たり判定の箱の近く (マス目で探す) ----------
  const nearSolid = (x, z, m) => { const L = map.grid ? map.grid.get(Math.floor(x / 10) * 4096 + Math.floor(z / 10)) || [] : map.solid; return L.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m); };
  // 大きな公園の小道 (まん中で十字・神社へ)
  const PB = A.PARK_BOX, pcx = (PB.x0 + PB.x1) / 2, pcz = (PB.z0 + PB.z1) / 2;
  const onPath = (x, z) => A.inPark(x, z) && (Math.abs(x - pcx) < 1.4 || Math.abs(z - pcz) < 1.4 || (Math.abs(x - (pcx + 16)) < 1.4 && z < pcz));
  { const pathMat = new THREE.MeshStandardMaterial({ color: '#cbb994', roughness: 0.95 });
    for (const [x, z, w, d] of [[pcx, pcz, 2.6, PB.z1 - PB.z0], [pcx, pcz, PB.x1 - PB.x0, 2.6], [pcx + 16, (PB.z0 + pcz) / 2, 2.6, pcz - PB.z0]]) { const m = receive(new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat)); m.rotation.x = -Math.PI / 2; m.position.set(x, CURB + 0.012, z); scene.add(m); } }
  // ---------- 大きな公園のもの (池・神社・鳥居・灯籠・噴水・ベンチ) と自動販売機 ----------
  const stone = new THREE.MeshStandardMaterial({ color: '#a29d93', roughness: 0.9 }), water = new THREE.MeshStandardMaterial({ color: '#1f4d63', roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 });
  const vermilion = new THREE.MeshStandardMaterial({ color: '#d9480f', roughness: 0.55 }), blackWood = new THREE.MeshStandardMaterial({ color: '#1f1b1a', roughness: 0.7 }), woodMat = new THREE.MeshStandardMaterial({ color: '#7b4b2a', roughness: 0.8 }), tileRoof = new THREE.MeshStandardMaterial({ color: '#3d4148', roughness: 0.6, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#ffd8a8', emissiveIntensity: 1.6 });
  const put = (geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) => { const m = shadowy(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); scene.add(m); return m; };
  const vendTex = (() => { const c = canvas(128, 256), g = c.getContext('2d'); g.fillStyle = '#f1f3f5'; g.fillRect(0, 0, 128, 256); g.fillStyle = '#111'; g.fillRect(10, 20, 108, 130);
    for (let r2 = 0; r2 < 4; r2++) for (let k = 0; k < 6; k++) { g.fillStyle = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#ae3ec9', '#0c8599'][(r2 * 6 + k * 5) % 6]; g.fillRect(16 + k * 17, 28 + r2 * 30, 11, 22); }
    g.fillStyle = '#495057'; g.fillRect(30, 170, 68, 30); g.fillStyle = '#212529'; g.fillRect(20, 215, 88, 26); return tex(c, { repeat: false }); })();
  const PARKS = {
    pond(b) { const T = 0.6; for (const [x, z, w, d] of [[b.x, b.z - b.d / 2 + T / 2, b.w, T], [b.x, b.z + b.d / 2 - T / 2, b.w, T], [b.x - b.w / 2 + T / 2, b.z, T, b.d], [b.x + b.w / 2 - T / 2, b.z, T, b.d]]) put(new THREE.BoxGeometry(w, b.h, d), stone, x, b.h / 2, z);
      const wt = receive(new THREE.Mesh(new THREE.PlaneGeometry(b.w - 2 * T, b.d - 2 * T), water)); wt.rotation.x = -Math.PI / 2; wt.position.set(b.x, b.h - 0.18, b.z); scene.add(wt);
      for (let k = 0; k < 7; k++) put(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 10), new THREE.MeshStandardMaterial({ color: '#2b8a3e', roughness: 0.7 }), b.x + (R() - 0.5) * (b.w - 3), b.h - 0.16, b.z + (R() - 0.5) * (b.d - 3)); }, // 蓮の葉
    shrine(b) { put(new THREE.BoxGeometry(b.w + 1.2, 0.5, b.d + 1.2), stone, b.x, 0.25, b.z);
      put(new THREE.BoxGeometry(b.w - 0.4, 2.4, b.d - 0.4), woodMat, b.x, 1.7, b.z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(new THREE.CylinderGeometry(0.14, 0.14, 2.6, 10), vermilion, b.x + sx * (b.w / 2 - 0.15), 1.8, b.z + sz * (b.d / 2 - 0.15));
      for (const s2 of [-1, 1]) put(new THREE.BoxGeometry(b.w + 1.6, 0.18, b.d / 2 + 1.1), tileRoof, b.x, 3.55, b.z + s2 * (b.d / 4 + 0.25), 0, s2 * 0.42); // 屋根 (切妻)
      put(new THREE.BoxGeometry(b.w + 1.8, 0.2, 0.25), blackWood, b.x, 3.95, b.z); // 棟
      put(new THREE.BoxGeometry(1.2, 0.7, 0.1), new THREE.MeshStandardMaterial({ color: '#c92a2a', roughness: 0.6 }), b.x, 2.6, b.z + b.d / 2 + 0.02); },
    torii(b) { put(new THREE.CylinderGeometry(0.2, 0.24, b.h, 14), vermilion, b.x, b.h / 2, b.z); },
    lantern(b) { put(new THREE.CylinderGeometry(0.28, 0.34, 0.3, 8), stone, b.x, 0.15, b.z); put(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), stone, b.x, 0.6, b.z); put(new THREE.BoxGeometry(0.42, 0.34, 0.42), glow, b.x, 1.05, b.z); put(new THREE.ConeGeometry(0.42, 0.3, 4), stone, b.x, 1.36, b.z, Math.PI / 4); },
    fountain(b) { put(new THREE.CylinderGeometry(b.w / 2, b.w / 2 + 0.1, b.h, 24), stone, b.x, b.h / 2, b.z); const wt = put(new THREE.CylinderGeometry(b.w / 2 - 0.2, b.w / 2 - 0.2, 0.05, 24), water, b.x, b.h - 0.05, b.z); wt.castShadow = false;
      put(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 12), stone, b.x, b.h + 0.6, b.z); put(new THREE.CylinderGeometry(0.6, 0.2, 0.25, 16), stone, b.x, b.h + 1.4, b.z); },
    bench(b) { const along = b.w > b.d; put(new THREE.BoxGeometry(b.w, 0.07, b.d), woodMat, b.x, b.h, b.z); for (const s2 of [-1, 1]) put(new THREE.BoxGeometry(along ? 0.08 : b.w * 0.9, b.h, along ? b.d * 0.9 : 0.08), blackWood, b.x + (along ? s2 * (b.w / 2 - 0.15) : 0), b.h / 2, b.z + (along ? 0 : s2 * (b.d / 2 - 0.15))); },
    vend(b) { const lines = Array.from({ length: N + 1 }, (_, i) => A.lineAt(i)), lx = lines.reduce((p2, c2) => (Math.abs(c2 - b.x) < Math.abs(p2 - b.x) ? c2 : p2)), sx = Math.sign(lx - b.x) || 1;
      const front = new THREE.MeshStandardMaterial({ map: vendTex, emissive: '#ffffff', emissiveMap: vendTex, emissiveIntensity: 0.35, roughness: 0.4 }), body = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.4, metalness: 0.3 });
      const faces = [body, body, body, body, body, body]; faces[sx > 0 ? 0 : 1] = front; put(new THREE.BoxGeometry(b.w, b.h, b.d), faces, b.x, b.h / 2, b.z); },
  };
  // ---------- 繁華街: たて看板 (ネオン)・横の看板・赤ちょうちん・電柱と電線・入口のアーチ ----------
  function decorateHanka() {
    const WORDS = ['居酒屋', 'ラーメン', 'カラオケ', '焼肉', '寿司', 'BAR', '焼鳥', '麻雀', '喫茶', 'ゲーム', '漫画喫茶', '薬', 'ホテル', '餃子', 'うどん', 'そば'], COLS = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', '#ffa94d', '#e599f7'];
    const vCache = new Map(), hCache = new Map();
    const vSign = (k) => { if (vCache.has(k)) return vCache.get(k); const w = WORDS[k % WORDS.length], col = COLS[(k >> 2) % COLS.length], c = canvas(96, 384), g = c.getContext('2d');
      g.fillStyle = '#16161c'; g.fillRect(0, 0, 96, 384); g.strokeStyle = col; g.lineWidth = 6; g.strokeRect(6, 6, 84, 372); g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10;
      const ch = [...w], fs = Math.min(70, 340 / ch.length); g.font = `900 ${fs}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; ch.forEach((t, i) => g.fillText(t, 48, 192 - ((ch.length - 1) / 2 - i) * fs * 1.02));
      const t = tex(c, { repeat: false }), m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.3, roughness: 0.5 }); vCache.set(k, m); return m; };
    const hSign = (k) => { const key = (k + 3) % WORDS.length; if (hCache.has(key)) return hCache.get(key); const w = WORDS[key], bg = ['#c92a2a', '#1864ab', '#2b8a3e', '#5f3dc4', '#e8590c', '#212529'][key % 6], c = canvas(512, 96), g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 96); g.fillStyle = '#fff'; g.font = '900 60px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(w, 256, 52);
      const t = tex(c, { repeat: false }), m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.6, roughness: 0.5 }); hCache.set(key, m); return m; };
    const dark = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6 }), red = new THREE.MeshStandardMaterial({ color: '#e03131', emissive: '#ff6b6b', emissiveIntensity: 0.8, roughness: 0.6 });
    const lines = Array.from({ length: N + 1 }, (_, i) => A.lineAt(i)), nl = (v) => lines.reduce((p2, c2) => (Math.abs(c2 - v) < Math.abs(p2 - v) ? c2 : p2));
    for (const b of map.boxes) {
      if (b.kind !== 'building' || b.district !== 'hanka') continue;
      const lx = nl(b.x), lz = nl(b.z), useX = Math.abs(lx - b.x) - b.w / 2 < Math.abs(lz - b.z) - b.d / 2, s2 = useX ? Math.sign(lx - b.x) || 1 : Math.sign(lz - b.z) || 1;
      const nx = useX ? s2 : 0, nz = useX ? 0 : s2, tx = useX ? 0 : 1, tz = useX ? 1 : 0, half = (useX ? b.w : b.d) / 2, len = useX ? b.d : b.w;
      const fx = b.x + nx * half, fz = b.z + nz * half, top = (b.y0 || 0) + b.h, k = b.sign || 0;
      // たて看板 (壁から直角に出る)
      const Hs = Math.min(top - 4.6, 5.5); if (Hs > 1.5) for (const sd of (k & 2) ? [-1, 1] : [(k & 1) ? 1 : -1]) { // 1〜2 枚。壁から直角に出て、道の向きから読める
        const off = (len / 2 - 0.6) * sd, m = vSign(k + (sd > 0 ? 7 : 0)), faces = [m, m, dark, dark, dark, dark];
        const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, Hs, 0.8), faces); g2.position.set(fx + nx * 0.45 + tx * off, 4.4 + Hs / 2, fz + nz * 0.45 + tz * off); g2.rotation.y = Math.atan2(nx, nz); scene.add(g2); }
      // 横の看板 (2 階の高さ)
      { const m = hSign(k), g2 = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.7, 0.14), [dark, dark, dark, dark, m, dark]); g2.position.set(fx + nx * 0.08, 3.95, fz + nz * 0.08); g2.rotation.y = Math.atan2(nx, nz); scene.add(g2); }
      // 赤ちょうちん
      if ((k % 3) === 0) for (const sd of [-1, 1]) { const x = fx + nx * 0.35 + tx * sd * (len / 2 - 0.4), z = fz + nz * 0.35 + tz * sd * (len / 2 - 0.4); const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), red); l.scale.y = 1.45; l.position.set(x, 2.55, z); scene.add(l); const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10), dark); cp.position.set(x, 2.89, z); scene.add(cp); }
    }
    // 電柱と電線
    const poleMat = new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 0.9 }), wireMat = new THREE.LineBasicMaterial({ color: '#15171a' }), byX = new Map();
    for (const [x, z] of map.deco?.poles || []) { put(new THREE.CylinderGeometry(0.13, 0.16, 8.5, 10), poleMat, x, 4.25, z); put(new THREE.BoxGeometry(1.6, 0.1, 0.1), dark, x, 7.8, z); if (!byX.has(x)) byX.set(x, []); byX.get(x).push(z); }
    const pts = [], sag = (t) => 7.75 - Math.sin(Math.PI * t) * 0.45;
    for (const [x, zs] of byX) { zs.sort((a2, b2) => a2 - b2); for (let i = 0; i + 1 < zs.length; i++) { if (zs[i + 1] - zs[i] > 16) continue; for (const off of [-0.65, 0, 0.65]) for (let k = 0; k < 6; k++) { const t0 = k / 6, t1 = (k + 1) / 6; pts.push(x + off, sag(t0), zs[i] + (zs[i + 1] - zs[i]) * t0, x + off, sag(t1), zs[i] + (zs[i + 1] - zs[i]) * t1); } } } // たるんだ電線 3 本
    if (pts.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); scene.add(new THREE.LineSegments(geo, wireMat)); }
    // 入口のアーチ (繁華街)・鳥居の上の木 (公園)
    for (const gt of map.deco?.gates || []) {
      if (gt.hanka) { const c = canvas(512, 96), g = c.getContext('2d'); g.fillStyle = '#c92a2a'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#ffe066'; g.font = '900 62px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('IppO 横丁', 256, 52);
        const t = tex(c, { repeat: false }), sm = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9 }), rot = gt.rot || 0, ax = Math.cos(rot), az = -Math.sin(rot);
        for (const sd of [-1, 1]) put(new THREE.CylinderGeometry(0.16, 0.16, gt.h, 10), dark, gt.x + ax * sd * gt.w / 2, gt.h / 2, gt.z + az * sd * gt.w / 2);
        const bd = new THREE.Mesh(new THREE.BoxGeometry(gt.w + 0.4, 1.0, 0.2), [dark, dark, dark, dark, sm, sm]); bd.position.set(gt.x, gt.h - 0.3, gt.z); bd.rotation.y = rot; scene.add(bd); }
      else { put(new THREE.BoxGeometry(gt.w + 1.4, 0.28, 0.5), blackWood, gt.x, gt.h + 0.1, gt.z); put(new THREE.BoxGeometry(gt.w + 0.8, 0.22, 0.32), vermilion, gt.x, gt.h - 0.15, gt.z); put(new THREE.BoxGeometry(gt.w + 0.4, 0.2, 0.26), vermilion, gt.x, gt.h - 0.8, gt.z); put(new THREE.BoxGeometry(0.5, 0.65, 0.08), blackWood, gt.x, gt.h - 0.45, gt.z + 0.15); }
    }
  }
  // ---------- 動かないものを材質ごとにまとめる (ビル・歩道・家具・看板など。数千 → 数十回の描画に) ----------
  function batchStatic() {
    scene.updateMatrixWorld(true);
    const buckets = new Map(), olds = [];
    const addPart = (geo, mat, o) => { const key = mat.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : ''); if (!buckets.has(key)) buckets.set(key, { mat, cast: o.castShadow, recv: o.receiveShadow, list: [] }); buckets.get(key).list.push(geo); };
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.userData.keep) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.transparent)) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) return;
      g.applyMatrix4(o.matrixWorld);
      if (!Array.isArray(o.material)) addPart(g, o.material, o);
      else for (const gr of g.groups) { // 面ごとの材質: その面だけ切りだす
        const sub = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) { const a = g.attributes[k]; sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize)); }
        addPart(sub, o.material[gr.materialIndex], o);
      }
      olds.push(o);
    });
    for (const o of olds) { o.parent.remove(o); o.geometry.dispose(); }
    for (const b of buckets.values()) { const geo = mergeGeometries(b.list, false); for (const g of b.list) g.dispose(); if (!geo) continue; const m = new THREE.Mesh(geo, b.mat); m.castShadow = b.cast; m.receiveShadow = b.recv; m.matrixAutoUpdate = false; scene.add(m); }
  }
  // ビル (外壁 4 種類 × 色)・屋上の機械・まわりの壁・木箱・車
  const PAL = { brick: ['#8d4a3a', '#a0573f', '#7a3f33', '#9b6b52'], concrete: ['#b7b2a8', '#9fa3a6', '#c4bdb0', '#8e9295'], glass: ['#5b6670', '#4a5560', '#6c7782'], plaster: ['#d9cdb4', '#c9b79c', '#e2d6c1', '#b9c3c9'] };
  const facadeCache = new Map();
  const facade = (style, col) => { const k = style + col; if (!facadeCache.has(k)) facadeCache.set(k, makeFacade(style, S, rng(k.length * 997 + col.charCodeAt(2)), col)); return facadeCache.get(k); };
  const roofBox = new THREE.MeshStandardMaterial({ color: '#8f9396', roughness: 0.6, metalness: 0.4 });
  const carPaint = (col) => new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const glassDark = new THREE.MeshStandardMaterial({ color: '#10161c', metalness: 0.6, roughness: 0.08, envMapIntensity: 1.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.85 }), chrome = new THREE.MeshStandardMaterial({ color: '#d0d4d8', metalness: 1, roughness: 0.2 });
  const lightMat = new THREE.MeshStandardMaterial({ color: '#fff6dd', emissive: '#fff1c9', emissiveIntensity: 2.2 }), tailMat = new THREE.MeshStandardMaterial({ color: '#7a0b0b', emissive: '#ff2a2a', emissiveIntensity: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
  const groupFm = new Map(); // 建物の中があるビル: 上の箱と 1 階の壁で同じ外壁
  const IN = makeInteriorMaterials(R);
  for (const b of map.boxes) {
    if (b.kind === 'building') {
      const styles = ['brick', 'concrete', 'glass', 'plaster'], style = (b.fullH || b.h) >= 16 && R() < 0.6 ? 'glass' : styles[Math.floor(R() * 4)];
      const col = PAL[style][Math.floor(R() * PAL[style].length)], fm = facade(style, col);
      if (b.gid) groupFm.set(b.gid, fm);
      const y0 = b.y0 || 0, top = y0 + b.h;
      const bm = shadowy(new THREE.Mesh(tiledBox(b.w, b.h, b.d), [fm, fm, M.roof, b.upper ? IN.ceiling : M.roof, fm, fm])); bm.position.set(b.x, y0 + b.h / 2, b.z); scene.add(bm);
      // 1 階の入り口まわり (少し出っぱった帯)
      const band = shadowy(new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, 0.5, b.d + 0.12), new THREE.MeshStandardMaterial({ color: '#4b4f54', roughness: 0.6 }))); band.position.set(b.x, b.upper ? y0 + 0.05 : 3.2, b.z); scene.add(band);
      // 屋上のふち・機械・給水タンク
      const par = shadowy(new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.5, b.d + 0.3), M.concrete)); par.position.set(b.x, top + 0.25, b.z); scene.add(par);
      if (Q.props >= 1) for (let k = 0; k < 2; k++) { const ac = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1), roofBox)); ac.position.set(b.x + (R() - 0.5) * (b.w - 2), top + 0.45, b.z + (R() - 0.5) * (b.d - 2)); scene.add(ac); }
      if (R() < 0.3) { const tank = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.8, 16), new THREE.MeshStandardMaterial({ color: '#8b6b4a', roughness: 0.8 }))); tank.position.set(b.x + b.w / 4, top + 1.6, b.z - b.d / 4); scene.add(tank); }
    } else if (b.kind === 'iwall') { // 1 階の壁: 外がわは外壁・内がわは室内の壁
      const fm = groupFm.get(b.gid) || M.concrete, w = IN.wall, faces = [w, w, w, w, w, w], idx = { px: 0, nx: 1, pz: 4, nz: 5 }[b.face];
      faces[idx] = fm;
      const m = shadowy(new THREE.Mesh(tiledBox(b.w, b.h, b.d), faces)); m.position.set(b.x, (b.y0 || 0) + b.h / 2, b.z); scene.add(m);
    } else if (b.kind === 'floor') {
      const fl = receive(new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), b.type === 'cafe' ? IN.wood : IN.tile)); fl.rotation.x = -Math.PI / 2; fl.position.set(b.x, 0.02, b.z); scene.add(fl);
      fl.geometry.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (i % 2 ? b.d : b.w) / 1.2; });
    } else if (b.kind === 'furn') {
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z); scene.add(g);
      const box = (w, h, d, mat, y, x = 0, z = 0) => { const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); g.add(m); return m; };
      if (b.part === 'counter') { box(b.w, b.h - 0.06, b.d, IN.counter, (b.h - 0.06) / 2); box(b.w + 0.06, 0.06, b.d + 0.06, IN.counterTop, b.h - 0.03); }
      else if (b.part === 'shelf') { box(b.w, b.h, b.d, IN.shelf, b.h / 2); for (const y of [0.35, 0.8, 1.25]) box(b.w * 0.98, 0.3, b.d * 1.02, IN.goods, y); }
      else if (b.part === 'table') { box(b.w, 0.05, b.d, IN.wood, b.h); box(0.08, b.h, 0.08, IN.metal, b.h / 2); }
      else { const pot = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 12), IN.counter)); pot.position.y = 0.2; g.add(pot); const leaf = shadowy(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), IN.leaf)); leaf.position.y = 0.8; g.add(leaf); }
    } else if (b.kind === 'car' && !b.dyn) {
      // 車: 当たり判定の箱 (高さ 1.45) の中におさまる形
      const along = b.w > b.d, L = Math.max(b.w, b.d), W = Math.min(b.w, b.d), g = new THREE.Group();
      g.position.set(b.x, 0, b.z); g.rotation.y = along ? 0 : Math.PI / 2;
      const paint = carPaint(b.color);
      const body = shadowy(new THREE.Mesh(new THREE.BoxGeometry(L, 0.55, W), paint)); body.position.y = 0.6; g.add(body);
      const hood = shadowy(new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.12, W * 0.96), paint)); hood.position.y = 0.92; g.add(hood);
      const cabin = shadowy(new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 0.48, W * 0.86), glassDark)); cabin.position.set(-L * 0.05, 1.2, 0); g.add(cabin);
      const roof = shadowy(new THREE.Mesh(new THREE.BoxGeometry(L * 0.44, 0.06, W * 0.84), paint)); roof.position.set(-L * 0.05, 1.45, 0); g.add(roof);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const wh = shadowy(new THREE.Mesh(wheelGeo, rubber)); wh.rotation.x = Math.PI / 2; wh.position.set(sx * L * 0.32, 0.36, sz * (W / 2 - 0.08)); g.add(wh);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), chrome); cap.rotation.x = Math.PI / 2; cap.position.copy(wh.position); g.add(cap); }
      for (const sz of [-1, 1]) { const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.34), lightMat); hl.position.set(L / 2, 0.72, sz * W * 0.32); g.add(hl); const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), tailMat); tl.position.set(-L / 2, 0.75, sz * W * 0.34); g.add(tl); }
      const bump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, W * 0.98), chrome); bump.position.set(L / 2 + 0.02, 0.45, 0); g.add(bump);
      scene.add(g);
    } else if (PARKS[b.kind]) { PARKS[b.kind](b);
    } else if (b.kind === 'crate' || b.kind === 'wall' || b.kind === 'fence') {
      const m = shadowy(new THREE.Mesh(tiledBox(b.w, b.h, b.d, b.kind === 'crate' ? Math.max(b.w, b.h) : 3), b.kind === 'crate' ? M.crate : M.concrete)); m.position.set(b.x, b.y0 + b.h / 2, b.z); scene.add(m);
    }
  }
  // 建物の中: 天井の明かり・入口の上の看板
  for (const r of map.interiors || []) {
    for (const k of [-0.25, 0.25]) { const lp = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.4, r.w * 0.4), 0.04, 0.5), IN.lamp); lp.position.set(r.x + (r.inZ ? k * r.w * 0.6 : 0), A.FLOOR_H - 0.03, r.z + (r.inX ? k * r.d * 0.6 : 0)); if (r.inX) lp.rotation.y = Math.PI / 2; scene.add(lp); }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 0.08), IN.sign[r.type]); sign.position.set(r.door.x + r.door.nx * 0.06, 2.95, r.door.z + r.door.nz * 0.06); sign.rotation.y = Math.atan2(r.door.nx, r.door.nz); scene.add(sign);
  }
  // 街灯・街路樹・消火栓 (歩道のふち)
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f44', metalness: 0.7, roughness: 0.45 }), lamp = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffe2a8', emissiveIntensity: 3 });
    const hydMat = new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.5, metalness: 0.2 });
    const lights = [], trees = [], hyd = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (inParkBlock(i, j)) continue;
      const x0 = blockOrigin(i), z0 = blockOrigin(j);
      if (inHankaBlock(i, j)) { for (const [x, z, r] of [[x0 + 0.5, z0 + BLOCK / 2, Math.PI], [x0 + BLOCK - 0.5, z0 + BLOCK / 2, 0]]) lights.push([x, z, r]); continue; } // 繁華街: 木はなし
      const park = map.boxes.some((b) => b.kind === 'grass' && Math.abs(b.x - (x0 + BLOCK / 2)) < 1 && Math.abs(b.z - (z0 + BLOCK / 2)) < 1);
      for (const [x, z, r] of [[x0 + 0.5, z0 + BLOCK / 2, Math.PI], [x0 + BLOCK - 0.5, z0 + BLOCK / 2, 0], [x0 + BLOCK / 2, z0 + 0.5, Math.PI / 2], [x0 + BLOCK / 2, z0 + BLOCK - 0.5, -Math.PI / 2]]) lights.push([x, z, r]);
      if (!park) for (const [x, z] of [[x0 + 1.2, z0 + 4], [x0 + BLOCK - 1.2, z0 + BLOCK - 4], [x0 + 4, z0 + BLOCK - 1.2], [x0 + BLOCK - 4, z0 + 1.2]]) {
        if (!map.solid.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.9 && Math.abs(z - b.z) < b.d / 2 + 0.9)) trees.push([x, z]);
      }
      else for (let k = 0; k < 6; k++) { const x = x0 + 3 + R() * (BLOCK - 6), z = z0 + 3 + R() * (BLOCK - 6); if (!map.solid.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1)) trees.push([x, z]); }
      hyd.push([x0 + 0.6, z0 + 0.6]);
    }
    const o = new THREE.Object3D();
    const inst = (geo, mat, list, f) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((v, k) => { f(o, v); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); shadowy(im); scene.add(im); return im; };
    inst(new THREE.CylinderGeometry(0.08, 0.11, 6, 10), poleMat, lights, (o, [x, z]) => { o.position.set(x, CURB + 3, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); });
    inst(new THREE.BoxGeometry(1.6, 0.08, 0.08), poleMat, lights, (o, [x, z, r]) => { o.position.set(x + Math.cos(r) * 0.75, CURB + 5.9, z - Math.sin(r) * 0.75); o.rotation.set(0, r, 0); });
    inst(new THREE.BoxGeometry(0.55, 0.12, 0.3), lamp, lights, (o, [x, z, r]) => { o.position.set(x + Math.cos(r) * 1.45, CURB + 5.82, z - Math.sin(r) * 1.45); o.rotation.set(0, r, 0); });
    // 木: 幹 + 葉のかたまり 3 つ (少しずつちがう緑)
    const leafGeo = new THREE.IcosahedronGeometry(1, 1); { const p = leafGeo.attributes.position; for (let i = 0; i < p.count; i++) { const s = 0.82 + R() * 0.36; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s); } leafGeo.computeVertexNormals(); }
    inst(new THREE.CylinderGeometry(0.13, 0.2, 2.6, 8), new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.95 }), trees, (o, [x, z]) => { o.position.set(x, CURB + 1.3, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#3d6b2a', roughness: 0.9, flatShading: true });
    for (const t of map.deco?.trees || []) trees.push(t); // 大きな公園の木
    const leafList = trees.flatMap(([x, z]) => [[x, z, 0], [x + 0.6, z + 0.3, 1], [x - 0.4, z - 0.5, 2]]);
    const lm = inst(leafGeo, leafMat, leafList, (o, [x, z, k]) => { const s = [1.5, 1.1, 1.2][k]; o.position.set(x, CURB + [3.4, 3.0, 3.8][k], z); o.scale.set(s, s * 0.9, s); o.rotation.set(R(), R(), 0); });
    const tc = new THREE.Color(); leafList.forEach((_, k) => { tc.setHSL(0.24 + R() * 0.07, 0.45 + R() * 0.2, 0.22 + R() * 0.1); lm.setColorAt(k, tc); });
    inst(new THREE.CylinderGeometry(0.13, 0.15, 0.7, 10), hydMat, hyd, (o, [x, z]) => { o.position.set(x, CURB + 0.35, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); });
  }
  // 桜 (大きな公園): 幹 + ピンクの花のかたまり 3 つ
  { const sk = map.deco?.sakura || [];
    if (sk.length) {
      const o = new THREE.Object3D(), trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 8), new THREE.MeshStandardMaterial({ color: '#4a3328', roughness: 0.95 }), sk.length);
      sk.forEach(([x, z], k) => { o.position.set(x, CURB + 1.2, z); o.rotation.set(0, 0, (R() - 0.5) * 0.2); o.scale.set(1, 1, 1); o.updateMatrix(); trunk.setMatrixAt(k, o.matrix); }); shadowy(trunk); scene.add(trunk);
      const blob = new THREE.IcosahedronGeometry(1, 1), list = sk.flatMap(([x, z]) => [[x, z, 0], [x + 0.8, z + 0.2, 1], [x - 0.6, z - 0.6, 2], [x, z + 0.8, 3]]);
      const pink = new THREE.InstancedMesh(blob, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true, emissive: '#f783ac', emissiveIntensity: 0.08 }), list.length), c = new THREE.Color();
      list.forEach(([x, z, k], n) => { const s = [1.6, 1.1, 1.2, 1.0][k]; o.position.set(x, CURB + [3.0, 2.6, 3.3, 2.9][k], z); o.scale.set(s, s * 0.8, s); o.rotation.set(R(), R(), 0); o.updateMatrix(); pink.setMatrixAt(n, o.matrix); c.setHSL(0.94 + R() * 0.03, 0.75 + R() * 0.2, 0.7 + R() * 0.08); pink.setColorAt(n, c); });
      shadowy(pink); scene.add(pink);
    } }
  decorateHanka(); // 繁華街の看板・ちょうちん・電柱と電線・入口のアーチ
  // 遠くのビル群 (かべの外。当たり判定なし・霧でかすむ)
  { const mat = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.9 }), list = [];
    for (let k = 0; k < 90; k++) { const a = R() * Math.PI * 2, r = A.HALF + 30 + R() * 120; list.push([Math.cos(a) * r, Math.sin(a) * r, 6 + R() * 7, 6 + R() * 7, 10 + R() * 60]); }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length), o = new THREE.Object3D();
    list.forEach(([x, z, w, d, h], k) => { o.position.set(x, h / 2, z); o.scale.set(w, h, d); o.rotation.set(0, R() * 3, 0); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); scene.add(im); }

  // 公園の草 (最高画質): 小さな草むらをたくさん。風でゆれる (頂点シェーダー)
  const wind = { value: 0 };
  if (Q.grass) {
    const blades = [], pos = [], col = [];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI + R() * 0.4, ca = Math.cos(a) * 0.035, sa = Math.sin(a) * 0.035, lx = (R() - 0.5) * 0.12, lz = (R() - 0.5) * 0.12, h = 0.22 + R() * 0.2, bx = (R() - 0.5) * 0.08;
      pos.push(lx - ca, 0, lz - sa, lx + ca, 0, lz + sa, lx + bx, h, lz); col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1, 1, 1); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.computeVertexNormals();
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // 上向きの法線 (地面と同じ明るさ)
    const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    gmat.onBeforeCompile = (sh) => { sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); float sway = sin(uWind * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.5 + sin(uWind * 3.1 + wp.x * 0.9) * 0.25;
        transformed.x += sway * 0.06 * position.y * 3.0; transformed.z += sway * 0.03 * position.y * 3.0;`); };
    for (const b of map.boxes.filter((x) => x.kind === 'grass')) {
      const W = b.w - 3.4, D = b.d - 3.4, n = Math.floor(W * D * (b.bigpark ? 4 : 9)), im = new THREE.InstancedMesh(bg, gmat, n), o = new THREE.Object3D(), c = new THREE.Color(); let k = 0;
      for (let t = 0; t < n; t++) { const x = b.x + (R() - 0.5) * W, z = b.z + (R() - 0.5) * D;
        if (nearSolid(x, z, 0.2) || onPath(x, z)) continue;
        o.position.set(x, CURB + 0.01, z); o.rotation.set(0, R() * 6.28, 0); const s = 0.7 + R() * 0.7; o.scale.set(s, s * (0.8 + R() * 0.5), s); o.updateMatrix(); im.setMatrixAt(k, o.matrix);
        c.setHSL(0.23 + R() * 0.06, 0.45 + R() * 0.2, 0.2 + R() * 0.1); im.setColorAt(k, c); k++; }
      im.count = k; im.frustumCulled = false; receive(im); scene.add(im);
    }
  }
  // 水たまり (高画質以上): 道路のところどころ。つるつるで、空やビルが映る
  if (Q.envCity) {
    const s2 = 128, pc = canvas(s2), pg = pc.getContext('2d'); pg.fillStyle = '#000'; pg.fillRect(0, 0, s2, s2);
    for (let k = 0; k < 7; k++) { const x = s2 * (0.3 + R() * 0.4), y = s2 * (0.3 + R() * 0.4), r = s2 * (0.12 + R() * 0.14), gr = pg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#fff'); gr.addColorStop(0.75, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); pg.fillStyle = gr; pg.beginPath(); pg.arc(x, y, r, 0, 7); pg.fill(); }
    const pmat = new THREE.MeshStandardMaterial({ color: '#0d0e11', roughness: 0.03, metalness: 0, alphaMap: tex(pc, { srgb: false, repeat: false }), transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const pgeo = new THREE.PlaneGeometry(1, 1); let made = 0;
    for (let t = 0; t < 400 && made < 70; t++) { const x = (R() - 0.5) * (A.SIZE - 4), z = (R() - 0.5) * (A.SIZE - 4);
      if (curbAt(x, z) || map.solid.some((b) => Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5)) continue;
      const pm = receive(new THREE.Mesh(pgeo, pmat)); pm.rotation.set(-Math.PI / 2, 0, R() * 6.28); pm.scale.set(1.5 + R() * 2.5, 1.2 + R() * 2, 1); pm.position.set(x, 0.006, z); scene.add(pm); made++; }
  }
  batchStatic(); // 動かないものを材質ごとに 1 つにまとめる (描く回数を減らして軽く)
  // 街の映りこみ: 街のまん中の上から 6 方向を 1 回だけ撮って、ガラス・車・水たまりに映す
  if (Q.envCity) {
    const cubeRT = new THREE.WebGLCubeRenderTarget(Q.texSize >= 1024 ? 512 : 256, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.5, 1500, cubeRT); cubeCam.position.set(0, 9, 0); scene.add(cubeCam);
    cubeCam.update(renderer, scene); scene.remove(cubeCam);
    const cityEnv = pmrem.fromCubemap(cubeRT.texture).texture; cubeRT.dispose(); scene.environment = cityEnv;
  }

  // ---------- 画面の仕上げ: ブルーム (光のにじみ)・AO (すき間の陰)・ACES・SMAA/FXAA・色の仕上げ ----------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa && renderer.capabilities.isWebGL2 ? Q.msaa : 0 }));
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null, bloom = null;
  if (Q.ao) { gtao = new GTAOPass(scene, camera, 1, 1); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.85; gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1 }); composer.addPass(gtao); }
  if (Q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.45, 1.05); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  let fxaa = null; if (Q.smaa) composer.addPass(new SMAAPass(1, 1)); else { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
  // 色の仕上げ: 少しだけコントラスト・彩度・周辺減光・画面のはしの色ずれ・フィルムの粒
  let grade = null;
  if (Q.grade) {
    grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 d = vUv - 0.5; float r2 = dot(d, d);
          vec2 ca = d * r2 * 0.012; // 色ずれ (はしだけ)
          vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.08);                        // 彩度
          c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);        // コントラスト (S 字)
          c *= vec3(1.02, 1.0, 0.97);                       // 少しあたたかく
          c *= 1.0 - smoothstep(0.18, 0.62, r2) * 0.32;     // 周辺減光
          c += (h(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.022; // フィルムの粒
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }` });
    composer.addPass(grade);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    applyPR(); camera.aspect = w / h; camera.fov = w < h ? 82 : 70; camera.updateProjectionMatrix();
  }
  function applyPR() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(PR); renderer.setSize(w, h, false); composer.setPixelRatio(PR); composer.setSize(w, h);
    fxaa?.material.uniforms.resolution.value.set(1 / (w * PR), 1 / (h * PR)); grade?.material.uniforms.uRes.value.set(w * PR, h * PR);
  }
  // 動的解像度: 重い (50fps より下) がつづいたら解像度を下げ、ずっと軽ければ少しずつもどす
  const dyn = { last: 0, ema: 16.7, t: 0, good: 0 };
  function adapt(now) {
    const dt = dyn.last ? now - dyn.last : 16.7; dyn.last = now; if (document.hidden || dt > 600) return; // タブが裏にあった
    dyn.ema += (dt - dyn.ema) * 0.05; dyn.t += dt; if (dyn.t < 1500) return; dyn.t = 0;
    const minPR = Math.min(1, PR_MAX);
    if (dyn.ema > 21 && PR > minPR) { PR = Math.max(minPR, PR - 0.25); dyn.good = 0; applyPR(); }
    else if (dyn.ema < 17.6 && PR < PR_MAX) { if (++dyn.good >= 3) { PR = Math.min(PR_MAX, PR + 0.125); dyn.good = 0; applyPR(); } }
    else dyn.good = 0;
  }
  // 影は自分のまわりだけ (太陽の影のカメラを、自分についていかせる)
  function follow(x, z) { if (!Q.shadow) return; const sx = Math.round(x / 4) * 4, sz = Math.round(z / 4) * 4; sun.target.position.set(sx, 0, sz); sun.position.set(sx + sunDir.x * 90, sunDir.y * 90, sz + sunDir.z * 90); }
  // 歩道の上は少し高い (見た目だけ。当たり判定は変えない)
  function curbAt(x, z) { if (A.inPark(x, z)) return CURB; const lx = ((x + A.HALF) % (BLOCK + ROAD) + (BLOCK + ROAD)) % (BLOCK + ROAD), lz = ((z + A.HALF) % (BLOCK + ROAD) + (BLOCK + ROAD)) % (BLOCK + ROAD); return lx >= ROAD && lz >= ROAD && Math.abs(x) < A.HALF - 0.5 && Math.abs(z) < A.HALF - 0.5 ? CURB : 0; }

  // ---------- キャラクター (高精細: 顔・髪・服の細部・指まで。部位ごとに 1 つにまとめて軽く描く) ----------
  // 布・デニム・革・髪の質感 (色は材質の color でつける。絵は白に近い灰色)
  const fabricTex = (() => { const s = 128, c = canvas(s), g = c.getContext('2d'), hc = canvas(s), hg = hc.getContext('2d'); g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s); hg.fillStyle = '#808080'; hg.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = y % 4 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)'; g.fillRect(0, y, s, 1); hg.fillStyle = y % 4 ? '#707070' : '#909090'; hg.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = 'rgba(0,0,0,.04)'; g.fillRect(x, 0, 1, s); }
    speckle(g, s, s, s * 6, 1, ['#d0d0d0', '#f4f4f4'], 0.4, R); return { map: tex(c), normal: tex(normalFrom(hc, 1.2), { srgb: false }) }; })();
  const denimTex = (() => { const s = 128, c = canvas(s), g = c.getContext('2d'); g.fillStyle = '#d8dbe2'; g.fillRect(0, 0, s, s);
    for (let i = -s; i < s; i += 3) { g.strokeStyle = 'rgba(40,50,80,.18)'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); } speckle(g, s, s, s * 8, 1, ['#ffffff', '#b8bdc8'], 0.35, R); return tex(c); })();
  const hairTex = (() => { const s = 128, c = canvas(s), g = c.getContext('2d'), hc = canvas(s), hg = hc.getContext('2d'); g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, s, s); hg.fillStyle = '#808080'; hg.fillRect(0, 0, s, s);
    for (let i = 0; i < s * 3; i++) { const x = R() * s, v = R(); g.strokeStyle = v > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)'; hg.strokeStyle = v > 0.5 ? '#b0b0b0' : '#505050'; g.beginPath(); hg.beginPath(); g.moveTo(x, 0); hg.moveTo(x, 0); const x2 = x + (R() - 0.5) * 10; g.lineTo(x2, s); hg.lineTo(x2, s); g.stroke(); hg.stroke(); }
    return { map: tex(c), normal: tex(normalFrom(hc, 2), { srgb: false }) }; })();
  const SKIN = ['#e9c4a0', '#d2a37c', '#9a6847', '#f3d6bb', '#b98560'], HAIR = ['#1d1612', '#3a291c', '#6a4a2a', '#a6804c', '#2b2b2e', '#5a2e1c'];
  const pantsMat = new THREE.MeshStandardMaterial({ color: '#33415e', map: denimTex, roughness: 0.92 });
  const soleMat = new THREE.MeshStandardMaterial({ color: '#e9e9e6', roughness: 0.7 }), shoeMat = new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.55, metalness: 0.05 });
  const beltMat = new THREE.MeshStandardMaterial({ color: '#1c1a19', roughness: 0.45 }), metalMat = new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 1, roughness: 0.25 });
  const scleraMat = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.3 }), irisMat = new THREE.MeshStandardMaterial({ color: '#2b1c12', roughness: 0.15 }), lipMat = new THREE.MeshStandardMaterial({ color: '#9b5a50', roughness: 0.5 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: '#2a2d31', metalness: 0.8, roughness: 0.35 }), gunGrip = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.75 }), gunAccent = new THREE.MeshStandardMaterial({ color: '#5c4a36', roughness: 0.6 });
  const skinMats = new Map(), hairMats = new Map();
  const skinOf = (c) => { if (!skinMats.has(c)) skinMats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })); return skinMats.get(c); };
  const hairOf = (c) => { if (!hairMats.has(c)) hairMats.set(c, new THREE.MeshStandardMaterial({ color: c, map: hairTex.map, normalMap: hairTex.normal, roughness: 0.6 })); return hairMats.get(c); };
  // 形のもと (使いまわす)
  const GEO_HI = {
    ball: new THREE.SphereGeometry(1, 32, 24), hairCap: new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), ballLo: new THREE.SphereGeometry(1, 16, 12), box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 24), cone: new THREE.ConeGeometry(1, 1, 16), torus: new THREE.TorusGeometry(1, 0.22, 10, 32),
    cap: (r, len) => new THREE.CapsuleGeometry(r, len, 8, 20),
    // 体 (胸が広く、腰が細い。前後はうすい)
    torso: new THREE.LatheGeometry([[0, 0.9], [0.16, 0.9], [0.172, 0.95], [0.158, 1.04], [0.175, 1.16], [0.192, 1.28], [0.19, 1.37], [0.165, 1.44], [0.11, 1.49], [0.065, 1.51], [0, 1.515]].map(([x, y]) => new THREE.Vector2(x, y)), 32),
    thigh: new THREE.LatheGeometry([[0, 0.02], [0.07, 0.02], [0.082, -0.08], [0.088, -0.2], [0.078, -0.36], [0.066, -0.44], [0, -0.46]].map(([x, y]) => new THREE.Vector2(x, y)), 20),
    shin: new THREE.LatheGeometry([[0, 0.02], [0.065, 0.02], [0.07, -0.08], [0.064, -0.2], [0.052, -0.36], [0.05, -0.4], [0, -0.41]].map(([x, y]) => new THREE.Vector2(x, y)), 20),
  };
  // 通行人用の軽い形 (ポリゴンを 1/3 くらいに)
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
  const GEO_LOW = { ...GEO_HI, ball: GEO_HI.ballLo, hairCap: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cone: new THREE.ConeGeometry(1, 1, 8), torus: new THREE.TorusGeometry(1, 0.22, 6, 14),
    cap: (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8),
    torso: lathe([[0, 0.9], [0.16, 0.9], [0.172, 0.95], [0.158, 1.04], [0.175, 1.16], [0.192, 1.28], [0.19, 1.37], [0.165, 1.44], [0.11, 1.49], [0.065, 1.51], [0, 1.515]], 12),
    thigh: lathe([[0, 0.02], [0.07, 0.02], [0.082, -0.08], [0.088, -0.2], [0.078, -0.36], [0.066, -0.44], [0, -0.46]], 8),
    shin: lathe([[0, 0.02], [0.065, 0.02], [0.07, -0.08], [0.064, -0.2], [0.052, -0.36], [0.05, -0.4], [0, -0.41]], 8) };
  const capCache = new Map(); for (const G_ of [GEO_HI, GEO_LOW]) { const f = G_.cap; G_.cap = (r, len) => { const k = `${G_ === GEO_HI}${r},${len}`; if (!capCache.has(k)) capCache.set(k, f(r, len)); return capCache.get(k); }; }
  const NPC_PANTS = ['#33415e', '#3b3b3f', '#6b5b45', '#2e3b2f', '#5a4632'].map((c) => new THREE.MeshStandardMaterial({ color: c, map: denimTex, roughness: 0.92 }));
  // 部品を集めて、材質ごとに 1 つの形にまとめる
  function seg() {
    const parts = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    return {
      add(geo, mat, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], [sx = 1, sy = 1, sz = 1] = []) {
        m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
        const g2 = (geo.index ? geo : geo).clone().applyMatrix4(m4); for (const k of Object.keys(g2.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g2.deleteAttribute(k);
        if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(g2);
      },
      build(parent) { for (const [mat, list] of parts) { const mesh = shadowy(new THREE.Mesh(mergeGeometries(list, false), mat)); parent.add(mesh); } return parent; },
    };
  }
  // 銃の部品 (本体・レール・銃身・マズル・ハンドガード・照準・弾倉・グリップ・用心金・ストック)。銃口は (0, 0.01, -0.58)
  function gunParts(G, GEO) {
    G.add(GEO.box, gunMetal, [0, 0, 0], [0, 0, 0], [0.065, 0.1, 0.42]);
    G.add(GEO.box, gunMetal, [0, 0.062, -0.02], [0, 0, 0], [0.04, 0.022, 0.36]);
    for (let i = 0; i < 8; i++) G.add(GEO.box, gunGrip, [0, 0.075, -0.17 + i * 0.045], [0, 0, 0], [0.042, 0.008, 0.02]);
    G.add(GEO.cyl, gunMetal, [0, 0.01, -0.36], [Math.PI / 2, 0, 0], [0.016, 0.3, 0.016]);
    G.add(GEO.cyl, gunGrip, [0, 0.01, -0.53], [Math.PI / 2, 0, 0], [0.026, 0.07, 0.026]);
    G.add(GEO.box, gunAccent, [0, -0.005, -0.27], [0, 0, 0], [0.07, 0.07, 0.16]);
    G.add(GEO.box, gunGrip, [0, 0.095, 0.05], [0, 0, 0], [0.03, 0.04, 0.09]);
    G.add(GEO.box, gunGrip, [0, -0.12, -0.03], [0.18, 0, 0], [0.045, 0.15, 0.065]);
    G.add(GEO.box, gunGrip, [0, -0.1, 0.12], [-0.3, 0, 0], [0.042, 0.13, 0.055]);
    G.add(GEO.torus, gunMetal, [0, -0.07, 0.06], [0, Math.PI / 2, 0], [0.035, 0.03, 0.03]);
    G.add(GEO.box, gunAccent, [0, -0.01, 0.3], [0.05, 0, 0], [0.05, 0.09, 0.2]);
  }
  // スナイパーライフル (長い銃身・スコープ・ボルト・ストック・たたんだ二脚)。銃口は (0, 0.01, -0.93)
  const lensMat = new THREE.MeshStandardMaterial({ color: '#0b1d2b', metalness: 0.9, roughness: 0.05, envMapIntensity: 2 });
  function sniperParts(G, GEO) {
    G.add(GEO.box, gunMetal, [0, 0, 0], [0, 0, 0], [0.06, 0.09, 0.42]);                                 // 本体
    G.add(GEO.cyl, gunMetal, [0, 0.01, -0.52], [Math.PI / 2, 0, 0], [0.014, 0.62, 0.014]);              // 長い銃身
    G.add(GEO.cyl, gunGrip, [0, 0.01, -0.87], [Math.PI / 2, 0, 0], [0.022, 0.09, 0.022]);               // マズルブレーキ
    G.add(GEO.cyl, gunGrip, [0, 0.088, -0.02], [Math.PI / 2, 0, 0], [0.024, 0.3, 0.024]);               // スコープ
    G.add(GEO.cyl, gunGrip, [0, 0.088, -0.2], [Math.PI / 2, 0, 0], [0.034, 0.07, 0.034]);
    G.add(GEO.cyl, gunGrip, [0, 0.088, 0.15], [Math.PI / 2, 0, 0], [0.03, 0.05, 0.03]);
    G.add(GEO.cyl, lensMat, [0, 0.088, -0.236], [Math.PI / 2, 0, 0], [0.03, 0.004, 0.03]);
    for (const z of [-0.08, 0.06]) G.add(GEO.box, gunMetal, [0, 0.058, z], [0, 0, 0], [0.03, 0.035, 0.025]); // スコープの台
    G.add(GEO.box, gunAccent, [0, -0.02, 0.33], [0.04, 0, 0], [0.055, 0.12, 0.3]);                      // ストック
    G.add(GEO.box, gunAccent, [0, 0.05, 0.3], [0, 0, 0], [0.045, 0.03, 0.18]);                          // ほお当て
    G.add(GEO.box, gunGrip, [0, -0.1, 0.12], [-0.3, 0, 0], [0.042, 0.13, 0.055]);                       // グリップ
    G.add(GEO.torus, gunMetal, [0, -0.07, 0.06], [0, Math.PI / 2, 0], [0.035, 0.03, 0.03]);             // 用心金
    G.add(GEO.box, gunGrip, [0, -0.075, -0.03], [0, 0, 0], [0.045, 0.07, 0.08]);                        // 弾倉
    G.add(GEO.cyl, gunMetal, [0.045, 0.03, 0.1], [0, 0, Math.PI / 2], [0.008, 0.06, 0.008]);            // ボルト
    G.add(GEO.ballLo, gunGrip, [0.08, 0.03, 0.1], [0, 0, 0], [0.016, 0.016, 0.016]);
    for (const x of [-0.012, 0.012]) G.add(GEO.cyl, gunMetal, [x, -0.03, -0.42], [Math.PI / 2, 0, 0], [0.006, 0.26, 0.006]); // 二脚 (たたんだ)
  }
  // SMG (短い・折りたたみストック・長い弾倉・サプレッサー)。銃口は (0, 0.01, -0.42)
  function smgParts(G, GEO) {
    G.add(GEO.box, gunMetal, [0, 0, -0.02], [0, 0, 0], [0.058, 0.09, 0.3]);                              // 本体
    G.add(GEO.box, gunMetal, [0, 0.055, -0.04], [0, 0, 0], [0.034, 0.02, 0.24]);                          // レール
    G.add(GEO.cyl, gunGrip, [0, 0.01, -0.3], [Math.PI / 2, 0, 0], [0.024, 0.2, 0.024]);                   // サプレッサー
    G.add(GEO.box, gunGrip, [0, 0.08, 0.02], [0, 0, 0], [0.026, 0.035, 0.06]);                           // 照準
    G.add(GEO.box, gunGrip, [0, -0.16, -0.06], [0.08, 0, 0], [0.036, 0.22, 0.05]);                        // 長い弾倉
    G.add(GEO.box, gunGrip, [0, -0.1, 0.09], [-0.3, 0, 0], [0.04, 0.12, 0.05]);                           // グリップ
    G.add(GEO.torus, gunMetal, [0, -0.065, 0.04], [0, Math.PI / 2, 0], [0.03, 0.028, 0.028]);             // 用心金
    for (const x of [-0.022, 0.022]) G.add(GEO.box, gunMetal, [x, 0.0, 0.22], [0, 0, 0], [0.008, 0.03, 0.2]); // 折りたたみストック (細い 2 本)
    G.add(GEO.box, gunMetal, [0, 0.0, 0.32], [0, 0, 0], [0.05, 0.07, 0.015]);
  }
  // 一人称の手と銃 (カメラの子にする)。小さくしてカメラのすぐ前に置く (壁にめりこまない)
  function makeViewModel(color, seed = 1) {
    const GEO = GEO_HI, vm = new THREE.Group(); vm.scale.setScalar(0.35);
    const jacket = new THREE.MeshStandardMaterial({ color, map: fabricTex.map, normalMap: fabricTex.normal, roughness: 0.82 });
    const cuff = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.85 }), skin = skinOf(SKIN[seed % SKIN.length]);
    const limb = (S_, a, b, r, mat) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = new THREE.Vector3().subVectors(B, A), L = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), e = new THREE.Euler().setFromQuaternion(q);
      S_.add(GEO.cap(r, Math.max(0.01, L - 2 * r)), mat, [(A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2], [e.x, e.y, e.z]); };
    const hand = (S_, at, s) => { S_.add(GEO.box, skin, at, [0.3, 0, 0], [0.07, 0.085, 0.04]); for (let i = 0; i < 4; i++) S_.add(GEO.cap(0.009, 0.03), skin, [at[0] + (i - 1.5) * 0.017, at[1] - 0.03, at[2] - 0.03], [1.2, 0, 0]); S_.add(GEO.cap(0.01, 0.03), skin, [at[0] - s * 0.035, at[1] + 0.01, at[2] - 0.02], [0.9, 0, -s * 0.6]); };
    // 銃 + 右手 (グリップ)
    const gun = new THREE.Group(); gun.position.set(0.13, -0.17, -0.42); vm.add(gun);
    const G = seg(); gunParts(G, GEO); hand(G, [0, -0.12, 0.12], 1); G.build(gun);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.01, -0.58); gun.add(tip);
    const sGun = new THREE.Group(); sGun.position.set(0.13, -0.17, -0.42); sGun.visible = false; vm.add(sGun);
    const SG = seg(); sniperParts(SG, GEO); hand(SG, [0, -0.12, 0.12], 1); SG.build(sGun);
    const sTip = new THREE.Object3D(); sTip.position.set(0, 0.01, -0.93); sGun.add(sTip);
    const mGun = new THREE.Group(); mGun.position.set(0.13, -0.17, -0.42); mGun.visible = false; vm.add(mGun);
    const MG = seg(); smgParts(MG, GEO); hand(MG, [0, -0.11, 0.1], 1); MG.build(mGun);
    const mTip = new THREE.Object3D(); mTip.position.set(0, 0.01, -0.42); mGun.add(mTip);
    const RA = seg(); limb(RA, [0.27, -0.5, 0.05], [0.14, -0.3, -0.29], 0.05, jacket); RA.add(GEO.cyl, cuff, [0.15, -0.31, -0.27], [1.0, 0, 0.5], [0.052, 0.04, 0.052]); RA.build(vm);
    // 左手 (ハンドガード) — なぐるときは前へ
    const left = new THREE.Group(); vm.add(left);
    const LA = seg(); limb(LA, [-0.08, -0.52, -0.25], [0.11, -0.24, -0.68], 0.05, jacket); hand(LA, [0.12, -0.22, -0.7], -1); LA.add(GEO.cyl, cuff, [0.1, -0.27, -0.64], [1.1, 0, -0.6], [0.052, 0.04, 0.052]); LA.build(left);
    vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const st = { recoil: 0, walk: 0, punch: 0, reload: 0 };
    let cur = gun;
    const api = { g: vm, gun, tip, left, own: [jacket, cuff],
      setWeapon(w) { gun.visible = w === 'rifle'; sGun.visible = w === 'sniper'; mGun.visible = w === 'smg'; cur = w === 'sniper' ? sGun : w === 'smg' ? mGun : gun; api.tip = w === 'sniper' ? sTip : w === 'smg' ? mTip : tip; st.swap = 1; },
      kick(k = 1) { st.recoil = k; }, punch() { st.punch = performance.now(); },
      update(dt, { speed = 0, run = false, reloading = false, aim = 0 } = {}) {
        st.walk += dt * (speed > 0.3 ? 6 + speed : 0); st.recoil = Math.max(0, st.recoil - dt * 9);
        st.reload += ((reloading ? 1 : 0) - st.reload) * Math.min(1, dt * 8);
        const sway = Math.min(1, speed / 5) * (1 - aim * 0.8), bx = Math.sin(st.walk) * 0.012 * sway, by = Math.abs(Math.cos(st.walk)) * 0.012 * sway;
        const pt = st.punch ? (performance.now() - st.punch) / 300 : 1, pk = pt < 1 ? Math.sin(Math.PI * pt) : 0; if (pt >= 1) st.punch = 0;
        st.swap = Math.max(0, (st.swap || 0) - dt * 3); // 持ちかえ: 下から上がってくる
        cur.position.set(0.13 * (1 - aim) + bx + pk * 0.08, -0.17 + aim * 0.055 - by - (run ? 0.05 : 0) - st.reload * 0.06 - pk * 0.05 - st.swap * 0.25, -0.42 - aim * 0.16 + st.recoil * 0.05); // aim: 照準 (y 0.115) が目の高さに・少し前へ (画面をふさがない)
        cur.rotation.set(st.recoil * 0.08 + st.reload * 0.7 - (run ? 0.25 : 0) + st.swap * 0.6, (run ? 0.5 : 0) + pk * 0.3, st.reload * 0.3);
        left.position.set(pk * -0.05 - aim * 0.13, -st.reload * 0.12 + pk * 0.08 - st.swap * 0.25 + aim * 0.055, -pk * 0.35 + st.reload * 0.15 - aim * 0.16);
      } };
    return api;
  }
  function nameSprite(name) {
    const c = canvas(256, 64), g = c.getContext('2d'); g.font = '800 28px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(name, 128, 32); g.fillStyle = '#fff'; g.fillText(name, 128, 32);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(c, { repeat: false }), depthTest: false, transparent: true, toneMapped: false, fog: false })); s.scale.set(2, 0.5, 1); s.position.y = 2.25; s.renderOrder = 10; return s;
  }
  // 手 (手のひら・指 4 本・親指)。s = 1 (右) / -1 (左)、fist = にぎる
  function addHand(GEO, S_, skin, y, s, fist, low) {
    if (low) { S_.add(GEO.box, skin, [0, y - 0.02, 0], [0, 0, 0], [0.062, 0.1, 0.034]); return; }
    S_.add(GEO.box, skin, [0, y, 0], [0, 0, 0], [0.062, 0.075, 0.03]);
    for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 0.016;
      if (fist) S_.add(GEO.cap(0.0085, 0.022), skin, [x, y - 0.042, -0.014], [Math.PI / 2, 0, 0]); else S_.add(GEO.cap(0.0085, 0.036 - Math.abs(i - 1.5) * 0.005), skin, [x, y - 0.06, 0], [0.15, 0, 0]); }
    S_.add(GEO.cap(0.009, 0.026), skin, [-s * 0.034, y - 0.012, -0.012], [0.4, 0, -s * 0.7]);          // 親指は体の内がわ
  }
  // opts.npc: 通行人 (銃・名前なし、うでは下ろす、服の色いろいろ)。opts.lod = 'low': 軽い形
  function makeChar(color, name, isMe, seed = 1, opts = {}) {
    const low = opts.lod === 'low', GEO = low ? GEO_LOW : GEO_HI, npc = !!opts.npc;
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; // 向き (y) → かたむき (x・z) の順
    const jacket = new THREE.MeshStandardMaterial({ color, map: fabricTex.map, normalMap: fabricTex.normal, roughness: 0.82 });
    const jacketDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), map: fabricTex.map, roughness: 0.85 });
    const skin = skinOf(SKIN[seed % SKIN.length]), hair = hairOf(HAIR[(seed >>> 3) % HAIR.length]);
    // ---- 体 (ジャケット・えり・ファスナー・ポケット・ベルト) ----
    const body = seg();
    body.add(GEO.torso, jacket, [0, 0, 0], [0, 0, 0], [1.08, 1, 0.74]);
    body.add(GEO.torus, jacketDark, [0, 1.47, 0], [Math.PI / 2, 0, 0], [0.085, 0.07, 0.06]);                  // えり
    body.add(GEO.box, metalMat, [0, 1.2, -0.143], [0.05, 0, 0], [0.008, 0.5, 0.006]);                       // ファスナー
    for (const s of [-1, 1]) { body.add(GEO.box, jacketDark, [s * 0.1, 1.02, -0.128], [0.12, 0, 0], [0.085, 0.07, 0.012]); body.add(GEO.box, jacketDark, [s * 0.1, 1.05, -0.134], [0.12, 0, 0], [0.086, 0.012, 0.012]); } // ポケット
    body.add(GEO.cyl, beltMat, [0, 0.93, 0], [0, 0, 0], [0.188, 0.045, 0.14]);
    body.add(GEO.box, metalMat, [0, 0.93, -0.142], [0, 0, 0], [0.05, 0.035, 0.01]);                          // バックル
    for (const s of [-1, 1]) body.add(GEO.ball, jacket, [s * 0.2, 1.415, 0], [0, 0, 0], [0.066, 0.058, 0.064]); // 肩
    body.add(GEO.cyl, skin, [0, 1.535, 0], [0, 0, 0], [0.048, 0.07, 0.048]);                                  // 首
    body.build(g);
    // ---- 頭 (顔・目・まゆ・鼻・口・耳・髪) ----
    const head = new THREE.Group(); head.position.y = 1.66; g.add(head);
    const H = seg();
    H.add(GEO.ball, skin, [0, 0, 0], [0, 0, 0], [0.112, 0.132, 0.12]);
    H.add(GEO.ball, skin, [0, -0.058, -0.022], [0, 0, 0], [0.085, 0.06, 0.09]);                              // あご
    for (const s of [-1, 1]) {
      H.add(GEO.ballLo, scleraMat, [s * 0.04, 0.012, -0.1], [0, 0, 0], [0.019, 0.013, 0.012]);
      H.add(GEO.ballLo, irisMat, [s * 0.04, 0.012, -0.111], [0, 0, 0], [0.0095, 0.0095, 0.004]);
      H.add(GEO.box, hair, [s * 0.042, 0.04, -0.106], [0, 0, s * -0.12], [0.036, 0.008, 0.01]);            // まゆ
      H.add(GEO.ballLo, skin, [s * 0.113, 0.0, 0.005], [0, 0, 0], [0.016, 0.03, 0.022]);                    // 耳
    }
    H.add(GEO.cone, skin, [0, -0.012, -0.122], [-Math.PI / 2 + 0.25, 0, 0], [0.016, 0.04, 0.016]);          // 鼻
    H.add(GEO.box, lipMat, [0, -0.052, -0.108], [0, 0, 0], [0.038, 0.009, 0.008]);                          // 口
    // 髪 (上と後ろ・前髪・横)
    H.add(GEO.hairCap, hair, [0, 0.022, 0.006], [0.38, 0, 0], [0.122, 0.13, 0.13]);                      // 上 (前は額まで・後ろは下まで)
    H.add(GEO.ball, hair, [0, -0.025, 0.058], [0, 0, 0], [0.112, 0.1, 0.075]);                             // 後ろ
    for (let i = -2; i <= 2; i++) H.add(GEO.ballLo, hair, [i * 0.034, 0.085, -0.092], [0.5, 0, i * 0.15], [0.038, 0.026, 0.03]);  // 前髪
    for (const s of [-1, 1]) H.add(GEO.ballLo, hair, [s * 0.105, 0.04, 0.015], [0, 0, 0], [0.025, 0.06, 0.065]);   // 横
    H.build(head);
    if (opts.cap) { // 警官の帽子 (つば付き)
      const C = seg(), capMat = new THREE.MeshStandardMaterial({ color: opts.cap, roughness: 0.6 });
      C.add(GEO.cyl, capMat, [0, 0.105, 0.005], [0.12, 0, 0], [0.128, 0.07, 0.132]); C.add(GEO.box, capMat, [0, 0.075, -0.13], [0.25, 0, 0], [0.2, 0.012, 0.09]);
      C.add(GEO.box, new THREE.MeshStandardMaterial({ color: '#d4a72c', metalness: 0.8, roughness: 0.3 }), [0, 0.115, -0.13], [0.1, 0, 0], [0.035, 0.035, 0.01]); C.build(head);
    }
    // ---- うで (肩 → ひじ → 手) ----
    const arm = (s, fist) => {
      const sh = new THREE.Group(); sh.position.set(s * 0.225, 1.42, 0); g.add(sh);
      const up = seg(); up.add(GEO.cap(0.058, 0.2), jacket, [0, -0.14, 0]); up.build(sh);
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      const lo = seg(); lo.add(GEO.cap(0.05, 0.19), jacket, [0, -0.12, 0]); lo.add(GEO.cyl, jacketDark, [0, -0.225, 0], [0, 0, 0], [0.053, 0.035, 0.053]); // そで口
      addHand(GEO, lo, skin, -0.29, s, fist, low); lo.build(el);
      return { sh, el };
    };
    const R_ = arm(1, true), L_ = arm(-1, true);
    if (npc) { R_.sh.rotation.set(0, 0, 0.08); L_.sh.rotation.set(0, 0, -0.08); R_.el.rotation.x = L_.el.rotation.x = 0.15; } // 通行人: うでを下ろす
    else { R_.sh.rotation.set(1.3, 0, -0.12); R_.el.rotation.x = 0.25; L_.sh.rotation.set(1.2, 0, 0.62); L_.el.rotation.x = 0.35; } // うでは前へ (銃をかまえる)
    // ---- 足 (もも → ひざ → すね → スニーカー) ----
    const legs = [-1, 1].map((s) => {
      const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.92, 0); g.add(hip);
      const pm = npc ? NPC_PANTS[(seed >>> 5) % NPC_PANTS.length] : pantsMat;
      const th = seg(); th.add(GEO.thigh, pm); th.build(hip);
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      const sh2 = seg(); sh2.add(GEO.shin, pm);
      sh2.add(GEO.box, soleMat, [0, -0.445, -0.045], [0, 0, 0], [0.11, 0.03, 0.29]);                         // くつ底
      sh2.add(GEO.ball, shoeMat, [0, -0.41, -0.06], [0, 0, 0], [0.058, 0.05, 0.14]);                        // くつ
      sh2.add(GEO.ball, shoeMat, [0, -0.39, 0.02], [0, 0, 0], [0.052, 0.06, 0.07]);
      for (let i = 0; i < 3; i++) sh2.add(GEO.box, soleMat, [0, -0.37 - i * 0.012, -0.1 - i * 0.025], [0.5, 0, 0], [0.05, 0.005, 0.006]); // くつひも
      sh2.build(knee);
      return { hip, knee };
    });
    // ---- 銃 (本体・銃身・マズル・レール・照準・弾倉・グリップ・用心金・ストック) ----
    const gun = new THREE.Group(); gun.position.set(0.17, 1.3, -0.42); g.add(gun);
    const G = seg(); gunParts(G, GEO); G.build(gun);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.01, -0.58); gun.add(tip);
    let sniper = null, sTip = null, smg = null, mTip = null;
    if (!npc) { sniper = new THREE.Group(); sniper.position.copy(gun.position); sniper.visible = false; g.add(sniper); const SG = seg(); sniperParts(SG, GEO); SG.build(sniper); sTip = new THREE.Object3D(); sTip.position.set(0, 0.01, -0.93); sniper.add(sTip);
      smg = new THREE.Group(); smg.position.copy(gun.position); smg.visible = false; g.add(smg); const MG = seg(); smgParts(MG, GEO); MG.build(smg); mTip = new THREE.Object3D(); mTip.position.set(0, 0.01, -0.42); smg.add(mTip); }
    if (npc) gun.visible = false; else if (!isMe) g.add(nameSprite(name));
    scene.add(g);
    const model = { g, head, gun, tip, sniper, arm: R_.sh, punchArm: L_.sh, legs, L: L_, R: R_, walk: 0, prev: null, npc, own: [jacket, jacketDark], w: 'rifle' };
    model.setWeapon = (w) => { model.w = w; if (npc) return; gun.visible = w === 'rifle' || !w; sniper.visible = w === 'sniper'; smg.visible = w === 'smg'; model.tip = w === 'sniper' ? sTip : w === 'smg' ? mTip : tip; };
    // ふつうの姿勢を覚えておく (ラグドールのあとにもどす)
    model.rest = [g, head, R_.sh, R_.el, L_.sh, L_.el, ...legs.flatMap((l) => [l.hip, l.knee])].map((o) => [o, o.quaternion.clone()]);
    return model;
  }
  // 歩く・なぐる・やられる の動き
  function animateChar(m, now, dt, curbY = 0) {
    if (m.ragdoll) return; // 倒れているあいだはラグドールが体を動かす
    const p = m.g.position;
    if (m.prev) { const sp = Math.hypot(p.x - m.prev.x, p.z - m.prev.z) / Math.max(dt, 1e-3); m.speed = (m.speed || 0) * 0.8 + Math.min(sp, 9) * 0.2; }
    m.prev = { x: p.x, z: p.z };
    const sp = m.speed || 0, moving = sp > 0.4;
    m.walk += dt * (moving ? 4 + sp * 1.1 : 0);
    const amp = moving ? Math.min(0.7, 0.25 + sp * 0.07) : 0;
    // 深手 (limp): 右足をかばって引きずる (振りが小さく、ひざが伸びたまま)
    m.legs.forEach((l, i) => { const ph = Math.sin(m.walk + i * Math.PI), lk = m.limp && i === 1 ? 0.35 : 1; l.hip.rotation.x = THREE.MathUtils.lerp(l.hip.rotation.x, ph * amp * lk, 0.3); l.knee.rotation.x = THREE.MathUtils.lerp(l.knee.rotation.x, Math.max(0, -Math.cos(m.walk + i * Math.PI)) * amp * 1.2 * (m.limp && i === 1 ? 0.2 : 1), 0.3); });
    if (m.npc) { // 通行人: うでをふって歩く・パニックのときは頭の上・隠れるときは頭をかかえる
      const sw = Math.sin(m.walk) * amp * 0.9, c = m.crouchK || 0;
      if (m.handsUp) { m.R.sh.rotation.set(-2.95, 0, 0.25); m.L.sh.rotation.set(-2.95, 0, -0.25); m.R.el.rotation.x = m.L.el.rotation.x = -0.35; } // 強盗に銃を向けられて手を上げる
      else if (m.treat) { m.R.sh.rotation.set(-1.1 + Math.sin(now / 260) * 0.2, 0, 0.2); m.L.sh.rotation.set(-1.0 - Math.sin(now / 260) * 0.2, 0, -0.2); m.R.el.rotation.x = m.L.el.rotation.x = -0.6; } // 処置 (胸を押す)
      else if (m.carry) { m.R.sh.rotation.set(-0.35, 0, 0.12); m.L.sh.rotation.set(-0.35, 0, -0.12); m.R.el.rotation.x = m.L.el.rotation.x = -0.9; } // 担架を持つ
      else if (m.warn) { m.R.sh.rotation.set(-1.75, 0, -0.1); m.R.el.rotation.x = -0.1; m.L.sh.rotation.set(0.1, 0, -0.08); m.L.el.rotation.x = 0.2; } // 手で合図 (はなれて)
      else if (m.panic && moving) { m.R.sh.rotation.set(-2.4 + sw * 0.3, 0, 0.3); m.L.sh.rotation.set(-2.4 - sw * 0.3, 0, -0.3); m.R.el.rotation.x = m.L.el.rotation.x = -1.2; }
      else if (c > 0.05) { m.R.sh.rotation.set(-2.2 * c, 0, 0.5 * c); m.L.sh.rotation.set(-2.2 * c, 0, -0.5 * c); m.R.el.rotation.x = m.L.el.rotation.x = -1.9 * c; }
      else if (m.limp) { m.R.sh.rotation.set(-sw * 0.5, 0, 0.1); m.L.sh.rotation.set(0.35, 0, 0.35); m.L.el.rotation.x = 1.9; m.R.el.rotation.x = 0.3; } // 左手でわき腹を押さえる
      else { m.R.sh.rotation.set(-sw, 0, 0.08); m.L.sh.rotation.set(sw, 0, -0.08); m.R.el.rotation.x = m.L.el.rotation.x = 0.15 + Math.abs(sw) * 0.4; }
    } else {
      // なぐる (左うでを前に突き出す)
      const t = m.swing ? (now - m.swing) / 260 : 1, k = t < 1 ? Math.sin(Math.PI * t) : 0; if (t >= 1) m.swing = 0;
      m.L.sh.rotation.set(1.2 + k * 0.35, 0, 0.62 - k * 0.55); m.L.el.rotation.x = 0.35 - k * 0.35;
    }
    // しゃがむ (隠れる): ひざを曲げて低く
    m.crouchK = THREE.MathUtils.lerp(m.crouchK || 0, m.crouch ? 1 : 0, Math.min(1, dt * 6));
    const ck = m.crouchK;
    if (ck > 0.02) m.legs.forEach((l) => { l.hip.rotation.x = -1.3 * ck; l.knee.rotation.x = 2.2 * ck; });
    // 被弾のよろけ: 当たった向きに体がかたむき、少し後ずさる (強さは設定で変えられる)
    let lean = 0, side = 0, push = 0;
    if (m.react) { const t2 = (now - m.react.t0) / m.react.ms; if (t2 >= 1) m.react = null; else { const e = Math.sin(Math.PI * Math.min(1, t2 * 1.6)) * (1 - t2) * m.react.k; lean = m.react.lz * e; side = -m.react.lx * e; push = e; } }
    m.g.rotation.x = lean * 0.45; m.g.rotation.z = side * 0.45;
    if (m.react) m.head.rotation.x = -lean * 0.5;
    // 起き上がる (0.7 秒): 低い姿勢から立つ
    let rise = 0; if (m.rise) { const t3 = (now - m.rise) / 700; if (t3 >= 1) m.rise = 0; else rise = (1 - t3) * (1 - t3); }
    m.g.rotation.x += rise * 0.9;
    m.bob = moving ? Math.abs(Math.sin(m.walk)) * 0.03 : 0;
    const limpDip = m.limp && moving ? Math.max(0, Math.sin(m.walk + Math.PI)) * 0.07 : 0; // 悪い足に乗るとき沈む
    if (m.limp) m.g.rotation.z += moving ? Math.sin(m.walk) * 0.06 : 0.04;
    m.g.position.y = (m.baseY ?? p.y) + curbY + (m.bob || 0) - ck * 0.42 - rise * 0.5 - limpDip;
    void push;
  }
  // よろける (dir: 弾の向き。世界の向き → キャラの向きに直して使う)
  function react(m, dir, k = 1, ms = 450) {
    const yaw = m.g.rotation.y, c = Math.cos(-yaw), s = Math.sin(-yaw);
    const lx = dir[0] * c - dir[2] * s, lz = dir[0] * s + dir[2] * c;
    m.react = { t0: performance.now(), ms, k, lx, lz };
  }
  // ふつうの姿勢にもどす (ラグドールのあと・復活のとき)
  function restPose(m) {
    for (const [o, q] of m.rest) o.quaternion.copy(q);
    m.ragdoll = null; m.react = null; m.crouch = false; m.crouchK = 0;
    if (!m.npc) m.setWeapon(m.w || 'rifle');
  }
  // 通行人のモデルを消す (形・材質を捨てて、メモリを残さない)
  function disposeChar(m) {
    scene.remove(m.g);
    m.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } });
    for (const mat of m.own || []) mat.dispose();
    for (const c of m.cut || []) { scene.remove(c); c.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); } // はなれた破片
  }

  // ---------- 走る車 (一般車・パトカー・救急車)。前は -z。ホイールは回す・赤色灯は点めつ ----------
  function makeVehicle(kind, color = '#c92a2a') {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const add = (geo, mat, x, y, z, rx = 0) => { const m = shadowy(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); m.rotation.x = rx; body.add(m); return m; };
    const van = kind === 'ambulance', W = van ? 2.1 : 1.9, L = van ? 5.4 : 4.4;
    const paint = carPaint(kind === 'civ' ? color : '#f4f4f2'), black = carPaint('#15171a'), red = carPaint('#c92a2a');
    if (!van) {
      add(new THREE.BoxGeometry(W, 0.55, L), paint, 0, 0.6, 0); add(new THREE.BoxGeometry(W * 0.96, 0.12, L * 0.96), paint, 0, 0.92, 0);
      add(new THREE.BoxGeometry(W * 0.86, 0.5, L * 0.48), glassDark, 0, 1.22, 0.2); add(new THREE.BoxGeometry(W * 0.84, 0.06, L * 0.42), paint, 0, 1.48, 0.2);
      if (kind === 'police') { add(new THREE.BoxGeometry(W * 1.005, 0.32, L * 0.5), black, 0, 0.55, 0.15); add(new THREE.BoxGeometry(W * 0.9, 0.06, L * 0.3), black, 0, 0.99, -1.2); } // 白黒のパトカー
    } else { // 救急車: 箱型・赤い帯
      add(new THREE.BoxGeometry(W, 2.0, L * 0.68), paint, 0, 1.35, 0.85); add(new THREE.BoxGeometry(W, 1.15, L * 0.32), paint, 0, 0.92, -1.8);
      add(new THREE.BoxGeometry(W * 0.94, 0.55, 0.06), glassDark, 0, 1.45, -1.33, 0.35); add(new THREE.BoxGeometry(W * 1.01, 0.22, L * 0.99), red, 0, 1.0, 0);
      for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.02, 0.5, 0.14), red, sx * (W / 2 + 0.01), 1.75, 1.0); add(new THREE.BoxGeometry(0.02, 0.14, 0.5), red, sx * (W / 2 + 0.01), 1.75, 1.0); } // 赤十字
    }
    const top = van ? 2.38 : 1.53, bar = [];
    if (kind !== 'civ') { // 赤色灯 (点めつ)
      for (const [x, c] of [[-0.35, '#ff2222'], [0.35, kind === 'police' ? '#2255ff' : '#ff2222']]) { const mt = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2 }); bar.push(mt); add(new THREE.BoxGeometry(0.6, 0.14, 0.26), mt, x, top + 0.07, van ? -1.2 : 0.2); }
    }
    for (const sx of [-1, 1]) { const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), lightMat); hl.position.set(sx * W * 0.32, van ? 0.9 : 0.72, -L / 2); body.add(hl); const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.06), tailMat); tl.position.set(sx * W * 0.34, van ? 1.0 : 0.75, L / 2); body.add(tl); }
    const wheels = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(sx * (W / 2 - 0.08), 0.36, sz * L * 0.32); body.add(pv);
      const wh = shadowy(new THREE.Mesh(wheelGeo, rubber)); wh.rotation.z = Math.PI / 2; pv.add(wh);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12), chrome); cap.rotation.z = Math.PI / 2; pv.add(cap); wheels.push(pv);
    }
    scene.add(g);
    return { g, body, wheels, bar, kind, color, front: wheels.filter((_, i) => i % 2 === 0) };
  }
  // 車の中 (運転席から見る): ボンネット・ダッシュボード・メーター (速さ)・ハンドル・柱・天井・ドア・座席・ミラー。運転席は右 (x = +0.42)
  function makeCarInterior(kind, color) {
    const g = new THREE.Group(), van = kind === 'ambulance', W = van ? 2.1 : 1.9;
    const dark = new THREE.MeshStandardMaterial({ color: '#202327', roughness: 0.85 }), dash = new THREE.MeshStandardMaterial({ color: '#2b2f35', roughness: 0.7 }), liner = new THREE.MeshStandardMaterial({ color: '#c9c4bb', roughness: 0.95 });
    const paint = carPaint(kind === 'civ' ? color : '#f4f4f2'), seat = new THREE.MeshStandardMaterial({ color: '#3b3f46', map: fabricTex.map, roughness: 0.9 }), trim = new THREE.MeshStandardMaterial({ color: '#8a8f96', metalness: 0.7, roughness: 0.35 });
    const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
    const zf = van ? -1.55 : -0.85; // 前のガラスの下の位置
    box(W * 0.96, 0.1, van ? 0.9 : 1.6, paint, 0, 0.95, zf - (van ? 0.45 : 0.8), 0.06);            // ボンネット
    box(W * 0.94, 0.26, 0.55, dash, 0, 0.9, zf + 0.12);                                              // ダッシュボード
    box(0.5, 0.08, 0.2, dark, 0.42, 1.17, zf + 0.36, -0.25);                                        // メーターのひさし
    box(W * 0.94, 0.55, 0.06, dash, 0, 0.62, zf + 0.42);                                             // 足もとの前の板
    box(W * 0.94, 0.05, 2.6, dark, 0, 0.36, 0.3);                                                    // 床
    // メーター: 速さを絵 (canvas) に描いて、変わったときだけ書きなおす
    const sc = canvas(256, 128), sg = sc.getContext('2d'), stex = tex(sc, { repeat: false });
    const meter = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false })); meter.position.set(0.42, 1.09, zf + 0.42); meter.rotation.x = -0.3; g.add(meter);
    let last = -1;
    const setSpeed = (kmh) => { const v = Math.round(Math.abs(kmh)); if (v === last) return; last = v;
      sg.fillStyle = '#0b0d12'; sg.fillRect(0, 0, 256, 128); sg.strokeStyle = '#2b2f35'; sg.lineWidth = 6; sg.strokeRect(3, 3, 250, 122);
      sg.strokeStyle = '#495057'; sg.lineWidth = 10; sg.beginPath(); sg.arc(70, 92, 52, Math.PI, Math.PI * 2); sg.stroke();
      const a = Math.PI + Math.PI * Math.min(1, v / 120); sg.strokeStyle = v > 90 ? '#ff6b6b' : '#ffd43b'; sg.beginPath(); sg.arc(70, 92, 52, Math.PI, a); sg.stroke();
      sg.strokeStyle = '#ff6b6b'; sg.lineWidth = 4; sg.beginPath(); sg.moveTo(70, 92); sg.lineTo(70 + Math.cos(a) * 46, 92 + Math.sin(a) * 46); sg.stroke();
      sg.fillStyle = '#e9ecef'; sg.font = '900 50px system-ui,sans-serif'; sg.textAlign = 'right'; sg.fillText(String(v), 240, 70); sg.font = '700 22px system-ui,sans-serif'; sg.fillStyle = '#adb5bd'; sg.fillText('km/h', 240, 104);
      stex.needsUpdate = true; };
    setSpeed(0);
    // ハンドル (回る)
    const wheel = new THREE.Group(); wheel.position.set(0.42, 0.93, zf + 0.62); wheel.rotation.x = -1.2; g.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.024, 10, 36), dark); wheel.add(rim);
    for (const a of [0, Math.PI * 0.75, Math.PI * 1.25]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), dark); sp.position.set(Math.sin(a) * 0.085, -Math.cos(a) * 0.085, 0); sp.rotation.z = a; wheel.add(sp); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 16), trim); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    box(0.06, 0.06, 0.4, dark, 0.42, 0.86, zf + 0.45, 0.6);                                        // ハンドルの軸
    // 柱 (前・まん中)・天井・前のガラスの上の枠・ドア・ひじかけ
    const top = van ? 1.75 : 1.5;
    for (const sx of [-1, 1]) {
      box(0.05, 0.72, 0.06, paint, sx * (W / 2 - 0.05), 1.23, zf + 0.26, -0.62);                     // 前の柱 (ななめ)
      box(0.1, top - 0.9, 0.12, paint, sx * (W / 2 - 0.06), (top + 0.9) / 2, 0.95);                  // まん中の柱
      box(0.06, 0.66, 1.8, dash, sx * (W / 2 - 0.04), 0.7, 0.1);                                     // ドア
      box(0.12, 0.06, 0.6, liner, sx * (W / 2 - 0.12), 0.98, 0.25);                                  // ひじかけ
    }
    box(W * 0.94, 0.05, 2.1, liner, 0, top, 0.2);                                                    // 天井
    box(W * 0.94, 0.08, 0.1, paint, 0, top - 0.03, zf + 0.5);                                        // 前のガラスの上
    box(0.18, 0.05, 0.02, dark, 0, top - 0.1, zf + 0.6);                                             // ルームミラー
    for (const sx of [-1, 1]) box(0.16, 0.1, 0.06, paint, sx * (W / 2 + 0.1), 1.05, zf + 0.3);       // サイドミラー
    for (const sx of [-0.42, 0.42]) { box(0.5, 0.12, 0.55, seat, sx, 0.62, 0.45); box(0.5, 0.7, 0.12, seat, sx, 0.95, 0.75, 0.15); }  // 座席
    box(0.05, 0.22, 0.05, trim, 0, 0.78, zf + 0.75, 0.3);                                            // シフトレバー
    // 前のガラス (うっすら映りこみ)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 0.62), new THREE.MeshStandardMaterial({ color: '#9fb3c8', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.5, depthWrite: false }));
    glass.position.set(0, (top + 1.05) / 2, zf + 0.28); glass.rotation.x = -0.62; g.add(glass);
    if (kind !== 'civ') { const radio = box(0.3, 0.12, 0.2, dark, -0.05, 0.98, zf + 0.25); radio.rotation.x = -0.3; }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    return { g, wheel, setSpeed, eye: [0.42, van ? 1.32 : 1.13, 0.35] };
  }
  // 担架 (運ばれる人の下)
  function makeStretcher() { const s = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 2.0), new THREE.MeshStandardMaterial({ color: '#e8590c', roughness: 0.6 })); s.add(m1); const m2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 1.9), new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.8 })); m2.position.y = 0.05; s.add(m2); scene.add(s); return s; }
  // 落ちているお金
  const cashMat = new THREE.MeshStandardMaterial({ color: '#2f9e44', emissive: '#2b8a3e', emissiveIntensity: 0.35, roughness: 0.6 });
  function makeCash() { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.16), cashMat); m.position.y = 0.05 + i * 0.035; m.rotation.y = i * 0.3; g.add(m); } scene.add(g); return g; }

  scene.add(camera); // 一人称の手と銃をカメラの子にするため
  return { renderer, scene, camera, composer, resize, follow, curbAt, makeChar, makeViewModel, makeVehicle, makeCarInterior, makeStretcher, makeCash, animateChar, react, restPose, disposeChar, quality: qName, qualities: Object.keys(QUALITY), sunDir, Q,
    render() { const now = performance.now(); adapt(now); wind.value = now / 1000; if (grade) grade.material.uniforms.uTime.value = now / 1000; composer.render(); },
    get pixelRatio() { return PR; },
    setQuality(q) { try { localStorage.setItem('arena_quality', q); } catch {} } };
}
