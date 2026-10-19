# Requisiti

Stato: **approvato il 2026-10-19.**

## 1. Obiettivo

Generare "mumble speech" (il parlato finto dei videogiochi) in tre stili con
una libreria che ha **un'unica implementazione in Rust**, usabile:

- sul web, tramite WebAssembly e un pacchetto npm;
- in Godot 4, tramite un addon GDExtension;
- in Unity, tramite un pacchetto UPM con libreria nativa;
- da qualunque altro linguaggio, tramite un'interfaccia C (C ABI).

La pagina web di prova (*playground*) è un progetto separato,
`mumble-speech-playground`, che usa la libreria solo tramite il pacchetto npm
(L6).

## 2. Glossario

| Termine | Significato |
|---|---|
| **Stile** | Algoritmo che decide quale suono associare a ogni carattere. In v1: `beep`, `grunt`, `alphabet`. |
| **Carattere sonoro** | Carattere che produce un suono: lettera, cifra o altro simbolo non classificato come spazio o punteggiatura. |
| **Pausa** | Silenzio prodotto da spazi, punteggiatura e a capo. |
| **Slot** | Unità di tempo base: `1 / velocità` secondi. Ogni carattere occupa uno o più slot. |
| **Timeline** | Sequenza ordinata di eventi sonori calcolata dal testo. È identica per riproduzione, visualizzazione ed export. |
| **Core** | Il crate Rust con tutta la logica: tokenizzazione, stili, timeline, sintesi, WAV. |
| **Binding** | Strato sottile che espone il core a una piattaforma (WASM/npm, C ABI, Godot, Unity). Nessuna logica di mumble speech. |
| **Voice** | Stile + altezza + velocità + variazione + seed. |
| **Render** | Audio di un testo intero, più la sua timeline. |
| **Speaker** | Oggetto con stato che produce il suono di un carattere alla volta (modalità macchina da scrivere). |
| **Advance** | Secondi da attendere dopo un carattere prima del successivo (1 slot, 2 o 4 per le pause). |
| **Vettore di conformità** | Caso di test condiviso (input → timeline attesa + hash del PCM) che ogni binding deve superare. |

## 3. Stili

| ID | Nome UI | Regola | Riferimento |
|---|---|---|---|
| `beep` | One beep per letter | Lo stesso beep per ogni carattere sonoro. | Undertale |
| `grunt` | A few grunts per character | La voce ha un piccolo set di grunt; ogni carattere sonoro ne suona uno. | Banjo-Kazooie |
| `alphabet` | A sound for every letter | Ognuna delle 26 lettere ha un suono proprio e riconoscibile. | Animal Crossing |

## 4. Requisiti

Formato EARS. **[auto]** = test automatico in CI, **[man]** = verifica
manuale, **[rev]** = verifica in code review.

### L1 — Core

- **L1.1** Tutta la logica di mumble speech DEVE stare nel core Rust. I binding NON DEVONO reimplementarne nessuna parte. [rev]
- **L1.2** Il core DEVE implementare i comportamenti R (sezione successiva). [auto]
- **L1.3** Il core DEVE compilare sia per `wasm32-unknown-unknown` sia per i target nativi, senza I/O, thread o clock. [auto]
- **L1.4** A parità di input, il PCM prodotto DEVE essere identico bit per bit su tutte le piattaforme supportate e in WASM. [auto]
- **L1.5** Il sample rate DEVE essere configurabile tra 8 000 e 192 000 Hz, con default 48 000. [auto]
- **L1.6** La `Voice` DEVE includere un `seed` intero (default 0). A parità di stile, voce e seed, la sequenza di suoni DEVE dipendere solo dai caratteri, non dal testo che segue. [auto]
- **L1.7** Il core DEVE rifiutare una voce fuori range: altezza da −12 a +12 semitoni, velocità da 5 a 30 caratteri/s, variazione da 0 a 1. [auto]

### R — Comportamento

Questi ID vengono dalla prima versione della pagina e restano invariati, così
test e commit esistenti continuano a riferirsi a loro.

