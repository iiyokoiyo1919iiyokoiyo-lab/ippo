// 117万分の1 競走馬版: 画面・演出・カード・図鑑 (tools/build_horse.py が元のゲームから作ったもの。手で編集しない)
// 元のゲームから変えたのは「みんなの結果」「図鑑の保存先」「シェア」だけ。IppO とのつなぎは ippo.js
/* ---------- 効果音(Web Audioで合成。音源ファイルは使わない) ---------- */
let AC = null, master = null, soundOn = true;
try { if (localStorage.getItem('sfx') === 'off') soundOn = false; } catch(e){}
function ac(){
  if (!soundOn) return null;
  if (!AC){
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    AC = new C(); master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, t0, dur, type, vol, slideTo){
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), st = a.currentTime + t0;
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, st);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, st + dur);
  g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(vol || 0.15, st + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
  o.connect(g); g.connect(master); o.start(st); o.stop(st + dur + 0.05);
}
function bell(freq, t0, dur, vol){ tone(freq, t0, dur, 'triangle', vol || 0.14); tone(freq * 2, t0, dur * 0.6, 'sine', (vol || 0.14) * 0.35); }
function noise(t0, dur, vol, f0, f1, q){
  const a = ac(); if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q || 1;
  const st = a.currentTime + t0; bp.frequency.setValueAtTime(f0, st); if (f1) bp.frequency.exponentialRampToValueAtTime(f1, st + dur);
  const g = a.createGain(); g.gain.setValueAtTime(vol, st); g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(st);
}
const N = {C5:523.25, D5:587.33, E5:659.25, G5:783.99, A5:880, C6:1046.5, E6:1318.5, G6:1568, C7:2093};
const sfx = {
  tick(season){ const f = season === '春' ? 880 : 740; tone(f, 0, 0.09, 'sine', 0.07); },
  born(){ [N.C5, N.E5, N.G5].forEach((f, i) => bell(f, i * 0.16, 0.9, 0.13)); },
  win(){ bell(N.G5, 0, 0.5, 0.13); bell(N.C6, 0.13, 0.7, 0.13); },
  fanfare(level){
    const seq = level >= 3 ? [N.C5, N.E5, N.G5, N.C6, N.E6] : level === 2 ? [N.E5, N.G5, N.C6, N.E6] : [N.G5, N.C6, N.E6];
    seq.forEach((f, i) => bell(f, i * 0.11, 0.8, 0.13));
    const at = seq.length * 0.11 + 0.05;
    [N.C5, N.E5, N.G5, N.C6].forEach(f => bell(f, at, level >= 3 ? 1.6 : 1.0, 0.1));
    if (level >= 2) [N.G6, N.C7, N.E6, N.G6].forEach((f, i) => bell(f, at + 0.25 + i * 0.1, 0.5, 0.06));
    if (level >= 3) { noise(at, 0.5, 0.05, 3000, 6000, 0.7); }
  },
  sparkle(){ [N.E6, N.G6, N.C7].forEach((f, i) => bell(f, i * 0.07, 0.4, 0.07)); },
  gate(){ noise(0, 0.06, 0.25, 1800, 900, 2); tone(110, 0, 0.12, 'sine', 0.2, 60);
    [0.35, 0.47, 0.59, 0.84, 0.96, 1.08].forEach((t0, i) => { tone(95, t0, 0.1, 'sine', i % 3 === 2 ? 0.22 : 0.15, 55); noise(t0, 0.05, 0.06, 500, 300, 1); }); },
  gallop(){ const hits = [0,.14,.28,.55,.69,.83,1.1,1.24,1.38,1.6]; hits.forEach((t0, i) => { tone(90, t0, 0.1, 'sine', i % 3 === 2 ? 0.2 : 0.14, 52); noise(t0, 0.05, 0.05, 500, 280, 1); }); },
  whoosh(){ noise(0, 0.9, 0.12, 300, 2500, 0.6); tone(220, 0, 0.9, 'sine', 0.04, 440); },
  hurt(){ tone(330, 0, 0.45, 'sine', 0.1, 220); tone(247, 0.22, 0.7, 'sine', 0.08, 165); },
  retire(){ bell(N.E5, 0, 0.8, 0.1); bell(N.C5, 0.22, 1.2, 0.1); },
  end(){ tone(261.6, 0, 1.6, 'sine', 0.09, 196); tone(196, 0.25, 1.8, 'sine', 0.07, 130.8); },
  result(){ [N.C5, N.G5, N.E6].forEach((f, i) => bell(f, i * 0.1, 0.9, 0.1)); }
};
function playFor(s){
  const h = s.head;
  if (h === '誕生') sfx.born();
  else if (h === 'G1勝利') sfx.fanfare(3);
  else if (h === 'G2勝利') sfx.fanfare(2);
  else if (h === 'G3勝利' || h === 'リステッド勝ち') sfx.fanfare(1);
  else if (h === 'デビュー'){ sfx.gate(); if (s.hit) setTimeout(() => sfx.win(), 1300); }
  else if (h === '初勝利') sfx.win();
  else if (h === '海を渡る') sfx.whoosh();
  else if (h === '引退') sfx.retire();
  else if (h === '最期' || h === '記録なし' || h === 'へい死' || h === '行方不明') sfx.end();
  else if (h === '故障') sfx.hurt();
  else if (s.kids && s.kids.some(k => k.hit)) sfx.sparkle();
  else if (s.hit) sfx.win();
  else sfx.tick(s.season);
}
function setSfxButton(){ const b = document.getElementById('btnSfx'); b.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); b.textContent = soundOn ? '🔊 音あり' : '🔇 音なし'; }

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);

