// IppO ベースボールのサービスワーカー (アプリとして開くため・範囲は /games/baseball/)
//   ・画面 (HTML) はネットワーク優先。つながらないときは前に開いた画面、それもなければ offline.html
//   ・JS・画像などのファイルは、キャッシュをすぐ出しつつ裏で新しくする
//   ・API (/api/)・ログイン・WebSocket はキャッシュしない (ゲームのデータや認証情報は保存しない)
const VER = 'bb-v1', SHELL = ['./offline.html', './icons/icon-192.png', './icons/apple-touch-icon.png', './manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bb-') && k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const res = await fetch(req); if (res.ok && url.pathname.startsWith('/games/baseball/')) { const c = await caches.open(VER); c.put(url.pathname, res.clone()); } return res; }
      catch { return (await caches.match(url.pathname)) || (await caches.match('./offline.html')) || Response.error(); }
    })());
    return;
  }
  if (!/\.(js|css|png|jpg|svg|webmanifest|woff2?)$/.test(url.pathname) || !url.pathname.startsWith('/games/')) return;
  e.respondWith((async () => {
    const c = await caches.open(VER), hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