- **R1.4** Il sistema DEVE trattare le lettere accentate come la lettera base (`è` → `e`, `ñ` → `n`). [auto]
- **R1.5** Il sistema DEVE classificare ogni carattere in esattamente una categoria: `letter`, `digit`, `space`, `pause-short` (`, ; :`), `pause-long` (`. ! ? …` e a capo), `other`. [auto]
- **R3.1** (`beep`) Ogni carattere sonoro DEVE produrre lo stesso suono; con variazione = 0 tutti gli eventi DEVONO avere frequenza identica. [auto]
- **R3.2** (`grunt`) La voce DEVE avere esattamente 4 grunt distinti per altezza, durata e timbro. [auto]
- **R3.3** (`grunt`) Ogni carattere sonoro DEVE suonare uno dei 4 grunt, scelto in modo pseudo-casuale ma deterministico, e DUE caratteri sonori consecutivi NON DEVONO usare lo stesso grunt. [auto]
- **R3.4** (`alphabet`) Ognuna delle 26 lettere DEVE avere un suono diverso da tutte le altre, e la stessa lettera DEVE produrre sempre lo stesso suono (a variazione = 0). [auto]
- **R3.5** (`alphabet`) Cifre e caratteri `other` DEVONO produrre un unico suono neutro comune. [auto]
- **R3.6** (tutti) Spazi DEVONO produrre 1 slot di silenzio, `pause-short` 2 slot, `pause-long` 4 slot. [auto]
- **R3.7** (tutti) Nessun suono DEVE superare il proprio slot: gli eventi non si sovrappongono. [auto]
- **R3.8** (tutti) A parità di testo e voce (seed incluso), la timeline DEVE essere identica tra esecuzioni diverse (determinismo). Il seed è esplicito, non derivato dal testo (LD1). [auto]
- **R3.9** (`alphabet`) Le lettere `a e i o u` DEVONO suonare come le vocali italiane corrispondenti: lo spettro di ciascuna DEVE essere più vicino ai formanti della propria vocale che a quelli delle altre quattro. [auto] [man]
- **R3.10** (`alphabet`) L'altezza di base DEVE variare al massimo di ±1 semitono tra lettere diverse: a distinguere le lettere è il timbro, non la nota. [auto]
- **R4.2** L'altezza DEVE trasporre tutte le frequenze dello stile di `2^(semitoni/12)`. [auto]
- **R4.3** La variazione DEVE aggiungere a ogni evento uno scostamento di altezza casuale (deterministico) nell'intervallo `±variazione × 2` semitoni. [auto]
- **R5.5** Il core NON DEVE produrre clipping: tutti i campioni DEVONO restare in `[−1, 1]`. [auto]
- **R7.1** `encodeWav` DEVE produrre un file WAV PCM 16 bit, mono, al sample rate richiesto. [auto]
- **R7.4** La durata del render DEVE essere la fine dell'ultimo suono più 50 ms di coda; le pause finali sono escluse. [auto]

### L2 — API "frase intera"

- **L2.1** Il core DEVE offrire `render(testo, voice, sampleRate)`, che restituisce il PCM mono `f32` e la timeline. [auto]
- **L2.2** Il core DEVE offrire `timeline(testo, voice)` senza sintetizzare audio. [auto]
- **L2.3** Ogni evento della timeline DEVE riportare: indice del grafema, intervallo in byte UTF-8, intervallo in unità UTF-16, inizio, durata, colore del pallino (sRGB `#rrggbb`) e dimensione (`sm`/`md`/`lg`). [auto]
- **L2.4** Il core DEVE offrire `encodeWav(pcm, sampleRate)`, che produce un WAV PCM a 16 bit mono. [auto]
- **L2.5** `render` su 500 caratteri a velocità 5 DEVE impiegare meno di 50 ms in nativo e meno di 150 ms in WASM, su un laptop di fascia media. [auto]

### L3 — API "carattere per carattere" (Speaker)

- **L3.1** Il core DEVE offrire uno `Speaker` creato da `voice` e `sampleRate`, con `next(grafema)` che restituisce: campioni (vuoti per spazi e pause), advance in secondi, pallino (assente per spazi e pause). [auto]
- **L3.2** Se si posizionano i campioni restituiti da `next` per ogni grafema di un testo ai rispettivi advance cumulati, il risultato DEVE essere identico bit per bit a `render` dello stesso testo. [auto]
- **L3.3** SE `next` riceve una stringa con più grafemi, DEVE elaborarli in ordine e restituire suoni concatenati e l'advance totale. [auto]
- **L3.4** `reset()` DEVE riportare lo Speaker allo stato iniziale. [auto]

### L4 — Binding

