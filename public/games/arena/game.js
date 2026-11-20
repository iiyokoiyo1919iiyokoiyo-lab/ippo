// =====================================================================
// シティバトル (ブラウザ側): three.js で街を描き、三人称で動いて撃つ
//   ・自分の動きはこの端末で計算してサーバーに送る (サーバーが速さをたしかめる)
//   ・弾は「画面のまん中」をねらう。当たったかどうかはサーバーが決める
//   ・パソコン: WASD・マウス (クリックで視点を固定)・クリックで撃つ・Space ジャンプ・Shift ダッシュ・R リロード
//   ・スマホ: 画面の左半分を触るとそこにスティックが出て移動、右側をなぞって視点、うつ・ジャンプ・リロードのボタン
//   ・車: 近くで「乗る」(E)・スティック / WASD で運転・「降りる」。速いと人をはねる
//   ・強盗: 通行人に銃を向けつづけると手を上げてお金を落とす (その場だけのお金。コインではない)
//   ・エイムアシスト (スマホだけ・軽め): 撃つ / のぞくとき、照準のすぐ近くの相手へ少し寄せる
// =====================================================================
import * as THREE from './vendor/three.module.min.js';
import { createGraphics } from './world.js?v=19';
import { Ragdoll, RagdollManager } from './ragdoll.js?v=3';
import { NpcView } from './npcs.js?v=5';
import { Sound } from './sound.js?v=4';
import { Gore } from './gore.js?v=2';
import { Settings } from './settings.js?v=3';
import { VehicleView } from './vehicles.js?v=2';
import { DebugPanel } from './debug.js?v=2';
const A = window.ArenaMap, map = A.build();
const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches; // 指で操作する端末だけ (タッチもできるパソコンはマウス操作)
if (isTouch) document.body.classList.add('is-touch');
$('#howto').innerHTML = isTouch
  ? '画面の左側を触るとスティックが出て移動・右側をなぞって見回す<br>「うつ」を押しているあいだ連射 (長押しで自動でのぞく)・近くの相手は「なぐる」<br>左の「のぞく」でサイト・スコープをのぞく・「武器」でスナイパーに持ちかえ<br>車の近くで「乗る」(どの車も乗れる)・通行人やコンビニの店員に銃を向けつづけると強盗'
  : 'WASD で移動・マウスで見回す・クリックで撃つ・右クリックでサイトをのぞく・F でなぐる<br>1 ライフル / 2 スナイパー (Q で切りかえ)<br>Space ジャンプ・Shift ダッシュ・R リロード・V 視点・Esc で一時停止<br>E で車に乗る / 降りる (WASD で運転・Space でブレーキ・V で運転席 / 後ろ)<br>通行人やコンビニの店員に銃を向けつづけると強盗';

// ---------- 画面・街・キャラクター (world.js) ----------
const GFX = createGraphics({ canvasEl: $('#c'), isTouch, map, A });
const { scene, camera } = GFX;
addEventListener('resize', GFX.resize); GFX.resize();
const seedOf = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const makeChar = (color, name, isMe) => GFX.makeChar(color, name, isMe, seedOf(name));
// ---------- 体の物理・通行人・音・血・設定 ----------
const env = { groundAt: (x, z) => GFX.curbAt(x, z), boxes: map.solid, cam: camera.position };
const ragdolls = new RagdollManager({ low: 3, medium: 6, high: 10, ultra: 14 }[GFX.quality] || 6);
const sound = new Sound(), gore = new Gore(scene, env);
const settings = new Settings({
  quality: GFX.quality, qualities: GFX.qualities, onQuality: (q) => { GFX.setQuality(q); location.reload(); },
  onLocal: (L) => applyLocal(L), onServer: (patch) => send({ t: 'config', patch }),
});
function applyLocal(L) { gore.blood = L.blood; gore.dismember = L.dismember; sound.setOn(L.sound); camera.near = L.view === 'fps' ? 0.02 : 0.1; camera.updateProjectionMatrix(); }
const fps = () => settings.local.view === 'fps';
let viewModel = null;
applyLocal(settings.local);
const npcView = new NpcView({ GFX, ragdolls, env, gore, sound, settings });
const vehicles = new VehicleView({ GFX, sound });
const cashView = new Map(); // 落ちているお金 id → 形
const debug = new DebugPanel({ send: (m) => send(m), getPos: () => ({ x: me.x, z: me.z }) });
{ const b = document.createElement('button'); b.className = 'btn ghost'; b.id = 'gfx'; b.style.marginTop = '10px'; b.textContent = `⚙️ 設定 (画質・ラグドール・血など)`;
  b.onclick = () => settings.open(); $('#center > div').append(document.createElement('br'), b); }
{ const b = document.createElement('button'); b.id = 'gear'; b.className = 'hud-btn'; b.textContent = '⚙️'; b.setAttribute('aria-label', '設定');
  b.onclick = () => { if (document.pointerLockElement) document.exitPointerLock(); settings.open(); }; document.body.append(b); }
