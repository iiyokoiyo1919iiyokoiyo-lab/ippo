'use strict';
// =====================================================================
// IppO クライアント
// 画面はすべて共通部品 (pageHead / card / postCard / emptyState / modal / toast …) で組み立てる
// =====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $('#main');
let me = null;
let siteConfig = { inviteOnly: false };
let viewCleanup = null;
let currentCommunity = null; // コミュニティ画面で投稿ボタンを押したら、そのコミュニティに投稿する

// ---------- ユーティリティ ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

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
  if (s < 45) return 'たった今';
  if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '時間前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + '日前';
  const d = new Date(t), now = new Date();
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
const fullTime = (t) => new Date(t).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// アバター: 名前の頭文字 + 落ち着いた色 (ユーザー名から決まる)
const PALETTE = ['#4b55f0', '#6a4fd6', '#2f7fd1', '#1495a0', '#16946c', '#c9622f', '#c9466b', '#7a5ad1', '#3b6db3', '#a35a2f'];
const colorFor = (key) => { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
function avatar(u, size = '', link = false) {
  const inner = esc([...(u.displayName || u.username)][0] || '?');
  const cls = `avatar ${size ? 'avatar-' + size : ''}`;
  return link ? `<a class="${cls}" href="#/u/${esc(u.username)}" style="background:${colorFor(u.username)}" aria-label="${esc(u.displayName)}">${inner}</a>`
    : `<span class="${cls}" style="background:${colorFor(u.username)}" aria-hidden="true">${inner}</span>`;
}

// 管理者バッジ: 名前の横に付ける小さな印 (プロフィールでは文字付き)
const adminBadge = (u, withLabel = false) => !u?.isAdmin ? ''
  : withLabel ? `<span class="admin-badge-label" title="IppO の管理者">${icon('badge')}管理者</span>`
  : `<span class="admin-badge" title="管理者" aria-label="管理者" role="img">${icon('badge')}</span>`;

// ---------- トースト ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = (type === 'success' ? icon('check') : type === 'error' ? icon('alert') : '') + `<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }, type === 'error' ? 4200 : 2600);
}

// ---------- モーダル (開く・閉じるアニメーション) ----------
function openModal(dlg) { dlg.classList.remove('closing'); if (!dlg.open) dlg.showModal(); }
function closeModal(dlg) {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  dlg.classList.add('closing');
  setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 170);
}
$$('dialog.modal').forEach((dlg) => {
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) closeModal(dlg); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(dlg); });
});
// 汎用ダイアログ: 確認
function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dlg = $('#ui-dialog');
    $('#ui-dialog-title').textContent = title;
    $('#ui-dialog-body').innerHTML = `<p class="confirm-text">${esc(body)}</p>
      <div class="modal-actions"><button class="btn btn-ghost" type="button" data-r="0">キャンセル</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-r="1">${esc(ok)}</button></div>`;
    let done = false;
    const finish = (v) => { if (done) return; done = true; closeModal(dlg); resolve(v); };
    $$('[data-r]', dlg).forEach((b) => b.addEventListener('click', () => finish(b.dataset.r === '1')));
    dlg.addEventListener('close', () => finish(false), { once: true });
    openModal(dlg);
  });
}
// 汎用ダイアログ: 任意の中身 (フォームなど)
function openPanel(title, html, onMount) {
  const dlg = $('#ui-dialog');
  $('#ui-dialog-title').textContent = title;
  $('#ui-dialog-body').innerHTML = html;
  openModal(dlg);
  onMount && onMount($('#ui-dialog-body'), () => closeModal(dlg));
}

// ---------- メニュー (投稿の「…」など) ----------
const menuEl = $('#menu');
function openMenu(anchor, items) {
  menuEl.innerHTML = items.map((it, i) => `<button class="menu-item ${it.danger ? 'danger' : ''}" type="button" data-i="${i}" role="menuitem">${icon(it.icon)}${esc(it.label)}</button>`).join('');
  menuEl.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
  menuEl.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  $$('.menu-item', menuEl).forEach((b) => b.addEventListener('click', () => { closeMenu(); items[b.dataset.i].run(); }));
}
function closeMenu() { menuEl.classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }, true);
window.addEventListener('scroll', closeMenu, { passive: true });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------- テーマ (自動 / ライト / ダーク) ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
applyTheme(store.get('ippo_theme', 'auto'));

// ---------- ブックマーク (この端末に保存) ----------
const bookmarks = {
  list: () => store.get('ippo_bookmarks', []),
  has: (id) => bookmarks.list().includes(Number(id)),
  toggle(id) {
    id = Number(id);
    const l = bookmarks.list(), on = !l.includes(id);
    store.set('ippo_bookmarks', on ? [id, ...l].slice(0, 300) : l.filter((x) => x !== id));
    return on;
  },
  remove(id) { store.set('ippo_bookmarks', bookmarks.list().filter((x) => x !== Number(id))); },
};

