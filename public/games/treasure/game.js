// =====================================================================
// 宝探し (ブラウザ側): three.js でキャンパスを描いて、歩いて宝箱をさがす (戦いなし)
//   ・パソコン: WASD・マウス (クリックで視点を固定)・Space ジャンプ・Shift ダッシュ
//   ・スマホ: 画面の左半分を触るとスティックが出て移動・右半分をなぞって見回す・「ジャンプ」
//   ・宝箱は近く (22m いない) のものだけサーバーから届く。遠いときはヒント (あつい / あたたかい / すずしい / つめたい)
//   ・見た目: 打ちっぱなしのコンクリート (型枠の線・小さな穴)・ガラスの校舎・赤いテント・砂のグラウンド・クスノキ
// =====================================================================
import * as THREE from '../arena/vendor/three.module.min.js';
import { Sky } from '../arena/vendor/jsm/objects/Sky.js';
const A = window.ArenaMap, map = window.CampusMap.build();
const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('is-touch');
$('#howto').textContent = isTouch ? '画面の左側を触ってスティックで移動・右側をなぞって見回す・「ジャンプ」' : 'WASD で移動・マウスで見回す (クリックで固定)・Space ジャンプ・Shift ダッシュ';

// ---------- 描画 ----------
const canvas = $('#c'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
scene.fog = new THREE.Fog('#c3d6e8', 110, 300);
const sky = new Sky(); sky.scale.setScalar(500); scene.add(sky);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 55), THREE.MathUtils.degToRad(150));
Object.assign(sky.material.uniforms.turbidity, { value: 2 }); sky.material.uniforms.rayleigh.value = 1.2; sky.material.uniforms.sunPosition.value.copy(sunDir);
{ const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene(), s2 = new Sky(); s2.scale.setScalar(500); for (const k of ['turbidity', 'rayleigh']) s2.material.uniforms[k].value = sky.material.uniforms[k].value; s2.material.uniforms.sunPosition.value.copy(sunDir); env.add(s2); scene.environment = pm.fromScene(env, 0.02).texture; }
const sun = new THREE.DirectionalLight('#fff4e0', 2.4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target, new THREE.HemisphereLight('#cfe3ff', '#8a7a62', 0.55));
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 80 : 70; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- 質感 (絵はプログラムで描く) ----------
let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const cv = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c, rep = true) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
const speck = (g, w, h, n, cols, a = 0.5, s = 1.6) => { for (let i = 0; i < n; i++) { g.globalAlpha = a * (0.4 + R() * 0.6); g.fillStyle = cols[(R() * cols.length) | 0]; g.fillRect(R() * w, R() * h, s, s); } g.globalAlpha = 1; };
// 打ちっぱなしのコンクリート: 1 枚 = 1.8m × 0.9m の型枠。継ぎ目の線と 6 つの小さな穴・雨のしみ
function concreteTex(tone = 168) {
  const c = cv(256, 128), g = c.getContext('2d'); g.fillStyle = `rgb(${tone},${tone - 2},${tone - 6})`; g.fillRect(0, 0, 256, 128);
  speck(g, 256, 128, 2600, [`rgb(${tone - 22},${tone - 24},${tone - 26})`, `rgb(${tone + 14},${tone + 12},${tone + 8})`], 0.45);
  for (let i = 0; i < 5; i++) { const x = R() * 256, gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(70,68,64,.16)'); gr.addColorStop(1, 'rgba(70,68,64,0)'); g.fillStyle = gr; g.fillRect(x, 0, 4 + R() * 12, 128); }
  g.strokeStyle = 'rgba(90,88,84,.6)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 126);
  g.fillStyle = 'rgba(70,68,66,.7)'; for (const x of [32, 128, 224]) for (const y of [32, 96]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
  const t = tex(c); return t;
}
const concrete = (rep, tone) => { const t = concreteTex(tone); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }); };
const CON = concrete(), CON_D = concrete(0, 145);
// 小さな窓が並ぶ塔の壁 (1 枚 = 1 階 3m × 幅 6m)
const towerMat = (() => { const c = cv(256, 128), g = c.getContext('2d'); g.drawImage(concreteTex(170).image, 0, 0);
  for (let i = 0; i < 6; i++) { const x = 20 + i * 38; g.fillStyle = '#e9ecef'; g.fillRect(x - 2, 46, 24, 24); g.fillStyle = '#5b7a96'; g.fillRect(x, 48, 20, 20); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, 48, 8, 20); }
  g.fillStyle = 'rgba(60,58,55,.35)'; g.fillRect(0, 100, 256, 6); return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.9 }); })();