// 全画面: はじめるときに自動で全画面に (対応しているブラウザ)。⛶ で切りかえ・✕ で IppO にもどる
const canFS = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function enterFS() { if (!canFS || document.fullscreenElement || document.webkitFullscreenElement) return; const el = document.documentElement; try { const r = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' }); r?.catch?.(() => {}); } catch {} }
function exitFS() { try { const r = (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); r?.catch?.(() => {}); } catch {} }
if (canFS) { const b = document.createElement('button'); b.id = 'fsbtn'; b.className = 'hud-btn'; b.textContent = '⛶'; b.setAttribute('aria-label', '全画面');
  b.onclick = () => { if (document.fullscreenElement || document.webkitFullscreenElement) exitFS(); else enterFS(); }; document.body.append(b); }
if (parent !== window) { const b = document.createElement('button'); b.id = 'exitbtn'; b.className = 'hud-btn'; b.textContent = '✕'; b.setAttribute('aria-label', 'IppO にもどる');
  b.onclick = () => { if (document.pointerLockElement) document.exitPointerLock(); exitFS(); parent.postMessage({ source: 'ippo-arena', type: 'exit' }, location.origin); }; document.body.append(b); }

// ---------- 状態 ----------
const me = { car: null, cash: 0, x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: -0.1, hp: 100, alive: false, protect: false, ammo: 30, reloading: 0, onGround: true, st: 0, srv: null, w: 'rifle', mags: { rifle: 30, sniper: 5 }, held: false };
const canControl = () => me.alive && me.st === 0 && !me.car; // 硬直・転倒・行動不能・運転中は、歩く・撃つができない
const MAG = 30, RELOAD_MS = 1400;
// 武器: ライフル (連射・30 発) / スナイパー (1 発ずつ・5 発・スコープ)。間かくとダメージはサーバーが決める
const WEAPON = { rifle: { name: 'ライフル', mag: 30, reload: 1400, ms: 130, auto: true }, sniper: { name: 'スナイパー', mag: 5, reload: 2600, ms: 1300, auto: false } };
const W = () => WEAPON[me.w] || WEAPON.rifle;
let scoped = false, aiming = false, scopeK = 0, aimK = 0; // aiming: サイトをのぞく (両方の武器) / scoped: スナイパーのスコープ (黒いふち)
let you = null, ws = null, playing = false, lastSend = 0, lastShot = 0, rules = { fireMs: 130 };
const others = new Map(); // sid → { name, color, bot, model, tx,ty,tz, yaw, alive, kills, deaths }
const scores = new Map();
let myModel = null, myColor = '#4dabf7';
function addPlayer(p) {
  scores.set(p.sid, { name: p.name, kills: p.kills || 0, deaths: p.deaths || 0, bot: p.bot });
  if (p.sid === you) { myColor = p.color; if (!myModel) myModel = makeChar(p.color, p.name, true); if (!viewModel) { viewModel = GFX.makeViewModel(p.color, seedOf(p.name)); camera.add(viewModel.g); } return; }
  if (others.has(p.sid)) return;
  others.set(p.sid, { ...p, model: makeChar(p.color, p.name, false), tx: 0, ty: 0, tz: 0, yaw: 0, alive: true, seen: false });
  if (p.w) others.get(p.sid).model.setWeapon(p.w);
}
function removePlayer(sid) { const o = others.get(sid); if (o) { endRagdoll(o.model); GFX.disposeChar(o.model); others.delete(sid); } scores.delete(sid); renderScore(); }
// ---------- 被弾のリアクション (プレイヤー・ボット) ----------
function startRagdoll(model, hit) {
  if (!model || model.ragdoll) return;
  if (settings.local.ragdoll) ragdolls.add(new Ragdoll(model, env, { dir: hit.dir || [0, 0, 1], impact: hit.impact || 30, head: hit.head, strength: settings.local.reaction }));
  else model.g.rotation.x = -Math.PI / 2; // ラグドールなし: その場に横たわる
}
function endRagdoll(model) { if (!model) return; if (model.ragdoll) ragdolls.remove(model.ragdoll); GFX.restPose(model); model.g.rotation.x = 0; model.g.rotation.z = 0; }
function reactTo(model, m, pos) {
  if (!model) return;
  const hp = [pos.x, pos.y + (m.head ? 1.6 : 1.15), pos.z];
  sound.play('flesh', pos.x, pos.z);
  if (gore.blood) gore.spray(hp, m.dir || [0, 0, 1], m.res === 'incap' ? 26 : 12); else burst(hp, m.melee ? '#ff922b' : m.head ? '#ffd43b' : '#ffffff', m.melee ? 16 : m.head ? 12 : 7);
  if (m.res === 'stagger') GFX.react(model, m.dir || [0, 0, 1], settings.local.reaction);
  else if (m.res === 'down' || m.res === 'incap') {
    startRagdoll(model, m); sound.play('fall', pos.x, pos.z); gore.pool(pos.x + (m.dir?.[0] || 0) * 0.7, pos.z + (m.dir?.[2] || 0) * 0.7);
    if (m.res === 'incap' && model.ragdoll && settings.local.dismember) gore.dismemberOn(model, model.ragdoll, m.dir);
  }
}
// 起き上がる・復活する: 体を元にもどす (欠損していたら作り直す)
function freshModel(o, isMe) {
  const m = isMe ? myModel : o.model; if (!m) return;
  endRagdoll(m);
  if (m.cut) { GFX.disposeChar(m); const s = scores.get(isMe ? you : o.sid); const nm = makeChar(isMe ? myColor : o.color, s?.name || '', isMe); if (isMe) myModel = nm; else o.model = nm; }
}

// ---------- 入力 ----------
const keys = new Set(); let firing = false;
const move = { x: 0, y: 0, run: false };
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyE') toggleCar(); if (e.code === 'Digit1') setWeapon('rifle'); if (e.code === 'Digit2') setWeapon('sniper'); if (e.code === 'KeyQ') setWeapon(me.w === 'sniper' ? 'rifle' : 'sniper'); if (e.code === 'KeyV') settings.set('view', fps() ? 'tps' : 'fps'); if (e.code === 'KeyF') doPunch(); if (e.code === 'KeyR') reload(); if (e.code === 'Space') { e.preventDefault(); jump(); } });
addEventListener('keyup', (e) => keys.delete(e.code));
const canvas = $('#c');
canvas.addEventListener('mousedown', (e) => { if (!playing) return; if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; } if (e.button === 0) firing = true; if (e.button === 2) setScope(true); }); // 右クリック: サイトをのぞく (ライフルもスナイパーも)
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mouseup', (e) => { if (e.button === 2) setScope(false); else firing = false; });
addEventListener('mousemove', (e) => { if (document.pointerLockElement !== canvas) return; const k = scoped ? 0.0006 : aiming ? 0.0014 : 0.0023; me.yaw -= e.movementX * k; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - e.movementY * k)); });
document.addEventListener('pointerlockchange', () => { if (!isTouch && playing && document.pointerLockElement !== canvas) { firing = false; showCenter('一時停止中', 'つづける'); } });
// スマホ: スティック・視点・ボタン
if (isTouch) {
  const stick = $('#stick'), knob = stick.firstElementChild; let sid = null;
  const sm = (t) => { const r = stick.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), L = Math.hypot(dx, dy), max = r.width / 2 - 10, k = L > max ? max / L : 1;
    knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; move.x = (dx * k) / max; move.y = (dy * k) / max; move.run = L > max * 0.92; };
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; sm(t); }, { passive: false });
  stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) sm(t); }, { passive: false });
  const send0 = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; move.x = move.y = 0; move.run = false; knob.style.transform = ''; stick.style.left = stick.style.top = stick.style.bottom = ''; stick.classList.remove('float'); } };
  // 画面の左半分なら、どこを触ってもそこにスティックが出る (はなすと元の場所にもどる)
  const floatStick = (t) => { const w = stick.offsetWidth, h = w / 2, x = Math.max(h + 4, Math.min(innerWidth - h - 4, t.clientX)), y = Math.max(h + 60, Math.min(innerHeight - h - 4, t.clientY));
    stick.style.left = (x - h) + 'px'; stick.style.top = (y - h) + 'px'; stick.style.bottom = 'auto'; stick.classList.add('float'); sid = t.identifier; sm(t); };
  stick.addEventListener('touchend', send0); stick.addEventListener('touchcancel', send0);
  // 視点: スティックとボタン以外の場所をなぞる
  const look = new Map();
  canvas.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) { if (sid === null && t.clientX < innerWidth / 2) floatStick(t); else look.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { if (t.identifier === sid) { sm(t); continue; } const p = look.get(t.identifier); if (!p) continue; const sk = scoped ? 0.3 : aiming ? 0.6 : 1; me.yaw -= (t.clientX - p[0]) * 0.0052 * sk; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - (t.clientY - p[1]) * 0.0042 * sk)); look.set(t.identifier, [t.clientX, t.clientY]); } }, { passive: false });
  const lend = (e) => { send0(e); for (const t of e.changedTouches) look.delete(t.identifier); };
  canvas.addEventListener('touchend', lend); canvas.addEventListener('touchcancel', lend);
  // うつ: 押しながらなぞると、視点も動かせる
  // 「うつ」を長押し (0.25 秒) すると自動でのぞく。はなすと、自動でのぞいていたときだけやめる
  const fire = $('#fire'); let fid = null, fp = null, holdT = 0, autoAim = false;
  fire.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; fid = t.identifier; fp = [t.clientX, t.clientY]; firing = true;
    clearTimeout(holdT); holdT = setTimeout(() => { if (fid !== null && !aiming) { setScope(true); autoAim = aiming; } }, 250); }, { passive: false });
  fire.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === fid) { const sk = scoped ? 0.3 : aiming ? 0.6 : 1; me.yaw -= (t.clientX - fp[0]) * 0.0045 * sk; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch - (t.clientY - fp[1]) * 0.0036 * sk)); fp = [t.clientX, t.clientY]; } }, { passive: false });
  const fend = (e) => { for (const t of e.changedTouches) if (t.identifier === fid) { fid = null; firing = false; clearTimeout(holdT); if (autoAim && aiming) setScope(false); autoAim = false; } };
  fire.addEventListener('touchend', fend); fire.addEventListener('touchcancel', fend);
  $('#jump').addEventListener('touchstart', (e) => { e.preventDefault(); jump(); }, { passive: false });
  $('#reload').addEventListener('touchstart', (e) => { e.preventDefault(); reload(); }, { passive: false });
  $('#punch').addEventListener('touchstart', (e) => { e.preventDefault(); doPunch(); }, { passive: false });
  $('#weapon').addEventListener('touchstart', (e) => { e.preventDefault(); setWeapon(me.w === 'sniper' ? 'rifle' : 'sniper'); }, { passive: false });
  $('#aim').addEventListener('touchstart', (e) => { e.preventDefault(); setScope(!aiming); }, { passive: false }); // 左側の「のぞく」
  $('#act').addEventListener('touchstart', (e) => { e.preventDefault(); toggleCar(); }, { passive: false }); // 乗る / 降りる
  $('#vbtn').addEventListener('touchstart', (e) => { e.preventDefault(); settings.set('view', fps() ? 'tps' : 'fps'); }, { passive: false }); // 運転中の視点 (運転席 / 後ろから)
}
// なぐる: 当たったかどうかはサーバーが決める。ここではうでをふる
let lastPunch = 0;
function doPunch() {
  const now = performance.now();
  if (!playing || !canControl() || now - lastPunch < (rules.punch?.ms || 600)) return;
  lastPunch = now; me.protect = false; swing(myModel); viewModel?.punch(); send({ t: 'punch' });
}
function swing(model) { if (model) model.swing = performance.now(); }
function setWeapon(w) {
  if (!WEAPON[w] || w === me.w || !you) return;
  me.mags[me.w] = me.ammo; me.w = w; me.ammo = me.mags[w]; me.reloading = 0; setScope(aiming);
  myModel?.setWeapon(w); viewModel?.setWeapon(w); lastShot = performance.now() + 450 - W().ms; send({ t: 'weapon', w }); updHud();
}
// スコープ (スナイパーのとき): 視野をせまくして、黒いふちの照準を出す
function setScope(on) {
  aiming = !!on && canControl(); scoped = aiming && me.w === 'sniper';
  document.body.classList.toggle('scoped', scoped); document.body.classList.toggle('aiming', aiming); $('#aim')?.classList.toggle('on', aiming);
}
// 車: 近くの一般車に乗る / 降りる (サーバーが決める)
function toggleCar() {
  if (!playing || !me.alive) return;
  if (me.car) { send({ t: 'exit' }); return; }
  if (!canControl()) return;
  const v = vehicles.enterable(me.x, me.z); if (v) send({ t: 'enter', id: v.id });
}
function jump() { if (playing && canControl() && me.onGround) { me.vy = 7; me.onGround = false; } }
function reload() { if (me.reloading || me.ammo === W().mag || !me.alive) return; me.reloading = performance.now() + W().reload; setScope(false); updHud(); }

