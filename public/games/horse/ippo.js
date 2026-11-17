// =====================================================================
// 117万分の1 競走馬版 × IppO のつなぎ (ログイン・保存先・シェア・テーマ)
//
// ゲームの確率・文章・演出 (logic.js / game.js) には手を入れず、ここで次のことだけを行う。
//  ・ログイン中か調べる (IppO と同じ Cookie。ゲストでも遊べるが、載せる・保存する・シェアするにはログインが必要)
//  ・生まれる前にサーバーから「乱数の種」をもらい、その種で一生を決める (確率の計算はそのまま。
//    サーバーが同じ種で計算し直すので、レア度や確率をごまかして載せることはできない)
//  ・図鑑と実績をアカウントごとにサーバーへ保存する (端末をまたいで引き継ぐ。初回だけこの端末の分を取りこめる)
//  ・結果カードと文章を IppO の投稿としてシェアする
//  ・IppO のライト / ダークに合わせる
// このファイルは game.js より前に読み込まれる。game.js の関数・変数は、呼ばれた時点で参照する
// =====================================================================
'use strict';
const IPPO = (() => {
  const inFrame = window.parent !== window;
  const I = { user: null, queue: [], ready: false };

  // ---------- API (IppO と同じドメインなので Cookie でログイン状態が伝わる) ----------
  I.api = async (path, { method = 'GET', body } = {}) => {
    const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(d.error || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return d;
  };
  // 親の IppO の画面に伝える (同じドメインの親にだけ送る)
  const tell = (msg) => { if (inFrame) parent.postMessage(Object.assign({ source: 'ippo-horse' }, msg), location.origin); };
  I.login = () => { if (inFrame) tell({ type: 'login' }); else location.href = '/#/'; };

  // ---------- テーマ (IppO の設定に合わせる) ----------
  function themeNow() {
    try { if (inFrame) return parent.document.documentElement.dataset.theme || 'auto'; } catch (e) {}
    try { return JSON.parse(localStorage.getItem('ippo_theme')) || 'auto'; } catch (e) { return 'auto'; }
  }
  function applyTheme() {
    const t = themeNow();
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  applyTheme();
  try { if (inFrame) new MutationObserver(applyTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) {}
  window.addEventListener('storage', (e) => { if (e.key === 'ippo_theme') applyTheme(); });

  // ---------- 投稿者の表示 (IppO の表示名とアイコン。文字は textContent でだけ入れる) ----------
  const PALETTE = ['#4b55f0', '#0f9d8a', '#c2410c', '#9333ea', '#be185d', '#0369a1', '#4d7c0f', '#a35a2f'];
  const colorFor = (key) => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#8486C4');
  I.avatarEl = (u) => {
    const s = document.createElement('span'); s.className = 'ippo-av'; s.setAttribute('aria-hidden', 'true');
    const a = u.avatar;
    if (a && a.kind === 'image' && u.id) { const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.src = `/api/avatars/${Number(u.id)}?v=${Number(a.v) || 0}`; s.append(img); }
    else if (a && a.kind === 'emoji') { s.textContent = String(a.emoji || '').slice(0, 8); s.style.background = safeColor(a.color); }
    else { s.textContent = [...(u.displayName || u.username || '?')][0] || '?'; s.style.background = colorFor(u.username); }
    return s;
  };
  I.userLink = (u, mine) => {
    const el = document.createElement(u.username ? 'a' : 'span');
    el.className = 'ippo-who' + (mine ? ' mine' : '');
    if (u.username) { el.href = '/#/u/' + encodeURIComponent(u.username); el.target = '_top'; }
    el.append(I.avatarEl(u), document.createTextNode(mine ? 'あなた' : u.displayName + 'さん'));
    return el;
  };

  // ---------- 乱数の種 ----------
  I.takeSeed = () => I.queue.shift() || null;
  async function fetchSeeds(opts) {
    I.queue = [];
    if (!I.user) return;
    try {
      const d = await I.api('/horse/seeds', { method: 'POST', body: opts });
      I.queue = (Array.isArray(d.seeds) ? d.seeds : []).filter((s) => s && typeof s.id === 'string' && Number.isInteger(s.seed));
    } catch (e) {
      if (e.status === 429) toast('短い時間に生まれすぎました。この馬はみんなの結果に載せられません。少し待ってから生まれてください。');
      else if (e.status === 401) { I.user = null; updateFoot(); }
    }
  }
  // 種をもらってから、元の処理で生まれる (種がもらえなかったときは、元どおり Math.random で生まれる)
  function installSeeds() {
    const baseNewLife = newLife;
    newLife = function (forceTB, parent) {
      const s = I.takeSeed();
      if (!s) return baseNewLife(forceTB, parent);
      const orig = Math.random;
      Math.random = mulberry32(s.seed);
      try { const l = baseNewLife(forceTB, parent); l.seedId = s.id; return l; } finally { Math.random = orig; }
    };
    let busy = false;
    const unlockAudio = () => { try { if (soundOn) ac(); } catch (e) {} }; // 音はボタンを押した瞬間に準備しておく
    const baseBegin = begin;
    begin = function (forceTB) {
      if (!I.user) return baseBegin(forceTB);
      if (busy) return;
      busy = true; unlockAudio();
      const parent = BEGIN_PARENT;
      const opts = parent ? { n: 1, parent: parent.seedId || null } : { n: 1, tb: forceTB === true };
      (parent && !parent.seedId ? Promise.resolve(I.queue = []) : fetchSeeds(opts)).then(() => {
        busy = false; BEGIN_PARENT = parent; baseBegin(forceTB);
      });
    };
    const baseTen = tenPull;
    tenPull = function (forceTB) {
      if (!I.user) return baseTen(forceTB);
      if (busy) return;
      busy = true; unlockAudio();
      fetchSeeds({ n: 10, tb: forceTB === true }).then(() => { busy = false; baseTen(forceTB); I.queue = []; });
    };
  }

  // ---------- 図鑑・実績 (ログイン中はサーバーに保存) ----------
  const emptyZ = () => ({ births: 0, ten: 0, cards: [], badges: {}, countries: [], maxGen: 1, best: null, bestP: 0 });
  function zFrom(v) { // game.js の zLoad と同じ確かめ方
    const z = emptyZ();
    if (v && typeof v === 'object') {
      z.births = Number.isFinite(v.births) ? v.births : 0; z.ten = Number.isFinite(v.ten) ? v.ten : 0;
      z.cards = Array.isArray(v.cards) ? v.cards.filter((e) => e && typeof e === 'object' && e.id && e.p > 0) : [];
      z.badges = (v.badges && typeof v.badges === 'object') ? v.badges : {};
      z.countries = Array.isArray(v.countries) ? v.countries.filter((x) => typeof x === 'string') : [];
      z.maxGen = Number.isFinite(v.maxGen) ? v.maxGen : 1; z.best = RK_ORDER.includes(v.best) ? v.best : null; z.bestP = v.bestP > 0 ? v.bestP : 0;
    }
    return z;
  }
  let synced = emptyZ();               // サーバーにあると分かっている内容
  let counted = { births: 0, ten: 0 }; // 回数のうち、サーバーに送り終えた分
  let syncing = false, dirty = false, timer = null;
  function adopt(server) {             // サーバーの内容 (ほかの端末の分もまとめたもの) を画面に使う
    synced = zFrom(server); Z = zFrom(server); counted = { births: Z.births, ten: Z.ten };
    if (curSection() === 'album') renderAlbum();
  }
  function diff() {
    const known = new Map(synced.cards.map((e) => [e.id, JSON.stringify(e)]));
    const cards = Z.cards.filter((e) => known.get(e.id) !== JSON.stringify(e));
    const badges = {}; Object.keys(Z.badges).forEach((k) => { if (!synced.badges[k]) badges[k] = Z.badges[k]; });
    const body = {
      cards: cards.slice(0, 40), badges, countries: Z.countries.filter((c) => !synced.countries.includes(c)),
      maxGen: Z.maxGen, best: Z.best, bestP: Z.bestP,
      birthsAdd: Math.max(0, Z.births - counted.births), tenAdd: Math.max(0, Z.ten - counted.ten),
    };
    const any = body.cards.length || Object.keys(badges).length || body.countries.length || body.birthsAdd || body.tenAdd
      || Z.maxGen > synced.maxGen || (Z.best && Z.best !== synced.best) || (Z.bestP > 0 && Z.bestP !== synced.bestP);
    return any ? { body, more: cards.length > 40 } : null;
  }
  async function flush() {
    if (syncing || !I.user) return;
    syncing = true;
    try {
      for (let i = 0; i < 40; i++) {
        dirty = false;
        const d = diff(); if (!d) break;
        const r = await I.api('/horse/zukan', { method: 'POST', body: d.body });
        counted.births += d.body.birthsAdd; counted.ten += d.body.tenAdd;
        synced = zFrom(r.zukan);
        if (!d.more && !dirty) { adopt(r.zukan); break; }
      }
      zSaveFailed = false;
    } catch (e) {
      zSaveFailed = true; dirty = true;
      if (e.status === 401) { I.user = null; updateFoot(); } else setTimeout(flush, 8000);
    } finally { syncing = false; if (dirty && I.user && !zSaveFailed) I.zSave(); }
  }
  // game.js の zSave から呼ばれる。ログイン中ならサーバーに送って true (この端末には保存しない)
  I.zSave = () => {
    if (!I.user) return false;
    dirty = true; clearTimeout(timer); timer = setTimeout(flush, 500);
    return true;
  };

  // この端末に残っている、ログイン前の図鑑を取りこむ (アカウントごとに 1 回だけ聞く)
  const DECLINED = 'ippo_horse_import_declined';
  function offerImport() {
    let local; try { local = JSON.parse(localStorage.getItem(ZKEY) || 'null'); } catch (e) { local = null; }
    const z = zFrom(local);
    if (!z.births && !z.cards.length) return;
    let declined = []; try { declined = JSON.parse(localStorage.getItem(DECLINED) || '[]'); } catch (e) {}
    if (Array.isArray(declined) && declined.includes(I.user.id)) return;
    const box = document.createElement('div'); box.className = 'ippo-import'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', '図鑑の取りこみ');
    const p = document.createElement('p'); p.textContent = `この端末に、ログインする前の図鑑(${z.births}回ぶん・カード${z.cards.length}枚)が残っています。@${I.user.username} の図鑑に取りこみますか？`;
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn btn-primary'; yes.textContent = '取りこむ';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-ghost'; no.textContent = '取りこまない';
    const note = document.createElement('p'); note.className = 'small muted'; note.textContent = '取りこむと、この端末からは消えて、アカウントの図鑑に入ります(学校の共用端末で、ほかの人の分を取りこまないよう気をつけてください)。';
    box.append(p, yes, no, note);
    $('start').querySelector('.panel').after(box);
    yes.onclick = async () => {
      yes.disabled = no.disabled = true;
      // 取りこむ分を「まだ送っていない変更」として足し、いつもの同期で送る
      z.cards.forEach((e) => { if (!Z.cards.some((x) => x.id === e.id)) Z.cards.push(e); });
      Object.keys(z.badges).forEach((k) => { if (!Z.badges[k] || z.badges[k] < Z.badges[k]) Z.badges[k] = z.badges[k]; });
      z.countries.forEach((c) => { if (!Z.countries.includes(c)) Z.countries.push(c); });
      Z.births += z.births; Z.ten += z.ten; Z.maxGen = Math.max(Z.maxGen, z.maxGen);
      if (z.best && (!Z.best || RK_ORDER.indexOf(z.best) < RK_ORDER.indexOf(Z.best))) Z.best = z.best;
      if (z.bestP > 0 && (!(Z.bestP > 0) || z.bestP < Z.bestP)) Z.bestP = z.bestP;
      await flush();
      if (zSaveFailed) { yes.disabled = no.disabled = false; toast('取りこめませんでした。通信を確かめて、もう一度押してください。'); return; }
      try { localStorage.removeItem(ZKEY); } catch (e) {}
      box.remove(); toast(`図鑑を取りこみました(カード${z.cards.length}枚)`);
    };
    no.onclick = () => {
      try { const list = Array.isArray(declined) ? declined : []; list.push(I.user.id); localStorage.setItem(DECLINED, JSON.stringify(list.slice(-50))); } catch (e) {}
      box.remove();
    };
  }
  // 図鑑の下の説明 (ゲームは図鑑を開くたびに「この端末に保存」と書くので、そのあとで IppO 用に直す)
  function updateFoot() {
    const f = document.getElementById('zFoot'); if (!f) return;
    const many = f.textContent.includes('200枚まで表示') ? '一覧には200枚まで表示しています。' : '';
    f.textContent = I.user
      ? (zSaveFailed ? 'いま IppO に保存できていません。通信が戻ると、自動で保存し直します。' : `図鑑と実績は、IppO のアカウント(@${I.user.username})に保存され、ほかの端末でログインしても引き継がれます。`)
        + 'カードは500枚まで残り、超えるとレア度の低い古いカードから消えます。' + many
      : '図鑑は、この端末のブラウザに保存されます。IppO にログインすると、アカウントに保存されて、ほかの端末にも引き継がれます。カードは500枚まで残り、超えるとレア度の低い古いカードから消えます。' + many;
  }

  // ---------- IppO でシェア ----------
  function jpeg(canvas) {
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('画像を作れませんでした'))), 'image/jpeg', 0.88));
  }
  let sharing = false;
  I.share = async (id, fn) => {
    if (!I.user) return I.login();
    if (sharing) return;
    let text; try { text = fn(); } catch (e) { return; }
    text = (text + X_TAGS).slice(0, 400);
    const btn = document.getElementById(id); const label = btn ? btn.textContent : '';
    sharing = true; if (btn) { btn.disabled = true; btn.textContent = '準備しています…'; }
    try {
      let canvas = null;
      if (id === 'btnX' && life) { await drawCard(); canvas = life.cardCanvas; }
      else if (id === 'btnTenX' && tenLives) {
        const L = tenLives.lives; let best = L[0];
        L.forEach((l) => { if (RK_ORDER.indexOf(rarityOf(l)) < RK_ORDER.indexOf(rarityOf(best)) || (rarityOf(l) === rarityOf(best) && l.p < best.p)) best = l; });
        canvas = renderCard(best, best.horseName);
      }
      let imageId = null;
      if (canvas) {
        const r = await fetch('/api/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: await jpeg(canvas) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(d.error || 'カードを送れませんでした'), { status: r.status });
        imageId = d.image.id;
      }
      if (inFrame) tell({ type: 'share', text, imageId });
      else if (confirm('この内容を IppO に投稿しますか？\n\n' + text)) { await I.api('/posts', { method: 'POST', body: { content: text, imageIds: imageId ? [imageId] : [] } }); toast('IppO に投稿しました'); }
    } catch (e) {
      if (e.status === 401) I.login(); else toast(e.message || 'シェアできませんでした');
    } finally { sharing = false; if (btn) { btn.disabled = false; btn.textContent = label; } }
  };

  // ---------- 起動 ----------
  I.start = async () => {
    installSeeds();
    const baseAlbum = renderAlbum;
    renderAlbum = function () { baseAlbum(); updateFoot(); };
    try { I.user = (await I.api('/me')).user || null; } catch (e) { I.user = null; }
    if (I.user) {
      Z = emptyZ(); // ほかの人の分が混ざらないよう、ログイン中はこの端末の図鑑を使わない
      try { adopt((await I.api('/horse/zukan')).zukan); offerImport(); }
      catch (e) { toast('図鑑を読み込めませんでした。開き直してください。'); }
    }
    document.documentElement.classList.toggle('ippo-guest', !I.user);
    updateFoot();
    I.ready = true;
    initNet();
  };
  return I;
})();
