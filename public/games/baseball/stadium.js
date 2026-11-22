// =====================================================================
// IppO ベースボール: 3D (球場・人の選手・動き・ボール)
//   ・座標は bb-core.js と同じ: 本塁が原点、x = 捕手から見て右、y = 上、z = 投手のほう
//   ・選手は「人の形」: 骨組み (関節のグループ) に、なめらかな形 (回転体・カプセル) をつけ、ユニフォームの番号は画像を作って貼る
//   ・動き: 関節の角度の「ポーズ」を時間で補間する (投球: セット → 足を上げる → 踏みこみ → リリース → フォロー、打撃: 構え → 引き → スイング → フォロー)
//   ・ナイター: 照明塔・観客 (インスタンス)・芝の刈り目・内野の土・フェンス・スコアボード
// =====================================================================
import * as THREE from '../arena/vendor/three.module.min.js';
import { EffectComposer } from '../arena/vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../arena/vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../arena/vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../arena/vendor/jsm/postprocessing/OutputPass.js';

const C = window.BBCore;
const lerp = (a, b, t) => a + (b - a) * t;
const W = (x) => -x; // データの x (捕手から見て右が +) → 3D の x (画面の右が -x になるので反転)
const ease = (t) => t * t * (3 - 2 * t);
const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

// ---------- 人 (選手) ----------
const SKIN = ['#f1c9a5', '#e0ac82', '#c68a5e', '#8d5b3c'], HAIR = ['#1b1b1b', '#3b2a1f', '#5a4230', '#2a2a35', '#6b5030'];
// ポーズ: 関節名 → [x, y, z] (ラジアン)。書いていない関節は 0
const POSES = {
  stand: { lArm: [0.05, 0, 0.12], rArm: [0.05, 0, -0.12], lFore: [-0.15, 0, 0], rFore: [-0.15, 0, 0] },
  ready: { pelvis: [0, 0, 0], spine: [0.45, 0, 0], lThigh: [-0.65, 0, 0.18], rThigh: [-0.65, 0, -0.18], lShin: [1.0, 0, 0], rShin: [1.0, 0, 0], lArm: [-0.55, 0, 0.25], rArm: [-0.55, 0, -0.25], lFore: [-0.6, 0, 0], rFore: [-0.6, 0, 0], neck: [-0.45, 0, 0], _y: -0.14 },
  catcher: { spine: [0.25, 0, 0], lThigh: [-1.5, 0, 0.45], rThigh: [-1.5, 0, -0.45], lShin: [2.2, 0, 0], rShin: [2.2, 0, 0], lArm: [-1.1, 0, 0.3], lFore: [-0.4, 0, 0], rArm: [-0.2, 0, -0.3], rFore: [-1.2, 0, 0], neck: [-0.2, 0, 0], _y: -0.52 },
  // 投球 (右投げ。投手は本塁 (-z) を向く)
  p_set: { lArm: [-0.7, 0, 0.35], rArm: [-0.7, 0, -0.35], lFore: [-1.4, 0, 0.3], rFore: [-1.4, 0, -0.3], spine: [0.05, 0, 0] },
  p_kick: { pelvis: [0, 0.9, 0], spine: [0.1, 0.4, 0], lThigh: [-1.45, 0, 0.1], lShin: [1.4, 0, 0], rThigh: [0, 0, 0], lArm: [-0.9, 0, 0.4], rArm: [-0.9, 0, -0.4], lFore: [-1.3, 0, 0], rFore: [-1.3, 0, 0], _y: 0.02 },
  p_stride: { pelvis: [0, 0.6, 0], spine: [0.15, 0.9, -0.2], lThigh: [-1.0, 0, 0.1], lShin: [0.5, 0, 0], rThigh: [0.55, 0, 0], rShin: [0.7, 0, 0], lArm: [-1.3, 0, 0.9], lFore: [-0.3, 0, 0], rArm: [0.4, 0, -1.6], rFore: [-1.6, 0, 0], _y: -0.18, _z: -0.6 },
  p_release: { pelvis: [0, -0.3, 0], spine: [0.55, -0.5, 0.1], lThigh: [-1.1, 0, 0], lShin: [0.55, 0, 0], rThigh: [0.6, 0, 0], rShin: [0.9, 0, 0], lArm: [0.3, 0, 0.5], lFore: [-1.4, 0, 0], rArm: [-2.6, 0, -0.3], rFore: [-0.15, 0, 0], neck: [-0.4, 0, 0], _y: -0.22, _z: -1.0 },
  p_follow: { pelvis: [0, -0.6, 0], spine: [0.9, -0.8, 0.1], lThigh: [-0.9, 0, 0], lShin: [0.7, 0, 0], rThigh: [0.2, 0, 0.3], rShin: [1.2, 0, 0], lArm: [0.4, 0, 0.6], lFore: [-1.4, 0, 0], rArm: [-0.6, 0.6, 0.6], rFore: [-0.6, 0, 0], neck: [-0.6, 0, 0], _y: -0.2, _z: -1.15 },
  // 打撃 (右打ち。打者は本塁の 3 塁がわに立ち、本塁 (+x) を向く)
  b_stance: { pelvis: [0, 0, 0], spine: [0.25, 0, 0], lThigh: [-0.25, 0, 0.32], rThigh: [-0.25, 0, -0.32], lShin: [0.45, 0, 0], rShin: [0.45, 0, 0], lArm: [-0.9, -0.6, 0.6], lFore: [-1.6, 0, 0], rArm: [-0.4, -0.3, -1.2], rFore: [-1.9, 0, 0], neck: [0, 1.25, 0], bat: [-0.35, 0, 0.5], _y: -0.06 },
  b_load: { pelvis: [0, 0.25, 0], spine: [0.25, 0.3, 0], lThigh: [-0.55, 0, 0.1], lShin: [0.9, 0, 0], rThigh: [-0.3, 0, -0.35], rShin: [0.55, 0, 0], lArm: [-0.8, -0.9, 0.5], lFore: [-1.7, 0, 0], rArm: [-0.2, -0.5, -1.4], rFore: [-2.0, 0, 0], neck: [0, 1.4, 0], bat: [-0.1, 0, 0.7], _y: -0.06 },
  b_swing: { pelvis: [0, -0.9, 0], spine: [0.3, -0.9, 0], lThigh: [-0.2, 0, 0.45], lShin: [0.15, 0, 0], rThigh: [-0.15, 0, -0.2], rShin: [0.75, 0, 0], lArm: [-1.5, 0.5, 0.1], lFore: [-0.15, 0, 0], rArm: [-1.4, 0.3, -0.2], rFore: [-0.5, 0, 0], neck: [0, 1.6, 0], bat: [-1.45, 0, 0.1], _y: -0.12 },
  b_follow: { pelvis: [0, -1.5, 0], spine: [0.15, -1.4, 0.15], lThigh: [-0.1, 0, 0.45], lShin: [0.2, 0, 0], rThigh: [-0.1, 0, -0.1], rShin: [0.9, 0, 0], lArm: [-1.8, 1.2, 0.6], lFore: [-1.2, 0, 0], rArm: [-1.9, 1.0, 0.4], rFore: [-1.5, 0, 0], neck: [0, 1.3, 0], bat: [-0.8, 0, 1.2], _y: -0.06 },
  run: { spine: [0.3, 0, 0], lThigh: [-1.0, 0, 0], rThigh: [0.6, 0, 0], lShin: [0.6, 0, 0], rShin: [1.4, 0, 0], lArm: [0.7, 0, 0.1], rArm: [-0.9, 0, -0.1], lFore: [-1.4, 0, 0], rFore: [-1.4, 0, 0] },
  run2: { spine: [0.3, 0, 0], lThigh: [0.6, 0, 0], rThigh: [-1.0, 0, 0], lShin: [1.4, 0, 0], rShin: [0.6, 0, 0], lArm: [-0.9, 0, 0.1], rArm: [0.7, 0, -0.1], lFore: [-1.4, 0, 0], rFore: [-1.4, 0, 0] },
};
const JOINTS = ['pelvis', 'spine', 'neck', 'lArm', 'rArm', 'lFore', 'rFore', 'lThigh', 'rThigh', 'lShin', 'rShin', 'bat'];