// ---------- HUD ----------
function updHud() {
  $('#hptxt').textContent = `HP ${Math.max(0, me.hp)}`;
  $('#hpbar i').style.width = Math.max(0, me.hp) + '%'; $('#hpbar').classList.toggle('low', me.hp <= 30);
  $('#ammotxt').textContent = me.reloading ? 'リロード中' : String(me.ammo); $('#ammosub').textContent = `${W().name} / ${W().mag}`;
  $('#prot').style.display = me.protect && me.alive ? 'block' : 'none';
}
function renderScore() {
  const list = [...scores.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths).slice(0, 6);
  const el = $('#score'); el.textContent = '';
  const h = document.createElement('b'); h.textContent = `🏆 キル数 (${scores.size}人)`; el.append(h);
  if (me.cash) { const c = document.createElement('div'); c.className = 'cash'; c.textContent = `💰 所持金 ¥${me.cash.toLocaleString()}`; el.append(c); }
  for (const [sid, s] of list) { const d = document.createElement('div'); if (sid === you) d.className = 'you'; const n = document.createElement('span'); n.textContent = (s.bot ? '🤖 ' : '') + s.name; const k = document.createElement('span'); k.textContent = `${s.kills} / ${s.deaths}`; d.append(n, k); el.append(d); }
}
function feed(text, mine) { const d = document.createElement('div'); d.textContent = text; if (mine) d.className = 'me'; const f = $('#feed'); f.prepend(d); while (f.children.length > 5) f.lastChild.remove(); setTimeout(() => d.remove(), 6000); }
function flashDamage() { const d = $('#dmg'); d.style.opacity = 1; clearTimeout(flashDamage.t); flashDamage.t = setTimeout(() => { d.style.opacity = 0; }, 180); }
function hitMarker(head) { const h = $('#hitmark'); h.classList.remove('on', 'head'); void h.offsetWidth; h.classList.add('on'); if (head) h.classList.add('head'); }
function showCenter(title, btn, sub = '') { playing = false; $('#center').classList.remove('hide'); $('#center h1').textContent = title; $('#status').textContent = sub; const b = $('#start'); b.textContent = btn; b.disabled = false; }

