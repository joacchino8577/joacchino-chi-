# 🌿 JOACCHINO CHI???? — versione 2.0

Un "Indovina Chi?" multiplayer con Single Player contro la CPU, stanze private 1v1 e Torneo stile Champions League (fino a 20 giocatori). Per vincere devi gridare **"Joacchino chi?"** al microfono.

## Novità della versione 2.0

- 🃏 **Carte che si abbassano**: cliccando una carta, questa si ribalta all'indietro come nel vero Indovina Chi. Ricliccando si rialza.
- 🔊 **Suoni**: carta che cade, domanda in arrivo, SÌ/NO, ticchettio negli ultimi secondi, rullo di tamburi, boato da stadio quando qualcuno grida "Joacchino chi?", fanfara di vittoria. Il pulsante 🔊 in alto a destra li spegne.
- ✨ **Animazioni**: le carte vengono distribuite a onda a inizio partita; quando vinci partono i coriandoli.
- ⏱️ **Timer di 40 secondi per turno**: la barra diventa gialla e poi rossa. Il timer si ferma mentre l'avversario risponde (che ha 15 secondi, poi il gioco risponde per lui) e durante la prova al microfono. Se il tempo scade, il turno passa.
- 🏅 **Classifica**: vittorie, sconfitte, trofei e vittorie contro la CPU per ogni nickname. Il torneo vinto vale 10 punti, una vittoria 1v1 o di torneo 3 punti, una vittoria contro la CPU 1 punto.
- 💬 **Chat veloce**: messaggi pronti ("Sei spacciato! 😈", "GG! 🤝"…) che compaiono in un fumetto sopra il nome. A volte anche la CPU risponde.

## Struttura del progetto

```
joacchino-chi/
├── package.json
├── render.yaml            ← configurazione automatica per Render
├── server.js              ← server Node.js + Express + Socket.io
└── public/
    ├── index.html
    ├── style.css
    ├── client.js          ← ritaglio canvas, gioco, timer, chat, tabellone, microfono
    ├── sounds.js          ← effetti sonori (generati, nessun file audio)
    ├── characters.js      ← 40 personaggi + attributi + 15 domande
    ├── personaggi.png     ← la griglia 8×5 dei personaggi
    ├── leaf-pattern.svg
    └── leaf.svg
```

## Pubblicarlo su Render, passo passo (senza installare niente)

### A) Caricare i file su GitHub
1. Estrai lo zip sul PC: ottieni la cartella `joacchino-chi`.
2. Vai su **https://github.com**, accedi (o crea un account gratuito).
3. In alto a destra clicca **+ → New repository**.
4. Nome: `joacchino-chi`, lascialo **Public**, poi clicca **Create repository**.
5. Nella pagina che si apre clicca il link **"uploading an existing file"**.
6. Apri la cartella `joacchino-chi` sul PC, **seleziona tutto il contenuto** (i file e la cartella `public`) e trascinalo nella pagina di GitHub. Non trascinare la cartella `joacchino-chi` in sé, ma quello che c'è dentro.
7. Aspetta il caricamento, poi in basso clicca **Commit changes**.
8. Controlla: nella pagina del repository devi vedere `server.js`, `package.json`, `render.yaml` e la cartella `public`.

### B) Creare il servizio su Render
1. Vai su **https://render.com** e clicca **Get Started**. Accedi con **GitHub**.
2. Clicca **New + → Web Service**.
3. Scegli il repository `joacchino-chi` (se non lo vedi, clicca "Configure account" e dai accesso al repository).
4. Controlla le impostazioni:
   - **Language / Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Clicca **Deploy Web Service**.
6. Aspetta 2-5 minuti finché compare **"Live"** in verde.
7. In alto trovi il link, tipo `https://joacchino-chi.onrender.com`: è quello da mandare agli amici.

### C) Aggiornare il gioco in futuro
Su GitHub apri il file da cambiare, clicca la matita ✏️ e poi **Commit changes**: Render ripubblica da solo in un paio di minuti.

## Cose da sapere

- **Microfono:** funziona su **Chrome** ed **Edge** (PC e Android). Su Firefox e su iPhone usa **"Simula Microfono (Test)"**. Prima di giocare premi **🎤 Prova microfono** nella schermata iniziale, così il browser chiede il permesso subito.
- **Piano gratuito che "dorme":** dopo 15 minuti senza giocatori il server si addormenta. La prima apertura può richiedere fino a circa 50 secondi.
- **Classifica sul piano gratuito:** viene salvata in un file sul server, ma Render Free **cancella i file quando il server si riavvia** (dopo il "sonno" o a ogni aggiornamento). Quindi la classifica vale per la serata di gioco. Per renderla permanente serve un piano a pagamento di Render con disco persistente: in quel caso imposta la variabile d'ambiente `DATA_DIR` con il percorso del disco.

## Provarlo sul PC (facoltativo)

1. Installa **Node.js** da https://nodejs.org
2. Apri un terminale nella cartella `joacchino-chi` ed esegui `npm install` e poi `npm start`
3. Apri **http://localhost:3000** (per provare il multiplayer apri due schede)

## Personalizzare

- **Ritaglio delle carte:** se cambi l'immagine, regola `FRAME` in `public/client.js`.
- **Attributi dei personaggi:** si correggono in `public/characters.js`.
- **Durata del turno:** cambia `TURN_MS` in `server.js` (40000 = 40 secondi). Il tempo per rispondere è `ANSWER_MS`.
- **Messaggi della chat:** cambiali in `QUICK_CHAT` sia in `server.js` sia in `public/client.js`, tenendo lo stesso ordine.