/* ---------- 勝利のカットイン ---------- */
const COAT_COL = {
  '鹿毛':{c:'#B98563', d:'#8E5F44', l:'#F6DCC6', m:'#FF9DC0'},
  '黒鹿毛':{c:'#7A5A52', d:'#55403B', l:'#D9C2B5', m:'#FFB7A1'},
  '栗毛':{c:'#E39A5B', d:'#B9733C', l:'#FFE3C4', m:'#FFF1C9'},
  '芦毛':{c:'#D5DAE8', d:'#A8AFC6', l:'#F4F6FC', m:'#C9B6FF'},
  '青鹿毛':{c:'#55536E', d:'#3C3A52', l:'#B9B7CF', m:'#8FD9C0'}
};
const SILKS = ['#7C8FF0','#FF8FB1','#5CC9A7','#FFB454','#B08CFF'];
const CONF_COL = ['#FF9DC0','#FFD35E','#8FD9C0','#9DB0FF','#FFFFFF','#C9B6FF'];
const CUT_DUR = [3300, 3700, 4000, 5000];
const CONF_N = [26, 34, 44, 70];
let cutinOn = true, cutinActive = false, cutTimer = null;
try { if (localStorage.getItem('cutin') === 'off') cutinOn = false; } catch(e){}
/* ---------- 3Dレース(自前の軽量WebGL。外部ライブラリは使わない) ---------- */
const G3D = (() => {
  let gl = null, canvas = null, prog = null, U = {}, MESH = {}, state = 0, raf = 0, t0 = 0, cur = null;
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const lerp = (a, b, k) => a + (b - a) * k;
  const sm = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  /* 行列(列優先) */
  const id = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3]; return o; };
  const T = (x,y,z) => { const m = id(); m[12] = x; m[13] = y; m[14] = z; return m; };
  const S = (x,y,z) => { const m = id(); m[0] = x; m[5] = y; m[10] = z; return m; };
  const RZ = a => { const m = id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
  const RY = a => { const m = id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; };
  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const look = (e, t, up) => { const z = norm3([e[0]-t[0], e[1]-t[1], e[2]-t[2]]), x = norm3(cross(up, z)), y = cross(z, x), m = id();
    m[0]=x[0]; m[1]=y[0]; m[2]=z[0]; m[4]=x[1]; m[5]=y[1]; m[6]=z[1]; m[8]=x[2]; m[9]=y[2]; m[10]=z[2]; m[12]=-dot(x,e); m[13]=-dot(y,e); m[14]=-dot(z,e); return m; };
  const nmat = m => { const a = (i, j) => m[j*4+i];
    const c00 = a(1,1)*a(2,2)-a(1,2)*a(2,1), c01 = -(a(1,0)*a(2,2)-a(1,2)*a(2,0)), c02 = a(1,0)*a(2,1)-a(1,1)*a(2,0);
    const c10 = -(a(0,1)*a(2,2)-a(0,2)*a(2,1)), c11 = a(0,0)*a(2,2)-a(0,2)*a(2,0), c12 = -(a(0,0)*a(2,1)-a(0,1)*a(2,0));
    const c20 = a(0,1)*a(1,2)-a(0,2)*a(1,1), c21 = -(a(0,0)*a(1,2)-a(0,2)*a(1,0)), c22 = a(0,0)*a(1,1)-a(0,1)*a(1,0);
    const d = (a(0,0)*c00 + a(0,1)*c01 + a(0,2)*c02) || 1;
    return new Float32Array([c00/d, c10/d, c20/d, c01/d, c11/d, c21/d, c02/d, c12/d, c22/d]); };

  /* 形状 */
  function mk(v, ix){
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    return {vb, ib, n: ix.length};
  }
  function sphere(lat, lon){ const v = [], ix = [];
    for (let i = 0; i <= lat; i++){ const th = i * Math.PI / lat, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= lon; j++){ const ph = j * 2 * Math.PI / lon, x = st * Math.cos(ph), z = st * Math.sin(ph); v.push(x, ct, z, x, ct, z); } }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++){ const a = i * (lon + 1) + j, b = a + lon + 1; ix.push(a, a + 1, b, b, a + 1, b + 1); }
    return mk(v, ix); }
  function cyl(bot, seg){ const v = [], ix = [], slope = 1 - bot, nl = Math.hypot(1, slope);
    for (let i = 0; i <= seg; i++){ const a = i * 2 * Math.PI / seg, c = Math.cos(a), s = Math.sin(a), nx = c / nl, ny = slope / nl, nz = s / nl;
      v.push(c, 0, s, nx, ny, nz, c * bot, -1, s * bot, nx, ny, nz); }
    for (let i = 0; i < seg; i++){ const a = i * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const base = v.length / 6; v.push(0, 0, 0, 0, 1, 0); for (let i = 0; i <= seg; i++){ const a = i * 2 * Math.PI / seg; v.push(Math.cos(a), 0, Math.sin(a), 0, 1, 0); }
    for (let i = 0; i < seg; i++) ix.push(base, base + i + 2, base + i + 1);
    const b2 = v.length / 6; v.push(0, -1, 0, 0, -1, 0); for (let i = 0; i <= seg; i++){ const a = i * 2 * Math.PI / seg; v.push(Math.cos(a) * bot, -1, Math.sin(a) * bot, 0, -1, 0); }
    for (let i = 0; i < seg; i++) ix.push(b2, b2 + i + 1, b2 + i + 2);
    return mk(v, ix); }
  function box(){ const v = [], ix = [], F = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
    F.forEach((n, f) => { const u = n[0] ? [0,0,1] : [1,0,0], w = cross(n, u), b = v.length / 6;
      [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([p, q]) => { v.push(n[0]*.5 + u[0]*p*.5 + w[0]*q*.5, n[1]*.5 + u[1]*p*.5 + w[1]*q*.5, n[2]*.5 + u[2]*p*.5 + w[2]*q*.5, n[0], n[1], n[2]); });
      ix.push(b, b + 1, b + 2, b, b + 2, b + 3); });
    return mk(v, ix); }

  const VS = 'attribute vec3 aP; attribute vec3 aN; uniform mat4 uM; uniform mat4 uVP; uniform mat3 uN; uniform float uO; varying vec3 vN; varying vec3 vW;' +
    'void main(){ vec4 w = uM * vec4(aP, 1.0); vec3 n = normalize(uN * aN); w.xyz += n * uO; vW = w.xyz; vN = n; gl_Position = uVP * w; }';
  const FS = 'precision mediump float; uniform vec3 uC; uniform vec3 uOC; uniform vec3 uCam; uniform vec3 uFog; uniform float uPass; varying vec3 vN; varying vec3 vW;' +
    'void main(){ vec3 N = normalize(vN); vec3 L = normalize(vec3(0.5, 0.85, 0.55)); float d = dot(N, L); float t = smoothstep(-0.1, 0.4, d);' +
    ' vec3 col = uC * (0.66 + 0.34 * t) + uC * 0.07 * N.y; vec3 V = normalize(uCam - vW); col += pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.10;' +
    ' if (uPass > 0.5) col = uOC; float f = clamp((length(uCam - vW) - 26.0) / 70.0, 0.0, 1.0); col = mix(col, uFog, f); gl_FragColor = vec4(col, 1.0); }';
  function sh(type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }

  function init(cv){
    if (state !== 0) return state === 1;
    try {
      canvas = cv; gl = cv.getContext('webgl', {antialias: true, alpha: false}) || cv.getContext('experimental-webgl', {antialias: true, alpha: false});
      if (!gl) throw new Error('no webgl');
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      ['uM','uVP','uN','uO','uC','uOC','uCam','uFog','uPass'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
      U.aP = gl.getAttribLocation(prog, 'aP'); U.aN = gl.getAttribLocation(prog, 'aN');
      MESH.sph = sphere(14, 20); MESH.cy = cyl(1, 14); MESH.tc = cyl(0.72, 14); MESH.bx = box();
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.frontFace(gl.CCW);
      state = 1;
    } catch (e) { state = 2; }
    return state === 1;
  }

  /* 描画命令 */
  const OUTLINE = hex('#6B4A5A'), SKY = hex('#D5E9FF');
  function push(cmds, parent, local, mesh, col, ow){ const M = mul(parent, local); cmds.push({mesh, M, N: nmat(M), col, ow}); }
  function seg(cmds, parent, p0, p1, r, mesh, col, ow){
    const d = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, ya = [-d[0]/L, -d[1]/L, -d[2]/L];
    const h = Math.abs(ya[1]) < 0.99 ? [0,1,0] : [1,0,0], xa = norm3(cross(h, ya)), za = cross(xa, ya);
    push(cmds, parent, new Float32Array([xa[0]*r, xa[1]*r, xa[2]*r, 0, -d[0], -d[1], -d[2], 0, za[0]*r, za[1]*r, za[2]*r, 0, p0[0], p0[1], p0[2], 1]), mesh, col, ow); }

  function horse(cmds, R, st, ph, lite){
    const OW = 0.05;
    const ell = (p, s, col, ow, par) => push(cmds, par || R, mul(T(p[0], p[1], p[2]), S(s[0], s[1], s[2])), 'sph', col, ow === undefined ? OW : ow);
    const bx = (p, s, col, ow, par) => push(cmds, par || R, mul(T(p[0], p[1], p[2]), S(s[0], s[1], s[2])), 'bx', col, ow === undefined ? OW * 0.6 : ow);
    const bob = 0.1 * Math.abs(Math.sin(ph + 0.6));
    const B = mul(R, mul(T(0, bob, 0), RZ(0.05 * Math.sin(ph + 0.4))));      // 体(上下にはずむ)
    const coat = st.coat, dark = st.dark;
    // 脚
    const L1 = 0.52, L2 = 0.5;
    [[-0.72, 0.34, 'h', 0.0], [-0.72, -0.34, 'h', 0.5], [0.74, 0.33, 'f', 2.9], [0.74, -0.33, 'f', 3.4]].forEach(([hx, hz, k, off]) => {
      const a = ph + off, hip = k === 'h' ? -0.1 + 0.62 * Math.sin(a) : 0.1 + 0.7 * Math.sin(a), kn = -(0.15 + 0.85 * Math.max(0, Math.sin(a + 1.6)));
      const col = hz < 0 ? dark : coat, hy = 1.0;
      const P0 = [hx, hy, hz], P1 = [hx + L1 * Math.sin(hip), hy - L1 * Math.cos(hip), hz], a2 = hip + kn, P2 = [P1[0] + L2 * Math.sin(a2), P1[1] - L2 * Math.cos(a2), hz];
      seg(cmds, B, P0, P1, 0.17, 'tc', col, OW); ell(P1, [0.15, 0.15, 0.15], col, OW, B); seg(cmds, B, P1, P2, 0.12, 'tc', col, OW);
      ell([P2[0] + 0.03, P2[1] - 0.04, P2[2]], [0.16, 0.12, 0.17], st.hoof, OW, B);
    });
    // 胴体・首・頭
    ell([0, 1.3, 0], [1.38, 0.8, 0.7], coat, OW, B);
    ell([0.3, 1.0, 0], [0.9, 0.35, 0.55], st.muzzle, 0, B);
    seg(cmds, B, [0.75, 1.45, 0], [1.3, 2.02, 0], 0.4, 'tc', coat, OW);
    ell([1.58, 2.12, 0], [0.56, 0.5, 0.47], coat, OW, B);
    ell([2.0, 1.98, 0], [0.33, 0.27, 0.31], st.muzzle, OW, B);
    // 目(大きくてかわいく)
    [1, -1].forEach(z => {
      ell([1.8, 2.2, 0.38 * z], [0.18, 0.22, 0.1], '#FFFFFF', 0.02, B);
      ell([1.86, 2.2, 0.44 * z], [0.11, 0.15, 0.06], '#3A2F4B', 0, B);
      ell([1.9, 2.26, 0.49 * z], [0.045, 0.045, 0.03], '#FFFFFF', 0, B);
      if (!lite){ ell([1.7, 2.0, 0.43 * z], [0.11, 0.075, 0.04], '#FF9DB8', 0, B); ell([2.27, 2.03, 0.1 * z], [0.05, 0.06, 0.04], '#3A2F4B', 0, B); }
    });
    // 耳・たてがみ・前髪
    [1, -1].forEach(z => seg(cmds, B, [1.4, 2.5, 0.17 * z], [1.34, 2.92, 0.22 * z], 0.12, 'tc', z < 0 ? dark : coat, OW));
    ell([1.64, 2.6, 0], [0.22, 0.15, 0.16], st.mane, OW, B);
    for (let i = 0; i < 4; i++){ const k = i / 3, sw = 0.05 * Math.sin(ph * 1.6 + i); ell([lerp(0.78, 1.28, k) - 0.06, lerp(1.95, 2.55, k), sw], [0.2 - i * 0.015, 0.2, 0.17], st.mane, OW, B); }
    // しっぽ
    for (let i = 0; i < 3; i++){ const sw = Math.sin(ph * 1.3 - i * 0.7); ell([-1.45 - i * 0.28, 1.5 - i * 0.18 + 0.05 * sw, 0.16 * sw * (i + 1) * 0.6], [0.2 - i * 0.025, 0.2 - i * 0.025, 0.2 - i * 0.025], st.mane, OW, B); }
    // ゼッケン(背中の布)
    bx([0.1, 2.06, 0], [0.95, 0.12, 0.95], st.cloth, OW * 0.6, B);
    // 騎手
    const J = mul(B, mul(T(0.05, 2.1, 0), RZ(-0.3)));
    const crouch = 0.03 * Math.sin(ph * 2);
    ell([0, 0.38 + crouch, 0], [0.34, 0.4, 0.31], st.silk, OW, J);
    ell([0.12, 0.9 + crouch, 0], [0.27, 0.27, 0.26], st.skin, OW, J);
    ell([0.12, 1.0 + crouch, 0], [0.3, 0.2, 0.29], st.silk, OW, J);
    if (!lite) bx([0.4, 0.95 + crouch, 0], [0.16, 0.04, 0.22], st.silk, 0, J);
    [1, -1].forEach(z => {
      ell([0.36, 0.9 + crouch, 0.1 * z], [0.035, 0.04, 0.03], '#3A2F4B', 0, J);
      seg(cmds, J, [0.1, 0.55 + crouch, 0.28 * z], [0.78, 0.2, 0.2 * z], 0.09, 'cy', st.silk, OW * 0.7);
      if (!lite) ell([0.8, 0.18, 0.2 * z], [0.09, 0.09, 0.09], st.skin, 0, J);
      seg(cmds, B, [0.0, 2.35, 0.3 * z], [0.18, 2.0, 0.52 * z], 0.11, 'cy', '#FFFFFF', OW * 0.7);
      ell([0.14, 1.9, 0.55 * z], [0.13, 0.1, 0.17], st.hoof, OW * 0.7, B);
    });
    // 影
    push(cmds, R, mul(T(0, 0.02, 0), S(1.7, 0.01, 0.85)), 'sph', '#E3C6A4', 0);
  }

  function newScene(level, col, silk){
    const rr = (a, b) => a + Math.random() * (b - a), pk = a => a[Math.floor(Math.random() * a.length)];
    const fin = {3: 3.8, 2: 3.5, 1: 3.2}[level] || 3.2;
    const coats = Object.values(COAT_COL), silks = SILKS.filter(s => s !== silk), cloths = ['#FFD35E', '#FFFFFF', '#FF9DC0', '#8FD9C0'];
    const lanes = [-4.5, -3.3, -2.1, -0.9, 0.3, 1.5, 2.7];
    const mar = {3: [2.5, 9], 2: [2, 6.5], 1: [1.2, 4.5]}[level] || [1.5, 5];
    const order = lanes.map((_, i) => i).sort(() => Math.random() - 0.5);
    const hs = lanes.map((z, li) => { const c = pk(coats), o = order[li]; return {z, g0: -2 + o * 1.5 + rr(-0.4, 0.4), gf: -(mar[0] + o * (mar[1] - mar[0]) / 6 + rr(-0.3, 0.3)), ph0: rr(0, 6.28), w: rr(0, 6.28), f: rr(2.55, 2.85), st: {coat: c.c, dark: c.d, muzzle: c.l, mane: c.m, silk: pk(silks), cloth: pk(cloths), skin: '#FFE3D0', hoof: '#6B5566'}}; });
    const player = {z: 4.1, st: {coat: col.c, dark: col.d, muzzle: col.l, mane: col.m, silk, cloth: '#FFD35E', skin: '#FFE3D0', hoof: '#6B5566'}, ph0: 0.3, f: 2.7};
    const crowd = []; for (let i = 0; i < 70; i++) crowd.push([-40 + i * 1.15 + rr(-.2, .2), 4.0 + (i % 2) * 0.55, -17.5 - (i % 3) * 0.6, pk(['#FF9DC0','#FFD35E','#8FD9C0','#9DB0FF','#FFFFFF','#C9B6FF'])]);
    return {level, fin, hs, player, crowd, dur: fin + 2.6};
  }

  function frame(t){
    const sc = cur, fin = sc.fin, V = 13, Sx = V * (t - fin), cmds = [], I = id();
    const wrap = (x, per) => ((x % per) + per * 1.5) % per - per / 2;   // [-per/2, per/2)
    const env = (mesh, p, s, col) => push(cmds, I, mul(T(p[0], p[1], p[2]), S(s[0], s[1], s[2])), mesh, col, 0);
    // 地面
    env('bx', [0, -0.12, 0], [400, 0.2, 160], '#CDEFD9'); env('bx', [0, -0.04, 0], [400, 0.1, 11.8], '#FFE6C9');
    for (let k = 0; k < 40; k++) env('bx', [wrap(k * 4 - Sx, 160), 0.012, 0], [1.6, 0.02, 11.8], '#FFDDB8');
    // 柵
    [-5.95, 5.95].forEach(z => { env('bx', [0, 0.95, z], [400, 0.12, 0.12], '#FFFFFF'); env('bx', [0, 0.5, z], [400, 0.1, 0.1], '#FFFFFF');
      for (let k = 0; k < 30; k++) env('bx', [wrap(k * 6 - Sx, 180), 0.55, z], [0.2, 1.1, 0.2], '#FFFFFF'); });
    // 遠景
    for (let k = 0; k < 6; k++){ env('sph', [wrap(k * 70 - Sx * 0.25, 420), -4, -52], [34, 11, 14], '#BFE8D6'); env('sph', [wrap(k * 70 + 35 - Sx * 0.15, 420), -6, -80], [40, 15, 16], '#D6F2E3'); }
    for (let k = 0; k < 7; k++){ const x = wrap(k * 60 - Sx * 0.12, 420), y = 20 + (k % 3) * 4; env('sph', [x, y, -60], [9, 3, 3], '#FFFFFF'); env('sph', [x - 5, y + 1.5, -60], [5, 3, 3], '#FFFFFF'); env('sph', [x + 5, y + 1, -60], [6, 3.4, 3], '#FFFFFF'); }
    // スタンドと観客・ゴール(ゴールは世界のx=0)
    const gx = -Sx;
    env('bx', [gx, 1.8, -17.5], [90, 3.6, 3.2], '#FFD6E3'); env('bx', [gx, 3.7, -17.5], [90, 0.3, 3.4], '#FFEFF5');
    sc.crowd.forEach(c => env('sph', [gx + c[0], c[1] - 0.1, c[2] + 1.0], [0.38, 0.38, 0.38], c[3]));
    for (let i = 0; i < 13; i++) env('bx', [gx, 0.02, -5.5 + i * 0.92], [0.9, 0.02, 0.92], i % 2 ? '#6B4A5A' : '#FFFFFF');
    for (let i = 0; i < 13; i++) env('bx', [gx + 0.9, 0.02, -5.5 + i * 0.92], [0.9, 0.02, 0.92], i % 2 ? '#FFFFFF' : '#6B4A5A');
    env('bx', [gx, 2.5, -6.8], [0.3, 5.0, 0.3], '#FFFFFF'); env('bx', [gx, 4.9, 0.4], [0.4, 0.7, 14.6], '#FF9DC0');
    // 馬たち
    const f2 = 2 * Math.PI, u = Math.min(1, t / fin), pe = Math.pow(u, 2.2);
    const post = Math.max(0, t - fin);
    const pg = lerp(-4.5, 0, pe) + Math.sin(t * 2) * 0.15 * (1 - u);
    const list = sc.hs.map(h => { const g = lerp(h.g0, h.gf, sm(u)) + 0.5 * Math.sin(1.4 * t + h.w) - post * 0.5; return {x: g, z: h.z + 0.08 * Math.sin(t * 1.7 + h.w), ph: t * f2 * h.f + h.ph0, st: h.st, lite: true}; });
    list.push({x: pg, z: sc.player.z, ph: t * f2 * sc.player.f + sc.player.ph0, st: sc.player.st, lite: false});
    list.sort((a, b) => a.z - b.z).forEach(h => horse(cmds, mul(T(h.x, 0.14, h.z), I), h.st, h.ph, h.lite));
    // カメラ
    const e = sm(u), k = sm(post / 2.4);
    let eye = [lerp(-10, 0.2, e), lerp(5.4, 3.1, e), lerp(17, 12.2, e)], tg = [lerp(0.5, pg + 0.5, e), 1.4, 0];
    eye = [lerp(eye[0], pg + 4.0, k), lerp(eye[1], 2.0, k), lerp(eye[2], 9.0, k)]; tg = [lerp(tg[0], pg + 0.8, k), lerp(tg[1], 1.8, k), 0];
    const W = canvas.width, H = canvas.height, VP = mul(persp(0.68, W / H, 0.5, 220), look(eye, tg, [0, 1, 0]));
    gl.viewport(0, 0, W, H); gl.clearColor(SKY[0], SKY[1], SKY[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform3fv(U.uCam, eye); gl.uniform3fv(U.uFog, SKY); gl.uniform3fv(U.uOC, OUTLINE);
    gl.enableVertexAttribArray(U.aP); gl.enableVertexAttribArray(U.aN);
    const cols = {}; const cc = h => cols[h] || (cols[h] = hex(h));
    let last = null;
    const pass = p => { gl.cullFace(p ? gl.FRONT : gl.BACK); gl.uniform1f(U.uPass, p);
      cmds.forEach(c => { if (p && !c.ow) return; const m = MESH[c.mesh];
        if (last !== c.mesh){ gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.vertexAttribPointer(U.aP, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(U.aN, 3, gl.FLOAT, false, 24, 12); last = c.mesh; }
        gl.uniformMatrix4fv(U.uM, false, c.M); gl.uniformMatrix3fv(U.uN, false, c.N); gl.uniform1f(U.uO, p ? c.ow : 0); gl.uniform3fv(U.uC, cc(c.col)); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0); }); };
    pass(1); pass(0);
  }

  function fit(){ const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(2, Math.round(canvas.clientWidth * dpr)); canvas.width = w; canvas.height = Math.round(w * 0.6); }
  function loop(now){ if (!cur) return; frame((now - t0) / 1000); raf = requestAnimationFrame(loop); }
  return {
    init, finTime: level => ({3: 3.8, 2: 3.5, 1: 3.2}[level] || 3.2),
    start(level, col, silk){ cur = newScene(level, col, silk); fit(); t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); },
    stop(){ cancelAnimationFrame(raf); cur = null; },
    preview(level, col, silk, t){ cur = newScene(level, col, silk); fit(); frame(t); }
  };
})();

/* ---------- 馬名カード(横長・キラキラ・ダウンロード用) ---------- */
const NAME_A = ['シャイニング','ロイヤル','ミラクル','ゴールデン','スターライト','ミッドナイト','ホワイト','アメジスト','サクラ','ハルカゼ','キセキ','ダイヤモンド','ブレイブ','ノーブル','エターナル','ヴィクトリー','フローラ','ルミナス','ステラ','ブルーム','サンライズ','ムーンライト','クリスタル','レジェンド','アクア','ローズ','ミスティ','スイート','ワンダー','マジェスティ','グランド','プラチナ','ミルキー','ファンタジー','ブリリアント','ラピス'];
const NAME_B = ['ノヴァ','ダンサー','スピリット','クラウン','ハート','ブレイズ','ウイング','ロード','プリンセス','キング','クイーン','ドリーム','メロディ','オーラ','スター','ファイア','ウィンド','ライト','ジュエル','ナイト','ティアラ','フラッシュ','レガシー','パレード','ミラージュ','リボン','ステップ','コメット'];
const NAME_C = ['キラメキ','ハナマル','オオゾラ','ハルノユメ','ホシノヒカリ','ツキノシズク','ニジイロ','アサヒノキセキ','ナミノハナ','ユメノツヅキ','ミライノカケラ','ゲンキイッパイ'];
function genHorseName(){
  if (Math.random() < 0.18) return NAME_C[Math.floor(Math.random() * NAME_C.length)];
  for (let i = 0; i < 60; i++){
    const a = NAME_A[Math.floor(Math.random() * NAME_A.length)], b = NAME_B[Math.floor(Math.random() * NAME_B.length)];
    if (a.length + b.length <= 9) return a + b;
  }
  return NAME_A[Math.floor(Math.random() * NAME_A.length)].slice(0, 9);
}
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function strHash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const CARD_W = 1600, CARD_H = 1000;
const RARITY = {
  g1:{label:'UR',  stars:5, bg:['#1A0F4D','#6A1B9A','#C0287F'], glow:'#FFE08A', foil:['#ff6b9d','#ffd36b','#7dffb0','#6bd3ff','#b08cff','#ff6b9d'], tag:'ULTRA RARE'},
  g2:{label:'SSR', stars:4, bg:['#2A1054','#7B2A8F','#E0801F'], glow:'#FFD66B', foil:['#ffe27a','#ff9ad0','#b48cff','#ffe27a'], tag:'SUPER SUPER RARE'},
  g3:{label:'SR',  stars:3, bg:['#0B2556','#1C5DA8','#2BB5D4'], glow:'#A8EEFF', foil:['#9deaff','#ffffff','#7da8ff','#9deaff'], tag:'SUPER RARE'},
  l: {label:'R',   stars:2, bg:['#0C3B35','#12806D','#58C9A0'], glow:'#C6FFE6', foil:['#9dffd0','#ffe27a','#6bd3ff','#9dffd0'], tag:'RARE'},
  n: {label:'N',   stars:1, bg:['#272B4F','#4B4F8A','#8486C4'], glow:'#EEF0FF', foil:['#d9dcff','#ffffff','#b9bdf0','#d9dcff'], tag:'NORMAL'}
};
const CARD_FONT = '"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Sans CJK JP",serif';
function mixHex(a, b, k){ const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); }
function rrect(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function star4(g, x, y, r, col, a, glow){
  g.save(); g.translate(x, y); g.globalAlpha = a; g.fillStyle = col; if (glow){ g.shadowColor = glow; g.shadowBlur = r * 0.9; }
  g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0); g.quadraticCurveTo(r * 0.12, r * 0.12, 0, r); g.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0); g.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r); g.closePath(); g.fill(); g.restore();
}
function fitFont(g, text, maxW, size, weight, minSize){ let s = size; do { g.font = `${weight} ${s}px ${CARD_FONT}`; if (g.measureText(text).width <= maxW) break; s -= 2; } while (s > (minSize || 20)); return s; }
function wrapLines(g, text, maxW, maxLines){
  const out = []; let line = '';
  for (const ch of text){ const t = line + ch; if (g.measureText(t).width > maxW && line){ out.push(line); line = ch; if (out.length === maxLines - 1) { /* 最終行へ */ } } else line = t; }
  if (line) out.push(line);
  if (out.length > maxLines){ const keep = out.slice(0, maxLines); let last = keep[maxLines - 1]; while (g.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1); keep[maxLines - 1] = last + '…'; return keep; }
  return out;
}

