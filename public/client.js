/* =====================================================================
 *  JOACCHINO CHI???? - Client
 *  ---------------------------------------------------------------------
 *  1) Ritaglio dell'immagine personaggi.png in 40 tasselli (canvas)
 *  2) Lobby: Single Player / Stanza 1v1 / Torneo
 *  3) Partita: tabellone con X rosse, domande, risposte SÌ/NO,
 *     tentativo di indovinare e fase vocale "Joacchino chi?"
 *  4) Tabellone torneo stile Champions League con collegamenti grafici
 * ===================================================================== */
(() => {
  const { CHARACTERS, QUESTIONS, answerFor, GRID } = window.JC_DATA;
  const socket = io();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ------------------------------------------------------------------
  //  1) RITAGLIO TASSELLI DA personaggi.png
  // ------------------------------------------------------------------
  // Margini della cornice esterna espressi in frazioni dell'immagine
  // (misurati sull'immagine originale 1200x896: così funziona anche se
  //  carichi una versione più grande con la stessa impaginazione).
  const FRAME = { x0: 0.030, x1: 0.970, y0: 0.0212, y1: 0.9788 };
  const TILES = []; // dataURL di ogni personaggio (indice = id)

  function cutTiles() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = $('#cutter'), ctx = cv.getContext('2d');
        const W = img.naturalWidth, H = img.naturalHeight;
        const left = FRAME.x0 * W, top = FRAME.y0 * H;
        const cw = ((FRAME.x1 - FRAME.x0) * W) / GRID.cols;
        const ch = ((FRAME.y1 - FRAME.y0) * H) / GRID.rows;
        const inset = Math.max(1, Math.round(cw * 0.018)); // toglie il bordino bianco della carta
        const outW = Math.round(cw - inset * 2), outH = Math.round(ch - inset * 2);
        cv.width = outW; cv.height = outH;
        CHARACTERS.forEach((c) => {
          ctx.clearRect(0, 0, outW, outH);
          ctx.drawImage(img, left + c.col * cw + inset, top + c.row * ch + inset, outW, outH, 0, 0, outW, outH);
          TILES[c.id] = cv.toDataURL('image/jpeg', 0.92);
        });
        resolve(true);
      };
      img.onerror = () => { fallbackTiles(); resolve(false); };
      img.src = 'personaggi.png';
    });
  }

  // Se l'immagine manca, crea carte segnaposto con il nome
  function fallbackTiles() {
    const cv = $('#cutter'), ctx = cv.getContext('2d');
    cv.width = 138; cv.height = 168;
    const colors = ['#a8e6cf', '#ffd3b6', '#ffaaa5', '#dcedc1', '#c7ceea', '#f8b5d9', '#b5ead7', '#ffdac1'];
    CHARACTERS.forEach((c) => {
      ctx.fillStyle = colors[c.id % colors.length]; ctx.fillRect(0, 0, 138, 168);
      ctx.font = '64px serif'; ctx.textAlign = 'center'; ctx.fillText(c.attrs.f ? '👩' : '👨', 69, 95);
      ctx.fillStyle = '#fff'; ctx.fillRect(10, 130, 118, 28);
      ctx.fillStyle = '#13244d'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(c.name, 69, 151);
      TILES[c.id] = cv.toDataURL('image/png');
    });
    toast('⚠️ Immagine personaggi.png non trovata: uso le carte segnaposto.', 'bad');
  }

  // ------------------------------------------------------------------
  //  Utilità UI
  // ------------------------------------------------------------------
  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'screen-bracket') requestAnimationFrame(drawBracketLines);
  }
  function toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('📋 Chiave copiata: ' + text, 'good'))
      .catch(() => { prompt('Copia la chiave:', text); });
  }
  function speak(text) {
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { /* niente sintesi vocale */ }
  }
  function nick() {
    const n = $('#nick').value.trim();
    try { localStorage.setItem('jc_nick', n); } catch (e) { /* ignora */ }
    if (!n) { $('#nick').classList.add('shake'); setTimeout(() => $('#nick').classList.remove('shake'), 400); toast('Scrivi prima il tuo Nickname!', 'bad'); return null; }
    return n;
  }
  try { $('#nick').value = localStorage.getItem('jc_nick') || ''; } catch (e) { /* ignora */ }

  // ------------------------------------------------------------------
  //  2) LOBBY
  // ------------------------------------------------------------------
  $('#btn-single').onclick = () => { const n = nick(); if (n) socket.emit('single:start', { nick: n }); };
  $('#btn-room-create').onclick = () => { const n = nick(); if (n) socket.emit('room:create', { nick: n }); };
  $('#btn-room-join').onclick = () => { const n = nick(); if (n) socket.emit('room:join', { nick: n, code: $('#room-code').value }); };
  $('#btn-t-create').onclick = () => { const n = nick(); if (n) socket.emit('tourney:create', { nick: n }); };
  $('#btn-t-join').onclick = () => { const n = nick(); if (n) socket.emit('tourney:join', { nick: n, code: $('#t-code').value }); };
  $('#room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-room-join').click(); });
  $('#t-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-t-join').click(); });
  $('#btn-t-start').onclick = () => socket.emit('tourney:start');
  $('#wait-code').onclick = () => copy($('#wait-code').textContent);
  $('#t-code-display').onclick = () => copy($('#t-code-display').textContent);
  $$('[data-leave]').forEach((b) => (b.onclick = () => socket.emit('leave')));

  socket.on('room:created', ({ code }) => { $('#wait-code').textContent = code; show('screen-wait'); });

  socket.on('left', resetToLobby);
  function resetToLobby() {
    game = null; tourney = null; bracket = null; stopVoice(true);
    $$('.overlay').forEach((o) => o.classList.add('hidden'));
    show('screen-lobby');
  }
  socket.on('disconnect', () => { toast('Connessione persa… riprovo.', 'bad'); resetToLobby(); });
  socket.on('toast', ({ text, kind }) => {
    if (kind === 'cpu-voice') { speak('Gioacchino chi?'); SFX.roar(); kind = 'bad'; }
    else if (kind === 'roar') { SFX.roar(); kind = 'good'; }
    else if (kind === 'voice-start') { SFX.drumroll(); kind = 'good'; }
    else if (kind === 'bad' && /sbagliato|Non hai detto|Tempo scaduto|mentire|Troppo lento/i.test(text)) SFX.wrong();
    toast(text, kind);
  });

  // ------------------------------------------------------------------
  //  3) PARTITA
  // ------------------------------------------------------------------
  let game = null;          // ultimo stato ricevuto dal server
  let matchId = null;
  const crossed = new Set();
  let guessing = false;
  let overDismissed = false;
  let stayOnBracket = false;
  let spokenFor = null;

  function buildBoard(deal = false) {
    const board = $('#board');
    board.innerHTML = '';
    CHARACTERS.forEach((c) => {
      const d = document.createElement('div');
      d.className = 'card'; d.dataset.id = c.id; d.title = c.name;
      // ordine "a onda" diagonale per la distribuzione
      d.style.setProperty('--d', `${(c.row + c.col) * 70 + Math.random() * 40}ms`);
      d.innerHTML = `<div class="slot">${c.name}</div><div class="flap"><img alt="${c.name}" src="${TILES[c.id]}"></div>`;
      d.onclick = () => onCardClick(c.id, d);
      board.appendChild(d);
    });
    if (deal) {
      board.classList.add('dealing');
      for (let i = 0; i < 12; i++) SFX.deal(i * 4);
      setTimeout(() => board.classList.remove('dealing'), 1800);
    }
  }

  function onCardClick(id, el) {
    if (guessing) {
      if (crossed.has(id)) return toast('Quella carta è abbassata: rialzala prima, se vuoi sceglierla.', 'bad');
      const c = CHARACTERS[id];
      if (!confirm(`Vuoi tentare con ${c.name}?`)) return;
      setGuessing(false);
      socket.emit('game:guess', { charId: id });
      return;
    }
    // Abbassa / rialza la carta (ripensamento possibile)
    if (crossed.has(id)) { crossed.delete(id); SFX.flipUp(); } else { crossed.add(id); SFX.flipDown(); }
    el.classList.toggle('crossed', crossed.has(id));
  }

  function setGuessing(on) {
    guessing = on;
    $('#board').classList.toggle('guessing', on);
    $('#guess-hint').classList.toggle('hidden', !on);
  }
  $('#btn-guess').onclick = () => setGuessing(!guessing);
  $('#btn-guess-cancel').onclick = () => setGuessing(false);
  $('#btn-end-turn').onclick = () => { setGuessing(false); socket.emit('game:endTurn'); };
  $('#btn-yes').onclick = () => sendAnswer(true);
  $('#btn-no').onclick = () => sendAnswer(false);
  $('#btn-rematch').onclick = () => { socket.emit('game:rematch'); $('#btn-rematch').disabled = true; $('#btn-rematch').textContent = '⏳ In attesa…'; };
  $('#btn-over-bracket').onclick = () => { overDismissed = true; $('#over-overlay').classList.add('hidden'); stayOnBracket = true; show('screen-bracket'); };
  $('#btn-see-bracket').onclick = () => { stayOnBracket = true; show('screen-bracket'); };
  $('#btn-to-match').onclick = () => { stayOnBracket = false; show('screen-game'); };

  function sendAnswer(yes) {
    if (!game || game.incomingQ === null) return;
    // Controllo anti-errore lato client (il server ricontrolla comunque)
    const truth = answerFor(game.secret, game.incomingQ);
    if (yes !== truth) {
      $('#q-overlay .bubble').classList.add('shake');
      setTimeout(() => $('#q-overlay .bubble').classList.remove('shake'), 400);
      SFX.wrong(); toast(`Non puoi mentire! Guarda bene ${CHARACTERS[game.secret].name}.`, 'bad');
      return;
    }
    socket.emit('game:answer', { yes });
  }

  // Domande (15 preimpostate)
  function buildQuestions() {
    const box = $('#questions');
    box.innerHTML = '';
    QUESTIONS.forEach((q) => {
      const b = document.createElement('button');
      b.className = 'q-btn'; b.dataset.qid = q.id; b.textContent = `${q.id + 1}. ${q.text}`;
      b.onclick = () => { setGuessing(false); socket.emit('game:ask', { qid: q.id }); };
      box.appendChild(b);
    });
  }

  socket.on('game:state', (v) => {
    const isNew = v.matchId !== matchId;
    const prev = isNew ? null : game;
    game = v;
    if (isNew) {
      matchId = v.matchId; crossed.clear(); overDismissed = false; stayOnBracket = false;
      buildBoard(true); setGuessing(false); stopVoice(true);
      $('#btn-rematch').disabled = false; $('#btn-rematch').textContent = '🔁 Rivincita';
      $('#over-overlay').classList.add('hidden');
      $('#podium-overlay').classList.add('hidden');
    }
    if (!stayOnBracket) show('screen-game');
    renderGame(v);
    playStateSounds(prev, v);
    setTimer(v);
  });

  // Suoni legati ai cambi di stato
  function playStateSounds(p, v) {
    if (v.incomingQ !== null && (!p || p.incomingQ === null)) SFX.question();
    if (p && p.phase === 'answer' && v.phase === 'after' && v.lastQA) (v.lastQA.yes ? SFX.yes() : SFX.no());
    if (v.yourTurn && v.phase === 'ask' && (!p || !p.yourTurn)) SFX.yourTurn();
    if (v.over && (!p || !p.over)) {
      if (v.over.youWon) { SFX.win(); confetti(); } else SFX.lose();
    }
  }

  // ------------------------------------------------------------------
  //  CRONOMETRO DEL TURNO (40 s) e della risposta (15 s)
  // ------------------------------------------------------------------
  let timer = { mode: 'off', end: 0, total: 1, lastSec: null };
  function setTimer(v) {
    if (v.phase === 'over') timer = { mode: 'off' };
    else if (v.phase === 'answer' && v.answerMsLeft !== null) timer = { mode: 'answer', end: Date.now() + v.answerMsLeft, total: 15000, mine: !v.yourTurn };
    else if (v.turnMsLeft !== null) timer = { mode: 'turn', end: Date.now() + v.turnMsLeft, total: v.turnMs, mine: v.yourTurn };
    else timer = { mode: 'paused', left: v.turnPausedMs || 0, total: v.turnMs };
  }
  setInterval(() => {
    const fill = $('#timer-fill'), txt = $('#timer-text');
    if (!game || timer.mode === 'off') { fill.style.width = '0%'; fill.className = 'timer-fill'; txt.textContent = '–'; return; }
    if (timer.mode === 'paused') {
      fill.className = 'timer-fill paused'; fill.style.width = (timer.left / timer.total) * 100 + '%';
      txt.className = 'timer-text'; txt.textContent = '⏸'; return;
    }
    const left = Math.max(0, timer.end - Date.now());
    const pct = Math.min(100, (left / timer.total) * 100);
    const sec = Math.ceil(left / 1000);
    fill.style.width = pct + '%';
    fill.className = 'timer-fill' + (sec <= 5 ? ' danger' : sec <= 12 ? ' warn' : '');
    txt.className = 'timer-text' + (sec <= 5 ? ' danger' : '');
    txt.textContent = (timer.mode === 'answer' ? '💬 ' : '') + sec;
    if (timer.mine && sec !== timer.lastSec && sec > 0) {
      if (sec <= 5) SFX.tickUrgent(); else if (sec <= 10) SFX.tick();
    }
    timer.lastSec = sec;
  }, 200);

  // ------------------------------------------------------------------
  //  CHAT VELOCE
  // ------------------------------------------------------------------
  const QUICK_CHAT = [
    'Sei spacciato! 😈', 'Bella domanda! 🤔', 'Ci sono quasi… 👀', 'Che fortuna! 🍀',
    'GG! 🤝', 'Sbrigati! ⏰', 'Ahahah! 😂', 'Joacchino chi?! 🎤',
  ];
  QUICK_CHAT.forEach((t, i) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.onclick = () => socket.emit('chat:quick', { i });
    $('#quick-chat').appendChild(b);
  });
  let bubbleTimer = null;
  socket.on('chat', ({ from, text, mine }) => {
    SFX.chat();
    if (mine) return toast(`💬 Tu: ${text}`, 'chat');
    const b = $('#opp-bubble');
    b.textContent = text; b.classList.remove('hidden');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => b.classList.add('hidden'), 3500);
    if (!$('#screen-game').classList.contains('active')) toast(`💬 ${from}: ${text}`, 'chat');
  });

  // ------------------------------------------------------------------
  //  CLASSIFICA
  // ------------------------------------------------------------------
  function openLeaderboard() { socket.emit('lb:get'); $('#lb-overlay').classList.remove('hidden'); }
  $('#btn-lb').onclick = openLeaderboard;
  $$('[data-open-lb]').forEach((b) => (b.onclick = openLeaderboard));
  $('#btn-lb-close').onclick = () => $('#lb-overlay').classList.add('hidden');
  socket.on('lb', (rows) => {
    $('#lb-body').innerHTML = rows.length
      ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.nick)}</td><td>${r.trophies}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.cpuWins}</td><td><b>${r.points}</b></td></tr>`).join('')
      : '<tr><td colspan="7">Ancora nessuna partita: sii il primo! 🌿</td></tr>';
  });

  // ------------------------------------------------------------------
  //  CORIANDOLI
  // ------------------------------------------------------------------
  function confetti(ms = 3500) {
    const cv = $('#confetti'), c = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#ffc83d', '#9be37a', '#e53935', '#4fc3f7', '#f48fb1', '#ffffff'];
    const parts = Array.from({ length: 180 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6,
      w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4,
      r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, col: colors[Math.floor(Math.random() * colors.length)],
      leaf: Math.random() < 0.15,
    }));
    const t0 = performance.now();
    (function frame(t) {
      c.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.x += p.vx + Math.sin((t + p.r * 100) / 300); p.y += p.vy; p.r += p.vr;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r);
        if (p.leaf) { c.font = '22px serif'; c.fillText('🌿', -11, 8); }
        else { c.fillStyle = p.col; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        c.restore();
      });
      if (t - t0 < ms) requestAnimationFrame(frame); else c.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  // Suoni on/off
  const updSoundBtn = () => ($('#btn-sound').textContent = SFX.isMuted() ? '🔇' : '🔊');
  $('#btn-sound').onclick = () => { SFX.toggle(); updSoundBtn(); };
  updSoundBtn();

  function renderGame(v) {
    $('#g-label').textContent = v.label;
    $('#g-you').textContent = v.you.nick;
    $('#g-opp').textContent = v.opp.nick;
    $('#btn-see-bracket').classList.toggle('hidden', v.mode !== 'tourney');
    $('#secret-card').innerHTML = `<img alt="${CHARACTERS[v.secret].name}" src="${TILES[v.secret]}">`;

    // Indicatore di turno
    const pill = $('#g-turn');
    let txt = '', cls = 'theirs';
    if (v.phase === 'over') { txt = v.over.youWon ? '🏆 HAI VINTO!' : '💀 Partita finita'; }
    else if (v.phase === 'voice') txt = v.voice && v.voice.mine ? '🎤 GRIDA "JOACCHINO CHI?"' : `🎤 ${v.opp.nick} deve dire "Joacchino chi?"!`;
    else if (v.yourTurn && v.phase === 'ask') { txt = '🟢 TOCCA A TE: domanda o indovina'; cls = 'mine'; }
    else if (v.yourTurn && v.phase === 'answer') txt = '⏳ Attendi la risposta…';
    else if (v.yourTurn && v.phase === 'after') { txt = '✂️ Scarta i personaggi e passa il turno'; cls = 'mine'; }
    else if (!v.yourTurn && v.phase === 'answer') { txt = '❓ Rispondi alla domanda!'; cls = 'mine'; }
    else txt = `⏳ Turno di ${v.opp.nick}`;
    pill.textContent = txt; pill.className = 'turn-pill ' + cls;

    // Domande
    const canAsk = v.yourTurn && v.phase === 'ask';
    $$('.q-btn').forEach((b) => {
      const qid = Number(b.dataset.qid);
      b.disabled = !canAsk;
      b.classList.toggle('asked', v.askedQ.includes(qid));
    });
    const canAct = v.yourTurn && (v.phase === 'ask' || v.phase === 'after');
    $('#btn-guess').disabled = !canAct;
    $('#btn-end-turn').disabled = !canAct;
    if (!canAct && guessing) setGuessing(false);

    // Ultima domanda / risposta
    const lq = $('#last-qa');
    if (v.waitingQ !== null) {
      lq.classList.remove('hidden');
      lq.innerHTML = `Hai chiesto: "${QUESTIONS[v.waitingQ].text}" <span class="ans">…</span>`;
    } else if (v.lastQA) {
      lq.classList.remove('hidden');
      const who = v.lastQA.mine ? 'Hai chiesto' : `${v.opp.nick} ha chiesto`;
      lq.innerHTML = `${who}: "${QUESTIONS[v.lastQA.qid].text}" <span class="ans ${v.lastQA.yes ? 'yes' : 'no'}">${v.lastQA.yes ? 'SÌ' : 'NO'}</span>`;
    } else lq.classList.add('hidden');

    // Fumetto con la domanda dell'avversario
    if (v.incomingQ !== null) {
      $('#q-from').textContent = `${v.opp.nick} chiede:`;
      $('#q-text').textContent = QUESTIONS[v.incomingQ].text;
      $('#q-secret-name').textContent = CHARACTERS[v.secret].name;
      $('#q-overlay').classList.remove('hidden');
    } else $('#q-overlay').classList.add('hidden');

    // Fase vocale
    if (v.phase === 'voice' && v.voice && v.voice.mine) { if (!voiceActive) startVoice(v.voice.msLeft); }
    else if (voiceActive) stopVoice(true);

    // Cronaca
    $('#log').innerHTML = v.log.slice().reverse().map((l) => `<li>${escapeHtml(l)}</li>`).join('');

    // Fine partita
    if (v.over && !overDismissed) {
      const o = v.over;
      const t = $('#over-title');
      t.textContent = o.youWon ? '🏆 VITTORIA UFFICIALE!' : '💀 HAI PERSO!';
      t.className = 'over-title ' + (o.youWon ? 'win' : 'lose');
      let sub = '';
      if (o.reason === 'forfeit') sub = o.youWon ? "L'avversario si è disconnesso: vittoria a tavolino!" : 'Partita persa a tavolino.';
      else sub = o.youWon ? 'Hai indovinato e gridato "Joacchino chi?"!' : `${v.opp.nick} ha indovinato il tuo personaggio!`;
      if (v.mode === 'tourney') sub += o.youWon ? ' Avanzi nel tabellone! 🚀' : ' Sei eliminato, ma puoi seguire il torneo dal tabellone.';
      $('#over-sub').textContent = sub;
      $('#over-card').innerHTML = `<img alt="" src="${TILES[o.oppSecret]}">`;
      $('#btn-rematch').classList.toggle('hidden', !v.canRematch);
      $('#btn-over-bracket').classList.toggle('hidden', v.mode !== 'tourney');
      $('#over-overlay').classList.remove('hidden');
      if (o.youWon && spokenFor !== v.matchId) { spokenFor = v.matchId; speak('Hai vinto!'); }
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

  // ------------------------------------------------------------------
  //  RICONOSCIMENTO VOCALE "JOACCHINO CHI?"
  // ------------------------------------------------------------------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voiceActive = false, recog = null, voiceTimer = null, voiceDeadline = 0, voiceDone = false;

  // Accetta varianti: joacchino, gioacchino, joachino, gioachino, joaquin…
  function isJoacchino(text) {
    const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    return /(gi|j|g|y)o?a+c+h?i+n+o/.test(t) || /(gi|j)oa(q|k|c)u?in/.test(t);
  }

  function makeRecognizer(onText, onEnd) {
    if (!SR) return null;
    const r = new SR();
    r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 5;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        for (let a = 0; a < e.results[i].length; a++) onText(e.results[i][a].transcript);
      }
    };
    r.onerror = (e) => { if (e.error === 'not-allowed') toast('🎤 Microfono bloccato: consenti l\'accesso nel browser (o usa "Simula Microfono").', 'bad'); };
    r.onend = onEnd;
    return r;
  }

  function startVoice(msLeft) {
    voiceActive = true; voiceDone = false;
    voiceDeadline = Date.now() + Math.max(500, msLeft);
    $('#voice-overlay').classList.remove('hidden');
    $('#voice-heard').textContent = SR ? '🎤 In ascolto…' : '⚠️ Questo browser non supporta il riconoscimento vocale (usa Chrome o Edge) – prova "Simula Microfono".';
    tickCountdown();
    voiceTimer = setInterval(tickCountdown, 100);
    recog = makeRecognizer((text) => {
      if (voiceDone) return;
      $('#voice-heard').textContent = `🗣️ Ho sentito: "${text}"`;
      if (isJoacchino(text)) voiceSuccess();
    }, () => {
      // Chrome a volte si ferma dopo un silenzio: riavvio se c'è ancora tempo
      if (voiceActive && !voiceDone && Date.now() < voiceDeadline) { try { recog.start(); } catch (e) { /* già avviato */ } }
    });
    if (recog) { try { recog.start(); } catch (e) { /* ignora */ } }
  }

  function tickCountdown() {
    const left = Math.max(0, voiceDeadline - Date.now());
    $('#countdown').textContent = Math.ceil(left / 1000);
    $('#countdown').style.setProperty('--p', (left / 5000) * 100 + '%');
    if (left <= 0 && !voiceDone) {
      voiceDone = true;
      socket.emit('game:voice', { ok: false });
      stopVoice(false);
    }
  }

  function voiceSuccess() {
    if (voiceDone) return;
    voiceDone = true;
    $('#voice-heard').textContent = '✅ JOACCHINO CHI?! Riconosciuto!';
    socket.emit('game:voice', { ok: true });
    setTimeout(() => stopVoice(false), 600);
  }

  function stopVoice(force) {
    voiceActive = false;
    clearInterval(voiceTimer); voiceTimer = null;
    if (recog) { try { recog.onend = null; recog.abort(); } catch (e) { /* ignora */ } recog = null; }
    $('#voice-overlay').classList.add('hidden');
    if (force) voiceDone = true;
  }

  // Fallback tecnico: simula il microfono
  $('#btn-sim-mic').onclick = () => { if (voiceActive) voiceSuccess(); };

  // Prova microfono in lobby (serve anche a concedere il permesso prima di giocare)
  $('#btn-mic-test').onclick = () => {
    if (!SR) { $('#mic-status').textContent = '⚠️ Riconoscimento vocale non supportato: usa Chrome o Edge.'; return; }
    $('#mic-status').textContent = '🎤 Di\' "Joacchino chi?"…';
    let ok = false;
    const r = makeRecognizer((t) => {
      if (ok) return;
      $('#mic-status').textContent = `🗣️ "${t}"`;
      if (isJoacchino(t)) { ok = true; $('#mic-status').textContent = '✅ Perfetto! Microfono pronto per la vittoria!'; r.abort(); }
    }, () => { if (!ok) $('#mic-status').textContent = '❌ Non ho sentito "Joacchino chi?". Riprova!'; });
    try { r.start(); setTimeout(() => { try { r.stop(); } catch (e) { /* ignora */ } }, 6000); } catch (e) { /* ignora */ }
  };

  // ------------------------------------------------------------------
  //  4) TORNEO
  // ------------------------------------------------------------------
  let tourney = null, bracket = null;

  socket.on('tourney:lobby', (t) => {
    tourney = t;
    $('#t-code-display').textContent = t.code;
    $('#t-count').textContent = `${t.players.length}/${t.max}`;
    $('#t-players').innerHTML = t.players.map((p) =>
      `<li class="${p.id === t.hostId ? 'host' : ''} ${p.id === socket.id ? 'me' : ''}">${escapeHtml(p.nick)}</li>`).join('');
    const amHost = t.hostId === socket.id;
    $('#btn-t-start').classList.toggle('hidden', !amHost);
    $('#btn-t-start').disabled = t.players.length < t.min;
    $('#t-wait-host').textContent = amHost
      ? (t.players.length < t.min ? `Servono almeno ${t.min} giocatori per iniziare.` : 'Sei l\'organizzatore: avvia quando vuoi!')
      : 'In attesa che l\'organizzatore avvii il torneo…';
    show('screen-tlobby');
  });

  socket.on('tourney:started', () => { stayOnBracket = true; show('screen-bracket'); toast('🏆 Il torneo è iniziato!', 'good'); });

  socket.on('tourney:bracket', (b) => {
    bracket = b;
    renderBracket();
    // Se non sto giocando una partita in corso, mostra il tabellone
    const playing = game && game.mode === 'tourney' && game.phase !== 'over';
    if (!playing && !$('#screen-bracket').classList.contains('active') && $('#over-overlay').classList.contains('hidden')) show('screen-bracket');
  });

  socket.on('tourney:podium', (p) => {
    setTimeout(() => {
      $('#champion-name').textContent = p.first || '—';
      $('#p-first').textContent = p.first || '—';
      $('#p-second').textContent = p.second || '—';
      $('#p-third').textContent = (p.third || []).join(' · ') || '—';
      $('#over-overlay').classList.add('hidden');
      $('#podium-overlay').classList.remove('hidden');
      speak(`Campione del torneo: ${p.first || ''}!`);
      SFX.trophy(); confetti(6000);
    }, 1500);
  });
  $('#btn-podium-close').onclick = () => { $('#podium-overlay').classList.add('hidden'); stayOnBracket = true; show('screen-bracket'); };

  function renderBracket() {
    if (!bracket) return;
    $('#b-code').textContent = bracket.code;
    const cur = bracket.rounds[bracket.current];
    if (bracket.status === 'done') $('#b-status').textContent = `🏁 Torneo concluso! Campione: ${bracket.podium && bracket.podium.first ? bracket.podium.first : '—'}`;
    else if (cur) {
      const live = cur.matches.filter((m) => m.status === 'playing').length;
      $('#b-status').textContent = `Turno attuale: ${cur.name} · Partite in corso: ${live}`;
    }
    let myLive = false;
    $('#bracket').innerHTML = bracket.rounds.map((r, ri) => `
      <div class="b-round">
        <div class="b-round-title ${ri === bracket.current && bracket.status !== 'done' ? 'current' : ''}">${r.name}</div>
        <div class="b-matches">
          ${r.matches.map((m, mi) => {
            const mine = m.aId === socket.id || m.bId === socket.id;
            if (mine && m.status === 'playing') myLive = true;
            return `<div class="b-match ${m.status} ${mine ? 'mine' : ''}" data-r="${ri}" data-m="${mi}">
              ${slot(m.a, m.aId, m)}${slot(m.b, m.bId, m)}
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');
    const inGame = game && game.mode === 'tourney' && game.phase !== 'over';
    $('#btn-to-match').classList.toggle('hidden', !(myLive && inGame));
    requestAnimationFrame(drawBracketLines);
  }

  function slot(name, id, m) {
    let cls = '', tag = '';
    if (name === '') { cls = 'tbd'; name = 'da definire'; }
    else if (name === 'BYE') cls = 'bye';
    else if (m.status === 'done') {
      if (m.winnerId && m.winnerId === id) { cls = 'win'; tag = m.how === 'bye' ? 'BYE ➜' : m.how === 'forfeit' ? 'a tavolino' : '✔'; }
      else cls = 'lose';
    }
    if (id === socket.id) name += ' (tu)';
    return `<div class="b-slot ${cls}"><span>${escapeHtml(name)}</span><span class="b-tag">${tag}</span></div>`;
  }

  // Collegamenti grafici tra i turni (linee a gomito in SVG)
  function drawBracketLines() {
    const wrap = $('.bracket-scroll'), svg = $('#bracket-lines');
    if (!wrap || !bracket || !$('#screen-bracket').classList.contains('active')) return;
    const base = wrap.getBoundingClientRect();
    const pos = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - base.left + wrap.scrollLeft, r: r.right - base.left + wrap.scrollLeft, y: r.top - base.top + wrap.scrollTop + r.height / 2 };
    };
    svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
    let d = '';
    for (let ri = 1; ri < bracket.rounds.length; ri++) {
      bracket.rounds[ri].matches.forEach((_, mi) => {
        const to = document.querySelector(`.b-match[data-r="${ri}"][data-m="${mi}"]`);
        if (!to) return;
        const t = pos(to);
        [mi * 2, mi * 2 + 1].forEach((pi) => {
          const from = document.querySelector(`.b-match[data-r="${ri - 1}"][data-m="${pi}"]`);
          if (!from) return;
          const f = pos(from);
          const mid = (f.r + t.l) / 2;
          d += `M${f.r},${f.y} H${mid} V${t.y} H${t.l} `;
        });
      });
    }
    svg.innerHTML = `<path d="${d}"/>`;
  }
  window.addEventListener('resize', () => requestAnimationFrame(drawBracketLines));

  // ------------------------------------------------------------------
  //  AVVIO
  // ------------------------------------------------------------------
  cutTiles().then(() => { buildQuestions(); buildBoard(); });
})();
