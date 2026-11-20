// =====================================================================
// シティバトル (ブラウザ側): three.js で街を描き、三人称で動いて撃つ
//   ・自分の動きはこの端末で計算してサーバーに送る (サーバーが速さをたしかめる)
//   ・弾は「画面のまん中」をねらう。当たったかどうかはサーバーが決める
//   ・パソコン: WASD・マウス (クリックで視点を固定)・クリックで撃つ・Space ジャンプ・Shift ダッシュ・R リロード
//   ・スマホ: 左のスティックで移動、右側をなぞって視点、うつ・ジャンプ・リロードのボタン
// =====================================================================
import * as THREE from './vendor/three.module.min.js';
import { createGraphics } from './world.js?v=5';
const A = window.ArenaMap, map = A.build();
const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches; // 指で操作する端末だけ (タッチもできるパソコンはマウス操作)
if (isTouch) document.body.classList.add('is-touch');
$('#howto').innerHTML = isTouch
  ? '左のスティックで移動・右側をなぞって見回す<br>「うつ」を押しているあいだ連射・近くの相手は「なぐる」'
  : 'WASD で移動・マウスで見回す・クリックで撃つ・F (右クリック) でなぐる<br>Space ジャンプ・Shift ダッシュ・R リロード・Esc で一時停止';

// ---------- 画面・街・キャラクター (world.js) ----------
const GFX = createGraphics({ canvasEl: $('#c'), isTouch, map, A });
const { scene, camera } = GFX;
addEventListener('resize', GFX.resize); GFX.resize();
const seedOf = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const makeChar = (color, name, isMe) => GFX.makeChar(color, name, isMe, seedOf(name));
// 画質 (はじめの画面で変えられる。変えると読みなおす)
{ const QN = { low: '低', medium: '中', high: '高' }, b = document.createElement('button'); b.className = 'btn ghost'; b.id = 'gfx'; b.style.marginTop = '10px';
  b.textContent = `⚙️ 画質: ${QN[GFX.quality]} (タップで変える)`;
  b.onclick = () => { const list = GFX.qualities, next = list[(list.indexOf(GFX.quality) + 1) % list.length]; GFX.setQuality(next); location.reload(); };
  $('#center > div').append(document.createElement('br'), b); }

// ---------- 状態 ----------
const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: -0.1, hp: 100, alive: false, protect: false, ammo: 15, reloading: 0, onGround: true };
const MAG = 15, RELOAD_MS = 1400;
let you = null, ws = null, playing = false, lastSend = 0, lastShot = 0, rules = { fireMs: 130 };
const others = new Map(); // sid → { name, color, bot, model, tx,ty,tz, yaw, alive, kills, deaths }
const scores = new Map();
let myModel = null;
function addPlayer(p) {
  scores.set(p.sid, { name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, bot: p.bot });
  if (p.sid === you) { if (!myModel) myModel = makeChar(p.color, p.name, true); return; }
  if (others.has(p.sid)) return;
  others.set(p.sid, { ...p, model: makeChar(p.color, p.name, false), tx: 0, ty: 0, tz: 0, yaw: 0, alive: true, seen: false });
}
function removePlayer(sid) { const o = others.get(sid); if (o) { scene.remove(o.model.g); others.delete(sid); } scores.delete(sid); renderScore(); }

