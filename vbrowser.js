// 仮想ブラウザ (Remote Browser Isolation)
// ・外部サイトはサーバー側の使い捨て Chromium コンテキストで描画する
// ・利用者の端末には画面の JPEG フレームだけが届き、サイトのコードは一切実行されない
// ・操作 (クリック/キー/スクロール) は WebSocket 経由でサーバーに中継する
// ・閉じるとコンテキストごと破棄 (Cookie・キャッシュ・ストレージも残らない)
const { chromium } = require('playwright');
const dns = require('dns').promises;
const net = require('net');

const DESKTOP = { width: 1280, height: 720 };
// スマホから開いた場合はスマホ版のサイトを表示する (Android Chrome として振る舞う)
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// 利用者が選んだ表示モード (スマホ版 / PC版) と画面サイズから、仮想ブラウザの表示サイズを決める
function pickViewport(opts = {}) {
  const clamp = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || d));
  if (opts.mobile) {
    return { viewport: { width: clamp(opts.width, 320, 600, 390), height: clamp(opts.height, 400, 1000, 700) }, mobile: true, scale: 2 };
  }
  return { viewport: { width: clamp(opts.width, 800, DESKTOP.width, DESKTOP.width), height: clamp(opts.height, 500, 2000, DESKTOP.height) }, mobile: false, scale: 1 };
}
const MAX_SESSIONS = Number(process.env.VB_MAX_SESSIONS || 4);
const SESSION_TTL_MS = Number(process.env.VB_TTL_MS || 10 * 60 * 1000);
const IDLE_MS = 3 * 60 * 1000;

// ---- SSRF 対策: 内部ネットワーク宛のリクエストを遮断 ----
const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]])
  blocked.addSubnet(a, p, 'ipv6');

function isBlockedIp(ip) {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) ip = m[1];
  return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

const hostCache = new Map();
const ALLOW_PRIVATE = process.env.VB_ALLOW_PRIVATE === '1'; // 開発用: 内部アドレスを許可
async function isSafeHost(host) {
  if (ALLOW_PRIVATE) return true;
  host = host.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(host) || /\.(localhost|local|internal)$/i.test(host)) return false;
  if (net.isIP(host)) return !isBlockedIp(host);
  const hit = hostCache.get(host);
  if (hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isBlockedIp(a.address));
  } catch { ok = false; }
  hostCache.set(host, { ok, exp: Date.now() + 60_000 });
  return ok;
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}

// ---- ブラウザ本体 (プロセスは共有、セッションごとに独立コンテキスト) ----
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--disable-dev-shm-usage'] }).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

const sessions = new Set();

class VirtualSession {
  constructor(ws, opts) {
    this.ws = ws;
    Object.assign(this, pickViewport(opts));
    this.closed = false;
    this.page = null;
    this.cdp = null;
    this.lastActive = Date.now();
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  async start(url) {
    const browser = await getBrowser();
    this.context = await browser.newContext({
      viewport: this.viewport,
      ...(this.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: this.scale, userAgent: MOBILE_UA } : {}),
      acceptDownloads: false,
      serviceWorkers: 'block',
      permissions: [],
      locale: 'ja-JP',
    });
    // 全リクエストを検査して内部アドレスを遮断
    await this.context.route('**/*', async (route) => {
      try {
        const u = new URL(route.request().url());
        if ((u.protocol === 'http:' || u.protocol === 'https:') && !(await isSafeHost(u.hostname))) {
          if (route.request().isNavigationRequest()) this.send({ t: 'notice', msg: `ブロックしました: ${u.hostname} (内部ネットワーク)` });
          return route.abort('blockedbyclient');
        }
      } catch {}
      return route.continue().catch(() => {});
    });
    // WebSocket も同様に検査
    await this.context.routeWebSocket(/.*/, async (wsRoute) => {
      try {
        const u = new URL(wsRoute.url());
        if (!(await isSafeHost(u.hostname))) return wsRoute.close();
      } catch { return wsRoute.close(); }
      wsRoute.connectToServer();
    }).catch(() => {});
    // ポップアップ (target=_blank 等) は同じ画面に切り替える
    this.context.on('page', (p) => { if (p !== this.page) this.attach(p, true); });

    const page = await this.context.newPage();
    await this.attach(page, false);
    this.ttl = setTimeout(() => this.close('制限時間に達したためセッションを終了しました'), SESSION_TTL_MS);
    this.idle = setInterval(() => {
      if (Date.now() - this.lastActive > IDLE_MS) this.close('一定時間操作がなかったため終了しました');
    }, 15_000);
    await this.navigate(url);
  }

  async attach(page, isPopup) {
    if (this.closed) return page.close().catch(() => {});
    const old = this.page;
    const oldCdp = this.cdp;
    this.page = page;
    page.on('dialog', (d) => { this.send({ t: 'notice', msg: `ダイアログ: ${d.message().slice(0, 200)}` }); d.dismiss().catch(() => {}); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) this.pushState(); });
    page.on('load', () => this.pushState());
    page.on('close', () => { if (this.page === page && !this.closed) this.close('ページが閉じられました'); });

