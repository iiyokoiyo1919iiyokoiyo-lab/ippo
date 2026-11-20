// =====================================================================
// シティバトル: 環境音 (音声ファイルは使わず、Web Audio で合成)
//   銃声・着弾・体に当たる音・倒れる音・悲鳴・驚きの声・街のざわめき
//   ・聞く人 (カメラ) からの距離で小さく、左右の位置で左右に振る
//   ・ブラウザの決まりで、最初のタップ (はじめるボタン) のあとから鳴る
// =====================================================================
export class Sound {
  constructor() { this.ctx = null; this.on = true; this.vol = 0.8; this.listener = { x: 0, z: 0, yaw: 0 }; this.last = new Map(); }
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx; this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    // 白いノイズ (いろいろな音の素)
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = buf;
    // 街のざわめき (低いノイズを小さく流す)
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.045; src.connect(lp).connect(g).connect(this.master); src.start(); this.amb = g;
  }
  setOn(on) { this.on = on; if (this.master) this.master.gain.value = on ? this.vol : 0; }
  setListener(x, z, yaw) { Object.assign(this.listener, { x, z, yaw }); }
  // 位置から、音量と左右
  place(x, z, maxD) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    if (d > maxD) return null;
    const ang = Math.atan2(-dx, -dz) - L.yaw, pan = Math.max(-1, Math.min(1, -Math.sin(ang)));
    const g = Math.pow(1 - d / maxD, 1.6);
    return { g, pan, d };
  }
  out(pos, gain) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain * pos.g;
    const p = c.createStereoPanner ? c.createStereoPanner() : null; if (p) { p.pan.value = pos.pan; g.connect(p).connect(this.master); } else g.connect(this.master);
    return g;
  }
  throttle(key, ms) { const now = performance.now(), t = this.last.get(key) || 0; if (now - t < ms) return false; this.last.set(key, now); if (this.last.size > 300) this.last.clear(); return true; }
  noiseBurst(dest, dur, f0, f1, type = 'lowpass', q = 0.7) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, c.currentTime); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), c.currentTime + dur);
    const e = c.createGain(); e.gain.setValueAtTime(1, c.currentTime); e.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    s.connect(f).connect(e).connect(dest); s.start(c.currentTime, Math.random()); s.stop(c.currentTime + dur + 0.05);
  }
  play(kind, x, z, opt = {}) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    if (kind === 'shot') { // 銃声: パンという破裂音 + 低い響き。遠いほどこもる
      const pos = this.place(x, z, 140); if (!pos) return; const o = this.out(pos, 0.9);
      this.noiseBurst(o, 0.12, 6000 - Math.min(5000, pos.d * 40), 600, 'lowpass', 0.5);
      this.noiseBurst(o, 0.45 + pos.d * 0.004, 900, 80, 'lowpass', 0.3);
    } else if (kind === 'impact') { const pos = this.place(x, z, 45); if (!pos) return; this.noiseBurst(this.out(pos, 0.25), 0.05, 3500, 1500, 'bandpass', 2); }
    else if (kind === 'flesh') { // 体に当たる: 低くにぶい音
      const pos = this.place(x, z, 50); if (!pos) return; const o = this.out(pos, 0.6);
      const os = c.createOscillator(), e = c.createGain(); os.frequency.setValueAtTime(140, t); os.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      e.gain.setValueAtTime(0.8, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.16); os.connect(e).connect(o); os.start(t); os.stop(t + 0.2);
      this.noiseBurst(o, 0.08, 1200, 300, 'lowpass', 1);
    } else if (kind === 'fall') { // 倒れる: どさっ
      const pos = this.place(x, z, 40); if (!pos) return; const o = this.out(pos, 0.7);
      this.noiseBurst(o, 0.25, 500, 60, 'lowpass', 0.8);
      const os = c.createOscillator(), e = c.createGain(); os.frequency.value = 60; e.gain.setValueAtTime(0.7, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.25); os.connect(e).connect(o); os.start(t); os.stop(t + 0.3);
    } else if (kind === 'scream' || kind === 'gasp') { // 声: のこぎり波を口の形 (フォルマント) でしぼる。人ごとに高さを変える
      if (!this.throttle(kind + (opt.id || ''), kind === 'scream' ? 2500 : 1500)) return;
      const pos = this.place(x, z, kind === 'scream' ? 70 : 30); if (!pos) return; const o = this.out(pos, kind === 'scream' ? 0.35 : 0.22);
      const base = (opt.pitch || 1) * (kind === 'scream' ? 520 : 260), dur = kind === 'scream' ? 0.9 + Math.random() * 0.4 : 0.22;
      const os = c.createOscillator(); os.type = 'sawtooth';
      os.frequency.setValueAtTime(base * 0.8, t); os.frequency.linearRampToValueAtTime(base * 1.25, t + dur * 0.25); os.frequency.linearRampToValueAtTime(base * 0.85, t + dur);
      const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 7; vg.gain.value = base * 0.04; vib.connect(vg).connect(os.frequency);
      const e = c.createGain(); e.gain.setValueAtTime(0.001, t); e.gain.exponentialRampToValueAtTime(1, t + 0.04); e.gain.setValueAtTime(1, t + dur * 0.7); e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      for (const [f, q, gg] of [[kind === 'scream' ? 950 : 700, 6, 1], [kind === 'scream' ? 2700 : 1200, 8, 0.5]]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const gn = c.createGain(); gn.gain.value = gg; os.connect(bp).connect(gn).connect(e); }
      e.connect(o); os.start(t); vib.start(t); os.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    }
  }
}