// ---------- 入力 ----------
const keys = new Set(); let firing = false;
const move = { x: 0, y: 0, run: false };
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyF') doPunch(); if (e.code === 'KeyR') reload(); if (e.code === 'Space') { e.preventDefault(); jump(); } });
addEventListener('keyup', (e) => keys.delete(e.code));
const canvas = $('#c');
canvas.addEventListener('mousedown', (e) => { if (!playing) return; if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; } if (e.button === 0) firing = true; if (e.button === 2) doPunch(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', () => { firing = false; });
addEventListener('mousemove', (e) => { if (document.pointerLockElement !== canvas) return; me.yaw -= e.movementX * 0.0023; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - e.movementY * 0.0023)); });
document.addEventListener('pointerlockchange', () => { if (!isTouch && playing && document.pointerLockElement !== canvas) { firing = false; showCenter('一時停止中', 'つづける'); } });
// スマホ: スティック・視点・ボタン
if (isTouch) {
  const stick = $('#stick'), knob = stick.firstElementChild; let sid = null;
  const sm = (t) => { const r = stick.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), L = Math.hypot(dx, dy), max = r.width / 2 - 10, k = L > max ? max / L : 1;
    knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; move.x = (dx * k) / max; move.y = (dy * k) / max; move.run = L > max * 0.92; };
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; sm(t); }, { passive: false });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) sm(t); }, { passive: false });
  const send0 = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; move.x = move.y = 0; move.run = false; knob.style.transform = ''; } };
  stick.addEventListener('touchend', send0); stick.addEventListener('touchcancel', send0);
  // 視点: スティックとボタン以外の場所をなぞる
  const look = new Map();
  canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) look.set(t.identifier, [t.clientX, t.clientY]); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { const p = look.get(t.identifier); if (!p) continue; me.yaw -= (t.clientX - p[0]) * 0.0052; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - (t.clientY - p[1]) * 0.0042)); look.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: false });
  const lend = (e) => { for (const t of e.changedTouches) look.delete(t.identifier); };
  canvas.addEventListener('touchend', lend); canvas.addEventListener('touchcancel', lend);
  // うつ: 押しながらなぞると、視点も動かせる
  const fire = $('#fire'); let fid = null, fp = null;
  fire.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; fid = t.identifier; fp = [t.clientX, t.clientY]; firing = true; }, { passive: false });
  fire.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === fid) { me.yaw -= (t.clientX - fp[0]) * 0.0045; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - (t.clientY - fp[1]) * 0.0036)); fp = [t.clientX, t.clientY]; } }, { passive: false });
  const fend = (e) => { for (const t of e.changedTouches) if (t.identifier === fid) { fid = null; firing = false; } };
  fire.addEventListener('touchend', fend); fire.addEventListener('touchcancel', fend);
  $('#jump').addEventListener('touchstart', (e) => { e.preventDefault(); jump(); }, { passive: false });
  $('#reload').addEventListener('touchstart', (e) => { e.preventDefault(); reload(); }, { passive: false });
  $('#punch').addEventListener('touchstart', (e) => { e.preventDefault(); doPunch(); }, { passive: false });
}
// なぐる: 当たったかどうかはサーバーが決める。ここではうでをふる
let lastPunch = 0;
function doPunch() {
  const now = performance.now();
  if (!playing || !me.alive || now - lastPunch < (rules.punch?.ms || 600)) return;
  lastPunch = now; me.protect = false; swing(myModel); send({ t: 'punch' });
}
function swing(model) { if (model) model.swing = performance.now(); }
function jump() { if (playing && me.alive && me.onGround) { me.vy = 7; me.onGround = false; } }
function reload() { if (me.reloading || me.ammo === MAG || !me.alive) return; me.reloading = performance.now() + RELOAD_MS; updHud(); }

// ---------- HUD ----------
function updHud() {
  $('#hptxt').textContent = `HP ${Math.max(0, me.hp)}`;
  $('#hpbar i').style.width = Math.max(0, me.hp) + '%'; $('#hpbar').classList.toggle('low', me.hp <= 30);
  $('#ammotxt').textContent = me.reloading ? 'リロード中' : String(me.ammo); $('#ammosub').textContent = `/ ${MAG}`;
  $('#prot').style.display = me.protect && me.alive ? 'block' : 'none';
}
function renderScore() {
  const list = [...scores.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths).slice(0, 6);
  const el = $('#score'); el.textContent = '';
  const h = document.createElement('b'); h.textContent = `🏆 キル数 (${scores.size}人)`; el.append(h);
  for (const [sid, s] of list) { const d = document.createElement('div'); if (sid === you) d.className = 'you'; const n = document.createElement('span'); n.textContent = (s.bot ? '🤖 ' : '') + s.name; const k = document.createElement('span'); k.textContent = `${s.kills} / ${s.deaths}`; d.append(n, k); el.append(d); }
}
function feed(text, mine) { const d = document.createElement('div'); d.textContent = text; if (mine) d.className = 'me'; const f = $('#feed'); f.prepend(d); while (f.children.length > 5) f.lastChild.remove(); setTimeout(() => d.remove(), 6000); }
function flashDamage() { const d = $('#dmg'); d.style.opacity = 1; clearTimeout(flashDamage.t); flashDamage.t = setTimeout(() => { d.style.opacity = 0; }, 180); }
function hitMarker(head) { const h = $('#hitmark'); h.classList.remove('on', 'head'); void h.offsetWidth; h.classList.add('on'); if (head) h.classList.add('head'); }
function showCenter(title, btn, sub = '') { playing = false; $('#center').classList.remove('hide'); $('#center h1').textContent = title; $('#status').textContent = sub; const b = $('#start'); b.textContent = btn; b.disabled = false; }

