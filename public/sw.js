// IppO のサービスワーカー: Web プッシュ通知 (通話の着信) を受け取って通知を出す。画面のファイルのキャッシュはしない
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  if (d.kind !== 'call') return;
  e.waitUntil((async () => {
    // IppO が前に出ていれば、画面の中の着信だけで十分 (通知は出さない)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || '📞 IppO 着信', {
      body: d.body || '音声通話の着信です', tag: 'call-' + d.id, renotify: true, requireInteraction: true,
      icon: '/favicon.svg', badge: '/favicon.svg', vibrate: [400, 200, 400, 200, 400], data: { url: d.url || '/' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
    if (w) { await w.focus(); try { w.navigate ? await w.navigate(url) : null; } catch {} return; }
    await self.clients.openWindow(url);
  })());
});
