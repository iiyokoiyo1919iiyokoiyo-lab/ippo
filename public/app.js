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
  const a = u.avatar;
  let inner, bg, kind = '';
  if (a?.kind === 'image' && u.id) { inner = `<img src="/api/avatars/${Number(u.id)}?v=${Number(a.v)}" alt="" loading="lazy" decoding="async" draggable="false">`; bg = 'var(--surface-3)'; kind = ' avatar-img'; }
  else if (a?.kind === 'emoji') { inner = `<span class="avatar-emoji">${esc(a.emoji)}</span>`; bg = esc(a.color); kind = ' avatar-em'; }
  else { inner = esc([...(u.displayName || u.username)][0] || '?'); bg = colorFor(u.username); }
  const cls = `avatar${kind} ${size ? 'avatar-' + size : ''}`;
  return link ? `<a class="${cls}" href="#/u/${esc(u.username)}" style="background:${bg}" aria-label="${esc(u.displayName)}">${inner}</a>`
    : `<span class="${cls}" style="background:${bg}" aria-hidden="true">${inner}</span>`;
}

// 管理者バッジ: 名前の横に付ける小さな印 (プロフィールでは文字付き)
const adminBadge = (u, withLabel = false) => (!u?.isAdmin ? ''
  : withLabel ? `<span class="admin-badge-label" title="IppO の管理者">${icon('badge')}管理者</span>`
  : `<span class="admin-badge" title="管理者" aria-label="管理者" role="img">${icon('badge')}</span>`) + verifiedBadge(u, withLabel);
// 称号 (高難易度クエストの最速クリアなど)。文字はエスケープして出す
const titleChips = (u, cls = '') => (u?.titles || []).map((t) => `<span class="user-title ${cls}" title="${esc(t.name)}"><i></i><i></i>🏅${esc(t.name)}</span>`).join('');
// 認証マーク (管理者が確認したアカウント。権限は増えない表示だけの印)
function verifiedBadge(u, withLabel = false) {
  const v = u?.verified;
  if (!v) return '';
  const title = `認証済み${v.label ? ' · ' + v.label : ''}（IppO 運営が確認したアカウント）`;
  return withLabel ? `<span class="verified-label" title="${esc(title)}">${icon('verified')}認証済み${v.label ? ` · ${esc(v.label)}` : ''}</span>`
    : `<span class="verified-badge" title="${esc(title)}" aria-label="${esc(title)}" role="img">${icon('verified')}</span>`;
}

// ---------- リアルタイム接続 (DM の新着・入力中・既読・オンライン) ----------
const RT = (() => {
  let ws = null, want = false, tries = 0, watching = null;
  const handlers = new Set();
  const emit = (m) => handlers.forEach((h) => { try { h(m); } catch {} });
  function connect() {
    if (!want || ws) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rt`);
    ws.onopen = () => { tries = 0; if (watching) ws.send(JSON.stringify({ t: 'watch', user: watching })); emit({ t: 'open' }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } emit(m); };
    ws.onclose = () => { ws = null; emit({ t: 'close' }); if (want) { tries++; setTimeout(connect, Math.min(15000, 800 * 2 ** Math.min(tries, 5))); } };
  }
  return {
    start() { want = true; connect(); },
    stop() { want = false; try { ws?.close(); } catch {} ws = null; },
    send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); },
    watch(user) { watching = user; if (user) this.send({ t: 'watch', user }); },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    get connected() { return !!ws && ws.readyState === 1; },
  };
})();
// 新しい DM が届いたら、その会話を見ていない時はバッジを更新してお知らせ
RT.on((m) => {
  if (m.t !== 'dm' || !m.from) return;
  refreshBadges(true);
  if (location.hash !== '#/dm/' + m.from && location.hash !== '#/dm') toast(`@${m.from} さんからメッセージ: ${m.message.content.slice(0, 30)}`);
});

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
  menuOpenedAt = Date.now();
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
  menuEl.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  $$('.menu-item', menuEl).forEach((b) => b.addEventListener('click', () => { closeMenu(); items[b.dataset.i].run(); }));
}
let menuOpenedAt = 0;
function closeMenu() { menuEl.classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!menuEl.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu(); }, true);
window.addEventListener('scroll', () => { if (Date.now() - menuOpenedAt > 250) closeMenu(); }, { passive: true });
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

// ---------- 投稿の写真 ----------
// 端末で長辺 1280px の JPEG に縮める (撮影場所などの情報もここで消える。サーバーでも再度消す)
async function shrinkPhoto(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('ファイルが大きすぎます (30MB まで)');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('この画像は読み込めませんでした。JPEG か PNG の写真を選んでください'); }
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(bmp.width * k)); c.height = Math.max(16, Math.round(bmp.height * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // 透明部分は白に
  g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
}
function photoGrid(p) {
  const n = p.images.length;
  // 1 枚の時は写真の縦横比を活かす (極端な縦長・横長はほどほどに切り取る)
  const ratio = n === 1 ? Math.min(1.9, Math.max(0.75, p.images[0].w / p.images[0].h)) : null;
  return `<div class="photo-grid n${n}" ${ratio ? `style="aspect-ratio:${ratio.toFixed(3)}"` : ''}>${p.images.map((im, i) =>
    `<button type="button" class="photo" data-photos="${p.images.map((x) => x.id).join(',')}" data-i="${i}" aria-label="写真 ${i + 1}/${n} を拡大"><img src="/api/images/${im.id}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`;
}
// 拡大表示 (左右の矢印・スワイプ・キーボードで移動)
const Lightbox = (() => {
  const dlg = $('#lightbox'), img = $('.lb-img', dlg), count = $('.lb-count', dlg);
  let ids = [], i = 0, sx = null;
  const show = () => {
    img.src = '/api/images/' + ids[i]; img.alt = `写真 ${i + 1}/${ids.length}`;
    count.textContent = ids.length > 1 ? `${i + 1} / ${ids.length}` : '';
    dlg.classList.toggle('single', ids.length < 2);
  };
  const go = (d) => { if (ids.length < 2) return; i = (i + d + ids.length) % ids.length; show(); };
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (b) { if (b.dataset.lb === 'close') closeModal(dlg); else go(b.dataset.lb === 'next' ? 1 : -1); return; }
    if (e.target === dlg) closeModal(dlg);
  });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(dlg); });
  img.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  img.addEventListener('pointerup', (e) => { if (sx !== null && Math.abs(e.clientX - sx) > 40) go(e.clientX < sx ? 1 : -1); sx = null; });
  return { open(list, start) { ids = list; i = start; show(); openModal(dlg); } };
})();
document.addEventListener('click', (e) => {
  const b = e.target.closest('.photo[data-photos]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  Lightbox.open(b.dataset.photos.split(',').map(Number), Number(b.dataset.i));
}, true);

// ---------- 投稿カード ----------
// 引用リポストに埋め込む、元投稿の小さなカード
function quoteEmbed(q) {
  if (!q || q.unavailable) return `<div class="quote-embed quote-gone">${icon('repeat', 'ic-sm')}この投稿は削除されました</div>`;
  const text = q.content ? esc(q.content.length > 180 ? q.content.slice(0, 180) + '…' : q.content) : '';
  const photo = q.images?.length ? `<span class="quote-photo">${icon('image', 'ic-sm')}写真${q.images.length}枚</span>` : '';
  return `<a class="quote-embed" href="#/p/${q.id}">
    <div class="quote-embed-head">${avatar(q.author, 'xs')}<b>${esc(q.author.displayName)}</b>${adminBadge(q.author)}<span class="handle">@${esc(q.author.username)}</span><span class="dot">·</span><time>${timeAgo(q.createdAt)}</time></div>
    ${text ? `<div class="quote-embed-text">${text}</div>` : ''}${photo}
  </a>`;
}
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
    ${p.content ? `<div class="post-text">${richText(p.content)}</div>` : ''}
    ${p.images?.length ? photoGrid(p) : ''}
    ${media ? `<div class="post-media">${media}</div>` : ''}
    ${p.quoted ? quoteEmbed(p.quoted) : ''}
    <footer class="post-actions">
      <button class="act like${p.liked ? ' on' : ''}" type="button" aria-label="いいね" aria-pressed="${p.liked}">${icon('heart')}<span>${n(p.counts.likes)}</span></button>
      <button class="act reply" type="button" aria-label="コメント">${icon('comment')}<span>${n(p.counts.replies)}</span></button>
      <button class="act repost${p.reposted ? ' on' : ''}" type="button" data-menu aria-label="リポスト" aria-pressed="${p.reposted}">${icon('repeat')}<span>${n((p.counts.reposts || 0) + (p.counts.quotes || 0))}</span></button>
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
    set('.act.repost', p.reposted, (p.counts.reposts || 0) + (p.counts.quotes || 0));
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
  const btn = e.target.closest('.act');
  if (btn && btn.classList.contains('repost')) return me ? openRepostMenu(btn, id, postEl.dataset.user) : openAuth();
  const more = e.target.closest('[data-menu]');
  if (more) return openPostMenu(more, postEl);
  if (!btn) { if (!postEl.classList.contains('focus') && !window.getSelection().toString()) location.hash = '#/p/' + id; return; }
  if (btn.classList.contains('bookmark')) {
    const on = bookmarks.toggle(id);
    $$(`.post[data-id="${id}"] .act.bookmark`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    popButton(btn);
    return toast(on ? 'ブックマークに追加しました' : 'ブックマークから外しました', on ? 'success' : '');
  }
  if (!me) return openAuth();
  if (btn.classList.contains('repost')) return openRepostMenu(btn, id, postEl.dataset.user);
  try {
    if (btn.classList.contains('like')) {
      const on = btn.classList.contains('on');
      // すぐに見た目を変え (控えめなアニメーション)、サーバーの結果で確定する
      btn.classList.toggle('on', !on);
      const c = $('span', btn); c.textContent = Math.max(0, (Number(c.textContent) || 0) + (on ? -1 : 1)) || '';
      if (!on) popButton(btn);
      const { post } = await api(`/posts/${id}/like`, { method: on ? 'DELETE' : 'POST' });
      updatePostEls(post);
    } else if (btn.classList.contains('reply')) {
      openCompose({ replyTo: id, handle: '@' + postEl.dataset.user });
    }
  } catch (err) { toast(err.message, 'error'); route(); }
});

