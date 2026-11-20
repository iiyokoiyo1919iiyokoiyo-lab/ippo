// =====================================================================
// シティバトル: 通行人の表示 (動きの判断はサーバーの arena-npc.js)
//   ・近づいたらモデルを作り、遠くなったら捨てる (メモリを残さない)。通行人は軽い形 (lod: low)
//   ・遠いほど更新をまびく (45m まで毎回・90m まで 2 回に 1 回・それより遠いと 4 回に 1 回)。130m より遠いと描かない
//   ・行動: 歩く・異常に気づく (止まって向く)・逃げる (うでを上げて走る)・隠れる (しゃがむ)
//   ・倒れたら (体の状態が転倒・行動不能・死亡) 歩行の動きを止めて、ラグドール (近いときだけ) か、横たわる姿勢
//   ・警官 (紺の制服・帽子)・救急隊員 (白)。車に乗っているあいだは見えない (flags 1)
//   ・手を上げる (強盗)・処置 (しゃがんで胸を押す)・注意の合図・担架で運ぶ / 運ばれる人は担架の上に横たわる (flags 2)
// =====================================================================
import { Ragdoll } from './ragdoll.js?v=3';

const ROLE = { police: { color: '#22325a', cap: '#1a2440' }, medic: { color: '#eef1f4' } };
const CLOTHES = ['#6c757d', '#1c3d5a', '#8d6e63', '#495057', '#b08968', '#2f4858', '#7f5539', '#e9ecef', '#5c677d', '#9c6644', '#386641', '#6d597a'];
const SHOW = 130, KEEP = 170;
export class NpcView {
  constructor({ GFX, ragdolls, env, gore, sound, settings }) {
    Object.assign(this, { GFX, ragdolls, env, gore, sound, settings });
    this.list = new Map(); this.frame = 0; this.stats = { visible: 0, models: 0, ms: 0 };
  }
  add(n) {
    if (this.list.has(n.id)) return;
    this.list.set(n.id, { id: n.id, seed: n.seed, x: n.x, z: n.z, tx: n.x, tz: n.z, yaw: n.yaw, m: n.m || 0, s: n.s || 0, inj: n.inj || 0, r: n.r || '', f: n.f || 0, model: null, acc: 0, pitch: 0.85 + ((n.seed >>> 4) % 50) / 100 });
  }
  remove(id) { const o = this.list.get(id); if (!o) return; this.drop(o); this.list.delete(id); }
  clear() { for (const id of [...this.list.keys()]) this.remove(id); }
  drop(o) { if (o.stretcher) { this.GFX.scene.remove(o.stretcher); o.stretcher = null; } if (!o.model) return; if (o.rag) this.ragdolls.remove(o.rag); o.rag = null; this.GFX.disposeChar(o.model); o.model = null; }
  snapshot(rows) {
    for (const [id, x, z, yaw, m, s, inj = 0, f = 0] of rows) {
      const o = this.list.get(id); if (!o) continue;
      const was = o.s; Object.assign(o, { tx: x, tz: z, yaw, m, s, inj, f });
      if (f & 1) { o.x = x; o.z = z; } // 車の中: 降りたときにその場所から
      if (o.rag && was !== s) o.rag.setWrithe(s === 3 ? 1 : s === 2 ? 0.45 : 0); // 行動不能は強く苦しむ・転倒は少し・死亡で止まる
      if (o.model && was >= 2 && s < 2) this.getUp(o);
      if (o.model && was < 2 && s >= 2 && !o.rag) this.fall(o, null);
    }
  }
  pos(id) { const o = this.list.get(id); return o ? { x: o.x, z: o.z } : null; }
  // 倒れる: ラグドールが使えるなら物理、だめなら横たわる姿勢
  fall(o, hit) {
    if (!o.model) return;
    const near = Math.hypot(o.x - this.env.cam.x, o.z - this.env.cam.z) < 60;
    if (this.settings.local.ragdoll && near) {
      o.rag = this.ragdolls.add(new Ragdoll(o.model, this.env, { dir: hit?.dir || [Math.sin(o.yaw), 0, Math.cos(o.yaw)], impact: hit?.impact || 25, head: hit?.head, strength: this.settings.local.reaction }));
      const lvl = o.s === 3 ? 1 : o.s === 2 ? 0.45 : 0; if (lvl && !hit?.head) setTimeout(() => o.rag?.setWrithe(o.s === 3 ? 1 : o.s === 2 ? 0.45 : 0), 900); // 倒れきってから苦しみだす (頭は即死に近いので動かない)
    } else { o.model.g.rotation.x = -Math.PI / 2; o.model.g.position.y = 0.2; }
    this.sound.play('fall', o.x, o.z);
    if (this.gore) this.gore.pool(o.x + (hit?.dir?.[0] || 0) * 0.6, o.z + (hit?.dir?.[2] || 0) * 0.6);
  }
  getUp(o) { if (o.rag) { this.ragdolls.remove(o.rag); o.rag = null; } this.GFX.restPose(o.model); o.model.g.rotation.set(0, o.yaw, 0); o.model.rise = performance.now(); }
  onHit(msg) {
    const o = this.list.get(msg.to); if (!o) return;
    const h = { x: o.x, y: msg.head ? 1.6 : 1.15, z: o.z };
    this.sound.play('flesh', o.x, o.z);
    if (this.gore) this.gore.spray([h.x, h.y, h.z], msg.dir || [0, 0, 1], msg.res === 'incap' ? 26 : 12);
    if (!o.model) { o.s = msg.res === 'stagger' ? 1 : msg.res === 'down' ? 2 : 3; return; }
    if (msg.res === 'stagger') { this.GFX.react(o.model, msg.dir || [0, 0, 1], this.settings.local.reaction); return; }
    o.s = msg.res === 'down' ? 2 : 3;
    if (!o.rag) this.fall(o, msg);
    if (msg.res === 'incap' && o.rag && this.settings.local.dismember && this.gore) this.gore.dismemberOn(o.model, o.rag, msg.dir);
  }
  fx(msg) {
    const o = this.list.get(msg.id); if (!o) return;
    this.sound.play(msg.k, o.x, o.z, { id: msg.id, pitch: o.pitch });
    if (o.model && msg.k === 'gasp') { this.GFX.react(o.model, [Math.sin(o.yaw), 0, Math.cos(o.yaw)], 0.6, 380); }
    if (msg.k === 'scream') o.panicUntil = performance.now() + 6000;
  }
  update(now, dt, cam) {
    const t0 = performance.now(); this.frame++;
    let vis = 0, models = 0, made = 0;
    const k = 1 - Math.exp(-dt * 10);
    for (const o of this.list.values()) {
      const d = Math.hypot(o.tx - cam.x, o.tz - cam.z);
      if (d > KEEP) { this.drop(o); o.x = o.tx; o.z = o.tz; continue; }
      if (!o.model && d < SHOW && made < 3) { // 1 フレームに 3 体まで作る (一度にたくさん作ると、かくっとなる)
        made++;
        const R = ROLE[o.r];
        o.model = this.GFX.makeChar(R ? R.color : CLOTHES[o.seed % CLOTHES.length], '', false, o.seed, { npc: true, lod: 'low', cap: R?.cap });
        o.x = o.tx; o.z = o.tz; o.model.g.position.set(o.x, 0, o.z); o.model.g.rotation.y = o.yaw;
        if (o.s >= 2) { o.model.g.rotation.x = -Math.PI / 2; o.model.g.position.y = 0.2; }
      }
      if (!o.model) continue;
      models++;
      if (o.f & 1) { o.model.g.visible = false; continue; } // 車に乗っている
      o.model.g.visible = d < SHOW; if (d < SHOW) vis++;
      if (o.f & 2) { // 担架で運ばれている: 横たわって、隊員といっしょに動く
        if (o.rag) { this.ragdolls.remove(o.rag); o.rag = null; this.GFX.restPose(o.model); }
        if (!o.stretcher) o.stretcher = this.GFX.makeStretcher();
        const g = o.model.g, kk = 1 - Math.exp(-dt * 12); o.x += (o.tx - o.x) * kk; o.z += (o.tz - o.z) * kk;
        g.rotation.set(-Math.PI / 2, o.yaw, 0, 'YXZ'); g.position.set(o.x, 0.98, o.z); o.stretcher.position.set(o.x, 0.82, o.z); o.stretcher.rotation.y = o.yaw;
        continue;
      }
      // 倒れて苦しんでいる人: うめき声・血 (近いときだけ)
      if ((o.s === 2 || o.s === 3) && d < 35 && (o.groanAt || 0) < now) { o.groanAt = now + 1800 + Math.random() * 2600; this.sound.play('groan', o.x, o.z, { id: o.id, pitch: o.pitch, k: o.s === 3 ? 1 : 0.7 }); if (this.gore && o.rag && o.s === 3) { const c = o.rag.pelvis(); this.gore.splat(c.x + (Math.random() - 0.5) * 0.6, c.z + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.3); } }
      if (o.rag || o.s >= 2) continue; // 倒れているあいだは歩行の動きをしない
      // 遠いほど、まびいて更新
      o.acc += dt; const every = d < 45 ? 1 : d < 90 ? 2 : 4;
      if (this.frame % every) continue;
      const step = o.acc; o.acc = 0;
      const g = o.model.g, kk = 1 - Math.exp(-step * 10);
      o.x += (o.tx - o.x) * kk; o.z += (o.tz - o.z) * kk; g.position.x = o.x; g.position.z = o.z;
      let dy = o.yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.rotation.y += dy * kk;
      o.model.crouch = (o.m === 3 && Math.hypot(o.tx - o.x, o.tz - o.z) < 0.15) || o.m === 5;
      o.model.handsUp = o.m === 4; o.model.treat = o.m === 5; o.model.warn = o.m === 6; o.model.carry = o.m === 7;
      o.model.panic = o.m === 2 && (o.panicUntil || 0) > now && !o.inj;
      o.model.limp = !!o.inj;
      if (o.inj && this.gore && (o.dripAt || 0) < now && d < 40) { o.dripAt = now + 500 + Math.random() * 700; this.gore.splat(o.x + (Math.random() - 0.5) * 0.3, o.z + (Math.random() - 0.5) * 0.3, 0.08 + Math.random() * 0.1); } // 血を落としながら歩く
      if (o.inj && d < 25 && (o.groanAt || 0) < now) { o.groanAt = now + 4000 + Math.random() * 4000; this.sound.play('groan', o.x, o.z, { id: o.id, pitch: o.pitch, k: 0.6 }); }
      o.model.baseY = 0; this.GFX.animateChar(o.model, now, step, this.GFX.curbAt(o.x, o.z));
      void k;
    }
    this.stats = { visible: vis, models, ms: performance.now() - t0, total: this.list.size };
  }
}