// ---------- 本文の整形 ----------
const URL_RE = /https?:\/\/[^\s<>"'「」、。）)]+/g;
function richText(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out.push(inlineMarkup(text.slice(last, m.index)));
    const url = m[0];
    let label = url.replace(/^https?:\/\//, '');
    if (label.length > 40) label = label.slice(0, 40) + '…';
    out.push(`<span class="vlink" data-url="${esc(url)}" title="仮想環境で開く: ${esc(url)}">${icon('shield')}${esc(label)}</span>`);
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
    <span class="vlink video-src" data-url="${esc(url)}">${icon('shield')}元のページを仮想ブラウザで開く</span></div>`;
}
function firstUrl(text) { const m = text.match(URL_RE); return m ? m[0] : null; }

// ---------- YouTube ----------
// 再生ボタンを押すまで YouTube には接続しない (サムネイルとタイトルは IppO のサーバー経由)。
// 再生は YouTube 公式の埋め込みプレーヤー (Cookie なしモード: youtube-nocookie.com)
function youtubeInfo(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/); if (m) id = m[2]; }
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  // 開始位置: t=90 / t=1m30s / start=90
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  let start = 0;
  const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (hms) start = (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
  return { id, start, shorts: u.pathname.startsWith('/shorts/') };
}
function youtubeCard(yt, url) {
  return `<div class="yt" data-yt="${yt.id}" data-start="${yt.start}">
    <button class="yt-card${yt.shorts ? ' yt-shorts' : ''}" type="button" aria-label="YouTube 動画を再生">
      <img class="yt-thumb" src="/api/yt/${yt.id}/thumb" alt="" loading="lazy" decoding="async">
      <span class="yt-play">${icon('play')}</span>
      <span class="yt-meta"><span class="yt-title">YouTube 動画</span><span class="yt-author"></span></span>
    </button>
    <div class="yt-note"><span class="yt-note-text">${icon('globe', 'ic-sm')}再生すると YouTube に接続（Cookie なし）</span>
      <span class="vlink" data-url="${esc(url)}">${icon('shield')}仮想ブラウザで開く</span></div>
  </div>`;
}
// タイトルを読み込む (表示された YouTube カードごとに1回)
const ytTitles = new Map();
async function fillYoutubeTitles(root = document) {
  for (const el of $$('.yt[data-yt]:not([data-filled])', root)) {
    el.dataset.filled = '1';
    const id = el.dataset.yt;
    if (!ytTitles.has(id)) ytTitles.set(id, api('/yt/' + id, { noAuthPrompt: true }).catch(() => null));
    const info = await ytTitles.get(id);
    if (info && el.isConnected) {
      $('.yt-title', el).textContent = info.title || 'YouTube 動画';
      $('.yt-author', el).textContent = info.author || '';
      $('.yt-card', el).setAttribute('aria-label', `${info.title} を再生`);
    }
  }
}
new MutationObserver(() => fillYoutubeTitles(main)).observe(main, { childList: true, subtree: true });
// サムネイルが読み込めなかった時は画像を外して無地の背景にする
document.addEventListener('error', (e) => { if (e.target.classList?.contains('yt-thumb')) e.target.remove(); }, true);
// 再生: その場で公式プレーヤーに差し替える
function playYoutube(el) {
  const id = el.dataset.yt, start = Number(el.dataset.start) || 0;
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1${start ? '&start=' + start : ''}`;
  $('.yt-card', el).outerHTML = `<div class="yt-frame${$('.yt-card', el).classList.contains('yt-shorts') ? ' yt-shorts' : ''}"><iframe src="${src}" title="YouTube 動画プレーヤー"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

// ---------- 共通部品 ----------
function pageHead({ title, sub = '', back = null, actions = '', tabs = '' }) {
  return `<header class="page-head${tabs ? ' with-tabs' : ''}">
    ${back ? `<a class="icon-btn back" href="${esc(back)}" data-back aria-label="戻る">${icon('back')}</a>` : ''}
    <h1>${title}${sub ? `<span class="sub">${sub}</span>` : ''}</h1>
    ${actions ? `<div class="page-head-actions">${actions}</div>` : ''}
    ${tabs}
  </header>`;
}
function emptyState({ icon: ic = 'sparkle', title, text = '', action = '' }) {
  return `<div class="empty"><div class="empty-icon">${icon(ic)}</div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
}
function skeletonPosts(n = 3) {
  return Array.from({ length: n }, () => `<div class="post sk-post" aria-hidden="true">
    <div class="row"><div class="sk sk-circle"></div><div style="flex:1"><div class="sk sk-line" style="width:38%"></div><div class="sk sk-line" style="width:22%;margin-top:8px;height:10px"></div></div></div>
    <div class="sk sk-line" style="width:92%;margin-top:18px"></div><div class="sk sk-line" style="width:70%;margin-top:10px"></div>
    <div class="row" style="margin:18px 0 8px;gap:28px"><div class="sk sk-line" style="width:36px"></div><div class="sk sk-line" style="width:36px"></div><div class="sk sk-line" style="width:36px"></div></div></div>`).join('');
}
const loadingBlock = () => `<div class="content">${skeletonPosts(2)}</div>`;

// ---------- 投稿カード ----------
function renderPost(item, { focus = false, fresh = false } = {}) {
  const p = item.type === 'repost' ? item.post : item;
  const ctx = item.type === 'repost' ? `<div class="post-ctx">${icon('repeat')}${esc(item.by.displayName)}さんがリポスト</div>` : '';
  const url = firstUrl(p.content);
  let media = '';
  const yt = url && youtubeInfo(url);
  if (yt) {
    media = youtubeCard(yt, url);
  } else if (url && isVideoUrl(url) && me) {
    media = videoEmbed(url);
  } else if (url) {
    let host = url; try { host = new URL(url).hostname; } catch {}
    const sub = isVideoUrl(url) ? '動画 · ログインすると再生できます' : '仮想ブラウザで安全に開く';
    media = `<div class="link-card" data-url="${esc(url)}"><div class="link-card-icon">${icon(isVideoUrl(url) ? 'play' : 'globe')}</div>
      <div><div class="link-card-host">${esc(host)}</div><div class="link-card-sub">${sub}</div></div>${icon('shield', 'ic-sm muted')}</div>`;
  }
  const chips = (p.community ? `<a class="chip chip-accent" href="#/c/${esc(p.community.slug)}">${icon('users')}${esc(p.community.name)}</a>` : '') +
    (p.question ? `<a class="chip" href="#/q">${icon('sparkle')}今日の質問</a>` : '');
  const bm = bookmarks.has(p.id);
  const n = (v) => (v ? v : '');
  return `<article class="post${focus ? ' focus' : ''}${fresh ? ' post-new' : ''}" data-id="${p.id}" data-user="${esc(p.author.username)}">
    ${ctx}
    <header class="post-head">
      ${avatar(p.author, '', true)}
      <div class="post-author">
        <div class="post-name"><a class="name" href="#/u/${esc(p.author.username)}">${esc(p.author.displayName)}</a>${adminBadge(p.author)}<span class="handle">@${esc(p.author.username)}</span></div>
        <div class="post-meta"><time datetime="${new Date(p.createdAt).toISOString()}" title="${fullTime(p.createdAt)}">${focus ? fullTime(p.createdAt) : timeAgo(p.createdAt)}</time>${chips}</div>
      </div>
      <button class="icon-btn post-more" type="button" data-menu aria-label="その他">${icon('more')}</button>
    </header>
    ${p.replyToUser ? `<div class="post-reply-to">返信先: <a href="#/u/${esc(p.replyToUser)}">@${esc(p.replyToUser)}</a></div>` : ''}
    <div class="post-text">${richText(p.content)}</div>
    ${media ? `<div class="post-media">${media}</div>` : ''}
    <footer class="post-actions">
      <button class="act like${p.liked ? ' on' : ''}" type="button" aria-label="いいね" aria-pressed="${p.liked}">${icon('heart')}<span>${n(p.counts.likes)}</span></button>
      <button class="act reply" type="button" aria-label="コメント">${icon('comment')}<span>${n(p.counts.replies)}</span></button>
      <button class="act repost${p.reposted ? ' on' : ''}" type="button" aria-label="リポスト" aria-pressed="${p.reposted}">${icon('repeat')}<span>${n(p.counts.reposts)}</span></button>
      <span class="spacer"></span>
      <button class="act bookmark${bm ? ' on' : ''}" type="button" aria-label="ブックマーク" aria-pressed="${bm}">${icon('bookmark')}</button>
    </footer>
  </article>`;
}

// サーバーから返った最新の状態を、表示中の同じ投稿すべてに反映する (アニメーションを保つため部分更新)
function updatePostEls(p) {
  $$(`.post[data-id="${p.id}"]`).forEach((el) => {
    const set = (sel, on, count) => {
      const b = $(sel, el); if (!b) return;
      b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', !!on);
      $('span', b).textContent = count || '';
    };
    set('.act.like', p.liked, p.counts.likes);
    set('.act.repost', p.reposted, p.counts.reposts);
    const r = $('.act.reply span', el); if (r) r.textContent = p.counts.replies || '';
  });
}
function popButton(btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }

// 投稿の操作 (イベント委譲)
main.addEventListener('click', async (e) => {
  const ytCard = e.target.closest('.yt-card');
  if (ytCard) { e.preventDefault(); e.stopPropagation(); return playYoutube(ytCard.closest('.yt')); }
  const link = e.target.closest('[data-url]');
  if (link) { e.preventDefault(); e.stopPropagation(); return VB.open(link.dataset.url); }
  const postEl = e.target.closest('.post[data-id]');
  if (!postEl || e.target.closest('a, video, iframe, .yt-frame')) return;
  const id = postEl.dataset.id;
  const more = e.target.closest('[data-menu]');
  if (more) return openPostMenu(more, postEl);
  const btn = e.target.closest('.act');
  if (!btn) { if (!postEl.classList.contains('focus') && !window.getSelection().toString()) location.hash = '#/p/' + id; return; }
  if (btn.classList.contains('bookmark')) {
    const on = bookmarks.toggle(id);
    $$(`.post[data-id="${id}"] .act.bookmark`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    popButton(btn);
    return toast(on ? 'ブックマークに追加しました' : 'ブックマークから外しました', on ? 'success' : '');
  }
  if (!me) return openAuth();
  try {
    if (btn.classList.contains('like') || btn.classList.contains('repost')) {
      const kind = btn.classList.contains('like') ? 'like' : 'repost';
      const on = btn.classList.contains('on');
      // すぐに見た目を変え (控えめなアニメーション)、サーバーの結果で確定する
      btn.classList.toggle('on', !on);
      const c = $('span', btn); c.textContent = Math.max(0, (Number(c.textContent) || 0) + (on ? -1 : 1)) || '';
      if (!on) popButton(btn);
      const { post } = await api(`/posts/${id}/${kind}`, { method: on ? 'DELETE' : 'POST' });
      updatePostEls(post);
      if (kind === 'repost') toast(on ? 'リポストを取り消しました' : 'リポストしました', on ? '' : 'success');
    } else if (btn.classList.contains('reply')) {
      openCompose({ replyTo: id, handle: '@' + postEl.dataset.user });
    }
  } catch (err) { toast(err.message, 'error'); route(); }
});

function openPostMenu(anchor, postEl) {
  const id = postEl.dataset.id, user = postEl.dataset.user;
  const mine = me && me.username === user;
  const items = [
    { icon: 'link', label: 'リンクをコピー', run: async () => {
      try { await navigator.clipboard.writeText(location.origin + '/#/p/' + id); toast('リンクをコピーしました', 'success'); }
      catch { toast('コピーできませんでした', 'error'); } } },
  ];
  if (!postEl.classList.contains('focus')) items.unshift({ icon: 'comment', label: '投稿を開く', run: () => { location.hash = '#/p/' + id; } });
  if (me && !mine) items.push({ icon: 'mail', label: `@${user} にメッセージ`, run: () => { location.hash = '#/dm/' + user; } });
  items.push({ icon: 'user', label: `@${user} のプロフィール`, run: () => { location.hash = '#/u/' + user; } });
  if (mine || me?.isAdmin) items.push({ icon: 'trash', label: mine ? '投稿を削除' : '投稿を削除（管理者）', danger: true, run: async () => {
    if (!(await confirmDialog({ title: '投稿を削除しますか？', body: mine ? 'この操作は取り消せません。' : `@${user} さんの投稿を管理者として削除します。\nこの操作は取り消せません。`, ok: '削除する', danger: true }))) return;
    try {
      await api('/posts/' + id, { method: 'DELETE' });
      $$(`.post[data-id="${id}"]`).forEach((el) => { el.classList.add('removing'); setTimeout(() => el.remove(), 200); });
      bookmarks.remove(id);
      toast('投稿を削除しました');
      if (postEl.classList.contains('focus')) setTimeout(() => { location.hash = '#/'; }, 250);
    } catch (err) { toast(err.message, 'error'); }
  } });
  openMenu(anchor, items);
}

// ---------- 投稿作成 ----------
const MAX_LEN = 280;
function composeHtml({ placeholder = 'いまどうしてる？', context = '', submit = '投稿する' } = {}) {
  const C = 2 * Math.PI * 10;
  return `<div class="composer">
    ${me ? avatar(me) : ''}
    <div class="composer-main">
      ${context}
      <textarea placeholder="${esc(placeholder)}" maxlength="400" rows="2" aria-label="本文"></textarea>
      <div class="composer-foot">
        <span class="hint">${icon('shield', 'ic-sm')}リンクは仮想ブラウザで開かれます</span>
        <span class="ring-wrap"><svg class="ring" viewBox="0 0 26 26"><circle class="track" cx="13" cy="13" r="10"/><circle class="bar" cx="13" cy="13" r="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="ring-num"></span></span>
        <button class="btn btn-primary" type="button" disabled>${esc(submit)}</button>
      </div>
    </div>
  </div>`;
}
function bindCompose(root, { replyTo = null, onDone, extra = {} } = {}) {
  const ta = $('textarea', root), btn = $('.composer-foot .btn', root), bar = $('.ring .bar', root), ring = $('.ring', root), num = $('.ring-num', root), wrap = $('.ring-wrap', root);
  const C = 2 * Math.PI * 10;
  const update = () => {
    const len = [...ta.value].length, left = MAX_LEN - len;
    bar.style.strokeDashoffset = C * (1 - Math.min(1, len / MAX_LEN));
    ring.classList.toggle('warn', left <= 20 && left >= 0); ring.classList.toggle('over', left < 0); wrap.classList.toggle('over', left < 0);
    num.textContent = left <= 20 ? left : '';
    btn.disabled = !ta.value.trim() || left < 0;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.5) + 'px';
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !btn.disabled) btn.click(); });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.classList.add('is-loading');
    try {
      const { post } = await api('/posts', { method: 'POST', body: { ...extra, content: ta.value, replyTo } });
      ta.value = ''; update();
      onDone && onDone(post);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    btn.classList.remove('is-loading');
  });
  update();
  return ta;
}
// 投稿作成モーダル (返信 / コミュニティ / 今日の質問 にも使う)
function openCompose({ replyTo = null, handle = '', extra = {}, title = '', placeholder = '' } = {}) {
  if (!me) return openAuth();
  const dlg = $('#compose-dialog'), slot = $('#compose-modal-slot');
  if (!replyTo && !extra.question && !extra.community && currentCommunity) extra = { community: currentCommunity.slug };
  let context = '';
  if (replyTo) context = `<div class="compose-context"><span class="chip">${icon('comment')}${esc(handle)} への返信</span></div>`;
  else if (extra.community) context = `<div class="compose-context"><span class="chip chip-accent">${icon('users')}${esc(currentCommunity?.name || extra.community)} に投稿</span></div>`;
  else if (extra.question) context = `<div class="compose-context"><span class="chip">${icon('sparkle')}${esc(title)}</span></div>`;
  $('#compose-title').textContent = replyTo ? 'コメントする' : extra.question ? '今日の質問に答える' : '新しい投稿';
  slot.innerHTML = composeHtml({ placeholder: placeholder || (replyTo ? 'コメントを書く' : 'いまどうしてる？'), context, submit: replyTo ? 'コメント' : '投稿する' });
  const ta = bindCompose(slot, { replyTo, extra, onDone: (post) => {
    closeModal(dlg);
    toast(replyTo ? 'コメントしました' : '投稿しました', 'success');
    // いま見ている画面に関係する投稿なら、その場に追加する
    const h = location.hash || '#/';
    const onHome = h === '#/' || h === '#';
    const onCommunity = extra.community && h === '#/c/' + extra.community;
    const feed = $('#feed');
    if (feed && !replyTo && !extra.question && ((onHome && !extra.community) || onCommunity)) { $('.empty', feed)?.remove(); feed.insertAdjacentHTML('afterbegin', renderPost(post, { fresh: true })); }
    else if ((replyTo && h.startsWith('#/p/')) || (extra.question && h === '#/q')) route();
  } });
  openModal(dlg);
  setTimeout(() => ta.focus(), 60);
}
$$('[data-compose]').forEach((b) => b.addEventListener('click', () => openCompose()));