// ガラスの校舎: 床の帯 (コンクリート) と縦の桟・青緑のガラス (1 枚 = 1 階 3.6m × 4m)
const glassMat = (() => { const c = cv(128, 128), g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 40, 128); gr.addColorStop(0, '#9cc3cf'); gr.addColorStop(0.6, '#4f7b8c'); gr.addColorStop(1, '#2d4a58'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(0, 90); g.lineTo(50, 0); g.lineTo(70, 0); g.lineTo(0, 128); g.fill();
  g.fillStyle = '#d6d3cc'; g.fillRect(0, 0, 128, 18); g.fillStyle = '#8f8b84'; for (const x of [0, 42, 84, 124]) g.fillRect(x, 18, 4, 110);
  return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.15, metalness: 0.4, envMapIntensity: 1.3 }); })();
const glassWall = new THREE.MeshStandardMaterial({ color: '#a9d0dc', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32, envMapIntensity: 1.5, depthWrite: false });
const sandMat = (() => { const c = cv(256), g = c.getContext('2d'); g.fillStyle = '#c4b088'; g.fillRect(0, 0, 256, 256); speck(g, 256, 256, 9000, ['#b09c74', '#d4c3a0', '#a08c66', '#dccdaa'], 0.6, 1.4); return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 1 }); })();
const paveMat = (() => { const c = cv(256), g = c.getContext('2d'); g.fillStyle = '#9c9a94'; g.fillRect(0, 0, 256, 256); speck(g, 256, 256, 6000, ['#8a8882', '#b0aea8', '#76746f'], 0.5); g.strokeStyle = 'rgba(80,78,74,.4)'; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke(); } return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.95 }); })();
const grassMat = (() => { const c = cv(256), g = c.getContext('2d'); g.fillStyle = '#5e8a3a'; g.fillRect(0, 0, 256, 256); speck(g, 256, 256, 9000, ['#6e9c45', '#4f7a2f', '#86b155'], 0.6, 2); return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 1 }); })();
const wood = new THREE.MeshStandardMaterial({ color: '#9c6b3f', roughness: 0.8 }), red = new THREE.MeshStandardMaterial({ color: '#d6282f', roughness: 0.6, side: THREE.DoubleSide }), white = new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.5 }), roofMat = new THREE.MeshStandardMaterial({ color: '#5f6368', roughness: 0.55, metalness: 0.4 });
const books = (() => { const c = cv(256, 64), g = c.getContext('2d'); g.fillStyle = '#6b4a2b'; g.fillRect(0, 0, 256, 64); for (let x = 2; x < 256; x += 6 + R() * 5) { g.fillStyle = ['#c92a2a', '#1864ab', '#2b8a3e', '#e67700', '#5f3dc4', '#f1f3f5'][(R() * 6) | 0]; g.fillRect(x, 6 + R() * 8, 5, 50); } return new THREE.MeshStandardMaterial({ map: tex(c, false), roughness: 0.8 }); })();
// 面の大きさに合わせて模様をくりかえす箱
function tiledBox(w, h, d, tw = 1.8, th = 0.9) { const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * Math.max(1, dims[f][0] / tw), uv.getY(i) * Math.max(1, dims[f][1] / th)); } return geo; }
const add = (mesh, cast = true) => { mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh); return mesh; };
const put = (geo, mat, x, y, z, cast = true) => { const m = add(new THREE.Mesh(geo, mat), cast); m.position.set(x, y, z); return m; };

