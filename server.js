/* =====================================================================
 *  JOACCHINO CHI???? - Server (Node.js + Express + Socket.io)
 *  ---------------------------------------------------------------------
 *  Gestisce:
 *   - Single Player contro la CPU (la CPU gira sul server)
 *   - Stanze private 1v1 con chiave d'ingresso (es. JOA420)
 *   - Tornei fino a 20 giocatori con tabellone a eliminazione diretta,
 *     BYE automatici, turni giocati in contemporanea e vittoria a
 *     tavolino in caso di disconnessione.
 *  Il server è l'unico a conoscere i personaggi segreti: controlla le
 *  risposte (anti-bugia), i tentativi e la fase vocale "Joacchino chi?".
 * ===================================================================== */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { CHARACTERS, QUESTIONS, answerFor } = require('./public/characters.js');

const PORT = process.env.PORT || 3000;
const VOICE_MS = 5000;          // conto alla rovescia vocale (5 secondi)
const VOICE_GRACE_MS = 1500;    // tolleranza per la latenza di rete
const ROUND_DELAY_MS = 5000;    // pausa tra un turno del torneo e il successivo
const MAX_TOURNEY = 20;
const MIN_TOURNEY = 3;
const TURN_MS = 40000;          // durata massima di un turno (40 secondi)
const ANSWER_MS = 15000;        // tempo per rispondere SÌ/NO (poi risponde il server)

// Messaggi della chat veloce (stessa lista nel client)
const QUICK_CHAT = [
  'Sei spacciato! 😈', 'Bella domanda! 🤔', 'Ci sono quasi… 👀', 'Che fortuna! 🍀',
  'GG! 🤝', 'Sbrigati! ⏰', 'Ahahah! 😂', 'Joacchino chi?! 🎤',
];

// --------------------------------------------------------------------
//  CLASSIFICA (salvata in data/leaderboard.json)
// --------------------------------------------------------------------
const fs = require('fs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LB_FILE = path.join(DATA_DIR, 'leaderboard.json');
let leaderboard = {};
try { leaderboard = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch (e) { leaderboard = {}; }
let lbSaveTimer = null;
function saveLeaderboard() {
  clearTimeout(lbSaveTimer);
  lbSaveTimer = setTimeout(() => {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LB_FILE, JSON.stringify(leaderboard)); } catch (e) { console.warn('Classifica non salvata:', e.message); }
  }, 1000);
}
function lbEntry(nick) {
  const k = nick.toLowerCase();
  if (!leaderboard[k]) leaderboard[k] = { nick, wins: 0, losses: 0, cpuWins: 0, trophies: 0 };
  leaderboard[k].nick = nick;
  return leaderboard[k];
}
function recordResult(winner, loser) {
  // Le partite contro la CPU contano a parte
  if (winner && !winner.cpu) { const e = lbEntry(winner.nick); if (loser && loser.cpu) e.cpuWins++; else e.wins++; }
  if (loser && !loser.cpu && !(winner && winner.cpu)) lbEntry(loser.nick).losses++;
  saveLeaderboard();
}
function topLeaderboard() {
  return Object.values(leaderboard)
    .map(e => ({ ...e, points: e.trophies * 10 + e.wins * 3 + e.cpuWins }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, 20);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));
app.get('/api/leaderboard', (_req, res) => res.json(topLeaderboard()));
const server = http.createServer(app);
const io = new Server(server);