// ---------- 弾の見た目 ----------
const fx = [];
function tracer(o, e, color = '#ffe066') {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, fog: false }));
  scene.add(line); fx.push({ o: line, until: performance.now() + 110, fade: true });
}
function burst(p, color = '#ffffff', n = 8) { // 当たったときの星 (血は出さない)
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(i % 2 ? color : '#ffd43b').multiplyScalar(4), transparent: true }));
    m.position.set(...p); scene.add(m);
    fx.push({ o: m, until: performance.now() + 380, v: [(Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6], fade: true });
  }
}
function stepFx(dt) {
  const now = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    if (now >= f.until) { scene.remove(f.o); f.o.geometry?.dispose(); f.o.material?.dispose(); fx.splice(i, 1); continue; }
    if (f.v) { f.o.position.x += f.v[0] * dt; f.o.position.y += f.v[1] * dt; f.o.position.z += f.v[2] * dt; f.v[1] -= 12 * dt; }
    if (f.fade && f.o.material) f.o.material.opacity = Math.max(0, (f.until - now) / 380);
  }
}

// ---------- 撃つ ----------
const ray = new THREE.Vector3();
function tryShoot(now) {
  if (!me.alive || me.reloading) return;
  if (now - lastShot < rules.fireMs) return;
  if (me.ammo <= 0) { reload(); return; }
  lastShot = now; me.ammo--; if (!me.ammo) reload();
  // 画面のまん中のねらい: カメラから前へ。壁かプレイヤーに当たるところ
  camera.getWorldDirection(ray);
  const co = [camera.position.x, camera.position.y, camera.position.z], cd = [ray.x, ray.y, ray.z];
  let t = A.rayWorld(map, co, cd, 120);
  for (const o of others.values()) { if (!o.alive) continue; const r = A.rayPlayer(co, cd, { x: o.model.g.position.x, y: o.model.g.position.y, z: o.model.g.position.z }); if (r && r.t < t) t = r.t; }
  const aim = [co[0] + cd[0] * t, co[1] + cd[1] * t, co[2] + cd[2] * t];
  // 撃つのは自分のブラスターの先から
  const tip = new THREE.Vector3(); myModel.tip.getWorldPosition(tip);
  const o = [tip.x, tip.y, tip.z], d = [aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]], L = Math.hypot(...d) || 1;
  const dn = d.map((v) => v / L);
  const wall = A.rayWorld(map, o, dn, 120);
  tracer(o, [o[0] + dn[0] * Math.min(wall, L + 40), o[1] + dn[1] * Math.min(wall, L + 40), o[2] + dn[2] * Math.min(wall, L + 40)]);
  muzzle(myModel);
  me.protect = false;
  send({ t: 'shoot', o, d: dn });
  updHud();
}
function muzzle(model) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(8), transparent: true })); model.tip.getWorldPosition(m.position); scene.add(m); fx.push({ o: m, until: performance.now() + 60, fade: true }); }