// ---------- キャンパスを作る ----------
{ // 地面: キャンパスはタイル・グラウンドは砂・まわりに芝生
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), grassMat); g.rotation.x = -Math.PI / 2; g.position.y = -0.02; grassMat.map.repeat.set(80, 80); add(g, false);
  const pv = new THREE.Mesh(new THREE.PlaneGeometry(map.size + 4, 104), paveMat); pv.rotation.x = -Math.PI / 2; paveMat.map.repeat.set(36, 26); add(pv, false);
  const Y = map.yard, sd = new THREE.Mesh(new THREE.PlaneGeometry(Y.x1 - Y.x0, Y.z1 - Y.z0), sandMat); sd.rotation.x = -Math.PI / 2; sd.position.set((Y.x0 + Y.x1) / 2, 0.01, (Y.z0 + Y.z1) / 2); sandMat.map.repeat.set(14, 7); add(sd, false);
  // グラウンドの白線 (センターライン・円)
  const lm = new THREE.MeshBasicMaterial({ color: '#f8f9fa' }), cx = (Y.x0 + Y.x1) / 2, cz = (Y.z0 + Y.z1) / 2;
  const ln = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lm); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); scene.add(m); };
  ln(0.15, Y.z1 - Y.z0 - 4, cx, cz); ln(Y.x1 - Y.x0 - 4, 0.15, cx, Y.z0 + 2); ln(Y.x1 - Y.x0 - 4, 0.15, cx, Y.z1 - 2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(7, 7.15, 64), lm); ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.02, cz); scene.add(ring);
  for (const k of ['hallfloor', 'libfloor']) for (const b of map.boxes.filter((x) => x.kind === k)) { const f = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), k === 'hallfloor' ? new THREE.MeshStandardMaterial({ color: '#b8875a', roughness: 0.5 }) : new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 })); f.rotation.x = -Math.PI / 2; f.position.set(b.x, 0.03, b.z); add(f, false); }
}
for (const b of map.boxes) {
  const y = (b.y0 || 0) + b.h / 2;
  if (b.kind === 'fence' || b.kind === 'fin' || b.kind === 'lowwall' || b.kind === 'cwall' || b.kind === 'column' || b.kind === 'core') put(tiledBox(b.w, b.h, b.d), b.kind === 'fin' ? CON_D : CON, b.x, y, b.z);
  else if (b.kind === 'tower') { // 塔: 下は小さな窓の壁・上の階は張り出した箱
    put(tiledBox(b.w, b.from, b.d, 6, 3), towerMat, b.x, b.from / 2, b.z);
    const top = b.h - b.from, o = b.overhang;
    put(tiledBox(b.w + o * 2, top, b.d + o * 2, 6, 3), towerMat, b.x, b.from + top / 2, b.z);
    put(new THREE.BoxGeometry(b.w + o * 2 + 0.2, 0.5, b.d + o * 2 + 0.2), CON_D, b.x, b.h + 0.25, b.z); // 屋上のふち
    put(tiledBox(b.w + o * 2, 0.4, b.d + o * 2), CON_D, b.x, b.from - 0.2, b.z); // 張り出しの床
  } else if (b.kind === 'hallroof') { // 切妻屋根 (棟は東西)・両はしの三角の壁
    const half = b.d / 2 + 0.8, rise = b.ridge, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) { const r = put(new THREE.BoxGeometry(b.w + 1.6, 0.3, slope), roofMat, b.x, b.y0 + rise / 2, b.z + s * half / 2); r.rotation.x = s * ang; }
    const tri = new THREE.Shape([new THREE.Vector2(-b.d / 2, 0), new THREE.Vector2(b.d / 2, 0), new THREE.Vector2(0, rise)]), tg = new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false });
    for (const s of [-1, 1]) { const m = put(tg, CON, b.x + s * (b.w / 2 - 0.2), b.y0, b.z); m.rotation.y = Math.PI / 2; m.position.x -= 0.2 * s; }
  } else if (b.kind === 'glass') put(tiledBox(b.w, b.h, b.d, 4, 3.6), glassMat, b.x, y, b.z);
  else if (b.kind === 'deck') put(tiledBox(b.w, b.h, b.d), CON, b.x, y, b.z);
  else if (b.kind === 'gwall') put(new THREE.BoxGeometry(b.w, b.h, b.d), glassWall, b.x, y, b.z, false);
  else if (b.kind === 'shelf') { put(new THREE.BoxGeometry(b.w, b.h, b.d), wood, b.x, y, b.z); for (const s of [-1, 1]) for (const k of [0.45, 1.05, 1.65]) { const bk = put(new THREE.PlaneGeometry(b.d * 0.95, 0.5), books, b.x + s * (b.w / 2 + 0.01), k, b.z, false); bk.rotation.y = s * Math.PI / 2; } }
  else if (b.kind === 'stage' || b.kind === 'bench' || b.kind === 'desk') put(new THREE.BoxGeometry(b.w, b.h, b.d), wood, b.x, y, b.z);
  else if (b.kind === 'goal') put(new THREE.CylinderGeometry(0.06, 0.06, b.h, 8), white, b.x, y, b.z);
  else if (b.kind === 'bikes') { put(new THREE.BoxGeometry(b.w + 1, 0.12, b.d), roofMat, b.x, 2.4, b.z); for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), roofMat, b.x, 1.2, b.z + s * (b.d / 2 - 0.3)); put(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: '#495057', roughness: 0.6, metalness: 0.5 }), b.x, y, b.z); }
}
// サッカーゴールの横の棒 (上)・ネット (うしろ)
for (const g of map.deco.goals) { put(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white, g.x, 2.44, g.z).rotation.x = Math.PI / 2; const net = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44, 14, 6), new THREE.MeshBasicMaterial({ color: '#dee2e6', wireframe: true, transparent: true, opacity: 0.5 })); net.position.set(g.x - g.dir * 1.2, 1.22, g.z); net.rotation.y = Math.PI / 2; scene.add(net); }
// 渡り廊下の赤いテント (四角すい)・手すり
for (const c of map.deco.canopies) { const t = put(new THREE.ConeGeometry(3.2, 1.3, 4, 1, true), red, c.x, c.y + 0.65, c.z); t.rotation.y = Math.PI / 4; for (const s of [-1, 1]) for (const k of [-1, 1]) put(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), white, c.x + s * 1.9, c.y - 0.1, c.z + k * 1.3, false); }
for (const br of map.deco.bridges) for (const s of [-1, 1]) put(new THREE.BoxGeometry(br.x1 - br.x0, 0.9, 0.12), CON, (br.x0 + br.x1) / 2, br.y + 0.95, br.z + s * 1.45);
// 講堂の時計
for (const c of map.deco.clocks) { const cc = cv(128), g = cc.getContext('2d'); g.fillStyle = '#f8f9fa'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#212529'; g.lineWidth = 6; g.stroke(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillStyle = '#212529'; g.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4); } g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 26); g.moveTo(64, 64); g.lineTo(92, 70); g.stroke();
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshStandardMaterial({ map: tex(cc, false) })); m.position.set(c.x, c.y, c.z); scene.add(m); }
// クスノキ (大きなもこもこの葉)・ヤシの木
{ const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), trunkM = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.95 });
  const blobs = [], o = new THREE.Object3D(), col = new THREE.Color();
  for (const [x, z, s] of map.deco.trees) { put(new THREE.CylinderGeometry(0.28 * s, 0.45 * s, 5 * s, 10), trunkM, x, 2.5 * s, z); for (let k = 0; k < 7; k++) blobs.push([x + (R() - 0.5) * 5 * s, (5.2 + R() * 2.6) * s, z + (R() - 0.5) * 5 * s, (1.8 + R() * 1.4) * s]); }
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leaf, blobs.length);
  blobs.forEach(([x, y, z, s], k) => { o.position.set(x, y, z); o.scale.set(s, s * 0.8, s); o.rotation.set(R(), R(), 0); o.updateMatrix(); im.setMatrixAt(k, o.matrix); col.setHSL(0.2 + R() * 0.06, 0.55, 0.38 + R() * 0.12); im.setColorAt(k, col); });
  add(im);
  for (const [x, z] of map.deco.palms) { const tr = put(new THREE.CylinderGeometry(0.18, 0.3, 7, 8), new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 0.9 }), x, 3.5, z); void tr;
    for (let k = 0; k < 8; k++) { const f = put(new THREE.ConeGeometry(0.5, 3.6, 4), new THREE.MeshStandardMaterial({ color: '#3f7a2a', roughness: 0.8, flatShading: true }), x, 7, z); const a = k / 8 * Math.PI * 2; f.rotation.set(Math.PI / 2 + 0.5, 0, a); f.position.set(x + Math.sin(a) * 1.4, 6.6, z + Math.cos(a) * 1.4); f.rotation.y = a; f.rotation.order = 'YXZ'; f.rotation.x = 1.9; } }
}

