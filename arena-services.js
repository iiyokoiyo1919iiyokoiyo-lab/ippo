// =====================================================================
// シティバトル: 警察と救急 (共通の事件管理 arena-incidents.js を使う)
//   警察 (パトカー 3 台・警官 2 人ずつ)
//     Patrolling (巡回) → Dispatching (出動準備) → Responding (現場へ。道路を走る) → Investigating (現場確認)
//     → Securing (まわりの安全確保・人を遠ざける) → Returning (車にもどって巡回へ)
//     ・1 つの事件に最大 2 台 (重い事件だけ 2 台)。止める場所をずらす。ほかの事件があれば、空いている車を先にそちらへ
//   救急 (救急車 2 台・隊員 2 人ずつ)
//     Available (待機・マップの外) → Dispatched (出動決定) → Driving (外周から入って現場へ) → Arrived (到着)
//     → Departing (外周へ出ていく → 待機へ)
//     ・到着したら安全を確かめてから (銃声などが 5 秒ない) けが人に近づき、処置 → 担架で救急車へ運ぶ
//     ・1 つの事件に 1 台だけ (incident.ems)。けが人は 1 台で 2 人まで (残りは、次に空いた救急車)
//   ・警官・隊員がやられたら、次の巡回/待機のときに新しい人が入る
//   ・プレイヤーから遠い車は簡易処理 (まわりを見ない)
// =====================================================================
const Body = require('./arena-body');

const POLICE_UNITS = 3, AMBULANCES = 2;
const rand = (a, b) => a + Math.random() * (b - a);

