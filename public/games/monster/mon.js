// =====================================================================
// ブリードモンスターズ (IppO のミニアプリ。IppO の中の iframe で開く)
// 画面: ホーム / モンスター / 育成 / 配合 / バトル / セリ / 募集掲示板 / ランキング
// 利用者の書いた文字 (名前・ひとこと) は必ず esc() してから表示する
// =====================================================================
'use strict';
(() => {
  const app = document.getElementById('app');
  const inFrame = window.parent !== window;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ARROW = { U: '↑', D: '↓', L: '←', R: '→' };
  const arrows = (cmd) => [...String(cmd)].map((k) => ARROW[k] || '').join('');
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  const STATUS = { training: '育成中', active: '戦える', breeding: '繁殖入り', listed: 'セリに出品中', auction: 'セリ中', sold: '売却済み' };
  const KIND = { punch: '直殴り', magic: '魔法', ult: '大技', guard: '防御' };
  // 防御 (どのモンスターも使える。相手が同じ回に撃ってきた技を無効にする)
  const guardSkill = () => catalog?.guard ? { ...catalog.guard } : { id: 'guard', name: 'ぼうぎょ', kind: 'guard', cmd: 'DD' };
  let catalog = null, me = null, user = null;

  // ---------- IppO とのつなぎ (テーマ・ログイン) ----------
  function applyTheme() {
    let t = 'auto';
    try { if (inFrame) t = parent.document.documentElement.dataset.theme || 'auto'; } catch {}
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  applyTheme();
  try { if (inFrame) new MutationObserver(applyTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch {}
  const login = () => { if (inFrame) parent.postMessage({ source: 'ippo-monster', type: 'login' }, location.origin); else location.href = '/#/'; };

  async function api(path, { method = 'GET', body } = {}) {
    const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let d = {}; try { d = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(d.error || 'エラーが起きました'); e.status = r.status; throw e; }
    return d;
  }
  function toast(msg, err = false) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }
  const typeTag = (t) => `<span class="ty" style="color:var(--${esc(t)})">${esc(catalog?.types[t]?.icon || '')}${esc(catalog?.types[t]?.name || '')}</span>`;
  const art = (m, cls = '') => MonArt.svg(m.look, m.type, { rank: m.rank, cls, label: m.name });
  const mcard = (m, { href = `#mon/${m.id}`, cls = '', extra = '' } = {}) => `<a class="mcard ${cls}" ${href ? `href="${href}"` : ''} data-id="${esc(m.id)}">
    <span class="rk r-${esc(m.rank)}">${esc(m.rank)}</span><span class="sx ${m.sex === 'm' ? 'm' : 'f'}">${m.sex === 'm' ? '♂' : '♀'}</span>
    ${m.mutantRarity ? `<span class="mutb mr-${esc(m.mutantRarity)}">🧬変異${esc(m.mutantRarity)}</span>` : ''}
    ${art(m)}<b>${esc(m.name)}</b><span class="meta">${typeTag(m.type)} · 市場価値 <span class="val">${Number(m.score).toLocaleString()}</span></span>
    <div><span class="st ${esc(m.status)}">${m.status === 'training' ? `育成中 あと${m.trainLeft}` : m.isStud ? '種モン' : esc(STATUS[m.status] || m.status)}</span></div>${extra}</a>`;
  // 変異の表示 (持っている変異・レアリティ・説明・能力への影響・相乗効果・遺伝の情報)
  const ORIGIN = { new: '突然変異で発現', father: '父から受けついだ', mother: '母から受けついだ', extract: '変異抽出装置で写した' };
  const mutRow = (x) => `<div class="mut ${x.mode === 'latent' ? 'latent' : ''}"><div class="mut-h"><span class="mutb mr-${esc(x.rarity)}">変異${esc(x.rarity)}</span><b>${esc(x.name)}</b><span class="mut-cat">${esc(x.catName)}</span></div>
    <p class="small" style="margin:2px 0">${esc(x.desc)}</p>${x.mode === 'latent' ? '<p class="small muted" style="margin:0">潜在形質: 表には出ていない (効果なし)。子に受けつがれることがある</p>' : `<p class="mut-fx">${x.effects.map(esc).join(' · ')}</p>`}
    <p class="small muted" style="margin:0">遺伝: ${esc(ORIGIN[x.origin] || '')}${x.mode === 'latent' ? ' (潜在)' : ''}</p></div>`;
  const mutCard = (m) => `<div class="card mutcard"><h2>🧬 突然変異 <span class="small muted">${m.mutations.filter((x) => x.mode === 'direct').length} 種類</span></h2>
    ${m.mutations.map(mutRow).join('')}
    ${(m.synergies || []).length ? `<div class="syn"><b>✨ 相乗効果</b>${m.synergies.map((s) => `<div><b>${esc(s.name)}</b> <span class="small">${esc(s.desc)}</span></div>`).join('')}</div>` : ''}
    ${m.baseStats ? `<p class="small muted" style="margin:6px 0 0">変異なしの能力: HP ${m.baseStats.hp} 攻 ${m.baseStats.atk} 魔 ${m.baseStats.mag} 防 ${m.baseStats.def} 速 ${m.baseStats.spd} (子に受けつがれるのはこちら)</p>` : ''}
    ${m.initScore ? `<p class="small muted" style="margin:2px 0 0">誕生時の市場価値: ${Number(m.initScore).toLocaleString()} (変異の初期値。種モンの条件には数えない)</p>` : ''}</div>`;
  const skillRow = (s, extra = '') => `<div class="skl"><span class="kd ${esc(s.kind)}">${esc(KIND[s.kind])}</span><b>${esc(s.name)}${extra}</b>${s.type ? typeTag(s.type) : '<span class="ty muted">本人の属性</span>'}<span class="cmd">${arrows(s.cmd)}</span><span class="small muted">威力${s.power}</span></div>`;
  const head = (title, back = '#') => `<div class="mb-head">${back ? `<a class="btn sm" href="${back}">←</a>` : ''}<h1>${title}</h1><span class="mb-coins">🪙 ${me ? Number(me.coins).toLocaleString() : '-'}</span></div>`;
  async function refresh() { me = await api('/mon/me'); return me; }

  // ---------- ルーター ----------
  let cleanup = null;
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const h = location.hash.slice(1); const [path, q = ''] = h.split('?'); const params = new URLSearchParams(q); const parts = path.split('/');
    try {
      if (!catalog) catalog = await api('/mon/catalog');
      try { await refresh(); user = true; } catch (e) { if (e.status === 401) { user = null; return viewGuest(); } throw e; }
      if (!me.started) return viewStart();
      if (parts[0] === 'mon' && parts[1]) return viewMon(parts[1]);
      if (parts[0] === 'train' && parts[1]) return viewTrain(parts[1]);
      if (parts[0] === 'breed') return viewBreed();
      if (parts[0] === 'battle') return viewBattle(params);
      if (parts[0] === 'fight') return viewFightPick(params);
      if (parts[0] === 'auction') return viewAuction();
      if (parts[0] === 'board') return viewBoard();
      if (parts[0] === 'shop') return viewShop();
      if (parts[0] === 'ranking') return viewRanking();
      if (parts[0] === 'dex') return viewDex();
      if (parts[0] === 'pedigree' && parts[1]) return viewPedigree(parts[1]);
      if (parts[0] === 'help') return viewHelp();
      return viewHome();
    } catch (e) { app.innerHTML = `${head('ブリードモンスターズ', '')}<div class="card empty">${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);

  function viewGuest() {
    app.innerHTML = `<div class="mb-head"><h1>🧬 ブリードモンスターズ</h1></div><div class="card center"><p>モンスターを配合して育て、コマンドを打ちこんで戦うゲームです。</p><button class="btn primary" id="lg">ログインして遊ぶ</button></div>`;
    $('#lg').onclick = login;
  }
  function viewStart() {
    app.innerHTML = `${head('🧬 ブリードモンスターズ', '')}<div class="card center"><p style="font-size:15px">ようこそ、<b>モンスターブリーダー</b>！<br>まずはランダムで <b>3 体</b> のモンスターがもらえます。</p>
      <span class="egg">🥚🥚🥚</span><button class="btn gold block" id="go" style="font-size:18px;margin-top:10px">タマゴをかえす！</button></div>`;
    $('#go').onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api('/mon/start', { method: 'POST' }); await refresh();
        app.innerHTML = `${head('🧬 ようこそ！', '')}<p class="shout">3 体のモンスターが生まれた！</p><div class="grid">${r.monsters.map((m) => mcard(m, { cls: 'reveal' })).join('')}</div>
          <div class="card"><h2>✏️ 名前をつけよう</h2><p class="small muted" style="margin:0">あとからでも、モンスターの画面で変えられます。</p>${r.monsters.map((m) => `<p class="small" style="margin:8px 0 0">${m.sex === 'm' ? '♂' : '♀'} ${typeTag(m.type)}</p>${nameBox(m)}`).join('')}</div><a class="btn primary block" href="#" style="margin-top:10px">はじめる</a>`;
        bindNames();
      } catch (err) { toast(err.message, true); e.target.disabled = false; }
    };
  }

  // ---------- ホーム ----------
  function viewHome() {
    const ms = me.monsters, next = me.next;
    app.innerHTML = `${head('🧬 ブリモン', '')}
      <div class="menu">
        <a class="btn primary" href="#fight">⚔️ バトル<small>CPU・ランダム対戦</small></a>
        <a class="btn gold" href="#breed">💞 配合<small>強い子を作る</small></a>
        <a class="btn" href="#auction">🔨 セリ<small>次は ${esc(fmtTime(next))}</small></a>
        <a class="btn" href="#board">📋 募集掲示板<small>対戦相手を探す</small></a>
        <a class="btn" href="#shop">🛒 メスショップ<small>毎朝 7 時・先着順</small></a>
        <a class="btn" href="#ranking">🏆 ランキング<small>市場価値</small></a>
        <a class="btn" href="#dex">📕 変異図鑑<small>発見されたものだけ</small></a>
        <a class="btn" href="#help">📖 あそびかた<small>ルールと相性</small></a>
      </div>
      <div class="card" id="mybox"></div>`;
    renderMine();
  }
  // ---------- わたしのモンスター: フォルダで分ける (すべて・未分類・自分のフォルダ)。「整理する」でえらんでまとめて移す ----------
  const FKEY = 'mon_folder';
  let selMode = false; const picked = new Set();
  const curF = () => { let v = 'all'; try { v = localStorage.getItem(FKEY) || 'all'; } catch {} return v === 'all' || v === '0' || (me.folders || []).some((f) => String(f.id) === v) ? v : 'all'; };
  const setF = (v) => { try { localStorage.setItem(FKEY, String(v)); } catch {} };
  const folderOpts = (sel) => `<option value="0" ${String(sel) === '0' ? 'selected' : ''}>📂 未分類</option>${(me.folders || []).map((f) => `<option value="${f.id}" ${String(sel) === String(f.id) ? 'selected' : ''}>📁 ${esc(f.name)}</option>`).join('')}`;
  function renderMine() {
    const box = $('#mybox'); if (!box) return;
    const ms = me.monsters, fs = me.folders || [], cur = curF();
    const count = (fid) => ms.filter((m) => String(m.folderId || 0) === String(fid)).length;
    const list = cur === 'all' ? ms : ms.filter((m) => String(m.folderId || 0) === cur);
    const chip = (v, label, n) => `<button class="fchip ${cur === String(v) ? 'on' : ''}" data-f="${v}">${label} <span>${n}</span></button>`;
    const curFolder = fs.find((f) => String(f.id) === cur);
    box.innerHTML = `<h2>🐾 わたしのモンスター <span class="small muted">${ms.length} 体</span></h2>
      <div class="fbar">${chip('all', 'すべて', ms.length)}${chip(0, '📂 未分類', count(0))}${fs.map((f) => chip(f.id, '📁 ' + esc(f.name), count(f.id))).join('')}<button class="fchip add" id="fadd">＋ フォルダ</button></div>
      <div class="ftools">${curFolder ? `<button class="btn sm" id="fren">✏️ フォルダ名</button><button class="btn sm" id="fdel">🗑 フォルダを消す</button>` : ''}<span style="flex:1"></span>${ms.length ? `<button class="btn sm ${selMode ? 'primary' : ''}" id="fsel">${selMode ? '✓ えらぶのをやめる' : '📁 整理する'}</button>` : ''}</div>
      ${selMode ? `<div class="fmove"><span class="small"><b id="pkn">${picked.size}</b> 体をえらび中</span><select class="in" id="fto" aria-label="移す先">${folderOpts(curFolder ? 0 : (fs[0]?.id ?? 0))}</select><button class="btn primary sm" id="fgo">移す</button><button class="btn sm" id="fallp">全部えらぶ</button></div>` : ''}
      ${list.length ? `<div class="grid ${selMode ? 'picking' : ''}">${list.map((m) => mcard(m, { href: selMode ? '' : `#mon/${m.id}`, cls: picked.has(m.id) ? 'picked' : '', extra: selMode ? `<span class="pk">${picked.has(m.id) ? '✓' : ''}</span>` : '' })).join('')}</div>`
        : `<p class="empty">${ms.length ? 'このフォルダにはモンスターがいません。「📁 整理する」でえらんで移せます' : 'モンスターがいません。セリで手に入れよう'}</p>`}`;
    $$('.fchip[data-f]', box).forEach((b) => b.onclick = () => { setF(b.dataset.f); renderMine(); });
    $('#fadd', box).onclick = async () => {
      const name = prompt('新しいフォルダの名前 (12 文字まで)', ''); if (name === null) return;
      try { const r = await api('/mon/folders', { method: 'POST', body: { name } }); applyFolders(r); setF(r.id); toast(`フォルダ「${name.trim().slice(0, 12)}」を作りました`); renderMine(); } catch (e) { toast(e.message, true); }
    };
    $('#fren', box)?.addEventListener('click', async () => {
      const name = prompt('フォルダの新しい名前', curFolder.name); if (name === null) return;
      try { applyFolders(await api(`/mon/folders/${curFolder.id}/rename`, { method: 'POST', body: { name } })); renderMine(); } catch (e) { toast(e.message, true); }
    });
    $('#fdel', box)?.addEventListener('click', async () => {
      if (!confirm(`フォルダ「${curFolder.name}」を消しますか？\n中のモンスターは「未分類」にもどります (モンスターは消えません)。`)) return;
      try { applyFolders(await api(`/mon/folders/${curFolder.id}/delete`, { method: 'POST' })); setF('all'); toast('フォルダを消しました'); renderMine(); } catch (e) { toast(e.message, true); }
    });
    $('#fsel', box)?.addEventListener('click', () => { selMode = !selMode; picked.clear(); renderMine(); });
    if (selMode) {
      $$('.grid .mcard', box).forEach((c) => c.onclick = (e) => { e.preventDefault(); const id = c.dataset.id; if (picked.has(id)) picked.delete(id); else picked.add(id); c.classList.toggle('picked', picked.has(id)); c.querySelector('.pk').textContent = picked.has(id) ? '✓' : ''; $('#pkn').textContent = picked.size; });
      $('#fallp', box).onclick = () => { const all = list.every((m) => picked.has(m.id)); list.forEach((m) => (all ? picked.delete(m.id) : picked.add(m.id))); renderMine(); };
      $('#fgo', box).onclick = async () => {
        if (!picked.size) return toast('モンスターをえらんでください', true);
        const to = $('#fto').value, toName = to === '0' ? '未分類' : fs.find((f) => String(f.id) === to)?.name;
        try { const r = await api('/mon/folders/move', { method: 'POST', body: { ids: [...picked], folder: Number(to) } }); applyFolders(r); toast(`${r.moved} 体を「${toName}」に移しました`); picked.clear(); selMode = false; renderMine(); } catch (e) { toast(e.message, true); }
      };
    }
  }
  // サーバーからのフォルダの状態を、手もとの me に反映
  function applyFolders(r) { if (r.folders) me.folders = r.folders; if (r.where) for (const m of me.monsters) m.folderId = r.where[m.id] || 0; }

  // ---------- 命名 (生まれたとき・買ったとき・詳細画面から。12 文字まで) ----------
  let nameNext = null; // ショップで買った直後は詳細画面で名前の入力を開く
  const nameBox = (m, label = '✏️ 名前をつける') => `<form class="namebox" data-name="${esc(m.id)}" style="display:flex;gap:6px;margin:8px 0"><input class="in" name="n" maxlength="12" value="${esc(m.name)}" placeholder="名前 (12 文字まで)" aria-label="名前" autocomplete="off" enterkeyhint="done"><button class="btn primary" style="white-space:nowrap">${label}</button></form>`;
  function bindNames(root = app) {
    $$('form.namebox', root).forEach((f) => f.onsubmit = async (e) => {
      e.preventDefault();
      const inp = f.querySelector('input'), btn = f.querySelector('button'), name = inp.value.trim();
      if (!name) return toast('名前を入れてください', true);
      btn.disabled = true;
      try {
        const r = await api(`/mon/monster/${encodeURIComponent(f.dataset.name)}/rename`, { method: 'POST', body: { name } });
        inp.value = r.monster.name; await refresh();
        $$('[data-nm]').filter((el) => el.dataset.nm === f.dataset.name).forEach((el) => { el.textContent = r.monster.name; });
        toast(`「${r.monster.name}」と名づけました`); inp.blur();
      } catch (err) { toast(err.message, true); }
      btn.disabled = false;
    });
  }

  // ---------- モンスターの詳細 ----------
  async function viewMon(id) {
    const { monster: m, owner } = await api('/mon/monster/' + encodeURIComponent(id));
    const mine = me.monsters.some((x) => x.id === m.id);
    const st = (k, label, max) => `<span>${label}</span><span class="bar"><i style="width:${Math.min(100, (m[k] / max) * 100)}%"></i></span><b>${m[k]}</b>`;
    const parent = (p, who) => p ? `<div class="mcard" style="cursor:default"><span class="rk r-${esc(p.rank)}">${esc(p.rank)}</span>${MonArt.svg(p.look, p.type, { rank: p.rank })}<b>${who} ${esc(p.name)}</b><span class="meta">市場価値 <span class="val">${Number(p.score).toLocaleString()}</span><br>${p.wins}勝${p.losses}敗 (対人 ${p.pvpWins}勝${p.pvpLosses}敗)</span></div>` : `<div class="mcard dim" style="cursor:default"><b>${who}</b><span class="meta">はじめのモンスター</span></div>`;
    const inh = new Set((m.inherited || []).map((x) => x.skill));
    app.innerHTML = `${head(esc(m.name), '#')}
      <div class="card center"><span class="rk r-${esc(m.rank)}" style="position:static;font-size:18px;padding:2px 12px">${esc(m.rank)}</span>
        ${art(m, 'big-art')}<p style="margin:4px 0"><b style="font-size:20px" data-nm="${esc(m.id)}">${esc(m.name)}</b>${mine ? ' <button class="btn sm" id="nmopen" aria-label="名前を変える">✏️</button>' : ''} <span class="sx ${m.sex === 'm' ? 'm' : 'f'}" style="position:static">${m.sex === 'm' ? '♂' : '♀'}</span> ${typeTag(m.type)} · 第${m.gen}世代</p>
        <p class="small" style="margin:0"><span class="st ${esc(m.status)}">${m.status === 'training' ? `育成中 あと${m.trainLeft}ターン` : m.isStud ? `種モン (種付け料 ${m.studFee} コイン)` : esc(STATUS[m.status])}</span> 市場価値 <span class="val">${Number(m.score).toLocaleString()}</span> · ${m.wins}勝${m.losses}敗 (対人 ${m.pvpWins}勝${m.pvpLosses}敗)${m.sex === 'f' ? ` · 産んだ子 ${m.children}/${catalog.rules.maxChildren}` : ''}</p>
        ${mine ? `<div id="nmwrap" ${nameNext === m.id ? '' : 'hidden'}>${nameNext === m.id ? '<p class="small" style="margin:6px 0 0"><b>🎉 なかまになった！ 名前をつけてあげよう</b></p>' : ''}${nameBox(m)}</div>` : `<p class="small muted">持ち主: ${esc(owner.displayName)}</p>`}</div>
      ${mine ? `<div class="card" id="acts"></div>` : ''}
      ${(m.mutations || []).length ? mutCard(m) : ''}
      <div class="card"><h2>📊 能力</h2><div class="stats">${st('hp', 'HP', 500)}${st('atk', '攻撃', 150)}${st('mag', '魔力', 150)}${st('def', '防御', 150)}${st('spd', '素早さ', 150)}</div></div>
      <div class="card"><h2>🎮 技とコマンド <span class="small muted">${m.skills.length}/${catalog.rules.maxSkills}</span></h2>${m.skills.map((s) => skillRow(s, inh.has(s.id) ? '<span class="inh">受けついだ</span>' : '')).join('')}
        <div class="skl"><span class="kd guard">${esc(KIND.guard)}</span><b>🛡️ ${esc(guardSkill().name)}</b><span class="ty muted">みんな使える</span><span class="cmd">${arrows(guardSkill().cmd)}</span><span class="small muted">同じ回の技を無効</span></div></div>
      <div class="card"><h2>🧬 血統</h2><div class="lin">${parent(m.father, '父')}${parent(m.mother, '母')}</div>
        ${(m.inherited || []).length ? `<p class="small">受けついだ技: ${(m.inherited).map((x) => `${esc(x.from)}の「${esc(m.skills.find((s) => s.id === x.skill)?.name || x.skill)}」`).join('・')}</p>` : ''}</div>`;
    if (!mine) return;
    bindNames();
    const openName = () => { const w = $('#nmwrap'); w.hidden = false; const i = w.querySelector('input'); i.focus(); i.select(); };
    $('#nmopen').onclick = openName;
    if (nameNext === m.id) { nameNext = null; setTimeout(() => $('#nmwrap input')?.focus(), 50); }
    const acts = $('#acts'), b = [];
    if (m.status === 'training') b.push(`<a class="btn gold block" href="#train/${m.id}">🏋️ 育成する (あと ${m.trainLeft} ターン)</a>`);
    if (m.status === 'active') b.push(`<a class="btn primary block" href="#fight?mon=${m.id}">⚔️ このモンスターで戦う</a>`);
    if (m.status === 'active') b.push(`<button class="btn block" id="retire">💞 繁殖入りさせる (もう戦えなくなります)</button>`);
    if (m.sex === 'm' && ['active', 'breeding'].includes(m.status) && !m.isStud) b.push(`<button class="btn block" id="stud" ${m.score < catalog.rules.studScore ? 'disabled' : ''}>🌟 種モンにする ${m.score < catalog.rules.studScore ? `(市場価値 ${catalog.rules.studScore} 以上で)` : '(ほかの人のメスと配合できる)'}</button>`);
    if (m.sex === 'f' && m.status === 'breeding') b.push(`<a class="btn gold block" href="#breed?mother=${m.id}">💞 配合する (あと ${catalog.rules.maxChildren - m.children} 体産める)</a>`);
    if (m.mother && ['training', 'active'].includes(m.status)) b.push(`<button class="btn block" id="list">🔨 セリに出す (次は ${esc(fmtTime(me.next))})</button>`);
    if (m.status === 'listed') b.push(`<button class="btn block" id="unlist">セリの出品をやめる (出品価格 ${m.listPrice} コイン)</button>`);
    if (!['listed', 'auction'].includes(m.status)) b.push(`<button class="btn gold block" id="extract" ${(m.mutations || []).length >= (catalog.rules.maxMutations || 4) ? 'disabled' : ''}>🧪 変異抽出装置 (🪙 ${Number(catalog.rules.extractCost || 1000).toLocaleString()})${(m.mutations || []).length >= (catalog.rules.maxMutations || 4) ? ' — 変異は 4 つまで' : ' — ほかのモンスターの変異を写す'}</button>`);
    b.push(`<a class="btn block" href="#pedigree/${m.id}">📜 血統書を作ってシェア</a>`);
    if (!['listed', 'auction'].includes(m.status)) b.push(`<button class="btn block" id="sell" ${me.monsters.length <= 1 ? 'disabled' : ''}>💰 売却する (🪙 ${Number(m.sellPrice || 0).toLocaleString()})${me.monsters.length <= 1 ? ' — 最後の 1 体は売れません' : ''}</button>`);
    b.push(`<label class="small" style="display:flex;gap:6px;align-items:center">📁 フォルダ <select class="in" id="mfold" style="flex:1">${folderOpts(me.monsters.find((x) => x.id === m.id)?.folderId || 0)}</select></label>`);
    b.push(`<button class="btn sm" id="rename">✏️ 名前を変える</button>`);
    acts.innerHTML = `<div style="display:grid;gap:8px">${b.join('')}</div>`;
    const act = async (path, body, msg) => { try { await api(`/mon/monster/${m.id}/${path}`, { method: 'POST', body }); toast(msg); route(); } catch (e) { toast(e.message, true); } };
    $('#retire', acts)?.addEventListener('click', () => { if (confirm(`${m.name} を繁殖入りさせますか？ 繁殖入りすると、もう戦えません。`)) act('retire', {}, '繁殖入りしました'); });
    $('#stud', acts)?.addEventListener('click', () => { const fee = prompt('種付け料 (コイン) を決めてください', '100'); if (fee !== null) act('stud', { fee: Number(fee) }, '種モンになりました'); });
    $('#list', acts)?.addEventListener('click', () => { const price = prompt('スタート価格 (コイン)', '50'); if (price !== null) act('list', { price: Number(price) }, `次のセリ (${fmtTime(me.next)}) に出品しました`); });
    $('#unlist', acts)?.addEventListener('click', () => act('unlist', {}, '出品をやめました'));
    $('#extract', acts)?.addEventListener('click', () => openExtract(m));
    $('#sell', acts)?.addEventListener('click', async (e) => {
      if (!confirm(`${m.name} を ${Number(m.sellPrice).toLocaleString()} コインで売却しますか？\n売ったモンスターはもどってきません。`)) return;
      e.target.disabled = true;
      try { const r = await api(`/mon/monster/${encodeURIComponent(m.id)}/sell`, { method: 'POST' }); await refresh(); toast(`${m.name} を売却しました (🪙 +${r.price})`); location.hash = '#'; }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    });
    $('#mfold', acts)?.addEventListener('change', async (e) => {
      const label = e.target.selectedOptions[0].textContent.slice(2).trim();
      try { const r = await api('/mon/folders/move', { method: 'POST', body: { ids: [m.id], folder: Number(e.target.value) } }); applyFolders(r); toast(`「${label}」に移しました`); } catch (err) { toast(err.message, true); }
    });
    $('#rename', acts)?.addEventListener('click', () => { openName(); $('#nmwrap').scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  }

  // ---------- 変異抽出装置: 自分のほかのモンスターの変異をえらんで、このモンスターに写す (元はそのまま) ----------
  function openExtract(m) {
    const have = new Set((m.mutations || []).map((x) => x.id)), cost = catalog.rules.extractCost || 1000;
    const srcs = me.monsters.filter((x) => x.id !== m.id && (x.mutations || []).some((y) => !have.has(y.id)));
    const wrap = document.createElement('div'); wrap.className = 'xt-wrap';
    wrap.innerHTML = `<div class="card xt" role="dialog" aria-label="変異抽出装置"><h2>🧪 変異抽出装置</h2>
      <p class="small">ほかのモンスターの変異を 1 つえらんで、<b>${esc(m.name)}</b> に写します。元のモンスターの変異はそのまま。レアリティと出方 (表・潜在) も同じ。<br>1 回 <b>🪙 ${cost.toLocaleString()}</b> (いま 🪙 ${Number(me.coins).toLocaleString()})</p>
      <div class="xt-list">${srcs.length ? srcs.map((x) => `<div class="xt-src"><div class="row" style="gap:8px;align-items:center">${MonArt.svg(x.look, x.type, { rank: x.rank, cls: '' }).replace('class="ma-svg', 'style="width:48px;height:48px" class="ma-svg')}<b>${esc(x.name)}</b></div>
        ${x.mutations.filter((y) => !have.has(y.id)).map((y) => `<button class="btn sm xt-pick" data-from="${esc(x.id)}" data-mut="${esc(y.id)}"><span class="mutb mr-${esc(y.rarity)}">変異${esc(y.rarity)}</span> ${esc(y.name)}${y.mode === 'latent' ? ' (潜在)' : ''} <span class="small muted">${esc((y.effects || []).join(' · '))}</span></button>`).join('')}</div>`).join('') : '<p class="muted">写せる変異を持ったモンスターがいません</p>'}</div>
      <button class="btn block" id="xt-close">とじる</button></div>`;
    document.body.append(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap || e.target.id === 'xt-close') return close();
      const b = e.target.closest('.xt-pick'); if (!b) return;
      const src = me.monsters.find((x) => x.id === b.dataset.from), mu = src?.mutations.find((y) => y.id === b.dataset.mut);
      if (!mu || !confirm(`${src.name} の「${mu.name}」(変異${mu.rarity}) を ${m.name} に写しますか？\n🪙 ${cost.toLocaleString()} コインかかります。`)) return;
      wrap.querySelectorAll('.xt-pick').forEach((x) => { x.disabled = true; });
      try {
        await api(`/mon/monster/${encodeURIComponent(m.id)}/extract`, { method: 'POST', body: { from: src.id, mutation: mu.id } });
        await refresh(); close(); toast(`🧪 ${m.name} に「${mu.name}」を写しました！`); route();
      } catch (err) { toast(err.message, true); wrap.querySelectorAll('.xt-pick').forEach((x) => { x.disabled = false; }); }
    });
  }

  // ---------- 育成 (10 ターン) ----------
  async function viewTrain(id) {
    let m = me.monsters.find((x) => x.id === id);
    if (!m) return route();
    const draw = (msg = '') => {
      app.innerHTML = `${head('🏋️ 育成', `#mon/${m.id}`)}<div class="card center">${art(m, 'big-art')}<b style="font-size:18px">${esc(m.name)}</b>
        <p class="shout" style="font-size:20px">${m.status === 'training' ? `のこり ${m.trainLeft} ターン` : '育成完了！'}</p>
        <div id="msg" style="min-height:60px">${msg}</div>
        ${m.status === 'training' ? `<p class="small muted">このターンは何をきたえる？ ときどき新しい技を覚えます</p><div class="lin"><button class="btn primary" data-c="punch" style="font-size:17px;padding:16px">👊 直殴り<br><small>攻撃・HP が上がる</small></button><button class="btn" data-c="magic" style="font-size:17px;padding:16px;background:#7048e8;color:#fff">🔮 魔法<br><small>魔力・HP が上がる</small></button></div>`
          : `<a class="btn gold block" href="#fight?mon=${m.id}">⚔️ さっそく戦う！</a><a class="btn block" href="#mon/${m.id}" style="margin-top:8px">ステータスを見る</a>`}</div>`;
      $$('[data-c]').forEach((btn) => btn.onclick = async () => {
        $$('[data-c]').forEach((x) => { x.disabled = true; });
        try {
          const r = await api(`/mon/monster/${m.id}/train`, { method: 'POST', body: { choice: btn.dataset.c } });
          m = r.monster;
          const ups = Object.entries(r.up).filter(([, v]) => v > 0).map(([k, v]) => `${{ hp: 'HP', atk: '攻撃', mag: '魔力', def: '防御', spd: '素早さ' }[k]} +${v}`).join('　');
          draw(`<p style="margin:4px 0;font-weight:800">${r.choice === 'punch' ? '👊 直殴りの特訓！' : '🔮 魔法の特訓！'}</p><p class="small" style="margin:0">${esc(ups)}</p>
            ${r.learned ? `<div class="shout reveal" style="font-size:18px">✨ 新しい技「${esc(r.learned.name)}」を覚えた！</div><p class="cmd">${arrows(r.learned.cmd)}</p>${r.replaced ? `<p class="small muted">(技がいっぱいなので「${esc(r.replaced.name)}」を忘れた)</p>` : ''}` : ''}${r.done ? '<p class="shout">🎉 育成完了！ 戦えるようになった！</p>' : ''}`);
        } catch (e) { toast(e.message, true); draw(); }
      });
    };
    draw();
  }

  // ---------- 配合 ----------
  async function viewBreed() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const { studs } = await api('/mon/studs');
    const mothers = me.monsters.filter((m) => m.sex === 'f' && m.status === 'breeding' && m.children < catalog.rules.maxChildren);
    const myFathers = me.monsters.filter((m) => m.sex === 'm' && m.status === 'breeding');
    const fathers = [...myFathers.map((m) => ({ ...m, fee: 0, own: true })), ...studs.filter((s) => !myFathers.some((x) => x.id === s.id)).map((s) => ({ ...s, fee: s.studFee, own: false }))];
    let mo = mothers.find((m) => m.id === params.get('mother'))?.id || mothers[0]?.id, fa = fathers[0]?.id;
    const best = (m) => m.skills.slice().sort((a, b) => b.power - a.power)[0];
    const draw = () => {
      const M = mothers.find((x) => x.id === mo), F = fathers.find((x) => x.id === fa);
      app.innerHTML = `${head('💞 配合', '#')}
        <div class="card"><h2>♀ 母をえらぶ <span class="small muted">繁殖入りした自分のメス (生涯 ${catalog.rules.maxChildren} 体まで)</span></h2>
          ${mothers.length ? `<div class="grid">${mothers.map((m) => mcard(m, { href: '', cls: m.id === mo ? 'sel' : '', extra: `<span class="small">あと ${catalog.rules.maxChildren - m.children} 体</span>` }).replace('class="mcard', 'data-pick="mo" class="mcard')).join('')}</div>` : '<p class="empty">繁殖入りしたメスがいません。メスのモンスターの画面から「繁殖入り」させよう</p>'}</div>
        <div class="card"><h2>♂ 父をえらぶ <span class="small muted">自分の繁殖オス・みんなの種モン</span></h2>
          ${fathers.length ? `<div class="grid">${fathers.map((m) => mcard(m, { href: '', cls: m.id === fa ? 'sel' : '', extra: `<span class="small">${m.own ? '自分のオス' : `${m.common ? '🤝 共通の種モン' : m.official ? '🏛️ 公式' : esc(m.owner?.displayName || '')} · 種付け料 ${m.fee}🪙`}</span>` }).replace('class="mcard', 'data-pick="fa" class="mcard')).join('')}</div>` : '<p class="empty">父になれるオスがいません</p>'}</div>
        ${M && F ? `<div class="card"><h2>🧬 この組み合わせだと…</h2>
          <p class="small">父「${esc(F.name)}」のいちばん強い技 <b>${esc(best(F)?.name || '-')}</b> と、母「${esc(M.name)}」のいちばん強い技 <b>${esc(best(M)?.name || '-')}</b> を、それぞれ <b>${Math.round(catalog.rules.inheritRate * 100)}%</b> の確率で受けつぎます。属性は ${typeTag(F.type)} か ${typeTag(M.type)}。見た目は両親をまぜた子になります。</p>
          <button class="btn gold block" id="go" style="font-size:18px">💞 配合する！${F.fee ? ` (種付け料 ${F.fee} コイン)` : ''}</button></div>` : ''}`;
      $$('[data-pick]').forEach((el) => el.onclick = (e) => { e.preventDefault(); if (el.dataset.pick === 'mo') mo = el.dataset.id; else fa = el.dataset.id; draw(); });
      $('#go')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        const requestId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
        try {
          const r = await api('/mon/breed', { method: 'POST', body: { mother: mo, father: fa, requestId } });
          await refresh(); hatch(r.child, F, M, r.mutation);
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      });
    };
    draw();
  }
  function hatch(c, F, M, mut) {
    app.innerHTML = `${head('💞 配合', '#')}<div class="card center"><div class="lin" style="margin-bottom:8px">${mcard(F, { href: '' })}${mcard(M, { href: '' })}</div><span class="egg">🥚</span><p class="shout">タマゴが…！？</p></div>`;
    if (mut && (mut.new.length || mut.discoveries.length)) return setTimeout(() => mutantBirth(c, mut), 1400);
    setTimeout(() => {
      app.innerHTML = `${head('💞 配合', '#')}<div class="card center"><p class="shout">🎉 <span data-nm="${esc(c.id)}">${esc(c.name)}</span> が生まれた！</p>
        <div class="reveal">${art(c, 'big-art')}</div>${nameBox(c)}<p><span class="rk r-${esc(c.rank)}" style="position:static;padding:2px 10px">${esc(c.rank)}</span> ${c.sex === 'm' ? '♂ オス' : '♀ メス'} · ${typeTag(c.type)} · 第${c.gen}世代</p>
        <p>${(c.inherited || []).length ? (c.inherited).map((x) => `<span class="inh" style="font-size:13px">${esc(x.from)}から「${esc(c.skills.find((s) => s.id === x.skill)?.name || '')}」</span>`).join(' ') : '<span class="small muted">今回は親の技を受けつげなかった…</span>'}</p>
        <a class="btn gold block" href="#train/${c.id}">🏋️ 育成する (10 ターン)</a><a class="btn block" href="#mon/${c.id}" style="margin-top:8px">くわしく見る</a></div>`;
      bindNames();
    }, 2000);
  }

  // 突然変異の誕生 (専用の演出。スキップできる)
  function mutantBirth(c, mut) {
    const top = c.mutantRarity || mut.new[0]?.rarity || 'N';
    const first = mut.discoveries.length > 0;
    const shareText = () => `🧬 突然変異が誕生！ ${me.monsters.find((x) => x.id === c.id)?.name || c.name} に「${(mut.new.length ? mut.new : c.mutations || []).map((x) => x.name).join('・')}」が発現した${first ? '。だれも見たことのない変異を発見！' : '！'} #ブリードモンスターズ`;
    app.innerHTML = `<div class="mutfx mr-${esc(top)}" id="mutfx"><div class="mutfx-dna">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <div class="mutfx-in"><p class="mutfx-t1">⚠️ 突然変異 ⚠️</p>
        <div class="mutfx-art reveal">${art(c, 'big-art')}</div>
        ${mut.new.map((x) => `<div class="mutfx-name"><span class="mutb mr-${esc(x.rarity)}">変異${esc(x.rarity)}</span><b>${esc(x.name)}</b><small>${esc(x.catName)}</small></div>`).join('')}
        ${first ? `<div class="mutfx-first">🏆 第一発見！ ${mut.discoveries.map((d) => `<span>${esc(d.kind === 'combo' ? '新しい組み合わせ「' + d.name + '」' : '「' + d.name + '」')}</span>`).join('')}${mut.title ? `<em>称号「${esc(mut.title)}」</em>` : ''}</div>` : ''}
        ${nameBox(c)}
        <div class="lin" style="margin-top:12px"><a class="btn gold" href="#mon/${esc(c.id)}">くわしく見る</a><button class="btn" id="mshare">📣 タイムラインに投稿</button></div>
        <a class="btn block" href="#train/${esc(c.id)}" style="margin-top:8px">🏋️ 育成する</a></div>
      <button class="btn sm mutfx-skip" id="mskip">スキップ ▶</button></div>`;
    const fx = $('#mutfx');
    $('#mskip').onclick = () => fx.classList.add('skip');
    bindNames();
    setTimeout(() => fx.classList.add('done'), 3200);
    $('#mshare').onclick = () => { if (inFrame) parent.postMessage({ source: 'ippo-monster', type: 'share', text: shareText() }, location.origin); else toast('IppO の中で開くと投稿できます'); };
  }

  // ---------- 血統書 (3 世代の家系図を 1 枚の画像に・タイムラインにシェア) ----------
  const RCOL = { C: '#868e96', B: '#1c7ed6', A: '#2f9e44', S: '#e67700', SS: '#cc5de8', Z: '#ff6b6b' };
  const MCOL = { N: '#868e96', R: '#1c7ed6', SR: '#7048e8', SSR: '#e8590c', UR: '#c2255c', MR: '#ff6bd6' };
  // モンスターの絵 (SVG) を画像にする (画像にするには xmlns が要る)
  const svgImage = (svg) => new Promise((ok) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => ok(null); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="412" ')); });
  async function drawPedigree(P, owner) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    const FONT = '"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1035'); bg.addColorStop(0.5, '#2b1f6e'); bg.addColorStop(1, '#120a2a'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,${200 + (i % 50)},${150 + (i % 100)},${0.2 + (i % 7) / 10})`; g.fillRect((i * 397) % W, (i * 233) % H, 3, 3); }
    // 金の額縁
    g.strokeStyle = '#ffd43b'; g.lineWidth = 10; g.strokeRect(24, 24, W - 48, H - 48); g.strokeStyle = 'rgba(255,212,59,.5)'; g.lineWidth = 3; g.strokeRect(44, 44, W - 88, H - 88);
    const text = (t, x, y, size, color = '#fff', align = 'center', weight = 900) => { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
    const fit = (t, max, size) => { g.font = `900 ${size}px ${FONT}`; while (g.measureText(t).width > max && size > 14) { size -= 2; g.font = `900 ${size}px ${FONT}`; } return size; };
    text('📜 血統書  PEDIGREE', W / 2, 108, 40, '#ffe066');
    // 本人
    const self = await svgImage(MonArt.svg(P.look, P.type, { rank: P.rank }));
    const glow = g.createRadialGradient(W / 2, 280, 20, W / 2, 280, 220); glow.addColorStop(0, 'rgba(255,224,102,.45)'); glow.addColorStop(1, 'rgba(255,224,102,0)'); g.fillStyle = glow; g.fillRect(0, 100, W, 380);
    if (self) g.drawImage(self, W / 2 - 150, 128, 300, 309);
    text(P.name, W / 2, 500, fit(P.name, 700, 60));
    const T = catalog?.types?.[P.type] || {};
    text(`${T.icon || ''}${T.name || ''}  ·  ${P.sex === 'm' ? '♂' : '♀'}  ·  第${P.gen}世代  ·  評価 ${P.rank}`, W / 2, 548, 30, '#e5dbff', 'center', 700);
    text(`市場価値 ${Number(P.score).toLocaleString()}  ·  ${P.wins}勝${P.losses}敗`, W / 2, 590, 30, '#ffd43b', 'center', 800);
    if (P.mutations.length) { const t = '🧬 ' + P.mutations.map((x) => `${x.name}(${x.rarity})`).join('  '); text(t, W / 2, 632, fit(t, 900, 28), '#ffa8e2', 'center', 800); }
    // 家系図 (両親・祖父母)
    const box = async (n, x, y, w, label) => {
      g.fillStyle = 'rgba(255,255,255,.08)'; g.strokeStyle = n ? (RCOL[n.rank] || '#868e96') : 'rgba(255,255,255,.2)'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(x, y, w, w + 74, 22); g.fill(); g.stroke();
      text(label, x + w / 2, y + 32, 22, '#c5f6fa', 'center', 800);
      if (!n) { const e0 = label.startsWith('父') || label.startsWith('母') ? 'はじめのモンスター' : '—'; text(e0, x + w / 2, y + w / 2 + 40, Math.min(20, fit(e0, w - 24, 20)), 'rgba(255,255,255,.5)', 'center', 700); return; }
      const im = await svgImage(MonArt.svg(n.look, n.type, { rank: n.rank })); if (im) g.drawImage(im, x + 10, y + 36, w - 20, w - 20);
      text(n.name, x + w / 2, y + w + 34, fit(n.name, w - 16, 24), '#fff');
      text(`${n.rank}${n.mutantRarity ? ` · 🧬${n.mutantRarity}` : ''}${n.official ? ' · 公式' : ''}`, x + w / 2, y + w + 62, 19, n.mutantRarity ? (MCOL[n.mutantRarity] || '#ffa8e2') : '#e5dbff', 'center', 800);
    };
    const line = (x1, y1, x2, y2) => { g.strokeStyle = 'rgba(255,212,59,.7)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1, (y1 + y2) / 2); g.lineTo(x2, (y1 + y2) / 2); g.lineTo(x2, y2); g.stroke(); };
    const pw = 200, py = 668, gw = 170, gy = 984;
    const px = [W / 2 - pw - 40, W / 2 + 40], gx = [70, 70 + gw + 40, W - 70 - gw * 2 - 40, W - 70 - gw];
    line(W / 2, 644, px[0] + pw / 2, py); line(W / 2, 644, px[1] + pw / 2, py);
    [[0, 0], [0, 1], [1, 2], [1, 3]].forEach(([pi, gi]) => line(px[pi] + pw / 2, py + pw + 74, gx[gi] + gw / 2, gy));
    await box(P.father, px[0], py, pw, '父'); await box(P.mother, px[1], py, pw, '母');
    await box(P.father?.father, gx[0], gy, gw, '父の父'); await box(P.father?.mother, gx[1], gy, gw, '父の母');
    await box(P.mother?.father, gx[2], gy, gw, '母の父'); await box(P.mother?.mother, gx[3], gy, gw, '母の母');
    text(`ブリーダー: ${owner?.displayName || ''}  ·  ブリードモンスターズ on IppO  ·  ${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}`, W / 2, H - 70, 24, 'rgba(255,255,255,.75)', 'center', 700);
    return cv;
  }
  async function viewPedigree(id) {
    app.innerHTML = `${head('📜 血統書', '#mon/' + encodeURIComponent(id))}<div class="card center"><p class="empty">血統書を作っています…</p></div>`;
    const { pedigree: P, owner } = await api(`/mon/monster/${encodeURIComponent(id)}/pedigree`);
    const cv = await drawPedigree(P, owner);
    const url = cv.toDataURL('image/jpeg', 0.9);
    const mineMon = me.monsters.some((x) => x.id === P.id);
    app.innerHTML = `${head('📜 血統書', '#mon/' + encodeURIComponent(id))}<div class="card center"><img src="${url}" alt="${esc(P.name)} の血統書" style="width:100%;border-radius:12px;display:block">
      <div class="lin" style="margin-top:10px">${mineMon ? '<button class="btn gold" id="pshare">📣 タイムラインに投稿</button>' : ''}<a class="btn" id="psave" href="${url}" download="${esc(P.name)}_血統書.jpg">💾 画像を保存</a></div></div>`;
    $('#pshare')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = '準備しています…';
      try {
        const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.88));
        const r = await fetch('/api/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || '画像を送れませんでした');
        const anc = [P.father, P.mother].filter(Boolean).map((p) => p.name).join(' × ');
        const text = `📜 ${P.name} の血統書 (第${P.gen}世代・評価 ${P.rank}${P.mutantRarity ? `・🧬変異${P.mutantRarity}` : ''})${anc ? `\n${anc} の子` : ''} #ブリードモンスターズ`;
        if (inFrame) parent.postMessage({ source: 'ippo-monster', type: 'share', text, imageId: d.image.id }, location.origin); else toast('IppO の中で開くと投稿できます');
      } catch (err) { toast(err.message, true); }
      e.target.disabled = false; e.target.textContent = '📣 タイムラインに投稿';
    });
  }

  // ---------- 変異図鑑 (発見されたものだけ) ----------
  async function viewDex() {
    const [d, r] = await Promise.all([api('/mon/dex'), api('/mon/discoverers')]);
    const when = (t) => new Date(t).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    const who = (x) => esc(x.discoverer?.displayName || '-');
    app.innerHTML = `${head('📕 変異図鑑', '#')}
      <div class="card"><h2>🧬 発見された変異</h2>${d.mutations.length ? d.mutations.map((x) => { const m = x.mutations[0]; return `<div class="mut"><div class="mut-h"><b>${esc(m.name)}</b><span class="mut-cat">${esc(m.catName)}</span>${x.owned ? '<span class="small" style="color:#2f9e44;font-weight:800">✅ 持っている</span>' : ''}</div>
        <p class="small" style="margin:2px 0">${esc(m.desc)}</p><p class="small muted" style="margin:0">第一発見者: <b>${who(x)}</b> (${when(x.at)}・変異${esc(x.rarity || '')} で発現)</p></div>`; }).join('') : '<p class="empty">まだ何も発見されていません</p>'}</div>
      ${d.combos.length ? `<div class="card"><h2>🔗 発見された組み合わせ</h2>${d.combos.map((x) => `<div class="mut"><b>${x.mutations.map((m) => esc(m.name)).join(' × ')}</b><p class="small muted" style="margin:0">第一発見者: <b>${who(x)}</b> (${when(x.at)})</p></div>`).join('')}</div>` : ''}
      <div class="card"><h2>🏆 発見者ランキング</h2>${r.top.length ? r.top.map((t) => `<div class="row" style="border-top:1px solid var(--line);padding:6px 0"><b style="width:26px;text-align:center">${t.rank}</b><span style="flex:1">${esc(t.user.displayName)}</span><span class="small">変異 ${t.mutations} · 組み合わせ ${t.count - t.mutations}</span></div>`).join('') : '<p class="empty">まだいません</p>'}</div>`;
  }

  // ---------- バトル: モンスターと相手をえらぶ ----------
  function viewFightPick(params) {
    const ready = me.monsters.filter((m) => m.status === 'active');
    let sel = ready.find((m) => m.id === params.get('mon'))?.id || ready[0]?.id;
    const draw = () => {
      app.innerHTML = `${head('⚔️ バトル', '#')}
        <div class="card"><h2>だれで戦う？</h2>${ready.length ? `<div class="grid">${ready.map((m) => mcard(m, { href: '', cls: m.id === sel ? 'sel' : '' })).join('')}</div>` : '<p class="empty">戦えるモンスターがいません (育成を終わらせよう)</p>'}</div>
        ${sel ? `<div class="card" style="display:grid;gap:8px"><a class="btn primary block" href="#battle?mode=cpu&mon=${sel}">🤖 CPU と戦う <small>(市場価値 0.6 倍)</small></a>
          <a class="btn gold block" href="#battle?mode=random&mon=${sel}">🌐 ランダム対戦 <small>(対人戦)</small></a>
          <a class="btn block" href="#board?mon=${sel}">📋 募集掲示板で相手を探す</a></div>` : ''}`;
      $$('.mcard').forEach((el) => el.onclick = (e) => { e.preventDefault(); sel = el.dataset.id; draw(); });
    };
    draw();
  }

  // ---------- ドット絵 (技の弾・衝撃・背景)。文字の並びを四角のドットで描く ----------
  const PIX_PAL = { fire: ['#e8590c', '#ff922b', '#fff3bf'], water: ['#1864ab', '#4dabf7', '#e7f5ff'], grass: ['#2b8a3e', '#69db7c', '#d3f9d8'], light: ['#f08c00', '#ffd43b', '#ffffff'], dark: ['#5f3dc4', '#9775fa', '#f3d9fa'], king: ['#b35c00', '#fcc419', '#fff9db'] };
  const PIX = {
    orb: ['..1111..', '.122221.', '12233221', '12333321', '12333321', '12233221', '.122221.', '..1111..'],
    fire: ['....1...', '...121..', '..1221..', '.12321.1', '1233321.', '12333321', '.123321.', '..1111..'],
    leaf: ['......11', '....1121', '...12221', '..122321', '.122321.', '.12221..', '1221....', '11......'],
    star: ['...11...', '...21...', '11123111', '.123321.', '..1331..', '.12..21.', '12....21', '1......1'],
    crown: ['1..1..1.', '12.2.21.', '1232321.', '1233321.', '12222221', '13131311', '11111111', '........'],
    shade: ['.1.11.1.', '1122221.', '12233221', '12333321', '.233332.', '12233221', '.122221.', '1.1..1.1'],
    impact: ['1...1...1', '.1..2..1.', '..12321..', '.1233321.', '123333321', '.1233321.', '..12321..', '.1..2..1.', '1...1...1'],
  };
  const PIX_SHOT = { fire: PIX.fire, water: PIX.orb, grass: PIX.leaf, light: PIX.star, dark: PIX.shade, king: PIX.crown };
  function pix(map, pal, px = 5) {
    const w = map[0].length, h = map.length; let r = '';
    map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[Number(ch) - 1] || pal[0]}"/>`; }));
    return `<svg width="${w * px}" height="${h * px}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${r}</svg>`;
  }
  // 背景: 夜空・ドットの星と月・段々の山・タイルの地面
  const PIX_BG = (() => {
    const W = 96, H = 52; let r = `<rect width="${W}" height="${H}" fill="#1b1650"/><rect y="18" width="${W}" height="10" fill="#241d68"/><rect y="28" width="${W}" height="8" fill="#2f2780"/>`;
    let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 26; i++) r += `<rect x="${Math.floor(rnd() * W)}" y="${Math.floor(rnd() * 26)}" width="1" height="1" fill="${rnd() < 0.3 ? '#ffe066' : '#ffffff'}" opacity="${0.5 + rnd() * 0.5}"/>`;
    r += `<rect x="78" y="4" width="6" height="6" fill="#fff3bf"/><rect x="77" y="5" width="8" height="4" fill="#fff3bf"/><rect x="80" y="5" width="3" height="3" fill="#ffe066"/>`;
    const hill = (x0, w, h, col) => { for (let i = 0; i < w; i++) { const hh = Math.round(h * Math.sin((i / w) * Math.PI)); r += `<rect x="${x0 + i}" y="${36 - hh}" width="1" height="${hh}" fill="${col}"/>`; } };
    hill(-6, 40, 12, '#3b2f8f'); hill(28, 44, 15, '#352a82'); hill(64, 40, 11, '#3b2f8f');
    for (let y = 36; y < H; y += 4) for (let x = 0; x < W; x += 4) r += `<rect x="${x}" y="${y}" width="4" height="4" fill="${((x + y) / 4) % 2 ? '#2f9e44' : '#37b24d'}"/>`;
    r += `<rect y="36" width="${W}" height="1" fill="#8ce99a"/>`;
    return `<svg class="pixbg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">${r}</svg>`;
  })();

  // ---------- バトル ----------
  function viewBattle(params) {
    const mode = params.get('mode'), monId = params.get('mon'), code = params.get('code'), comment = params.get('comment') || '';
    app.innerHTML = `${head('⚔️ バトル', '#fight')}<div class="bt" id="bt"><div class="ovl"><div class="toss"><p style="animation:none">${mode === 'random' ? '対戦相手をさがしています…' : mode === 'board' ? '📋 掲示板で対戦相手を募集中…' : 'じゅんび中…'}</p><span id="wcode"></span><button class="btn sm" id="cancel" style="pointer-events:auto">やめる</button></div></div></div>`;
    const bt = $('#bt');
    let ws = null, you = 0, st = null, keys = '', queued = [], closed = false, oppN = 0, deadline = 0, timer = 0, players = [], log = [], ended = false, busy = false;
    const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    $('#cancel').onclick = () => { wsSend({ t: 'cancel' }); location.hash = '#fight'; };
    const mySkills = () => [...st.mons[you].skills, guardSkill()];
    const hpBar = (f) => `<div class="hp"><i style="width:${Math.max(0, (f.hp / f.maxHp) * 100)}%" class="${f.hp / f.maxHp < 0.3 ? 'low' : ''}"></i></div><span class="small">${f.hp}/${f.maxHp}</span>`;
    const plate = (f, who) => `<div class="pl ${who}"><b>${esc(f.name)}</b><span class="pl-sub">${esc(players[who === 'foe' ? 1 - you : you]?.displayName || '')} ${typeTag(f.type)} <span class="rk r-${esc(f.rank)}" style="position:static;padding:0 4px;font-size:10px">${esc(f.rank)}</span></span>${hpBar(f)}</div>`;
    function buildStage() {
      const me2 = st.mons[you], foe = st.mons[1 - you];
      bt.innerHTML = `<div class="stage" id="stage">${PIX_BG}
        ${plate(me2, 'me')}${plate(foe, 'foe')}
        <div class="ftr me" id="fme"><div class="mon">${MonArt.svg(me2.look, me2.type, { rank: me2.rank })}</div><i class="shadow"></i></div>
        <div class="ftr foe" id="ffoe"><div class="mon">${MonArt.svg(foe.look, foe.type, { rank: foe.rank })}</div><i class="shadow"></i></div>
        <div class="slog" id="slog"></div></div><div id="ctrl"></div>`;
      updStage();
    }
    function updStage() {
      const sl = $('#slog'); if (sl) sl.textContent = log.slice(-1)[0] || `ラウンド ${st.round + 1} · ${st.first === you ? 'あなたが先攻' : '相手が先攻'}`;
      [['me', st.mons[you]], ['foe', st.mons[1 - you]]].forEach(([w, f]) => { const i = $(`.pl.${w} .hp i`, bt), n = $(`.pl.${w} .small`, bt); if (i) { i.style.width = Math.max(0, (f.hp / f.maxHp) * 100) + '%'; i.classList.toggle('low', f.hp / f.maxHp < 0.3); } if (n) n.textContent = `${f.hp}/${f.maxHp}`; });
    }
    // 入力のしかた: 十字キー (pad) / スティック (stick)。端末に覚えておく
    let ctrlMode = (() => { try { return localStorage.getItem('mon_ctrl') === 'stick' ? 'stick' : 'pad'; } catch { return 'pad'; } })();
    const surBtn = () => (ended ? '' : '<button class="btn sm" id="sur" style="margin-top:8px;background:rgba(255,255,255,.15);color:#fff">こうさん</button>');
    const padHtml = () => `<div class="pad"><span class="c"></span><button data-k="U">↑</button><span class="c"></span><button data-k="L">←</button><button class="c" data-k="X" style="font-size:16px;background:rgba(255,255,255,.2);color:#fff;box-shadow:none">消す</button><button data-k="R">→</button><span class="c"></span><button data-k="D">↓</button><span class="c"></span></div>`;
    const stickHtml = () => `<div class="stick-wrap"><div class="stick" id="stick"><i class="sd u">↑</i><i class="sd d">↓</i><i class="sd l">←</i><i class="sd r">→</i><b class="thumb" id="thumb"></b></div><button class="btn sm erase" data-k="X">⌫ 消す</button></div>`;
    // 入力の画面は 1 ラウンドに 1 回だけ組み立てる。キーを押したときは中身だけ変える (ボタンの位置が動かないように)
    function render(phase) {
      if (!$('#bt')) return;
      if (!$('#stage')) buildStage(); else updStage();
      if (phase !== 'input') { $('#ctrl').innerHTML = `<p class="prompt" style="opacity:.85">⚔️ バトル中…</p><div style="min-height:250px"></div>${surBtn()}`; bindSur(); return; }
      $('#ctrl').innerHTML = `<p class="prompt" id="prompt"></p><div class="timer"><i id="tbar" style="width:100%"></i></div>
        <div class="queue" id="queue"></div>
        <div class="bt-mid"><div class="inarea">
          <div class="slots" id="slots"></div><div class="hintline" id="hint"></div>
          <div class="ctlmode" role="tablist"><button type="button" data-mode="pad" class="${ctrlMode === 'pad' ? 'on' : ''}">✚ 十字キー</button><button type="button" data-mode="stick" class="${ctrlMode === 'stick' ? 'on' : ''}">🕹️ スティック</button></div>
          <div id="pad">${ctrlMode === 'stick' ? stickHtml() : padHtml()}</div>
          <button class="btn gold block" id="ok" style="font-size:20px">決定！</button></div>
          <div class="cmdlist" id="cmdlist"></div></div>${surBtn()}`;
      bindPad();
      $$('[data-mode]', bt).forEach((b) => b.addEventListener('click', () => { ctrlMode = b.dataset.mode; try { localStorage.setItem('mon_ctrl', ctrlMode); } catch {} $$('[data-mode]', bt).forEach((x) => x.classList.toggle('on', x === b)); $('#pad').innerHTML = ctrlMode === 'stick' ? stickHtml() : padHtml(); bindPad(); updateInput(); }));
      $('#ok', bt).addEventListener('click', submit);
      bindSur();
      updateInput();
    }
    function bindSur() { $('#sur', bt)?.addEventListener('click', () => { if (confirm('こうさんしますか？')) wsSend({ t: 'surrender' }); }); }
    function bindPad() {
      $$('#pad [data-k]', bt).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
      const stick = $('#stick', bt); if (!stick) return;
      // スティック: 倒した向きを入力。同じ向きをもう一度入れるときは、いったん真ん中にもどす (向きを変えるのはそのままでも OK)
      const thumb = $('#thumb', stick); let id = null, last = null;
      const move = (e) => {
        const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy), max = r.width / 2 - 26, k = d > max ? max / d : 1;
        thumb.style.transform = `translate(${dx * k}px,${dy * k}px)`;
        if (d < r.width * 0.12) { last = null; stick.dataset.dir = ''; return; }
        if (d > r.width * 0.26) { const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'); if (dir !== last) { last = dir; stick.dataset.dir = dir; press(dir); } }
      };
      stick.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; stick.setPointerCapture(id); stick.classList.add('held'); move(e); });
      stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
      const up = (e) => { if (e.pointerId !== id) return; id = null; last = null; stick.dataset.dir = ''; stick.classList.remove('held'); thumb.style.transform = ''; };
      stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
    }
    function updateInput() {
      if (!$('#slots', bt)) return;
      const match = mySkills().find((s) => s.cmd === keys);
      const near = keys && mySkills().filter((s) => s.cmd.startsWith(keys) && s.cmd !== keys).sort((a, b) => a.cmd.length - b.cmd.length)[0];
      $('#prompt', bt).innerHTML = `${closed ? '時間切れ！ 技を出すよ' : queued.length ? `続けて打てる！ (${queued.length} 個確定)` : 'コマンドを打って技を入力！'}<small>${oppN ? `相手は ${oppN} 個確定` : '&nbsp;'}</small>`;
      $('#queue', bt).innerHTML = queued.map((q, i) => { const s = mySkills().find((x) => x.cmd === q); return `<span class="${s ? 'ok' : 'ng'}">${i + 1}. ${s ? esc(s.name) : '不発'}</span>`; }).join('');
      const sl = $('#slots', bt); sl.className = 'slots' + (match ? ' match' : '');
      sl.innerHTML = [...keys].map((k) => `<span>${ARROW[k]}</span>`).join('') || '<small style="opacity:.6">↑↓←→ でコマンドを入力</small>';
      const h = $('#hint', bt);
      h.className = 'hintline' + (keys && !match && !near ? ' miss' : '');
      h.innerHTML = match ? `✨ <b>${esc(match.name)}</b>！ 決定で確定` : near ? `→ <b>${esc(near.name)}</b> まで あと ${near.cmd.length - keys.length} キー` : keys ? 'この並びの技はありません (消すで直せます)' : '&nbsp;';
      $('#cmdlist', bt).innerHTML = `<b style="font-size:12px">コマンド一覧</b>${mySkills().map((s) => `<div class="${keys && s.cmd.startsWith(keys) ? 'hit' : ''}"><b>${esc(s.name)}</b><span class="cmd">${arrows(s.cmd)}</span></div>`).join('')}`;
      $('#ok', bt).disabled = closed || !keys;
      $$('#pad button, [data-mode]', bt).forEach((b) => { b.disabled = closed; });
    }
    function press(k) {
      if (closed || ended || !st) return;
      if (k === 'X') keys = keys.slice(0, -1); else if (keys.length < 14) keys += k;
      const before = mySkills().find((s) => s.cmd === keys);
      updateInput();
      keyFx(k, before);
    }
    // キーを押すたびのエフェクト: ボタンから光の輪・入力枠に火花と矢印が飛びこむ・どの技に近づいているか・合わなくなったらゆれる
    const KEY_COL = { U: '#ffe066', D: '#74c0fc', L: '#ff8787', R: '#8ce99a', X: '#ced4da' };
    function keyFx(k, matched) {
      const box = bt.getBoundingClientRect();
      const btn = $(`#pad [data-k="${k}"]`, bt) || $('#stick', bt), slots = $('#slots', bt);
      if (!btn || !slots) return;
      const br = btn.getBoundingClientRect(), sr = slots.getBoundingClientRect(), col = KEY_COL[k];
      const at = (r) => ({ x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 });
      const from = at(br), last = slots.lastElementChild?.getBoundingClientRect?.() ? at(slots.lastElementChild.getBoundingClientRect()) : at(sr);
      const fx = (cls, x, y, css = '', html = '', ms = 700) => { const e = document.createElement('i'); e.className = 'kfx ' + cls; e.style.cssText = `left:${x}px;top:${y}px;--c:${col};${css}`; e.innerHTML = html; bt.append(e); setTimeout(() => e.remove(), ms); return e; };
      fx('ring', from.x, from.y);                                   // ボタンから光の輪
      btn.classList.remove('kpress'); void btn.offsetWidth; btn.classList.add('kpress');
      if (k === 'X') return;
      fx('fly', from.x, from.y, `--dx:${last.x - from.x}px;--dy:${last.y - from.y}px`, ARROW[k], 420); // 矢印が入力枠へ飛ぶ
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4, d = 22 + Math.random() * 18; fx('spark', last.x, last.y, `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:.32s`, '', 900); }
      const near = mySkills().filter((s) => s.cmd.startsWith(keys) && s.cmd !== keys).sort((a, b) => a.cmd.length - b.cmd.length)[0];
      if (matched) { slots.classList.add('kmatch'); fx('burst', last.x, last.y, 'animation-delay:.3s', '', 900); }
      else if (!near) slots.classList.add('kmiss');
    }
    // 決定: 確定した技は順番にならび、時間があるあいだは続けて何個でも打てる
    // 決定で確定したときに、成立した技ならパチンコ風カットイン (打っている途中では出さない)
    function submit() { if (closed || ended || !keys) return; const sk = mySkills().find((s) => s.cmd === keys); wsSend({ t: 'cmd', keys }); queued.push(keys); keys = ''; updateInput(); if (sk) pachiCut(sk, true, you); }
    const onKey = (e) => { const k = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', Backspace: 'X' }[e.key]; if (k) { e.preventDefault(); press(k); } else if (e.key === 'Enter') submit(); };
    document.addEventListener('keydown', onKey);
    function cutin(s, preview = false, who = you) {
      const col = s.kind === 'punch' ? (st.mons[who].type) : s.type;
      const el = document.createElement('div'); el.className = 'ci' + (s.kind === 'ult' ? ' ult' : '');
      el.style.background = s.kind === 'guard' ? 'linear-gradient(90deg,transparent,#5c7cfa 15%,#748ffc 85%,transparent)' : `linear-gradient(90deg,transparent,var(--${col}) 15%,var(--${col}) 85%,transparent)`;
      el.innerHTML = `<small>${preview ? 'コマンド認識！' : who === you ? 'あなたの' : '相手の'}${esc(KIND[s.kind])}</small><b>${esc(s.name)}</b>`;
      if (!preview) el.classList.add('short');
      ($('#stage') || bt).append(el); setTimeout(() => el.remove(), preview ? 1600 : 1000);
    }
    // パチンコ風のギラギラカットイン: 白フラッシュ → 回転する光線 → 斜めの帯 → 巨大な漢字 → 金色の技名がドンと落ちてくる → 火花
    // 大技は虹色の光線・虹の枠・「確定」のハンコ。preview: 入力中にコマンドが成立したとき (入力のじゃまをしないよう触れない・少し短い)
    const PC_LABEL = { punch: ['⚡ チャンス！', '激'], magic: ['🔥 激アツ！！', '熱'], ult: ['🌈 超激アツ確定！！！', '極'], guard: ['🛡️ 鉄壁！', '守'] };
    const PC_MS = { punch: 800, magic: 1000, ult: 1500, guard: 700 };
    function pachiCut(s, preview = false, who = you) {
      if (!bt) return 0;
      const kind = PC_LABEL[s.kind] ? s.kind : 'punch', ms = Math.round((PC_MS[kind] || 900) * (preview ? 0.85 : 1));
      const col = kind === 'guard' ? '#748ffc' : `var(--${kind === 'punch' ? st.mons[who].type : s.type})`;
      const [lab, kanji] = PC_LABEL[kind], n = kind === 'ult' ? 20 : 12;
      const sparks = Array.from({ length: n }, (_, i) => `<i style="--a:${Math.round((i / n) * 360 + Math.random() * 14)}deg;--d:${Math.round(120 + Math.random() * 120)}px;--dl:${(0.08 + Math.random() * 0.25).toFixed(2)}s"></i>`).join('');
      $$('.pc', bt).forEach((x) => x.remove()); // 前のカットインは消して、新しいものを出す (重ならないように)
      const el = document.createElement('div'), len = [...s.name].length;
      el.className = `pc k-${kind}${preview ? ' pre' : ''}`; el.style.setProperty('--ms', ms + 'ms'); el.style.setProperty('--c', col);
      el.style.setProperty('--fs', (len > 9 ? 22 : len > 7 ? 26 : len > 5 ? 30 : 34) + 'px'); // 長い技名は小さく (1 行におさめる)
      el.innerHTML = `<div class="pc-flash"></div><div class="pc-rays"></div><div class="pc-band"><div class="pc-stripe"></div></div><div class="pc-kanji">${esc(kanji)}</div>
        <div class="pc-txt"><small>${esc(preview ? 'コマンド確定！' : `${who === you ? 'あなた' : '相手'}の${KIND[kind] || ''}`)}</small><span class="pc-lab">${esc(lab)}</span><b data-t="${esc(s.name)}">${esc(s.name)}</b></div>
        <div class="pc-sp">${sparks}</div>${kind === 'ult' ? '<div class="pc-frame"></div><div class="pc-stamp">確定</div>' : ''}`;
      bt.append(el); setTimeout(() => el.remove(), ms + 120);
      return ms;
    }
    function connect() {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mb`);
      ws.onopen = () => { if (!st) wsSend(mode === 'join' ? { t: 'find', mode: 'join', code, mon: monId } : { t: 'find', mode, mon: monId, comment }); };
      ws.onmessage = async (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (!$('#bt')) return;
        if (m.t === 'waiting') { if (m.code) $('#wcode').innerHTML = `<span class="small">この画面のまま待っていると、掲示板を見た人が来ます</span>`; return; }
        if (m.t === 'error') { bt.innerHTML = `<div class="empty" style="color:#fff">${esc(m.msg)}<br><a class="btn" href="#fight" style="margin-top:10px">もどる</a></div>`; ended = true; ws.close(); return; }
        if (m.t === 'start') {
          you = m.you; players = m.players; st = m.state;
          if (m.resumed) { render('wait'); return; }
          bt.innerHTML = `<div class="ovl"><div class="toss"><p style="animation:none;font-size:16px">${esc(players[0].displayName)} vs ${esc(players[1].displayName)}</p><div class="coin">🪙</div><p>${st.first === you ? '🎉 あなたが先攻！' : '相手が先攻'}</p></div></div>`;
          return;
        }
        if (m.t === 'input') {
          while (busy) await new Promise((r) => setTimeout(r, 80)); // 演出が終わってから入力にもどる
          st = m.state; keys = ''; queued = Array.isArray(m.queued) ? m.queued.slice() : []; closed = false; oppN = 0; deadline = Date.now() + (m.deadline - Date.now());
          render('input'); clearInterval(timer);
          timer = setInterval(() => { const b = $('#tbar'); if (!b) return; const left = Math.max(0, deadline - Date.now()); b.style.width = (left / m.ms) * 100 + '%';
            if (left <= 0) { clearInterval(timer); if (keys && mySkills().some((s) => s.cmd === keys)) submit(); closed = true; updateInput(); } }, 100);
          return;
        }
        if (m.t === 'opponentReady') { oppN = m.n || oppN + 1; updateInput(); return; }
        if (m.t === 'queued') return;
        if (m.t === 'result') { clearInterval(timer); busy = true; await playEvents(m.events, m.state); busy = false; return; }
        if (m.t === 'opponentLeft') { log.push('相手の接続が切れました'); return; }
        if (m.t === 'end') { while (busy) await new Promise((r) => setTimeout(r, 100)); end(m); }
      };
      ws.onclose = () => { if (!ended && $('#bt')) setTimeout(() => { if (!ended && $('#bt')) connect(); }, 1500); };
    }
    async function playEvents(events, ns) {
      const prev = st; render('show');
      for (const e of events) {
        if (e.k === 'skill') {
          const s = { name: e.name, kind: e.kind, type: e.type };
          log.push(`${e.p === you ? 'あなた' : '相手'}の「${e.name}」！`); updStage();
          await wait(pachiCut(s, false, e.p) * 0.75);            // パチンコ風カットイン
          await attackFx(e);                                     // 技を相手に撃ちこむ
          st.mons[1 - e.p].hp = e.hp; prev.mons[1 - e.p].hp = e.hp;
          popDmg(e);
          log.push(`${e.p === you ? 'あなた' : '相手'}の「${e.name}」！ ${e.dmg} ダメージ${e.eff === 'good' ? ' (効果ばつぐん)' : e.eff === 'bad' ? ' (いまひとつ)' : ''}`); updStage();
          await wait(650);
        } else if (e.k === 'guard') {                           // 防御の構え (撃ってこなければ空振り)
          const at = $(e.p === you ? '#fme' : '#ffoe', bt);
          shieldFx(at, false);
          log.push(e.idle ? `${e.p === you ? 'あなた' : '相手'}は身を守った…けれど攻撃は来なかった` : `${e.p === you ? 'あなた' : '相手'}は🛡️ぼうぎょの構え！`); updStage();
          await wait(e.idle ? 900 : 700);
        } else if (e.k === 'blocked') {                         // 同じ回の防御で技が無効になった
          const s = { name: e.name, kind: e.kind, type: e.type };
          log.push(`${e.p === you ? 'あなた' : '相手'}の「${e.name}」！`); updStage();
          await wait(pachiCut(s, false, e.p) * 0.75);
          const tgt = $(e.p === you ? '#ffoe' : '#fme', bt);
          shieldFx(tgt, true);
          await attackFx({ ...e, blocked: true });
          const d = document.createElement('div'); d.className = 'pdmg guard'; d.innerHTML = '🛡️ ガード！<small>技を無効にした</small>'; placeOver(d, tgt); ($('#stage') || bt).append(d); setTimeout(() => d.remove(), 1200);
          log.push(`${e.p === you ? '相手' : 'あなた'}のぼうぎょで「${e.name}」は無効になった！`); updStage();
          await wait(700);
        } else if (e.k === 'miss') {
          const at = $(e.p === you ? '#fme' : '#ffoe', bt);
          at?.classList.add('fizzle'); setTimeout(() => at?.classList.remove('fizzle'), 900);
          const d = document.createElement('div'); d.className = 'pdmg miss'; d.textContent = e.empty ? '…' : '不発！'; placeOver(d, at, -20); ($('#stage') || bt).append(d); setTimeout(() => d.remove(), 1000);
          log.push(`${e.p === you ? 'あなた' : '相手'}の技は${e.empty ? '入力されなかった' : '不発だった'}`); updStage(); await wait(900);
        } else if (e.k === 'ko') {
          const t = $(e.p === you ? '#fme' : '#ffoe', bt); t?.classList.add('ko');
          koFx(e.p !== you);
          log.push(`${e.p === you ? 'あなた' : '相手'}のモンスターはたおれた！`); updStage(); await wait(1100);
        }
      }
      st = ns;
    }
    function end(m) {
      ended = true; clearInterval(timer);
      const word = m.result === 'win' ? '🏆 勝ち！' : m.result === 'lose' ? '負け…' : '引き分け';
      bt.innerHTML = `<div class="center" style="padding:30px 10px"><p class="shout" style="font-size:36px">${word}</p>${m.monster ? MonArt.svg(m.monster.look, m.monster.type, { rank: m.monster.rank, cls: 'big-art' }) : ''}
        <p style="font-weight:900">市場価値 +${m.score}${m.pvp ? '' : ' (CPU 戦は 0.6 倍)'} · 🪙 +${m.coins}</p>${m.monster ? `<p>いまの市場価値 <span class="val">${Number(m.monster.score).toLocaleString()}</span></p>` : ''}
        <div class="lin"><a class="btn gold" href="#battle?mode=${encodeURIComponent(mode === 'join' ? 'board' : mode)}&mon=${encodeURIComponent(monId)}&n=${Date.now()}">もう一度</a><a class="btn" href="#">ホームへ</a></div></div>`;
      refresh().catch(() => {});
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const center = (el) => { const sr = $('#stage').getBoundingClientRect(), r = (el.querySelector('.mon') || el).getBoundingClientRect(); return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 }; };
    function placeOver(d, el, dy = 0) { if (!el) return; const c = center(el); d.style.left = c.x + 'px'; d.style.top = (c.y - 50 + dy) + 'px'; }
    // 防御のバリア (ドット風の六角の盾)。hit: 技を受け止めた (光ってゆれる)
    function shieldFx(el, hit) {
      if (!el || !$('#stage')) return;
      const c = center(el), d = document.createElement('div'); d.className = 'shield' + (hit ? ' hit' : '');
      d.style.left = c.x + 'px'; d.style.top = c.y + 'px'; $('#stage').append(d); setTimeout(() => d.remove(), hit ? 1900 : 1100);
    }
    function popDmg(e) {
      const tgt = $(e.p === you ? '#ffoe' : '#fme', bt), d = document.createElement('div');
      d.className = 'pdmg gdmg' + (e.eff === 'good' ? ' good' : e.eff === 'bad' ? ' bad' : '') + (e.kind === 'ult' ? ' big' : '');
      d.innerHTML = `-${e.dmg}${e.eff === 'good' ? '<small>こうかばつぐん!</small>' : e.eff === 'bad' ? '<small>いまひとつ…</small>' : ''}`;
      placeOver(d, tgt); $('#stage').append(d); setTimeout(() => d.remove(), 1200);
    }
    function sprite(cls, html, x, y) { const d = document.createElement('div'); d.className = 'spr ' + cls; d.innerHTML = html; d.style.left = x + 'px'; d.style.top = y + 'px'; $('#stage').append(d); return d; }
    function burst(x, y, pal, n = 12, big = false) {
      const im = sprite('impact' + (big ? ' big' : ''), pix(PIX.impact, pal, big ? 8 : 5), x, y); setTimeout(() => im.remove(), 600);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, d = (big ? 70 : 40) + Math.random() * 30;
        const q = sprite('px', '', x, y); q.style.background = pal[i % 3]; q.style.setProperty('--dx', Math.cos(a) * d + 'px'); q.style.setProperty('--dy', Math.sin(a) * d + 'px'); setTimeout(() => q.remove(), 700); }
    }
    // ---- ギラギラの部品 ----
    const ONOMA = { punch: ['ドゴッ!!', 'バキィッ!!', 'ズガン!!', 'ドカッ!!'], magic: ['ズドォン!!', 'バシュウッ!!', 'ドバァン!!'], ult: ['ドッゴォォン!!!', 'ズガガガガ!!!', 'ドドドドドッ!!!'] };
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
    function sflash(col = '#fff', ms = 380) { const st2 = $('#stage'); if (!st2) return; const f = document.createElement('div'); f.className = 'sflash'; f.style.background = col; f.style.animationDuration = ms + 'ms'; st2.append(f); setTimeout(() => f.remove(), ms + 50); }
    function shock(x, y, col, size = 1, delay = 0) { const r = sprite('shock', '', x, y); r.style.setProperty('--c', col); r.style.setProperty('--s', size); r.style.animationDelay = delay + 'ms'; setTimeout(() => r.remove(), 700 + delay); }
    function starburst(x, y, col, big = false) { const r = sprite('sburst' + (big ? ' big' : ''), '', x, y); r.style.setProperty('--c', col); setTimeout(() => r.remove(), 750); }
    function goldRain(x, y, n = 16, big = false) {
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = (big ? 90 : 55) + Math.random() * (big ? 90 : 50);
        const q = sprite('gp' + (i % 4 === 0 ? ' star' : ''), i % 4 === 0 ? '✦' : '', x, y); q.style.setProperty('--dx', Math.cos(a) * d + 'px'); q.style.setProperty('--dy', Math.sin(a) * d - 20 + 'px'); q.style.setProperty('--r', Math.round(Math.random() * 720 - 360) + 'deg');
        q.style.animationDelay = Math.round(Math.random() * 120) + 'ms'; setTimeout(() => q.remove(), 1100); }
    }
    function onoma(x, y, text, col, big = false) { const d = sprite('onoma' + (big ? ' big' : ''), esc(text), x, y); d.style.setProperty('--c', col); setTimeout(() => d.remove(), 1000); }
    function koFx(won) {
      const stage = $('#stage'); if (!stage) return;
      sflash('#fff', 500); stage.classList.add('quake'); setTimeout(() => stage.classList.remove('quake'), 900);
      const k = document.createElement('div'); k.className = 'kofx' + (won ? ' won' : ''); k.innerHTML = '<i></i><b>K.O.!!</b>'; stage.append(k); setTimeout(() => k.remove(), 1400);
      const sr = stage.getBoundingClientRect(); goldRain(sr.width / 2, sr.height / 2, won ? 26 : 12, true);
    }
    async function attackFx(e) {
      const stage = $('#stage'); if (!stage) return;
      const atk = $(e.p === you ? '#fme' : '#ffoe', bt), tgt = $(e.p === you ? '#ffoe' : '#fme', bt);
      const a = center(atk), t = center(tgt), pal = PIX_PAL[e.type] || PIX_PAL.fire, dir = t.x > a.x ? 1 : -1;
      const hit = () => { if (e.blocked) return; tgt.classList.remove('hit'); void tgt.offsetWidth; tgt.classList.add('hit'); };
      const word = e.blocked ? 'ガキィン!!' : pickOne(ONOMA[e.kind] || ONOMA.punch);
      if (e.kind === 'punch') { // 直殴り: 集中線の中を残像つきで突進 → 星形の衝撃・衝撃波・金の火花・擬音
        stage.classList.add('speed');
        const ghost = atk.cloneNode(true); ghost.removeAttribute('id'); ghost.classList.add('ghost'); stage.append(ghost);
        atk.style.setProperty('--dash', `${(t.x - a.x) * 0.62}px`); atk.classList.add('dash');
        ghost.style.setProperty('--dash', `${(t.x - a.x) * 0.35}px`); requestAnimationFrame(() => ghost.classList.add('dash'));
        await wait(210);
        sflash(pal[1], 180); starburst(t.x - dir * 14, t.y, pal[1]); shock(t.x, t.y, '#fff'); shock(t.x, t.y, pal[1], 0.7, 90);
        burst(t.x - dir * 18, t.y, pal, 12); goldRain(t.x, t.y, 12); onoma(t.x + dir * 6, t.y - 62, word, pal[1]); hit(); stage.classList.add('jolt');
        await wait(340); atk.classList.remove('dash'); stage.classList.remove('jolt', 'speed'); ghost.remove();
        await wait(120);
      } else if (e.kind === 'magic') { // 魔法: 足もとに回る魔法陣 → 光る弾が尾を引いてとぶ → 大爆発
        const mc = sprite('mcircle', '', a.x, a.y + 34); mc.style.setProperty('--c', pal[1]);
        atk.classList.add('cast'); await wait(360);
        const map = PIX_SHOT[e.type] || PIX.orb, b = sprite('shot glow', pix(map, pal, 6), a.x, a.y);
        b.style.setProperty('--c', pal[1]);
        if (dir < 0) b.firstElementChild.style.transform = 'scaleX(-1)';
        let tick = 0; const trail = setInterval(() => { const r = b.getBoundingClientRect(), sr = stage.getBoundingClientRect(); const q = sprite('trail', '', r.left - sr.left + r.width / 2, r.top - sr.top + r.height / 2); q.style.background = tick++ % 2 ? '#ffe066' : pal[1]; q.style.boxShadow = `0 0 8px ${pal[1]}`; setTimeout(() => q.remove(), 450); }, 30);
        await b.animate([{ transform: 'translate(-50%,-50%) translate(0,0) scale(.6)' }, { transform: `translate(-50%,-50%) translate(${(t.x - a.x) / 2}px,${-46}px) scale(1.35)`, offset: 0.5 }, { transform: `translate(-50%,-50%) translate(${t.x - a.x}px,${t.y - a.y}px) scale(1.15)` }], { duration: 520, easing: 'ease-in' }).finished;
        clearInterval(trail); b.remove();
        sflash(pal[1], 260); starburst(t.x, t.y, pal[1], true); shock(t.x, t.y, '#fff', 1.1); shock(t.x, t.y, pal[1], 1.5, 120);
        burst(t.x, t.y, pal, 18); goldRain(t.x, t.y, 18); onoma(t.x, t.y - 66, word, pal[1]); hit(); stage.classList.add('jolt'); atk.classList.remove('cast');
        await wait(380); stage.classList.remove('jolt'); mc.remove();
      } else { // 大技: 暗転 → 背中に虹の光線・力をためる → 「超必殺」 → 虹色の極太ビーム → ホワイトアウト → 連続大爆発 → 金の雨
        stage.classList.add('dim'); atk.classList.add('charge');
        const rays = sprite('urays', '', a.x, a.y), ring = sprite('chargering', '', a.x, a.y); ring.style.borderColor = pal[1]; ring.style.boxShadow = `0 0 24px ${pal[1]}`;
        onoma(a.x, a.y - 74, '超必殺!!', '#ffd43b', true);
        for (let i = 0; i < 10; i++) { const q = sprite('suck', '', a.x + Math.cos(i * 0.63) * 90, a.y + Math.sin(i * 0.63) * 70); q.style.setProperty('--dx', -Math.cos(i * 0.63) * 90 + 'px'); q.style.setProperty('--dy', -Math.sin(i * 0.63) * 70 + 'px'); q.style.background = i % 2 ? '#fff' : pal[1]; q.style.animationDelay = i * 40 + 'ms'; setTimeout(() => q.remove(), 800); }
        await wait(780); ring.remove();
        const beam = document.createElement('div'); beam.className = 'beam rainbow';
        const x0 = Math.min(a.x, t.x), w = Math.abs(t.x - a.x);
        beam.style.cssText = `left:${x0}px;top:${a.y - 30}px;width:${w}px;height:60px;--c1:${pal[0]};--c2:${pal[1]};--c3:${pal[2]};transform-origin:${dir > 0 ? 'left' : 'right'} center`;
        stage.append(beam);
        await wait(240); sflash('#fff', 520); const f = document.createElement('div'); f.className = 'flashb'; stage.append(f); setTimeout(() => f.remove(), 500);
        hit(); stage.classList.add('quake');
        for (let i = 0; i < 5; i++) setTimeout(() => { const x = t.x + (Math.random() - 0.5) * 70, y = t.y + (Math.random() - 0.5) * 60; starburst(x, y, pal[i % 3], true); burst(x, y, pal, 10, i % 2 === 0); shock(x, y, i % 2 ? '#fff' : pal[1], 1.6); }, i * 120);
        goldRain(t.x, t.y, 30, true); onoma(t.x, t.y - 70, word, pal[1], true);
        await wait(720); beam.classList.add('out'); burst(t.x, t.y - 20, pal, 14, true);
        await wait(300); beam.remove(); rays.remove(); stage.classList.remove('dim', 'quake'); atk.classList.remove('charge');
      }
    }
    connect();
    cleanup = () => { document.removeEventListener('keydown', onKey); clearInterval(timer); ended = true; try { ws.close(); } catch {} };
  }

  // ---------- セリ ----------
  function viewAuction() {
    app.innerHTML = `${head('🔨 セリ', '#')}<div id="auc"><p class="empty">よみこみ中…</p></div>`;
    let ws = null, state = null, tick = 0, closed = false;
    const draw = () => {
      const root = $('#auc'); if (!root || !state) return;
      const lotCard = (m) => `<div class="card"><div class="row">${MonArt.svg(m.look, m.type, { rank: m.rank, cls: '' }).replace('class="ma-svg', 'style="width:120px;height:120px" class="ma-svg')}<div style="flex:1;min-width:0"><b style="font-size:17px">${esc(m.name)}</b> <span class="rk r-${esc(m.rank)}" style="position:static;padding:0 6px">${esc(m.rank)}</span><br>${m.sex === 'm' ? '♂' : '♀'} ${typeTag(m.type)} · 第${m.gen}世代 · ${m.status === 'training' || m.trainLeft ? `育成あと${m.trainLeft}` : '育成ずみ'}<br><span class="small">出品: ${esc(m.seller?.displayName || '')}</span></div></div>
        <div class="lin" style="margin-top:6px">${['father', 'mother'].map((k) => { const p = m[k]; return p ? `<div class="small"><b>${k === 'father' ? '父' : '母'} ${esc(p.name)}</b> (${esc(p.rank)})<br>市場価値 <span class="val">${Number(p.score).toLocaleString()}</span><br>${p.wins}勝${p.losses}敗・対人 ${p.pvpWins}勝${p.pvpLosses}敗</div>` : '<div></div>'; }).join('')}</div>
        <p class="small" style="margin:6px 0 0">受けついだ技: ${(m.inherited || []).length ? m.inherited.map((x) => `<span class="inh">${esc(x.from)}「${esc(m.skills.find((s) => s.id === x.skill)?.name || '')}」</span>`).join(' ') : 'なし'}</p>
        <p class="small" style="margin:4px 0 0">技: ${m.skills.map((s) => esc(s.name)).join('・')}</p>
        ${(m.mutations || []).length ? `<p class="small" style="margin:4px 0 0">🧬 変異: ${m.mutations.map((x) => `<span class="mutb mr-${esc(x.rarity)}">${x.mode === 'latent' ? '潜在 ' : ''}${esc(x.name)} ${esc(x.rarity)}</span>`).join(' ')}</p>` : ''}</div>`;
      if (state.live && state.lot) {
        const L = state.lot, left = Math.max(0, Math.ceil((L.endsAt - Date.now()) / 1000));
        root.innerHTML = `<div class="card auc-live center"><b>🔴 セリ開催中！ (${state.index + 1}/${state.total})</b><div class="auc-price">🪙 ${Number(L.price).toLocaleString()}</div>
          <p style="margin:0">${L.bidder ? `いちばん高い入札: <b>${esc(L.bidder.displayName)}</b> さん (${L.bids} 回入札)` : `スタート価格 ${L.start} コイン · まだ入札なし`}</p><div class="auc-time">⏱ のこり ${left} 秒</div>
          <div class="row" style="justify-content:center;margin-top:6px"><button class="btn gold" data-bid="${L.minNext}">🔨 ${Number(L.minNext).toLocaleString()} で入札</button><button class="btn" data-bid="${Math.ceil(L.minNext * 1.5)}">${Number(Math.ceil(L.minNext * 1.5)).toLocaleString()}</button><button class="btn" data-bid="${L.minNext * 2}">${Number(L.minNext * 2).toLocaleString()}</button></div>
          <p class="small" style="margin:6px 0 0">入札したコインは預かり、ほかの人に高く入札されたら返します。終わりぎわの入札で少し延長します</p></div>
          ${lotCard(L.monster)}
          ${state.results?.length ? `<div class="card"><h2>今回の結果</h2>${state.results.map((r) => `<div class="small">${esc(r.name)}: ${r.price ? `🪙 ${r.price} で ${esc(r.buyer?.displayName || '')} さんが落札` : '売れ残り'}</div>`).join('')}</div>` : ''}
          ${state.queue.length ? `<div class="card"><h2>このあと (${state.queue.length})</h2>${state.queue.map((m) => `<div class="small">${esc(m.name)} (${esc(m.rank)})</div>`).join('')}</div>` : ''}`;
        $$('[data-bid]', root).forEach((b) => b.onclick = () => ws.send(JSON.stringify({ t: 'bid', amount: Number(b.dataset.bid) })));
      } else {
        const left = Math.max(0, state.next - Date.now()), mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
        root.innerHTML = `<div class="card center"><b>次のセリ</b><div class="auc-time">${esc(fmtTime(state.next))} から (あと ${mm}分${String(ss).padStart(2, '0')}秒)</div><p class="small muted">15 分ごと (毎時 5・20・35・50 分) に開催。メスが産んだモンスターを出品できます (モンスターの画面の「セリに出す」から)</p></div>
          <div class="card"><h2>出品されているモンスター (${state.queue.length})</h2>${state.queue.length ? '' : '<p class="empty">まだ出品はありません</p>'}</div>${state.queue.map(lotCard).join('')}`;
      }
    };
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mb`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'watch' }));
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'auction') { state = m.state; state.skew = Date.now() - m.state.now; draw(); }
        if (m.t === 'bidError') toast(m.msg, true);
        if (m.t === 'bidOk') { toast('入札しました！'); me.coins = m.coins; $('.mb-coins').textContent = `🪙 ${Number(m.coins).toLocaleString()}`; }
        if (m.t === 'outbid') { toast(`「${m.name}」でほかの人がもっと高く入札しました (コインは返しました)`); me.coins = m.coins; $('.mb-coins').textContent = `🪙 ${Number(m.coins).toLocaleString()}`; } };
      ws.onclose = () => { if (!closed) setTimeout(() => { if (!closed && $('#auc')) connect(); }, 1500); };
    };
    connect();
    tick = setInterval(draw, 1000);
    cleanup = () => { closed = true; clearInterval(tick); try { ws.close(); } catch {} };
  }

  // ---------- 募集掲示板 ----------
  async function viewBoard() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const ready = me.monsters.filter((m) => m.status === 'active');
    let sel = ready.find((m) => m.id === params.get('mon'))?.id || ready[0]?.id;
    const draw = (posts) => {
      app.innerHTML = `${head('📋 募集掲示板', '#')}
        <div class="card"><h2>📣 対戦相手を募集する</h2>${ready.length ? `<div class="grid">${ready.map((m) => mcard(m, { href: '', cls: m.id === sel ? 'sel' : '' })).join('')}</div>
          <input class="in" id="cm" maxlength="40" placeholder="ひとこと (40 文字まで)" style="margin-top:8px"><button class="btn gold block" id="post" style="margin-top:8px">📋 募集を出す (対人戦)</button>` : '<p class="empty">戦えるモンスターがいません</p>'}</div>
        <div class="card"><h2>⚔️ 募集中 <span class="small muted">${posts.length} 件</span></h2>${posts.length ? posts.map((p) => `<div class="row" style="border-top:1px solid var(--line);padding:8px 0">
          ${MonArt.svg(p.monster.look, p.monster.type, { rank: p.monster.rank }).replace('class="ma-svg', 'style="width:64px;height:64px" class="ma-svg')}
          <div style="flex:1;min-width:0"><b>${esc(p.user.displayName)}</b> <span class="small muted">の ${esc(p.monster.name)} (${esc(p.monster.rank)}・${typeTag(p.monster.type)})</span>${p.comment ? `<div class="small">${esc(p.comment)}</div>` : ''}</div>
          ${p.mine ? '<span class="small muted">あなた</span>' : sel ? `<a class="btn primary sm" href="#battle?mode=join&code=${encodeURIComponent(p.code)}&mon=${encodeURIComponent(sel)}">対戦する</a>` : ''}</div>`).join('') : '<p class="empty">いま募集している人はいません</p>'}</div>`;
      $$('.mcard').forEach((el) => el.onclick = (e) => { e.preventDefault(); sel = el.dataset.id; load(); });
      $('#post')?.addEventListener('click', () => { location.hash = `#battle?mode=board&mon=${encodeURIComponent(sel)}&comment=${encodeURIComponent($('#cm').value)}&n=${Date.now()}`; });
    };
    const load = async () => { try { draw((await api('/mon/board')).posts); } catch (e) { toast(e.message, true); } };
    await load();
    const iv = setInterval(() => { if (!$('#cm') || document.activeElement === $('#cm')) return; load(); }, 6000);
    cleanup = () => clearInterval(iv);
  }

  // ---------- メスモンスターショップ (毎朝 7 時に 6 体・先着順・1 人 1 日 1 体) ----------
  async function viewShop() {
    const draw = async () => {
      const s = await api('/mon/shop');
      const left = Math.max(0, s.next - Date.now()), hh = Math.floor(left / 3600000), mm = Math.floor(left / 60000) % 60;
      app.innerHTML = `${head('🛒 メスショップ', '#')}
        <div class="card center"><b>本日の品ぞろえ</b><p class="small" style="margin:4px 0">先着順！ 売り切れたら終わり。1 人 1 日 1 体まで · 次の入れかえは 7:00 (あと ${hh}時間${mm}分)</p>${s.bought ? '<p class="small" style="margin:0;color:#e67700;font-weight:800">✅ 今日はもう買いました</p>' : ''}</div>
        <div class="grid">${s.items.map((it) => { const m = { ...it.monster, id: 'shop' + it.id, score: 0, status: 'active' };
          return `<div class="mcard ${it.sold ? 'dim' : ''}" style="cursor:default"><span class="rk r-${esc(m.rank)}">${esc(m.rank)}</span><span class="sx f">♀</span>${MonArt.svg(m.look, m.type, { rank: m.rank })}
            <b>${esc(m.name)}</b><span class="meta">${typeTag(m.type)} · 技 ${m.skills.length} 個</span>
            <div class="small" style="margin:4px 0">HP ${m.hp} 攻 ${m.atk} 魔 ${m.mag} 防 ${m.def}</div>
            ${it.sold ? `<span class="st">${it.mine ? '✅ あなたが購入' : `売り切れ (${esc(it.buyer?.displayName || '')})`}</span>`
              : `<button class="btn gold sm block" data-buy="${it.id}" data-price="${it.price}" ${s.bought ? 'disabled' : ''}>🪙 ${Number(it.price).toLocaleString()} で買う</button>`}</div>`; }).join('')}</div>`;
      $$('[data-buy]').forEach((b) => b.onclick = async () => {
        if (!confirm(`${b.dataset.price} コインで買いますか？`)) return;
        b.disabled = true;
        try { const r = await api(`/mon/shop/${b.dataset.buy}/buy`, { method: 'POST' }); await refresh(); toast(`${r.monster.name} がなかまになった！`); nameNext = r.monster.id; location.hash = '#mon/' + r.monster.id; }
        catch (e) { toast(e.message, true); draw(); }
      });
    };
    await draw();
    const iv = setInterval(() => { if (location.hash.startsWith('#shop')) draw().catch(() => {}); }, 8000);
    cleanup = () => clearInterval(iv);
  }

  async function viewRanking() {
    const { top } = await api('/mon/ranking');
    app.innerHTML = `${head('🏆 市場価値ランキング', '#')}<div class="card">${top.length ? top.map((r) => `<a class="row" href="#mon/${esc(r.monster.id)}" style="color:inherit;text-decoration:none;border-top:1px solid var(--line);padding:6px 0">
      <b style="width:28px;text-align:center;font-size:18px">${r.rank}</b>${MonArt.svg(r.monster.look, r.monster.type, { rank: r.monster.rank }).replace('class="ma-svg', 'style="width:56px;height:56px" class="ma-svg')}
      <span style="flex:1;min-width:0"><b>${esc(r.monster.name)}</b> <span class="small muted">(${esc(r.monster.rank)}) ${esc(r.owner?.displayName || '')}</span><br><span class="small">対人 ${r.monster.pvpWins}勝${r.monster.pvpLosses}敗</span></span><span class="val">${Number(r.monster.score).toLocaleString()}</span></a>`).join('') : '<p class="empty">まだランキングはありません</p>'}</div>`;
  }
  function viewHelp() {
    const T = catalog.types, ids = Object.keys(T);
    app.innerHTML = `${head('📖 あそびかた', '#')}<div class="card small">
      <h2>🧬 配合と育成</h2><p>母 (繁殖入りしたメス) と父 (繁殖入りしたオスか種モン) を配合すると子が生まれます。子は父と母の<b>いちばん強い技</b>をそれぞれ <b>${Math.round(catalog.rules.inheritRate * 100)}%</b> の確率で受けつぎ、見た目は両親をまぜた姿になります。母は生涯 ${catalog.rules.maxChildren} 体まで産めます。</p>
      <p>生まれた子は <b>${catalog.rules.trainTurns} ターン</b> 育成します。毎ターン「👊 直殴り」か「🔮 魔法」をえらんで能力を上げ、ときどき新しい技を覚えます。</p>
      <p>モンスターは何回でも戦えますが、<b>繁殖入りするともう戦えません</b>。市場価値 ${catalog.rules.studScore} 以上のオスは<b>種モン</b>になって、ほかの人のメスと配合できます (種付け料をもらえる)。</p>
      <h2>⚔️ バトル</h2><p>コイントスで先攻を決めます。毎ラウンド <b>${catalog.rules.inputMs / 1000} 秒</b> で十字キーのコマンドを入力して「決定！」。先攻から技を出し、どちらかの HP がなくなったら終わりです。コマンドがまちがっていると不発になります。</p>
      <p>🛡️ <b>ぼうぎょ</b> (${arrows(guardSkill().cmd)}) はどのモンスターも使えます。相手が<b>同じラウンドの同じ回</b> (1 つ目どうし・2 つ目どうし…) に技を撃ってきたら、その技を<b>無効</b>にします。撃ってこなければ空振りです。</p>
      <p>直殴り (2〜4 キー) はモンスター自身の属性、魔法 (3〜8 キー)・大技 (10 キー前後) は技ごとの属性です。</p>
      <h2>💰 市場価値とセリ</h2><p>市場価値 (戦績スコア) は対人戦で上がります (勝ち +${catalog.rules.score.pvp.win}・負け +${catalog.rules.score.pvp.lose})。CPU 戦は 0.6 倍。メスが産んだ子は、<b>15 分ごと (毎時 5・20・35・50 分)</b>のセリに出品できます。コインはぶんぼうぐバトラーズと共通です。</p>
      <h2>🔥 相性 (攻撃 → 受ける側)</h2><div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;text-align:center"><tr><th></th>${ids.map((d) => `<th>${T[d].icon}</th>`).join('')}</tr>${ids.map((a) => `<tr><th>${T[a].icon}${T[a].name}</th>${ids.map((d) => { const v = catalog.typeTable[a][d]; return `<td style="padding:3px 6px;font-weight:800;color:${v > 1 ? '#e03131' : v < 1 ? '#1c7ed6' : 'var(--muted)'}">${v === 1 ? '-' : '×' + v}</td>`; }).join('')}</tr>`).join('')}</table></div>
      <p>強さ評価: C → B → A → S → SS → Z</p></div>`;
  }

  route();
})();
