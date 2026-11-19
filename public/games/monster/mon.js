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
  const STATUS = { training: '育成中', active: '戦える', breeding: '繁殖入り', listed: 'セリに出品中', auction: 'セリ中' };
  const KIND = { punch: '直殴り', magic: '魔法', ult: '大技' };
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
    ${art(m)}<b>${esc(m.name)}</b><span class="meta">${typeTag(m.type)} · 市場価値 <span class="val">${Number(m.score).toLocaleString()}</span></span>
    <div><span class="st ${esc(m.status)}">${m.status === 'training' ? `育成中 あと${m.trainLeft}` : m.isStud ? '種モン' : esc(STATUS[m.status] || m.status)}</span></div>${extra}</a>`;
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
      if (parts[0] === 'ranking') return viewRanking();
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
        app.innerHTML = `${head('🧬 ようこそ！', '')}<p class="shout">3 体のモンスターが生まれた！</p><div class="grid">${r.monsters.map((m) => mcard(m, { cls: 'reveal' })).join('')}</div><a class="btn primary block" href="#" style="margin-top:10px">はじめる</a>`;
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
        <a class="btn" href="#ranking">🏆 ランキング<small>市場価値</small></a>
        <a class="btn" href="#help">📖 あそびかた<small>ルールと相性</small></a>
      </div>
      <div class="card"><h2>🐾 わたしのモンスター <span class="small muted">${ms.length} 体</span></h2>
        ${ms.length ? `<div class="grid">${ms.map((m) => mcard(m)).join('')}</div>` : '<p class="empty">モンスターがいません。セリで手に入れよう</p>'}</div>`;
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
        ${art(m, 'big-art')}<p style="margin:4px 0"><b style="font-size:20px">${esc(m.name)}</b> <span class="sx ${m.sex === 'm' ? 'm' : 'f'}" style="position:static">${m.sex === 'm' ? '♂' : '♀'}</span> ${typeTag(m.type)} · 第${m.gen}世代</p>
        <p class="small" style="margin:0"><span class="st ${esc(m.status)}">${m.status === 'training' ? `育成中 あと${m.trainLeft}ターン` : m.isStud ? `種モン (種付け料 ${m.studFee} コイン)` : esc(STATUS[m.status])}</span> 市場価値 <span class="val">${Number(m.score).toLocaleString()}</span> · ${m.wins}勝${m.losses}敗 (対人 ${m.pvpWins}勝${m.pvpLosses}敗)${m.sex === 'f' ? ` · 産んだ子 ${m.children}/${catalog.rules.maxChildren}` : ''}</p>
        ${mine ? '' : `<p class="small muted">持ち主: ${esc(owner.displayName)}</p>`}</div>
      ${mine ? `<div class="card" id="acts"></div>` : ''}
      <div class="card"><h2>📊 能力</h2><div class="stats">${st('hp', 'HP', 500)}${st('atk', '攻撃', 150)}${st('mag', '魔力', 150)}${st('def', '防御', 150)}${st('spd', '素早さ', 150)}</div></div>
      <div class="card"><h2>🎮 技とコマンド <span class="small muted">${m.skills.length}/${catalog.rules.maxSkills}</span></h2>${m.skills.map((s) => skillRow(s, inh.has(s.id) ? '<span class="inh">受けついだ</span>' : '')).join('')}</div>
      <div class="card"><h2>🧬 血統</h2><div class="lin">${parent(m.father, '父')}${parent(m.mother, '母')}</div>
        ${(m.inherited || []).length ? `<p class="small">受けついだ技: ${(m.inherited).map((x) => `${esc(x.from)}の「${esc(m.skills.find((s) => s.id === x.skill)?.name || x.skill)}」`).join('・')}</p>` : ''}</div>`;
    if (!mine) return;
    const acts = $('#acts'), b = [];
    if (m.status === 'training') b.push(`<a class="btn gold block" href="#train/${m.id}">🏋️ 育成する (あと ${m.trainLeft} ターン)</a>`);
    if (m.status === 'active') b.push(`<a class="btn primary block" href="#fight?mon=${m.id}">⚔️ このモンスターで戦う</a>`);
    if (m.status === 'active') b.push(`<button class="btn block" id="retire">💞 繁殖入りさせる (もう戦えなくなります)</button>`);
    if (m.sex === 'm' && ['active', 'breeding'].includes(m.status) && !m.isStud) b.push(`<button class="btn block" id="stud" ${m.score < catalog.rules.studScore ? 'disabled' : ''}>🌟 種モンにする ${m.score < catalog.rules.studScore ? `(市場価値 ${catalog.rules.studScore} 以上で)` : '(ほかの人のメスと配合できる)'}</button>`);
    if (m.sex === 'f' && m.status === 'breeding') b.push(`<a class="btn gold block" href="#breed?mother=${m.id}">💞 配合する (あと ${catalog.rules.maxChildren - m.children} 体産める)</a>`);
    if (m.mother && ['training', 'active'].includes(m.status)) b.push(`<button class="btn block" id="list">🔨 セリに出す (次は ${esc(fmtTime(me.next))})</button>`);
    if (m.status === 'listed') b.push(`<button class="btn block" id="unlist">セリの出品をやめる (出品価格 ${m.listPrice} コイン)</button>`);
    b.push(`<button class="btn sm" id="rename">✏️ 名前を変える</button>`);
    acts.innerHTML = `<div style="display:grid;gap:8px">${b.join('')}</div>`;
    const act = async (path, body, msg) => { try { await api(`/mon/monster/${m.id}/${path}`, { method: 'POST', body }); toast(msg); route(); } catch (e) { toast(e.message, true); } };
    $('#retire', acts)?.addEventListener('click', () => { if (confirm(`${m.name} を繁殖入りさせますか？ 繁殖入りすると、もう戦えません。`)) act('retire', {}, '繁殖入りしました'); });
    $('#stud', acts)?.addEventListener('click', () => { const fee = prompt('種付け料 (コイン) を決めてください', '100'); if (fee !== null) act('stud', { fee: Number(fee) }, '種モンになりました'); });
    $('#list', acts)?.addEventListener('click', () => { const price = prompt('スタート価格 (コイン)', '50'); if (price !== null) act('list', { price: Number(price) }, `次のセリ (${fmtTime(me.next)}) に出品しました`); });
    $('#unlist', acts)?.addEventListener('click', () => act('unlist', {}, '出品をやめました'));
    $('#rename', acts)?.addEventListener('click', () => { const name = prompt('新しい名前 (12 文字まで)', m.name); if (name) act('rename', { name }, '名前を変えました'); });
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
          ${fathers.length ? `<div class="grid">${fathers.map((m) => mcard(m, { href: '', cls: m.id === fa ? 'sel' : '', extra: `<span class="small">${m.own ? '自分のオス' : `${m.official ? '🏛️ 公式' : esc(m.owner?.displayName || '')} · 種付け料 ${m.fee}🪙`}</span>` }).replace('class="mcard', 'data-pick="fa" class="mcard')).join('')}</div>` : '<p class="empty">父になれるオスがいません</p>'}</div>
        ${M && F ? `<div class="card"><h2>🧬 この組み合わせだと…</h2>
          <p class="small">父「${esc(F.name)}」のいちばん強い技 <b>${esc(best(F)?.name || '-')}</b> と、母「${esc(M.name)}」のいちばん強い技 <b>${esc(best(M)?.name || '-')}</b> を、それぞれ <b>${Math.round(catalog.rules.inheritRate * 100)}%</b> の確率で受けつぎます。属性は ${typeTag(F.type)} か ${typeTag(M.type)}。見た目は両親をまぜた子になります。</p>
          <button class="btn gold block" id="go" style="font-size:18px">💞 配合する！${F.fee ? ` (種付け料 ${F.fee} コイン)` : ''}</button></div>` : ''}`;
      $$('[data-pick]').forEach((el) => el.onclick = (e) => { e.preventDefault(); if (el.dataset.pick === 'mo') mo = el.dataset.id; else fa = el.dataset.id; draw(); });
      $('#go')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const r = await api('/mon/breed', { method: 'POST', body: { mother: mo, father: fa } });
          await refresh(); hatch(r.child, F, M);
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      });
    };
    draw();
  }
  function hatch(c, F, M) {
    app.innerHTML = `${head('💞 配合', '#')}<div class="card center"><div class="lin" style="margin-bottom:8px">${mcard(F, { href: '' })}${mcard(M, { href: '' })}</div><span class="egg">🥚</span><p class="shout">タマゴが…！？</p></div>`;
    setTimeout(() => {
      app.innerHTML = `${head('💞 配合', '#')}<div class="card center"><p class="shout">🎉 ${esc(c.name)} が生まれた！</p>
        <div class="reveal">${art(c, 'big-art')}</div><p><span class="rk r-${esc(c.rank)}" style="position:static;padding:2px 10px">${esc(c.rank)}</span> ${c.sex === 'm' ? '♂ オス' : '♀ メス'} · ${typeTag(c.type)} · 第${c.gen}世代</p>
        <p>${(c.inherited || []).length ? (c.inherited).map((x) => `<span class="inh" style="font-size:13px">${esc(x.from)}から「${esc(c.skills.find((s) => s.id === x.skill)?.name || '')}」</span>`).join(' ') : '<span class="small muted">今回は親の技を受けつげなかった…</span>'}</p>
        <a class="btn gold block" href="#train/${c.id}">🏋️ 育成する (10 ターン)</a><a class="btn block" href="#mon/${c.id}" style="margin-top:8px">くわしく見る</a></div>`;
    }, 2000);
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

  // ---------- バトル ----------
  function viewBattle(params) {
    const mode = params.get('mode'), monId = params.get('mon'), code = params.get('code'), comment = params.get('comment') || '';
    app.innerHTML = `${head('⚔️ バトル', '#fight')}<div class="bt" id="bt"><div class="ovl"><div class="toss"><p style="animation:none">${mode === 'random' ? '対戦相手をさがしています…' : mode === 'board' ? '📋 掲示板で対戦相手を募集中…' : 'じゅんび中…'}</p><span id="wcode"></span><button class="btn sm" id="cancel" style="pointer-events:auto">やめる</button></div></div></div>`;
    const bt = $('#bt');
    let ws = null, you = 0, st = null, keys = '', queued = [], closed = false, oppN = 0, deadline = 0, timer = 0, players = [], log = [], ended = false, busy = false;
    const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    $('#cancel').onclick = () => { wsSend({ t: 'cancel' }); location.hash = '#fight'; };
    const mySkills = () => st.mons[you].skills;
    const hpBar = (f) => `<div class="hp"><i style="width:${Math.max(0, (f.hp / f.maxHp) * 100)}%" class="${f.hp / f.maxHp < 0.3 ? 'low' : ''}"></i></div><span class="small">${f.hp}/${f.maxHp}</span>`;
    const side = (f, foe) => `<div class="bt-side ${foe ? 'foe' : 'me'}" id="${foe ? 'sfoe' : 'sme'}">${MonArt.svg(f.look, f.type, { rank: f.rank })}<div class="bt-info"><b>${esc(f.name)}</b>
      <span class="small">${esc(players[foe ? 1 - you : you]?.displayName || '')} · ${typeTag(f.type)} · <span class="rk r-${esc(f.rank)}" style="position:static;padding:0 5px">${esc(f.rank)}</span></span>${hpBar(f)}</div></div>`;
    function render(phase) {
      if (!$('#bt')) return;
      const me2 = st.mons[you], foe = st.mons[1 - you];
      const match = mySkills().find((s) => s.cmd === keys);
      bt.innerHTML = `${side(foe, true)}
        <div class="bt-log">${log.slice(-2).map((l) => `<div>${esc(l)}</div>`).join('') || `ラウンド ${st.round + 1} · ${st.first === you ? 'あなたが先攻' : '相手が先攻'}`}</div>
        ${phase === 'input' ? `<p class="prompt">${closed ? '時間切れ！ 技を出すよ' : queued.length ? `続けて打てる！ (${queued.length} 個確定)` : 'コマンドを打って技を入力！'}${oppN ? `<small style="display:block;font-size:11px;opacity:.8">相手は ${oppN} 個確定</small>` : ''}</p><div class="timer"><i id="tbar" style="width:100%"></i></div>
          ${queued.length ? `<div class="queue">${queued.map((q, i) => { const s = mySkills().find((x) => x.cmd === q); return `<span class="${s ? 'ok' : 'ng'}">${i + 1}. ${s ? esc(s.name) : '不発'}</span>`; }).join('')}</div>` : ''}
          <div class="bt-mid"><div><div class="slots ${match ? 'match' : ''}" id="slots">${[...keys].map((k) => `<span>${ARROW[k]}</span>`).join('') || '<small style="opacity:.6">↑↓←→ を押してコマンドを入力</small>'}</div>
            ${match ? `<p style="margin:4px 0;font-weight:900;color:#ffe066">✨ ${esc(match.name)}！</p>` : ''}
            <div class="pad"><span class="c"></span><button data-k="U">↑</button><span class="c"></span><button data-k="L">←</button><button class="c" data-k="X" style="font-size:16px;background:rgba(255,255,255,.2);color:#fff;box-shadow:none" ${closed ? 'disabled' : ''}>消す</button><button data-k="R">→</button><span class="c"></span><button data-k="D">↓</button><span class="c"></span></div>
            <button class="btn gold block" id="ok" ${closed || !keys ? 'disabled' : ''} style="font-size:20px">決定！</button></div>
            <div class="cmdlist"><b style="font-size:12px">コマンド一覧</b>${mySkills().map((s) => `<div class="${s.cmd === keys ? 'hit' : s.cmd.startsWith(keys) && keys ? 'hit' : ''}"><b>${esc(s.name)}</b><span class="cmd">${arrows(s.cmd)}</span></div>`).join('')}</div></div>`
          : `<div style="min-height:300px"></div>`}
        ${side(me2, false)}
        ${ended ? '' : '<button class="btn sm" id="sur" style="margin-top:8px;background:rgba(255,255,255,.15);color:#fff">こうさん</button>'}`;
      $$('[data-k]', bt).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
      $('#ok', bt)?.addEventListener('click', submit);
      $('#sur', bt)?.addEventListener('click', () => { if (confirm('こうさんしますか？')) wsSend({ t: 'surrender' }); });
    }
    function press(k) {
      if (closed || ended || !st) return;
      if (k === 'X') keys = keys.slice(0, -1); else if (keys.length < 14) keys += k;
      const before = mySkills().find((s) => s.cmd === keys);
      render('input');
      keyFx(k, before);
      if (before && k !== 'X') cutin(before, true);
    }
    // キーを押すたびのエフェクト: ボタンから光の輪・入力枠に火花と矢印が飛びこむ・どの技に近づいているか・合わなくなったらゆれる
    const KEY_COL = { U: '#ffe066', D: '#74c0fc', L: '#ff8787', R: '#8ce99a', X: '#ced4da' };
    function keyFx(k, matched) {
      const box = bt.getBoundingClientRect();
      const btn = $(`[data-k="${k}"]`, bt), slots = $('#slots', bt);
      if (!btn || !slots) return;
      const br = btn.getBoundingClientRect(), sr = slots.getBoundingClientRect(), col = KEY_COL[k];
      const at = (r) => ({ x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 });
      const from = at(br), last = slots.lastElementChild?.getBoundingClientRect?.() ? at(slots.lastElementChild.getBoundingClientRect()) : at(sr);
      const fx = (cls, x, y, css = '', html = '', ms = 700) => { const e = document.createElement('i'); e.className = 'kfx ' + cls; e.style.cssText = `left:${x}px;top:${y}px;--c:${col};${css}`; e.innerHTML = html; bt.append(e); setTimeout(() => e.remove(), ms); return e; };
      fx('ring', from.x, from.y);                                   // ボタンから光の輪
      btn.classList.add('kpress');
      if (k === 'X') return;
      fx('fly', from.x, from.y, `--dx:${last.x - from.x}px;--dy:${last.y - from.y}px`, ARROW[k], 420); // 矢印が入力枠へ飛ぶ
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4, d = 22 + Math.random() * 18; fx('spark', last.x, last.y, `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:.32s`, '', 900); }
      const near = mySkills().filter((s) => s.cmd.startsWith(keys) && s.cmd !== keys).sort((a, b) => a.cmd.length - b.cmd.length)[0];
      if (matched) { slots.classList.add('kmatch'); fx('burst', last.x, last.y, 'animation-delay:.3s', '', 900); }
      else if (near) { const h = document.createElement('div'); h.className = 'knear'; h.innerHTML = `→ <b>${esc(near.name)}</b> まで あと ${near.cmd.length - keys.length} キー`; slots.after(h); }
      else { slots.classList.add('kmiss'); const h = document.createElement('div'); h.className = 'knear miss'; h.textContent = 'この並びの技はありません (消すで直せます)'; slots.after(h); }
    }
    // 決定: 確定した技は順番にならび、時間があるあいだは続けて何個でも打てる
    function submit() { if (closed || ended || !keys) return; wsSend({ t: 'cmd', keys }); queued.push(keys); keys = ''; render('input'); }
    const onKey = (e) => { const k = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', Backspace: 'X' }[e.key]; if (k) { e.preventDefault(); press(k); } else if (e.key === 'Enter') submit(); };
    document.addEventListener('keydown', onKey);
    function cutin(s, preview = false, who = you) {
      const col = s.kind === 'punch' ? (st.mons[who].type) : s.type;
      const el = document.createElement('div'); el.className = 'ci' + (s.kind === 'ult' ? ' ult' : '');
      el.style.background = `linear-gradient(90deg,transparent,var(--${col}) 15%,var(--${col}) 85%,transparent)`;
      el.innerHTML = `<small>${preview ? 'コマンド認識！' : who === you ? 'あなたの' : '相手の'}${esc(KIND[s.kind])}</small><b>${esc(s.name)}</b>`;
      bt.append(el); setTimeout(() => el.remove(), 1600);
      if (s.kind === 'ult' && !preview) { const f = document.createElement('div'); f.className = 'flashb'; bt.append(f); setTimeout(() => f.remove(), 600); }
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
          st = m.state; keys = ''; queued = Array.isArray(m.queued) ? m.queued.slice() : []; closed = false; oppN = 0; deadline = Date.now() + (m.deadline - Date.now());
          render('input'); clearInterval(timer);
          timer = setInterval(() => { const b = $('#tbar'); if (!b) return; const left = Math.max(0, deadline - Date.now()); b.style.width = (left / m.ms) * 100 + '%';
            if (left <= 0) { clearInterval(timer); if (keys && mySkills().some((s) => s.cmd === keys)) submit(); closed = true; render('input'); } }, 100);
          return;
        }
        if (m.t === 'opponentReady') { oppN = m.n || oppN + 1; if (!closed) render('input'); return; }
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
          cutin(s, false, e.p);
          await wait(900);
          const tgt = e.p === you ? '#sfoe' : '#sme';
          const el = $(tgt, bt); el?.classList.add('shake');
          const d = document.createElement('div'); d.className = 'dmg'; d.textContent = `-${e.dmg}${e.eff === 'good' ? ' 効果ばつぐん！' : e.eff === 'bad' ? ' いまひとつ' : ''}`;
          d.style.top = e.p === you ? '60px' : 'auto'; d.style.bottom = e.p === you ? 'auto' : '70px'; d.style.left = '20px'; bt.append(d); setTimeout(() => d.remove(), 1100);
          prev.mons[1 - e.p].hp = e.hp;
          const side2 = $(tgt + ' .hp i', bt); if (side2) side2.style.width = Math.max(0, (e.hp / prev.mons[1 - e.p].maxHp) * 100) + '%';
          log.push(`${e.p === you ? 'あなた' : '相手'}の「${e.name}」！ ${e.dmg} ダメージ${e.eff === 'good' ? ' (効果ばつぐん)' : ''}`);
          await wait(800);
        } else if (e.k === 'miss') {
          const el = document.createElement('div'); el.className = 'ci'; el.style.background = 'linear-gradient(90deg,transparent,#495057 20%,#495057 80%,transparent)';
          el.innerHTML = `<small>${e.p === you ? 'あなた' : '相手'}</small><b>${e.empty ? '入力なし…' : '不発…'}</b>`; bt.append(el); setTimeout(() => el.remove(), 1600);
          log.push(`${e.p === you ? 'あなた' : '相手'}の技は${e.empty ? '入力されなかった' : '不発だった'}`); await wait(1000);
        } else if (e.k === 'ko') { log.push(`${e.p === you ? 'あなた' : '相手'}のモンスターはたおれた！`); }
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
        <p class="small" style="margin:4px 0 0">技: ${m.skills.map((s) => esc(s.name)).join('・')}</p></div>`;
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
        root.innerHTML = `<div class="card center"><b>次のセリ</b><div class="auc-time">${esc(fmtTime(state.next))} から (あと ${mm}分${String(ss).padStart(2, '0')}秒)</div><p class="small muted">毎時 5 分に開催。メスが産んだモンスターを出品できます (モンスターの画面の「セリに出す」から)</p></div>
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
      <p>直殴り (2〜4 キー) はモンスター自身の属性、魔法 (3〜8 キー)・大技 (10 キー前後) は技ごとの属性です。</p>
      <h2>💰 市場価値とセリ</h2><p>市場価値 (戦績スコア) は対人戦で上がります (勝ち +${catalog.rules.score.pvp.win}・負け +${catalog.rules.score.pvp.lose})。CPU 戦は 0.6 倍。メスが産んだ子は、<b>毎時 5 分</b>のセリに出品できます。コインはぶんぼうぐバトラーズと共通です。</p>
      <h2>🔥 相性 (攻撃 → 受ける側)</h2><div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;text-align:center"><tr><th></th>${ids.map((d) => `<th>${T[d].icon}</th>`).join('')}</tr>${ids.map((a) => `<tr><th>${T[a].icon}${T[a].name}</th>${ids.map((d) => { const v = catalog.typeTable[a][d]; return `<td style="padding:3px 6px;font-weight:800;color:${v > 1 ? '#e03131' : v < 1 ? '#1c7ed6' : 'var(--muted)'}">${v === 1 ? '-' : '×' + v}</td>`; }).join('')}</tr>`).join('')}</table></div>
      <p>強さ評価: C → B → A → S → SS → Z</p></div>`;
  }

  route();
})();
