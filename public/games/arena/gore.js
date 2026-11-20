// =====================================================================
// シティバトル: 血と欠損 (設定で ON/OFF。はじめは両方 ON)
//   ・被弾: 当たった向きへ血が飛び、地面に落ちるとしみになる (時間で消える・数に上限)
//   ・倒れた体の下に、血だまりが広がる
//   ・欠損: 致命的な被弾で、前うで・すねのどれかがラグドールから離れて飛ぶ (切り口は赤い)
//   ・しみや破片は数に上限をつけて、古いものから消す (メモリを残さない)
// =====================================================================
import * as THREE from './vendor/three.module.min.js';

const MAX_DROPS = 260, MAX_DECALS = 140, DECAL_MS = 45000;
export class Gore {
  constructor(scene, env) {
    this.scene = scene; this.env = env; this.blood = true; this.dismember = true;
    // 血のしぶき (まとめて 1 つ: InstancedMesh)
    this.dropMat = new THREE.MeshStandardMaterial({ color: '#5a0000', roughness: 0.3, metalness: 0.1 });
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.025, 0), this.dropMat, MAX_DROPS); this.drops.count = 0; this.drops.frustumCulled = false; scene.add(this.drops);
    this.dropData = []; this.m = new THREE.Matrix4(); this.o = new THREE.Object3D();
    // 地面のしみ: ふちがぎざぎざの赤い円 (1 枚の絵を使いまわす)
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = Math.random() * 40; g.fillStyle = `rgba(${90 + Math.random() * 40},0,0,${0.5 + Math.random() * 0.4})`; g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 8 + Math.random() * 18, 0, 7); g.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.decalMat = new THREE.MeshStandardMaterial({ map: tex, color: '#8a1010', transparent: true, depthWrite: false, roughness: 0.55, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2 }); // 空の映りこみで明るくなりすぎないよう、くすんだ赤
    this.decalGeo = new THREE.PlaneGeometry(1, 1); this.decals = [];
    this.stumpMat = new THREE.MeshStandardMaterial({ color: '#6b0d0d', roughness: 0.5 }); this.stumpGeo = new THREE.SphereGeometry(0.05, 10, 8);
  }
  // 血が飛ぶ: p (当たった所)、dir (弾の向き)、n (量)
  spray(p, dir, n = 14) {
    if (!this.blood) return;
    for (let i = 0; i < n; i++) {
      if (this.dropData.length >= MAX_DROPS) this.dropData.shift();
      const s = 1.5 + Math.random() * 3.5;
      this.dropData.push({ x: p[0], y: p[1], z: p[2], vx: dir[0] * s + (Math.random() - 0.5) * 1.6, vy: dir[1] * s + Math.random() * 1.8, vz: dir[2] * s + (Math.random() - 0.5) * 1.6, sz: 0.6 + Math.random() * 1.2 });
    }
  }
  splat(x, z, size, grow = 0) {
    if (!this.blood) return;
    if (this.decals.length >= MAX_DECALS) { const d = this.decals.shift(); this.scene.remove(d.mesh); d.mesh.material.dispose?.(); }
    const mat = this.decalMat.clone(); mat.opacity = 0.9;
    const mesh = new THREE.Mesh(this.decalGeo, mat); mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
    mesh.position.set(x, this.env.groundAt(x, z) + 0.006 + Math.random() * 0.003, z); mesh.scale.setScalar(grow ? 0.1 : size); this.scene.add(mesh);
    this.decals.push({ mesh, born: performance.now(), size, grow });
  }
  // 倒れた体の下の血だまり (4 秒かけて広がる)
  pool(x, z) { this.splat(x, z, 1.3 + Math.random() * 0.6, 4000); }
  // 欠損: ラグドールの前うで (ひじ) か、すね (ひざ) を切りはなす
  dismemberOn(model, rag, dir) {
    if (!this.dismember || !rag || rag.cut) return null;
    const parts = [['el', 'L'], ['el', 'R'], ['knee', 'L'], ['knee', 'R']], [kind, s] = parts[Math.floor(Math.random() * 4)];
    const grp = kind === 'el' ? model[s].el : model.legs[s === 'L' ? 0 : 1].knee;
    const top = kind === 'el' ? 'sh' + s : 'hip' + s, joint = (kind === 'el' ? 'el' : 'knee') + s;
    rag.detach(top, joint, grp, this.scene);
    // 切り口 (親のがわ) と、はなれたがわ
    const st = new THREE.Mesh(this.stumpGeo, this.stumpMat); st.position.y = kind === 'el' ? -0.29 : -0.44; (kind === 'el' ? model[s].sh : model.legs[s === 'L' ? 0 : 1].hip).add(st);
    const st2 = new THREE.Mesh(this.stumpGeo, this.stumpMat); grp.add(st2);
    rag.bleed = { joint, until: performance.now() + 2500 };
    void dir; return joint;
  }
  update(dt, rags) {
    // しぶき: 放物線で落ちて、地面でしみになる
    const keep = [];
    for (const d of this.dropData) {
      d.vy -= 14 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const gy = this.env.groundAt(d.x, d.z);
      if (d.y <= gy) { if (Math.random() < 0.35) this.splat(d.x, d.z, 0.12 + Math.random() * 0.22 * d.sz); } else keep.push(d);
    }
    this.dropData = keep;
    keep.forEach((d, i) => { this.o.position.set(d.x, d.y, d.z); this.o.scale.setScalar(d.sz); this.o.updateMatrix(); this.drops.setMatrixAt(i, this.o.matrix); });
    this.drops.count = keep.length; this.drops.instanceMatrix.needsUpdate = true;
    // 切り口から少し血が出る
    for (const r of rags || []) if (r.bleed && performance.now() < r.bleed.until && Math.random() < 0.5) { const p = r.point(r.bleed.joint); this.spray([p.x, p.y, p.z], [0, 0.2, 0], 1); }
    // しみ: 広がる・時間で消える
    const now = performance.now();
    this.decals = this.decals.filter((d) => {
      const age = now - d.born;
      if (d.grow && age < d.grow) d.mesh.scale.setScalar(0.1 + (d.size - 0.1) * (age / d.grow));
      if (age > DECAL_MS) { d.mesh.material.opacity -= dt * 0.3; if (d.mesh.material.opacity <= 0) { this.scene.remove(d.mesh); d.mesh.material.dispose(); return false; } }
      return true;
    });
  }
  clear() { for (const d of this.decals) { this.scene.remove(d.mesh); d.mesh.material.dispose(); } this.decals = []; this.dropData = []; }
}