// --------------------------------------------------------------------
//  Utilità
// --------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente O/0, I/1
function makeCode(taken) {
  let code;
  do {
    code = 'JOA' + Array.from({ length: 3 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (taken.has(code));
  return code;
}
const rnd = (n) => Math.floor(Math.random() * n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cleanNick(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Giocatore'; }
function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

const rooms = new Map();     // codice -> stanza 1v1 { code, players:[socket], match }
const tourneys = new Map();  // codice -> Torneo

// ====================================================================
//  MATCH: una singola partita 1 contro 1 (umano/umano o umano/CPU)
// ====================================================================
let matchSeq = 1;
class Match {
  /**
   * @param {object} opt
   *  - players: [{ id, nick, socket|null, cpu:boolean }]
   *  - mode: 'single' | 'room' | 'tourney'
   *  - label: testo mostrato (es. "Quarti di finale")
   *  - onEnd(winnerId|null, loserId|null)
   */
  constructor({ players, mode, label, onEnd }) {
    this.id = matchSeq++;
    this.mode = mode;
    this.label = label || '';
    this.onEnd = onEnd || (() => {});
    // Personaggi segreti diversi per i due giocatori
    const a = rnd(40); let b = rnd(40); while (b === a) b = rnd(40);
    this.players = players.map((p, i) => ({
      ...p,
      secret: i === 0 ? a : b,
      cands: p.cpu ? new Set(CHARACTERS.map(c => c.id)) : null, // memoria della CPU
      askedQ: new Set(),
    }));
    this.turn = rnd(2);      // chi inizia
    this.phase = 'ask';      // ask | answer | after | voice | over
    this.pendingQ = null;    // domanda in attesa di risposta
    this.lastQA = null;      // { qid, yes, byIdx }
    this.voice = null;       // { byIdx, endsAt, timer }
    this.log = [];
    this.winnerIdx = null;
    this.rematch = new Set();
    this.timers = new Set();
    this.players.forEach(p => { if (p.socket) p.socket.data.match = this; });
    this.addLog(`🎲 Inizia ${this.players[this.turn].nick}!`);
    this.turnTimer = null; this.turnEndsAt = 0; this.turnLeft = TURN_MS; this.answerTimer = null; this.answerEndsAt = 0;
    this.startClock(TURN_MS + 3000); // +3s per l'animazione di distribuzione delle carte
  }

  // ---- Cronometro del turno (40 s) ----------------------------------
  startClock(ms) {
    this.stopClock();
    this.turnEndsAt = Date.now() + ms;
    this.turnTimer = this.later(() => this.onTurnTimeout(), ms);
  }
  stopClock() { if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; } }
  pauseClock() { this.turnLeft = Math.max(3000, this.turnEndsAt - Date.now()); this.stopClock(); }
  resumeClock() { this.startClock(this.turnLeft); }
  onTurnTimeout() {
    this.turnTimer = null;
    if (!['ask', 'after'].includes(this.phase)) return;
    const p = this.players[this.turn];
    this.addLog(`⏰ Tempo scaduto per ${p.nick}!`);
    this.toast('⏰ Tempo scaduto! Turno passato.', 'bad', this.turn);
    this.toast(`⏰ Tempo scaduto per ${p.nick}: tocca a te!`, 'good', this.other(this.turn));
    this.nextTurn();
  }

  idxOf(socketId) { return this.players.findIndex(p => p.socket && p.socket.id === socketId); }
  other(i) { return 1 - i; }
  later(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); if (this.phase !== 'over') fn(); }, ms); this.timers.add(t); return t; }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }
  addLog(t) { this.log.push(t); if (this.log.length > 40) this.log.shift(); }

  toast(text, kind = 'info', only = null) {
    this.players.forEach((p, i) => { if (p.socket && (only === null || only === i)) p.socket.emit('toast', { text, kind }); });
  }

  // Invia a ciascun giocatore la propria "vista" dello stato (senza segreti altrui)
  sync() {
    this.players.forEach((p, i) => {
      if (!p.socket) return;
      const o = this.players[this.other(i)];
      const view = {
        matchId: this.id, mode: this.mode, label: this.label,
        you: { nick: p.nick }, opp: { nick: o.nick, cpu: !!o.cpu },
        secret: p.secret,
        yourTurn: this.turn === i,
        phase: this.phase,
        // domanda che devi rispondere tu
        incomingQ: this.phase === 'answer' && this.turn !== i ? this.pendingQ : null,
        // domanda che hai fatto e aspetti risposta
        waitingQ: this.phase === 'answer' && this.turn === i ? this.pendingQ : null,
        lastQA: this.lastQA ? { qid: this.lastQA.qid, yes: this.lastQA.yes, mine: this.lastQA.byIdx === i } : null,
        voice: this.voice ? { mine: this.voice.byIdx === i, msLeft: Math.max(0, this.voice.endsAt - Date.now() - VOICE_GRACE_MS) } : null,
        askedQ: [...p.askedQ],
        log: this.log.slice(-12),
        over: this.phase === 'over' ? {
          youWon: this.winnerIdx === i,
          oppSecret: o.secret,
          reason: this.endReason,
        } : null,
        canRematch: this.mode !== 'tourney',
        rematchVotes: this.rematch.size,
        // cronometri (millisecondi rimanenti, null = fermo)
        turnMsLeft: this.turnTimer ? Math.max(0, this.turnEndsAt - Date.now()) : null,
        turnPausedMs: !this.turnTimer && this.phase !== 'over' ? this.turnLeft : null,
        turnMs: TURN_MS,
        answerMsLeft: this.phase === 'answer' ? Math.max(0, this.answerEndsAt - Date.now()) : null,
      };
      p.socket.emit('game:state', view);
    });
    this.cpuMaybeAct();
  }

  // ---- Azioni dei giocatori ----------------------------------------
  ask(i, qid) {
    if (this.phase !== 'ask' || this.turn !== i) return this.err(i, 'Non puoi fare domande adesso.');
    if (!QUESTIONS[qid]) return;
    this.pendingQ = qid;
    this.players[i].askedQ.add(qid);
    this.phase = 'answer';
    this.addLog(`❓ ${this.players[i].nick}: "${QUESTIONS[qid].text}"`);
    // Il cronometro del turno si ferma mentre l'avversario risponde
    this.pauseClock();
    this.answerEndsAt = Date.now() + ANSWER_MS;
    const ans = this.other(i);
    this.answerTimer = this.later(() => {
      if (this.phase !== 'answer') return;
      this.toast('⏰ Troppo lento! Ho risposto io per te.', 'bad', ans);
      this.answer(ans, answerFor(this.players[ans].secret, this.pendingQ));
    }, ANSWER_MS);
    this.sync();
  }

  answer(i, yes) {
    if (this.phase !== 'answer' || this.turn === i) return;
    const truth = answerFor(this.players[i].secret, this.pendingQ);
    if (!!yes !== truth) {
      // Controllo anti-errore: la risposta deve essere vera!
      return this.err(i, `Risposta non valida! Guarda bene la tua carta: la risposta corretta è "${truth ? 'SÌ' : 'NO'}".`);
    }
    this.lastQA = { qid: this.pendingQ, yes: truth, byIdx: this.turn };
    const asker = this.players[this.turn];
    if (asker.cpu) this.cpuFilter(asker, this.pendingQ, truth);
    this.addLog(`💬 ${this.players[i].nick} risponde: ${truth ? 'SÌ' : 'NO'}`);
    this.pendingQ = null;
    this.phase = 'after';
    if (this.answerTimer) { clearTimeout(this.answerTimer); this.timers.delete(this.answerTimer); this.answerTimer = null; }
    this.resumeClock();
    this.sync();
  }

  endTurn(i) {
    if (this.turn !== i || !['ask', 'after'].includes(this.phase)) return;
    this.addLog(`⏭️ ${this.players[i].nick} passa il turno.`);
    this.nextTurn();
  }

  nextTurn() {
    this.turn = this.other(this.turn);
    this.phase = 'ask';
    this.pendingQ = null;
    this.startClock(TURN_MS);
    this.sync();
  }

  guess(i, charId) {
    if (this.turn !== i || !['ask', 'after'].includes(this.phase)) return this.err(i, 'Puoi indovinare solo durante il tuo turno.');
    const c = CHARACTERS[charId]; if (!c) return;
    const p = this.players[i], o = this.players[this.other(i)];
    if (charId !== o.secret) {
      this.addLog(`❌ ${p.nick} prova con ${c.name}… SBAGLIATO!`);
      this.toast(`${p.nick} ha provato con ${c.name}: sbagliato! Turno perso.`, 'bad');
      if (p.cpu) p.cands.delete(charId);
      return this.nextTurn();
    }
    // Personaggio esatto -> fase vocale
    this.addLog(`🎯 ${p.nick} ha indovinato ${c.name}! Ora deve dire "Joacchino chi?"`);
    this.phase = 'voice';
    this.pauseClock();
    this.toast(`🎯 ${p.nick} ha indovinato! Ora deve gridare "Joacchino chi?"`, 'voice-start');
    const endsAt = Date.now() + VOICE_MS + VOICE_GRACE_MS;
    this.voice = { byIdx: i, endsAt, timer: this.later(() => this.voiceResult(i, false, true), VOICE_MS + VOICE_GRACE_MS) };
    this.sync();
    if (p.cpu) this.later(() => {
      this.toast('🤖 La CPU urla: "JOACCHINO CHI?!"', 'cpu-voice');
      this.voiceResult(i, true);
    }, 1800);
  }

  voiceResult(i, ok, timeout = false) {
    if (this.phase !== 'voice' || !this.voice || this.voice.byIdx !== i) return;
    const p = this.players[i];
    if (ok && Date.now() <= this.voice.endsAt) {
      clearTimeout(this.voice.timer); this.timers.delete(this.voice.timer);
      this.voice = null;
      this.addLog(`🏆 ${p.nick} ha detto "JOACCHINO CHI?" e VINCE!`);
      if (!p.cpu) this.toast(`🏟️ ${p.nick}: "JOACCHINO CHI?!"`, 'roar');
      return this.finish(i, 'voice');
    }
    clearTimeout(this.voice.timer); this.timers.delete(this.voice.timer);
    this.voice = null;
    this.addLog(`🙊 ${p.nick} non ha detto "Joacchino chi?" in tempo. Turno passato!`);
    this.toast('Non hai detto Joacchino chi! Turno passato!', 'bad', i);
    this.toast(`${p.nick} non ha detto "Joacchino chi?"! Tocca a te!`, 'good', this.other(i));
    this.nextTurn();
  }

  // ---- Fine partita ------------------------------------------------
  finish(winnerIdx, reason) {
    if (this.phase === 'over') return;
    this.clearTimers();
    this.phase = 'over';
    this.winnerIdx = winnerIdx;
    this.endReason = reason; // voice | forfeit
    this.sync();
    const w = winnerIdx === null ? null : this.players[winnerIdx];
    const l = winnerIdx === null ? null : this.players[this.other(winnerIdx)];
    if (w) recordResult(w, l);
    this.onEnd(w ? w.id : null, l ? l.id : null);
  }

  // Disconnessione: l'avversario vince a tavolino
  forfeit(i) {
    if (this.phase === 'over') return;
    this.addLog(`🔌 ${this.players[i].nick} si è disconnesso: vittoria a tavolino!`);
    this.players[i].socket = null;
    this.finish(this.other(i), 'forfeit');
  }

  err(i, msg) { const s = this.players[i] && this.players[i].socket; if (s) s.emit('toast', { text: msg, kind: 'bad' }); }

  detach() { this.players.forEach(p => { if (p.socket && p.socket.data.match === this) p.socket.data.match = null; }); this.clearTimers(); }

  // ================================================================
  //  INTELLIGENZA ARTIFICIALE (CPU)
  // ================================================================
  cpuFilter(cpuP, qid, yes) {
    for (const id of [...cpuP.cands]) if (answerFor(id, qid) !== yes) cpuP.cands.delete(id);
  }

  cpuMaybeAct() {
    if (this.phase === 'over') return;
    const cur = this.players[this.turn];
    const oppIdx = this.other(this.turn);
    // La CPU deve rispondere a una domanda dell'umano
    if (this.phase === 'answer' && this.players[oppIdx].cpu && !this._cpuAnswering) {
      this._cpuAnswering = true;
      this.later(() => { this._cpuAnswering = false; this.answer(oppIdx, answerFor(this.players[oppIdx].secret, this.pendingQ)); }, 900);
      return;
    }
    if (!cur.cpu || this._cpuThinking) return;
    if (this.phase === 'ask') {
      this._cpuThinking = true;
      this.later(() => { this._cpuThinking = false; this.cpuTurn(); }, 1400);
    } else if (this.phase === 'after') {
      this._cpuThinking = true;
      this.later(() => {
        this._cpuThinking = false;
        if (this.players[this.turn].cands.size === 1) this.guess(this.turn, [...this.players[this.turn].cands][0]);
        else this.endTurn(this.turn);
      }, 1300);
    }
  }

  cpuTurn() {
    const i = this.turn, me = this.players[i];
    const cands = [...me.cands];
    if (cands.length <= 1 || (cands.length === 2 && Math.random() < 0.5)) {
      return this.guess(i, cands[rnd(cands.length)]);
    }
    // Sceglie la domanda che divide meglio i candidati rimasti
    let best = null, bestScore = Infinity;
    for (const q of QUESTIONS) {
      const yes = cands.filter(id => answerFor(id, q.id)).length;
      if (yes === 0 || yes === cands.length) continue;
      const score = Math.abs(yes - cands.length / 2) + Math.random() * 1.5;
      if (score < bestScore) { bestScore = score; best = q.id; }
    }
    if (best === null) return this.guess(i, cands[rnd(cands.length)]); // indistinguibili: tira a indovinare
    this.ask(i, best);
  }
}