// リポストボタンのメニュー (リポスト / 引用リポスト)
function openRepostMenu(btn, id, user) {
  const on = btn.classList.contains('on');
  openMenu(btn, [
    { icon: 'repeat', label: on ? 'リポストを取り消す' : 'リポスト', run: async () => {
      // すぐ見た目を変え、サーバーの結果で確定
      const c = $('span', btn);
      btn.classList.toggle('on', !on); c.textContent = Math.max(0, (Number(c.textContent) || 0) + (on ? -1 : 1)) || '';
      if (!on) popButton(btn);
      try { const { post } = await api(`/posts/${id}/repost`, { method: on ? 'DELETE' : 'POST' }); updatePostEls(post); toast(on ? 'リポストを取り消しました' : 'リポストしました', on ? '' : 'success'); }
      catch (err) { toast(err.message, 'error'); route(); }
    } },
    { icon: 'edit', label: '引用リポスト', run: async () => {
      try { const { post } = await api('/posts/' + id, { noAuthPrompt: true }); openCompose({ quote: post }); }
      catch (err) { toast(err.message, 'error'); }
    } },
  ]);
}

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
      <div class="composer-images"></div>
      <div class="composer-foot">
        <label class="icon-btn composer-photo" title="写真を追加 (4枚まで)" aria-label="写真を追加">${icon('image')}<input type="file" accept="image/*" multiple hidden></label>
        <span class="hint">${icon('shield', 'ic-sm')}リンクは仮想ブラウザで開かれます</span>
        <span class="ring-wrap"><svg class="ring" viewBox="0 0 26 26"><circle class="track" cx="13" cy="13" r="10"/><circle class="bar" cx="13" cy="13" r="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="ring-num"></span></span>
        <button class="btn btn-primary" type="button" disabled>${esc(submit)}</button>
      </div>
    </div>
  </div>`;
}
function bindCompose(root, { replyTo = null, onDone, extra = {}, prefill = '', presetImages = [] } = {}) {
  const ta = $('textarea', root), btn = $('.composer-foot .btn', root), bar = $('.ring .bar', root), ring = $('.ring', root), num = $('.ring-num', root), wrap = $('.ring-wrap', root);
  const C = 2 * Math.PI * 10;
  // 添付する写真 (端末で縮めてから先にアップロードしておく)
  const imgBox = $('.composer-images', root), fileInput = $('.composer-photo input', root);
  let images = presetImages.map((im) => ({ key: Math.random().toString(36).slice(2), id: im.id, url: im.url, uploading: false })); // { key, id, url, uploading }
  const renderImages = () => {
    imgBox.innerHTML = images.map((im) => `<div class="composer-img${im.uploading ? ' uploading' : ''}" data-key="${im.key}">
      <img src="${im.url}" alt="">${im.uploading ? '<span class="composer-img-spin"></span>' : ''}
      <button type="button" class="composer-img-x" aria-label="写真を外す">${icon('x')}</button></div>`).join('');
    $$('.composer-img-x', imgBox).forEach((b) => b.addEventListener('click', () => {
      const key = b.closest('[data-key]').dataset.key, im = images.find((x) => x.key === key);
      images = images.filter((x) => x.key !== key);
      if (im?.id) api('/uploads/' + im.id, { method: 'DELETE' }).catch(() => {});
      URL.revokeObjectURL(im?.url); renderImages(); update();
    }));
    $('.composer-photo', root).classList.toggle('hidden', images.length >= 4);
  };
  fileInput.addEventListener('change', async () => {
    const all = [...fileInput.files], files = all.slice(0, 4 - images.length);
    fileInput.value = '';
    if (all.length > files.length) toast('写真は1つの投稿に4枚までです');
    for (const file of files) {
      const im = { key: Math.random().toString(36).slice(2), url: '', uploading: true };
      try {
        const blob = await shrinkPhoto(file);
        im.url = URL.createObjectURL(blob);
        images.push(im); renderImages(); update();
        const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '写真をアップロードできませんでした');
        im.id = data.image.id; im.uploading = false;
      } catch (e) {
        images = images.filter((x) => x !== im);
        toast(e.message || 'この写真は使えません', 'error');
      }
      renderImages(); update();
    }
  });
  const update = () => {
    const len = [...ta.value].length, left = MAX_LEN - len;
    bar.style.strokeDashoffset = C * (1 - Math.min(1, len / MAX_LEN));
    ring.classList.toggle('warn', left <= 20 && left >= 0); ring.classList.toggle('over', left < 0); wrap.classList.toggle('over', left < 0);
    num.textContent = left <= 20 ? left : '';
    btn.disabled = (!ta.value.trim() && !images.length) || left < 0 || images.some((im) => im.uploading);
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.5) + 'px';
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !btn.disabled) btn.click(); });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.classList.add('is-loading');
    try {
      const { post } = await api('/posts', { method: 'POST', body: { ...extra, content: ta.value, replyTo, imageIds: images.map((im) => im.id) } });
      ta.value = ''; images.forEach((im) => URL.revokeObjectURL(im.url)); images = []; renderImages(); update();
      onDone && onDone(post);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    btn.classList.remove('is-loading');
  });
  update();
  if (prefill) ta.value = prefill;
  if (images.length || prefill) { renderImages(); update(); }
  return ta;
}
// 投稿作成モーダル (返信 / コミュニティ / 今日の質問 にも使う)
function openCompose({ replyTo = null, handle = '', extra = {}, title = '', placeholder = '', quote = null, prefill = '', presetImages = [] } = {}) {
  if (!me) return openAuth();
  const dlg = $('#compose-dialog'), slot = $('#compose-modal-slot');
  if (!replyTo && !quote && !extra.question && !extra.community && currentCommunity) extra = { community: currentCommunity.slug };
  if (quote) extra = { ...extra, quoteOf: quote.id };
  let context = '';
  if (replyTo) context = `<div class="compose-context"><span class="chip">${icon('comment')}${esc(handle)} への返信</span></div>`;
  else if (quote) context = `<div class="compose-context"><span class="chip">${icon('repeat')}引用リポスト</span></div>`;
  else if (extra.community) context = `<div class="compose-context"><span class="chip chip-accent">${icon('users')}${esc(currentCommunity?.name || extra.community)} に投稿</span></div>`;
  else if (extra.question) context = `<div class="compose-context"><span class="chip">${icon('sparkle')}${esc(title)}</span></div>`;
  $('#compose-title').textContent = replyTo ? 'コメントする' : quote ? '引用リポスト' : extra.question ? '今日の質問に答える' : '新しい投稿';
  slot.innerHTML = composeHtml({ placeholder: placeholder || (quote ? 'ひとこと添える' : replyTo ? 'コメントを書く' : 'いまどうしてる？'), context, submit: replyTo ? 'コメント' : quote ? '投稿' : '投稿する' });
  if (quote) $('.composer-main', slot).insertAdjacentHTML('beforeend', `<div class="compose-quote">${quoteEmbed(quote)}</div>`);
  const ta = bindCompose(slot, { replyTo, extra, prefill, presetImages, onDone: (post) => {
    closeModal(dlg);
    toast(replyTo ? 'コメントしました' : quote ? '引用リポストしました' : '投稿しました', 'success');
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
    RT.start();
  } else {
    $('#nav-admin').classList.add('hidden');
    RT.stop();
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
// FF (相互フォロー) の投稿を通知するか (この端末の設定。最初はオン)
const ffNotify = () => store.get('ippo_ff_notify', true) !== false;
let badgeAt = 0;
async function refreshBadges(force = false) {
  // 画面を切り替えるたびに呼ばれるので、5秒以内の連続呼び出しはまとめる
  if (!force && Date.now() - badgeAt < 5000) return;
  badgeAt = Date.now();
  const show = (sel, n) => $$(sel).forEach((b) => { b.classList.toggle('hidden', !n); if (b.classList.contains('count-badge')) b.textContent = n > 99 ? '99+' : n; });
  if (!me) { show('.dm-badge', 0); show('.notif-badge', 0); show('.news-badge', 0); return; }
  let news = 0;
  try { news = location.hash === '#/news' ? 0 : (await api('/announcements/summary', { noAuthPrompt: true })).unread; show('.news-badge', news); } catch {}
  try { const { unread } = await api('/dm/unread', { noAuthPrompt: true }); show('.dm-badge', unread); } catch {}
  try {
    const s = notifSeen();
    const { unread } = await api(`/notifications/unread?at=${s.at}&like=${s.like}&follow=${s.follow}&ff=${ffNotify() ? 1 : 0}`, { noAuthPrompt: true });
    const n = location.hash === '#/notifications' ? 0 : unread;
    show('.sidebar .notif-badge', n);
    show('.topbar .notif-badge', n + news); // スマホはお知らせも 🔔 から見る
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
    <div id="announce-banner"></div>
    <div id="event-banners" class="ev-list"></div>
    <div id="question-card" class="hidden"></div>
    <div class="stack" id="feed"></div></div>`;
  questionCard();
  loadAnnounceBanner();
  loadEventBanners();
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
  let user, horse;
  try { ({ user, horse } = await api('/users/' + encodeURIComponent(username) + '?before=0', { noAuthPrompt: true })); }
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
        ${(user.titles || []).length ? `<div class="user-titles">${titleChips(user)}</div>` : ''}
        ${user.bio ? `<p class="hero-bio">${richText(user.bio)}</p>` : isMe ? '<p class="hero-bio muted">自己紹介を書いてみましょう</p>' : ''}
        ${user.verified ? `<p class="verified-note">${icon('verified')}<span>IppO 運営が確認したアカウントです${user.verified.label ? `（${esc(user.verified.label)}）` : ''}</span></p>` : ''}
        ${horseNote(horse)}
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
  if (isMe) { const av = $('.hero-top .avatar', main); av.classList.add('av-editable'); av.setAttribute('role', 'button'); av.setAttribute('aria-label', 'アイコンを変更'); av.addEventListener('click', () => editProfile(user)); }
  main.querySelector('.hero').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) VB.open(l.dataset.url); });
  if (isMe && tab === 'bookmarks') return renderBookmarks($('#feed'));
  await loadFeed((before) => `/users/${encodeURIComponent(username)}${before ? '?before=' + before : ''}`,
    { icon: 'edit', title: isMe ? 'まだ投稿がありません' : 'まだ投稿がありません', text: isMe ? '最初の投稿をしてみましょう。' : '' });
}
function editProfile(user) {
  openPanel('プロフィールを編集', `<div class="av-editor" id="av-editor"></div>
    <form class="form-stack" id="profile-form">
      <label class="field"><span class="field-label">表示名</span><input class="input" name="displayName" maxlength="50" value="${esc(user.displayName)}" required>
        ${me.verified ? `<span class="field-hint">${icon('verified', 'ic-sm')} 表示名を変えると、運営が確認し直すまで認証マークが外れます</span>` : ''}</label>
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
    avatarEditor($('#av-editor', root), f);
  });
}

// ---------- アイコンの編集 (写真を切り抜く / 絵文字を選ぶ / 元に戻す) ----------
// アイコンを変えたら、画面中のアイコンを新しいものに差し替える
function avatarChanged(avatarInfo) {
  me = { ...me, avatar: avatarInfo };
  renderMe();
  // 編集中のウィンドウは開いたままにし、閉じた時に画面のアイコンを描き直す
  const dlg = $('#ui-dialog');
  if (!dlg.dataset.avatarDirty) {
    dlg.dataset.avatarDirty = '1';
    dlg.addEventListener('close', () => { delete dlg.dataset.avatarDirty; if (location.hash.startsWith('#/u/') || location.hash === '#/settings' || location.hash.startsWith('#/dm')) route(); }, { once: true });
  }
}
function avatarEditor(box, form) {
  const show = (html) => { box.innerHTML = html; form.classList.toggle('hidden', box.dataset.mode && box.dataset.mode !== 'main'); };
  // 最初の画面: 今のアイコンと 3 つの操作
  function mainView() {
    box.dataset.mode = 'main';
    show(`<div class="av-main">${avatar(me, 'lg')}
      <div class="av-actions">
        <label class="btn btn-secondary btn-sm av-file">${icon('file')}写真を選ぶ<input type="file" accept="image/*" hidden></label>
        <button class="btn btn-outline btn-sm" type="button" data-av="emoji">${icon('sparkle')}絵文字にする</button>
        ${me.avatar ? `<button class="btn btn-ghost btn-sm" type="button" data-av="reset">元に戻す</button>` : ''}
      </div>
      <p class="field-hint">写真は端末で小さく切り抜き、撮影場所などの情報を消してから送ります</p></div>`);
    $('input[type=file]', box).addEventListener('change', (e) => { const file = e.target.files[0]; if (file) cropView(file); });
    $('[data-av=emoji]', box).addEventListener('click', emojiView);
    $('[data-av=reset]', box)?.addEventListener('click', async () => {
      try { await api('/me/avatar', { method: 'DELETE' }); avatarChanged(null); toast('アイコンを元に戻しました'); mainView(); } catch (e) { toast(e.message, 'error'); }
    });
  }
  // 写真: ドラッグで位置、スライダーで大きさを決めて、真ん中の円の範囲を 256×256 にする
  async function cropView(file) {
    if (file.size > 25 * 1024 * 1024) return toast('ファイルが大きすぎます (25MB まで)', 'error');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { return toast('この画像は読み込めませんでした。JPEG か PNG の写真を選んでください', 'error'); }
    box.dataset.mode = 'crop';
    show(`<div class="av-crop">
      <div class="av-crop-frame"><canvas width="560" height="560"></canvas><div class="av-crop-mask"></div></div>
      <label class="av-zoom">${icon('search', 'ic-sm')}<input type="range" min="1" max="4" step="0.01" value="1" aria-label="拡大"></label>
      <p class="field-hint">ドラッグで位置を調整できます</p>
      <div class="modal-actions" style="margin-top:4px"><button class="btn btn-ghost" type="button" data-av="cancel">戻る</button><button class="btn btn-primary" type="button" data-av="save">このアイコンにする</button></div></div>`);
    const cv = $('canvas', box), g = cv.getContext('2d'), range = $('input[type=range]', box), N = cv.width;
    const base = Math.max(N / bmp.width, N / bmp.height); // 枠を埋める最小の倍率
    let zoom = 1, ox = 0, oy = 0;
    const clamp = () => {
      const w = bmp.width * base * zoom, h = bmp.height * base * zoom;
      ox = Math.min(0, Math.max(N - w, ox)); oy = Math.min(0, Math.max(N - h, oy));
    };
    const draw = () => { clamp(); g.fillStyle = '#fff'; g.fillRect(0, 0, N, N); g.drawImage(bmp, ox, oy, bmp.width * base * zoom, bmp.height * base * zoom); };
    ox = (N - bmp.width * base) / 2; oy = (N - bmp.height * base) / 2; draw();
    range.addEventListener('input', () => {
      // 中心を保ったまま拡大
      const nz = Number(range.value), c = N / 2;
      ox = c - (c - ox) * (nz / zoom); oy = c - (c - oy) * (nz / zoom); zoom = nz; draw();
    });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox, oy }; });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = N / cv.getBoundingClientRect().width;
      ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); range.value = Math.min(4, Math.max(1, zoom * Math.exp(-e.deltaY * 0.002))); range.dispatchEvent(new Event('input')); }, { passive: false });
    $('[data-av=cancel]', box).addEventListener('click', mainView);
    $('[data-av=save]', box).addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.classList.add('is-loading');
      try {
        const out = document.createElement('canvas'); out.width = out.height = 256;
        out.getContext('2d').drawImage(cv, 0, 0, N, N, 0, 0, 256, 256);
        const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.86));
        const res = await fetch('/api/me/avatar/image', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'アイコンを保存できませんでした');
        avatarChanged(data.avatar); toast('アイコンを変更しました', 'success'); mainView();
      } catch (err) { toast(err.message, 'error'); }
      btn.classList.remove('is-loading');
    });
  }
  // 絵文字 + 背景色
  async function emojiView() {
    let opts;
    try { opts = await api('/avatar-options'); } catch { return toast('読み込めませんでした', 'error'); }
    let emoji = me.avatar?.kind === 'emoji' ? me.avatar.emoji : opts.emojis[0];
    let color = me.avatar?.kind === 'emoji' ? me.avatar.color : opts.colors[0];
    box.dataset.mode = 'emoji';
    const render = () => show(`<div class="av-emoji">
      <div class="av-emoji-preview">${avatar({ ...me, avatar: { kind: 'emoji', emoji, color } }, 'lg')}</div>
      <div class="av-colors">${opts.colors.map((c) => `<button type="button" class="av-color${c === color ? ' on' : ''}" style="background:${c}" data-color="${c}" aria-label="背景色 ${c}" aria-pressed="${c === color}"></button>`).join('')}</div>
      <div class="av-emojis">${opts.emojis.map((x) => `<button type="button" class="av-emoji-btn${x === emoji ? ' on' : ''}" data-emoji="${x}" aria-pressed="${x === emoji}">${x}</button>`).join('')}</div>
      <div class="modal-actions" style="margin-top:4px"><button class="btn btn-ghost" type="button" data-av="cancel">戻る</button><button class="btn btn-primary" type="button" data-av="save">このアイコンにする</button></div></div>`);
    const bind = () => {
      $$('[data-color]', box).forEach((b) => b.addEventListener('click', () => { color = b.dataset.color; render(); bind(); }));
      $$('[data-emoji]', box).forEach((b) => b.addEventListener('click', () => { emoji = b.dataset.emoji; render(); bind(); }));
      $('[data-av=cancel]', box).addEventListener('click', mainView);
      $('[data-av=save]', box).addEventListener('click', async () => {
        try { const r = await api('/me/avatar/emoji', { method: 'PUT', body: { emoji, color } }); avatarChanged(r.avatar); toast('アイコンを変更しました', 'success'); mainView(); }
        catch (e) { toast(e.message, 'error'); }
      });
    };
    render(); bind();
  }
  mainView();
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
    res.innerHTML = `<a class="card pw-banner" href="#/pixel">
        <span class="pw-banner-art" aria-hidden="true">${Array.from({ length: 36 }, (_, i) => `<i style="background:${['#4b55f0', '#1f2766', '#4CC9F0', '#FFD43B', '#F06EAA', '#94D82D', '#ffffff', '#7B4AE2', '#F4802A'][(i * 7 + (i >> 2)) % 9]}"></i>`).join('')}</span>
        <span class="pw-banner-text"><b>PIXEL WORLD</b><span>全校で1枚のキャンバスに、みんなで自由に描こう</span></span>${icon('chevron', 'chev')}</a>
      <a class="card pw-banner horse-banner" href="#/games">
        <span class="horse-banner-art md-banner-art" aria-hidden="true">🎮</span>
        <span class="pw-banner-text"><b>ミニゲーム</b><span>ぶんぼうぐバトラーズ · レート戦ポーカー · 暗算ダッシュ · 117万分の1 競走馬版</span></span>${icon('chevron', 'chev')}</a>
      <div class="shortcuts">
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
  try { data = await api('/notifications?ff=' + (ffNotify() ? 1 : 0)); } catch (e) { $('#notifs').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const seen = notifSeen();
  store.set('ippo_notif_seen', { at: Math.max(seen.at, data.cursor.at), like: Math.max(seen.like, data.cursor.like), follow: Math.max(seen.follow, data.cursor.follow) });
  refreshBadges(true);
  const label = { reply: 'があなたの投稿にコメントしました', mention: 'があなたをメンションしました', repost: 'があなたの投稿をリポストしました', ff: 'が投稿しました' };
  const ic = { reply: 'comment', mention: 'at', repost: 'repeat', ff: 'users' };
  const quote = (p) => p.content ? esc(p.content.length > 90 ? p.content.slice(0, 90) + '…' : p.content) : `📷 写真${p.images?.length || ''}枚`;
  const activity = data.activity.map((a) => `<a class="notif${a.at > seen.at ? ' unread' : ''}" href="#/p/${a.type === 'repost' ? a.post.id : a.post.id}">
      <span class="notif-icon ${a.type}">${icon(ic[a.type])}</span>
      <div class="notif-body"><div class="notif-text">${a.type === 'ff' ? '<span class="ff-chip">FF</span>' : ''}<b>${esc(a.user.displayName)}${adminBadge(a.user)}</b>さん${label[a.type]}</div><div class="notif-quote">${quote(a.post)}</div></div>
      <time>${timeAgo(a.at)}</time></a>`).join('');
  const likes = data.likes.map((g) => `<a class="notif${g.rid > seen.like ? ' unread' : ''}" href="#/p/${g.post.id}">
      <span class="notif-icon like">${icon('heart')}</span>
      <div class="notif-body"><div class="notif-avatars">${g.users.map((u) => avatar(u, 'xs')).join('')}</div>
        <div class="notif-text"><b>${esc(g.users[0]?.displayName || '')}${adminBadge(g.users[0])}</b>さん${g.total > 1 ? `ほか${g.total - 1}人` : ''}があなたの投稿にいいねしました</div><div class="notif-quote">${quote(g.post)}</div></div></a>`).join('');
  const follows = data.follows.map((f) => `<a class="notif${f.rid > seen.follow ? ' unread' : ''}" href="#/u/${esc(f.user.username)}">
      <span class="notif-icon follow">${icon('user-plus')}</span>
      <div class="notif-body"><div class="notif-text"><b>${esc(f.user.displayName)}${adminBadge(f.user)}</b>さんにフォローされました</div><div class="notif-quote">@${esc(f.user.username)}</div></div></a>`).join('');
  const news = await api('/announcements', { noAuthPrompt: true }).catch(() => ({ announcements: [], lastSeenId: 0 }));
  const newsHtml = news.announcements.slice(0, 3).map((a) => `<a class="notif${a.id > news.lastSeenId ? ' unread' : ''}" href="#/news/${a.id}">
      <span class="notif-icon ${a.level === 'important' ? 'important' : 'news'}">${icon('megaphone')}</span>
      <div class="notif-body"><div class="notif-text"><b>${esc(a.title)}</b></div><div class="notif-quote">IppO 運営${a.level === 'important' ? ' · 重要' : ''}</div></div>
      <time>${timeAgo(a.createdAt)}</time></a>`).join('');
  const newsSection = newsHtml ? `<div class="section-row"><h2 class="section-title">運営からのお知らせ</h2><a class="link-sm" href="#/news">すべて見る</a></div><div class="list-card">${newsHtml}</div>` : '';
  $('#notifs').innerHTML = newsSection + ((!activity && !likes && !follows)
    ? emptyState({ icon: 'bell', title: 'まだ通知はありません', text: 'コメントやいいね、フォロー、FF (相互フォロー) の投稿があるとここでお知らせします。' })
    : (activity ? `<h2 class="section-title">アクティビティ</h2><div class="list-card">${activity}</div>` : '') +
      (likes ? `<h2 class="section-title">いいね</h2><div class="list-card">${likes}</div>` : '') +
      (follows ? `<h2 class="section-title">新しいフォロワー</h2><div class="list-card">${follows}</div>` : ''));
}

// =====================================================================
// 運営からのお知らせ
// =====================================================================
const fmtDate = (t) => new Date(t).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
const announceChips = (a) => `${a.level === 'important' ? '<span class="chip chip-danger">重要</span>' : '<span class="chip chip-accent">お知らせ</span>'}${a.pinned ? `<span class="chip">${icon('pin')}固定</span>` : ''}`;
async function markAnnouncementsSeen(upTo) {
  if (!me) return;
  try { await api('/announcements/seen', { method: 'POST', body: { upTo } }); } catch {}
  refreshBadges(true);
}
// ホームのバナー (固定されたお知らせ、または未読の重要なお知らせ)。× で閉じるとこの端末では出さない
// 新キャラ・期間限定クエストの告知バナー (サーバーの時刻で、予告 → 開催中 → 終わったら消える)
async function loadEventBanners() {
  const el = $('#event-banners'); if (!el) return;
  let r; try { r = await api('/events/banners', { noAuthPrompt: true }); } catch { return; }
  if (!$('#event-banners')) return;
  const closed = store.get('ippo_ev_closed', []);
  const list = r.banners.filter((b) => !closed.includes(`${b.id}:${b.live ? 1 : 0}`));
  // 高難易度クエストのまとめ (1 つのバナーの中でスライド)
  const slide = (x) => x.image ? `<a class="ev-pic ev-slide" href="${esc(x.href)}"><img src="${esc(x.image)}" alt="${esc(x.title)} ${esc(x.text)}" width="1200" height="675" loading="lazy"><span class="ev-shine" aria-hidden="true"></span>${x.live ? '' : '<span class="ev-soon">⏳ もうすぐ</span>'}</a>`
    : `<a class="ev-slide ev-body ev-slide-text" href="${esc(x.href)}"><span class="ev-art" aria-hidden="true">${window.CBArt ? CBArt.svg(x.art.id, x.art.rarity) : ''}</span><span class="ev-text"><b>${esc(x.title)}</b><span>${esc(x.text)}</span><small>${esc(x.sub)}</small></span></a>`;
  const multi = (b) => `<div class="ev-bn ev-img ev-multi quest${b.live ? ' live' : ''}" data-ev="${esc(b.id)}:${b.live ? 1 : 0}">
      <div class="ev-track">${b.items.map(slide).join('')}</div>
      <span class="ev-mtag">${esc(b.tag)}</span>
      <span class="ev-dots">${b.items.map((x, i) => `<button type="button" class="${i ? '' : 'on'}" aria-label="${esc(x.title)}"></button>`).join('')}</span>
      <button class="icon-btn ev-close" type="button" aria-label="このお知らせを閉じる">${icon('x')}</button></div>`;
  el.innerHTML = list.map((b) => b.multi ? multi(b) : b.image ? `<div class="ev-bn ev-img ${esc(b.kind)}${b.live ? ' live' : ''}" data-ev="${esc(b.id)}:${b.live ? 1 : 0}">
      <a class="ev-pic" href="${esc(b.href)}"><img src="${esc(b.image)}" alt="${esc(b.title)} ${esc(b.text)}" width="1200" height="675" loading="lazy"><span class="ev-shine" aria-hidden="true"></span></a>
      <button class="icon-btn ev-close" type="button" aria-label="このお知らせを閉じる">${icon('x')}</button></div>`
    : `<div class="ev-bn ${esc(b.kind)}${b.live ? ' live' : ''}" data-ev="${esc(b.id)}:${b.live ? 1 : 0}">
      <span class="ev-sky" aria-hidden="true"><i></i><i></i><i></i></span>
      <a class="ev-body" href="${esc(b.href)}">
        <span class="ev-art" aria-hidden="true">${window.CBArt ? CBArt.svg(b.art.id, b.art.rarity) : ''}</span>
        <span class="ev-text"><span class="ev-tag">${esc(b.tag)}</span><b>${esc(b.title)}</b><span>${esc(b.text)}</span><small>${esc(b.sub)}</small></span>
      </a>
      <button class="icon-btn ev-close" type="button" aria-label="このお知らせを閉じる">${icon('x')}</button></div>`).join('')
    + (list.length && r.official ? `<a class="ev-official" href="#/u/${esc(r.official)}">📢 アップデート情報は公式アカウント <b>@${esc(r.official)}</b> でお知らせしています</a>` : '');
  // スライド: 点を押す・指でめくる・5 秒ごとに自動で次へ (さわったら自動はとめる)
  $$('.ev-multi', el).forEach((m) => {
    const tr = $('.ev-track', m), dots = $$('.ev-dots button', m); let auto = true;
    const cur = () => Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth));
    const go = (i) => tr.scrollTo({ left: i * tr.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    tr.addEventListener('scroll', () => { const i = cur(); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
    dots.forEach((d, i) => d.addEventListener('click', () => { auto = false; go(i); }));
    ['pointerdown', 'touchstart', 'wheel'].forEach((e) => tr.addEventListener(e, () => { auto = false; }, { passive: true }));
    const t = setInterval(() => { if (!m.isConnected) return clearInterval(t); if (auto && !document.hidden) go((cur() + 1) % dots.length); }, 5000);
  });
  $$('.ev-close', el).forEach((b) => b.addEventListener('click', () => {
    const card = b.closest('.ev-bn');
    store.set('ippo_ev_closed', [card.dataset.ev, ...store.get('ippo_ev_closed', [])].slice(0, 40));
    card.remove(); if (!$('.ev-bn', el)) $('.ev-official', el)?.remove();
  }));
}
async function loadAnnounceBanner() {
  const el = $('#announce-banner');
  if (!el) return;
  let s;
  try { s = await api('/announcements/summary', { noAuthPrompt: true }); } catch { return; }
  const a = s.banner;
  const key = a ? `${a.id}:${a.updatedAt}` : '';
  if (!a || store.get('ippo_banner_closed', []).includes(key)) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="announce-banner ${a.level}">
    <span class="announce-banner-icon">${icon('megaphone')}</span>
    <a class="announce-banner-body" href="#/news/${a.id}">
      <span class="announce-banner-label">運営からのお知らせ${a.level === 'important' ? ' · 重要' : ''}</span>
      <b>${esc(a.title)}</b>
      <span class="announce-banner-text">${esc(a.body.replace(/\s+/g, ' ').slice(0, 80))}${a.body.length > 80 ? '…' : ''}</span>
    </a>
    <button class="icon-btn" type="button" aria-label="閉じる" id="announce-close">${icon('x')}</button></div>`;
  $('#announce-close').addEventListener('click', () => {
    store.set('ippo_banner_closed', [key, ...store.get('ippo_banner_closed', [])].slice(0, 30));
    el.firstElementChild.classList.add('closing');
    setTimeout(() => { el.innerHTML = ''; }, 200);
    if (a.id > s.lastSeenId) markAnnouncementsSeen(a.id);
  });
}
function announceCard(a, lastSeenId, full = false) {
  const unread = me && a.id > lastSeenId;
  const body = full ? richText(a.body) : esc(a.body.length > 140 ? a.body.slice(0, 140) + '…' : a.body);
  return `<article class="card announce ${a.level}${unread ? ' unread' : ''}" data-id="${a.id}">
    <div class="announce-head">
      <span class="announce-from"><span class="brand-mark sm"></span><b>IppO 運営</b></span>
      <span class="announce-chips">${announceChips(a)}${unread ? '<span class="chip chip-new">NEW</span>' : ''}</span>
    </div>
    ${full ? `<h2 class="announce-title">${esc(a.title)}</h2>` : `<a class="announce-title" href="#/news/${a.id}">${esc(a.title)}</a>`}
    <div class="announce-body${full ? '' : ' clamp'}">${body}</div>
    <div class="announce-foot"><time>${fmtDate(a.createdAt)}${a.edited ? '（編集済み）' : ''}</time>
      ${full ? '' : `<a class="link-sm" href="#/news/${a.id}">続きを読む</a>`}
      <span class="spacer"></span>
      <span class="announce-admin"></span></div>
  </article>`;
}
function bindAnnounceAdmin(root, list, canManage, reload) {
  if (!canManage) return;
  $$('.announce[data-id]', root).forEach((card) => {
    const a = list.find((x) => x.id === Number(card.dataset.id));
    const slot = $('.announce-admin', card);
    slot.innerHTML = `<button class="icon-btn" type="button" data-menu aria-label="編集・削除">${icon('more')}</button>`;
    $('button', slot).addEventListener('click', (e) => openMenu(e.currentTarget, [
      { icon: 'edit', label: '編集する', run: () => editAnnouncement(a, reload) },
      { icon: 'trash', label: '削除する', danger: true, run: async () => {
        if (!(await confirmDialog({ title: 'お知らせを削除しますか？', body: `「${a.title}」を削除します。元に戻せません。`, ok: '削除する', danger: true }))) return;
        try { await api('/admin/announcements/' + a.id, { method: 'DELETE' }); toast('お知らせを削除しました'); reload(); } catch (err) { toast(err.message, 'error'); }
      } },
    ]));
  });
}
// お知らせを書く / 編集する (管理者)
function editAnnouncement(a, done) {
  openPanel(a ? 'お知らせを編集' : 'お知らせを書く', `<form class="form-stack" id="announce-form">
      <label class="field"><span class="field-label">タイトル</span><input class="input" name="title" maxlength="60" required value="${esc(a?.title || '')}" placeholder="例: 期末考査期間中のお願い"></label>
      <label class="field"><span class="field-label">本文</span><textarea class="textarea" name="body" rows="7" maxlength="2000" required placeholder="生徒のみなさんに伝えたいことを書いてください">${esc(a?.body || '')}</textarea><span class="field-hint" id="announce-count"></span></label>
      <div class="field"><span class="field-label">重要度</span>
        <div class="segmented">${[['info', '通常のお知らせ'], ['important', '重要']].map(([v, l]) => `<button type="button" class="seg${(a?.level || 'info') === v ? ' active' : ''}" data-level="${v}">${l}</button>`).join('')}</div></div>
      <label class="choice"><input type="checkbox" name="pinned" ${a?.pinned ? 'checked' : ''}><span><b>ホームの上部に固定する</b><small>全員のホームにバナーとして表示し続けます（閉じた人には出ません）</small></span></label>
      <p class="field-hint">${a ? '編集しても、もう一度通知は送られません。' : '公開すると、IppO を開いている人にすぐ通知されます。'}</p>
      <p class="form-error" id="announce-error"></p>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="submit">${a ? '保存する' : '公開する'}</button></div>
    </form>`, (root, close) => {
    const f = $('#announce-form', root);
    let level = a?.level || 'info';
    $$('[data-level]', root).forEach((b) => b.addEventListener('click', () => { level = b.dataset.level; $$('[data-level]', root).forEach((x) => x.classList.toggle('active', x === b)); }));
    const cnt = $('#announce-count', root), upd = () => { cnt.textContent = `${[...f.body.value].length} / 2000`; };
    f.body.addEventListener('input', upd); upd();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { title: f.title.value, body: f.body.value, level, pinned: f.pinned.checked };
      try {
        await api(a ? '/admin/announcements/' + a.id : '/admin/announcements', { method: a ? 'PATCH' : 'POST', body });
        close(); toast(a ? 'お知らせを更新しました' : 'お知らせを公開しました', 'success'); done && done();
      } catch (err) { $('#announce-error', root).textContent = err.message; }
    });
  });
}
async function viewNews() {
  main.innerHTML = pageHead({ title: 'お知らせ', sub: 'IppO 運営から', actions: '<span id="news-actions"></span>' }) + `<div class="content stack" id="news">${skeletonPosts(1)}</div>`;
  let r;
  try { r = await api('/announcements', { noAuthPrompt: true }); } catch (e) { $('#news').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  if (r.canManage) {
    $('#news-actions').innerHTML = `<button class="btn btn-primary btn-sm" type="button" id="news-new">${icon('plus')}書く</button>`;
    $('#news-new').addEventListener('click', () => editAnnouncement(null, viewNews));
  }
  $('#news').innerHTML = r.announcements.length ? r.announcements.map((a) => announceCard(a, r.lastSeenId)).join('')
    : emptyState({ icon: 'megaphone', title: 'お知らせはまだありません', text: r.canManage ? '右上の「書く」から、全員へのお知らせを公開できます。' : '運営からのお知らせがあると、ここに表示されます。' });
  bindAnnounceAdmin($('#news'), r.announcements, r.canManage, viewNews);
  const max = Math.max(0, ...r.announcements.map((a) => a.id));
  if (max > r.lastSeenId) markAnnouncementsSeen(max);
}
async function viewNewsItem(id) {
  main.innerHTML = pageHead({ title: 'お知らせ', back: '#/news' }) + `<div class="content" id="news-item">${skeletonPosts(1)}</div>`;
  let r;
  try { r = await api('/announcements/' + id, { noAuthPrompt: true }); } catch (e) { $('#news-item').innerHTML = emptyState({ icon: 'megaphone', title: e.message }); return; }
  $('#news-item').innerHTML = announceCard(r.announcement, Infinity, true);
  bindAnnounceAdmin($('#news-item'), [r.announcement], r.canManage, () => viewNewsItem(id));
  markAnnouncementsSeen(r.announcement.id);
}
// FF (相互フォロー) が投稿したら、すぐに知らせる
RT.on((m) => {
  if (m.t !== 'ff-post' || !ffNotify()) return;
  const mentioned = me && new RegExp('(^|[^\\w])@' + me.username + '(?![A-Za-z0-9_])', 'i').test(m.preview);
  toast(mentioned ? `${m.name}さんがあなたをメンションしました: ${m.preview}` : `${m.name}さんが投稿しました: ${m.preview}`);
  refreshBadges(true);
  if (location.hash === '#/notifications') viewNotifications();
});
document.addEventListener('change', (e) => {
  if (e.target.id !== 'ff-notify') return;
  store.set('ippo_ff_notify', e.target.checked);
  toast(e.target.checked ? 'FF の投稿を通知します' : 'FF の投稿を通知しません', 'success');
  refreshBadges(true);
});
// 新しいお知らせはすぐに知らせる
RT.on((m) => {
  if (m.t === 'announce') {
    toast(`${m.level === 'important' ? '【重要】' : ''}運営からのお知らせ: ${m.title}`);
    refreshBadges(true);
    if (location.hash === '#/' || location.hash === '' || location.hash === '#') loadAnnounceBanner();
    if (location.hash === '#/news') viewNews();
  } else if (m.t === 'announce-update') {
    if (location.hash === '#/' || location.hash === '') loadAnnounceBanner();
    if (location.hash === '#/news') viewNews();
  }
});

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
    <section class="settings-group"><h2>プライバシー</h2>
      <div class="list-card" id="privacy">
        <label class="list-item switch-row"><div class="grow"><div class="title">オンライン状態と「入力中」を表示</div><div class="desc">オフにすると相手に見えなくなり、あなたも相手のものを見られなくなります</div></div>
          <input type="checkbox" class="switch" data-priv="showPresence" disabled></label>
        <label class="list-item switch-row"><div class="grow"><div class="title">「既読」を表示</div><div class="desc">オフにすると相手に既読が付かなくなり、あなたも相手の既読を見られなくなります</div></div>
          <input type="checkbox" class="switch" data-priv="showRead" disabled></label>
      </div>
    </section>
    <section class="settings-group"><h2>通知</h2>
      <div class="list-card">
        <label class="list-item switch-row"><div class="grow"><div class="title">FF (相互フォロー) の投稿を通知</div><div class="desc">おたがいにフォローしている人が投稿したら、通知とポップアップでお知らせします (この端末の設定)</div></div>
          <input type="checkbox" class="switch" id="ff-notify" ${ffNotify() ? 'checked' : ''}></label>
      </div>
    </section>
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
  api('/me/privacy').then((pv) => {
    $$('[data-priv]', main).forEach((el) => {
      el.checked = !!pv[el.dataset.priv]; el.disabled = false;
      el.addEventListener('change', async () => {
        try { await api('/me/privacy', { method: 'PATCH', body: { [el.dataset.priv]: el.checked } }); toast('プライバシー設定を保存しました', 'success'); }
        catch (e) { el.checked = !el.checked; toast(e.message, 'error'); }
      });
    });
  }).catch(() => {});
  $('#settings-edit').addEventListener('click', () => editProfile(me));
  $('#settings-logout').addEventListener('click', logout);
  $$('[data-theme-opt]', main).forEach((b) => b.addEventListener('click', () => {
    store.set('ippo_theme', b.dataset.themeOpt); applyTheme(b.dataset.themeOpt);
    $$('[data-theme-opt]', main).forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#invite-create').addEventListener('click', async () => {
    $('#invite-error').textContent = '';
    try { const { invite } = await api('/invites', { method: 'POST' }); await loadInvites(); showInviteQr(invite.code, invite.expiresAt); }
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
    <section class="settings-group"><h2>永久バン</h2>
      <div class="card card-pad ban-box">
        <p class="text-sm" style="color:var(--text-2)">ユーザー名に、ここに入れた文字を<b>含む</b>アカウントを、<b>アカウントごと完全に削除</b>します (投稿・DM なども消え、元に戻せません)。以後、その文字を含むユーザー名では新しく登録できなくなります。管理者のアカウントは対象外です。</p>
        <form class="ban-form" id="ban-form"><input class="input" name="word" placeholder="例: konnichiha" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn btn-outline" type="submit">対象を確認</button></form>
        <div id="ban-preview"></div>
      </div>
      <div id="ban-list"></div>
    </section>
    <p class="text-xs muted">管理者は Railway の環境変数 ADMIN_USERS で指定します。管理者の操作はサーバーの記録 (ログ) に残ります。DM の内容は管理者にも見えません。</p>
  </div>`;
  $('#admin-search').addEventListener('submit', (e) => { e.preventDefault(); loadAdminUsers(e.target.q.value.trim()); });
  bindBans();
  try {
    const s = await api('/admin/stats');
    const card = (label, value, sub = '') => `<div class="card stat-card"><span class="stat-label">${label}</span><b>${value.toLocaleString()}</b>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
    $('#admin-stats').innerHTML = card('ユーザー', s.users, `今週 +${s.usersWeek}`) + card('投稿', s.posts, `24時間 +${s.postsDay}`) +
      card('コミュニティ', s.communities) + card('最近ログインした人', s.activeUsers, '直近7日') + card('DM', s.dms, '件数のみ') + card('未使用の招待', s.openInvites);
  } catch (e) { $('#admin-stats').innerHTML = emptyState({ icon: 'alert', title: e.message }); }
  loadAdminUsers(q);
}
// 永久バン: 禁止ワードを含むユーザー名のアカウントを削除し、以後の登録も止める
function bindBans() {
  const form = $('#ban-form'), box = $('#ban-preview');
  const loadList = async () => {
    try {
      const { bans } = await api('/admin/bans');
      $('#ban-list').innerHTML = bans.length ? `<div class="list-card">${bans.map((b) => `<div class="list-item" data-word="${esc(b.word)}">
          <div style="flex:1;min-width:0"><div class="title">「${esc(b.word)}」を含むユーザー名は登録できません</div>
          <div class="text-xs muted">@${esc(b.createdBy)} · ${new Date(b.createdAt).toLocaleString('ja-JP')} · 削除したアカウント ${Number(b.deletedAccounts)}件</div></div>
          <button class="btn btn-ghost btn-sm" type="button" data-unban>登録の制限を外す</button></div>`).join('')}</div>` : '';
      $$('[data-unban]', $('#ban-list')).forEach((b) => b.addEventListener('click', async () => {
        const w = b.closest('[data-word]').dataset.word;
        if (!(await confirmDialog({ title: `「${w}」の登録制限を外しますか？`, body: 'この文字を含むユーザー名で、また登録できるようになります。削除したアカウントは戻りません。', ok: '外す' }))) return;
        try { await api('/admin/bans/' + encodeURIComponent(w), { method: 'DELETE' }); toast('登録の制限を外しました'); loadList(); } catch (e) { toast(e.message, 'error'); }
      }));
    } catch {}
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    box.innerHTML = '<div class="sk sk-line" style="margin:12px 0"></div>';
    let r;
    try { r = await api('/admin/bans/preview?word=' + encodeURIComponent(form.word.value.trim())); }
    catch (err) { box.innerHTML = `<p class="text-sm" style="color:var(--danger)">${esc(err.message)}</p>`; return; }
    const n = r.targets.length;
    box.innerHTML = `<div class="ban-result">
        <p class="text-sm"><b>「${esc(r.word)}」を含むアカウント: ${n}件</b>${r.skippedAdmins.length ? `<span class="muted">（管理者 @${r.skippedAdmins.map(esc).join(', @')} は対象外）</span>` : ''}</p>
        ${n ? `<div class="list-card ban-targets">${r.targets.map((u) => `<div class="list-item">${avatar(u, 'sm')}<div style="min-width:0"><div class="title">${esc(u.displayName)}</div><div class="text-xs muted">@${esc(u.username)}</div></div></div>`).join('')}</div>` : '<p class="text-sm muted">いま当てはまるアカウントはありません。実行すると、今後の登録だけを止めます。</p>'}
        <button class="btn btn-danger" type="button" id="ban-run">${n ? `${n}件のアカウントを削除して永久バン` : 'この文字を含むユーザー名の登録を止める'}</button>
      </div>`;
    $('#ban-run').addEventListener('click', async () => {
      if (!(await confirmDialog({ title: n ? `${n}件のアカウントを削除しますか？` : `「${r.word}」の登録を止めますか？`,
        body: n ? `@${r.targets.map((u) => u.username).join(', @')} のアカウントと、投稿・DM などのデータをすべて消します。元に戻せません。` : `「${r.word}」を含むユーザー名では、新しく登録できなくなります。`,
        ok: n ? '削除して永久バン' : '登録を止める', danger: true }))) return;
      try {
        const res = await api('/admin/bans', { method: 'POST', body: { word: r.word, expect: n } });
        toast(res.deleted.length ? `${res.deleted.length}件のアカウントを削除し、永久バンしました` : `「${res.word}」を含むユーザー名の登録を止めました`, 'success');
        if (res.failed.length) toast(`削除できなかったアカウント: @${res.failed.join(', @')}`, 'error');
        box.innerHTML = ''; form.reset(); loadList(); loadAdminUsers($('#admin-search')?.q.value.trim() || '');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  loadList();
}
// 認証マークを付ける (メモは任意: 生徒会・先生 など)
function grantVerification(name, label = '') {
  openPanel('認証マークを付ける', `<form class="form-stack" id="verify-form">
      <p class="text-sm" style="color:var(--text-2)">@${esc(name)} の名前の横に ${icon('verified', 'ic-sm verified-inline')} を表示します。<b>権限は増えません</b>。本人であることを確認したアカウントにだけ付けてください。</p>
      <label class="field"><span class="field-label">メモ <span class="muted">（任意・20文字まで）</span></span>
        <input class="input" name="label" maxlength="20" value="${esc(label)}" placeholder="例: 生徒会 / 先生 / 写真部 部長"><span class="field-hint">プロフィールに「認証済み · メモ」と表示されます</span></label>
      <p class="field-hint">本人が表示名を変えると、確認し直すまで印は外れます。</p>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>キャンセル</button><button class="btn btn-primary" type="submit">付ける</button></div>
    </form>`, (root, close) => {
    $('#verify-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/admin/users/${name}/verify`, { method: 'PUT', body: { label: e.target.label.value } });
        close(); toast(`@${name} に認証マークを付けました`, 'success'); loadAdminUsers($('#admin-search')?.q.value.trim() || '');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
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
        <div class="title">${esc(u.displayName)} <span class="muted text-sm" style="font-weight:500">@${esc(u.username)}</span>${adminBadge(u, true)}${u.verification?.status === 'pending' ? `<span class="chip chip-warn" title="認証した時の表示名: ${esc(u.verification.verifiedName)}">認証保留中（表示名を変更）</span>` : ''}</div>
        <div class="desc">${new Date(u.createdAt).toLocaleDateString('ja-JP')} 登録${u.invitedBy ? ` · <a href="#/u/${esc(u.invitedBy)}">@${esc(u.invitedBy)}</a> の招待` : ''} · 投稿 ${u.posts} · フォロワー ${u.followers}${u.invited ? ` · 招待した人 ${u.invited}` : ''}</div>
      </div>
      <button class="icon-btn" type="button" data-admin-menu data-vstatus="${u.verification?.status || 'none'}" data-vlabel="${esc(u.verification?.label || '')}" data-admin-target="${u.isAdmin ? 1 : 0}" aria-label="操作">${icon('more')}</button>
    </div>`).join('')}</div>`;
  $$('[data-admin-menu]', el).forEach((b) => b.addEventListener('click', () => {
    const name = b.closest('[data-u]').dataset.u, vs = b.dataset.vstatus, vlabel = b.dataset.vlabel;
    const verifyItems = [
      { icon: 'verified', label: vs === 'none' ? '認証マークを付ける' : vs === 'pending' ? '確認し直して認証マークを戻す' : '認証マークのメモを変える', run: () => grantVerification(name, vlabel) },
      ...(vs !== 'none' ? [{ icon: 'x', label: '認証マークを外す', danger: true, run: async () => {
        if (!(await confirmDialog({ title: `@${name} の認証マークを外しますか？`, body: '権限は変わりません。名前の横の印が消えます。', ok: '外す', danger: true }))) return;
        try { await api(`/admin/users/${name}/verify`, { method: 'DELETE' }); toast(`@${name} の認証マークを外しました`); loadAdminUsers($('#admin-search').q.value.trim()); } catch (e) { toast(e.message, 'error'); }
      } }] : []),
    ];
    // 管理者に対しては認証マークの操作だけ
    if (b.dataset.adminTarget === '1') return openMenu(b, verifyItems);
    openMenu(b, [
      ...verifyItems,
      { icon: 'user', label: 'プロフィールを見る', run: () => { location.hash = '#/u/' + name; } },
      { icon: 'logout', label: '強制ログアウト', run: async () => {
        if (!(await confirmDialog({ title: `@${name} を強制ログアウトしますか？`, body: 'すべての端末でログアウトされます。パスワードを知っていれば、またログインできます。', ok: 'ログアウトさせる' }))) return;
        try { await api(`/admin/users/${name}/logout`, { method: 'POST' }); toast(`@${name} をログアウトさせました`, 'success'); } catch (e) { toast(e.message, 'error'); }
      } },
      { icon: 'user', label: 'アイコンを削除', run: async () => {
        if (!(await confirmDialog({ title: `@${name} のアイコンを削除しますか？`, body: '頭文字のアイコンに戻ります。', ok: '削除する', danger: true }))) return;
        try { const r = await api(`/admin/users/${name}/avatar`, { method: 'DELETE' }); toast(r.ok ? `@${name} のアイコンを削除しました` : 'アイコンは設定されていません'); loadAdminUsers($('#admin-search').q.value.trim()); } catch (e) { toast(e.message, 'error'); }
      } },
      { icon: 'trash', label: 'アカウントを削除', danger: true, run: async () => {
        if (!(await confirmDialog({ title: `@${name} のアカウントを削除しますか？`, body: '投稿・DM・フォロー・作成したコミュニティなど、このユーザーのデータがすべて完全に削除されます。\n元に戻すことはできません。', ok: '削除する', danger: true }))) return;
        try { await api(`/admin/users/${name}`, { method: 'DELETE' }); toast(`@${name} のアカウントを削除しました`); loadAdminUsers($('#admin-search').q.value.trim()); } catch (e) { toast(e.message, 'error'); }
      } },
    ]);
  }));
}

// =====================================================================
// PIXEL WORLD (全校で 1 枚のキャンバスを共有して描く)
// ・待ち時間 (クールタイム) はなし。サーバーで PW_COOLDOWN_MS を設定したときだけ、残り時間を表示する (判定はサーバー側)
// ・他の人の配置は WebSocket (/pw) で届く。順番の番号 (seq) が飛んだら全体を取り直す
// =====================================================================
const PW_SIZE = 100;
const pwHex = (pal, i) => pal[i]?.hex || '#ffffff';
const pwRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const pwIsLight = (hex) => { const [r, g, b] = pwRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 160; };
const pwSwatch = (pal, i) => `<span class="pw-chip" style="background:${pwHex(pal, i)}"></span>${i} ${esc(pal[i]?.name || '')}`;
// base64 のピクセル (1 マス 1 バイト) をキャンバスに描く
function pwDraw(canvas, pixels, pal) {
  const g = canvas.getContext('2d'), img = g.createImageData(PW_SIZE, PW_SIZE);
  const rgb = pal.map((p) => pwRgb(p.hex));
  for (let i = 0; i < pixels.length; i++) { const c = rgb[pixels[i]] || [255, 255, 255]; img.data.set([c[0], c[1], c[2], 255], i * 4); }
  g.putImageData(img, 0, 0);
}
const pwDecode = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const pwFmtDate = (t) => new Date(t).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });

async function viewPixel() {
  const S = {
    pal: [], pixels: null, canvasId: 0, seq: 0, offset: 0, cooldownMs: 60_000, nextAt: 0, paused: false, reason: '',
    color: store.get('ippo_pw_color', 10), sel: null, s: 4, tx: 0, ty: 0, recent: [], stats: {}, online: 0,
    ws: null, wsTry: 0, closed: false, placing: false, title: '', theme: '',
  };
  main.innerHTML = pageHead({ title: 'PIXEL WORLD', sub: 'みんなで描く 100×100 のキャンバス', actions: `<a class="btn btn-outline btn-sm" href="#/pixel/archive">${icon('file')}アーカイブ</a>` }) + `<div class="content pw">
    <section class="card pw-status" id="pw-status" aria-live="polite">
      <div class="pw-status-main"><div class="pw-title" id="pw-title">読み込み中…</div><div class="pw-theme" id="pw-theme"></div></div>
      <div class="pw-timer" id="pw-timer"></div>
    </section>
    <section class="card pw-board">
      <div class="pw-viewport" id="pw-viewport" tabindex="0" aria-label="キャンバス。矢印キーでマスを選び、Enter で配置">
        <div class="pw-stage" id="pw-stage">
          <canvas id="pw-canvas" width="${PW_SIZE}" height="${PW_SIZE}"></canvas>
          <div class="pw-grid"></div>
          <div class="pw-hover hidden" id="pw-hover"></div>
          <div class="pw-sel hidden" id="pw-sel"></div>
        </div>
        <div class="pw-paused hidden" id="pw-paused"></div>
        <div class="pw-zoom">
          <button class="icon-btn" type="button" data-zoom="in" aria-label="拡大">${icon('plus')}</button>
          <button class="icon-btn" type="button" data-zoom="out" aria-label="縮小"><svg class="ic" aria-hidden="true"><path d="M5 12h14"/></svg></button>
          <button class="icon-btn" type="button" data-zoom="fit" aria-label="全体を表示"><svg class="ic" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
        </div>
        <div class="pw-conn" id="pw-conn"><i></i><span>接続中…</span></div>
      </div>
      <div class="pw-palette" id="pw-palette" role="radiogroup" aria-label="カラーパレット"></div>
      <div class="pw-place" id="pw-place"></div>
      <details class="pw-help"><summary>${icon('sparkle', 'ic-sm')}操作方法</summary>
        <ul>
          <li><b>マスを選ぶ</b>: タップ（クリック）すると、置く色でマスが光ります。「ここに置く」で配置します。</li>
          <li><b>拡大・縮小</b>: 2本指でピンチ、マウスホイール、または右上の ＋ − ボタン。</li>
          <li><b>移動</b>: ドラッグでキャンバスを動かせます。</li>
          <li id="pw-rule"><b>ルール</b>: 待ち時間なし。<b>何マスでも続けて</b>置けます。</li>
          <li>キーボード: 矢印キーでマスを移動、Enter で配置。</li>
        </ul>
      </details>
    </section>
    <section class="card card-pad" id="pw-stats"></section>
    <section class="card card-pad" id="pw-poll"></section>
    <section class="card card-pad" id="pw-recent"></section>
    ${me?.isAdmin ? '<section class="card card-pad pw-admin" id="pw-admin"></section>' : ''}
  </div>`;

  const vp = $('#pw-viewport'), stage = $('#pw-stage'), cv = $('#pw-canvas'), selEl = $('#pw-sel'), hoverEl = $('#pw-hover');
  const now = () => Date.now() + S.offset;

  // ---------- 表示位置 (拡大・移動) ----------
  const fitScale = () => Math.min(vp.clientWidth, vp.clientHeight) / PW_SIZE;
  function apply() {
    const vw = vp.clientWidth, vh = vp.clientHeight, size = PW_SIZE * S.s, m = 0.35;
    S.tx = Math.min(Math.max(S.tx, Math.min(0, vw - size) - vw * m), Math.max(0, vw - size) + vw * m);
    S.ty = Math.min(Math.max(S.ty, Math.min(0, vh - size) - vh * m), Math.max(0, vh - size) + vh * m);
    stage.style.transform = `translate(${S.tx}px, ${S.ty}px) scale(${S.s})`;
    stage.style.setProperty('--s', S.s);
    vp.classList.toggle('show-grid', S.s >= 9);
  }
  function zoomAt(f, cx, cy) {
    const min = fitScale() * 0.9, max = 48;
    const ns = Math.min(max, Math.max(min, S.s * f));
    S.tx = cx - (cx - S.tx) * (ns / S.s); S.ty = cy - (cy - S.ty) * (ns / S.s); S.s = ns; apply();
  }
  function fit() { S.s = fitScale(); S.tx = (vp.clientWidth - PW_SIZE * S.s) / 2; S.ty = (vp.clientHeight - PW_SIZE * S.s) / 2; apply(); }
  const cellAt = (clientX, clientY) => {
    const r = vp.getBoundingClientRect();
    const x = Math.floor((clientX - r.left - S.tx) / S.s), y = Math.floor((clientY - r.top - S.ty) / S.s);
    return x >= 0 && x < PW_SIZE && y >= 0 && y < PW_SIZE ? { x, y } : null;
  };

  // ---------- 操作 (タップ・ドラッグ・ピンチ・ホイール) ----------
  const ptrs = new Map();
  let drag = null, pinch = null, pinched = false;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pw-zoom')) return;
    vp.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty, moved: false }; pinched = false; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], r = vp.getBoundingClientRect();
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: S.s, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, tx: S.tx, ty: S.ty };
      pinched = true; drag = null;
    }
  });
  vp.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !ptrs.size) {
      const c = cellAt(e.clientX, e.clientY);
      hoverEl.classList.toggle('hidden', !c);
      if (c) { hoverEl.style.left = c.x + 'px'; hoverEl.style.top = c.y + 'px'; }
    }
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], r = vp.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      const ns = Math.min(48, Math.max(fitScale() * 0.9, pinch.s * d / pinch.d));
      // ピンチの中心が指の下に留まるように
      S.tx = mx - (pinch.mx - pinch.tx) * (ns / pinch.s); S.ty = my - (pinch.my - pinch.ty) * (ns / pinch.s); S.s = ns; apply();
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 7) drag.moved = true;
      if (drag.moved) { S.tx = drag.tx + dx; S.ty = drag.ty + dy; apply(); }
    }
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) {
      if (drag && !drag.moved && !pinched) { const c = cellAt(e.clientX, e.clientY); if (c) select(c); }
      drag = null;
    }
  };
  vp.addEventListener('pointerup', endPtr);
  vp.addEventListener('pointercancel', endPtr);
  vp.addEventListener('pointerleave', () => hoverEl.classList.add('hidden'));
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $$('[data-zoom]', vp).forEach((b) => b.addEventListener('click', () => {
    const z = b.dataset.zoom;
    if (z === 'fit') return fit();
    const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
    // 選択中のマスがあれば、そこを中心に拡大
    if (S.sel && z === 'in') { S.tx = cx - (S.sel.x + 0.5) * S.s; S.ty = cy - (S.sel.y + 0.5) * S.s; }
    zoomAt(z === 'in' ? 1.6 : 1 / 1.6, cx, cy);
  }));
  vp.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) { e.preventDefault(); const c = S.sel || { x: 50, y: 50 }; select({ x: Math.min(99, Math.max(0, c.x + d[0])), y: Math.min(99, Math.max(0, c.y + d[1])) }); }
    else if (e.key === 'Enter' && S.sel) { e.preventDefault(); place(); }
  });
  const onResize = () => fit();
  window.addEventListener('resize', onResize);

  // ---------- パレット ----------
  function renderPalette() {
    $('#pw-palette').innerHTML = S.pal.map((p) => `<button class="pw-color${p.id === S.color ? ' on' : ''}${pwIsLight(p.hex) ? ' light' : ''}" type="button" role="radio"
      aria-checked="${p.id === S.color}" aria-label="${p.id} ${esc(p.name)}" title="${p.id} ${esc(p.name)}" data-color="${p.id}" style="--c:${p.hex}">${p.id === S.color ? icon('check') : ''}</button>`).join('') +
      `<div class="pw-color-name">選択中: ${pwSwatch(S.pal, S.color)}</div>`;
    $$('[data-color]', $('#pw-palette')).forEach((b) => b.addEventListener('click', () => { S.color = Number(b.dataset.color); store.set('ippo_pw_color', S.color); renderPalette(); renderSelection(); }));
  }

  // ---------- 選択と配置 ----------
  function select(c) {
    S.sel = c;
    renderSelection();
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(5);
  }
  function renderSelection() {
    if (S.sel) {
      selEl.classList.remove('hidden');
      selEl.style.left = S.sel.x + 'px'; selEl.style.top = S.sel.y + 'px';
      selEl.style.background = pwHex(S.pal, S.color);
    } else selEl.classList.add('hidden');
    renderPlaceBar();
  }
  function renderPlaceBar() {
    const el = $('#pw-place');
    if (!el) return;
    const wait = Math.max(0, S.nextAt - now());
    let btn;
    if (!me) btn = `<button class="btn btn-primary" type="button" id="pw-login">ログインして参加</button>`;
    else if (S.paused) btn = `<button class="btn btn-secondary" type="button" disabled>${icon('lock')}停止中</button>`;
    else if (wait > 0) btn = `<button class="btn btn-secondary pw-wait" type="button" disabled>あと ${Math.ceil(wait / 1000)}秒</button>`;
    else btn = `<button class="btn btn-primary" type="button" id="pw-go" ${S.sel && !S.placing ? '' : 'disabled'}>${S.placing ? '配置中…' : 'ここに置く'}</button>`;
    const info = S.sel
      ? `<div class="pw-place-info"><b>(${S.sel.x}, ${S.sel.y})</b><span>${pwSwatch(S.pal, S.pixels?.[S.sel.y * PW_SIZE + S.sel.x] ?? 0)}</span><span class="pw-arrow">→</span><span>${pwSwatch(S.pal, S.color)}</span></div>`
      : `<div class="pw-place-info"><span>${pwSwatch(S.pal, S.color)}</span><span class="muted">置きたいマスをタップ</span></div>`;
    el.innerHTML = info + btn;
    $('#pw-login')?.addEventListener('click', () => openAuth());
    $('#pw-go')?.addEventListener('click', place);
  }
  async function place() {
    if (!me) return openAuth();
    if (!S.sel || S.placing || S.paused || S.nextAt > now()) return;
    S.placing = true; renderPlaceBar();
    const { x, y } = S.sel, color = S.color;
    try {
      const r = await api('/pw/pixels', { method: 'POST', body: { x, y, color }, noAuthPrompt: true });
      S.offset = r.serverNow - Date.now();
      S.nextAt = r.nextAt;
      applyPixel({ seq: r.seq, x, y, c: color, at: r.serverNow, canvas: S.canvasId }, true);
      pop(x, y);
      toast(`(${x}, ${y}) に ${S.pal[color].name} を置きました`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      resync(); // サーバーの状態 (残り時間・停止状態) に合わせる
    }
    S.placing = false; renderPlaceBar(); renderTimer();
  }
  // 配置成功のアニメーション
  function pop(x, y) {
    const el = document.createElement('div');
    el.className = 'pw-pop'; el.style.left = x + 'px'; el.style.top = y + 'px';
    stage.append(el); setTimeout(() => el.remove(), 700);
  }

  // ---------- 状態の反映 ----------
  function drawPixel(x, y, c) {
    const g = cv.getContext('2d'); g.fillStyle = pwHex(S.pal, c); g.fillRect(x, y, 1, 1);
  }
  function applyPixel(ev, mine = false) {
    if (ev.canvas && ev.canvas !== S.canvasId) return resync();
    if (ev.seq <= S.seq) return;                    // すでに反映済み (自分の配置の通知など)
    if (ev.seq > S.seq + 1 && !mine) { S.seq = ev.seq; return resync(); } // 取りこぼし → 全体を取り直す
    S.seq = Math.max(S.seq, ev.seq);
    S.pixels[ev.y * PW_SIZE + ev.x] = ev.c;
    drawPixel(ev.x, ev.y, ev.c);
    S.recent.unshift({ x: ev.x, y: ev.y, c: ev.c, at: ev.at });
    S.recent = S.recent.slice(0, 12);
    S.stats.todayPlacements = (S.stats.todayPlacements || 0) + 1;
    S.stats.hourPlacements = (S.stats.hourPlacements || 0) + 1;
    S.stats.placements = (S.stats.placements || 0) + 1;
    renderStats(); renderRecent();
    if (S.sel && S.sel.x === ev.x && S.sel.y === ev.y) renderPlaceBar();
  }
  let resyncing = null;
  async function resync() {
    if (resyncing) return resyncing;
    resyncing = (async () => {
      try {
        const st = await api('/pw/state', { noAuthPrompt: true });
        S.offset = st.serverNow - Date.now();
        S.pal = st.palette; S.cooldownMs = st.cooldownMs;
        const rule = $('#pw-rule');
        if (rule) rule.innerHTML = S.cooldownMs > 0 ? `<b>ルール</b>: 1人につき <b>${Math.round(S.cooldownMs / 1000)}秒に1マス</b>。待ち時間は持ち越せません。` : '<b>ルール</b>: 待ち時間なし。<b>何マスでも続けて</b>置けます。';
        S.canvasId = st.canvas.id; S.seq = st.canvas.seq; S.title = st.canvas.title; S.theme = st.canvas.theme;
        S.pixels = pwDecode(st.canvas.pixels);
        pwDraw(cv, S.pixels, S.pal);
        S.nextAt = st.me?.nextAt || 0;
        S.paused = st.paused; S.reason = st.reason;
        S.stats = st.stats; S.online = Math.max(S.online, st.stats.online);
        S.recent = st.recent;
        $('#pw-title').textContent = S.title;
        $('#pw-theme').innerHTML = S.theme ? `${icon('sparkle', 'ic-sm')}テーマ: ${esc(S.theme)}` : `${icon('calendar', 'ic-sm')}${pwFmtDate(st.canvas.startedAt)} から開催中`;
        renderPalette(); renderSelection(); renderTimer(); renderStats(); renderRecent(); renderPause();
      } catch (e) { toast('PIXEL WORLD を読み込めませんでした', 'error'); }
    })();
    try { await resyncing; } finally { resyncing = null; }
  }
  function renderPause() {
    const el = $('#pw-paused');
    el.classList.toggle('hidden', !S.paused);
    el.innerHTML = S.paused ? `${icon('lock')}<span>${esc(S.reason)}</span>` : '';
  }

  // 残り時間のカウントダウン (サーバーの時刻に合わせて表示)
  let lastReady = null;
  function renderTimer() {
    const el = $('#pw-timer');
    if (!el) return;
    const wait = Math.max(0, S.nextAt - now()), ready = !!me && !S.paused && wait === 0;
    const C = 2 * Math.PI * 17, frac = me && !S.paused ? (S.cooldownMs > 0 ? 1 - wait / S.cooldownMs : 1) : 0;
    el.className = `pw-timer${ready ? ' ready' : ''}${S.paused ? ' paused' : ''}`;
    el.innerHTML = `<svg class="pw-ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" class="track"/><circle cx="20" cy="20" r="17" class="bar" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
      <div class="pw-timer-text">${!me ? '<b>閲覧中</b><span>ログインで参加</span>'
        : S.paused ? '<b>停止中</b><span>しばらくお待ちください</span>'
        : ready ? '<b>配置できます</b><span>マスを選んでください</span>'
        : `<b>${Math.floor(Math.ceil(wait / 1000) / 60)}:${String(Math.ceil(wait / 1000) % 60).padStart(2, '0')}</b><span>次の配置まで</span>`}</div>`;
    if (lastReady === false && ready) { renderPlaceBar(); el.classList.add('pulse'); }
    else if (lastReady !== ready) renderPlaceBar();
    else if (!ready && $('.pw-wait')) $('.pw-wait').textContent = `あと ${Math.ceil(wait / 1000)}秒`;
    lastReady = ready;
  }
  function renderStats() {
    const s = S.stats;
    $('#pw-stats').innerHTML = `<div class="panel-head"><h3>${icon('users', 'ic-sm')}みんなの活動</h3><span class="pw-live"><i></i>LIVE</span></div>
      <div class="pw-stat-grid">
        <div><b>${S.online}</b><span>いま見ている人</span></div>
        <div><b>${s.todayParticipants ?? 0}</b><span>今日の参加者</span></div>
        <div><b>${s.hourPlacements ?? 0}</b><span>直近1時間の配置</span></div>
        <div><b>${s.todayPlacements ?? 0}</b><span>今日の配置</span></div>
      </div>
      <p class="text-xs muted" style="margin-top:10px">この作品の参加者 ${s.participants ?? 0}人 · 合計 ${(s.placements ?? 0).toLocaleString()}マス</p>`;
  }
  function renderRecent() {
    $('#pw-recent').innerHTML = `<div class="panel-head"><h3>${icon('refresh', 'ic-sm')}最近の更新</h3></div>` + (S.recent.length
      ? `<ul class="pw-recent">${S.recent.map((r) => `<li><span class="pw-chip" style="background:${pwHex(S.pal, r.c)}"></span>(${r.x}, ${r.y}) が ${esc(S.pal[r.c]?.name || '')} に<time>${timeAgo(r.at)}</time></li>`).join('')}</ul>`
      : '<p class="text-sm muted">まだ誰も置いていません。最初の1マスを置いてみましょう！</p>');
  }

  // ---------- テーマ投票 ----------
  async function loadPoll() {
    const el = $('#pw-poll');
    if (!el) return;
    let poll;
    try { ({ poll } = await api('/pw/poll', { noAuthPrompt: true })); } catch { return; }
    if (!poll) { el.innerHTML = `<div class="panel-head"><h3>${icon('sparkle', 'ic-sm')}次のテーマ投票</h3></div><p class="text-sm muted">現在、テーマ投票はありません。</p>`; return; }
    const open = poll.status === 'open';
    el.innerHTML = `<div class="panel-head"><h3>${icon('sparkle', 'ic-sm')}次のテーマ投票</h3><span class="chip ${open ? 'chip-accent' : ''}">${open ? '受付中' : '締め切り'}</span></div>
      <p class="pw-q">${esc(poll.question)}</p>
      <div class="pw-options" role="list">${poll.options.map((o) => {
        const pct = poll.total ? Math.round(o.votes / poll.total * 100) : 0, mine = poll.myVote === o.id;
        return `<button class="pw-option${mine ? ' mine' : ''}" type="button" data-opt="${o.id}" ${open ? '' : 'disabled'} aria-pressed="${mine}">
          <span class="pw-bar" style="width:${pct}%"></span>
          <span class="pw-opt-label">${mine ? icon('check', 'ic-sm') : ''}${esc(o.label)}</span><span class="pw-opt-num">${pct}% · ${o.votes}票</span></button>`;
      }).join('')}</div>
      <p class="text-xs muted" style="margin-top:8px">合計 ${poll.total}票${open ? ' · 投票は何度でも変えられます' : ''}</p>
      ${me?.isAdmin && open ? `<button class="btn btn-ghost btn-sm" type="button" id="pw-poll-close" style="margin-top:8px">この投票を締め切る</button>` : ''}`;
    $$('[data-opt]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!me) return openAuth();
      try { await api(`/pw/poll/${poll.id}/vote`, { method: 'POST', body: { optionId: Number(b.dataset.opt) } }); loadPoll(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    $('#pw-poll-close')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: '投票を締め切りますか？', body: 'これ以降は投票できなくなります。', ok: '締め切る' }))) return;
      await api(`/pw/admin/polls/${poll.id}/close`, { method: 'POST' }); loadPoll();
    });
  }

  // ---------- 運営メニュー (管理者だけ) ----------
  function renderAdmin() {
    const el = $('#pw-admin');
    if (!el) return;
    const hourAgo = new Date(Date.now() - 3600_000 + 9 * 3600_000).toISOString().slice(0, 16);
    el.innerHTML = `<details><summary class="panel-head"><h3>${icon('shield', 'ic-sm')}運営メニュー</h3><span class="chip chip-accent">管理者</span></summary>
      <div class="pw-admin-body">
        <div class="pw-admin-block"><h4>一時停止</h4>
          <div class="row"><input class="input" id="pwa-reason" placeholder="停止の理由（例: 点検中）" maxlength="100">
          <button class="btn ${S.paused ? 'btn-primary' : 'btn-danger-outline'}" type="button" id="pwa-pause">${S.paused ? '再開する' : '停止する'}</button></div></div>
        <div class="pw-admin-block"><h4>休止時間帯（毎日）</h4>
          <div class="row"><input class="input" type="time" id="pwa-qs"><span>〜</span><input class="input" type="time" id="pwa-qe">
          <button class="btn btn-outline" type="button" id="pwa-quiet">保存</button></div>
          <p class="field-hint">例: 22:00〜06:00。両方を空にして保存すると解除します</p></div>
        <div class="pw-admin-block"><h4>マスの履歴を調べる</h4>
          <button class="btn btn-outline" type="button" id="pwa-pixel">選択中のマスを調べる</button><div id="pwa-pixel-out"></div></div>
        <div class="pw-admin-block"><h4>配置を元に戻す</h4>
          <div class="form-stack" style="gap:8px"><input class="input" id="pwa-user" placeholder="ユーザー名" autocapitalize="off">
          <label class="field"><span class="field-hint">この日時以降に置いたマスを戻します（その後に他の人が置いたマスはそのまま）</span><input class="input" type="datetime-local" id="pwa-since" value="${hourAgo}"></label>
          <div class="row"><button class="btn btn-outline" type="button" id="pwa-user-check">配置を確認</button><button class="btn btn-danger-outline" type="button" id="pwa-revert">元に戻す</button></div>
          <div id="pwa-user-out"></div></div></div>
        <div class="pw-admin-block"><h4>作品を完成させる</h4>
          <div class="form-stack" style="gap:8px"><input class="input" id="pwa-title" placeholder="作品名（例: 学園祭の夜空）" maxlength="60">
          <input class="input" id="pwa-next" placeholder="次のキャンバスの名前（例: 第2回 PIXEL WORLD）" maxlength="60">
          <input class="input" id="pwa-theme" placeholder="次のテーマ（任意。例: 宇宙）" maxlength="60">
          <button class="btn btn-primary" type="button" id="pwa-archive">アーカイブして新しいキャンバスを始める</button></div></div>
        <div class="pw-admin-block"><h4>テーマ投票を作る</h4>
          <div class="form-stack" style="gap:8px"><input class="input" id="pwa-q" placeholder="質問（例: 次のテーマは？）" maxlength="80">
          <textarea class="textarea" id="pwa-opts" rows="4" placeholder="選択肢を1行に1つ（2〜8個）&#10;学校のマスコット&#10;宇宙&#10;動物"></textarea>
          <button class="btn btn-outline" type="button" id="pwa-poll">投票を作成（今の投票は締め切り）</button></div></div>
      </div></details>`;
    const fmtT = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('#pwa-pause').addEventListener('click', async () => {
      try { const p = await api('/pw/admin/pause', { method: 'POST', body: { paused: !S.paused, reason: $('#pwa-reason').value } });
        S.paused = p.paused; S.reason = p.reason; renderPause(); renderTimer(); renderAdmin(); toast(p.paused ? '一時停止しました' : '再開しました', 'success'); } catch (e) { toast(e.message, 'error'); }
    });
    $('#pwa-quiet').addEventListener('click', async () => {
      try { const r = await api('/pw/admin/quiet', { method: 'POST', body: { start: $('#pwa-qs').value, end: $('#pwa-qe').value } });
        toast(r.quiet ? `休止時間帯を ${r.quiet.start}〜${r.quiet.end} にしました` : '休止時間帯を解除しました', 'success'); resync(); } catch (e) { toast(e.message, 'error'); }
    });
    $('#pwa-pixel').addEventListener('click', async () => {
      if (!S.sel) return toast('先にキャンバスのマスを選んでください', 'error');
      const { history } = await api(`/pw/admin/pixel?x=${S.sel.x}&y=${S.sel.y}`);
      $('#pwa-pixel-out').innerHTML = `<p class="text-sm" style="margin-top:8px"><b>(${S.sel.x}, ${S.sel.y})</b> の履歴</p>` + (history.length
        ? `<ul class="pw-recent">${history.map((h) => `<li><span class="pw-chip" style="background:${pwHex(S.pal, h.color)}"></span>${esc(S.pal[h.color].name)}${h.kind === 'restore' ? '（復元）' : ''} · @${esc(h.user)}<time>${fmtT(h.at)}</time></li>`).join('')}</ul>`
        : '<p class="text-sm muted">まだ誰も置いていません</p>');
    });
    const sinceMs = () => new Date($('#pwa-since').value + ':00+09:00').getTime() || 0;
    $('#pwa-user-check').addEventListener('click', async () => {
      try { const r = await api('/pw/admin/user?username=' + encodeURIComponent($('#pwa-user').value.trim().replace(/^@/, '')));
        const since = sinceMs(), n = r.placements.filter((p) => p.at >= since).length;
        $('#pwa-user-out').innerHTML = `<p class="text-sm" style="margin-top:8px">@${esc(r.user.username)}: この作品で ${r.placements.length}マス（指定日時以降 ${n}マス）</p>` +
          `<ul class="pw-recent">${r.placements.slice(0, 15).map((p) => `<li><span class="pw-chip" style="background:${pwHex(S.pal, p.color)}"></span>(${p.x}, ${p.y}) を ${esc(S.pal[p.color].name)} に<time>${fmtT(p.at)}</time></li>`).join('')}</ul>`;
      } catch (e) { toast(e.message, 'error'); }
    });
    $('#pwa-revert').addEventListener('click', async () => {
      const username = $('#pwa-user').value.trim().replace(/^@/, '');
      if (!username) return toast('ユーザー名を入力してください', 'error');
      if (!(await confirmDialog({ title: `@${username} の配置を元に戻しますか？`, body: `${$('#pwa-since').value.replace('T', ' ')} 以降に置いたマスを、置く前の色に戻します。`, ok: '元に戻す', danger: true }))) return;
      try { const r = await api('/pw/admin/revert', { method: 'POST', body: { username, since: sinceMs() } }); toast(`${r.restored}マスを元に戻しました`, 'success'); } catch (e) { toast(e.message, 'error'); }
    });
    $('#pwa-archive').addEventListener('click', async () => {
      const title = $('#pwa-title').value.trim(), nextTitle = $('#pwa-next').value.trim(), nextTheme = $('#pwa-theme').value.trim();
      if (!title || !nextTitle) return toast('作品名と次のキャンバスの名前を入力してください', 'error');
      if (!(await confirmDialog({ title: '作品を完成させますか？', body: `今のキャンバスを「${title}」としてアーカイブし、真っ白な「${nextTitle}」を始めます。\nタイムラインに完成のお知らせが投稿されます。`, ok: '完成させる' }))) return;
      try { const r = await api('/pw/admin/archive', { method: 'POST', body: { title, nextTitle, nextTheme } }); toast('作品をアーカイブしました', 'success'); location.hash = '#/pixel/archive/' + r.archiveId; } catch (e) { toast(e.message, 'error'); }
    });
    $('#pwa-poll').addEventListener('click', async () => {
      const options = $('#pwa-opts').value.split('\n').map((s) => s.trim()).filter(Boolean);
      try { await api('/pw/admin/polls', { method: 'POST', body: { question: $('#pwa-q').value, options } }); toast('テーマ投票を作成しました', 'success'); loadPoll(); } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- リアルタイム接続 (切れたら自動で再接続し、全体を取り直す) ----------
  function setConn(state) {
    const el = $('#pw-conn');
    if (!el) return;
    el.className = `pw-conn ${state}`;
    $('span', el).textContent = state === 'on' ? 'リアルタイム' : state === 'off' ? '再接続中…' : '接続中…';
  }
  function connect() {
    if (S.closed) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pw`);
    S.ws = ws;
    ws.onopen = () => { const again = S.wsTry > 0; S.wsTry = 0; setConn('on'); if (again) resync(); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'px') applyPixel(m);
      else if (m.t === 'hello' || m.t === 'online') { S.online = m.n; renderStats(); }
      else if (m.t === 'pause') { S.paused = m.paused; S.reason = m.reason; renderPause(); renderTimer(); }
      else if (m.t === 'reload') { toast('新しいキャンバスが始まりました'); resync(); }
      else if (m.t === 'poll') loadPoll();
    };
    ws.onclose = () => {
      if (S.closed) return;
      setConn('off');
      S.wsTry++;
      setTimeout(connect, Math.min(15000, 800 * 2 ** Math.min(S.wsTry, 5)));
    };
  }

  // ---------- 起動・後片付け ----------
  await resync();
  requestAnimationFrame(fit);
  connect();
  loadPoll();
  renderAdmin();
  const tick = setInterval(renderTimer, 250);
  const statTimer = setInterval(async () => {
    if (document.hidden) return;
    try { const r = await api('/pw/stats', { noAuthPrompt: true }); S.stats = { ...r.stats }; S.online = Math.max(r.stats.online, 0); S.paused = r.paused; S.reason = r.reason; renderStats(); renderPause(); } catch {}
  }, 30_000);
  // 別のタブから戻ってきた時は最新状態に合わせる
  const onVisible = () => { if (!document.hidden) resync(); };
  document.addEventListener('visibilitychange', onVisible);
  viewCleanup = () => {
    S.closed = true;
    try { S.ws?.close(); } catch {}
    clearInterval(tick); clearInterval(statTimer);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// 作品アーカイブ一覧
async function viewPixelArchive() {
  main.innerHTML = pageHead({ title: '作品アーカイブ', sub: 'PIXEL WORLD', back: '#/pixel' }) + `<div class="content" id="pwa-list">${skeletonPosts(1)}</div>`;
  let r;
  try { r = await api('/pw/archives', { noAuthPrompt: true }); } catch (e) { $('#pwa-list').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  if (!r.archives.length) { $('#pwa-list').innerHTML = emptyState({ icon: 'file', title: 'まだ完成した作品はありません', text: '今のキャンバスが完成すると、ここに保存されます。', action: '<a class="btn btn-primary" href="#/pixel">キャンバスへ</a>' }); return; }
  $('#pwa-list').innerHTML = `<div class="grid-2">${r.archives.map((a) => `<a class="card pw-art-card" href="#/pixel/archive/${a.id}">
      <canvas class="pw-thumb" width="${PW_SIZE}" height="${PW_SIZE}" data-px="${a.pixels}"></canvas>
      <div class="pw-art-meta"><b>${esc(a.title)}</b>${!a.published ? ' <span class="chip">非公開</span>' : ''}
        <span>${pwFmtDate(a.startedAt)}〜${pwFmtDate(a.endedAt)}</span><span>${a.participants}人 · ${a.placements.toLocaleString()}マス</span></div></a>`).join('')}</div>`;
  $$('canvas[data-px]', main).forEach((c) => pwDraw(c, pwDecode(c.dataset.px), r.palette));
}

// 作品の詳細 (閲覧専用) + コメント (完成のお知らせ投稿への返信を利用)
async function viewPixelArtwork(id) {
  main.innerHTML = pageHead({ title: '作品', back: '#/pixel/archive' }) + `<div class="content" id="pwa-art">${skeletonPosts(1)}</div>`;
  let r;
  try { r = await api('/pw/archives/' + id, { noAuthPrompt: true }); } catch (e) { $('#pwa-art').innerHTML = emptyState({ icon: 'file', title: e.message }); return; }
  const a = r.archive;
  $('.page-head h1', main).innerHTML = `${esc(a.title)}<span class="sub">PIXEL WORLD 作品</span>`;
  $('#pwa-art').innerHTML = `<section class="card pw-art">
      <div class="pw-art-frame"><canvas id="pw-art-canvas" width="${PW_SIZE}" height="${PW_SIZE}"></canvas></div>
      <div class="pw-art-info">
        <h2>${esc(a.title)}</h2>
        ${a.theme ? `<p class="text-sm muted">テーマ: ${esc(a.theme)}</p>` : ''}
        <div class="hero-meta"><span>${icon('calendar')}${pwFmtDate(a.startedAt)}〜${pwFmtDate(a.endedAt)}</span><span>${icon('users')}${a.participants}人が参加</span><span>${icon('sparkle')}${a.placements.toLocaleString()}マス</span></div>
        <div class="row" style="margin-top:var(--s4);flex-wrap:wrap">
          <button class="btn btn-outline" type="button" id="pw-art-save">${icon('file')}画像を保存</button>
          ${r.canManage ? `<button class="btn ${a.published ? 'btn-ghost' : 'btn-primary'}" type="button" id="pw-art-pub">${a.published ? '非公開にする' : '公開する'}</button><span class="chip">${a.published ? '公開中' : '非公開'}</span>` : ''}
        </div>
      </div>
    </section>
    <h2 class="section-title">コメント</h2>
    <div id="pw-art-comments"></div>`;
  pwDraw($('#pw-art-canvas'), pwDecode(a.pixels), r.palette);
  $('#pw-art-save').addEventListener('click', () => {
    // 1 マス 10px の PNG にして保存
    const big = document.createElement('canvas'); big.width = big.height = PW_SIZE * 10;
    const g = big.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage($('#pw-art-canvas'), 0, 0, big.width, big.height);
    big.toBlob((blob) => {
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `pixel-world-${a.id}.png`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast('作品の画像を保存しました', 'success');
    }, 'image/png');
  });
  $('#pw-art-pub')?.addEventListener('click', async () => {
    try { await api('/pw/admin/archives/' + a.id, { method: 'PATCH', body: { published: !a.published } }); toast(a.published ? '非公開にしました' : '公開しました', 'success'); viewPixelArtwork(id); } catch (e) { toast(e.message, 'error'); }
  });
  // コメント: 完成のお知らせ投稿の返信をそのまま使う (既存のコメント機能)
  const box = $('#pw-art-comments');
  if (!a.postId) { box.innerHTML = '<p class="text-sm muted">この作品にはコメントできません</p>'; return; }
  try {
    const { replies } = await api('/posts/' + a.postId, { noAuthPrompt: true });
    box.innerHTML = (me ? `<div class="card compose-card" id="pw-art-compose">${composeHtml({ placeholder: '作品の感想を書く', submit: 'コメント' })}</div>`
      : `<div class="card card-pad row"><span class="text-sm muted" style="flex:1">ログインするとコメントできます</span><button class="btn btn-primary btn-sm" type="button" id="pw-art-login">ログイン</button></div>`) +
      `<div class="stack" id="replies" style="margin-top:var(--s3)">${replies.length ? replies.map((p) => renderPost(p)).join('') : '<p class="text-sm muted" id="pw-no-comments">まだコメントはありません</p>'}</div>`;
    $('#pw-art-login')?.addEventListener('click', () => openAuth());
    if (me) bindCompose($('#pw-art-compose'), { replyTo: a.postId, onDone: (p) => { $('#pw-no-comments')?.remove(); $('#replies').insertAdjacentHTML('beforeend', renderPost(p, { fresh: true })); toast('コメントしました', 'success'); } });
  } catch { box.innerHTML = '<p class="text-sm muted">コメントを読み込めませんでした</p>'; }
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
      ${i.status === 'open' ? `<button class="btn btn-outline btn-sm" data-qr="${esc(i.code)}" data-exp="${i.expiresAt}" type="button">QR</button><button class="btn btn-secondary btn-sm" data-share="${esc(i.code)}" type="button">送る</button><button class="icon-btn" data-del="${esc(i.code)}" aria-label="削除" type="button">${icon('trash')}</button>` : ''}
    </div>`).join('') + '</div>' : '';
  $$('[data-share]', el).forEach((b) => b.addEventListener('click', () => shareInvite(b.dataset.share)));
  $$('[data-qr]', el).forEach((b) => b.addEventListener('click', () => showInviteQr(b.dataset.qr, Number(b.dataset.exp))));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '招待リンクを削除しますか？', body: 'このリンクでは登録できなくなります。', ok: '削除する', danger: true }))) return;
    await api('/invites/' + b.dataset.del, { method: 'DELETE' }); loadInvites(); toast('招待リンクを削除しました');
  }));
}
// 招待の QR コード: 対面ならカメラで読み取ってもらう。画像として保存・共有もできる
function showInviteQr(code, expiresAt) {
  const exp = new Date(expiresAt).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  openPanel('招待QRコード', `<div class="qr-wrap">
      <div class="qr-box"><img class="qr-img" src="/api/invites/${encodeURIComponent(code)}/qr.svg" alt="招待リンクのQRコード" width="280" height="280"></div>
      <p class="qr-lead">スマホのカメラで読み取ると、IppO の登録画面が開きます</p>
      <div class="qr-code"><span>招待コード</span><code>${esc(code)}</code></div>
      <p class="text-xs muted">1人だけ使えます · ${exp}まで有効</p>
      <div class="qr-actions">
        <button class="btn btn-outline" type="button" id="qr-save">${icon('file')}画像を保存</button>
        <button class="btn btn-primary" type="button" id="qr-share">${icon('send')}リンクを送る</button>
      </div>
      <p class="text-xs muted qr-hint">読み取りにくい時は、画面を明るくしてください</p>
    </div>`, (root) => {
    $('#qr-share', root).addEventListener('click', () => shareInvite(code));
    $('#qr-save', root).addEventListener('click', () => saveInviteQr(code, exp, $('.qr-img', root)));
    $('.qr-img', root).addEventListener('error', () => { $('.qr-box', root).innerHTML = emptyState({ icon: 'alert', title: 'このリンクは使えません', text: '使用済みか、期限が切れています。' }); });
  });
}
// QR を「招待カード」の PNG 画像にして保存 (スマホは共有メニューから写真に保存・LINE などへ送信)
async function saveInviteQr(code, exp, img) {
  try {
    if (!img.complete) await new Promise((r, j) => { img.onload = r; img.onerror = j; });
    const W = 900, H = 1180, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const font = (w, s) => `${w} ${s}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    g.fillStyle = '#f5f6fa'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(60, 60, W - 120, H - 120, 48); g.fill();
    // ブランドマーク + 見出し
    g.strokeStyle = '#4b55f0'; g.lineWidth = 12; g.beginPath(); g.arc(W / 2 - 92, 170, 26, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#4b55f0'; g.beginPath(); g.arc(W / 2 - 92, 170, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f2766'; g.font = font(800, 56); g.textBaseline = 'middle'; g.fillText('IppO', W / 2 - 46, 172);
    g.textAlign = 'center'; g.fillStyle = '#191d2e'; g.font = font(700, 40); g.fillText('IppO に招待されました', W / 2, 270);
    g.drawImage(img, W / 2 - 300, 330, 600, 600);
    g.fillStyle = '#7c8399'; g.font = font(500, 28); g.fillText('カメラで読み取って登録してください', W / 2, 980);
    g.fillStyle = '#4b55f0'; g.font = `700 40px ui-monospace, Menlo, monospace`; g.fillText(code, W / 2, 1040);
    g.fillStyle = '#7c8399'; g.font = font(500, 24); g.fillText(`1人だけ使えます · ${exp}まで有効`, W / 2, 1090);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], `ippo-invite-${code}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: 'IppO への招待' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('QRコードの画像を保存しました', 'success');
  } catch { toast('画像を保存できませんでした', 'error'); }
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
      <a class="dm-row${c.unread ? ' unread' : ''}" href="#/dm/${esc(c.user.username)}" data-peer="${esc(c.user.username)}">
        <span class="avatar-wrap">${avatar(c.user)}${c.online ? '<i class="online-dot" title="オンライン"></i>' : ''}</span>
        <div class="dm-row-body">
          <div class="dm-row-top"><b>${esc(c.user.displayName)}${adminBadge(c.user)}</b><span class="text-sm muted">@${esc(c.user.username)}</span><time>${timeAgo(c.last.createdAt)}</time></div>
          <div class="dm-preview" data-text="${esc((c.last.mine ? 'あなた: ' : '') + c.last.content)}">${c.last.mine ? 'あなた: ' : ''}${esc(c.last.content)}</div>
        </div>
        ${c.unread ? `<b class="count-badge" style="margin-left:0">${c.unread}</b>` : ''}
      </a>`).join('')}</div>` : emptyState({ icon: 'mail', title: 'まだメッセージはありません', text: '相手のプロフィールの ' + icon('mail', 'ic-sm') + ' から、または上の欄にユーザー名を入れて始められます。' });
    applyTyping(); // 一覧を描き直しても「入力中…」を保つ
  };
  // 相手ごとの「入力中」の期限。一覧を描き直した時もここから表示を戻す
  const typingUntil = new Map();
  const typingTimers = new Map();
  function applyTyping() {
    $$('.dm-row[data-peer]', main).forEach((row) => {
      const el = $('.dm-preview', row), on = (typingUntil.get(row.dataset.peer) || 0) > Date.now();
      el.textContent = on ? '入力中…' : el.dataset.text;
      el.classList.toggle('typing', on);
    });
  }
  await load().catch((e) => { $('#dm-list').innerHTML = emptyState({ icon: 'alert', title: e.message }); });
  const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 10_000);
  const off = RT.on((m) => {
    if (m.t === 'dm') { if (m.from) typingUntil.delete(m.from); load().catch(() => {}); }
    else if (m.t === 'typing') {
      typingUntil.set(m.from, Date.now() + 4500);
      applyTyping();
      clearTimeout(typingTimers.get(m.from));
      typingTimers.set(m.from, setTimeout(applyTyping, 4600));
    }
  });
  viewCleanup = () => { clearInterval(t); off(); typingTimers.forEach(clearTimeout); };
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
    <div class="dm-typing hidden" id="dm-typing" aria-live="polite"><span class="dm-typing-bubble"><i></i><i></i><i></i></span><span class="dm-typing-text"></span></div>
    <form class="dm-composer" id="dm-form">
      <textarea class="textarea" name="c" rows="1" placeholder="メッセージを入力" maxlength="1000" aria-label="メッセージ"></textarea>
      <button class="btn btn-primary send" type="submit" disabled aria-label="送信">${icon('send')}</button>
    </form>`;
  const thread = $('#dm-thread'), form = $('#dm-form'), ta = form.c, btn = $('button', form), typingEl = $('#dm-typing');
  let lastId = 0, firstId = 0, stopped = false, peerUser = null;
  // 相手の状態: online (true/false/null=非公開), lastSeenAt, typing, readUpTo (既読の位置。null=非公開)
  const peer = { online: null, lastSeenAt: null, typing: false, readUpTo: null };
  let typingTimer = null, statusTimer = null;
  const atBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  const scrollBottom = () => window.scrollTo(0, document.body.scrollHeight);
  const append = (msgs) => {
    const fresh = msgs.filter((m) => !thread.querySelector(`.dm-msg[data-id="${m.id}"]`));
    if (!fresh.length) return;
    $('.empty', thread)?.remove();
    thread.insertAdjacentHTML('beforeend', fresh.map(dmBubble).join(''));
    lastId = Math.max(lastId, ...fresh.map((m) => m.id));
    renderRead();
  };
  // 見出しの下: 入力中 / オンライン / 最終オンライン / @ユーザー名
  function renderStatus() {
    const sub = $('#dm-status');
    if (!sub || !peerUser) return;
    let html, cls = '';
    if (peer.typing) { html = '入力中…'; cls = 'typing'; }
    else if (peer.online) { html = '<i class="dm-dot"></i>オンライン'; cls = 'online'; }
    else if (peer.lastSeenAt) html = `最終オンライン ${timeAgo(peer.lastSeenAt)}`;
    else html = `@${esc(peerUser.username)}`;
    sub.className = `sub dm-status ${cls}`;
    sub.innerHTML = html;
  }
  // 「既読」: 相手が読んだ自分のメッセージのうち、いちばん新しいものの下に表示
  function renderRead() {
    $$('.dm-read', thread).forEach((el) => el.remove());
    if (peer.readUpTo == null) return;
    const mine = $$('.dm-msg.mine', thread).filter((el) => Number(el.dataset.id) <= peer.readUpTo);
    const last = mine[mine.length - 1];
    if (last) $('.dm-time', last).insertAdjacentHTML('afterbegin', '<span class="dm-read">既読</span>');
  }
  function showTyping() {
    peer.typing = true;
    $('.dm-typing-text', typingEl).textContent = `${peerUser?.displayName || ''}さんが入力中`;
    const stick = atBottom();
    typingEl.classList.remove('hidden');
    if (stick) scrollBottom();
    renderStatus();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(hideTyping, 4500);
  }
  function hideTyping() { peer.typing = false; typingEl.classList.add('hidden'); clearTimeout(typingTimer); renderStatus(); }

  try {
    const { user, messages, hasMore, peer: p } = await api('/dm/' + encodeURIComponent(username));
    peerUser = user;
    Object.assign(peer, { online: p?.online ?? null, lastSeenAt: p?.lastSeenAt ?? null, readUpTo: p?.readUpTo ?? null });
    $('.page-head h1', main).innerHTML = `<a href="#/u/${esc(user.username)}" style="color:inherit">${esc(user.displayName)}</a>${adminBadge(user)}<span class="sub dm-status" id="dm-status"></span>`;
    renderStatus();
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
        renderRead();
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
  let typingSent = 0;
  ta.addEventListener('input', () => {
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; btn.disabled = !ta.value.trim();
    // 入力中の合図 (2.5 秒に 1 回まで)
    if (ta.value.trim() && Date.now() - typingSent > 2500) { typingSent = Date.now(); RT.send({ t: 'typing', to: username }); }
  });
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
      ta.value = ''; ta.dispatchEvent(new Event('input')); typingSent = 0;
      append([message]); scrollBottom();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    ta.focus();
  });
  // 新着の取得 (読んだことも相手に伝わる)。リアルタイム接続中は通知で即時、切れている時は 4 秒ごと
  const poll = async () => {
    if (stopped || document.hidden) return;
    try {
      const { messages } = await api(`/dm/${encodeURIComponent(username)}?after=${lastId}`, { noAuthPrompt: true });
      if (messages.length) { const stick = atBottom(); append(messages); if (stick) scrollBottom(); }
    } catch {}
  };
  const off = RT.on((m) => {
    if (m.t === 'dm' && m.from === username) { hideTyping(); poll(); }
    else if (m.t === 'dm' && m.to === username) { append([m.message]); scrollBottom(); } // 自分の別の端末から送った分
    else if (m.t === 'typing' && m.from === username) showTyping();
    else if (m.t === 'read' && m.by === username) { peer.readUpTo = Math.max(peer.readUpTo || 0, m.lastReadId); renderRead(); }
    else if (m.t === 'presence' && m.user === username) { peer.online = m.online; peer.lastSeenAt = m.lastSeenAt; renderStatus(); }
    else if (m.t === 'open') { RT.watch(username); poll(); }
  });
  RT.watch(username);
  const t = setInterval(() => { if (!RT.connected) poll(); }, 4000);
  statusTimer = setInterval(renderStatus, 30_000); // 「最終オンライン ○分前」を更新
  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  viewCleanup = () => {
    stopped = true; clearInterval(t); clearInterval(statusTimer); clearTimeout(typingTimer);
    off(); RT.watch(null);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// =====================================================================
// 画面の切り替え
// =====================================================================
function requireLogin() { if (me) return true; openAuth(); location.hash = '#/'; return false; }
function setActiveNav(key) { $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key)); }
let lastHash = null;
// ---------- 更新の確認: サーバーの画面ファイルが新しくなっていたら、画面を移るときに読み込み直す ----------
// (開きっぱなしの画面は古い絵やプログラムのままなので、新キャラが鉛筆の絵になるなどのずれが出る)
let assetVersion = null, versionCheckedAt = 0, reloadPending = false;
async function checkVersion() {
  if (Date.now() - versionCheckedAt < 60_000) return; versionCheckedAt = Date.now();
  try { const r = await fetch('/api/version', { cache: 'no-store' }); const { v } = await r.json();
    if (!assetVersion) assetVersion = v; else if (v && v !== assetVersion) reloadPending = true; } catch {}
}
checkVersion();
setInterval(checkVersion, 5 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { versionCheckedAt = 0; checkVersion(); } });
function route() {
  // 新しい版があれば、対戦中以外の画面に移るときに読み込み直す
  if (reloadPending && !/\/battle|\/table/.test(location.hash)) { reloadPending = false; location.reload(); return; }
  if (viewCleanup) { viewCleanup(); viewCleanup = null; }
  closeMenu();
  // 画面を移ったら、開いたままのウィンドウ (QR・確認など) を閉じる (ログイン画面は除く)
  $$('dialog[open]').forEach((d) => { if (d.id !== 'auth-dialog') closeModal(d); });
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
  if (h === '/news') { setActiveNav('news'); return viewNews(); }
  if ((m = h.match(/^\/news\/(\d+)/))) { setActiveNav('news'); return viewNewsItem(m[1]); }
  if (h === '/pixel') { setActiveNav('pixel'); return viewPixel(); }
  if (h === '/horse') { setActiveNav('games'); return viewHorse(); }
  if (h === '/monster') { setActiveNav('games'); return viewMonster(); }
  if (h === '/arena') { setActiveNav('games'); return viewArena(); }
  if (h === '/treasure') { setActiveNav('games'); return viewTreasure(); }
  if (h === '/horse/race') { setActiveNav('games'); return viewRace(); }
  if (h === '/games') { setActiveNav('games'); return viewGames(); }
  if (h === '/games/math') { setActiveNav('games'); return viewMath(); }
  if (h === '/games/cards') { setActiveNav('games'); return viewCards(); }
  if (h === '/games/poker') { setActiveNav('games'); return viewPoker(); }
  if (h.startsWith('/games/poker/table')) { setActiveNav('games'); return viewPokerTable(new URLSearchParams(h.split('?')[1] || '')); }
  if (h === '/games/cards/gacha') { setActiveNav('games'); return viewGacha(); }
  if (h === '/games/cards/collection') { setActiveNav('games'); return viewCollection(); }
  if (h === '/games/cards/quest') { setActiveNav('games'); return viewQuest(); }
  if (h === '/games/cards/oni') { setActiveNav('games'); return viewOni(); }
  if (h === '/games/cards/usage') { setActiveNav('games'); return viewCardUsage(); }
  if (h === '/games/cards/board') { setActiveNav('games'); return viewCardBoard(); }
  if (h.startsWith('/games/cards/battle')) { setActiveNav('games'); return viewBattle(new URLSearchParams(h.split('?')[1] || '')); }
  if (h === '/pixel/archive') { setActiveNav('pixel'); return viewPixelArchive(); }
  if ((m = h.match(/^\/pixel\/archive\/(\d+)/))) { setActiveNav('pixel'); return viewPixelArtwork(m[1]); }
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

// ---------- ミニゲーム「117万分の1 競走馬版」 (非公式のファン作品) ----------
// ゲームは /games/horse/ にあり、同じドメインの iframe で開く。ゲームとのやり取りは postMessage (同じドメインからだけ受け取る)
const HORSE_RARITY = { g1: 'UR', g2: 'SSR', g3: 'SR', l: 'R', n: 'N' };
function horseNote(h) {
  if (!h || (!h.best && !h.badges && !h.births)) return '';
  const parts = [h.best ? `最高 <b>${esc(HORSE_RARITY[h.best] || '')}</b>` : '', `バッジ ${Number(h.badges) || 0}/${Number(h.badgeTotal) || 29}`, h.births ? `${Number(h.births)}回生まれた` : ''].filter(Boolean);
  return `<a class="horse-note" href="#/horse"><span aria-hidden="true">🐴</span><span>117万分の1 競走馬版: ${parts.join(' · ')}</span></a>`;
}
function viewHorse() {
  main.innerHTML = pageHead({ title: '117万分の1 競走馬版', sub: 'ミニゲーム · 非公式のファン作品', actions: '<a class="btn btn-primary btn-sm" href="#/horse/race">🏇 レース</a>' }) +
    `<div class="horse-wrap"><iframe class="horse-frame" id="horse-frame" src="/games/horse/" title="117万分の1 競走馬版"></iframe></div>`;
  const frame = $('#horse-frame');
  // ゲームの中で画面全体の演出 (カットイン・下のボタン) が使えるよう、見えている高さぴったりにする
  const fit = () => {
    const tab = $('.tabbar'), tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().height : 0;
    const top = frame.getBoundingClientRect().top + window.scrollY;
    frame.style.height = Math.max(380, window.innerHeight - top - tabH) + 'px';
  };
  fit(); window.scrollTo(0, 0);
  window.addEventListener('resize', fit);
  viewCleanup = () => window.removeEventListener('resize', fit);
}
// シティバトル (/games/arena/ を iframe で開く。3D の撃ち合い)
function viewArena() {
  main.innerHTML = pageHead({ title: 'シティバトル', sub: 'ミニゲーム · 3D の撃ち合い・オンライン', back: '#/games' }) +
    `<div class="horse-wrap"></div>`;
  // 全画面: body の直下に置いて画面いっぱいにかぶせる (ヘッダー・タブバーの上。iPhone でも効く)。もどるはゲームの中の ✕
  $('#arena-frame')?.remove();
  const frame = document.createElement('iframe'); frame.className = 'horse-frame arena-full'; frame.id = 'arena-frame'; frame.src = '/games/arena/'; frame.title = 'シティバトル'; frame.allow = 'fullscreen';
  document.body.append(frame); document.body.classList.add('arena-open'); window.scrollTo(0, 0);
  viewCleanup = () => { frame.remove(); document.body.classList.remove('arena-open'); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
}
window.addEventListener('message', (e) => {
  const af = $('#arena-frame');
  if (!af || e.source !== af.contentWindow || e.origin !== location.origin) return;
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-arena' && e.data.type === 'login') openAuth();
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-arena' && e.data.type === 'exit') location.hash = '#/games';
});
// 宝探し (/games/treasure/ を iframe で開く。シティバトルと同じく画面いっぱい)
async function viewTreasure() {
  let st = null; try { st = await api('/treasure/status', { noAuthPrompt: true }); } catch {}
  if (st?.maint && !st.admin) { main.innerHTML = pageHead({ title: '宝探し', sub: 'ミニゲーム', back: '#/games' }) + `<div class="content">${emptyState({ icon: 'sparkle', title: '🛠️ ただいまメンテナンス中です', text: 'もうしばらくお待ちください' })}</div>`; return; } // メンテ中 (管理者は遊べる)
  main.innerHTML = pageHead({ title: '宝探し', sub: 'ミニゲーム · キャンパスの宝箱をみんなで探す', back: '#/games' }) + `<div class="horse-wrap"></div>`;
  $('#treasure-frame')?.remove();
  const frame = document.createElement('iframe'); frame.className = 'horse-frame arena-full'; frame.id = 'treasure-frame'; frame.src = '/games/treasure/'; frame.title = '宝探し'; frame.allow = 'fullscreen';
  document.body.append(frame); document.body.classList.add('arena-open'); window.scrollTo(0, 0);
  viewCleanup = () => { frame.remove(); document.body.classList.remove('arena-open'); };
}
window.addEventListener('message', (e) => {
  const tf = $('#treasure-frame');
  if (!tf || e.source !== tf.contentWindow || e.origin !== location.origin) return;
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-treasure' && e.data.type === 'login') openAuth();
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-treasure' && e.data.type === 'exit') location.hash = '#/games';
});
// ブリードモンスターズ (/games/monster/ を iframe で開く。競走馬版と同じ形)
async function viewMonster() {
  let ok = false; try { ok = (await api('/mon/access', { noAuthPrompt: true })).ok; } catch {}
  if (!ok) { main.innerHTML = pageHead({ title: 'ブリードモンスターズ', sub: 'ミニゲーム', back: '#/games' }) + `<div class="content">${emptyState({ icon: 'sparkle', title: 'ただいま準備中です', text: 'もうしばらくお待ちください' })}</div>`; return; }
  main.innerHTML = pageHead({ title: 'ブリードモンスターズ', sub: 'ミニゲーム · 配合・コマンドバトル・セリ' }) +
    `<div class="horse-wrap"><iframe class="horse-frame" id="mon-frame" src="/games/monster/" title="ブリードモンスターズ"></iframe></div>`;
  const frame = $('#mon-frame');
  const fit = () => {
    const tab = $('.tabbar'), tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().height : 0;
    frame.style.height = Math.max(420, window.innerHeight - (frame.getBoundingClientRect().top + window.scrollY) - tabH) + 'px';
  };
  fit(); window.scrollTo(0, 0);
  window.addEventListener('resize', fit);
  viewCleanup = () => window.removeEventListener('resize', fit);
}
window.addEventListener('message', (e) => {
  const mf = $('#mon-frame');
  if (!mf || e.source !== mf.contentWindow || e.origin !== location.origin) return;
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-monster' && e.data.type === 'login') openAuth();
  // 突然変異を発見したときの投稿: 投稿の画面を開くだけ (公開範囲などはいつもの投稿と同じ。自動では投稿しない)
  if (e.data && typeof e.data === 'object' && e.data.source === 'ippo-monster' && e.data.type === 'share') { const id = Number.isInteger(e.data.imageId) && e.data.imageId > 0 ? e.data.imageId : null; openCompose({ prefill: String(e.data.text || '').slice(0, 400), presetImages: id ? [{ id, url: '/api/images/' + id }] : [] }); }
});
window.addEventListener('message', (e) => {
  const frame = $('#horse-frame');
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || typeof d !== 'object' || d.source !== 'ippo-horse') return;
  if (d.type === 'login') return openAuth();
  if (d.type === 'share') {
    const id = Number.isInteger(d.imageId) && d.imageId > 0 ? d.imageId : null;
    openCompose({ prefill: String(d.text || '').slice(0, 400), presetImages: id ? [{ id, url: '/api/images/' + id }] : [] });
  }
});

// =====================================================================
// ミニゲームの一覧
// =====================================================================
function viewGames() {
  main.innerHTML = pageHead({ title: 'ミニゲーム', sub: 'みんなで遊べるゲーム' }) + `<div class="content stack">
    <div id="event-banners" class="ev-list"></div>
    <a class="card game-card" href="#/games/poker">
      <span class="game-card-art pk-art" aria-hidden="true">${pkCard('As')}${pkCard('Ah')}</span>
      <span class="game-card-body"><b>レート戦ポーカー</b><span>1対1のテキサスホールデム。相手のチップを全部とったら勝ち (お金やコインは賭けません)</span>
        <span class="chip chip-accent">${icon('trend', 'ic-sm')}レート戦・オンライン対戦</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card" href="#/games/math">
      <span class="game-card-art md-art" aria-hidden="true">${'<i>7</i><i>+</i><i>5</i>'}</span>
      <span class="game-card-body"><b>暗算ダッシュ</b><span>60秒で何問とける？ 連続正解でボーナス。今日・今週・これまでのランキングで競おう</span>
        <span class="chip chip-accent">${icon('trend', 'ic-sm')}ランキングつき</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card game-card-new" href="#/treasure">
      <span class="game-card-art mb-art" aria-hidden="true">🗝️</span>
      <span class="game-card-body"><b>宝探し <span class="chip" style="font-size:10px">🛠️ メンテ中</span></b><span>コンクリートの校舎がならぶキャンパスに、宝箱が 12 個。みんなで早いもの勝ちで探そう (戦いなし)</span>
        <span class="chip chip-accent">🗝️ 3D・オンライン</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card game-card-new" href="#/arena">
      <span class="game-card-art mb-art" aria-hidden="true">🏙️</span>
      <span class="game-card-body"><b>シティバトル <span class="chip chip-accent" style="font-size:10px">NEW</span></b><span>街を舞台にした 3D の撃ち合い。みんなとオンラインで、たおした数をきそおう (人が少ないときはボットも参加)</span>
        <span class="chip chip-accent">🎯 3D・オンライン対戦</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card game-card-new" href="#/monster" id="mon-game" style="display:none">
      <span class="game-card-art mb-art" aria-hidden="true">🧬</span>
      <span class="game-card-body"><b>ブリードモンスターズ <span class="chip chip-accent" style="font-size:10px">NEW</span></b><span>モンスターを配合して強い子を作り、十字キーのコマンドを打ちこんで戦う。15 分ごとにリアルタイムのセリも</span>
        <span class="chip chip-accent">🧬 配合・コマンドバトル・セリ</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card" href="#/games/cards">
      <span class="game-card-art cb-art" aria-hidden="true">${CBArt.svg('gold', 'N')}</span>
      <span class="game-card-body"><b>ぶんぼうぐバトラーズ</b><span>文房具のキャラクターをガチャで集めて、3枚のデッキでオンライン対戦</span>
        <span class="chip chip-accent">${icon('globe', 'ic-sm')}オンライン対戦・ガチャ・レート</span></span>${icon('chevron', 'chev')}</a>
    <a class="card game-card" href="#/horse">
      <span class="game-card-art horse-banner-art" aria-hidden="true">🐴</span>
      <span class="game-card-body"><b>117万分の1 競走馬版</b><span>今年生まれる馬の一頭になって、その一生をたどる（非公式のファン作品）。生まれた馬でオンラインレースも</span>
        <span class="chip chip-accent">🏇 図鑑の馬でレース・レート</span></span>${icon('chevron', 'chev')}</a>
  </div>`;
  loadEventBanners();
  // ブリードモンスターズはテスト中 (テスターにだけ一覧に出す)
  if (me) api('/mon/access', { noAuthPrompt: true }).then((r) => { if (r.ok && $('#mon-game')) $('#mon-game').style.display = ''; }).catch(() => {});
}

// =====================================================================
// 暗算ダッシュ: 60 秒で何問とけるか。点数はサーバーが計算し直す (端末は答えと時刻を送るだけ)
// =====================================================================
const MD_PERIODS = [['day', '今日'], ['week', '今週'], ['all', 'これまで']];
function mdPoints(combo) { return 10 + Math.min(combo - 1, 9) * 2; } // サーバーの計算と同じ
function viewMath() {
  let period = 'day', game = null, raf = 0, timers = [];
  main.innerHTML = pageHead({ title: '暗算ダッシュ', sub: '60秒で何問とける？', back: '#/games' }) + `<div class="content stack">
    <section class="card md-stage" id="md-stage" aria-live="polite"></section>
    <section class="card card-pad">
      <div class="panel-head"><h3>${icon('trend', 'ic-sm')}ランキング</h3></div>
      <div class="segmented md-periods" role="tablist">${MD_PERIODS.map(([v, l]) => `<button type="button" class="seg${v === period ? ' active' : ''}" data-period="${v}" role="tab">${l}</button>`).join('')}</div>
      <div id="md-rank" class="md-rank"></div>
    </section>
  </div>`;
  const stage = $('#md-stage');
  const clearTimers = () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = []; };
  const onKey = (e) => {
    if (!game || game.phase !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace' || e.key === 'Escape') { e.preventDefault(); press('clear'); }
  };
  document.addEventListener('keydown', onKey);
  viewCleanup = () => { clearTimers(); document.removeEventListener('keydown', onKey); game = null; };

  // ---------- はじめの画面 ----------
  function intro(msg = '') {
    game = null;
    stage.innerHTML = `<div class="md-intro">
      <div class="md-logo" aria-hidden="true"><i>7</i><i>×</i><i>8</i></div>
      <h2>暗算ダッシュ</h2>
      <ul class="md-rules">
        <li>制限時間は <b>60秒</b>。出てくる計算の答えを入力しよう</li>
        <li>正解で <b>10点</b>。<b>連続正解</b>するほどボーナスが増える (最大 +18点)</li>
        <li>まちがえると連続が途切れる。後半ほど難しくなる</li>
      </ul>
      ${me ? '' : `<p class="md-note">${icon('lock', 'ic-sm')}いまは<b>練習モード</b>です。ログインするとランキングに載ります。</p>`}
      ${msg ? `<p class="md-note md-err">${esc(msg)}</p>` : ''}
      <button class="btn btn-primary btn-lg md-start" type="button" id="md-start">${icon('sparkle')}スタート</button>
      ${me ? '' : '<button class="btn btn-ghost" type="button" id="md-login">ログインしてランキングに参加</button>'}
    </div>`;
    $('#md-start').addEventListener('click', start);
    $('#md-login')?.addEventListener('click', () => openAuth());
  }

  // ---------- ゲーム ----------
  async function start() {
    const btn = $('#md-start'); btn.disabled = true; btn.classList.add('is-loading');
    let r;
    try { r = await api('/games/math/start', { method: 'POST', noAuthPrompt: true }); }
    catch (e) { return intro(e.message); }
    game = { phase: 'count', runId: r.runId, problems: r.problems, gameMs: r.gameMs, ranked: r.ranked, i: 0, input: '', inputs: [], score: 0, combo: 0, best: 0, correct: 0, t0: 0, lastT: -1e9 };
    // 3・2・1
    let n = Math.round(r.countdownMs / 1000);
    const tick = () => {
      if (!game) return;
      if (n === 0) return play();
      stage.innerHTML = `<div class="md-count"><b>${n}</b><span>${game.ranked ? 'ランキング対象' : '練習モード'}</span></div>`;
      n--; timers.push(setTimeout(tick, 1000));
    };
    tick();
  }
  function play() {
    game.phase = 'play'; game.t0 = performance.now();
    window.scrollTo(0, 0); // 時間・点数・ボタンが全部見えるように
    stage.innerHTML = `<div class="md-play">
      <div class="md-bar"><i id="md-time"></i></div>
      <div class="md-hud"><span><b id="md-score">0</b>点</span><span id="md-combo" class="md-combo"></span><span id="md-left">60</span></div>
      <div class="md-q" id="md-q"></div>
      <div class="md-input" id="md-input" aria-label="入力中の答え"></div>
      <div class="md-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0'].map((k) => `<button type="button" class="md-key${k === 'clear' ? ' md-key-clear' : ''}" data-k="${k}" aria-label="${k === 'clear' ? '消す' : k}">${k === 'clear' ? '消す' : k}</button>`).join('')}</div>
    </div>`;
    // タップは pointerdown で受ける (連打しても取りこぼさない・ダブルタップで拡大しない)
    $$('.md-key', stage).forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(b.dataset.k); }));
    showQ();
    const loop = () => {
      if (!game || game.phase !== 'play') return;
      const left = Math.max(0, game.gameMs - (performance.now() - game.t0));
      $('#md-time').style.transform = `scaleX(${left / game.gameMs})`;
      $('#md-left').textContent = Math.ceil(left / 1000) + '秒';
      $('#md-time').classList.toggle('hurry', left < 10_000);
      if (left <= 0) return finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function showQ() {
    const p = game.problems[game.i];
    if (!p) return finish();
    $('#md-q').textContent = p.q + ' = ?';
    renderInput();
  }
  function renderInput() {
    const len = String(game.problems[game.i].a).length;
    $('#md-input').innerHTML = Array.from({ length: len }, (_, k) => `<i class="${k < game.input.length ? 'on' : ''}">${esc(game.input[k] || '')}</i>`).join('');
  }
  function press(k) {
    if (!game || game.phase !== 'play') return;
    if (k === 'clear') { game.input = ''; return renderInput(); }
    const p = game.problems[game.i];
    game.input += k; renderInput();
    if (game.input.length < String(p.a).length) return;
    // 答えの桁数がそろったら判定。時刻は、前の答えから 0.3 秒以上あける (サーバーの決まりと同じ)
    const t = Math.min(game.gameMs, Math.max(Math.round(performance.now() - game.t0), game.lastT + 300));
    game.lastT = t;
    const v = Number(game.input), ok = v === p.a;
    game.inputs.push({ v, t });
    if (ok) { game.combo++; game.correct++; game.best = Math.max(game.best, game.combo); game.score += mdPoints(game.combo); }
    else game.combo = 0;
    $('#md-score').textContent = game.score;
    const cb = $('#md-combo'); cb.textContent = game.combo >= 2 ? `${game.combo}連続！` : ''; cb.classList.toggle('hot', game.combo >= 10);
    const q = $('#md-q');
    q.classList.remove('ok', 'ng'); void q.offsetWidth; q.classList.add(ok ? 'ok' : 'ng');
    if (!ok) q.textContent = `${p.q} = ${p.a}`;
    game.input = ''; game.i++;
    timers.push(setTimeout(() => { if (game && game.phase === 'play') showQ(); }, ok ? 90 : 450));
  }
  async function finish() {
    if (!game || game.phase !== 'play') return;
    game.phase = 'done'; clearTimers(); window.scrollTo(0, 0);
    stage.innerHTML = `<div class="md-count"><b class="md-spin"></b><span>集計しています…</span></div>`;
    let r;
    try { r = await api('/games/math/finish', { method: 'POST', body: { runId: game.runId, inputs: game.inputs }, noAuthPrompt: true }); }
    catch (e) { return intro('記録できませんでした: ' + e.message); }
    const acc = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
    const rk = (x, label) => x ? `<div><span>${label}</span><b>${x.rank}位</b><small>ベスト ${x.best}点</small></div>` : '';
    stage.innerHTML = `<div class="md-result">
      ${r.newBest ? `<span class="chip chip-accent md-newbest">${icon('sparkle', 'ic-sm')}自己ベスト更新！</span>` : ''}
      <div class="md-final"><b>${r.score}</b><span>点</span></div>
      <div class="md-stats"><span>正解 <b>${r.correct}</b>問</span><span>正答率 <b>${acc}</b>%</span><span>最高 <b>${r.bestCombo}</b>連続</span></div>
      ${r.ranked ? `<div class="md-ranks">${rk(r.day, '今日')}${rk(r.week, '今週')}${rk(r.all, 'これまで')}</div>` : `<p class="md-note">${icon('lock', 'ic-sm')}練習モードの記録はランキングに載りません。<a href="#" id="md-login2">ログイン</a>して挑戦しよう。</p>`}
      <div class="md-actions">
        <button class="btn btn-primary btn-lg" type="button" id="md-again">${icon('repeat')}もう一度</button>
        ${r.ranked ? `<button class="btn btn-outline" type="button" id="md-share">${icon('send')}IppO でシェア</button>` : ''}
      </div>
    </div>`;
    $('#md-again').addEventListener('click', () => { intro(); start(); });
    $('#md-login2')?.addEventListener('click', (e) => { e.preventDefault(); openAuth(); });
    $('#md-share')?.addEventListener('click', () => openCompose({ prefill:
      `暗算ダッシュで ${r.score}点！ (正解${r.correct}問・最高${r.bestCombo}連続)\n今日のランキング ${r.day.rank}位\n#暗算ダッシュ` }));
    loadRank();
  }

  // ---------- ランキング ----------
  async function loadRank() {
    const el = $('#md-rank'); if (!el) return;
    let r;
    try { r = await api('/games/math/ranking?period=' + period, { noAuthPrompt: true }); }
    catch { el.innerHTML = '<p class="muted text-sm">読み込めませんでした</p>'; return; }
    if (!$('#md-rank')) return;
    const row = (x, mine) => `<a class="md-row${mine ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}" href="#/u/${esc(x.user.username)}">
        <span class="md-rk">${x.rank}</span>${avatar(x.user, 'sm')}
        <span class="md-who"><b>${esc(x.user.displayName)}${adminBadge(x.user)}</b><small>@${esc(x.user.username)} · 正解${Number(x.correct)} · 最高${Number(x.bestCombo)}連続</small></span>
        <span class="md-pts">${Number(x.score)}<small>点</small></span></a>`;
    const meIn = r.me && r.top.some((x) => x.user.id === r.me.user.id);
    el.innerHTML = r.top.length
      ? `<p class="md-players">${r.players}人が挑戦中</p><div class="md-list">${r.top.map((x) => row(x, me && x.user.id === me.id)).join('')}</div>${r.me && !meIn ? `<div class="md-list md-mine">${row(r.me, true)}</div>` : ''}`
      : `<p class="muted text-sm md-empty">${period === 'day' ? '今日' : period === 'week' ? '今週' : 'まだ'}だれも記録を出していません。一番乗りしよう！</p>`;
  }
  $$('[data-period]').forEach((b) => b.addEventListener('click', () => {
    period = b.dataset.period;
    $$('[data-period]').forEach((x) => x.classList.toggle('active', x === b));
    loadRank();
  }));
  intro(); loadRank();
}