// ---------- 弾の見た目 ----------
const fx = [];
function tracer(o, e, w = 'rifle') {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(w === 'sniper' ? '#d8dee6' : '#e8d7a8').multiplyScalar(0.7), transparent: true, opacity: w === 'sniper' ? 0.35 : 0.28, fog: true, toneMapped: true }));
  scene.add(line); fx.push({ o: line, until: performance.now() + (w === 'sniper' ? 160 : 70), fade: true, maxO: w === 'sniper' ? 0.35 : 0.28 });
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
    if (f.fade && f.o.material) f.o.material.opacity = Math.min(f.maxO ?? 1, Math.max(0, (f.until - now) / 380));
  }
}

// ---------- 撃つ ----------
const ray = new THREE.Vector3();
function tryShoot(now) {
  if (!canControl() || me.reloading) return;
  if (!W().auto && me.held) return;
  if (now - lastShot < W().ms) return;
  if (me.ammo <= 0) { reload(); return; }
  lastShot = now; me.ammo--; me.held = true; if (!me.ammo) reload();
  // 画面のまん中のねらい: カメラから前へ。壁かプレイヤーに当たるところ
  camera.getWorldDirection(ray);
  const co = [camera.position.x, camera.position.y, camera.position.z], cd = [ray.x, ray.y, ray.z];
  let t = A.rayWorld(map, co, cd, me.w === 'sniper' ? 220 : 120);
  for (const v of vehicles.list.values()) { if ((v.flags & 1) || !v.seen) continue; const tv = A.rayOBB(co, cd, { x: v.x, z: v.z, yaw: v.yaw, w: v.kind === 'ambulance' ? 2.1 : 1.9, l: v.kind === 'ambulance' ? 5.4 : 4.4, h: v.kind === 'ambulance' ? 2.45 : 1.5 }); if (tv < t) t = tv; } // 車は弾よけ
  for (const o of others.values()) { if (!o.alive) continue; const r = A.rayPlayer(co, cd, { x: o.model.g.position.x, y: o.model.g.position.y, z: o.model.g.position.z }); if (r && r.t < t) t = r.t; }
  const aim = [co[0] + cd[0] * t, co[1] + cd[1] * t, co[2] + cd[2] * t];
  // 撃つのは自分のブラスターの先から
  const tip = new THREE.Vector3(); (fps() && viewModel ? viewModel.tip : myModel.tip).getWorldPosition(tip);
  if (scoped) { tip.copy(camera.position).add(new THREE.Vector3(0.06, -0.08, 0).applyQuaternion(camera.quaternion)); } // スコープ中は目のすぐ下から
  const o = [tip.x, tip.y, tip.z], d = [aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]], L = Math.hypot(...d) || 1;
  const dn = d.map((v) => v / L);
  const wall = A.rayWorld(map, o, dn, me.w === 'sniper' ? 220 : 120);
  if (!scoped) tracer(o, [o[0] + dn[0] * Math.min(wall, L + 40), o[1] + dn[1] * Math.min(wall, L + 40), o[2] + dn[2] * Math.min(wall, L + 40)], me.w);
  if (!scoped) muzzle(fps() && viewModel ? viewModel : myModel, me.w); viewModel?.kick(me.w === 'sniper' ? 2.2 : 1);
  if (me.w === 'sniper') { me.pitch = Math.min(0.7, me.pitch + 0.05); sound.play('shot', me.x, me.z, { heavy: true }); } // 反動
  me.protect = false;
  send({ t: 'shoot', o, d: dn });
  updHud();
}
function muzzle(model, w = 'rifle') { const m = new THREE.Mesh(new THREE.SphereGeometry(w === 'sniper' ? 0.07 : 0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(1.6), transparent: true, opacity: 0.8 })); model.tip.getWorldPosition(m.position); scene.add(m); fx.push({ o: m, until: performance.now() + 60, fade: true }); }

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
      npcView.clear(); for (const n of m.npcs || []) npcView.add(n);
      vehicles.init(m.vehicles || []); for (const c of m.cash || []) addCash(c);
      for (const p of m.players) if (p.car && p.sid !== you) { const o = others.get(p.sid); if (o) o.car = p.car; }
      me.cash = m.players.find((p) => p.sid === you)?.cash || 0;
      settings.setServer(m.cfg || {}, m.admin); debug.enable(!!m.admin);
      Object.assign(me, { x: m.me.x, y: m.me.y, z: m.me.z, vy: 0, yaw: m.me.yaw, pitch: -0.1, hp: 100, alive: true, protect: true, ammo: MAG, reloading: 0 }); updHud();
      renderScore();
      const b = $('#start'); b.disabled = false; b.textContent = 'はじめる！'; $('#status').textContent = `いま ${m.players.filter((p) => !p.bot).length} 人が遊んでいます`;
    } else if (m.t === 'full') { $('#status').textContent = '満員です。少し待ってからもう一度どうぞ'; }
    else if (m.t === 'npcnew') npcView.add(m.n);
    else if (m.t === 'npcgone') npcView.remove(m.id);
    else if (m.t === 'nfx') npcView.fx(m);
    else if (m.t === 'config') settings.setServer(m.cfg);
    else if (m.t === 'dbg') debug.render(m.d);
    else if (m.t === 'cash') addCash(m.c);
    else if (m.t === 'cashgone') { const g = cashView.get(m.id); if (g) { scene.remove(g); cashView.delete(m.id); } if (m.sid === you) { me.cash = m.total; sound.play('cash'); feed(`💰 +¥${m.a}`, true); renderScore(); } }
    else if (m.t === 'robbed') { feed('🙌 手を上げた！ お金を落とすぞ', true); const o = npcView.list.get(m.id); if (o) o.robbed = true; }
    else if (m.t === 'enter') {
      if (m.sid === you) { const v = vehicles.get(m.id); me.car = m.id; firing = false; setScope(false); if (v) { v.local = true; car.sp = 0; car.x = v.x; car.z = v.z; car.yaw = v.yaw; me.yaw = v.yaw; me.pitch = 0; } document.body.classList.add('driving'); } // 乗ったら前を向く
      else { const o = others.get(m.sid); if (o) o.car = m.id; }
    } else if (m.t === 'exit') {
      const v = vehicles.get(m.id); if (v) { v.local = false; v.sp = 0; }
      if (m.sid === you) { setCabin(false); me.car = null; Object.assign(me, { x: m.x, z: m.z, y: 0, vy: 0 }); if (v) me.yaw = v.yaw; document.body.classList.remove('driving'); }
      else { const o = others.get(m.sid); if (o) { o.car = 0; o.model.g.position.set(m.x, 0, m.z); } }
    } else if (m.t === 'cfix') { Object.assign(car, { x: m.x, z: m.z, yaw: m.yaw, sp: 0 }); }
    else if (m.t === 'weapon') { const o = others.get(m.sid); if (o) { o.w = m.w; o.model.setWeapon(m.w); } }
    else if (m.t === 'join') { addPlayer(m.p); renderScore(); if (m.p.sid !== you) feed(`${m.p.bot ? '🤖 ' : ''}${m.p.name} が来た`); }
    else if (m.t === 'leave') { const s = scores.get(m.sid); if (s) feed(`${s.name} が帰った`); removePlayer(m.sid); }
    else if (m.t === 'spawn') {
      if (m.sid === you) { freshModel(null, true); me.mags = { rifle: WEAPON.rifle.mag, sniper: WEAPON.sniper.mag }; Object.assign(me, { x: m.x, y: m.y, z: m.z, vy: 0, yaw: m.yaw, pitch: -0.1, hp: 100, alive: true, protect: true, ammo: W().mag, reloading: 0, st: 0 }); myModel?.setWeapon(me.w); $('#dead').style.display = 'none'; if (myModel) { myModel.g.visible = true; myModel.g.rotation.x = 0; } updHud(); }
      else { const o = others.get(m.sid); if (o) { freshModel(o, false); Object.assign(o, { tx: m.x, ty: m.y, tz: m.z, alive: true, st: 0 }); o.model.g.position.set(m.x, m.y, m.z); o.cy = m.y; o.model.g.visible = true; o.model.g.rotation.x = 0; } }
    } else if (m.t === 's') {
      for (const [sid, x, y, z, yaw, pitch, hp, alive, prot, st = 0] of m.p) {
        if (sid === you) {
          me.hp = hp; me.protect = !!prot; if (!alive && me.alive) me.alive = false; me.srv = { x, y, z };
          if (me.st >= 2 && st === 0 && alive) { endRagdoll(myModel); Object.assign(me, { x, y, z }); if (myModel) myModel.rise = performance.now(); } // 起き上がった (サーバーの位置へ)
          me.st = st; continue;
        }
        const o = others.get(sid); if (!o) continue;
        if ((o.st || 0) >= 2 && st === 0 && alive) { endRagdoll(o.model); o.model.setWeapon(o.w || 'rifle'); o.model.g.position.set(x, y, z); o.model.rise = performance.now(); }
        Object.assign(o, { tx: x, ty: y, tz: z, yaw, alive: !!alive, prot: !!prot, st, hp });
        if (!o.seen) { o.model.g.position.set(x, y, z); o.cy = y; o.seen = true; }
      }
      if (m.n) npcView.snapshot(m.n);
      if (m.v) vehicles.snapshot(m.v);
      updHud();
    } else if (m.t === 'punch') {
      if (m.sid !== you) swing(others.get(m.sid)?.model);
    } else if (m.t === 'shot') {
      if (m.sid !== you || m.w !== 'sniper') sound.play('shot', m.o[0], m.o[2], { heavy: m.w === 'sniper' }); if (!m.hit) sound.play('impact', m.e[0], m.e[2]);
      if (m.sid === you) return;
      const o = others.get(m.sid); tracer(m.o, m.e, m.w); if (o) muzzle(o.model, m.w);
    } else if (m.t === 'hit') {
      if (m.sid === you) hitMarker(m.head);
      if (m.npc) { npcView.onHit(m); return; }
      const target = m.to === you ? null : others.get(m.to);
      if (target) reactTo(target.model, m, target.model.g.position);
      if (m.to === you) { reactTo(myModel, m, { x: me.x, y: me.y, z: me.z }); if (m.res !== 'stagger') { firing = false; me.kx = me.kz = 0; } if (m.res !== 'stagger') me.st = m.res === 'down' ? 2 : 3; }
      if (m.melee && target && m.kb) { target.model.g.position.x += m.kb[0] * 0.08; target.model.g.position.z += m.kb[1] * 0.08; }
      if (m.melee && m.to === you && m.kb) { me.kx = m.kb[0]; me.kz = m.kb[1]; me.vy = Math.max(me.vy, 3.5); me.onGround = false; }
      if (m.to === you) { me.hp = m.hp; flashDamage(); updHud(); }
    } else if (m.t === 'kill') {
      for (const s of m.score) { const r = scores.get(s.sid); if (r) Object.assign(r, { kills: s.kills, deaths: s.deaths }); }
      renderScore();
      const k = scores.get(m.killer)?.name || '?', v = scores.get(m.victim)?.name || '?';
      feed(`${k} ${m.melee ? '👊' : m.w === 'car' ? '🚗' : m.w === 'sniper' ? '🔭' : m.head ? '🎯' : '💥'} ${v}`, m.killer === you || m.victim === you);
      if (m.victim === you) { if (me.car) { setCabin(false); const cv = vehicles.get(me.car); if (cv) cv.local = false; me.car = null; document.body.classList.remove('driving'); } me.alive = false; me.hp = 0; updHud(); $('#deadby').textContent = `${k} にやられた… 3 秒で復活`; $('#dead').style.display = 'grid'; firing = false; if (myModel && !myModel.ragdoll) myModel.g.rotation.x = -Math.PI / 2; }
      else { const o = others.get(m.victim); if (o) { o.alive = false; if (!o.model.ragdoll) o.model.g.rotation.x = -Math.PI / 2; } }
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
  playing = true; $('#center').classList.add('hide'); sound.start(); applyLocal(settings.local);
  enterFS(); if (!isTouch) canvas.requestPointerLock?.();
};

