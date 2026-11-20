// =====================================================================
// シティバトル: マップと当たり判定 (サーバーとブラウザで同じものを使う)
//   ・街は 5×5 のブロック。ブロックのあいだは道路 (幅 8)。ブロックにはビル・公園 (木箱・低い壁)
//   ・同じ種 (seed) から作るので、サーバーとブラウザで必ず同じ形になる
//   ・ブラウザでは window.ArenaMap、サーバーでは require で使う
//   ・一部のビルは 1 階に入れる (コンビニ・カフェ・ロビー)。壁・入口・天井 (2 階から上の箱)・家具も当たり判定
//   ・道ばたの車は動く車 (dyn)。当たり判定の箱 (solid) には入れない (arena-traffic.js の車として動く)
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
    for (const b of boxes) if (b.kind === 'car') b.dyn = true;
    const interiors = makeInteriors(boxes, seed);
    const solid = boxes.filter((b) => !b.flat && !b.dyn);
    return { boxes, solid, nodes, interiors, size: SIZE, half: HALF };
  }
  // ---------- 建物の 1 階の中 ----------
  // えらんだビルを、1 階の壁 (入口のすき間・入口の上の壁)・天井から上の箱・床・家具に分ける (街の形は変えない)
  const FLOOR_H = 3.4, WALL_T = 0.25, DOOR = 1.8;
  function makeInteriors(boxes, seed) {
    const r = rng(seed ^ 0x51ed), lines = []; for (let i = 0; i <= N; i++) lines.push(-HALF + ROAD / 2 + i * (BLOCK + ROAD));
    const near = (v) => lines.reduce((b, l) => (Math.abs(l - v) < Math.abs(b - v) ? l : b));
    const out = [], TYPES = ['shop', 'cafe', 'shop', 'lobby'];
    let gid = 0;
    for (const b of [...boxes]) {
      if (b.kind !== 'building' || b.w < 6 || b.d < 5.4 || b.h < 6) continue;
      if (r() > 0.5) continue;
      const type = TYPES[out.length % TYPES.length], id = 'i' + (++gid);
      // 入口: 道路に近い面
      const lx = near(b.x), lz = near(b.z), useX = Math.abs(lx - b.x) - b.w / 2 < Math.abs(lz - b.z) - b.d / 2;
      const sx = Math.sign(lx - b.x) || 1, sz = Math.sign(lz - b.z) || 1;
      boxes.splice(boxes.indexOf(b), 1);
      const g = { gid: id, color: b.color }, T = WALL_T, H = FLOOR_H;
      boxes.push({ ...g, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h - H, y0: H, kind: 'building', upper: true, fullH: b.h }); // 天井から上
      const wall = (x, z, w, d, face, y0 = 0, h = H) => boxes.push({ ...g, x, z, w, d, h, y0, kind: 'iwall', face });
      // x の面 (±x) と z の面 (±z)。入口の面は 2 つに分けて、上に壁
      for (const s of [-1, 1]) {
        const xw = b.x + s * (b.w / 2 - T / 2), zw = b.z + s * (b.d / 2 - T / 2);
        if (useX && s === sx) { const seg = (b.d - DOOR) / 2; wall(xw, b.z - DOOR / 2 - seg / 2, T, seg, s > 0 ? 'px' : 'nx'); wall(xw, b.z + DOOR / 2 + seg / 2, T, seg, s > 0 ? 'px' : 'nx'); wall(xw, b.z, T, DOOR, s > 0 ? 'px' : 'nx', 2.4, H - 2.4); }
        else wall(xw, b.z, T, b.d, s > 0 ? 'px' : 'nx');
        if (!useX && s === sz) { const seg = (b.w - 2 * T - DOOR) / 2; wall(b.x - DOOR / 2 - seg / 2, zw, seg, T, s > 0 ? 'pz' : 'nz'); wall(b.x + DOOR / 2 + seg / 2, zw, seg, T, s > 0 ? 'pz' : 'nz'); wall(b.x, zw, DOOR, T, s > 0 ? 'pz' : 'nz', 2.4, H - 2.4); }
        else wall(b.x, zw, b.w - 2 * T, T, s > 0 ? 'pz' : 'nz');
      }
      boxes.push({ ...g, x: b.x, z: b.z, w: b.w - 2 * T, d: b.d - 2 * T, h: 0.02, y0: 0, kind: 'floor', flat: true, type });
      // 内がわの座標: 入口から奥へ = in。横 = side
      const inX = useX ? -sx : 0, inZ = useX ? 0 : -sz, sdX = useX ? 0 : 1, sdZ = useX ? 1 : 0;
      const depth = (useX ? b.w : b.d) - 2 * T, width = (useX ? b.d : b.w) - 2 * T;
      const door = { x: useX ? b.x + sx * (b.w / 2) : b.x, z: useX ? b.z : b.z + sz * (b.d / 2), nx: -inX, nz: -inZ };
      const at = (a, sd) => ({ x: door.x + inX * a + sdX * sd, z: door.z + inZ * a + sdZ * sd }); // a: 入口からの奥行き・sd: 横
      const furn = (a, sd, along, across, h, kind = 'furn', extra = {}) => { const c = at(a, sd); boxes.push({ ...g, x: c.x, z: c.z, w: useX ? along : across, d: useX ? across : along, h, y0: 0, kind, ...extra }); };
      // furn の along: 奥行き方向の長さ・across: 横の長さ (上の関数で x/z に直す)
      const room = { id, type, x: b.x, z: b.z, w: b.w, d: b.d, door, inX, inZ };
      if (type === 'shop') { // コンビニ: 奥にレジのカウンター・まん中に棚 2 列
        furn(depth - 1.25, -width / 2 + 1.3, 0.6, 2.2, 1.0, 'furn', { part: 'counter' });
        for (const sd of [0.9, width / 2 - 0.3]) furn(depth / 2 - 0.2, sd, Math.max(1.2, depth - 3.6), 0.5, 1.5, 'furn', { part: 'shelf' }); // 棚はレジと反対がわ (入口からレジが見える)
        const c = at(depth - 0.55, -width / 2 + 1.3); room.clerk = { x: c.x, z: c.z, yaw: Math.atan2(inX, inZ) }; // 店員はカウンターの奥 (入口を向く)
        room.register = at(depth - 1.25, -width / 2 + 1.0);
      } else if (type === 'cafe') { // カフェ: 奥にカウンター・テーブル 3 つ
        furn(depth - 0.9, 0, 0.6, Math.min(3, width - 1.6), 1.0, 'furn', { part: 'counter' });
        for (const [a, sd] of [[1.6, -width / 2 + 1.1], [1.6, width / 2 - 1.1], [depth / 2 + 0.3, -width / 2 + 1.1]]) furn(a, sd, 0.8, 0.8, 0.75, 'furn', { part: 'table' });
      } else { // ロビー: 受付と植木
        furn(depth - 1.1, 0, 0.7, 2.4, 1.05, 'furn', { part: 'counter' });
        for (const sd of [-width / 2 + 0.6, width / 2 - 0.6]) furn(1.0, sd, 0.6, 0.6, 1.1, 'furn', { part: 'plant' });
      }
      out.push(room);
    }
    return out;
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
  // 光線と向きのある箱 (車): { x, z, yaw, w (幅), l (長さ), h (高さ) }。車の前は -z
  function rayOBB(o, d, v) {
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw), rx = c, rz = -s; // 右 = (cos, -sin)・前 = (-sin, -cos)
    const ox = o[0] - v.x, oz = o[2] - v.z;
    const lo = [ox * rx + oz * rz, o[1], ox * s + oz * c], ld = [d[0] * rx + d[2] * rz, d[1], d[0] * s + d[2] * c];
    return rayBox(lo, ld, { x: 0, z: 0, w: v.w, d: v.l, y0: 0, h: v.h });
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

  const api = { build, groundAt, collide, rayBox, rayOBB, rayWorld, rayPlayer, PLAYER_R, PLAYER_H, STEP, SIZE, HALF, FLOOR_H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ArenaMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