/* 馬の顔(正面)。流星(顔の中央の白い線)つき */
function drawHorseFace(g, cx, cy, s, col, rar){
  const coat = col.c, dark = col.d, light = col.l, mane = col.m, line = '#4A3550';
  g.save(); g.translate(cx, cy); g.scale(s, s); g.lineJoin = 'round'; g.lineCap = 'round';
  const mirror = fn => { fn(1); g.save(); g.scale(-1, 1); fn(-1); g.restore(); };
  const outline = (w) => { g.strokeStyle = line; g.lineWidth = w || 9; g.stroke(); };
  // 首・肩
  g.beginPath(); g.moveTo(-250, 250); g.bezierCurveTo(-270, 430, -330, 540, -420, 620); g.lineTo(420, 620); g.bezierCurveTo(330, 540, 270, 430, 250, 250); g.closePath();
  g.fillStyle = dark; g.fill(); outline();
  // たてがみ(後ろ)
  mirror(() => {
    g.beginPath(); g.moveTo(-120, -300); g.bezierCurveTo(-300, -300, -400, -150, -360, 40); g.bezierCurveTo(-340, 150, -370, 290, -330, 460);
    g.bezierCurveTo(-290, 380, -250, 300, -230, 220); g.bezierCurveTo(-250, 120, -240, 0, -200, -100); g.closePath();
    g.fillStyle = mane; g.fill(); outline();
    g.beginPath(); g.moveTo(-300, -120); g.bezierCurveTo(-345, -20, -335, 70, -310, 150); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 12; g.stroke();
  });
  // 耳
  mirror(() => {
    g.beginPath(); g.moveTo(-125, -245); g.bezierCurveTo(-165, -330, -150, -415, -110, -445); g.bezierCurveTo(-72, -405, -50, -340, -48, -270); g.closePath();
    g.fillStyle = coat; g.fill(); outline();
    g.beginPath(); g.moveTo(-118, -270); g.bezierCurveTo(-140, -330, -130, -380, -108, -404); g.bezierCurveTo(-88, -372, -76, -330, -74, -285); g.closePath(); g.fillStyle = '#FFB7CF'; g.fill();
  });
  // 頭
  const head = new Path2D();
  head.moveTo(0, -300); head.bezierCurveTo(-120, -300, -190, -210, -195, -100); head.bezierCurveTo(-198, 0, -170, 110, -130, 190); head.bezierCurveTo(-110, 230, -125, 290, -90, 325);
  head.bezierCurveTo(-60, 352, 60, 352, 90, 325); head.bezierCurveTo(125, 290, 110, 230, 130, 190); head.bezierCurveTo(170, 110, 198, 0, 195, -100); head.bezierCurveTo(190, -210, 120, -300, 0, -300); head.closePath();
  const gr = g.createRadialGradient(0, -80, 40, 0, 0, 330); gr.addColorStop(0, mixHex(coat, '#ffffff', 0.28)); gr.addColorStop(0.55, coat); gr.addColorStop(1, dark);
  g.fillStyle = gr; g.fill(head); g.strokeStyle = line; g.lineWidth = 10; g.stroke(head);
  // 流星(顔の中央の白い大きな線)
  g.save(); g.clip(head);
  const bl = new Path2D(); bl.moveTo(-24, -296); bl.bezierCurveTo(-42, -200, -56, -90, -50, 20); bl.bezierCurveTo(-47, 90, -42, 150, -38, 215); bl.lineTo(38, 215); bl.bezierCurveTo(42, 150, 47, 90, 50, 20); bl.bezierCurveTo(56, -90, 42, -200, 24, -296); bl.closePath();
  g.shadowColor = 'rgba(255,255,255,.85)'; g.shadowBlur = 26; g.fillStyle = '#FFFFFF'; g.fill(bl); g.shadowBlur = 0;
  g.strokeStyle = 'rgba(120,90,130,.35)'; g.lineWidth = 5; g.stroke(bl);
  g.restore();
  // 鼻先
  g.beginPath(); g.ellipse(0, 262, 116, 84, 0, 0, Math.PI * 2); g.fillStyle = light; g.fill(); g.strokeStyle = line; g.lineWidth = 9; g.stroke();
  mirror(() => { g.save(); g.translate(-46, 258); g.rotate(-0.4); g.beginPath(); g.ellipse(0, 0, 15, 23, 0, 0, Math.PI * 2); g.fillStyle = '#3A2A45'; g.fill(); g.restore(); });
  g.beginPath(); g.moveTo(-62, 316); g.quadraticCurveTo(0, 350, 62, 316); g.strokeStyle = '#3A2A45'; g.lineWidth = 8; g.stroke();
  // 目(大きくてキラキラ)
  mirror(() => {
    g.save(); g.translate(-112, -30);
    g.beginPath(); g.ellipse(0, 0, 50, 64, 0, 0, Math.PI * 2); g.fillStyle = '#2B2347'; g.fill();
    const ig = g.createLinearGradient(0, -50, 0, 56); ig.addColorStop(0, '#9A7BFF'); ig.addColorStop(0.55, '#4B3AD0'); ig.addColorStop(1, '#1B1650');
    g.beginPath(); g.ellipse(0, 4, 39, 52, 0, 0, Math.PI * 2); g.fillStyle = ig; g.fill();
    g.beginPath(); g.ellipse(0, 6, 16, 24, 0, 0, Math.PI * 2); g.fillStyle = '#120E33'; g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(14, -22, 14, 0, 7); g.fill(); g.beginPath(); g.arc(-14, 24, 7, 0, 7); g.fill();
    star4(g, -10, -4, 13, '#FFF6B0', 1, '#fff');
    g.beginPath(); g.moveTo(-58, -34); g.quadraticCurveTo(-8, -86, 56, -36); g.strokeStyle = '#2B2347'; g.lineWidth = 12; g.stroke();
    g.restore();
    g.beginPath(); g.ellipse(-138, 62, 38, 22, 0.15, 0, Math.PI * 2); g.fillStyle = 'rgba(255,110,160,.55)'; g.fill();
  });
  // 前髪
  mirror(() => { g.beginPath(); g.moveTo(-8, -306); g.bezierCurveTo(-90, -310, -150, -250, -130, -170); g.bezierCurveTo(-110, -210, -70, -218, -44, -200); g.bezierCurveTo(-52, -240, -34, -280, -8, -306); g.closePath(); g.fillStyle = mane; g.fill(); outline(8); });
  // 光の輪(高いレア度)
  if (rar === 'g1' || rar === 'g2'){
    g.save(); g.translate(0, -20);
    [[372, 10, 0.9], [410, 5, 0.5]].slice(0, rar === 'g1' ? 2 : 1).forEach(([r, w, a2]) => {
      const hg2 = g.createLinearGradient(-r, -r, r, r); hg2.addColorStop(0, '#FFF6B8'); hg2.addColorStop(0.5, '#FFC93A'); hg2.addColorStop(1, '#FFF6B8');
      g.globalAlpha = a2; g.shadowColor = '#FFE58A'; g.shadowBlur = 30; g.strokeStyle = hg2; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); });
    g.shadowBlur = 0; g.globalAlpha = 1;
    for (let i = 0; i < 12; i++){ const a3 = i * Math.PI / 6 + 0.26, r3 = 372; star4(g, Math.cos(a3) * r3, Math.sin(a3) * r3, i % 3 === 0 ? 26 : 14, '#FFF6C4', 0.95, '#FFE58A'); }
    g.restore();
  }
  if (rar === 'g1'){
    g.save(); g.translate(0, -352); g.scale(2.1, 2.1);
    g.beginPath(); g.moveTo(-30, 18); g.lineTo(-34, -14); g.lineTo(-17, 2); g.lineTo(0, -24); g.lineTo(17, 2); g.lineTo(34, -14); g.lineTo(30, 18); g.closePath();
    const cg = g.createLinearGradient(0, -24, 0, 20); cg.addColorStop(0, '#FFF4B0'); cg.addColorStop(1, '#E0A818'); g.fillStyle = cg; g.fill(); g.strokeStyle = '#8A5E0C'; g.lineWidth = 3; g.stroke();
    [[-34, -16], [0, -26], [34, -16]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fillStyle = '#FF5C8A'; g.fill(); g.stroke(); });
    g.restore();
  }
  g.restore();
}

