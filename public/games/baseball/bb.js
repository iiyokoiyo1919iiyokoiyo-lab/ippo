// =====================================================================
// IppO ベースボール: 画面 (プロ野球の公式アプリのような見た目) とリアルタイム対戦の操作
//   ・下のナビ: ホーム / マイチーム / ドラフト / 対戦 / その他 (リーグ・ガチャ・ニュース・トレード・選手図鑑・アプリとして使う)
//   ・選手プロフィール (#player/<id>)・ニュース記事 (#article/<id>)・トレード (#trade・#tradeteam/<uid>)・図鑑 (#zukan)
//   ・演出: ページの切りかえ・能力のバー・覚醒 (前後の比較)・ドラフトの指名・ニュースの通知
//   ・利用者の書いた文字 (チーム名・ユーザー名・メッセージ) は esc() で必ずエスケープして出す
//   ・アプリとして開いたとき (PWA) はログイン画面・オフラインの表示もここ
// =====================================================================
const C = window.BBCore;
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inFrame = parent !== window;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const app = $('#app');
let me = null, Stadium = null, HOME = null;
const ls = { get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
class LoginError extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET' && !navigator.onLine) throw new Error('オフラインのため操作できません。通信がもどってからもう一度どうぞ');
  let r;
  try { r = await fetch('/api/bb' + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { setNet(false); throw new Error('サーバーにつながりません (オフライン)'); }
  setNet(true);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { if (inFrame) parent.postMessage({ source: 'ippo-baseball', type: 'login' }, location.origin); throw new LoginError('ログインしてください'); }
  if (!r.ok) throw new Error(d.error || 'エラーが起きました');
  return d;
}
function setNet(on) { const n = $('#net'); if (n) n.classList.toggle('on', !on); }
addEventListener('offline', () => setNet(false));
addEventListener('online', () => { setNet(true); toast('通信がもどりました'); if (!M) { me = null; route(); } });
function toast(msg, err = false) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2800); }
const fmtT = (t) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const hm = (t) => new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
const left = (t) => { const s = Math.max(0, Math.round((t - Date.now()) / 1000)); return s >= 86400 ? `${Math.floor(s / 86400)}日${Math.floor(s / 3600) % 24}時間` : s >= 3600 ? `${Math.floor(s / 3600)}時間${Math.floor(s / 60) % 60}分` : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`; };
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'たった今' : s < 3600 ? `${Math.floor(s / 60)}分前` : s < 86400 ? `${Math.floor(s / 3600)}時間前` : fmtT(t); };
const hashS = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const LG = { bronze: 'ブロンズ', silver: 'シルバー', gold: 'ゴールド', elite: 'エリート', champion: 'チャンピオン', king: 'KING' };
const lgChip = (l) => `<span class="lg ${esc(l)}">${l === 'king' ? '👑 ' : ''}${LG[l] || esc(l)}</span>`;
const souls = () => (me?.team ? Number(me.team.souls).toLocaleString() : '-');
// ---------- アイコン (線の SVG) ----------
const IC = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/>',
  draft: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  play: '<path d="M5 19 17 7M7 5l12 12M4.5 16.5l3 3M16.5 4.5l3 3"/>',
  more: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  back: '<path d="M15 5 8 12l7 7"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', news: '<rect x="3" y="5" width="15" height="15" rx="2"/><path d="M18 9h3v9a2 2 0 0 1-2 2M7 9h7M7 13h7M7 17h4"/>',
  trade: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>', book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5"/>', trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
  gacha: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="4"/><path d="M8 17h8"/>', phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
};
const icon = (k, sz = 22) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || ''}</svg>`;
// ---------- 球団エンブレム (チーム名から決まる) ----------
const EPAL = [['#0b2a6b', '#d4af37'], ['#7a0e1c', '#f3efe3'], ['#0e3b2e', '#e9c46a'], ['#16161f', '#ff8c1a'], ['#3a1d6e', '#d4af37'], ['#0b4f6c', '#f3efe3'], ['#5a1a1a', '#e9c46a'], ['#12355b', '#ff6b6b']];
function emblem(name, size = 48) {
  const h = hashS(name || '?'), [c1, c2] = EPAL[h % EPAL.length], ini = [...String(name || '?').replace(/\s/g, '')].slice(0, 2).join(''), id = 'em' + (h % 1e6);
  return `<svg class="emb" viewBox="0 0 64 72" width="${size}" height="${Math.round(size * 72 / 64)}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="#05070f"/></linearGradient></defs>
    <path d="M32 2 60 10v26c0 18-14 28-28 34C18 64 4 54 4 36V10z" fill="url(#${id})" stroke="${c2}" stroke-width="3"/><path d="M32 8 54 14v22c0 14-10 22-22 27-12-5-22-13-22-27V14z" fill="none" stroke="${c2}" stroke-opacity=".45"/>
    <text x="32" y="${ini.length > 1 ? 41 : 44}" text-anchor="middle" font-size="${ini.length > 1 ? 19 : 27}" font-weight="900" fill="${c2}" font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif">${esc(ini)}</text><path d="M19 51h26" stroke="${c2}" stroke-width="2"/><circle cx="32" cy="57" r="2.4" fill="${c2}"/></svg>`;
}
// ---------- 共通の部品 ----------
const head = (title, sub = '', { back = false } = {}) => `<header class="bar">${back ? `<button class="ib" id="back" aria-label="もどる">${icon('back')}</button>` : inFrame ? `<button class="ib" id="exit" aria-label="IppO にもどる">${icon('close')}</button>` : `<span class="ib logo">⚾</span>`}
  <h1>${title}${sub ? `<small>${sub}</small>` : ''}</h1><span class="souls" title="たましい">🔥 <b>${souls()}</b></span></header>`;
const NAV = [['home', 'home', 'ホーム'], ['team', 'team', 'マイチーム'], ['draft', 'draft', 'ドラフト'], ['play', 'play', '対戦'], ['more', 'more', 'その他']];
const NAV_OF = { home: 'home', team: 'team', player: 'team', draft: 'draft', play: 'play' };
const tabs = (on) => { const cur = NAV_OF[on] || 'more'; const badge = (HOME?.trades || 0) + (HOME?.awakenings?.length || 0); return `<nav class="tabs">${NAV.map(([k, ic, n]) => `<a href="#${k}" class="${cur === k ? 'on' : ''}" ${cur === k ? 'aria-current="page"' : ''}>${icon(ic, 23)}<span>${n}</span>${k === 'more' && HOME?.trades ? `<i class="dot">${HOME.trades}</i>` : ''}</a>`).join('')}</nav>`; };
function render(html, on) { app.innerHTML = `<div class="page">${html}</div>` + tabs(on); bindCommon(); scrollTo(0, 0); }
function bindCommon() {
  $('#exit')?.addEventListener('click', () => parent.postMessage({ source: 'ippo-baseball', type: 'exit' }, location.origin));
  $('#back')?.addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#home')));
}
const loading = (title, on, opt) => render(head(title, '', opt) + '<div class="sk"><i></i><i></i><i></i></div>', on);
const RN = { N: 1, R: 2, SR: 3, SSR: 4 };
const rar = (r) => `<span class="rr r-${esc(r)}">${esc(r)}</span>`;
const gradeB = (p) => (p.grade ? `<span class="gr g-${esc(p.grade)}"><b>${esc(p.grade)}</b><small>${p.ovr}</small></span>` : '');
const spChips = (p) => (p.specials || []).map((s) => `<span class="chip ${s.award ? 'aw' : 'sp'}" title="${esc(s.desc)}">${esc(s.name)}</span>`).join('');
// 選手のイラスト (bb-illust.js)。一覧の小さな絵は顔のアップ。なければシルエット (bb-art.js)。文字は中でエスケープしている
const art = (p, size, name = true) => (window.BBIllust ? window.BBIllust.svg(p, { size, name, crop: size < 80 ? 'face' : null }) : window.BBArt ? window.BBArt.svg(p, { size, name }) : '');
const statLine = (p) => (p.stats ? (p.kind === 'P' ? `${p.stats.velo}km 変${p.stats.brk} 威${p.stats.stuff} ス${p.stats.stamina}` : `ミ${p.stats.meet} パ${p.stats.power} 走${p.stats.speed} 守${p.stats.tech}`) : '');
const plRow = (p, extra = '') => `<div class="pl" data-pid="${esc(p.id)}"><span class="pic">${art(p, 46, false)}</span><span class="grow"><b>${esc(p.name)} <small class="num">#${esc(p.number)}</small>${p.rookie ? ' <span class="chip new">新人</span>' : ''}${p.real ? ' <span class="chip real">実在</span>' : ''}</b>
  <small>${rar(p.rarity)} ${p.kind === 'P' ? '投手' : '野手'}・${esc(p.pos)}${p.age ? `・${p.age}歳` : ''} <span class="sl">${statLine(p)}</span></small>${p.specials?.length ? `<span class="chips">${spChips(p)}</span>` : ''}</span>${gradeB(p)}${extra}</div>`;
const STATS = (p) => (p.kind === 'P' ? [['球速', p.stats.velo, 165, 'km', 110], ['変化力', p.stats.brk], ['球威', p.stats.stuff], ['スタミナ', p.stats.stamina]] : [['ミート', p.stats.meet], ['パワー', p.stats.power], ['走力', p.stats.speed], ['守備', p.stats.tech]]);
const abBar = ([label, v, max = 100, suf = '', min = 0], i = 0) => { const w = Math.max(3, Math.min(100, (v - min) / (max - min) * 100)), g = max === 165 ? (v >= 155 ? 'S' : v >= 148 ? 'A' : v >= 142 ? 'B' : v >= 136 ? 'C' : 'D') : v >= 85 ? 'S' : v >= 75 ? 'A' : v >= 65 ? 'B' : v >= 55 ? 'C' : v >= 45 ? 'D' : 'E';
  return `<div class="ab"><span>${label}</span><span class="track"><i class="g-${g}" style="width:${w}%;animation-delay:${i * 70}ms"></i></span><b class="g-${g}">${g}</b><em>${v}${suf}</em></div>`; };
function playerModal(p, { release = false } = {}) {
  if (!p) return;
  if (me?.players?.some((x) => x.id === p.id)) { location.hash = '#player/' + encodeURIComponent(p.id); return; }
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="sheet"><button class="ib x" data-close aria-label="とじる">${icon('close')}</button><div class="pcard">${art(p, 200)}</div>
    <h2>${rar(p.rarity)} ${esc(p.name)} <small class="muted">#${esc(p.number)} · ${p.kind === 'P' ? '投手' : '野手'} (${esc(p.pos)})${p.age ? ` · ${p.age}歳` : ''}</small></h2>
    ${p.stats ? `<div class="abs">${STATS(p).map(abBar).join('')}</div>` : ''}
    ${p.kind === 'P' && p.pitches?.length ? `<p class="lbl">球種 (${p.pitches.length})</p><div>${p.pitches.map((x) => `<span class="chip">${esc(x.name)}</span>`).join('')}</div>` : ''}
    ${p.specials?.length ? `<p class="lbl">特殊能力</p>${p.specials.map((x) => `<div class="small"><span class="chip ${x.award ? 'aw' : 'sp'}">${esc(x.name)}</span> ${esc(x.desc)}</div>`).join('')}` : ''}
    ${p.real ? `<p class="small">${esc(p.real.team)}${p.real.note ? ` · 🔥 ${esc(p.real.note)}` : ''}</p>` : ''}</div>`;
  document.body.append(m);
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
}
// カウントダウン (data-cd = 時刻)
setInterval(() => { for (const el of $$('[data-cd]')) el.textContent = left(Number(el.dataset.cd)); }, 1000);

// ---------- ログイン (アプリとして開いたとき) ----------
function viewLogin() {
  app.innerHTML = `<div class="page login"><div class="lg-hero">${emblem('IppO', 84)}<h1>IppO ベースボール</h1><p>IppO のアカウントでログイン</p></div>
    <form class="card" id="lf"><label class="fl">ユーザー名<input class="in" name="u" autocomplete="username" required maxlength="15"></label><label class="fl">パスワード<input class="in" name="p" type="password" autocomplete="current-password" required></label>
    <button class="btn p block">ログイン</button><p class="small muted">アカウントの作成は <a href="/" target="_blank" rel="noopener">IppO</a> から (招待制)</p></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.u.value, password: f.p.value }) }); const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'ログインできませんでした'); me = null; route(); } catch (err) { toast(err.message, true); }
  };
}