// =====================================================================
// ぶんぼうぐバトラーズ: カードを集めて (ガチャ) 3 枚のデッキで対戦する
// 判定はすべてサーバー。端末は「選んだ行動」を送るだけ
// =====================================================================
let cbCatalogCache = null;
async function cbCatalog() { if (!cbCatalogCache) cbCatalogCache = await api('/cards/catalog', { noAuthPrompt: true }); return cbCatalogCache; }
const CB_RCOL = { N: '#8a94a6', R: '#2f8fd8', SR: '#a24ee0', SSR: '#e2a400', UR: '#e03131', MR: '#7048e8', LR: '#ff6bd6' };
function cbCard(c, { level = 0, locked = false, small = false, cls = '', attrs = '' } = {}) {
  const T = cbCatalogCache?.types || {};
  const skillName = c.skillName || cbCatalogCache?.cards.find((x) => x.id === c.id)?.skillName || '';
  const lvMul = level > 1 && cbCatalogCache && c.skillName && !c.horse && !c.monster ? 1 + cbCatalogCache.levelBonus * (Math.min(level, cbCatalogCache.maxLevel) - 1) : 1; // 図鑑のカードはレベル 1 の能力なので、レベルの分を足す
  const sv = (v) => Math.round(v * lvMul);
  if (locked) return `<div class="cb-card locked${small ? ' sm' : ''} ${cls}" ${attrs}><span class="cb-pic cb-silhouette">${CBArt.svg(c.id, 'N')}</span><b>？？？</b><span class="cb-meta">${esc(c.rarity)}</span></div>`;
  return `<div class="cb-card r-${esc(c.rarity)}${small ? ' sm' : ''} ${cls}" style="--rc:${CB_RCOL[c.rarity]}" ${attrs}>
    <span class="cb-rar">${esc(c.rarity)}</span>${level ? `<span class="cb-lv">Lv${Number(level)}</span>` : ''}
    ${(c.fes ?? cbCatalogCache?.cards?.find((x) => x.id === c.id)?.fes) && !c.horse && !c.monster ? '<span class="cb-fes" title="IppO祭の限定キャラ">🎊祭</span>' : ''}${c.horse ? '<span class="cb-horse" title="競走馬版から連れてきた馬">🐴</span>' : c.monster ? '<span class="cb-horse" title="ブリードモンスターズから連れてきたモンスター">🧬</span>' : ''}<span class="cb-pic">${CBArt.svg(c.id, c.rarity, { label: c.name, coat: c.coat })}</span><b>${esc(c.name)}</b>
    <span class="cb-meta">${esc(T[c.type]?.icon || '')}${esc(T[c.type]?.name || '')} · ${esc(skillName)}</span>
    ${small ? '' : `<span class="cb-stats"><i>HP ${sv(c.maxHp)}</i><i>攻 ${sv(c.atk)}</i><i>防 ${sv(c.def)}</i><i>速 ${Number(c.spd)}</i></span>`}
  </div>`;
}
// 自分のカード: ガチャ限定 SR を 3 枚引いて UR に昇格していたら、UR の姿と能力にする
function cbMine(c, mine) {
  if (mine?.lr?.includes(c.id) && c.lrStats) return { ...c, ...c.lrStats, rarity: 'LR', baseRarity: c.rarity, promoted: true };
  return mine?.ur?.includes(c.id) && c.urStats ? { ...c, ...c.urStats, rarity: 'UR', baseRarity: c.rarity, promoted: true } : c;
}
// LR まであと何枚か (高難易度クエストの報酬キャラは 25 枚・IppO祭の限定キャラは 15 枚)
function cbLrCounter(id, mine, cat) {
  if (!mine?.lrCount || !(id in mine.lrCount)) return '';
  const n = mine.lrCount[id], need = mine.lrNeed?.[id] || cat.cards?.find((x) => x.id === id)?.lrNeed || cat.lrPromote?.copies || 25, done = n >= need;
  return `<span class="cb-lrc${done ? ' done' : ''}"><span>${done ? '🌈 LR 昇格ずみ！' : `🌈 LR まで ${n}/${need}`}</span><i style="width:${Math.min(100, (n / need) * 100)}%"></i></span>`;
}
// カードを指 (マウス) でなぞると傾いて、ホロの光が動く
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let cur = null;
  const reset = (c) => { if (!c) return; c.classList.remove('tilting'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); c.style.removeProperty('--mx'); };
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest?.('.cb-card:not(.locked):not(.empty)');
    if (c !== cur) { reset(cur); cur = c; }
    if (!c) return;
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    c.classList.add('tilting');
    c.style.setProperty('--ry', `${(x - 0.5) * 18}deg`); c.style.setProperty('--rx', `${(0.5 - y) * 18}deg`); c.style.setProperty('--mx', `${x * 100}%`);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { reset(cur); cur = null; }, true);
  document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { reset(cur); cur = null; } }, { passive: true });
})();
// 新キャラ登場のバナー (登場から 7 日間。登場前のキャラはサーバーが送ってこないので、ここには出ない)
function cbNewBanner(cat, link = true) {
  const list = (cat.newCards || []).map((id) => cat.cards.find((c) => c.id === id)).filter(Boolean);
  // まとめて追加したキャラは 1 枚のバナーにまとめる (図鑑で全員見られる)
  const bulk = (cat.newBulk || []).map((g) => { const cs = g.ids.map((id) => cat.cards.find((c) => c.id === id)).filter(Boolean), top = cs.filter((c) => c.rarity === 'SSR');
    return `<a href="#/games/cards/collection" class="card cb-newchar cb-newbulk">
      <span class="cb-newbulk-arts">${top.slice(0, 5).map((c) => CBArt.svg(c.id, c.rarity, { label: c.name })).join('')}</span>
      <span class="cb-newchar-text"><span class="cb-newchar-tag">🎉 ${esc(g.name)}！</span><b>新キャラ ${cs.length} 体がガチャに登場</b>
        <span>R ${g.count.R} 体・SR ${g.count.SR} 体・SSR ${g.count.SSR} 体 (すべて恒常)。SSR: ${top.map((c) => esc(c.name)).join('・')}</span><small>図鑑で全員を見る ›</small></span></a>`; }).join('');
  if (!list.length) return bulk;
  return bulk + list.map((c) => `<${link ? 'a href="#/games/cards/gacha"' : 'div'} class="card cb-newchar">
      <span class="cb-newchar-art">${CBArt.svg(c.id, c.rarity, { label: c.name })}</span>
      <span class="cb-newchar-text"><span class="cb-newchar-tag">🆕 新キャラ登場！</span><b>${esc(c.name)}</b>
        ${(cat.pickups || []).some((x) => x.id === c.id) ? `<span class="cb-pickup">🎯 ピックアップ中！ 出る確率 <em>${Number((cat.pickups.find((x) => x.id === c.id).rate).toFixed(2))}%</em></span>` : ''}
        <span>${esc(c.rarity)} · ${esc(cat.types[c.type]?.icon || '')}${esc(cat.types[c.type]?.name || '')} · わざ「${esc(c.skillName)}」${esc(c.skillDesc)}${c.passiveName ? ` · パッシブ「${esc(c.passiveName)}」${esc(c.passiveDesc)}` : ''}</span></span>
    </${link ? 'a' : 'div'}>`).join('');
}
// 確率アップのお知らせ (開催中だけ)
function cbRateUpBanner(cat, link = true) {
  return (cat.rateUps || []).filter((x) => x.ids.length).map((x) => {
    const cards = x.ids.map((id) => cat.cards.find((c) => c.id === id)).filter(Boolean);
    const each = cat.perCard?.[x.ids[0]];
    const end = x.end ? new Date(x.end).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) + ' まで' : '開催中';
    return `<${link ? 'a href="#/games/cards/gacha"' : 'div'} class="card cb-rateup">
      <span class="cb-rateup-tag">🎉 ${esc(x.name)}</span>
      <span class="cb-rateup-arts">${cards.map((c) => `<span>${CBArt.svg(c.id, c.rarity, { label: c.name })}</span>`).join('')}</span>
      <b>${cards.map((c) => esc(c.name)).join('・')}</b>
      <span class="cb-rateup-text">の出る確率が <em>${x.mult}倍</em>！${each ? ` (1体 ${each.toFixed(2)}%)` : ''} · ${esc(end)}</span>
    </${link ? 'a' : 'div'}>`;
  }).join('');
}
// 期間限定クエストのバナー
function cbQuestBanner(q, cat) {
  const r = cat.cards.find((c) => c.id === q.reward);
  const end = new Date(q.end).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  return `<a class="card cb-questbn${q.cleared ? ' cleared' : ''}${q.hard ? ' hard' : ''}" href="#/games/cards/quest">
    <span class="cb-questbn-sky" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="cb-questbn-art">${r ? CBArt.svg(r.id, r.rarity, { label: r.name }) : ''}</span>
    <span class="cb-questbn-text"><span class="cb-questbn-tag">${q.hard ? `${esc(q.emoji || '⚡')} 高難易度クエスト` : '🌠 期間限定クエスト'}</span><b>${esc(q.name)}</b>
      <span>${q.cleared ? '✅ クリアずみ · もう一度あそべます' : `クリアで <em class="cb-mr-word">MR</em>「${esc(r?.name || '')}」がもらえる！`}</span><small>${esc(end)} まで</small></span>${icon('chevron', 'chev')}</a>`;
}
const cbCoins = (n) => `<span class="cb-coins">🪙 <b>${Number(n).toLocaleString()}</b></span>`;