// ---------- 認証 ----------
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  const f = $('#auth-form');
  f.classList.toggle('login', m === 'login');
  $('#auth-title').textContent = m === 'login' ? 'おかえりなさい' : 'アカウントを作成';
  $('#auth-sub').textContent = m === 'login' ? 'IppO にログイン' : 'IppO へようこそ';
  $('#auth-submit').textContent = m === 'login' ? 'ログイン' : '登録する';
  $('#auth-toggle').textContent = m === 'login' ? 'はじめての方はこちら（新規登録）' : 'アカウントをお持ちの方はこちら';
  $$('[data-auth-mode]').forEach((b) => { b.classList.toggle('active', b.dataset.authMode === m); b.setAttribute('aria-selected', b.dataset.authMode === m); });
  $('#auth-error').textContent = '';
  f.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('.invite-field').classList.toggle('hidden', !siteConfig.inviteOnly);
  f.invite.required = m === 'register' && siteConfig.inviteOnly;
  const note = $('#invite-note');
  if (m === 'register' && siteConfig.inviteOnly && !note.dataset.from) {
    note.textContent = 'IppO は招待制です。招待してくれた人から届いたリンクを開くか、招待コードを入力してください。';
    note.classList.remove('hidden');
  } else if (!note.dataset.from) note.classList.add('hidden');
}
function openAuth(mode = 'login') { setAuthMode(mode); openModal($('#auth-dialog')); setTimeout(() => $('#auth-form').username.focus(), 80); }
window.openAuth = openAuth;
$('#auth-toggle').addEventListener('click', (e) => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'register' : 'login'); });
$$('[data-auth-mode]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.authMode)));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const btn = $('#auth-submit');
  btn.classList.add('is-loading');
  try {
    const { user } = await api(authMode === 'login' ? '/login' : '/register', { method: 'POST', body: fd, noAuthPrompt: true });
    me = user; closeModal($('#auth-dialog')); e.target.reset(); delete $('#invite-note').dataset.from;
    toast(authMode === 'login' ? `おかえりなさい、${user.displayName}さん` : 'ようこそ IppO へ！', 'success');
    renderMe();
    // 招待リンクから来た場合はホームへ (画面の切り替えは hashchange で1回だけ行う)
    if (location.hash.startsWith('#/invite/')) location.hash = '#/'; else route();
  } catch (err) { $('#auth-error').textContent = err.message; }
  btn.classList.remove('is-loading');
});

async function logout() {
  await api('/logout', { method: 'POST' });
  me = null; renderMe(); location.hash = '#/'; route();
  toast('ログアウトしました');
}

// サイドバーのアカウント欄・ヘッダーのアバター・右カラム
function renderMe() {
  const box = $('#account-box');
  if (me) {
    box.innerHTML = `<button class="account-btn" type="button" data-menu id="account-btn">${avatar(me, 'sm')}
      <span class="account-text"><b>${esc(me.displayName)}${adminBadge(me)}</b><span>@${esc(me.username)}</span></span>${icon('more', 'account-more')}</button>`;
    $('#account-btn').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { icon: 'user', label: 'マイページ', run: () => { location.hash = '#/me'; } },
      { icon: 'settings', label: '設定', run: () => { location.hash = '#/settings'; } },
      { icon: 'logout', label: 'ログアウト', run: logout },
    ]));
    $('#topbar-avatar').innerHTML = avatar(me);
    $('#nav-admin').classList.toggle('hidden', !me.isAdmin);
  } else {
    $('#nav-admin').classList.add('hidden');
    box.innerHTML = `<button class="btn btn-secondary btn-block" type="button" id="login-btn">${icon('user')}<span class="account-text" style="flex:none">ログイン</span></button>`;
    $('#login-btn').addEventListener('click', () => openAuth());
    $('#topbar-avatar').innerHTML = icon('user');
  }
  loadSuggest();
  loadTrends();
  refreshBadges(true);
}