// ---------- はじめる ----------
function viewStart() {
  render(head('IppO ベースボール') + `<section class="hero start">${emblem('IppO', 72)}<h2>自分だけの球団をつくろう</h2><p>架空の選手 20 人でスタート。毎時 5 分に同じリーグの球団と自動で試合。ドラフト・トレード・育成で、ブロンズから KING を目指す</p></section>
    <div class="card"><label class="fl">球団名 (14 文字まで)<input class="in" id="tn" maxlength="14" placeholder="例: 港町ドルフィンズ"></label><button class="btn p block" id="go">球団をつくる</button></div>`, 'home');
  $('#go').onclick = async () => { try { me = await api('/start', { method: 'POST', body: { name: $('#tn').value } }); toast('球団ができました！'); location.hash = '#home'; route(); } catch (e) { toast(e.message, true); } };
}

// ---------- ホーム ----------
async function viewHome() {
  if (!HOME) loading('ホーム', 'home');
  try { HOME = await api('/home'); me = HOME.me; } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  if ((location.hash || '#home') !== '#home') return;
  const t = me.team, H = HOME, champ = t.league === 'champion' || t.league === 'king';
  const dph = { entry: '参加券 受付中', closed: '受付終了', r1: '1巡目 指名中', r1wait: '抽選中', reveal: '結果発表', r2: '2巡目 指名中', done: '本日終了' }[H.draft.phase] || '';
  const nextDraft = H.draft.phase === 'done' ? H.draft.times.r1 : H.draft.phase === 'entry' ? H.draft.times.deadline : H.draft.phase === 'r1' ? H.draft.times.r1End : H.draft.phase === 'r2' ? H.draft.times.r2End : H.draft.times.r2;
  const nw = (n, big = false) => `<a class="nw${big ? ' big' : ''} c-${esc(n.cat)}" href="#article/${n.id}"><span class="kick">${esc(n.catName)}${n.mine ? ' · マイ球団' : ''}</span><b>${esc(n.title)}</b>${big ? `<p>${esc(n.body.slice(0, 90))}${n.body.length > 90 ? '…' : ''}</p>` : ''}<small>${ago(n.at)}${n.team ? ` · ${esc(n.team)}` : ''}</small></a>`;
  render(head(esc(t.name), 'マイ球団') + `
    <section class="hero"><div class="hero-in">${emblem(t.name, 76)}<div class="grow"><p class="eyebrow">${lgChip(t.league)} <span>シーズン ${me.season.id}</span></p><h2>${esc(t.name)}</h2>
      <div class="kpis"><div><b>${H.rank || '-'}<small>位</small></b><span>${H.teamsInLeague} 球団中</span></div><div><b>${t.wins}<small>勝</small>${t.losses}<small>敗</small></b><span>今季の成績</span></div><div><b>${champ ? t.rate : `${Math.max(0, t.need - t.lwins)}`}${champ ? '' : '<small>勝</small>'}</b><span>${champ ? 'レート' : '昇格まで'}</span></div></div></div></div>
      ${champ ? '' : `<div class="prog"><i style="width:${Math.min(100, t.lwins / t.need * 100)}%"></i></div>`}
      <div class="hero-ft"><span>⏱ シーズン終了まで <b data-cd="${me.season.end}">${left(me.season.end)}</b></span><span class="gold">🔥 ${souls()}</span></div></section>
    ${H.awakenings.length ? `<button class="alert gold" id="awk">⚡ ${H.awakenings.length} 人の選手が覚醒しました！ <b>見る</b></button>` : ''}
    ${H.trades ? `<a class="alert" href="#trade">🔁 トレードの申し込みが ${H.trades} 件届いています</a>` : ''}
    <div class="tiles"><a class="tile" href="#team"><small>つぎの自動試合</small><b>${hm(me.nextGame)}</b><span>あと <em data-cd="${me.nextGame}">${left(me.nextGame)}</em></span></a>
      <a class="tile" href="#draft"><small>ドラフト会議 · ${dph}</small><b>${hm(nextDraft)}</b><span>${H.draft.ticket ? '✅ 参加券あり' : `参加券 🔥${H.draft.price.toLocaleString()}`}</span></a></div>
    <section class="card news"><div class="ch"><h3>${icon('news', 18)} 球団ニュース</h3><a href="#news">すべて ›</a></div>${H.headline ? nw(H.headline, true) : ''}${H.news.filter((n) => n.id !== H.headline?.id).slice(0, 4).map((n) => nw(n)).join('') || '<p class="muted small">まだニュースはありません</p>'}</section>
    <section class="card"><div class="ch"><h3>直近の試合</h3><span class="muted small">毎時 5 分</span></div>${me.games.length ? `<div class="games">${me.games.slice(0, 6).map((g) => `<button class="gm ${g.won ? 'w' : 'l'}" data-gid="${g.id}"><b>${g.won ? '勝' : '負'}</b><span>${g.my}-${g.op}</span><small>${esc(g.opp.slice(0, 7))}</small></button>`).join('')}</div>` : '<p class="muted small">最初の試合を待っています</p>'}</section>
    ${H.stars.length ? `<section class="card"><div class="ch"><h3>好調の選手</h3><span class="muted small">最近 12 試合</span></div><div class="stars">${H.stars.map((s) => `<a class="star" href="#player/${encodeURIComponent(s.player.id)}">${art(s.player, 64, false)}<b>${esc(s.player.name)}</b><small>${esc(s.line)}</small></a>`).join('')}</div></section>` : ''}
    <a class="cta" href="#play"><span>${icon('play', 28)}</span><div class="grow"><b>リアルタイム対戦</b><small>レート ${t.rtRate} · ${t.rtW}勝${t.rtL}敗</small></div><em>対戦する ›</em></a>`, 'home');
  $$('[data-gid]').forEach((el) => el.onclick = () => boxScore(el.dataset.gid));
  $('#awk')?.addEventListener('click', () => showAwakenings(H.awakenings));
  if (H.awakenings.length && !ls.get('bb_awk_shown_' + H.awakenings[0].id)) { ls.set('bb_awk_shown_' + H.awakenings[0].id, 1); showAwakenings(H.awakenings); }
  // 重要なニュースの通知 (前に見たものより新しいとき)
  const lastSeen = ls.get('bb_news_seen', 0), top = H.news.find((n) => n.imp >= 2 && n.id > lastSeen);
  if (top && lastSeen) notifyNews(top);
  if (H.news[0]) ls.set('bb_news_seen', Math.max(lastSeen, H.news[0].id));
}
function notifyNews(n) {
  const el = document.createElement('a'); el.className = 'ntf'; el.href = '#article/' + n.id; el.innerHTML = `<span class="kick">${esc(n.catName)}</span><b>${esc(n.title)}</b>`;
  document.body.append(el); requestAnimationFrame(() => el.classList.add('on')); setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }, 5000);
}

// ---------- 覚醒の演出 (前後の比較) ----------
function showAwakenings(list) {
  if (!list?.length) return;
  let i = 0; const m = document.createElement('div'); m.className = 'awk';
  const NAME = { meet: 'ミート', power: 'パワー', speed: '走力', tech: '守備', velo: '球速', brk: '変化力', stuff: '球威', stamina: 'スタミナ' };
  const show = () => {
    const a = list[i], p = { ...a.player, stats: a.after }, keys = Object.keys(a.after);
    m.innerHTML = `<div class="awk-in"><div class="rays"></div><p class="awk-t">覚 醒</p><div class="awk-p">${art(p, 150)}</div><h2>${esc(a.player.name)}</h2><p class="muted small">${esc(a.player.pos)} · ${fmtT(a.at)}</p>
      <div class="cmp">${keys.map((k) => { const b = a.before[k], af = a.after[k], g = af - b, max = k === 'velo' ? 165 : 100, min = k === 'velo' ? 110 : 0; return `<div class="cr${g > 0 ? ' up' : ''}"><span>${NAME[k] || k}</span><span class="track"><i class="old" style="width:${(b - min) / (max - min) * 100}%"></i><i class="new" style="width:${(af - min) / (max - min) * 100}%"></i></span><b>${b}${g > 0 ? ` → <em>${af}</em> <small>+${g}</small>` : ''}</b></div>`; }).join('')}</div>
      ${a.newPitch ? `<p class="gain">🆕 変化球「${esc(a.newPitch.name)}」を習得</p>` : ''}${a.newSpecial ? `<p class="gain">✨ 特殊能力「${esc(a.newSpecial.name)}」を獲得 <small>${esc(a.newSpecial.desc)}</small></p>` : ''}
      <button class="btn gold block" id="awn">${i + 1 < list.length ? `つぎへ (${i + 1}/${list.length})` : 'とじる'}</button></div>`;
    $('#awn', m).onclick = () => { if (++i < list.length) show(); else { m.classList.add('out'); setTimeout(() => m.remove(), 300); api('/awaken/seen', { method: 'POST', body: { all: true } }).then(() => { if (HOME) HOME.awakenings = []; $('#awk')?.remove(); }).catch(() => {}); } };
  };
  document.body.append(m); show();
}

