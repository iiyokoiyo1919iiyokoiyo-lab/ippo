// =====================================================================
// シティバトル: 設定画面
//   ・この端末の設定 (localStorage): 画質・ラグドール・被弾リアクションの強さ・血・欠損・音
//   ・サーバーの設定 (管理者だけ変えられる。ほかの人は見るだけ): 一撃で倒れる・NPC の数/反応頻度/逃走頻度/最大同時処理数
//   ・文字はすべて textContent で入れる
// =====================================================================
const KEY = 'arena_settings';
export const LOCAL_DEFAULTS = { view: 'fps', ragdoll: true, reaction: 1, blood: true, dismember: true, sound: true };
export function loadLocal() { try { return { ...LOCAL_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...LOCAL_DEFAULTS }; } }
function saveLocal(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

export class Settings {
  constructor({ onLocal, onServer, quality, qualities, onQuality }) {
    this.local = loadLocal(); this.server = {}; this.admin = false;
    Object.assign(this, { onLocal, onServer, quality, qualities, onQuality });
    const el = document.createElement('div'); el.id = 'settings'; el.hidden = true; document.body.append(el); this.el = el;
  }
  set(k, v) { this.local[k] = v; saveLocal(this.local); this.onLocal?.(this.local); }
  setServer(cfg, admin) { this.server = { ...cfg }; if (admin != null) this.admin = !!admin; if (!this.el.hidden) this.render(); }
  open() { this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; }
  render() {
    const el = this.el; el.textContent = '';
    const box = document.createElement('div'); box.className = 'set-box'; el.append(box);
    const h = (t) => { const x = document.createElement('h3'); x.textContent = t; box.append(x); };
    const row = (label, ctrl, note) => { const r = document.createElement('label'); r.className = 'set-row'; const s = document.createElement('span'); s.textContent = label; r.append(s, ctrl); if (note) { const n = document.createElement('small'); n.textContent = note; r.append(n); } box.append(r); };
    const toggle = (val, fn, disabled) => { const b = document.createElement('input'); b.type = 'checkbox'; b.checked = !!val; b.disabled = !!disabled; b.onchange = () => fn(b.checked); return b; };
    const range = (val, min, max, step, fn, disabled, fmt = (v) => v) => { const w = document.createElement('span'); w.className = 'set-range'; const b = document.createElement('input'); b.type = 'range'; Object.assign(b, { min, max, step, value: val, disabled: !!disabled }); const o = document.createElement('output'); o.textContent = fmt(val); b.oninput = () => { o.textContent = fmt(b.value); }; b.onchange = () => fn(Number(b.value)); w.append(b, o); return w; };
    const L = this.local, setL = (k) => (v) => this.set(k, v);
    h('⚙️ この端末の設定');
    { const sel = document.createElement('select'); const QN = { low: '低', medium: '中', high: '高' }; for (const q of this.qualities) { const o = document.createElement('option'); o.value = q; o.textContent = QN[q] || q; if (q === this.quality) o.selected = true; sel.append(o); } sel.onchange = () => this.onQuality?.(sel.value); row('画質', sel, '変えると読みなおします'); }
    { const sel = document.createElement('select'); for (const [v, t] of [['fps', '一人称'], ['tps', '三人称']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (L.view === v) o.selected = true; sel.append(o); } sel.onchange = () => setL('view')(sel.value); row('視点', sel, 'V キーでも切りかえ'); }
    row('ラグドール (倒れるときの物理)', toggle(L.ragdoll, setL('ragdoll')));
    row('被弾リアクションの強さ', range(L.reaction, 0.3, 2, 0.1, setL('reaction'), false, (v) => `${Number(v).toFixed(1)}×`));
    row('血の表現', toggle(L.blood, setL('blood')));
    row('欠損の表現', toggle(L.dismember, setL('dismember')));
    row('音', toggle(L.sound, setL('sound')));
    const S = this.server, ro = !this.admin, setS = (k) => (v) => this.onServer?.({ [k]: v });
    h(this.admin ? '🛠️ サーバーの設定 (全員に反映)' : '🛠️ サーバーの設定 (管理者だけ変えられます)');
    row('一撃で倒れるモード', toggle(S.oneHitDown, setS('oneHitDown'), ro), 'ON: どんな被弾でも転倒');
    row('NPC の数', range(S.npcCount ?? 20, 0, 200, 5, setS('npcCount'), ro));
    row('NPC の反応頻度', range(S.npcReact ?? 1, 0, 2, 0.1, setS('npcReact'), ro, (v) => `${Number(v).toFixed(1)}×`));
    row('NPC の逃走頻度', range(S.npcFlee ?? 0.6, 0, 1, 0.05, setS('npcFlee'), ro, (v) => `${Math.round(v * 100)}%`));
    row('NPC の最大同時処理数', range(S.npcMaxActive ?? 40, 5, 400, 5, setS('npcMaxActive'), ro));
    row('転倒する強さ (衝撃)', range(S.downImpact ?? 30, 5, 100, 1, setS('downImpact'), ro), '体 18・頭 40・パンチ 34');
    const close = document.createElement('button'); close.className = 'btn'; close.textContent = 'とじる'; close.onclick = () => this.close(); box.append(close);
  }
}
