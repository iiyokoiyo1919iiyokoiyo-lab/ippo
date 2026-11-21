// =====================================================================
// 宝探し: 光と空と画面の仕上げ (シティバトルの最高画質と同じしくみ)
//   ・空: 大気の散乱 (Sky) を濃い青に・流れる雲 (シェーダーで描くもこもこの雲。太陽がわは明るく、下は少し灰色)・太陽のかさ
//   ・光: 太陽の影 (4096・自分のまわり 60m)・空の映りこみ → 建物ができたらキャンパスの映りこみ (CubeCamera を 1 回)
//   ・仕上げ: AO (すき間の陰)・ブルーム (光のにじみ)・ACES・SMAA または FXAA・MSAA・色の仕上げ (周辺減光・粒)・動的解像度
//   ・画質はシティバトルと同じ設定を使う (localStorage arena_quality: low / medium / high / ultra)
// =====================================================================
import * as THREE from '../arena/vendor/three.module.min.js';
import { Sky } from '../arena/vendor/jsm/objects/Sky.js';
import { EffectComposer } from '../arena/vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../arena/vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../arena/vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../arena/vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../arena/vendor/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from '../arena/vendor/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from '../arena/vendor/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from '../arena/vendor/jsm/shaders/FXAAShader.js';

export const QUALITY = {
  low: { pr: 1, shadow: 1024, ao: false, bloom: false, grade: false, msaa: 0, smaa: false, env: false, clouds: true },
  medium: { pr: 1.5, shadow: 2048, ao: false, bloom: true, grade: true, msaa: 0, smaa: false, env: true, clouds: true },
  high: { pr: 2, shadow: 2048, ao: true, bloom: true, grade: true, msaa: 0, smaa: false, env: true, clouds: true },
  ultra: { pr: 3, shadow: 4096, ao: true, bloom: true, grade: true, msaa: 4, smaa: true, env: true, clouds: true },
};
const QN = { low: '低', medium: '中', high: '高', ultra: '最高' };

