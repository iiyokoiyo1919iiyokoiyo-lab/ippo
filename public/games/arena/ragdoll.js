// =====================================================================
// シティバトル: ラグドール (倒れるときの体の物理)
//   ・関節を点 (16 個) で表し、骨の長さを保つ制約でつなぐ軽い物理 (ベルレ積分)。物理エンジンは使わない
//   ・地面・歩道・まわりの箱 (ビル・車・木箱) に当たる。止まったら計算をやめる (sleep)
//   ・同時に動かす数には上限 (RagdollManager)。こえたら古いものから止める
//   ・倒れる向き: 被弾の向き (dir) に、当たった高さ (頭・体) から力を加える
// =====================================================================
import * as THREE from './vendor/three.module.min.js';

const G = -16, STEP = 1 / 60, ITER = 8, R = 0.07;
// 点の名前と、キャラクターのどこから位置をとるか
const J = { pelvis: 0, chest: 1, neck: 2, head: 3, shL: 4, elL: 5, handL: 6, shR: 7, elR: 8, handR: 9, hipL: 10, kneeL: 11, footL: 12, hipR: 13, kneeR: 14, footR: 15 };
const BONES = [['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['neck', 'shL'], ['neck', 'shR'], ['shL', 'shR'], ['chest', 'shL'], ['chest', 'shR'],
  ['pelvis', 'hipL'], ['pelvis', 'hipR'], ['hipL', 'hipR'], ['chest', 'hipL'], ['chest', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL'], ['shL', 'hipL'], ['shR', 'hipR'], ['head', 'chest'],
  ['shL', 'elL'], ['elL', 'handL'], ['shR', 'elR'], ['elR', 'handR'], ['hipL', 'kneeL'], ['kneeL', 'footL'], ['hipR', 'kneeR'], ['kneeR', 'footR']];
// ひざ・ひじが逆に曲がりすぎないよう、ゆるい最小距離 (つけ根 ↔ 先)
const SOFT = [['hipL', 'footL', 0.55], ['hipR', 'footR', 0.55], ['shL', 'handL', 0.45], ['shR', 'handR', 0.45], ['head', 'pelvis', 0.85]];

const v = () => new THREE.Vector3();
export class Ragdoll {
  // model: world.js の makeChar の戻り値。env: { groundAt(x,z), boxes }
  constructor(model, env, { dir = [0, 0, 1], impact = 30, head = false, strength = 1 } = {}) {
    this.model = model; this.env = env; this.sleeping = false; this.still = 0; this.acc = 0;
    model.g.updateMatrixWorld(true);
    const P = new Array(16);
    const at = (o, x = 0, y = 0, z = 0) => o.localToWorld(v().set(x, y, z));
    P[J.pelvis] = at(model.g, 0, 0.92, 0); P[J.chest] = at(model.g, 0, 1.25, 0); P[J.neck] = at(model.g, 0, 1.5, 0); P[J.head] = at(model.head, 0, 0.02, 0);
    for (const [s, A] of [['L', model.L], ['R', model.R]]) { P[J['sh' + s]] = at(A.sh); P[J['el' + s]] = at(A.el); P[J['hand' + s]] = at(A.el, 0, -0.29, 0); }
    model.legs.forEach((l, i) => { const s = i ? 'R' : 'L'; P[J['hip' + s]] = at(l.hip); P[J['knee' + s]] = at(l.knee); P[J['foot' + s]] = at(l.knee, 0, -0.43, 0); });
    this.p = P; this.q = P.map((x) => x.clone());
    this.bones = BONES.map(([a, b]) => [J[a], J[b], P[J[a]].distanceTo(P[J[b]])]);
    this.soft = SOFT.map(([a, b, k]) => [J[a], J[b], P[J[a]].distanceTo(P[J[b]]) * k]);
    // 近くの箱だけ当たり判定に使う
    const c = P[0]; this.boxes = (env.boxes || []).filter((b) => Math.abs(b.x - c.x) < b.w / 2 + 4 && Math.abs(b.z - c.z) < b.d / 2 + 4);
    // 被弾の力: 当たった高さほど強く (上半身を押す → ひざから崩れて、その向きへ倒れる)
    const f = Math.min(9, 2 + impact * 0.1) * strength, d = new THREE.Vector3(dir[0], 0, dir[2]).normalize();
    const hitY = head ? P[J.head].y : P[J.chest].y;
    P.forEach((p, i) => { const k = Math.max(0, 1 - Math.abs(p.y - hitY) / 1.4); const kick = d.clone().multiplyScalar(f * (0.25 + k)); this.q[i].addScaledVector(kick, -STEP); });
    this.q[J.kneeL].y += 0.02; this.q[J.kneeR].y += 0.02; // ひざが少し先に落ちる
    model.gun.visible = false; // 銃は手から離れる
    model.ragdoll = this;
  }
  // 苦しむ: level 0 (なし)〜1 (強い)。体を丸める・傷口を押さえる・寝返り・手をのばす・足をばたつかせる
  setWrithe(level, woundY = 1.15) { this.writhe = level; this.woundY = woundY; if (level) { this.sleeping = false; this.still = 0; } }
  muscle() {
    const p = this.p, w = this.writhe, c = p[J.chest], pel = p[J.pelvis];
    this.wt = (this.wt || 0) - STEP;
    if (this.wt <= 0) { this.wt = 0.3 + Math.random() * 0.7; this.pose = ['curl', 'clutch', 'clutch', 'roll', 'reach', 'kick', 'lift'][Math.floor(Math.random() * 7)]; this.side = Math.random() < 0.5 ? -1 : 1; }
    const pull = (i, t, k) => { p[i].x += (t.x - p[i].x) * k * w; p[i].y += (t.y - p[i].y) * k * w; p[i].z += (t.z - p[i].z) * k * w; };
    const wound = new THREE.Vector3().lerpVectors(pel, c, 0.55);
    // 手はいつも傷口のほうへ (押さえる)
    pull(J.handL, wound, 0.012); pull(J.handR, wound, this.pose === 'reach' ? 0 : 0.012);
    if (this.pose === 'curl') { pull(J.kneeL, c, 0.03); pull(J.kneeR, c, 0.03); pull(J.footL, pel, 0.02); pull(J.footR, pel, 0.02); pull(J.head, wound, 0.01); }
    if (this.pose === 'clutch') { pull(J.handL, wound, 0.05); pull(J.handR, wound, 0.05); pull(J.kneeL, c, 0.012); }
    if (this.pose === 'roll') { const r = new THREE.Vector3().subVectors(p[J.shR], p[J.shL]).normalize().multiplyScalar(0.004 * this.side * w); for (const i of [J.shL, J.shR, J.chest, J.neck, J.head]) { p[i].add(r); p[i].y += 0.002 * w; } }
    if (this.pose === 'reach') { p[J.handR].y += 0.012 * w; p[J.elR].y += 0.006 * w; }
    if (this.pose === 'kick') { const f = this.side > 0 ? J.footL : J.footR; p[f].y += 0.01 * w; pull(f, c, 0.015); }
    if (this.pose === 'lift') { p[J.head].y += 0.008 * w; p[J.neck].y += 0.004 * w; }
  }
  step(dt) {
    if (this.sleeping) return;
    this.acc += Math.min(dt, 0.05);
    let moved = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const { p, q } = this;
      for (let i = 0; i < 16; i++) { // ベルレ: 速さ = いま − まえ
        const a = p[i], b = q[i], vx = (a.x - b.x) * 0.985, vy = (a.y - b.y) * 0.985, vz = (a.z - b.z) * 0.985;
        b.copy(a); a.x += vx; a.y += vy + G * STEP * STEP; a.z += vz;
      }
      if (this.writhe) this.muscle();
      for (let it = 0; it < ITER; it++) {
        for (const [i, j, L] of this.bones) this.solve(i, j, L, 1);
        for (const [i, j, L] of this.soft) { const d = p[i].distanceTo(p[j]); if (d < L) this.solve(i, j, L, 0.5); }
        for (let i = 0; i < 16; i++) this.collide(i);
      }
      for (let i = 0; i < 16; i++) moved = Math.max(moved, p[i].distanceToSquared(q[i]));
    }
    // 止まったら計算をやめる
    if (!this.writhe && moved < 4e-6) { if (++this.still > 30) this.sleeping = true; } else this.still = 0; // 苦しんでいるあいだは止めない
    this.apply();
  }
  solve(i, j, L, k) {
    const a = this.p[i], b = this.p[j], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-6, diff = ((d - L) / d) * 0.5 * k;
    a.x += dx * diff; a.y += dy * diff; a.z += dz * diff; b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff;
  }
  collide(i) {
    const a = this.p[i], b = this.q[i], gY = this.env.groundAt(a.x, a.z) + R;
    if (a.y < gY) { a.y = gY; b.x = a.x - (a.x - b.x) * 0.55; b.z = a.z - (a.z - b.z) * 0.55; } // 地面の摩擦
    for (const x of this.boxes) {
      const hx = x.w / 2 + R, hz = x.d / 2 + R, top = x.y0 + x.h;
      if (a.y > top + R || Math.abs(a.x - x.x) > hx || Math.abs(a.z - x.z) > hz) continue;
      const ox = hx - Math.abs(a.x - x.x), oz = hz - Math.abs(a.z - x.z), oy = top + R - a.y;
      if (oy < ox && oy < oz) a.y = top + R; else if (ox < oz) a.x = x.x + Math.sign(a.x - x.x || 1) * hx; else a.z = x.z + Math.sign(a.z - x.z || 1) * hz;
    }
  }
  // 点の位置から、キャラクターの体・うで・足・頭の向きを決める
  apply() {
    const { p, model } = this, g = model.g;
    const up = v().subVectors(p[J.neck], p[J.pelvis]).normalize();
    const right = v().subVectors(p[J.shR], p[J.shL]); right.addScaledVector(up, -right.dot(up)).normalize();
    const back = v().crossVectors(right, up);
    const m = new THREE.Matrix4().makeBasis(right, up, back);
    g.quaternion.setFromRotationMatrix(m);
    g.position.copy(p[J.pelvis]).sub(v().set(0, 0.92, 0).applyQuaternion(g.quaternion));
    const gq = g.quaternion.clone(), inv = gq.clone().invert(), down = v().set(0, -1, 0), upv = v().set(0, 1, 0);
    const aim = (grp, parentQ, from, to, rest = down) => {
      const d = v().subVectors(p[to], p[from]).normalize().applyQuaternion(parentQ.clone().invert());
      grp.quaternion.setFromUnitVectors(rest, d);
      return parentQ.clone().multiply(grp.quaternion);
    };
    const cut = this.cut?.grp;
    for (const [s, A] of [['L', model.L], ['R', model.R]]) { const q1 = aim(A.sh, gq, J['sh' + s], J['el' + s]); if (A.el !== cut) aim(A.el, q1, J['el' + s], J['hand' + s]); }
    model.legs.forEach((l, i) => { const s = i ? 'R' : 'L'; const q1 = aim(l.hip, gq, J['hip' + s], J['knee' + s]); if (l.knee !== cut) aim(l.knee, q1, J['knee' + s], J['foot' + s]); });
    if (cut) { const { b, end } = this.cut; cut.position.copy(p[b]); cut.quaternion.setFromUnitVectors(down, v().subVectors(p[end], p[b]).normalize()); } // はなれた破片
    aim(model.head, gq, J.neck, J.head, upv); void inv;
  }
  pelvis() { return this.p[J.pelvis]; }
  point(name) { return this.p[J[name]]; }
  // 欠損: top (肩・ももの付け根) と joint (ひじ・ひざ) のあいだを切る。joint から先は別の破片として飛ぶ
  detach(top, joint, grp, scene) {
    const a = J[top], b = J[joint], end = b + 1;
    this.bones = this.bones.filter(([i, j]) => !((i === a && j === b) || (i === b && j === a)));
    this.soft = this.soft.filter(([i, j]) => !((i === a && j === end) || (i === end && j === a)));
    scene.attach(grp); this.cut = { b, end, grp };
    (this.model.cut ||= []).push(grp);
    for (const i of [b, end]) { this.q[i].x -= (Math.random() - 0.5) * 0.08; this.q[i].y -= 0.06; this.q[i].z -= (Math.random() - 0.5) * 0.08; }
    this.sleeping = false; this.still = 0;
  }
  stop() { this.sleeping = true; }
}

// 同時に動かすラグドールの数を制限する
export class RagdollManager {
  constructor(max = 6) { this.max = max; this.list = []; }
  add(r) { this.list.push(r); const awake = this.list.filter((x) => !x.sleeping); if (awake.length > this.max) awake[0].stop(); return r; }
  remove(r) { const i = this.list.indexOf(r); if (i >= 0) this.list.splice(i, 1); }
  step(dt) { for (const r of this.list) r.step(dt); }
  get awake() { return this.list.filter((x) => !x.sleeping).length; }
}
