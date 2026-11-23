// =====================================================================
// IppO ベースボール: ガチャの演出 (3D)
//   ・ナイターのグラウンドに 3D の打者。前にカード (うら向き) がならぶ。うらの色でレア度がわかる (SSR は金色に光る)
//   ・トスされたボールを打つ → ボールがカードに当たる → 光ってカードが裏返り、選手のイラストが出る (1 枚ずつ)
//   ・SSR のときはスローとズーム。画面をタップすると早送り (のこりを全部めくる)
//   ・選手の絵は bb-illust.js の SVG を画像にしてカードに貼る
// =====================================================================
import * as THREE from '../arena/vendor/three.module.min.js';
import { makeHuman } from './stadium.js?v=7';

const RC = { N: '#9aa5b8', R: '#4dabf7', SR: '#c77dff', SSR: '#ffd43b' };
const svgTex = (svg, w, h) => new Promise((ok) => {
  const img = new Image(); const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ok(t); };
  img.onerror = () => ok(null); img.src = url;
});
function backTex(rar) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 332; const g = c.getContext('2d'), col = RC[rar] || RC.N;
  const BG = { N: ['#3a4150', '#1c2029'], R: ['#1864ab', '#0b2a4a'], SR: ['#7b2cbf', '#2a0d47'], SSR: ['#f5b400', '#7a4a00'] }[rar] || ['#3a4150', '#1c2029']; const gr = g.createLinearGradient(0, 0, 256, 332); gr.addColorStop(0, BG[0]); gr.addColorStop(1, BG[1]); g.fillStyle = gr; g.fillRect(0, 0, 256, 332);
  g.strokeStyle = col; g.lineWidth = 10; g.strokeRect(10, 10, 236, 312);
  g.globalAlpha = 0.18; g.fillStyle = '#ffffff'; for (let i = 0; i < 9; i++) g.fillRect(i * 30 + 8, 0, 8, 332); g.globalAlpha = 1; // たての線
  g.beginPath(); g.arc(128, 166, 56, 0, Math.PI * 2); g.fillStyle = '#fbfbf6'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#e03131';
  g.beginPath(); g.arc(70, 166, 48, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(186, 166, 48, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
  g.fillStyle = col; g.font = '900 30px sans-serif'; g.textAlign = 'center'; g.fillText('IppO', 128, 300);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// results: ガチャの結果 (選手)。onDone: 演出が終わったら
export async function playGacha(results, onDone) {
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;inset:0;z-index:80;background:#000;touch-action:none';
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; wrap.append(canvas);
  const tip = document.createElement('div'); tip.style.cssText = 'position:absolute;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);color:#fff;font:800 12px sans-serif;background:rgba(0,0,0,.5);padding:5px 12px;border-radius:999px;pointer-events:none'; tip.textContent = 'タップで早送り'; wrap.append(tip);
  const big = document.createElement('div'); big.style.cssText = 'position:absolute;left:50%;top:18%;transform:translate(-50%,-50%);font:900 34px sans-serif;color:#fff;text-shadow:0 4px 0 #000,0 0 24px rgba(255,212,59,.8);pointer-events:none;opacity:0;transition:opacity .2s,transform .3s;white-space:nowrap'; wrap.append(big);
  document.body.append(wrap);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#070b1a'); scene.fog = new THREE.Fog('#070b1a', 18, 46);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  scene.add(new THREE.HemisphereLight('#9fb6ff', '#1a2a12', 0.7));
  const spot = new THREE.SpotLight('#fff6e0', 60, 40, 0.6, 0.5); spot.position.set(-2, 12, -4); spot.target.position.set(0, 0, 5); spot.castShadow = true; scene.add(spot, spot.target);
  const glow = new THREE.PointLight('#dfe8ff', 18, 20); glow.position.set(0, 3, 9); scene.add(glow);
  // 地面 (芝と土)・遠くの照明
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: '#2f7d32', roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshStandardMaterial({ color: '#a86b3c', roughness: 1 })); dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.01; scene.add(dirt);
  for (let i = 0; i < 40; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#fffbe8' })); const a = (i / 40) * Math.PI - Math.PI / 2; s.position.set(Math.sin(a) * 34, 9 + (i % 3) * 1.5, Math.cos(a) * 34 + 6); scene.add(s); }
  // 打者 (右打ち。本塁 (原点) に向かって立ち、+z の方へ打つ)
  const RK = ['N', 'R', 'SR', 'SSR'], best = results.reduce((a, b) => (RK.indexOf(b.rarity) > RK.indexOf(a.rarity) ? b : a), results[0]); // いちばんいい選手が打席に立つ
  const batter = makeHuman({ main: '#f8f9fa', accent: '#f08c00', cap: '#1b1b2a', number: Number(best?.number) || 51, label: '', look: best?.look || {}, glove: false, bat: true });
  batter.position.set(0.78, 0, 0); batter.rotation.y = Math.PI / 2; batter.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(batter); batter.pose('b_stance');
  // カード (うら向き。カメラ (-z) のほうを向いている面がうら)
  const portrait = innerWidth / innerHeight < 0.8, n = results.length, cols = portrait ? Math.min(n, n > 6 ? 4 : 3) : Math.min(n, 5), rows = Math.ceil(n / cols);
  const cards = [];
  for (let i = 0; i < n; i++) {
    const p = results[i], col = i % cols, row = Math.floor(i / cols);
    const back = new THREE.MeshStandardMaterial({ map: backTex(p.rarity), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(RC[p.rarity] || RC.N), emissiveIntensity: p.rarity === 'SSR' ? 0.35 : 0.04 });
    const front = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
    const edge = new THREE.MeshStandardMaterial({ color: RC[p.rarity] || RC.N, metalness: 0.6, roughness: 0.3 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.82, 0.05), [edge, edge, edge, edge, front, back]);
    const inRow = Math.min(cols, n - row * cols), x = (col - (inRow - 1) / 2) * 1.65, y = 1.2 + (rows - 1 - row) * 2.15 + (rows === 1 ? 0.6 : 0), z = 10;
    m.userData = { target: new THREE.Vector3(x, y, z), from: new THREE.Vector3(x * 3, 14, z + 6), p, flipped: false, flipT: 0 };
    m.position.copy(m.userData.from); m.castShadow = true; scene.add(m); cards.push(m);
    svgTex(window.BBIllust ? window.BBIllust.svg(p, { size: 256 }) : '<svg/>', 256, 332).then((t) => { if (t) { front.map = t; front.needsUpdate = true; } });
  }
  // ボール・光・火花
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshStandardMaterial({ color: '#fbfbf6', emissive: '#ffffff', emissiveIntensity: 0.4 })); ball.visible = false; scene.add(ball);
  const trail = []; for (let i = 0; i < 10; i++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.05 * (1 - i / 12), 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.5 * (1 - i / 10) })); t.visible = false; scene.add(t); trail.push(t); }
  const sparks = []; const sparkGeo = new THREE.SphereGeometry(0.04, 6, 4);
  const burst = (pos, color, k = 1) => { for (let i = 0; i < 24 * k; i++) { const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true })); s.position.copy(pos); s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.7) * 4).multiplyScalar(k); s.userData.life = 0.8; scene.add(s); sparks.push(s); } };
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })); scene.add(flash);
  // 進め方
  const camHome = { pos: new THREE.Vector3(-1.6, 1.9, -3.6), look: new THREE.Vector3(0.1, 1.2 + (rows - 1) * 1.0, 10) };
  // はじめは打者の前のアップ (選手登場) → うしろへ引く
  camera.position.set(2.7, 1.55, 0.9); const look = new THREE.Vector3(0.78, 1.25, 0);
  let phase = 'intro', t = 0, idx = 0, fast = false, slow = 1, done = false, shot = null;
  const order = cards.map((_, i) => i).sort((a, b) => RK.indexOf(cards[a].userData.p.rarity) - RK.indexOf(cards[b].userData.p.rarity)); // いいカードは最後に
  const say = (txt, ms = 900) => { big.textContent = txt; big.style.opacity = '1'; big.style.transform = 'translate(-50%,-50%) scale(1.08)'; clearTimeout(say.t); say.t = setTimeout(() => { big.style.opacity = '0'; big.style.transform = 'translate(-50%,-50%) scale(1)'; }, ms); };
  const flipCard = (c) => { c.userData.flipped = true; c.userData.flipT = 0; const col = RC[c.userData.p.rarity] || RC.N; burst(c.position, col, c.userData.p.rarity === 'SSR' ? 2 : 1); flash.position.copy(c.position).add(new THREE.Vector3(0, 0, -0.2)); flash.material.color.set(col); flash.material.opacity = 0.9;
    if (c.userData.p.rarity === 'SSR') say('✨ SSR ✨', 1400); else if (c.userData.p.origin === 'hot' || c.userData.p.origin === 'real') say('🔥 活躍選手！', 1000); };
  wrap.addEventListener('pointerdown', () => { if (phase === 'done') return finish(); fast = true; tip.textContent = '早送り中…'; });
  function finish() { if (done) return; done = true; cancelAnimationFrame(raf); renderer.dispose(); wrap.remove(); onDone?.(); }
  const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.8 ? 62 : 46; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  let last = performance.now(), raf = 0;
  const loop = () => {
    const now = performance.now(); let dt = Math.min(0.05, (now - last) / 1000) * slow; last = now; if (fast) dt *= 3;
    t += dt; batter.update?.(dt);
    if (phase === 'intro') { if (t > 1.6 || fast) { phase = 'deal'; t = 0; } }
    // カードが空から降りてくる
    cards.forEach((c, i) => {
      const k = phase === 'intro' ? 0 : Math.min(1, Math.max(0, (t - i * 0.06) / 0.7)), e = 1 - Math.pow(1 - k, 3);
      if (phase === 'deal' || k < 1) c.position.lerpVectors(c.userData.from, c.userData.target, e);
      if (!c.userData.flipped) c.rotation.set(0, 0, Math.sin(now / 500 + i) * 0.03);
      else { c.userData.flipT = Math.min(1, c.userData.flipT + dt / 0.45); const f = c.userData.flipT; c.rotation.y = Math.PI * (1 - Math.pow(1 - f, 3)); const s = 1 + Math.sin(f * Math.PI) * 0.25; c.scale.setScalar(s); }
      if (c.userData.p.rarity === 'SSR' && !c.userData.flipped) c.material[5].emissiveIntensity = 0.3 + Math.sin(now / 120) * 0.2;
    });
    if (phase === 'deal' && t > 0.7 + n * 0.06) { phase = 'swing'; t = 0; }
    // 1 枚ずつ: トス → スイング → ボールがカードへ → 裏返る
    if (phase === 'swing' && idx < order.length) {
      const c = cards[order[idx]], ssr = c.userData.p.rarity === 'SSR';
      if (!shot) { shot = { t: 0, hit: false }; batter.pose('b_stance'); ball.visible = true; batter.play([['b_load', 0.25]]); }
      shot.t += dt; const s = shot.t;
      if (s < 0.35) { const u = s / 0.35; ball.position.set(-0.2, 1.0 + Math.sin(u * Math.PI) * 0.5, 0.55 + u * 0.1); } // トス
      else if (!shot.swung) { shot.swung = true; batter.play([['b_swing', 0.09], ['b_follow', 0.25]]); slow = ssr ? 0.35 : 1; }
      if (s >= 0.42) { // 打球
        const dur = ssr ? 0.55 : 0.32, u = Math.min(1, (s - 0.42) / dur), from = new THREE.Vector3(-0.2, 1.0, 0.65), to = c.position;
        ball.position.lerpVectors(from, to, u); ball.position.y += Math.sin(u * Math.PI) * 0.8;
        trail.forEach((tr, i) => { const uu = Math.max(0, u - (i + 1) * 0.025); tr.visible = u > 0 && u < 1; tr.position.lerpVectors(from, to, uu); tr.position.y += Math.sin(uu * Math.PI) * 0.8; });
        if (ssr) { look.lerp(c.position, 0.08); camera.position.lerp(new THREE.Vector3(c.position.x * 0.5, c.position.y + 0.2, c.position.z - 7.5), 0.05); }
        if (u >= 1 && !shot.hit) { shot.hit = true; ball.visible = false; trail.forEach((tr) => { tr.visible = false; }); flipCard(c); slow = 1; }
      }
      if (shot.hit && s > 0.42 + (ssr ? 1.6 : 0.62)) { shot = null; idx++; ball.visible = false; }
    }
    if (phase === 'swing' && idx >= order.length) { phase = 'done'; tip.textContent = 'タップでとじる'; say(results.some((p) => p.rarity === 'SSR') ? '🎉 SSR 獲得！' : '🎉 結果', 1600); }
    if (fast && phase === 'swing') { for (const i of order.slice(idx)) if (!cards[i].userData.flipped) flipCard(cards[i]); idx = order.length; shot = null; ball.visible = false; }
    if (phase !== 'intro' && !(phase === 'swing' && shot && cards[order[idx]]?.userData.p.rarity === 'SSR')) { camera.position.lerp(camHome.pos, 0.05); look.lerp(camHome.look, 0.06); }
    camera.lookAt(look);
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 3); flash.lookAt(camera.position);
    for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.userData.life -= dt; s.userData.v.y -= 9 * dt; s.position.addScaledVector(s.userData.v, dt); s.material.opacity = Math.max(0, s.userData.life / 0.8); if (s.userData.life <= 0) { scene.remove(s); sparks.splice(i, 1); } }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  say('⚾ ' + (best?.rarity === 'SSR' ? '大物の予感…！' : 'プレイボール！'), 1300);
  raf = requestAnimationFrame(loop);
}
