# Piano di implementazione

Ogni task è piccolo, si chiude con test verdi e cita i requisiti che copre.
I task del core si scrivono test-first. L'ordine rispetta le dipendenze.

Legenda: **Fatto quando** = condizione verificabile per chiudere il task.

## Fase 0 — Setup

- [x] **T0.1** Scaffold Vite `vanilla-ts`, TypeScript `strict`, Vitest, script `dev`, `build`, `test`, `typecheck`.
  - Fatto quando: `npm test` e `npm run build` passano su un progetto vuoto.
- [x] **T0.2** Struttura cartelle come in design §2 e `core/types.ts` con i tipi di design §3.
  - Fatto quando: `npm run typecheck` passa.

## Fase 1 — Core puro

- [x] **T1.1** `normalize` + `tokenize` (grapheme, 6 categorie). — R1.4, R1.5
  - Fatto quando: test su lettere accentate, punteggiatura, a capo, emoji composte, alfabeti non latini.
- [x] **T1.2** `fnv1a` + `mulberry32`. — R3.8
  - Fatto quando: stesso seed → stessa sequenza; valori in `[0, 1)`; test con valori attesi fissati.
- [x] **T1.3** `buildTimeline` con uno stile fittizio. — R3.6, R3.7, R4.2, R4.3, R7.4
  - Fatto quando: test su durate delle pause, assenza di sovrapposizioni, trasposizione, limiti della variazione, durata totale, `Math.random` mai chiamato.
- [x] **T1.4** Helper `hasAudibleTokens(tokens)`. — R1.3
  - Fatto quando: `false` per `""`, `"   "`, `"...!?"`; `true` per `"a"`.

## Fase 2 — Stili

- [x] **T2.1** Stile `beep`. — R3.1, R6.2
  - Fatto quando: con variazione 0 tutte le frequenze sono identiche; tutti i pallini uguali.
- [x] **T2.2** Stile `grunt`. — R3.2, R3.3, R6.2
  - Fatto quando: 4 grunt distinti; mai due uguali consecutivi su 200 testi casuali; tutti e 4 usati su un testo lungo.
- [x] **T2.3** Stile `alphabet`. — R3.4, R3.5, R6.2
  - Fatto quando: 26 `SoundSpec` distinte; stessa lettera → stesso suono; cifre e `other` → suono neutro; 26 colori distinti.
- [x] **T2.4** Registry e snapshot della timeline di `"Hello, world!"` per ogni stile. — R3.8
  - Fatto quando: gli snapshot sono committati e stabili tra due esecuzioni.
- [ ] **T2.5** Revisione di `alphabet` dopo il feedback all'ascolto: vocali italiane con 3 formanti in cascata, ogni vocale suona sé stessa, altezza entro ±1 semitono, glide del parlato. — R3.9, R3.10 (D9)
  - Fatto quando: un test spettrale riconosce ognuna delle 5 vocali tra le altre 4; un test verifica lo scarto di altezza; ascolto di `a e i o u` a velocità bassa (M10).

## Fase 3 — Audio

- [x] **T3.1** `encodeWav`. — R7.1, R5.5
  - Fatto quando: header verificato byte per byte; lunghezza = 44 + 2·n; clamp di valori fuori range; un round-trip di decodifica restituisce i campioni entro 1 LSB.
- [x] **T3.2** `synthesize`: DSP puro (oscillatori PolyBLEP, formanti, glide, rumore, inviluppo, limitazione del picco). — R5.4, R5.5, design §6.1 (D6)
  - Fatto quando: test su determinismo, frequenza, glide, silenzio tra eventi, assenza di click, picco ≤ 0.98, 500 caratteri sotto 250 ms.
  - Nota: la prima versione con `OfflineAudioContext` impiegava 1,4–9,5 s per 500 caratteri su Chrome ed è stata sostituita (D6).
