// =====================================================================
// シティバトル: 事件の管理 (警察・救急・群衆パニックで共通)
//   ・事件を登録する (銃声・暴行・けが人・強盗・事故・テスト)。近く (22m・90 秒いない) の事件は 1 つにまとめる
//   ・街を 6×6 のエリアに分けて「熱さ」をためる → パニックレベル 0 (平常)〜4 (パニック)。時間で冷める
//   ・けが人 (行動不能の通行人) は「救急が必要」として記録する。救急車は 1 つの事件に 1 台だけ (ems)
//   ・しばらく何も起きなければ「落ち着いた」(calm)。けが人を運び終えて、警察が引き上げたら閉じる
//   ・同時にいくつも起きてよい (上限 MAX)。遠くでもサーバーが同じように管理する
// =====================================================================
const M = require('./public/games/arena/arena-map.js');

const GRID = 6, CELL = M.SIZE / GRID, MERGE_R = 22, MERGE_MS = 90000, MAX = 16;
const SEV = { shots: 1, assault: 2, down: 2, injury: 3, robbery: 2, crash: 2, officer: 3, test: 3 };
const HEAT = [0, 3, 9, 18, 32]; // この熱さ以上でレベル 1〜4
const LEVEL_NAME = ['平常', '警戒', '不安', '混乱', 'パニック'];

class Incidents {
  constructor(cfg) {
    this.cfg = cfg; this.list = new Map(); this.seq = 0;
    this.heat = new Float32Array(GRID * GRID);
  }
  cellOf(x, z) { const i = Math.max(0, Math.min(GRID - 1, Math.floor((x + M.HALF) / CELL))), j = Math.max(0, Math.min(GRID - 1, Math.floor((z + M.HALF) / CELL))); return i * GRID + j; }
  levelAt(x, z) { return this.levelOf(this.heat[this.cellOf(x, z)]); }
  levelOf(h) { let l = 0; for (let k = 1; k < HEAT.length; k++) if (h >= HEAT[k]) l = k; return l; }
  levels() { return [...this.heat].map((h) => this.levelOf(h)); }
  // 熱さを足す (そのエリアと、となりに少し)
  warm(x, z, amount) {
    const c = this.cellOf(x, z), i = Math.floor(c / GRID), j = c % GRID;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue;
      this.heat[ii * GRID + jj] = Math.min(60, this.heat[ii * GRID + jj] + amount * (a || b ? 0.3 : 1));
    }
  }
  // 事件を登録する。victim: 救急が必要な通行人の id
  report(type, x, z, { victim = null, sev = SEV[type] || 1, now = Date.now() } = {}) {
    this.warm(x, z, sev * 1.6);
    let inc = null, bd = MERGE_R * MERGE_R;
    for (const e of this.list.values()) {
      if (e.closed || now - e.lastAt > MERGE_MS) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2; if (d < bd) { bd = d; inc = e; }
    }
    if (!inc) {
      if (this.list.size >= MAX) { const old = [...this.list.values()].sort((a, b) => a.lastAt - b.lastAt)[0]; if (old && !old.ems && !old.police.size) this.list.delete(old.id); else return null; }
      inc = { id: 'e' + (++this.seq), type, x, z, sev, createdAt: now, lastAt: now, lastDangerAt: now, reports: 0, victims: new Map(), police: new Set(), ems: null, closed: false };
      this.list.set(inc.id, inc);
    }
    inc.reports++; inc.lastAt = now; inc.sev = Math.max(inc.sev, sev);
    if (type !== 'injury' || !victim) inc.lastDangerAt = now; // けが人の報告だけなら、危険が続いているとは見ない
    if (sev > (SEV[inc.type] || 0)) inc.type = type;
    inc.x += (x - inc.x) * 0.15; inc.z += (z - inc.z) * 0.15; // 中心を少し寄せる
    if (victim && !inc.victims.has(victim)) inc.victims.set(victim, 'waiting');
    return inc;
  }
  // 危険が去った (しばらく銃声などがない)
  calm(inc, now = Date.now()) { return now - inc.lastDangerAt > (this.cfg.calmMs || 15000); }
  safe(inc, now = Date.now()) { return now - inc.lastDangerAt > 5000; } // 救急が近づいてよい
  pendingVictims(inc) { return [...inc.victims.entries()].filter(([, s]) => s === 'waiting').map(([id]) => id); }
  nearest(x, z, r) { let best = null, bd = r * r; for (const e of this.list.values()) { if (e.closed) continue; const d = (e.x - x) ** 2 + (e.z - z) ** 2; if (d < bd) { bd = d; best = e; } } return best; }
  update(now, dt) {
    const k = Math.exp(-dt / Math.max(1, this.cfg.panicDecay || 25)); // パニックは時間で冷める
    for (let c = 0; c < this.heat.length; c++) this.heat[c] = this.heat[c] < 0.05 ? 0 : this.heat[c] * k;
    for (const e of [...this.list.values()]) {
      // 閉じる: 落ち着いて、けが人がいない・警察も救急もいない
      const busy = e.police.size || e.ems || this.pendingVictims(e).length || [...e.victims.values()].some((s) => s === 'treating');
      if (this.calm(e, now) && !busy) { e.closed = true; this.list.delete(e.id); }
    }
  }
  clear() { for (const e of this.list.values()) e.lastDangerAt = 0; this.heat.fill(0); }
  debug(now = Date.now()) {
    return [...this.list.values()].map((e) => ({ id: e.id, type: e.type, sev: e.sev, x: Math.round(e.x), z: Math.round(e.z), age: Math.round((now - e.createdAt) / 1000), quiet: Math.round((now - e.lastDangerAt) / 1000), calm: this.calm(e, now), police: [...e.police], ems: e.ems, victims: Object.fromEntries(e.victims) }));
  }
}
module.exports = { Incidents, GRID, CELL, LEVEL_NAME, SEV };