// ====================================================================
//  TORNEO stile Champions League
// ====================================================================
function roundName(matchCount, isFirstWithByes) {
  if (isFirstWithByes) return 'Turno Preliminare';
  return ({ 1: 'Finale', 2: 'Semifinali', 4: 'Quarti di finale', 8: 'Ottavi di finale', 16: 'Sedicesimi di finale' })[matchCount] || `Turno da ${matchCount * 2}`;
}

class Tournament {
  constructor(code, hostSocket, nick) {
    this.code = code;
    this.hostId = hostSocket.id;
    this.players = new Map(); // id -> { id, nick, socket, connected }
    this.status = 'lobby';    // lobby | running | done
    this.rounds = [];         // [{ name, matches:[{ a, b, winner, status, match }] }]
    this.current = -1;
    this.podium = null;
    this.add(hostSocket, nick);
  }

  add(socket, nick) {
    this.players.set(socket.id, { id: socket.id, nick, socket, connected: true });
    socket.data.tourney = this;
    socket.join('T:' + this.code);
    this.broadcastLobby();
  }

  nick(id) { const p = this.players.get(id); return p ? p.nick : '—'; }

  broadcastLobby() {
    io.to('T:' + this.code).emit('tourney:lobby', {
      code: this.code, hostId: this.hostId, max: MAX_TOURNEY, min: MIN_TOURNEY,
      players: [...this.players.values()].map(p => ({ id: p.id, nick: p.nick })),
    });
  }

