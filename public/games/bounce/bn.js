// =====================================================================
// PROJECT BOUNCE: 画面 (ホーム・クエスト・マルチ・ガチャ・キャラ・育成・ミッション・フレンド・図鑑・戦績・お知らせ・ショップ・戦闘)
//   戦闘の計算はサーバー (bn-core.js をサーバーで動かす)。ここでは結果を再生して見せるだけ
// =====================================================================
(() => {
  const D = BNData, A = BNArt, CORE = BNCore;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');
  const app = $('#app'), inFrame = window.parent !== window;
  let me = null, ws = null, room = null, battle = null, wsQueue = [];

  function toast(msg, ng) { const t = document.createElement('div'); t.className = 'toast' + (ng ? ' ng' : ''); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600); }
  async function api(path, { method = 'GET', body } = {}) {
    const r = await fetch('/api/bn' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { if (inFrame) parent.postMessage({ source: 'ippo-bounce', type: 'login' }, location.origin); throw new Error('ログインしてください'); }
    if (!r.ok) throw new Error(d.error || 'エラーが起きました');
    return d;
  }
  const apply = (d) => { if (d && d.player) { me = { ...me, ...d }; head(); } return d; };
  function head() { if (!me) return; $('#h-st').textContent = `⚡ ${me.player.stamina.now}/${me.player.stamina.max}`; $('#h-gem').textContent = `💎 ${fmt(me.player.gems)}`; }
  $('#exit').addEventListener('click', () => { if (battle) return toast('戦闘中は閉じられません。ルームを抜けるときは「あきらめる」から'); if (inFrame) parent.postMessage({ source: 'ippo-bounce', type: 'exit' }, location.origin); else location.href = '/#/games'; });

  const unitTile = (charId, { level, cls = '', attrs = '' } = {}) => { const c = D.CHAR[charId]; return `<span class="unit ${cls}" style="--rc:${D.RARITY_COLOR[c.rarity]}" ${attrs}>${A.svg(charId)}<span class="rar">${c.rarity}</span><span class="at">${D.ATTRS[c.attr].icon}</span>${level ? `<span class="lv">Lv${level}</span>` : ''}</span>`; };
  const rewardText = (r) => [r.gems ? `💎${fmt(r.gems)}` : '', r.coins ? `🪙${fmt(r.coins)}` : '', ...Object.entries(r.items || {}).map(([k, n]) => `${D.MATERIALS[k]?.icon || ''}${esc(D.MATERIALS[k]?.name || k)}×${n}`)].filter(Boolean).join(' ');

  // ---------- 画面の切りかえ ----------
  const routes = { home: viewHome, quests: viewQuests, lobby: viewLobby, gacha: viewGacha, units: viewUnits, unit: viewUnit, party: viewParty, missions: viewMissions, friends: viewFriends, zukan: viewZukan, records: viewRecords, news: viewNews, shop: viewShop, profile: viewProfile, items: viewItems, history: viewHistory, admin: viewAdmin };
  async function route() {
    if (battle) return;
    const [name, arg] = (location.hash.slice(1) || 'home').split('/');
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.n === name || (name === 'unit' && a.dataset.n === 'units')));
    window.scrollTo(0, 0);
    try { await (routes[name] || viewHome)(decodeURIComponent(arg || '')); } catch (e) { app.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);

  // ---------- ホーム ----------
  async function viewHome() {
    const p = me.player, b = me.banners[0];
    app.innerHTML = `
      ${me.loginBonus ? `<div class="card" style="border-color:rgba(255,212,59,.5)">🎁 ログインボーナス ${me.loginBonus.day} 日目: <b>${rewardText(me.loginBonus.reward)}</b></div>` : ''}
      <section class="card"><div class="row"><div style="flex:1"><div class="sub">プレイヤー</div><b style="font-size:17px">${esc(me.me.displayName)}</b> <span class="sub">@${esc(me.me.username)}</span></div><div style="text-align:right"><div class="sub">ランク</div><b style="font-size:22px;color:var(--gold)">${p.rank}</b></div></div>
        <div class="bar" style="margin:8px 0 6px"><i style="width:${Math.round(p.rankExp / p.rankNext * 100)}%"></i></div>
        <div class="row" style="flex-wrap:wrap"><span class="pill">💎 ${fmt(p.gems)}</span><span class="pill">🪙 ${fmt(p.coins)}</span><span class="pill">⚡ ${p.stamina.now}/${p.stamina.max}${p.stamina.nextMs ? ` · あと${Math.ceil(p.stamina.nextMs / 60000)}分で+1` : ''}</span></div></section>
      <a class="hero" href="#gacha" style="background:radial-gradient(circle at 75% 40%,#5b3fd1,#140a3a 60%)"><div class="art">${A.svg(b.pickup)}</div><div class="txt"><span class="tag">期間限定 · 初回限定 UR</span><h3>${esc(b.name)}</h3><div class="sub" style="color:#e9e4ff">${esc(b.text)}</div></div></a>
      <div class="grid3" style="margin-top:12px">
        <a class="tile" href="#quests"><b>⚔️</b>クエスト<small>5 つのモード</small></a><a class="tile" href="#lobby"><b>👥</b>マルチ<small>最大 4 人で協力</small></a><a class="tile" href="#gacha"><b>✨</b>ガチャ<small>単発・10 連</small></a>
        <a class="tile" href="#units"><b>🃏</b>キャラ<small>育成・編成</small></a><a class="tile" href="#shop"><b>🛒</b>ショップ</a><a class="tile" href="#missions"><b>🎯</b>ミッション<small>${missionReady()} 件 受け取れる</small></a>
        <a class="tile" href="#friends"><b>🤝</b>フレンド</a><a class="tile" href="#zukan"><b>📖</b>図鑑<small>${me.zukan.filter((z) => z.owned).length}/${me.zukan.length}</small></a><a class="tile" href="#records"><b>📊</b>戦績</a>
        <a class="tile" href="#items"><b>🎒</b>素材</a><a class="tile" href="#news"><b>📢</b>お知らせ</a><a class="tile" href="#profile/${encodeURIComponent(me.me.username)}"><b>👤</b>プロフィール</a>
      </div>
      ${me.admin ? '<a class="btn block" href="#admin" style="margin-top:12px">🛠️ 排出率の設定 (管理者)</a>' : ''}`;
    me.loginBonus = null;
  }
  const missionReady = () => ['daily', 'weekly', 'achievements'].reduce((n, k) => n + me.missions[k].filter((m) => m.progress >= m.goal && !m.claimed).length, 0);

  // ---------- クエスト ----------
  let questMode = 'story';
  function viewQuests() {
    app.innerHTML = `<h2>⚔️ クエスト</h2><div class="tabs">${Object.entries(D.MODES).map(([k, v]) => `<button data-m="${k}" class="${k === questMode ? 'on' : ''}">${v}</button>`).join('')}</div><div id="ql"></div>`;
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => { questMode = b.dataset.m; viewQuests(); }));
    $('#ql').innerHTML = D.STAGES.filter((s) => s.mode === questMode).map((s) => { const c = me.clears[s.id]; return `<section class="card"><div class="row"><div style="flex:1"><h3>${esc(s.name)}</h3><div class="sub">難しさ ${'★'.repeat(Math.min(10, s.diff))} · ⚡${s.stamina} · ${s.waves.length} バトル${s.g?.length ? ` · ギミック: ${[...new Set(s.g.map((g) => D.GIMMICK_TYPES[g.type]))].join('・')}` : ''}</div>
      <div class="sub">報酬: ${rewardText(s.reward)} ${s.drops?.length ? `· ドロップ: ${s.drops.map(([k]) => esc(D.MATERIALS[k].name)).join('・')}` : ''}</div>${c ? `<div class="sub" style="color:var(--ok)">✔ クリア ${c.clears} 回${c.best ? ` · 最短 ${c.best} ターン` : ''}</div>` : '<div class="sub" style="color:var(--gold)">はじめてのクリアで 💎30</div>'}</div></div>
      <div class="grid2" style="margin-top:10px"><button class="btn gold" data-solo="${s.id}">ソロで出発</button><button class="btn" data-multi="${s.id}">マルチで募集</button></div></section>`; }).join('');
    $$('[data-solo]').forEach((b) => b.addEventListener('click', () => { if (me.player.stamina.now < D.STAGES.find((s) => s.id === b.dataset.solo).stamina) return toast('スタミナが足りません (ショップで回復できます)', true); wsSend({ t: 'solo', stage: b.dataset.solo }); }));
    $$('[data-multi]').forEach((b) => b.addEventListener('click', () => { lobbyStage = b.dataset.multi; location.hash = '#lobby'; }));
  }

  // ---------- マルチ (ロビー) ----------
  let lobbyStage = 's1-1';
  function viewLobby() {
    if (room && !room.solo) return renderRoom();
    app.innerHTML = `<h2>👥 マルチプレイ</h2>
      <section class="card"><h3>クエストをえらぶ</h3><select class="input" id="lb-stage">${D.STAGES.map((s) => `<option value="${s.id}" ${s.id === lobbyStage ? 'selected' : ''}>${esc(D.MODES[s.mode])} · ${esc(s.name)} (⚡${s.stamina})</option>`).join('')}</select>
        <div class="grid2" style="margin-top:10px"><button class="btn gold" id="lb-random">🎲 ランダムマッチ</button><button class="btn" id="lb-create">🏠 ルームを作る</button></div>
        <input class="input" id="lb-pass" placeholder="パスワード (なくても OK・最大 20 文字)" maxlength="20" style="margin-top:10px"></section>
      <section class="card"><h3>ルーム ID で参加</h3><div class="row"><input class="input" id="lb-id" inputmode="numeric" maxlength="6" placeholder="6 けたの ID"><input class="input" id="lb-jpass" placeholder="パスワード" maxlength="20"></div><button class="btn block" id="lb-join" style="margin-top:10px">参加する</button></section>
      <p class="sub">マルチでは、ひとり 1 体 (編成のリーダー。ルームの中で変えられる) を担当します。順番に弾いて、全員で同じ敵と戦います。</p>`;
    $('#lb-stage').addEventListener('change', (e) => { lobbyStage = e.target.value; });
    $('#lb-random').addEventListener('click', () => wsSend({ t: 'random', stage: lobbyStage }));
    $('#lb-create').addEventListener('click', () => wsSend({ t: 'create', stage: lobbyStage, password: $('#lb-pass').value.trim() }));
    $('#lb-join').addEventListener('click', () => wsSend({ t: 'join', id: $('#lb-id').value.trim(), password: $('#lb-jpass').value }));
  }
  let friendCache = null;
  async function renderRoom() {
    if (!room || location.hash.slice(1) !== 'lobby') return;
    const mine = room.members.find((m) => m.username === me.me.username), host = room.host === mine?.uid, st = D.STAGES.find((s) => s.id === room.stage);
    app.innerHTML = `<h2>👥 ルーム <span style="color:var(--gold)">${esc(room.id)}</span> ${room.locked ? '🔒' : ''}</h2>
      <section class="card"><div class="row"><div style="flex:1"><b>${esc(st.name)}</b><div class="sub">⚡${st.stamina} · ${room.isPublic ? 'ランダムマッチで公開中' : '招待・ID のみ'}</div></div><button class="btn" id="rm-copy">ID をコピー</button></div>
        ${host ? `<select class="input" id="rm-stage" style="margin-top:8px">${D.STAGES.map((s) => `<option value="${s.id}" ${s.id === room.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}</section>
      <section class="card"><h3>参加者 (${room.members.length}/4)</h3><div class="grid4">${[0, 1, 2, 3].map((i) => { const m = room.members[i]; return m ? `<div style="text-align:center">${m.unit ? unitTile(m.unit.char, { level: m.unit.level }) : ''}<div style="font-size:11px;font-weight:800;margin-top:4px">${room.host === m.uid ? '👑' : ''}${esc(m.name)}</div><div class="sub">${!m.connected ? '📡 切断' : room.host === m.uid ? 'ホスト' : m.ready ? '✅ 準備OK' : '… 準備中'}</div></div>` : '<div class="unit" style="--rc:#333;display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:12px">あき</div>'; }).join('')}</div></section>
      <section class="card"><h3>担当キャラ</h3><div class="grid4" id="rm-units">${me.units.map((u) => unitTile(u.char, { level: u.level, cls: mine?.unit?.char === u.char ? 'sel' : '', attrs: `data-u="${u.id}" role="button"` })).join('')}</div></section>
      <div class="grid2">${host ? `<button class="btn gold" id="rm-start" ${room.members.some((m) => m.uid !== room.host && !m.ready) ? 'disabled' : ''}>🚀 出発する</button>` : `<button class="btn ${mine?.ready ? '' : 'gold'}" id="rm-ready">${mine?.ready ? '準備を取り消す' : '✅ 準備OK'}</button>`}<button class="btn" id="rm-leave">ルームを出る</button></div>
      <section class="card" style="margin-top:12px"><h3>🤝 フレンドを招待</h3><div id="rm-friends" class="list"><div class="sub">読みこみ中…</div></div></section>`;
    $('#rm-copy').addEventListener('click', () => { navigator.clipboard?.writeText(room.id); toast('ルーム ID をコピーしました'); });
    $('#rm-stage')?.addEventListener('change', (e) => wsSend({ t: 'stage', stage: e.target.value }));
    $$('#rm-units [data-u]').forEach((el) => el.addEventListener('click', () => wsSend({ t: 'unit', id: Number(el.dataset.u) })));
    $('#rm-start')?.addEventListener('click', () => wsSend({ t: 'start' }));
    $('#rm-ready')?.addEventListener('click', () => wsSend({ t: 'ready', on: !mine?.ready }));
    $('#rm-leave').addEventListener('click', () => { wsSend({ t: 'leave' }); room = null; viewLobby(); });
    try { friendCache = friendCache || (await api('/friends')).friends; } catch { friendCache = []; }
    const fl = $('#rm-friends'); if (!fl) return;
    fl.innerHTML = friendCache.length ? friendCache.map((f) => `<div>${f.leader ? `<span style="width:40px">${unitTile(f.leader.char)}</span>` : ''}<div style="flex:1"><b>${esc(f.name)}</b><div class="sub">@${esc(f.username)} · ランク ${f.rank} ${f.online ? '· 🟢 オンライン' : ''}</div></div><button class="btn" data-inv="${esc(f.username)}">招待</button></div>`).join('')
      : '<div class="sub">IppO で相互フォローの人が PROJECT BOUNCE を始めると、ここから招待できます</div>';
    $$('[data-inv]').forEach((b) => b.addEventListener('click', () => { wsSend({ t: 'invite', username: b.dataset.inv }); b.disabled = true; }));
  }

  // ---------- ガチャ ----------
  let gbanner = 0;
  function viewGacha() {
    const b = me.banners[gbanner], pity = me.player.pity[b.id]?.n || 0;
    app.innerHTML = `<h2>✨ ガチャ</h2><div class="tabs">${me.banners.map((x, i) => `<button data-b="${i}" class="${i === gbanner ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>
      <section class="hero" style="background:radial-gradient(circle at 70% 40%,${b.pickup ? '#5b3fd1' : '#1c7ed6'},#140a3a 65%);min-height:230px">${b.pickup ? `<div class="art">${A.svg(b.pickup)}</div>` : ''}<div class="txt"><span class="tag">${b.pickup ? '期間限定' : '常設'}</span><h3>${esc(b.name)}</h3><div class="sub" style="color:#e9e4ff">${esc(b.text)}</div>${b.pickup ? `<div class="sub" style="margin-top:8px;color:var(--gold)">天井まで あと ${D.GACHA.pity - pity} 回</div>` : ''}</div></section>
      <div class="grid2" style="margin:12px 0"><button class="btn" id="g1">単発 💎${D.GACHA.single}</button><button class="btn gold" id="g10">10 連 💎${D.GACHA.ten}<small style="font-weight:700">SR 以上 1 体確定</small></button></div>
      <section class="card"><h3>排出率</h3><div class="kv">${['UR', 'SSR', 'SR', 'R', 'N'].map((r) => `<b style="color:${D.RARITY_COLOR[r]}">${r}</b><span>${b.rates[r]}%${r === 'UR' && b.pickup ? ` (うちピックアップ ${esc(D.CHAR[b.pickup].name)} ${b.pickupRate}%)` : ''}</span>`).join('')}</div>
        <div class="sub" style="margin-top:8px">同じキャラが出たら限界突破 (最大 ${D.GROW.limitBreak.max})。最大のあとは星のかけら。${b.pickup ? `${D.GACHA.pity} 回目でピックアップ確定。` : ''}</div>
        <div class="sub" style="margin-top:6px">出るキャラ: ${D.CHARS.filter((c) => !c.limited || (b.limited || []).includes(c.id)).filter((c) => (b.rates[c.rarity] || 0) > 0).map((c) => `${esc(c.name)}(${c.rarity})`).join('・')}</div></section>
      <a class="btn block" href="#history">📜 ガチャの履歴</a>`;
    $$('[data-b]').forEach((x) => x.addEventListener('click', () => { gbanner = Number(x.dataset.b); viewGacha(); }));
    const go = async (n) => { try { const d = apply(await api('/gacha', { method: 'POST', body: { banner: b.id, n } })); await gachaFx(d.results); viewGacha(); } catch (e) { toast(e.message, true); } };
    $('#g1').addEventListener('click', () => go(1)); $('#g10').addEventListener('click', () => go(10));
  }
  // 引いたときの演出 (限定キャラは専用の登場演出)
  function gachaFx(results) {
    return new Promise((resolve) => {
      const best = ['UR', 'SSR', 'SR', 'R', 'N'].find((r) => results.some((x) => x.rarity === r));
      const fx = document.createElement('div'); fx.className = 'gfx'; document.body.append(fx);
      let i = 0, phase = 0;
      const col = (r) => D.RARITY_COLOR[r];
      const showOrb = () => { fx.className = 'gfx'; fx.innerHTML = `<div class="orb" style="--oc:${col(best)}"></div><div class="tp">タップで開く</div>`; };
      const reveal = () => {
        if (i >= results.length) return summary();
        const r = results[i++], c = D.CHAR[r.char];
        if (r.limited && c.id === 'limited_astraea_001') { // アストレア専用: 宇宙・星の魔法陣・流れ星・光の爆発 → 登場
          fx.className = 'gfx cosmos';
          fx.innerHTML = `<div class="circle"></div><div class="circle c2"></div>${Array.from({ length: 14 }, (_, k) => `<i class="shoot" style="left:${(k * 37) % 120}%;animation-delay:${(k % 7) * 0.18}s"></i>`).join('')}<div class="ttlx">初回限定 UR · 降臨</div>`;
          setTimeout(() => { if (!fx.isConnected) return; fx.insertAdjacentHTML('beforeend', `<div class="flash"></div><div class="reveal" style="--oc:#ffd43b">${A.svg(c.id)}</div><div class="nm" style="--oc:#ffd43b">${esc(c.title)}<br>${esc(c.name)}</div><div class="tp">${r.isNew ? 'NEW!' : dupText(r)} · タップでつづける</div>`); }, 1700);
        } else if (r.limited && c.id === 'yumiko') { // ユミコ: 雷が落ちて登場
          fx.className = 'gfx'; fx.style.background = 'radial-gradient(circle,#2b1450,#05030f 70%)';
          fx.innerHTML = `${[12, 38, 66, 88].map((x) => `<i class="bolt" style="left:${x}%"></i>`).join('')}<div class="ttlx">限定 UR</div>`;
          setTimeout(() => { if (!fx.isConnected) return; fx.insertAdjacentHTML('beforeend', `<div class="flash"></div><div class="reveal" style="--oc:#b197fc;width:min(92vw,520px)">${A.full(c.id)}</div><div class="nm" style="--oc:#b197fc">${esc(c.name)}</div><div class="tp">${r.isNew ? 'NEW!' : dupText(r)} · タップでつづける</div>`); }, 900);
        } else {
          fx.className = 'gfx'; fx.style.background = '';
          fx.innerHTML = `<div class="reveal" style="--oc:${col(r.rarity)}">${A.svg(c.id)}</div><div class="nm" style="--oc:${col(r.rarity)}"><span style="color:${col(r.rarity)}">${r.rarity}</span> ${esc(c.name)}</div><div class="tp">${r.isNew ? 'NEW!' : dupText(r)} · タップでつづける (${i}/${results.length})</div>`;
        }
      };
      const summary = () => { phase = 2; fx.className = 'gfx'; fx.style.background = ''; fx.innerHTML = `<div style="width:min(92vw,460px)"><h2 style="text-align:center">結果</h2><div class="grid4">${results.map((r) => unitTile(r.char)).join('')}</div><p class="sub" style="text-align:center">${results.filter((r) => r.isNew).length} 体が新しく仲間に</p><button class="btn gold block" id="gfx-ok">OK</button></div>`; $('#gfx-ok').addEventListener('click', () => { fx.remove(); resolve(); }); };
      showOrb();
      fx.addEventListener('click', (e) => { if (phase === 2) return; if (phase === 0) { phase = 1; reveal(); return; } if (e.target.id !== 'gfx-ok') reveal(); });
    });
  }
  const dupText = (r) => r.dup?.kind === 'lb' ? `限界突破 ${r.dup.lb}` : r.dup?.kind === 'shard' ? `星のかけら +${r.dup.n}` : '';
  async function viewHistory() { const d = await api('/gacha/history'); app.innerHTML = `<h2>📜 ガチャの履歴</h2><section class="card list">${d.history.map((h) => `<div><b style="color:${D.RARITY_COLOR[h.rarity]};width:38px">${h.rarity}</b><span style="flex:1">${esc(D.CHAR[h.char]?.name || h.char)}${h.dup ? ' <span class="sub">(重複)</span>' : ''}</span><span class="sub">${new Date(h.at).toLocaleString('ja-JP')}</span></div>`).join('') || '<div class="sub">まだ引いていません</div>'}</section>`; }

  // ---------- キャラ・育成・編成 ----------
  function viewUnits() {
    app.innerHTML = `<h2>🃏 キャラ (${me.units.length})</h2><a class="btn block gold" href="#party" style="margin-bottom:12px">🧩 編成 (ソロの 4 体・マルチのリーダー)</a>
      <div class="grid4">${me.units.slice().sort((a, b) => D.RARITIES.indexOf(D.CHAR[b.char].rarity) - D.RARITIES.indexOf(D.CHAR[a.char].rarity)).map((u) => `<a href="#unit/${u.id}">${unitTile(u.char, { level: u.level })}</a>`).join('')}</div>`;
  }
  function viewUnit(id) {
    const u = me.units.find((x) => String(x.id) === String(id)); if (!u) { location.hash = '#units'; return; }
    const c = D.CHAR[u.char], cb = D.COMBOS[c.combo], sp = D.SPECIALS[c.special], have = me.items;
    const evoCost = u.evo < D.GROW.evo.max ? D.evoCost(c, u.evo) : null, lbNeed = { N: 2, R: 4, SR: 10, SSR: 30, UR: 80 }[c.rarity];
    app.innerHTML = `<div class="detail-art" style="--rc:${D.RARITY_COLOR[c.rarity]}">${A.full(c.id)}</div>
      <section class="card" style="margin-top:12px"><div class="sub">${esc(c.title || '')}</div><h2 style="margin:2px 0 6px"><span style="color:${D.RARITY_COLOR[c.rarity]}">${c.rarity}</span> ${esc(c.name)} ${c.limited ? '<span class="pill" style="background:var(--goldg);color:#3b2200">限定</span>' : ''}</h2>
        <div class="kv"><b>属性</b><span>${D.ATTRS[c.attr].icon}${D.ATTRS[c.attr].name}</span><b>種族</b><span>${esc(c.race)} · ${esc(c.type)} · ${c.shot === 'pierce' ? '貫通' : '反射'}</span>
        <b>レベル</b><span>Lv ${u.level}/${u.maxLv} ${u.level < u.maxLv ? `<span class="sub">(次まで ${fmt(u.next - u.exp)})</span>` : ''}</span><b>HP</b><span>${fmt(u.hp)}</span><b>攻撃力</b><span>${fmt(u.atk)}</span><b>スピード</b><span>${u.spd}</span>
        <b>進化</b><span>${'★'.repeat(u.evo + 1)}${'☆'.repeat(D.GROW.evo.max - u.evo)}</span><b>限界突破</b><span>${u.lb}/${D.GROW.limitBreak.max}</span><b>スキル</b><span>Lv${u.skill + 1} (必殺技 ${u.spTurns} ターン)</span></div>
        <div class="skill"><b>連携コンボ「${esc(cb.name)}」</b><br>${comboDesc(cb)}<br><span class="sub">威力は攻撃力に比例 (いま ×${(u.atk / u.baseAtk).toFixed(2)})</span></div>
        <div class="skill"><b>必殺技「${esc(sp.name)}」</b> (${u.spTurns} ターン)<br>${esc(sp.desc)}</div>
        ${c.abilities.length ? `<div class="skill"><b>アビリティ</b><br>${c.abilities.map((a) => `・${esc(D.ABILITIES[a].name)}: ${esc(D.ABILITIES[a].desc)}`).join('<br>')}</div>` : ''}
        ${c.profile ? `<p class="sub" style="margin-top:10px">${esc(c.profile)}</p>` : ''}</section>
      <section class="card"><h3>育成</h3>
        <div class="grid2"><button class="btn" data-feed="exp_s" ${!(have.exp_s > 0) || u.level >= u.maxLv ? 'disabled' : ''}>📘 経験の書 (小) ×1<br><small>持っている ${have.exp_s || 0}</small></button><button class="btn" data-feed="exp_l" ${!(have.exp_l > 0) || u.level >= u.maxLv ? 'disabled' : ''}>📗 経験の書 (大) ×1<br><small>持っている ${have.exp_l || 0}</small></button></div>
        <div class="grid3" style="margin-top:10px"><button class="btn" id="u-evo" ${!evoCost ? 'disabled' : ''}>⭐ 進化<br><small>${evoCost ? Object.entries(evoCost).map(([k, n]) => `${esc(D.MATERIALS[k].name)}×${n} (${have[k] || 0})`).join('') : '最大'}</small></button>
          <button class="btn" id="u-skill" ${u.skill >= 5 ? 'disabled' : ''}>📜 スキル強化<br><small>スキルの書 (${have.skill_book || 0})</small></button><button class="btn" id="u-lb" ${u.lb >= D.GROW.limitBreak.max ? 'disabled' : ''}>💠 限界突破<br><small>星のかけら ${lbNeed} (${have.star_shard || 0})</small></button></div></section>`;
    const act = async (path, body) => { try { apply(await api(path, { method: 'POST', body })); viewUnit(id); toast('強化しました'); } catch (e) { toast(e.message, true); } };
    $$('[data-feed]').forEach((b) => b.addEventListener('click', () => act(`/unit/${u.id}/feed`, { item: b.dataset.feed, n: 1 })));
    $('#u-evo').addEventListener('click', () => act(`/unit/${u.id}/evolve`)); $('#u-skill').addEventListener('click', () => act(`/unit/${u.id}/skill`)); $('#u-lb').addEventListener('click', () => act(`/unit/${u.id}/limit`));
  }
  const comboDesc = (cb) => ({ laser: '横一直線のレーザー', explode: '味方のまわりで爆発', homing: `敵を追いかける弾 ${cb.shots} 発`, heal: `チームの HP を ${Math.round(cb.rate * 100)}% 回復`, barrier: '次に受けるダメージを減らすバリア', nova: '8 方向へのレーザー',
    orbital: `敵全体へ星光レーザー (威力 ${fmt(cb.power)} を敵の数で分ける・ボスに ×${cb.bossBonus}・${Math.round(cb.eclipseChance * 100)}% で星蝕)`, thunder: `天から雷を落とす (威力 ${fmt(cb.power)})` }[cb.kind] || '') + (cb.power && !['orbital', 'thunder'].includes(cb.kind) ? ` · 威力 ${fmt(cb.power)}` : '');
  function viewParty() {
    let sel = me.player.party.slice();
    const draw = () => {
      app.innerHTML = `<h2>🧩 編成</h2><p class="sub">ソロでは 4 体で戦います。1 体目はマルチのリーダー (担当キャラの初期値)。タップでえらぶ (最大 4)</p>
        <section class="card"><div class="grid4">${[0, 1, 2, 3].map((i) => { const u = me.units.find((x) => x.id === sel[i]); return u ? unitTile(u.char, { level: u.level }) : '<div class="unit" style="--rc:#333"></div>'; }).join('')}</div></section>
        <div class="grid4">${me.units.map((u) => unitTile(u.char, { level: u.level, cls: sel.includes(u.id) ? 'sel' : '', attrs: `data-u="${u.id}" role="button"` })).join('')}</div>
        <button class="btn gold block" id="p-save" style="margin-top:12px" ${sel.length ? '' : 'disabled'}>保存</button>`;
      $$('[data-u]').forEach((el) => el.addEventListener('click', () => { const id = Number(el.dataset.u); sel = sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 4 ? [...sel, id] : sel; draw(); }));
      $('#p-save').addEventListener('click', async () => { try { apply(await api('/party', { method: 'POST', body: { units: sel } })); toast('編成を保存しました'); location.hash = '#units'; } catch (e) { toast(e.message, true); } });
    };
    draw();
  }

  // ---------- ミッション・フレンド・図鑑・戦績・お知らせ・ショップ・素材・プロフィール ----------
  function viewMissions() {
    const sec = (title, list) => `<section class="card"><h3>${title}</h3><div class="list">${list.map((m) => `<div><div style="flex:1"><b>${esc(m.name)}</b><div class="sub">${m.progress}/${m.goal} · 報酬 ${rewardText(m.reward)}</div><div class="bar" style="margin-top:4px"><i style="width:${m.progress / m.goal * 100}%"></i></div></div>${m.claimed ? '<span class="sub">受け取りずみ</span>' : `<button class="btn ${m.progress >= m.goal ? 'gold' : ''}" data-k="${m.key}" ${m.progress >= m.goal ? '' : 'disabled'}>受け取る</button>`}</div>`).join('')}</div></section>`;
    app.innerHTML = `<h2>🎯 ミッション</h2>${sec('デイリー (毎日 0 時に更新)', me.missions.daily)}${sec('ウィークリー (毎週月曜)', me.missions.weekly)}${sec('🏆 実績', me.missions.achievements)}`;
    $$('[data-k]').forEach((b) => b.addEventListener('click', async () => { try { apply(await api('/claim', { method: 'POST', body: { key: b.dataset.k } })); toast('受け取りました'); viewMissions(); } catch (e) { toast(e.message, true); } }));
  }
  async function viewFriends() {
    const f = (await api('/friends')).friends; friendCache = f;
    app.innerHTML = `<h2>🤝 フレンド</h2><p class="sub">IppO で相互フォローの人がフレンドです。ルームから招待できます。</p><section class="card list">${f.map((x) => `<a href="#profile/${encodeURIComponent(x.username)}" style="text-decoration:none">${x.leader ? `<span style="width:44px">${unitTile(x.leader.char)}</span>` : ''}<div style="flex:1"><b>${esc(x.name)}</b><div class="sub">@${esc(x.username)} · ランク ${x.rank}${x.online ? ' · 🟢 オンライン' : ''}</div></div></a>`).join('') || '<div class="sub">まだいません</div>'}</section>`;
  }
  function viewZukan() {
    app.innerHTML = `<h2>📖 キャラクター図鑑</h2><p class="sub">${me.zukan.filter((z) => z.owned).length}/${me.zukan.length} 体</p><div class="grid4">${D.CHARS.map((c) => { const own = me.zukan.find((z) => z.id === c.id)?.owned, u = me.units.find((x) => x.char === c.id); return own ? `<a href="#unit/${u.id}">${unitTile(c.id)}</a>` : unitTile(c.id, { cls: 'locked' }); }).join('')}</div>`;
  }
  async function viewRecords() {
    const r = (await api('/records')).battles, s = me.player.stats;
    app.innerHTML = `<h2>📊 戦績</h2><section class="card"><div class="grid3" style="text-align:center"><div><b style="font-size:22px">${s.clear || 0}</b><div class="sub">クリア</div></div><div><b style="font-size:22px">${s.multi || 0}</b><div class="sub">マルチ勝利</div></div><div><b style="font-size:22px">${s.boss || 0}</b><div class="sub">ボス撃破</div></div><div><b style="font-size:22px">${s.combo || 0}</b><div class="sub">連携コンボ</div></div><div><b style="font-size:22px">${s.special || 0}</b><div class="sub">必殺技</div></div><div><b style="font-size:22px">${s.gacha || 0}</b><div class="sub">ガチャ</div></div></div></section>
      <section class="card list">${r.map((b) => `<div><span style="width:24px">${b.result === 'win' ? '🏆' : '💀'}</span><span style="flex:1">${esc(D.STAGES.find((s) => s.id === b.stage)?.name || b.stage)} ${b.multi ? '<span class="pill">マルチ</span>' : ''}</span><span class="sub">${b.turns} ターン</span></div>`).join('') || '<div class="sub">まだ戦っていません</div>'}</section>`;
  }
  function viewNews() { app.innerHTML = `<h2>📢 お知らせ</h2>${D.NEWS.map((n) => `<section class="card"><div class="sub">${esc(n.at)}</div><h3 style="margin-top:4px">${esc(n.title)}</h3><div style="font-size:13px">${esc(n.text)}</div></section>`).join('')}`; }
  function viewShop() {
    app.innerHTML = `<h2>🛒 ショップ</h2><section class="card list">${D.SHOP.map((s) => `<div><b style="font-size:24px;width:34px">${s.icon}</b><span style="flex:1"><b>${esc(s.name)}</b></span><button class="btn gold" data-s="${s.id}">${s.price.gems ? `💎${s.price.gems}` : `🪙${fmt(s.price.coins)}`}</button></div>`).join('')}</section>
      <h3>⚗️ 素材合成</h3><section class="card list">${Object.entries(D.SYNTH).map(([to, r]) => `<div><span style="flex:1">${esc(D.MATERIALS[r.from].name)} ×${r.n} → <b>${esc(D.MATERIALS[to].name)}</b> <span class="sub">(${me.items[r.from] || 0} 持っている)</span></span><button class="btn" data-syn="${to}" ${(me.items[r.from] || 0) >= r.n ? '' : 'disabled'}>合成</button></div>`).join('')}</section>`;
    $$('[data-s]').forEach((b) => b.addEventListener('click', async () => { try { apply(await api('/shop', { method: 'POST', body: { id: b.dataset.s } })); toast('購入しました'); viewShop(); } catch (e) { toast(e.message, true); } }));
    $$('[data-syn]').forEach((b) => b.addEventListener('click', async () => { try { apply(await api('/synth', { method: 'POST', body: { to: b.dataset.syn } })); toast('合成しました'); viewShop(); } catch (e) { toast(e.message, true); } }));
  }
  function viewItems() { const it = Object.entries(me.items); app.innerHTML = `<h2>🎒 素材</h2><section class="card list">${it.map(([k, n]) => `<div><b style="width:34px">${D.MATERIALS[k]?.icon || ''}</b><span style="flex:1">${esc(D.MATERIALS[k]?.name || k)}</span><b>×${n}</b></div>`).join('') || '<div class="sub">まだ持っていません (クエストで手に入ります)</div>'}</section><a class="btn block" href="#shop">⚗️ 素材合成・ショップ</a>`; }
  async function viewProfile(username) {
    const p = await api('/profile/' + encodeURIComponent(username || me.me.username));
    app.innerHTML = `<h2>👤 ${esc(p.name)}</h2><section class="card"><div class="sub">@${esc(p.username)}</div><div class="kv" style="margin-top:8px"><b>ランク</b><span>${p.rank}</span><b>キャラ</b><span>${p.units} 体</span><b>戦闘</b><span>${p.battles} 回 (勝ち ${p.wins})</span><b>クリアしたクエスト</b><span>${p.clears}</span><b>連携コンボ</b><span>${fmt(p.stats.combo || 0)} 回</span></div></section>
      <section class="card"><h3>編成</h3><div class="grid4">${p.party.map((u) => unitTile(u.char_id, { level: u.level })).join('')}</div></section>`;
  }
  function viewAdmin() {
    if (!me.admin) { location.hash = '#home'; return; }
    app.innerHTML = `<h2>🛠️ 排出率の設定</h2>${me.banners.map((b) => `<section class="card" data-bn="${b.id}"><h3>${esc(b.name)}</h3><div class="grid3">${['UR', 'SSR', 'SR', 'R', 'N'].map((r) => `<label class="sub">${r} %<input class="input" data-r="${r}" type="number" step="0.01" min="0" max="100" value="${b.rates[r]}"></label>`).join('')}${b.pickup ? `<label class="sub">ピックアップ %<input class="input" data-pk type="number" step="0.01" min="0" value="${b.pickupRate}"></label>` : ''}</div><button class="btn gold block" style="margin-top:10px" data-save>保存 (合計 100%)</button></section>`).join('')}`;
    $$('[data-bn]').forEach((s) => $('[data-save]', s).addEventListener('click', async () => {
      const rates = Object.fromEntries($$('[data-r]', s).map((i) => [i.dataset.r, Number(i.value)]));
      try { const d = await api('/admin/rates', { method: 'POST', body: { banner: s.dataset.bn, rates, pickupRate: Number($('[data-pk]', s)?.value) } }); me.banners = d.banners; toast('保存しました'); } catch (e) { toast(e.message, true); }
    }));
  }

  // ---------- 通信 (ルーム・戦闘) ----------
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bn`);
    ws.onopen = () => { wsQueue.splice(0).forEach((m) => ws.send(JSON.stringify(m))); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => { if (battle) battleMsg('📡 通信が切れました。つなぎ直しています…'); setTimeout(connect, 1500); };
  }
  function wsSend(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); else wsQueue.push(m); }
  function onMsg(m) {
    if (m.t === 'error') return toast(m.msg, true);
    if (m.t === 'info') return toast(m.msg);
    if (m.t === 'left') { room = null; if (m.msg) toast(m.msg); if (location.hash === '#lobby') viewLobby(); return; }
    if (m.t === 'room') { room = m.room; if (!room.solo && room.phase === 'lobby') { if (location.hash !== '#lobby') location.hash = '#lobby'; else renderRoom(); } return; }
    if (m.t === 'battle') return openBattle(m.state, m.room, m.resumed);
    if (m.t === 'turn' && battle) return battleTurn(m);
    if (m.t === 'shot' && battle) return battleShot(m);
    if (m.t === 'result') return battleResult(m);
  }

  // =====================================================================
  // 戦闘画面。サーバーから来たフレーム・出来事を再生する (計算はサーバー。ここは見せ方だけ)
  //   上: クエスト名・難しさ / バトル番号・ターン / メニュー → チームの HP → (ボス戦) ボスの HP → 行動順
  //   まん中: フィールド (bn-field.js の地面・ギミック・敵の絵・キャラのボール絵)
  //   下: チームの HP / 4 体の顔 (必殺技までのターン・状態。タップで詳しく) / ターン・必殺技
  // =====================================================================
  const F = window.BNField;
  const BALL = CORE.UNIT_R * 1.18; // 見た目のボールの半径 (当たり判定は CORE.UNIT_R のまま)
  function openBattle(state, rm, resumed) {
    room = rm;
    const st = D.STAGES.find((s) => s.id === state.stage);
    const el = document.createElement('div'); el.className = 'battle';
    el.innerHTML = `<div class="bt-top">
        <div class="bt-q"><b>${esc(st.name)}</b><small>${esc(D.MODES[st.mode])} ${'★'.repeat(Math.min(10, st.diff))}</small></div>
        <div class="bt-c"><b id="b-wave"></b><small id="b-turn"></small></div>
        <button class="bt-menu" id="b-menu" aria-label="メニュー">≡</button></div>
      <div class="bt-bars"><div class="bt-hpbar"><i id="b-hp"></i><s id="b-bar"></s><span id="b-hpt"></span></div>
        <div class="bt-boss" id="b-boss" hidden><em id="b-bossn"></em><div class="bt-bossbar"><i id="b-bosshp"></i></div></div>
        <div class="bt-order" id="b-order"></div></div>
      <div class="bwrap"><canvas class="field" id="b-cv"></canvas><div class="bt-ticker" id="b-tick"></div><div class="bmsg" id="b-msg"></div></div>
      <div class="bt-bot"><div class="bt-thp"><small>HP</small><b id="b-hpn"></b><div class="bt-mini"><i id="b-hpm"></i></div><small id="b-timer"></small></div>
        <div class="bt-faces" id="b-faces"></div>
        <div class="bt-side"><div class="bt-speed"><small>ターン</small><b id="b-tnum"></b></div><button class="spbtn" id="b-sp">必殺技</button></div></div>`;
    document.body.append(el);
    battle = { el, state, st, cv: $('#b-cv', el), anim: null, fx: [], log: [], disp: null, special: false, myTurn: false, deadline: 0, cosmos: 0, playing: false, pend: [], hit: {}, dying: [] };
    battle.disp = JSON.parse(JSON.stringify(state));
    $('#b-menu', el).addEventListener('click', openMenu);
    $('#b-sp', el).addEventListener('click', toggleSpecial);
    fit(); window.addEventListener('resize', fit);
    bindAim();
    drawHud(); loop();
    log(resumed ? '戦闘にもどりました' : 'バトル開始！ 引っぱって離すと発射');
  }
  function toggleSpecial() { const u = battle.disp.units[battle.disp.current]; if (!battle.myTurn || u.spLeft > 0) return; battle.special = !battle.special; drawHud(); battleMsg(battle.special ? `必殺技「${D.SPECIALS[u.special].name}」を撃つ準備` : '必殺技をやめた', 900); }
  function openMenu() {
    const m = document.createElement('div'); m.className = 'bt-sheet';
    m.innerHTML = `<div class="card"><h3>メニュー</h3><div class="bt-log">${battle.log.map((x) => `<p>${esc(x)}</p>`).join('') || '<p class="sub">まだ記録はありません</p>'}</div>
      <div class="grid2" style="margin-top:10px"><button class="btn" data-close>閉じる</button><button class="btn pink" data-giveup>あきらめる</button></div></div>`;
    battle.el.append(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); if (e.target.closest('[data-giveup]') && confirm('ルームを抜けますか？ (マルチではあなたのキャラは自動で動きます)')) { wsSend({ t: 'leave' }); closeBattle(); } });
  }
  function openUnitInfo(i) {
    const u = battle.disp.units[i]; if (!u) return; const c = D.CHAR[u.char], cb = D.COMBOS[u.combo], sp = D.SPECIALS[u.special];
    const m = document.createElement('div'); m.className = 'bt-sheet';
    m.innerHTML = `<div class="card"><div class="row"><span style="width:64px">${unitTile(u.char)}</span><div style="flex:1"><b>${esc(u.name)}</b><div class="sub">${D.ATTRS[u.attr].icon}${D.ATTRS[u.attr].name} · ${u.shot === 'pierce' ? '貫通' : '反射'}${u.immuneAll ? ' · 全ギミック対応中' : ''}</div><div class="sub">${room && !room.solo ? `担当: ${esc(memberName(u.owner))}` : ''}</div></div></div>
      <div class="kv" style="margin-top:8px"><b>攻撃力</b><span>${fmt(u.atk)}${u.atk !== u.baseAtk ? ` <span class="sub">(×${(u.atk / u.baseAtk).toFixed(2)})</span>` : ''}</span><b>スピード</b><span>${u.spd}</span><b>必殺技</b><span>${esc(sp.name)} · ${u.spLeft > 0 ? `あと ${u.spLeft} ターン` : '使える！'}</span><b>連携コンボ</b><span>${esc(cb.name)}</span>
      <b>バフ</b><span>${u.buffs.length ? u.buffs.map((b) => `攻撃 +${Math.round(b.rate * 100)}% (${b.turns})`).join('・') : 'なし'}</span><b>状態</b><span>${u.status?.slow ? '🐌 のろい (次のショットが遅い)' : 'ふつう'}</span></div>
      ${c.abilities.length ? `<div class="sub" style="margin-top:8px">${c.abilities.map((a) => esc(D.ABILITIES[a].name)).join('・')}</div>` : ''}<button class="btn block" data-close style="margin-top:10px">閉じる</button></div>`;
    battle.el.append(m); m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
  }
  function closeBattle() { if (!battle) return; cancelAnimationFrame(battle.raf); battle.el.remove(); battle = null; window.removeEventListener('resize', fit); route(); }
  function fit() {
    if (!battle) return; const cv = battle.cv, wrap = cv.parentElement, s = Math.min(wrap.clientWidth / D.W, wrap.clientHeight / D.H), dpr = Math.min(2, devicePixelRatio || 1);
    cv.style.width = D.W * s + 'px'; cv.style.height = D.H * s + 'px'; cv.width = Math.round(D.W * s * dpr); cv.height = Math.round(D.H * s * dpr); battle.scale = s; battle.dpr = dpr * s;
    battle.ground = F.field(battle.st, Math.min(3, Math.ceil(s * dpr)));
  }
  const log = (t) => { if (!battle) return; battle.log.unshift(t); battle.log.length = Math.min(battle.log.length, 40); const k = $('#b-tick'); if (k) { k.textContent = t; k.classList.remove('on'); void k.offsetWidth; k.classList.add('on'); } };
  function battleMsg(t, ms = 1400) { if (!battle) return; const m = $('#b-msg'); m.textContent = t; m.classList.remove('on'); void m.offsetWidth; m.classList.add('on'); clearTimeout(battle.msgT); battle.msgT = setTimeout(() => { m.textContent = ''; }, ms); }
  function drawHud() {
    if (!battle) return;
    const s = battle.disp, el = battle.el, cur = s.units[s.current], nW = battle.st.waves.length;
    $('#b-wave', el).textContent = `BATTLE ${s.wave + 1}/${nW}`; $('#b-turn', el).textContent = s.enemies.some((e) => e.boss && e.hp > 0) ? 'BOSS' : `${s.turn + 1} ターン目`;
    const pct = Math.max(0, s.teamHp / s.teamMax * 100);
    $('#b-hp', el).style.width = pct + '%'; $('#b-hp', el).className = pct < 25 ? 'low' : pct < 55 ? 'mid' : '';
    $('#b-bar', el).style.width = `${Math.min(100, s.barrier / s.teamMax * 100)}%`;
    $('#b-hpt', el).textContent = `${fmt(s.teamHp)} / ${fmt(s.teamMax)}${s.barrier ? ` 🛡${fmt(s.barrier)}` : ''}`;
    $('#b-hpn', el).textContent = fmt(s.teamHp); $('#b-hpm', el).style.width = pct + '%'; $('#b-tnum', el).textContent = s.turn + 1;
    const boss = s.enemies.find((e) => e.boss && e.hp > 0);
    $('#b-boss', el).hidden = !boss; if (boss) { $('#b-bossn', el).textContent = `${D.ATTRS[boss.attr].icon} ${boss.name}`; $('#b-bosshp', el).style.width = `${boss.hp / boss.maxHp * 100}%`; }
    // 行動順 (今の番から)
    $('#b-order', el).innerHTML = s.units.map((_, k) => s.units[(s.current + k) % s.units.length]).map((u, k) => `<span class="${k === 0 ? 'cur' : ''}">${k === 0 ? '▶ ' : ''}${esc(u.name)}</span>`).join('');
    // 下の顔 (必殺技までのターン・状態)
    $('#b-faces', el).innerHTML = s.units.map((u, i) => `<button class="bt-face ${i === s.current ? 'cur' : ''} ${u.spLeft <= 0 ? 'sp' : ''}" data-f="${i}" style="--ac:${D.ATTRS[u.attr].color}">${A.svg(u.char)}<em>${u.spLeft > 0 ? u.spLeft : 'SS'}</em>${u.status?.slow ? '<i>🐌</i>' : u.buffs.length ? '<i>⬆</i>' : ''}</button>`).join('');
    $$('#b-faces [data-f]', el).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.f); if (i === s.current && battle.myTurn && s.units[i].spLeft <= 0) return toggleSpecial(); openUnitInfo(i); }));
    const sp = $('#b-sp', el), spec = D.SPECIALS[cur.special];
    sp.className = 'spbtn' + (battle.myTurn && cur.spLeft <= 0 ? (battle.special ? ' on' : ' ready') : '');
    sp.innerHTML = `<small>${esc(spec.name)}</small>${cur.spLeft > 0 ? `あと ${cur.spLeft}` : battle.special ? '発動！' : '必殺技'}`;
  }
  function battleTurn(m) {
    battle.turnMsg = m;
    const apply = () => {
      const u = battle.disp.units[m.current];
      battle.myTurn = !m.auto && u.owner === myUid(); battle.deadline = m.deadline; battle.special = false;
      drawHud();
      battleMsg(battle.myTurn ? 'あなたの番！' : m.auto ? `${u.name} (自動)` : `${memberName(u.owner)} の番`, 1000);
    };
    if (battle.playing) battle.pend.push(apply); else apply();
  }
  const myUid = () => room?.members.find((x) => x.username === me.me.username)?.uid;
  const memberName = (uid) => room?.members.find((x) => x.uid === uid)?.name || '';

  // ねらう: キャラ (か、フィールドのどこか) を触って引っぱる。引っぱった向きの逆へ飛ぶ
  function bindAim() {
    const cv = battle.cv; let start = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / battle.scale, y: (e.clientY - r.top) / battle.scale }; };
    cv.addEventListener('pointerdown', (e) => { if (!battle?.myTurn || battle.playing) return; start = pos(e); battle.aim = { dx: 0, dy: 0 }; battle.grab = performance.now(); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (!start) return; const p = pos(e); battle.aim = { dx: (start.x - p.x) / 160, dy: (start.y - p.y) / 160 }; });
    const up = () => {
      if (!start) return; start = null;
      const a = battle.aim; battle.aim = null; battle.grab = 0;
      if (!a || Math.hypot(a.dx, a.dy) < 0.12) return;
      const l = Math.min(1, Math.hypot(a.dx, a.dy)), d = Math.hypot(a.dx, a.dy);
      wsSend({ t: 'shoot', dx: a.dx / d * l, dy: a.dy / d * l, special: battle.special });
      battle.myTurn = false; drawHud();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { start = null; battle.aim = null; battle.grab = 0; });
  }

  // サーバーの結果を再生 (フレーム = 1/30 秒)
  function battleShot(m) {
    battle.playing = true;
    const u = battle.disp.units[m.unit];
    battle.anim = { unit: m.unit, frames: m.frames, i: 0, t0: performance.now(), evs: m.events.slice(), final: m.state, trail: [] };
    if (m.auto) log(`${u.name} が自動で発射`);
  }
  function stepAnim(now) {
    const a = battle.anim; if (!a) return;
    const i = Math.min(a.frames.length - 1, Math.floor((now - a.t0) / (1000 / 30)));
    while (a.i <= i) { a.evs.filter((e) => e.f === a.i).forEach(onEvent); a.i++; }
    const p = a.frames[i], u = battle.disp.units[a.unit]; u.x = p[0]; u.y = p[1]; a.trail.push([p[0], p[1]]); if (a.trail.length > 18) a.trail.shift();
    if (i >= a.frames.length - 1) {
      a.evs.filter((e) => e.f >= a.frames.length).forEach(onEvent);
      battle.anim = null; battle.disp = JSON.parse(JSON.stringify(a.final)); battle.cosmos = 0;
      setTimeout(() => { if (!battle) return; battle.playing = false; drawHud(); battle.pend.splice(0).forEach((f) => f()); }, 450);
    }
  }
  // 出来事ごとの演出
  function onEvent(e) {
    const s = battle.disp, fx = battle.fx, now = performance.now();
    const E = (k) => s.enemies.find((x) => x.key === k);
    if (e.k === 'dmg') { const en = E(e.e); if (en) { en.hp = e.hp; battle.hit[en.key] = now;
        fx.push({ t: now, kind: 'num', x: en.x + (Math.random() - 0.5) * 30, y: en.y - en.r * 0.6, text: fmt(e.dmg), big: e.dmg >= 30000, thunder: e.thunder });
        if (e.hit !== undefined) { const u = s.units[e.hit]; const ang = Math.atan2(u.y - en.y, u.x - en.x); fx.push({ t: now, kind: 'spark', x: en.x + Math.cos(ang) * en.r, y: en.y + Math.sin(ang) * en.r, col: D.ATTRS[u.attr].color }); }
        if (e.thunder) fx.push({ t: now, kind: 'thunder', x: en.x, y: en.y }); if (e.from) fx.push({ t: now, kind: 'homing', x: e.from[0], y: e.from[1], tx: en.x, ty: en.y }); } }
    else if (e.k === 'kill') { const en = E(e.e); if (en) { battle.dying.push({ t: now, en: { ...en } }); fx.push({ t: now, kind: 'burst', x: en.x, y: en.y, r: en.r }); } log(`${en?.name || '敵'} をたおした！`); }
    else if (e.k === 'combo') { const cb = D.COMBOS[e.id]; fx.push({ t: now, kind: 'combo_' + e.kind, x: e.x, y: e.y, cb }); fx.push({ t: now, kind: 'touch', x: e.x, y: e.y }); log(`連携コンボ「${e.name}」！`); }
    else if (e.k === 'special') { log(`必殺技「${e.name}」！`); battleMsg(e.name, 1800); if (e.type === 'akashic_zero') { battle.cosmos = now; fx.push({ t: now, kind: 'zero' }); } if (e.type === 'akashic_record') fx.push({ t: now, kind: 'record', u: e.u }); if (e.type === 'meteor') fx.push({ t: now, kind: 'meteor' }); }
    else if (e.k === 'mode') { log(e.end ? '貫通・全ギミック対応がおわり、反射にもどった' : '貫通タイプ・全ギミック対応に変化！'); }
    else if (e.k === 'heal') { s.teamHp = e.hp; fx.push({ t: now, kind: 'heal' }); log(`HP が ${fmt(e.amount)} 回復`); }
    else if (e.k === 'barrier') { s.barrier = e.total; log(`バリア ${fmt(e.amount)}`); }
    else if (e.k === 'buff') log(`味方全員の攻撃力 ${Math.round(e.rate * 100)}% アップ (${e.turns} ターン)`);
    else if (e.k === 'teamDmg') { s.teamHp = e.hp; fx.push({ t: now, kind: 'hurt' }); if (e.why === 'floor') log(`ダメージ床！ ${fmt(e.dmg)}`); }
    else if (e.k === 'barrierUse') s.barrier = e.left;
    else if (e.k === 'enemyAtk') { const en = E(e.e); log(`${en?.name || '敵'} の${e.kind === 'laser' ? 'レーザー' : e.kind === 'curse' ? 'のろい' : 'こうげき'}！`); if (en) fx.push({ t: now, kind: 'eatk', x: en.x, y: en.y, laser: e.kind === 'laser' }); }
    else if (e.k === 'status') log(e.end ? 'のろいがとけた' : `${s.units[e.u]?.name} はのろわれた (次のショットが遅くなる)`);
    else if (e.k === 'resist') log(`${s.units[e.u]?.name} は運命干渉でのろいを防いだ！`);
    else if (e.k === 'eclipse') { const en = E(e.e); if (en) en.eclipse = 2; log('星蝕！ 受けるダメージが増える'); }
    else if (e.k === 'gimmick') { if (e.type === 'warp') fx.push({ t: now, kind: 'warp', x: e.to[0], y: e.to[1] }); if (e.hit) { const u = s.units[battle.anim?.unit]; if (u) fx.push({ t: now, kind: 'spark', x: u.x, y: u.y, col: e.type === 'slow_wall' ? '#74c0fc' : '#ced4da' }); } }
    else if (e.k === 'wave') { s.enemies = e.enemies; s.wave = e.wave; battleMsg(`BATTLE ${e.wave + 1}`); }
    else if (e.k === 'over') battleMsg(e.result === 'win' ? 'クリア！' : '全滅…', 3000);
    drawHud();
  }

  // 描画
  function loop() {
    if (!battle) return;
    battle.raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (battle.anim) stepAnim(now);
    draw(now);
    if (battle.deadline) { const left = Math.max(0, Math.ceil((battle.deadline - Date.now()) / 1000)); const t = $('#b-timer'); if (t) t.textContent = battle.playing ? '' : `⏱ ${left}`; }
  }
  // 予想の軌道 (外の壁ではね返る直線。強さで長さが変わる)
  function guidePath(x, y, dx, dy, len) {
    const pts = [[x, y]]; let px = x, py = y, vx = dx, vy = dy, left = len, R = CORE.UNIT_R;
    for (let k = 0; k < 4 && left > 0; k++) {
      const tx = vx > 0 ? (D.W - R - px) / vx : vx < 0 ? (R - px) / vx : Infinity, ty = vy > 0 ? (D.H - R - py) / vy : vy < 0 ? (R - py) / vy : Infinity, t = Math.min(tx, ty, left);
      px += vx * t; py += vy * t; left -= t; pts.push([px, py]); if (t === tx) vx = -vx; if (t === ty) vy = -vy;
    }
    return pts;
  }
  function draw(now) {
    const b = battle, s = b.disp, c = b.cv.getContext('2d'); c.setTransform(b.dpr, 0, 0, b.dpr, 0, 0);
    // 地面 (アカシックゼロのあいだは宇宙に変わる)
    const cos = b.cosmos && now - b.cosmos < 2600;
    if (b.ground) c.drawImage(b.ground, 0, 0, D.W, D.H);
    if (cos) { const k = Math.min(1, (now - b.cosmos) / 400) * (now - b.cosmos > 2200 ? Math.max(0, (2600 - (now - b.cosmos)) / 400) : 1); const g = c.createRadialGradient(D.W / 2, D.H * 0.35, 10, D.W / 2, D.H * 0.4, D.H); g.addColorStop(0, `rgba(59,42,122,${k})`); g.addColorStop(1, `rgba(5,3,15,${k})`); c.fillStyle = g; c.fillRect(0, 0, D.W, D.H); for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${(0.3 + (i % 5) * 0.14) * k})`; c.fillRect((i * 97) % D.W, (i * 53 + now / 20) % D.H, 1.6, 1.6); } }
    // ギミック
    for (const gm of s.gimmicks) F.drawGimmick(c, gm, now);
    // 敵 (影 → 絵 → 属性・HP・行動ターン)
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const im = F.enemyImage(e.id), hitT = b.hit[e.key] && now - b.hit[e.key] < 260 ? (now - b.hit[e.key]) / 260 : 0;
      const sx = hitT ? Math.sin(hitT * 40) * 4 * (1 - hitT) : 0, bob = Math.sin(now / 500 + e.key) * 1.6, size = e.r * (e.boss ? 2.6 : 2.4);
      c.fillStyle = 'rgba(0,0,0,.32)'; c.beginPath(); c.ellipse(e.x, e.y + e.r * 0.85, e.r * 0.95, e.r * 0.3, 0, 0, 7); c.fill();
      if (e.cd <= 1) { const p = 0.5 + Math.sin(now / 120) * 0.5; c.strokeStyle = `rgba(255,60,60,${0.4 + p * 0.5})`; c.lineWidth = 3; c.beginPath(); c.arc(e.x, e.y, e.r + 6 + p * 3, 0, 7); c.stroke(); c.lineWidth = 1; } // 攻撃の予告
      if (F.ready(im)) { c.drawImage(im, e.x - size / 2 + sx, e.y - size / 2 + bob, size, size); if (hitT) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.6 * (1 - hitT); c.drawImage(im, e.x - size / 2 + sx, e.y - size / 2 + bob, size, size); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; } }
      if (e.eclipse > 0) { c.strokeStyle = 'rgba(177,151,252,.9)'; c.setLineDash([3, 3]); c.beginPath(); c.arc(e.x, e.y, e.r + 4, 0, 7); c.stroke(); c.setLineDash([]); label(c, '蝕', e.x - e.r, e.y - e.r * 0.2, '#d0bfff', 10, '#000'); }
      // 頭上の HP バー
      if (!e.boss) { const bw = e.r * 1.8, by = e.y - size / 2 - 4 + bob; c.fillStyle = 'rgba(0,0,0,.65)'; roundRect(c, e.x - bw / 2 - 1, by - 1, bw + 2, 6, 3); c.fill(); c.fillStyle = e.hp / e.maxHp < 0.3 ? '#ff6b6b' : '#ffd43b'; roundRect(c, e.x - bw / 2, by, bw * e.hp / e.maxHp, 4, 2); c.fill(); }
      // 属性のしるし・行動までのターン
      c.fillStyle = D.ATTRS[e.attr].color; c.beginPath(); c.arc(e.x - e.r * 0.85, e.y + e.r * 0.65, 7, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.stroke(); label(c, D.ATTRS[e.attr].icon, e.x - e.r * 0.85, e.y + e.r * 0.66, '#fff', 8);
      label(c, String(e.cd), e.x + e.r * 0.8, e.y - e.r * 0.7, e.cd <= 1 ? '#ff6b6b' : '#fff', e.cd <= 1 ? 17 : 15, '#1a1033');
    }
    // 撃破の消滅 (光りながら小さくなる)
    b.dying = b.dying.filter((d) => now - d.t < 600);
    for (const d of b.dying) { const k = (now - d.t) / 600, im = F.enemyImage(d.en.id), size = d.en.r * 2.4 * (1 - k * 0.6); if (F.ready(im)) { c.globalAlpha = 1 - k; c.globalCompositeOperation = 'lighter'; c.drawImage(im, d.en.x - size / 2, d.en.y - size / 2 - k * 20, size, size); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; } }
    // 味方 (影・軌跡・ボール絵・属性のふち・選ばれた光)
    const cur = s.units[s.current];
    s.units.forEach((u, i) => {
      const col = D.ATTRS[u.attr].color, isCur = i === s.current && !b.anim, moving = b.anim && b.anim.unit === i;
      if (moving && b.anim.trail.length > 1) { const tr = b.anim.trail; for (let k = 1; k < tr.length; k++) { c.strokeStyle = F.hexA(u.shot === 'pierce' ? '#ffd43b' : col, k / tr.length * 0.7); c.lineWidth = BALL * 1.4 * k / tr.length; c.lineCap = 'round'; c.beginPath(); c.moveTo(tr[k - 1][0], tr[k - 1][1]); c.lineTo(tr[k][0], tr[k][1]); c.stroke(); } c.lineWidth = 1; }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(u.x + 2, u.y + BALL * 0.9, BALL * 0.85, BALL * 0.3, 0, 0, 7); c.fill();
      if (isCur) { const p = 0.6 + Math.sin(now / 180) * 0.4, gl = c.createRadialGradient(u.x, u.y, BALL * 0.8, u.x, u.y, BALL * 1.9); gl.addColorStop(0, `rgba(255,236,153,${0.7 * p})`); gl.addColorStop(1, 'rgba(255,236,153,0)'); c.fillStyle = gl; c.beginPath(); c.arc(u.x, u.y, BALL * 1.9, 0, 7); c.fill(); }
      // ボール絵
      const im = F.unitImage(u.char);
      c.save(); c.beginPath(); c.arc(u.x, u.y, BALL - 2, 0, 7); c.clip(); c.fillStyle = '#120d2e'; c.fillRect(u.x - BALL, u.y - BALL, BALL * 2, BALL * 2);
      if (F.ready(im)) { if (D.CHAR[u.char].sprite) c.drawImage(im, u.x - BALL * 1.3, u.y - BALL * 1.35, BALL * 2.6, BALL * 2.6); else { const w = BALL * 2.7, h = w * 1.25; c.drawImage(im, u.x - w / 2, u.y - h * 0.33, w, h); } }
      const sh = c.createRadialGradient(u.x - BALL * 0.4, u.y - BALL * 0.5, 1, u.x, u.y, BALL); sh.addColorStop(0, 'rgba(255,255,255,.35)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = sh; c.fillRect(u.x - BALL, u.y - BALL, BALL * 2, BALL * 2);
      c.restore();
      c.shadowColor = col; c.shadowBlur = isCur ? 16 : 8; c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(u.x, u.y, BALL - 1, 0, 7); c.stroke(); c.shadowBlur = 0; c.lineWidth = 1;
      if (isCur) { c.strokeStyle = '#fff3bf'; c.lineWidth = 2; c.beginPath(); c.arc(u.x, u.y, BALL + 3 + Math.sin(now / 200) * 1.5, 0, 7); c.stroke(); c.lineWidth = 1; }
      if (u.immuneAll || (moving && u.shot === 'pierce')) { c.strokeStyle = `rgba(255,212,59,${0.6 + Math.sin(now / 90) * 0.3})`; c.lineWidth = 2; c.setLineDash([4, 3]); c.beginPath(); c.arc(u.x, u.y, BALL + 7, now / 300, now / 300 + 6.3); c.stroke(); c.setLineDash([]); c.lineWidth = 1; }
      if (u.status?.slow) label(c, '🐌', u.x + BALL * 0.8, u.y - BALL * 0.8, '#fff', 12);
      if (u.spLeft <= 0 && !moving) label(c, 'SS', u.x, u.y + BALL + 8, '#ffd43b', 9, '#1a1033');
    });
    // ねらい: 予想の軌道 (壁ではね返る点線)・強さの輪
    if (b.aim && cur && Math.hypot(b.aim.dx, b.aim.dy) > 0.05) {
      const l = Math.min(1, Math.hypot(b.aim.dx, b.aim.dy)), d = Math.hypot(b.aim.dx, b.aim.dy) || 1, pts = guidePath(cur.x, cur.y, b.aim.dx / d, b.aim.dy / d, 60 + l * 260);
      c.strokeStyle = `hsla(${50 - l * 45},100%,62%,.95)`; c.lineWidth = 4; c.setLineDash([2, 9]); c.lineCap = 'round'; c.lineDashOffset = -now / 30; c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
      const [lx, ly] = pts[pts.length - 1], [px, py] = pts[pts.length - 2], an = Math.atan2(ly - py, lx - px); c.fillStyle = c.strokeStyle; c.beginPath(); c.moveTo(lx + Math.cos(an) * 8, ly + Math.sin(an) * 8); c.lineTo(lx + Math.cos(an + 2.5) * 8, ly + Math.sin(an + 2.5) * 8); c.lineTo(lx + Math.cos(an - 2.5) * 8, ly + Math.sin(an - 2.5) * 8); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 5; c.beginPath(); c.arc(cur.x, cur.y, BALL + 10, 0, 7); c.stroke(); c.strokeStyle = `hsl(${50 - l * 45},100%,60%)`; c.lineWidth = 4; c.beginPath(); c.arc(cur.x, cur.y, BALL + 10, -Math.PI / 2, -Math.PI / 2 + l * Math.PI * 2); c.stroke(); c.lineWidth = 1;
      label(c, `${Math.round(l * 100)}%`, cur.x, cur.y - BALL - 22, '#fff', 13, '#000');
    }
    // 演出
    b.fx = b.fx.filter((f) => now - f.t < 1400);
    for (const f of b.fx) {
      const t = (now - f.t) / 1000;
      if (f.kind === 'num') { c.globalAlpha = Math.max(0, 1 - t); const sc = t < 0.12 ? 1.4 - t * 3 : 1; label(c, f.text, f.x, f.y - t * 40, f.thunder ? '#ffe066' : f.big ? '#ffd43b' : '#fff', (f.big ? 20 : 15) * sc, '#1a1033'); c.globalAlpha = 1; }
      else if (f.kind === 'spark') { if (t < 0.35) { const k = t / 0.35; c.strokeStyle = F.hexA(f.col.length === 7 ? f.col : '#ffffff', 1 - k); c.lineWidth = 2.5; for (let a = 0; a < 8; a++) { const an = a * Math.PI / 4 + 0.3; c.beginPath(); c.moveTo(f.x + Math.cos(an) * (4 + k * 10), f.y + Math.sin(an) * (4 + k * 10)); c.lineTo(f.x + Math.cos(an) * (10 + k * 20), f.y + Math.sin(an) * (10 + k * 20)); c.stroke(); } c.fillStyle = `rgba(255,255,255,${0.9 - k})`; c.beginPath(); c.arc(f.x, f.y, 7 * (1 - k) + 2, 0, 7); c.fill(); c.lineWidth = 1; } }
      else if (f.kind === 'touch') { if (t < 0.5) { c.strokeStyle = `rgba(255,243,191,${1 - t * 2})`; c.lineWidth = 3; c.beginPath(); c.arc(f.x, f.y, BALL + t * 50, 0, 7); c.stroke(); c.lineWidth = 1; } }
      else if (f.kind === 'burst') { c.strokeStyle = `rgba(255,255,255,${1 - t})`; c.lineWidth = 4; c.beginPath(); c.arc(f.x, f.y, f.r + t * 80, 0, 7); c.stroke(); for (let k = 0; k < 10; k++) { const an = k * 0.63; c.fillStyle = `rgba(255,236,153,${1 - t})`; c.beginPath(); c.arc(f.x + Math.cos(an) * t * 90, f.y + Math.sin(an) * t * 90, 3, 0, 7); c.fill(); } c.lineWidth = 1; }
      else if (f.kind === 'combo_laser') { if (t < 0.5) { c.shadowColor = '#74c0fc'; c.shadowBlur = 16; c.fillStyle = `rgba(165,216,255,${0.85 - t * 1.5})`; c.fillRect(0, f.y - f.cb.width / 2, D.W, f.cb.width); c.fillStyle = `rgba(255,255,255,${0.9 - t * 1.6})`; c.fillRect(0, f.y - f.cb.width / 6, D.W, f.cb.width / 3); c.shadowBlur = 0; } }
      else if (f.kind === 'combo_explode') { if (t < 0.6) { const g = c.createRadialGradient(f.x, f.y, 2, f.x, f.y, f.cb.radius * Math.min(1, t * 4)); g.addColorStop(0, `rgba(255,255,200,${0.9 - t})`); g.addColorStop(0.5, `rgba(255,146,43,${0.7 - t})`); g.addColorStop(1, 'rgba(255,80,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, f.cb.radius * Math.min(1, t * 4), 0, 7); c.fill(); } }
      else if (f.kind === 'combo_nova') { if (t < 0.5) { c.strokeStyle = `rgba(255,255,255,${0.9 - t * 1.5})`; c.lineWidth = f.cb.width / 2; c.shadowColor = '#fff'; c.shadowBlur = 10; for (let d = 0; d < 8; d++) { const ang = d * Math.PI / 4; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x + Math.cos(ang) * 700, f.y + Math.sin(ang) * 700); c.stroke(); } c.shadowBlur = 0; c.lineWidth = 1; } }
      else if (f.kind === 'homing') { if (t < 0.35) { const k = t / 0.35; c.fillStyle = '#ffe066'; c.shadowColor = '#ffd43b'; c.shadowBlur = 10; c.beginPath(); c.arc(f.x + (f.tx - f.x) * k, f.y + (f.ty - f.y) * k - Math.sin(k * Math.PI) * 50, 5, 0, 7); c.fill(); c.shadowBlur = 0; } }
      else if (f.kind === 'combo_orbital') { if (t < 0.9) { s.enemies.filter((e) => e.hp > 0).forEach((e, k) => { c.strokeStyle = `rgba(255,243,191,${0.9 - t})`; c.lineWidth = 6; c.shadowColor = '#ffd43b'; c.shadowBlur = 14; c.beginPath(); c.moveTo(D.W / 2 + Math.cos(now / 300 + k) * 140, -10); c.lineTo(e.x, e.y); c.stroke(); c.shadowBlur = 0; }); c.lineWidth = 1; for (let k = 0; k < 10; k++) label(c, '✦', (k * 41 + t * 200) % D.W, (k * 67) % 200, `rgba(255,224,102,${1 - t})`, 14); } }
      else if (f.kind === 'thunder') { if (t < 0.45) { c.strokeStyle = `rgba(255,236,153,${1 - t * 2})`; c.lineWidth = 5; c.shadowColor = '#ffe066'; c.shadowBlur = 18; c.beginPath(); let x = f.x + 30, y = -10; c.moveTo(x, y); const fall = Math.min(1, t * 6); while (y < f.y * fall) { y += 34; x += (y / 34 % 2 ? -1 : 1) * 16; c.lineTo(x, Math.min(y, f.y)); } c.stroke(); c.shadowBlur = 0; c.lineWidth = 1; if (fall >= 1) { c.fillStyle = `rgba(255,255,255,${0.8 - t})`; c.beginPath(); c.arc(f.x, f.y, 30 + t * 60, 0, 7); c.fill(); } } }
      else if (f.kind === 'combo_heal' || f.kind === 'heal') { if (t < 0.8) for (let k = 0; k < 8; k++) label(c, '✚', (k * 47) % D.W, D.H - 40 - t * 120 - (k % 3) * 20, `rgba(105,219,124,${1 - t})`, 16); }
      else if (f.kind === 'combo_barrier') { if (t < 0.8) { c.strokeStyle = `rgba(116,192,252,${1 - t})`; c.lineWidth = 4; c.beginPath(); c.arc(f.x, f.y, 30 + t * 60, 0, 7); c.stroke(); c.lineWidth = 1; } }
      else if (f.kind === 'hurt') { if (t < 0.3) { c.fillStyle = `rgba(255,0,0,${0.3 - t})`; c.fillRect(0, 0, D.W, D.H); } }
      else if (f.kind === 'eatk') { if (t < 0.6) { c.strokeStyle = `rgba(255,107,107,${1 - t * 1.6})`; c.lineWidth = f.laser ? 10 : 4; c.shadowColor = '#ff3b3b'; c.shadowBlur = 12; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(D.W / 2, D.H - 60); c.stroke(); c.shadowBlur = 0; c.lineWidth = 1; } }
      else if (f.kind === 'warp') { c.strokeStyle = `rgba(99,230,190,${1 - t})`; c.beginPath(); c.arc(f.x, f.y, 10 + t * 40, 0, 7); c.stroke(); }
      else if (f.kind === 'meteor') { if (t < 1) s.enemies.filter((e) => e.hp > 0).forEach((e, k) => { const k2 = Math.min(1, t * 2 + k * 0.1); c.fillStyle = '#ff922b'; c.shadowColor = '#ff6b00'; c.shadowBlur = 14; c.beginPath(); c.arc(e.x - 80 * (1 - k2), e.y - 300 * (1 - k2), 10, 0, 7); c.fill(); c.shadowBlur = 0; }); }
      else if (f.kind === 'record') { if (t < 1.2) { c.fillStyle = `rgba(177,151,252,${0.25 - t * 0.2})`; c.fillRect(0, 0, D.W, D.H); for (let k = 0; k < 16; k++) { c.strokeStyle = `rgba(255,255,255,${0.5 - t * 0.4})`; c.beginPath(); c.moveTo((k * 23) % D.W, 0); c.lineTo((k * 23) % D.W - 40, D.H); c.stroke(); } label(c, '全ギミック対応・貫通', D.W / 2, 60, '#ffe066', 16, '#000'); } }
      else if (f.kind === 'zero') { // 天地創造・アカシックゼロ: 星の魔法陣 → 星が降る → 光の爆発
        if (t < 1.35) { c.save(); c.translate(D.W / 2, D.H * 0.32); c.rotate(now / 900); c.strokeStyle = `rgba(255,224,102,${Math.min(1, t * 2)})`; c.lineWidth = 2; c.shadowColor = '#ffd43b'; c.shadowBlur = 12; c.beginPath(); c.arc(0, 0, 130, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 100, 0, 7); c.stroke(); c.beginPath(); for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 + k * Math.PI * 4 / 5; c.lineTo(Math.cos(a) * 130, Math.sin(a) * 130); } c.stroke(); c.restore(); c.lineWidth = 1; c.shadowBlur = 0;
          for (let k = 0; k < 18; k++) { const kk = (t * 1.4 + k * 0.07) % 1; label(c, '★', (k * 53) % D.W + kk * 40, kk * D.H * 0.6, '#fff3bf', 14 + (k % 3) * 4); } }
        else { const k = t - 1.35; c.fillStyle = `rgba(255,255,255,${Math.max(0, 0.95 - k * 2)})`; c.fillRect(0, 0, D.W, D.H); }
      }
    }
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function label(c, text, x, y, color, size = 12, stroke) { c.font = `900 ${size}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; if (stroke) { c.lineWidth = 3; c.strokeStyle = stroke; c.strokeText(text, x, y); c.lineWidth = 1; } c.fillStyle = color; c.fillText(text, x, y); }

  function battleResult(m) {
    const show = () => {
      if (m.me) apply(m.me);
      const r = m.result, el = document.createElement('div'); el.className = 'result';
      el.innerHTML = `<div class="card"><h2 style="font-size:28px;margin:6px 0">${r.win ? '🏆 クリア！' : '💀 全滅…'}</h2><p class="sub">${m.turns} ターン · 連携コンボ ${m.stats.combo} 回 · 与えたダメージ ${fmt(m.stats.dmg)}</p>
        ${r.win ? `<p><b>報酬</b><br>${rewardText(r.reward)}${r.firstClear ? `<br>はじめてのクリア 💎${r.firstClear}` : ''}</p>${r.levelUps.length ? `<p class="sub">${r.levelUps.map((x) => `${esc(D.CHAR[x.char].name)} Lv+${x.up}`).join('・')}</p>` : ''}${r.rankUp ? `<p style="color:var(--gold)">ランクアップ！ (+${r.rankUp})</p>` : ''}` : '<p class="sub">育成や編成を見直して、もう一度挑戦しよう</p>'}
        <button class="btn gold block" id="r-ok">OK</button></div>`;
      document.body.append(el);
      $('#r-ok', el).addEventListener('click', () => { el.remove(); const wasSolo = room?.solo; closeBattle(); if (wasSolo) room = null; location.hash = room && !room.solo ? '#lobby' : '#quests'; route(); });
    };
    if (battle && (battle.playing || battle.anim)) battle.pend.push(() => setTimeout(show, 1200)); else show();
  }

  // ---------- はじめ ----------
  (async () => {
    try { me = await api('/me'); head(); connect(); const j = location.hash.match(/^#join\/(\d{6})$/); if (j) { location.hash = '#lobby'; wsSend({ t: 'join', id: j[1] }); } route(); }
    catch (e) { app.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`; }
  })();
})();
