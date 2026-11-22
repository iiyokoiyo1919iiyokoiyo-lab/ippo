// =====================================================================
// IppO ベースボール: サーバーとブラウザで共通の計算 (球種・ボールの軌道・打球の判定・打席の自動計算)
//   ・座標: 本塁 (ホームベースの先) が原点。x = 捕手から見て右 (+)、y = 高さ (m)、z = 投手のほう (+)。マウンドの投球位置は z = 17.4
//   ・ストライクゾーン: |x| <= 0.22、0.48 <= y <= 1.06 (m)
//   ・投手のカーソル = ボールが本塁に来る場所 (失投するとずれる)。変化球は「来る場所」に向かって曲がりながら入ってくる
//   ・打者のミートカーソルの大きさはミート、打球の強さはパワー、タイミングとカーソルの位置のずれで打球が決まる
// =====================================================================
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.BBCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const ZONE = { x: 0.22, yLo: 0.48, yHi: 1.06 };
  const RELEASE = { x: -0.45, y: 1.85, z: 17.4 }; // 右投げのリリースの位置 (捕手から見て左)
  // 球種: k = 球速の倍率、bx/by = 変化の量 (m。変化力 50 のとき)、late = 変化がどれだけ遅いか (0 早い〜1 遅い)、wob = ゆれ (ナックル)、lob = 山なり
  const PITCHES = {
    straight: { name: 'ストレート', k: 1.0, bx: 0, by: 0.04, late: 0.5 },
    fireball: { name: '火の玉ストレート', k: 1.045, bx: 0, by: 0.11, late: 0.7 },
    fourseam: { name: 'フォーシーム', k: 1.0, bx: 0.02, by: 0.07, late: 0.6 },
    twoseam: { name: 'ツーシーム', k: 0.97, bx: 0.15, by: -0.07, late: 0.75 },
    cutter: { name: 'カットボール', k: 0.95, bx: -0.14, by: -0.03, late: 0.8 },
    slider: { name: 'スライダー', k: 0.88, bx: -0.3, by: -0.09, late: 0.65 },
    slurve: { name: 'スラーブ', k: 0.83, bx: -0.27, by: -0.25, late: 0.55 },
    curve: { name: 'カーブ', k: 0.76, bx: -0.15, by: -0.42, late: 0.4 },
    fork: { name: 'フォーク', k: 0.86, bx: 0, by: -0.4, late: 0.85 },
    split: { name: 'スプリット', k: 0.91, bx: 0.06, by: -0.26, late: 0.88 },
    splitfork: { name: 'スプリットフォーク', k: 0.88, bx: 0.04, by: -0.33, late: 0.86 },
    eephus: { name: 'イーファスピッチ', k: 0.46, bx: 0, by: -0.1, late: 0.3, lob: 1.6 },
    knuckle: { name: 'ナックル', k: 0.73, bx: 0, by: -0.12, late: 0.5, wob: 0.13 },
  };
  const PITCH_IDS = Object.keys(PITCHES);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // 乱数 (種から同じ並びが出る)
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- 投球 ----------
  // p: 投手 { velo (km/h), brk (変化力 1-100), stuff (球威 1-100) }、pitch: 球種の id、aim: { x, y } カーソル、release: 0..1 (0.5 がぴったり)
  // 戻り値: { id, km, T (秒・本塁まで), end: { x, y } (本塁での位置), start: リリースの位置, bx, by (変化), late, wob, lob, miss (失投), seed }
  function makePitch(p, pitchId, aim, release, seed) {
    const P = PITCHES[pitchId] || PITCHES.straight, r = rng(seed);
    const off = Math.abs((Number(release) || 0) - 0.5); // ずれ (0 がぴったり)
    const miss = off > 0.24;                            // 失投
    const grade = off <= 0.07 ? 'perfect' : off <= 0.16 ? 'good' : miss ? 'miss' : 'ok';
    const bk = clamp(p.brk || 50, 1, 100) / 50;           // 変化力
    let km = clamp(p.velo || 140, 90, 170) * P.k * (miss ? 0.95 : 1) * (grade === 'perfect' ? 1.01 : 1);
    // 狙いからのずれ (ぴったりなら小さい・失投は真ん中寄りに甘く入る)
    const sc = grade === 'perfect' ? 0.015 : grade === 'good' ? 0.04 : grade === 'ok' ? 0.08 : 0.06;
    let ex = clamp(Number(aim?.x) || 0, -0.45, 0.45) + (r() - 0.5) * 2 * sc, ey = clamp(Number(aim?.y) || 0.77, 0.15, 1.45) + (r() - 0.5) * 2 * sc;
    if (miss) { ex = ex * 0.35 + (r() - 0.5) * 0.08; ey = 0.8 + (ey - 0.8) * 0.3 + (r() - 0.5) * 0.06; }
    const brkMul = miss ? 0.45 : 1;
    const v = km / 3.6, T = (RELEASE.z / v) * (P.lob ? 1.08 : 1);
    return { id: pitchId, name: P.name, km: Math.round(km), T, end: { x: ex, y: ey }, start: { ...RELEASE }, bx: P.bx * bk * brkMul, by: P.by * bk * brkMul, late: clamp(P.late + ((p.stuff || 50) - 50) / 250, 0.2, 0.95), wob: P.wob || 0, lob: P.lob || 0, miss, grade, seed: seed >>> 0 };
  }
  // 時刻 t (秒) のボールの位置。変化しない線 (始点 → 終点 - 変化) に、変化の量を (t/T)^n で足す (n が大きいほど遅く曲がる)
  function pitchPos(pc, t) {
    const u = clamp(t / pc.T, 0, 1.25), n = 1 + pc.late * 3, bend = Math.pow(Math.min(u, 1), n) + Math.max(0, u - 1) * n;
    const ax = pc.end.x - pc.bx, ay = pc.end.y - pc.by;
    let x = pc.start.x + (ax - pc.start.x) * u + pc.bx * bend;
    let y = pc.start.y + (ay - pc.start.y) * u + pc.by * bend;
    const z = pc.start.z * (1 - u);
    if (pc.lob) y += Math.sin(Math.PI * Math.min(u, 1)) * pc.lob;          // イーファス: 山なり
    if (pc.wob) { const s = pc.seed % 1000; x += Math.sin(u * 9 + s) * pc.wob * u; y += Math.sin(u * 7 + s * 1.7) * pc.wob * 0.6 * u; } // ナックル: ゆれる
    return { x, y, z };
  }
  const inZone = (e) => Math.abs(e.x) <= ZONE.x + 0.037 && e.y >= ZONE.yLo - 0.037 && e.y <= ZONE.yHi + 0.037; // ボールの半径ぶん

  // ---------- 打撃 ----------
  // b: 打者 { meet, power, speed }、pc: 投球、swing: null (見送り) | { x, y, t (秒・投球の始まりから) }、def: 守備の技術 (0-100)
  // 戻り値: { kind: 'take' | 'miss' | 'foul' | 'out' | 'hit', call ('strike' | 'ball' 見送り)、bases (1-4)、outType、dir (度・-45 左〜45 右)、dist (m)、angle (度)、ev (km/h)、q (芯の度合い) }
  const meetR = (meet) => 0.05 + clamp(meet, 1, 100) / 100 * 0.085; // ミートカーソルの半径 (m)
  function swingResult(b, pc, swing, def, seed, situ = {}) {
    if (!swing) return { kind: 'take', call: inZone(pc.end) ? 'strike' : 'ball' };
    const r = rng(seed ^ 0x9e3779b9);
    const dt = (Number(swing.t) - pc.T) * 1000;                // ms (- は早い)
    const R = meetR(b.meet) * (situ.boost || 1);
    const dx = (Number(swing.x) || 0) - pc.end.x, dy = (Number(swing.y) || 0) - pc.end.y, dist = Math.hypot(dx, dy);
    const win = 125 + clamp(b.meet, 1, 100) * 0.45;            // タイミングの幅 (ms)
    if (Math.abs(dt) > win || dist > R * 1.12) return { kind: 'miss' };
    const qt = 1 - Math.abs(dt) / win, qd = 1 - Math.min(1, dist / R);
    let q = situ.q ?? clamp(qd * 0.62 + qt * 0.38, 0, 1) * (pc.miss ? 1.15 : 1) * (1 - ((situ.stuff ?? 50) - 50) / 400); // 球威が高いと芯をはずしやすい
    if (q < 0.12 || (q < 0.24 && r() < 0.55)) return { kind: 'foul', q };
    // 打球: 方向 = タイミング (早いと引っぱり)、角度 = カーソルとボールの上下のずれ (カーソルが上 → ゴロ・下 → フライ)
    const dir = clamp(-dt / win * 42 + (r() - 0.5) * 16, -44, 44);
    const angle = clamp(14 - dy / R * 32 + (r() - 0.5) * 10, -12, 62);
    const pw = clamp(b.power, 1, 100);
    const ev = 84 + q * 42 + pw * 0.27 * (0.5 + q * 0.5);     // 打球の速さ (km/h)
    const fa = Math.pow(Math.max(0, Math.cos((angle - 28) * Math.PI / 100)), 1.6); // 角度 28° でいちばん飛ぶ
    let dist2 = angle < 6 ? ev * 0.35 : (ev - 52) * 1.5 * fa;  // 飛距離 (m)
    dist2 = clamp(dist2 * (0.86 + r() * 0.2), 4, 150);        // 風・打球の回転などで少しばらつく
    const fence = 118 - Math.abs(dir) * 0.45;                  // 中堅 118m・両翼 98m くらい
    if (angle >= 15 && angle <= 42 && dist2 >= fence) return { kind: 'hit', bases: 4, dir, dist: Math.round(dist2), angle: Math.round(angle), ev: Math.round(ev), q, hr: true };
    // ヒットになるか: 打球の質と守備の技術で決まる
    const dq = clamp(def ?? 50, 1, 100) / 100;
    let hitP;
    if (angle < 8) hitP = 0.16 + q * 0.22 + (b.speed || 50) / 100 * 0.08 - dq * 0.12;          // ゴロ
    else if (angle < 22) hitP = 0.42 + q * 0.32 - dq * 0.12;                                   // ライナー
    else if (angle < 45) hitP = (dist2 > fence - 12 ? 0.42 : 0.14) + q * 0.12 - dq * 0.1;      // フライ
    else hitP = 0.03;                                                                           // ポップフライ
    if (r() < clamp(hitP, 0.02, 0.85)) {
      let bases = 1;
      if (angle >= 8 && dist2 > 72 && Math.abs(dir) > 25) bases = 2;
      if (angle >= 10 && dist2 > 88) bases = r() < 0.12 + (b.speed || 50) / 600 ? 3 : 2;
      return { kind: 'hit', bases, dir, dist: Math.round(dist2), angle: Math.round(angle), ev: Math.round(ev), q };
    }
    return { kind: 'out', outType: angle < 8 ? 'ground' : angle < 22 ? 'liner' : angle < 45 ? 'fly' : 'pop', dir, dist: Math.round(dist2), angle: Math.round(angle), ev: Math.round(ev), q };
  }

  // ---------- 打席・塁・アウトの進め方 (リアルタイム対戦と自動試合で共通) ----------
  // g: { outs, bases: [b1, b2, b3] (走者の id か null), score }、res: 打席の結果、batter: 打者の id、spd: 走者の速さを返す関数、r: 乱数
  // 戻り値: 入った点
  function advance(g, res, batter, spd, r) {
    let runs = 0; const b = g.bases;
    const home = () => { runs++; };
    if (res.kind === 'bb') { if (b[0]) { if (b[1]) { if (b[2]) home(); b[2] = b[1]; } b[1] = b[0]; } b[0] = batter; return runs; }
    if (res.kind === 'hit') {
      const n = res.bases;
      if (n === 4) { for (let i = 0; i < 3; i++) if (b[i]) home(); g.bases = [null, null, null]; home(); return runs; }
      const nb = [null, null, null];
      for (let i = 2; i >= 0; i--) { if (!b[i]) continue; let to = i + n + (n === 1 && i >= 1 && r() < 0.3 + spd(b[i]) / 250 ? 1 : 0); if (to >= 3) home(); else nb[to] = b[i]; }
      nb[n - 1] = batter; g.bases = nb; return runs;
    }
    if (res.kind === 'out' || res.kind === 'k') {
      g.outs++;
      if (res.kind === 'out' && g.outs < 3) {
        if (res.outType === 'ground' && b[0] && r() < 0.42) { g.outs++; b[0] = null; }          // 併殺
        else if (res.outType === 'fly' && b[2] && res.dist > 60 && r() < 0.6 + spd(b[2]) / 300) { home(); b[2] = null; } // 犠牲フライ
        else if (res.outType === 'ground') { if (b[2] && !b[1] && r() < 0.35) { home(); b[2] = null; } if (b[1] && !b[2]) { b[2] = b[1]; b[1] = null; } }
      }
      return g.outs >= 3 ? 0 : runs;
    }
    return runs;
  }

  // ---------- 自動試合 (マイチーム): 1 打席ずつ、能力から確率で決める ----------
  // 打者 vs 投手: 三振・四球・打球。打球は swingResult と同じ考え方でまとめて計算
  function autoPA(b, p, def, r, situ = {}) {
    const meet = b.meet * (situ.mult || 1), power = b.power * (situ.mult || 1);
    const pitchQ = (p.velo - 130) / 30 * 0.4 + p.brk / 100 * 0.35 + p.stuff / 100 * 0.35 + (p.pitches?.length || 4) / 10 * 0.1; // 0〜1 くらい
    const kP = clamp(0.12 + pitchQ * 0.16 - meet / 100 * 0.12, 0.05, 0.4);
    const bbP = clamp(0.085 - p.stuff / 100 * 0.03 + meet / 100 * 0.02, 0.03, 0.14);
    const u = r();
    if (u < kP) return { kind: 'k' };
    if (u < kP + bbP) return { kind: 'bb' };
    // 打球: 芯の度合い q はミートと投手の質、角度はランダム、強さはパワー
    const q = clamp(0.2 + meet / 100 * 0.42 - pitchQ * 0.22 + (r() - 0.5) * 0.75, 0, 1);
    const fakePc = { T: 0.5, end: { x: 0, y: 0.8 }, miss: false };
    const dy = (r() - 0.42) * meetR(meet) * 1.7;
    const sw = { t: 0.5 + (r() - 0.5) * 0.16, x: (r() - 0.5) * 0.02, y: 0.8 + dy };
    const res = swingResult({ meet: 100, power, speed: b.speed }, fakePc, sw, def, Math.floor(r() * 2 ** 31), { q });
    if (res.kind === 'miss' || res.kind === 'foul') return autoPA(b, p, def, r, situ); // 打ち直し (ファウルなど)
    return res;
  }

  return { ZONE, RELEASE, PITCHES, PITCH_IDS, rng, clamp, makePitch, pitchPos, inZone, meetR, swingResult, advance, autoPA };
});
