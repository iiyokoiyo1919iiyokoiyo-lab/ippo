'use strict';
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
let me = null;

// ---------- ユーティリティ ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noAuthPrompt) openAuth();
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}
function timeAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return Math.max(1, Math.floor(s)) + '秒';
  if (s < 3600) return Math.floor(s / 60) + '分';
  if (s < 86400) return Math.floor(s / 3600) + '時間';
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function avatar(u, cls = '') {
  let h = 0; for (const c of u.username) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<div class="avatar ${cls}" style="background:hsl(${h} 55% 45%)">${esc([...u.displayName][0] || '?')}</div>`;
}
const URL_RE = /https?:\/\/[^\s<>"'「」、。）)]+/g;
function richText(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out.push(inlineMarkup(text.slice(last, m.index)));
    const url = m[0];
    let label = url.replace(/^https?:\/\//, '');
    if (label.length > 40) label = label.slice(0, 40) + '…';
    out.push(`<span class="vlink" data-url="${esc(url)}" title="仮想環境で開く: ${esc(url)}">${esc(label)}</span>`);
    last = m.index + url.length;
  }
  out.push(inlineMarkup(text.slice(last)));
  return out.join('');
}
function inlineMarkup(s) {
  return esc(s)
    .replace(/(^|[^\w])@([A-Za-z0-9_]{3,15})/g, '$1<a href="#/u/$2">@$2</a>')
    .replace(/(^|\s)#([^\s#]{1,50})/g, (m, p, tag) => `${p}<a href="#/search?q=${encodeURIComponent('#' + tag)}">#${tag}</a>`);
}
// 動画ファイルの URL (mp4 / webm / m4v / mov) はその場で再生する。動画はサーバー経由で読み込む
function isVideoUrl(url) {
  try { return /\.(mp4|webm|m4v|mov)$/i.test(new URL(url).pathname); } catch { return false; }
}
function videoEmbed(url) {
  return `<div class="video-wrap"><video controls playsinline preload="metadata" src="/api/media?url=${encodeURIComponent(url)}"></video>
    <span class="vlink video-src" data-url="${esc(url)}">元のページを仮想ブラウザで開く</span></div>`;
}
function firstUrl(text) { const m = text.match(URL_RE); return m ? m[0] : null; }

// ---------- 投稿の描画 ----------
function renderPost(item, { focus = false } = {}) {
  const p = item.type === 'repost' ? item.post : item;
  const ctx = item.type === 'repost' ? `<div class="ctx">🔁 ${esc(item.by.displayName)}さんがリポストしました</div>` : '';
  const url = firstUrl(p.content);
  let card = '';
  if (url && isVideoUrl(url) && me) {
    card = videoEmbed(url);
  } else if (url) {
    let host = url; try { host = new URL(url).hostname; } catch {}
    const sub = isVideoUrl(url) ? '🎬 動画 · ログインすると再生できます' : '仮想環境で安全に開く';
    card = `<div class="link-card" data-url="${esc(url)}"><div class="lc-icon">🛡</div><div><div class="lc-host">${esc(host)}</div><div class="lc-sub">${sub}</div></div></div>`;
  }
  const tags = (p.community ? `<div class="post-tag">👥 <a href="#/c/${esc(p.community.slug)}">${esc(p.community.name)}</a></div>` : '') +
    (p.question ? '<div class="post-tag">💡 <a href="#/q">今日の質問への回答</a></div>' : '');
  const reply = p.replyToUser ? `<div class="muted">返信先: <a href="#/u/${esc(p.replyToUser)}">@${esc(p.replyToUser)}</a></div>` : '';
  const del = me && me.id === p.author.id ? `<button class="del" title="削除">🗑</button>` : '';
  return `${ctx}<article class="post${focus ? ' focus' : ''}" data-id="${p.id}">
    ${avatar(p.author)}
    <div class="body">
      <div class="meta"><b><a href="#/u/${esc(p.author.username)}" style="color:inherit">${esc(p.author.displayName)}</a></b>
        <span>@${esc(p.author.username)}</span><span>·</span><span title="${new Date(p.createdAt).toLocaleString()}">${timeAgo(p.createdAt)}</span></div>
      ${tags}${reply}
      <div class="text">${richText(p.content)}</div>
      ${card}
      <div class="actions">
        <button class="reply" title="返信">💬 <span>${p.counts.replies || ''}</span></button>
        <button class="repost${p.reposted ? ' on' : ''}" title="リポスト">🔁 <span>${p.counts.reposts || ''}</span></button>
        <button class="like${p.liked ? ' on' : ''}" title="いいね">${p.liked ? '❤️' : '🤍'} <span>${p.counts.likes || ''}</span></button>
        <button class="share" title="リンクをコピー">🔗</button>
        ${del}
      </div>
    </div>
  </article>`;
}

function updatePostEls(p) {
  document.querySelectorAll(`.post[data-id="${p.id}"]`).forEach((el) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderPost(p, { focus: el.classList.contains('focus') });
    el.replaceWith(tmp.querySelector('.post'));
  });
}

// 投稿のクリック操作 (イベント委譲)
main.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-url]');
  if (link) { e.stopPropagation(); return VB.open(link.dataset.url); }
  const postEl = e.target.closest('.post');
  if (!postEl || e.target.closest('a, video')) return;
  const id = postEl.dataset.id;
  const btn = e.target.closest('.actions button');
  if (!btn) return (location.hash = '#/p/' + id);
  if (!me) return openAuth();
  try {
    if (btn.classList.contains('like')) updatePostEls((await api(`/posts/${id}/like`, { method: btn.classList.contains('on') ? 'DELETE' : 'POST' })).post);
    else if (btn.classList.contains('repost')) updatePostEls((await api(`/posts/${id}/repost`, { method: btn.classList.contains('on') ? 'DELETE' : 'POST' })).post);
    else if (btn.classList.contains('reply')) openCompose(id, postEl.querySelector('.meta span').textContent);
    else if (btn.classList.contains('share')) { await navigator.clipboard?.writeText(location.origin + '/#/p/' + id); btn.textContent = '✅'; }
    else if (btn.classList.contains('del') && confirm('この投稿を削除しますか？')) { await api('/posts/' + id, { method: 'DELETE' }); postEl.remove(); }
  } catch (err) { alert(err.message); }
});