  removeFromLobby(id) {
    this.players.delete(id);
    if (this.players.size === 0) { tourneys.delete(this.code); return; }
    if (id === this.hostId) this.hostId = [...this.players.keys()][0]; // nuovo organizzatore
    this.broadcastLobby();
  }

  // ---- Costruzione del tabellone con BYE ---------------------------
  start() {
    const ids = shuffle([...this.players.keys()]);
    const n = ids.length;
    let size = 1; while (size < n) size *= 2;
    const byes = size - n;
    const first = size / 2;
    // I BYE vengono distribuiti in modo uniforme nel tabellone
    const byeSlots = new Set();
    for (let k = 0; k < byes; k++) byeSlots.add(Math.floor((k * first) / byes));
    const r0 = [];
    let p = 0;
    for (let m = 0; m < first; m++) {
      if (byeSlots.has(m)) r0.push({ a: ids[p++], b: null });
      else { r0.push({ a: ids[p++], b: ids[p++] }); }
    }
    this.rounds = [{ name: roundName(first, byes > 0), matches: r0.map(x => ({ ...x, winner: undefined, status: 'pending' })) }];
    for (let cnt = first / 2; cnt >= 1; cnt /= 2) {
      this.rounds.push({ name: roundName(cnt, false), matches: Array.from({ length: cnt }, () => ({ a: undefined, b: undefined, winner: undefined, status: 'pending' })) });
    }
    this.status = 'running';
    io.to('T:' + this.code).emit('tourney:started');
    this.startRound(0);
  }

