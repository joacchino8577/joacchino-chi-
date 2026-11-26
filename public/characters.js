/* =====================================================================
 *  JOACCHINO CHI???? - Dati condivisi (usati sia dal server che dal client)
 *  ---------------------------------------------------------------------
 *  - 40 personaggi in ordine di griglia: riga per riga, da sinistra a destra
 *    (Viola in alto a sinistra  ->  Teo in basso a destra).
 *  - Ogni personaggio ha gli attributi visivi usati da:
 *      * la CPU (per scegliere le domande e scartare i personaggi)
 *      * il controllo anti-errore (impedisce di rispondere il falso)
 *  - Se vuoi correggere un attributo, modifica SOLO questa tabella.
 * ===================================================================== */
(function (root) {
  // Legenda attributi (1 = sì, 0 = no):
  // f        = donna
  // beard    = barba o baffi
  // glasses  = occhiali / monocolo / visiera
  // hat      = qualsiasi copricapo (cappello, berretto, basco, fascia, turbante, corona)
  // colored  = capelli colorati rosa / blu / verde
  // red      = capelli rossi / arancioni
  // dread    = trecce o rasta
  // paint    = pitture colorate sul viso
  // earrings = orecchini
  // mohawk   = cresta
  // bald     = calvo
  // afro     = capigliatura afro
  // brim     = cilindro / bombetta (cappello con tesa)
  // beanie   = berretto di lana o basco
  // face     = fa l'occhiolino o la linguaccia
  const KEYS = ['f','beard','glasses','hat','colored','red','dread','paint','earrings','mohawk','bald','afro','brim','beanie','face'];

  // name | f beard glasses hat colored red dread paint earrings mohawk bald afro brim beanie face
  const RAW = [
    // ---- Riga 1 ----
    ['Viola',    1,0,0,0,1,0,0,0,1,0,0,0,0,0,1],
    ['Rita',     1,0,1,0,1,0,0,0,0,0,0,0,0,0,1],
    ['Gioia',    1,0,0,1,1,0,0,0,0,0,0,0,0,0,1],
    ['Gaia',     1,0,0,1,0,1,0,1,0,0,0,0,0,1,0],
    ['Sergio',   0,1,0,1,0,0,0,0,0,0,0,0,0,1,0],
    ['Bruno',    0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ['Marco',    0,1,0,1,0,0,0,0,0,0,0,0,0,1,0],
    ['Stefano',  0,1,0,1,0,0,0,1,0,0,0,0,0,1,0],
    // ---- Riga 2 ----
    ['Matteo',   0,0,1,0,0,1,0,0,1,0,0,0,0,0,0],
    ['Chiara',   1,0,1,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Sofia',    1,0,0,0,0,0,1,1,1,0,0,0,0,0,0],
    ['Filippo',  0,1,1,0,0,0,0,0,0,0,1,0,0,0,0],
    ['Davide',   0,1,0,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Lorenzo',  0,0,1,1,0,0,0,0,0,0,0,0,1,0,0],
    ['Giulia',   1,0,0,1,0,1,0,0,1,0,0,0,0,0,0],
    ['Pietro',   0,1,0,0,0,0,0,0,0,0,1,0,0,0,0],
    // ---- Riga 3 ----
    ['Elena',    1,0,0,0,0,0,0,0,1,0,0,1,0,0,0],
    ['Isabella', 1,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    ['Elio',     0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Carlo',    0,1,0,1,0,0,0,0,0,0,0,0,1,0,0],
    ['Luca',     0,0,1,0,0,1,0,0,0,0,0,0,0,0,1],
    ['Giovanni', 0,1,0,1,0,1,0,0,0,0,0,0,0,0,0],
    ['Sara',     1,0,0,1,0,0,1,0,0,0,0,0,0,1,0],
    ['Dino',     0,0,0,0,1,0,0,1,0,1,0,0,0,0,0],
    // ---- Riga 4 ----
    ['Alice',    1,0,0,0,1,0,0,0,1,0,0,0,0,0,0],
    ['Emma',     1,0,1,0,1,0,0,0,0,0,0,0,0,0,0],
    ['Rocco',    0,0,0,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Leonardo', 0,1,0,1,0,0,0,0,0,0,0,0,0,1,0],
    ['Marta',    1,0,0,0,0,1,0,0,1,0,0,0,0,0,0],
    ['Andrea',   1,0,0,1,0,0,1,0,0,0,0,0,1,0,0],
    ['Franco',   0,1,1,1,0,0,0,0,0,0,0,0,1,0,0],
    ['Dario',    0,0,1,1,0,0,0,0,0,0,0,0,1,0,0],
    // ---- Riga 5 ----
    ['Roberto',  0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    ['Agata',    1,0,1,0,0,1,0,0,1,0,0,0,0,0,1],
    ['Michele',  0,1,0,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Simone',   0,1,0,1,0,0,0,0,0,0,0,0,0,0,0],
    ['Claudio',  0,1,1,1,0,0,0,0,0,0,0,0,1,0,0],
    ['Alberto',  0,1,0,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Fabio',    0,0,1,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Teo',      0,1,0,0,1,0,0,0,1,1,0,0,0,0,0],
  ];

  const CHARACTERS = RAW.map((row, id) => {
    const attrs = {};
    KEYS.forEach((k, i) => { attrs[k] = row[i + 1] === 1; });
    return { id, name: row[0], row: Math.floor(id / 8), col: id % 8, attrs };
  });

  // Le 15 domande preimpostate: ogni domanda controlla un attributo
  const QUESTIONS = [
    { id: 0,  key: 'f',        text: 'È una donna?' },
    { id: 1,  key: 'beard',    text: 'Ha la barba o i baffi?' },
    { id: 2,  key: 'glasses',  text: 'Porta occhiali, monocolo o una visiera?' },
    { id: 3,  key: 'hat',      text: 'Indossa un cappello, berretto, fascia, turbante o corona?' },
    { id: 4,  key: 'colored',  text: 'Ha i capelli colorati di rosa, blu o verde?' },
    { id: 5,  key: 'red',      text: 'Ha i capelli rossi o arancioni?' },
    { id: 6,  key: 'dread',    text: 'Ha trecce o rasta?' },
    { id: 7,  key: 'paint',    text: 'Ha pitture colorate sul viso?' },
    { id: 8,  key: 'earrings', text: 'Indossa orecchini?' },
    { id: 9,  key: 'mohawk',   text: 'Ha la cresta?' },
    { id: 10, key: 'bald',     text: 'È calvo?' },
    { id: 11, key: 'afro',     text: 'Ha una capigliatura afro?' },
    { id: 12, key: 'brim',     text: 'Porta un cilindro o una bombetta?' },
    { id: 13, key: 'beanie',   text: 'Porta un berretto di lana o un basco?' },
    { id: 14, key: 'face',     text: "Fa l'occhiolino o la linguaccia?" },
  ];

  // Risposta corretta di un personaggio a una domanda
  function answerFor(charId, qid) {
    const c = CHARACTERS[charId], q = QUESTIONS[qid];
    return !!(c && q && c.attrs[q.key]);
  }

  const DATA = { CHARACTERS, QUESTIONS, answerFor, GRID: { cols: 8, rows: 5 } };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.JC_DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