// ---------- 投稿フォーム ----------
function composeHtml(placeholder = 'いまどうしてる？') {
  return `<div class="compose">${me ? avatar(me) : ''}<div style="flex:1">
    <textarea placeholder="${esc(placeholder)}" maxlength="400"></textarea>
    <div class="row"><span class="count muted">280</span><button class="btn primary" type="button" disabled>投稿する</button></div></div></div>`;
}
function bindCompose(root, { replyTo = null, onDone, extra = {} } = {}) {
  const ta = $('textarea', root), btn = $('.btn', root), count = $('.count', root);
  ta.addEventListener('input', () => {
    const n = 280 - [...ta.value].length;
    count.textContent = n; count.classList.toggle('over', n < 0);
    btn.disabled = !ta.value.trim() || n < 0;
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { post } = await api('/posts', { method: 'POST', body: { ...extra, content: ta.value, replyTo } });
      ta.value = ''; ta.dispatchEvent(new Event('input'));
      onDone && onDone(post);
    } catch (e) { alert(e.message); btn.disabled = false; }
  });
}
function openCompose(replyTo = null, handle = '', { extra = {}, title = '', placeholder = '' } = {}) {
  if (!me) return openAuth();
  const dlg = $('#compose-dialog');
  const slot = $('#compose-modal-slot');
  // コミュニティ画面で開いた場合は、そのコミュニティに投稿する
  const cm = !replyTo && !extra.question && location.hash.match(/^#\/c\/([A-Za-z0-9_-]+)/);
  if (cm && $('#community-compose')) { extra = { community: cm[1] }; title = title || '👥 ' + ($('.community-head h2')?.textContent || '') + ' に投稿'; }
  slot.innerHTML = (replyTo ? `<div class="muted" style="padding:0 16px">返信先: ${esc(handle)}</div>` : '') +
    (title ? `<div class="compose-title">${esc(title)}</div>` : '') +
    composeHtml(placeholder || (replyTo ? '返信をポスト' : 'いまどうしてる？'));
  bindCompose(slot, { replyTo, extra, onDone: () => { dlg.close(); route(); } });
  dlg.showModal();
  $('textarea', slot).focus();
}
$('#open-compose').addEventListener('click', () => openCompose());

// ---------- 認証 ----------
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  const f = $('#auth-form');
  f.classList.toggle('login', m === 'login');
  $('#auth-title').textContent = m === 'login' ? 'ログイン' : 'アカウントを作成';
  $('#auth-submit').textContent = m === 'login' ? 'ログイン' : '登録する';
  $('#auth-toggle').textContent = m === 'login' ? 'アカウントを作成' : 'ログインはこちら';
  $('#auth-error').textContent = '';
}
function openAuth(mode = 'login') { setAuthMode(mode); $('#auth-dialog').showModal(); }
$('#auth-toggle').addEventListener('click', (e) => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'register' : 'login'); });
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  try {
    const { user } = await api(authMode === 'login' ? '/login' : '/register', { method: 'POST', body: fd, noAuthPrompt: true });
    me = user; $('#auth-dialog').close(); e.target.reset(); renderMe(); route();
  } catch (err) { $('#auth-error').textContent = err.message; }
});
$('#auth-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

function renderMe() {
  const box = $('#me-box');
  if (me) {
    box.innerHTML = `<div class="user-row">${avatar(me)}<div class="names"><b>${esc(me.displayName)}</b><div class="muted">@${esc(me.username)}</div></div></div><a href="#/settings" style="font-size:14px">⚙️ 設定</a> · <a href="#" id="logout" style="font-size:14px">ログアウト</a>`;
    $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/logout', { method: 'POST' }); me = null; renderMe(); route(); });
  } else {
    box.innerHTML = `<button class="btn primary" id="login-btn" style="width:100%">ログイン / 登録</button>`;
    $('#login-btn').addEventListener('click', () => openAuth());
  }
  loadSuggest();
  loadTrends();
  refreshDmBadge();
}

async function loadSuggest() {
  const { users } = await api('/users', { noAuthPrompt: true }).catch(() => ({ users: [] }));
  $('#suggest .list').innerHTML = users.length ? users.map(userRow).join('') : '<p class="muted">まだいません</p>';
}
function userRow(u) {
  const btn = me && me.id !== u.id ? `<button class="btn ${u.followed ? 'outline' : ''} follow-btn" data-user="${esc(u.username)}" data-on="${u.followed ? 1 : 0}">${u.followed ? 'フォロー中' : 'フォロー'}</button>` : '';
  return `<div class="user-row">${avatar(u)}<div class="names"><a href="#/u/${esc(u.username)}">${esc(u.displayName)}</a><div class="muted">@${esc(u.username)}</div></div>${btn}</div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.follow-btn');
  if (!b) return;
  if (!me) return openAuth();
  const on = b.dataset.on === '1';
  try {
    const { user } = await api(`/users/${b.dataset.user}/follow`, { method: on ? 'DELETE' : 'POST' });
    b.dataset.on = user.followed ? '1' : '0';
    b.textContent = user.followed ? 'フォロー中' : 'フォロー';
    b.classList.toggle('outline', user.followed);
    const f = $('#followers-count'); if (f) f.textContent = user.stats.followers;
  } catch (err) { alert(err.message); }
});

// ---------- 画面 ----------
let tlMode = 'all';
async function viewHome() {
  main.innerHTML = `<div class="head"><h2>ホーム</h2><div class="tabs">
    <button data-mode="all" class="${tlMode === 'all' ? 'active' : ''}">おすすめ</button>
    <button data-mode="following" class="${tlMode === 'following' ? 'active' : ''}">フォロー中</button></div></div>
    ${me ? `<div id="home-compose">${composeHtml()}</div>` : `<div class="empty">ログインすると投稿できます<br><br><button class="btn primary" id="start-btn">はじめる</button></div>`}
    <div class="question-card hidden" id="question-card"></div>
    <div id="feed"></div>`;
  questionCard();
  main.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'following' && !me) return openAuth();
    tlMode = b.dataset.mode; viewHome();
  }));
  $('#start-btn')?.addEventListener('click', () => openAuth('register'));
  if (me) bindCompose($('#home-compose'), { onDone: (p) => { $('#feed .empty')?.remove(); $('#feed').insertAdjacentHTML('afterbegin', renderPost(p)); } });
  await loadFeed((before) => `/timeline?mode=${tlMode}${before ? '&before=' + before : ''}`, 'まだ投稿がありません。リンク付きで最初の投稿をしてみましょう！');
}

async function loadFeed(pathFn, emptyMsg, feedEl = $('#feed')) {
  let before = null;
  const more = async () => {
    const { posts } = await api(pathFn(before), { noAuthPrompt: true });
    $('.more', feedEl)?.remove();
    if (!posts.length && !before) feedEl.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    feedEl.insertAdjacentHTML('beforeend', posts.map((p) => renderPost(p)).join(''));
    if (posts.length === 30) {
      before = posts[posts.length - 1].id;
      feedEl.insertAdjacentHTML('beforeend', '<button class="more">さらに読み込む</button>');
      $('.more', feedEl).addEventListener('click', more);
    }
  };
  await more();
}

async function viewPost(id) {
  main.innerHTML = `<div class="head"><h2><a href="#/" id="back-link" style="color:inherit">←</a> ポスト</h2></div><div id="thread"></div>`;
  $('#back-link').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  try {
    const { post, ancestors, replies } = await api('/posts/' + id, { noAuthPrompt: true });
    $('#thread').innerHTML = ancestors.map((p) => renderPost(p)).join('') + renderPost(post, { focus: true }) +
      (me ? `<div id="reply-compose">${composeHtml('返信をポスト')}</div>` : '') +
      `<div id="replies">${replies.map((p) => renderPost(p)).join('')}</div>`;
    if (me) bindCompose($('#reply-compose'), { replyTo: post.id, onDone: (p) => $('#replies').insertAdjacentHTML('beforeend', renderPost(p)) });
  } catch (e) { $('#thread').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function viewUser(username) {
  main.innerHTML = '<div class="empty">読み込み中…</div>';
  try {
    const { user } = await api('/users/' + encodeURIComponent(username) + '?before=0', { noAuthPrompt: true });
    const isMe = me && me.id === user.id;
    main.innerHTML = `<div class="head"><h2>${esc(user.displayName)}</h2></div>
      <div class="profile-head"><div class="banner"></div>
        <div class="top">${avatar(user, 'lg')}
          ${isMe ? '<span class="profile-btns"><a class="btn outline dm-btn" href="#/settings" title="設定">⚙️</a><button class="btn outline" id="edit-profile">プロフィールを編集</button></span>' : me ? `<span class="profile-btns"><a class="btn outline dm-btn" href="#/dm/${esc(user.username)}" title="メッセージを送る">✉️</a><button class="btn ${user.followed ? 'outline' : ''} follow-btn" data-user="${esc(user.username)}" data-on="${user.followed ? 1 : 0}">${user.followed ? 'フォロー中' : 'フォロー'}</button></span>` : ''}
        </div>
        <h2>${esc(user.displayName)}</h2><div class="muted">@${esc(user.username)}</div>
        ${user.bio ? `<p>${richText(user.bio)}</p>` : ''}
        <div class="muted">📅 ${new Date(user.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}から利用</div>
        <div class="stats"><span><b>${user.stats.following}</b> フォロー</span><span><b id="followers-count">${user.stats.followers}</b> フォロワー</span><span><b>${user.stats.posts}</b> ポスト</span></div>
      </div><div id="feed"></div>`;
    $('#edit-profile')?.addEventListener('click', async () => {
      const displayName = prompt('表示名', user.displayName); if (displayName === null) return;
      const bio = prompt('自己紹介（160文字まで）', user.bio); if (bio === null) return;
      me = (await api('/me', { method: 'PATCH', body: { displayName, bio } })).user; renderMe(); viewUser(username);
    });
    main.querySelector('.profile-head').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) VB.open(l.dataset.url); });
    await loadFeed((before) => `/users/${encodeURIComponent(username)}${before ? '?before=' + before : ''}`, 'まだ投稿がありません');
  } catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function viewSearch(q) {
  main.innerHTML = `<div class="head"><h2>検索</h2><form class="search-box" id="sf"><input name="q" placeholder="キーワード・#タグ・ユーザー" value="${esc(q)}"></form></div><div id="res"></div>`;
  $('#sf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent(e.target.q.value); });
  if (!q) {
    $('#res').innerHTML = '<p class="muted" style="padding:0 16px">投稿やユーザーを検索できます。URLを入力すると仮想ブラウザで開けます。</p><h3 class="section-title">🔥 トレンド</h3><div class="search-trends">読み込み中…</div>';
    $('.search-trends').innerHTML = await trendsHtml().catch(() => '<p class="muted">読み込めませんでした</p>');
    return;
  }
  if (/^https?:\/\//.test(q)) return VB.open(q);
  const { posts, users } = await api('/search?q=' + encodeURIComponent(q), { noAuthPrompt: true });
  $('#res').innerHTML = (users.length ? `<div style="padding:0 16px;border-bottom:1px solid var(--line)">${users.map((u) => userRow({ ...u, followed: false })).join('')}</div>` : '') +
    (posts.length ? posts.map((p) => renderPost(p)).join('') : '<div class="empty">該当する投稿はありません</div>');
}

let viewCleanup = null;
function route() {
  if (viewCleanup) { viewCleanup(); viewCleanup = null; }
  const h = location.hash.slice(1) || '/';
  document.querySelectorAll('.side [data-nav]').forEach((a) => a.classList.remove('active'));
  refreshDmBadge();
  let m;
  if (h === '/c' || h.startsWith('/c/')) {
    $('[data-nav=c]').classList.add('active');
    if ((m = h.match(/^\/c\/([A-Za-z0-9_-]+)/))) return viewCommunity(m[1]);
    return viewCommunities();
  }
  if (h === '/q') return viewQuestion();
  if (h === '/schedule') { $('[data-nav=schedule]').classList.add('active'); return viewSchedule(); }
  if (h === '/settings') { if (!me) { openAuth(); location.hash = '#/'; return; } return viewSettings(); }
  if (h.startsWith('/dm')) {
    $('[data-nav=dm]').classList.add('active');
    if (!me) { openAuth(); location.hash = '#/'; return; }
    if ((m = h.match(/^\/dm\/([A-Za-z0-9_]+)/))) return viewDmThread(m[1]);
    return viewDmList();
  }
  if ((m = h.match(/^\/p\/(\d+)/))) return viewPost(m[1]);
  if ((m = h.match(/^\/u\/([A-Za-z0-9_]+)/))) return viewUser(m[1]);
  if (h === '/me') { if (!me) { openAuth(); location.hash = '#/'; return; } location.hash = '#/u/' + me.username; return; }
  if (h.startsWith('/search')) { $('[data-nav=search]').classList.add('active'); return viewSearch(new URLSearchParams(h.split('?')[1] || '').get('q') || ''); }
  $('[data-nav=home]').classList.add('active');
  viewHome();
}
window.addEventListener('hashchange', route);

// =====================================================================
// 今日の質問
// =====================================================================
async function questionCard() {
  const el = $('#question-card');
  if (!el) return;
  try {
    const q = await api('/question', { noAuthPrompt: true });
    el.innerHTML = `<div class="q-label">💡 今日の質問</div>
      <div class="q-text">${esc(q.text)}</div>
      <div class="q-actions">
        <button class="btn primary" id="q-answer" type="button">${q.answered ? 'もう一度答える' : '答える'}</button>
        <a class="btn outline" href="#/q">みんなの回答${q.answers ? `（${q.answers}）` : ''}</a>
      </div>`;
    $('#q-answer').addEventListener('click', () => openCompose(null, '', { extra: { question: true }, title: `💡 ${q.text}`, placeholder: 'あなたの答えは？' }));
    el.classList.remove('hidden');
  } catch { el.classList.add('hidden'); }
}

async function viewQuestion() {
  main.innerHTML = `<div class="head"><h2><a href="#/" style="color:inherit">←</a> 今日の質問</h2></div>
    <div class="question-card" id="question-card"></div><div id="feed"></div>`;
  questionCard();
  await loadFeed((before) => `/question/answers${before ? '?before=' + before : ''}`, 'まだ回答がありません。最初に答えてみましょう！');
}

// =====================================================================
// トレンド
// =====================================================================
async function trendsHtml() {
  const { period, trends } = await api('/trends', { noAuthPrompt: true });
  if (!trends.length) return '<p class="muted">まだトレンドはありません。<br>みんなの投稿によく出てくる言葉がここに表示されます</p>';
  return trends.map((t, i) => `<a class="trend-row" href="#/search?q=${encodeURIComponent(t.tag)}">
      <span class="muted trend-rank">${i + 1}</span>
      <span class="trend-body"><b>${esc(t.tag)}</b><span class="muted">${t.posts}件の投稿 · ${t.users}人</span></span>
    </a>`).join('') + `<p class="muted trend-period">直近${period}の集計</p>`;
}
async function loadTrends() {
  const el = $('#trends .list');
  if (el) el.innerHTML = await trendsHtml().catch(() => '<p class="muted">読み込めませんでした</p>');
}
setInterval(() => { if (!document.hidden) loadTrends(); }, 120_000);

// =====================================================================
// コミュニティ
// =====================================================================
function communityRow(c) {
  return `<a class="community-row" href="#/c/${esc(c.slug)}">
    <div class="community-icon">${esc([...c.name][0] || '?')}</div>
    <div class="community-body"><b>${esc(c.name)}</b><span class="muted">${c.members}人のメンバー${c.joined ? ' · 参加中' : ''}</span>
      ${c.description ? `<div class="community-desc">${esc(c.description)}</div>` : ''}</div>
  </a>`;
}

async function viewCommunities() {
  main.innerHTML = `<div class="head"><h2>コミュニティ</h2></div>
    ${me ? `<details class="community-create"><summary>＋ コミュニティを作る</summary>
      <form id="community-form" class="auth">
        <input name="name" placeholder="コミュニティ名（例: 猫好きの集い）" maxlength="50" required>
        <input name="slug" placeholder="ID（英数字と - _ で3〜30文字。URLになります）" pattern="[A-Za-z0-9_\\-]{3,30}" required>
        <textarea name="description" placeholder="説明（任意・300文字まで）" maxlength="300" rows="3"></textarea>
        <p class="error" id="community-error"></p>
        <button class="btn primary" type="submit">作成する</button>
      </form></details>` : ''}
    <div id="community-list"><div class="empty">読み込み中…</div></div>`;
  $('#community-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { community } = await api('/communities', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      location.hash = '#/c/' + community.slug;
    } catch (err) { $('#community-error').textContent = err.message; }
  });
  const [all, mine] = await Promise.all([
    api('/communities', { noAuthPrompt: true }),
    me ? api('/communities?mine=1', { noAuthPrompt: true }) : Promise.resolve({ communities: [] }),
  ]);
  $('#community-list').innerHTML =
    (mine.communities.length ? `<h3 class="section-title">参加中</h3>${mine.communities.map(communityRow).join('')}` : '') +
    `<h3 class="section-title">みんなのコミュニティ</h3>` +
    (all.communities.length ? all.communities.map(communityRow).join('') : '<div class="empty">まだコミュニティがありません。最初のコミュニティを作ってみましょう！</div>');
}

async function viewCommunity(slug) {
  main.innerHTML = '<div class="empty">読み込み中…</div>';
  let c;
  try { c = (await api('/communities/' + encodeURIComponent(slug) + '?before=0', { noAuthPrompt: true })).community; }
  catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const joinBtn = !me ? '' : c.isOwner
    ? '<button class="btn outline danger" id="community-delete" type="button">削除</button>'
    : `<button class="btn ${c.joined ? 'outline' : 'primary'}" id="community-join" type="button">${c.joined ? '参加中' : '参加する'}</button>`;
  main.innerHTML = `<div class="head"><h2><a href="#/c" style="color:inherit">←</a> ${esc(c.name)}</h2></div>
    <div class="profile-head community-head">
      <div class="banner"></div>
      <div class="top"><div class="community-icon lg">${esc([...c.name][0] || '?')}</div>${joinBtn}</div>
      <h2>${esc(c.name)}</h2><div class="muted">/c/${esc(c.slug)} · 作成: <a href="#/u/${esc(c.owner.username)}">@${esc(c.owner.username)}</a></div>
      ${c.description ? `<p>${richText(c.description)}</p>` : ''}
      <div class="stats"><span><b>${c.members}</b> メンバー</span></div>
    </div>
    ${c.joined ? `<div id="community-compose">${composeHtml(`${c.name} に投稿`)}</div>` : me ? '<div class="empty">参加すると投稿できます</div>' : ''}
    <div id="feed"></div>`;
  $('#community-join')?.addEventListener('click', async () => {
    try {
      await api(`/communities/${encodeURIComponent(slug)}/join`, { method: c.joined ? 'DELETE' : 'POST' });
      viewCommunity(slug);
    } catch (e) { alert(e.message); }
  });
  $('#community-delete')?.addEventListener('click', async () => {
    if (!confirm(`「${c.name}」を削除しますか？\nコミュニティ内の投稿もすべて削除され、元に戻せません。`)) return;
    try { await api('/communities/' + encodeURIComponent(slug), { method: 'DELETE' }); location.hash = '#/c'; } catch (e) { alert(e.message); }
  });
  if (c.joined) bindCompose($('#community-compose'), { extra: { community: c.slug }, onDone: (p) => { $('#feed .empty')?.remove(); $('#feed').insertAdjacentHTML('afterbegin', renderPost(p)); } });
  main.querySelector('.community-head').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) VB.open(l.dataset.url); });
  await loadFeed((before) => `/communities/${encodeURIComponent(slug)}${before ? '?before=' + before : ''}`, 'まだ投稿がありません');
}

// =====================================================================
// 設定 / 緊急データ削除
// =====================================================================
function viewSettings() {
  main.innerHTML = `<div class="head"><h2>設定</h2></div>
    <section class="settings-section">
      <h3>アカウント</h3>
      <p class="muted">@${esc(me.username)} でログイン中</p>
      <div class="settings-buttons">
        <a class="btn outline" href="#/u/${esc(me.username)}">プロフィールを見る</a>
        <button class="btn outline" id="settings-logout" type="button">ログアウト</button>
      </div>
    </section>
    <section class="settings-section danger-zone">
      <h3>🚨 緊急データ削除</h3>
      <p>あなたのデータをすぐに、完全に削除します。<b>元に戻すことはできません。</b></p>
      <ul class="muted">
        <li>投稿・返信・リポスト・いいね・今日の質問への回答</li>
        <li>DM（<b>相手の画面からも消えます</b>）</li>
        <li>フォロー／フォロワー、参加中のコミュニティ、作成したコミュニティ（中の投稿も含む）</li>
        <li>開いている仮想ブラウザ（閲覧履歴・Cookie）</li>
      </ul>
      <p class="muted">削除したデータは、サーバーのデータベースファイル上でも上書きされ、痕跡が残りません。この端末に保存された設定も消去します。</p>
      <form id="wipe-form" class="auth">
        <label class="wipe-option"><input type="radio" name="mode" value="content" checked> <span><b>履歴をすべて削除</b><br><span class="muted">アカウント（ユーザー名・パスワード）は残ります。他の端末はログアウトされます</span></span></label>
        <label class="wipe-option"><input type="radio" name="mode" value="account"> <span><b>アカウントごと完全に削除</b><br><span class="muted">ユーザー名も含めて、すべてが消えます</span></span></label>
        <input name="password" type="password" placeholder="確認のためパスワードを入力" autocomplete="current-password" required>
        <p class="error" id="wipe-error"></p>
        <button class="btn danger-btn" type="submit">今すぐ削除する</button>
      </form>
    </section>`;
  $('#settings-logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); me = null; renderMe(); location.hash = '#/'; });
  $('#wipe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const label = fd.mode === 'account' ? 'アカウントとすべてのデータ' : 'すべての履歴';
    if (!confirm(`${label}を完全に削除します。元に戻せません。よろしいですか？`)) return;
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true; btn.textContent = '削除しています…';
    try {
      await api('/me/wipe', { method: 'POST', body: fd, noAuthPrompt: true });
      VB.close();
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
      if (fd.mode === 'account') { me = null; }
      alert(fd.mode === 'account' ? 'アカウントとすべてのデータを削除しました。' : 'すべての履歴を削除しました。');
      location.replace('/#/');
      location.reload();
    } catch (err) {
      $('#wipe-error').textContent = err.message;
      btn.disabled = false; btn.textContent = '今すぐ削除する';
    }
  });
}

// =====================================================================
// 予定表 (学校の行事予定表を PDF から書き起こしたデータを表示する)
// データ: /schedules/index.json と /schedules/<id>.json
// =====================================================================
const SCHEDULE_CATS = {
  exam: { label: '試験', icon: '📝' },
  event: { label: '行事', icon: '🎉' },
  off: { label: '休日・休業', icon: '🏖' },
  staff: { label: '教職員', icon: '👔' },
};
function scheduleCategory(text) {
  if (/(閉校|休業|代休|寮閉鎖|の日|祝日)/.test(text)) return 'off';
  if (/(考査|到達度試験|模試|プレテスト|英検|入試(?!説明会|体験会|準備)|転入学考査)/.test(text)) return 'exam';
  if (/(職員会議|教職員|審査会|入試準備|県外校視察)/.test(text)) return 'staff';
  return 'event';
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const todayYmd = () => ymd(new Date());

let scheduleCache = null;
async function loadSchedule() {
  if (scheduleCache) return scheduleCache;
  const idx = await fetch('/schedules/index.json').then((r) => r.json());
  // 今日を含む予定表、なければいちばん新しいもの
  const t = todayYmd();
  const meta = idx.schedules.find((s) => s.start <= t && t <= s.end) || idx.schedules[idx.schedules.length - 1];
  const data = await fetch(`/schedules/${meta.id}.json`).then((r) => r.json());
  // 日付ごとの予定一覧を作る (期間の予定は期間中の毎日に入れる)
  const byDay = new Map();
  const add = (day, text, extra = {}) => {
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ text, cat: scheduleCategory(text), ...extra });
  };
  for (const r of data.ranges) {
    const end = r.end < data.end ? r.end : data.end;
    for (let d = new Date(r.start + 'T00:00:00'); ymd(d) <= end; d.setDate(d.getDate() + 1)) {
      add(ymd(d), r.title, { range: `${r.start.slice(5).replace('-', '/')}〜${r.end.slice(5).replace('-', '/')}` });
    }
  }
  for (const [day, list] of Object.entries(data.days)) for (const text of list) add(day, text);
  scheduleCache = { data, byDay, holidays: new Set(data.holidays) };
  return scheduleCache;
}

function upcomingEvents(s, from, limit) {
  const out = [];
  for (const day of [...s.byDay.keys()].sort()) {
    if (day < from) continue;
    // 期間の予定は、期間の途中なら1回だけ出す
    for (const e of s.byDay.get(day)) {
      if (e.range && out.some((o) => o.e.text === e.text)) continue;
      out.push({ day, e });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

function fmtDay(day) {
  const d = new Date(day + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
}
function eventChip(e) {
  const c = SCHEDULE_CATS[e.cat];
  return `<span class="sch-ev cat-${e.cat}" title="${c.label}">${c.icon} ${esc(e.text)}${e.range ? ` <span class="sch-range">${esc(e.range)}</span>` : ''}</span>`;
}

// 右側の欄 (PC) の「次の予定」
async function loadScheduleWidget() {
  const el = $('#schedule-widget .list');
  if (!el) return;
  try {
    const s = await loadSchedule();
    const up = upcomingEvents(s, todayYmd(), 4);
    el.innerHTML = up.length
      ? up.map(({ day, e }) => `<a class="sch-mini" href="#/schedule"><span class="sch-mini-day${day === todayYmd() ? ' today' : ''}">${day === todayYmd() ? '今日' : fmtDay(day)}</span>${eventChip(e)}</a>`).join('')
      : '<p class="muted">この学期の予定は終わりました</p>';
  } catch { el.innerHTML = '<p class="muted">読み込めませんでした</p>'; }
}

let scheduleMonth = null, scheduleFilter = new Set(Object.keys(SCHEDULE_CATS)), scheduleSelected = null;
async function viewSchedule() {
  main.innerHTML = '<div class="empty">読み込み中…</div>';
  let s;
  try { s = await loadSchedule(); } catch { main.innerHTML = '<div class="empty">予定表を読み込めませんでした</div>'; return; }
  const { data } = s;
  const t = todayYmd();
  const months = [];
  for (let d = new Date(data.start + 'T00:00:00'); ymd(d) <= data.end; d.setMonth(d.getMonth() + 1, 1)) months.push(ymd(d).slice(0, 7));
  if (!scheduleMonth || !months.includes(scheduleMonth)) scheduleMonth = months.includes(t.slice(0, 7)) ? t.slice(0, 7) : months[0];

  const todays = s.byDay.get(t) || [];
  const up = upcomingEvents(s, ymd(new Date(Date.now() + 86400_000)), 6);
  const visible = (list) => list.filter((e) => scheduleFilter.has(e.cat));

  // カレンダー
  const [yy, mm] = scheduleMonth.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1), daysIn = new Date(yy, mm, 0).getDate();
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="sch-cell empty"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const day = `${scheduleMonth}-${String(d).padStart(2, '0')}`;
    const dow = new Date(yy, mm - 1, d).getDay();
    const evs = visible(s.byDay.get(day) || []);
    const cls = ['sch-cell', dow === 0 ? 'sun' : '', dow === 6 ? 'sat' : '', s.holidays.has(day) ? 'hol' : '', day === t ? 'today' : '', day === scheduleSelected ? 'selected' : '', evs.length ? 'has' : ''].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-day="${day}" type="button"><span class="sch-num">${d}</span>
      <span class="sch-dots">${evs.slice(0, 4).map((e) => `<i class="cat-${e.cat}"></i>`).join('')}</span>
      <span class="sch-cell-text">${evs.slice(0, 2).map((e) => esc(e.text)).join('<br>')}${evs.length > 2 ? `<br>+${evs.length - 2}` : ''}</span></button>`;
  }

  // 月の一覧
  const monthDays = [...s.byDay.keys()].filter((d) => d.startsWith(scheduleMonth)).sort();
  const listHtml = monthDays.map((day) => {
    const evs = visible(s.byDay.get(day));
    if (!evs.length) return '';
    const dow = new Date(day + 'T00:00:00').getDay();
    return `<div class="sch-row${day === t ? ' today' : ''}${day === scheduleSelected ? ' selected' : ''}" id="sch-${day}">
      <div class="sch-row-day ${dow === 0 || s.holidays.has(day) ? 'sun' : dow === 6 ? 'sat' : ''}">${fmtDay(day)}${day === t ? '<b class="badge">今日</b>' : ''}</div>
      <div class="sch-row-evs">${evs.map(eventChip).join('')}</div></div>`;
  }).join('');
  const notes = visible((data.notes[scheduleMonth] || []).map((n) => ({ text: n, cat: scheduleCategory(n) })));

  main.innerHTML = `<div class="head"><h2>📅 予定表</h2></div>
    <div class="sch-head">
      <div><b>${esc(data.title)}</b><div class="muted">${esc(data.org)}</div></div>
      <a class="btn outline" href="${esc(data.pdf)}" target="_blank" rel="noopener">📄 元のPDF</a>
    </div>
    <section class="sch-today">
      <h3>今日 <span class="muted">${fmtDay(t)}</span></h3>
      ${todays.length ? `<div class="sch-row-evs">${todays.map(eventChip).join('')}</div>` : '<p class="muted">今日の予定はありません</p>'}
      ${up.length ? `<h3>これからの予定</h3>${up.map(({ day, e }) => `<div class="sch-up"><span class="sch-up-day">${fmtDay(day)}</span>${eventChip(e)}</div>`).join('')}` : ''}
    </section>
    <div class="sch-filters">${Object.entries(SCHEDULE_CATS).map(([k, c]) => `<button type="button" class="sch-filter cat-${k}${scheduleFilter.has(k) ? ' on' : ''}" data-cat="${k}">${c.icon} ${c.label}</button>`).join('')}</div>
    <div class="tabs sch-tabs">${months.map((m) => `<button type="button" data-month="${m}" class="${m === scheduleMonth ? 'active' : ''}">${Number(m.slice(5))}月</button>`).join('')}</div>
    <div class="sch-cal">${WEEK.map((w, i) => `<div class="sch-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}${cells}</div>
    <div class="sch-list">${listHtml || '<div class="empty">この月の予定はありません</div>'}
      ${notes.length ? `<div class="sch-row"><div class="sch-row-day">この月</div><div class="sch-row-evs">${notes.map(eventChip).join('')}</div></div>` : ''}
    </div>`;

  main.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => { scheduleMonth = b.dataset.month; scheduleSelected = null; viewSchedule(); }));
  main.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cat;
    if (scheduleFilter.has(k) && scheduleFilter.size > 1) scheduleFilter.delete(k); else scheduleFilter.add(k);
    viewSchedule();
  }));
  // 日付をタップ → その日の予定までスクロールして強調
  main.querySelectorAll('.sch-cell[data-day]').forEach((b) => b.addEventListener('click', () => {
    scheduleSelected = b.dataset.day;
    main.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
    b.classList.add('selected');
    const row = document.getElementById('sch-' + b.dataset.day);
    if (row) { row.classList.add('selected'); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }));
}

// =====================================================================
// ダイレクトメッセージ
// =====================================================================
async function refreshDmBadge() {
  const badge = $('#dm-badge');
  if (!me) return badge.classList.add('hidden');
  try {
    const { unread } = await api('/dm/unread', { noAuthPrompt: true });
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.toggle('hidden', !unread);
  } catch {}
}
setInterval(() => { if (!document.hidden) refreshDmBadge(); }, 20_000);

async function viewDmList() {
  main.innerHTML = `<div class="head"><h2>メッセージ</h2></div>
    <form class="search-box" id="dm-new"><input name="u" placeholder="ユーザー名を入力して新しいメッセージ (例: alice)" autocomplete="off"></form>
    <div id="dm-list"><div class="empty">読み込み中…</div></div>`;
  $('#dm-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = e.target.u.value.trim().replace(/^@/, '');
    if (u) location.hash = '#/dm/' + encodeURIComponent(u);
  });
  const load = async () => {
    const { conversations } = await api('/dm');
    $('#dm-list').innerHTML = conversations.length ? conversations.map((c) => `
      <a class="dm-row${c.unread ? ' unread' : ''}" href="#/dm/${esc(c.user.username)}">
        ${avatar(c.user)}
        <div class="dm-row-body">
          <div class="meta"><b>${esc(c.user.displayName)}</b><span>@${esc(c.user.username)}</span><span>·</span><span>${timeAgo(c.last.createdAt)}</span></div>
          <div class="dm-preview">${c.last.mine ? 'あなた: ' : ''}${esc(c.last.content)}</div>
        </div>
        ${c.unread ? `<b class="badge">${c.unread}</b>` : ''}
      </a>`).join('') : '<div class="empty">まだメッセージはありません。<br>相手のプロフィールの ✉️ から送れます。</div>';
  };
  await load().catch((e) => { $('#dm-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 10_000);
  viewCleanup = () => clearInterval(t);
}

function dmBubble(m) {
  const d = new Date(m.createdAt);
  return `<div class="dm-msg ${m.mine ? 'mine' : 'theirs'}" data-id="${m.id}">
    <div class="dm-bubble">${richText(m.content)}</div>
    ${(() => { const u = firstUrl(m.content); return u && isVideoUrl(u) ? videoEmbed(u) : ''; })()}
    <div class="dm-time">${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}</div>
  </div>`;
}

async function viewDmThread(username) {
  main.innerHTML = `<div class="head dm-head"><h2><a href="#/dm" style="color:inherit">←</a> <span id="dm-peer">@${esc(username)}</span></h2></div>
    <div class="dm-thread" id="dm-thread"><div class="empty">読み込み中…</div></div>
    <form class="dm-composer" id="dm-form">
      <textarea name="c" rows="1" placeholder="メッセージを入力" maxlength="1000"></textarea>
      <button class="btn primary" type="submit" disabled>送信</button>
    </form>`;
  const thread = $('#dm-thread'), form = $('#dm-form'), ta = form.c, btn = $('button', form);
  let lastId = 0, firstId = 0, stopped = false;
  const atBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  const scrollBottom = () => window.scrollTo(0, document.body.scrollHeight);
  const append = (msgs) => {
    const fresh = msgs.filter((m) => !thread.querySelector(`.dm-msg[data-id="${m.id}"]`));
    if (!fresh.length) return;
    thread.querySelector('.empty')?.remove();
    thread.insertAdjacentHTML('beforeend', fresh.map(dmBubble).join(''));
    lastId = Math.max(lastId, ...fresh.map((m) => m.id));
  };
  try {
    const { user, messages, hasMore } = await api('/dm/' + encodeURIComponent(username));
    $('#dm-peer').innerHTML = `<a href="#/u/${esc(user.username)}" style="color:inherit">${esc(user.displayName)}</a> <span class="muted" style="font-size:14px;font-weight:400">@${esc(user.username)}</span>`;
    thread.innerHTML = messages.length ? '' : `<div class="empty">${esc(user.displayName)}さんにメッセージを送ってみましょう</div>`;
    append(messages);
    firstId = messages[0]?.id || 0;
    if (hasMore) {
      thread.insertAdjacentHTML('afterbegin', '<button class="more" id="dm-more" type="button">前のメッセージを読み込む</button>');
      const moreBtn = $('#dm-more');
      moreBtn.addEventListener('click', async () => {
        const r = await api(`/dm/${encodeURIComponent(username)}?before=${firstId}`);
        moreBtn.insertAdjacentHTML('afterend', r.messages.map(dmBubble).join(''));
        firstId = r.messages[0]?.id || firstId;
        if (!r.hasMore) moreBtn.remove();
      });
    }
    scrollBottom();
    refreshDmBadge();
  } catch (e) {
    thread.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    form.remove();
    return;
  }
  // 入力欄: 内容に合わせて高さを伸ばす。PC は Enter で送信 (Shift+Enter で改行)。日本語変換中の Enter では送信しない
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; btn.disabled = !ta.value.trim(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = ta.value.trim();
    if (!content) return;
    btn.disabled = true;
    try {
      const { message } = await api('/dm/' + encodeURIComponent(username), { method: 'POST', body: { content } });
      ta.value = ''; ta.dispatchEvent(new Event('input'));
      append([message]); scrollBottom();
    } catch (err) { alert(err.message); btn.disabled = false; }
    ta.focus();
  });
  // 新着を定期的に取得 (画面を離れたら止める)
  const poll = async () => {
    if (stopped || document.hidden) return;
    try {
      const { messages } = await api(`/dm/${encodeURIComponent(username)}?after=${lastId}`, { noAuthPrompt: true });
      if (messages.length) { const stick = atBottom(); append(messages); if (stick) scrollBottom(); }
    } catch {}
  };
  const t = setInterval(poll, 4000);
  viewCleanup = () => { stopped = true; clearInterval(t); };
}

// =====================================================================
// 仮想ブラウザ クライアント
// サーバーから届く JPEG フレームを canvas に描画し、操作をサーバーへ送るだけ。
// 外部サイトの HTML/JS はこの端末では一切実行されない。
// =====================================================================
const VB = (() => {
  const root = $('#vb'), canvas = $('#vb-canvas'), ctx = canvas.getContext('2d');
  const ime = $('#vb-ime'), addr = $('#vb-addr'), overlay = $('#vb-overlay'), toastEl = $('#vb-toast'), timerEl = $('#vb-timer');
  let ws = null, endAt = 0, timer = null, toastT = null, pendingMove = null, drawing = false;
  let vp = { width: 1280, height: 720 }; // リモート側の表示サイズ (CSS ピクセル)
  const isPhone = () => matchMedia('(max-width: 640px)').matches;
  const modeBtn = $('#vb-mode');
  // 表示モードは端末ごとに記憶する。未設定ならスマホはスマホ版、PC は PC 版
  const loadMode = () => { try { const m = localStorage.getItem('ippo_vb_mode'); if (m === 'mobile' || m === 'desktop') return m; } catch {} return isPhone() ? 'mobile' : 'desktop'; };
  let mode = loadMode();
  const stage = $('#vb-stage');

  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3500); };

  function open(url) {
    if (!me) { openAuth(); return; }
    close();
    root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    overlay.textContent = '🛡 仮想環境を起動中…'; overlay.classList.remove('hidden');
    addr.value = url;
    // 表示モード (スマホ版 / PC版) と、この端末の画面サイズから表示サイズを決める
    const phone = isPhone();
    const bar = $('.vb-bar').getBoundingClientRect().height || 48;
    const availW = Math.round(window.innerWidth), availH = Math.round(window.innerHeight - bar);
    if (mode === 'mobile') {
      vp = phone ? { width: availW, height: availH } : { width: 390, height: Math.min(844, Math.round(window.innerHeight - 120)) };
    } else {
      // スマホで PC 版を見る時は、スマホの「PC版サイトを表示」と同じく幅 980px で縦長に表示する
      vp = phone ? { width: 980, height: Math.min(2000, Math.round(980 * availH / availW)) } : { width: 1280, height: 720 };
    }
    root.classList.toggle('vb-narrow', mode === 'mobile' && !phone);
    stage.style.width = mode === 'mobile' && !phone ? `${vp.width}px` : '';
    stage.style.aspectRatio = `${vp.width} / ${vp.height}`;
    modeBtn.textContent = mode === 'mobile' ? '📱' : '🖥';
    modeBtn.title = mode === 'mobile' ? 'スマホ版で表示中 (タップでPC版に切り替え)' : 'PC版で表示中 (タップでスマホ版に切り替え)';
    const q = `&m=${mode === 'mobile' ? 1 : 0}&w=${vp.width}&h=${vp.height}`;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/vb?url=${encodeURIComponent(url)}${q}`);
    ws.binaryType = 'blob';
    ws.onmessage = async (ev) => {
      if (typeof ev.data !== 'string') {
        if (drawing) return; // 描画が追いつかない時は捨てる
        drawing = true;
        try {
          const bmp = await createImageBitmap(ev.data);
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
          ctx.drawImage(bmp, 0, 0); bmp.close();
          overlay.classList.add('hidden');
        } finally { drawing = false; }
        return;
      }
      const m = JSON.parse(ev.data);
      if (m.t === 'hello') { vp = m.viewport; stage.style.aspectRatio = `${vp.width} / ${vp.height}`; endAt = Date.now() + m.ttl; tick(); timer = setInterval(tick, 1000); }
      else if (m.t === 'state') { if (document.activeElement !== addr) addr.value = m.url; }
      else if (m.t === 'loading') { if (document.activeElement !== addr) addr.value = m.url; }
      else if (m.t === 'notice') toast(m.msg);
      else if (m.t === 'focus' && lastPointer === 'touch') {
        if (m.editable) { if (document.activeElement !== ime) kbdFloat.classList.remove('hidden'); }
        else { kbdFloat.classList.add('hidden'); if (document.activeElement === ime) ime.blur(); }
      }
      else if (m.t === 'ended') { overlay.textContent = '🛡 ' + m.msg; overlay.classList.remove('hidden'); }
    };
    ws.onclose = () => { if (!root.classList.contains('hidden') && overlay.classList.contains('hidden')) { overlay.textContent = '🛡 セッションは終了し、データは破棄されました'; overlay.classList.remove('hidden'); } clearInterval(timer); };
    setTimeout(() => canvas.focus(), 50);
  }

  function close() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    clearInterval(timer);
    root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
    $('#vb-kbd-float').classList.add('hidden'); $('#vb-ime').blur();
    document.body.style.overflow = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function tick() {
    const s = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    timerEl.textContent = `残り ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // 画面上の座標 → リモートのビューポート座標
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * vp.width / r.width), y: Math.round((e.clientY - r.top) * vp.height / r.height) };
  }
  const BTN = ['left', 'middle', 'right'];

  // マウス / タッチ
  let touch = null, lastPointer = 'mouse';
  const kbdFloat = $('#vb-kbd-float');
  const openKeyboard = () => { kbdFloat.classList.add('hidden'); ime.value = ''; ime.focus({ preventScroll: true }); };
  // ボタンのタップ (ユーザー操作) の中でフォーカスしないと iPhone ではキーボードが開かない
  kbdFloat.addEventListener('pointerdown', (e) => { e.preventDefault(); openKeyboard(); });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lastPointer = e.pointerType;
    // マウス操作ではすぐにキー入力を受け付ける。タッチではキーボードが開いてしまうのでフォーカスしない
    if (e.pointerType !== 'touch') ime.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') { touch = { ...pos(e), sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }; return; }
    send({ t: 'down', ...pos(e), button: BTN[e.button] || 'left' });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!touch) return;
      const dx = touch.lx - e.clientX, dy = touch.ly - e.clientY;
      if (Math.abs(e.clientX - touch.sx) + Math.abs(e.clientY - touch.sy) > 8) touch.moved = true;
      if (touch.moved) { const r = vp.width / canvas.getBoundingClientRect().width; send({ t: 'wheel', x: touch.x, y: touch.y, dx: dx * r, dy: dy * r }); }
      touch.lx = e.clientX; touch.ly = e.clientY;
      return;
    }
    const first = !pendingMove;
    pendingMove = pos(e);
    if (first) requestAnimationFrame(() => { send({ t: 'move', ...pendingMove }); pendingMove = null; });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      if (touch && !touch.moved) { send({ t: 'down', x: touch.x, y: touch.y, button: 'left' }); send({ t: 'up', x: touch.x, y: touch.y, button: 'left' }); }
      touch = null; return;
    }
    send({ t: 'up', ...pos(e), button: BTN[e.button] || 'left' });
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    send({ t: 'wheel', ...pos(e), dx: e.deltaX * k, dy: e.deltaY * k });
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => { ime.focus({ preventScroll: true }); });

  // キーボード: 特殊キーは key、文字入力 (日本語 IME 含む) は text として送る
  const MODS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Process', 'Unidentified', 'Dead']);
  ime.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229 || MODS.has(e.key)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'v') return; // paste イベントで処理
    if (e.key.length > 1 || ctrl || e.altKey) {
      e.preventDefault();
      const combo = [ctrl && 'Control', e.altKey && 'Alt', e.shiftKey && e.key.length > 1 && 'Shift'].filter(Boolean);
      send({ t: 'key', key: [...combo, e.key.length === 1 ? e.key.toLowerCase() : e.key].join('+') });
    }
  });
  ime.addEventListener('input', (e) => { if (!e.isComposing && ime.value) { send({ t: 'text', text: ime.value }); ime.value = ''; } });
  ime.addEventListener('compositionend', (e) => { if (e.data) send({ t: 'text', text: e.data }); ime.value = ''; });
  ime.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData.getData('text'); if (t) send({ t: 'text', text: t }); });

  // ツールバー
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vb]');
    if (!b) { if (e.target === root) close(); return; }
    if (b.dataset.vb === 'close') close();
    else if (b.dataset.vb === 'kbd') { if (document.activeElement === ime) ime.blur(); else openKeyboard(); }
    else if (b.dataset.vb === 'mode') {
      mode = mode === 'mobile' ? 'desktop' : 'mobile';
      try { localStorage.setItem('ippo_vb_mode', mode); } catch {}
      const current = addr.value;
      open(current); // 表示サイズが変わるので、今のページを新しいモードで開き直す
      toast(mode === 'mobile' ? '📱 スマホ版で表示します' : '🖥 PC版で表示します');
    }
    else send({ t: b.dataset.vb });
  });
  $('#vb-addr-form').addEventListener('submit', (e) => { e.preventDefault(); send({ t: 'goto', url: addr.value }); addr.blur(); canvas.focus(); });

  return { open, close };
})();
window.openAuth = openAuth;

// ---------- 起動 ----------
(async () => {
  me = (await api('/me', { noAuthPrompt: true }).catch(() => ({}))).user || null;
  renderMe();
  loadScheduleWidget();
  route();
})();
