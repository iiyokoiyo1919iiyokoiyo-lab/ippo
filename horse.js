// =====================================================================
// ミニゲーム「117万分の1 競走馬版」 (非公式のファン作品) のサーバー側
//
// ・乱数の種: 生まれるたびにサーバーが種を出し、その種でゲームと同じ生成コード (public/games/horse/logic.js)
//   をサーバーでも動かして、レア度と確率をサーバー自身が計算して記録する
//   → 「みんなの結果」には、サーバーが計算した値しか載らない (送られてきた値は照合にだけ使う)
// ・みんなの結果: IppO のアカウントで載せる。1 人 10 分に 20 回まで
// ・図鑑と実績: アカウントごとに保存し、端末をまたいで引き継ぐ (送られた差分をサーバーでまとめる)
// =====================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const MIGRATION = `
CREATE TABLE horse_seeds (
  id TEXT PRIMARY KEY,                               -- 推測できないランダムな ID
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed INTEGER NOT NULL,                             -- 乱数の種 (0〜2^32-1)
  tb INTEGER NOT NULL DEFAULT 0,                     -- 「サラブレッドに生まれる」で生まれたか
  parent_id TEXT,                                    -- 仔として生まれたときの親の種
  gen INTEGER NOT NULL DEFAULT 1,
  rarity TEXT NOT NULL CHECK (rarity IN ('g1','g2','g3','l','n')),
  p REAL NOT NULL CHECK (p > 0 AND p <= 1),
  country TEXT NOT NULL, breed TEXT NOT NULL, headline TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '',
  can_parent INTEGER NOT NULL DEFAULT 0,             -- 繁殖牝馬・種牡馬になった (仔が生まれられる)
  created_at INTEGER NOT NULL
);
CREATE INDEX horse_seeds_user ON horse_seeds(user_id, created_at);
CREATE TABLE horse_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed_id TEXT NOT NULL UNIQUE REFERENCES horse_seeds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  horse TEXT NOT NULL,
  country TEXT NOT NULL, breed TEXT NOT NULL, headline TEXT NOT NULL, sub TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL CHECK (rarity IN ('g1','g2','g3','l','n')),
  p REAL NOT NULL CHECK (p > 0 AND p <= 1),
  created_at INTEGER NOT NULL
);
CREATE INDEX horse_plays_new ON horse_plays(created_at DESC);
CREATE INDEX horse_plays_rare ON horse_plays(p ASC, created_at DESC);
CREATE INDEX horse_plays_user ON horse_plays(user_id, created_at);
CREATE TABLE horse_zukan (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,                                -- 図鑑と実績 (JSON)
  updated_at INTEGER NOT NULL
);
CREATE TABLE horse_stats (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lives INTEGER NOT NULL DEFAULT 0,                  -- サーバーで確かめた馬生の数
  best TEXT,                                         -- サーバーで確かめた最高レア度
  best_p REAL
);
`;

const RK = ['g1', 'g2', 'g3', 'l', 'n'];
const BADGE_KEYS = new Set(('first tb abroad debutwin win listed grade g1 comeback transfer localwin brood stallion kidstakes kidg1 '
  + 'gen3 gen5 pasture long banei intl man100 oku c5 c15 b10 b100 ten tenssr').split(' '));
const MAX_GEN = 200;
const SEEDS_PER_10MIN = 300;

// ゲームと同じ乱数 (game.js の mulberry32 とまったく同じ式)
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- ゲームの生成コードをサーバーで動かす ----------
function loadEngine() {
  const src = fs.readFileSync(path.join(__dirname, 'public', 'games', 'horse', 'logic.js'), 'utf8');
  const sandbox = { __rng: Math.random };
  const context = vm.createContext(sandbox);
  new vm.Script(src + '\n;Math.random = () => globalThis.__rng();\nglobalThis.__newLife = newLife; globalThis.__rarityOf = rarityOf;', { filename: 'logic.js' })
    .runInContext(context, { timeout: 5000 });
  return {
    life(seed, forceTB, parent) { sandbox.__rng = mulberry32(seed); try { return sandbox.__newLife(forceTB, parent); } finally { sandbox.__rng = Math.random; } },
    rarityOf: (l) => sandbox.__rarityOf(l),
  };
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim() : null);
const len = (s) => [...s].length;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit, publicUser } = ctx;
  db.migrate('2026-11-19-horse-game', MIGRATION);
  const engine = loadEngine();

  // ---------- 種から一生を計算し直す (仔は親から順に。最近のものは覚えておく) ----------
  const qSeed = db.prepare('SELECT * FROM horse_seeds WHERE id = ?');
  const cache = new Map();
  function lifeOf(row, depth = 0) {
    if (cache.has(row.id)) { const l = cache.get(row.id); cache.delete(row.id); cache.set(row.id, l); return l; }
    if (depth > MAX_GEN) throw new Error('too deep');
    let parent = null;
    if (row.parent_id) { const pr = qSeed.get(row.parent_id); if (!pr) throw new Error('parent missing'); parent = lifeOf(pr, depth + 1); }
    const l = engine.life(row.seed, !!row.tb || !!parent, parent);
    cache.set(row.id, l); if (cache.size > 1000) cache.delete(cache.keys().next().value);
    return l;
  }
  const canParent = (l) => !!(l.isTB && (l.path === 'brood' || l.path === 'stallion'));

  // ---------- 乱数の種を出す (生まれる直前に呼ばれる) ----------
  const seedLimit = rateLimit({ windowMs: 60 * 1000, max: 40, key: (req) => 'hs' + req.user.id });
  const insSeed = db.prepare(`INSERT INTO horse_seeds (id, user_id, seed, tb, parent_id, gen, rarity, p, country, breed, headline, sub, can_parent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upStats = db.prepare(`INSERT INTO horse_stats (user_id, lives, best, best_p) VALUES (?, 1, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET lives = lives + 1,
      best = CASE WHEN best IS NULL OR instr('g1g2g3l n', excluded.best) < instr('g1g2g3l n', best) THEN excluded.best ELSE best END,
      best_p = CASE WHEN best_p IS NULL OR excluded.best_p < best_p THEN excluded.best_p ELSE best_p END`);
  app.post('/api/horse/seeds', requireAuth, seedLimit, (req, res) => {
    const b = req.body || {};
    const n = b.n === 10 ? 10 : b.n === 1 || b.n === undefined ? 1 : null;
    if (!n) return res.status(400).json({ error: '頭数が正しくありません' });
    const recent = db.prepare('SELECT COUNT(*) AS c FROM horse_seeds WHERE user_id = ? AND created_at > ?').get(req.user.id, Date.now() - 10 * 60 * 1000).c;
    if (recent + n > SEEDS_PER_10MIN) return res.status(429).json({ error: '短い時間に生まれすぎました。少し待ってからお試しください' });
    let parentRow = null, parentLife = null;
    if (b.parent != null) {
      if (n !== 1 || typeof b.parent !== 'string') return res.status(400).json({ error: '親の指定が正しくありません' });
      parentRow = qSeed.get(b.parent);
      if (!parentRow || parentRow.user_id !== req.user.id) return res.status(404).json({ error: '親の馬が見つかりません' });
      if (!parentRow.can_parent) return res.status(400).json({ error: 'この馬の仔としては生まれられません' });
      if (parentRow.gen >= MAX_GEN) return res.status(400).json({ error: `血統は${MAX_GEN}代までです` });
      try { parentLife = lifeOf(parentRow); } catch { return res.status(400).json({ error: '親の馬を確かめられませんでした' }); }
    }
    const tb = parentRow ? true : b.tb === true;
    const seeds = [];
    db.exec('BEGIN');
    try {
      for (let i = 0; i < n; i++) {
        const id = crypto.randomBytes(12).toString('base64url'), seed = crypto.randomInt(0, 2 ** 32);
        const l = engine.life(seed, tb, parentLife), r = engine.rarityOf(l);
        insSeed.run(id, req.user.id, seed, tb ? 1 : 0, parentRow ? parentRow.id : null, l.gen || 1, r, l.p,
          String(l.c.ja), String(l.breed), String(l.headline), String(l.sub || '').slice(0, 40), canParent(l) ? 1 : 0, Date.now());
        upStats.run(req.user.id, r, l.p);
        cache.set(id, l); if (cache.size > 1000) cache.delete(cache.keys().next().value);
        seeds.push({ id, seed });
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.json({ seeds });
  });

  // ---------- みんなの結果 ----------
  const playLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, key: (req) => 'hp' + req.user.id });
  app.post('/api/horse/plays', requireAuth, playLimit, (req, res) => {
    const b = req.body || {};
    // 形の確かめ (文字数・レア度の値・確率の範囲)
    const horse = clean(b.horse);
    if (!horse || len(horse) < 1 || len(horse) > 9) return res.status(400).json({ error: '馬名は1〜9文字にしてください' });
    if (typeof b.seedId !== 'string' || b.seedId.length > 40) return res.status(400).json({ error: '結果が正しくありません' });
    if (!RK.includes(b.rarity)) return res.status(400).json({ error: 'レア度が正しくありません' });
    const p = b.p;
    if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0 && p <= 1)) return res.status(400).json({ error: '確率が正しくありません' });
    for (const [k, max] of [['country', 20], ['breed', 20], ['headline', 20], ['sub', 40]]) {
      const v = b[k] ?? '';
      if (typeof v !== 'string' || len(v) > max || (k !== 'sub' && !v)) return res.status(400).json({ error: '結果が正しくありません' });
    }
    // サーバーが計算した結果と照合 (載せるのはサーバーの値)
    const s = qSeed.get(b.seedId);
    if (!s || s.user_id !== req.user.id) return res.status(404).json({ error: 'この馬の記録が見つかりません' });
    if (s.rarity !== b.rarity || Math.abs(s.p - p) > s.p * 1e-9 || s.country !== b.country || s.breed !== b.breed || s.headline !== b.headline || s.sub !== (b.sub || '')) {
      console.warn(`[horse] 結果の不一致 user=${req.user.id} seed=${s.id}`);
      return res.status(422).json({ error: 'この結果は、サーバーで計算した結果と一致しないため載せられません' });
    }
    const now = Date.now();
    const old = db.prepare('SELECT id FROM horse_plays WHERE seed_id = ?').get(s.id);
    if (old) db.prepare('UPDATE horse_plays SET horse = ? WHERE id = ?').run(horse, old.id); // もう一度載せると馬名だけ書き換わる
    else db.prepare(`INSERT INTO horse_plays (seed_id, user_id, horse, country, breed, headline, sub, rarity, p, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, req.user.id, horse, s.country, s.breed, s.headline, s.sub, s.rarity, s.p, now);
    res.json({ ok: true, updated: !!old });
  });

  app.get('/api/horse/plays', (req, res) => {
    const order = req.query.tab === 'rare' ? 'p ASC, created_at DESC' : 'created_at DESC';
    const rows = db.prepare(`SELECT hp.*, u.id AS uid FROM horse_plays hp JOIN users u ON u.id = hp.user_id ORDER BY ${order} LIMIT 30`).all();
    const users = new Map();
    const userOf = (id) => { if (!users.has(id)) { const u = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)); users.set(id, u && { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar }); } return users.get(id); };
    const st = db.prepare(`SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS players,
      SUM(rarity = 'g1') AS g1, SUM(rarity = 'g2') AS g2, SUM(rarity = 'g3') AS g3, SUM(rarity = 'l') AS l, SUM(rarity = 'n') AS n FROM horse_plays`).get();
    for (const k of RK) st[k] = st[k] || 0;
    res.json({
      stats: st,
      plays: rows.map((r) => ({ id: r.id, horse: r.horse, country: r.country, breed: r.breed, headline: r.headline, sub: r.sub,
        rarity: r.rarity, p: r.p, createdAt: r.created_at, user: userOf(r.uid), mine: !!req.user && req.user.id === r.user_id })),
    });
  });

  // ---------- 図鑑と実績 ----------
  const emptyZ = () => ({ births: 0, ten: 0, cards: [], badges: {}, countries: [], maxGen: 1, best: null, bestP: 0 });
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  function cleanCard(e) {
    if (!e || typeof e !== 'object') return null;
    const s = (v, max) => { const t = clean(v); return t !== null && len(t) <= max ? t : null; };
    const id = typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(e.id) ? e.id : null;
    const p = num(e.p, 0, 1), t = num(e.t, 0, 4e12), n = s(e.n, 9);
    if (!id || !(p > 0) || t === null || !n || !RK.includes(e.r)) return null;
    const c = { id, t, n, c: s(e.c, 8) || '', cj: s(e.cj, 20) || '', b: s(e.b, 20) || '', h: s(e.h, 20) || '', s: s(e.s, 40) || '', r: e.r, p,
      coat: s(e.coat, 10) || '', sex: e.sex === 'M' ? 'M' : 'F', path: s(e.path, 16) || '',
      kn: num(e.kn, 0, 1e5) || 0, ks: num(e.ks, 0, 1e5) || 0, kg: num(e.kg, 0, 1e5) || 0, gen: Math.floor(num(e.gen, 1, 1000) || 1) };
    return c;
  }
  // game.js の zTrim と同じ決まり: 500 枚を超えたら、レア度の低い古いカードから消す
  function trim(cards) {
    const MAX = 500; if (cards.length <= MAX) return cards;
    const drop = new Set(cards.map((e, i) => ({ i, k: RK.indexOf(e.r), t: e.t })).sort((a, b) => b.k - a.k || a.t - b.t).slice(0, cards.length - MAX).map((x) => x.i));
    return cards.filter((e, i) => !drop.has(i));
  }
  const qZ = db.prepare('SELECT data FROM horse_zukan WHERE user_id = ?');
  const loadZ = (uid) => { const r = qZ.get(uid); if (!r) return null; try { return JSON.parse(r.data); } catch { return null; } };
  app.get('/api/horse/zukan', requireAuth, (req, res) => res.json({ zukan: loadZ(req.user.id) }));
  const zLimit = rateLimit({ windowMs: 60 * 1000, max: 120, key: (req) => 'hz' + req.user.id });
  app.post('/api/horse/zukan', requireAuth, zLimit, (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.cards) || b.cards.length > 60) return res.status(400).json({ error: 'カードが多すぎます' });
    const z = Object.assign(emptyZ(), loadZ(req.user.id) || {});
    // カード: 同じ ID は新しい内容 (馬名の書き換えなど) で上書き、なければ足す
    const byId = new Map(z.cards.map((e) => [e.id, e]));
    for (const raw of b.cards) { const c = cleanCard(raw); if (c) byId.set(c.id, c); }
    z.cards = trim([...byId.values()].sort((a, b2) => b2.t - a.t));
    // バッジ: 知っている 29 種類だけ。早いほうの日時を残す
    if (b.badges && typeof b.badges === 'object') for (const [k, v] of Object.entries(b.badges)) {
      if (!BADGE_KEYS.has(k)) continue;
      const t = num(v, 1, 4e12); if (t && (!z.badges[k] || t < z.badges[k])) z.badges[k] = t;
    }
    if (Array.isArray(b.countries)) for (const c of b.countries.slice(0, 20)) if (typeof c === 'string' && /^[A-Z]{3}$/.test(c) && !z.countries.includes(c) && z.countries.length < 20) z.countries.push(c);
    z.maxGen = Math.max(z.maxGen, Math.floor(num(b.maxGen, 1, 1000) || 1));
    if (RK.includes(b.best) && (!z.best || RK.indexOf(b.best) < RK.indexOf(z.best))) z.best = b.best;
    const bp = num(b.bestP, 0, 1); if (bp > 0 && (!(z.bestP > 0) || bp < z.bestP)) z.bestP = bp;
    // 回数は「前回から増えた分」を足す (2 台で同時に遊んでも数がずれない)
    z.births += Math.floor(num(b.birthsAdd, 0, 1000) || 0);
    z.ten += Math.floor(num(b.tenAdd, 0, 100) || 0);
    db.prepare(`INSERT INTO horse_zukan (user_id, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(req.user.id, JSON.stringify(z), Date.now());
    res.json({ zukan: z });
  });

  // ---------- プロフィールに出す記録 ----------
  // 最高レア度はサーバーで確かめた値。バッジと生まれた回数は図鑑の記録
  ctx.horseSummaryOf = (userId) => {
    const st = db.prepare('SELECT lives, best, best_p FROM horse_stats WHERE user_id = ?').get(userId);
    const z = loadZ(userId);
    if (!st && !z) return null;
    return { best: st?.best || null, bestP: st?.best_p || null, badges: z ? Object.keys(z.badges || {}).filter((k) => BADGE_KEYS.has(k)).length : 0,
      badgeTotal: BADGE_KEYS.size, births: z?.births || 0 };
  };

  // ---------- 掃除: 載せていない・親にもならない古い種は 30 日で消す ----------
  setInterval(() => {
    try {
      db.prepare(`DELETE FROM horse_seeds WHERE created_at < ? AND can_parent = 0 AND id NOT IN (SELECT seed_id FROM horse_plays)`).run(Date.now() - 30 * 86400_000);
    } catch {}
  }, 6 * 3600_000).unref();

  ctx.eraseHorse = (userId) => {
    for (const t of ['horse_plays', 'horse_seeds', 'horse_zukan', 'horse_stats']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    cache.clear();
  };
};