// ---------- 毎フレーム ----------
const clock = new THREE.Clock();
const camOff = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
  // 自分の移動
  if (playing && canControl()) {
    let fx0 = 0, fz0 = 0, run = false;
    if (isTouch) { fx0 = move.x; fz0 = move.y; run = move.run; }
    else { if (keys.has('KeyW') || keys.has('ArrowUp')) fz0 -= 1; if (keys.has('KeyS') || keys.has('ArrowDown')) fz0 += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) fx0 -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) fx0 += 1; run = keys.has('ShiftLeft') || keys.has('ShiftRight'); }
    const L = Math.hypot(fx0, fz0); if (L > 1) { fx0 /= L; fz0 /= L; }
    const sp = (aiming ? 3 : run ? 8 : 5.5) * dt, s = Math.sin(me.yaw), c = Math.cos(me.yaw); // のぞいているあいだは走れない
    me.x += (fx0 * c + fz0 * s) * sp; me.z += (-fx0 * s + fz0 * c) * sp;
    if (me.kx || me.kz) { me.x += me.kx * dt; me.z += me.kz * dt; const f = Math.exp(-dt * 5); me.kx *= f; me.kz *= f; if (Math.hypot(me.kx, me.kz) < 0.2) me.kx = me.kz = 0; }
    me.vy -= 20 * dt; me.y += me.vy * dt;
    A.collide(map, me);
    if (me.y < 1.4) for (const c of vehicles.circles()) { const dx = me.x - c.x, dz = me.z - c.z, d = Math.hypot(dx, dz) || 0.01, r = c.r + A.PLAYER_R; if (d < r) { me.x += dx / d * (r - d); me.z += dz / d * (r - d); } } // 車にめりこまない
    const g = A.groundAt(map, me.x, me.z, me.y);
    if (me.y <= g) { me.y = g; me.vy = 0; me.onGround = true; } else me.onGround = false;
    if (isTouch && (firing || aiming)) aimAssist(dt);
    if (firing) tryShoot(now); else me.held = false;
    if (me.reloading && now >= me.reloading) { me.reloading = 0; me.ammo = W().mag; updHud(); }
    if (now - lastSend > 50) { lastSend = now; send({ t: 'pos', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3) }); }
  }
  if (playing && me.car && me.alive) driveCar(dt, now);
  updateAct(); robHint(dt);
  // 自分のモデルとカメラ (肩ごしの三人称。壁があればカメラを近づける)
  if (myModel && me.car) { myModel.g.visible = false; if (viewModel) viewModel.g.visible = false; carCamera(dt); }
  else if (myModel) {
    const curb = GFX.curbAt(me.x, me.z);
    if (!myModel.ragdoll) { myModel.g.position.x = me.x; myModel.g.position.z = me.z; myModel.baseY = me.y; myModel.g.rotation.y = me.yaw; GFX.animateChar(myModel, now, dt, curb); }
    // 倒れているあいだは、カメラは体を追う
    const pv = myModel.ragdoll ? myModel.ragdoll.pelvis() : null;
    const pivot = pv ? new THREE.Vector3(pv.x, pv.y + 0.9, pv.z) : new THREE.Vector3(me.x, me.y + curb + 1.6, me.z);
    camOff.set(0.75, 0.35, 3.6).applyEuler(new THREE.Euler(me.pitch, me.yaw, 0, 'YXZ'));
    const dist = camOff.length(), dir = camOff.clone().normalize();
    const hit = A.rayWorld(map, [pivot.x, pivot.y, pivot.z], [dir.x, dir.y, dir.z], dist);
    camera.position.copy(pivot).addScaledVector(dir, Math.max(0.4, Math.min(dist, hit - 0.25)));
    if (camera.position.y < 0.45) camera.position.y = 0.45; // 地面の下には行かない
    camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
    // 一人称: 目の高さ (倒れているあいだは三人称で自分の体を映す)
    if (aiming && !canControl()) setScope(false);
    scopeK += ((scoped ? 1 : 0) - scopeK) * Math.min(1, dt * 12);
    aimK += ((aiming && !scoped ? 1 : 0) - aimK) * Math.min(1, dt * 12);
    // 視野: スナイパーのスコープは 16°・ライフルでのぞくと 48°
    const fov = (innerWidth < innerHeight ? 82 : 70), want = fov + (16 - fov) * scopeK + (48 - fov) * aimK; if (Math.abs(camera.fov - want) > 0.05) { camera.fov = want; camera.updateProjectionMatrix(); }
    const firstP = (fps() || aiming) && !myModel.ragdoll && location.hash !== '#inspect';
    myModel.g.visible = !firstP;
    if (viewModel) viewModel.g.visible = firstP && me.alive && scopeK < 0.5;
    if (firstP) {
      const walking = canControl() && (keys.size || Math.hypot(move.x, move.y) > 0.1), bob = walking ? Math.sin(now / 105) * 0.035 : 0;
      camera.position.set(me.x, me.y + curb + 1.62 + bob, me.z);
      viewModel.update(dt, { speed: myModel.speed || 0, run: !aiming && (keys.has('ShiftLeft') || move.run), reloading: !!me.reloading, aim: aimK });
    }
    if (location.hash === '#inspect') { // 確認用: 自分のキャラを前から近くで見る
      camera.position.set(me.x - Math.sin(me.yaw) * 1.25 + Math.cos(me.yaw) * 0.35, me.y + curb + 1.55, me.z - Math.cos(me.yaw) * 1.25 - Math.sin(me.yaw) * 0.35);
      camera.lookAt(me.x, me.y + curb + 1.35, me.z);
    }
  }
  if (window.__camOverride) { const c = window.__camOverride; camera.position.set(...c.pos); camera.lookAt(...c.at); } // 確認用 (#debug のテストだけが使う)
  // ほかのプレイヤー (なめらかに追いかける)
  const k = 1 - Math.exp(-dt * 14);
  for (const o of others.values()) {
    const g = o.model.g;
    if (o.model.ragdoll) { // 倒れているあいだはラグドールが動かす。転倒・行動不能は苦しむ
      g.visible = true; o.model.ragdoll.setWrithe(o.st === 3 ? 1 : o.st === 2 ? 0.45 : 0);
      if ((o.st === 2 || o.st === 3) && (o.groanAt || 0) < now) { o.groanAt = now + 2000 + Math.random() * 2500; const pv = o.model.ragdoll.pelvis(); sound.play('groan', pv.x, pv.z, { id: o.sid, k: 0.8 }); }
      continue;
    }
    if (o.car) { g.visible = false; continue; } // 車を運転している
    o.model.limp = o.hp != null && o.hp < 35;
    g.position.x += (o.tx - g.position.x) * k; g.position.z += (o.tz - g.position.z) * k; o.cy = (o.cy ?? o.ty) + (o.ty - (o.cy ?? o.ty)) * k;
    o.model.baseY = o.cy; GFX.animateChar(o.model, now, dt, GFX.curbAt(g.position.x, g.position.z));
    let dy = o.yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * k;
    // 無敵中は点めつ (マテリアルは共有なので、見える・見えないで表す)
    g.visible = (o.alive || g.rotation.x !== 0) && !(o.prot && Math.floor(now / 120) % 2);
  }
  stepFx(dt);
  const t1 = performance.now();
  if (myModel?.ragdoll) myModel.ragdoll.setWrithe(me.st === 2 ? 0.45 : me.st === 3 ? 1 : 0); // 自分が倒れたときも苦しむ
  if (myModel) myModel.limp = me.hp < 35 && me.alive;
  ragdolls.step(dt);
  npcView.update(now, dt, camera.position);
  vehicles.update(dt, now);
  for (const g of cashView.values()) g.rotation.y += dt * 2;
  gore.update(dt, ragdolls.list);
  sound.setListener(camera.position.x, camera.position.z, me.yaw);
  window.__arenaStats = { npcMs: performance.now() - t1, npcs: npcView.stats, ragdolls: ragdolls.list.length, awake: ragdolls.awake, frameMs: dt * 1000 };
  GFX.follow(me.x, me.z);
  GFX.render();
  requestAnimationFrame(frame);
}
// ---------- 車の運転 (この端末で動かして、サーバーに送る) ----------
const car = { x: 0, z: 0, yaw: 0, sp: 0, steer: 0, lastSend: 0 };
const CARP = { acc: 9, brake: 20, rev: 7, max: 26, back: -8, turn: 1.9 };
function driveCar(dt, now) {
  const v = vehicles.get(me.car); if (!v) return;
  let thr = 0, steer = 0, hand = false;
  if (isTouch) { thr = -move.y; steer = move.x; if (Math.abs(thr) < 0.15) thr = 0; }
  else { if (keys.has('KeyW') || keys.has('ArrowUp')) thr += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) thr -= 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1; if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1; hand = keys.has('Space'); }
  if (thr > 0) car.sp += (car.sp < 0 ? CARP.brake : CARP.acc * (1 - Math.max(0, car.sp) / (CARP.max + 4))) * thr * dt;
  else if (thr < 0) car.sp -= (car.sp > 0 ? CARP.brake : CARP.rev) * -thr * dt;
  else car.sp -= Math.sign(car.sp) * Math.min(Math.abs(car.sp), (1.2 + Math.abs(car.sp) * 0.08) * dt);
  if (hand) car.sp *= Math.exp(-dt * 3);
  car.sp = Math.max(CARP.back, Math.min(CARP.max, car.sp));
  car.steer += (steer - car.steer) * Math.min(1, dt * 8);
  const dyaw = -car.steer * CARP.turn * Math.max(-1, Math.min(1, car.sp / 6)) * (1 - Math.min(0.45, Math.abs(car.sp) / 60)) * dt;
  car.yaw += dyaw; me.yaw += dyaw; // 見ている向きも車といっしょに回る
  car.x += -Math.sin(car.yaw) * car.sp * dt; car.z += -Math.cos(car.yaw) * car.sp * dt;
  // ぶつかる: 車の前・まん中・後ろの円を、建物・止まっている車・ほかの車から押しだす
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw); let px = 0, pz = 0, hit = 0;
  for (const k of [-1.35, 0, 1.35]) {
    const c = { x: car.x + fx * k, y: 0, z: car.z + fz * k }, o = { ...c }; A.collide(map, c, 1.05);
    for (const q of vehicles.circles(me.car)) { const dx = c.x - q.x, dz = c.z - q.z, d = Math.hypot(dx, dz) || 0.01, r = q.r + 1.05; if (d < r) { c.x += dx / d * (r - d); c.z += dz / d * (r - d); } }
    const ddx = c.x - o.x, ddz = c.z - o.z; if (Math.abs(ddx) + Math.abs(ddz) > 0.001) { hit++; if (Math.abs(ddx) > Math.abs(px)) px = ddx; if (Math.abs(ddz) > Math.abs(pz)) pz = ddz; }
  }
  if (hit) { car.x += px; car.z += pz; if (Math.abs(car.sp) > 6) sound.play('crash', car.x, car.z); car.sp *= 0.55; }
  Object.assign(v, { x: car.x, z: car.z, yaw: car.yaw, sp: car.sp, steer: car.steer * 0.5, tx: car.x, tz: car.z, tyaw: car.yaw });
  if (cabin) { cabin.wheel.rotation.z = -car.steer * 2.4; cabin.setSpeed(car.sp * 3.6); }
  Object.assign(me, { x: car.x, z: car.z, y: 0 });
  if (now - car.lastSend > 50) { car.lastSend = now; send({ t: 'drive', x: +car.x.toFixed(2), z: +car.z.toFixed(2), yaw: +car.yaw.toFixed(3), sp: +car.sp.toFixed(2) }); }
}
// 車の中 (運転席の視点のとき): 乗った車に付けて、外がわの車体はかくす
let cabin = null, cabinCar = null;
function setCabin(on) {
  const v = me.car ? vehicles.get(me.car) : null;
  if (cabin && (!on || cabinCar !== v)) { cabinCar?.model.g.remove(cabin.g); if (cabinCar) cabinCar.model.body.visible = true; cabin = null; cabinCar = null; }
  if (on && v && !cabin) { cabin = GFX.makeCarInterior(v.kind, v.model.color); v.model.g.add(cabin.g); v.model.body.visible = false; cabinCar = v; }
}
// 運転中のカメラ: 一人称なら運転席から (見回せる・はなすと前にもどる)。三人称なら車の後ろの上から (壁があれば近づける)
const camCar = new THREE.Vector3();
function carCamera(dt) {
  setCabin(fps());
  if (cabin) {
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), rx = -fz, rz = fx, [ex, ey, ez] = cabin.eye;
    camera.position.set(car.x + rx * ex - fx * ez, ey, car.z + rz * ex - fz * ez);
    let look = me.yaw - car.yaw; look = Math.atan2(Math.sin(look), Math.cos(look)); look = Math.max(-1.4, Math.min(1.4, look)) * Math.exp(-dt * 1.5); me.yaw = car.yaw + look;
    me.pitch = Math.max(-0.6, Math.min(0.4, me.pitch)) * Math.exp(-dt * 1.5);
    camera.rotation.set(me.pitch - 0.05, me.yaw, 0, 'YXZ');
    const fov = innerWidth < innerHeight ? 80 : 72; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return;
  }
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), want = new THREE.Vector3(car.x - fx * 7.5, 3.4, car.z - fz * 7.5);
  const pv = [car.x, 1.6, car.z], d = [want.x - pv[0], want.y - pv[1], want.z - pv[2]], L = Math.hypot(...d), hitD = A.rayWorld(map, pv, d.map((v) => v / L), L);
  if (hitD < L) want.set(pv[0] + d[0] / L * (hitD - 0.3), pv[1] + d[1] / L * (hitD - 0.3), pv[2] + d[2] / L * (hitD - 0.3));
  camCar.lerp(want, Math.min(1, dt * 6)); if (camCar.lengthSq() === 0) camCar.copy(want);
  camera.position.copy(camCar); camera.lookAt(car.x + fx * 3, 1.2, car.z + fz * 3);
  const fov = innerWidth < innerHeight ? 82 : 70; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  me.yaw = car.yaw; me.pitch = -0.1;
}
// ---------- 強盗の進み具合 (照準の下に出す。決めるのはサーバー) ----------
let robT = 0, robId = null;
function robHint(dt) {
  const el = $('#rob');
  if (!playing || !canControl() || me.car) { if (robId) { robId = null; el.classList.remove('on'); } return; }
  const cp = Math.cos(me.pitch), f = [-Math.sin(me.yaw) * cp, Math.sin(me.pitch), -Math.cos(me.yaw) * cp], eye = [me.x, me.y + 1.6, me.z];
  let best = null, bc = Math.cos(10 * Math.PI / 180);
  for (const o of npcView.list.values()) {
    if ((o.r && o.r !== 'clerk') || o.s !== 0 || o.m === 4 || (o.f & 1) || o.robbed) continue;
    const d = [o.x - eye[0], 1.2 - eye[1], o.z - eye[2]], L = Math.hypot(...d); if (L > 10 || L < 0.5) continue;
    const c = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / L; if (c < bc) continue;
    if (A.rayWorld(map, eye, d.map((v) => v / L), L) < L - 0.4) continue;
    bc = c; best = o;
  }
  if (!best) { if (robId) { robId = null; robT = 0; el.classList.remove('on'); } return; }
  if (best.id !== robId) { robId = best.id; robT = 0; }
  robT += dt; el.classList.add('on'); el.style.setProperty('--p', Math.min(1, robT / 0.9));
  $('#robtxt').textContent = robT < 0.9 ? (best.r === 'clerk' ? '🔫 レジのお金を出させる…' : '🔫 おどしている…') : '🙌';
}
// 「乗る」「降りる」のボタン (スマホ) と、案内 (パソコン)
let actState = '';
function updateAct() {
  const st = !playing || !me.alive ? '' : me.car ? 'out' : canControl() && vehicles.enterable(me.x, me.z) ? 'in' : '';
  if (st === actState) return; actState = st;
  const b = $('#act'); b.textContent = st === 'out' ? '降りる' : '乗る'; b.classList.toggle('show', !!st);
  $('#hint').textContent = isTouch ? '' : st === 'in' ? 'E で車に乗る' : st === 'out' ? 'E で降りる・WASD で運転・Space ブレーキ' : '';
}
// ---------- エイムアシスト (スマホ・軽め) ----------
const aDir = new THREE.Vector3();
function aimAssist(dt) {
  const cpch = Math.cos(me.pitch); aDir.set(-Math.sin(me.yaw) * cpch, Math.sin(me.pitch), -Math.cos(me.yaw) * cpch); // いまの向き (カメラは 1 フレームおくれるので使わない)
  const cp = camera.position, cone = (aiming ? 0.07 : 0.1) * camera.fov / 70;
  let best = null, ba = cone;
  for (const o of others.values()) {
    if (!o.alive || o.car || (o.st || 0) >= 2) continue;
    const g = o.model.g.position, v = [g.x - cp.x, g.y + 1.25 - cp.y, g.z - cp.z], L = Math.hypot(...v); if (L > 80 || L < 1) continue;
    const a = Math.acos(Math.max(-1, Math.min(1, (v[0] * aDir.x + v[1] * aDir.y + v[2] * aDir.z) / L))); if (a > ba) continue;
    if (A.rayWorld(map, [cp.x, cp.y, cp.z], v.map((x) => x / L), L) < L - 0.6) continue;
    ba = a; best = { v, L };
  }
  if (!best) return;
  const k = Math.min(1, dt * 5) * 0.4; // 弱め: 1 秒で残りの差の 9 割くらい
  let dy = Math.atan2(-best.v[0], -best.v[2]) - me.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const dp = Math.asin(best.v[1] / best.L) - me.pitch;
  me.yaw += dy * k; me.pitch = Math.max(-1.2, Math.min(0.7, me.pitch + dp * k));
}
// ---------- 落ちているお金 ----------
function addCash(c) { if (cashView.has(c.id)) return; const g = GFX.makeCash(); g.position.set(c.x, GFX.curbAt(c.x, c.z), c.z); cashView.set(c.id, g); }
if (location.hash === '#debug') window.__arenaDebug = { npcView, ragdolls, GFX, me, camera, gore, settings, vehicles, car, others }; // 確認用 (#debug のときだけ)
updHud(); connect(); requestAnimationFrame(frame);