function renderCard(life, name){
  const W = CARD_W, H = CARD_H, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const rar = rarityOf(life), R = RARITY[rar], rnd = mulberry32(strHash(name + life.headline + life.c.id));
  const col = (typeof COAT_COL !== 'undefined' && COAT_COL[life.coat]) || {c:'#B98563', d:'#8E5F44', l:'#F6DCC6', m:'#FF9DC0'};
  const GOLD = ['#FFF6C4', '#F1C94A', '#B88A12'];
  // --- 外枠(ホログラムの虹色) ---
  g.save(); rrect(g, 0, 0, W, H, 46); g.clip();
  let fg; if (g.createConicGradient){ fg = g.createConicGradient(0.5, W / 2, H / 2); R.foil.forEach((c, i) => fg.addColorStop(i / (R.foil.length - 1), c)); } else { fg = g.createLinearGradient(0, 0, W, H); R.foil.forEach((c, i) => fg.addColorStop(i / (R.foil.length - 1), c)); }
  g.fillStyle = fg; g.fillRect(0, 0, W, H);
  g.restore();
  // --- 内側 ---
  const IN = 24; g.save(); rrect(g, IN, IN, W - IN * 2, H - IN * 2, 30); g.clip();
  const bg = g.createLinearGradient(IN, IN, W - IN, H - IN); bg.addColorStop(0, R.bg[0]); bg.addColorStop(0.5, R.bg[1]); bg.addColorStop(1, R.bg[2]);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // 光線(サンバースト)
  const AX = 430, AY = 520;
  g.save(); g.translate(AX, AY); for (let i = 0; i < 30; i++){ g.rotate(Math.PI * 2 / 30); g.beginPath(); g.moveTo(0, 0); g.lineTo(-60, -1400); g.lineTo(60, -1400); g.closePath(); g.fillStyle = i % 2 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.02)'; g.fill(); } g.restore();
  const rg = g.createRadialGradient(AX, AY, 20, AX, AY, 560); rg.addColorStop(0, R.glow + 'cc'); rg.addColorStop(0.45, R.glow + '44'); rg.addColorStop(1, R.glow + '00'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // ボケ(丸い光)
  for (let i = 0; i < 26; i++){ const x = rnd() * W, y = rnd() * H, r = 10 + rnd() * 44; g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.1})`; g.fill(); }
  // --- 馬の顔 ---
  drawHorseFace(g, AX, AY + 36, 0.86, col, rar);
  // --- 右のパネル ---
  const PX = 860, PY = 64, PW = W - 64 - PX, PH = H - 128;
  g.save(); rrect(g, PX, PY, PW, PH, 26); g.fillStyle = 'rgba(8,6,36,.46)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,230,150,.75)'; g.stroke(); g.restore();
  // レア度プレート
  g.save(); const bx = PX + 28, by = PY + 26; rrect(g, bx, by, 170, 86, 16); const pg = g.createLinearGradient(bx, by, bx, by + 86); pg.addColorStop(0, GOLD[0]); pg.addColorStop(0.5, GOLD[1]); pg.addColorStop(1, GOLD[2]); g.fillStyle = pg; g.fill(); g.lineWidth = 4; g.strokeStyle = '#7A5410'; g.stroke();
  g.fillStyle = '#2A1850'; g.font = `800 ${R.label.length > 2 ? 52 : 62}px ${CARD_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(R.label, bx + 85, by + 46); g.restore();
  // 星
  for (let i = 0; i < 5; i++){ const x = PX + 238 + i * 58, y = PY + 70; g.save(); g.translate(x, y); g.beginPath(); for (let k = 0; k < 10; k++){ const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 11 : 26; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath();
    if (i < R.stars){ g.fillStyle = '#FFD84A'; g.shadowColor = '#FFE98A'; g.shadowBlur = 18; g.fill(); g.shadowBlur = 0; g.strokeStyle = '#9A6A10'; g.lineWidth = 3; g.stroke(); } else { g.strokeStyle = 'rgba(255,230,150,.45)'; g.lineWidth = 3; g.stroke(); } g.restore(); }
  // NEW
  g.save(); g.translate(PX + PW - 100, PY + 66); g.rotate(-0.1); rrect(g, -70, -30, 140, 60, 14); g.fillStyle = '#FF3E86'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.font = `800 38px ${CARD_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NEW!', 0, 3); g.restore();
  // 馬名
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,236,170,.9)'; g.font = `700 26px ${CARD_FONT}`; g.fillText('馬名', PX + 34, PY + 168);
  const nsz = fitFont(g, name, PW - 68, 112, 800, 52); g.font = `800 ${nsz}px ${CARD_FONT}`;
  const ny = PY + 168 + 30 + nsz * 0.88;
  g.save(); g.lineJoin = 'round'; g.shadowColor = R.glow; g.shadowBlur = 30; g.lineWidth = 14; g.strokeStyle = '#2A1850'; g.strokeText(name, PX + 34, ny); g.shadowBlur = 0;
  const tg = g.createLinearGradient(0, ny - nsz, 0, ny); tg.addColorStop(0, '#FFFFFF'); tg.addColorStop(0.35, '#FFF1A8'); tg.addColorStop(0.7, '#F5C23A'); tg.addColorStop(1, '#D9981A'); g.fillStyle = tg; g.fillText(name, PX + 34, ny); g.restore();
  const lw = Math.min(PW - 68, g.measureText(name).width + 20); const ug = g.createLinearGradient(PX + 34, 0, PX + 34 + lw, 0); ug.addColorStop(0, '#FFE98A'); ug.addColorStop(1, 'rgba(255,233,138,0)'); g.fillStyle = ug; g.fillRect(PX + 34, ny + 18, lw, 6);
  // 情報
  let y = ny + 86;
  g.fillStyle = '#F6EBCB'; const l1 = `${life.c.ja} ・ ${life.breed} ・ ${life.sex === 'M' ? '牡' : '牝'}${life.coat ? ' ・ ' + life.coat : ''}`; fitFont(g, l1, PW - 68, 32, 600, 22); g.fillText(l1, PX + 34, y);
  y += 78; const hs = fitFont(g, life.headline, PW - 68, 74, 800, 40); g.font = `800 ${hs}px ${CARD_FONT}`;
  g.save(); g.shadowColor = R.glow; g.shadowBlur = 18; g.fillStyle = '#FFE58A'; g.fillText(life.headline, PX + 34, y); g.restore();
  g.fillStyle = '#EDE3FF'; g.font = `500 30px ${CARD_FONT}`; y += 20;
  wrapLines(g, life.sub || '', PW - 68, 2).forEach(t => { y += 42; g.fillText(t, PX + 34, y); });
  const note = life.path === 'died' ? '最後まで走りきった一頭。' : life.path === 'lost' ? '足取りは消えても、確かに走った。' : (life.kids && life.kids.n > 0 ? `${life.path === 'brood' ? '産んだ仔' : '産駒'} ${life.kids.n}頭` + (life.kids.stakes ? `(重賞馬 ${life.kids.stakes}頭)` : '') : '');
  if (note){ y += 50; g.fillStyle = 'rgba(255,236,170,.92)'; g.font = `600 28px ${CARD_FONT}`; g.fillText(note, PX + 34, y); }
  // 確率のシール
  const sy = PY + PH - 196; g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(PX + 34, sy - 18, PW - 68, 2);
  g.fillStyle = '#F6EBCB'; g.font = `600 28px ${CARD_FONT}`; g.fillText('この馬生に出会う確率', PX + 34, sy + 22);
  const pt = `約${fmtOneIn(life.p)}分の1`; const ps = fitFont(g, pt, PW - 68, 96, 800, 56); g.font = `800 ${ps}px ${CARD_FONT}`;
  g.save(); g.lineJoin = 'round'; g.shadowColor = '#FF6BB5'; g.shadowBlur = 26; g.lineWidth = 12; g.strokeStyle = '#2A1850'; g.strokeText(pt, PX + 34, sy + 22 + ps * 0.92); g.shadowBlur = 0;
  const pg2 = g.createLinearGradient(0, sy + 22, 0, sy + 22 + ps); pg2.addColorStop(0, '#FFFFFF'); pg2.addColorStop(0.5, '#FFE48A'); pg2.addColorStop(1, '#FFB347'); g.fillStyle = pg2; g.fillText(pt, PX + 34, sy + 22 + ps * 0.92); g.restore();
  // フッター
  g.fillStyle = 'rgba(255,255,255,.62)'; g.font = `500 22px ${CARD_FONT}`; const d = new Date(); const no = String(strHash(name + life.p) % 9000000 + 1000000);
  g.fillText(`117万分の1 競走馬版  No.${no}  ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, PX + 34, PY + PH - 22);
  // --- キラキラ ---
  const cols = ['#FFFFFF', R.glow, '#FFB3E6', '#A8F0FF', '#FFF3A8'];
  const faceHit = (x, y2, k) => Math.abs(x - 430) < 175 * k && Math.abs(y2 - 570) < 300 * k;
  for (let i = 0; i < 80; i++){ const x = IN + 10 + rnd() * 800, y2 = IN + 10 + rnd() * (H - IN * 2 - 20), r = 8 + Math.pow(rnd(), 2.2) * 36; if (faceHit(x, y2, 1) && rnd() < 0.8) continue; star4(g, x, y2, r, cols[Math.floor(rnd() * cols.length)], 0.55 + rnd() * 0.45, R.glow); }
  for (let i = 0; i < 26; i++){ const x = PX + rnd() * PW, y2 = PY + rnd() * PH; star4(g, x, y2, 6 + rnd() * 14, cols[Math.floor(rnd() * cols.length)], 0.4 + rnd() * 0.5, R.glow); }
  const bigN = rar === 'g1' ? 5 : rar === 'g2' ? 4 : rar === 'g3' ? 3 : 2;
  for (let i = 0; i < bigN; i++){ let x = 70 + rnd() * 740, y2 = 70 + rnd() * 860; for (let k = 0; k < 20 && faceHit(x, y2, 1.25); k++){ x = 70 + rnd() * 740; y2 = 70 + rnd() * 860; } const r = 50 + rnd() * 36; star4(g, x, y2, r, '#FFFFFF', 0.95, R.glow); g.save(); g.globalAlpha = 0.5; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - r * 1.8, y2); g.lineTo(x + r * 1.8, y2); g.moveTo(x, y2 - r * 1.8); g.lineTo(x, y2 + r * 1.8); g.stroke(); g.restore(); }
  // --- ホログラムの反射(斜めの虹色)と光沢 ---
  g.save(); g.globalCompositeOperation = 'screen'; const hg = g.createLinearGradient(0, H, W, 0); ['rgba(255,80,160,.20)', 'rgba(255,220,100,.18)', 'rgba(110,255,190,.16)', 'rgba(100,200,255,.20)', 'rgba(180,140,255,.18)'].forEach((c, i, a) => hg.addColorStop(i / (a.length - 1), c)); g.fillStyle = hg; g.fillRect(0, 0, W, H); g.restore();
  g.save(); const gl = g.createLinearGradient(W * 0.18, 0, W * 0.5, H); gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.42, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,.22)'); gl.addColorStop(0.58, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H); g.restore();
  g.restore(); // 内側のクリップ
  // 縁のハイライト
  g.save(); rrect(g, IN, IN, W - IN * 2, H - IN * 2, 30); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke(); rrect(g, 4, 4, W - 8, H - 8, 44); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(); g.restore();
  return cv;
}