async function viewCards() {
  cbCatalogCache = null;
  main.innerHTML = pageHead({ title: 'ぶんぼうぐバトラーズ', sub: 'カードを集めて、3枚のデッキで対戦', back: '#/games' }) + `<div class="content stack" id="cb">${loadingBlock()}</div>`;
  let cat, mine = null;
  try { cat = await cbCatalog(); if (me) mine = await api('/cards/me'); } catch (e) { $('#cb').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const C = Object.fromEntries([...cat.cards.map((c) => cbMine(c, mine)), ...(mine?.horses || []), ...(mine?.monsters || [])].map((c) => [c.id, c]));
  const root = $('#cb'); if (!root) return;
  root.innerHTML = `
    ${(mine?.quests || []).map((q) => cbQuestBanner(q, cat)).join('')}${cbRateUpBanner(cat)}${cbNewBanner(cat)}
    ${me ? `<section class="card card-pad cb-wallet">
      ${cbCoins(mine.coins)}
      <button class="btn ${mine.dailyReady ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" id="cb-daily" ${mine.dailyReady ? '' : 'disabled'}>${mine.dailyReady ? `🎁 今日のボーナス +${cat.dailyCoins}` : '今日のボーナスは受け取り済み'}</button>
      <a class="cb-scrolls" href="#/games/cards/collection" title="レベルアップ書 (タップでレベル上げへ)">📜 <b>${Number(mine.scrolls || 0)}</b></a>
      <span class="text-xs muted">対戦の報酬は今日あと ${Math.max(0, mine.rewardsLeft)} 回 (CPU 戦は回数制限なし)</span>
    </section>
    <section class="card card-pad">
      <div class="panel-head"><h3>${icon('users', 'ic-sm')}デッキ</h3><span><a class="btn btn-ghost btn-sm" href="#/games/cards/usage">📊 採用率</a><a class="btn btn-ghost btn-sm" href="#/games/cards/collection">デッキを変える</a></span></div>
      <div class="cb-deck">${mine.deck.map((id) => C[id] ? cbCard(C[id], { level: C[id].horse || C[id].monster ? C[id].level : Math.min(mine.owned[id] || 1, cat.maxLevel) }) : '').join('')}</div>
    </section>
    <section class="card card-pad">
      <div class="panel-head"><h3>${icon('sparkle', 'ic-sm')}対戦</h3><span class="text-xs muted">レート ${mine.rating} · ${mine.wins}勝${mine.losses}敗${mine.draws ? mine.draws + '分' : ''}</span></div>
      <div class="cb-modes">
        <a class="btn btn-primary btn-lg" href="#/games/cards/battle?mode=random">${icon('globe')}ランダム対戦<small>レート戦 · 勝ち +${cat.reward.random.win}🪙</small></a>
        <div class="cb-cpu-pick"><a class="btn btn-outline cb-easy-btn" href="#/games/cards/battle?mode=easy">🐣 CPU (かんたん)<small>SR までのキャラ · 勝ち +${cat.reward.easy?.win ?? 20}🪙</small></a>
          <a class="btn btn-outline" href="#/games/cards/battle?mode=cpu">🤖 CPU (ふつう)<small>勝ち +${cat.reward.cpu.win}🪙 · 回数制限なし</small></a>
          <a class="btn cb-oni-btn" href="#/games/cards/oni">👹 CPU (鬼難)<small>勝ち +${cat.reward.oni?.win ?? 40}🪙 · ガチで強い</small></a></div>
        <a class="btn cb-board-btn" href="#/games/cards/board">📋 レート戦 募集掲示板<small>相手をえらんでレート戦 · 勝ち +${cat.reward.random.win}🪙</small></a>
        <a class="btn btn-outline" href="#/games/cards/battle?mode=room-create">${icon('user-plus')}部屋を作って友だちと<small>部屋コードを教えて対戦</small></a>
        <form class="cb-join" id="cb-join"><input class="input" name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="部屋コード (4けた)" required><button class="btn btn-outline" type="submit">入る</button></form>
      </div>
    </section>
    <section class="card cb-horse-banner">
      <span class="cb-gacha-art" aria-hidden="true">${CBArt.svg('h:x', 'SSR', { coat: '栗毛' })}</span>
      <span><b>競走馬版から馬を連れてくる</b><span>1日${mine.horsesPerDay || 3}頭まで (今日はあと <b>${mine.horseLeft ?? 0}</b> 頭)。わざ・相性・能力は SSR くらいの強さでランダム。まれに <b class="cb-ur-word">UR</b> に昇格！ (連れてきた馬 ${mine.horses.length}頭)</span></span>
      <button class="btn ${mine.horseReady ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" id="cb-horse" ${mine.horseReady ? '' : 'disabled'}>${mine.horseReady ? `🐴 連れてくる (あと${mine.horseLeft})` : '今日はもう連れてきた'}</button>
    </section>
    <section class="card cb-horse-banner cb-mon-banner">
      <span class="cb-gacha-art" aria-hidden="true">${CBArt.svg('m:x', 'SR')}</span>
      <span><b>ブリードモンスターズからモンスターを連れてくる</b><span>育てたモンスターがカードになります。評価でレア度が決まり (B→R・A→SR・S/SS→SSR・Z→<b>MR</b>)、<b>能力は育てたぶんだけ強く (上限なし)</b>。突然変異 R 以上は<b>限定級</b>の強さ！ (連れてきたモンスター ${(mine.monsters || []).length}体)</span></span>
      <button class="btn btn-primary btn-sm" type="button" id="cb-monster">🧬 連れてくる</button>
    </section>
    <a class="card cb-gacha-banner" href="#/games/cards/gacha"><span class="cb-gacha-art" aria-hidden="true">${CBArt.svg('case', 'SSR')}</span>
      <span><b>ガチャを引く</b>${cat.sale ? `<span class="cb-sale-tag">🔥 ${esc(cat.sale.name)}</span>` : ''}<span>1回 ${cat.sale ? `<s>${cat.sale.pull}</s> ` : ''}${cat.pullCost}🪙 · 10回 ${cat.sale ? `<s>${cat.sale.ten}</s> ` : ''}${cat.tenCost}🪙 (SR以上1枚確定) · ${cat.pity}回でSSR確定</span></span>${icon('chevron', 'chev')}</a>`
    : `<section class="card card-pad cb-guest"><p>24種類の文房具のキャラクターを集めて、3枚のデッキで対戦するカードゲームです。<b>ログインすると、すぐにコインとはじめのカードがもらえます。</b></p>
      <button class="btn btn-primary" type="button" id="cb-login">ログインして遊ぶ</button>
      <div class="cb-grid">${cat.cards.slice(0, 6).map((c) => cbCard(c, { small: true })).join('')}</div></section>`}
    <section class="card card-pad">
      <div class="panel-head"><h3>${icon('trend', 'ic-sm')}レート ランキング</h3><span class="text-xs muted">ランダム対戦の成績</span></div>
      <div id="cb-rank">${loadingBlock()}</div>
    </section>
    <section class="card card-pad cb-rules"><details><summary>${icon('sparkle', 'ic-sm')}あそびかた</summary><ul>
      <li>おたがいに、毎ターン同時に行動を選びます: <b>こうげき</b> / <b>ガード</b> (ダメージ 6 割減) / <b>わざ</b> (使うと 2 ターン休み) / <b>こうたい</b></li>
      <li>相性: ${Object.entries(cat.beats).map(([a, b]) => `${esc(cat.types[a].icon)}${esc(cat.types[a].name)} は ${esc(cat.types[b].icon)}${esc(cat.types[b].name)} に強い (1.5 倍)`).join('、')}</li>
      <li>素早いカードから先に動きます。相手の 3 枚をすべてたおすと勝ち。30 ターンたったら残り HP の多いほうの勝ち</li>
      <li>レア度が高いほど、レベルが上がるほど強くなります (R +${cat.rarityBonus.R}% / SR +${cat.rarityBonus.SR}% / SSR +${cat.rarityBonus.SSR}%、レベル 1 つにつき +${Math.round(cat.levelBonus * 100)}%)。相性と作戦しだいで逆転もできます</li>
      <li>コインはお金では買えません。毎日のボーナスと対戦でもらえます</li></ul></details></section>`;
  $('#cb-login')?.addEventListener('click', () => openAuth());
  $('#cb-horse')?.addEventListener('click', () => cbBringHorse(() => viewCards()));
  $('#cb-monster')?.addEventListener('click', () => cbBringMonster(() => viewCards()));
  $('#cb-daily')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('/cards/daily', { method: 'POST' }); toast(`🎁 ${r.got} コインを受け取りました`, 'success'); viewCards(); } catch (err) { toast(err.message, 'error'); }
  });
  $('#cb-join')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/games/cards/battle?mode=room-join&code=' + encodeURIComponent(e.target.code.value.trim()); });
  try {
    const r = await api('/cards/ranking', { noAuthPrompt: true });
    const row = (x, mine) => `<a class="md-row${mine ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}" href="#/u/${esc(x.user.username)}"><span class="md-rk">${x.rank}</span>${avatar(x.user, 'sm')}
      <span class="md-who"><b>${esc(x.user.displayName)}${adminBadge(x.user)}</b><small>@${esc(x.user.username)} · ${Number(x.wins)}勝${Number(x.losses)}敗</small></span><span class="md-pts">${Number(x.rating)}</span></a>`;
    const meIn = r.me && r.top.some((x) => x.user.id === r.me.user.id);
    const el = $('#cb-rank'); if (!el) return;
    el.innerHTML = r.top.length ? `<div class="md-list">${r.top.map((x) => row(x, me && x.user.id === me.id)).join('')}</div>${r.me && !meIn ? `<div class="md-list md-mine">${row(r.me, true)}</div>` : ''}`
      : '<p class="muted text-sm md-empty">まだだれもランダム対戦をしていません。</p>';
  } catch { const el = $('#cb-rank'); if (el) el.innerHTML = '<p class="muted text-sm">読み込めませんでした</p>'; }
}

