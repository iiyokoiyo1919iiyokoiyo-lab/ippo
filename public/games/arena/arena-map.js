// =====================================================================
// シティバトル: マップと当たり判定 (サーバーとブラウザで同じものを使う)
//   ・街は 5×5 のブロック。ブロックのあいだは道路 (幅 8)。ブロックにはビル・公園 (木箱・低い壁)
//   ・同じ種 (seed) から作るので、サーバーとブラウザで必ず同じ形になる
//   ・ブラウザでは window.ArenaMap、サーバーでは require で使う
// =====================================================================
(function (root) {
  const BLOCK = 18, ROAD = 8, N = 5;
  const SIZE = N * BLOCK + (N + 1) * ROAD;      // 138
  const HALF = SIZE / 2;
  const PLAYER_R = 0.45, PLAYER_H = 1.8, STEP = 0.55;

  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // 箱: { x, z (中心), w (x の幅), d (z の幅), h (高さ), y0 (下の高さ。ふつう 0), kind }
  function build(seed = 20261120) {
    const r = rng(seed), boxes = [];
    const blockOrigin = (i) => -HALF + ROAD + i * (BLOCK + ROAD);   // ブロックの左端
    const PALETTE = ['#f4a261', '#e76f51', '#2a9d8f', '#8ecae6', '#cdb4db', '#ffb703', '#90be6d', '#adb5bd', '#f28482', '#84a59d'];
    for (let bi = 0; bi < N; bi++) for (let bj = 0; bj < N; bj++) {
      const x0 = blockOrigin(bi), z0 = blockOrigin(bj);
      const park = (bi === 2 && bj === 2) || r() < 0.18;
      if (park) {
        // 公園: 木箱と低い壁 (かくれる場所)。まん中は広場
        for (let k = 0; k < 7; k++) {
          const w = 1.2 + r() * 1.6, d = 1.2 + r() * 1.6, h = r() < 0.5 ? 1.1 : 1.6 + r() * 0.8;
          const x = x0 + 2 + r() * (BLOCK - 4), z = z0 + 2 + r() * (BLOCK - 4);
          boxes.push({ x, z, w, d, h, y0: 0, kind: h < 1.3 ? 'crate' : 'wall', color: h < 1.3 ? '#c08552' : '#b5838d' });
        }
        boxes.push({ x: x0 + BLOCK / 2, z: z0 + BLOCK / 2, w: BLOCK, d: BLOCK, h: 0.12, y0: 0, kind: 'grass', color: '#6ab04c', flat: true });
        continue;
      }
      // ビル: ブロックを 2×2 に分けて、ところどころに建てる (すき間は路地)
      const cells = [[0, 0], [1, 0], [0, 1], [1, 1]];
      for (const [cx, cz] of cells) {
        if (r() < 0.15) continue;
        const cw = BLOCK / 2, gap = 1.6 + r() * 1.2;
        const w = cw - gap, d = cw - gap - r() * 1.5;
        const h = 4 + Math.floor(r() * 5) * 2.5 + (r() < 0.15 ? 10 : 0);
        boxes.push({ x: x0 + cx * cw + cw / 2, z: z0 + cz * cw + cw / 2, w, d, h, y0: 0, kind: 'building', color: PALETTE[Math.floor(r() * PALETTE.length)] });
      }
    }
    // 道路の上のくるま (止まっている。かくれる場所)
    for (let k = 0; k < 14; k++) {
      const along = r() < 0.5, line = Math.floor(r() * (N + 1)), pos = -HALF + 6 + r() * (SIZE - 12);
      const c = -HALF + ROAD / 2 + line * (BLOCK + ROAD) + (r() < 0.5 ? -1.8 : 1.8);
      const x = along ? pos : c, z = along ? c : pos;
      boxes.push({ x, z, w: along ? 4.2 : 1.9, d: along ? 1.9 : 4.2, h: 1.45, y0: 0, kind: 'car', color: ['#e63946', '#457b9d', '#ffd166', '#f8f9fa', '#06d6a0'][k % 5] });
    }
    // まわりの壁
    const T = 2;
    boxes.push({ x: 0, z: -HALF - T / 2, w: SIZE + 2 * T, d: T, h: 6, y0: 0, kind: 'fence', color: '#495057' });
    boxes.push({ x: 0, z: HALF + T / 2, w: SIZE + 2 * T, d: T, h: 6, y0: 0, kind: 'fence', color: '#495057' });
    boxes.push({ x: -HALF - T / 2, z: 0, w: T, d: SIZE, h: 6, y0: 0, kind: 'fence', color: '#495057' });
    boxes.push({ x: HALF + T / 2, z: 0, w: T, d: SIZE, h: 6, y0: 0, kind: 'fence', color: '#495057' });
    // 出てくる場所・ボットの通り道: 道路の交差点
    const nodes = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) nodes.push({ x: -HALF + ROAD / 2 + i * (BLOCK + ROAD), z: -HALF + ROAD / 2 + j * (BLOCK + ROAD), i, j });
    const solid = boxes.filter((b) => !b.flat);
    return { boxes, solid, nodes, size: SIZE, half: HALF };
  }

  // 足もとの高さ (乗れる箱の上。段差 STEP まではのぼれる)
  function groundAt(map, x, z, y) {
    let g = 0;
    for (const b of map.solid) {
      if (Math.abs(x - b.x) > b.w / 2 + PLAYER_R * 0.6 || Math.abs(z - b.z) > b.d / 2 + PLAYER_R * 0.6) continue;
      const top = b.y0 + b.h;
      if (top <= y + STEP && top > g) g = top;
    }
    return g;
  }
  // 横の当たり判定: 円 (半径 PLAYER_R) を箱の外へ押し出す。足もとより STEP 以上高い箱だけ
  function collide(map, p, R = PLAYER_R) { // R: 円の半径 (車は 1.05)
    for (let iter = 0; iter < 2; iter++) for (const b of map.solid) {
      if (b.y0 + b.h <= p.y + STEP || b.y0 >= p.y + PLAYER_H) continue;
      const hx = b.w / 2, hz = b.d / 2;
      const cx = Math.max(b.x - hx, Math.min(p.x, b.x + hx)), cz = Math.max(b.z - hz, Math.min(p.z, b.z + hz));
      let dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 < 1e-8) { // 中にめりこんだ: いちばん近い辺へ
        const ox = hx - Math.abs(p.x - b.x), oz = hz - Math.abs(p.z - b.z);
        if (ox < oz) p.x = b.x + Math.sign(p.x - b.x || 1) * (hx + R); else p.z = b.z + Math.sign(p.z - b.z || 1) * (hz + R);
        continue;
      }
      const d = Math.sqrt(d2), push = R - d;
      p.x += (dx / d) * push; p.z += (dz / d) * push;
    }
    p.x = Math.max(-HALF + R, Math.min(HALF - R, p.x));
    p.z = Math.max(-HALF + R, Math.min(HALF - R, p.z));
    return p;
  }
  // 光線と箱: 当たるまでの距離 (当たらなければ Infinity)
  function rayBox(o, d, b) {
    let tmin = 0, tmax = Infinity;
    const mins = [b.x - b.w / 2, b.y0, b.z - b.d / 2], maxs = [b.x + b.w / 2, b.y0 + b.h, b.z + b.d / 2], oo = [o[0], o[1], o[2]], dd = [d[0], d[1], d[2]];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < mins[a] || oo[a] > maxs[a]) return Infinity; continue; }
      let t1 = (mins[a] - oo[a]) / dd[a], t2 = (maxs[a] - oo[a]) / dd[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
    return tmin;
  }
  function rayWorld(map, o, d, max = 120) {
    let best = max;
    if (d[1] < -1e-6) { const t = -o[1] / d[1]; if (t >= 0 && t < best) best = t; } // 地面
    for (const b of map.solid) { const t = rayBox(o, d, b); if (t < best) best = t; }
    return best;
  }
  // 光線と球 (体・頭の当たり判定)
  function raySphere(o, d, c, r) {
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : (cc < 0 ? 0 : Infinity);
  }
  // プレイヤーへの当たり: { t, head } (足もと p の上に、体 2 つと頭 1 つ)
  function rayPlayer(o, d, p) {
    const head = raySphere(o, d, [p.x, p.y + 1.58, p.z], 0.27);
    const body = Math.min(raySphere(o, d, [p.x, p.y + 1.1, p.z], 0.42), raySphere(o, d, [p.x, p.y + 0.5, p.z], 0.4));
    if (head < body) return { t: head, head: true };
    return body < Infinity ? { t: body, head: false } : null;
  }

  const api = { build, groundAt, collide, rayBox, rayWorld, rayPlayer, PLAYER_R, PLAYER_H, STEP, SIZE, HALF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ArenaMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