function uniformTex(main, accent, number, name) {
  return tex(512, 512, (g, w, h) => {
    g.fillStyle = main; g.fillRect(0, 0, w, h);
    // ピンストライプ
    g.strokeStyle = accent; g.globalAlpha = 0.18; g.lineWidth = 3; for (let x = 0; x < w; x += 26) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.globalAlpha = 1;
    // 背番号 (背中 = 画像の右半分の中央・胸 = 左半分に小さく)
    g.fillStyle = accent; g.strokeStyle = '#fff'; g.lineWidth = 10; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 150px "Arial Black", Arial, sans-serif'; g.strokeText(String(number), w * 0.75, h * 0.56); g.fillText(String(number), w * 0.75, h * 0.56);
    g.font = '700 36px sans-serif'; g.lineWidth = 6; g.strokeText(name, w * 0.75, h * 0.3); g.fillText(name, w * 0.75, h * 0.3);
    g.font = '900 64px "Arial Black", Arial, sans-serif'; g.lineWidth = 7; g.strokeText(String(number), w * 0.25, h * 0.45); g.fillText(String(number), w * 0.25, h * 0.45);
  });
}
export function makeHuman({ main = '#f8f9fa', accent = '#1c3f94', cap = '#1c3f94', number = 0, label = '', look = {}, glove = true, bat = false, catcher = false, ump = false } = {}) {
  const H = (look.h || 1) * 1.0, W = look.build || 1;
  const skin = new THREE.MeshStandardMaterial({ color: SKIN[look.skin % 4 || 0], roughness: 0.62 });
  const jersey = new THREE.MeshStandardMaterial({ map: uniformTex(ump ? '#1f2430' : main, ump ? '#9aa3b8' : accent, ump ? '' : number, ump ? '' : label), roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: ump ? '#4a4f5c' : main === '#f8f9fa' ? '#eceef2' : '#bfc4cc', roughness: 0.85 });
  const sock = new THREE.MeshStandardMaterial({ color: ump ? '#1f2430' : accent, roughness: 0.8 });
  const shoe = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.4, metalness: 0.1 });
  const capM = new THREE.MeshStandardMaterial({ color: ump ? '#1f2430' : cap, roughness: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: catcher ? '#5b3a1e' : '#8a5a2b', roughness: 0.55 });
  const hairM = new THREE.MeshStandardMaterial({ color: HAIR[look.hair % 5 || 0], roughness: 0.9 });
  const root = new THREE.Group(), J = {};
  const grp = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); J[name] = g; return g; };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const cap2 = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  // 腰 → 背骨 → 首・腕
  const pelvis = grp('pelvis', root, 0, 0.98 * H, 0);
  add(pelvis, lathe([[0.001, -0.1], [0.15, -0.09], [0.17 * W, 0.0], [0.155 * W, 0.08], [0.001, 0.09]]), pants, 0, 0, 0, 1, 1, 0.72);
  add(pelvis, new THREE.TorusGeometry(0.155 * W, 0.016, 6, 20), new THREE.MeshStandardMaterial({ color: '#1b1b1b' }), 0, 0.07, 0, 1, 1, 0.72).rotation.x = Math.PI / 2; // ベルト
  const spine = grp('spine', pelvis, 0, 0.08, 0);
  const torso = add(spine, lathe([[0.001, 0], [0.155 * W, 0.0], [0.17 * W, 0.12], [0.2 * W, 0.3], [0.21 * W, 0.4], [0.16, 0.47], [0.06, 0.5], [0.001, 0.5]]), jersey, 0, 0, 0, 1, 1, 0.68);
  torso.rotation.y = Math.PI; // 背番号を背中 (+z) に
  const neck = grp('neck', spine, 0, 0.5, 0);
  add(neck, cap2(0.048, 0.06), skin, 0, 0.05, 0);
  const head = new THREE.Group(); head.position.set(0, 0.17, 0); neck.add(head);
  add(head, new THREE.SphereGeometry(0.105, 24, 18), skin, 0, 0, 0, 0.92, 1.08, 1.0);
  add(head, new THREE.SphereGeometry(0.022, 10, 8), skin, 0, -0.01, -0.1, 1, 1, 0.9); // 鼻
  for (const s of [-1, 1]) { add(head, new THREE.SphereGeometry(0.024, 10, 8), skin, s * 0.098, -0.005, 0.005, 0.5, 1, 0.8); add(head, new THREE.SphereGeometry(0.011, 8, 6), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }), s * 0.035, 0.018, -0.092); }
  add(head, new THREE.SphereGeometry(0.108, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.005, 0.012);
  if (look.beard) add(head, new THREE.SphereGeometry(0.08, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4), hairM, 0, -0.01, -0.02, 1.1, 1, 1);
  // 帽子 (捕手はヘルメット・マスク)
  add(head, new THREE.SphereGeometry(0.114, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), capM, 0, 0.025, 0.005, 1, 0.85, 1.02);
  add(head, new THREE.CylinderGeometry(0.1, 0.11, 0.012, 20, 1, false, Math.PI * 0.75, Math.PI * 0.5), capM, 0, 0.03, -0.065, 1, 1, 1.25); // つば
  if (catcher || ump) add(head, new THREE.BoxGeometry(0.17, 0.2, 0.03), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.35, wireframe: true }), 0, -0.01, -0.115);
  if (catcher) add(spine, new THREE.BoxGeometry(0.34, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: '#23272f', roughness: 0.6 }), 0, 0.24, -0.12);
  // 腕
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'l' : 'r', sh = grp(L + 'Arm', spine, s * 0.205 * W, 0.43, 0);
    add(sh, new THREE.SphereGeometry(0.062 * W, 14, 10), jersey, 0, 0, 0);
    add(sh, cap2(0.052 * W, 0.15), jersey, 0, -0.1, 0);            // 袖
    add(sh, cap2(0.042, 0.14), skin, 0, -0.2, 0);
    const el = grp(L + 'Fore', sh, 0, -0.29, 0);
    add(el, cap2(0.038, 0.18), skin, 0, -0.12, 0);
    const hand = new THREE.Group(); hand.position.set(0, -0.26, 0); el.add(hand); J[L + 'Hand'] = hand;
    add(hand, new THREE.SphereGeometry(0.045, 12, 10), skin, 0, 0, 0, 0.9, 1.2, 0.7);
    if (glove && s < 0) add(hand, new THREE.SphereGeometry(0.1, 16, 12), leather, 0, -0.03, -0.02, catcher ? 1.25 : 0.95, catcher ? 1.25 : 1.15, 0.55);
  }
  // バット (右手に持つ)
  if (bat) {
    const b = new THREE.Group(); J.rHand.add(b); J.bat = b;
    const bm = new THREE.Mesh(new THREE.LatheGeometry([[0.014, 0], [0.016, 0.02], [0.015, 0.03], [0.017, 0.25], [0.028, 0.5], [0.033, 0.75], [0.033, 0.82], [0.02, 0.84], [0.001, 0.845]].map(([x, y]) => new THREE.Vector2(x, y)), 16), new THREE.MeshStandardMaterial({ color: '#d9b27a', roughness: 0.35, metalness: 0.05 }));
    bm.castShadow = true; bm.position.y = -0.05; b.add(bm);
  }
  // 脚
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'l' : 'r', hip = grp(L + 'Thigh', pelvis, s * 0.09 * W, -0.04, 0);
    add(hip, cap2(0.082 * W, 0.3), pants, 0, -0.22, 0);
    const kn = grp(L + 'Shin', hip, 0, -0.45, 0);
    add(kn, cap2(0.062, 0.18), pants, 0, -0.08, 0, 1, 1, 1.05);
    add(kn, cap2(0.052, 0.2), sock, 0, -0.27, 0);
    add(kn, new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe, 0, -0.45, -0.05);
  }
  root.userData = { J, pose: {}, from: null, to: null, t0: 0, dur: 0 };
  // ポーズを直接きめる / 時間で移す
  const apply = (P) => {
    for (const j of JOINTS) { const g = J[j]; if (!g) continue; const v = P[j] || [0, 0, 0]; g.rotation.set(v[0], v[1], v[2]); }
    J.pelvis.position.y = 0.98 * H + (P._y || 0); J.pelvis.position.z = P._z || 0;
  };
  const mix = (A, B, t) => { const o = {}; for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) { if (k[0] === '_') { o[k] = lerp(A[k] || 0, B[k] || 0, t); continue; } const a = A[k] || [0, 0, 0], b = B[k] || [0, 0, 0]; o[k] = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; } return o; };
  let cur = { ...POSES.stand }, seq = null;
  root.pose = (name) => { cur = { ...(POSES[name] || POSES.stand) }; seq = null; apply(cur); };
  // play([[ポーズ名, 秒], ...]): つぎつぎに移る
  root.play = (steps, loop = false) => { seq = { steps, i: 0, t: 0, from: { ...cur }, loop }; };
  root.update = (dt) => {
    if (!seq) return;
    const [name, d] = seq.steps[seq.i]; seq.t += dt;
    const k = Math.min(1, seq.t / d); cur = mix(seq.from, POSES[name] || POSES.stand, ease(k)); apply(cur);
    if (k >= 1) { seq.i++; seq.t = 0; seq.from = { ...cur }; if (seq.i >= seq.steps.length) { if (seq.loop) seq.i = 0; else seq = null; } }
  };
  root.joints = J;
  apply(cur);
  return root;
}