  startRound(r) {
    this.current = r;
    const round = this.rounds[r];
    round.matches.forEach((m, idx) => {
      const aOk = m.a && this.players.get(m.a) && this.players.get(m.a).connected;
      const bOk = m.b && this.players.get(m.b) && this.players.get(m.b).connected;
      if (!m.a && !m.b) return this.resolve(r, idx, null, 'empty');
      if (!m.b || !m.a) return this.resolve(r, idx, m.a || m.b, 'bye');
      if (!aOk && !bOk) return this.resolve(r, idx, null, 'forfeit');
      if (!aOk) return this.resolve(r, idx, m.b, 'forfeit');
      if (!bOk) return this.resolve(r, idx, m.a, 'forfeit');
      // Partita reale: stanza 1v1 privata gestita dal server
      const A = this.players.get(m.a), B = this.players.get(m.b);
      m.status = 'playing';
      m.match = new Match({
        mode: 'tourney', label: `${round.name} – Torneo ${this.code}`,
        players: [{ id: A.id, nick: A.nick, socket: A.socket }, { id: B.id, nick: B.nick, socket: B.socket }],
        onEnd: (winnerId) => setTimeout(() => this.resolve(r, idx, winnerId, 'played'), 50),
      });
    });
    this.broadcastBracket();
    round.matches.forEach(m => { if (m.match) m.match.sync(); });
    this.checkRoundDone();
  }