async function loadSuggest() {
  const { users } = await api('/users', { noAuthPrompt: true }).catch(() => ({ users: [] }));
  $('#suggest .list').innerHTML = users.length ? users.map(userRow).join('') : '<p class="text-sm muted">まだいません</p>';
}
function followBtn(u) {
  return `<button class="btn btn-sm ${u.followed ? 'btn-outline' : 'btn-primary'} follow-btn" type="button" data-user="${esc(u.username)}" data-on="${u.followed ? 1 : 0}">${u.followed ? 'フォロー中' : 'フォロー'}</button>`;
}
function userRow(u) {
  return `<div class="user-row">${avatar(u, '', true)}<div class="names"><a href="#/u/${esc(u.username)}">${esc(u.displayName)}${adminBadge(u)}</a><span>@${esc(u.username)}</span></div>${me && me.id !== u.id ? followBtn(u) : ''}</div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.follow-btn');
  if (!b) return;
  if (!me) return openAuth();
  const on = b.dataset.on === '1';
  try {
    const { user } = await api(`/users/${b.dataset.user}/follow`, { method: on ? 'DELETE' : 'POST' });
    $$(`.follow-btn[data-user="${b.dataset.user}"]`).forEach((x) => {
      x.dataset.on = user.followed ? '1' : '0';
      x.textContent = user.followed ? 'フォロー中' : 'フォロー';
      x.classList.toggle('btn-outline', user.followed); x.classList.toggle('btn-primary', !user.followed);
    });
    const f = $('#followers-count'); if (f) f.textContent = user.stats.followers;
    if (user.followed) toast(`@${user.username} さんをフォローしました`, 'success');
  } catch (err) { toast(err.message, 'error'); }
});

// ---------- バッジ (通知・DM) ----------
const notifSeen = () => store.get('ippo_notif_seen', { at: 0, like: 0, follow: 0 });
let badgeAt = 0;
async function refreshBadges(force = false) {
  // 画面を切り替えるたびに呼ばれるので、5秒以内の連続呼び出しはまとめる
  if (!force && Date.now() - badgeAt < 5000) return;
  badgeAt = Date.now();
  const show = (sel, n) => $$(sel).forEach((b) => { b.classList.toggle('hidden', !n); if (b.classList.contains('count-badge')) b.textContent = n > 99 ? '99+' : n; });
  if (!me) { show('.dm-badge', 0); show('.notif-badge', 0); return; }
  try { const { unread } = await api('/dm/unread', { noAuthPrompt: true }); show('.dm-badge', unread); } catch {}
  try {
    const s = notifSeen();
    const { unread } = await api(`/notifications/unread?at=${s.at}&like=${s.like}&follow=${s.follow}`, { noAuthPrompt: true });
    show('.notif-badge', location.hash === '#/notifications' ? 0 : unread);
  } catch {}
}
setInterval(() => { if (!document.hidden) refreshBadges(true); }, 20_000);

// =====================================================================
// 画面
// =====================================================================
let tlMode = 'all';
async function viewHome() {
  const tabs = `<div class="tabs" role="tablist">
    <button data-mode="all" class="${tlMode === 'all' ? 'active' : ''}" role="tab">おすすめ</button>
    <button data-mode="following" class="${tlMode === 'following' ? 'active' : ''}" role="tab">フォロー中</button></div>`;
  main.innerHTML = pageHead({ title: 'ホーム', tabs }).replace('class="page-head', 'class="page-head home-head') + `<div class="content">
    ${me ? `<div class="card compose-card" id="home-compose">${composeHtml()}</div>` : welcomeCard()}
    <div id="question-card" class="hidden"></div>
    <div class="stack" id="feed"></div></div>`;
  questionCard();
  $$('.tabs button', main).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'following' && !me) return openAuth();
    tlMode = b.dataset.mode; viewHome();
  }));
  $('#start-btn')?.addEventListener('click', () => openAuth('register'));
  $('#welcome-login')?.addEventListener('click', () => openAuth('login'));
  if (me) bindCompose($('#home-compose'), { onDone: (p) => { $('#feed .empty')?.remove(); $('#feed').insertAdjacentHTML('afterbegin', renderPost(p, { fresh: true })); toast('投稿しました', 'success'); } });
  await loadFeed((before) => `/timeline?mode=${tlMode}${before ? '&before=' + before : ''}`,
    tlMode === 'following' ? { icon: 'users', title: 'まだ投稿がありません', text: 'フォローした人の投稿がここに表示されます。発見ページで気になる人を探してみましょう。' }
      : { icon: 'sparkle', title: '最初の投稿をしてみましょう', text: 'リンクを貼ると、みんなが仮想ブラウザで安全に開けます。' });
}
function welcomeCard() {
  return `<div class="card welcome">
    <span class="brand-mark lg"></span>
    <h2>学校のための、安心できるSNS</h2>
    <p>IppO は招待制のソーシャルプラットフォームです。投稿のリンクはすべて仮想ブラウザで開かれ、あなたの端末を守ります。</p>
    <div class="feature-list">
      <div>${icon('users')}コミュニティで、好きなことを語り合う</div>
      <div>${icon('calendar')}学校の予定表をいつでも確認</div>
      <div>${icon('shield')}リンクは仮想ブラウザで安全に</div>
    </div>
    <div class="row"><button class="btn btn-primary btn-lg" id="start-btn" type="button">はじめる</button><button class="btn btn-ghost btn-lg" id="welcome-login" type="button">ログイン</button></div>
  </div>`;
}

// タイムラインの読み込み (最初はスケルトン、以降は「さらに読み込む」)
async function loadFeed(pathFn, empty, feedEl = $('#feed')) {
  let before = null;
  feedEl.innerHTML = skeletonPosts(3);
  const more = async () => {
    let posts;
    try { ({ posts } = await api(pathFn(before), { noAuthPrompt: true })); }
    catch (e) { feedEl.innerHTML = emptyState({ icon: 'alert', title: '読み込めませんでした', text: esc(e.message) }); return; }
    if (!before) feedEl.innerHTML = '';
    $('.more', feedEl)?.remove();
    if (!posts.length && !before) { feedEl.innerHTML = emptyState(typeof empty === 'string' ? { title: empty } : empty); return; }
    feedEl.insertAdjacentHTML('beforeend', posts.map((p) => renderPost(p)).join(''));
    if (posts.length === 30) {
      before = posts[posts.length - 1].id;
      feedEl.insertAdjacentHTML('beforeend', '<button class="more" type="button">さらに読み込む</button>');
      $('.more', feedEl).addEventListener('click', more);
    }
  };
  await more();
}

// 投稿詳細 + コメント
async function viewPost(id) {
  main.innerHTML = pageHead({ title: '投稿', back: '#/' }) + `<div class="content" id="thread">${skeletonPosts(1)}</div>`;
  try {
    const { post, ancestors, replies } = await api('/posts/' + id, { noAuthPrompt: true });
    $('#thread').innerHTML = ancestors.map((p) => renderPost(p)).join('') + renderPost(post, { focus: true }) +
      `<h2 class="section-title">コメント${post.counts.replies ? ` ${post.counts.replies}件` : ''}</h2>` +
      (me ? `<div class="card compose-card" id="reply-compose">${composeHtml({ placeholder: 'コメントを書く', submit: 'コメント' })}</div>`
        : `<div class="card card-pad row"><span class="muted text-sm" style="flex:1">ログインするとコメントできます</span><button class="btn btn-primary btn-sm" type="button" id="reply-login">ログイン</button></div>`) +
      `<div class="stack" id="replies">${replies.length ? replies.map((p) => renderPost(p)).join('') : ''}</div>`;
    $('#reply-login')?.addEventListener('click', () => openAuth());
    if (me) bindCompose($('#reply-compose'), { replyTo: post.id, onDone: (p) => { $('#replies').insertAdjacentHTML('beforeend', renderPost(p, { fresh: true })); toast('コメントしました', 'success'); } });
  } catch (e) { $('#thread').innerHTML = emptyState({ icon: 'alert', title: e.message }); }
}

// プロフィール
async function viewUser(username, tab = 'posts') {
  main.innerHTML = pageHead({ title: '@' + esc(username), back: '#/' }) + loadingBlock();
  let user;
  try { ({ user } = await api('/users/' + encodeURIComponent(username) + '?before=0', { noAuthPrompt: true })); }
  catch (e) { main.innerHTML = pageHead({ title: 'プロフィール', back: '#/' }) + emptyState({ icon: 'user', title: e.message }); return; }
  const isMe = me && me.id === user.id;
  const actions = isMe
    ? `<button class="btn btn-outline btn-sm" id="edit-profile" type="button">${icon('edit')}編集</button><a class="icon-btn" href="#/settings" aria-label="設定">${icon('settings')}</a>`
    : me ? `<a class="icon-btn" href="#/dm/${esc(user.username)}" aria-label="メッセージを送る" style="border:1px solid var(--border-strong)">${icon('mail')}</a>${followBtn(user)}` : '';
  main.innerHTML = pageHead({ title: esc(user.displayName) + adminBadge(user), sub: `${user.stats.posts}件の投稿`, back: '#/' }) + `<div class="content">
    <section class="hero">
      <div class="hero-cover"></div>
      <div class="hero-body">
        <div class="hero-top">${avatar(user, 'lg')}<div class="hero-actions">${actions}</div></div>
        <h2>${esc(user.displayName)}${adminBadge(user, true)}</h2>
        <div class="handle">@${esc(user.username)}</div>
        ${user.bio ? `<p class="hero-bio">${richText(user.bio)}</p>` : isMe ? '<p class="hero-bio muted">自己紹介を書いてみましょう</p>' : ''}
        <div class="hero-meta"><span>${icon('calendar')}${new Date(user.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}から利用</span></div>
        <div class="stats">
          <div class="stat"><b>${user.stats.posts}</b><span>投稿</span></div>
          <div class="stat"><b id="followers-count">${user.stats.followers}</b><span>フォロワー</span></div>
          <div class="stat"><b>${user.stats.following}</b><span>フォロー中</span></div>
        </div>
      </div>
    </section>
    ${isMe ? `<div class="tabs card" role="tablist" style="padding:0 var(--s2)"><button class="${tab === 'posts' ? 'active' : ''}" data-tab="posts">投稿</button><button class="${tab === 'bookmarks' ? 'active' : ''}" data-tab="bookmarks">ブックマーク</button></div>` : ''}
    <div class="stack" id="feed"></div></div>`;
  $$('[data-tab]', main).forEach((b) => b.addEventListener('click', () => viewUser(username, b.dataset.tab)));
  $('#edit-profile')?.addEventListener('click', () => editProfile(user));
  main.querySelector('.hero').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) VB.open(l.dataset.url); });
  if (isMe && tab === 'bookmarks') return renderBookmarks($('#feed'));
  await loadFeed((before) => `/users/${encodeURIComponent(username)}${before ? '?before=' + before : ''}`,
    { icon: 'edit', title: isMe ? 'まだ投稿がありません' : 'まだ投稿がありません', text: isMe ? '最初の投稿をしてみましょう。' : '' });
}
function editProfile(user) {
  openPanel('プロフィールを編集', `<form class="form-stack" id="profile-form">
      <label class="field"><span class="field-label">表示名</span><input class="input" name="displayName" maxlength="50" value="${esc(user.displayName)}" required></label>
      <label class="field"><span class="field-label">自己紹介</span><textarea class="textarea" name="bio" maxlength="160" rows="4" placeholder="好きなこと、部活、ひとことなど">${esc(user.bio || '')}</textarea><span class="field-hint" id="bio-count"></span></label>
      <p class="form-error" id="profile-error"></p>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="submit">保存</button></div>
    </form>`, (root, close) => {
    const f = $('#profile-form', root), cnt = $('#bio-count', root);
    const upd = () => { cnt.textContent = `${[...f.bio.value].length} / 160`; };
    f.bio.addEventListener('input', upd); upd();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        me = (await api('/me', { method: 'PATCH', body: { displayName: f.displayName.value, bio: f.bio.value } })).user;
        close(); renderMe(); toast('プロフィールを更新しました', 'success'); viewUser(me.username);
      } catch (err) { $('#profile-error', root).textContent = err.message; }
    });
  });
}

// ブックマーク (この端末に保存したもの)
async function renderBookmarks(el) {
  const ids = bookmarks.list();
  if (!ids.length) { el.innerHTML = emptyState({ icon: 'bookmark', title: 'ブックマークはまだありません', text: '投稿の右下の ' + icon('bookmark', 'ic-sm') + ' で保存できます。ブックマークはこの端末に保存されます。' }); return; }
  el.innerHTML = skeletonPosts(2);
  const results = await Promise.all(ids.slice(0, 50).map((id) => api('/posts/' + id, { noAuthPrompt: true }).then((r) => r.post).catch(() => { bookmarks.remove(id); return null; })));
  const posts = results.filter(Boolean);
  el.innerHTML = posts.length ? posts.map((p) => renderPost(p)).join('') + '<p class="text-xs muted" style="text-align:center">ブックマークはこの端末に保存されています</p>'
    : emptyState({ icon: 'bookmark', title: 'ブックマークはまだありません' });
}
async function viewBookmarks() {
  main.innerHTML = pageHead({ title: 'ブックマーク', sub: 'この端末に保存' }) + '<div class="content"><div class="stack" id="feed"></div></div>';
  renderBookmarks($('#feed'));
}

// 発見 (検索・トレンド・ショートカット)
async function viewSearch(q) {
  const form = `<form class="search-field" id="sf" role="search">${icon('search')}<input class="input" name="q" type="search" placeholder="キーワード・#タグ・ユーザー・URL" value="${esc(q)}" enterkeyhint="search" autocomplete="off"></form>`;
  main.innerHTML = pageHead({ title: q ? '検索結果' : '発見', back: q ? '#/search' : null }) + `<div class="content">${form}<div class="stack" id="res"></div></div>`;
  $('#sf').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) location.hash = '#/search?q=' + encodeURIComponent(v); });
  const res = $('#res');
  if (!q) {
    res.innerHTML = `<div class="shortcuts">
        <a class="card shortcut" href="#/schedule"><span class="shortcut-icon">${icon('calendar')}</span><b>予定表</b><span>学校の行事</span></a>
        <a class="card shortcut" href="#/q"><span class="shortcut-icon">${icon('sparkle')}</span><b>今日の質問</b><span>みんなの回答</span></a>
        <a class="card shortcut" href="#/c"><span class="shortcut-icon">${icon('users')}</span><b>コミュニティ</b><span>仲間を探す</span></a>
        <a class="card shortcut" href="#/bookmarks"><span class="shortcut-icon">${icon('bookmark')}</span><b>ブックマーク</b><span>保存した投稿</span></a>
      </div>
      <section class="card card-pad"><div class="panel-head"><h3>${icon('trend', 'ic-sm')}トレンド</h3></div><div id="discover-trends">${'<div class="sk sk-line" style="margin:10px 0"></div>'.repeat(4)}</div></section>
      <section class="card card-pad"><div class="panel-head"><h3>おすすめのユーザー</h3></div><div id="discover-users"></div></section>`;
    $('#discover-trends').innerHTML = await trendsHtml().catch(() => '<p class="muted text-sm">読み込めませんでした</p>');
    const { users } = await api('/users', { noAuthPrompt: true }).catch(() => ({ users: [] }));
    $('#discover-users').innerHTML = users.length ? users.map(userRow).join('') : '<p class="muted text-sm">まだいません</p>';
    return;
  }
  if (/^https?:\/\//.test(q)) { res.innerHTML = emptyState({ icon: 'shield', title: '仮想ブラウザで開いています' }); return VB.open(q); }
  res.innerHTML = skeletonPosts(2);
  const { posts, users } = await api('/search?q=' + encodeURIComponent(q), { noAuthPrompt: true });
  res.innerHTML = (users.length ? `<section class="card card-pad"><div class="panel-head"><h3>ユーザー</h3></div>${users.map((u) => userRow({ ...u, followed: false })).join('')}</section>` : '') +
    (posts.length ? `<h2 class="section-title">投稿 ${posts.length}件</h2>` + posts.map((p) => renderPost(p)).join('')
      : emptyState({ icon: 'search', title: `「${q}」に一致する投稿はありません`, text: '別のキーワードで探してみましょう。' }));
}

// 通知 (返信・メンション・リポスト・いいね・フォロー)
async function viewNotifications() {
  main.innerHTML = pageHead({ title: '通知' }) + `<div class="content" id="notifs">${'<div class="card card-pad"><div class="row"><div class="sk sk-circle"></div><div style="flex:1"><div class="sk sk-line" style="width:60%"></div><div class="sk sk-line" style="width:40%;margin-top:8px"></div></div></div></div>'.repeat(3)}</div>`;
  let data;
  try { data = await api('/notifications'); } catch (e) { $('#notifs').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const seen = notifSeen();
  store.set('ippo_notif_seen', { at: Math.max(seen.at, data.cursor.at), like: Math.max(seen.like, data.cursor.like), follow: Math.max(seen.follow, data.cursor.follow) });
  refreshBadges(true);
  const label = { reply: 'があなたの投稿にコメントしました', mention: 'があなたをメンションしました', repost: 'があなたの投稿をリポストしました' };
  const ic = { reply: 'comment', mention: 'at', repost: 'repeat' };
  const quote = (p) => esc(p.content.length > 90 ? p.content.slice(0, 90) + '…' : p.content);
  const activity = data.activity.map((a) => `<a class="notif${a.at > seen.at ? ' unread' : ''}" href="#/p/${a.type === 'repost' ? a.post.id : a.post.id}">
      <span class="notif-icon ${a.type}">${icon(ic[a.type])}</span>
      <div class="notif-body"><div class="notif-text"><b>${esc(a.user.displayName)}${adminBadge(a.user)}</b>さん${label[a.type]}</div><div class="notif-quote">${quote(a.post)}</div></div>
      <time>${timeAgo(a.at)}</time></a>`).join('');
  const likes = data.likes.map((g) => `<a class="notif${g.rid > seen.like ? ' unread' : ''}" href="#/p/${g.post.id}">
      <span class="notif-icon like">${icon('heart')}</span>
      <div class="notif-body"><div class="notif-avatars">${g.users.map((u) => avatar(u, 'xs')).join('')}</div>
        <div class="notif-text"><b>${esc(g.users[0]?.displayName || '')}${adminBadge(g.users[0])}</b>さん${g.total > 1 ? `ほか${g.total - 1}人` : ''}があなたの投稿にいいねしました</div><div class="notif-quote">${quote(g.post)}</div></div></a>`).join('');
  const follows = data.follows.map((f) => `<a class="notif${f.rid > seen.follow ? ' unread' : ''}" href="#/u/${esc(f.user.username)}">
      <span class="notif-icon follow">${icon('user-plus')}</span>
      <div class="notif-body"><div class="notif-text"><b>${esc(f.user.displayName)}${adminBadge(f.user)}</b>さんにフォローされました</div><div class="notif-quote">@${esc(f.user.username)}</div></div></a>`).join('');
  $('#notifs').innerHTML = (!activity && !likes && !follows)
    ? emptyState({ icon: 'bell', title: 'まだ通知はありません', text: 'コメントやいいね、フォローがあるとここでお知らせします。' })
    : (activity ? `<h2 class="section-title">アクティビティ</h2><div class="list-card">${activity}</div>` : '') +
      (likes ? `<h2 class="section-title">いいね</h2><div class="list-card">${likes}</div>` : '') +
      (follows ? `<h2 class="section-title">新しいフォロワー</h2><div class="list-card">${follows}</div>` : '');
}

// =====================================================================
// 今日の質問
// =====================================================================
async function questionCard() {
  const el = $('#question-card');
  if (!el) return;
  try {
    const q = await api('/question', { noAuthPrompt: true });
    el.className = 'question';
    el.innerHTML = `<div class="question-label">${icon('sparkle')}今日の質問</div>
      <div class="question-text">${esc(q.text)}</div>
      <div class="question-actions">
        <button class="btn btn-primary btn-sm" id="q-answer" type="button">${q.answered ? 'もう一度答える' : '答える'}</button>
        <a class="btn btn-ghost btn-sm" href="#/q">みんなの回答${q.answers ? `（${q.answers}）` : ''}</a>
      </div>`;
    $('#q-answer').addEventListener('click', () => openCompose({ extra: { question: true }, title: q.text, placeholder: 'あなたの答えは？' }));
  } catch { el.classList.add('hidden'); }
}
async function viewQuestion() {
  main.innerHTML = pageHead({ title: '今日の質問', back: '#/' }) + `<div class="content"><div id="question-card"></div><h2 class="section-title">みんなの回答</h2><div class="stack" id="feed"></div></div>`;
  questionCard();
  await loadFeed((before) => `/question/answers${before ? '?before=' + before : ''}`, { icon: 'sparkle', title: 'まだ回答がありません', text: '最初に答えてみましょう！' });
}

// =====================================================================
// トレンド
// =====================================================================
async function trendsHtml() {
  const { period, trends } = await api('/trends', { noAuthPrompt: true });
  if (!trends.length) return '<p class="text-sm muted">まだトレンドはありません。みんなの投稿によく出てくる言葉がここに表示されます。</p>';
  return trends.map((t, i) => `<a class="trend" href="#/search?q=${encodeURIComponent(t.tag)}">
      <span class="trend-rank">${i + 1}</span>
      <span class="trend-body"><b>${esc(t.tag)}</b><span>${t.posts}件の投稿 · ${t.users}人</span></span>
    </a>`).join('') + `<p class="trend-period">直近${period}の集計</p>`;
}
async function loadTrends() {
  const el = $('#trends .list');
  if (el) el.innerHTML = await trendsHtml().catch(() => '<p class="text-sm muted">読み込めませんでした</p>');
}
setInterval(() => { if (!document.hidden) loadTrends(); }, 120_000);
$('#rail-search').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) { location.hash = '#/search?q=' + encodeURIComponent(v); e.target.q.blur(); } });

// =====================================================================
// コミュニティ
// =====================================================================
const communityIcon = (c, lg = false) => `<span class="community-icon${lg ? ' lg' : ''}" style="background:${colorFor(c.slug)}">${esc([...c.name][0] || '?')}</span>`;
function communityCard(c) {
  return `<a class="card community-card" href="#/c/${esc(c.slug)}">
    <div class="row">${communityIcon(c)}<div style="min-width:0;flex:1"><h3>${esc(c.name)}</h3>
      <div class="meta">${icon('users', 'ic-sm')}${c.members}人${c.joined ? ' · <span style="color:var(--accent-text);font-weight:650">参加中</span>' : ''}</div></div></div>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
  </a>`;
}
async function viewCommunities() {
  const act = me ? `<button class="btn btn-primary btn-sm" type="button" id="community-new">${icon('plus')}作成</button>` : '';
  main.innerHTML = pageHead({ title: 'コミュニティ', actions: act }) + `<div class="content" id="community-list">${'<div class="card card-pad"><div class="row"><div class="sk sk-circle"></div><div style="flex:1"><div class="sk sk-line" style="width:50%"></div></div></div></div>'.repeat(3)}</div>`;
  $('#community-new')?.addEventListener('click', createCommunity);
  const [all, mine] = await Promise.all([
    api('/communities', { noAuthPrompt: true }),
    me ? api('/communities?mine=1', { noAuthPrompt: true }) : Promise.resolve({ communities: [] }),
  ]);
  const joined = new Set(mine.communities.map((c) => c.slug));
  const others = all.communities.filter((c) => !joined.has(c.slug));
  $('#community-list').innerHTML =
    (mine.communities.length ? `<h2 class="section-title">参加中</h2><div class="grid-2">${mine.communities.map(communityCard).join('')}</div>` : '') +
    (others.length ? `<h2 class="section-title">みんなのコミュニティ</h2><div class="grid-2">${others.map(communityCard).join('')}</div>` : '') +
    (!all.communities.length ? emptyState({ icon: 'users', title: 'まだコミュニティがありません', text: '部活や趣味、クラスの話題など、最初のコミュニティを作ってみましょう。',
      action: me ? `<button class="btn btn-primary" type="button" id="community-new-2">${icon('plus')}コミュニティを作る</button>` : '' }) : '');
  $('#community-new-2')?.addEventListener('click', createCommunity);
}
function createCommunity() {
  openPanel('コミュニティを作る', `<form class="form-stack" id="community-form">
      <label class="field"><span class="field-label">コミュニティ名</span><input class="input" name="name" placeholder="例: 写真部" maxlength="50" required></label>
      <label class="field"><span class="field-label">ID</span><input class="input" name="slug" placeholder="例: photo-club" pattern="[A-Za-z0-9_\\-]{3,30}" autocapitalize="off" spellcheck="false" required>
        <span class="field-hint">英数字と - _ で3〜30文字。URL（/c/ID）になります</span></label>
      <label class="field"><span class="field-label">説明 <span class="muted">（任意）</span></span><textarea class="textarea" name="description" maxlength="300" rows="3" placeholder="どんな人に来てほしいか書いてみましょう"></textarea></label>
      <p class="form-error" id="community-error"></p>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="submit">作成する</button></div>
    </form>`, (root, close) => {
    $('#community-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { community } = await api('/communities', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        close(); toast('コミュニティを作成しました', 'success');
        location.hash = '#/c/' + community.slug;
      } catch (err) { $('#community-error', root).textContent = err.message; }
    });
  });
}
async function viewCommunity(slug) {
  main.innerHTML = pageHead({ title: 'コミュニティ', back: '#/c' }) + loadingBlock();
  let c;
  try { c = (await api('/communities/' + encodeURIComponent(slug) + '?before=0', { noAuthPrompt: true })).community; }
  catch (e) { main.innerHTML = pageHead({ title: 'コミュニティ', back: '#/c' }) + emptyState({ icon: 'users', title: e.message }); return; }
  currentCommunity = c.joined ? c : null;
  const action = !me ? '' : (c.canDelete ? `<button class="btn btn-danger-outline btn-sm" id="community-delete" type="button">${icon('trash')}削除</button>` : '') +
    (c.isOwner ? '' : `<button class="btn btn-sm ${c.joined ? 'btn-outline' : 'btn-primary'}" id="community-join" type="button">${c.joined ? '参加中' : '参加する'}</button>`);
  main.innerHTML = pageHead({ title: esc(c.name), sub: `${c.members}人のメンバー`, back: '#/c' }) + `<div class="content">
    <section class="hero community-head">
      <div class="hero-cover"></div>
      <div class="hero-body">
        <div class="hero-top">${communityIcon(c, true)}<div class="hero-actions">${action}</div></div>
        <h2>${esc(c.name)}</h2>
        <div class="handle">/c/${esc(c.slug)}</div>
        ${c.description ? `<p class="hero-bio">${richText(c.description)}</p>` : ''}
        <div class="hero-meta"><span>${icon('users')}${c.members}人のメンバー</span><span>${icon('user')}作成: <a href="#/u/${esc(c.owner.username)}">@${esc(c.owner.username)}</a></span></div>
      </div>
    </section>
    ${c.joined ? `<div class="card compose-card" id="community-compose">${composeHtml({ placeholder: `${c.name} に投稿` })}</div>`
      : me ? `<div class="card card-pad row"><span class="text-sm muted" style="flex:1">参加すると、このコミュニティに投稿できます</span><button class="btn btn-primary btn-sm" type="button" id="community-join-2">参加する</button></div>` : ''}
    <div class="stack" id="feed"></div></div>`;
  const join = async () => {
    try {
      await api(`/communities/${encodeURIComponent(slug)}/join`, { method: c.joined ? 'DELETE' : 'POST' });
      toast(c.joined ? 'コミュニティから退出しました' : `「${c.name}」に参加しました`, c.joined ? '' : 'success');
      viewCommunity(slug);
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#community-join')?.addEventListener('click', join);
  $('#community-join-2')?.addEventListener('click', join);
  $('#community-delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: `「${c.name}」を削除しますか？`, body: (c.isOwner ? '' : '管理者として削除します。\n') + 'コミュニティ内の投稿もすべて削除され、元に戻せません。', ok: '削除する', danger: true }))) return;
    try { await api('/communities/' + encodeURIComponent(slug), { method: 'DELETE' }); toast('コミュニティを削除しました'); location.hash = '#/c'; } catch (e) { toast(e.message, 'error'); }
  });
  if (c.joined) bindCompose($('#community-compose'), { extra: { community: c.slug }, onDone: (p) => { $('#feed .empty')?.remove(); $('#feed').insertAdjacentHTML('afterbegin', renderPost(p, { fresh: true })); toast('投稿しました', 'success'); } });
  main.querySelector('.community-head').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) VB.open(l.dataset.url); });
  await loadFeed((before) => `/communities/${encodeURIComponent(slug)}${before ? '?before=' + before : ''}`, { icon: 'comment', title: 'まだ投稿がありません', text: c.joined ? '最初の話題を投稿してみましょう。' : '' });
}

// =====================================================================
// 設定 / 招待 / 緊急データ削除
// =====================================================================
function viewSettings() {
  const theme = store.get('ippo_theme', 'auto');
  main.innerHTML = pageHead({ title: '設定' }) + `<div class="content">
    <section class="settings-group"><h2>アカウント</h2>
      <div class="list-card">
        <a class="list-item" href="#/u/${esc(me.username)}">${avatar(me, 'sm')}<div class="grow"><div class="title">${esc(me.displayName)}${adminBadge(me)}</div><div class="desc">@${esc(me.username)}</div></div>${icon('chevron', 'chev')}</a>
        <button class="list-item" type="button" id="settings-edit">${icon('edit')}<div class="grow title">プロフィールを編集</div>${icon('chevron', 'chev')}</button>
        <a class="list-item" href="#/bookmarks">${icon('bookmark')}<div class="grow title">ブックマーク</div>${icon('chevron', 'chev')}</a>
        <button class="list-item" type="button" id="settings-logout">${icon('logout')}<div class="grow title">ログアウト</div></button>
      </div>
    </section>
    ${me.isAdmin ? `<section class="settings-group"><h2>管理者</h2><div class="list-card">
        <a class="list-item" href="#/admin">${icon('shield')}<div class="grow"><div class="title">管理者画面</div><div class="desc">ユーザー管理・利用状況</div></div>${icon('chevron', 'chev')}</a></div></section>` : ''}
    <section class="settings-group"><h2>表示</h2>
      <div class="card card-pad">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap"><div><div class="title" style="font-weight:650">テーマ</div><div class="text-sm muted">「自動」は端末の設定に合わせます</div></div>
        <div class="segmented" style="min-width:240px">${[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) => `<button type="button" class="seg${theme === v ? ' active' : ''}" data-theme-opt="${v}">${l}</button>`).join('')}</div></div>
      </div>
    </section>
    <section class="settings-group" id="invite-section"><h2>友だちを招待</h2>
      <div class="card card-pad">
        <p class="text-sm" style="color:var(--text-2)">IppO は招待制です。招待リンクを作って、参加してほしい人に送ってください。リンクは1人1回だけ使え、7日で期限切れになります。</p>
        <button class="btn btn-primary" id="invite-create" type="button" style="margin-top:var(--s4)">${icon('ticket')}招待リンクを作る</button>
        <p class="form-error" id="invite-error" style="margin-top:8px"></p>
        <div id="invite-list"></div>
      </div>
    </section>
    <section class="settings-group"><h2>安全</h2>
      <div class="card card-pad danger-card">
        <h3 class="card-title">${icon('alert')}緊急データ削除</h3>
        <p style="margin-top:8px;color:var(--text-2)">あなたのデータをすぐに、完全に削除します。<b>元に戻すことはできません。</b></p>
        <ul class="bullets">
          <li>投稿・コメント・リポスト・いいね・今日の質問への回答</li>
          <li>DM（<b>相手の画面からも消えます</b>）</li>
          <li>フォロー／フォロワー、参加中・作成したコミュニティ（中の投稿も含む）、作成した招待</li>
          <li>開いている仮想ブラウザ（閲覧履歴・Cookie）と、この端末に保存された設定</li>
        </ul>
        <p class="text-sm muted">削除したデータは、サーバーのデータベースファイル上でも上書きされ、痕跡が残りません。</p>
        <form id="wipe-form" class="form-stack" style="margin-top:var(--s4)">
          <label class="choice danger"><input type="radio" name="mode" value="content" checked><span><b>履歴をすべて削除</b><small>アカウント（ユーザー名・パスワード）は残ります。他の端末はログアウトされます</small></span></label>
          <label class="choice danger"><input type="radio" name="mode" value="account"><span><b>アカウントごと完全に削除</b><small>ユーザー名も含めて、すべてが消えます</small></span></label>
          <label class="field"><span class="field-label">確認のためパスワードを入力</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <p class="form-error" id="wipe-error"></p>
          <button class="btn btn-danger btn-lg btn-block" type="submit">今すぐ削除する</button>
        </form>
      </div>
    </section></div>`;
  loadInvites();
  $('#settings-edit').addEventListener('click', () => editProfile(me));
  $('#settings-logout').addEventListener('click', logout);
  $$('[data-theme-opt]', main).forEach((b) => b.addEventListener('click', () => {
    store.set('ippo_theme', b.dataset.themeOpt); applyTheme(b.dataset.themeOpt);
    $$('[data-theme-opt]', main).forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#invite-create').addEventListener('click', async () => {
    $('#invite-error').textContent = '';
    try { const { invite } = await api('/invites', { method: 'POST' }); await loadInvites(); shareInvite(invite.code); }
    catch (err) { $('#invite-error').textContent = err.message; }
  });
  $('#wipe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const label = fd.mode === 'account' ? 'アカウントとすべてのデータ' : 'すべての履歴';
    if (!(await confirmDialog({ title: '本当に削除しますか？', body: `${label}を完全に削除します。\n元に戻すことはできません。`, ok: '削除する', danger: true }))) return;
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true; btn.textContent = '削除しています…';
    try {
      await api('/me/wipe', { method: 'POST', body: fd, noAuthPrompt: true });
      VB.close();
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
      if (fd.mode === 'account') { me = null; }
      await confirmDialog({ title: '削除しました', body: fd.mode === 'account' ? 'アカウントとすべてのデータを削除しました。' : 'すべての履歴を削除しました。', ok: 'OK' });
      location.replace('/#/');
      location.reload();
    } catch (err) {
      $('#wipe-error').textContent = err.message;
      btn.disabled = false; btn.textContent = '今すぐ削除する';
    }
  });
}

// =====================================================================
// 管理者画面 (権限の確認はサーバー側で行う)
// =====================================================================
async function viewAdmin(q = '') {
  if (!me.isAdmin) { main.innerHTML = pageHead({ title: '管理' }) + emptyState({ icon: 'lock', title: '管理者だけが使える画面です' }); return; }
  main.innerHTML = pageHead({ title: '管理者画面', sub: '@' + esc(me.username) + ' として操作中' }) + `<div class="content">
    <div class="stat-grid" id="admin-stats">${'<div class="card stat-card"><div class="sk sk-line" style="width:50%"></div><div class="sk sk-line" style="width:30%;margin-top:10px;height:22px"></div></div>'.repeat(4)}</div>
    <section class="settings-group"><h2>ユーザー</h2>
      <form class="search-field" id="admin-search">${icon('search')}<input class="input" name="q" placeholder="ユーザー名・表示名で検索" value="${esc(q)}" autocomplete="off" autocapitalize="off"></form>
      <div id="admin-users"></div>
    </section>
    <p class="text-xs muted">管理者は Railway の環境変数 ADMIN_USERS で指定します。管理者の操作はサーバーの記録 (ログ) に残ります。DM の内容は管理者にも見えません。</p>
  </div>`;
  $('#admin-search').addEventListener('submit', (e) => { e.preventDefault(); loadAdminUsers(e.target.q.value.trim()); });
  try {
    const s = await api('/admin/stats');
    const card = (label, value, sub = '') => `<div class="card stat-card"><span class="stat-label">${label}</span><b>${value.toLocaleString()}</b>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
    $('#admin-stats').innerHTML = card('ユーザー', s.users, `今週 +${s.usersWeek}`) + card('投稿', s.posts, `24時間 +${s.postsDay}`) +
      card('コミュニティ', s.communities) + card('最近ログインした人', s.activeUsers, '直近7日') + card('DM', s.dms, '件数のみ') + card('未使用の招待', s.openInvites);
  } catch (e) { $('#admin-stats').innerHTML = emptyState({ icon: 'alert', title: e.message }); }
  loadAdminUsers(q);
}
async function loadAdminUsers(q) {
  const el = $('#admin-users');
  el.innerHTML = `<div class="list-card">${'<div class="list-item"><div class="sk sk-circle"></div><div style="flex:1"><div class="sk sk-line" style="width:40%"></div></div></div>'.repeat(3)}</div>`;
  let users;
  try { ({ users } = await api('/admin/users?q=' + encodeURIComponent(q))); } catch (e) { el.innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  if (!users.length) { el.innerHTML = emptyState({ icon: 'search', title: '見つかりませんでした' }); return; }
  el.innerHTML = `<div class="list-card">${users.map((u) => `<div class="list-item admin-user" data-u="${esc(u.username)}">
      ${avatar(u, 'sm', true)}
      <div class="grow">
        <div class="title">${esc(u.displayName)} <span class="muted text-sm" style="font-weight:500">@${esc(u.username)}</span>${adminBadge(u, true)}</div>
        <div class="desc">${new Date(u.createdAt).toLocaleDateString('ja-JP')} 登録${u.invitedBy ? ` · <a href="#/u/${esc(u.invitedBy)}">@${esc(u.invitedBy)}</a> の招待` : ''} · 投稿 ${u.posts} · フォロワー ${u.followers}${u.invited ? ` · 招待した人 ${u.invited}` : ''}</div>
      </div>
      ${u.isAdmin ? '' : `<button class="icon-btn" type="button" data-admin-menu aria-label="操作">${icon('more')}</button>`}
    </div>`).join('')}</div>`;
  $$('[data-admin-menu]', el).forEach((b) => b.addEventListener('click', () => {
    const name = b.closest('[data-u]').dataset.u;
    openMenu(b, [
      { icon: 'user', label: 'プロフィールを見る', run: () => { location.hash = '#/u/' + name; } },
      { icon: 'logout', label: '強制ログアウト', run: async () => {
        if (!(await confirmDialog({ title: `@${name} を強制ログアウトしますか？`, body: 'すべての端末でログアウトされます。パスワードを知っていれば、またログインできます。', ok: 'ログアウトさせる' }))) return;
        try { await api(`/admin/users/${name}/logout`, { method: 'POST' }); toast(`@${name} をログアウトさせました`, 'success'); } catch (e) { toast(e.message, 'error'); }
      } },
      { icon: 'trash', label: 'アカウントを削除', danger: true, run: async () => {
        if (!(await confirmDialog({ title: `@${name} のアカウントを削除しますか？`, body: '投稿・DM・フォロー・作成したコミュニティなど、このユーザーのデータがすべて完全に削除されます。\n元に戻すことはできません。', ok: '削除する', danger: true }))) return;
        try { await api(`/admin/users/${name}`, { method: 'DELETE' }); toast(`@${name} のアカウントを削除しました`); loadAdminUsers($('#admin-search').q.value.trim()); } catch (e) { toast(e.message, 'error'); }
      } },
    ]);
  }));
}

// =====================================================================
// 予定表 (学校の行事予定表を PDF から書き起こしたデータを表示する)
// データ: /schedules/index.json と /schedules/<id>.json
// =====================================================================
const SCHEDULE_CATS = {
  exam: { label: '試験' },
  event: { label: '行事' },
  off: { label: '休日・休業' },
  staff: { label: '教職員' },
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
  return `<span class="sch-ev cat-${e.cat}" title="${SCHEDULE_CATS[e.cat].label}">${esc(e.text)}${e.range ? ` <span class="sch-range">${esc(e.range)}</span>` : ''}</span>`;
}
// 右カラム (PC) の「次の予定」
async function loadScheduleWidget() {
  const el = $('#schedule-widget .list');
  if (!el) return;
  try {
    const s = await loadSchedule();
    const up = upcomingEvents(s, todayYmd(), 4);
    el.innerHTML = up.length
      ? up.map(({ day, e }) => `<a class="sch-mini" href="#/schedule"><span class="sch-mini-day${day === todayYmd() ? ' today' : ''}">${day === todayYmd() ? '今日' : fmtDay(day)}</span>${eventChip(e)}</a>`).join('')
      : '<p class="text-sm muted">この学期の予定は終わりました</p>';
  } catch { el.innerHTML = '<p class="text-sm muted">読み込めませんでした</p>'; }
}
let scheduleMonth = null, scheduleFilter = new Set(Object.keys(SCHEDULE_CATS)), scheduleSelected = null;
async function viewSchedule() {
  if (!$('.sch-cal', main)) main.innerHTML = pageHead({ title: '予定表' }) + loadingBlock();
  let s;
  try { s = await loadSchedule(); } catch { main.innerHTML = pageHead({ title: '予定表' }) + emptyState({ icon: 'calendar', title: '予定表を読み込めませんでした' }); return; }
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
    cells += `<button class="${cls}" data-day="${day}" type="button" aria-label="${mm}月${d}日 予定${evs.length}件"><span class="sch-num">${d}</span>
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
      <div class="sch-row-day ${dow === 0 || s.holidays.has(day) ? 'sun' : dow === 6 ? 'sat' : ''}">${fmtDay(day)}${day === t ? '<span class="chip chip-accent">今日</span>' : ''}</div>
      <div class="sch-row-evs">${evs.map(eventChip).join('')}</div></div>`;
  }).join('');
  const notes = visible((data.notes[scheduleMonth] || []).map((n) => ({ text: n, cat: scheduleCategory(n) })));

  main.innerHTML = pageHead({ title: '予定表', sub: esc(data.org), actions: `<a class="btn btn-outline btn-sm" href="${esc(data.pdf)}" target="_blank" rel="noopener">${icon('file')}PDF</a>` }) + `<div class="content">
    <section class="card card-pad">
      <div class="sch-head"><div><b>${esc(data.title)}</b></div></div>
      <div class="panel-head" style="margin-top:var(--s4)"><h3>今日 <span class="muted" style="font-weight:600">${fmtDay(t)}</span></h3></div>
      ${todays.length ? `<div class="sch-row-evs">${todays.map(eventChip).join('')}</div>` : '<p class="text-sm muted">今日の予定はありません</p>'}
      ${up.length ? `<div class="panel-head" style="margin-top:var(--s4)"><h3>これからの予定</h3></div>${up.map(({ day, e }) => `<div class="sch-up"><span class="sch-up-day">${fmtDay(day)}</span>${eventChip(e)}</div>`).join('')}` : ''}
    </section>
    <div class="sch-filters">${Object.entries(SCHEDULE_CATS).map(([k, c]) => `<button type="button" class="sch-filter cat-${k}${scheduleFilter.has(k) ? ' on' : ''}" data-cat="${k}" aria-pressed="${scheduleFilter.has(k)}">${c.label}</button>`).join('')}</div>
    <section class="card" style="overflow:hidden">
      <div class="tabs" style="border-bottom:1px solid var(--border)">${months.map((m) => `<button type="button" data-month="${m}" class="${m === scheduleMonth ? 'active' : ''}">${Number(m.slice(5))}月</button>`).join('')}</div>
      <div class="sch-cal">${WEEK.map((w, i) => `<div class="sch-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`).join('')}${cells}</div>
    </section>
    <section class="list-card">${listHtml || emptyState({ icon: 'calendar', title: 'この月の予定はありません' })}
      ${notes.length ? `<div class="sch-row"><div class="sch-row-day">この月</div><div class="sch-row-evs">${notes.map(eventChip).join('')}</div></div>` : ''}
    </section></div>`;

  $$('[data-month]', main).forEach((b) => b.addEventListener('click', () => { scheduleMonth = b.dataset.month; scheduleSelected = null; viewSchedule(); }));
  $$('[data-cat]', main).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cat;
    if (scheduleFilter.has(k) && scheduleFilter.size > 1) scheduleFilter.delete(k); else scheduleFilter.add(k);
    viewSchedule();
  }));
  // 日付をタップ → その日の予定までスクロールして強調
  $$('.sch-cell[data-day]', main).forEach((b) => b.addEventListener('click', () => {
    scheduleSelected = b.dataset.day;
    $$('.selected', main).forEach((el) => el.classList.remove('selected'));
    b.classList.add('selected');
    const row = document.getElementById('sch-' + b.dataset.day);
    if (row) { row.classList.add('selected'); row.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); }
  }));
}

// =====================================================================
// 招待
// =====================================================================
const inviteUrl = (code) => `${location.origin}/#/invite/${code}`;
async function shareInvite(code) {
  const url = inviteUrl(code);
  // スマホなら共有メニュー (LINE などに送れる)、使えなければコピー
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'IppO への招待', text: 'IppO に招待します。このリンクから登録してね', url }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました', 'success'); }
  catch {
    openPanel('招待リンク', `<p class="text-sm muted">このリンクをコピーして送ってください。</p><input class="input input-code" style="margin-top:12px;text-transform:none;letter-spacing:0" value="${esc(url)}" readonly id="invite-url">`,
      (root) => { const i = $('#invite-url', root); i.focus(); i.select(); });
  }
}
async function loadInvites() {
  const el = $('#invite-list');
  if (!el) return;
  const { invites } = await api('/invites');
  const label = { open: '未使用', used: '使用済み', expired: '期限切れ' };
  el.innerHTML = invites.length ? `<div style="margin-top:var(--s2)">` + invites.map((i) => `<div class="invite-row ${i.status}">
      <div class="grow">
        <code>${esc(i.code)}</code><span class="status ${i.status}">${label[i.status]}</span>
        <div class="text-xs muted" style="margin-top:2px">${i.status === 'used' ? (i.usedBy ? `<a href="#/u/${esc(i.usedBy.username)}">@${esc(i.usedBy.username)}</a> さんが登録` : '登録済み')
          : i.status === 'open' ? `期限: ${new Date(i.expiresAt).toLocaleDateString('ja-JP')}` : ''}</div>
      </div>
      ${i.status === 'open' ? `<button class="btn btn-secondary btn-sm" data-share="${esc(i.code)}" type="button">送る</button><button class="icon-btn" data-del="${esc(i.code)}" aria-label="削除" type="button">${icon('trash')}</button>` : ''}
    </div>`).join('') + '</div>' : '';
  $$('[data-share]', el).forEach((b) => b.addEventListener('click', () => shareInvite(b.dataset.share)));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '招待リンクを削除しますか？', body: 'このリンクでは登録できなくなります。', ok: '削除する', danger: true }))) return;
    await api('/invites/' + b.dataset.del, { method: 'DELETE' }); loadInvites(); toast('招待リンクを削除しました');
  }));
}
// 招待リンクを開いた時: コードを確認して登録画面を出す
async function viewInviteLanding(code) {
  main.innerHTML = `<div class="content">${emptyState({ icon: 'ticket', title: '招待を確認しています…' })}</div>`;
  if (me) { main.innerHTML = `<div class="content">${emptyState({ icon: 'check', title: 'すでにログインしています', action: '<a class="btn btn-primary" href="#/">ホームへ</a>' })}</div>`; return; }
  const r = await api('/invites/' + encodeURIComponent(code) + '/check', { noAuthPrompt: true }).catch(() => ({ valid: false, error: '確認できませんでした' }));
  if (!r.valid) {
    main.innerHTML = `<div class="content">${emptyState({ icon: 'ticket', title: r.error, text: '招待してくれた人に、新しいリンクを作ってもらってください。' })}</div>`;
    return;
  }
  main.innerHTML = `<div class="content"><div class="card welcome"><span class="brand-mark lg"></span>
    <h2>${r.from ? esc(r.from.displayName) + ' さん' : '友だち'}から招待されています</h2>
    <p>IppO は招待制の、学校のためのソーシャルプラットフォームです。アカウントを作って参加しましょう。</p>
    <button class="btn btn-primary btn-lg" id="invite-start" type="button">アカウントを作る</button></div></div>`;
  const open = () => {
    const note = $('#invite-note');
    note.dataset.from = '1';
    note.textContent = `${r.from ? '@' + r.from.username + ' さん' : ''}からの招待で登録します`;
    note.classList.remove('hidden');
    openAuth('register');
    $('#auth-form').invite.value = code;
  };
  $('#invite-start').addEventListener('click', open);
  open();
}

