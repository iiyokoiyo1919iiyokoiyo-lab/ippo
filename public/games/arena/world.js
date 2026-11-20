// =====================================================================
// シティバトル: 見た目 (リアルな街・キャラクター・光と影・画面の仕上げ)
//   ・画像ファイルは使わず、壁・アスファルト・歩道・草などの質感はすべてプログラムで描く (手続き的なテクスチャ)
//   ・PBR (MeshStandardMaterial)・空 (Sky)・空からの映りこみ (PMREM)・太陽の影・ACES の色・ブルーム・AO・FXAA
//   ・画質は 3 段階 (low / medium / high)。スマホは medium、パソコンは high から始まる (画面の ⚙️ で変えられる)
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
import { Sky } from './vendor/jsm/objects/Sky.js';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';

const BLOCK = 18, ROAD = 8, N = 5, CURB = 0.15;
const QUALITY = {
  low: { pr: 1, shadow: 0, bloom: false, ao: false, texSize: 256, props: 0.5 },
  medium: { pr: 1.5, shadow: 1024, bloom: true, ao: false, texSize: 512, props: 1 },
  high: { pr: 2, shadow: 2048, bloom: true, ao: true, texSize: 512, props: 1 },
};

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
function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
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
    M.asphalt = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: tex(normalFrom(hc, 3), { srgb: false }), roughness: 0.93, metalness: 0 }); }
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