  resolve(r, idx, winnerId, how) {
    const m = this.rounds[r].matches[idx];
    if (m.status === 'done') return;
    m.status = 'done';
    m.winner = winnerId;
    m.how = how;
    if (m.match) { const mm = m.match; setTimeout(() => mm.detach(), 100); }
    m.match = null;
    this.broadcastBracket();
    this.checkRoundDone();
  }

  checkRoundDone() {
    const r = this.current;
    if (r < 0 || this.status !== 'running') return;
    const round = this.rounds[r];
    if (!round.matches.every(m => m.status === 'done')) return;
    if (this._advancing === r) return;
    this._advancing = r;
    if (r === this.rounds.length - 1) return this.finishTourney();
    // Riempie il turno successivo con i vincitori
    const next = this.rounds[r + 1];
    round.matches.forEach((m, idx) => {
      const nm = next.matches[Math.floor(idx / 2)];
      if (idx % 2 === 0) nm.a = m.winner || null; else nm.b = m.winner || null;
    });
    this.broadcastBracket();
    io.to('T:' + this.code).emit('toast', { text: `Prossimo turno: ${next.name} tra ${ROUND_DELAY_MS / 1000} secondi!`, kind: 'info' });
    setTimeout(() => this.startRound(r + 1), ROUND_DELAY_MS);
  }

  finishTourney() {
    this.status = 'done';
    const fin = this.rounds[this.rounds.length - 1].matches[0];
    const champ = fin.winner;
    const second = fin.winner === fin.a ? fin.b : fin.a;
    const third = [];
    if (this.rounds.length >= 2) {
      this.rounds[this.rounds.length - 2].matches.forEach(m => {
        if (m.a && m.b && m.winner) third.push(m.winner === m.a ? m.b : m.a);
      });
    }
    if (champ) { lbEntry(this.nick(champ)).trophies++; saveLeaderboard(); }
    this.podium = {
      first: champ ? this.nick(champ) : null,
      second: second ? this.nick(second) : null,
      third: third.map(id => this.nick(id)),
    };
    this.broadcastBracket();
    io.to('T:' + this.code).emit('tourney:podium', this.podium);
    setTimeout(() => tourneys.delete(this.code), 30 * 60 * 1000);
  }

  publicBracket() {
    const label = (id) => (id === undefined ? '' : id === null ? 'BYE' : this.nick(id));
    return {
      code: this.code, status: this.status, current: this.current, podium: this.podium,
      rounds: this.rounds.map(r => ({
        name: r.name,
        matches: r.matches.map(m => ({
          a: label(m.a), b: label(m.b), aId: m.a || null, bId: m.b || null,
          winner: m.winner === undefined ? undefined : (m.winner ? this.nick(m.winner) : null),
          winnerId: m.winner || null, status: m.status, how: m.how || null,
        })),
      })),
    };
  }

  broadcastBracket() { io.to('T:' + this.code).emit('tourney:bracket', this.publicBracket()); }