// ---------- 宝箱 (近いものだけ。光の柱つき) ----------
const KCOL = { bronze: ['#b5651d', '#ffd43b'], silver: ['#adb5bd', '#e7f5ff'], rainbow: ['#be4bdb', '#fff'] };
const chests = new Map();
function makeChest(kind) {
  const g = new THREE.Group(), [base, trim] = KCOL[kind];
  const body = new THREE.MeshStandardMaterial({ color: base, roughness: 0.45, metalness: kind === 'bronze' ? 0.2 : 0.7, emissive: base, emissiveIntensity: 0.25 }), gold = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.3, metalness: 0.9, emissive: trim, emissiveIntensity: 0.4 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.55), body); b.position.y = 0.25; g.add(b);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.8, 16, 1, false, 0, Math.PI), body); lid.rotation.z = Math.PI / 2; lid.position.y = 0.5; g.add(lid);
  for (const x of [-0.28, 0.28]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.58), gold); band.position.set(x, 0.38, 0); g.add(band); }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.04), gold); lock.position.set(0, 0.45, 0.29); g.add(lock);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 7, 12, 1, true), new THREE.MeshBasicMaterial({ color: kind === 'rainbow' ? '#e599f7' : trim, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 3.6; g.add(beam);
  g.traverse((o) => { if (o.isMesh && o !== beam) o.castShadow = true; });
  scene.add(g); return { g, beam, kind };
}
function syncChests(near) {
  const ids = new Set(near.map((t) => t.id));
  for (const [id, c] of chests) if (!ids.has(id)) { scene.remove(c.g); chests.delete(id); }
  for (const t of near) if (!chests.has(t.id)) { const c = makeChest(t.kind); c.g.position.set(t.x, 0, t.z); chests.set(t.id, c); }
}
function clearChests() { for (const c of chests.values()) scene.remove(c.g); chests.clear(); }

// ---------- 人 (かんたんな体・名札) ----------
const others = new Map();
function nameSprite(name) { const c = cv(256, 64), g = c.getContext('2d'); g.font = '800 28px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(name, 128, 32); g.fillStyle = '#fff'; g.fillText(name, 128, 32); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(c, false), depthTest: false, transparent: true })); s.scale.set(2, 0.5, 1); s.position.y = 2.2; return s; }
function makePerson(color, name) {
  const g = new THREE.Group(), cl = new THREE.MeshStandardMaterial({ color, roughness: 0.7 }), skin = new THREE.MeshStandardMaterial({ color: '#f1c9a5', roughness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: '#343a40', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 6, 12), cl); body.position.y = 1.0; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), skin); head.position.y = 1.72; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cl); cap.position.y = 1.76; g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.18), cl); brim.position.set(0, 1.78, -0.26); g.add(brim);
  const legs = [-1, 1].map((s) => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.45, 4, 8), dark); l.position.set(s * 0.13, 0.35, 0); g.add(l); return l; });
  for (const o of g.children) o.castShadow = true;
  if (name) g.add(nameSprite(name));
  scene.add(g); return { g, legs, walk: 0 };
}
function animPerson(m, dt, moving) { m.walk += dt * (moving ? 10 : 0); const a = moving ? Math.sin(m.walk) * 0.5 : 0; m.legs[0].rotation.x = a; m.legs[1].rotation.x = -a; }