// =====================================================================
// ダイレクトメッセージ
// =====================================================================
async function viewDmList() {
  main.innerHTML = pageHead({ title: 'メッセージ' }) + `<div class="content">
    <form class="search-field" id="dm-new">${icon('search')}<input class="input" name="u" placeholder="ユーザー名を入力して新しいメッセージ" autocomplete="off" autocapitalize="off" enterkeyhint="go"></form>
    <div id="dm-list"></div></div>`;
  $('#dm-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = e.target.u.value.trim().replace(/^@/, '');
    if (u) location.hash = '#/dm/' + encodeURIComponent(u);
  });
  $('#dm-list').innerHTML = `<div class="list-card">${'<div class="dm-row"><div class="sk sk-circle"></div><div style="flex:1"><div class="sk sk-line" style="width:40%"></div><div class="sk sk-line" style="width:70%;margin-top:8px"></div></div></div>'.repeat(3)}</div>`;
  const load = async () => {
    const { conversations } = await api('/dm');
    $('#dm-list').innerHTML = conversations.length ? `<div class="list-card">${conversations.map((c) => `
      <a class="dm-row${c.unread ? ' unread' : ''}" href="#/dm/${esc(c.user.username)}">
        ${avatar(c.user)}
        <div class="dm-row-body">
          <div class="dm-row-top"><b>${esc(c.user.displayName)}${adminBadge(c.user)}</b><span class="text-sm muted">@${esc(c.user.username)}</span><time>${timeAgo(c.last.createdAt)}</time></div>
          <div class="dm-preview">${c.last.mine ? 'あなた: ' : ''}${esc(c.last.content)}</div>
        </div>
        ${c.unread ? `<b class="count-badge" style="margin-left:0">${c.unread}</b>` : ''}
      </a>`).join('')}</div>` : emptyState({ icon: 'mail', title: 'まだメッセージはありません', text: '相手のプロフィールの ' + icon('mail', 'ic-sm') + ' から、または上の欄にユーザー名を入れて始められます。' });
  };
  await load().catch((e) => { $('#dm-list').innerHTML = emptyState({ icon: 'alert', title: e.message }); });
  const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 10_000);
  viewCleanup = () => clearInterval(t);
}
function dmBubble(m) {
  const d = new Date(m.createdAt);
  return `<div class="dm-msg ${m.mine ? 'mine' : 'theirs'}" data-id="${m.id}">
    <div class="dm-bubble">${richText(m.content)}</div>
    ${(() => { const u = firstUrl(m.content); if (!u) return ''; const yt = youtubeInfo(u); return yt ? youtubeCard(yt, u) : isVideoUrl(u) ? videoEmbed(u) : ''; })()}
    <div class="dm-time">${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}</div>
  </div>`;
}
async function viewDmThread(username) {
  main.innerHTML = pageHead({ title: '@' + esc(username), back: '#/dm' }) + `
    <div class="dm-thread" id="dm-thread">${'<div class="sk" style="height:38px;width:55%;border-radius:20px"></div>'.repeat(2)}</div>
    <form class="dm-composer" id="dm-form">
      <textarea class="textarea" name="c" rows="1" placeholder="メッセージを入力" maxlength="1000" aria-label="メッセージ"></textarea>
      <button class="btn btn-primary send" type="submit" disabled aria-label="送信">${icon('send')}</button>
    </form>`;
  const thread = $('#dm-thread'), form = $('#dm-form'), ta = form.c, btn = $('button', form);
  let lastId = 0, firstId = 0, stopped = false;
  const atBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  const scrollBottom = () => window.scrollTo(0, document.body.scrollHeight);
  const append = (msgs) => {
    const fresh = msgs.filter((m) => !thread.querySelector(`.dm-msg[data-id="${m.id}"]`));
    if (!fresh.length) return;
    $('.empty', thread)?.remove();
    thread.insertAdjacentHTML('beforeend', fresh.map(dmBubble).join(''));
    lastId = Math.max(lastId, ...fresh.map((m) => m.id));
  };
  try {
    const { user, messages, hasMore } = await api('/dm/' + encodeURIComponent(username));
    $('.page-head h1', main).innerHTML = `${esc(user.displayName)}${adminBadge(user)}<span class="sub"><a href="#/u/${esc(user.username)}" style="color:inherit">@${esc(user.username)}</a></span>`;
    thread.innerHTML = messages.length ? '' : emptyState({ icon: 'mail', title: `${user.displayName}さんにメッセージを送ってみましょう` });
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
    refreshBadges(true);
  } catch (e) {
    thread.innerHTML = emptyState({ icon: 'alert', title: e.message });
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
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
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
// 画面の切り替え
// =====================================================================
function requireLogin() { if (me) return true; openAuth(); location.hash = '#/'; return false; }
function setActiveNav(key) { $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key)); }
let lastHash = null;
function route() {
  if (viewCleanup) { viewCleanup(); viewCleanup = null; }
  closeMenu();
  currentCommunity = null;
  const h = location.hash.slice(1) || '/';
  // 別の画面に移った時だけ、先頭に戻してフェードイン
  if (h !== lastHash) {
    window.scrollTo(0, 0);
    document.body.classList.remove('topbar-hidden');
    main.classList.remove('page-enter'); void main.offsetWidth; main.classList.add('page-enter');
  }
  lastHash = h;
  refreshBadges();
  let m;
  if (h === '/c' || h.startsWith('/c/')) {
    setActiveNav('c');
    if ((m = h.match(/^\/c\/([A-Za-z0-9_-]+)/))) return viewCommunity(m[1]);
    return viewCommunities();
  }
  if (h === '/q') { setActiveNav('search'); return viewQuestion(); }
  if ((m = h.match(/^\/invite\/([A-Za-z0-9-]+)/))) { setActiveNav(''); return viewInviteLanding(m[1]); }
  if (h === '/schedule') { setActiveNav('schedule'); return viewSchedule(); }
  if (h === '/bookmarks') { setActiveNav('bookmarks'); return viewBookmarks(); }
  if (h === '/admin') { setActiveNav('admin'); if (!requireLogin()) return; return viewAdmin(); }
  if (h === '/settings') { setActiveNav('settings'); if (!requireLogin()) return; return viewSettings(); }
  if (h === '/notifications') { setActiveNav('notifications'); if (!requireLogin()) return; return viewNotifications(); }
  if (h.startsWith('/dm')) {
    setActiveNav('dm');
    if (!requireLogin()) return;
    if ((m = h.match(/^\/dm\/([A-Za-z0-9_]+)/))) return viewDmThread(m[1]);
    return viewDmList();
  }
  if ((m = h.match(/^\/p\/(\d+)/))) { setActiveNav(''); return viewPost(m[1]); }
  if ((m = h.match(/^\/u\/([A-Za-z0-9_]+)/))) { setActiveNav(me && me.username.toLowerCase() === m[1].toLowerCase() ? 'me' : ''); return viewUser(m[1]); }
  if (h === '/me') { if (!requireLogin()) return; location.hash = '#/u/' + me.username; return; }
  if (h.startsWith('/search')) { setActiveNav('search'); return viewSearch(new URLSearchParams(h.split('?')[1] || '').get('q') || ''); }
  setActiveNav('home');
  viewHome();
}
window.addEventListener('hashchange', route);
// 「戻る」ボタン: 履歴があれば前の画面へ
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (b && history.length > 1 && sessionStorage.getItem('ippo_nav')) { e.preventDefault(); history.back(); }
});
window.addEventListener('hashchange', () => { try { sessionStorage.setItem('ippo_nav', '1'); } catch {} });

