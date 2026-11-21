// =====================================================================
// 宝探し: キャンパスのマップ (サーバーとブラウザで同じものを使う)
//   ・架空のキャンパス。打ちっぱなしのコンクリート・上が張り出した塔・赤いテントの渡り廊下・柱が並ぶ塀・
//     ピロティ (1 階が柱だけ) のガラスの校舎・切妻屋根の講堂 (時計)・ガラスの図書館・砂のグラウンド・クスノキの並木
//   ・当たり判定は シティバトルの arena-map.js と同じ形の箱 ({ x, z, w, d, h, y0, kind }) で、同じ関数 (collide・groundAt・rayWorld) を使う
//   ・宝の隠し場所の候補 (spots) と、出てくる場所 (spawns) もここ
//   ・ブラウザでは window.CampusMap、サーバーでは require で使う
// =====================================================================
(function (root) {
  const W = 140, D = 100; // 東西 140m × 南北 100m (x: -70〜70、z: -50〜50)
  function build() {
    const boxes = [], deco = { trees: [], palms: [], canopies: [], bridges: [], goals: [], clocks: [], lines: [] };
    const box = (x, z, w, d, h, kind, extra = {}) => { const b = { x, z, w, d, h, y0: 0, kind, ...extra }; boxes.push(b); return b; };
    // まわりの塀
    const T = 1.2;
    box(0, -D / 2 - T / 2, W + 2 * T, T, 2.6, 'fence'); box(0, D / 2 + T / 2, W + 2 * T, T, 2.6, 'fence');
    box(-W / 2 - T / 2, 0, T, D, 2.6, 'fence'); box(W / 2 + T / 2, 0, T, D, 2.6, 'fence');
    // グラウンド (砂。見た目だけ) とサッカーゴール (柱だけ当たる)
    const yard = { x0: -62, x1: 24, z0: 2, z1: 46 };
    box((yard.x0 + yard.x1) / 2, (yard.z0 + yard.z1) / 2, yard.x1 - yard.x0, yard.z1 - yard.z0, 0.02, 'sand', { flat: true });
    for (const [gx, dir] of [[yard.x0 + 2, 1], [yard.x1 - 2, -1]]) {
      const gz = (yard.z0 + yard.z1) / 2; deco.goals.push({ x: gx, z: gz, dir });
      for (const s of [-1, 1]) box(gx, gz + s * 3.66, 0.14, 0.14, 2.44, 'goal');
    }
    // 柱が並ぶ塀 (グラウンドの北): 太い柱と、あいだの低い壁。ところどころ通れる
    for (let i = 0, x = yard.x0; x <= yard.x1 + 0.1; i++, x += 3.6) {
      box(x, 0, 1.0, 1.5, 3.3, 'fin');
      if (x + 3.6 <= yard.x1 + 0.1 && i % 4 !== 2) box(x + 1.8, 0, 2.6, 0.35, 1.15, 'lowwall');
    }
    // 塔 2 つ (上の階が箱のように張り出す。当たり判定は下の箱)
    const tA = box(-50, -24, 12, 13, 19, 'tower', { overhang: 1.4, from: 11.5 });
    const tB = box(-36, -27, 9, 10, 16, 'tower', { overhang: 1.2, from: 10 });
    void tA; void tB;
    // 講堂 (切妻屋根・時計)。中に入れる: 南に入口 2 つ・東に 1 つ
    const H = { x0: -14, x1: 10, z0: -40, z1: -18, h: 6.5 }, t = 0.4, hx = (H.x0 + H.x1) / 2, hz = (H.z0 + H.z1) / 2;
    const wallX = (z, x0, x1) => box((x0 + x1) / 2, z, x1 - x0, t, H.h, 'cwall');
    const wallZ = (x, z0, z1) => box(x, (z0 + z1) / 2, t, z1 - z0, H.h, 'cwall');
    wallX(H.z0, H.x0, H.x1); // 北
    wallX(H.z1, H.x0, -9); wallX(H.z1, -6, 4); wallX(H.z1, 7, H.x1); // 南 (入口 2 つ)
    wallZ(H.x0, H.z0, H.z1); // 西
    wallZ(H.x1, H.z0, -26); wallZ(H.x1, -23, H.z1); // 東 (入口 1 つ)
    box(hx, hz, H.x1 - H.x0, H.z1 - H.z0, 0.02, 'hallfloor', { flat: true });
    boxes.push({ x: hx, z: hz, w: H.x1 - H.x0, d: H.z1 - H.z0, h: 0.4, y0: H.h, kind: 'hallroof', ridge: 4.5 }); // 屋根 (高いので当たらない)
    deco.clocks.push({ x: hx, z: H.z1 + 0.25, y: H.h + 2.2 });
    // 講堂の中: 舞台・長いす
    box(hx, H.z0 + 2.2, 14, 3.6, 0.9, 'stage');
    for (let r = 0; r < 3; r++) for (const s of [-1, 1]) box(hx + s * 4.5, -31 + r * 3.2, 6, 0.6, 0.5, 'bench');
    // ガラスの校舎 (3 階。1 階はピロティ: 柱だけで下を歩ける)
    const G = { x0: 16, x1: 48, z0: -36, z1: -18 };
    for (let x = G.x0 + 0.5; x <= G.x1 - 0.4; x += 4) for (const z of [G.z0 + 0.5, G.z1 - 0.5]) box(x, z, 0.8, 0.8, 3.6, 'column');
    box(G.x1 - 4, (G.z0 + G.z1) / 2, 6, 9, 3.6, 'core'); // 階段の箱
    boxes.push({ x: (G.x0 + G.x1) / 2, z: (G.z0 + G.z1) / 2, w: G.x1 - G.x0, d: G.z1 - G.z0, h: 8.2, y0: 3.6, kind: 'glass' }); // 2・3 階 (上なので当たらない)
    // 渡り廊下 (柱の上の通路。赤いテントの屋根)。塔 B → 講堂、講堂 → ガラスの校舎
    for (const [x0, x1, z] of [[-31.5, H.x0, -25], [H.x1, G.x0, -24]]) {
      deco.bridges.push({ x0, x1, z, y: 4.2 });
      boxes.push({ x: (x0 + x1) / 2, z, w: x1 - x0, d: 3, h: 0.5, y0: 4.2, kind: 'deck' });
      for (let x = x0 + 2; x < x1 - 1; x += 5) box(x, z, 0.6, 0.6, 4.2, 'column');
      for (let x = x0 + 3; x < x1 - 2; x += 6) deco.canopies.push({ x, z, y: 4.7 });
    }
    // 図書館 (ガラス張りの 3 階建て)。西に入口。中は本棚
    const L = { x0: 38, x1: 62, z0: 8, z1: 28 }, lx = (L.x0 + L.x1) / 2, lz = (L.z0 + L.z1) / 2;
    const lwX = (z, x0, x1) => box((x0 + x1) / 2, z, x1 - x0, t, 3.6, 'gwall');
    const lwZ = (x, z0, z1) => box(x, (z0 + z1) / 2, t, z1 - z0, 3.6, 'gwall');
    lwX(L.z0, L.x0, L.x1); lwX(L.z1, L.x0, L.x1); lwZ(L.x1, L.z0, L.z1);
    lwZ(L.x0, L.z0, 15); lwZ(L.x0, 19, L.z1); // 西 (入口)
    box(lx, lz, L.x1 - L.x0, L.z1 - L.z0, 0.02, 'libfloor', { flat: true });
    boxes.push({ x: lx, z: lz, w: L.x1 - L.x0, d: L.z1 - L.z0, h: 8.4, y0: 3.6, kind: 'glass' });
    for (let k = 0; k < 4; k++) box(lx + 1 + k * 4.2, lz - 4, 0.6, 7, 2.1, 'shelf');
    box(lx - 6, lz + 5.5, 3, 1.2, 0.8, 'desk');
    // クスノキの並木 (図書館の南の道)・グラウンドのまわり・塔のそば。幹は当たる
    const tree = (x, z, s = 1) => { deco.trees.push([x, z, s]); box(x, z, 0.9 * s, 0.9 * s, 3, 'trunk'); };
    for (const x of [32, 40, 48, 56, 64]) tree(x, 36, 1.25);
    for (const [x, z, s] of [[-66, 8, 1.1], [-66, 30, 1.2], [30, 6, 1], [30, 44, 1.1], [-58, -40, 1], [-22, -44, 1.1], [60, -10, 1.2], [-20, -10, 0.9], [12, -8, 0.9], [-66, -8, 1]]) tree(x, z, s);
    deco.palms.push([-41, -12]); box(-41, -12, 0.6, 0.6, 3, 'trunk');
    // 外のベンチ・自転車置き場 (屋根は見た目)
    for (const [x, z] of [[36, 40], [44, 40], [52, 40], [-28, 8], [-10, 8]]) box(x, z, 1.8, 0.6, 0.45, 'bench');
    box(66, 0, 2, 12, 1.1, 'bikes');
    // 宝の隠し場所の候補 (名前つき)
    const spots = [
      ...[-9, 0, 6].map((x) => ({ x, z: -34.5, name: '講堂の舞台のまえ' })), { x: -12, z: -38, name: '講堂の奥のすみ' }, { x: 8, z: -38, name: '講堂の奥のすみ' }, { x: -11.5, z: -20, name: '講堂の入口のわき' }, { x: 2, z: -28, name: '講堂の長いすのあいだ' },
      ...[20, 26, 32, 38].map((x) => ({ x, z: -27, name: 'ピロティの下' })), { x: 18, z: -34, name: 'ピロティの柱のかげ' }, { x: 40, z: -20, name: 'ピロティの柱のかげ' },
      ...[-25, -20, 0, 13].map((x) => ({ x, z: -22, name: '渡り廊下の下' })),
      ...[-55, -40, -26, -11, 4, 18].map((x) => ({ x, z: -1.5, name: '柱の塀のうら' })), ...[-47, -33, -18, 11].map((x) => ({ x, z: 1.6, name: '柱の塀のかげ' })),
      { x: -59, z: 24, name: 'ゴールのうしろ' }, { x: 21.5, z: 20, name: 'ゴールのうしろ' }, { x: -20, z: 44, name: 'グラウンドのすみ' }, { x: -60, z: 44, name: 'グラウンドのすみ' }, { x: 22, z: 44, name: 'グラウンドのすみ' },
      { x: -57, z: -32, name: '塔のうら' }, { x: -43, z: -32, name: '塔のあいだ' }, { x: -30, z: -33, name: '塔のうら' }, { x: -57, z: -15, name: '塔の入口' }, { x: -42, z: -13.5, name: 'ヤシの木の下' },
      { x: 41, z: 13, name: '図書館の本棚のあいだ' }, { x: 49, z: 20, name: '図書館の本棚のあいだ' }, { x: 58, z: 25, name: '図書館の奥' }, { x: 58, z: 10, name: '図書館の奥' }, { x: 44, z: 25.2, name: '図書館の机のそば' },
      { x: 33, z: 37.5, name: 'クスノキの根元' }, { x: 49, z: 34.5, name: 'クスノキの根元' }, { x: 65, z: 37.5, name: 'クスノキの根元' }, { x: 30, z: 7.5, name: 'クスノキの根元' }, { x: -66, z: 31.5, name: '大きな木のかげ' }, { x: -21, z: -45, name: '北の木の下' },
      { x: 67, z: 6.5, name: '自転車置き場' }, { x: 67, z: -6.5, name: '自転車置き場' }, { x: 66, z: -45, name: 'キャンパスのすみ' }, { x: -67, z: -47, name: 'キャンパスのすみ' }, { x: 66, z: 47, name: 'キャンパスのすみ' },
      { x: -10, z: 9.5, name: 'ベンチの下' }, { x: 44, z: 41.5, name: 'ベンチのうしろ' }, { x: 60, z: -12, name: '東の木の下' }, { x: 12, z: -6, name: '講堂の前の木' },
    ];
    const spawns = [[-40, 20], [-20, 30], [0, 15], [-50, 38], [10, 35], [-30, 12], [-5, 40], [15, 22]].map(([x, z]) => ({ x, z }));
    const solid = boxes.filter((b) => !b.flat);
    return { boxes, solid, deco, spots, spawns, yard, hall: H, glass: G, lib: L, size: Math.max(W, D), half: Math.max(W, D) / 2 };
  }
  const api = { build, W, D };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CampusMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