class Services {
  constructor({ npcs, traffic, incidents, cfg, send }) {
    Object.assign(this, { npcs, traffic, incidents, cfg, send });
    this.police = []; this.ems = []; this.log = [];
    const pick = () => this.traffic.nodes[Math.floor(Math.random() * this.traffic.nodes.length)];
    for (let k = 0; k < POLICE_UNITS; k++) {
      const n = pick(), v = this.traffic.add('police', n.x, n.z, 0, { color: '#f8f9fa' });
      const u = { id: 'P' + (k + 1), v, crew: [], state: 'patrolling', inc: null, at: 0, slot: 0 };
      this.police.push(u); this.crew(u, 'police'); this.patrol(u);
    }
    for (let k = 0; k < AMBULANCES; k++) {
      const v = this.traffic.add('ambulance', 0, 0, 0, { hidden: true, color: '#ffffff' });
      const a = { id: 'A' + (k + 1), v, crew: [], state: 'available', inc: null, at: 0, victims: [], load: [] };
      this.ems.push(a); this.crew(a, 'medic');
    }
  }
  note(text) { this.log.unshift(`${new Date().toISOString().slice(11, 19)} ${text}`); this.log.length = Math.min(this.log.length, 30); }
  // 乗っている人をそろえる (やられた人は入れかえ)
  crew(u, role) {
    u.crew = u.crew.filter((n) => !n.gone && Body.canMove(n.body));
    while (u.crew.length < 2) { const n = this.npcs.spawnRole(role, u.v.x, u.v.z); u.crew.push(n); }
    for (const n of u.crew) this.board(u, n);
  }
  board(u, n) { n.hidden = true; n.x = u.v.x; n.z = u.v.z; n.mode = 'walking'; }
  // 降りる: 車の左右のドアから (右 = (-fz, fx))
  unboard(u, n, k) { const fx = -Math.sin(u.v.yaw), fz = -Math.cos(u.v.yaw), side = k ? 1 : -1; n.hidden = false; n.x = u.v.x - fz * side * 1.6 + fx * 0.4; n.z = u.v.z + fx * side * 1.6 + fz * 0.4; n.mode = 'walking'; n.y = 0; }
  patrol(u) { const n = this.traffic.nodes[Math.floor(Math.random() * this.traffic.nodes.length)]; this.traffic.plan(u.v, n.x, n.z); u.v.siren = false; u.v.lights = false; }
  // 遠い車は簡易処理 (まわりを見ない)
  far(v, players) { for (const p of players) if ((p.x - v.x) ** 2 + (p.z - v.z) ** 2 < 120 * 120) return false; return true; }
  obstacles(v, players) {
    const out = [];
    for (const p of players) if (!p.car && (p.x - v.x) ** 2 + (p.z - v.z) ** 2 < 144) out.push(p);
    if (this.npcs.near) for (const n of this.npcs.near(v.x, v.z, 12)) if (!n.hidden && !n.carriedBy) out.push(n);
    return out;
  }
  update(now, dt, players) {
    this.dispatch(now);
    for (const u of this.police) this.policeStep(u, now, dt, players);
    for (const a of this.ems) this.emsStep(a, now, dt, players);
  }
  // ---------- 出動の割り当て (共通の事件管理から) ----------
  dispatch(now) {
    const inc = [...this.incidents.list.values()].filter((e) => !e.closed).sort((a, b) => b.sev - a.sev || a.createdAt - b.createdAt);
    const free = () => this.police.filter((u) => (u.state === 'patrolling' || u.state === 'returning') && u.crew.some((n) => !n.gone && Body.canMove(n.body)));
    // 1 周目: どの事件にも 1 台。2 周目: 重い事件 (3 以上) にもう 1 台
    for (const round of [1, 2]) for (const e of inc) {
      if (this.incidents.calm(e, now)) continue;
      const want = round === 1 ? 1 : e.sev >= 3 ? 2 : 1;
      if (e.police.size >= want) continue;
      const list = free(); if (!list.length) break;
      const u = list.reduce((b, c) => ((c.v.x - e.x) ** 2 + (c.v.z - e.z) ** 2 < (b.v.x - e.x) ** 2 + (b.v.z - e.z) ** 2 ? c : b));
      if (u.state === 'returning') { for (const n of u.crew) if (!n.gone && n.hidden === false) this.board(u, n); } // 引き上げ中なら、そのまま次へ
      u.inc = e.id; u.slot = e.police.size; e.police.add(u.id); u.state = 'dispatching'; u.at = now + 1500; u.v.siren = true; u.v.lights = true;
      this.note(`${u.id} 出動準備 → ${e.id} (${e.type})`);
    }
    // 救急: けが人がいて、まだ救急車のない事件に 1 台
    for (const e of inc) {
      if (e.ems || !this.incidents.pendingVictims(e).length) continue;
      const a = this.ems.find((x) => x.state === 'available'); if (!a) break;
      a.inc = e.id; e.ems = a.id; a.state = 'dispatched'; a.at = now + 1500; a.victims = []; a.load = [];
      this.note(`${a.id} 出動決定 → ${e.id}`);
    }
  }
  incOf(u) { return u.inc ? this.incidents.list.get(u.inc) : null; }
  // 止める場所: 事件のそばの道路。何台目かで前後にずらす
  parkSpot(e, slot) {
    const p = this.traffic.roadPoint(e.x, e.z), along = slot === 0 ? 0 : slot === 1 ? 8 : -8;
    const onVertical = this.traffic.nodes.some((n) => Math.abs(n.x - p.x) < 0.01); // x が道の線の上 → z の向きにずらす
    return onVertical ? { x: p.x, z: p.z + along } : { x: p.x + along, z: p.z };
  }
  // ---------- 警察 ----------
  policeStep(u, now, dt, players) {
    const v = u.v, e = this.incOf(u), far = this.far(v, players), crew = u.crew.filter((n) => !n.gone);
    const drive = (cruise) => this.traffic.drive(v, dt, { cruise, obstacles: far ? [] : this.obstacles(v, players), far });
    const inCar = () => crew.every((n) => n.hidden || !Body.canMove(n.body));
    // 事件がなくなった (閉じた) ら引き上げ
    if (u.inc && !e && !['patrolling', 'returning'].includes(u.state)) { u.state = 'returning'; u.inc = null; this.note(`${u.id} 引き上げ`); }
    switch (u.state) {
      case 'patrolling':
        if (!crew.length || crew.some((n) => !Body.canMove(n.body))) this.crew(u, 'police');
        if (v.arrived) this.patrol(u);
        drive(7.5); break;
      case 'dispatching':
        drive(0);
        if (now >= u.at) { const s = this.parkSpot(e, u.slot); this.traffic.plan(v, s.x, s.z); u.state = 'responding'; u.at = now; this.note(`${u.id} 現場へ (${e.id})`); }
        break;
      case 'responding':
        drive(14);
        if (v.arrived || (now - u.at > 45000 && Math.abs(v.speed) < 0.5)) { // 着いた (つまって動けないときも、そこで降りる)
          v.speed = 0; crew.forEach((n, k) => { if (Body.canMove(n.body)) this.unboard(u, n, k); });
          u.state = 'investigating'; u.at = now; u.warnAt = 0; this.note(`${u.id} 現場確認 (${e.id})`);
        }
        break;
      case 'investigating': { // 事件の場所のまわりを確かめる
        crew.forEach((n, k) => {
          const a = (u.slot * 2 + k) * 1.7, tx = e.x + Math.cos(a) * 3, tz = e.z + Math.sin(a) * 3;
          const there = this.npcs.walkTo(n, tx, tz, 2.2, dt, players);
          n.mode = there ? 'alert' : 'walking'; if (there) n.yaw = Math.atan2(-(e.x - n.x), -(e.z - n.z));
        });
        if (now >= u.warnAt) { u.warnAt = now + 3000; this.npcs.warn(e.x, e.z, 16, now); crew.forEach((n) => { if (!n.hidden) n.mode = 'warn'; }); }
        if (now - u.at > 9000) { u.state = 'securing'; u.at = now; this.note(`${u.id} 安全確保 (${e.id})`); }
        break;
      }
      case 'securing': { // まわりに立って、人を近づけない
        crew.forEach((n, k) => {
          const a = (u.slot * 2 + k) * (Math.PI / 2) + 0.4, tx = e.x + Math.cos(a) * 9, tz = e.z + Math.sin(a) * 9;
          if (this.npcs.walkTo(n, tx, tz, 1.8, dt, players)) { n.yaw = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI; n.mode = now % 6000 < 1500 ? 'warn' : 'alert'; } else n.mode = 'walking';
        });
        if (now >= u.warnAt) { u.warnAt = now + 4000; this.npcs.warn(e.x, e.z, 12, now); }
        const victimsBusy = this.incidents.pendingVictims(e).length || e.ems;
        if (this.incidents.calm(e, now) && !victimsBusy && now - u.at > 10000) { u.state = 'returning'; e.police.delete(u.id); u.inc = null; u.at = now; v.siren = false; v.lights = false; this.note(`${u.id} 巡回へもどる`); }
        break;
      }
      case 'returning': { // 車へもどって乗る → 巡回
        v.siren = false; v.lights = false;
        crew.forEach((n) => { if (!n.hidden && Body.canMove(n.body)) { if (this.npcs.walkTo(n, v.x, v.z, 2.4, dt, players, 1.2)) this.board(u, n); else n.mode = 'walking'; } });
        if (inCar() || now - u.at > 30000) { crew.forEach((n) => { if (!n.hidden && Body.canMove(n.body)) this.board(u, n); }); u.state = 'patrolling'; this.patrol(u); }
        else drive(0);
        break;
      }
    }
    for (const n of crew) if (n.hidden) { n.x = v.x; n.z = v.z; } // 乗っている人は車といっしょ
  }
  // ---------- 救急 ----------
  emsStep(a, now, dt, players) {
    const v = a.v, e = this.incOf(a), far = this.far(v, players), crew = a.crew.filter((n) => !n.gone);
    const drive = (cruise) => this.traffic.drive(v, dt, { cruise, obstacles: far ? [] : this.obstacles(v, players), far });
    const finish = () => { if (e) { e.ems = null; } a.inc = null; };
    switch (a.state) {
      case 'available': v.hidden = true; v.siren = false; v.lights = false; break;
      case 'dispatched':
        if (now >= a.at) {
          if (!e) { a.state = 'available'; a.inc = null; break; }
          this.crew(a, 'medic');
          const n = this.traffic.edgeNode(e.x, e.z); // 外周の道から入ってくる
          Object.assign(v, { x: n.x, z: n.z, yaw: 0, speed: 0, hidden: false, siren: true, lights: true });
          const s = this.parkSpot(e, 2); this.traffic.plan(v, s.x, s.z); a.state = 'driving'; a.at = now; this.note(`${a.id} 現場へ (${e.id})`);
        }
        break;
      case 'driving':
        drive(13);
        if (!e) { this.leave(a, now); break; }
        if (v.arrived || (now - a.at > 50000 && Math.abs(v.speed) < 0.5)) { v.speed = 0; a.state = 'arrived'; a.sub = 'check'; a.at = now; this.note(`${a.id} 到着・安全確認 (${e.id})`); }
        break;
      case 'arrived': this.arrived(a, e, crew, now, dt, players); break;
      case 'departing':
        drive(12);
        if (v.arrived) { v.hidden = true; v.siren = false; a.state = 'available'; a.at = now; this.note(`${a.id} 退出 → 待機`); }
        break;
    }
    for (const n of crew) if (n.hidden) { n.x = v.x; n.z = v.z; }
  }
  // 到着してから: 安全確認 → 降りる → けが人へ → 処置 → 運ぶ → 乗せる → (次の人) → 出発
  arrived(a, e, crew, now, dt, players) {
    const v = a.v;
    if (!e) { this.backToCar(a, crew, now, dt, players); return; }
    const alive = crew.filter((n) => Body.canMove(n.body));
    if (!alive.length) { e.ems = null; a.inc = null; this.leave(a, now); return; } // 隊員がやられた → 引き上げ (次の救急車が来る)
    if (a.sub === 'check') { // 危険がおさまるまで車の中で待つ
      if (this.incidents.safe(e, now) && now - a.at > 1500) { alive.forEach((n, k) => this.unboard(a, n, k)); a.sub = 'go'; this.note(`${a.id} 安全確認できた・けが人へ`); }
      return;
    }
    if (!this.incidents.safe(e, now) && a.sub !== 'carry') { alive.forEach((n) => { if (!n.hidden) this.npcs.walkTo(n, v.x, v.z, 3, dt, players, 1.5); }); return; } // また危なくなったら車のそばへ
    if (a.sub === 'go') {
      if (!a.victim) {
        const ids = this.incidents.pendingVictims(e);
        const next = ids.map((id) => this.npcs.npcs.get(id)).find((n) => n && !n.carriedBy);
        for (const id of ids) if (!this.npcs.npcs.get(id)) e.victims.delete(id); // 消えた人は外す
        if (!next || a.load.length >= 2) { a.sub = 'back'; return; }
        a.victim = next; a.goAt = now; e.victims.set(next.id, 'treating');
      }
      const t = a.victim, [m1, m2] = alive;
      const r1 = this.npcs.walkTo(m1, t.x + 0.7, t.z, 2.6, dt, players, 0.4) || Math.hypot(m1.x - t.x, m1.z - t.z) < 1.3, r2 = !m2 || this.npcs.walkTo(m2, t.x - 0.7, t.z, 2.6, dt, players, 0.4) || Math.hypot(m2.x - t.x, m2.z - t.z) < 1.3;
      if (!(r1 && r2) && now - a.goAt > 25000) { // 近づけない (壁のすき間など): あきらめて次へ
        if (Math.hypot(m1.x - t.x, m1.z - t.z) > 2.5) { e.victims.delete(t.id); t.awaitEMS = false; a.victim = null; this.note(`${a.id} けが人に近づけない (${t.id})`); return; }
      }
      if ((r1 && r2) || now - a.goAt > 25000) { a.sub = 'treat'; a.at = now; alive.forEach((n) => { n.mode = 'treat'; n.yaw = Math.atan2(-(t.x - n.x), -(t.z - n.z)); }); this.note(`${a.id} 処置中 (${t.id})`); }
      return;
    }
    if (a.sub === 'treat') {
      if (now - a.at > 4000) { a.sub = 'carry'; a.victim.carriedBy = alive[0].id; alive.forEach((n) => { n.mode = 'carry'; }); this.note(`${a.id} 搬送 (${a.victim.id})`); }
      return;
    }
    if (a.sub === 'carry') { // 担架で救急車の後ろへ
      const t = a.victim, [m1, m2] = alive, bx = v.x + Math.sin(v.yaw) * 3.2, bz = v.z + Math.cos(v.yaw) * 3.2;
      const there = this.npcs.walkTo(m1, bx, bz, 1.5, dt, players, 0.6);
      if (m2) { const fx = -Math.sin(m1.yaw), fz = -Math.cos(m1.yaw); m2.x = m1.x - fx * 1.9; m2.z = m1.z - fz * 1.9; m2.yaw = m1.yaw; }
      t.x = m1.x + Math.sin(m1.yaw) * 0.95; t.z = m1.z + Math.cos(m1.yaw) * 0.95; t.yaw = m1.yaw; // 2 人のあいだ (担架の上)
      if (there) { // 乗せた: けが人はマップから消える (救急車の中)
        e.victims.set(t.id, 'loaded'); a.load.push(t.id); this.npcs.remove(t); a.victim = null; a.sub = 'go';
        alive.forEach((n) => { n.mode = 'walking'; }); this.note(`${a.id} 収容 (${t.id})`);
      }
      return;
    }
    if (a.sub === 'back') this.backToCar(a, crew, now, dt, players);
  }
  backToCar(a, crew, now, dt, players) {
    const v = a.v; let all = true;
    for (const n of crew) { if (n.hidden || !Body.canMove(n.body)) continue; n.mode = 'walking'; if (this.npcs.walkTo(n, v.x, v.z, 2.6, dt, players, 1.2)) this.board(a, n); else all = false; }
    if (all) { const e = this.incOf(a); if (e) e.ems = null; a.inc = null; this.leave(a, now); }
  }
  // マップの外へ (いちばん近い外周の交差点 → 壁ぎわで消える)
  leave(a, now) {
    const v = a.v, n = this.traffic.edgeNode(v.x, v.z);
    for (const c of a.crew) if (!c.gone && Body.canMove(c.body)) this.board(a, c);
    if (a.victim) { a.victim.carriedBy = null; a.victim = null; }
    this.traffic.plan(v, n.x, n.z); v.siren = false; v.lights = true; a.state = 'departing'; a.at = now; this.note(`${a.id} 現場から退出`);
  }
  debug() {
    return {
      police: this.police.map((u) => ({ id: u.id, state: u.state, inc: u.inc, x: Math.round(u.v.x), z: Math.round(u.v.z), crew: u.crew.filter((n) => !n.gone).length })),
      ems: this.ems.map((a) => ({ id: a.id, state: a.state, sub: a.sub || '', inc: a.inc, x: Math.round(a.v.x), z: Math.round(a.v.z), load: a.load.length })),
      log: this.log.slice(0, 12),
    };
  }
}
module.exports = { Services, POLICE_UNITS, AMBULANCES };
void rand;
