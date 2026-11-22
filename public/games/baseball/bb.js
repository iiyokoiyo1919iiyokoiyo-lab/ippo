// =====================================================================
// IppO ベースボール: 画面 (ホーム・チーム・リーグ・ドラフト・ガチャ・対戦) とリアルタイム対戦の操作
//   ・利用者の書いた文字 (チーム名・ユーザー名) は esc() で必ずエスケープして出す
// =====================================================================
const C = window.BBCore;
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inFrame = parent !== window;
const app = $('#app');
let me = null, Stadium = null;
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/bb' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { if (inFrame) parent.postMessage({ source: 'ippo-baseball', type: 'login' }, location.origin); throw new Error('ログインしてください'); }
  if (!r.ok) throw new Error(d.error || 'エラーが起きました');
  return d;
}
function toast(msg, err = false) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600); }
const fmtT = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const hm = (t) => new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
const left = (t) => { const s = Math.max(0, Math.round((t - Date.now()) / 1000)); return s >= 86400 ? `${Math.floor(s / 86400)}日${Math.floor(s / 3600) % 24}時間` : s >= 3600 ? `${Math.floor(s / 3600)}時間${Math.floor(s / 60) % 60}分` : `${Math.floor(s / 60)}分${s % 60}秒`; };
const LG = { bronze: '🥉 ブロンズ', silver: '🥈 シルバー', gold: '🥇 ゴールド', elite: '💠 エリート', champion: '🏆 チャンピオン', king: '👑 KING' };
const lgChip = (l) => `<span class="lg ${esc(l)}">${LG[l] || esc(l)}</span>`;
const head = (title, sub = '') => `<div class="hd">${inFrame ? '<button class="x" id="exit" aria-label="もどる">✕</button>' : ''}<h1>⚾ ${title}${sub ? `<small>${sub}</small>` : ''}</h1><span class="souls">🔥 ${me?.team ? Number(me.team.souls).toLocaleString() : '-'}</span></div>`;
const tabs = (on) => `<nav class="tabs">${[['home', '🏟️', 'ホーム'], ['team', '👥', 'チーム'], ['league', '🏆', 'リーグ'], ['draft', '📋', 'ドラフト'], ['gacha', '🎰', 'ガチャ'], ['play', '⚔️', '対戦']].map(([k, i, n]) => `<a href="#${k}" class="${on === k ? 'on' : ''}"><b>${i}</b>${n}</a>`).join('')}</nav>`;
function bindCommon() { $('#exit')?.addEventListener('click', () => parent.postMessage({ source: 'ippo-baseball', type: 'exit' }, location.origin)); }
const statBar = (label, v, max = 100, suf = '') => `<span>${label}</span><span class="bar"><i style="width:${Math.min(100, v / max * 100)}%"></i></span><b>${v}${suf}</b>`;
const spChips = (p) => (p.specials || []).map((s) => `<span class="chip ${s.award ? 'aw' : 'sp'}" title="${esc(s.desc)}">${esc(s.name)}</span>`).join('');
const plRow = (p, extra = '') => `<div class="pl" data-pid="${esc(p.id)}"><span class="no">${p.kind === 'P' ? esc(p.pos) : esc(p.pos)}</span><span class="grow"><b><span class="r-${esc(p.rarity)}">${esc(p.rarity)}</span> ${esc(p.name)} <small>#${p.number}</small>${p.awakened ? ' <span class="chip star">覚醒</span>' : ''}</b>
  <small>${p.kind === 'P' ? `${p.stats.velo}km 変${p.stats.brk} 威${p.stats.stuff} · ${p.pitches.length}球種` : `ミ${p.stats.meet} パ${p.stats.power} 速${p.stats.speed} 守${p.stats.tech}`}</small> ${spChips(p)}</span>${extra}</div>`;
