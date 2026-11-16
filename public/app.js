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
function firstUrl(text) { const m = text.match(URL_RE); return m ? m[0] : null; }

// ---------- 投稿の描画 ----------
function renderPost(item, { focus = false } = {}) {
  const p = item.type === 'repost' ? item.post : item;
  const ctx = item.type === 'repost' ? `<div class="ctx">🔁 ${esc(item.by.displayName)}さんがリポストしました</div>` : '';
  const url = firstUrl(p.content);
  let card = '';
  if (url) {
    let host = url; try { host = new URL(url).hostname; } catch {}
    card = `<div class="link-card" data-url="${esc(url)}"><div class="lc-icon">🛡</div><div><div class="lc-host">${esc(host)}</div><div class="lc-sub">仮想環境で安全に開く</div></div></div>`;
  }
  const reply = p.replyToUser ? `<div class="muted">返信先: <a href="#/u/${esc(p.replyToUser)}">@${esc(p.replyToUser)}</a></div>` : '';
  const del = me && me.id === p.author.id ? `<button class="del" title="削除">🗑</button>` : '';
  return `${ctx}<article class="post${focus ? ' focus' : ''}" data-id="${p.id}">
    ${avatar(p.author)}
    <div class="body">
      <div class="meta"><b><a href="#/u/${esc(p.author.username)}" style="color:inherit">${esc(p.author.displayName)}</a></b>
        <span>@${esc(p.author.username)}</span><span>·</span><span title="${new Date(p.createdAt).toLocaleString()}">${timeAgo(p.createdAt)}</span></div>
      ${reply}
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
  if (!postEl || e.target.closest('a')) return;
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
function bindCompose(root, { replyTo = null, onDone } = {}) {
  const ta = $('textarea', root), btn = $('.btn', root), count = $('.count', root);
  ta.addEventListener('input', () => {
    const n = 280 - [...ta.value].length;
    count.textContent = n; count.classList.toggle('over', n < 0);
    btn.disabled = !ta.value.trim() || n < 0;
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { post } = await api('/posts', { method: 'POST', body: { content: ta.value, replyTo } });
      ta.value = ''; ta.dispatchEvent(new Event('input'));
      onDone && onDone(post);
    } catch (e) { alert(e.message); btn.disabled = false; }
  });
}
function openCompose(replyTo = null, handle = '') {
  if (!me) return openAuth();
  const dlg = $('#compose-dialog');
  const slot = $('#compose-modal-slot');
  slot.innerHTML = (replyTo ? `<div class="muted" style="padding:0 16px">返信先: ${esc(handle)}</div>` : '') + composeHtml(replyTo ? '返信をポスト' : 'いまどうしてる？');
  bindCompose(slot, { replyTo, onDone: () => { dlg.close(); route(); } });
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
    box.innerHTML = `<div class="user-row">${avatar(me)}<div class="names"><b>${esc(me.displayName)}</b><div class="muted">@${esc(me.username)}</div></div></div><a href="#" id="logout" style="font-size:14px">ログアウト</a>`;
    $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/logout', { method: 'POST' }); me = null; renderMe(); route(); });
  } else {
    box.innerHTML = `<button class="btn primary" id="login-btn" style="width:100%">ログイン / 登録</button>`;
    $('#login-btn').addEventListener('click', () => openAuth());
  }
  loadSuggest();
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
    <div id="feed"></div>`;
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
          ${isMe ? '<button class="btn outline" id="edit-profile">プロフィールを編集</button>' : me ? `<button class="btn ${user.followed ? 'outline' : ''} follow-btn" data-user="${esc(user.username)}" data-on="${user.followed ? 1 : 0}">${user.followed ? 'フォロー中' : 'フォロー'}</button>` : ''}
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
  if (!q) return ($('#res').innerHTML = '<div class="empty">投稿やユーザーを検索できます。URLを入力すると仮想ブラウザで開けます。</div>');
  if (/^https?:\/\//.test(q)) return VB.open(q);
  const { posts, users } = await api('/search?q=' + encodeURIComponent(q), { noAuthPrompt: true });
  $('#res').innerHTML = (users.length ? `<div style="padding:0 16px;border-bottom:1px solid var(--line)">${users.map((u) => userRow({ ...u, followed: false })).join('')}</div>` : '') +
    (posts.length ? posts.map((p) => renderPost(p)).join('') : '<div class="empty">該当する投稿はありません</div>');
}

function route() {
  const h = location.hash.slice(1) || '/';
  document.querySelectorAll('.side [data-nav]').forEach((a) => a.classList.remove('active'));
  let m;
  if ((m = h.match(/^\/p\/(\d+)/))) return viewPost(m[1]);
  if ((m = h.match(/^\/u\/([A-Za-z0-9_]+)/))) return viewUser(m[1]);
  if (h === '/me') { if (!me) { openAuth(); location.hash = '#/'; return; } location.hash = '#/u/' + me.username; return; }
  if (h.startsWith('/search')) { $('[data-nav=search]').classList.add('active'); return viewSearch(new URLSearchParams(h.split('?')[1] || '').get('q') || ''); }
  $('[data-nav=home]').classList.add('active');
  viewHome();
}
window.addEventListener('hashchange', route);

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
    // スマホでは画面いっぱいに、スマホ版のサイトとして表示する
    const mobile = matchMedia('(max-width: 640px)').matches;
    const bar = $('.vb-bar').getBoundingClientRect().height || 48;
    vp = mobile ? { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight - bar) } : { width: 1280, height: 720 };
    stage.style.aspectRatio = `${vp.width} / ${vp.height}`;
    const q = mobile ? `&m=1&w=${vp.width}&h=${vp.height}` : '';
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
  route();
})();
