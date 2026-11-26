// =====================================================================
// PROJECT BOUNCE (ミニゲーム): ひっぱって弾くアクション RPG・最大 4 人の協力プレイ
//   ・戦闘はサーバーが public/games/bounce/bn-core.js で計算する (ブラウザは結果を再生するだけ)。ガチャの結果もサーバーが決める
//   ・数値は public/games/bounce/bn-data.js (設定ファイル)。ガチャの排出率は管理者が画面から上書きできる (表 bn_config)
//   ・いまはテスターだけ (環境変数 BN_TESTERS = カンマ区切りのユーザー名。未設定なら RCN413。* で全員)。ほかの人は API・接続とも 403
//   ・WebSocket /bn: ソロ・ルーム (作成・ID で参加・パスワード・ランダムマッチ・準備・ホストが出発)・戦闘の同期・再接続
// =====================================================================
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./public/games/bounce/bn-data.js');
const C = require('./public/games/bounce/bn-core.js');

const MIGRATION = `
CREATE TABLE IF NOT EXISTS bn_players (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL DEFAULT 1, rank_exp INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0,
  stamina INTEGER NOT NULL DEFAULT 0, stamina_at INTEGER NOT NULL DEFAULT 0, pity TEXT NOT NULL DEFAULT '{}', party TEXT NOT NULL DEFAULT '[]',
  login_day TEXT NOT NULL DEFAULT '', login_count INTEGER NOT NULL DEFAULT 0, stats TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bn_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, char_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1, exp INTEGER NOT NULL DEFAULT 0, evo INTEGER NOT NULL DEFAULT 0, lb INTEGER NOT NULL DEFAULT 0, skill INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, UNIQUE (user_id, char_id)
);
CREATE TABLE IF NOT EXISTS bn_items (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, item TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, item));
CREATE TABLE IF NOT EXISTS bn_gacha_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, banner TEXT NOT NULL, char_id TEXT NOT NULL, rarity TEXT NOT NULL, dup INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS bn_gacha_log_user ON bn_gacha_log(user_id, id);
CREATE TABLE IF NOT EXISTS bn_clears (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, stage TEXT NOT NULL, clears INTEGER NOT NULL DEFAULT 0, best_turns INTEGER, first_at INTEGER NOT NULL, PRIMARY KEY (user_id, stage));
CREATE TABLE IF NOT EXISTS bn_missions (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, period TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key, period));
CREATE TABLE IF NOT EXISTS bn_battles (id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT NOT NULL, result TEXT NOT NULL, turns INTEGER NOT NULL, players TEXT NOT NULL, multi INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bn_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
const START = { gems: 3000, coins: 20000, units: ['sprout', 'bubble_frog', 'coal_golem', 'spark_sprite'] };
const STAMINA_MS = 3 * 60_000, TURN_MS = 40_000, LEAVE_MS = 90_000, ROOM_IDLE_MS = 30 * 60_000;

module.exports = function install(app, ctx) {
  const { db, requireAuth, rateLimit } = ctx;
  db.migrate('2026-11-27-bounce', MIGRATION);
  const TESTERS = new Set(String(process.env.BN_TESTERS ?? 'RCN413').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const isTester = (u) => !!u && (TESTERS.has('*') || TESTERS.has(String(u.username).toLowerCase()));
  const isAdmin = (u) => !!(ctx.isAdmin && ctx.isAdmin(u));
  app.get('/api/bn-access', (req, res) => res.json({ ok: isTester(req.user) }));
  app.use('/api/bn', (req, res, next) => (isTester(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: 'PROJECT BOUNCE はまだテスト中です' })));
  const limit = rateLimit({ windowMs: 60_000, max: 90, key: (req) => 'bn' + req.user.id });
  const sr = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;
  const jstDay = (t = Date.now()) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
  const jstWeek = (t = Date.now()) => { const d = new Date(t + 9 * 3600_000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return 'w' + d.toISOString().slice(0, 10); };

  // ---------- ガチャの設定 (排出率は管理者が上書きできる) ----------
  const cfgGet = (k) => { const r = db.prepare('SELECT value FROM bn_config WHERE key = ?').get(k); try { return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const banners = () => D.GACHA.banners.map((b) => { const o = cfgGet('rates:' + b.id); return o ? { ...b, rates: o.rates || b.rates, pickupRate: o.pickupRate ?? b.pickupRate } : b; });

  // ---------- プレイヤー ----------
  const P = (uid) => db.prepare('SELECT * FROM bn_players WHERE user_id = ?').get(uid);
  const items = (uid) => Object.fromEntries(db.prepare('SELECT item, count FROM bn_items WHERE user_id = ? AND count > 0').all(uid).map((r) => [r.item, r.count]));
  const addItem = (uid, item, n) => db.prepare('INSERT INTO bn_items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = count + excluded.count').run(uid, item, n);
  const useItem = (uid, item, n) => db.prepare('UPDATE bn_items SET count = count - ? WHERE user_id = ? AND item = ? AND count >= ?').run(n, uid, item, n).changes > 0;
  const units = (uid) => db.prepare('SELECT * FROM bn_units WHERE user_id = ? ORDER BY id').all(uid);
  const unitView = (u) => { const c = D.CHAR[u.char_id], s = C.unitStats({ char: u.char_id, level: u.level, evo: u.evo, lb: u.lb, skill: u.skill }); return { id: u.id, char: u.char_id, level: u.level, exp: u.exp, evo: u.evo, lb: u.lb, skill: u.skill, maxLv: D.LEVEL_CAP[c.rarity], next: D.GROW.expFor(u.level), ...s }; };
  const statsOf = (p) => { try { return JSON.parse(p.stats || '{}'); } catch { return {}; } };
  function ensure(uid) {
    if (P(uid)) return;
    const now = Date.now();
    db.prepare('INSERT OR IGNORE INTO bn_players (user_id, gems, coins, stamina, stamina_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, START.gems, START.coins, D.RANK.staminaAt(1), now, now);
    for (const c of START.units) db.prepare('INSERT OR IGNORE INTO bn_units (user_id, char_id, created_at) VALUES (?, ?, ?)').run(uid, c, now);
    const ids = units(uid).map((u) => u.id).slice(0, 4);
    db.prepare('UPDATE bn_players SET party = ? WHERE user_id = ?').run(JSON.stringify(ids), uid);
  }
  // スタミナ (3 分で 1 回復・上限はランクで決まる)
  function stamina(uid) {
    const p = P(uid), max = D.RANK.staminaAt(p.rank), now = Date.now();
    if (p.stamina >= max) { db.prepare('UPDATE bn_players SET stamina_at = ? WHERE user_id = ?').run(now, uid); return { now: p.stamina, max, nextMs: 0 }; }
    const gain = Math.floor((now - p.stamina_at) / STAMINA_MS);
    if (gain > 0) { const v = Math.min(max, p.stamina + gain); db.prepare('UPDATE bn_players SET stamina = ?, stamina_at = ? WHERE user_id = ?').run(v, v >= max ? now : p.stamina_at + gain * STAMINA_MS, uid); }
    const q = P(uid); return { now: q.stamina, max, nextMs: q.stamina >= max ? 0 : STAMINA_MS - ((now - q.stamina_at) % STAMINA_MS) };
  }
  function grant(uid, r, why) { // 報酬 { gems, coins, items }
    if (!r) return;
    if (r.gems || r.coins) db.prepare('UPDATE bn_players SET gems = gems + ?, coins = coins + ? WHERE user_id = ?').run(r.gems || 0, r.coins || 0, uid);
    for (const [k, n] of Object.entries(r.items || {})) addItem(uid, k, n);
  }
  // ミッション・実績の数え上げ
  function bump(uid, stat, n = 1) {
    const p = P(uid), st = statsOf(p); st[stat] = (st[stat] || 0) + n;
    db.prepare('UPDATE bn_players SET stats = ? WHERE user_id = ?').run(JSON.stringify(st), uid);
    for (const [kind, list] of Object.entries(D.MISSIONS)) {
      const period = kind === 'daily' ? jstDay() : jstWeek();
      for (const m of list.filter((x) => x.stat === stat)) db.prepare('INSERT INTO bn_missions (user_id, key, period, progress) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key, period) DO UPDATE SET progress = progress + excluded.progress').run(uid, m.key, period, n);
    }
  }
  // ログインボーナス (日本時間の日付が変わって最初に開いたとき)
  function loginBonus(uid) {
    const p = P(uid), day = jstDay(); if (p.login_day === day) return null;
    const i = p.login_count % D.LOGIN_BONUS.length, r = D.LOGIN_BONUS[i];
    const ok = db.prepare('UPDATE bn_players SET login_day = ?, login_count = login_count + 1 WHERE user_id = ? AND login_day != ?').run(day, uid, day).changes;
    if (!ok) return null;
    grant(uid, r, 'login'); return { day: i + 1, reward: r };
  }
  function addRankExp(uid, n) {
    const p = P(uid); let rank = p.rank, exp = p.rank_exp + n, up = 0;
    while (exp >= D.RANK.expFor(rank) && rank < 200) { exp -= D.RANK.expFor(rank); rank++; up++; }
    db.prepare('UPDATE bn_players SET rank = ?, rank_exp = ?, stamina = stamina + ? WHERE user_id = ?').run(rank, exp, up ? D.RANK.staminaAt(rank) : 0, uid); // ランクが上がったらスタミナ全回復ぶんを足す
    return up;
  }
  function addUnitExp(u, n) { // u = 行
    const c = D.CHAR[u.char_id], cap = D.LEVEL_CAP[c.rarity]; let lv = u.level, exp = u.exp + n;
    while (lv < cap && exp >= D.GROW.expFor(lv)) { exp -= D.GROW.expFor(lv); lv++; }
    if (lv >= cap) exp = 0;
    db.prepare('UPDATE bn_units SET level = ?, exp = ? WHERE id = ?').run(lv, exp, u.id);
    return lv - u.level;
  }
  function missionsView(uid) {
    const st = statsOf(P(uid)), out = {};
    for (const [kind, list] of Object.entries(D.MISSIONS)) {
      const period = kind === 'daily' ? jstDay() : jstWeek();
      out[kind] = list.map((m) => { const r = db.prepare('SELECT progress, claimed FROM bn_missions WHERE user_id = ? AND key = ? AND period = ?').get(uid, m.key, period) || { progress: 0, claimed: 0 }; return { ...m, progress: Math.min(m.goal, r.progress), claimed: !!r.claimed }; });
    }
    out.achievements = D.ACHIEVEMENTS.map((a) => { const r = db.prepare('SELECT claimed FROM bn_missions WHERE user_id = ? AND key = ? AND period = ?').get(uid, a.key, 'all'); return { ...a, progress: Math.min(a.goal, st[a.stat] || 0), claimed: !!r?.claimed }; });
    return out;
  }
  function meView(uid) {
    const p = P(uid), us = units(uid).map(unitView), owned = new Set(us.map((u) => u.char));
    return { player: { rank: p.rank, rankExp: p.rank_exp, rankNext: D.RANK.expFor(p.rank), gems: p.gems, coins: p.coins, stamina: stamina(uid), party: JSON.parse(p.party), loginCount: p.login_count, stats: statsOf(p), pity: JSON.parse(p.pity) },
      units: us, items: items(uid), banners: banners(), clears: Object.fromEntries(db.prepare('SELECT stage, clears, best_turns FROM bn_clears WHERE user_id = ?').all(uid).map((r) => [r.stage, { clears: r.clears, best: r.best_turns }])),
      zukan: D.CHARS.map((c) => ({ id: c.id, owned: owned.has(c.id) })), missions: missionsView(uid) };
  }

  app.get('/api/bn/me', requireAuth, (req, res) => { ensure(req.user.id); const bonus = loginBonus(req.user.id); res.json({ ...meView(req.user.id), loginBonus: bonus, admin: isAdmin(req.user), me: { username: req.user.username, displayName: req.user.display_name } }); });

  // ---------- ガチャ (結果はサーバーが決める) ----------
  function pullOne(b, pity) {
    pity.n = (pity.n || 0) + 1;
    if (b.pickup && pity.n >= D.GACHA.pity) { pity.n = 0; return D.CHAR[b.pickup]; } // 天井: ピックアップ確定
    const roll = sr() * 100; let acc = 0, rar = 'N';
    for (const r of ['UR', 'SSR', 'SR', 'R', 'N']) { acc += b.rates[r] || 0; if (roll < acc) { rar = r; break; } }
    if (rar === 'UR' && b.pickup && sr() * (b.rates.UR || 1) < b.pickupRate) { pity.n = 0; return D.CHAR[b.pickup]; }
    let pool = D.CHARS.filter((c) => c.rarity === rar && (!c.limited || (b.limited || []).includes(c.id)) && c.id !== b.pickup);
    if (!pool.length) pool = D.CHARS.filter((c) => c.rarity === 'SSR' && !c.limited);
    const c = pool[Math.floor(sr() * pool.length)];
    if (c.id === b.pickup) pity.n = 0;
    return c;
  }
  app.post('/api/bn/gacha', requireAuth, limit, (req, res) => {
    const uid = req.user.id; ensure(uid);
    const b = banners().find((x) => x.id === String(req.body?.banner || '')); if (!b) return res.status(400).json({ error: 'そのガチャはありません' });
    const n = req.body?.n === 10 ? 10 : 1, cost = n === 10 ? D.GACHA.ten : D.GACHA.single;
    if (!db.prepare('UPDATE bn_players SET gems = gems - ? WHERE user_id = ? AND gems >= ?').run(cost, uid, cost).changes) return res.status(400).json({ error: `ジェムが足りません (${cost} 必要)` });
    const p = P(uid), pities = JSON.parse(p.pity), pity = pities[b.id] || { n: 0 };
    const out = [];
    db.exec('BEGIN');
    try {
      for (let i = 0; i < n; i++) {
        let c = pullOne(b, pity);
        if (n === 10 && i === 9 && !out.some((x) => ['SR', 'SSR', 'UR'].includes(x.rarity)) && ['N', 'R'].includes(c.rarity)) { const pool = D.CHARS.filter((x) => x.rarity === 'SR'); c = pool[Math.floor(sr() * pool.length)]; } // 10 連は SR 以上 1 体確定
        const had = db.prepare('SELECT * FROM bn_units WHERE user_id = ? AND char_id = ?').get(uid, c.id);
        let dup = null;
        if (!had) db.prepare('INSERT INTO bn_units (user_id, char_id, created_at) VALUES (?, ?, ?)').run(uid, c.id, Date.now());
        else if (had.lb < D.GROW.limitBreak.max) { db.prepare('UPDATE bn_units SET lb = lb + 1 WHERE id = ?').run(had.id); dup = { kind: 'lb', lb: had.lb + 1 }; } // 重複: 限界突破
        else { const k = { N: 1, R: 2, SR: 5, SSR: 15, UR: 40 }[c.rarity]; addItem(uid, 'star_shard', k); dup = { kind: 'shard', n: k }; } // 限界突破が最大なら星のかけら
        db.prepare('INSERT INTO bn_gacha_log (user_id, banner, char_id, rarity, dup, at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, b.id, c.id, c.rarity, dup ? 1 : 0, Date.now());
        if (c.rarity === 'UR') bump(uid, 'ur');
        out.push({ char: c.id, rarity: c.rarity, limited: !!c.limited, isNew: !had, dup });
      }
      pities[b.id] = pity;
      db.prepare('UPDATE bn_players SET pity = ? WHERE user_id = ?').run(JSON.stringify(pities), uid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    bump(uid, 'gacha', n);
    res.json({ results: out, ...meView(uid) });
  });
  app.get('/api/bn/gacha/history', requireAuth, (req, res) => res.json({ history: db.prepare('SELECT banner, char_id AS char, rarity, dup, at FROM bn_gacha_log WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id) }));
  // 管理者: 排出率を変える (合計 100%)
  app.post('/api/bn/admin/rates', requireAuth, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: '管理者だけが変えられます' });
    const b = D.GACHA.banners.find((x) => x.id === String(req.body?.banner || '')); if (!b) return res.status(400).json({ error: 'そのガチャはありません' });
    const rates = {}; let sum = 0;
    for (const r of ['UR', 'SSR', 'SR', 'R', 'N']) { const v = Number(req.body?.rates?.[r]); if (!(v >= 0 && v <= 100)) return res.status(400).json({ error: `${r} の確率が正しくありません` }); rates[r] = Math.round(v * 100) / 100; sum += rates[r]; }
    if (Math.abs(sum - 100) > 0.01) return res.status(400).json({ error: `合計を 100% にしてください (いま ${sum.toFixed(2)}%)` });
    const pickupRate = b.pickup ? Number(req.body?.pickupRate) : undefined;
    if (b.pickup && !(pickupRate >= 0 && pickupRate <= rates.UR)) return res.status(400).json({ error: 'ピックアップの確率は 0〜UR の確率のあいだにしてください' });
    db.prepare('INSERT INTO bn_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('rates:' + b.id, JSON.stringify({ rates, pickupRate }));
    console.log(`[bounce] 排出率を変更: ${b.id} by ${req.user.username}`);
    res.json({ banners: banners() });
  });

  // ---------- 育成 ----------
  const ownUnit = (uid, id) => db.prepare('SELECT * FROM bn_units WHERE id = ? AND user_id = ?').get(Number(id), uid);
  app.post('/api/bn/unit/:id/feed', requireAuth, limit, (req, res) => { // レベルアップ: 経験の書を使う
    const u = ownUnit(req.user.id, req.params.id); if (!u) return res.status(404).json({ error: 'キャラが見つかりません' });
    const item = String(req.body?.item || ''), n = Math.max(1, Math.min(99, Number(req.body?.n) || 1));
    if (!D.MATERIALS[item]?.exp) return res.status(400).json({ error: 'その素材では経験値は増えません' });
    if (u.level >= D.LEVEL_CAP[D.CHAR[u.char_id].rarity]) return res.status(400).json({ error: 'もうレベルが最大です' });
    const coin = 100 * n;
    if (!db.prepare('UPDATE bn_players SET coins = coins - ? WHERE user_id = ? AND coins >= ?').run(coin, req.user.id, coin).changes) return res.status(400).json({ error: `コインが足りません (${coin})` });
    if (!useItem(req.user.id, item, n)) { grant(req.user.id, { coins: coin }); return res.status(400).json({ error: '素材が足りません' }); }
    const up = addUnitExp(u, D.MATERIALS[item].exp * n);
    res.json({ up, ...meView(req.user.id) });
  });
  app.post('/api/bn/unit/:id/evolve', requireAuth, limit, (req, res) => { // 進化: 属性の結晶
    const u = ownUnit(req.user.id, req.params.id); if (!u) return res.status(404).json({ error: 'キャラが見つかりません' });
    if (u.evo >= D.GROW.evo.max) return res.status(400).json({ error: 'これ以上は進化できません' });
    const c = D.CHAR[u.char_id], cost = D.evoCost(c, u.evo), coin = 5000 * (u.evo + 1);
    if (u.level < Math.min(D.LEVEL_CAP[c.rarity], 20 * (u.evo + 1))) return res.status(400).json({ error: `Lv${Math.min(D.LEVEL_CAP[c.rarity], 20 * (u.evo + 1))} になると進化できます` });
    const have = items(req.user.id);
    for (const [k, n] of Object.entries(cost)) if ((have[k] || 0) < n) return res.status(400).json({ error: `${D.MATERIALS[k].name} が ${n} 個必要です` });
    if (!db.prepare('UPDATE bn_players SET coins = coins - ? WHERE user_id = ? AND coins >= ?').run(coin, req.user.id, coin).changes) return res.status(400).json({ error: `コインが足りません (${coin})` });
    for (const [k, n] of Object.entries(cost)) useItem(req.user.id, k, n);
    db.prepare('UPDATE bn_units SET evo = evo + 1 WHERE id = ?').run(u.id);
    res.json(meView(req.user.id));
  });
  app.post('/api/bn/unit/:id/skill', requireAuth, limit, (req, res) => { // スキル強化: スキルの書 (必殺技のターンが 10% ずつ短く・最大 5)
    const u = ownUnit(req.user.id, req.params.id); if (!u) return res.status(404).json({ error: 'キャラが見つかりません' });
    if (u.skill >= 5) return res.status(400).json({ error: 'スキルはもう最大です' });
    if (!useItem(req.user.id, 'skill_book', 1)) return res.status(400).json({ error: 'スキルの書が必要です' });
    db.prepare('UPDATE bn_units SET skill = skill + 1 WHERE id = ?').run(u.id);
    res.json(meView(req.user.id));
  });
  app.post('/api/bn/unit/:id/limit', requireAuth, limit, (req, res) => { // 限界突破: 星のかけらでも (ダブりがなくても)
    const u = ownUnit(req.user.id, req.params.id); if (!u) return res.status(404).json({ error: 'キャラが見つかりません' });
    if (u.lb >= D.GROW.limitBreak.max) return res.status(400).json({ error: '限界突破はもう最大です' });
    const need = { N: 2, R: 4, SR: 10, SSR: 30, UR: 80 }[D.CHAR[u.char_id].rarity];
    if (!useItem(req.user.id, 'star_shard', need)) return res.status(400).json({ error: `星のかけらが ${need} 個必要です` });
    db.prepare('UPDATE bn_units SET lb = lb + 1 WHERE id = ?').run(u.id);
    res.json(meView(req.user.id));
  });
  app.post('/api/bn/synth', requireAuth, limit, (req, res) => { // 素材合成
    const to = String(req.body?.to || ''), r = D.SYNTH[to]; if (!r) return res.status(400).json({ error: 'その素材は作れません' });
    if (!useItem(req.user.id, r.from, r.n)) return res.status(400).json({ error: `${D.MATERIALS[r.from].name} が ${r.n} 個必要です` });
    addItem(req.user.id, to, 1); res.json(meView(req.user.id));
  });
  app.post('/api/bn/shop', requireAuth, limit, (req, res) => {
    const it = D.SHOP.find((x) => x.id === String(req.body?.id || '')); if (!it) return res.status(400).json({ error: 'その商品はありません' });
    const g = it.price.gems || 0, c = it.price.coins || 0;
    if (!db.prepare('UPDATE bn_players SET gems = gems - ?, coins = coins - ? WHERE user_id = ? AND gems >= ? AND coins >= ?').run(g, c, req.user.id, g, c).changes) return res.status(400).json({ error: g ? 'ジェムが足りません' : 'コインが足りません' });
    if (it.give.stamina) { const max = D.RANK.staminaAt(P(req.user.id).rank); db.prepare('UPDATE bn_players SET stamina = MAX(stamina, ?), stamina_at = ? WHERE user_id = ?').run(max, Date.now(), req.user.id); }
    grant(req.user.id, it.give); res.json(meView(req.user.id));
  });
  app.post('/api/bn/party', requireAuth, limit, (req, res) => {
    const ids = Array.isArray(req.body?.units) ? [...new Set(req.body.units.map(Number))].slice(0, 4) : [];
    if (!ids.length || ids.some((id) => !ownUnit(req.user.id, id))) return res.status(400).json({ error: '編成が正しくありません' });
    db.prepare('UPDATE bn_players SET party = ? WHERE user_id = ?').run(JSON.stringify(ids), req.user.id);
    res.json(meView(req.user.id));
  });
  app.post('/api/bn/claim', requireAuth, limit, (req, res) => { // ミッション・実績の報酬
    const uid = req.user.id, key = String(req.body?.key || '');
    const daily = D.MISSIONS.daily.find((m) => m.key === key), weekly = D.MISSIONS.weekly.find((m) => m.key === key), ach = D.ACHIEVEMENTS.find((a) => a.key === key);
    const m = daily || weekly || ach; if (!m) return res.status(400).json({ error: 'そのミッションはありません' });
    const period = daily ? jstDay() : weekly ? jstWeek() : 'all';
    const prog = ach ? (statsOf(P(uid))[ach.stat] || 0) : (db.prepare('SELECT progress FROM bn_missions WHERE user_id = ? AND key = ? AND period = ?').get(uid, key, period)?.progress || 0);
    if (prog < m.goal) return res.status(400).json({ error: 'まだ達成していません' });
    db.prepare('INSERT INTO bn_missions (user_id, key, period, progress) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key, period) DO NOTHING').run(uid, key, period, prog);
    if (!db.prepare('UPDATE bn_missions SET claimed = 1 WHERE user_id = ? AND key = ? AND period = ? AND claimed = 0').run(uid, key, period).changes) return res.status(400).json({ error: 'もう受け取りました' });
    grant(uid, m.reward); res.json(meView(uid));
  });
  // フレンド = IppO で相互フォローの人 (PROJECT BOUNCE を始めている人)
  const friends = (uid) => (ctx.mutualsOf ? ctx.mutualsOf(uid) : []).map((id) => { const p = P(id), u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(id); if (!p || !u) return null; const party = JSON.parse(p.party); const lead = party[0] && db.prepare('SELECT char_id, level FROM bn_units WHERE id = ?').get(party[0]); return { username: u.username, name: u.display_name, rank: p.rank, leader: lead ? { char: lead.char_id, level: lead.level } : null, online: !!userConns.get(id)?.size }; }).filter(Boolean);
  app.get('/api/bn/friends', requireAuth, (req, res) => res.json({ friends: friends(req.user.id) }));
  app.get('/api/bn/profile/:username', requireAuth, (req, res) => {
    const u = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(String(req.params.username)); const p = u && P(u.id);
    if (!p) return res.status(404).json({ error: 'プレイヤーが見つかりません' });
    const party = JSON.parse(p.party).map((id) => db.prepare('SELECT char_id, level, evo, lb FROM bn_units WHERE id = ?').get(id)).filter(Boolean);
    const rec = db.prepare("SELECT COUNT(*) AS n, SUM(result = 'win') AS w FROM bn_battles WHERE players LIKE ?").get(`%"${u.id}"%`);
    res.json({ username: u.username, name: u.display_name, rank: p.rank, stats: statsOf(p), party, units: db.prepare('SELECT COUNT(*) AS n FROM bn_units WHERE user_id = ?').get(u.id).n, battles: rec.n || 0, wins: rec.w || 0, clears: db.prepare('SELECT COUNT(*) AS n FROM bn_clears WHERE user_id = ?').get(u.id).n });
  });
  app.get('/api/bn/records', requireAuth, (req, res) => res.json({ battles: db.prepare('SELECT stage, result, turns, multi, at FROM bn_battles WHERE players LIKE ? ORDER BY id DESC LIMIT 50').all(`%"${req.user.id}"%`) }));

  // ---------- ルーム・戦闘 (WebSocket /bn) ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const userConns = new Map(); // uid → Set(ws)
  const rooms = new Map();     // id → room
  const roomOf = new Map();    // uid → room id
  const send = (ws, m) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch {} };
  const sendUser = (uid, m) => userConns.get(uid)?.forEach((ws) => send(ws, m));
  const roomView = (r) => ({ id: r.id, stage: r.stage, host: r.host, solo: r.solo, locked: !!r.pass, isPublic: r.isPublic, phase: r.phase,
    members: r.members.map((m) => ({ uid: m.uid, name: m.name, username: m.username, unit: m.unit ? { char: m.unit.char_id, level: m.unit.level } : null, ready: m.ready, connected: m.connected })) });
  const broadcast = (r, m) => r.members.forEach((x) => sendUser(x.uid, m));
  const pushRoom = (r) => broadcast(r, { t: 'room', room: roomView(r) });
  const newId = () => { let id; do { id = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(id)); return id; };
  const hashPass = (p) => crypto.createHash('sha256').update('bn:' + p).digest('hex');
  function leaveRoom(uid) {
    const id = roomOf.get(uid); if (!id) return; roomOf.delete(uid);
    const r = rooms.get(id); if (!r) return;
    if (r.phase === 'battle') { const m = r.members.find((x) => x.uid === uid); if (m) { m.connected = false; m.left = true; } pushRoom(r); return; } // 戦闘中に抜けたら、その人のキャラは自動で動く
    r.members = r.members.filter((m) => m.uid !== uid);
    if (!r.members.length) { clearTimeout(r.timer); rooms.delete(id); return; }
    if (r.host === uid) r.host = r.members[0].uid;
    pushRoom(r);
  }
  function joinRoom(r, user, unit) {
    leaveRoom(user.id);
    r.members.push({ uid: user.id, name: user.display_name, username: user.username, unit, ready: false, connected: true });
    roomOf.set(user.id, r.id); r.at = Date.now();
    pushRoom(r);
  }
  const leaderUnit = (uid) => { const p = P(uid); const id = JSON.parse(p.party)[0]; return (id && db.prepare('SELECT * FROM bn_units WHERE id = ? AND user_id = ?').get(id, uid)) || units(uid)[0]; };
  function startBattle(r) {
    const st = D.STAGES.find((s) => s.id === r.stage);
    for (const m of r.members) { stamina(m.uid); if (!db.prepare('UPDATE bn_players SET stamina = stamina - ? WHERE user_id = ? AND stamina >= ?').run(st.stamina, m.uid, st.stamina).changes) { broadcast(r, { t: 'error', msg: `${m.name} さんのスタミナが足りません (${st.stamina} 必要)` }); return false; } }
    const party = r.solo ? JSON.parse(P(r.host).party).map((id) => ownUnit(r.host, id)).filter(Boolean).map((u) => ({ owner: r.host, char: u.char_id, level: u.level, evo: u.evo, lb: u.lb, skill: u.skill, unitId: u.id }))
      : r.members.map((m) => ({ owner: m.uid, char: m.unit.char_id, level: m.unit.level, evo: m.unit.evo, lb: m.unit.lb, skill: m.unit.skill, unitId: m.unit.id }));
    r.party = party;
    r.state = C.newBattle(r.stage, party, crypto.randomInt(1, 2 ** 31));
    r.phase = 'battle'; r.nextAt = Date.now() + 1500; r.startedAt = Date.now();
    pushRoom(r);
    broadcast(r, { t: 'battle', state: C.pub(r.state), room: roomView(r) });
    armTurn(r);
    return true;
  }
  // ターンの時間切れ (自動で撃つ)・抜けた人のキャラも自動で撃つ
  function armTurn(r) {
    clearTimeout(r.timer);
    if (r.phase !== 'battle') return;
    const u = r.state.units[r.state.current], m = r.members.find((x) => x.uid === u.owner);
    const auto = !m || m.left || (!m.connected && Date.now() - (m.offAt || 0) > LEAVE_MS);
    const wait = Math.max(0, r.nextAt - Date.now()) + (auto ? 1200 : TURN_MS);
    r.turnDeadline = Date.now() + wait;
    broadcast(r, { t: 'turn', current: r.state.current, owner: u.owner, deadline: r.turnDeadline, auto });
    r.timer = setTimeout(() => autoShoot(r), wait);
  }
  function autoShoot(r) {
    if (r.phase !== 'battle') return;
    const u = r.state.units[r.state.current], t = r.state.enemies.filter((e) => e.hp > 0).sort((a, b) => a.hp - b.hp)[0] || { x: 180, y: 120 };
    const d = Math.hypot(t.x - u.x, t.y - u.y) || 1;
    doShoot(r, { dx: (t.x - u.x) / d * 0.85, dy: (t.y - u.y) / d * 0.85, special: u.spLeft <= 0 }, true);
  }
  function doShoot(r, input, auto = false) {
    const res = C.shoot(r.state, input);
    r.nextAt = Date.now() + Math.round(res.frames.length * C.FRAME_EVERY * 1000 / 60) + 900; // ブラウザで再生し終わるまで次は撃てない
    broadcast(r, { t: 'shot', unit: res.unit, auto, frames: res.frames, events: res.events, state: C.pub(r.state) });
    if (r.state.over) return finish(r);
    armTurn(r);
  }
  function finish(r) {
    clearTimeout(r.timer); r.phase = 'done';
    const st = D.STAGES.find((s) => s.id === r.stage), win = r.state.over === 'win', s = r.state.stats;
    db.prepare('INSERT INTO bn_battles (stage, result, turns, players, multi, at) VALUES (?, ?, ?, ?, ?, ?)').run(r.stage, r.state.over, r.state.turn, JSON.stringify(r.members.map((m) => String(m.uid))), r.solo ? 0 : 1, Date.now());
    const results = {};
    for (const m of r.members) {
      const out = { win, reward: null, drops: {}, rankUp: 0, levelUps: [] };
      if (win) {
        const reward = { ...st.reward, items: {} };
        for (const [item, p] of st.drops || []) if (sr() < p) reward.items[item] = (reward.items[item] || 0) + 1;
        if (!r.solo) reward.gems = Math.round((reward.gems || 0) * 1.2); // マルチは少しおまけ
        grant(m.uid, reward); out.reward = reward;
        const first = !db.prepare('SELECT 1 FROM bn_clears WHERE user_id = ? AND stage = ?').get(m.uid, r.stage);
        db.prepare('INSERT INTO bn_clears (user_id, stage, clears, best_turns, first_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id, stage) DO UPDATE SET clears = clears + 1, best_turns = MIN(COALESCE(best_turns, 9999), excluded.best_turns)').run(m.uid, r.stage, r.state.turn, Date.now());
        if (first) { grant(m.uid, { gems: 30 }); out.firstClear = 30; }
        out.rankUp = addRankExp(m.uid, Math.round(st.reward.exp / 3));
        const mine = r.party.filter((p) => p.owner === m.uid);
        for (const p of mine) { const row = ownUnit(m.uid, p.unitId); if (row) { const up = addUnitExp(row, st.reward.exp); if (up) out.levelUps.push({ char: row.char_id, up }); } }
        bump(m.uid, 'clear'); if (!r.solo) bump(m.uid, 'multi'); if (s.boss) bump(m.uid, 'boss', s.boss);
      }
      if (s.combo) bump(m.uid, 'combo', s.combo); if (s.special) bump(m.uid, 'special', s.special);
      results[m.uid] = out;
    }
    r.members.forEach((m) => sendUser(m.uid, { t: 'result', result: results[m.uid], turns: r.state.turn, stats: s, me: meView(m.uid) }));
    // 結果のあとはロビーにもどる (ソロはルームを閉じる)
    if (r.solo) { r.members.forEach((m) => roomOf.delete(m.uid)); rooms.delete(r.id); return; }
    r.members = r.members.filter((m) => !m.left); r.members.forEach((m) => { m.ready = false; }); r.phase = 'lobby'; r.state = null;
    if (!r.members.length) rooms.delete(r.id); else { if (!r.members.some((m) => m.uid === r.host)) r.host = r.members[0].uid; pushRoom(r); }
  }

  wss.on('connection', (ws, req, user) => {
    ensure(user.id);
    if (!userConns.has(user.id)) userConns.set(user.id, new Set());
    userConns.get(user.id).add(ws);
    // 再接続: 入っていたルームの続きから
    const rid = roomOf.get(user.id), r0 = rid && rooms.get(rid);
    if (r0) { const m = r0.members.find((x) => x.uid === user.id); if (m) { m.connected = true; m.offAt = 0; } pushRoom(r0); if (r0.phase === 'battle') { send(ws, { t: 'battle', state: C.pub(r0.state), room: roomView(r0), resumed: true }); send(ws, { t: 'turn', current: r0.state.current, owner: r0.state.units[r0.state.current].owner, deadline: r0.turnDeadline }); } }
    else send(ws, { t: 'hello' });
    let hits = 0; const iv = setInterval(() => { hits = 0; }, 1000);
    ws.on('message', (raw) => {
      if (++hits > 15) return;
      let m; try { m = JSON.parse(raw); } catch { return; } if (!m || typeof m !== 'object') return;
      const err = (msg) => send(ws, { t: 'error', msg });
      const stage = D.STAGES.find((s) => s.id === String(m.stage || ''));
      const r = rooms.get(roomOf.get(user.id));
      if (m.t === 'solo' || m.t === 'create') {
        if (!stage) return err('ステージがありません');
        if (r && r.phase === 'battle') return err('戦闘中です');
        const unit = leaderUnit(user.id);
        const room = { id: newId(), stage: stage.id, host: user.id, solo: m.t === 'solo', pass: m.t === 'create' && m.password ? hashPass(String(m.password).slice(0, 20)) : null, isPublic: m.t === 'create' && !m.password && m.isPublic !== false, phase: 'lobby', members: [], at: Date.now() };
        rooms.set(room.id, room); joinRoom(room, user, unit);
        if (room.solo) { room.members[0].ready = true; if (!startBattle(room)) { leaveRoom(user.id); } }
        return;
      }
      if (m.t === 'join') {
        const t = rooms.get(String(m.id || '')); if (!t || t.solo) return err('そのルームは見つかりません');
        if (t.phase !== 'lobby') return err('そのルームはもう出発しています');
        if (t.members.length >= 4) return err('ルームがいっぱいです (4 人まで)');
        if (t.pass && t.pass !== hashPass(String(m.password || '').slice(0, 20))) return err('パスワードがちがいます');
        return joinRoom(t, user, leaderUnit(user.id));
      }
      if (m.t === 'random') { // ランダムマッチ: 同じステージの公開ルームに入る (なければ作る)
        if (!stage) return err('ステージがありません');
        const t = [...rooms.values()].find((x) => !x.solo && x.isPublic && x.phase === 'lobby' && x.stage === stage.id && x.members.length < 4 && !x.members.some((y) => y.uid === user.id));
        if (t) return joinRoom(t, user, leaderUnit(user.id));
        const room = { id: newId(), stage: stage.id, host: user.id, solo: false, pass: null, isPublic: true, phase: 'lobby', members: [], at: Date.now() };
        rooms.set(room.id, room); joinRoom(room, user, leaderUnit(user.id)); send(ws, { t: 'info', msg: '同じクエストの部屋がなかったので、公開ルームを作りました。だれかが入るのを待っています' });
        return;
      }
      if (!r) return m.t === 'leave' ? send(ws, { t: 'left' }) : err('ルームに入っていません');
      const me = r.members.find((x) => x.uid === user.id);
      if (m.t === 'leave') { leaveRoom(user.id); return send(ws, { t: 'left' }); }
      if (m.t === 'unit' && r.phase === 'lobby') { const u = ownUnit(user.id, m.id); if (!u) return err('キャラが見つかりません'); me.unit = u; me.ready = false; return pushRoom(r); } // 担当キャラ
      if (m.t === 'ready' && r.phase === 'lobby') { me.ready = !!m.on; return pushRoom(r); }
      if (m.t === 'stage' && r.phase === 'lobby' && r.host === user.id && stage) { r.stage = stage.id; r.members.forEach((x) => { x.ready = false; }); return pushRoom(r); }
      if (m.t === 'start' && r.phase === 'lobby') {
        if (r.host !== user.id) return err('出発できるのはホストだけです');
        if (r.members.some((x) => x.uid !== r.host && !x.ready)) return err('全員の準備ができていません');
        return startBattle(r);
      }
      if (m.t === 'invite' && r.phase === 'lobby') { // フレンド (相互フォロー) を招待: IppO の画面に通知が出る
        const target = db.prepare('SELECT id FROM users WHERE username = ?').get(String(m.username || ''));
        if (!target || !(ctx.mutualsOf ? ctx.mutualsOf(user.id) : []).includes(target.id)) return err('相互フォローの人だけ招待できます');
        ctx.rt?.sendToUsers?.([target.id], { t: 'bn-invite', from: user.username, name: user.display_name, room: r.id, stage: D.STAGES.find((s) => s.id === r.stage)?.name || '' });
        return send(ws, { t: 'info', msg: '招待を送りました' });
      }
      if (m.t === 'shoot' && r.phase === 'battle') {
        const u = r.state.units[r.state.current];
        if (u.owner !== user.id) return err('いまはあなたの番ではありません');
        if (Date.now() < r.nextAt - 300) return; // 再生中
        const dx = Number(m.dx), dy = Number(m.dy);
        if (!isFinite(dx) || !isFinite(dy) || Math.hypot(dx, dy) > 1.5 || Math.hypot(dx, dy) < 0.02) return err('ショットが正しくありません');
        return doShoot(r, { dx, dy, special: !!m.special });
      }
    });
    ws.on('close', () => {
      clearInterval(iv); userConns.get(user.id)?.delete(ws);
      if (userConns.get(user.id)?.size) return;
      const r = rooms.get(roomOf.get(user.id)); if (!r) return;
      const m = r.members.find((x) => x.uid === user.id); if (!m) return;
      if (r.phase === 'battle') { m.connected = false; m.offAt = Date.now(); pushRoom(r); return; } // 戦闘中は再接続を待つ (90 秒すぎるとキャラは自動で動く)
      leaveRoom(user.id);
    });
  });
  setInterval(() => { for (const [id, r] of rooms) if (r.phase !== 'battle' && Date.now() - r.at > ROOM_IDLE_MS) { r.members.forEach((m) => { roomOf.delete(m.uid); sendUser(m.uid, { t: 'left', msg: 'ルームの時間切れです' }); }); rooms.delete(id); } }, 60_000).unref();

  ctx.bounceUpgrade = (req, socket, head, user) => {
    if (!isTester(user)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  };
};
