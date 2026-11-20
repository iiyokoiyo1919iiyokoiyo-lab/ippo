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

  // ---------- キャラクター (人の形・歩く・なぐる) ----------
  const skinMats = ['#e8c39e', '#c99b74', '#8d5a3b', '#f1d3b5'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  const pants = new THREE.MeshStandardMaterial({ color: '#2b3448', roughness: 0.9 }), shoes = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 0.8 }), gunMetal = new THREE.MeshStandardMaterial({ color: '#2a2d31', metalness: 0.75, roughness: 0.38 }), gunGrip = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.8 });
  const cap = (r, len, mat) => shadowy(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat));
  function nameSprite(name) {
    const c = canvas(256, 64), g = c.getContext('2d'); g.font = '800 28px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(name, 128, 32); g.fillStyle = '#fff'; g.fillText(name, 128, 32);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(c, { repeat: false }), depthTest: false, transparent: true, toneMapped: false, fog: false })); s.scale.set(2, 0.5, 1); s.position.y = 2.25; s.renderOrder = 10; return s;
  }
  function makeChar(color, name, isMe, seed = 1) {
    const g = new THREE.Group(), jacket = new THREE.MeshStandardMaterial({ color, roughness: 0.75 }), skin = skinMats[seed % skinMats.length];
    // 足 (ももの付け根から: もも → ひざ → すね → くつ)
    const legs = [-1, 1].map((s) => { const hip = new THREE.Group(); hip.position.set(s * 0.11, 0.93, 0); const th = cap(0.085, 0.32, pants); th.position.y = -0.22; hip.add(th);
      const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee); const sh = cap(0.075, 0.3, pants); sh.position.y = -0.2; knee.add(sh);
      const shoe = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.27), shoes)); shoe.position.set(0, -0.42, -0.05); knee.add(shoe); g.add(hip); return { hip, knee }; });
    // 体 (ジャケット)・首・頭・髪
    const torso = cap(0.17, 0.36, jacket); torso.scale.set(1.25, 1, 0.82); torso.position.y = 1.2; g.add(torso);
    const belt = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.07, 14), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.5 }))); belt.scale.set(1.18, 1, 0.82); belt.position.y = 0.95; g.add(belt);
    const neck = cap(0.055, 0.06, skin); neck.position.y = 1.5; g.add(neck);
    const head = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), skin)); head.scale.set(1, 1.12, 1.05); head.position.y = 1.66; g.add(head);
    const hair = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.132, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat)); hair.scale.set(1, 1.1, 1.08); hair.position.set(0, 1.68, 0.01); g.add(hair);
    // うで: 右は銃を持つ・左はなぐる
    const arm = (s) => { const sh = new THREE.Group(); sh.position.set(s * 0.26, 1.42, 0); const up = cap(0.06, 0.24, jacket); up.position.y = -0.15; sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el); const lo = cap(0.052, 0.22, jacket); lo.position.y = -0.13; el.add(lo); const hand = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin)); hand.position.y = -0.29; el.add(hand); g.add(sh); return { sh, el, hand }; };
    const R_ = arm(1), L_ = arm(-1);
    R_.sh.rotation.x = -1.35; R_.el.rotation.x = -0.25; L_.sh.rotation.set(-1.15, 0, 0.55); L_.el.rotation.x = -0.75;
    // 銃 (本体・銃身・弾倉・グリップ・照準)
    const gun = new THREE.Group(); gun.position.set(0.2, 1.32, -0.42); g.add(gun);
    const part = (geo, mat, x, y, z, rx = 0) => { const m = shadowy(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); m.rotation.x = rx; gun.add(m); return m; };
    part(new THREE.BoxGeometry(0.07, 0.11, 0.5), gunMetal, 0, 0, 0);
    part(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 10), gunMetal, 0, 0.02, -0.4, Math.PI / 2);
    part(new THREE.BoxGeometry(0.05, 0.16, 0.07), gunGrip, 0, -0.12, 0.05, 0.2);
    part(new THREE.BoxGeometry(0.045, 0.14, 0.06), gunGrip, 0, -0.1, 0.19, -0.25);
    part(new THREE.BoxGeometry(0.03, 0.04, 0.12), gunMetal, 0, 0.08, -0.05);
    part(new THREE.BoxGeometry(0.06, 0.09, 0.2), gunGrip, 0, -0.01, 0.32);
    const tip = new THREE.Object3D(); tip.position.set(0, 0.02, -0.58); gun.add(tip);
    if (!isMe) g.add(nameSprite(name));
    scene.add(g);
    return { g, head, gun, tip, arm: R_.sh, punchArm: L_.sh, legs, L: L_, R: R_, walk: 0, prev: null };
  }
  // 歩く・なぐる・やられる の動き
  function animateChar(m, now, dt, curbY = 0) {
    const p = m.g.position;
    if (m.prev) { const sp = Math.hypot(p.x - m.prev.x, p.z - m.prev.z) / Math.max(dt, 1e-3); m.speed = (m.speed || 0) * 0.8 + Math.min(sp, 9) * 0.2; }
    m.prev = { x: p.x, z: p.z };
    const sp = m.speed || 0, moving = sp > 0.4;
    m.walk += dt * (moving ? 4 + sp * 1.1 : 0);
    const amp = moving ? Math.min(0.7, 0.25 + sp * 0.07) : 0;
    m.legs.forEach((l, i) => { const ph = Math.sin(m.walk + i * Math.PI); l.hip.rotation.x = THREE.MathUtils.lerp(l.hip.rotation.x, ph * amp, 0.3); l.knee.rotation.x = THREE.MathUtils.lerp(l.knee.rotation.x, Math.max(0, -Math.cos(m.walk + i * Math.PI)) * amp * 1.2, 0.3); });
    // なぐる (左うでを前に突き出す)
    const t = m.swing ? (now - m.swing) / 260 : 1, k = t < 1 ? Math.sin(Math.PI * t) : 0; if (t >= 1) m.swing = 0;
    m.L.sh.rotation.set(-1.15 - k * 0.4, 0, 0.55 - k * 0.45); m.L.el.rotation.x = -0.75 + k * 0.75;
    m.bob = moving ? Math.abs(Math.sin(m.walk)) * 0.03 : 0;
    m.g.position.y = (m.baseY ?? p.y) + curbY + (m.bob || 0);
  }

  return { renderer, scene, camera, composer, resize, follow, curbAt, makeChar, animateChar, quality: qName, qualities: Object.keys(QUALITY), sunDir,
    render() { composer.render(); },
    setQuality(q) { try { localStorage.setItem('arena_quality', q); } catch {} } };
}
