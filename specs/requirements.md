# Requisiti

> **Nota (libreria):** il motore è stato estratto nella libreria `mumble-speech`
> (repository separato, `specs/requirements.md`). R1.4, R1.5, R3.x, R4.2, R4.3,
> R5.5, R7.1 e R7.4 sono specificati lì, con gli stessi ID; qui restano per
> riferimento finché il playground usa ancora il suo core TypeScript (task P1–P3).
> Con la libreria cambiano anche R3.8 (seed esplicito, LD1) e R8.6 (il WASM è
> escluso dal budget, coperto da L4.2 della libreria).

## 1. Obiettivo

Permettere a chiunque di scrivere una frase, scegliere uno stile di mumble
speech, ascoltarla con una visualizzazione lettera-per-lettera e scaricarla
come file WAV. Tutto gira nel browser, senza backend.

## 2. Glossario

| Termine | Significato |
|---|---|
| **Stile** | Algoritmo che decide quale suono associare a ogni carattere. In v1: `beep`, `grunt`, `alphabet`. |
| **Carattere sonoro** | Carattere che produce un suono: lettera, cifra o altro simbolo non classificato come spazio o punteggiatura. |
| **Pausa** | Silenzio prodotto da spazi, punteggiatura e a capo. |
| **Slot** | Unità di tempo base: `1 / velocità` secondi. Ogni carattere occupa uno o più slot. |
| **Timeline** | Sequenza ordinata di eventi sonori calcolata dal testo. È identica per riproduzione, visualizzazione ed export. |
| **Voce** | L'insieme di parametri regolabili: altezza, velocità, variazione. |

## 3. Stili (riferimento)

| ID | Nome UI | Regola | Riferimento |
|---|---|---|---|
| `beep` | One beep per letter | Lo stesso beep per ogni carattere sonoro. | Undertale |
| `grunt` | A few grunts per character | La voce ha un piccolo set di grunt; ogni carattere sonoro ne suona uno. | Banjo-Kazooie |
| `alphabet` | A sound for every letter | Ognuna delle 26 lettere ha un suono proprio e riconoscibile. | Animal Crossing |

## 4. Requisiti

Formato EARS: *QUANDO / MENTRE / SE … il sistema DEVE …*. I criteri marcati
**[auto]** vanno coperti da test automatici; quelli **[man]** da verifica
manuale (checklist in `tasks.md`).

### R1 — Inserimento testo

*Come utente voglio scrivere la frase da far "parlare".*

- **R1.1** Il sistema DEVE offrire un campo di testo multilinea precompilato con `Hello`. [man]
- **R1.2** Il sistema DEVE accettare al massimo 500 caratteri e mostrare un contatore `n/500`. [man]
- **R1.3** SE il testo non contiene caratteri sonori, il sistema DEVE disabilitare *Play* ed *Export* e mostrare il motivo. [auto]
- **R1.4** Il sistema DEVE trattare le lettere accentate come la lettera base (`è` → `e`, `ñ` → `n`). [auto]
- **R1.5** Il sistema DEVE classificare ogni carattere in esattamente una categoria: `letter`, `digit`, `space`, `pause-short` (`, ; :`), `pause-long` (`. ! ? …` e a capo), `other`. [auto]

### R2 — Scelta dello stile

*Come utente voglio scegliere tra i tre stili e capire cosa fa ciascuno.*

- **R2.1** Il sistema DEVE mostrare i tre stili come opzioni mutuamente esclusive, ciascuna con nome, descrizione di una riga e gioco di riferimento. [man]
- **R2.2** Lo stile predefinito DEVE essere `beep`. [man]
- **R2.3** QUANDO l'utente cambia stile, il sistema DEVE ricalcolare la visualizzazione senza ricaricare la pagina. [man]

### R3 — Comportamento degli stili

- **R3.1** (`beep`) Ogni carattere sonoro DEVE produrre lo stesso suono; con variazione = 0 tutti gli eventi DEVONO avere frequenza identica. [auto]
- **R3.2** (`grunt`) La voce DEVE avere esattamente 4 grunt distinti per altezza, durata e timbro. [auto]
- **R3.3** (`grunt`) Ogni carattere sonoro DEVE suonare uno dei 4 grunt, scelto in modo pseudo-casuale ma deterministico, e DUE caratteri sonori consecutivi NON DEVONO usare lo stesso grunt. [auto]
- **R3.4** (`alphabet`) Ognuna delle 26 lettere DEVE avere un suono diverso da tutte le altre, e la stessa lettera DEVE produrre sempre lo stesso suono (a variazione = 0). [auto]
- **R3.5** (`alphabet`) Cifre e caratteri `other` DEVONO produrre un unico suono neutro comune. [auto]
- **R3.6** (tutti) Spazi DEVONO produrre 1 slot di silenzio, `pause-short` 2 slot, `pause-long` 4 slot. [auto]
- **R3.7** (tutti) Nessun suono DEVE superare il proprio slot: gli eventi non si sovrappongono. [auto]
- **R3.8** (tutti) A parità di testo, stile e voce, la timeline DEVE essere identica tra esecuzioni diverse (determinismo). [auto]
- **R3.9** (`alphabet`) Le lettere `a e i o u` DEVONO suonare come le vocali italiane corrispondenti: lo spettro di ciascuna DEVE essere più vicino ai formanti della propria vocale che a quelli delle altre quattro. [auto] [man]
- **R3.10** (`alphabet`) L'altezza di base DEVE variare al massimo di ±1 semitono tra lettere diverse: a distinguere le lettere è il timbro, non la nota. [auto]