export function createLook({ canvas, isTouch }) {
  let qName = (() => { try { return localStorage.getItem('arena_quality'); } catch { return null; } })();
  if (!QUALITY[qName]) qName = isTouch ? 'high' : 'ultra';
  const Q = QUALITY[qName];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const PR_MAX = Math.min(devicePixelRatio, Q.pr); let PR = PR_MAX;
  renderer.setPixelRatio(PR); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.52;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ANISO = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2500);
  scene.fog = new THREE.FogExp2('#b8cfe6', 0.0032);

  // ---------- 空: 澄んだ濃い青 (初夏の昼前)・太陽は南東の高いところ ----------
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 52), THREE.MathUtils.degToRad(145));
  const SKY = { turbidity: 1.6, rayleigh: 2.2, mieCoefficient: 0.0035, mieDirectionalG: 0.82 };
  // 見える空は、写真のような濃い青のグラデーション (上ほど濃く、地平線は明るい・太陽のまわりに光のかさ)。物理の空 (Sky) は映りこみだけに使う
  const SKYC = { zenith: new THREE.Color(0.035, 0.16, 0.62), horizon: new THREE.Color(0.42, 0.62, 0.92), ground: new THREE.Color(0.32, 0.36, 0.42), sun: new THREE.Color(1.0, 0.92, 0.78) };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uZ: { value: SKYC.zenith }, uH: { value: SKYC.horizon }, uG: { value: SKYC.ground }, uS: { value: SKYC.sun }, uSun: { value: sunDir } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uZ; uniform vec3 uH; uniform vec3 uG; uniform vec3 uS; uniform vec3 uSun; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 c = h > 0.0 ? mix(uH, uZ, pow(h, 0.5)) : mix(uH, uG, pow(min(1.0, -h * 4.0), 0.6));
        float s = max(dot(d, normalize(uSun)), 0.0); c += uS * (pow(s, 900.0) * 30.0 + pow(s, 60.0) * 0.5 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(c * 2.2, 1.0); }` }));
  dome.renderOrder = -2; dome.frustumCulled = false; dome.userData.keep = true; scene.add(dome);
  // 映りこみを撮るときだけ使う、落ち着いた色の物理の空 (濃い青の空を映すと、かげが青くなりすぎる)
  const phys = new Sky(); phys.scale.setScalar(2000); for (const [k, v] of Object.entries(SKY)) phys.material.uniforms[k].value = v; phys.material.uniforms.sunPosition.value.copy(sunDir); phys.visible = false; scene.add(phys);
  // 雲: 高いところの大きな板に、ゆっくり流れるもこもこの雲 (fbm ノイズ)。地平線に近いほどうすく
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSun: { value: sunDir }, uCam: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform vec3 uCam; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
      void main(){
        vec2 p = vW.xz * 0.0016 + vec2(uTime * 0.004, uTime * 0.0015);
        float d = fbm(p), cov = smoothstep(0.52, 0.78, d);               // 雲の量 (晴れ間が多め)
        float thick = smoothstep(0.55, 0.95, fbm(p * 1.7 + 3.1));
        float lit = clamp(0.62 + (fbm(p + uSun.xz * 0.03) - d) * 2.4, 0.35, 1.0); // 太陽がわは明るく、かげは灰色
        vec3 col = mix(vec3(0.62, 0.68, 0.78), vec3(1.0, 0.99, 0.97), lit) * (1.0 - thick * 0.18);
        float dist = length(vW.xz - uCam.xz), fade = 1.0 - smoothstep(900.0, 2300.0, dist); // 遠い (地平線に近い) ほどうすく
        gl_FragColor = vec4(col * 1.6, cov * 0.92 * fade);
      }` }));
  clouds.rotation.x = -Math.PI / 2; clouds.position.y = 260; clouds.renderOrder = -1; clouds.frustumCulled = false; clouds.userData.keep = true; clouds.visible = Q.clouds; scene.add(clouds);
  // 空の映りこみ (環境光)
  const pmrem = new THREE.PMREMGenerator(renderer);
  { const env = new THREE.Scene(), s2 = new Sky(); s2.scale.setScalar(2000); for (const [k, v] of Object.entries(SKY)) s2.material.uniforms[k].value = v; s2.material.uniforms.sunPosition.value.copy(sunDir); env.add(s2); scene.environment = pmrem.fromScene(env, 0.02).texture; }
  // 太陽と空の光
  const sun = new THREE.DirectionalLight('#fff3dc', 3.1); sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 260 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target, new THREE.HemisphereLight('#bcd6ff', '#7d6c52', 0.42));

  // ---------- 仕上げ ----------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa && renderer.capabilities.isWebGL2 ? Q.msaa : 0 }));
  composer.addPass(new RenderPass(scene, camera));
  if (Q.ao) { const ao = new GTAOPass(scene, camera, 1, 1); ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.9; ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1, thickness: 1, scale: 1 }); composer.addPass(ao); }
  if (Q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 1.0));
  composer.addPass(new OutputPass());
  let fxaa = null; if (Q.smaa) composer.addPass(new SMAAPass(1, 1)); else { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
  let grade = null;
  if (Q.grade) {
    grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ vec2 d = vUv - 0.5; float r2 = dot(d, d); vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, 1.1); c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
          c *= 1.0 - smoothstep(0.2, 0.65, r2) * 0.28; c += (h(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.018; gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }` });
    composer.addPass(grade);
  }
  function applyPR() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(PR); renderer.setSize(w, h, false); composer.setPixelRatio(PR); composer.setSize(w, h);
    fxaa?.material.uniforms.resolution.value.set(1 / (w * PR), 1 / (h * PR)); grade?.material.uniforms.uRes.value.set(w * PR, h * PR);
  }
  function resize() { applyPR(); camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 80 : 70; camera.updateProjectionMatrix(); }
  // 動的解像度: 重いのが続いたら解像度を下げ、ずっと軽ければもどす
  const dyn = { last: 0, ema: 16.7, t: 0, good: 0 };
  function adapt(now) {
    const dt = dyn.last ? now - dyn.last : 16.7; dyn.last = now; if (document.hidden || dt > 600) return;
    dyn.ema += (dt - dyn.ema) * 0.05; dyn.t += dt; if (dyn.t < 1500) return; dyn.t = 0;
    if (dyn.ema > 21 && PR > Math.min(1, PR_MAX)) { PR = Math.max(Math.min(1, PR_MAX), PR - 0.25); dyn.good = 0; applyPR(); }
    else if (dyn.ema < 17.6 && PR < PR_MAX) { if (++dyn.good >= 3) { PR = Math.min(PR_MAX, PR + 0.125); dyn.good = 0; applyPR(); } } else dyn.good = 0;
  }
  // 高さの絵から法線マップ (でこぼこの陰影)
  function normalMap(src, strength = 2) {
    const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data, out = document.createElement('canvas'); out.width = w; out.height = h;
    const g = out.getContext('2d'), img = g.createImageData(w, h), d = img.data, H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength, L = Math.hypot(dx, dy, 1), i = (y * w + x) * 4; d[i] = (dx / L * 0.5 + 0.5) * 255; d[i + 1] = (dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255; }
    g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t;
  }
  // 建物ができたあとで 1 回: キャンパスのまん中から 6 方向を撮って、ガラスや床の映りこみにする
  function captureEnv(at) {
    if (!Q.env) return;
    const rt = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType }), cc = new THREE.CubeCamera(0.5, 2500, rt); cc.position.copy(at); scene.add(cc);
    const vis = clouds.visible; clouds.visible = false; dome.visible = false; phys.visible = true; cc.update(renderer, scene); clouds.visible = vis; dome.visible = true; phys.visible = false; scene.remove(cc);
    scene.environment = pmrem.fromCubemap(rt.texture).texture; rt.dispose();
  }
  return {
    renderer, scene, camera, sun, sunDir, Q, ANISO, quality: qName, qualities: Object.keys(QUALITY), QN, resize, normalMap, captureEnv,
    follow(x, z) { const sx = Math.round(x / 4) * 4, sz = Math.round(z / 4) * 4; sun.target.position.set(sx, 0, sz); sun.position.set(sx + sunDir.x * 120, sunDir.y * 120, sz + sunDir.z * 120); },
    render(now) { adapt(now); dome.position.copy(camera.position); clouds.material.uniforms.uTime.value = now / 1000; clouds.material.uniforms.uCam.value.copy(camera.position); if (grade) grade.material.uniforms.uTime.value = now / 1000; composer.render(); },
    setQuality(q) { try { localStorage.setItem('arena_quality', q); } catch {} location.reload(); },
  };
}
