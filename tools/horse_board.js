/* ---------- みんなの結果(IppO 版: IppO のアカウントとデータベース) ---------- */
// 投稿者は IppO のアカウント (表示名・アイコン)。レア度と確率は、サーバーが同じ乱数の種から計算し直したものだけが載る
const NET = {docs:[], stats:null, tab:'new', posted:null, busy:false, ready:false};
const RK_ORDER = ['g1','g2','g3','l','n'];
const S = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
function cleanRow(x){
  if (!x || typeof x !== 'object') return null;
  const p = Number(x.p), t = Number(x.createdAt);
  if (!(p > 0 && p <= 1) || !isFinite(t)) return null;
  const u = (x.user && typeof x.user === 'object') ? x.user : {};
  const user = {id: Number(u.id) || 0, username: S(u.username, 30), displayName: S(u.displayName, 50) || S(u.username, 30) || 'ななし', avatar: (u.avatar && typeof u.avatar === 'object') ? u.avatar : null};
  return {id:x.id, user, mine: !!x.mine, n:S(x.horse, 9) || 'ノーネーム', c:S(x.country, 20), b:S(x.breed, 20), h:S(x.headline, 20), s:S(x.sub, 40), r: RK_ORDER.includes(x.rarity) ? x.rarity : 'n', p, t};
}
function ago(t){
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '時間前'; if (s < 86400 * 30) return Math.floor(s / 86400) + '日前';
  const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
async function loadBoard(){
  try {
    const d = await IPPO.api('/horse/plays?tab=' + (NET.tab === 'rare' ? 'rare' : 'new'));
    NET.docs = (Array.isArray(d.plays) ? d.plays : []).map(cleanRow).filter(Boolean); NET.stats = d.stats; NET.ready = true; renderBoard();
  } catch(e){ if (!NET.ready) boardOffline('みんなの結果を読み込めませんでした。少し待ってから、開き直してください。'); }
}
function renderBoard(){
  if (!NET.ready) return;
  const st = NET.stats || {}, num = v => Number.isFinite(+v) ? +v : 0;
  $('boardStat').textContent = num(st.total) ? `${num(st.players).toLocaleString('ja-JP')}人が、あわせて${num(st.total).toLocaleString('ja-JP')}頭の馬生を載せました。` : 'まだだれも結果を載せていません。';
  const tl = $('boardTally'); tl.innerHTML = '';
  if (num(st.total)) RK_ORDER.forEach(k => { const li = document.createElement('li'); li.textContent = `${RARITY[k].label} ${num(st[k]).toLocaleString('ja-JP')}`; tl.append(li); });
  const feed = $('feed'); feed.innerHTML = '';
  $('feedEmpty').classList.toggle('hidden', NET.docs.length > 0);
  NET.docs.forEach((x, i) => {
    const li = document.createElement('li');
    const rk = document.createElement('span'); rk.className = 'rk rk-' + x.r; rk.textContent = RARITY[x.r].label;
    const nm = document.createElement('span'); nm.className = 'nm';
    if (NET.tab === 'rare'){ const rn = document.createElement('span'); rn.className = 'rank'; rn.textContent = (i + 1) + '位'; nm.append(rn); }
    nm.append(document.createTextNode(x.n));
    const od = document.createElement('span'); od.className = 'odds'; od.textContent = `約${fmtOneIn(x.p)}分の1`;
    const meta = document.createElement('span'); meta.className = 'meta';
    meta.textContent = `${x.c}生まれの${x.b} ／ ` + (x.h === x.b ? (x.s || '') : `${x.h}${x.s ? '(' + x.s + ')' : ''}`) + ' ／ ';
    meta.append(IPPO.userLink(x.user, x.mine), document.createTextNode(' ・ ' + ago(x.t)));
    li.append(rk, nm, od, meta); feed.append(li);
  });
}
function setTab(t){ NET.tab = t; $('tabNew').setAttribute('aria-selected', t === 'new'); $('tabRare').setAttribute('aria-selected', t === 'rare'); loadBoard(); }
$('tabNew').onclick = () => setTab('new');
$('tabRare').onclick = () => setTab('rare');
function boardOffline(msg){ NET.ready = false; $('boardStat').textContent = msg; $('boardTally').innerHTML = ''; $('feed').innerHTML = ''; $('feedEmpty').classList.add('hidden'); }
function initNet(){
  loadBoard();
  setInterval(() => { if (!document.hidden) loadBoard(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadBoard(); });
}
function updatePostBox(){
  const box = document.getElementById('postBox'); if (!box) return;
  box.classList.remove('hidden');
  const btn = $('btnPost'), note = $('postNote');
  btn.disabled = false;
  if (!IPPO.user){ btn.textContent = 'ログインして載せる'; note.textContent = 'みんなの結果に載せるには、IppO へのログインが必要です。ログインしたあとに生まれた馬から載せられます。'; return; }
  if (!life.seedId){ btn.textContent = 'この馬は載せられません'; btn.disabled = true; note.textContent = 'ログインする前や、通信できないときに生まれた馬は、みんなの結果に載せられません。'; return; }
  if (NET.posted && NET.posted === life){ btn.textContent = '載せた内容を更新'; note.textContent = 'みんなの結果に載せました。馬名を変えたら、もう一度押すと書き換わります。'; }
  else { btn.textContent = 'みんなの結果に載せる'; note.textContent = `${IPPO.user.displayName}(@${IPPO.user.username})として、馬名・出生国・結果・確率が、IppO のみんなが見られる「みんなの結果」に載ります。`; }
}
async function postResult(){
  if (!life || NET.busy) return;
  if (!IPPO.user){ IPPO.login(); return; }
  if (!life.seedId) return;
  NET.busy = true; const btn = $('btnPost'); btn.disabled = true;
  const horse = (($('horseName').value || '').trim().slice(0, 9)) || life.horseName || 'ノーネーム';
  try {
    await IPPO.api('/horse/plays', {method:'POST', body:{seedId:life.seedId, horse, country:life.c.ja, breed:life.breed, headline:life.headline, sub:(life.sub || '').slice(0, 40), rarity:rarityOf(life), p:life.p}});
    NET.posted = life; sfx.win(); updatePostBox(); loadBoard();
  } catch(e){
    $('postNote').textContent = e.status === 429 ? '短い時間に載せすぎました。10分ほど待ってから、もう一度押してください。'
      : e.status === 401 ? 'ログインが切れました。ログインし直してください。'
      : (e.message && e.status ? e.message : '載せられませんでした。通信を確かめて、もう一度押してください。');
  } finally { NET.busy = false; btn.disabled = !life.seedId; }
}