// ---------- 入力 ----------
const keys = new Set(), move = { x: 0, y: 0, run: false };
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); jump(); } });
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', () => { if (playing && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => { if (document.pointerLockElement !== canvas) return; me.yaw -= e.movementX * 0.0023; me.pitch = Math.max(-1.1, Math.min(0.6, me.pitch - e.movementY * 0.0023)); });
if (isTouch) {
  const stick = $('#stick'), knob = stick.firstElementChild; let sid = null;
  const sm = (t) => { const r = stick.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), L = Math.hypot(dx, dy), max = r.width / 2 - 10, k = L > max ? max / L : 1; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; move.x = dx * k / max; move.y = dy * k / max; move.run = L > max * 0.92; };
  const end = (t) => { if (t.identifier !== sid) return; sid = null; move.x = move.y = 0; move.run = false; knob.style.transform = ''; stick.style.left = stick.style.top = stick.style.bottom = ''; stick.classList.remove('float'); };
  const look = new Map();
  canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) { if (sid === null && t.clientX < innerWidth / 2) { const h = stick.offsetWidth / 2, x = Math.max(h + 4, Math.min(innerWidth - h - 4, t.clientX)), y = Math.max(h + 60, Math.min(innerHeight - h - 4, t.clientY)); stick.style.left = (x - h) + 'px'; stick.style.top = (y - h) + 'px'; stick.style.bottom = 'auto'; stick.classList.add('float'); sid = t.identifier; sm(t); } else look.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { if (t.identifier === sid) { sm(t); continue; } const p = look.get(t.identifier); if (!p) continue; me.yaw -= (t.clientX - p[0]) * 0.0055; me.pitch = Math.max(-1.1, Math.min(0.6, me.pitch - (t.clientY - p[1]) * 0.0045)); look.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: false });
  const tend = (e) => { for (const t of e.changedTouches) { end(t); look.delete(t.identifier); } };
  canvas.addEventListener('touchend', tend); canvas.addEventListener('touchcancel', tend);
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; sm(t); }, { passive: false });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) sm(t); }, { passive: false });
  stick.addEventListener('touchend', tend);
  $('#jump').addEventListener('touchstart', (e) => { e.preventDefault(); jump(); }, { passive: false });
}
function jump() { if (playing && me.onGround) { me.vy = 7; me.onGround = false; } }
// IppO の中で開いているとき: ✕ でもどる
if (parent !== window) { const b = document.createElement('button'); b.id = 'exitbtn'; b.className = 'hud-btn'; b.textContent = '✕'; b.setAttribute('aria-label', 'IppO にもどる'); b.onclick = () => { if (document.pointerLockElement) document.exitPointerLock(); parent.postMessage({ source: 'ippo-treasure', type: 'exit' }, location.origin); }; document.body.append(b); }

