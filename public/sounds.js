/* =====================================================================
 *  JOACCHINO CHI???? - Effetti sonori
 *  Tutti i suoni sono generati al volo con la Web Audio API:
 *  nessun file audio da caricare.
 * ===================================================================== */
(function () {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('jc_muted') === '1'; } catch (e) { /* ignora */ }

  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Il browser sblocca l'audio solo dopo un clic dell'utente
  window.addEventListener('pointerdown', () => ac(), { once: true });

  // Nota semplice con inviluppo
  function tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, slide = 0 } = {}) {
    const a = ac(); if (!a || muted) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Rumore filtrato (per il "tonfo" delle carte e il boato dello stadio)
  function noise(dur, { vol = 0.3, delay = 0, freq = 1200, q = 0.8, type = 'bandpass', attack = 0.01 } = {}) {
    const a = ac(); if (!a || muted) return;
    const t = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }

  const S = {
    // carta che si abbassa / si rialza
    flipDown() { noise(0.12, { freq: 900, vol: 0.35 }); tone(180, 0.12, { type: 'triangle', vol: 0.15, slide: -90 }); },
    flipUp() { noise(0.1, { freq: 1600, vol: 0.25 }); tone(220, 0.1, { type: 'triangle', vol: 0.12, slide: 120 }); },
    deal(i) { noise(0.05, { freq: 2500, vol: 0.12, delay: i * 0.02 }); },
    click() { tone(660, 0.06, { type: 'square', vol: 0.06 }); },
    question() { tone(520, 0.12, { vol: 0.2 }); tone(780, 0.18, { vol: 0.2, delay: 0.1 }); },
    yes() { tone(660, 0.12, { vol: 0.2 }); tone(990, 0.2, { vol: 0.2, delay: 0.1 }); },
    no() { tone(300, 0.15, { type: 'sawtooth', vol: 0.1 }); tone(220, 0.25, { type: 'sawtooth', vol: 0.1, delay: 0.12 }); },
    wrong() { tone(160, 0.45, { type: 'sawtooth', vol: 0.15, slide: -60 }); },
    tick() { tone(1200, 0.04, { type: 'square', vol: 0.05 }); },
    tickUrgent() { tone(1500, 0.06, { type: 'square', vol: 0.09 }); },
    yourTurn() { tone(523, 0.1, { vol: 0.15 }); tone(659, 0.1, { vol: 0.15, delay: 0.08 }); tone(784, 0.16, { vol: 0.15, delay: 0.16 }); },
    chat() { tone(880, 0.08, { vol: 0.12 }); tone(1320, 0.12, { vol: 0.1, delay: 0.07 }); },
    drumroll() { for (let i = 0; i < 24; i++) noise(0.05, { freq: 300, vol: 0.18 + i * 0.006, delay: i * 0.07 }); },
    // boato da stadio
    roar() {
      noise(2.6, { freq: 700, q: 0.4, vol: 0.5, attack: 0.25 });
      noise(2.2, { freq: 1600, q: 0.6, vol: 0.25, attack: 0.3, delay: 0.1 });
      for (let i = 0; i < 6; i++) tone(300 + Math.random() * 250, 0.8, { type: 'sawtooth', vol: 0.025, delay: 0.2 + Math.random() * 0.6 });
    },
    // fanfara di vittoria
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.22, delay: i * 0.13 }));
      [784, 1047].forEach((f, i) => tone(f, 0.6, { type: 'triangle', vol: 0.2, delay: 0.6 + i * 0.02 }));
    },
    lose() { [392, 370, 349, 330].forEach((f, i) => tone(f, i === 3 ? 0.7 : 0.25, { type: 'triangle', vol: 0.18, delay: i * 0.3 })); },
    trophy() { this.win(); setTimeout(() => this.roar(), 700); },

    isMuted: () => muted,
    toggle() { muted = !muted; try { localStorage.setItem('jc_muted', muted ? '1' : '0'); } catch (e) { /* ignora */ } return muted; },
  };
  window.SFX = S;
})();