### R4 — Parametri della voce

*Come utente voglio regolare la voce per dare carattere al personaggio.*

- **R4.1** Il sistema DEVE offrire tre slider con valore visibile:
  - **Altezza**: da −12 a +12 semitoni, passo 1, default 0. [man]
  - **Velocità**: da 5 a 30 caratteri/secondo, passo 1, default 15. [man]
  - **Variazione**: da 0 a 1, passo 0,05, default 0. [man]
- **R4.2** L'altezza DEVE trasporre tutte le frequenze dello stile di `2^(semitoni/12)`. [auto]
- **R4.3** La variazione DEVE aggiungere a ogni evento uno scostamento di altezza casuale (deterministico) nell'intervallo `±variazione × 2` semitoni. [auto]
- **R4.4** I parametri DEVONO essere condivisi tra stili: cambiare stile non li reimposta. [man]
- **R4.5** QUANDO l'utente modifica un parametro durante la riproduzione, il sistema DEVE fermare la riproduzione. [man]

### R5 — Riproduzione

- **R5.1** QUANDO l'utente preme *Play*, il sistema DEVE riprodurre la timeline dall'inizio. [man]
- **R5.2** MENTRE è in riproduzione, il pulsante DEVE diventare *Stop* e fermare l'audio immediatamente se premuto. [man]
- **R5.3** QUANDO l'utente preme *Play* durante una riproduzione, o modifica testo/stile, il sistema DEVE fermare la riproduzione in corso prima di fare altro. [man]
- **R5.4** Il primo suono DEVE partire entro 300 ms dal click con testi fino a 500 caratteri, su un laptop di fascia media. [man]
- **R5.5** Il sistema NON DEVE produrre clipping: tutti i campioni DEVONO restare in `[−1, 1]`. [auto]

### R6 — Visualizzazione

*Come utente voglio vedere quale lettera sta "parlando", come nell'immagine di riferimento.*

- **R6.1** Il sistema DEVE mostrare il testo come riga di caratteri in font pixel/monospace, con sotto ogni carattere sonoro un pallino. Spazi e punteggiatura NON hanno pallino. [man]
- **R6.2** Colore e dimensione dei pallini DEVONO dipendere dallo stile:
  - `beep`: tutti dello stesso colore e dimensione;
  - `grunt`: colore e dimensione determinati dal grunt suonato (4 combinazioni);
  - `alphabet`: colore determinato dalla lettera (26 colori distinti), dimensione costante. [auto]
- **R6.3** MENTRE l'audio suona, il carattere e il pallino dell'evento corrente DEVONO essere evidenziati, con uno scarto percepito non superiore a 50 ms rispetto al suono. [man]
- **R6.4** La visualizzazione DEVE andare a capo senza scroll orizzontale da 320 px di larghezza in su. [man]
- **R6.5** SE l'utente ha `prefers-reduced-motion`, l'evidenziazione DEVE essere un cambio di colore senza animazioni di scala. [man]

### R7 — Export WAV

- **R7.1** QUANDO l'utente preme *Export WAV*, il sistema DEVE scaricare un file WAV PCM 16 bit, mono, 44 100 Hz. [auto]
- **R7.2** L'audio esportato DEVE essere identico campione per campione a quello riprodotto con gli stessi input. [auto]
- **R7.3** Il nome del file DEVE essere `mumble-<stile>-<YYYYMMDD-HHmmss>.wav`. [auto]
- **R7.4** La durata del file DEVE essere la fine dell'ultimo suono più 50 ms di coda; le pause finali sono escluse. [auto]

### R8 — Requisiti non funzionali

- **R8.1** L'app DEVE essere un sito statico, senza backend né chiamate di rete dopo il caricamento. [man]
- **R8.2** L'app DEVE funzionare nelle ultime 2 versioni di Chrome, Firefox, Safari desktop e Safari iOS. [man]
- **R8.3** Tutti i controlli DEVONO essere usabili da tastiera, con etichette accessibili e focus visibile. [man]
- **R8.4** L'`AudioContext` DEVE essere creato o ripreso solo in risposta a un gesto dell'utente (policy autoplay). [man]
- **R8.5** La logica che va dal testo alla timeline e il codificatore WAV DEVONO essere funzioni pure, testabili senza browser. [auto]
- **R8.6** Il bundle di produzione (JS + CSS, gzip, escluso il font) DEVE restare sotto i 50 KB. [man]
- **R8.7** Tema scuro come nel riferimento, con contrasto testo/sfondo almeno WCAG AA. [man]

## 5. Fuori scope (v1)

- Text-to-speech reale o riconoscimento di sillabe.
- Suoni basati su campioni audio o caricati dall'utente.
- Più voci/personaggi per stile, preset salvabili.
- Link condivisibili, persistenza delle impostazioni.
- Intonazione automatica (per esempio altezza crescente su `?`).
- Riproduzione mentre si digita.
- Export in formati diversi da WAV.

## 6. Domande risolte

Chiuse con i default proposti, approvati insieme alle spec il 2026-10-19.

| # | Domanda | Decisione |
|---|---|---|
| Q1 | Lingua della UI? | Inglese, coerente con i nomi degli stili. |
| Q2 | 4 grunt sono il numero giusto per `grunt`? | 4, coerente con l'esempio (3–4 pallini diversi). |
| Q3 | Le cifre in `alphabet` vanno lette come nome (`1` → "one")? | No, suono neutro (R3.5). |
| Q4 | Deploy previsto (GitHub Pages, Netlify…)? | GitHub Pages; influenza solo il `base` di Vite. |