// ---------- ブリードモンスターズからモンスターを連れてくる (1 体 1 枚。連れてきたあとも「最新の強さにする」で写し直せる) ----------
async function cbBringMonster(done) {
  let r;
  try { r = await api('/cards/monster-candidates'); } catch (e) { return toast(e.message, 'error'); }
  if (!r.monsters.length) return openPanel('モンスターを連れてくる', `<div class="form-stack"><p>連れてこられるモンスターがいません。「ブリードモンスターズ」で育てたモンスターが、カードになって連れてこられます。</p>
    <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>閉じる</button><a class="btn btn-primary" href="#/monster">ブリードモンスターズへ</a></div></div>`);
  const T = cbCatalogCache?.types || {};
  openPanel('どのモンスターを連れてくる？', `<div class="form-stack"><p class="text-sm" style="color:var(--text-2)">モンスターの<b>評価でレア度</b>、<b>属性で相性とわざ</b>が決まります (🔥火・✨光 → ✂️きる / 🌿草・🌑闇 → 📄つつむ / 💧水・👑王 → 🪨おもい)。<b>能力はモンスターの能力に比例 (上限なし)</b>: はじめのモンスターで R くらい、育てるほど強くなります。<b>突然変異 R 以上</b>のモンスターは<b>限定級</b> (限定キャラの平均より弱くならず、倍率も限定キャラと同じ ×1.2)。<br>連れてきたあとにモンスターを育てたら、<b>「最新の強さにする」</b>で写し直せます (カードのレベルはそのまま)。</p>
      <div class="cb-pick-horse">${r.monsters.map((m) => `<button type="button" class="list-item" data-mid="${esc(m.id)}"><span class="cb-mini-art cb-mon-mini">${m.cardId ? CBArt.svg(m.cardId, 'N') : CBArt.svg('m:x', 'N')}</span>
        <div class="grow"><div class="title">${esc(m.name)}</div><div class="desc">評価 ${esc(m.rank)} → <b>${esc(m.rarity)}</b>${m.limited ? ` · <b class="cb-lim-word">🧬変異${esc(m.mutant)} → 限定級</b>` : ''} · ${esc(T[m.cardType]?.icon || '')}${esc(T[m.cardType]?.name || '')} · わざ「${esc(m.skillName)}」</div></div>
        <span class="cb-rbadge" style="--rc:${CB_RCOL[m.rarity] || '#888'}">${m.have ? '最新の強さにする' : esc(m.rarity)}</span></button>`).join('')}</div>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>やめる</button></div></div>`, (root, close) => {
    $$('[data-mid]', root).forEach((b) => b.addEventListener('click', async () => {
      $$('[data-mid]', root).forEach((x) => { x.disabled = true; });
      try {
        const res = await api('/cards/monster', { method: 'POST', body: { monster: b.dataset.mid } });
        const c = res.card, up = c.rarity === 'MR';
        root.innerHTML = `<div class="cb-horse-reveal${up ? ' promoted' : ''}">${up ? '<p class="cb-ur-shout">🌈 MR のモンスター！！ 🌈</p>' : ''}<div class="cb-flip open r-${esc(c.rarity)}">${cbCard(c, { level: c.level, cls: 'tilt' })}</div>
          <p><b>${esc(c.name)}</b> が${res.updated ? '最新の強さになった！' : 'カードになって仲間になった！'}</p>
          <p class="text-sm" style="color:var(--text-2)">${esc(T[c.type]?.icon || '')}${esc(T[c.type]?.name || '')} · わざ「${esc(c.skillName)}」 (${esc(c.skillDesc)})</p>
          <div class="modal-actions" style="margin-top:0"><a class="btn btn-outline" href="#/games/cards/collection">デッキに入れる</a><button class="btn btn-primary" type="button" data-close>OK</button></div></div>`;
        $$('[data-close]', root).forEach((x) => x.addEventListener('click', () => close()));
        cbConfetti(root, up ? 120 : 50, up ? ['#ffd43b', '#ff6b6b', '#fff3bf', '#fab005', '#e8590c', '#fff'] : undefined);
        done && setTimeout(done, 50);
      } catch (e) { toast(e.message, 'error'); close(); }
    }));
  });
}

// ---------- 競走馬版から馬を連れてくる (1 日 3 頭) ----------
async function cbBringHorse(done) {
  let r;
  try { r = await api('/cards/horse-candidates'); } catch (e) { return toast(e.message, 'error'); }
  if (!r.ready) return toast(`今日はもう ${r.perDay || 3} 頭連れてきました。また明日！`);
  if (!r.horses.length) return openPanel('馬を連れてくる', `<div class="form-stack"><p>連れてこられる馬がいません。IppO にログインしたまま「117万分の1 競走馬版」で生まれた馬が、連れてこられます (同じ馬は 1 回だけ)。</p>
    <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>閉じる</button><a class="btn btn-primary" href="#/horse">馬を生みに行く</a></div></div>`);
  const LC = { UR: '#c2255c', SSR: '#e67700', SR: '#1971c2', R: '#2b8a3e', N: '#868e96' };
  openPanel('どの馬を連れてくる？', `<div class="form-stack"><p class="text-sm" style="color:var(--text-2)">1日${r.perDay || 3}頭まで (今日はあと <b>${r.left}</b> 頭)。<b>わざ・相性・能力は、連れてきたときにランダムで決まります</b> (SSR くらいの強さ)。<br>まれに <b class="cb-ur-word">UR</b> (能力 +${cbCatalogCache?.urBonus ?? 20}%) に昇格します。<b>競走馬版でのランクが高い馬ほど、昇格しやすい</b>です。</p>
      <div class="cb-pick-horse">${r.horses.map((h) => `<button type="button" class="list-item" data-sid="${esc(h.sid)}"><span class="cb-mini-art">${CBArt.svg('h:x', 'N', { coat: h.coat })}</span>
        <div class="grow"><div class="title">${esc(h.name)}</div><div class="desc">${esc(h.coat || '')} · ${esc(h.headline)} · UR 昇格 ${Math.round(h.urChance * 100)}%</div></div><span class="rc-badge" style="position:static;--c:${LC[h.label] || '#868e96'}">${esc(h.label)}</span></button>`).join('')}</div>
      <div class="modal-actions" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>やめる</button></div></div>`, (root, close) => {
    $$('[data-sid]', root).forEach((b) => b.addEventListener('click', async () => {
      $$('[data-sid]', root).forEach((x) => { x.disabled = true; });
      try {
        const res = await api('/cards/horse', { method: 'POST', body: { sid: b.dataset.sid } });
        const c = res.card, T = cbCatalogCache?.types || {};
        root.innerHTML = `<div class="cb-horse-reveal${res.promoted ? ' promoted' : ''}">${res.promoted ? '<p class="cb-ur-shout">✨ UR に昇格！！ ✨</p>' : ''}<div class="cb-flip open r-${esc(c.rarity)}">${cbCard(c, { cls: 'tilt' })}</div>
          <p><b>${esc(c.name)}</b> が仲間になった！</p>
          <p class="text-sm" style="color:var(--text-2)">${esc(T[c.type]?.icon || '')}${esc(T[c.type]?.name || '')} · わざ「${esc(c.skillName)}」 (${esc(c.skillDesc)})</p>
          <div class="modal-actions" style="margin-top:0"><a class="btn btn-outline" href="#/games/cards/collection">デッキに入れる</a><button class="btn btn-primary" type="button" data-close>OK</button></div></div>`;
        $$('[data-close]', root).forEach((x) => x.addEventListener('click', () => close()));
        cbConfetti(root, res.promoted ? 120 : 50, res.promoted ? ['#ffd43b', '#ff6b6b', '#fff3bf', '#fab005', '#e8590c', '#fff'] : undefined);
        done && setTimeout(done, 50);
      } catch (e) { toast(e.message, 'error'); close(); }
    }));
  });
}