// ---------- 球場 ----------
export function createStadium(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b1430'); scene.fog = new THREE.Fog('#0b1430', 160, 420);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 900);
  // 夜空 (グラデーション + 星)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, map: tex(16, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#02040c'); gr.addColorStop(0.45, '#0b1638'); gr.addColorStop(0.52, '#24305e'); gr.addColorStop(1, '#0b1430'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }) }));
  scene.add(sky);
  // 光: 照明塔の白い光 (影) + 空の弱い光
  scene.add(new THREE.HemisphereLight('#9fb6ff', '#2a3a1a', 0.55));
  const key = new THREE.DirectionalLight('#fff6e8', 2.6); key.position.set(-40, 80, -30); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -45, right: 45, top: 60, bottom: -10, near: 10, far: 220 }); key.shadow.bias = -0.0004; key.target.position.set(0, 0, 25); scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#dfe8ff', 1.0); fill.position.set(60, 70, 40); scene.add(fill);
  // 芝 (刈り目) と土
  const grass = tex(1024, 1024, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#2f7d32' : '#3a8f3c'; g.fillRect(i * w / 16, 0, w / 16, h); } for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${20 + Math.random() * 40},${80 + Math.random() * 60},${20 + Math.random() * 30},.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(6, 6);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64, 0, Math.PI * 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.rotation.z = Math.PI / 4; ground.receiveShadow = true; scene.add(ground);
  const dirtM = new THREE.MeshStandardMaterial({ map: tex(256, 256, (g, w, h) => { g.fillStyle = '#a86b3c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${120 + Math.random() * 60},${70 + Math.random() * 40},${30 + Math.random() * 20},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }), roughness: 1 });
  const flat = (geo, m, y, x = 0, z = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.rotation.x = -Math.PI / 2; o.rotation.z = rz; o.position.set(x, y, z); o.receiveShadow = true; scene.add(o); return o; };
  // 内野の土 (扇形) と芝の内野 (ダイヤモンド)
  flat(new THREE.CircleGeometry(29, 48, Math.PI / 4, Math.PI / 2), dirtM, 0.01, 0, 0, 0).rotation.z = 0;
  const infield = flat(new THREE.PlaneGeometry(24.5, 24.5), new THREE.MeshStandardMaterial({ map: grass.clone(), roughness: 0.95 }), 0.02, 0, 19.4, Math.PI / 4);
  infield.material.map.repeat.set(1, 1);
  flat(new THREE.CircleGeometry(2.7, 32), dirtM, 0.03, 0, 18.44); // マウンド
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.7, 0.25, 32), dirtM); mound.position.set(0, 0.12, 18.44); mound.receiveShadow = true; scene.add(mound);
  flat(new THREE.CircleGeometry(4, 32), dirtM, 0.03, 0, 0); // 本塁のまわり
  for (const [x0, z] of [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]]) { const x = W(x0); flat(new THREE.CircleGeometry(2.4, 24), dirtM, 0.025, x, z); const b = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.38), new THREE.MeshStandardMaterial({ color: '#fff' })); b.position.set(x, 0.04, z); b.rotation.y = Math.PI / 4; b.castShadow = true; scene.add(b); }
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.215, 0), new THREE.Vector2(0.215, 0), new THREE.Vector2(0.215, 0.215), new THREE.Vector2(0, 0.43), new THREE.Vector2(-0.215, 0.215)])), new THREE.MeshStandardMaterial({ color: '#fff' }));
  plate.rotation.x = -Math.PI / 2; plate.position.set(0, 0.035, -0.43 + 0.43); plate.rotation.z = Math.PI; scene.add(plate);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.04, 0.15), new THREE.MeshStandardMaterial({ color: '#fff' })); rubber.position.set(0, 0.27, 18.44); scene.add(rubber);
  // ライン (ファウルライン・打席)
  const lineM = new THREE.MeshBasicMaterial({ color: '#f4f4f4' });
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 100), lineM); l.rotation.x = -Math.PI / 2; l.rotation.z = -s * Math.PI / 4; l.position.set(s * 35.35, 0.04, 35.35); scene.add(l); }
  for (const s of [-1, 1]) { const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.22, 1.83)), new THREE.LineBasicMaterial({ color: '#f4f4f4' })); box.rotation.x = -Math.PI / 2; box.position.set(s * 0.93, 0.045, 0.1); scene.add(box); }
  // フェンス・観客席 (扇形)・照明塔
  const fenceR = (a) => 98 + (118 - 98) * Math.cos(a * 2); // 両翼 98m・中堅 118m (a = 中堅からの角度)
  const fence = new THREE.Group(); scene.add(fence);
  const padM = new THREE.MeshStandardMaterial({ color: '#1d4f8f', roughness: 0.7 }), yellowM = new THREE.MeshBasicMaterial({ color: '#ffd43b' });
  for (let i = 0; i <= 60; i++) {
    const a = -Math.PI / 4 + i / 60 * Math.PI / 2, a2 = -Math.PI / 4 + (i + 1) / 60 * Math.PI / 2; if (i === 60) break;
    const r1 = fenceR(a), r2 = fenceR(a2), x1 = Math.sin(a) * r1, z1 = Math.cos(a) * r1, x2 = Math.sin(a2) * r2, z2 = Math.cos(a2) * r2;
    const len = Math.hypot(x2 - x1, z2 - z1), seg = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 3.4, 0.4), padM);
    seg.position.set((x1 + x2) / 2, 1.7, (z1 + z2) / 2); seg.rotation.y = Math.atan2(x2 - x1, z2 - z1) - Math.PI / 2; seg.castShadow = true; fence.add(seg);
    const top = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.12, 0.42), yellowM); top.position.set(seg.position.x, 3.45, seg.position.z); top.rotation.y = seg.rotation.y; fence.add(top);
  }
  // 観客: スタンドの段 (箱) + 人 (色つきの小さな箱をたくさん)
  const standM = new THREE.MeshStandardMaterial({ color: '#2c3140', roughness: 0.9 });
  const crowdGeo = new THREE.BoxGeometry(0.45, 0.75, 0.35), crowdN = 5200, crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowdN);
  const tmp = new THREE.Object3D(), col = new THREE.Color(); let ci = 0;
  const seatCols = ['#e03131', '#1c7ed6', '#f8f9fa', '#ffd43b', '#2f9e44', '#f783ac', '#343a40', '#ff922b'];
  const standArc = (r0, a0, a1, rows, h0) => {
    for (let row = 0; row < rows; row++) {
      const r = r0 + row * 1.4, y = h0 + row * 0.9;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.7, r + 0.7, 0.9, 64, 1, true, a0, a1 - a0), standM); ring.position.y = y; ring.material.side = THREE.DoubleSide; scene.add(ring);
      const step = 0.9 / r;
      for (let a = a0; a < a1 && ci < crowdN; a += step) { if (Math.random() < 0.18) continue; tmp.position.set(Math.sin(a) * r, y + 0.82, Math.cos(a) * r); tmp.rotation.y = a + Math.PI; tmp.updateMatrix(); crowd.setMatrixAt(ci, tmp.matrix); crowd.setColorAt(ci, col.set(seatCols[ci % 8]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2)); ci++; }
    }
  };
  standArc(26, Math.PI * 0.6, Math.PI * 1.4, 14, 1.2);    // 本塁のうしろ
  standArc(48, Math.PI * 0.18, Math.PI * 0.62, 12, 2.0);  // 1 塁がわ
  standArc(48, Math.PI * 1.38, Math.PI * 1.82, 12, 2.0);  // 3 塁がわ
  standArc(124, -Math.PI * 0.22, Math.PI * 0.22, 10, 4.5); // 外野
  crowd.count = ci; crowd.instanceMatrix.needsUpdate = true; if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true; scene.add(crowd);
  // 照明塔 (光る板)
  const lampM = new THREE.MeshBasicMaterial({ color: '#fffbe8' });
  for (const [x, z] of [[-70, 30], [70, 30], [-60, 110], [60, 110], [-35, -30], [35, -30]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 42, 8), new THREE.MeshStandardMaterial({ color: '#5c6370' })); pole.position.set(x, 21, z); scene.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), lampM); panel.position.set(x, 44, z); panel.lookAt(0, 0, 30); scene.add(panel);
  }
  // スコアボード (中堅の奥)
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = 1024; sbCanvas.height = 384; const sbTex = new THREE.CanvasTexture(sbCanvas); sbTex.colorSpace = THREE.SRGBColorSpace;
  const sb = new THREE.Mesh(new THREE.PlaneGeometry(30, 11.25), new THREE.MeshBasicMaterial({ map: sbTex })); sb.position.set(0, 24, 132); sb.rotation.y = Math.PI; scene.add(sb);
  const sbBack = new THREE.Mesh(new THREE.BoxGeometry(32, 13, 1), new THREE.MeshStandardMaterial({ color: '#111' })); sbBack.position.set(0, 24, 132.7); scene.add(sbBack);
  function scoreboard(teams, line, score) {
    const g = sbCanvas.getContext('2d'); g.fillStyle = '#05070d'; g.fillRect(0, 0, 1024, 384);
    g.font = '700 40px sans-serif'; g.fillStyle = '#ffd43b'; g.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) {
      const y = 140 + i * 110; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText((teams[i] || '').slice(0, 9), 24, y);
      for (let k = 0; k < 6; k++) { g.textAlign = 'center'; g.fillStyle = '#9ef01a'; const v = line?.[i]?.[k]; g.fillText(v == null ? '' : String(v), 470 + k * 70, y); }
      g.fillStyle = '#ffd43b'; g.font = '900 56px sans-serif'; g.fillText(String(score?.[i] ?? 0), 940, y); g.font = '700 40px sans-serif';
    }
    g.fillStyle = '#888'; g.font = '700 28px sans-serif'; for (let k = 0; k < 6; k++) { g.textAlign = 'center'; g.fillText(String(k + 1), 470 + k * 70, 70); } g.fillText('R', 940, 70);
    sbTex.needsUpdate = true;
  }
  scoreboard(['', ''], [[], []], [0, 0]);

  // ---------- ボール ----------
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.037, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.45, map: tex(256, 128, (g, w, h) => { g.fillStyle = '#fbfbf6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d6336c'; g.lineWidth = 4; for (const o of [0, w / 2]) { g.beginPath(); for (let x = 0; x <= w / 2; x += 4) g.lineTo(o + x, h / 2 + Math.sin(x / (w / 2) * Math.PI * 2) * h * 0.28); g.stroke(); } }) }));
  ball.castShadow = true; ball.visible = false; scene.add(ball);
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.001, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 })); trail.visible = false; scene.add(trail);
  // ストライクゾーンとカーソル (本塁の上の面に描く)
  const zone = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(C.ZONE.x * 2, C.ZONE.yHi - C.ZONE.yLo)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false })); zone.renderOrder = 8; // 捕手の上にも見える
  zone.position.set(0, (C.ZONE.yHi + C.ZONE.yLo) / 2, 0); scene.add(zone);
  const gridLines = new THREE.Group(); zone.add(gridLines);
  for (const k of [-1, 1]) { const v = new THREE.Mesh(new THREE.PlaneGeometry(0.004, C.ZONE.yHi - C.ZONE.yLo), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.35, depthTest: false })); v.renderOrder = 8; v.position.x = k * C.ZONE.x / 3; gridLines.add(v); const h = new THREE.Mesh(new THREE.PlaneGeometry(C.ZONE.x * 2, 0.004), v.material); h.position.y = k * (C.ZONE.yHi - C.ZONE.yLo) / 6; gridLines.add(h); }
  const ring = (r, color) => { const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })); m.renderOrder = 10; m.visible = false; scene.add(m); return m; };
  // ミートカーソル: 太い黄色の輪 + 黒いふち (どんな背景でも見える) + 十字 + 明るい塗り
  const meet = new THREE.Group(); meet.visible = false; meet.renderOrder = 12; scene.add(meet);
  const mb = (geo, color, opacity, order) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = order; meet.add(m); return m; };
  mb(new THREE.CircleGeometry(1, 48), '#ffe066', 0.3, 11);                       // 塗り
  mb(new THREE.RingGeometry(1.0, 1.16, 64), '#111827', 0.85, 12);                // 外の黒いふち
  mb(new THREE.RingGeometry(0.8, 1.0, 64), '#ffd43b', 1, 13);                    // 太い輪
  mb(new THREE.RingGeometry(0.72, 0.8, 64), '#111827', 0.6, 12);                 // 内の黒いふち
  mb(new THREE.PlaneGeometry(0.7, 0.06), '#ffffff', 0.95, 13); mb(new THREE.PlaneGeometry(0.06, 0.7), '#ffffff', 0.95, 13); // 十字
  const aimCur = ring(0.05, '#ff6b6b');
  const setMeet = (x, y, r, on = true) => { meet.visible = on; meet.position.set(W(x), y, -0.03); meet.scale.setScalar(r); };
  const setAim = (x, y, on = true) => { aimCur.visible = on; aimCur.position.set(W(x), y, -0.02); };
  const mark = new THREE.Group(); mark.visible = false; scene.add(mark);
  const mk = (geo, color, opacity, order) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = order; mark.add(m); return m; };
  const markDot = mk(new THREE.CircleGeometry(0.037, 24), '#ffffff', 0.95, 14);   // ボールの大きさ
  const markRing = mk(new THREE.RingGeometry(0.05, 0.062, 32), '#ff6b6b', 0.95, 14); // 近づくほど小さくなる輪
  let markHold = 0;

  // ---------- 選手 ----------
  const TEAM_COLORS = [{ main: '#f8f9fa', accent: '#1c3f94', cap: '#1c3f94' }, { main: '#2b2f3a', accent: '#f08c00', cap: '#f08c00' }];
  const people = { field: [], pitcher: null, batter: null, catcher: null, ump: null, runners: [] };
  const FIELD_POS = [[19.6, 26], [12, 33], [-12, 33], [-19.6, 26], [-30, 78], [0, 92], [30, 78]]; // 一・二・遊・三・左・中・右
  const all = [];
  const place = (h, x, z, ry) => { h.position.set(x, 0, z); h.rotation.y = ry; scene.add(h); all.push(h); return h; };
  function clearPeople() { for (const h of all) scene.remove(h); all.length = 0; people.field = []; people.runners = []; }
  // def: 守るチーム (0/1)、batter: 打者の情報、pitcher: 投手の情報
  function setupPlayers({ defTeam, offTeam, batter, pitcher, lineupDef, bases }) {
    clearPeople();
    const dc = TEAM_COLORS[defTeam], oc = TEAM_COLORS[offTeam];
    people.pitcher = place(makeHuman({ ...dc, number: pitcher.number, label: pitcher.name?.split(' ')[0] || '', look: pitcher.look || {} }), W(-0.1), 18.44 + 0.1, 0); // 本塁 (-z) を向く
    people.pitcher.pose('p_set');
    people.catcher = place(makeHuman({ ...dc, number: 2, look: {}, catcher: true }), 0, -0.9, Math.PI); people.catcher.pose('catcher');
    people.ump = place(makeHuman({ ump: true, look: { skin: 1 } }), 0, -1.75, Math.PI); people.ump.pose('ready');
    const lefty = batter.look?.bat === 'L';
    people.batter = place(makeHuman({ ...oc, number: batter.number, label: batter.name?.split(' ')[0] || '', look: batter.look || {}, glove: false, bat: true }), W(lefty ? 0.78 : -0.78), 0.05, lefty ? -Math.PI / 2 : Math.PI / 2); // 本塁のほうを向く
    if (lefty) people.batter.scale.x = -1; // 左打ちは左右を反転
    people.batter.pose('b_stance');
    FIELD_POS.forEach(([x, z], i) => { const f = place(makeHuman({ ...dc, number: lineupDef?.[i]?.number ?? i + 3, label: '', look: lineupDef?.[i]?.look || { skin: i % 4 } }), W(x), z, Math.atan2(W(x), z)); f.pose('ready'); people.field.push(f); }); // 本塁のほうを向く
    setRunners(bases || [false, false, false], oc);
  }
  function setRunners(bases, oc = TEAM_COLORS[1]) {
    for (const r of people.runners) { scene.remove(r); all.splice(all.indexOf(r), 1); }
    people.runners = [];
    [[17.9, 20.6], [1.5, 37.6], [-17.9, 20.6]].forEach(([x, z], i) => { if (!bases[i]) return; const r = place(makeHuman({ ...oc, number: 10 + i, look: { skin: i }, glove: false }), W(x), z, Math.PI * 0.75 + i * Math.PI / 2); r.pose('ready'); people.runners.push(r); });
  }

  // ---------- カメラ ----------
  const CAM_BAT = { pos: new THREE.Vector3(0, 2.0, -5.2), look: new THREE.Vector3(0, 0.85, 14) }; // 捕手のうしろの少し高いところから
  let camMode = 'bat', camT = 0, follow = null;
  const camPos = CAM_BAT.pos.clone(), camLook = CAM_BAT.look.clone();
  function setCam(mode, target = null) { camMode = mode; follow = target; camT = 0; }

  // ---------- 投球と打球のアニメーション ----------
  let pitchAnim = null, hitAnim = null;
  // 投げる: windup 秒の動きのあと、ボールが pc の軌道で飛ぶ。onRelease はボールが手をはなれた時刻 (performance.now) を返す
  function throwPitch(pc, windup, onRelease) {
    people.pitcher.play([['p_kick', windup * 0.45], ['p_stride', windup * 0.4], ['p_release', windup * 0.15], ['p_follow', 0.4]]);
    people.batter.play([['b_load', windup + pc.T * 0.4]]);
    pitchAnim = { pc, t: -windup, onRelease, released: false };
  }
  function swingBat() { people.batter.play([['b_swing', 0.11], ['b_follow', 0.25]]); }
  // 打球: res の方向・距離・角度でボールを飛ばす (2 秒ほど)。カメラは高いところから追う
  function hitBall(res) {
    const dir = (res.dir || 0) * Math.PI / 180, dist = res.dist || 30, ang = (res.angle ?? 15);
    const end = new THREE.Vector3(W(Math.sin(dir) * dist), 0.1, Math.cos(dir) * dist);
    const peak = ang < 6 ? 0.4 : Math.min(45, Math.tan(ang * Math.PI / 180) * dist / 4 + 1);
    const dur = ang < 6 ? 1.1 + dist / 60 : 1.2 + dist / 45;
    hitAnim = { from: new THREE.Vector3(res.hr ? 0 : 0, 1.0, 0.3), end, peak, dur, t: 0, ground: ang < 6 };
    ball.visible = true; trail.visible = false; mark.visible = false; setCam('hit');
    // 近い野手がボールへ走る
    let best = null, bd = 1e9; for (const f of people.field) { const d = f.position.distanceTo(end); if (d < bd) { bd = d; best = f; } }
    if (best && !res.hr) { hitAnim.fielder = best; hitAnim.fFrom = best.position.clone(); best.play([['run', 0.18], ['run2', 0.18]], true); }
    people.batter.play([['run', 0.2], ['run2', 0.2]], true); hitAnim.runner = people.batter;
  }
  function resetView() { setCam('bat'); hitAnim = null; pitchAnim = null; ball.visible = false; trail.visible = false; mark.visible = false; markHold = 0; }

  // ---------- 描画 ----------
  let composer = null;
  try { composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.6, 0.85)); composer.addPass(new OutputPass()); } catch { composer = null; }
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); composer?.setSize(w, h); camera.aspect = w / h; camera.fov = w / h < 0.8 ? 44 : 34; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  let last = performance.now();
  const loop = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const h of all) h.update?.(dt);
    if (pitchAnim) {
      pitchAnim.t += dt; const t = pitchAnim.t;
      if (t >= 0) {
        if (!pitchAnim.released) { pitchAnim.released = true; pitchAnim.onRelease?.(now - t * 1000); }
        const p = C.pitchPos(pitchAnim.pc, t); p.x = W(p.x); ball.visible = true; ball.position.set(p.x, p.y, p.z); ball.rotation.x += dt * 40;
        const q = C.pitchPos(pitchAnim.pc, Math.max(0, t - 0.06)); q.x = W(q.x); trail.visible = true; trail.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2); trail.lookAt(q.x, q.y, q.z); trail.rotateX(Math.PI / 2); trail.scale.set(1, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), 1);
        // ボールの目印: ゾーンの面に、いまのボールの左右と高さを出す (輪は遠いと大きく、本塁で 1 つになる)
        const u = Math.min(1, t / pitchAnim.pc.T); mark.visible = true; mark.position.set(p.x, p.y, -0.04); markRing.scale.setScalar(1 + (1 - u) * 3);
        markRing.material.opacity = 0.5 + u * 0.5; markDot.material.opacity = 0.45 + u * 0.5;
        if (t >= pitchAnim.pc.T) markHold = 1.4; // 通った場所を少し残す
        if (t > pitchAnim.pc.T + 0.25) { ball.visible = false; trail.visible = false; pitchAnim = null; }
      }
    }
    if (!pitchAnim && markHold > 0) { markHold -= dt; if (markHold <= 0) mark.visible = false; }
    if (hitAnim) {
      const h = hitAnim; h.t += dt; const u = Math.min(1, h.t / h.dur);
      ball.position.lerpVectors(h.from, h.end, u); ball.position.y = h.ground ? 0.1 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.5 * (1 - u) : lerp(h.from.y, 0.1, u) + Math.sin(u * Math.PI) * h.peak;
      if (h.fielder) { const f = h.fielder, to = h.end; f.position.lerpVectors(h.fFrom, new THREE.Vector3(lerp(h.fFrom.x, to.x, 0.85), 0, lerp(h.fFrom.z, to.z, 0.85)), Math.min(1, h.t / h.dur)); f.lookAt(to.x, 0, to.z); }
      if (h.runner) { const r = h.runner, v = Math.min(1, h.t / 3.2); r.position.set(lerp(W(-0.78), W(19.4), v), 0, lerp(0, 19.4, v)); r.rotation.y = Math.PI * 0.75; } // 一塁へ走る
      if (u >= 1 && !h.done) { h.done = true; h.fielder?.pose('ready'); }
    }
    // カメラ: 打席は捕手のうしろ、打球は高いところから追う
    camT += dt;
    if (camMode === 'bat') { camPos.lerp(CAM_BAT.pos, 0.2); camLook.lerp(CAM_BAT.look, 0.2); }
    else if (camMode === 'hit') { const b = ball.position; camPos.lerp(new THREE.Vector3(b.x * 0.35, 14 + b.y * 0.5, -16 + b.z * 0.45), 0.06); camLook.lerp(b, 0.15); }
    else if (camMode === 'wide') { camPos.lerp(new THREE.Vector3(0, 32, -38), 0.05); camLook.lerp(new THREE.Vector3(0, 0, 40), 0.05); }
    camera.position.copy(camPos); camera.lookAt(camLook);
    zone.visible = camMode === 'bat'; if (people.ump) people.ump.visible = camMode !== 'bat'; // 打席のカメラでは審判は見せない (視界をふさぐ)
    if (people.catcher) people.catcher.visible = camMode !== 'bat'; // 打席のカメラでは捕手を見せない (ゾーンとボールが見やすい)
    if (composer) composer.render(); else renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  let raf = requestAnimationFrame(loop);
  // 画面の点 → 本塁の上の面 (z = 0) の座標
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  function screenToPlate(cx, cy) {
    const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(plane, hit) ? { x: W(hit.x), y: hit.y } : null;
  }
  function plateToScreen(x, y) { const v = new THREE.Vector3(W(x), y, 0).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }
  // 確認用: 打席のカメラを [x, y, z, 見る x, 見る y, 見る z] で変える
  const camBat = (c) => { CAM_BAT.pos.set(c[0], c[1], c[2]); CAM_BAT.look.set(c[3], c[4], c[5]); };
  return { camBat, scene, camera, setupPlayers, setRunners, throwPitch, swingBat, hitBall, resetView, setCam, setMeet, setAim, scoreboard, screenToPlate, plateToScreen, people, dispose() { cancelAnimationFrame(raf); renderer.dispose(); } };
}