- **L4.1** (Web) Un pacchetto npm `@mumble-speech/web`, ESM con tipi TypeScript, DEVE esporre L2 e L3 e un helper `WebAudioPlayer`. Deve funzionare nelle ultime 2 versioni di Chrome, Firefox, Safari desktop e Safari iOS, e in Node ≥ 20. [auto]
- **L4.2** (Web) Il pacchetto, WASM incluso, DEVE pesare meno di 60 KB gzip. [auto]
- **L4.3** (C ABI) La libreria DEVE fornire un header `mumble.h` generato automaticamente e librerie precompilate per macOS (universal arm64 + x86_64), Windows x64 e Linux x64. [auto]
- **L4.4** (C ABI) Nessuna funzione DEVE propagare un panic oltre il confine C: gli errori DEVONO essere codici di ritorno. La proprietà di ogni puntatore DEVE essere documentata nell'header. [auto] [rev]
- **L4.5** (C ABI) L'header DEVE esporre `mumble_abi_version()`. Un cambio incompatibile DEVE incrementare la versione. [rev]
- **L4.6** (Godot) Un addon per Godot ≥ 4.3 DEVE offrire una risorsa `MumbleVoice` configurabile dall'inspector, un nodo `MumbleSpeaker` che riproduce frasi o singoli caratteri, e un nodo `MumbleTypewriter` che rivela un `Label` o `RichTextLabel` carattere per carattere sincronizzato con l'audio. Piattaforme: desktop (Windows, macOS, Linux). [auto] [man]
- **L4.7** (Unity) Un pacchetto UPM per Unity ≥ 2022.3 LTS DEVE offrire un `ScriptableObject` `MumbleVoice`, un componente `MumbleSpeaker` (`Say`, `SpeakCharacter`, eventi per carattere e per fine frase) e un helper typewriter per `TMP_Text`, opzionale se TextMeshPro è presente. Piattaforme: desktop. [man]
- **L4.8** Ogni binding DEVE usare gli stessi concetti (Voice, render, timeline, Speaker, advance) con nomi adattati alle convenzioni della piattaforma. [rev]
- **L4.9** Ogni binding DEVE includere un esempio minimo eseguibile. [man]

### L5 — Conformità e qualità

- **L5.1** Il repository DEVE contenere almeno 30 vettori di conformità (stili, voci, seed, sample rate, testi limite). L'hash del PCM è FNV-1a a 64 bit sui byte `f32` little-endian, facile da implementare in ogni linguaggio. [auto]
- **L5.2** Le suite di test di core, Web, C ABI e Godot DEVONO superare tutti i vettori in CI. Quella Unity DEVE superarli in esecuzione manuale (in CI servirebbe una licenza Unity). [auto] [man]
- **L5.3** Tutti i pacchetti DEVONO condividere la stessa versione semver. [rev]

### L6 — Uso da progetti esterni

- **L6.1** Il repository della libreria NON DEVE contenere il playground né altre app dimostrative oltre agli esempi minimi di L4.9. [rev]
- **L6.2** Il pacchetto `@mumble-speech/web` DEVE poter essere installato da un progetto esterno prima della pubblicazione, come tarball (`npm pack`) o dipendenza `file:`. Una prova in CI installa il tarball in un progetto vuoto e ne usa l'API pubblica. [auto]

## 5. Fuori scope (v1)

- Librerie precompilate per iOS, Android e console (la C ABI le rende possibili in seguito).
- Export web di Godot con GDExtension e Unity WebGL.
- Plugin Unreal dedicato (usabile tramite C ABI, senza wrapper).
- Stili personalizzati o definiti da dati.
- Sintesi in streaming nel thread audio.
- Pubblicazione sui registry (npm, Godot Asset Library, OpenUPM).

## 6. Domande risolte

Chiuse con i default proposti, approvati insieme alle spec il 2026-10-19.

| # | Domanda | Decisione |
|---|---|---|
| LQ1 | Nomi dei pacchetti (`@mumble-speech/web`, `com.mumble-speech.unity`, crate `mumble-speech`)? | Questi, previa verifica di disponibilità. |
| LQ2 | Licenza? | MIT OR Apache-2.0, convenzione Rust. |
| LQ3 | Hosting e CI? | GitHub + GitHub Actions. Serve inizializzare git e creare il repo. |
| LQ4 | Il cambio di seed (L1.6) cambia leggermente il comportamento di R3.8: il seed non deriva più dal testo. Va bene? | Sì: è necessario per L3.2. |
| LQ5 | Dove sta il playground? | In un progetto separato, `mumble-speech-playground` (richiesta dell'utente, 2026-10-19). |