function playerModal(p, { release = false } = {}) {
  const s = p.season;
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h2 class="grow"><span class="r-${esc(p.rarity)}">${esc(p.rarity)}</span> ${esc(p.name)} <small class="muted">#${p.number} · ${p.kind === 'P' ? '投手' : '野手'} (${esc(p.pos)})</small></h2><button class="x" data-close>✕</button></div>
    <div class="st">${p.kind === 'P' ? statBar('球速', p.stats.velo, 165, 'km') + statBar('変化力', p.stats.brk) + statBar('球威', p.stats.stuff) + statBar('スタミナ', p.stats.stamina) : statBar('ミート', p.stats.meet) + statBar('パワー', p.stats.power) + statBar('走力', p.stats.speed) + statBar('守備', p.stats.tech)}</div>
    ${p.kind === 'P' ? `<p class="small" style="margin:8px 0 4px"><b>球種 (${p.pitches.length})</b></p><div>${p.pitches.map((x) => `<span class="chip">${esc(x.name)}</span>`).join('')}</div>` : ''}
    ${p.specials?.length ? `<p class="small" style="margin:8px 0 4px"><b>特殊能力</b></p>${p.specials.map((x) => `<div class="small"><span class="chip ${x.award ? 'aw' : 'sp'}">${esc(x.name)}</span> ${esc(x.desc)}</div>`).join('')}` : ''}
    ${s ? `<p class="small" style="margin:8px 0 4px"><b>今シーズン</b></p><p class="small muted" style="margin:0">${p.kind === 'B' ? `${s.g}試合 打率 ${s.ab ? (s.h / s.ab).toFixed(3).replace(/^0/, '') : '-'} (${s.h}/${s.ab}) 本塁打 ${s.hr} 打点 ${s.rbi} 守備評価 ${s.def}` : `${s.g}試合 ${s.w}勝${s.l}敗 ${s.sv}S ${s.hld}H 防御率 ${s.outs ? (s.er * 27 / s.outs).toFixed(2) : '-'} 奪三振 ${s.k}`}</p>` : ''}
    <p class="small muted">入手: ${{ start: 'はじめのチーム', draft: 'ドラフト', gacha: 'ガチャ', hot: 'ガチャ (前日の活躍選手)' }[p.origin] || esc(p.origin)} · 出場 ${p.games} 試合</p>
    ${release ? '<button class="btn sm" id="rel">手放す (たましいが少しもどる)</button>' : ''}</div>`;
  document.body.append(m);
  m.addEventListener('click', async (e) => {
    if (e.target === m || e.target.closest('[data-close]')) return m.remove();
    if (e.target.id === 'rel') { if (!confirm(`${p.name} を手放しますか？`)) return; try { const r = await api('/release/' + encodeURIComponent(p.id), { method: 'POST' }); me = r; m.remove(); toast(`手放しました (🔥 +${r.back})`); route(); } catch (err) { toast(err.message, true); } }
  });
}

// ---------- はじめる ----------
function viewStart() {
  app.innerHTML = head('IppO ベースボール') + `<div class="card"><h2>⚾ 自分だけのチームを作ろう</h2>
    <p class="small">架空の選手 20 人でスタート。毎時 5 分に同じリーグのチームと自動で試合して、ブロンズ → シルバー → ゴールド → エリート → チャンピオン を目指す！ 勝つと 🔥たましい がもらえて、ドラフト会議やガチャで選手を集められる。リアルタイム対戦もできる</p>
    <input class="in" id="tn" maxlength="14" placeholder="チーム名 (14 文字まで)"><div style="height:8px"></div><button class="btn p block" id="go">チームを作る</button></div>`;
  bindCommon();
  $('#go').onclick = async () => { try { me = await api('/start', { method: 'POST', body: { name: $('#tn').value } }); toast('チームができました！'); location.hash = '#home'; route(); } catch (e) { toast(e.message, true); } };
}

// ---------- ホーム ----------
function viewHome() {
  const t = me.team;
  const champ = t.league === 'champion' || t.league === 'king';
  app.innerHTML = head(esc(t.name), 'マイチーム') + `
    <div class="card"><div class="row">${lgChip(t.league)}<span class="grow"></span><span class="small muted">シーズン ${me.season.id} · のこり ${left(me.season.end)}</span></div>
      <p style="margin:10px 0 6px;font-size:22px;font-weight:900">${t.wins}勝 ${t.losses}敗</p>
      ${champ ? `<p class="small">🏆 チャンピオン レート <b style="font-size:18px">${t.rate}</b> · シーズン終了時に 1 位なら「King of season ${me.season.id}」</p>` : `<p class="small" style="margin:0 0 4px">昇格まで あと <b>${Math.max(0, t.need - t.lwins)}</b> 勝 (${t.lwins}/${t.need})</p><div class="bar"><i style="width:${t.lwins / t.need * 100}%"></i></div>`}
      <p class="small muted" style="margin:8px 0 0">⏰ つぎの自動試合: ${hm(me.nextGame)} (毎時 5 分) · 勝ち 🔥${me.rules.win}・負け 🔥${me.rules.lose}</p></div>
    <div class="card"><h2>📅 最近の試合</h2>${me.games.length ? me.games.map((g) => `<div class="pl" data-gid="${g.id}"><span class="no" style="background:${g.won ? '#2f9e44' : '#a61e1e'}">${g.won ? '勝' : '負'}</span><span class="grow"><b>${g.my} - ${g.op} vs ${esc(g.opp)}</b><small>${fmtT(g.at)}</small></span>›</div>`).join('') : '<p class="small muted">まだ試合がありません。つぎの毎時 5 分をお楽しみに</p>'}</div>
    <div class="card"><h2>⚔️ リアルタイム対戦</h2><p class="small">レート <b>${t.rtRate}</b> (${t.rtW}勝${t.rtL}敗)</p><a class="btn b block" href="#play">対戦する</a></div>` + tabs('home');
  bindCommon();
  $$('[data-gid]').forEach((el) => el.onclick = () => boxScore(el.dataset.gid));
}
async function boxScore(id) {
  let g; try { g = await api('/game/' + id); } catch (e) { return toast(e.message, true); }
  const inn = Math.max(9, g.lineAway.length, g.lineHome.length);
  const line = (name, L, R) => `<tr><td class="l">${esc(name)}</td>${Array.from({ length: inn }, (_, i) => `<td>${L[i] ?? (i < L.length ? 0 : 'x')}</td>`).join('')}<td><b>${R}</b></td></tr>`;
  const mine = g.box.filter((x) => x.team === g.mine);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${esc(g.away)} ${g.as} - ${g.hs} ${esc(g.home)}</h2><button class="x" data-close>✕</button></div>
    <div style="overflow:auto"><table><tr><th class="l"></th>${Array.from({ length: inn }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>計</th></tr>${line(g.away, g.lineAway, g.as)}${line(g.home, g.lineHome, g.hs)}</table></div>
    <p class="small" style="margin:10px 0 4px"><b>打撃 (自分のチーム)</b></p><table><tr><th class="l">選手</th><th>打数</th><th>安打</th><th>本</th><th>打点</th><th>四球</th><th>三振</th></tr>${mine.filter((x) => x.kind === 'B').map((x) => `<tr><td class="l">${esc(x.name)}</td><td>${x.ab}</td><td>${x.h}</td><td>${x.hr}</td><td>${x.rbi}</td><td>${x.bb}</td><td>${x.so}</td></tr>`).join('')}</table>
    <p class="small" style="margin:10px 0 4px"><b>投手</b></p><table><tr><th class="l">選手</th><th>回</th><th>自責</th><th>三振</th><th></th></tr>${mine.filter((x) => x.kind === 'P').map((x) => `<tr><td class="l">${esc(x.name)}</td><td>${Math.floor(x.outs / 3)}${x.outs % 3 ? '.' + (x.outs % 3) : ''}</td><td>${x.er}</td><td>${x.k}</td><td>${x.w ? '勝' : x.l ? '負' : x.sv ? 'S' : x.hld ? 'H' : ''}</td></tr>`).join('')}</table></div>`;
  document.body.append(m); m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
}