// ---------- 状態・通信 ----------
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: Math.PI, pitch: -0.15, onGround: true, score: 0 };
let ws = null, you = null, playing = false, lastSend = 0, round = null, kinds = {}, heat = null, myModel = null;
const names = new Map(); // sid → { name, color, score }
const E = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
function feed(text, mine) { const d = E('div', mine ? 'me' : '', text); const f = $('#feed'); f.prepend(d); while (f.children.length > 5) f.lastChild.remove(); setTimeout(() => d.remove(), 6000); }
function pop(text, cls = '') { const d = E('div', 'pop ' + cls, text); document.body.append(d); setTimeout(() => d.remove(), 1600); }
function renderInfo() {
  const el = $('#info'); el.textContent = ''; el.append(E('b', null, `🗝️ 宝探し${round ? ` · のこり ${round.left}/${round.count}` : ''}`));
  for (const [sid, s] of [...names].sort((a, b) => b[1].score - a[1].score).slice(0, 6)) { const d = E('div', sid === you ? 'me' : ''); d.append(E('span', null, s.name), E('span', null, `${s.score} 点`)); el.append(d); }
}
function renderStats(stats, topList) {
  const box = $('#mystats'); box.textContent = '';
  if (stats) { const c = E('div', 'card'); c.append(E('b', null, '📜 あなたの記録'), E('div', null, `見つけた宝 ${stats.found} 個 · ${stats.points} 点 · 虹 ${stats.rainbow} 個 · ラウンド 1 位 ${stats.wins} 回 (${stats.rounds} ラウンド)`)); box.append(c); }
  if (topList?.length) { const c = E('div', 'card'); c.append(E('b', null, '🏆 ランキング (合計の点)')); for (const r of topList) { const row = E('div', 'row'); row.append(E('span', null, r.place), E('span', null, r.name), E('span', null, `${r.points} 点`)); c.append(row); } box.append(c); }
}
const HEAT = [['🧊 つめたい…', '#74c0fc'], ['🌤️ すずしい', '#63e6be'], ['☀️ あたたかい', '#ffa94d'], ['🔥 あつい！ すぐ近く', '#ff6b6b']];
function renderHeat() { const el = $('#heat'); if (!round || round.rest || !heat) { el.textContent = round?.rest ? '⏳ 次のラウンドを待っています' : '🔍 さがそう'; el.style.setProperty('--hc', '#74c0fc'); return; } const [t, c] = HEAT[heat.heat]; el.textContent = t; if (heat.d != null) el.append(E('small', null, `いちばん近い宝まで 約 ${heat.d}m`)); el.style.setProperty('--hc', c); }
function showOver(m) {
  const o = $('#over'), box = $('#overbox'); box.textContent = '';
  box.append(E('h2', null, '🏁 ラウンド終了！'));
  const c = E('div', 'card'); c.append(E('b', null, 'このラウンドの順位')); m.ranking.slice(0, 8).forEach((r, k) => { const row = E('div', 'row'); row.append(E('span', null, k + 1), E('span', null, (r.sid === you ? '⭐ ' : '') + r.name), E('span', null, `${r.score} 点`)); c.append(row); }); box.append(c);
  if (m.left.length) box.append(E('p', null, `見つからなかった宝: ${[...new Set(m.left.map((x) => x.name))].slice(0, 4).join('・')}${m.left.length > 4 ? ' など' : ''}`));
  const p = E('p', null, ''); box.append(p); const tick = () => { if (!round?.rest) return; const s = Math.max(0, Math.ceil((round.rest - Date.now()) / 1000)); p.textContent = `次のラウンドまで ${s} 秒`; if (s > 0) setTimeout(tick, 250); }; tick();
  o.classList.remove('hide'); renderStats(null, m.top);
}
function connect() {
  $('#status').textContent = 'つないでいます…';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/tr`);
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'welcome') {
      you = m.you; kinds = m.kinds; round = m.round; Object.assign(me, { x: m.me.x, z: m.me.z, y: 0 });
      names.clear(); for (const p of m.players) addPlayer(p);
      renderStats(m.stats, m.top); renderInfo(); renderHeat();
      const b = $('#start'); b.disabled = false; b.textContent = 'さがしに行く！'; $('#status').textContent = `いま ${m.players.length} 人がさがしています`;
    } else if (m.t === 'full') $('#status').textContent = '満員です。少し待ってからもう一度どうぞ';
    else if (m.t === 'join') { addPlayer(m.p); if (m.p.sid !== you) feed(`${m.p.name} が来た`); renderInfo(); }
    else if (m.t === 'leave') { const o = others.get(m.sid); if (o) { scene.remove(o.g); others.delete(m.sid); } names.delete(m.sid); renderInfo(); }
    else if (m.t === 'round') { round = { id: m.id, end: m.end, rest: 0, count: m.count, left: m.count }; clearChests(); for (const s of names.values()) s.score = 0; $('#over').classList.add('hide'); pop('🗝️ ラウンド開始！ 宝箱が 12 個かくれた'); renderInfo(); }
    else if (m.t === 'roundend') { round.rest = m.next; clearChests(); showOver(m); renderHeat(); }
    else if (m.t === 'me') renderStats(m.stats, null);
    else if (m.t === 'found') {
      const s = names.get(m.sid); if (s) s.score = m.score; if (round) round.left = m.left;
      const c = chests.get(m.id); if (c) { scene.remove(c.g); chests.delete(m.id); }
      const k = kinds[m.kind]?.name || '宝箱';
      if (m.sid === you) { me.score = m.score; pop(`${m.kind === 'rainbow' ? '🌈' : m.kind === 'silver' ? '🥈' : '🎁'} ${k} GET！ +${m.pts} 点`, m.kind === 'rainbow' ? 'rainbow' : ''); }
      feed(`${m.name} が ${m.where}で ${k} を見つけた (+${m.pts})`, m.sid === you); renderInfo();
    } else if (m.t === 's') {
      for (const [sid, x, y, z, yaw] of m.p) { if (sid === you) continue; const o = others.get(sid); if (o) Object.assign(o, { tx: x, ty: y, tz: z, tyaw: yaw }); }
      if (m.h) { heat = m.h; syncChests(m.h.near); renderHeat(); }
    } else if (m.t === 'fix') Object.assign(me, { x: m.x, y: m.y, z: m.z });
  };
  ws.onclose = (e) => {
    if (e.code === 4000) { $('#center').classList.remove('hide'); $('#status').textContent = 'ほかの画面で開きました'; playing = false; return; }
    if (e.code === 1006 && !you) { $('#status').textContent = 'ログインすると遊べます'; const b = $('#start'); b.disabled = false; b.textContent = 'ログインする'; b.onclick = () => parent.postMessage({ source: 'ippo-treasure', type: 'login' }, location.origin); return; }
    you = null; $('#status').textContent = '接続が切れました。つなぎ直しています…'; setTimeout(connect, 1500);
  };
}
function addPlayer(p) {
  names.set(p.sid, { name: p.name, color: p.color, score: p.score || 0 });
  if (p.sid === you) { if (!myModel) myModel = makePerson(p.color, ''); return; }
  if (others.has(p.sid)) return;
  const m = makePerson(p.color, p.name); others.set(p.sid, Object.assign(m, { tx: 0, ty: 0, tz: 0, tyaw: 0, seen: false }));
}
$('#start').onclick = () => { playing = true; $('#center').classList.add('hide'); if (!isTouch) canvas.requestPointerLock?.(); };
document.addEventListener('pointerlockchange', () => { if (!isTouch && playing && document.pointerLockElement !== canvas) { playing = false; $('#center').classList.remove('hide'); $('#start').textContent = 'つづける'; } });

// ---------- 毎フレーム ----------
const clock = new THREE.Clock(), camOff = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
  if (playing) {
    let fx = 0, fz = 0, run = false;
    if (isTouch) { fx = move.x; fz = move.y; run = move.run; }
    else { if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1; run = keys.has('ShiftLeft') || keys.has('ShiftRight'); }
    const L = Math.hypot(fx, fz); if (L > 1) { fx /= L; fz /= L; }
    const sp = (run ? 8 : 5.5) * dt, s = Math.sin(me.yaw), c = Math.cos(me.yaw);
    me.x += (fx * c + fz * s) * sp; me.z += (-fx * s + fz * c) * sp;
    me.vy -= 20 * dt; me.y += me.vy * dt; A.collide(map, me);
    const g = A.groundAt(map, me.x, me.z, me.y); if (me.y <= g) { me.y = g; me.vy = 0; me.onGround = true; } else me.onGround = false;
    me.moving = L > 0.1;
    if (now - lastSend > 60 && ws?.readyState === 1) { lastSend = now; ws.send(JSON.stringify({ t: 'pos', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(3) })); }
  }
  if (myModel) { myModel.g.position.set(me.x, me.y, me.z); myModel.g.rotation.y = me.yaw; animPerson(myModel, dt, me.moving && playing); }
  // カメラ: 肩ごしの三人称 (壁があれば近づける)
  const pivot = new THREE.Vector3(me.x, me.y + 1.6, me.z);
  camOff.set(0.6, 0.5, 4).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
  const dist = camOff.length(), dir = camOff.clone().normalize(), hit = A.rayWorld(map, [pivot.x, pivot.y, pivot.z], [dir.x, dir.y, dir.z], dist);
  camera.position.copy(pivot).addScaledVector(dir, Math.max(0.4, Math.min(dist, hit - 0.25))); if (camera.position.y < 0.4) camera.position.y = 0.4;
  camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
  const k = 1 - Math.exp(-dt * 12);
  for (const o of others.values()) { const gp = o.g.position; if (!o.seen) { gp.set(o.tx, o.ty, o.tz); o.seen = true; } const mv = Math.hypot(o.tx - gp.x, o.tz - gp.z) > 0.02; gp.x += (o.tx - gp.x) * k; gp.y += (o.ty - gp.y) * k; gp.z += (o.tz - gp.z) * k; let dy = o.tyaw - o.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); o.g.rotation.y += dy * k; animPerson(o, dt, mv); }
  for (const c of chests.values()) { c.g.rotation.y += dt * 0.8; c.g.position.y = Math.sin(now / 400) * 0.06; c.beam.material.opacity = 0.16 + Math.sin(now / 300) * 0.06; }
  if (round && !round.rest) { const s = Math.max(0, Math.ceil((round.end - Date.now()) / 1000)); $('#timer').textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } else $('#timer').textContent = '⏳ 休けい中';
  const sx = Math.round(me.x / 4) * 4, sz = Math.round(me.z / 4) * 4; sun.target.position.set(sx, 0, sz); sun.position.set(sx + sunDir.x * 80, sunDir.y * 80, sz + sunDir.z * 80);
  if (window.__cam) { camera.position.set(...window.__cam.pos); camera.lookAt(...window.__cam.at); } // 確認用 (#debug のテストだけ)
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (location.hash === '#debug') window.__tr = { me, camera, chests, others, get round() { return round; } };
connect(); requestAnimationFrame(frame);
