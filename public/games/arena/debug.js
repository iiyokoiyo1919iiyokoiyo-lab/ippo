// =====================================================================
// シティバトル: 開発者向けデバッグ画面 (管理者だけ。🐞 ボタン)
//   ・パニックレベル (街の 6×6 のエリア)・NPC の状態・警察と救急の出動状況・いまの事件・NPC の総数・サーバーの処理時間
//   ・テスト用: ここで事件 / ランダムに 3 か所 / 近くの人をけが人に / 事件を落ち着かせる
//   ・文字はすべて textContent で入れる (利用者の名前もエスケープされる)
// =====================================================================
const LEVEL = ['平常', '警戒', '不安', '混乱', 'パニック'], LCOL = ['#2b8a3e', '#94d82d', '#fab005', '#f76707', '#e03131'];
const STATE_JA = { patrolling: '巡回', dispatching: '出動準備', responding: '現場へ', investigating: '現場確認', securing: '安全確保', returning: '巡回へもどる',
  available: '待機', dispatched: '出動決定', driving: '現場へ', arrived: '到着', departing: '退出',
  walking: '歩く', alert: '警戒', fleeing: '逃げる', hiding: '隠れる', surrender: '手を上げる', treat: '処置', warn: '注意', carry: '運ぶ', staggered: '硬直', downed: '転倒', incap: '行動不能', dead: '死亡' };
const ja = (s) => STATE_JA[s] || s;

export class DebugPanel {
  constructor({ send, getPos }) {
    Object.assign(this, { send, getPos }); this.open = false;
    const b = document.createElement('button'); b.id = 'dbgbtn'; b.className = 'hud-btn'; b.textContent = '🐞'; b.setAttribute('aria-label', 'デバッグ'); b.hidden = true; document.body.append(b); this.btn = b;
    const el = document.createElement('div'); el.id = 'dbg'; el.hidden = true; document.body.append(el); this.el = el;
    b.onclick = () => this.toggle();
  }
  enable(admin) { this.btn.hidden = !admin; if (!admin && this.open) this.toggle(); }
  toggle() { this.open = !this.open; this.el.hidden = !this.open; this.send({ t: 'dbg', on: this.open }); if (document.pointerLockElement) document.exitPointerLock(); }
  cmd(k) { const p = this.getPos(); this.send({ t: 'dbgcmd', k, x: p.x, z: p.z }); }
  render(d) {
    if (!this.open) return;
    const el = this.el; el.textContent = '';
    const E = (tag, text, cls) => { const x = document.createElement(tag); if (text != null) x.textContent = text; if (cls) x.className = cls; return x; };
    const head = E('div', null, 'dbg-head'); head.append(E('b', '🐞 デバッグ'), E('span', `サーバー ${d.tickMs} ms/回・人 ${d.humans}`));
    const close = E('button', '✕', 'dbg-x'); close.onclick = () => this.toggle(); head.append(close); el.append(head);
    // テスト用のボタン
    const bar = E('div', null, 'dbg-bar');
    for (const [k, t] of [['panic', '💥 ここで事件'], ['random', '🎲 ランダムに 3 か所'], ['injure', '🚑 近くの人をけが人に'], ['clear', '🕊️ 落ち着かせる']]) { const b = E('button', t); b.onclick = () => this.cmd(k); bar.append(b); }
    el.append(bar);
    // まとめ
    const inc = d.incidents, n = d.npc;
    const sum = E('div', null, 'dbg-sum');
    for (const [k, v] of [['NPC の総数', `${n.total} (通行人 ${n.civilians}・警官 ${n.roles.police || 0}・隊員 ${n.roles.medic || 0})`], ['いまの事件', `${inc.length} 件`], ['パトカー出動中', `${d.services.police.filter((u) => u.state !== 'patrolling').length} / ${d.services.police.length}`], ['救急車出動中', `${d.services.ems.filter((a) => a.state !== 'available').length} / ${d.services.ems.length}`]]) { const r = E('div'); r.append(E('span', k), E('b', v)); sum.append(r); }
    el.append(sum);
    // パニックレベル (6×6。上が北 = z が小さい)
    el.append(E('h4', 'パニックレベル (街を 6×6 に分けたエリア)'));
    const grid = E('div', null, 'dbg-grid'), me = this.getPos(), G = 6, cell = (x) => Math.max(0, Math.min(G - 1, Math.floor((x + 69) / 23)));
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const l = d.panic[i * G + j], c = E('div', String(l)); c.style.background = LCOL[l]; c.title = `${LEVEL[l]} (熱さ ${d.heat[i * G + j]})`; if (cell(me.x) === i && cell(me.z) === j) c.classList.add('me'); grid.append(c); }
    el.append(grid);
    const lg = E('div', null, 'dbg-legend'); LEVEL.forEach((t, l) => { const s = E('span', `${l} ${t}`); s.style.borderColor = LCOL[l]; lg.append(s); }); el.append(lg);
    // NPC の状態
    el.append(E('h4', 'NPC の状態'));
    const st = E('div', null, 'dbg-tags'); for (const [k, v] of Object.entries(n.byState)) st.append(E('span', `${ja(k)} ${v}`)); el.append(st);
    const pe = E('div', null, 'dbg-tags'); for (const [k, v] of Object.entries(n.byPersona)) pe.append(E('span', `${{ timid: '臆病', calm: '冷静', curious: '好奇心', indifferent: '無関心' }[k] || k} ${v}`)); el.append(pe);
    // 警察・救急
    const table = (title, rows, cols) => { el.append(E('h4', title)); const t = E('table'); const tr = E('tr'); for (const c of cols) tr.append(E('th', c[0])); t.append(tr); for (const r of rows) { const x = E('tr'); for (const c of cols) x.append(E('td', String(c[1](r)))); t.append(x); } el.append(t); };
    table('🚓 警察', d.services.police, [['車', (u) => u.id], ['状態', (u) => ja(u.state)], ['事件', (u) => u.inc || '-'], ['人', (u) => u.crew], ['位置', (u) => `${u.x},${u.z}`]]);
    table('🚑 救急', d.services.ems, [['車', (a) => a.id], ['状態', (a) => ja(a.state) + (a.sub ? `・${a.sub}` : '')], ['事件', (a) => a.inc || '-'], ['収容', (a) => a.load], ['位置', (a) => `${a.x},${a.z}`]]);
    table('📋 事件', inc, [['id', (e) => e.id], ['種類', (e) => e.type], ['重さ', (e) => e.sev], ['経過', (e) => `${e.age}s`], ['静か', (e) => `${e.quiet}s${e.calm ? ' ✓' : ''}`], ['警察', (e) => e.police.join(',') || '-'], ['救急', (e) => e.ems || '-'], ['けが人', (e) => Object.values(e.victims).join(',') || '-']]);
    table('🧍 NPC (最初の 60 人)', n.sample, [['id', (x) => x.id], ['役', (x) => x.role || { timid: '臆病', calm: '冷静', curious: '好奇心', indifferent: '無関心' }[x.p] || x.p], ['行動', (x) => (x.hidden ? '車内' : ja(x.mode))], ['体', (x) => ja(x.st)], ['HP', (x) => x.hp], ['エリア', (x) => x.lvl], ['位置', (x) => `${x.x},${x.z}`]]);
    el.append(E('h4', 'ログ')); const lg2 = E('pre'); lg2.textContent = d.services.log.join('\n'); el.append(lg2);
  }
}