// ---------- チーム (選手・スタメン) ----------
function viewTeam() {
  const ps = me.players, byId = new Map(ps.map((p) => [p.id, p])), t = me.team;
  const bats = ps.filter((p) => p.kind === 'B'), pits = ps.filter((p) => p.kind === 'P');
  const opt = (list, sel, none = false) => `${none ? '<option value="">(なし)</option>' : ''}${list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${p.kind === 'P' ? `${p.stats.velo}km` : `ミ${p.stats.meet} パ${p.stats.power}`})</option>`).join('')}`;
  app.innerHTML = head('チーム', `${ps.length}/${me.rules.roster} 人`) + `
    <div class="card"><div class="row"><h2 class="grow">📝 スタメン・投手</h2><button class="btn sm" id="auto">おまかせ</button><button class="btn sm p" id="save">保存</button></div>
      <p class="small muted" style="margin:0 0 6px">打順 (1〜9 番)</p>${t.lineup.map((id, i) => `<div class="row" style="margin-bottom:4px"><b style="width:22px">${i + 1}</b><select class="in lu">${opt(bats, id)}</select></div>`).join('')}
      <p class="small muted" style="margin:10px 0 6px">先発ローテーション</p>${Array.from({ length: 5 }, (_, i) => `<div class="row" style="margin-bottom:4px"><b style="width:22px">${i + 1}</b><select class="in rot">${opt(pits, t.rotation[i], i > 0)}</select></div>`).join('')}
      <p class="small muted" style="margin:10px 0 6px">中継ぎ (ホールド) ・抑え (セーブ)</p>${[0, 1].map((i) => `<div class="row" style="margin-bottom:4px"><b style="width:22px">中</b><select class="in su">${opt(pits, t.bullpen.setup?.[i], true)}</select></div>`).join('')}
      <div class="row"><b style="width:22px">抑</b><select class="in" id="cl">${opt(pits, t.bullpen.closer, true)}</select></div></div>
    <div class="card"><h2>🧢 野手 (${bats.length})</h2>${bats.map((p) => plRow(p)).join('')}</div>
    <div class="card"><h2>⚾ 投手 (${pits.length})</h2>${pits.map((p) => plRow(p)).join('')}</div>
    <div class="card"><div class="row"><input class="in grow" id="tn" maxlength="14" value="${esc(t.name)}"><button class="btn sm" id="ren">チーム名を変える</button></div></div>` + tabs('team');
  bindCommon();
  $$('[data-pid]').forEach((el) => el.onclick = () => playerModal(byId.get(el.dataset.pid), { release: true }));
  $('#auto').onclick = async () => { try { me = await api('/auto-lineup', { method: 'POST' }); toast('おまかせで組みました'); route(); } catch (e) { toast(e.message, true); } };
  $('#save').onclick = async () => {
    const lineup = $$('.lu').map((s) => s.value), rotation = $$('.rot').map((s) => s.value).filter(Boolean), setup = $$('.su').map((s) => s.value).filter(Boolean), closer = $('#cl').value || null;
    try { me = await api('/lineup', { method: 'POST', body: { lineup, rotation, setup, closer } }); toast('保存しました'); route(); } catch (e) { toast(e.message, true); }
  };
  $('#ren').onclick = async () => { try { me = await api('/rename', { method: 'POST', body: { name: $('#tn').value } }); toast('変えました'); route(); } catch (e) { toast(e.message, true); } };
}

// ---------- リーグ (順位・表彰・ランキング) ----------
async function viewLeague() {
  app.innerHTML = head('リーグ') + '<div class="card muted">読みこみ中…</div>' + tabs('league'); bindCommon();
  let L, R; try { [L, R] = await Promise.all([api('/league'), api('/ranking')]); } catch (e) { return toast(e.message, true); }
  const champ = L.league === 'champion' || L.league === 'king';
  app.innerHTML = head('リーグ') + `
    <div class="card"><div class="row">${lgChip(L.league)}<span class="grow"></span><span class="small muted">シーズン ${L.season.id} · のこり ${left(L.season.end)}</span></div>
      <table style="margin-top:8px"><tr><th>#</th><th class="l">チーム</th><th>勝</th><th>敗</th><th>${champ ? 'レート' : '昇格まで'}</th></tr>
      ${L.teams.map((x, i) => `<tr style="${x.me ? 'background:#26315a' : ''}"><td>${i + 1}</td><td class="l">${x.king ? '👑 ' : ''}${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.wins}</td><td>${x.losses}</td><td>${champ ? x.rate : `${x.lwins}/${me.rules.promote}`}</td></tr>`).join('')}</table>
      <p class="small muted">同じリーグにプレイヤーがいないときは CPU のチームと戦います</p></div>
    <div class="card"><h2>🏅 シーズンの表彰</h2><p class="small muted" style="margin-top:0">表彰された選手には、その称号の特殊能力がつきます</p>${L.awards.length ? `<table><tr><th>季</th><th class="l">賞</th><th class="l">選手</th><th></th></tr>${L.awards.map((a) => `<tr><td>${a.season}</td><td class="l">${esc(a.title)}</td><td class="l">${esc(a.player)} <small class="muted">@${esc(a.owner || '')}</small></td><td>${esc(String(a.value))}${esc(a.unit || '')}</td></tr>`).join('')}</table>` : '<p class="small muted">まだありません (3 日ごとのシーズンの終わりに決まります)</p>'}
      ${L.kings.length ? `<p class="small" style="margin:8px 0 0">👑 ${L.kings.map((k) => `King of season ${k.season}: ${esc(k.name || '')} (@${esc(k.username || '')})`).join(' / ')}</p>` : ''}</div>
    <div class="card"><h2>⚔️ リアルタイム対戦 レート</h2>${R.rt.length ? `<table>${R.rt.map((x, i) => `<tr><td>${i + 1}</td><td class="l">${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.rt_rate}</td><td class="small">${x.rt_w}勝${x.rt_l}敗</td></tr>`).join('')}</table>` : '<p class="small muted">まだいません</p>'}</div>
    <div class="card"><h2>🏆 チャンピオン レート</h2>${R.champ.length ? `<table>${R.champ.map((x, i) => `<tr><td>${i + 1}</td><td class="l">${x.league === 'king' ? '👑 ' : ''}${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.rate}</td></tr>`).join('')}</table>` : '<p class="small muted">まだいません</p>'}</div>` + tabs('league');
  bindCommon();
}

// ---------- ドラフト会議 ----------
async function viewDraft() {
  app.innerHTML = head('ドラフト会議') + '<div class="card muted">読みこみ中…</div>' + tabs('draft'); bindCommon();
  let d; try { d = await api('/draft'); } catch (e) { return toast(e.message, true); }
  const T = d.times, ph = d.phase, mine = d.mine;
  const PH = { entry: `参加券の受付中 (${hm(T.deadline)} まで)`, closed: `受付終了 · ${hm(T.r1)} から 1 巡目`, r1: `🔔 1 巡目の指名中 (${hm(T.r1End)} まで)`, r1wait: `1 巡目の結果を ${hm(T.reveal)} に発表`, reveal: `1 巡目の結果発表 · ${hm(T.r2)} から 2 巡目`, r2: `🔔 2 巡目の指名中 (${hm(T.r2End)} まで・参加券を早く買った順)`, done: '今日のドラフトは終わりました (毎日 9:35〜)' };
  const canPick = mine && (ph === 'r1' || (ph === 'r2'));
  const myPick = ph === 'r1' ? mine?.pick1 : mine?.pick2;
  app.innerHTML = head('ドラフト会議', '毎日 9:35') + `
    <div class="card"><h2>📋 ${PH[ph]}</h2>
      <p class="small muted" style="margin:0">参加券 🔥${d.ticket.toLocaleString()} (${hm(T.deadline)} まで) · 1 巡目 ${hm(T.r1)}〜${hm(T.r1End)} (かぶったら抽選・${hm(T.reveal)} 発表) · 2 巡目 ${hm(T.r2)}〜${hm(T.r2End)}</p>
      ${mine ? `<p class="small">✅ 参加券を持っています (${hm(mine.boughtAt)} に購入)</p>` : ph === 'entry' ? `<button class="btn p block" id="buy">参加券を買う (🔥${d.ticket.toLocaleString()})</button>` : '<p class="small muted">参加券を持っていません</p>'}
      ${mine?.got?.length ? `<p class="small" style="margin:8px 0 4px"><b>🎉 獲得した選手</b></p>${mine.got.map((p) => plRow(p)).join('')}` : ''}</div>
    ${d.lots.length ? `<div class="card"><h2>🎯 1 巡目の結果</h2>${d.lots.map((l) => `<div class="small">${esc(l.name)}: ${l.entrants > 1 ? `${l.entrants} 球団が競合 → 抽選で ` : ''}<b>${esc(l.winner)}</b>${l.me ? ' 🎉' : ''}</div>`).join('')}</div>` : ''}
    <div class="card"><h2>🏟️ 参加球団 (${d.teams.length})</h2><div class="small">${d.teams.length ? d.teams.map((x, i) => `${i + 1}. ${esc(x.name)} <span class="muted">@${esc(x.username)}</span>`).join('<br>') : 'まだいません'}</div></div>
    <div class="card"><h2>🧢 指名候補 (${d.pool.length})</h2><p class="small muted" style="margin-top:0">⭐ は目玉選手 (かならず特殊能力つき)。目玉のほかにも、大化けする選手がいるかも…？</p>
      ${d.pool.map((p) => plRow(p, `${p.star ? '<span class="chip star">⭐目玉</span>' : ''}${p.taken ? '<span class="chip">指名済</span>' : ''}${canPick && !p.taken && !(ph === 'r2' && p.star) ? `<button class="btn sm ${myPick === p.id ? 'p' : ''}" data-pick="${esc(p.id)}">${myPick === p.id ? '指名中' : '指名'}</button>` : ''}`)).join('')}</div>` + tabs('draft');
  bindCommon();
  $('#buy')?.addEventListener('click', async () => { try { await api('/draft/ticket', { method: 'POST' }); me = await api('/me'); toast('参加券を買いました'); viewDraft(); } catch (e) { toast(e.message, true); } });
  $$('[data-pick]').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); try { await api('/draft/pick', { method: 'POST', body: { round: ph === 'r1' ? 1 : 2, player: b.dataset.pick } }); toast('指名しました'); viewDraft(); } catch (err) { toast(err.message, true); } });
  $$('[data-pid]').forEach((el) => el.onclick = () => playerModal(d.pool.find((p) => p.id === el.dataset.pid) || mine?.got.find((p) => p.id === el.dataset.pid)));
}

// ---------- ガチャ ----------
async function viewGacha() {
  app.innerHTML = head('ガチャ') + '<div class="card muted">読みこみ中…</div>' + tabs('gacha'); bindCommon();
  let g; try { g = await api('/gacha'); } catch (e) { return toast(e.message, true); }
  app.innerHTML = head('ガチャ', `1 回 🔥${g.price}`) + `
    <div class="card"><h2>🎰 選手ガチャ</h2><p class="small">前日の試合で活躍した選手が入っています (🔥 30%)。そのほか SSR 3%・SR 12%・R 30%・N 25%</p>
      <div class="row"><button class="btn p grow" data-n="1">1 回 (🔥${g.price})</button><button class="btn b grow" data-n="10">10 回 (🔥${g.price * 10})</button></div></div>
    <div class="card"><h2>🔥 前日の活躍選手</h2>${g.hot.length ? g.hot.map((p) => plRow(p)).join('') : '<p class="small muted">まだいません (前の日の試合の活躍で決まります)</p>'}</div>
    <div id="res"></div>` + tabs('gacha');
  bindCommon();
  $$('[data-n]').forEach((b) => b.onclick = async () => {
    try { const r = await api('/gacha', { method: 'POST', body: { n: Number(b.dataset.n) } }); me = r; $('.souls').textContent = `🔥 ${Number(r.team.souls).toLocaleString()}`;
      $('#res').innerHTML = `<div class="card"><h2>🎉 結果</h2>${r.results.map((p) => plRow(p, p.origin === 'hot' ? '<span class="chip star">🔥活躍</span>' : '')).join('')}</div>`;
      $$('#res [data-pid]').forEach((el) => el.onclick = () => playerModal(r.results.find((p) => p.id === el.dataset.pid)));
      $('#res').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message, true); }
  });
  $$('.card [data-pid]').forEach((el) => el.onclick = () => playerModal(g.hot.find((p) => p.id === el.dataset.pid)));
}

// ---------- 対戦 (リアルタイム) ----------
function viewPlay() {
  const t = me.team;
  app.innerHTML = head('リアルタイム対戦', 'レート戦') + `
    <div class="card"><h2>⚔️ レート ${t.rtRate} <small class="muted">(${t.rtW}勝${t.rtL}敗)</small></h2>
      <p class="small">2 イニング + 延長タイブレーク (無死一・二塁から)。投げるときは球種と場所 (カーソル) を決めて、メーターのまん中でリリース (ずれると失投)。打つときは画面を長押ししてミートカーソルを動かし、ボールが来たら指を離してスイング！</p>
      <button class="btn p block" id="q">対戦相手を探す (レート戦)</button><div style="height:8px"></div><button class="btn block" id="cpu">CPU と練習 (レートは変わらない)</button><p class="small muted" id="qs"></p></div>` + tabs('play');
  bindCommon();
  $('#q').onclick = () => startMatch('queue');
  $('#cpu').onclick = () => startMatch('cpu');
}

// ---------- 試合の画面と操作 ----------
let ws = null, M = null;
async function startMatch(mode) {
  if (!Stadium) { try { Stadium = await import('./stadium.js?v=1'); } catch (e) { return toast('3D を読みこめませんでした', true); } }
  ws?.close(); ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bb`);
  ws.onopen = () => { ws.send(JSON.stringify({ t: mode })); const qs = $('#qs'); if (qs) qs.textContent = mode === 'queue' ? '相手を探しています… (見つからなければ CPU と練習もできます)' : ''; };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { if (M && !M.over) { toast('接続が切れました', true); endScreen(null); } };
}
const $m = (s) => $(s, $('#match'));
function onMsg(m) {
  if (m.t === 'error') return toast(m.error, true);
  if (m.t === 'queued') return;
  if (m.t === 'start') {
    $('#match').classList.add('on');
    M = { you: m.you, teams: m.teams, rated: m.rated, S: Stadium.createStadium($('#cv')), cursor: { x: 0, y: 0.77 }, aim: { x: 0, y: 0.75 }, pitch: null, role: null, state: null, holding: false, releaseAt: 0, swung: false, inFlight: false, lastBatter: null };
    M.S.scoreboard(m.teams.map((t) => t.name), [[], []], [0, 0]);
    show('⚾ プレイボール！', `${esc(m.teams[0].name)} vs ${esc(m.teams[1].name)}${m.rated ? '' : ' (練習)'}`, 1800);
    bindMatchInput();
    return;
  }
  if (!M) return;
  if (m.t === 'turn') return onTurn(m);
  if (m.t === 'pitched') return onPitched(m);
  if (m.t === 'result') return onResult(m);
  if (m.t === 'half') { M.S.resetView(); show(`${m.state.inning}回${m.state.half ? '裏' : '表'}`, m.tiebreak ? 'タイブレーク: 無死一・二塁から' : '', 1800); hud(m.state); return; }
  if (m.t === 'end') return endScreen(m);
}
function hud(st) {
  M.state = st;
  const T = M.teams, dot = (n, on, cls) => `<span class="${cls}">${cls === 'b' ? 'B' : cls === 's' ? 'S' : 'O'}${Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
  $m('#sb').innerHTML = `<div class="sc"><span>${st.half === 0 ? '▶' : ''}${esc(T[0].name.slice(0, 8))}</span><b>${st.score[0]}</b></div><div class="sc"><span>${st.half === 1 ? '▶' : ''}${esc(T[1].name.slice(0, 8))}</span><b>${st.score[1]}</b></div>
    <div class="cnt">${st.inning}回${st.half ? '裏' : '表'} ${dot(3, st.count.b, 'b')}${dot(2, st.count.s, 's')}${dot(2, st.outs, 'o')}</div>`;
  $$('#bases i').forEach((el, i) => el.classList.toggle('on', !!st.bases[i]));
  const b = st.batter, p = st.pitcher;
  $m('#who').innerHTML = `🧢 ${esc(b.name)} <span class="muted">ミ${b.meet} パ${b.power}</span><br>⚾ ${esc(p.name)} <span class="muted">${p.velo}km</span>`;
  M.S.scoreboard(T.map((t) => t.name), st.line, st.score);
}
function show(title, sub = '', ms = 1400) { const el = $m('#msg'); el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(show.t); show.t = setTimeout(() => el.classList.remove('show'), ms); }
function onTurn(m) {
  hud(m.state); M.role = m.role; M.swung = false; M.inFlight = false; M.holding = false;
  const st = m.state, defTeam = 1 - st.half, offTeam = st.half;
  if (M.lastBatter !== st.batter.id + ':' + st.half) { M.lastBatter = st.batter.id + ':' + st.half; M.S.setupPlayers({ defTeam, offTeam, batter: st.batter, pitcher: st.pitcher, lineupDef: M.teams[defTeam].lineup, bases: st.bases }); }
  else M.S.setRunners(st.bases);
  M.S.resetView();
  const ctl = $m('#ctl');
  if (m.role === 'pitch') {
    const ps = st.pitcher.pitches || ['straight']; if (!ps.includes(M.pitch)) M.pitch = ps[0];
    ctl.innerHTML = `<div id="hint">球種をえらんで、ゾーンをなぞって場所を決める → 投げる</div><div class="pitches">${ps.map((k) => `<button data-pt="${k}" class="${k === M.pitch ? 'on' : ''}">${esc(C.PITCHES[k]?.name || k)}</button>`).join('')}</div><div id="meter"><span class="g"></span><span class="p"></span><span class="k"></span></div><button class="bigbtn" id="throw">投げる</button>`;
    $$('[data-pt]', ctl).forEach((b) => b.onclick = () => { M.pitch = b.dataset.pt; $$('[data-pt]', ctl).forEach((x) => x.classList.toggle('on', x === b)); });
    $('#throw', ctl).onclick = startMeter;
    M.S.setAim(M.aim.x, M.aim.y, true); M.S.setMeet(0, 0, 0, false);
    $m('#pinfo').textContent = `${st.pitcher.name}: 球速 ${st.pitcher.velo} · 変化 ${st.pitcher.brk} · 球威 ${st.pitcher.stuff}`;
  } else {
    ctl.innerHTML = `<div id="hint">画面を長押ししてミートカーソルを動かす → ボールが来たら離してスイング (さわらなければ見送り)</div>`;
    M.S.setAim(0, 0, false); M.S.setMeet(M.cursor.x, M.cursor.y, C.meetR(st.batter.meet), true);
    $m('#pinfo').textContent = `${st.batter.name}: ミート ${st.batter.meet} · パワー ${st.batter.power}`;
  }
}
// 投球のメーター: 白い線が左右に動く。まん中 (黄色) で止めるとぴったり、外れすぎると失投
function startMeter() {
  const meter = $m('#meter'), k = $('.k', meter), btn = $m('#throw'); if (!meter || M.meterOn) return;
  meter.classList.add('on'); btn.textContent = 'リリース！'; M.meterOn = true;
  const t0 = performance.now(); let pos = 0;
  const step = () => { if (!M.meterOn) return; const u = ((performance.now() - t0) / 1100) % 2; pos = u < 1 ? u : 2 - u; k.style.left = `calc(${pos * 100}% - 2px)`; requestAnimationFrame(step); };
  step();
  btn.onclick = () => { M.meterOn = false; meter.classList.remove('on'); btn.disabled = true; ws.send(JSON.stringify({ t: 'pitch', pitch: M.pitch, x: M.aim.x, y: M.aim.y, release: pos })); const g = Math.abs(pos - 0.5); show(g <= 0.07 ? '✨ ナイスリリース' : g <= 0.16 ? 'いいね' : g > 0.24 ? '😱 失投…' : 'まあまあ', '', 900); };
}
function onPitched(m) {
  M.inFlight = true; M.S.setAim(0, 0, false);
  if (M.role === 'pitch') $m('#ctl').innerHTML = '';
  M.S.throwPitch(m.pc, m.windup, (at) => { M.releaseAt = at; });
  M.pc = m.pc;
  setTimeout(() => { if (M?.pc === m.pc) $m('#pinfo').textContent = `${m.pc.name} ${m.pc.km}km/h`; }, m.windup * 1000);
}
function swing() {
  if (M.role !== 'bat' || !M.inFlight || M.swung || !M.releaseAt) return;
  M.swung = true; M.S.swingBat();
  ws.send(JSON.stringify({ t: 'swing', x: M.cursor.x, y: M.cursor.y, tt: (performance.now() - M.releaseAt) / 1000 }));
}
const RES = (m) => {
  const r = m.res, e = m.ev;
  if (e?.kind === 'k') return ['💨 三振！', ''];
  if (e?.kind === 'bb') return ['フォアボール', ''];
  if (r.kind === 'take') return [r.call === 'strike' ? 'ストライク' : 'ボール', ''];
  if (r.kind === 'miss') return ['空振り', ''];
  if (r.kind === 'foul') return ['ファウル', ''];
  if (r.kind === 'hit') return [r.bases === 4 ? '🎆 ホームラン！！' : ['', 'ヒット！', 'ツーベース！', 'スリーベース！'][r.bases], `${r.dist}m · ${r.ev}km/h${m.runs ? ` · ${m.runs} 点！` : ''}`];
  return [{ ground: 'ゴロでアウト', liner: 'ライナーでアウト', fly: 'フライでアウト', pop: 'ポップフライ' }[r.outType] || 'アウト', `${r.dist}m${m.runs ? ` · ${m.runs} 点` : ''}`];
};
function onResult(m) {
  M.inFlight = false; M.S.setMeet(0, 0, 0, false);
  const [t, s] = RES(m);
  if (m.res.kind === 'hit' || m.res.kind === 'out') M.S.hitBall(m.res);
  setTimeout(() => { show(t, s, 1800); hud(m.state); if (m.walkoff) show('🎉 サヨナラ！', '', 2400); }, m.res.kind === 'hit' || m.res.kind === 'out' ? 900 : 200);
}
function endScreen(m) {
  if (!M) return;
  M.over = true; const ctl = $m('#ctl');
  const win = m && m.winner === m.you, draw = m && m.winner === -1;
  show(!m ? '試合終了' : win ? '🏆 勝利！' : draw ? '引き分け' : '敗北…', m ? `${m.score[0]} - ${m.score[1]}${m.rated ? ` · レート ${m.delta >= 0 ? '+' : ''}${m.delta}` : ' (練習)'}${m.forfeit !== null && m.forfeit !== undefined ? ' (相手の降参・切断)' : ''}` : '', 600000);
  ctl.innerHTML = '<button class="bigbtn" id="back">もどる</button>';
  $('#back', ctl).onclick = async () => { $('#match').classList.remove('on'); M.S.dispose(); M = null; ws?.close(); ws = null; try { me = await api('/me'); } catch {} location.hash = '#play'; route(); };
}
function bindMatchInput() {
  const el = $('#match');
  if (el.dataset.bound) return; el.dataset.bound = '1';
  let last = null;
  el.addEventListener('pointerdown', (e) => {
    if (!M || M.over || e.target.closest('button')) return;
    const p = M.S.screenToPlate(e.clientX, e.clientY); if (!p) return;
    if (M.role === 'pitch' && !M.inFlight) { M.aim = { x: C.clamp(p.x, -0.45, 0.45), y: C.clamp(p.y, 0.2, 1.4) }; M.S.setAim(M.aim.x, M.aim.y); M.dragAim = true; }
    if (M.role === 'bat') { M.holding = true; last = p; el.setPointerCapture?.(e.pointerId); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!M) return; const p = M.S.screenToPlate(e.clientX, e.clientY); if (!p) return;
    if (M.dragAim && M.role === 'pitch' && !M.inFlight) { M.aim = { x: C.clamp(p.x, -0.45, 0.45), y: C.clamp(p.y, 0.2, 1.4) }; M.S.setAim(M.aim.x, M.aim.y); }
    if (M.holding && M.role === 'bat' && last) { // 長押しのあいだ、指の動きの分だけカーソルが動く (指でカーソルが隠れない)
      M.cursor.x = C.clamp(M.cursor.x + (p.x - last.x) * 1.15, -0.5, 0.5); M.cursor.y = C.clamp(M.cursor.y + (p.y - last.y) * 1.15, 0.2, 1.4); last = p;
      M.S.setMeet(M.cursor.x, M.cursor.y, C.meetR(M.state.batter.meet), true);
    }
  });
  const up = () => { if (!M) return; M.dragAim = false; if (M.holding) { M.holding = false; last = null; swing(); } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { if (M) { M.holding = false; M.dragAim = false; } });
  // キーボード: 矢印でカーソル・スペースでスイング / リリース
  addEventListener('keydown', (e) => {
    if (!M || M.over) return; const d = 0.03;
    const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
    if (mv && M.role === 'bat') { M.cursor.x = C.clamp(M.cursor.x + mv[0], -0.5, 0.5); M.cursor.y = C.clamp(M.cursor.y + mv[1], 0.2, 1.4); M.S.setMeet(M.cursor.x, M.cursor.y, C.meetR(M.state.batter.meet)); e.preventDefault(); }
    if (mv && M.role === 'pitch' && !M.inFlight) { M.aim.x = C.clamp(M.aim.x + mv[0], -0.45, 0.45); M.aim.y = C.clamp(M.aim.y + mv[1], 0.2, 1.4); M.S.setAim(M.aim.x, M.aim.y); e.preventDefault(); }
    if (e.key === ' ') { e.preventDefault(); if (M.role === 'bat') swing(); else if (M.role === 'pitch') { const b = $m('#throw'); if (b && !b.disabled) b.click(); } }
  });
  $('#mx').onclick = () => { if (M && !M.over && confirm('降参しますか？ (負けになります)')) ws?.send(JSON.stringify({ t: 'resign' })); };
}

// ---------- 画面の切りかえ ----------
async function route() {
  if (!me) { try { me = await api('/me'); } catch (e) { app.innerHTML = head('IppO ベースボール') + `<div class="card">${esc(e.message)}</div>`; bindCommon(); return; } }
  if (!me.started) return viewStart();
  const h = (location.hash || '#home').slice(1);
  ({ home: viewHome, team: viewTeam, league: viewLeague, draft: viewDraft, gacha: viewGacha, play: viewPlay }[h] || viewHome)();
}
addEventListener('hashchange', () => { if (!M) route(); });
route();
setInterval(async () => { if (!M && (location.hash || '#home') === '#home') { try { me = await api('/me'); viewHome(); } catch {} } }, 60_000);
