// =====================================================================
// シティバトル: 車の表示 (パトカー・救急車・乗れる一般車)。動きはサーバー (arena-traffic.js)
//   ・サーバーの位置になめらかに追いつく。自分が運転している車だけは、この端末の位置 (local) を使う
//   ・ホイールが回る・前輪が曲がる・赤色灯が点めつ・サイレンの音 (近いときだけ)
//   ・見えない車 (待機中の救急車) は描かない
// =====================================================================
const KINDS = ['civ', 'police', 'ambulance'], LEN = { civ: 1.35, police: 1.4, ambulance: 1.75 }, CAR_R = 1.05;

export class VehicleView {
  constructor({ GFX, sound }) { Object.assign(this, { GFX, sound }); this.list = new Map(); }
  init(list) {
    for (const v of list) {
      if (this.list.has(v.id)) continue;
      const kind = KINDS[v.k] || 'civ', model = this.GFX.makeVehicle(kind, v.color || '#c92a2a');
      for (const w of model.wheels) w.rotation.order = 'YXZ';
      model.g.visible = false;
      this.list.set(v.id, { id: v.id, kind, model, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0, sp: 0, flags: 1, driver: 0, seen: false, steer: 0 });
    }
  }
  get(id) { return this.list.get(id); }
  snapshot(rows) {
    for (const [id, x, z, yaw, sp, flags, driver] of rows) {
      const o = this.list.get(id); if (!o) continue;
      Object.assign(o, { flags, driver: driver || 0 });
      if (o.local) continue;
      Object.assign(o, { tx: x, tz: z, tyaw: yaw, sp });
      if (!o.seen || (flags & 1)) { o.x = x; o.z = z; o.yaw = yaw; o.seen = true; } // 見えないあいだは、すぐその場所へ (出てきたときに飛ばない)
    }
  }
  // 当たりの円 (歩くとき・運転するときにぶつかる)。except: 自分の車
  circles(except) {
    const out = [];
    for (const o of this.list.values()) { if (o.id === except || (o.flags & 1) || !o.seen) continue; const fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), L = LEN[o.kind]; for (const k of [-L, 0, L]) out.push({ x: o.x + fx * k, z: o.z + fz * k, r: CAR_R }); }
    return out;
  }
  // 乗れる車 (一般車・だれも運転していない・近い)
  enterable(x, z, r = 4.1) { let best = null, bd = r * r; for (const o of this.list.values()) { if (o.kind !== 'civ' || o.driver || (o.flags & 1) || !o.seen) continue; const d = (o.x - x) ** 2 + (o.z - z) ** 2; if (d < bd) { bd = d; best = o; } } return best; }
  update(dt, now) {
    const k = 1 - Math.exp(-dt * 10);
    for (const o of this.list.values()) {
      const g = o.model.g, hidden = !!(o.flags & 1);
      g.visible = !hidden && o.seen; if (hidden) continue;
      if (!o.local) {
        // 送られてくる間 (0.1 秒) のぶん、速さで先へ進めてから追いつく
        o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
        let dy = o.tyaw - o.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); o.steer = o.steer * 0.8 + Math.max(-0.5, Math.min(0.5, dy * 6)) * 0.2; o.yaw += dy * k;
      }
      g.position.set(o.x, 0, o.z); g.rotation.y = o.yaw;
      for (const w of o.model.wheels) w.rotation.x -= (o.sp / 0.36) * dt;
      for (const w of o.model.front) w.rotation.y = o.steer || 0;
      // 赤色灯: 左右がかわるがわる光る
      if (o.model.bar.length) { const on = !!(o.flags & 4), ph = Math.floor(now / 180) % 2; o.model.bar.forEach((m, i) => { m.emissiveIntensity = on ? (i === ph ? 6 : 0.4) : 0.2; }); }
      if (o.flags & 2) this.sound.play('siren', o.x, o.z, { id: o.id, kind: o.kind });
    }
  }
}