  onDisconnect(id) {
    if (this.status === 'lobby') return this.removeFromLobby(id);
    const p = this.players.get(id); if (p) { p.connected = false; p.socket = null; }
    // Se sta giocando, il Match gestisce la vittoria a tavolino
  }
}

// ====================================================================
//  SOCKET.IO
// ====================================================================
function leaveEverything(socket) {
  const m = socket.data.match;
  if (m && m.phase !== 'over') { const i = m.idxOf(socket.id); if (i >= 0) m.forfeit(i); }
  else if (m) {
    // partita finita: avvisa l'altro che la rivincita non è più possibile
    if (m.mode === 'room') m.players.forEach(p => { if (p.socket && p.socket.id !== socket.id) p.socket.emit('toast', { text: 'L\'avversario ha lasciato la stanza.', kind: 'info' }); });
    m.detach();
  }
  socket.data.match = null;
  const code = socket.data.room;
  if (code && rooms.has(code)) {
    const room = rooms.get(code);
    room.players = room.players.filter(s => s.id !== socket.id);
    if (room.players.length === 0 || room.match) rooms.delete(code);
  }
  socket.data.room = null;
  const t = socket.data.tourney;
  if (t) { t.onDisconnect(socket.id); socket.leave('T:' + t.code); }
  socket.data.tourney = null;
}