// ---------- ガチャ ----------
// 演出: カプセルがゆれる → 出たいちばん高いレア度の色で光る (SSR は虹の光線) → 1 枚ずつめくれる。タップでとばせる
function cbConfetti(host, n = 40, colors = ['#ffd43b', '#ff6b9d', '#74c0fc', '#8ce99a', '#b197fc', '#fff']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'cb-confetti';
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.cssText = `--x:${(Math.random() * 2 - 1) * 180}px;--y:${-120 - Math.random() * 160}px;--r:${Math.random() * 720 - 360}deg;--c:${colors[i % colors.length]};--d:${Math.random() * 0.25}s;left:${45 + Math.random() * 10}%`;
    box.append(p);
  }
  host.append(box); setTimeout(() => box.remove(), 1800);
}
// ハサミ丸の登場演出 (R のカプセルが開いたところから):
//   暗転して R のカードを 2 秒見せる → 緑の斬撃で R のカードを切り裂く → R のカプセルが SSR のカプセルに変わる → カプセルからハサミ丸が飛び出す (タップでとばせる)
const HASAMI_CUT_MS = 6000;
function cbHasamiCut(cat) {
  if (document.querySelector('.hs-cut')) return;
  const rs = cat.cards.filter((c) => c.rarity === 'R'), decoy = rs[Math.floor(Math.random() * rs.length)] || cat.cards[0];
  const hasami = cat.cards.find((c) => c.id === 'scissors');
  const ov = document.createElement('div'); ov.className = 'hs-cut'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '疾風剣士ハサミ丸 登場');
  ov.innerHTML = `<div class="hs-rays"></div>
    <div class="hs-cap"><i class="hs-cap-top"></i><i class="hs-cap-bot"></i><i class="hs-cap-glow"></i></div>
    <div class="hs-decoy"><div class="hs-half a">${cbCard(decoy)}</div><div class="hs-half b">${cbCard(decoy)}</div></div>
    <div class="hs-slash"><i></i><i></i><i></i></div><div class="hs-flash"></div>
    <div class="hs-hero"><div class="hs-card">${hasami ? cbCard(hasami, { cls: 'tilt' }) : ''}</div>
      <p class="hs-title"><span>疾風剣士</span>ハサミ丸 参上！！</p></div>
    <p class="hs-skip">タップでとばす</p>`;
  document.body.append(ov);
  const timers = [], step = (ms, fn) => timers.push(setTimeout(fn, ms));
  const close = () => { timers.forEach(clearTimeout); ov.classList.add('out'); setTimeout(() => ov.remove(), 300); };
  step(2000, () => ov.classList.add('cut'));                                  // 暗転から 2 秒: 切り裂く
  step(2550, () => ov.classList.add('ssr'));                                  // カプセルが SSR に変わる
  step(3700, () => { ov.classList.add('hero'); cbConfetti(ov.querySelector('.hs-hero'), 110, ['#38d9a9', '#12b886', '#c3fae8', '#ffe066', '#fff', '#ff6bd6', '#74c0fc']); }); // ハサミ丸が飛び出す
  step(HASAMI_CUT_MS - 250, close);
  ov.addEventListener('click', close);
}
async function viewGacha() {
  if (!requireLogin()) return;
  cbCatalogCache = null; // 値段 (セール) が変わっているかもしれないので取り直す
  main.innerHTML = pageHead({ title: 'ガチャ', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbg">${loadingBlock()}</div>`;
  let cat, mine, timers = [];
  try { cat = await cbCatalog(); mine = await api('/cards/me'); } catch (e) { $('#cbg').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  viewCleanup = () => timers.forEach(clearTimeout);
  const RANK = { N: 0, R: 1, SR: 2, SSR: 3, UR: 3 };
  const render = (results = null) => {
    const root = $('#cbg'); if (!root) return;
    timers.forEach(clearTimeout); timers = [];
    const hasami = !!results && results.some((c) => c.id === 'scissors');   // ハサミ丸が出た: カプセルの光は R のふりをして、あとで切り裂いて登場
    const best = results ? results.map((c) => (c.id === 'scissors' ? 'R' : c.baseRarity || c.rarity)).reduce((a, r) => (RANK[r] > RANK[a] ? r : a), 'N') : null;
    const price = mine.prices || { pull: cat.pullCost, ten: cat.tenCost, sale: cat.sale };
    const saleEnd = price.sale ? new Date(price.sale.end).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '';
    root.innerHTML = `${results ? '' : cbRateUpBanner(cat, false) + cbNewBanner(cat, false)}${price.sale ? `<div class="card cb-sale"><b>🔥 ${esc(price.sale.name)}</b><span>ガチャが 1回 <s>${price.sale.pull}</s> → <em>${price.pull}</em>🪙 · 10回 <s>${price.sale.ten}</s> → <em>${price.ten}</em>🪙</span><small>${esc(saleEnd)} まで</small></div>` : ''}<section class="card card-pad cb-gacha">
        <div class="cb-gacha-top">${cbCoins(mine.coins)}<span class="text-sm muted">SSR 確定まであと <b>${cat.pity - mine.pity}</b> 回</span></div>
        <div class="cb-stage${results ? ' rolling best-' + best : ''}" id="cb-stage">
          ${results ? `<div class="cb-capsule"><i></i><b></b></div><div class="cb-burst"></div><div class="cb-shout">${best === 'SSR' ? 'SSR！！' : best === 'SR' ? 'SR！' : ''}</div>
            <div class="cb-reveal">${results.map((c) => `<div class="cb-flip r-${esc(c.baseRarity || c.rarity)}"><div class="cb-flip-in"><div class="cb-back"><span>✦</span></div>
              <div class="cb-front">${cbCard(c, { level: c.level, small: true, cls: 'tilt' })}${c.converted ? `<span class="cb-new conv">📜×${c.converted}</span>` : c.lrUp ? '<span class="cb-new lr">LR 昇格！</span>' : c.urUp ? '<span class="cb-new ur">UR 昇格！</span>' : c.isNew ? '<span class="cb-new">NEW</span>' : c.levelUp ? '<span class="cb-new up">Lv UP</span>' : ''}</div></div></div>`).join('')}</div>
            ${results.some((c) => c.converted) ? `<p class="cb-conv-note">📜 昇格しきったカードのダブり ${results.filter((c) => c.converted).length} 枚を、レベルアップ書 <b>${results.reduce((s, c) => s + (c.converted || 0), 0)}</b> 冊に変換しました</p>` : ''}
            ${results.some((c) => c.lrUp) ? `<p class="cb-lr-shout cb-gacha-ur">🌈 ${results.filter((c) => c.lrUp).map((c) => esc(c.name)).join('・')} が LR に昇格！！ 🌈</p>` : ''}
            ${results.some((c) => c.urUp) ? `<p class="cb-ur-shout cb-gacha-ur">✨ ${results.filter((c) => c.urUp).map((c) => esc(c.name)).join('・')} が UR に昇格！！ ✨</p>` : ''}
            <p class="cb-skip">タップでとばす</p>`
          : `<div class="cb-machine">${CBArt.svg('case', 'SSR')}<p>きょうは何が出るかな？</p></div>`}
        </div>
        <div class="cb-gacha-btns">
          <button class="btn btn-outline btn-lg" type="button" data-n="1" ${mine.coins < price.pull ? 'disabled' : ''}>1回<small>${price.sale ? `<s>${price.sale.pull}</s> ` : ''}${price.pull}🪙</small></button>
          <button class="btn btn-primary btn-lg cb-ten" type="button" data-n="10" ${mine.coins < price.ten ? 'disabled' : ''}>10回<small>${price.sale ? `<s>${price.sale.ten}</s> ` : ''}${price.ten}🪙 · SR以上1枚確定</small></button>
        </div>
        ${mine.coins < price.pull ? `<p class="text-sm muted" style="text-align:center">コインが足りません。毎日のボーナスや対戦でもらえます。</p>` : ''}
      </section>
      <section class="card card-pad"><div class="panel-head"><h3>提供割合</h3></div>
        <div class="cb-rates">${Object.entries(cat.rates).reverse().map(([r, v]) => { const list = cat.cards.filter((c) => c.rarity === r), pick = list.filter((c) => (cat.pickups || []).some((x) => x.id === c.id)), up = list.filter((c) => !pick.includes(c) && (cat.rateUps || []).some((x) => x.ids.includes(c.id))), normal = list.filter((c) => !up.includes(c) && !pick.includes(c));
          const parts = [...pick.map((c) => `ピックアップ ${esc(c.name)} ${cat.perCard[c.id].toFixed(2)}%`), up.length ? `確率アップ 1体 ${cat.perCard[up[0].id].toFixed(2)}%` : '', normal.length && (pick.length || up.length) ? `ほか 1体 ${cat.perCard[normal[0].id].toFixed(2)}%` : ''].filter(Boolean);
          return `<div><span class="cb-rbadge" style="--rc:${CB_RCOL[r]}">${r}</span><b>${Number(v.toFixed(2))}%</b><small>${list.length}種類 · ${parts.length ? parts.join(' / ') : `1種類あたり ${(v / list.length).toFixed(2)}%`}</small></div>`; }).join('')}</div>
        <ul class="text-xs muted cb-notes"><li>${cat.pity}回引いて SSR が出なかったら、${cat.pity}回目は SSR が確定します (回数は SSR が出ると 0 にもどる)</li>
          <li>同じカードが出るとレベルが上がり、強くなります (レベル 1 つにつき +${Math.round(cat.levelBonus * 100)}%、同じカードで上がるのは Lv${cat.dupMaxLevel || 15} まで。Lv${cat.maxLevel} まではレベルアップ書で)</li>
          <li>レア度が高いほど強い: R +${cat.rarityBonus.R}% / SR +${cat.rarityBonus.SR}% / SSR +${cat.rarityBonus.SSR}% / UR +${cat.urBonus}%</li>
          <li>ガチャ限定の ${esc(cat.urPromote?.from || 'SSR')} は、同じカードを ${cat.urPromote?.copies || 3} 枚引くと UR に昇格します (UR はガチャからは直接出ません)。UR になったあとに同じカードが出たら、レベルアップ書 ${cat.urDupScrolls || 50} 冊に変換されます</li>
          ${cat.fesLr?.ids?.length ? `<li>🎊 IppO祭の限定キャラ (${cat.fesLr.ids.map((id) => esc(cat.cards.find((x) => x.id === id)?.name || id)).join('・')}) は、同じカードを <b>${cat.fesLr.copies} 枚</b>集めると <b class="cb-lr-word">LR</b> に昇格 (能力 +${cat.lrPromote?.bonus || 35}%)。UR のあとのダブりも LR までは枚数に数え、LR のあとのダブりがレベルアップ書になります</li>` : ''}
          ${(cat.pickups || []).map((x) => `<li>${esc(x.name)}: ${esc(cat.cards.find((c) => c.id === x.id)?.name || '')} 1体の出る確率が ${x.rate}%。ほかのキャラは元の確率のままで、ふえた分だけ ほかのレア度の確率が少し下がります</li>`).join('')}
          ${(cat.rateUps || []).map((x) => `<li>${esc(x.name)}: ${x.ids.map((id) => esc(cat.cards.find((c) => c.id === id)?.name || '')).join('・')} の出る確率が ${x.mult} 倍。上がった分、ほかのレア度の確率が少し下がります</li>`).join('')}
          <li>コインはお金では買えません</li></ul></section>`;
    $$('[data-n]', root).forEach((b) => b.addEventListener('click', async () => {
      $$('[data-n]', root).forEach((x) => { x.disabled = true; });
      try { const r = await api('/cards/gacha', { method: 'POST', body: { n: Number(b.dataset.n) } }); mine = r; render(r.results); }
      catch (e) { toast(e.message, 'error'); render(); }
    }));
    if (!results) return;
    // ---- 演出 ----
    const stage = $('#cb-stage'), flips = $$('.cb-flip', stage);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const at = (ms, fn) => timers.push(setTimeout(fn, reduced ? 0 : ms));
    let done = false;
    const finish = () => {
      if (done) return; done = true; timers.forEach(clearTimeout); timers = [];
      stage.classList.remove('rolling'); stage.classList.add('opened', 'shown');
      flips.forEach((f) => f.classList.add('open'));
      if (best === 'SSR' || best === 'SR') cbConfetti(stage, best === 'SSR' ? 70 : 36, best === 'SSR' ? undefined : ['#b197fc', '#e5dbff', '#fff', '#ffd43b']);
      if (results.some((c) => c.lrUp)) cbConfetti(stage, 160, ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2', '#fff']);
      if (results.some((c) => c.urUp)) cbConfetti(stage, 120, ['#ffd43b', '#ff6b6b', '#fff3bf', '#fab005', '#e8590c', '#fff']);
    };
    at(900, () => stage.classList.add('burst'));                       // 光る
    at(1350, () => { stage.classList.remove('rolling'); stage.classList.add('opened'); });
    let t = 1500;
    if (hasami && !reduced) { at(1360, () => cbHasamiCut(cat)); t += HASAMI_CUT_MS; } // R のカプセルが開いたら: 暗転 → R のカード (2 秒) → 切り裂く → SSR のカプセル → ハサミ丸
    flips.forEach((f) => {
      const big = f.classList.contains('r-SSR') || f.classList.contains('r-SR');
      if (big) t += 260;                                                  // SR 以上は少しためてからめくる
      at(t, () => { f.classList.add('open'); if (big) cbConfetti(f, f.classList.contains('r-SSR') ? 46 : 22); });
      t += big ? 420 : 150;
    });
    at(t + 200, () => { done = true; stage.classList.add('shown'); });
    stage.addEventListener('click', finish);
  };
  render();
}

// ---------- 図鑑とデッキ ----------
async function viewCollection() {
  if (!requireLogin()) return;
  main.innerHTML = pageHead({ title: 'カード図鑑・デッキ', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbc">${loadingBlock()}</div>`;
  let cat, mine, mode = 'deck';
  try { cat = await cbCatalog(); mine = await api('/cards/me'); } catch (e) { $('#cbc').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  let deck = [...mine.deck];
  const lvOf = (c) => (c.horse || c.monster ? c.level : Math.min(mine.owned[c.id] || 1, cat.maxLevel));
  const render = () => {
    const C = Object.fromEntries([...cat.cards.map((c) => cbMine(c, mine)), ...mine.horses, ...(mine.monsters || [])].map((c) => [c.id, c]));
    const root = $('#cbc'); if (!root) return;
    const have = cat.cards.filter((c) => mine.owned[c.id]).length;
    const pickCls = (c) => 'pick' + (mode === 'deck' && deck.includes(c.id) ? ' chosen' : '') + (mode === 'level' ? (lvOf(c) >= cat.maxLevel ? ' maxed' : costOf(lvOf(c)) <= mine.scrolls ? ' can-lv' : '') : '');
    root.innerHTML = `<div class="segmented cb-mode" role="tablist">
        <button type="button" class="seg${mode === 'deck' ? ' active' : ''}" data-mode="deck">デッキ編成</button>
        <button type="button" class="seg${mode === 'level' ? ' active' : ''}" data-mode="level">📜 レベル上げ</button></div>
      ${mode === 'deck' ? `<section class="card card-pad cb-deckedit">
        <div class="panel-head"><h3>デッキ (${deck.length}/3)</h3><button class="btn btn-primary btn-sm" type="button" id="cb-save" ${deck.length === 3 && deck.join() !== mine.deck.join() ? '' : 'disabled'}>保存</button></div>
        <p class="text-xs muted">下のカードをタップして、3枚えらんでください (タップした順に先に出ます)。</p>
        <div class="cb-deck">${[0, 1, 2].map((i) => deck[i] && C[deck[i]] ? cbCard(C[deck[i]], { small: true, level: lvOf(C[deck[i]]), attrs: `data-slot="${i}"`, cls: 'pick' }) : `<div class="cb-card empty sm">${i + 1}枚目</div>`).join('')}</div>
      </section>`
      : `<section class="card card-pad cb-scrollbox"><div class="cb-scroll-have">📜 レベルアップ書 <b>${mine.scrolls}</b> 枚</div>
        <p class="text-xs muted">レベルを上げたいカードをタップ (何レベルかまとめて上げられます)。Lv1→2 は 1 枚、Lv2→3 は 2 枚… (今のレベルと同じ枚数)。<b>Lv${cat.dupMaxLevel || 15} → ${cat.maxLevel} は 1 つにつき ${cat.highLevelCost || 50} 枚</b> (同じカードを引いても Lv${cat.dupMaxLevel || 15} より上には上がりません)。<br>レベルアップ書は試合をするともらえます (${cat.scrollMinTurns} ターン以上戦った試合で、勝ち ${cat.scrollReward.win} 枚・負け ${cat.scrollReward.lose} 枚)。</p></section>`}
      <section class="card card-pad"><div class="panel-head"><h3>🧬 連れてきたモンスター</h3><span class="text-xs muted">${(mine.monsters || []).length}体</span></div>
        ${(mine.monsters || []).length ? `<div class="cb-grid">${mine.monsters.map((c) => cbCard(c, { level: c.level, cls: pickCls(c), attrs: `data-card="${esc(c.id)}" title="${esc(c.skillName)}: ${esc(c.skillDesc)} · 評価 ${esc(c.monRank)}"` })).join('')}</div>`
          : `<p class="text-sm muted" style="margin:8px 0 0">ブリードモンスターズで育てたモンスターを、カードにして連れてこられます (ホームの「連れてくる」から)。</p>`}</section>
      <section class="card card-pad"><div class="panel-head"><h3>🐴 連れてきた馬</h3><span class="text-xs muted">${mine.horses.length}頭</span></div>
        ${mine.horses.length ? `<div class="cb-grid">${mine.horses.map((c) => cbCard(c, { level: c.level, cls: pickCls(c), attrs: `data-card="${esc(c.id)}" title="${esc(c.skillName)}: ${esc(c.skillDesc)} · ${esc(c.origin)}"` })).join('')}</div>`
          : `<p class="text-sm muted" style="margin:8px 0 0">競走馬版の馬を、1日${mine.horsesPerDay || 3}頭まで連れてこられます (ホームの「連れてくる」から)。</p>`}</section>
      <section class="card card-pad"><div class="panel-head"><h3>図鑑</h3><span class="text-xs muted">${have} / ${cat.cards.length} 種類</span></div>
        <p class="text-xs muted" style="margin:4px 0 8px">ガチャ限定の <b>${esc(cat.urPromote?.from || 'SSR')}</b> は、同じカードを <b>${cat.urPromote?.copies || 3} 枚</b>引くと <b class="cb-ur-word">UR</b> に昇格！ (能力 +${cat.urBonus}%)。UR のあとのダブりは 📜 レベルアップ書 ${cat.urDupScrolls || 50} 冊に変換</p>
        ${cat.fesLr?.ids?.length ? `<p class="text-xs muted" style="margin:0 0 8px">🎊 <b>IppO祭の限定キャラ</b> (${cat.fesLr.ids.map((id) => esc(cat.cards.find((x) => x.id === id)?.name || id)).join('・')}) は、同じカードを <b>${cat.fesLr.copies} 枚</b>集めると <b class="cb-lr-word">LR</b> に昇格！ (能力 +${cat.lrPromote?.bonus || 35}%)</p>` : ''}
        <p class="text-xs muted" style="margin:0 0 8px">高難易度クエストの報酬キャラは、クエストに勝つたびに 1 枚もらえて、<b>${cat.lrPromote?.copies || 25} 枚</b>で <b class="cb-lr-word">LR</b> に昇格！ (能力 +${cat.lrPromote?.bonus || 35}%)</p>
        <div class="cb-grid">${cat.cards.map((c) => (mine.owned[c.id]
          ? cbCard(C[c.id], { level: lvOf(c), cls: pickCls(c), attrs: `data-card="${esc(c.id)}" title="${esc(c.skillName)}: ${esc(c.skillDesc)}${c.passiveName ? ` / パッシブ ${esc(c.passiveName)}: ${esc(c.passiveDesc)}` : ''}"` })
          : cbCard(c, { locked: true, attrs: c.questOnly ? 'title="期間限定クエストのクリア報酬"' : '' })).replace(/<\/div>\s*$/, `${cbLrCounter(c.id, mine, cat)}</div>`)).join('')}</div></section>`;
    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
    $$('[data-card]', root).forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.card;
      if (mode === 'level') return levelUp(C[id]);
      if (deck.includes(id)) deck = deck.filter((x) => x !== id); else if (deck.length < 3) deck.push(id); else toast('デッキは3枚までです。上のカードをタップして外してください');
      render();
    }));
    $$('[data-slot]', root).forEach((el) => el.addEventListener('click', () => { deck.splice(Number(el.dataset.slot), 1); render(); }));
    $('#cb-save')?.addEventListener('click', async () => {
      try { mine = await api('/cards/deck', { method: 'PUT', body: { deck } }); deck = [...mine.deck]; toast('デッキを保存しました', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  // レベルアップ書を使う (確認してから)
  // レベルアップ書を使う: 目標のレベルを選んで、まとめて上げられる
  const costOf = (lv) => (lv < (cat.dupMaxLevel || 15) ? lv : (cat.highLevelCost || 50));
  const costTo = (from, to) => { let n = 0; for (let l = from; l < to; l++) n += costOf(l); return n; };
  function levelUp(c) {
    const lv = lvOf(c);
    if (lv >= cat.maxLevel) return toast(`${c.name} はもう最大のレベル (Lv${cat.maxLevel}) です`);
    let reach = lv; while (reach < cat.maxLevel && costTo(lv, reach + 1) <= mine.scrolls) reach++;   // 今の書で上げられる最高のレベル
    let to = lv + 1;  // はじめは +1 (まとめて上げるときは選ぶ)
    const mul = (l) => 1 + cat.levelBonus * (l - 1);
    const base = c.horse || c.monster ? { maxHp: c.maxHp / mul(lv), atk: c.atk / mul(lv), def: c.def / mul(lv) } : c;  // Lv1 の能力
    const at = (l) => ({ maxHp: Math.round(base.maxHp * mul(l)), atk: Math.round(base.atk * mul(l)), def: Math.round(base.def * mul(l)) });
    openPanel('レベルを上げる', `<div class="cb-lvup">
        <div class="cb-lvup-card">${cbCard(c, { level: lv })}</div>
        <div class="cb-lvup-pick"><button class="btn btn-outline btn-sm" type="button" data-step="-1" aria-label="1 つ下げる">−</button>
          <p class="cb-lvup-lv">Lv${lv} → <b id="cb-lvto"></b></p>
          <button class="btn btn-outline btn-sm" type="button" data-step="1" aria-label="1 つ上げる">＋</button></div>
        <div class="cb-lvup-quick"><button class="btn btn-ghost btn-sm" type="button" data-to="${lv + 1}">+1</button>
          ${reach > lv + 1 ? `<button class="btn btn-ghost btn-sm" type="button" data-to="${reach}">上げられるだけ (Lv${reach})</button>` : ''}
          <button class="btn btn-ghost btn-sm" type="button" data-to="${cat.maxLevel}">最大 (Lv${cat.maxLevel})</button></div>
        <div class="cb-lvup-stats" id="cb-lvstats"></div>
        <p class="text-sm" id="cb-lvcost"></p>
        <p class="text-xs muted" style="margin:0">Lv${cat.dupMaxLevel || 15} までは今のレベルと同じ枚数、Lv${cat.dupMaxLevel || 15} → ${cat.maxLevel} は 1 つにつき ${cat.highLevelCost || 50} 枚</p>
        <div class="modal-actions cb-lvup-acts" style="margin-top:0"><button class="btn btn-ghost" type="button" data-close>やめる</button>
          <button class="btn btn-outline" type="button" id="cb-lvcoin"></button>
          <button class="btn btn-primary" type="button" id="cb-lvgo"></button></div></div>`, (root, close) => {
      let done = false;
      const show = () => {
        const cost = costTo(lv, to), enough = mine.scrolls >= cost, a = at(lv), b = at(to);
        $('#cb-lvto', root).textContent = `Lv${to}`;
        $('#cb-lvstats', root).innerHTML = `<span>HP ${a.maxHp} → <b>${b.maxHp}</b></span><span>攻 ${a.atk} → <b>${b.atk}</b></span><span>防 ${a.def} → <b>${b.def}</b></span>`;
        const cc = cost * (cat.coinsPerScroll || 50), coinOk = mine.coins >= cc;
        $('#cb-lvcost', root).innerHTML = `📜 レベルアップ書 <b>${cost}</b> 枚 (持っている: ${mine.scrolls} 枚)<br>または 🪙 コイン <b>${cc.toLocaleString()}</b> (持っている: ${Number(mine.coins).toLocaleString()} · 書 1 枚 = ${cat.coinsPerScroll || 50} コイン)`;
        const go = $('#cb-lvgo', root); go.disabled = !enough; go.textContent = enough ? (to - lv > 1 ? `📜 書で Lv${to} まで上げる！` : '📜 書でレベルアップ！') : `書があと ${cost - mine.scrolls} 枚たりません`;
        const cg = $('#cb-lvcoin', root); cg.disabled = !coinOk; cg.textContent = coinOk ? `🪙 ${cc.toLocaleString()} コインで上げる` : `コインがあと ${(cc - mine.coins).toLocaleString()} たりません`;
        $('[data-step="-1"]', root).disabled = to <= lv + 1; $('[data-step="1"]', root).disabled = to >= cat.maxLevel;
      };
      show();
      $$('[data-step]', root).forEach((b) => b.addEventListener('click', () => { to = Math.min(cat.maxLevel, Math.max(lv + 1, to + Number(b.dataset.step))); show(); }));
      $$('[data-to]', root).forEach((b) => b.addEventListener('click', () => { to = Number(b.dataset.to); show(); }));
      const doLevel = async (e, pay) => {
        if (done) return close(); // 2 回目のタップは「OK」(とじるだけ)
        e.target.disabled = true;
        try {
          const res = await api('/cards/levelup', { method: 'POST', body: { id: c.id, to, pay } });
          mine = res;
          $('.cb-lvup-card', root).innerHTML = cbCard(res.card.horse || res.card.monster ? res.card : C2(res.card.id), { level: res.to, cls: 'lv-flash' });
          $('.cb-lvup-pick', root).innerHTML = `<p class="cb-lvup-lv"><span class="cb-lvup-shout">Lv${res.to} にレベルアップ！</span></p>`;
          $$('.cb-lvup-quick, #cb-lvstats, #cb-lvcost, .cb-lvup > p.text-xs', root).forEach((x) => x.remove());
          done = true; $('#cb-lvcoin', root)?.remove(); $('#cb-lvgo', root).textContent = 'OK'; $('#cb-lvgo', root).disabled = false;
          cbConfetti(root, res.to - res.from > 1 ? 90 : 40, ['#ffd43b', '#74c0fc', '#8ce99a', '#fff']);
          render();
        } catch (err) { toast(err.message, 'error'); close(); }
      };
      $('#cb-lvgo', root).addEventListener('click', (e) => doLevel(e, 'scrolls'));
      $('#cb-lvcoin', root).addEventListener('click', (e) => doLevel(e, 'coins'));
    });
  }
  const C2 = (id) => { const c = cat.cards.find((x) => x.id === id); return c ? cbMine(c, mine) : [...mine.horses, ...(mine.monsters || [])].find((x) => x.id === id); };
  render();
}

// ---------- CPU 戦「鬼難」: 5 種類のデッキからえらぶ ----------
async function viewOni() {
  if (!requireLogin()) return;
  main.innerHTML = pageHead({ title: '👹 CPU (鬼難)', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbo">${loadingBlock()}</div>`;
  let o; try { await cbCatalog(); o = await api('/cards/oni'); } catch (e) { $('#cbo').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const root = $('#cbo'); if (!root) return;
  root.innerHTML = `<section class="card cb-oni-hero"><b>👹 鬼難</b><p>先を読む強い CPU が、鍛えぬいた Lv20 のデッキで待ちかまえる。<br>Lv18 の SSR・MR でそろえても、勝てるのは 4 回に 1 回くらい。</p>
      <span>勝ち +${o.reward.win}🪙 · 負け +${o.reward.lose}🪙 · 回数制限なし · レベルアップ書もいつもどおり</span></section>
    ${o.decks.map((d) => `<section class="card card-pad cb-oni-deck">
      <div class="panel-head"><h3>${esc(d.emoji)} ${esc(d.name)}</h3><span class="text-xs muted">全員 Lv20${d.boost > 1 ? ` · 鬼強化 +${Math.round((d.boost - 1) * 100)}%` : ''}</span></div>
      <p class="text-sm muted" style="margin:0 0 8px">${esc(d.text)}</p>
      <div class="cb-deck">${d.cards.map((c) => cbCard(c, { small: true })).join('')}</div>
      <p class="text-xs muted cb-oni-stats">${d.cards.map((c) => `${esc(c.name)}: HP ${c.maxHp} 攻 ${c.atk} 防 ${c.def} 速 ${c.spd}`).join('<br>')}</p>
      <a class="btn cb-oni-btn btn-block" href="#/games/cards/battle?mode=oni&deck=${encodeURIComponent(d.id)}">⚔️ この鬼に挑む</a></section>`).join('')}
    <a class="btn btn-outline btn-block" href="#/games/cards/battle?mode=oni">🎲 ランダムな鬼に挑む</a>`;
}

// ---------- デッキの採用率 ----------
async function viewCardUsage() {
  main.innerHTML = pageHead({ title: 'デッキ採用率', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbu">${loadingBlock()}</div>`;
  let cat; try { cat = await cbCatalog(); } catch (e) { $('#cbu').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  let days = 7, scope = 'all';
  const C = Object.fromEntries(cat.cards.map((c) => [c.id, c]));
  async function load() {
    const root = $('#cbu'); if (!root) return;
    let u; try { u = await api(`/cards/usage?days=${days}&scope=${scope}`, { noAuthPrompt: true }); } catch (e) { root.innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
    if (!$('#cbu')) return;
    const max = Math.max(1, ...u.cards.map((x) => x.rate), u.horse.rate, u.monster?.rate || 0);
    const seg = (name, cur, opts) => `<div class="segmented cb-mode" role="tablist">${opts.map(([v, l]) => `<button type="button" class="seg${cur === v ? ' active' : ''}" data-${name}="${v}">${l}</button>`).join('')}</div>`;
    const row = (rank, art, name, rarity, x) => `<li class="cbu-row"><span class="cbu-rank${rank <= 3 && x.count ? ' top' + rank : ''}">${rank}</span>
        <span class="cbu-art" aria-hidden="true">${art}</span>
        <span class="cbu-main"><span class="cbu-name"><b>${esc(name)}</b>${rarity ? `<span class="cb-rbadge" style="--rc:${CB_RCOL[rarity] || '#888'}">${esc(rarity)}</span>` : ''}</span>
          <span class="cbu-bar"><i style="width:${(x.rate / max) * 100}%;--rc:${CB_RCOL[rarity] || '#c9783a'}"></i></span></span>
        <span class="cbu-pct"><b>${x.count}回</b><small>${x.rate.toFixed(1)}%</small></span></li>`;
    let rank = 0, last = -1;
    $('#cbu').innerHTML = `<section class="card card-pad stack-sm">
        ${seg('days', days, [[1, '今日'], [7, '7日間'], [30, '30日間'], [0, 'ぜんぶ']])}
        ${seg('scope', scope, [['all', 'すべての対戦'], ['random', 'レート戦だけ']])}
        <p class="text-xs muted" style="margin:0">${days ? `この ${days === 1 ? '1 日' : days + ' 日間'}` : 'これまで'}の${scope === 'random' ? 'ランダム対戦 (レート戦)' : '対戦'} <b>${u.matches}</b> 試合で、そのカードが使われた回数です (プレイヤーのデッキ <b>${u.decks}</b> 個を数えます。CPU のデッキは数えません)。% は使われたデッキの割合。1 分ごとに更新。</p></section>
      ${u.decks ? `<section class="card card-pad"><ol class="cbu-list">
        ${u.cards.map((x, i) => { if (x.count !== last) { rank = i + 1; last = x.count; } const c = C[x.id]; return c ? row(rank, CBArt.svg(c.id, c.rarity), c.name, c.rarity, x) : ''; }).join('')}
        ${u.horse.count ? row('🐴', CBArt.svg('h:x', 'SSR', { coat: '栗毛' }), '連れてきた馬 (どれか 1 頭以上)', '', u.horse) : ''}
        ${u.monster?.count ? row('🧬', CBArt.svg('m:x', 'SR'), '連れてきたモンスター (どれか 1 体以上)', '', u.monster) : ''}
      </ol></section>` : emptyState({ icon: 'sparkle', title: 'この期間の試合はまだありません', text: '期間を変えてみてください' })}`;
    $$('[data-days]').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.days); load(); }));
    $$('[data-scope]').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; load(); }));
  }
  load();
}

// ---------- 対戦募集掲示板 ----------
async function viewCardBoard() {
  main.innerHTML = pageHead({ title: 'レート戦 募集掲示板', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbd">${loadingBlock()}</div>`;
  let cat; try { cat = await cbCatalog(); } catch (e) { $('#cbd').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  let tag = '', timer = 0, first = true;
  const draw = (b) => {
    const root = $('#cbd'); if (!root) return clearInterval(timer);
    if (first) {
      tag = b.tags[0]; first = false;
      root.innerHTML = `<section class="card card-pad cbd-new">${me ? `
        <div class="panel-head"><h3>📣 対戦相手を募集する</h3><span class="text-xs muted">いまのデッキで募集します</span></div>
        <form id="cbd-form" class="stack-sm">
          <div class="cbd-tags" role="radiogroup" aria-label="タグ">${b.tags.map((t, i) => `<button type="button" class="chip cbd-tag${i ? '' : ' active'}" data-tag="${esc(t)}" role="radio" aria-checked="${i ? 'false' : 'true'}">${esc(t)}</button>`).join('')}</div>
          <input class="input" name="comment" maxlength="${b.max}" placeholder="ひとこと (例: タドコロ使ってます！ 誰でもどうぞ)" autocomplete="off">
          <button class="btn btn-primary btn-block" type="submit">📋 掲示板に募集を出す</button>
          <p class="text-xs muted" style="margin:0">掲示板の対戦は<b>レート戦</b>です (ランダム対戦と同じく、レートが動いて勝ち +${b.reward.win}🪙)。同じ相手と何回でもできますが、2 人のレート戦が ${b.banGames} 戦以上で片方が 1 回も勝てていないと、その 2 人は対戦できなくなります。募集を出すと待ち受け画面になり、相手が来たらすぐ始まります。待ち受け画面をはなれると、募集は消えます</p>
        </form>` : '<p class="text-sm">ログインすると、募集を出したり、募集している人と対戦したりできます</p><button class="btn btn-primary" type="button" id="cbd-login">ログイン</button>'}</section>
        <section class="card card-pad"><div class="panel-head"><h3>⚔️ 募集中</h3><span class="text-xs muted" id="cbd-n"></span></div><div id="cbd-list"></div></section>`;
      $$('.cbd-tag').forEach((x) => x.addEventListener('click', () => { tag = x.dataset.tag; $$('.cbd-tag').forEach((y) => { y.classList.toggle('active', y === x); y.setAttribute('aria-checked', String(y === x)); }); }));
      $('#cbd-form')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/games/cards/battle?mode=room-create&board=1&tag=${encodeURIComponent(tag)}&comment=${encodeURIComponent(e.target.comment.value.trim())}&n=${Date.now()}`; });
      $('#cbd-login')?.addEventListener('click', () => openAuth());
    }
    $('#cbd-n').textContent = `${b.posts.length} 件 · 自動で更新`;
    $('#cbd-list').innerHTML = b.posts.length ? b.posts.map((p) => `<article class="cbd-post${p.mine ? ' mine' : ''}">
        <div class="cbd-head"><a href="#/u/${esc(p.user.username)}">${avatar(p.user, 'sm')}</a><span class="cbd-who"><a href="#/u/${esc(p.user.username)}"><b>${esc(p.user.displayName)}</b>${adminBadge(p.user)}</a>${titleChips(p.user, 'sm')}<small>@${esc(p.user.username)} · ${esc(timeAgo(p.at))}</small></span><span class="cbd-ptag">${esc(p.tag)}</span></div>
        ${p.comment ? `<p class="cbd-comment">${esc(p.comment)}</p>` : ''}
        <div class="cbd-deck">${p.deck.map((c) => `<span class="cbd-card r-${esc(c.rarity)}" title="${esc(c.name)} Lv${Number(c.level)}">${CBArt.svg(c.horse ? 'h:x' : c.id, c.rarity, { coat: c.coat })}<small>Lv${Number(c.level)}</small></span>`).join('')}</div>
        ${p.mine ? '<p class="text-xs muted" style="margin:6px 0 0">あなたの募集です (待ち受け画面で待っています)</p>'
          : p.vs?.banned ? `<p class="cbd-banned">🚫 この人とは対戦できません (${p.vs.games} 戦 ${p.vs.wins} 勝 ${p.vs.losses} 敗。${b.banGames} 戦以上で片方が 1 回も勝てていないため)</p>`
          : me ? `${p.vs?.games ? `<p class="text-xs muted" style="margin:8px 0 0">この人との成績: ${p.vs.games} 戦 ${p.vs.wins} 勝 ${p.vs.losses} 敗</p>` : ''}<a class="btn btn-primary btn-block cbd-go" href="#/games/cards/battle?mode=room-join&code=${encodeURIComponent(p.code)}&from=board&n=${Date.now()}">⚔️ この人と対戦する</a>` : ''}
      </article>`).join('') : emptyState({ icon: 'sparkle', title: 'いま募集している人はいません', text: '上のフォームから募集を出してみよう！' });
  };
  const load = async () => { try { draw(await api('/cards/board', { noAuthPrompt: true })); } catch (e) { if (first && $('#cbd')) $('#cbd').innerHTML = emptyState({ icon: 'alert', title: e.message }); } };
  await load();
  timer = setInterval(() => { if (!$('#cbd') || document.hidden) { if (!$('#cbd')) clearInterval(timer); return; } load(); }, 5000);
}

// ---------- 期間限定クエスト ----------
async function viewQuest() {
  main.innerHTML = pageHead({ title: '期間限定クエスト', sub: 'ぶんぼうぐバトラーズ', back: '#/games/cards' }) + `<div class="content stack" id="cbq">${loadingBlock()}</div>`;
  let cat, quests;
  try { cat = await cbCatalog(); ({ quests } = await api('/cards/quests', { noAuthPrompt: true })); } catch (e) { $('#cbq').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const root = $('#cbq'); if (!root) return;
  const cbMineCache = me ? await api('/cards/me', { noAuthPrompt: true }).catch(() => null) : null; // LR までのカウンター用
  if (!quests.length) { root.innerHTML = emptyState({ icon: 'sparkle', title: 'いま開催中のクエストはありません', text: '次のクエストをお楽しみに！', action: '<a class="btn btn-primary" href="#/games/cards">もどる</a>' }); return; }
  const fmt = (t) => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  root.innerHTML = quests.map((q) => `
    <section class="card cb-quest${q.hard ? ' hard' : ''}">
      <div class="cb-quest-sky" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i style="--x:${10 + i * 15}%;--d:${i * 0.7}s"></i>`).join('')}</div>
      <span class="cb-quest-tag">${q.hard ? `${esc(q.emoji || '⚡')} 高難易度クエスト` : '🌠 期間限定クエスト'} · ${esc(fmt(q.start))} 〜 ${esc(fmt(q.end))}</span>
      <h2>${esc(q.name)}</h2>
      <p>${esc(q.text)}</p>
      <div class="cb-quest-reward">
        <div class="cb-quest-rcard">${cbCard(q.reward, { level: 1, cls: 'tilt' })}</div>
        <div class="cb-quest-rtext"><span class="cb-quest-label">クリア報酬</span><b><em class="cb-mr-word">MR</em> ${esc(q.reward.name)}</b>
          <span>わざ「${esc(q.reward.skillName)}」</span><small>${esc(q.reward.skillDesc)}</small>
          <small>${q.hard ? `高難易度クエストは勝つたびに 1 枚もらえて、${cat.lrPromote?.copies || 25} 枚集めると <b class="cb-lr-word">LR</b> に昇格 (能力 +${cat.lrPromote?.bonus || 35}%)！` : `MR は能力 +${cat.rarityBonus.MR}%。報酬のカードは、はじめてクリアしたときに 1 枚もらえます`}</small>${q.hard ? cbLrCounter(q.reward.id, cbMineCache, cat) : ''}</div>
      </div>
      ${q.cleared ? '<p class="cb-quest-done">✅ クリアずみ！ 何度でも挑戦できます (コインとレベルアップ書はもらえます)</p>' : ''}
    </section>
    <section class="card card-pad"><div class="panel-head"><h3>${esc(q.emoji)} 敵: ${esc(q.boss)}</h3><span class="text-xs muted">3 体を全部たおすとクリア</span></div>
      <div class="cb-deck">${q.enemy.map((c) => cbCard(c, { level: c.lv, small: false })).join('')}</div>
      ${(q.bonus || []).length || (q.bonusSoon || []).length ? `<div class="cb-quest-bonus"><b>⭐ 特効キャラ</b>
        ${(q.bonus || []).map((c) => `<div class="cb-quest-bonus-row">${CBArt.svg(c.id, c.rarity, { label: c.name })}<span><b>${esc(c.name)}</b>をデッキに入れると、このクエストでは HP・攻撃・防御が <em>${c.mult} 倍</em>！</span></div>`).join('')}
        ${(q.bonusSoon || []).map((c) => `<div class="cb-quest-bonus-row"><span><b>${esc(c.name)}</b> (${esc(fmt(c.at))} ガチャに登場) をデッキに入れると、このクエストでは HP・攻撃・防御が <em>${c.mult} 倍</em>！</span></div>`).join('')}</div>` : ''}
      ${q.items ? `<div class="cb-quest-items"><b>🧪 アイテムが使える！ (${esc(fmt(q.items.from))} から)</b>${q.items.list.map((it) => `<span>${esc(it.emoji)} <b>${esc(it.name)}</b> 🪙${Number(it.price).toLocaleString()} — ${esc(it.desc)}</span>`).join('')}<small>バトル中に「🧪 アイテム」ボタンから、コインを払ってその場で使います (そのターンの行動になります)</small></div>` : ''}
      ${q.hard ? `<p class="cb-quest-hard">⚠️ 高難易度: 敵は先を読む強い CPU${q.boostPct ? `・能力 ${q.boostPct > 0 ? '+' : ''}${q.boostPct}%` : ''}。ガチで難しいので、デッキと作戦をしっかり考えて挑もう！</p>` : ''}
      <p class="text-xs muted" style="margin:8px 0 0">${esc(q.tip)}</p></section>
    <section class="card card-pad">${me
      ? `<a class="btn btn-primary btn-lg btn-block cb-quest-go" href="#/games/cards/battle?mode=quest&q=${encodeURIComponent(q.id)}">⚔️ ${q.cleared ? 'もう一度挑戦する' : '挑戦する！'}</a>
         <a class="btn btn-ghost btn-block" href="#/games/cards/collection" style="margin-top:8px">デッキを変える</a>`
      : '<button class="btn btn-primary btn-block" type="button" id="cbq-login">ログインして挑戦する</button>'}</section>`).join('');
  $('#cbq-login')?.addEventListener('click', () => openAuth());
}

// ---------- 対戦 ----------
async function viewBattle(params) {
  if (!requireLogin()) return;
  const mode = params.get('mode'), code = params.get('code') || '', questId = params.get('q') || '', oniDeck = params.get('deck') || '';
  const board = mode === 'room-create' && params.get('board') ? { comment: params.get('comment') || '', tag: params.get('tag') || '' } : null; // 対戦募集掲示板に出す
  const titles = { quest: '🌠 期間限定クエスト', oni: '👹 CPU (鬼難)', easy: '🐣 CPU (かんたん)', cpu: 'CPU (ふつう)', random: 'ランダム対戦', 'room-create': '友だちと対戦', 'room-join': '友だちと対戦' };
  main.innerHTML = pageHead({ title: board ? '📋 対戦募集' : titles[mode] || '対戦', sub: 'ぶんぼうぐバトラーズ', back: board || params.get('from') === 'board' ? '#/games/cards/board' : '#/games/cards' }) + `<div class="content"><section class="card cb-battle" id="cbb">${loadingBlock()}</section></div>`;
  const cat = await cbCatalog().catch(() => null);
  const T = cat?.types || {};
  const box = () => $('#cbb');
  let fromBoard = !!board || params.get('from') === 'board';
  let items = null, coins = 0; // ボスクエストのアイテム (コインで買ってその場で使う)
  let ws = null, you = 0, players = [], state = null, deadline = 0, tick = 0, chosen = false, picking = false, closedByUs = false, log = [], ended = false;
  const name = (p, card) => `${p === you ? '' : '相手の'}${card}`;
  const evText = (e) => e.k === 'item' ? (e.item === 'tea' ? `${e.p === you ? 'あなた' : '相手'}は🧋アイスティーを使った！` : `${e.p === you ? 'あなた' : '相手'}は${e.item === 'elixir' ? '💖' : '🧪'}${e.name}を使った！ ${e.card}の HP が ${e.amount} 回復`)
    : e.k === 'flinched' ? (e.sleep ? `${e.p === you ? '' : '相手の'}${e.card}は眠ってしまった！💤 (次のターン動けない)` : `${e.p === you ? '' : '相手の'}${e.card}は野獣の眼光に怯んだ！ (${e.now ? 'このターンは動けない' : '次のターン動けない'})`)
    : e.k === 'flinch' ? (e.sleep ? `${e.p === you ? '' : '相手の'}${e.card}は眠っていて動けない…💤` : `${e.p === you ? '' : '相手の'}${e.card}は怯んで動けない！`)
    : e.k === 'dogma' ? `🧬 ${name(e.p, e.card)}のセントラルドグマ！ ${e.healed.map((x) => `${x.card} +${x.amount}`).join('・')} 回復`
    : e.k === 'morale' ? `${e.p === you ? '' : '相手の'}${e.card}がたおれ、${e.p === you ? '味方' : '相手'}の士気が上がった！🔥 (攻撃 1.4 倍・防御 1.3 倍)`
    : e.k === 'sermon' ? `${name(e.p, e.card)}の説教！ 📢${e.to !== null ? ` ${e.p === you ? '相手の' : ''}${e.target}の攻撃力が ${e.from} → ${e.to} に下がった` : ` (${e.p === you ? '相手の' : ''}${e.target}はもう説教ずみ)`}${e.cured.length ? `。${e.cured.join('・')}の毒が治った` : ''}`
    : e.k === 'deathsong' ? `🎤💀 ${name(e.p, e.card)}の死の歌声─一方的な愛─！ ${e.p === you ? '相手の' : ''}${e.target}は呪われた… (このターンに${e.p === you ? '' : '相手の'}${e.card}を倒すと道連れ)`
    : e.k === 'curse' ? `💔 一方的な愛… ${e.p === you ? '' : '相手の'}${e.card}が${e.by}の道連れになった！`
    : e.k === 'sealed' ? `🧬 ${name(e.p === 0 ? 1 : 0, e.by)}が${e.p === you ? '' : '相手の'}${e.card}の DNA を取り出した！ ${e.again ? '(もう封じられている)' : 'このバトル中、わざが使えない'}`
    : e.k === 'taika' ? `📜 大化の改新！ ${e.p === you ? '味方' : '相手'}の${e.fixed.length || e.meteor ? `${e.fixed.map((x) => `${x.card}の${x.what.join('・')}`).join('、')}${e.meteor ? `${e.fixed.length ? '、' : ''}流星` : ''}が取りのぞかれた` : '状態異常はなかった (こうげきだけ)'}`
    : e.k === 'starfall' ? `${name(e.p, e.card)}の流星が、${e.target === you ? 'あなた' : '相手'}の盤面に降りそそぐ！ 🌠 (${e.turns}ターン)`
    : e.k === 'meteor' ? `流星が${e.p === you ? '' : '相手の'}${e.card}に ${e.dmg} ダメージ！${e.left ? ` (あと${e.left}ターン)` : ' (流星がやんだ)'}`
    : e.k === 'poisoned' ? `${e.p === you ? 'あなた' : '相手'}の ${e.cards.length} 体が毒になった！ ☠️`
    : e.k === 'poison' ? `${e.p === you ? '' : '相手の'}${e.bench ? '控えの' : ''}${e.card}は毒で ${e.dmg} ダメージ${e.left ? ` (あと${e.left}ターン)` : ' (毒が消えた)'}`
    : e.k === 'hit' ? (e.bench ? `${1 - e.p === you ? '' : '相手の'}控えの${e.target}に ${e.dmg} ダメージ` : `${name(e.p, e.card)}のこうげき！ ${name(1 - e.p, e.target)}に ${e.dmg} ダメージ${e.eff === 'good' ? '（こうかばつぐん！）' : e.eff === 'bad' ? '（いまひとつ…）' : ''}${e.guarded ? '（ガード）' : ''}`)
    : e.k === 'skill' ? `${name(e.p, e.card)}の「${e.skill}」！` : e.k === 'heal' ? `${name(e.p, e.card)}は ${e.amount} 回復した`
    : e.k === 'guard' ? `${name(e.p, e.card)}はガードした` : e.k === 'switch' ? `${e.p === you ? 'あなた' : '相手'}は ${e.card} を出した`
    : e.k === 'ko' ? (e.bench ? `${e.p === you ? '' : '相手の'}控えの${e.card}はたおれた！` : `${name(e.p, e.card)}はたおれた！`) : e.k === 'timeup' ? '30ターンたったので、残りの HP で決まります' : '';
  let prevPct = {}; // HP バーを前のターンの長さから動かすため
  const hpBar = (c, key) => { const now = Math.max(0, (c.hp / c.maxHp) * 100), from = prevPct[key] ?? now; return `<span class="cb-hp"><i data-to="${now}" style="width:${from}%" class="${c.hp / c.maxHp < 0.3 ? 'low' : ''}"></i></span><span class="cb-hpn">${c.hp}/${c.maxHp}</span>`; };
  const fighter = (c, mineSide, key, meteor = 0) => `<div class="cb-fighter r-${esc(c.rarity)}${mineSide ? ' mine' : ''}${meteor ? ' meteor' : ''}" data-side="${mineSide ? 'me' : 'foe'}" style="--rc:${CB_RCOL[c.rarity]}">
      ${meteor ? '<span class="cb-rain" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}
      <span class="cb-fpic">${CBArt.svg(c.id, c.rarity, { label: c.name, coat: c.coat })}</span>
      <div class="cb-finfo"><b>${esc(c.name)}</b><span class="cb-meta">${esc(T[c.type]?.icon || '')}${esc(T[c.type]?.name || '')} · 速 ${c.spd}${c.cd ? ` · わざ あと${c.cd}` : ''}${c.bonus ? ` · <span class="cb-bonus">⭐特効 ×${c.bonus}</span>` : ''}${c.scolded ? ' · <span class="cb-scolded">📢説教 攻↓</span>' : ''}${c.morale ? ' · <span class="cb-morale">🔥士気UP</span>' : ''}${c.sealed > 0 ? ` · <span class="cb-sealed">🧬わざ封じ</span>` : ''}${c.flinch === 1 ? (c.sleep ? ' · <span class="cb-flinch">💤眠り</span>' : ' · <span class="cb-flinch">😨怯み</span>') : ''}${c.poison > 0 ? ` · <span class="cb-psn">☠️毒 あと${c.poison}</span>` : ''}${meteor ? ` · <span class="cb-met">🌠流星 あと${meteor}</span>` : ''}</span>${hpBar(c, key)}</div></div>`;
  const bench = (side, mineSide) => `<div class="cb-bench">${side.cards.map((c, i) => `<button type="button" class="cb-mini${i === side.active ? ' active' : ''}${c.hp <= 0 ? ' down' : ''}${c.poison > 0 && c.hp > 0 ? ' poisoned' : ''}" ${mineSide && picking && i !== side.active && c.hp > 0 ? `data-switch="${i}"` : 'disabled'} aria-label="${esc(c.name)} HP ${c.hp}">${CBArt.svg(c.id, 'N', { coat: c.coat })}<i style="width:${Math.max(0, (c.hp / c.maxHp) * 100)}%"></i></button>`).join('')}</div>`;
  function render() {
    if (!box() || !state) return;
    const mineS = state.sides[you], foeS = state.sides[1 - you], my = mineS.cards[mineS.active], skill = my.skillName ? my : cat?.cards.find((c) => c.id === my.id);
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const canSwitch = mineS.cards.some((c, i) => i !== mineS.active && c.hp > 0);
    box().innerHTML = `<div class="cb-top">${avatar(players[1 - you], 'sm')}<b>${esc(players[1 - you].displayName)}</b>${titleChips(players[1 - you], 'sm')}${bench(foeS, false)}</div>
      ${fighter(foeS.cards[foeS.active], false, `${1 - you}-${foeS.active}-${foeS.cards[foeS.active].id}`, foeS.meteor)}
      <div class="cb-log" aria-live="polite">${log.slice(-4).map((l) => `<p>${esc(l)}</p>`).join('') || '<p class="muted">バトル開始！</p>'}</div>
      ${fighter(my, true, `${you}-${mineS.active}-${my.id}`, mineS.meteor)}
      <div class="cb-top mine">${avatar(players[you], 'sm')}<b>あなた</b>${bench(mineS, true)}<span class="cb-timer${left <= 5 ? ' hurry' : ''}" id="cb-timer">${ended ? '' : chosen ? '相手を待っています…' : `のこり ${left}秒`}</span></div>
      ${ended ? '' : picking === 'item' ? `<div class="cb-acts cb-items"><p class="text-sm" style="grid-column:1/-1">アイテムをえらんでください (🪙 ${Number(coins).toLocaleString()} コイン持っています)</p>
          ${items.list.map((it) => `<button class="btn btn-outline cb-item" type="button" data-item="${esc(it.id)}" ${coins < it.price || ((it.id === 'potion' || it.id === 'elixir') && my.hp >= my.maxHp) ? 'disabled' : ''}><b>${esc(it.emoji)} ${esc(it.name)}</b><small>${esc(it.desc)}</small><em>🪙 ${Number(it.price).toLocaleString()}</em></button>`).join('')}
          <button class="btn btn-ghost" type="button" data-act="cancel-switch">もどる</button></div>`
        : picking ? `<div class="cb-acts"><p class="text-sm" style="grid-column:1/-1">交代するカードをえらんでください</p><button class="btn btn-ghost" type="button" data-act="cancel-switch">もどる</button></div>`
        : `<div class="cb-acts">
          <button class="btn btn-primary btn-lg" type="button" data-act="attack" ${chosen ? 'disabled' : ''}>こうげき</button>
          <button class="btn btn-outline btn-lg" type="button" data-act="guard" ${chosen ? 'disabled' : ''}>ガード</button>
          <button class="btn btn-outline btn-lg cb-skill" type="button" data-act="skill" ${chosen || my.cd || my.sealed > 0 ? 'disabled' : ''}>わざ「${esc(skill?.skillName || '')}」${my.sealed > 0 ? `<small>🧬 DNA を取り出されて、このバトル中は使えない</small>` : my.cd ? `<small>あと${my.cd}ターン</small>` : `<small>${esc(skill?.skillDesc || '')}</small>`}</button>
          <button class="btn btn-outline btn-lg" type="button" data-act="switch" ${chosen || !canSwitch ? 'disabled' : ''}>こうたい</button>
          ${items ? (Date.now() >= items.from ? `<button class="btn btn-lg cb-item-btn" type="button" data-act="item" ${chosen ? 'disabled' : ''}>🧪 アイテム<small>コインで回復・眠らせる (🪙 ${Number(coins).toLocaleString()})</small></button>`
            : `<button class="btn btn-lg cb-item-btn" type="button" disabled>🧪 アイテム<small>${esc(new Date(items.from).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }))} から使えます</small></button>`) : ''}
        </div>`}
      ${ended ? '' : '<button class="btn btn-ghost btn-sm cb-surrender" type="button" id="cb-surrender">こうさんする</button>'}`;
    requestAnimationFrame(() => $$('.cb-hp i[data-to]', box()).forEach((i) => { i.style.width = i.dataset.to + '%'; }));
    prevPct = {};
    state.sides.forEach((s, p) => s.cards.forEach((c, k) => { prevPct[`${p}-${k}-${c.id}`] = Math.max(0, (c.hp / c.maxHp) * 100); }));
    $$('[data-act]', box()).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'switch') { picking = true; return render(); }
      if (a === 'item') { picking = 'item'; return render(); }
      if (a === 'cancel-switch') { picking = false; return render(); }
      choose({ a });
    }));
    $$('[data-item]', box()).forEach((b) => b.addEventListener('click', () => { picking = false; choose({ a: 'item', item: b.dataset.item }); }));
    $$('[data-switch]', box()).forEach((b) => b.addEventListener('click', () => { picking = false; choose({ a: 'switch', i: Number(b.dataset.switch) }); }));
    $('#cb-surrender')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'こうさんしますか？', body: 'このバトルは負けになります。', ok: 'こうさんする', danger: true })) wsSend({ t: 'surrender' }); });
  }
  const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  // 1 ターンの出来事を順番に見せる: こうげきした側が飛び出し、受けた側がゆれて数字が出る
  // 大きな演出 (斬撃・流星) は、画面の上に重ねて出す (次のターンで画面が描き直されても消えないように)
  function overlayFx(cls, html, ms, part = 'all') {
    const b = box(); if (!b) return;
    const r = b.getBoundingClientRect(), h = part === 'all' ? r.height : r.height * 0.55, top = part === 'bottom' ? r.top + r.height * 0.45 : r.top;
    const fx = document.createElement('div'); fx.className = cls; fx.innerHTML = html;
    Object.assign(fx.style, { position: 'fixed', left: r.left + 'px', top: top + 'px', width: r.width + 'px', height: h + 'px', right: 'auto', bottom: 'auto' });
    document.body.append(fx); setTimeout(() => fx.remove(), ms);
  }
  function animate(events) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = (p) => box()?.querySelector(`.cb-fighter[data-side="${p === you ? 'me' : 'foe'}"]`);
    const pop = (p, text, cls) => { const f = el(p); if (!f) return; const n = document.createElement('span'); n.className = 'cb-float ' + cls; n.textContent = text; f.append(n); setTimeout(() => n.remove(), 1100); };
    const replay = (node, cls) => { if (!node) return; const list = cls.split(' '); node.classList.remove('lunge', 'hurt', 'big', 'charge', 'guarding', 'shake'); void node.offsetWidth; node.classList.add(...list); };
    let t = 0;
    events.forEach((e) => {
      if (e.k === 'hit' && e.bench) {
        setTimeout(() => {
          const side = box()?.querySelectorAll('.cb-top')[e.p === you ? 0 : 1];
          const mini = [...(side?.querySelectorAll('.cb-mini') || [])].find((m) => (m.getAttribute('aria-label') || '').startsWith(e.target + ' '));
          if (mini) { replay(mini, 'hurt'); const n = document.createElement('span'); n.className = 'cb-float dmg bench'; n.textContent = `-${e.dmg}`; mini.append(n); setTimeout(() => n.remove(), 1100); }
        }, t);
        t += 160;
      } else if (e.k === 'hit') {
        setTimeout(() => {
          replay(el(e.p), 'lunge'); replay(el(1 - e.p), e.dmg >= 100 ? 'hurt big' : 'hurt');
          pop(1 - e.p, `-${e.dmg}`, e.eff === 'good' ? 'dmg crit' : 'dmg');
          if (e.eff === 'good') pop(1 - e.p, 'こうかばつぐん！', 'tag');
          if (e.dmg >= 100 && box()) replay(box(), 'shake');
        }, t);
        t += 420;
      } else if (e.k === 'heal') { setTimeout(() => pop(e.p, `+${e.amount}`, 'heal'), t); t += 300; }
      else if (e.k === 'skill' && e.id === 'sweep') { // 疾風斬り: 緑の斬撃が相手の盤面を横切る
        setTimeout(() => {
          replay(el(e.p), 'charge'); pop(e.p, e.skill, 'skill sweep');
          overlayFx('cb-gslash' + (e.p === you ? ' to-foe' : ' to-me'), '<i></i><i></i><i></i><b>疾風斬り！</b>', 1300, e.p === you ? 'top' : 'bottom');
        }, t);
        t += 650;
      }
      else if (e.k === 'skill' && e.id === 'thunder') { // 落雷: 画面が光って、相手の盤面に稲妻が落ちる
        setTimeout(() => {
          replay(el(e.p), 'charge'); pop(e.p, e.skill, 'skill thunder');
          overlayFx('cb-gslash cb-yslash' + (e.p === you ? ' to-foe' : ' to-me'), '<i></i><i></i><i></i><i class="v"></i><i class="v"></i><b>⚡ 落雷！</b>', 1400, e.p === you ? 'top' : 'bottom');
        }, t);
        t += 650;
      }
      else if (e.k === 'skill') { setTimeout(() => { replay(el(e.p), 'charge'); pop(e.p, e.skill, 'skill'); }, t); t += 320; }
      else if (e.k === 'guard') { setTimeout(() => replay(el(e.p), 'guarding'), t); }
      else if (e.k === 'ko') { setTimeout(() => pop(e.p, 'KO!', 'ko'), t); t += 300; }
      else if (e.k === 'sermon') { // 説教: 吹き出しが出て、相手がしょんぼり
        setTimeout(() => {
          replay(el(e.p), 'charge'); pop(e.p, '📢 説教！', 'skill sermon');
          overlayFx('cb-sermon' + (e.p === you ? ' to-foe' : ' to-me'), `<b>コラーッ！！</b><i>📢 説教タイム</i>${e.to !== null ? `<em>攻撃 ${e.from} → ${e.to}</em>` : ''}`, 1600, e.p === you ? 'top' : 'bottom');
          if (e.to !== null) setTimeout(() => { replay(el(1 - e.p), 'hurt'); pop(1 - e.p, '攻撃ダウン…', 'tag'); }, 500);
          if (e.cured.length) setTimeout(() => pop(e.p, '💧 毒が治った', 'heal'), 800);
        }, t);
        t += 900;
      }
      else if (e.k === 'deathsong') { // 死の歌声: 黒とピンクの音符があふれる
        setTimeout(() => {
          overlayFx('cb-dsong' + (e.p === you ? ' on-foe' : ' on-me'), `<b>死の歌声</b><i>─一方的な愛─</i><em>💀 このターンに倒すと道連れ</em>${Array.from({ length: 12 }, (_, i) => `<s style="--x:${(i * 41) % 100}%;--d:${(i % 6) * 0.12}s">${i % 3 ? '♪' : '💀'}</s>`).join('')}`, 1800, e.p === you ? 'top' : 'bottom');
          setTimeout(() => { replay(el(1 - e.p), 'hurt'); pop(1 - e.p, '💀 呪い', 'skill flinch'); }, 500);
        }, t);
        t += 900;
      }
      else if (e.k === 'curse') { setTimeout(() => { overlayFx('cb-dsong curse', `<b>道連れ</b><i>💔 一方的な愛</i><em>${esc(e.card)}</em>`, 1700, e.p === you ? 'bottom' : 'top'); replay(el(e.p), 'hurt'); }, t); t += 1000; }
      else if (e.k === 'sealed') { // DNAを取り出す: ピンクの魔法陣から二重らせんが抜き取られる
        setTimeout(() => {
          overlayFx('cb-dna' + (e.p === you ? ' on-me' : ''), `<b>DNAを取り出す</b><i>🩷 マジカル☆抜き取り！</i><em>🧬 このバトル中 わざ封じ</em>`, 1700, e.p === you ? 'bottom' : 'top');
          setTimeout(() => { replay(el(e.p), 'hurt'); pop(e.p, '🧬 わざ封じ！', 'skill flinch'); }, 500);
        }, t);
        t += 900;
      }
      else if (e.k === 'taika') { // 大化の改新: 金の巻物が開いて、味方の状態異常が消える
        setTimeout(() => {
          overlayFx('cb-taika' + (e.p === you ? ' to-me' : ' to-foe'), `<b>大化の改新</b><i>📜 新しい時代へ！</i>${e.fixed.length || e.meteor ? '<em>✨ 状態異常・デバフ すべて解除</em>' : ''}`, 1700, e.p === you ? 'bottom' : 'top');
          if (e.fixed.length || e.meteor) setTimeout(() => pop(e.p, '✨ 全部治った', 'heal'), 600);
        }, t);
        t += 900;
      }
      else if (e.k === 'starfall') {
        setTimeout(() => {
          overlayFx('cb-starfall' + (e.target === you ? ' on-me' : ''), '<b>🌠 スターライトマーチ！</b>' + Array.from({ length: 14 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.09}s"></i>`).join(''), 1900);
        }, t);
        t += 700;
      }
      else if (e.k === 'item') { setTimeout(() => { replay(el(e.p), 'charge'); pop(e.p, e.item === 'tea' ? '🧋 アイスティー！' : `${e.item === 'elixir' ? '💖' : '🧪'} +${e.amount}`, e.item === 'tea' ? 'skill' : 'heal'); }, t); t += 450; }
      else if (e.k === 'flinched') { setTimeout(() => { replay(el(e.p), 'hurt'); pop(e.p, e.sleep ? '💤 眠った！' : '😨 怯み！', 'skill flinch'); }, t); t += 400; }
      else if (e.k === 'flinch') { setTimeout(() => { replay(el(e.p), 'shake'); pop(e.p, '怯んで動けない…', 'tag'); }, t); t += 350; }
      else if (e.k === 'dogma') { setTimeout(() => { replay(el(e.p), 'charge'); pop(e.p, '🧬 セントラルドグマ 回復', 'heal'); }, t); t += 450; }
      else if (e.k === 'morale') { setTimeout(() => { replay(el(e.p), 'charge'); pop(e.p, '🔥 士気UP！', 'skill morale'); }, t); t += 500; }
      else if (e.k === 'meteor') { setTimeout(() => { replay(el(e.p), 'hurt'); pop(e.p, `🌠-${e.dmg}`, 'dmg met'); }, t); t += 260; }
      else if (e.k === 'poisoned') { setTimeout(() => pop(e.p, '☠️ 毒！', 'skill psn'), t); t += 250; }
      else if (e.k === 'poison') {
        setTimeout(() => {
          if (e.bench) {
            const side = box()?.querySelectorAll('.cb-top')[e.p === you ? 1 : 0];
            const mini = [...(side?.querySelectorAll('.cb-mini') || [])].find((m) => (m.getAttribute('aria-label') || '').startsWith(e.card + ' '));
            if (mini) { const n = document.createElement('span'); n.className = 'cb-float dmg bench psn'; n.textContent = `-${e.dmg}`; mini.append(n); setTimeout(() => n.remove(), 1100); }
          } else pop(e.p, `☠️-${e.dmg}`, 'dmg psn');
        }, t);
        t += 120;
      }
    });
  }
  function choose(a) { if (chosen || ended) return; chosen = true; wsSend({ t: 'act', ...a }); render(); }
  function waiting(msg, extra = '') {
    if (!box()) return;
    box().innerHTML = `<div class="cb-wait"><span class="md-spin"></span><p>${msg}</p>${extra}<button class="btn btn-ghost" type="button" id="cb-cancel">やめる</button></div>`;
    $('#cb-cancel').addEventListener('click', () => { wsSend({ t: 'cancel' }); location.hash = '#/games/cards'; });
  }
  function end(m) {
    ended = true; clearInterval(tick); state = m.state || state; render();
    const word = m.result === 'win' ? '勝ち！' : m.result === 'lose' ? '負け…' : '引き分け';
    box().insertAdjacentHTML('beforeend', `<div class="cb-end ${m.result}"><b>${word}</b>
      <p>${m.reason === 'surrender' ? (m.result === 'win' ? '相手がこうさんしました' : 'こうさんしました') : m.reason === 'left' ? (m.result === 'win' ? '相手がいなくなりました' : '接続が切れたため負けになりました') : ''}</p>
      <p class="cb-gain">${m.scrolls ? `📜 レベルアップ書 +${m.scrolls} · ` : ''}${m.coins ? `+${m.coins}🪙` : '今日の報酬は上限に達しています'}${m.rating ? ` · レート ${m.rating.now} (${m.rating.delta >= 0 ? '+' : ''}${m.rating.delta})` : ''}</p>
      ${m.questCopy ? (m.questCopy.lrUp ? `<div class="cb-lrup"><p class="cb-lr-shout">🌈 LR に昇格！！ 🌈</p><div class="cb-qreward-card">${cbCard(m.questCopy.lr, { level: 1, cls: 'tilt' })}</div><p>${esc(m.questCopy.name)} が <b class="cb-lr-word">LR</b> になった！ (能力 +${cbCatalogCache?.lrPromote?.bonus || 35}%)</p></div>`
        : `<p class="cb-lr-get">🎴 ${esc(m.questCopy.name)} を 1 枚ゲット！ <span>${m.questCopy.copies >= m.questCopy.need ? '🌈 LR 昇格ずみ' : `🌈 LR まで ${m.questCopy.copies}/${m.questCopy.need}`}</span></p>`) : ''}
      ${m.questReward ? `<div class="cb-qreward"><p class="cb-mr-shout">🎉 クエストクリア！</p><div class="cb-qreward-card">${cbCard(m.questReward, { level: 1, cls: 'tilt' })}</div>
        <p><em class="cb-mr-word">MR</em>「${esc(m.questReward.name)}」が仲間になった！<br><small>わざ「${esc(m.questReward.skillName)}」${esc(m.questReward.skillDesc)}</small></p></div>`
        : m.quest && m.result === 'win' && !m.questCopy ? '<p class="text-sm">クエストはクリアずみです (報酬のカードは 1 回だけ)</p>' : ''}
      <div class="md-actions">${fromBoard ? '<a class="btn btn-primary" href="#/games/cards/board">掲示板にもどる</a><a class="btn btn-ghost" href="#/games/cards">ゲームのホーム</a>' : `<a class="btn btn-primary" href="#/games/cards/battle?mode=${esc(mode === 'room-join' ? 'room-create' : mode)}${mode === 'quest' ? `&q=${encodeURIComponent(questId)}` : ''}${mode === 'oni' && oniDeck ? `&deck=${encodeURIComponent(oniDeck)}` : ''}&n=${Date.now()}">もう一度</a><a class="btn btn-ghost" href="${mode === 'quest' ? '#/games/cards/quest' : mode === 'oni' ? '#/games/cards/oni' : '#/games/cards'}">もどる</a>`}</div></div>`);
    if (m.questReward) { cbCatalogCache = null; const q = box().querySelector('.cb-qreward'); if (q) { cbConfetti(q, 140, ['#ff6bd6', '#ffd43b', '#63e6be', '#4dabf7', '#b197fc', '#fff']); setTimeout(() => cbConfetti(q, 90, ['#ffe066', '#fff', '#d0a8ff']), 700); } }
  }
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/cb`);
    ws.onopen = () => { if (!state) wsSend({ t: 'find', mode, code, quest: questId, deck: oniDeck, board }); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!box()) return;
      if (m.t === 'waiting' && m.board) return waiting('📋 掲示板で対戦相手を募集中…', `<p class="text-sm">この画面のまま待っていると、掲示板を見た人が対戦しに来ます (最大 ${Math.round((m.ms || 600000) / 60000)} 分)</p><div class="cb-code">${esc(m.code)}</div><p class="text-xs muted">部屋コードを友だちに教えて入ってもらうこともできます。ほかの画面に行くと、募集は取り消されます</p>`);
      if (m.t === 'waiting') return m.mode === 'room' ? waiting('友だちを待っています', `<div class="cb-code">${esc(m.code)}</div><p class="text-sm muted">この部屋コードを友だちに教えてください (「部屋コードで入る」に入力)</p>`) : waiting('対戦相手を探しています…');
      if (m.t === 'error') { box().innerHTML = emptyState({ icon: 'alert', title: m.msg, action: '<a class="btn btn-primary" href="#/games/cards">もどる</a>' }); closedByUs = true; ws.close(); return; }
      if (m.t === 'start') {
        you = m.you; players = m.players; state = m.state; ended = false; if (m.resumed) log.push('つなぎ直しました');
        if (m.items) { items = m.items; coins = m.coins; }
        if (m.quest?.bg && /^[a-z0-9-]+$/.test(m.quest.bg)) { box().classList.add('qbg'); box().style.setProperty('--qbg', `url("/bg/${m.quest.bg}.svg")`); } // 期間限定クエストの戦闘背景
        if (m.quest) { const h = $('.page-head h1'); if (h?.firstChild?.nodeType === 3) h.firstChild.nodeValue = `${m.quest.emoji || (m.quest.hard ? '⚡' : '🌠')} ${m.quest.name}`; }
        if (m.board) { fromBoard = true; const h = $('.page-head h1'); if (h?.firstChild?.nodeType === 3) h.firstChild.nodeValue = m.rated ? '📋 レート戦 (掲示板)' : '📋 掲示板の対戦';
          if (!m.resumed && m.vs && you === 1) log.push(`掲示板からのレート戦です (この相手とはこれまで ${m.vs.games} 戦 ${m.vs.wins} 勝 ${m.vs.losses} 敗)`);
          else if (!m.resumed) log.push('掲示板からのレート戦です'); }
        render();
        // 行動のボタンまで 1 画面に入るよう、バトルの枠を画面の上にそろえる
        const top = box().getBoundingClientRect().top + window.scrollY - ($('.topbar')?.offsetHeight || 0) - ($('.page-head')?.offsetHeight || 0) - 6;
        window.scrollTo({ top: Math.max(0, top) });
        return;
      }
      if (m.t === 'turn') { state = m.state; deadline = Date.now() + (m.deadline - Date.now()); chosen = !!m.chosen; picking = false; render(); clearInterval(tick); tick = setInterval(() => { const t = $('#cb-timer'); if (!t) return clearInterval(tick); if (!chosen && !ended) { const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); t.textContent = `のこり ${left}秒`; t.classList.toggle('hurry', left <= 5); } }, 250); return; }
      if (m.t === 'coins') { coins = m.coins; return; }
      if (m.t === 'itemError') { chosen = false; picking = false; toast(m.msg, 'error'); render(); return; }
      if (m.t === 'opponentReady') { const t = $('#cb-timer'); if (t && !chosen) t.textContent += ' · 相手は決めました'; return; }
      if (m.t === 'result') { m.events.forEach((e) => { const s = evText(e); if (s) log.push(s); }); state = m.state; render(); animate(m.events); return; }
      if (m.t === 'opponentLeft') { log.push(`相手の接続が切れました。${Math.round(m.ms / 1000)}秒もどらなければ、あなたの勝ちです`); render(); return; }
      if (m.t === 'opponentBack') { log.push('相手がもどってきました'); render(); return; }
      if (m.t === 'end') return end(m);
    };
    ws.onclose = () => { if (!closedByUs && !ended && box()) { log.push('接続が切れました。つなぎ直しています…'); setTimeout(() => { if (box() && !ended) connect(); }, 1500); } };
  }
  connect();
  viewCleanup = () => { closedByUs = true; clearInterval(tick); try { ws.close(); } catch {} };
}

// =====================================================================
// レート戦ポーカー (1 対 1 のテキサスホールデム)。お金・コインは賭けない。動くのはレートだけ
// カードを配る・勝ち負けを決めるのはサーバー。端末は「選んだ行動」を送るだけ
// =====================================================================
const PK_SUIT = { s: ['♠', 'blk'], h: ['♥', 'red'], d: ['♦', 'red'], c: ['♣', 'blk'] };
function pkCard(c, cls = '') {
  if (!c) return `<span class="pk-card back ${cls}"><span></span></span>`;
  const [sym, col] = PK_SUIT[c[1]] || ['?', 'blk'], r = c[0] === 'T' ? '10' : c[0];
  return `<span class="pk-card ${col} ${cls}" aria-label="${esc(sym + r)}"><b>${esc(r)}</b><i>${sym}</i><em>${sym}</em></span>`;
}
const PK_HANDS = ['ロイヤルフラッシュ', 'ストレートフラッシュ', 'フォーカード', 'フルハウス', 'フラッシュ', 'ストレート', 'スリーカード', 'ツーペア', 'ワンペア', 'ハイカード'];

async function viewPoker() {
  main.innerHTML = pageHead({ title: 'レート戦ポーカー', sub: '1対1のテキサスホールデム', back: '#/games' }) + `<div class="content stack" id="pk">${loadingBlock()}</div>`;
  let mine = null;
  try { if (me) mine = await api('/poker/me'); } catch {}
  const root = $('#pk'); if (!root) return;
  root.innerHTML = `
    <section class="card pk-hero">
      <div class="pk-hero-cards" aria-hidden="true">${pkCard('As', 'tilt1')}${pkCard('Kh', 'tilt2')}</div>
      <div><b>レート戦ポーカー</b><p>おたがい 1000 チップから。相手のチップを全部とったら勝ち。<br><b>お金やコインは賭けません</b>。勝ち負けで動くのはレートだけです。</p>
        ${mine ? `<div class="pk-rate"><span>あなたのレート</span><b>${mine.rating}</b><small>${mine.wins}勝 ${mine.losses}敗</small></div>` : ''}</div>
    </section>
    ${me ? `<section class="card card-pad"><div class="cb-modes">
        <a class="btn btn-primary btn-lg" href="#/games/poker/table?mode=random">${icon('globe')}ランダム対戦<small>レート戦</small></a>
        <a class="btn btn-outline" href="#/games/poker/table?mode=cpu">🤖 CPU と練習<small>レートは動きません</small></a>
        <a class="btn btn-outline" href="#/games/poker/table?mode=room-create">${icon('user-plus')}部屋を作って友だちと<small>レートは動きません</small></a>
        <form class="cb-join" id="pk-join"><input class="input" name="code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="部屋コード (4けた)" required><button class="btn btn-outline" type="submit">入る</button></form>
      </div></section>`
    : `<section class="card card-pad"><p style="margin:0 0 12px">ログインすると、オンライン対戦とレートのランキングに参加できます。</p><button class="btn btn-primary" type="button" id="pk-login">ログインして遊ぶ</button></section>`}
    <section class="card card-pad"><div class="panel-head"><h3>${icon('trend', 'ic-sm')}レート ランキング</h3><span class="text-xs muted">ランダム対戦の成績</span></div><div id="pk-rank">${loadingBlock()}</div></section>
    <section class="card card-pad cb-rules"><details><summary>${icon('sparkle', 'ic-sm')}ルールと役の強さ</summary><ul>
      <li>手札 2 枚と、場の 5 枚のうち、いちばん強い 5 枚の組み合わせで勝負します</li>
      <li>行動: <b>フォールド</b> (おりる) / <b>チェック</b> (賭けずに回す) / <b>コール</b> (同じだけ出す) / <b>ベット・レイズ</b> (上乗せ) / <b>オールイン</b> (全部)</li>
      <li>ブラインド (強制で出すチップ) は 5 ハンドごとに上がります。1 回の行動は 30 秒まで (過ぎるとチェック、できなければフォールド)</li>
      <li>役の強さ (強い順): ${PK_HANDS.join(' > ')}</li></ul></details></section>`;
  $('#pk-login')?.addEventListener('click', () => openAuth());
  $('#pk-join')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/games/poker/table?mode=room-join&code=' + encodeURIComponent(e.target.code.value.trim()); });
  try {
    const r = await api('/poker/ranking', { noAuthPrompt: true });
    const row = (x, mine2) => `<a class="md-row${mine2 ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}" href="#/u/${esc(x.user.username)}"><span class="md-rk">${x.rank}</span>${avatar(x.user, 'sm')}
      <span class="md-who"><b>${esc(x.user.displayName)}${adminBadge(x.user)}</b><small>@${esc(x.user.username)} · ${Number(x.wins)}勝${Number(x.losses)}敗</small></span><span class="md-pts">${Number(x.rating)}</span></a>`;
    const meIn = r.me && r.top.some((x) => x.user.id === r.me.user.id);
    const el = $('#pk-rank'); if (!el) return;
    el.innerHTML = r.top.length ? `<div class="md-list">${r.top.map((x) => row(x, me && x.user.id === me.id)).join('')}</div>${r.me && !meIn ? `<div class="md-list md-mine">${row(r.me, true)}</div>` : ''}`
      : '<p class="muted text-sm md-empty">まだだれもランダム対戦をしていません。</p>';
  } catch { const el = $('#pk-rank'); if (el) el.innerHTML = '<p class="muted text-sm">読み込めませんでした</p>'; }
}

async function viewPokerTable(params) {
  if (!requireLogin()) return;
  const mode = params.get('mode'), code = params.get('code') || '';
  const titles = { cpu: 'CPU と練習', random: 'ランダム対戦', 'room-create': '友だちと対戦', 'room-join': '友だちと対戦' };
  main.innerHTML = pageHead({ title: titles[mode] || 'ポーカー', sub: 'レート戦ポーカー', back: '#/games/poker' }) + `<div class="content"><section class="pk-table" id="pkt">${loadingBlock()}</section></div>`;
  const box = () => $('#pkt');
  let ws = null, players = [], st = null, deadline = 0, closed = false, ended = false, shownBoard = 0, raiseTo = 0, lastPot = 0, banner = null;
  const wsSend = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const seat = (who) => {
    const i = who === 'me' ? 0 : 1, u = players[i];
    const cards = who === 'me' ? st.myCards : (st.oppCards || (st.myCards.length ? [null, null] : []));
    const turn = st.turn === who;
    const left = turn && deadline ? Math.max(0, deadline - Date.now()) : 0;
    return `<div class="pk-seat ${who}${turn ? ' turn' : ''}${st.result && st.result.win === who ? ' won' : ''}">
      <div class="pk-who">${avatar(u, 'sm')}<span><b>${who === 'me' ? 'あなた' : esc(u.displayName)}</b><small>🪙 ${st.stacks[i].toLocaleString()}</small></span>
        ${st.button === who ? '<span class="pk-dealer" title="ディーラー (スモールブラインド)">D</span>' : ''}
        ${st.last[i] ? `<span class="pk-bubble">${esc(st.last[i])}</span>` : ''}</div>
      <div class="pk-hole">${cards.map((c, k) => pkCard(c, `${who === 'opp' && st.oppCards ? 'flip' : ''} d${k}`)).join('')}</div>
      ${who === 'me' && st.myHand ? `<span class="pk-hand">いまの役: <b>${esc(st.myHand)}</b></span>` : ''}
      ${st.bets[i] ? `<span class="pk-bet">${st.bets[i].toLocaleString()}</span>` : ''}
      ${turn ? `<span class="pk-timer"><i style="animation-duration:${left}ms"></i></span>` : ''}
    </div>`;
  };
  function actions() {
    const L = st.legal;
    if (!L || st.turn !== 'me') return `<div class="pk-actions wait">${st.result ? '' : st.turn === 'opp' ? '<span class="md-spin sm"></span>相手が考えています…' : ''}</div>`;
    const R = L.raise, potNow = st.pot;
    if (R) raiseTo = Math.min(R.max, Math.max(R.min, raiseTo || R.min));
    const preset = (f) => R ? Math.min(R.max, Math.max(R.min, st.bets[1] + Math.round((potNow + (L.call || 0)) * f))) : 0;
    return `<div class="pk-actions">
      <div class="pk-main">
        ${L.fold ? '<button class="btn btn-ghost btn-lg pk-fold" type="button" data-a="fold">フォールド</button>' : ''}
        ${L.check ? '<button class="btn btn-outline btn-lg" type="button" data-a="check">チェック</button>' : `<button class="btn btn-outline btn-lg" type="button" data-a="call">${L.call >= st.stacks[0] ? 'オールインでコール' : 'コール'} <small>${L.call.toLocaleString()}</small></button>`}
        ${R ? `<button class="btn btn-primary btn-lg pk-raise" type="button" data-a="raise">${raiseTo >= R.max ? 'オールイン' : R.isBet ? 'ベット' : 'レイズ'} <small id="pk-to">${raiseTo.toLocaleString()}</small></button>` : ''}
      </div>
      ${R ? `<div class="pk-sizer">
        <input type="range" id="pk-range" min="${R.min}" max="${R.max}" step="${Math.max(1, Math.floor(st.bb / 2))}" value="${raiseTo}" aria-label="賭ける額">
        <div class="pk-presets"><button type="button" data-to="${R.min}">最小</button><button type="button" data-to="${preset(0.5)}">½ポット</button><button type="button" data-to="${preset(1)}">ポット</button><button type="button" data-to="${R.max}">オールイン</button></div>
      </div>` : ''}
    </div>`;
  }
  function render() {
    if (!box() || !st) return;
    const newCards = st.board.length > shownBoard ? shownBoard : st.board.length;
    const potUp = st.pot > lastPot;
    box().innerHTML = `<div class="pk-info"><span>ハンド ${st.hand} · ブラインド ${st.sb}/${st.bb} (レベル${st.level})</span>${ended ? '' : '<button class="btn btn-ghost btn-sm" type="button" id="pk-surrender">こうさん</button>'}</div>
      ${seat('opp')}
      <div class="pk-felt">
        <div class="pk-pot${potUp ? ' up' : ''}">ポット <b>${st.pot.toLocaleString()}</b></div>
        <div class="pk-board">${[0, 1, 2, 3, 4].map((k) => st.board[k] ? pkCard(st.board[k], k >= newCards ? `deal d${k - newCards}` : '') : '<span class="pk-slot"></span>').join('')}</div>
        ${banner || ''}
      </div>
      ${seat('me')}
      ${ended ? '' : actions()}`;
    shownBoard = st.board.length; lastPot = st.pot;
    $$('[data-a]', box()).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      wsSend(a === 'raise' ? { t: 'act', a, to: raiseTo } : { t: 'act', a });
      $$('.pk-actions button', box()).forEach((x) => { x.disabled = true; });
    }));
    const range = $('#pk-range');
    const setTo = (v) => { const R = st.legal.raise; raiseTo = Math.min(R.max, Math.max(R.min, Math.round(Number(v)))); if (range) range.value = raiseTo; const t = $('#pk-to'); if (t) t.textContent = raiseTo.toLocaleString(); const btn = $('.pk-raise'); if (btn) btn.firstChild.textContent = (raiseTo >= R.max ? 'オールイン' : R.isBet ? 'ベット' : 'レイズ') + ' '; };
    range?.addEventListener('input', () => setTo(range.value));
    $$('[data-to]', box()).forEach((b) => b.addEventListener('click', () => setTo(b.dataset.to)));
    $('#pk-surrender')?.addEventListener('click', async () => { if (await confirmDialog({ title: 'こうさんしますか？', body: 'この試合は負けになります。', ok: 'こうさんする', danger: true })) wsSend({ t: 'surrender' }); });
  }
  function onState(s, dl) {
    const before = st;
    st = s; deadline = dl ? Date.now() + Math.max(0, dl - Date.now()) : 0;
    if (!before || before.hand !== s.hand) { shownBoard = 0; raiseTo = 0; banner = null; }
    if (s.result && !(before && before.result && before.hand === s.hand)) {
      const r = s.result;
      const txt = r.win === 'me' ? `あなたの勝ち！ +${r.pot.toLocaleString()}` : r.win === 'opp' ? '相手の勝ち' : '引き分け';
      const why = r.showdown ? `${r.myHandName ? 'あなた: ' + r.myHandName : ''}${r.oppHandName ? ' / 相手: ' + r.oppHandName : ''}` : r.folded === 'me' ? 'フォールドしました' : '相手がフォールドしました';
      banner = `<div class="pk-banner ${r.win}"><b>${esc(txt)}</b><small>${esc(why)}</small></div>`;
      if (r.win === 'me' && r.showdown && ['フルハウス', 'フォーカード', 'ストレートフラッシュ', 'ロイヤルフラッシュ', 'フラッシュ'].includes(r.myHandName)) setTimeout(() => box() && cbConfetti(box(), 50), 200);
    }
    render();
  }
  function end(m) {
    ended = true; render();
    const word = m.result === 'win' ? '勝ち！' : '負け…';
    const why = m.reason === 'surrender' ? (m.result === 'win' ? '相手がこうさんしました' : 'こうさんしました') : m.reason === 'left' ? (m.result === 'win' ? '相手がいなくなりました' : '接続が切れたため負けになりました') : `${m.hands}ハンドで決着`;
    box().insertAdjacentHTML('beforeend', `<div class="cb-end ${m.result}"><b>${word}</b><p>${esc(why)}</p>
      <p class="cb-gain">${m.rating ? `レート ${m.rating.now} (${m.rating.delta >= 0 ? '+' : ''}${m.rating.delta})` : 'この対戦ではレートは動きません'}</p>
      <div class="md-actions"><a class="btn btn-primary" href="#/games/poker/table?mode=${esc(mode === 'room-join' ? 'room-create' : mode)}&n=${Date.now()}">もう一度</a><a class="btn btn-ghost" href="#/games/poker">もどる</a></div></div>`);
    if (m.result === 'win') cbConfetti(box(), 70);
  }
  function waiting(msg, extra = '') {
    if (!box()) return;
    box().innerHTML = `<div class="cb-wait"><span class="md-spin"></span><p>${msg}</p>${extra}<button class="btn btn-ghost" type="button" id="pk-cancel">やめる</button></div>`;
    $('#pk-cancel').addEventListener('click', () => { wsSend({ t: 'cancel' }); location.hash = '#/games/poker'; });
  }
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pk`);
    ws.onopen = () => { if (!st) wsSend({ t: 'find', mode, code }); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!box()) return;
      if (m.t === 'waiting') return m.mode === 'room' ? waiting('友だちを待っています', `<div class="cb-code">${esc(m.code)}</div><p class="text-sm muted">この部屋コードを友だちに教えてください</p>`) : waiting('対戦相手を探しています…');
      if (m.t === 'error') { box().innerHTML = emptyState({ icon: 'alert', title: m.msg, action: '<a class="btn btn-primary" href="#/games/poker">もどる</a>' }); closed = true; ws.close(); return; }
      if (m.t === 'start') {
        players = m.players; ended = false;
        const top = box().getBoundingClientRect().top + window.scrollY - ($('.topbar')?.offsetHeight || 0) - ($('.page-head')?.offsetHeight || 0) - 6;
        window.scrollTo({ top: Math.max(0, top) });
        return;
      }
      if (m.t === 'state') return onState(m.state, m.deadline);
      if (m.t === 'opponentLeft') { toast(`相手の接続が切れました。${Math.round(m.ms / 1000)}秒もどらなければ、あなたの勝ちです`); return; }
      if (m.t === 'opponentBack') { toast('相手がもどってきました'); return; }
      if (m.t === 'end') return end(m);
    };
    ws.onclose = () => { if (!closed && !ended && box()) setTimeout(() => { if (box() && !ended) connect(); }, 1500); };
  }
  connect();
  viewCleanup = () => { closed = true; try { ws.close(); } catch {} };
}

// =====================================================================
// 117万分の1 競走馬版: 図鑑の馬でレース。レースはサーバーが計算し、端末は同じ映像を再生するだけ
// =====================================================================
const RC_LABEL_COL = { UR: '#c2255c', SSR: '#e67700', SR: '#1971c2', R: '#2b8a3e', N: '#868e96', CPU: '#495057' };
const rcTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
async function viewRace() {
  if (!requireLogin()) return;
  main.innerHTML = pageHead({ title: 'レース', sub: '117万分の1 競走馬版 · 図鑑の馬で走る', back: '#/horse' }) + `<div class="content stack" id="rc">${loadingBlock()}</div>`;
  let data, sel = null, style = 'senko', ws = null, closed = false, raf = 0, timer = 0;
  try { data = await api('/race/horses'); } catch (e) { $('#rc').innerHTML = emptyState({ icon: 'alert', title: e.message }); return; }
  const root = () => $('#rc');
  const D = Object.fromEntries(data.distances.map((d) => [d.m, d.name]));
  const bar = (label, v) => `<span class="rc-stat"><small>${label}</small><i><b style="width:${Math.max(4, Math.min(100, (v - 40) / 70 * 100))}%"></b></i><em>${v}</em></span>`;
  const horseCard = (h) => `<button type="button" class="rc-hcard${sel === h.sid ? ' on' : ''}" data-sid="${esc(h.sid)}">
      <span class="rc-badge" style="--c:${RC_LABEL_COL[h.label]}">${esc(h.label)}</span>
      <b>${esc(h.name)}</b><small>${esc(h.headline)}${h.breed !== h.headline ? ' · ' + esc(h.breed) : ''}</small>
      ${bar('スピード', h.stats.speed)}${bar('スタミナ', h.stats.stamina)}${bar('末脚', h.stats.kick)}${bar('根性', h.stats.guts)}
      <small class="rc-best">得意: ${esc(D[h.stats.best] || '')} (${h.stats.best}m)</small></button>`;
  viewCleanup = () => { closed = true; cancelAnimationFrame(raf); clearInterval(timer); try { ws?.close(); } catch {} };

  // ---------- 馬と脚質をえらぶ ----------
  function pick(msg = '') {
    cancelAnimationFrame(raf); clearInterval(timer);
    if (!data.horses.length) {
      root().innerHTML = `<section class="card card-pad">${emptyState({ icon: 'sparkle', title: 'レースに出られる馬がまだいません', text: 'IppO にログインしたまま「117万分の1 競走馬版」で生まれた馬が、レースに出られます。', action: '<a class="btn btn-primary" href="#/horse">馬を生みに行く</a>' })}</section>`;
      return loadSide();
    }
    if (!sel || !data.horses.some((h) => h.sid === sel)) sel = data.horses[0].sid;
    root().innerHTML = `
      <section class="card card-pad rc-me"><div><span>あなたのレート</span><b>${data.me.rating}</b><small>${data.me.races}戦 ${data.me.wins}勝</small></div>
        <p class="text-xs muted">2 人以上が同じレースを走ると、着順でレートが動きます。</p></section>
      ${msg ? `<p class="md-note md-err">${esc(msg)}</p>` : ''}
      <section class="card card-pad"><div class="panel-head"><h3>出走する馬 (${data.horses.length}頭)</h3></div>
        <div class="rc-horses">${data.horses.map(horseCard).join('')}</div>
        <p class="text-xs muted">強さは、その馬の成績・品種から決まります (図鑑の記録ではなく、サーバーが計算し直した成績を使います)。</p></section>
      <section class="card card-pad"><div class="panel-head"><h3>脚質 (走り方)</h3></div>
        <div class="segmented rc-styles">${Object.entries(data.styles).map(([k, v]) => `<button type="button" class="seg${style === k ? ' active' : ''}" data-style="${k}">${esc(v.name)}</button>`).join('')}</div>
        <p class="text-sm rc-style-desc">${esc(data.styles[style].desc)}</p></section>
      <div class="rc-go">
        <button class="btn btn-primary btn-lg" type="button" id="rc-online">🏇 オンラインレースに出る<small>最大8頭 · みんなと同じレース</small></button>
        <button class="btn btn-outline btn-lg" type="button" id="rc-cpu">🤖 CPU と練習<small>レートは動きません</small></button>
      </div>
      <div id="rc-side"></div>`;
    $$('.rc-hcard', root()).forEach((b) => b.addEventListener('click', () => { sel = b.dataset.sid; $$('.rc-hcard', root()).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-style]', root()).forEach((b) => b.addEventListener('click', () => { style = b.dataset.style; $$('[data-style]', root()).forEach((x) => x.classList.toggle('active', x === b)); $('.rc-style-desc').textContent = data.styles[style].desc; }));
    $('#rc-online').addEventListener('click', () => enter('online'));
    $('#rc-cpu').addEventListener('click', () => enter('cpu'));
    loadSide();
  }
  async function loadSide() {
    let rk = null, hist = null;
    try { [rk, hist] = await Promise.all([api('/race/ranking', { noAuthPrompt: true }), api('/race/history')]); } catch { return; }
    const el = $('#rc-side') || (root() && root().insertAdjacentHTML('beforeend', '<div id="rc-side"></div>'), $('#rc-side'));
    if (!el) return;
    const row = (x, mine) => `<a class="md-row${mine ? ' me' : ''}${x.rank <= 3 ? ' top' + x.rank : ''}" href="#/u/${esc(x.user.username)}"><span class="md-rk">${x.rank}</span>${avatar(x.user, 'sm')}
      <span class="md-who"><b>${esc(x.user.displayName)}${adminBadge(x.user)}</b><small>@${esc(x.user.username)} · ${Number(x.races)}戦${Number(x.wins)}勝</small></span><span class="md-pts">${Number(x.rating)}</span></a>`;
    const meIn = rk.me && rk.top.some((x) => x.user.id === rk.me.user.id);
    el.innerHTML = `<section class="card card-pad"><div class="panel-head"><h3>${icon('trend', 'ic-sm')}レース レート ランキング</h3></div>
        ${rk.top.length ? `<div class="md-list">${rk.top.map((x) => row(x, x.user.id === me.id)).join('')}</div>${rk.me && !meIn ? `<div class="md-list md-mine">${row(rk.me, true)}</div>` : ''}` : '<p class="muted text-sm md-empty">まだだれもオンラインレースで対戦していません。</p>'}</section>
      ${hist.results.length ? `<section class="card card-pad"><div class="panel-head"><h3>最近のレース</h3></div><div class="rc-hist">${hist.results.map((r) => `<div><b class="rc-place p${r.place}">${r.place}着</b><span>${esc(r.horse)}<small>${r.distance}m · ${rcTime(r.time)} · ${r.field}頭</small></span>${r.rating_delta ? `<em class="${r.rating_delta > 0 ? 'up' : 'down'}">${r.rating_delta > 0 ? '+' : ''}${r.rating_delta}</em>` : ''}</div>`).join('')}</div></section>` : ''}`;
  }

  // ---------- 出走 ----------
  function enter(mode) {
    root().innerHTML = `<section class="card rc-stage"><div class="cb-wait"><span class="md-spin"></span><p>ゲートに向かっています…</p></div></section>`;
    window.scrollTo(0, 0);
    try { ws?.close(); } catch {}
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rc`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'enter', mode, sid: sel, style }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!root()) return;
      if (m.t === 'error') return pick(m.msg);
      if (m.t === 'lobby') return lobby(m.lobby, m.serverNow);
      if (m.t === 'race') return play(m.race, m.you, m.result);
    };
    ws.onclose = () => {};
  }
  function lobby(l, serverNow) {
    const end = Date.now() + (l.closesAt - serverNow);
    const draw = () => {
      const st = $('.rc-stage'); if (!st) return clearInterval(timer);
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      st.innerHTML = `<div class="rc-lobby"><p class="rc-dist">${l.distance}m <small>${esc(D[l.distance] || '')}</small></p>
        <p class="rc-count">発走まで <b>${left}</b> 秒</p>
        <div class="rc-gates">${Array.from({ length: 8 }, (_, i) => { const e = l.entries[i]; return e ? `<div class="rc-gate on">${avatar(e.user, 'sm')}<span><b>${esc(e.horse)}</b><small>${esc(e.user.displayName)} · ${esc(e.style)}</small></span><span class="rc-badge" style="--c:${RC_LABEL_COL[e.label]}">${esc(e.label)}</span></div>` : `<div class="rc-gate">空き (CPU の馬が入ります)</div>`; }).join('')}</div>
        <p class="text-xs muted">ほかの人がこのページから出走すると、同じレースに入ります。</p>
        <button class="btn btn-ghost btn-sm" type="button" id="rc-leave">出走をやめる</button></div>`;
      $('#rc-leave').addEventListener('click', () => { try { ws.send(JSON.stringify({ t: 'leave' })); ws.close(); } catch {} pick(); });
    };
    clearInterval(timer); draw(); timer = setInterval(draw, 500);
  }

  // ---------- レースの再生 ----------
  function play(race, you, result) {
    clearInterval(timer);
    const n = race.horses.length, F = race.frames, perFrame = 210, total = (F.length - 1) * perFrame;
    const marks = []; for (let m = 200; m < race.distance; m += 200) marks.push(m);
    $('.rc-stage').outerHTML = `<section class="card rc-stage racing">
      <div class="rc-head"><b>${race.distance}m ${esc(D[race.distance] || '')}</b><span>${race.practice ? '練習 (CPU)' : race.rated ? 'レート戦' : 'オンライン'}</span><span id="rc-left"></span></div>
      <div class="rc-call" id="rc-call">ゲートが開きます…</div>
      <div class="rc-track" id="rc-track">
        ${marks.map((m) => `<i class="rc-mark" data-f="${m / race.distance}"><span>${race.distance - m}</span></i>`).join('')}<i class="rc-finish"></i>
        ${race.horses.map((h, i) => `<div class="rc-lane${i === you ? ' you' : ''}"><div class="rc-horse" data-i="${i}"><span class="rc-silk" style="--c:${h.silk}">${h.gate}</span><span class="rc-emoji">🏇</span><span class="rc-name">${esc(h.name)}${i === you ? ' (あなた)' : ''}</span></div></div>`).join('')}
      </div>
      <ol class="rc-board" id="rc-board"></ol>
    </section>`;
    const track = $('#rc-track'), els = $$('.rc-horse', track), board = $('#rc-board');
    // 馬の鼻先 (左から 4px + 馬の幅 46px) が、ゴールでちょうどゴール板に着くように目印を置く
    const NOSE = 50, W0 = () => track.clientWidth - 64;
    $$('.rc-mark', track).forEach((mk) => { mk.style.left = `${NOSE + Number(mk.dataset.f) * W0()}px`; });
    $('.rc-finish', track).style.left = `${NOSE + W0()}px`;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start = performance.now() + 900, lastLeader = -1, saidStraight = false, lastBoard = 0;
    const call = (t) => { const c = $('#rc-call'); if (c && c.textContent !== t) { c.textContent = t; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } };
    const step = (now) => {
      if (!$('#rc-track')) return;
      const t = reduced ? total : Math.max(0, now - start);
      const k = Math.min(F.length - 1, t / perFrame), a = Math.floor(k), b = Math.min(F.length - 1, a + 1), f = k - a;
      const W = track.clientWidth - 64;
      const pos = race.horses.map((_, i) => (F[a][i] + (F[b][i] - F[a][i]) * f) / 1000);
      els.forEach((el, i) => { el.style.transform = `translateX(${pos[i] * W}px)`; el.classList.toggle('run', t > 0 && pos[i] < 1); });
      // 同じ位置 (ゴールした馬どうしなど) は、正式な着順で並べる
      const rankOf = new Map(race.order.map((i, k) => [i, k]));
      const order = pos.map((p, i) => [p, i]).sort((x, y) => y[0] - x[0] || rankOf.get(x[1]) - rankOf.get(y[1])).map(([, i]) => i);
      const leader = order[0], fl = pos[leader];
      if (t === 0) call('スタート！');
      else if (fl >= 1) call(`${race.horses[race.order[0]].name}、1着でゴール！`);
      else if (fl > 0.72 && !saidStraight) { saidStraight = true; call(`最後の直線！ 先頭は${race.horses[leader].name}！`); }
      else if (leader !== lastLeader && fl > 0.08) call(`${fl > 0.72 ? '' : '先頭は'}${race.horses[leader].name}${fl > 0.72 ? 'が先頭に立った！' : ''}`);
      lastLeader = leader;
      $('#rc-left').textContent = fl >= 1 ? 'ゴール' : `残り ${Math.max(0, Math.round(race.distance * (1 - fl)))}m`;
      if (now - lastBoard > 250) { lastBoard = now; board.innerHTML = order.map((i, p) => `<li class="${i === you ? 'you' : ''}"><span class="rc-silk sm" style="--c:${race.horses[i].silk}">${race.horses[i].gate}</span>${p + 1}. ${esc(race.horses[i].name)}</li>`).join(''); }
      if (t < total + 200) raf = requestAnimationFrame(step); else setTimeout(() => results(race, you, result), 700);
    };
    raf = requestAnimationFrame(step);
  }
  function results(race, you, result) {
    const st = $('.rc-stage'); if (!st) return;
    const win = race.times[race.order[0]];
    st.insertAdjacentHTML('beforeend', `<div class="rc-result">
      <div class="rc-mine p${result.place}"><b>${result.place}着</b><span>${result.field}頭中 · ${rcTime(result.time)}</span>
        ${race.rated ? `<em>レート ${result.rating} (${result.ratingDelta >= 0 ? '+' : ''}${result.ratingDelta})</em>` : '<em>この レースでは レートは動きません</em>'}</div>
      <ol class="rc-final">${race.order.map((i, p) => { const h = race.horses[i]; return `<li class="${i === you ? 'you' : ''}"><b class="rc-place p${p + 1}">${p + 1}</b><span class="rc-silk sm" style="--c:${h.silk}">${h.gate}</span>
        <span class="rc-fname"><b>${esc(h.name)}</b><small>${h.user ? esc(h.user.displayName) : 'CPU'} · ${esc(h.style)}</small></span><span class="rc-ftime">${rcTime(race.times[i])}${p ? `<small>+${(race.times[i] - win).toFixed(1)}</small>` : ''}</span></li>`; }).join('')}</ol>
      <div class="md-actions"><button class="btn btn-primary" type="button" id="rc-again">同じ馬でもう一度</button><button class="btn btn-ghost" type="button" id="rc-back">馬をえらび直す</button></div></div>`);
    if (result.place === 1) cbConfetti(st, 80);
    $('#rc-again').addEventListener('click', () => enter(race.practice ? 'cpu' : 'online'));
    $('#rc-back').addEventListener('click', async () => { try { data = await api('/race/horses'); } catch {} pick(); });
    st.scrollIntoView({ block: 'nearest' });
  }
  pick();
}
