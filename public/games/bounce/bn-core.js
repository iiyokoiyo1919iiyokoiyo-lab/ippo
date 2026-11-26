// =====================================================================
// PROJECT BOUNCE: 戦闘の計算 (サーバーとブラウザで共通)
//   1 回のショット = 「ひっぱった向き・強さ」を受けとって、止まるまでの動きを固定の刻み (1/60 秒) で計算する。
//   乱数は状態の中の種 (seed) から作るので、同じ入力なら同じ結果になる。サーバーがこれを動かして結果 (フレーム・出来事) を全員に配り、
//   ブラウザはそれを再生するだけ (不正な結果を送れない・マルチでも全員が同じ画面になる)
// =====================================================================
(function (root) {
  const D = typeof module !== 'undefined' && module.exports ? require('./bn-data.js') : root.BNData;
  const { W, H } = D;
  const UNIT_R = 20, STEP = 1 / 60, SUB = 3, MAX_STEPS = 60 * 7, FRAME_EVERY = 2;
  const FRICTION = 0.9915, STOP_V = 40;

  // 乱数 (mulberry32)
  function rng(state) { let t = (state.seed = (state.seed + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  // ---------- 育成の結果の能力 ----------
  function unitStats(u) { // u = { char, level, evo, lb, skill }
    const c = D.CHAR[u.char]; if (!c) return null;
    const lv = Math.max(1, Math.min(u.level || 1, D.LEVEL_CAP[c.rarity]));
    const m = (1 + D.GROW.perLevel * (lv - 1)) * (1 + D.GROW.evo.mult * (u.evo || 0)) * (1 + D.GROW.limitBreak.mult * (u.lb || 0));
    const sp = D.SPECIALS[c.special];
    const spTurns = Math.max(1, Math.round(sp.turns * Math.max(D.GROW.skillMin, 1 - 0.1 * (u.skill || 0))));
    return { hp: Math.round(c.hp * m), atk: Math.round(c.atk * m), spd: c.spd, baseAtk: c.atk, spTurns };
  }

  // ---------- 戦闘の状態を作る ----------
  // party: [{ owner, char, level, evo, lb, skill }] (1〜4 体)
  function newBattle(stageId, party, seed) {
    const st = D.STAGES.find((s) => s.id === stageId); if (!st) throw new Error('stage');
    const units = party.slice(0, 4).map((p, i) => {
      const c = D.CHAR[p.char], s = unitStats(p);
      return { key: i, owner: p.owner ?? null, char: c.id, name: c.name, attr: c.attr, shot: c.shot, combo: c.combo, special: c.special, abilities: c.abilities.slice(),
        hp: s.hp, atk: s.atk, baseAtk: s.baseAtk, spd: s.spd, spTurns: s.spTurns, spLeft: s.spTurns, buffs: [], status: {}, pierceTurns: 0, immuneAll: 0,
        x: 70 + i * 73, y: 520 };
    });
    const teamMax = units.reduce((a, u) => a + u.hp, 0);
    const state = { stage: st.id, wave: 0, turn: 0, current: 0, teamHp: teamMax, teamMax, barrier: 0, units, enemies: [], gimmicks: JSON.parse(JSON.stringify(st.g || [])), over: null, seed: (seed >>> 0) || 1, stats: { combo: 0, special: 0, boss: 0, dmg: 0 } };
    spawnWave(state);
    return state;
  }
  function spawnWave(state) {
    const st = D.STAGES.find((s) => s.id === state.stage);
    state.enemies = st.waves[state.wave].map(([id, x, y], i) => { const e = D.ENEMIES[id]; return { key: i, id, name: e.name, attr: e.attr, hp: e.hp, maxHp: e.hp, x, y, r: e.r, boss: !!e.boss, attack: e.attack, cd: e.attack.every, eclipse: 0 }; });
  }
  const alive = (state) => state.enemies.filter((e) => e.hp > 0);

  // ---------- ギミック (共通のしくみ) ----------
  // isImmune: そのユニットがそのギミックに対応しているか。'*' (すべて) を持っていれば、今後ふえるギミックにも対応する
  function immuneSet(u) {
    const s = new Set();
    for (const a of u.abilities) { const ab = D.ABILITIES[a]; if (ab?.kind === 'immune') ab.gimmicks.forEach((g) => s.add(g)); }
    if (u.immuneAll > 0) s.add('*');
    return s;
  }
  const isImmune = (imm, type) => imm.has('*') || imm.has(type);
  const inRect = (g, x, y, r = 0) => x + r > g.x && x - r < g.x + g.w && y + r > g.y && y - r < g.y + g.h;
  // それぞれのギミックが「動いているあいだ」にすること。新しいギミックはここに足す (対応していれば呼ばれない)
  const GIMMICK_RULES = {
    gravity: { step(b, g, ctx) { if (inRect(g, b.x, b.y)) { b.vx *= 0.93; b.vy *= 0.93; if (!ctx.flag('grav' + g.i)) ctx.ev({ k: 'gimmick', type: 'gravity', i: g.i }); } } },
    damage_floor: { step(b, g, ctx) { if (inRect(g, b.x, b.y)) { if (!ctx.flag('floor' + g.i)) { ctx.teamDamage(g.power, 'floor'); ctx.ev({ k: 'gimmick', type: 'damage_floor', i: g.i, dmg: g.power }); } } } }, // 1 回のショットで 1 回だけ
    warp: { step(b, g, ctx) { if (Math.hypot(b.x - g.x, b.y - g.y) < g.r + UNIT_R * 0.6 && !ctx.cool('warp', 30)) { b.x = g.tx; b.y = g.ty; ctx.ev({ k: 'gimmick', type: 'warp', i: g.i, to: [g.tx, g.ty] }); } } },
    block: { solid: true },
    slow_wall: { solid: true, onBounce(b) { b.vx *= 0.55; b.vy *= 0.55; } },
  };

  // 円と長方形のはね返り (当たったら true)
  function bounceRect(b, g) {
    const cx = Math.max(g.x, Math.min(b.x, g.x + g.w)), cy = Math.max(g.y, Math.min(b.y, g.y + g.h));
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    if (d >= UNIT_R) return false;
    let nx, ny;
    if (d > 0.0001) { nx = dx / d; ny = dy / d; } else { const l = b.x - g.x, r = g.x + g.w - b.x, t = b.y - g.y, bo = g.y + g.h - b.y, m = Math.min(l, r, t, bo); nx = m === l ? -1 : m === r ? 1 : 0; ny = m === t ? -1 : m === bo ? 1 : 0; }
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    b.x = cx + nx * UNIT_R; b.y = cy + ny * UNIT_R;
    return true;
  }

  // ---------- 攻撃力 ----------
  function atkOf(u) {
    let m = 1;
    for (const b of u.buffs) if (b.kind === 'atk') m += b.rate;
    for (const a of u.abilities) { const ab = D.ABILITIES[a]; if (ab?.kind === 'attr_up' && ab.attr === u.attr) m += ab.rate; }
    return u.atk * m;
  }
  const comboUp = (u) => u.abilities.reduce((m, a) => m + (D.ABILITIES[a]?.kind === 'combo_up' ? D.ABILITIES[a].rate : 0), 1);
  const ratio = (u) => atkOf(u) / u.baseAtk; // 連携コンボ・必殺技の威力は攻撃力に比例 (Lv1・バフなしで 1)

  function damageEnemy(state, e, raw, attr, ev, info) {
    if (e.hp <= 0) return 0;
    const dmg = Math.max(1, Math.round(raw * D.attrMult(attr, e.attr) * (e.eclipse > 0 ? 1.3 : 1) * (0.95 + rng(state) * 0.1)));
    e.hp = Math.max(0, e.hp - dmg); state.stats.dmg += dmg;
    ev({ k: 'dmg', e: e.key, dmg, hp: e.hp, ...info });
    if (e.hp <= 0) { ev({ k: 'kill', e: e.key, boss: e.boss }); if (e.boss) state.stats.boss++; }
    return dmg;
  }

  // ---------- 連携コンボ (味方 a にふれたとき) ----------
  function fireCombo(state, a, ev) {
    const cb = D.COMBOS[a.combo]; if (!cb) return;
    state.stats.combo++;
    const k = ratio(a) * comboUp(a), en = alive(state), base = { combo: a.combo, src: a.key };
    ev({ k: 'combo', u: a.key, id: a.combo, kind: cb.kind, name: cb.name, x: a.x, y: a.y });
    if (cb.kind === 'laser') en.filter((e) => Math.abs(e.y - a.y) < cb.width + e.r).forEach((e) => damageEnemy(state, e, cb.power * k, a.attr, ev, base));
    else if (cb.kind === 'explode') en.filter((e) => Math.hypot(e.x - a.x, e.y - a.y) < cb.radius + e.r).forEach((e) => damageEnemy(state, e, cb.power * k, a.attr, ev, base));
    else if (cb.kind === 'homing') for (let i = 0; i < cb.shots; i++) { const t = alive(state); if (!t.length) break; const e = t[Math.floor(rng(state) * t.length)]; damageEnemy(state, e, cb.power * k, a.attr, ev, { ...base, from: [a.x, a.y] }); }
    else if (cb.kind === 'heal') { const h = Math.round(state.teamMax * cb.rate); state.teamHp = Math.min(state.teamMax, state.teamHp + h); ev({ k: 'heal', amount: h, hp: state.teamHp }); }
    else if (cb.kind === 'barrier') { const amt = Math.round(cb.amount * k); state.barrier += amt; ev({ k: 'barrier', amount: amt, total: state.barrier }); }
    else if (cb.kind === 'nova') {
      for (let d = 0; d < 8; d++) { const ang = d * Math.PI / 4, dx = Math.cos(ang), dy = Math.sin(ang);
        en.forEach((e) => { const px = e.x - a.x, py = e.y - a.y, along = px * dx + py * dy, perp = Math.abs(px * dy - py * dx); if (along > 0 && perp < cb.width + e.r) damageEnemy(state, e, cb.power * k, a.attr, ev, base); }); }
    }
    else if (cb.kind === 'orbital') { // 敵全体へ星光レーザー: 合計の威力を敵の数で分ける・ボスに追加・星蝕 (受けるダメージ +30%・2 ターン)
      const each = cb.power * k / Math.max(1, en.length);
      en.forEach((e) => { damageEnemy(state, e, each * (e.boss ? cb.bossBonus : 1), a.attr, ev, base); if (e.hp > 0 && rng(state) < cb.eclipseChance) { e.eclipse = 2; ev({ k: 'eclipse', e: e.key }); } });
    }
    else if (cb.kind === 'thunder') { // ABC: 天から雷 (いちばん近い敵へ)。威力 18000 × 攻撃力の比
      const t = en.slice().sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
      if (t) damageEnemy(state, t, cb.power * k, a.attr, ev, { ...base, thunder: true });
    }
  }

  // ---------- 必殺技 (撃つ前に発動) ----------
  function useSpecial(state, u, ev, shot) {
    const sp = D.SPECIALS[u.special]; if (!sp) return;
    state.stats.special++;
    ev({ k: 'special', u: u.key, id: u.special, type: sp.type, name: sp.name });
    const k = ratio(u);
    if (sp.type === 'boost') shot.speedMul *= sp.speed;
    else if (sp.type === 'meteor') alive(state).forEach((e) => damageEnemy(state, e, sp.power * k, u.attr, ev, { special: u.special }));
    else if (sp.type === 'akashic_zero') {
      alive(state).forEach((e) => damageEnemy(state, e, sp.power * k, u.attr, ev, { special: u.special }));
      state.units.forEach((x) => { x.buffs = x.buffs.filter((b) => b.src !== 'akashic_zero'); x.buffs.push({ kind: 'atk', rate: sp.atkUp, turns: sp.buffTurns, src: 'akashic_zero' }); });
      const h = Math.round(state.teamMax * sp.heal); state.teamHp = Math.min(state.teamMax, state.teamHp + h);
      ev({ k: 'buff', kind: 'atk', rate: sp.atkUp, turns: sp.buffTurns }); ev({ k: 'heal', amount: h, hp: state.teamHp });
    }
    else if (sp.type === 'akashic_record') { // スピードアップ・全ギミック対応・貫通。duration ショットのあいだ続く (終わったら元にもどす)
      shot.speedMul *= sp.speed; u.pierceTurns = sp.duration; u.immuneAll = sp.duration;
      ev({ k: 'mode', u: u.key, shot: 'pierce', immuneAll: true, turns: sp.duration });
    }
    u.spLeft = u.spTurns;
  }

  // ---------- 1 回のショット ----------
  // input: { dx, dy (ひっぱった向きと長さ。長さ 0〜1 = 強さ), special: true/false }
  function shoot(state, input) {
    if (state.over) throw new Error('over');
    const u = state.units[state.current], events = [], frames = [];
    let step = 0;
    const ev = (e) => events.push({ f: Math.floor(step / FRAME_EVERY), ...e });
    let pw = Math.hypot(input.dx, input.dy); if (!(pw > 0.05)) pw = 0.05; if (pw > 1) pw = 1;
    const dirx = input.dx / Math.hypot(input.dx, input.dy || 1e-9), diry = input.dy / Math.hypot(input.dx || 1e-9, input.dy) || 0;
    const shot = { speedMul: 1 };
    if (u.status.slow) { shot.speedMul *= 0.6; delete u.status.slow; ev({ k: 'status', u: u.key, status: 'slow', end: true }); }
    if (input.special && u.spLeft <= 0) useSpecial(state, u, ev, shot);
    const pierce = u.pierceTurns > 0 || u.shot === 'pierce';
    const imm = immuneSet(u);
    const speed = pw * (300 + u.spd * 1.2) * shot.speedMul;
    const b = { x: u.x, y: u.y, vx: dirx * speed, vy: diry * speed };
    if (!isFinite(b.vx) || !isFinite(b.vy)) { b.vx = 0; b.vy = -speed; }
    const touchedAlly = new Set(), inside = new Set(), flags = new Set(), cools = {};
    const ctx = { ev, flag: (k) => { if (flags.has(k)) return true; flags.add(k); return false; }, unflag: (k) => flags.delete(k), cool: (k, n) => { if ((cools[k] || 0) > step) return true; cools[k] = step + n; return false; },
      teamDamage: (n, why) => teamDamage(state, n, ev, why) };
    state.gimmicks.forEach((g, i) => { g.i = i; });
    for (; step < MAX_STEPS; step++) {
      for (let s = 0; s < SUB; s++) {
        b.x += b.vx * STEP / SUB; b.y += b.vy * STEP / SUB;
        // 外の壁
        if (b.x < UNIT_R) { b.x = UNIT_R; b.vx = Math.abs(b.vx); } if (b.x > W - UNIT_R) { b.x = W - UNIT_R; b.vx = -Math.abs(b.vx); }
        if (b.y < UNIT_R) { b.y = UNIT_R; b.vy = Math.abs(b.vy); } if (b.y > H - UNIT_R) { b.y = H - UNIT_R; b.vy = -Math.abs(b.vy); }
        // かたいギミック (ブロック・減速壁): 対応していれば素通り
        for (const g of state.gimmicks) { const rule = GIMMICK_RULES[g.type]; if (!rule?.solid || isImmune(imm, g.type)) continue; if (bounceRect(b, g)) { rule.onBounce?.(b); if (!ctx.cool('solid' + g.i, 6)) ev({ k: 'gimmick', type: g.type, i: g.i, hit: true }); } }
        // 敵
        for (const e of state.enemies) {
          if (e.hp <= 0) { inside.delete(e.key); continue; }
          const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy), rr = UNIT_R + e.r;
          if (d < rr) {
            if (pierce) { if (!inside.has(e.key)) { inside.add(e.key); damageEnemy(state, e, atkOf(u), u.attr, ev, { hit: u.key, pierce: true }); } }
            else {
              const nx = d > 0.0001 ? dx / d : 0, ny = d > 0.0001 ? dy / d : -1, vn = b.vx * nx + b.vy * ny;
              if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; damageEnemy(state, e, atkOf(u), u.attr, ev, { hit: u.key }); }
              b.x = e.x + nx * rr; b.y = e.y + ny * rr;
            }
          } else inside.delete(e.key);
        }
        // 味方にふれたら、その味方の連携コンボ (1 回のショットで 1 体 1 回)
        for (const a of state.units) { if (a === u || touchedAlly.has(a.key)) continue; if (Math.hypot(b.x - a.x, b.y - a.y) < UNIT_R * 2) { touchedAlly.add(a.key); fireCombo(state, a, ev); } }
        if (!alive(state).length) break;
      }
      // 動いているあいだのギミック (重力・ダメージ床・ワープ…)
      for (const g of state.gimmicks) { const rule = GIMMICK_RULES[g.type]; if (rule?.step && !isImmune(imm, g.type)) rule.step(b, g, ctx); }
      b.vx *= FRICTION; b.vy *= FRICTION;
      if (step % FRAME_EVERY === 0) frames.push([Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]);
      if (Math.hypot(b.vx, b.vy) < STOP_V || !alive(state).length || state.teamHp <= 0) break;
    }
    frames.push([Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]);
    u.x = b.x; u.y = b.y;
    endTurn(state, u, events, frames.length);
    return { unit: u.key, frames, events, state };
  }

  function teamDamage(state, n, ev, why) {
    let dmg = Math.round(n);
    if (state.barrier > 0) { const used = Math.min(state.barrier, dmg); state.barrier -= used; dmg -= used; if (used) ev({ k: 'barrierUse', amount: used, left: state.barrier }); }
    state.teamHp = Math.max(0, state.teamHp - dmg);
    ev({ k: 'teamDmg', dmg, hp: state.teamHp, why });
    if (state.teamHp <= 0 && !state.over) { state.over = 'lose'; ev({ k: 'over', result: 'lose' }); }
  }

  // ショットのあと: 波の入れかわり・敵の攻撃・ターンの残り
  function endTurn(state, u, events, nf) {
    const ev = (e) => events.push({ f: nf, ...e });
    // 貫通・全ギミック対応の継続ターン (終わったら元の反射にもどす)
    if (u.pierceTurns > 0 && --u.pierceTurns === 0) ev({ k: 'mode', u: u.key, shot: u.shot, immuneAll: false, end: true });
    if (u.immuneAll > 0) u.immuneAll--;
    if (state.teamHp <= 0) return;
    if (!alive(state).length) {
      const st = D.STAGES.find((s) => s.id === state.stage);
      if (state.wave + 1 >= st.waves.length) { state.over = 'win'; ev({ k: 'over', result: 'win' }); return; }
      state.wave++; spawnWave(state); ev({ k: 'wave', wave: state.wave, enemies: state.enemies.map(pubEnemy) });
    } else {
      // 敵の攻撃 (カウントダウン)
      for (const e of alive(state)) {
        if (e.eclipse > 0) e.eclipse--;
        if (--e.cd > 0) continue;
        e.cd = e.attack.every;
        const a = e.attack;
        ev({ k: 'enemyAtk', e: e.key, kind: a.kind, power: a.power });
        if (a.kind === 'curse') {
          const t = state.units[Math.floor(rng(state) * state.units.length)];
          const resist = t.abilities.map((x) => D.ABILITIES[x]).find((ab) => ab?.kind === 'resist');
          if (resist && rng(state) < resist.chance) ev({ k: 'resist', u: t.key, status: 'slow' });
          else { t.status.slow = 1; ev({ k: 'status', u: t.key, status: 'slow' }); }
        }
        teamDamage(state, a.power, ev, a.kind);
        if (state.over) return;
      }
    }
    // バフ・必殺技のターン
    state.units.forEach((x) => { x.buffs.forEach((b) => b.turns--); x.buffs = x.buffs.filter((b) => b.turns > 0); if (x.spLeft > 0) x.spLeft--; });
    state.turn++;
    state.current = (state.current + 1) % state.units.length;
  }

  const pubEnemy = (e) => ({ key: e.key, id: e.id, name: e.name, attr: e.attr, hp: e.hp, maxHp: e.maxHp, x: e.x, y: e.y, r: e.r, boss: e.boss, cd: e.cd, eclipse: e.eclipse });
  // 画面に送る形 (乱数の種は送らない)
  function pub(state) {
    return { stage: state.stage, wave: state.wave, turn: state.turn, current: state.current, teamHp: state.teamHp, teamMax: state.teamMax, barrier: state.barrier, over: state.over, gimmicks: state.gimmicks,
      units: state.units.map((u) => ({ key: u.key, owner: u.owner, char: u.char, name: u.name, attr: u.attr, shot: u.pierceTurns > 0 ? 'pierce' : u.shot, x: u.x, y: u.y, atk: Math.round(atkOf(u)), baseAtk: u.baseAtk, hp: u.hp, spd: u.spd,
        spLeft: u.spLeft, spTurns: u.spTurns, buffs: u.buffs, status: u.status, immuneAll: u.immuneAll > 0, combo: u.combo, special: u.special })),
      enemies: state.enemies.map(pubEnemy), stats: state.stats };
  }

  const CORE = { UNIT_R, STEP, FRAME_EVERY, newBattle, shoot, pub, unitStats, atkOf, immuneSet, isImmune, GIMMICK_RULES, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE; else root.BNCore = CORE;
})(typeof self !== 'undefined' ? self : this);