// ---------- マイチーム (選手・オーダー) ----------
function viewTeam(sub = 'players') {
  const ps = me.players, t = me.team, byId = new Map(ps.map((p) => [p.id, p]));
  const bats = ps.filter((p) => p.kind === 'B'), pits = ps.filter((p) => p.kind === 'P');
  const filt = ls.get('bb_team_f', 'all'), sortK = ls.get('bb_team_s', 'ovr');
  const sorter = (a, b) => (sortK === 'age' ? a.age - b.age : sortK === 'rar' ? RN[b.rarity] - RN[a.rarity] || b.ovr - a.ovr : b.ovr - a.ovr);
  const opt = (list, sel, none = false) => `${none ? '<option value="">(なし)</option>' : ''}${list.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${p.grade}${p.ovr} ${p.kind === 'P' ? `${p.stats.velo}km` : `ミ${p.stats.meet} パ${p.stats.power}`})</option>`).join('')}`;
  const seg = `<div class="seg"><a href="#team" class="${sub === 'players' ? 'on' : ''}">選手 (${ps.length}/${me.rules.roster})</a><a href="#order" class="${sub === 'order' ? 'on' : ''}">オーダー</a></div>`;
  if (sub === 'order') {
    render(head('マイチーム', esc(t.name)) + seg + `<div class="card"><div class="ch"><h3>打順</h3><button class="btn sm" id="auto">おまかせ</button></div>${t.lineup.map((id, i) => `<div class="row ord"><b>${i + 1}</b><select class="in lu">${opt(bats, id)}</select></div>`).join('')}</div>
      <div class="card"><h3>先発ローテーション</h3>${Array.from({ length: 5 }, (_, i) => `<div class="row ord"><b>${i + 1}</b><select class="in rot">${opt(pits, t.rotation[i], i > 0)}</select></div>`).join('')}
      <h3 style="margin-top:14px">中継ぎ・抑え</h3>${[0, 1].map((i) => `<div class="row ord"><b>中</b><select class="in su">${opt(pits, t.bullpen.setup?.[i], true)}</select></div>`).join('')}<div class="row ord"><b>抑</b><select class="in" id="cl">${opt(pits, t.bullpen.closer, true)}</select></div></div>
      <div class="sticky"><button class="btn p block" id="save">オーダーを保存</button></div>
      <div class="card"><h3>球団名</h3><div class="row"><input class="in grow" id="tn" maxlength="14" value="${esc(t.name)}"><button class="btn sm" id="ren">変える</button></div></div>`, 'team');
    $('#auto').onclick = async () => { try { me = await api('/auto-lineup', { method: 'POST' }); toast('おまかせで組みました'); viewTeam('order'); } catch (e) { toast(e.message, true); } };
    $('#save').onclick = async () => { const lineup = $$('.lu').map((s) => s.value), rotation = $$('.rot').map((s) => s.value).filter(Boolean), setup = $$('.su').map((s) => s.value).filter(Boolean), closer = $('#cl').value || null;
      try { me = await api('/lineup', { method: 'POST', body: { lineup, rotation, setup, closer } }); toast('保存しました'); } catch (e) { toast(e.message, true); } };
    $('#ren').onclick = async () => { try { me = await api('/rename', { method: 'POST', body: { name: $('#tn').value } }); toast('球団名を変えました'); viewTeam('order'); } catch (e) { toast(e.message, true); } };
    return;
  }
  const list = (filt === 'B' ? bats : filt === 'P' ? pits : ps).slice().sort(sorter), inLineup = new Set([...t.lineup, ...t.rotation, ...(t.bullpen.setup || []), t.bullpen.closer].filter(Boolean));
  render(head('マイチーム', esc(t.name)) + seg + `<div class="fbar"><div class="chipsel">${[['all', 'すべて'], ['B', `野手 ${bats.length}`], ['P', `投手 ${pits.length}`]].map(([k, n]) => `<button data-f="${k}" class="${filt === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <select class="in mini" id="srt">${[['ovr', '総合評価順'], ['rar', 'レア度順'], ['age', '若い順']].map(([k, n]) => `<option value="${k}" ${sortK === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="card flush">${list.map((p) => plRow(p, inLineup.has(p.id) ? '<span class="tag">出場</span>' : '')).join('')}</div>`, 'team');
  $$('[data-f]').forEach((b) => b.onclick = () => { ls.set('bb_team_f', b.dataset.f); viewTeam(); });
  $('#srt').onchange = (e) => { ls.set('bb_team_s', e.target.value); viewTeam(); };
  $$('[data-pid]').forEach((el) => el.onclick = () => { location.hash = '#player/' + encodeURIComponent(el.dataset.pid); });
}

// ---------- 選手プロフィール ----------
async function viewPlayer(id) {
  loading('選手', 'player', { back: true });
  let d; try { d = await api('/player/' + encodeURIComponent(id)); } catch (e) { if (e instanceof LoginError) throw e; render(head('選手', '', { back: true }) + `<div class="card">${esc(e.message)}</div>`, 'player'); return; }
  const p = d.player, B = p.kind === 'B', c = d.career, hof = d.retired?.hof;
  const sline = (s) => (B ? `<tr><td>${s.season ?? '通算'}</td><td>${s.g}</td><td>${s.avg}</td><td>${s.h}</td><td>${s.hr}</td><td>${s.rbi}</td><td>${s.sb}</td><td>${s.bb}</td><td>${s.so}</td></tr>`
    : `<tr><td>${s.season ?? '通算'}</td><td>${s.g}</td><td>${s.era}</td><td>${s.w}</td><td>${s.l}</td><td>${s.sv}</td><td>${s.hld}</td><td>${Math.floor(s.outs / 3)}${s.outs % 3 ? '.' + (s.outs % 3) : ''}</td><td>${s.k}</td></tr>`);
  const th = B ? '<tr><th>季</th><th>試</th><th>打率</th><th>安</th><th>本</th><th>点</th><th>盗</th><th>四</th><th>三</th></tr>' : '<tr><th>季</th><th>試</th><th>防御率</th><th>勝</th><th>敗</th><th>S</th><th>H</th><th>回</th><th>K</th></tr>';
  const NAME = { meet: 'ミート', power: 'パワー', speed: '走力', tech: '守備', velo: '球速', brk: '変化力', stuff: '球威', stamina: 'スタミナ' };
  render(head(esc(p.name), d.retired ? 'OB' : esc(d.team), { back: true }) + `
    <section class="ph ${hof ? 'hof' : ''} r-bg-${esc(p.rarity)}"><div class="ph-art">${art(p, 230, false)}</div><div class="ph-info"><p class="eyebrow">${rar(p.rarity)} ${B ? '野手' : '投手'} · ${esc(p.pos)}</p><h2>${esc(p.name)}<small>#${esc(p.number)}</small></h2>
      <p class="ph-sub">${d.retired ? `シーズン${d.retired.season}で引退 · ${d.retired.age}歳 · 在籍${d.retired.seasons}年` : `${p.age}歳 · プロ${p.seasons + 1}年目${p.rookie ? ' · 🌱ルーキー' : ''}`}</p><p class="ph-team">${d.team ? emblem(d.team, 22) + ' ' + esc(d.team) : ''}</p>
      <div class="ovr g-${esc(p.grade)}"><b>${esc(p.grade)}</b><span>${p.ovr}</span><small>総合評価</small></div></div>
      ${hof ? `<div class="hofb">🏛 殿堂入り<small>${esc(d.retired.hofReason)}</small></div>` : ''}</section>
    <section class="card"><h3>能力</h3><div class="abs">${STATS(p).map(abBar).join('')}</div>
      ${!B ? `<p class="lbl">球種 (${p.pitches.length})</p><div>${p.pitches.map((x) => `<span class="chip">${esc(x.name)}</span>`).join('')}</div>` : ''}
      ${p.specials.length ? `<p class="lbl">特殊能力</p>${p.specials.map((x) => `<div class="spr"><span class="chip ${x.award ? 'aw' : 'sp'}">${esc(x.name)}</span><small>${esc(x.desc)}</small></div>`).join('')}` : ''}
      ${p.value ? `<p class="small muted" style="margin:10px 0 0">市場価値の目安 🔥${p.value.toLocaleString()}${p.locked ? ' · 🔒トレード申請中' : ''}</p>` : ''}</section>
    <section class="card"><h3>成績</h3>${d.seasons.length ? `<div class="tw"><table class="st">${th}${d.seasons.map(sline).join('')}${d.seasons.length > 1 ? sline({ ...c, season: null }) : ''}</table></div>` : '<p class="muted small">まだ公式戦の出場はありません</p>'}
      <div class="tot"></div></section>
    ${d.titles.length ? `<section class="card"><h3>受賞タイトル</h3>${d.titles.map((t) => `<div class="ttl">🏅 <b>${esc(t.name)}</b><small>シーズン${t.season}</small></div>`).join('')}</section>` : ''}
    ${d.awakenings.length ? `<section class="card"><h3>覚醒の記録</h3>${d.awakenings.map((a) => `<div class="awr">⚡ <b>${fmtT(a.at)}</b> <small>${Object.entries(a.gains).map(([k, g]) => `${NAME[k]} ${a.before[k]}→${a.after[k]}`).join('、')}${a.newPitch ? ` · 新球種「${esc(a.newPitch)}」` : ''}${a.newSpecial ? ` · 「${esc(a.newSpecial)}」獲得` : ''}</small></div>`).join('')}</section>` : ''}
    ${d.mine ? `<div class="card row"><a class="btn grow" href="#trade">${icon('trade', 18)} トレードへ</a><button class="btn danger grow" id="rel">手放す</button></div>` : ''}`, 'player');
  // 通算の数字
  const tot = $('.tot'); if (tot) tot.innerHTML = (B ? [['通算打率', c.avg], ['安打', c.h], ['本塁打', c.hr], ['打点', c.rbi], ['盗塁', c.sb], ['試合', c.g]] : [['防御率', c.era], ['勝利', c.w], ['奪三振', c.k], ['セーブ', c.sv], ['ホールド', c.hld], ['登板', c.g]]).map(([k, v]) => `<div><b>${esc(v)}</b><small>${k}</small></div>`).join('');
  $('#rel')?.addEventListener('click', async () => { if (!confirm(`${p.name} を手放しますか？ (たましいが少しもどります)`)) return; try { const r = await api('/release/' + encodeURIComponent(p.id), { method: 'POST' }); me = r; toast(`手放しました (🔥 +${r.back})`); location.hash = '#team'; } catch (e) { toast(e.message, true); } });
}

// ---------- ドラフト会議 (スカウトつき) ----------
async function viewDraft() {
  loading('ドラフト会議', 'draft');
  let d; try { d = await api('/draft'); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const T = d.times, ph = d.phase, mine = d.mine, sc = d.scout;
  const PH = { entry: ['参加券 受付中', T.deadline], closed: ['まもなく 1 巡目', T.r1], r1: ['1 巡目 指名中', T.r1End], r1wait: ['抽選中…', T.reveal], reveal: ['1 巡目の結果発表', T.r2], r2: ['2 巡目 指名中', T.r2End], done: ['本日のドラフトは終了', null] };
  const canPick = mine && (ph === 'r1' || ph === 'r2'), myPick = ph === 'r1' ? mine?.pick1 : mine?.pick2;
  const freeLeft = Math.max(0, sc.free - sc.used);
  const rep = (p) => { const r = p.scout; if (!r) return ''; const lo = p.kind === 'P' ? [['球速', 'velo', 110, 165], ['変化', 'brk'], ['球威', 'stuff'], ['スタ', 'stamina']] : [['ミート', 'meet'], ['パワー', 'power'], ['走力', 'speed'], ['守備', 'tech']];
    return `<div class="rep">${lo.map(([n, k, mn = 0, mx = 100]) => { const [a, b] = r.est[k] || [0, 0]; return `<div class="rg"><span>${n}</span><span class="track"><i style="left:${(a - mn) / (mx - mn) * 100}%;width:${Math.max(2, (b - a) / (mx - mn) * 100)}%"></i></span><b>${a}〜${b}</b></div>`; }).join('')}
      <div class="rgx"><span>得意 <b>${esc(r.strong)}</b></span><span>苦手 <b>${esc(r.weak)}</b></span><span>将来性 <b class="g-${esc(r.future)}">${esc(r.future)}</b></span><span>適性 <b>${r.pos.map(esc).join('・')}</b></span></div>
      <p class="small">${esc(r.special)}${r.futureNote ? `<br><b class="gold">${esc(r.futureNote)}</b>` : ''}<span class="muted"> · スカウト Lv${r.lv}</span></p></div>`; };
  render(head('ドラフト会議', '毎日 ' + hm(T.r1)) + `
    <section class="hero dr"><p class="eyebrow">${esc(d.day)}</p><h2>${PH[ph][0]}</h2>${PH[ph][1] ? `<p class="cd">あと <b data-cd="${PH[ph][1]}">${left(PH[ph][1])}</b></p>` : ''}
      <ol class="tl">${[['参加券', T.deadline, 'entry'], ['1巡目', T.r1, 'r1'], ['抽選発表', T.reveal, 'reveal'], ['2巡目', T.r2, 'r2']].map(([n, at, k]) => `<li class="${ph === k ? 'on' : ''}"><b>${hm(at)}</b><span>${n}</span></li>`).join('')}</ol>
      ${mine ? `<p class="ok">✅ 参加券あり (${hm(mine.boughtAt)} 購入 · 2巡目はこの順)</p>` : ph === 'entry' ? `<button class="btn gold block" id="buy">参加券を買う 🔥${d.ticket.toLocaleString()}</button>` : '<p class="muted small">今日の参加券の受付は終わりました</p>'}</section>
    ${mine?.got?.length ? `<section class="card"><h3>🎉 獲得した選手</h3>${mine.got.map((p) => plRow(p)).join('')}</section>` : ''}
    ${d.lots.length ? `<section class="card"><h3>1 巡目の結果</h3>${d.lots.map((l) => `<div class="lot${l.me ? ' me' : ''}"><b>${esc(l.name)}</b><span>${l.entrants > 1 ? `${l.entrants}球団競合 → ` : ''}${esc(l.winner)}${l.me ? ' 🎯' : ''}</span></div>`).join('')}</section>` : ''}
    <section class="card scout"><div class="ch"><h3>${icon('search', 18)} スカウト <span class="lvb">Lv${sc.lv}</span></h3>${sc.next != null ? `<button class="btn sm" id="sup">Lv${sc.lv + 1} へ 🔥${sc.next.toLocaleString()}</button>` : '<span class="small gold">最高レベル</span>'}</div>
      <p class="small muted">候補の能力はスカウトで調べると、幅つきの推定でわかります (レベルが高いほど正確)。今日の無料 あと ${freeLeft} 回・そのあと 1 回 🔥${sc.cost}。目玉とは別に、能力は低くても将来化ける「隠し逸材」がいることも</p></section>
    <section class="card flush"><div class="ch pad"><h3>指名候補 (${d.pool.length})</h3><span class="small muted">参加 ${d.teams.length} 球団</span></div>
      ${d.pool.map((p) => `<div class="dp${p.taken ? ' taken' : ''}${myPick === p.id ? ' picked' : ''}" data-dp="${esc(p.id)}"><div class="row"><span class="pic">${art(p, 46, false)}</span><span class="grow"><b>${esc(p.name)}${p.star ? ' <span class="chip star">⭐ 目玉</span>' : ''}${p.taken ? ' <span class="chip">指名済</span>' : ''}</b>
        <small>${'★'.repeat(RN[p.rarity] || 1)}${'☆'.repeat(4 - (RN[p.rarity] || 1))} 評判 · ${p.kind === 'P' ? '投手' : '野手'}・${esc(p.pos)} · ${p.age}歳${p.kind === 'P' ? ` · ${p.pitchesN}球種` : ''}</small>${p.specials?.length ? `<span class="chips">${spChips(p)}</span>` : ''}</span>
        <span class="acts">${!p.scout || p.scout.lv < sc.lv ? `<button class="btn sm" data-scout="${esc(p.id)}">${p.scout ? '再調査' : 'スカウト'}${!p.scout && freeLeft <= 0 ? ` 🔥${sc.cost}` : ''}</button>` : ''}${canPick && !p.taken && !(ph === 'r2' && p.star) ? `<button class="btn sm ${myPick === p.id ? 'gold' : 'p'}" data-pick="${esc(p.id)}">${myPick === p.id ? '指名中' : '指名'}</button>` : ''}</span></div>${rep(p)}</div>`).join('')}</section>`, 'draft');
  $('#buy')?.addEventListener('click', async () => { try { await api('/draft/ticket', { method: 'POST' }); me = await api('/me'); toast('参加券を買いました'); viewDraft(); } catch (e) { toast(e.message, true); } });
  $('#sup')?.addEventListener('click', async () => { if (!confirm(`スカウトを Lv${sc.lv + 1} にしますか？ (🔥${sc.next})`)) return; try { await api('/scout/upgrade', { method: 'POST' }); me = await api('/me'); toast('スカウトのレベルが上がりました'); viewDraft(); } catch (e) { toast(e.message, true); } });
  $$('[data-scout]').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); b.disabled = true; try { const r = await api('/scout', { method: 'POST', body: { player: b.dataset.scout } }); if (r.cost) toast(`スカウトしました (🔥${r.cost})`); me = await api('/me'); viewDraft(); } catch (err) { b.disabled = false; toast(err.message, true); } });
  $$('[data-pick]').forEach((b) => b.onclick = async (e) => { e.stopPropagation(); try { await api('/draft/pick', { method: 'POST', body: { round: ph === 'r1' ? 1 : 2, player: b.dataset.pick } }); toast('指名しました'); viewDraft(); } catch (err) { toast(err.message, true); } });
  $$('.card [data-pid]').forEach((el) => el.onclick = () => { location.hash = '#player/' + encodeURIComponent(el.dataset.pid); });
  // 指名の演出 (まだ見ていない獲得選手)
  const seen = ls.get('bb_draft_seen', []), fresh = (mine?.got || []).filter((p) => !seen.includes(p.id));
  if (fresh.length) { ls.set('bb_draft_seen', [...seen, ...fresh.map((p) => p.id)].slice(-60)); draftReveal(fresh, me.team.name); }
}
function draftReveal(list, team) {
  let i = 0; const m = document.createElement('div'); m.className = 'dfx';
  const show = () => { const p = list[i]; m.innerHTML = `<div class="dfx-in"><p class="dfx-k">第${i === 0 && list.length > 1 ? 1 : list.length > 1 ? 2 : ''}巡選択希望選手</p><p class="dfx-t">${esc(team)}</p><div class="dfx-card">${art(p, 180)}</div><h2>${esc(p.name)}</h2><p>${p.kind === 'P' ? '投手' : '野手'} · ${esc(p.pos)} · ${p.age || ''}歳</p><button class="btn gold block" id="dfn">${i + 1 < list.length ? 'つぎへ' : 'とじる'}</button></div>`;
    $('#dfn', m).onclick = () => { if (++i < list.length) show(); else { m.classList.add('out'); setTimeout(() => m.remove(), 300); } }; };
  document.body.append(m); show();
}

// ---------- その他 ----------
function viewMore() {
  const it = [['league', 'trophy', 'リーグ・順位', '順位表・表彰・ランキング'], ['gacha', 'gacha', 'ガチャ', '前日の活躍選手が入る'], ['news', 'news', 'ニュース', '球団・リーグの出来事'], ['trade', 'trade', 'トレード', `ほかの球団と選手を交換${HOME?.trades ? ` · 📩${HOME.trades}` : ''}`],
    ['zukan', 'book', '選手図鑑・殿堂', '引退した名選手・殿堂入り'], ['install', 'phone', 'アプリとして使う', 'ホーム画面に追加']];
  render(head('その他') + `<div class="menu">${it.map(([k, ic, n, s]) => `<a href="#${k}" class="mi"><span class="mic">${icon(ic, 24)}</span><b>${n}</b><small>${s}</small></a>`).join('')}</div>
    <p class="small muted center">IppO ベースボール · ${esc(me.team.name)}</p>`, 'more');
}

// ---------- ニュース ----------
async function viewNews(cat = '') {
  loading('ニュース', 'news', { back: true });
  let d; try { d = await api('/news?limit=30' + (cat === 'mine' ? '&mine=1' : cat ? '&cat=' + encodeURIComponent(cat) : '')); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const chips = [['', 'すべて'], ['mine', 'マイ球団'], ...Object.entries(d.cats).filter(([k]) => k !== 'game')];
  const item = (n) => `<a class="nl c-${esc(n.cat)}" href="#article/${n.id}"><span class="kick">${esc(n.catName)}</span><b>${esc(n.title)}</b><small>${fmtT(n.at)}${n.team ? ` · ${esc(n.team)}` : ''}${n.imp >= 3 ? ' · <em>重要</em>' : ''}</small></a>`;
  render(head('ニュース', '', { back: true }) + `<div class="chipsel scroll">${chips.map(([k, n]) => `<button data-c="${esc(k)}" class="${cat === k ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
    <div class="card flush paper" id="nl">${d.news.map(item).join('') || '<p class="muted pad">ニュースはまだありません</p>'}</div>${d.news.length >= 30 ? '<button class="btn block" id="moren">もっと見る</button>' : ''}`, 'news');
  $$('[data-c]').forEach((b) => b.onclick = () => viewNews(b.dataset.c));
  let last = d.news[d.news.length - 1]?.id;
  $('#moren')?.addEventListener('click', async (e) => { try { const r = await api(`/news?limit=30&before=${last}` + (cat === 'mine' ? '&mine=1' : cat ? '&cat=' + encodeURIComponent(cat) : '')); $('#nl').insertAdjacentHTML('beforeend', r.news.map(item).join('')); last = r.news[r.news.length - 1]?.id; if (r.news.length < 30) e.target.remove(); } catch (err) { toast(err.message, true); } });
}
async function viewArticle(id) {
  loading('ニュース', 'news', { back: true });
  let d; try { d = await api('/news/' + Number(id)); } catch (e) { if (e instanceof LoginError) throw e; return render(head('ニュース', '', { back: true }) + `<div class="card">${esc(e.message)}</div>`, 'news'); }
  const n = d.news;
  render(head('ニュース', esc(n.catName), { back: true }) + `<article class="card art c-${esc(n.cat)}"><p class="kick">${esc(n.catName)}${n.imp >= 3 ? ' · 重要' : ''}</p><h1>${esc(n.title)}</h1><p class="dl">IppO ベースボール通信 · ${fmtT(n.at)} · シーズン${n.season}</p>
    ${n.team ? `<p class="by">${emblem(n.team, 26)} <b>${esc(n.team)}</b></p>` : ''}<div class="bd">${esc(n.body).replace(/。/g, '。<wbr>')}</div>${n.playerId ? `<a class="btn block" href="#player/${encodeURIComponent(n.playerId)}">${esc(n.player)} のプロフィール ›</a>` : ''}</article>`, 'news');
}

// ---------- トレード ----------
async function viewTrade() {
  loading('トレード', 'trade', { back: true });
  let d; try { d = await api('/trades'); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const ST = { pending: '申請中', accepted: '成立', rejected: '拒否', cancelled: '取り消し', expired: '期限切れ', void: '無効' };
  const side = (list) => list.map((p) => `<div class="tp"><span class="rr r-${esc(p.rarity)}">${esc(p.rarity)}</span> ${esc(p.name)} <small>${esc(p.pos)} · 🔥${Number(p.value).toLocaleString()}</small></div>`).join('');
  const card = (t) => `<div class="tc ${esc(t.status)}"><div class="tch"><b>${t.incoming ? `${esc(t.from.name)} から` : `${esc(t.to.name)} へ`}</b><span class="stt">${ST[t.status] || esc(t.status)}</span></div>
    <div class="tcb"><div><small>${t.incoming ? '相手が出す' : 'あなたが出す'}</small>${side(t.give)}</div><span class="sw">${icon('trade', 20)}</span><div><small>${t.incoming ? 'あなたが出す' : 'もらう'}</small>${side(t.get)}</div></div>
    ${t.message ? `<p class="msg">「${esc(t.message)}」</p>` : ''}<p class="small muted">${t.status === 'pending' ? `期限まで <span data-cd="${t.expiresAt}">${left(t.expiresAt)}</span>` : fmtT(t.decidedAt || t.createdAt)}</p>
    ${t.status === 'pending' ? `<div class="row">${t.incoming ? `<button class="btn grow" data-ta="reject" data-id="${t.id}">拒否</button><button class="btn p grow" data-ta="accept" data-id="${t.id}">承認する</button>` : `<button class="btn grow" data-ta="cancel" data-id="${t.id}">取り消す</button>`}</div>` : ''}</div>`;
  const inc = d.pending.filter((t) => t.incoming), out = d.pending.filter((t) => !t.incoming);
  render(head('トレード', '', { back: true }) + `<a class="cta" href="#tradenew"><span>${icon('search', 26)}</span><div class="grow"><b>新しいトレードを申し込む</b><small>球団を探して、選手をえらぶ (1〜${d.rules.maxSide} 人ずつ)</small></div><em>›</em></a>
    <section class="card"><h3>届いた申し込み (${inc.length})</h3>${inc.map(card).join('') || '<p class="muted small">ありません</p>'}</section>
    <section class="card"><h3>申し込み中 (${out.length})</h3>${out.map(card).join('') || '<p class="muted small">ありません</p>'}</section>
    <section class="card"><h3>履歴</h3>${d.history.map(card).join('') || '<p class="muted small">まだありません</p>'}</section>
    <p class="small muted center">市場価値は参考です。成立するかは相手しだい。申請は ${d.rules.expireHours} 時間で期限切れ。出した選手はほかのトレードに出せません</p>`, 'trade');
  $$('[data-ta]').forEach((b) => b.onclick = async () => { const a = b.dataset.ta; if (a === 'accept' && !confirm('このトレードを承認しますか？ 選手はすぐに移籍します')) return; try { await api(`/trades/${b.dataset.id}/${a}`, { method: 'POST' }); toast(a === 'accept' ? 'トレードが成立しました！' : a === 'reject' ? '拒否しました' : '取り消しました'); me = await api('/me'); HOME = null; viewTrade(); } catch (e) { toast(e.message, true); viewTrade(); } });
}
async function viewTradeNew() {
  render(head('トレード相手を探す', '', { back: true }) + `<div class="card"><div class="row"><input class="in grow" id="q" placeholder="球団名・ユーザー名" maxlength="20"><button class="btn" id="go">${icon('search', 18)}</button></div></div><div class="card flush" id="tl"></div>`, 'trade');
  const load = async () => { try { const r = await api('/trade/teams?q=' + encodeURIComponent($('#q').value)); $('#tl').innerHTML = r.teams.map((t) => `<a class="tm" href="#tradeteam/${t.uid}">${emblem(t.name, 36)}<span class="grow"><b>${esc(t.name)}</b><small>@${esc(t.username)} · ${lgChip(t.league)} · ${t.wins}勝${t.losses}敗 · ${t.players}人</small></span>›</a>`).join('') || '<p class="muted pad">見つかりません</p>'; } catch (e) { toast(e.message, true); } };
  $('#go').onclick = load; $('#q').onkeydown = (e) => { if (e.key === 'Enter') load(); }; load();
}
async function viewTradeTeam(uid) {
  loading('トレード', 'trade', { back: true });
  let d, mine; try { [d, mine] = await Promise.all([api('/trade/team/' + Number(uid)), api('/trades')]); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const sel = { give: new Set(), get: new Set() }, max = mine.rules.maxSide;
  const row = (p, k) => `<label class="pl sel${p.locked && k === 'give' ? ' dis' : ''}"><input type="checkbox" data-k="${k}" value="${esc(p.id)}" ${p.locked && k === 'give' ? 'disabled' : ''}><span class="pic">${art(p, 46, false)}</span><span class="grow"><b>${esc(p.name)}</b><small>${rar(p.rarity)} ${p.kind === 'P' ? '投' : '野'}・${esc(p.pos)}・${p.age}歳 · 🔥${p.value.toLocaleString()}${p.locked ? ' · 🔒申請中' : ''}</small></span>${gradeB(p)}</label>`;
  render(head('トレード', esc(d.team.name), { back: true }) + `<section class="hero tt">${emblem(d.team.name, 56)}<div><h2>${esc(d.team.name)}</h2><p>@${esc(d.team.username)} · ${lgChip(d.team.league)} · ${d.team.wins}勝${d.team.losses}敗</p></div></section>
    <section class="card flush"><div class="ch pad"><h3>ほしい選手 (最大 ${max})</h3></div>${d.players.slice().sort((a, b) => b.ovr - a.ovr).map((p) => row(p, 'get')).join('')}</section>
    <section class="card flush"><div class="ch pad"><h3>あなたが出す選手 (最大 ${max})</h3></div>${mine.mine.slice().sort((a, b) => b.ovr - a.ovr).map((p) => row(p, 'give')).join('')}</section>
    <div class="card"><input class="in" id="msg" maxlength="80" placeholder="ひとこと (任意・80 文字まで)"></div>
    <div class="sticky"><div class="tsum" id="sum"></div><button class="btn p block" id="send" disabled>トレードを申し込む</button></div>`, 'trade');
  const vals = new Map([...d.players, ...mine.mine].map((p) => [p.id, p.value]));
  const upd = () => { const g = [...sel.give].reduce((a, id) => a + vals.get(id), 0), t = [...sel.get].reduce((a, id) => a + vals.get(id), 0); $('#sum').innerHTML = `出す ${sel.give.size}人 (🔥${g.toLocaleString()}) ⇄ もらう ${sel.get.size}人 (🔥${t.toLocaleString()})`; $('#send').disabled = !sel.give.size || !sel.get.size; };
  $$('input[data-k]').forEach((c) => c.onchange = () => { const s = sel[c.dataset.k]; if (c.checked) { if (s.size >= max) { c.checked = false; return toast(`${max} 人までです`, true); } s.add(c.value); } else s.delete(c.value); upd(); });
  upd();
  $('#send').onclick = async () => { try { await api('/trades', { method: 'POST', body: { to: d.team.uid, give: [...sel.give], get: [...sel.get], message: $('#msg').value } }); toast('トレードを申し込みました'); location.hash = '#trade'; } catch (e) { toast(e.message, true); } };
}

// ---------- 選手図鑑・殿堂 ----------
async function viewZukan(tab = 'hof', q = '') {
  loading('選手図鑑', 'zukan', { back: true });
  let d; try { d = await api(`/zukan?tab=${tab}&q=${encodeURIComponent(q)}`); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const card = (p) => tab === 'active' ? plRow(p, `<span class="tag">${esc(p.team)}</span>`)
    : `<div class="ob${p.hof ? ' hof' : ''}" data-pid="${esc(p.id)}"><span class="pic">${art(p, 56, false)}</span><span class="grow"><b>${p.hof ? '🏛 ' : ''}${esc(p.name)}</b><small>${esc(p.team)} · ${p.kind === 'P' ? '投手' : '野手'}・${esc(p.pos)} · 在籍${p.seasons}年 · シーズン${p.retiredSeason}引退</small>
      <small class="tl2">${p.kind === 'B' ? `打率${p.totals.avg} ${p.totals.h}安打 ${p.totals.hr}本 ${p.totals.rbi}打点` : `${p.totals.w}勝${p.totals.l}敗 ${p.totals.sv}S 防${p.totals.era} ${p.totals.k}K`}${p.titles.length ? ` · 🏅${p.titles.length}` : ''}</small>${p.hof ? `<small class="gold">${esc(p.hofReason)}</small>` : ''}</span>${p.hof ? '<span class="medal">殿堂</span>' : ''}</div>`;
  render(head('選手図鑑', '', { back: true }) + `<div class="seg">${[['hof', '🏛 殿堂'], ['retired', '引退選手'], ['active', '現役']].map(([k, n]) => `<a href="#zukan" data-t="${k}" class="${tab === k ? 'on' : ''}">${n}</a>`).join('')}</div>
    <div class="card"><div class="row"><input class="in grow" id="q" value="${esc(q)}" placeholder="選手名でさがす" maxlength="20"><button class="btn" id="go">${icon('search', 18)}</button></div></div>
    ${tab === 'hof' ? `<p class="small muted pad">殿堂入りの基準 (どれか 1 つ): 野手 通算${d.hofRule.B.h}安打・${d.hofRule.B.hr}本塁打・${d.hofRule.B.rbi}打点・タイトル${d.hofRule.B.titles}回 / 投手 通算${d.hofRule.P.w}勝・${d.hofRule.P.sv}セーブ・${d.hofRule.P.k}奪三振・タイトル${d.hofRule.P.titles}回</p>` : ''}
    <div class="card flush">${d.players.map(card).join('') || `<p class="muted pad">${tab === 'hof' ? 'まだ殿堂入りした選手はいません' : tab === 'retired' ? 'まだ引退した選手はいません。選手は年齢を重ねるとシーズンの終わりに引退します' : '見つかりません'}</p>`}</div>`, 'zukan');
  $$('[data-t]').forEach((a) => a.onclick = (e) => { e.preventDefault(); viewZukan(a.dataset.t, $('#q').value); });
  $('#go').onclick = () => viewZukan(tab, $('#q').value);
  $$('[data-pid]').forEach((el) => el.onclick = () => { location.hash = '#player/' + encodeURIComponent(el.dataset.pid); });
}

// ---------- アプリとして使う (ホーム画面に追加) ----------
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function viewInstall() {
  const ios = isIOS();
  render(head('アプリとして使う', '', { back: true }) + `<section class="hero inst">${emblem('IppO', 64)}<h2>ホーム画面から、アプリのように</h2><p>アドレスバーのない画面いっぱいの表示で、すぐに起動できます</p></section>
    ${standalone ? '<div class="card"><b>✅ いまアプリとして開いています</b></div>' : inFrame ? `<div class="card"><p>IppO の中で開いています。野球ゲームだけをアプリにするには、ブラウザで開いてからホーム画面に追加してください。</p><a class="btn gold block" href="/games/baseball/" target="_blank" rel="noopener">ブラウザで開く</a></div>` : ''}
    <section class="card"><h3> iPhone・iPad (Safari)</h3><ol class="steps"><li>Safari でこのページを開く</li><li>画面の下 (iPad は上) の <b>共有ボタン</b> <span class="shr">⬆︎</span> をタップ</li><li>メニューを下へスクロールして <b>「ホーム画面に追加」</b></li><li>右上の <b>「追加」</b> をタップ</li></ol>${ios && !standalone && !inFrame ? '<p class="gold small">↓ 共有ボタンは画面の下にあります</p>' : ''}</section>
    <section class="card"><h3>Android (Chrome)</h3><button class="btn p block" id="inst" ${installEvt ? '' : 'hidden'}>インストールする</button><ol class="steps"><li>右上の <b>︙</b> メニューをタップ</li><li><b>「アプリをインストール」</b> または <b>「ホーム画面に追加」</b></li></ol></section>
    <p class="small muted center">オフラインのときは画面だけ表示され、試合・ガチャなどの操作は通信がもどってからできます</p>`, 'install');
  $('#inst')?.addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; $('#inst')?.setAttribute('hidden', ''); });
}
// はじめてのとき「ホーム画面に追加」の案内 (ブラウザで直接開いたスマホだけ・一度とじたら出さない)
function installHint() {
  if (inFrame || standalone || ls.get('bb_install_hint') || !matchMedia('(max-width: 820px)').matches) return;
  const el = document.createElement('div'); el.className = 'ihint'; el.innerHTML = `${emblem('IppO', 34)}<span class="grow"><b>ホーム画面に追加</b><small>アプリのように全画面で遊べます</small></span><a class="btn sm gold" href="#install">方法</a><button class="ib" aria-label="とじる">${icon('close', 18)}</button>`;
  el.querySelector('button').onclick = () => { ls.set('bb_install_hint', 1); el.remove(); }; el.querySelector('a').onclick = () => { ls.set('bb_install_hint', 1); el.remove(); };
  document.body.append(el);
}

// ---------- リーグ (順位・表彰・ランキング) ----------
async function viewLeague() {
  loading('リーグ', 'league', { back: true });
  let L, R; try { [L, R] = await Promise.all([api('/league'), api('/ranking')]); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  const champ = L.league === 'champion' || L.league === 'king';
  render(head('リーグ', '', { back: true }) + `
    <section class="card"><div class="ch"><h3>${lgChip(L.league)} 順位表</h3><span class="small muted">シーズン ${L.season.id} · あと <span data-cd="${L.season.end}">${left(L.season.end)}</span></span></div>
      <div class="tw"><table class="st std"><tr><th>#</th><th class="l">球団</th><th>勝</th><th>敗</th><th>${champ ? 'レート' : '昇格まで'}</th></tr>
      ${L.teams.map((x, i) => `<tr class="${x.me ? 'me' : ''}"><td>${i + 1}</td><td class="l">${emblem(x.name, 18)} ${x.king ? '👑 ' : ''}${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.wins}</td><td>${x.losses}</td><td>${champ ? x.rate : Math.max(0, 12 - x.lwins)}</td></tr>`).join('')}</table></div>
      <p class="small muted">同じリーグにプレイヤーがいないときは CPU の球団と戦います</p></section>
    <section class="card"><h3>シーズンの表彰</h3><p class="small muted" style="margin-top:0">表彰された選手には、その称号の特殊能力がつきます</p>${L.awards.length ? `<div class="tw"><table class="st"><tr><th>季</th><th class="l">タイトル</th><th class="l">選手</th><th>記録</th></tr>${L.awards.map((a) => `<tr><td>${a.season}</td><td class="l">${esc(a.title)}</td><td class="l">${esc(a.player)} <small class="muted">@${esc(a.owner || '')}</small></td><td>${esc(a.value)}</td></tr>`).join('')}</table></div>` : '<p class="small muted">まだありません (シーズンの終わりに決まります)</p>'}
      ${L.kings.length ? `<p class="small" style="margin:8px 0 0">👑 ${L.kings.map((k) => `King of season ${k.season}: ${esc(k.name || '')} (@${esc(k.username || '')})`).join(' / ')}</p>` : ''}</section>
    <section class="card"><h3>リアルタイム対戦 レート</h3>${R.rt.length ? `<table class="st">${R.rt.map((x, i) => `<tr><td>${i + 1}</td><td class="l">${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.rt_rate}</td><td class="small">${x.rt_w}勝${x.rt_l}敗</td></tr>`).join('')}</table>` : '<p class="small muted">まだいません</p>'}</section>
    <section class="card"><h3>チャンピオン レート</h3>${R.champ.length ? `<table class="st">${R.champ.map((x, i) => `<tr><td>${i + 1}</td><td class="l">${x.league === 'king' ? '👑 ' : ''}${esc(x.name)} <small class="muted">@${esc(x.username)}</small></td><td>${x.rate}</td></tr>`).join('')}</table>` : '<p class="small muted">まだいません</p>'}</section>`, 'league');
}

// ---------- 対戦 (リアルタイム) ----------
function viewPlay() {
  const t = me.team;
  render(head('リアルタイム対戦', 'レート戦') + `
    <section class="hero vs"><p class="eyebrow">RATING</p><h2>${t.rtRate}</h2><p>${t.rtW}勝 ${t.rtL}敗</p></section>
    <div class="card"><button class="btn gold block big" id="q">${icon('play', 22)} 対戦相手を探す</button><div style="height:10px"></div><button class="btn block" id="cpu">CPU と練習 (レートは変わらない)</button><p class="small muted center" id="qs"></p></div>
    <section class="card"><h3>遊び方</h3><ul class="how"><li><b>2 イニング</b> + 延長タイブレーク (無死一・二塁から)</li><li><b>投げる</b>: 球種と場所 (画面をなぞる) を決めて、メーターのまん中でリリース。ずれると失投</li><li><b>打つ</b>: 長押しでミートカーソルを動かし、ボールに合わせて離すとスイング</li></ul></section>`, 'play');
  $('#q').onclick = () => startMatch('queue');
  $('#cpu').onclick = () => startMatch('cpu');
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


function illustEditor(p) {
  if (!p) return;
  const L = { ...(p.look || {}) }; let num = p.number;
  const PAL = [['#1c3f94', '#f8f9fa', '#e03131'], ['#c92a2a', '#f8f9fa', '#1b1b2a'], ['#1b1b2a', '#ffd43b', '#f08c00'], ['#2b8a3e', '#f8f9fa', '#ffd43b'], ['#5f3dc4', '#f8f9fa', '#f783ac'], ['#0b7285', '#f8f9fa', '#ff922b'], ['#e8590c', '#1b1b2a', '#ffffff'], ['#364fc7', '#ffd43b', '#e03131']];
  const sel = (k, label, opts) => `<label class="small">${label}<select class="in" data-k="${k}">${opts.map(([v, n]) => `<option value="${v}" ${String(L[k] ?? '') === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h2 class="grow">✏️ ${esc(p.name)} のイラスト</h2><button class="x" data-close>✕</button></div>
    <div class="row" style="align-items:flex-start;gap:10px;flex-wrap:wrap"><div id="ipv" style="flex:none"></div><div id="ipf" style="flex:none"></div>
    <div class="grow" style="min-width:200px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
      ${sel('pose', 'ポーズ', p.kind === 'P' ? [['', 'おまかせ'], [0, 'ボールを見せる'], [1, 'セットポジション']] : [['', 'おまかせ'], [0, 'バットを肩に'], [1, '両手でバットを持つ']])}
      ${sel('bat', p.kind === 'P' ? '投げる手' : '打つ手', [['R', '右'], ['L', '左']])}
      ${sel('skin', '肌', [[0, 'とても明るい'], [1, '明るい'], [2, '小麦色'], [3, '濃い']])}
      ${sel('hairStyle', '髪型', [['', 'おまかせ'], [0, '短い'], [1, 'もみあげ長め'], [2, 'うしろが長い'], [3, '外はね'], [4, 'ぼうず']])}
      ${sel('eyes', '目', [['', 'おまかせ'], [0, 'するどい'], [1, 'まるい'], [2, '切れ長']])}
      ${sel('mouth', '口', [['', 'おまかせ'], [0, 'ほほえみ'], [1, 'きりっと'], [2, 'にっ']])}
      <label class="small">髪の色<input class="in" style="height:34px;padding:2px" type="color" data-c="hairHex" value="${esc(L.hairHex || '#1b1a22')}"></label>
      <label class="small">目の色<input class="in" style="height:34px;padding:2px" type="color" data-c="eyeHex" value="${esc(L.eyeHex || '#4dabf7')}"></label>
      <label class="small"><input type="checkbox" id="ibd" ${L.beard ? 'checked' : ''}> ひげ</label>
      <label class="small">背番号<input class="in" id="inum" inputmode="numeric" value="${esc(String(num ?? ''))}"></label>
      <label class="small">体格<input type="range" min="0.9" max="1.18" step="0.02" data-r="build" value="${L.build || 1}"></label>
      <label class="small">身長<input type="range" min="0.94" max="1.06" step="0.01" data-r="h" value="${L.h || 1}"></label>
      <div class="small" style="grid-column:1/-1">チームの色 <span class="muted">(メイン・地・アクセント)</span><div class="row" style="gap:4px;flex-wrap:wrap;margin:4px 0">${PAL.map((c, i) => `<button class="btn sm" data-pal="${i}" title="パレット ${i + 1}" style="padding:3px"><span style="display:inline-flex;width:30px;height:14px;border-radius:4px;overflow:hidden">${c.map((x) => `<i style="flex:1;background:${x}"></i>`).join('')}</span></button>`).join('')}</div>
        <div class="row" style="gap:4px">${[0, 1, 2].map((i) => `<input type="color" class="in" data-t="${i}" value="${esc((L.team || PAL[0])[i])}" style="height:34px;padding:2px">`).join('')}</div></div>
    </div></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="ireset">おまかせにもどす</button><span class="grow"></span><button class="btn p" id="isave">保存</button></div>
    <p class="small muted">保存すると、ガチャの「活躍選手」と、すでに引いた人の選手の絵もかわります</p></div>`;
  document.body.append(m);
  const draw = () => { const q = { ...p, number: num, look: L }; $('#ipv', m).innerHTML = window.BBIllust ? window.BBIllust.svg(q, { size: 170 }) : ''; $('#ipf', m).innerHTML = window.BBIllust ? window.BBIllust.svg(q, { size: 64, crop: 'face', name: false }) : ''; };
  draw();
  m.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) { if (t.value === '') L[t.dataset.k] = null; else L[t.dataset.k] = t.dataset.k === 'bat' ? t.value : Number(t.value); } // null = おまかせ
    if (t.dataset.c) L[t.dataset.c] = t.value;
    if (t.dataset.r) L[t.dataset.r] = Number(t.value);
    if (t.dataset.t) { L.team = [...(L.team || PAL[0])]; L.team[Number(t.dataset.t)] = t.value; }
    if (t.id === 'ibd') L.beard = t.checked;
    if (t.id === 'inum') num = Math.max(0, Math.min(99, parseInt(t.value, 10) || 0));
    draw();
  });
  m.addEventListener('click', async (e) => {
    if (e.target === m || e.target.closest('[data-close]')) return m.remove();
    const pb = e.target.closest('[data-pal]'); if (pb) { L.team = [...PAL[Number(pb.dataset.pal)]]; $$('[data-t]', m).forEach((x, i) => { x.value = L.team[i]; }); return draw(); }
    if (e.target.id === 'ireset') { for (const k of ['pose', 'hairStyle', 'eyes', 'mouth', 'team']) L[k] = null; L.hairHex = ''; L.eyeHex = ''; $$('select[data-k]', m).forEach((s) => { if (s.dataset.k !== 'bat' && s.dataset.k !== 'skin') s.value = ''; }); return draw(); }
    if (e.target.id === 'isave') {
      const look = { ...L };
      try { const r = await api('/admin/hot/look', { method: 'POST', body: { id: p.id, look, number: num } }); toast(`保存しました (引いた人の選手 ${r.copies} 人にも反映)`); m.remove(); viewGacha(); } catch (err) { toast(err.message, true); }
    }
  });
}

// ---------- ガチャ ----------
async function viewGacha() {
  loading('ガチャ', 'gacha', { back: true });
  let g; try { g = await api('/gacha'); } catch (e) { if (e instanceof LoginError) throw e; return toast(e.message, true); }
  render(head('ガチャ', `1 回 🔥${g.price}`, { back: true }) + `
    <div class="card"><h2>🎰 選手ガチャ</h2><p class="small">前日の試合で活躍した選手が入っています (🔥 30%)。そのほか SSR 3%・SR 12%・R 30%・N 25%</p>
      <div class="row"><button class="btn p grow" data-n="1">1 回 (🔥${g.price})</button><button class="btn b grow" data-n="10">10 回 (🔥${g.price * 10})</button></div></div>
    <div class="card"><h2>🔥 前日の活躍選手</h2>${g.hot.length ? g.hot.map((p) => plRow(p, me.admin ? `<button class="btn sm" data-edit="${esc(p.id)}">✏️ イラスト</button>` : '')).join('') : '<p class="small muted">まだいません (前の日の試合の活躍で決まります)</p>'}</div>
    ${me.admin ? `<div class="card"><h2>🛠️ 前日の活躍選手 (実名) を登録 <small class="muted">管理者だけ</small></h2>
      <p class="small muted" style="margin-top:0">登録した選手は今日のガチャの「前日の活躍選手」に入ります (30% の枠)。成績のメモは画面に出ます</p>
      <div class="row" style="flex-wrap:wrap;gap:6px"><input class="in" id="hn" placeholder="選手名" maxlength="24" style="flex:2;min-width:140px"><input class="in" id="ht" placeholder="球団" maxlength="20" style="flex:1;min-width:90px"><input class="in" id="hno" placeholder="背番号" inputmode="numeric" style="width:70px"></div>
      <div style="height:6px"></div><input class="in" id="hnote" placeholder="前日の活躍 (例: 3安打 2本塁打 5打点)" maxlength="60">
      <div style="height:6px"></div><div class="row" style="flex-wrap:wrap;gap:6px"><select class="in" id="hk" style="width:auto"><option value="B">野手</option><option value="P">投手</option></select><select class="in" id="hr" style="width:auto"><option>SR</option><option>SSR</option><option>R</option><option>N</option></select><select class="in" id="hpos" style="width:auto">${['捕', '一', '二', '三', '遊', '左', '中', '右', '指', '先', '抑'].map((x) => `<option>${x}</option>`).join('')}</select><select class="in" id="hbat" style="width:auto"><option value="R">右</option><option value="L">左</option></select></div>
      <div style="height:6px"></div><div class="row" style="flex-wrap:wrap;gap:6px" id="hstats"></div>
      <div id="hpit" class="small" style="margin-top:6px"></div>
      <div style="height:8px"></div><button class="btn p block" id="hadd">登録する</button></div>` : ''}
    <div id="res"></div>`, 'gacha');
  $$('[data-n]').forEach((b) => b.onclick = async () => {
    try { const r = await api('/gacha', { method: 'POST', body: { n: Number(b.dataset.n) } }); me = r; $('.souls').textContent = `🔥 ${Number(r.team.souls).toLocaleString()}`;
      try { const G = await import('./gacha3d.js?v=1'); $$('[data-n]').forEach((x) => { x.disabled = true; }); await new Promise((ok) => G.playGacha(r.results, ok)); } catch (e) { console.warn('gacha3d', e); } finally { $$('[data-n]').forEach((x) => { x.disabled = false; }); } // 3D の演出 (読みこめなければ結果だけ)
      $('#res').innerHTML = `<div class="card"><h2>🎉 結果</h2><div class="cards">${r.results.map((p) => `<button class="cardbtn" data-pid="${esc(p.id)}">${art(p, 120)}</button>`).join('')}</div>${r.results.map((p) => plRow(p, p.origin === 'hot' ? '<span class="chip star">🔥活躍</span>' : '')).join('')}</div>`;
      $$('#res [data-pid]').forEach((el) => el.onclick = () => playerModal(r.results.find((p) => p.id === el.dataset.pid)));
      $('#res').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message, true); }
  });
  $$('.card [data-pid]').forEach((el) => el.onclick = () => playerModal(g.hot.find((p) => p.id === el.dataset.pid)));
  if (me.admin) $$('[data-edit]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); illustEditor(g.hot.find((p) => p.id === b.dataset.edit)); });
  if (me.admin) {
    const stats = () => { const P = $('#hk').value === 'P'; $('#hstats').innerHTML = (P ? [['velo', '球速', 148], ['brk', '変化力', 65], ['stuff', '球威', 65], ['stamina', 'スタミナ', 65]] : [['meet', 'ミート', 70], ['power', 'パワー', 70], ['speed', '走力', 55], ['tech', '守備', 60]]).map(([k, n, v]) => `<label class="small" style="flex:1;min-width:70px">${n}<input class="in hs" data-k="${k}" type="number" value="${v}"></label>`).join('');
      $('#hpit').innerHTML = P ? `球種: ${Object.entries(me.pitches).map(([k, n]) => `<label style="white-space:nowrap;margin-right:6px"><input type="checkbox" class="hp" value="${k}" ${['straight', 'slider', 'fork'].includes(k) ? 'checked' : ''}>${esc(n)}</label>`).join('')}` : ''; };
    $('#hk').onchange = stats; stats();
    $('#hadd').onclick = async () => {
      const body = { name: $('#hn').value, team: $('#ht').value, number: $('#hno').value, note: $('#hnote').value, kind: $('#hk').value, rarity: $('#hr').value, pos: $('#hpos').value, bat: $('#hbat').value, pitches: $$('.hp:checked').map((x) => x.value) };
      for (const i of $$('.hs')) body[i.dataset.k] = i.value;
      try { await api('/admin/hot', { method: 'POST', body }); toast('登録しました'); viewGacha(); } catch (e) { toast(e.message, true); }
    };
  }
}


// ---------- 試合の画面と操作 ----------
let ws = null, M = null;
async function startMatch(mode) {
  if (!Stadium) { try { Stadium = await import('./stadium.js?v=6'); } catch (e) { return toast('3D を読みこめませんでした', true); } }
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
  if (m.t === 'half') { M.S.resetView(M.role === 'pitch' ? 'pitch' : 'bat'); show(`${m.state.inning}回${m.state.half ? '裏' : '表'}`, m.tiebreak ? 'タイブレーク: 無死一・二塁から' : '', 1800); hud(m.state); return; }
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
  M.S.resetView(m.role === 'pitch' ? 'pitch' : 'bat'); // 投げるときは投手のうしろから、打つときは捕手のうしろから
  const ctl = $m('#ctl');
  if (m.role === 'pitch') {
    const ps = st.pitcher.pitches || ['straight']; if (!ps.includes(M.pitch)) M.pitch = ps[0];
    ctl.innerHTML = `<div id="hint">球種をえらんで、ゾーンをなぞって場所を決める → 投げる</div><div class="pitches">${ps.map((k) => `<button data-pt="${k}" class="${k === M.pitch ? 'on' : ''}">${esc(C.PITCHES[k]?.name || k)}</button>`).join('')}</div><div id="meter"><span class="g"></span><span class="p"></span><span class="k"></span></div><button class="bigbtn" id="throw">投げる</button>`;
    $$('[data-pt]', ctl).forEach((b) => b.onclick = () => { M.pitch = b.dataset.pt; $$('[data-pt]', ctl).forEach((x) => x.classList.toggle('on', x === b)); preview(); });
    $('#throw', ctl).onclick = startMeter;
    M.S.setAim(M.aim.x, M.aim.y, true); M.S.setMeet(0, 0, 0, false); preview();
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
// 変化の予測: えらんだ球種が、ぴったりのリリースで狙いに来るときの軌道 (黄色い点の線)
function preview() {
  if (!M || M.role !== 'pitch' || M.inFlight) return M?.S.setPath(null);
  const p = M.state.pitcher, pc = C.makePitch({ velo: p.velo, brk: p.brk, stuff: p.stuff }, M.pitch, M.aim, 0.5, 1);
  pc.end = { x: M.aim.x, y: M.aim.y }; pc.wob = 0; // 予測なので、ずれとナックルのゆれは入れない
  M.S.setPath(pc);
  const P = C.PITCHES[M.pitch] || {}, bk = (p.brk || 50) / 50, dx = P.bx * bk, dy = P.by * bk;
  const dir = `${Math.abs(dy) > 0.06 ? (dy < 0 ? '↓' : '↑') : ''}${Math.abs(dx) > 0.06 ? (dx < 0 ? '←' : '→') : ''}` || '→まっすぐ';
  const h = $m('#hint'); if (h) h.textContent = `${P.name || ''} ${Math.round(pc.km)}km 変化 ${dir} ${Math.round(Math.hypot(dx, dy) * 100)}cm · 画面のどこをなぞっても狙いが動く → 投げる`;
}
function onPitched(m) {
  M.inFlight = true; M.S.setAim(0, 0, false); M.S.setPath(null);
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
    if (M.role === 'pitch' && !M.inFlight) { M.dragAim = true; last = p; el.setPointerCapture?.(e.pointerId); } // 指の位置にとばさず、なぞった分だけ動かす
    if (M.role === 'bat') { M.holding = true; last = p; el.setPointerCapture?.(e.pointerId); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!M) return; const p = M.S.screenToPlate(e.clientX, e.clientY); if (!p) return;
    if (M.dragAim && M.role === 'pitch' && !M.inFlight && last) { const k = 1.0; M.aim = { x: C.clamp(M.aim.x + (p.x - last.x) * k, -0.45, 0.45), y: C.clamp(M.aim.y + (p.y - last.y) * k, 0.2, 1.4) }; last = p; M.S.setAim(M.aim.x, M.aim.y); preview(); }
    if (M.holding && M.role === 'bat' && last) { // 長押しのあいだ、指の動きの分だけカーソルが動く (指でカーソルが隠れない)
      M.cursor.x = C.clamp(M.cursor.x + (p.x - last.x) * 1.15, -0.5, 0.5); M.cursor.y = C.clamp(M.cursor.y + (p.y - last.y) * 1.15, 0.2, 1.4); last = p;
      M.S.setMeet(M.cursor.x, M.cursor.y, C.meetR(M.state.batter.meet), true);
    }
  });
  const up = () => { if (!M) return; if (M.dragAim) last = null; M.dragAim = false; if (M.holding) { M.holding = false; last = null; swing(); } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { if (M) { M.holding = false; M.dragAim = false; } });
  // キーボード: 矢印でカーソル・スペースでスイング / リリース
  addEventListener('keydown', (e) => {
    if (!M || M.over) return; const d = 0.03;
    const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
    if (mv && M.role === 'bat') { M.cursor.x = C.clamp(M.cursor.x + mv[0], -0.5, 0.5); M.cursor.y = C.clamp(M.cursor.y + mv[1], 0.2, 1.4); M.S.setMeet(M.cursor.x, M.cursor.y, C.meetR(M.state.batter.meet)); e.preventDefault(); }
    if (mv && M.role === 'pitch' && !M.inFlight) { M.aim.x = C.clamp(M.aim.x + mv[0], -0.45, 0.45); M.aim.y = C.clamp(M.aim.y + mv[1], 0.2, 1.4); M.S.setAim(M.aim.x, M.aim.y); preview(); e.preventDefault(); }
    if (e.key === ' ') { e.preventDefault(); if (M.role === 'bat') swing(); else if (M.role === 'pitch') { const b = $m('#throw'); if (b && !b.disabled) b.click(); } }
  });
  $('#mx').onclick = () => { if (M && !M.over && confirm('降参しますか？ (負けになります)')) ws?.send(JSON.stringify({ t: 'resign' })); };
}


// ---------- 画面の切りかえ ----------
async function route() {
  try { if (!me) me = await api('/me'); }
  catch (e) { splashOff(); if (e instanceof LoginError && !inFrame) return viewLogin(); app.innerHTML = `<div class="page">${head('IppO ベースボール')}<div class="card">${esc(e.message)}</div></div>`; bindCommon(); return; }
  splashOff();
  if (!me.started) return viewStart();
  const [h, arg] = (location.hash || '#home').slice(1).split('/');
  try {
    if (['team', 'order', 'play'].includes(h)) me = await api('/me');
    switch (h) {
      case 'team': return viewTeam('players');
      case 'order': return viewTeam('order');
      case 'player': return await viewPlayer(decodeURIComponent(arg || ''));
      case 'draft': return await viewDraft();
      case 'play': return viewPlay();
      case 'more': return viewMore();
      case 'league': return await viewLeague();
      case 'gacha': return await viewGacha();
      case 'news': return await viewNews();
      case 'article': return await viewArticle(arg);
      case 'trade': return await viewTrade();
      case 'tradenew': return await viewTradeNew();
      case 'tradeteam': return await viewTradeTeam(arg);
      case 'zukan': return await viewZukan();
      case 'install': return viewInstall();
      default: return await viewHome();
    }
  } catch (e) { if (e instanceof LoginError && !inFrame) { me = null; return viewLogin(); } toast(e.message, true); }
}
function splashOff() { const s = $('#splash'); if (s && !s.classList.contains('out')) { s.classList.add('out'); setTimeout(() => s.remove(), 500); } }
addEventListener('hashchange', () => { if (!M) route(); });
route().then(installHint);
// ホームにいるあいだは 1 分ごとに新しくする (演出や入力のじゃまはしない)
setInterval(() => { if (!M && navigator.onLine && (location.hash || '#home') === '#home' && !$('.modal, .awk, .dfx')) viewHome().catch(() => {}); }, 60_000);
// アプリとして使うためのサービスワーカー (IppO の中の iframe では登録しない)
if ('serviceWorker' in navigator && !inFrame) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