io.on('connection', (socket) => {
  socket.data = { nick: 'Giocatore', match: null, room: null, tourney: null };
  const mine = () => socket.data.match;
  const myIdx = () => (mine() ? mine().idxOf(socket.id) : -1);

  // ---- SINGLE PLAYER ----
  socket.on('single:start', ({ nick } = {}) => {
    leaveEverything(socket);
    socket.data.nick = cleanNick(nick);
    const m = new Match({
      mode: 'single', label: 'Single Player vs CPU',
      players: [{ id: socket.id, nick: socket.data.nick, socket }, { id: 'cpu', nick: '🤖 CPU Joacchino', socket: null, cpu: true }],
    });
    m.sync();
  });

  // ---- STANZA PRIVATA 1v1 ----
  socket.on('room:create', ({ nick } = {}) => {
    leaveEverything(socket);
    socket.data.nick = cleanNick(nick);
    const code = makeCode(new Set([...rooms.keys(), ...tourneys.keys()]));
    rooms.set(code, { code, players: [socket], match: null });
    socket.data.room = code;
    socket.emit('room:created', { code });
  });

  socket.on('room:join', ({ nick, code } = {}) => {
    code = cleanCode(code);
    if (tourneys.has(code)) return joinTourney(socket, nick, code); // chiave di un torneo: entra nel torneo
    const room = rooms.get(code);
    if (!room) return socket.emit('toast', { text: 'Stanza non trovata. Controlla la chiave!', kind: 'bad' });
    if (room.players.length >= 2 || room.match) return socket.emit('toast', { text: 'La stanza è già piena.', kind: 'bad' });
    leaveEverything(socket);
    socket.data.nick = cleanNick(nick);
    socket.data.room = code;
    room.players.push(socket);
    startRoomMatch(room);
  });

  function startRoomMatch(room) {
    const [a, b] = room.players;
    room.match = new Match({
      mode: 'room', label: `Stanza privata ${room.code}`,
      players: [{ id: a.id, nick: a.data.nick, socket: a }, { id: b.id, nick: b.data.nick, socket: b }],
    });
    room.match.sync();
  }

  // ---- TORNEO ----
  socket.on('tourney:create', ({ nick } = {}) => {
    leaveEverything(socket);
    socket.data.nick = cleanNick(nick);
    const code = makeCode(new Set([...rooms.keys(), ...tourneys.keys()]));
    const t = new Tournament(code, socket, socket.data.nick);
    tourneys.set(code, t);
  });

  socket.on('tourney:join', ({ nick, code } = {}) => joinTourney(socket, nick, cleanCode(code)));

  socket.on('tourney:start', () => {
    const t = socket.data.tourney;
    if (!t || t.status !== 'lobby') return;
    if (t.hostId !== socket.id) return socket.emit('toast', { text: 'Solo l\'organizzatore può avviare il torneo.', kind: 'bad' });
    if (t.players.size < MIN_TOURNEY) return socket.emit('toast', { text: `Servono almeno ${MIN_TOURNEY} giocatori.`, kind: 'bad' });
    t.start();
  });

  socket.on('tourney:bracket', () => { const t = socket.data.tourney; if (t && t.status !== 'lobby') socket.emit('tourney:bracket', t.publicBracket()); });

  // ---- AZIONI DI GIOCO ----
  socket.on('game:ask', ({ qid } = {}) => { const m = mine(); if (m) m.ask(myIdx(), Number(qid)); });
  socket.on('game:answer', ({ yes } = {}) => { const m = mine(); if (m) m.answer(myIdx(), !!yes); });
  socket.on('game:endTurn', () => { const m = mine(); if (m) m.endTurn(myIdx()); });
  socket.on('game:guess', ({ charId } = {}) => { const m = mine(); if (m) m.guess(myIdx(), Number(charId)); });
  socket.on('game:voice', ({ ok } = {}) => { const m = mine(); if (m) m.voiceResult(myIdx(), !!ok); });

  socket.on('game:rematch', () => {
    const m = mine();
    if (!m || m.phase !== 'over' || m.mode === 'tourney') return;
    if (m.mode === 'single') {
      m.detach();
      const nm = new Match({ mode: 'single', label: m.label, players: m.players.map(p => ({ id: p.id, nick: p.nick, socket: p.socket, cpu: p.cpu })) });
      return nm.sync();
    }
    const others = m.players.filter(p => p.socket && p.socket.id !== socket.id);
    if (others.length === 0) return socket.emit('toast', { text: 'L\'avversario se n\'è andato.', kind: 'bad' });
    m.rematch.add(socket.id);
    if (m.rematch.size >= 2) {
      m.detach();
      const nm = new Match({ mode: 'room', label: m.label, players: m.players.map(p => ({ id: p.id, nick: p.nick, socket: p.socket })) });
      const room = rooms.get(socket.data.room); if (room) room.match = nm;
      nm.sync();
    } else {
      others.forEach(p => p.socket.emit('toast', { text: `${socket.data.nick} vuole la rivincita!`, kind: 'good' }));
      m.sync();
    }
  });

  // ---- CHAT VELOCE ----
  socket.on('chat:quick', ({ i } = {}) => {
    const m = mine(); const text = QUICK_CHAT[Number(i)];
    if (!m || !text) return;
    const now = Date.now();
    if (now - (socket.data.lastChat || 0) < 1500) return; // anti-spam
    socket.data.lastChat = now;
    m.players.forEach(p => { if (p.socket) p.socket.emit('chat', { from: socket.data.nick, text, mine: p.socket.id === socket.id }); });
    const opp = m.players.find(p => p.cpu);
    if (opp && Math.random() < 0.6) { // la CPU a volte risponde
      setTimeout(() => { if (socket.connected) socket.emit('chat', { from: opp.nick, text: QUICK_CHAT[rnd(QUICK_CHAT.length)], mine: false }); }, 1200);
    }
  });

  // ---- CLASSIFICA ----
  socket.on('lb:get', () => socket.emit('lb', topLeaderboard()));

  socket.on('leave', () => { leaveEverything(socket); socket.emit('left'); });
  socket.on('disconnect', () => leaveEverything(socket));
});

function joinTourney(socket, nick, code) {
  const t = tourneys.get(code);
  if (!t) return socket.emit('toast', { text: 'Torneo non trovato. Controlla la chiave!', kind: 'bad' });
  if (t.status !== 'lobby') return socket.emit('toast', { text: 'Il torneo è già iniziato.', kind: 'bad' });
  if (t.players.size >= MAX_TOURNEY) return socket.emit('toast', { text: `Torneo pieno (max ${MAX_TOURNEY}).`, kind: 'bad' });
  leaveEverything(socket);
  socket.data.nick = cleanNick(nick);
  t.add(socket, socket.data.nick);
}

server.listen(PORT, () => console.log(`🌿 JOACCHINO CHI???? in ascolto sulla porta ${PORT}`));