    const cdp = await this.context.newCDPSession(page);
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      // 通信が詰まっている時はフレームを間引く
      if (this.ws.readyState === 1 && this.ws.bufferedAmount < 1_500_000) this.ws.send(Buffer.from(data, 'base64'));
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 70, maxWidth: this.viewport.width * this.scale, maxHeight: this.viewport.height * this.scale, everyNthFrame: 1,
    });
    if (old && isPopup) {
      if (oldCdp) oldCdp.detach().catch(() => {});
      old.removeAllListeners('close');
      old.close().catch(() => {});
      this.send({ t: 'notice', msg: '新しいウィンドウを開きました' });
    }
    this.pushState();
  }

  async pushState() {
    if (!this.page || this.closed) return;
    let title = '';
    try { title = await this.page.title(); } catch {}
    this.send({ t: 'state', url: this.page.url(), title });
  }

  async navigate(raw) {
    const url = normalizeUrl(raw);
    if (!url) return this.send({ t: 'notice', msg: 'http/https の URL のみ開けます' });
    if (!(await isSafeHost(new URL(url).hostname))) return this.send({ t: 'notice', msg: '内部ネットワークのアドレスは開けません' });
    this.send({ t: 'loading', url });
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      this.send({ t: 'notice', msg: '読み込みに失敗しました: ' + String(e.message).split('\n')[0].slice(0, 160) });
    }
    this.pushState();
  }

  // 操作は到着順に1つずつ実行する (並列だとクリック前に文字が入る等の順序ずれが起きる)
  handle(msg) {
    this.queue = (this.queue || Promise.resolve()).then(() => this.exec(msg));
  }

  async exec(msg) {
    if (this.closed || !this.page) return;
    this.lastActive = Date.now();
    const p = this.page;
    const clampX = (v) => Math.max(0, Math.min(this.viewport.width, Number(v) || 0));
    const clampY = (v) => Math.max(0, Math.min(this.viewport.height, Number(v) || 0));
    const button = ['left', 'middle', 'right'].includes(msg.button) ? msg.button : 'left';
    try {
      switch (msg.t) {
        case 'move': await p.mouse.move(clampX(msg.x), clampY(msg.y)); break;
        case 'down': await p.mouse.move(clampX(msg.x), clampY(msg.y)); await p.mouse.down({ button }); break;
        case 'up':
          await p.mouse.move(clampX(msg.x), clampY(msg.y)); await p.mouse.up({ button });
          this.reportFocus();
          break;
        case 'wheel':
          await p.mouse.move(clampX(msg.x), clampY(msg.y));
          await p.mouse.wheel(Math.max(-2000, Math.min(2000, Number(msg.dx) || 0)), Math.max(-2000, Math.min(2000, Number(msg.dy) || 0)));
          break;
        case 'key':
          if (typeof msg.key === 'string' && msg.key.length <= 40) await p.keyboard.press(msg.key);
          break;
        case 'text':
          if (typeof msg.text === 'string') await p.keyboard.insertText(msg.text.slice(0, 2000));
          break;
        case 'goto': await this.navigate(msg.url); break;
        case 'back': await p.goBack({ timeout: 15_000 }).catch(() => {}); this.pushState(); break;
        case 'forward': await p.goForward({ timeout: 15_000 }).catch(() => {}); this.pushState(); break;
        case 'reload': await p.reload({ timeout: 30_000 }).catch(() => {}); this.pushState(); break;
      }
    } catch { /* ページ遷移中の操作エラーは無視 */ }
  }

  // クリック後、フォーカスが文字入力できる要素にあるかを利用者側へ伝える (スマホのキーボード表示に使う)
  async reportFocus() {
    await new Promise((r) => setTimeout(r, 80));
    let editable = false;
    for (const frame of this.page.frames()) {
      try {
        editable = await frame.evaluate(() => {
          if (!document.hasFocus()) return false;
          let el = document.activeElement;
          while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
          if (!el) return false;
          if (el.isContentEditable) return true;
          if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
          if (el.tagName === 'INPUT') {
            const t = (el.type || 'text').toLowerCase();
            return !el.readOnly && !el.disabled && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(t);
          }
          return false;
        });
      } catch { editable = false; }
      if (editable) break;
    }
    this.send({ t: 'focus', editable });
  }

  async close(reason) {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this);
    clearTimeout(this.ttl);
    clearInterval(this.idle);
    if (reason) this.send({ t: 'ended', msg: reason });
    try { this.ws.close(); } catch {}
    if (this.context) await this.context.close().catch(() => {});
  }
}

function handleConnection(ws, startUrl, userId, opts) {
  // 同じユーザーの古いセッションは閉じる (1ユーザー1セッション)
  for (const old of sessions) if (old.userId === userId) old.close('別の画面で仮想ブラウザを開いたため終了しました');
  if (sessions.size >= MAX_SESSIONS) {
    ws.send(JSON.stringify({ t: 'ended', msg: '仮想環境が混み合っています。しばらくしてから再度お試しください' }));
    return ws.close();
  }
  const s = new VirtualSession(ws, opts);
  s.userId = userId;
  sessions.add(s);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    s.handle(msg);
  });
  ws.on('close', () => s.close());
  s.send({ t: 'hello', viewport: s.viewport, ttl: SESSION_TTL_MS });
  s.start(startUrl).catch((e) => {
    s.send({ t: 'ended', msg: '仮想環境の起動に失敗しました: ' + String(e.message).split('\n')[0] });
    s.close();
  });
}

async function shutdown() {
  await Promise.all([...sessions].map((s) => s.close()));
  if (browserPromise) (await browserPromise).close().catch(() => {});
}

// 特定ユーザーの仮想ブラウザを閉じる (緊急データ削除時)
function closeUser(userId) {
  for (const s of sessions) if (s.userId === userId) s.close('データ削除のため終了しました');
}

module.exports = { handleConnection, shutdown, normalizeUrl, isBlockedIp, isSafeHost, closeUser, ALLOW_PRIVATE };