- [x] **T3.3** `Player` (play/stop/position, `unlock()` sincrono, compensazione della latenza). — R5.1, R5.2, R8.4 (D7)
  - Fatto quando: checklist M1 passa (verificata in Chrome headless; resta l'ascolto reale in T5.1).
- [x] **T3.4** `filename` per l'export. — R7.3
  - Fatto quando: test con data fissa → `mumble-beep-20261019-163000.wav`.

## Fase 4 — UI

- [x] **T4.1** Markup e CSS (tema, layout responsive, card stili, slider). — R2.1, R2.2, R4.1, R6.4, R8.7
- [x] **T4.2** Stato applicativo e collegamento dei controlli (stop su ogni modifica, contatore, messaggio R1.3). — R1.1–R1.3, R2.3, R4.4, R4.5, R5.3
- [x] **T4.3** Visualizer statico (token, pallini, colori, dimensioni). — R6.1, R6.2
- [x] **T4.4** Highlight sincronizzato con rAF + reduced motion. — R6.3, R6.5
- [x] **T4.5** Export WAV dai campioni in cache. — R7.1, R7.2
  - Fatto quando: un test unitario verifica che l'export non richiami la sintesi se la cache è valida.
- [x] **T4.6** Accessibilità: fieldset/radio, `<output>`, `aria-pressed`, `aria-live`, focus visibile. — R8.3

## Fase 5 — Verifica e rilascio

- [ ] **T5.1** Checklist manuale completa (sotto) su Chrome, Firefox, Safari, iOS Safari. — R8.2
- [x] **T5.2** Misura del bundle gzip. — R8.6
  - Esito: JS 4,7 KB + CSS 5,1 KB gzip (limite 50 KB).
- [x] **T5.3** Controllo nel pannello Network: nessuna richiesta dopo il load. — R8.1
  - Esito: zero richieste durante play ed export (Chrome headless).
- [ ] **T5.4** Deploy statico (vedi Q4 in requirements).

## Checklist manuale

Colonna *Headless*: esito della verifica automatica in Chrome headless del
2026-10-19 (`playwright-core`, script non incluso nel repo). Non sostituisce la
verifica manuale: l'audio non è stato ascoltato.

| ID | Passi | Atteso | Requisiti | Headless |
|---|---|---|---|---|
| M1 | Play su `Hello`, poi Stop a metà | Audio parte < 300 ms, si ferma subito, pulsante torna *Play* | R5.1, R5.2, R5.4 | ✓ 30–180 ms, 125 ms con 500 caratteri |
| M2 | Play, poi modificare testo / stile / slider | Riproduzione si ferma ogni volta | R4.5, R5.3 | ✓ slider |
| M3 | Play di 500 caratteri a velocità 30 | Highlight resta allineato all'audio fino alla fine | R6.3, R5.4 | ✓ parziale: tutte le lettere evidenziate su testo breve |
| M4 | Ascoltare i 3 stili su `Hello` | Beep uniforme; grunt variati e mai ripetuti; lettere riconoscibilmente diverse | R3.1–R3.4 | — richiede ascolto |
| M5 | Export e apertura del file in un player esterno | Suono identico a quello in pagina, nome file corretto | R7.1–R7.3 | ✓ header RIFF/WAVE e nome; confronto d'ascolto da fare |
| M6 | Finestra a 320 px | Nessuno scroll orizzontale, card in colonna | R6.4 | ✓ |
| M7 | Solo tastiera dall'inizio alla fine | Tutti i controlli raggiungibili e attivabili, focus visibile | R8.3 | — |
| M8 | Attivare reduced motion dal sistema operativo | Highlight senza animazioni di scala | R6.5 | — |
| M9 | Testo `"... !!!"` | Play/Export disabilitati, messaggio visibile | R1.3 | ✓ |
| M10 | Stile `alphabet`, velocità 5, testo `a e i o u` | Si riconoscono le cinque vocali italiane; le lettere hanno quasi la stessa nota | R3.9, R3.10 | — richiede ascolto |

## Tracciabilità

| Requisito | Task |
|---|---|
| R1 | T1.1, T1.4, T4.2 |
| R2 | T4.1, T4.2 |
| R3 | T1.3, T2.1–T2.5 |
| R4 | T1.3, T4.1, T4.2 |
| R5 | T3.1–T3.3, T4.2 |
| R6 | T2.x, T4.3, T4.4 |
| R7 | T1.3, T3.1, T3.4, T4.5 |
| R8 | T0.1, T1.x, T3.3, T4.6, T5.x |