// ---------- 通信 ----------
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  $('#status').textContent = 'つないでいます…';
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ab`);
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'welcome') {
      you = m.you; rules = m.rules || rules;
      for (const p of m.players) addPlayer(p);
      Object.assign(me, { x: m.me.x, y: m.me.y, z: m.me.z, vy: 0, yaw: m.me.yaw, pitch: -0.1, hp: 100, alive: true, protect: true, ammo: MAG, reloading: 0 }); updHud();
      renderScore();
      const b = $('#start'); b.disabled = false; b.textContent = 'はじめる！'; $('#status').textContent = `いま ${m.players.filter((p) => !p.bot).length} 人が遊んでいます`;
    } else if (m.t === 'full') { $('#status').textContent = '満員です。少し待ってからもう一度どうぞ'; }
    else if (m.t === 'join') { addPlayer(m.p); renderScore(); if (m.p.sid !== you) feed(`${m.p.bot ? '🤖 ' : ''}${m.p.name} が来た`); }
    else if (m.t === 'leave') { const s = scores.get(m.sid); if (s) feed(`${s.name} が帰った`); removePlayer(m.sid); }
    else if (m.t === 'spawn') {
      if (m.sid === you) { Object.assign(me, { x: m.x, y: m.y, z: m.z, vy: 0, yaw: m.yaw, pitch: -0.1, hp: 100, alive: true, protect: true, ammo: MAG, reloading: 0 }); $('#dead').style.display = 'none'; if (myModel) { myModel.g.visible = true; myModel.g.rotation.x = 0; } updHud(); }
      else { const o = others.get(m.sid); if (o) { Object.assign(o, { tx: m.x, ty: m.y, tz: m.z, alive: true }); o.model.g.position.set(m.x, m.y, m.z); o.cy = m.y; o.model.g.visible = true; o.model.g.rotation.x = 0; } }
    } else if (m.t === 's') {
      for (const [sid, x, y, z, yaw, pitch, hp, alive, prot] of m.p) {
        if (sid === you) { me.hp = hp; me.protect = !!prot; if (!alive && me.alive) me.alive = false; continue; }
        const o = others.get(sid); if (!o) continue;
        Object.assign(o, { tx: x, ty: y, tz: z, yaw, alive: !!alive, prot: !!prot });
        if (!o.seen) { o.model.g.position.set(x, y, z); o.cy = y; o.seen = true; }
      }
      updHud();
    } else if (m.t === 'punch') {
      if (m.sid !== you) swing(others.get(m.sid)?.model);
    } else if (m.t === 'shot') {
      if (m.sid === you) return;
      const o = others.get(m.sid); tracer(m.o, m.e, '#ff8787'); if (o) muzzle(o.model);
    } else if (m.t === 'hit') {
      const target = m.to === you ? null : others.get(m.to);
      if (target) burst([target.model.g.position.x, target.model.g.position.y + (m.head ? 1.6 : 1.1), target.model.g.position.z], m.melee ? '#ff922b' : m.head ? '#ffd43b' : '#ffffff', m.melee ? 16 : m.head ? 12 : 7);
      if (m.melee && target && m.kb) { target.model.g.position.x += m.kb[0] * 0.08; target.model.g.position.z += m.kb[1] * 0.08; }
      if (m.melee && m.to === you && m.kb) { me.kx = m.kb[0]; me.kz = m.kb[1]; me.vy = Math.max(me.vy, 3.5); me.onGround = false; }
      if (m.sid === you) hitMarker(m.head);
      if (m.to === you) { me.hp = m.hp; flashDamage(); updHud(); }
    } else if (m.t === 'kill') {
      for (const s of m.score) { const r = scores.get(s.sid); if (r) Object.assign(r, { kills: s.kills, deaths: s.deaths }); }
      renderScore();
      const k = scores.get(m.killer)?.name || '?', v = scores.get(m.victim)?.name || '?';
      feed(`${k} ${m.melee ? '👊' : m.head ? '🎯' : '💥'} ${v}`, m.killer === you || m.victim === you);
      if (m.victim === you) { me.alive = false; me.hp = 0; updHud(); $('#deadby').textContent = `${k} にやられた… 3 秒で復活`; $('#dead').style.display = 'grid'; firing = false; if (myModel) myModel.g.rotation.x = -Math.PI / 2; }
      else { const o = others.get(m.victim); if (o) { o.alive = false; o.model.g.rotation.x = -Math.PI / 2; } }
    } else if (m.t === 'fix') { Object.assign(me, { x: m.x, y: m.y, z: m.z }); }
  };
  ws.onclose = (e) => {
    if (e.code === 4000) { showCenter('ほかの画面で開きました', 'こちらで遊ぶ'); $('#start').onclick = () => location.reload(); return; }
    if (e.code === 1006 && !you) { showCenter('シティバトル', 'ログインする', 'ログインすると遊べます'); $('#start').onclick = () => parent.postMessage({ source: 'ippo-arena', type: 'login' }, location.origin); return; }
    for (const sid of [...others.keys()]) removePlayer(sid);
    you = null; $('#status').textContent = '接続が切れました。つなぎ直しています…';
    setTimeout(connect, 1500);
  };
}
$('#start').onclick = () => {
  playing = true; $('#center').classList.add('hide');
  if (!isTouch) canvas.requestPointerLock?.();
};

// ---------- 毎フレーム ----------
const clock = new THREE.Clock();
const camOff = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
  // 自分の移動
  if (playing && me.alive) {
    let fx0 = 0, fz0 = 0, run = false;
    if (isTouch) { fx0 = move.x; fz0 = move.y; run = move.run; }
    else { if (keys.has('KeyW') || keys.has('ArrowUp')) fz0 -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fz0 += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) fx0 -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) fx0 += 1; run = keys.has('ShiftLeft') || keys.has('ShiftRight'); }
    const L = Math.hypot(fx0, fz0); if (L > 1) { fx0 /= L; fz0 /= L; }
    const sp = (run ? 8 : 5.5) * dt, s = Math.sin(me.yaw), c = Math.cos(me.yaw);
    me.x += (fx0 * c + fz0 * s) * sp; me.z += (-fx0 * s + fz0 * c) * sp;
    if (me.kx || me.kz) { me.x += me.kx * dt; me.z += me.kz * dt; const f = Math.exp(-dt * 5); me.kx *= f; me.kz *= f; if (Math.hypot(me.kx, me.kz) < 0.2) me.kx = me.kz = 0; }
    me.vy -= 20 * dt; me.y += me.vy * dt;
    A.collide(map, me);
    const g = A.groundAt(map, me.x, me.z, me.y);
    if (me.y <= g) { me.y = g; me.vy = 0; me.onGround = true; } else me.onGround = false;
    if (firing) tryShoot(now);
    if (me.reloading && now >= me.reloading) { me.reloading = 0; me.ammo = MAG; updHud(); }
    if (now - lastSend > 50) { lastSend = now; send({ t: 'pos', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3) }); }
  }
  // 自分のモデルとカメラ (肩ごしの三人称。壁があればカメラを近づける)
  if (myModel) {
    const curb = GFX.curbAt(me.x, me.z);
    myModel.g.position.x = me.x; myModel.g.position.z = me.z; myModel.baseY = me.y; myModel.g.rotation.y = me.yaw;
    GFX.animateChar(myModel, now, dt, curb);
    const pivot = new THREE.Vector3(me.x, me.y + curb + 1.6, me.z);
    camOff.set(0.75, 0.35, 3.6).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
    const dist = camOff.length(), dir = camOff.clone().normalize();
    const hit = A.rayWorld(map, [pivot.x, pivot.y, pivot.z], [dir.x, dir.y, dir.z], dist);
    camera.position.copy(pivot).addScaledVector(dir, Math.max(0.4, Math.min(dist, hit - 0.25)));
    if (camera.position.y < 0.45) camera.position.y = 0.45; // 地面の下には行かない
    camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
    if (location.hash === '#inspect') { // 確認用: 自分のキャラを前から近くで見る
      camera.position.set(me.x - Math.sin(me.yaw) * 1.25 + Math.cos(me.yaw) * 0.35, me.y + curb + 1.55, me.z - Math.cos(me.yaw) * 1.25 - Math.sin(me.yaw) * 0.35);
      camera.lookAt(me.x, me.y + curb + 1.35, me.z);
    }
  }
  // ほかのプレイヤー (なめらかに追いかける)
  const k = 1 - Math.exp(-dt * 14);
  for (const o of others.values()) {
    const g = o.model.g;
    g.position.x += (o.tx - g.position.x) * k; g.position.z += (o.tz - g.position.z) * k; o.cy = (o.cy ?? o.ty) + (o.ty - (o.cy ?? o.ty)) * k;
    o.model.baseY = o.cy; GFX.animateChar(o.model, now, dt, GFX.curbAt(g.position.x, g.position.z));
    let dy = o.yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * k;
    // 無敵中は点めつ (マテリアルは共有なので、見える・見えないで表す)
    g.visible = (o.alive || g.rotation.x !== 0) && !(o.prot && Math.floor(now / 120) % 2);
  }
  stepFx(dt);
  GFX.follow(me.x, me.z);
  GFX.render();
  requestAnimationFrame(frame);
}
updHud(); connect(); requestAnimationFrame(frame);