function genConfetti(n, target){
  const NS = 'http://www.w3.org/2000/svg', box = document.getElementById(target || 'confetti'); box.textContent = '';
  for (let i = 0; i < n; i++){
    const outer = document.createElementNS(NS, 'g'); outer.setAttribute('transform', `translate(${rnd(10,390)},-20)`);
    const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'conf'); g.setAttribute('fill', pick(CONF_COL));
    g.style.setProperty('--d', (Math.random() * 1.2).toFixed(2) + 's'); g.style.setProperty('--t', (1.6 + Math.random() * 1.2).toFixed(2) + 's'); g.style.setProperty('--r', rnd(0,360) + 'deg');
    let shape; if (Math.random() < 0.6){ shape = document.createElementNS(NS, 'rect'); const w = rnd(5,9); shape.setAttribute('width', w); shape.setAttribute('height', rnd(8,14)); shape.setAttribute('rx', 2); }
    else { shape = document.createElementNS(NS, 'circle'); shape.setAttribute('r', rnd(3,5)); }
    g.append(shape); outer.append(g); box.append(outer);
  }
}
function showCutin(cut, coat){
  const el = $('cutin'), svg = $('cutSvg'), col = COAT_COL[coat] || COAT_COL['鹿毛'];
  cutinActive = true;
  const use3d = cut.kind === '3d' && !reduce && G3D.init($('cut3d'));
  const silk = pick(SILKS);
  svg.style.setProperty('--coat', col.c); svg.style.setProperty('--coat-d', col.d); svg.style.setProperty('--coat-l', col.l); svg.style.setProperty('--mane', col.m);
  svg.style.setProperty('--silk', silk);
  $('bibNum').textContent = rnd(1, 18);
  genConfetti(CONF_N[cut.level], use3d ? 'confetti3' : 'confetti');
  $('cutinTitle').textContent = cut.title; $('cutinSub').textContent = cut.sub || '';
  const fin = use3d ? G3D.finTime(cut.level) : 1.7;
  el.style.setProperty('--off', (fin - 1.7).toFixed(2) + 's');
  el.className = 'cutin lv' + cut.level + (use3d ? ' is3d' : ''); el.setAttribute('aria-hidden', 'false');
  void el.offsetWidth; el.classList.add('play');
  if (use3d) G3D.start(cut.level, col, silk);
  clearTimeout(cutTimer); cutTimer = setTimeout(closeCutin, use3d ? Math.round((fin + 2.6) * 1000) : CUT_DUR[cut.level]);
  return fin;
}
let cutSfxTimers = [];
function closeCutin(){ clearTimeout(cutTimer); cutSfxTimers.forEach(clearTimeout); cutSfxTimers = []; G3D.stop(); const el = $('cutin'); el.className = 'cutin hidden'; el.setAttribute('aria-hidden', 'true'); cutinActive = false; }
function setCutButton(){ const b = document.getElementById('btnCut'); b.setAttribute('aria-pressed', cutinOn ? 'true' : 'false'); b.textContent = cutinOn ? '🎬 演出あり' : '🎬 演出なし'; }
let life = null, shown = 0, timer = null;
$('heroNum').textContent = fmtOneIn(1 / SUM) + '分の1';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function stopAuto(){ if (timer){ clearInterval(timer); timer = null; } $('btnAuto').setAttribute('aria-pressed','false'); $('btnAuto').textContent = 'オート'; }
function addStep(){
  const s = life.steps[shown++];
  const li = document.createElement('li');
  const major = s.hit || (s.kids && s.kids.length) || ['誕生','引退','最期','デビュー','初勝利','未勝利','未出走','海を渡る','育成','初めての仔','初年度産駒','記録なし','故障','復帰','転厩','へい死','行方不明','登録抹消','地方で勝利'].includes(s.head) || /勝/.test(s.head);
  li.className = 'step' + (s.hit ? ' hit' : '') + (major ? '' : ' minor');
  const age = document.createElement('div'); age.className = 'age';
  age.append(document.createTextNode(s.age + '歳'));
  const sm = document.createElement('small'); sm.textContent = s.season; age.append(sm);
  const body = document.createElement('div'); body.className = 'body';
  const head = document.createElement('div'); head.className = 'head'; head.textContent = s.head;
  const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = s.text;
  body.append(head, txt);
  (s.kids || []).forEach(k => { const kd = document.createElement('div'); kd.className = 'kid' + (k.hit ? ' hit' : ''); kd.textContent = k.text; body.append(kd); });
  li.append(age, body); $('timeline').append(li);
  li.scrollIntoView({block:'center', behavior: reduce ? 'auto' : 'smooth'});
  if (s.cut && cutinOn && !reduce){ const fin = showCutin(s.cut, life.coat); sfx.gallop(); cutSfxTimers = [setTimeout(() => sfx.gallop(), 1700), setTimeout(() => playFor(s), Math.round(fin * 1000))]; } else playFor(s);
  if (shown >= life.steps.length){ $('btnNext').textContent = '結果を見る'; stopAuto(); }
}
function begin(forceTB){
  stopAuto();
  life = newLife(forceTB === true, BEGIN_PARENT); BEGIN_PARENT = null; shown = 0;
  $('timeline').innerHTML = ''; $('result').classList.add('hidden'); $('start').classList.add('hidden');
  $('story').classList.remove('hidden'); $('bar').classList.remove('hidden');
  $('btnNext').textContent = '次へ'; window.scrollTo(0, 0); addStep();
}
function showResult(){
  stopAuto(); closeCutin();
  $('story').classList.add('hidden'); $('bar').classList.add('hidden');
  const r = $('result'); r.classList.remove('hidden'); r.innerHTML = '';
  const one = fmtOneIn(life.p);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="bib"><div class="in">
      <div class="lead">この馬生に出会う確率</div>
      <div class="num display">約${one}分の1</div>
      <div class="tail"></div>
    </div></div>
    <h2></h2><p class="sub muted"></p><ul class="chips"></ul>
    <div class="kidsum hidden"><h3>仔の成績</h3><p class="small kidtxt"></p><ul class="small kidlist"></ul></div>
    <div class="cardbox"><h3>馬名カード</h3>
      <div class="cardwrap"><img id="cardImg" alt="この馬の馬名カード" width="1600" height="1000"></div>
      <div class="namerow"><label for="horseName">馬名</label><input id="horseName" type="text" maxlength="9" autocomplete="off" spellcheck="false"><button class="btn btn-ghost" id="btnReName" type="button">名前を変える</button></div>
      <button class="btn btn-primary" id="btnCard" type="button">カードをダウンロード</button>
      <p class="small muted" id="cardNote">馬名は、自由に書き換えられます(9文字まで)。保存できないときは、カードを長押ししてください。</p>
    </div>
    <div class="post hidden" id="postBox">
      <button class="btn btn-primary" id="btnPost" type="button">みんなの結果に載せる</button>
      <p class="small" id="postNote">ニックネーム・馬名・出生国・結果・確率が、だれでも見られる「みんなの結果」に載ります。</p>
    </div>
    <div class="btns">
      <button class="btn btn-primary hidden" id="btnChild" type="button">この馬の仔として生まれる</button>
      <button class="btn btn-ippo" id="btnX" type="button">IppOでシェア</button>
      <button class="btn btn-ghost" id="btnShare" type="button">結果の文章をコピー・共有</button>
      <a class="btn btn-support" id="btnSupport" href="https://ofuse.me/640dc097" target="_blank" rel="noopener noreferrer">🐴 この作者を応援する(OFUSE)</a>
      <button class="btn btn-ghost" id="btnAgain" type="button">もう一度生まれる</button>
      <button class="btn btn-ghost" id="btnAgainTB" type="button">サラブレッドに生まれる</button>
      <button class="btn btn-ghost" id="btnAgainTen" type="button">10連馬生</button>
      <button class="btn btn-ghost hidden" id="btnBackTen" type="button">10連の一覧にもどる</button>
    </div>
    <p class="unofficial small">このゲームは、個人が作った<strong>非公式</strong>のファン作品です。JRA・地方競馬・IFHA・ISBCなどの競馬の団体や主催者、実在の馬・人物とは関係ありません。競走名や統計は、公開されている情報をもとにしています。</p>
    <details><summary>確率の根拠と、仮の数字</summary>
      <ul class="small">
        <li>出生国と、サラブレッドの割合: ISBC(国際サラブレッド血統書委員会)の2021〜2023年の産駒数、FAOの馬の飼養頭数から推定。「その他の馬」の産駒数は、飼養頭数の5%という仮定で概算(日本の乗用馬・重種馬の実数で検算済み)。</li>
        <li>ゲームでは、遊びやすくするため、サラブレッドに生まれる確率を3倍にしています。ここに出る確率は、統計どおりの値で計算しています。</li>
        <li>1勝は31.5%(JRA)。G1・G2・G3・リステッドの割合は、「その国の競走数÷競走馬の数」で計算(日本の2021年産世代の実績とほぼ一致)。</li>
        <li>競走名: IFHAのICSブック2026のパートI国の平地競走(G1が434、G2・G3・リステッドも全て)。日本のG1には地方Jpn1の12競走も含みます。</li>
        <li>輸出: アイルランド産の約6割は英国で走る(Weatherbysの発言)。英国産とNZ産の行き先の割合は仮の数字。</li>
        <li>引退後の行き先: 令和7年の日本の登録抹消(JRAと地方)の実数をもとにしています。中央の引退馬の約67%が地方競馬へ移り、地方の引退馬は、乗馬が約47%、へい死が約17%、「その他(行方不明など)」が約20%でした。日本以外の国は、同じ割合を仮に使っています。</li>
        <li>故障: 骨折、屈腱炎、跛行、鼻出血など、JRAの発表に出てくる種類を使っています。頻度と休養の長さは仮の数字です。</li>
        <li>乗用馬・ポニー・作業馬の進路の割合は、公的な統計がなく、すべて仮の数字。</li>
        <li>仔の成績: 親の成績が良いほど、仔が重賞を勝つ割合が高くなる仮の倍率(G1馬の仔は4倍など)で計算。仔の成績は、ここに出る確率には含めていません。</li>
        <li>障害競走、地方のJpn2・Jpn3は、まだ入っていません。</li>
      </ul>
    </details>`;
  r.append(wrap);
  r.querySelector('.tail').textContent = `${life.c.ja} ／ ${life.breed} ／ ${life.headline}`;
  r.querySelector('h2').textContent = life.headline;
  r.querySelector('.sub').textContent = life.sub;
  const ul = r.querySelector('.chips'); life.chips.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.append(li); });
  const K = life.kids;
  if (K && K.n > 0){
    const box = r.querySelector('.kidsum'); box.classList.remove('hidden');
    r.querySelector('.kidtxt').textContent = `${life.path === 'brood' ? '産んだ仔' : '産駒'}は${K.n}頭。勝ち上がり${K.win}頭、重賞馬${K.stakes}頭` + (K.g1 ? `(うちG1馬${K.g1}頭)` : '') + '。';
    const kl = r.querySelector('.kidlist'); K.notable.slice(0, 8).forEach(x => { const li = document.createElement('li'); li.textContent = x; kl.append(li); });
  }
  $('btnAgain').onclick = () => begin(false);
  $('btnAgainTB').onclick = () => begin(true);
  life.horseName = genHorseName(); $('horseName').value = life.horseName;
  drawCard();
  $('horseName').oninput = () => { clearTimeout(cardTimer); cardTimer = setTimeout(drawCard, 250); };
  $('btnReName').onclick = () => { $('horseName').value = genHorseName(); drawCard(); sfx.tick('春'); };
  $('btnCard').onclick = saveCard;
  $('btnShare').onclick = share;
  window.scrollTo(0, 0);
  const hl = life.headline; if (hl === 'G1馬') sfx.fanfare(3); else if (hl === 'G2馬' || hl === 'G3馬') sfx.fanfare(2); else if (hl === 'リステッド馬') sfx.fanfare(1); else sfx.result();
}

let cardTimer = null;
function canvasBlob(cv){ const d = cv.toDataURL('image/png'), bin = atob(d.split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type: 'image/png'}); }
async function drawCard(){
  if (!life) return;
  const nm = ($('horseName').value || '').trim().slice(0, 9) || life.horseName || 'ノーネーム';
  life.horseName = nm;
  try { if (document.fonts && document.fonts.load) await document.fonts.load('800 80px "Shippori Mincho"', nm + '馬名分の1'); } catch(e){}
  if (life.horseName !== nm) return;
  const cv = renderCard(life, nm); life.cardCanvas = cv;
  $('cardImg').src = cv.toDataURL('image/png');
}
async function saveCard(){
  const note = $('cardNote'); if (!life || !life.cardCanvas) return;
  const blob = canvasBlob(life.cardCanvas);
  const fname = ((life.horseName || 'horse').replace(/[\\/:*?"<>|]/g, '') || 'horse') + '_117man.png';
  let dl = null; try { dl = (window.claude && window.claude.use) ? await window.claude.use('downloads') : null; } catch(e){}
  if (dl){
    try { await dl.save({filename: fname, data: blob}); note.textContent = '保存しました。'; sfx.win(); return; }
    catch(e){ if (e && e.code === 'declined'){ note.textContent = '保存をキャンセルしました。'; return; } }
  }
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.append(a); a.click(); a.remove(); note.textContent = 'ダウンロードを試しました。保存できないときは、カードを長押ししてください。'; }
  catch(e){ note.textContent = 'この画面では保存できませんでした。カードを長押しして保存してください。'; }
}
async function share(){
  const t = `「${fmtOneIn(1/SUM)}分の1」競走馬版で、${life.c.ja}に生まれた${life.breed}の「${life.horseName || ''}」になった。結果は「${life.headline}」${life.sub ? '(' + life.sub + ')' : ''}。この馬生に出会う確率は約${fmtOneIn(life.p)}分の1。`;
  try { if (navigator.share){ await navigator.share({text:t}); return; } } catch(e){}
  try { await navigator.clipboard.writeText(t); $('btnShare').textContent = 'コピーしました'; return; } catch(e){}
  const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); $('btnShare').textContent = 'コピーしました'; } catch(e){ $('btnShare').textContent = 'コピーできませんでした'; }
  ta.remove();
}
$('btnBorn').onclick = () => begin(false);
$('btnBornTB').onclick = () => begin(true);
$('btnSfx').onclick = () => { soundOn = !soundOn; try { localStorage.setItem('sfx', soundOn ? 'on' : 'off'); } catch(e){} setSfxButton(); if (soundOn) sfx.tick('春'); };
setSfxButton();
$('btnCut').onclick = () => { cutinOn = !cutinOn; try { localStorage.setItem('cutin', cutinOn ? 'on' : 'off'); } catch(e){} setCutButton(); if (!cutinOn) closeCutin(); };
setCutButton();
$('cutin').onclick = closeCutin;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCutin(); });
$('btnNext').onclick = () => { stopAuto(); if (shown >= life.steps.length) showResult(); else addStep(); };
$('btnSkip').onclick = showResult;
$('btnAuto').onclick = () => {
  if (timer){ stopAuto(); return; }
  if (shown >= life.steps.length) return;
  $('btnAuto').setAttribute('aria-pressed','true'); $('btnAuto').textContent = '止める';
  timer = setInterval(() => { if (cutinActive) return; if (shown >= life.steps.length) stopAuto(); else addStep(); }, 1500);
};

/* ---------- みんなの結果(IppO 版: IppO のアカウントとデータベース) ---------- */
// 投稿者は IppO のアカウント (表示名・アイコン)。レア度と確率は、サーバーが同じ乱数の種から計算し直したものだけが載る
const NET = {docs:[], stats:null, tab:'new', posted:null, busy:false, ready:false};
const RK_ORDER = ['g1','g2','g3','l','n'];
const S = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
function cleanRow(x){
  if (!x || typeof x !== 'object') return null;
  const p = Number(x.p), t = Number(x.createdAt);
  if (!(p > 0 && p <= 1) || !isFinite(t)) return null;
  const u = (x.user && typeof x.user === 'object') ? x.user : {};
  const user = {id: Number(u.id) || 0, username: S(u.username, 30), displayName: S(u.displayName, 50) || S(u.username, 30) || 'ななし', avatar: (u.avatar && typeof u.avatar === 'object') ? u.avatar : null};
  return {id:x.id, user, mine: !!x.mine, n:S(x.horse, 9) || 'ノーネーム', c:S(x.country, 20), b:S(x.breed, 20), h:S(x.headline, 20), s:S(x.sub, 40), r: RK_ORDER.includes(x.rarity) ? x.rarity : 'n', p, t};
}
function ago(t){
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '時間前'; if (s < 86400 * 30) return Math.floor(s / 86400) + '日前';
  const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
async function loadBoard(){
  try {
    const d = await IPPO.api('/horse/plays?tab=' + (NET.tab === 'rare' ? 'rare' : 'new'));
    NET.docs = (Array.isArray(d.plays) ? d.plays : []).map(cleanRow).filter(Boolean); NET.stats = d.stats; NET.ready = true; renderBoard();
  } catch(e){ if (!NET.ready) boardOffline('みんなの結果を読み込めませんでした。少し待ってから、開き直してください。'); }
}
function renderBoard(){
  if (!NET.ready) return;
  const st = NET.stats || {}, num = v => Number.isFinite(+v) ? +v : 0;
  $('boardStat').textContent = num(st.total) ? `${num(st.players).toLocaleString('ja-JP')}人が、あわせて${num(st.total).toLocaleString('ja-JP')}頭の馬生を載せました。` : 'まだだれも結果を載せていません。';
  const tl = $('boardTally'); tl.innerHTML = '';
  if (num(st.total)) RK_ORDER.forEach(k => { const li = document.createElement('li'); li.textContent = `${RARITY[k].label} ${num(st[k]).toLocaleString('ja-JP')}`; tl.append(li); });
  const feed = $('feed'); feed.innerHTML = '';
  $('feedEmpty').classList.toggle('hidden', NET.docs.length > 0);
  NET.docs.forEach((x, i) => {
    const li = document.createElement('li');
    const rk = document.createElement('span'); rk.className = 'rk rk-' + x.r; rk.textContent = RARITY[x.r].label;
    const nm = document.createElement('span'); nm.className = 'nm';
    if (NET.tab === 'rare'){ const rn = document.createElement('span'); rn.className = 'rank'; rn.textContent = (i + 1) + '位'; nm.append(rn); }
    nm.append(document.createTextNode(x.n));
    const od = document.createElement('span'); od.className = 'odds'; od.textContent = `約${fmtOneIn(x.p)}分の1`;
    const meta = document.createElement('span'); meta.className = 'meta';
    meta.textContent = `${x.c}生まれの${x.b} ／ ` + (x.h === x.b ? (x.s || '') : `${x.h}${x.s ? '(' + x.s + ')' : ''}`) + ' ／ ';
    meta.append(IPPO.userLink(x.user, x.mine), document.createTextNode(' ・ ' + ago(x.t)));
    li.append(rk, nm, od, meta); feed.append(li);
  });
}
function setTab(t){ NET.tab = t; $('tabNew').setAttribute('aria-selected', t === 'new'); $('tabRare').setAttribute('aria-selected', t === 'rare'); loadBoard(); }
$('tabNew').onclick = () => setTab('new');
$('tabRare').onclick = () => setTab('rare');
function boardOffline(msg){ NET.ready = false; $('boardStat').textContent = msg; $('boardTally').innerHTML = ''; $('feed').innerHTML = ''; $('feedEmpty').classList.add('hidden'); }
function initNet(){
  loadBoard();
  setInterval(() => { if (!document.hidden) loadBoard(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadBoard(); });
}
function updatePostBox(){
  const box = document.getElementById('postBox'); if (!box) return;
  box.classList.remove('hidden');
  const btn = $('btnPost'), note = $('postNote');
  btn.disabled = false;
  if (!IPPO.user){ btn.textContent = 'ログインして載せる'; note.textContent = 'みんなの結果に載せるには、IppO へのログインが必要です。ログインしたあとに生まれた馬から載せられます。'; return; }
  if (!life.seedId){ btn.textContent = 'この馬は載せられません'; btn.disabled = true; note.textContent = 'ログインする前や、通信できないときに生まれた馬は、みんなの結果に載せられません。'; return; }
  if (NET.posted && NET.posted === life){ btn.textContent = '載せた内容を更新'; note.textContent = 'みんなの結果に載せました。馬名を変えたら、もう一度押すと書き換わります。'; }
  else { btn.textContent = 'みんなの結果に載せる'; note.textContent = `${IPPO.user.displayName}(@${IPPO.user.username})として、馬名・出生国・結果・確率が、IppO のみんなが見られる「みんなの結果」に載ります。`; }
}
async function postResult(){
  if (!life || NET.busy) return;
  if (!IPPO.user){ IPPO.login(); return; }
  if (!life.seedId) return;
  NET.busy = true; const btn = $('btnPost'); btn.disabled = true;
  const horse = (($('horseName').value || '').trim().slice(0, 9)) || life.horseName || 'ノーネーム';
  try {
    await IPPO.api('/horse/plays', {method:'POST', body:{seedId:life.seedId, horse, country:life.c.ja, breed:life.breed, headline:life.headline, sub:(life.sub || '').slice(0, 40), rarity:rarityOf(life), p:life.p}});
    NET.posted = life; sfx.win(); updatePostBox(); loadBoard();
  } catch(e){
    $('postNote').textContent = e.status === 429 ? '短い時間に載せすぎました。10分ほど待ってから、もう一度押してください。'
      : e.status === 401 ? 'ログインが切れました。ログインし直してください。'
      : (e.message && e.status ? e.message : '載せられませんでした。通信を確かめて、もう一度押してください。');
  } finally { NET.busy = false; btn.disabled = !life.seedId; }
}

// 結果画面にも「みんなの結果」を出す
const _showResult = showResult;
showResult = function(){
  _showResult();
  const r = $('result'), bd = $('board');
  r.querySelector('details').before(bd);
  $('btnPost').onclick = postResult;
  updatePostBox();
};
const _begin = begin;
begin = function(forceTB){ const bd = $('board'); $('start').append(bd); _begin(forceTB); };
$('btnBorn').onclick = () => begin(false);
$('btnBornTB').onclick = () => begin(true);
$('btnSkip').onclick = () => showResult();

/* ---------- 図鑑・実績(この端末に保存) ---------- */
const ZKEY = 'zukan_v1';
const BADGES = [
  ['first','🐣','はじめての馬生','一頭目として生まれる'],
  ['tb','🏇','サラブレッド','サラブレッドに生まれる'],
  ['abroad','✈️','海を渡る','生まれた国の外で走る'],
  ['debutwin','⚡','デビュー勝ち','デビュー戦を勝つ'],
  ['win','🥕','初勝利','1勝を挙げる'],
  ['listed','🎗️','リステッド勝ち','リステッド競走を勝つ'],
  ['grade','🏅','重賞ウイナー','G2かG3を勝つ'],
  ['g1','👑','初G1','G1を勝つ'],
  ['comeback','🩹','不屈の復帰','故障から復帰する'],
  ['transfer','🚚','地方へ転厩','中央から地方競馬へ移る'],
  ['localwin','🌾','地方で勝利','地方競馬で勝つ'],
  ['brood','🤱','母になる','繁殖牝馬になる'],
  ['stallion','🐎','種牡馬','種牡馬になる'],
  ['kidstakes','🌟','重賞馬の親','産駒が重賞を勝つ'],
  ['kidg1','🏆','G1馬の親','産駒がG1を勝つ'],
  ['gen3','🌳','三代の血統','仔として生まれて3代目になる'],
  ['gen5','🌲','五代の血統','5代目まで血をつなぐ'],
  ['pasture','🌿','功労馬','引退後、牧場でのんびり暮らす'],
  ['long','🎂','長生き','30歳を迎える'],
  ['banei','🛷','ばんえい競走馬','ばんえい競走で走る'],
  ['intl','🌐','国際大会','乗用馬として国際大会に出る'],
  ['man100','🔮','100万分の1','100万分の1より低い確率の馬生'],
  ['oku','💎','1億分の1','1億分の1より低い確率の馬生'],
  ['c5','🗺️','5か国','5つの国で生まれる'],
  ['c15','🌏','世界一周','15か国すべてで生まれる'],
  ['b10','🔟','10回目の馬生','10回生まれる'],
  ['b100','💯','100回目の馬生','100回生まれる'],
  ['ten','🎰','10連馬生','10連馬生をする'],
  ['tenssr','🎉','10連の大当たり','10連でSSR以上が出る']
];
const BADGE_BY = Object.fromEntries(BADGES.map(b => [b[0], b]));
function zLoad(){
  const z = {births:0, ten:0, cards:[], badges:{}, countries:[], maxGen:1, best:null, bestP:0};
  try {
    const v = JSON.parse(localStorage.getItem(ZKEY) || 'null');
    if (v && typeof v === 'object'){
      z.births = Number.isFinite(v.births) ? v.births : 0; z.ten = Number.isFinite(v.ten) ? v.ten : 0;
      z.cards = Array.isArray(v.cards) ? v.cards.filter(e => e && typeof e === 'object' && e.id && e.p > 0) : [];
      z.badges = (v.badges && typeof v.badges === 'object') ? v.badges : {};
      z.countries = Array.isArray(v.countries) ? v.countries.filter(x => typeof x === 'string') : [];
      z.maxGen = Number.isFinite(v.maxGen) ? v.maxGen : 1; z.best = RK_ORDER.includes(v.best) ? v.best : null; z.bestP = v.bestP > 0 ? v.bestP : 0;
    }
  } catch(e){}
  return z;
}
let Z = zLoad(), zSaveFailed = false;
function zSave(){ if (IPPO.zSave()) return; try { localStorage.setItem(ZKEY, JSON.stringify(Z)); zSaveFailed = false; } catch(e){ zSaveFailed = true; } }
function zTrim(){
  const MAX = 500; if (Z.cards.length <= MAX) return;
  const drop = Z.cards.map((e, i) => ({i, k: RK_ORDER.indexOf(e.r), t: e.t})).sort((a, b) => b.k - a.k || a.t - b.t).slice(0, Z.cards.length - MAX).map(x => x.i);
  const ds = new Set(drop); Z.cards = Z.cards.filter((e, i) => !ds.has(i));
}
function badgeKeysFor(l){
  const k = [], has = h => l.steps.some(s => s.head === h);
  k.push('first');
  if (l.isTB){
    k.push('tb');
    if (l.rc && l.rc.id !== l.c.id) k.push('abroad');
    if (l.steps.some(s => s.head === 'デビュー' && s.hit)) k.push('debutwin');
    if (['win','l','g3','g2','g1'].includes(l.tier)) k.push('win');
    if (l.tier === 'l') k.push('listed');
    if (l.tier === 'g3' || l.tier === 'g2') k.push('grade');
    if (l.tier === 'g1') k.push('g1');
    if (has('復帰')) k.push('comeback');
    if (l.transfer) k.push('transfer');
    if (has('地方で勝利')) k.push('localwin');
    if (l.path === 'brood') k.push('brood');
    if (l.path === 'stallion') k.push('stallion');
    if (l.path === 'pasture') k.push('pasture');
    if (l.kids && l.kids.stakes > 0) k.push('kidstakes');
    if (l.kids && l.kids.g1 > 0) k.push('kidg1');
    if ((l.gen || 1) >= 3) k.push('gen3');
    if ((l.gen || 1) >= 5) k.push('gen5');
  } else {
    if (l.sub === 'ばんえい競走馬') k.push('banei');
    if (l.sub === '国際大会') k.push('intl');
  }
  const last = l.steps[l.steps.length - 1]; if (last && last.age >= 30) k.push('long');
  if (l.p < 1e-6) k.push('man100');
  if (l.p < 1e-8) k.push('oku');
  if (Z.countries.length >= 5) k.push('c5');
  if (Z.countries.length >= COUNTRIES.length) k.push('c15');
  if (Z.births >= 10) k.push('b10');
  if (Z.births >= 100) k.push('b100');
  return k;
}
function giveBadges(keys){ const got = []; keys.forEach(x => { if (!Z.badges[x]){ Z.badges[x] = Date.now(); got.push(x); } }); return got; }
function recordLife(l){
  if (l.zid) return [];
  const r = rarityOf(l);
  l.zid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  Z.births++;
  Z.cards.unshift({id:l.zid, t:Date.now(), n:l.horseName || 'ノーネーム', c:l.c.id, cj:l.c.ja, b:l.breed, h:l.headline, s:l.sub || '', r, p:l.p, coat:l.coat, sex:l.sex, path:l.path || '', kn:(l.kids && l.kids.n) || 0, ks:(l.kids && l.kids.stakes) || 0, kg:(l.kids && l.kids.g1) || 0, gen:l.gen || 1});
  zTrim();
  if (!Z.countries.includes(l.c.id)) Z.countries.push(l.c.id);
  Z.maxGen = Math.max(Z.maxGen, l.gen || 1);
  if (!Z.best || RK_ORDER.indexOf(r) < RK_ORDER.indexOf(Z.best)) Z.best = r;
  if (!(Z.bestP > 0) || l.p < Z.bestP) Z.bestP = l.p;
  l.newBadges = giveBadges(badgeKeysFor(l));
  zSave();
  return l.newBadges;
}
let toastTimer = null;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 4200); }
function badgeToast(keys){ if (!keys.length) return; const names = keys.map(k => BADGE_BY[k][1] + ' ' + BADGE_BY[k][2]); toast('新しいバッジ: ' + names.slice(0, 4).join('、') + (names.length > 4 ? ` ほか${names.length - 4}個` : '')); }

/* ---------- 画面の切り替え ---------- */
const SECTIONS = ['start','story','result','ten','album'];
function curSection(){ return SECTIONS.find(id => !$(id).classList.contains('hidden')) || 'start'; }
function showSection(id){ stopAuto(); closeCutin(); SECTIONS.forEach(x => $(x).classList.toggle('hidden', x !== id)); $('bar').classList.add('hidden'); window.scrollTo(0, 0); }

/* ---------- 結果画面に足すもの(仔として生まれる・バッジ・血統) ---------- */
let BEGIN_PARENT = null, tenLives = null;
const _showResult2 = showResult;
showResult = function(){
  const kept = life.zid ? life.horseName : null;
  ['ten','album'].forEach(x => $(x).classList.add('hidden'));
  _showResult2();
  if (kept){ life.horseName = kept; $('horseName').value = kept; drawCard(); }
  else { recordLife(life); badgeToast(life.newBadges || []); }
  const r = $('result');
  if (life.gen > 1) r.querySelector('.bib .lead').textContent = '親が決まってから、この馬生に出会う確率';
  if (life.lineage && life.lineage.length){
    const lp = document.createElement('p'); lp.className = 'small muted lineage';
    lp.textContent = '血統: ' + life.lineage.map(a => `${a.sx === 'M' ? '父' : '母'}「${a.n}」(${a.h})`).join(' → ') + ' → この馬';
    r.querySelector('.chips').after(lp);
  }
  if (life.newBadges && life.newBadges.length){
    const nb = document.createElement('div'); nb.className = 'newbadges';
    const h = document.createElement('h3'); h.textContent = '🏅 この一生でとれたバッジ'; nb.append(h);
    const ul = document.createElement('ul'); life.newBadges.forEach(k => { const li = document.createElement('li'); li.textContent = `${BADGE_BY[k][2]}(${BADGE_BY[k][3]})`; ul.append(li); }); nb.append(ul);
    r.querySelector('.bib').after(nb);
  }
  const canChild = life.isTB && (life.path === 'brood' || life.path === 'stallion');
  const bc = $('btnChild'); bc.classList.toggle('hidden', !canChild);
  bc.textContent = life.path === 'brood' ? 'この馬の仔として生まれる(母の成績が受けつがれる)' : 'この馬の産駒として生まれる(父の成績が受けつがれる)';
  bc.onclick = () => { BEGIN_PARENT = life; begin(true); };
  $('btnAgainTen').onclick = () => tenPull(false);
  const bt = $('btnBackTen'); bt.classList.toggle('hidden', !(life.fromTen && tenLives)); bt.onclick = () => renderTen();
  bindResultX();
};
const _begin2 = begin;
begin = function(forceTB){ ['ten','album'].forEach(x => $(x).classList.add('hidden')); _begin2(forceTB); };
const _drawCard2 = drawCard;
drawCard = async function(){
  await _drawCard2();
  if (life && life.zid){ const e = Z.cards.find(x => x.id === life.zid); if (e && e.n !== life.horseName){ e.n = life.horseName; zSave(); } }
};

/* ---------- 10連馬生 ---------- */
function tenPull(forceTB){
  const lives = [];
  for (let i = 0; i < 10; i++){ const l = newLife(forceTB === true, null); l.horseName = genHorseName(); l.fromTen = true; lives.push(l); }
  const got = [];
  lives.forEach(l => recordLife(l).forEach(k => got.push(k)));
  Z.ten++;
  const extra = ['ten']; if (lives.some(l => ['g1','g2'].includes(rarityOf(l)))) extra.push('tenssr');
  got.push(...giveBadges(extra)); zSave();
  tenLives = {lives, tb: forceTB === true};
  renderTen();
  badgeToast(got);
  const best = lives.reduce((a, l) => RK_ORDER.indexOf(rarityOf(l)) < RK_ORDER.indexOf(rarityOf(a)) ? l : a, lives[0]);
  const br = rarityOf(best);
  if (br === 'g1') sfx.fanfare(3); else if (br === 'g2' || br === 'g3') sfx.fanfare(2); else if (br === 'l') sfx.fanfare(1); else sfx.result();
}
function renderTen(){
  if (!tenLives) return;
  showSection('ten');
  const lives = tenLives.lives;
  let bi = 0; lives.forEach((l, i) => { const a = RK_ORDER.indexOf(rarityOf(l)), b = RK_ORDER.indexOf(rarityOf(lives[bi])); if (a < b || (a === b && l.p < lives[bi].p)) bi = i; });
  const best = lives[bi];
  $('tenTitle').textContent = `最高は${RARITY[rarityOf(best)].label}「${best.horseName}」`;
  const tb = lives.filter(l => l.isTB).length, win = lives.filter(l => ['win','l','g3','g2','g1'].includes(l.tier)).length, st = lives.filter(l => ['g3','g2','g1'].includes(l.tier)).length;
  $('tenSum').textContent = `サラブレッド${tb}頭 ／ 勝ち上がり${win}頭 ／ 重賞馬${st}頭。10頭すべて図鑑に入りました。`;
  const ol = $('tenList'); ol.innerHTML = '';
  lives.forEach((l, i) => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
    if (i === bi) b.className = 'best';
    const r = rarityOf(l);
    const rk = document.createElement('span'); rk.className = 'rk rk-' + r; rk.textContent = RARITY[r].label;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = l.horseName;
    if (i === bi){ const t = document.createElement('span'); t.className = 'tag'; t.textContent = '最高'; nm.append(t); }
    const od = document.createElement('span'); od.className = 'odds'; od.textContent = `約${fmtOneIn(l.p)}分の1`;
    const mt = document.createElement('span'); mt.className = 'meta'; mt.textContent = `${l.c.ja}生まれの${l.breed} ／ ` + (l.headline === l.breed ? (l.sub || '') : `${l.headline}${l.sub ? '(' + l.sub + ')' : ''}`);
    b.append(rk, nm, od, mt);
    b.onclick = () => { life = l; shown = l.steps.length; showResult(); };
    li.append(b); ol.append(li);
  });
}
$('btnTen').onclick = () => tenPull(false);
$('btnTenAgain').onclick = () => tenPull(tenLives ? tenLives.tb : false);
$('btnTenTB').onclick = () => tenPull(true);
$('btnTenTop').onclick = () => { $('start').append($('board')); showSection('start'); };

/* ---------- 図鑑の画面 ---------- */
let albumPrev = 'start', zFilterBy = 'all', zSortRare = false;
function cardLife(e){ return {c:{id:e.c, ja:e.cj}, breed:e.b, coat:e.coat, headline:e.h, sub:e.s, p:e.p, path:e.path, sex:e.sex, kids:{n:e.kn || 0, stakes:e.ks || 0}}; }
function renderAlbum(){
  const st = $('zStats'); st.innerHTML = '';
  const kinds = new Set(Z.cards.map(e => e.b + '|' + e.h)).size;
  [['生まれた回数', Z.births.toLocaleString('ja-JP') + '回'], ['最高レア度', Z.best ? RARITY[Z.best].label : '—'], ['最も低い確率', Z.bestP > 0 ? fmtOneIn(Z.bestP) + '分の1' : '—'],
   ['出生国', `${Z.countries.length} / ${COUNTRIES.length}`], ['最長の血統', Z.maxGen + '代'], ['10連馬生', Z.ten + '回']].forEach(([k, v]) => {
    const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; d.append(dt, dd); st.append(d);
  });
  const gotN = BADGES.filter(b => Z.badges[b[0]]).length;
  $('zBadgeCount').textContent = `${gotN} / ${BADGES.length}`;
  const bl = $('zBadges'); bl.innerHTML = '';
  BADGES.forEach(([k, ic, name, hint]) => {
    const got = !!Z.badges[k];
    const li = document.createElement('li'); if (got) li.className = 'got';
    const i = document.createElement('span'); i.className = 'ic'; i.textContent = got ? ic : '？'; i.setAttribute('aria-hidden', 'true');
    const d = document.createElement('div'), b = document.createElement('b'), s = document.createElement('small');
    b.textContent = got ? name : '？？？'; s.textContent = hint + (got ? '' : '(未獲得)');
    d.append(b, s); li.append(i, d); bl.append(li);
  });
  const fl = $('zFilter'); fl.innerHTML = '';
  [['all','すべて']].concat(RK_ORDER.map(r => [r, RARITY[r].label])).forEach(([k, lab]) => {
    const n = k === 'all' ? Z.cards.length : Z.cards.filter(e => e.r === k).length;
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', zFilterBy === k);
    b.textContent = `${lab} ${n}`; b.onclick = () => { zFilterBy = k; renderAlbum(); }; fl.append(b);
  });
  const sb = $('zSort'); sb.textContent = zSortRare ? 'レア順' : '新しい順'; sb.setAttribute('aria-pressed', zSortRare);
  let list = Z.cards.filter(e => zFilterBy === 'all' || e.r === zFilterBy);
  if (zSortRare) list = list.slice().sort((a, b) => RK_ORDER.indexOf(a.r) - RK_ORDER.indexOf(b.r) || a.p - b.p);
  const gr = $('zGrid'); gr.innerHTML = '';
  $('zEmpty').classList.toggle('hidden', list.length > 0);
  list.slice(0, 200).forEach(e => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
    const R = RARITY[e.r] || RARITY.n; b.style.background = `linear-gradient(150deg, ${R.bg[0]}, ${R.bg[1]} 60%, ${R.bg[2]})`;
    const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = '★'.repeat(R.stars) + ' ' + R.label;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = e.n;
    const hd = document.createElement('span'); hd.className = 'hd'; hd.textContent = `${e.cj}・${e.h}${(e.gen || 1) > 1 ? '・' + e.gen + '代目' : ''}`;
    const od = document.createElement('span'); od.className = 'od'; od.textContent = `約${fmtOneIn(e.p)}分の1`;
    b.append(lb, nm, hd, od); b.setAttribute('aria-label', `${R.label} ${e.n} ${e.h} のカードを見る`);
    b.onclick = () => openViewer(e);
    li.append(b); gr.append(li);
  });
  $('zFoot').textContent = (zSaveFailed ? 'この画面では端末に保存できないため、ページを閉じると図鑑は消えます。' : '図鑑は、この端末のブラウザに保存されます。ほかの端末やブラウザには引き継がれません。') + 'カードは500枚まで残り、超えるとレア度の低い古いカードから消えます。' + (list.length > 200 ? '一覧には200枚まで表示しています。' : '');
}
function openAlbum(){ const c = curSection(); if (c !== 'album') albumPrev = c; showSection('album'); renderAlbum(); }
$('btnZukan').onclick = openAlbum;
$('zSort').onclick = () => { zSortRare = !zSortRare; renderAlbum(); };
$('btnAlbumBack').onclick = () => {
  if (albumPrev === 'story' && life){ SECTIONS.forEach(x => $(x).classList.toggle('hidden', x !== 'story')); $('bar').classList.remove('hidden'); }
  else if (albumPrev === 'ten' && tenLives) renderTen();
  else showSection(albumPrev === 'album' ? 'start' : albumPrev);
};
let viewerEntry = null, viewerCanvas = null, viewerFocus = null;
async function openViewer(e){
  viewerEntry = e; viewerFocus = document.activeElement;
  $('vTitle').textContent = e.n; $('vNote').textContent = '';
  $('vMeta').textContent = `${e.cj}生まれの${e.b} ／ ${e.h}${e.s ? '(' + e.s + ')' : ''} ／ 約${fmtOneIn(e.p)}分の1 ／ ${new Date(e.t).toLocaleDateString('ja-JP')}`;
  $('viewer').classList.remove('hidden'); $('vClose').focus();
  try { if (document.fonts && document.fonts.load) await document.fonts.load('800 80px "Shippori Mincho"', e.n + '馬名分の1'); } catch(err){}
  if (viewerEntry !== e) return;
  viewerCanvas = renderCard(cardLife(e), e.n); $('vImg').src = viewerCanvas.toDataURL('image/png');
}
function closeViewer(){ $('viewer').classList.add('hidden'); viewerEntry = null; if (viewerFocus && viewerFocus.focus) viewerFocus.focus(); }
$('vClose').onclick = closeViewer;
$('viewer').onclick = ev => { if (ev.target === $('viewer')) closeViewer(); };
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('viewer').classList.contains('hidden')) closeViewer(); });
$('vSave').onclick = async () => {
  if (!viewerCanvas || !viewerEntry) return;
  const note = $('vNote'), blob = canvasBlob(viewerCanvas);
  const fname = ((viewerEntry.n || 'horse').replace(/[\\/:*?"<>|]/g, '') || 'horse') + '_117man.png';
  let dl = null; try { dl = (window.claude && window.claude.use) ? await window.claude.use('downloads') : null; } catch(err){}
  if (dl){ try { await dl.save({filename: fname, data: blob}); note.textContent = '保存しました。'; return; } catch(err){ if (err && err.code === 'declined'){ note.textContent = '保存をキャンセルしました。'; return; } } }
  note.textContent = 'この画面では保存できませんでした。カードを長押しして保存してください。';
};


/* ---------- IppOでシェア (文章は元の X 用と同じものを使う) ---------- */
const X_TAGS = '\n#117万分の1 #競走馬版';
function setX(id, fn){ const a = $(id); if (!a) return; a.onclick = () => IPPO.share(id, fn); }
function lifeXText(l){
  const r = RARITY[rarityOf(l)].label, gen = (l.gen || 1) > 1 ? `(${l.gen}代目)` : '';
  const body = l.isTB ? `${l.c.ja}生まれのサラブレッドで、結果は「${l.headline}」。` + (/「/.test(l.sub || '') ? `\n${l.sub}` : '')
                      : `${l.c.ja}生まれの${l.breed}で、「${l.sub || l.headline}」の一生。`;
  return `【${r}】${l.horseName || 'ノーネーム'}${gen}\n${body}\nこの馬生に出会う確率は約${fmtOneIn(l.p)}分の1`;
}
function bindResultX(){ setX('btnX', () => { const nm = ($('horseName').value || '').trim().slice(0, 9); if (nm) life.horseName = nm; return lifeXText(life); }); }
setX('btnTenX', () => {
  const L = tenLives ? tenLives.lives : []; const cnt = {}; L.forEach(l => { const r = rarityOf(l); cnt[r] = (cnt[r] || 0) + 1; });
  let best = L[0]; L.forEach(l => { if (RK_ORDER.indexOf(rarityOf(l)) < RK_ORDER.indexOf(rarityOf(best)) || (rarityOf(l) === rarityOf(best) && l.p < best.p)) best = l; });
  const tally = RK_ORDER.map(k => `${RARITY[k].label}${cnt[k] || 0}`).join(' ');
  return `10連馬生の結果\n${tally}\n最高は【${RARITY[rarityOf(best)].label}】${best.horseName}(${best.c.ja}・${best.headline})、約${fmtOneIn(best.p)}分の1`;
});
setX('btnAlbumX', () => {
  const got = BADGES.filter(b => Z.badges[b[0]]).length;
  return `これまで${Z.births}回生まれて、バッジは${got}/${BADGES.length}個。\n最高レア度は${Z.best ? RARITY[Z.best].label : 'まだなし'}、最も低い確率は${Z.bestP > 0 ? '約' + fmtOneIn(Z.bestP) + '分の1' : 'まだなし'}。出生国は${Z.countries.length}/${COUNTRIES.length}か国`;
});

IPPO.start();