// ---------- 描画のしくみ ----------
export function createGraphics({ canvasEl, isTouch, map, A }) {
  let qName = (() => { try { return localStorage.getItem('arena_quality'); } catch { return null; } })();
  if (!QUALITY[qName]) qName = isTouch ? 'medium' : 'high';
  const Q = QUALITY[qName];
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
  const PR = Math.min(devicePixelRatio, Q.pr);
  renderer.setPixelRatio(PR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = !!Q.shadow; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
  const R = rng(9137);

  // 空と太陽 (夕方の少し前・あたたかい光)
  const sky = new Sky(); sky.scale.setScalar(1000); scene.add(sky);
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
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
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
    const geo = tiledBox(BLOCK, CURB, BLOCK, 2); const sw = receive(new THREE.Mesh(geo, [M.curb, M.curb, M.sidewalk, M.curb, M.curb, M.curb]));
    sw.position.set(blockOrigin(i) + BLOCK / 2, CURB / 2, blockOrigin(j) + BLOCK / 2); scene.add(sw);
  }
  for (const b of map.boxes.filter((x) => x.kind === 'grass')) {
    const geo = new THREE.PlaneGeometry(b.w - 3, b.d - 3); geo.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (b.w - 3) / 4; });
    const gm = receive(new THREE.Mesh(geo, M.grass)); gm.rotation.x = -Math.PI / 2; gm.position.set(b.x, CURB + 0.01, b.z); scene.add(gm);
  }
  { // 白線 (破線)・横断歩道: まとめて 1 つ (InstancedMesh)
    const lineMat = new THREE.MeshStandardMaterial({ color: '#cfcabe', roughness: 0.75 }), dash = [], cross = [];
    for (let i = 0; i <= N; i++) {
      const c = -A.HALF + ROAD / 2 + i * (BLOCK + ROAD);
      for (let t = -A.HALF + 1; t < A.HALF - 1; t += 3) {
        const local = ((t + A.HALF) % (BLOCK + ROAD)); if (local < ROAD + 1 || local > ROAD + BLOCK - 1) continue; // 交差点はぬかす
        dash.push([c, t, 0], [t, c, Math.PI / 2]);
      }
      for (let j = 0; j <= N; j++) { // 横断歩道 (交差点の 4 方向)
        const cz = -A.HALF + ROAD / 2 + j * (BLOCK + ROAD);
        for (let s = -3; s <= 3; s += 1) { cross.push([c + s, cz + ROAD / 2 + 1.1, 0], [c + s, cz - ROAD / 2 - 1.1, 0], [c + ROAD / 2 + 1.1, cz + s, Math.PI / 2], [c - ROAD / 2 - 1.1, cz + s, Math.PI / 2]); }
      }
    }
    const put = (list, w, l) => { const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(w, l), lineMat, list.length), o = new THREE.Object3D();
      list.forEach(([x, z, r], k) => { o.position.set(x, 0.012, z); o.rotation.set(-Math.PI / 2, 0, r); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); receive(im); scene.add(im); };
    put(dash, 0.15, 1.5); put(cross, 0.5, 2.2);
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
  for (const b of map.boxes) {
    if (b.kind === 'building') {
      const styles = ['brick', 'concrete', 'glass', 'plaster'], style = b.h >= 16 && R() < 0.6 ? 'glass' : styles[Math.floor(R() * 4)];
      const col = PAL[style][Math.floor(R() * PAL[style].length)], fm = facade(style, col);
      const bm = shadowy(new THREE.Mesh(tiledBox(b.w, b.h, b.d), [fm, fm, M.roof, M.roof, fm, fm])); bm.position.set(b.x, b.h / 2, b.z); scene.add(bm);
      // 1 階の入り口まわり (少し出っぱった帯)
      const band = shadowy(new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, 0.5, b.d + 0.12), new THREE.MeshStandardMaterial({ color: '#4b4f54', roughness: 0.6 }))); band.position.set(b.x, 3.2, b.z); scene.add(band);
      // 屋上のふち・機械・給水タンク
      const par = shadowy(new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.3, 0.5, b.d + 0.3), M.concrete)); par.position.set(b.x, b.h + 0.25, b.z); scene.add(par);
      if (Q.props >= 1) for (let k = 0; k < 2; k++) { const ac = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1), roofBox)); ac.position.set(b.x + (R() - 0.5) * (b.w - 2), b.h + 0.45, b.z + (R() - 0.5) * (b.d - 2)); scene.add(ac); }
      if (R() < 0.3) { const tank = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.8, 16), new THREE.MeshStandardMaterial({ color: '#8b6b4a', roughness: 0.8 }))); tank.position.set(b.x + b.w / 4, b.h + 1.6, b.z - b.d / 4); scene.add(tank); }
    } else if (b.kind === 'car') {
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
    } else if (b.kind === 'crate' || b.kind === 'wall' || b.kind === 'fence') {
      const m = shadowy(new THREE.Mesh(tiledBox(b.w, b.h, b.d, b.kind === 'crate' ? Math.max(b.w, b.h) : 3), b.kind === 'crate' ? M.crate : M.concrete)); m.position.set(b.x, b.y0 + b.h / 2, b.z); scene.add(m);
    }
  }
  // 街灯・街路樹・消火栓 (歩道のふち)
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f44', metalness: 0.7, roughness: 0.45 }), lamp = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffe2a8', emissiveIntensity: 3 });
    const hydMat = new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.5, metalness: 0.2 });
    const lights = [], trees = [], hyd = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x0 = blockOrigin(i), z0 = blockOrigin(j);
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
    const leafList = trees.flatMap(([x, z]) => [[x, z, 0], [x + 0.6, z + 0.3, 1], [x - 0.4, z - 0.5, 2]]);
    const lm = inst(leafGeo, leafMat, leafList, (o, [x, z, k]) => { const s = [1.5, 1.1, 1.2][k]; o.position.set(x, CURB + [3.4, 3.0, 3.8][k], z); o.scale.set(s, s * 0.9, s); o.rotation.set(R(), R(), 0); });
    const tc = new THREE.Color(); leafList.forEach((_, k) => { tc.setHSL(0.24 + R() * 0.07, 0.45 + R() * 0.2, 0.22 + R() * 0.1); lm.setColorAt(k, tc); });
    inst(new THREE.CylinderGeometry(0.13, 0.15, 0.7, 10), hydMat, hyd, (o, [x, z]) => { o.position.set(x, CURB + 0.35, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); });
  }
  // 遠くのビル群 (かべの外。当たり判定なし・霧でかすむ)
  { const mat = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.9 }), list = [];
    for (let k = 0; k < 90; k++) { const a = R() * Math.PI * 2, r = A.HALF + 30 + R() * 120; list.push([Math.cos(a) * r, Math.sin(a) * r, 6 + R() * 7, 6 + R() * 7, 10 + R() * 60]); }
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length), o = new THREE.Object3D();
    list.forEach(([x, z, w, d, h], k) => { o.position.set(x, h / 2, z); o.scale.set(w, h, d); o.rotation.set(0, R() * 3, 0); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); scene.add(im); }

  // ---------- 画面の仕上げ: ブルーム (光のにじみ)・AO (すき間の陰)・ACES・FXAA ----------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null, bloom = null;
  if (Q.ao) { gtao = new GTAOPass(scene, camera, 1, 1); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.85; gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1 }); composer.addPass(gtao); }
  if (Q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.45, 1.05); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setPixelRatio(PR); composer.setSize(w, h);
    camera.aspect = w / h; camera.fov = w < h ? 82 : 70; camera.updateProjectionMatrix();
    fxaa.material.uniforms.resolution.value.set(1 / (w * PR), 1 / (h * PR));
  }
  // 影は自分のまわりだけ (太陽の影のカメラを、自分についていかせる)
  function follow(x, z) { if (!Q.shadow) return; const sx = Math.round(x / 4) * 4, sz = Math.round(z / 4) * 4; sun.target.position.set(sx, 0, sz); sun.position.set(sx + sunDir.x * 90, sunDir.y * 90, sz + sunDir.z * 90); }
  // 歩道の上は少し高い (見た目だけ。当たり判定は変えない)
  function curbAt(x, z) { const lx = ((x + A.HALF) % (BLOCK + ROAD) + (BLOCK + ROAD)) % (BLOCK + ROAD), lz = ((z + A.HALF) % (BLOCK + ROAD) + (BLOCK + ROAD)) % (BLOCK + ROAD); return lx >= ROAD && lz >= ROAD && Math.abs(x) < A.HALF - 0.5 && Math.abs(z) < A.HALF - 0.5 ? CURB : 0; }

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
    const RA = seg(); limb(RA, [0.27, -0.5, 0.05], [0.14, -0.3, -0.29], 0.05, jacket); RA.add(GEO.cyl, cuff, [0.15, -0.31, -0.27], [1.0, 0, 0.5], [0.052, 0.04, 0.052]); RA.build(vm);
    // 左手 (ハンドガード) — なぐるときは前へ
    const left = new THREE.Group(); vm.add(left);
    const LA = seg(); limb(LA, [-0.08, -0.52, -0.25], [0.11, -0.24, -0.68], 0.05, jacket); hand(LA, [0.12, -0.22, -0.7], -1); LA.add(GEO.cyl, cuff, [0.1, -0.27, -0.64], [1.1, 0, -0.6], [0.052, 0.04, 0.052]); LA.build(left);
    vm.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const st = { recoil: 0, walk: 0, punch: 0, reload: 0 };
    let cur = gun;
    const api = { g: vm, gun, tip, left, own: [jacket, cuff],
      setWeapon(w) { const s2 = w === 'sniper'; gun.visible = !s2; sGun.visible = s2; cur = s2 ? sGun : gun; api.tip = s2 ? sTip : tip; st.swap = 1; },
      kick(k = 1) { st.recoil = k; }, punch() { st.punch = performance.now(); },
      update(dt, { speed = 0, run = false, reloading = false, aim = 0 } = {}) {
        st.walk += dt * (speed > 0.3 ? 6 + speed : 0); st.recoil = Math.max(0, st.recoil - dt * 9);
        st.reload += ((reloading ? 1 : 0) - st.reload) * Math.min(1, dt * 8);
        const sway = Math.min(1, speed / 5) * (1 - aim * 0.8), bx = Math.sin(st.walk) * 0.012 * sway, by = Math.abs(Math.cos(st.walk)) * 0.012 * sway;
        const pt = st.punch ? (performance.now() - st.punch) / 300 : 1, pk = pt < 1 ? Math.sin(Math.PI * pt) : 0; if (pt >= 1) st.punch = 0;
        st.swap = Math.max(0, (st.swap || 0) - dt * 3); // 持ちかえ: 下から上がってくる
        cur.position.set(0.13 * (1 - aim) + bx + pk * 0.08, -0.17 + aim * 0.055 - by - (run ? 0.05 : 0) - st.reload * 0.06 - pk * 0.05 - st.swap * 0.25, -0.42 + aim * 0.06 + st.recoil * 0.05); // aim: 照準 (y 0.115) が目の高さに
        cur.rotation.set(st.recoil * 0.08 + st.reload * 0.7 - (run ? 0.25 : 0) + st.swap * 0.6, (run ? 0.5 : 0) + pk * 0.3, st.reload * 0.3);
        left.position.set(pk * -0.05 - aim * 0.13, -st.reload * 0.12 + pk * 0.08 - st.swap * 0.25 + aim * 0.055, -pk * 0.35 + st.reload * 0.15 + aim * 0.06);
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
    let sniper = null, sTip = null;
    if (!npc) { sniper = new THREE.Group(); sniper.position.copy(gun.position); sniper.visible = false; g.add(sniper); const SG = seg(); sniperParts(SG, GEO); SG.build(sniper); sTip = new THREE.Object3D(); sTip.position.set(0, 0.01, -0.93); sniper.add(sTip); }
    if (npc) gun.visible = false; else if (!isMe) g.add(nameSprite(name));
    scene.add(g);
    const model = { g, head, gun, tip, sniper, arm: R_.sh, punchArm: L_.sh, legs, L: L_, R: R_, walk: 0, prev: null, npc, own: [jacket, jacketDark], w: 'rifle' };
    model.setWeapon = (w) => { model.w = w; if (npc) return; gun.visible = w !== 'sniper'; sniper.visible = w === 'sniper'; model.tip = w === 'sniper' ? sTip : tip; };
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
      if (m.panic && moving) { m.R.sh.rotation.set(-2.4 + sw * 0.3, 0, 0.3); m.L.sh.rotation.set(-2.4 - sw * 0.3, 0, -0.3); m.R.el.rotation.x = m.L.el.rotation.x = -1.2; }
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

  scene.add(camera); // 一人称の手と銃をカメラの子にするため
  return { renderer, scene, camera, composer, resize, follow, curbAt, makeChar, makeViewModel, animateChar, react, restPose, disposeChar, quality: qName, qualities: Object.keys(QUALITY), sunDir, Q,
    render() { composer.render(); },
    setQuality(q) { try { localStorage.setItem('arena_quality', q); } catch {} } };
}