// スマホ: 下にスクロールするとヘッダーを隠し、上に戻すと出す
let lastY = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > lastY + 8 && y > 90) document.body.classList.add('topbar-hidden');
  else if (y < lastY - 8 || y < 40) document.body.classList.remove('topbar-hidden');
  lastY = y;
}, { passive: true });

// スマホ: キーボード表示中は下部ナビを隠して入力欄を広く使う
const isTouchSmall = () => matchMedia('(max-width: 767px)').matches;
document.addEventListener('focusin', (e) => { if (isTouchSmall() && e.target.matches('input:not([type=radio]):not([type=checkbox]), textarea') && !e.target.closest('#vb')) document.body.classList.add('kb-open'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.('input, textarea')) document.body.classList.remove('kb-open'); }, 50));

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
  const vbToast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3500); };

  function open(url) {
    if (!me) { openAuth(); return; }
    close();
    root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    overlay.textContent = '仮想環境を起動しています…'; overlay.classList.remove('hidden');
    addr.value = url;
    // 表示モード (スマホ版 / PC版) と、この端末の画面サイズから表示サイズを決める
    const phone = isPhone();
    const bar = $('.vb-bar').getBoundingClientRect().height || 48;
    const safeTop = parseFloat(getComputedStyle($('.vb-window')).paddingTop) || 0;
    const availW = Math.round(window.innerWidth), availH = Math.round(window.innerHeight - bar - safeTop);
    if (mode === 'mobile') {
      vp = phone ? { width: availW, height: availH } : { width: 390, height: Math.min(844, Math.round(window.innerHeight - 120)) };
    } else {
      // スマホで PC 版を見る時は、スマホの「PC版サイトを表示」と同じく幅 980px で縦長に表示する
      vp = phone ? { width: 980, height: Math.min(2000, Math.round(980 * availH / availW)) } : { width: 1280, height: 720 };
    }
    root.classList.toggle('vb-narrow', mode === 'mobile' && !phone);
    stage.style.width = mode === 'mobile' && !phone ? `${vp.width}px` : '';
    stage.style.aspectRatio = `${vp.width} / ${vp.height}`;
    modeBtn.innerHTML = icon(mode === 'mobile' ? 'phone' : 'monitor');
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
      else if (m.t === 'notice') vbToast(m.msg);
      else if (m.t === 'focus' && lastPointer === 'touch') {
        if (m.editable) { if (document.activeElement !== ime) kbdFloat.classList.remove('hidden'); }
        else { kbdFloat.classList.add('hidden'); if (document.activeElement === ime) ime.blur(); }
      }
      else if (m.t === 'ended') { overlay.textContent = m.msg; overlay.classList.remove('hidden'); }
    };
    ws.onclose = () => { if (!root.classList.contains('hidden') && overlay.classList.contains('hidden')) { overlay.textContent = 'セッションは終了し、データは破棄されました'; overlay.classList.remove('hidden'); } clearInterval(timer); };
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
  canvas.addEventListener('keydown', () => { ime.focus({ preventScroll: true }); });

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
      vbToast(mode === 'mobile' ? 'スマホ版で表示します' : 'PC版で表示します');
    }
    else send({ t: b.dataset.vb });
  });
  $('#vb-addr-form').addEventListener('submit', (e) => { e.preventDefault(); send({ t: 'goto', url: addr.value }); addr.blur(); canvas.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.classList.contains('hidden') && document.activeElement !== ime) close(); });

  return { open, close };
})();

// ---------- 起動 ----------
(async () => {
  siteConfig = await api('/config', { noAuthPrompt: true }).catch(() => siteConfig);
  me = (await api('/me', { noAuthPrompt: true }).catch(() => ({}))).user || null;
  renderMe();
  loadScheduleWidget();
  route();
})();
