# Libreria — Requisiti

Stato: **approvato il 2026-10-19.**

## 1. Obiettivo

Estrarre il motore di mumble speech in una libreria con **un'unica
implementazione in Rust**, usabile:

- sul web, tramite WebAssembly e un pacchetto npm;
- in Godot 4, tramite un addon GDExtension;
- in Unity, tramite un pacchetto UPM con libreria nativa;
- da qualunque altro linguaggio, tramite un'interfaccia C (C ABI).

La pagina web descritta in [`../requirements.md`](../requirements.md) diventa
il *playground* della libreria e la usa esclusivamente tramite il pacchetto npm.

## 2. Glossario

Valgono i termini di [`../requirements.md`](../requirements.md) §2, più:

| Termine | Significato |
|---|---|
| **Core** | Il crate Rust con tutta la logica: tokenizzazione, stili, timeline, sintesi, WAV. |
| **Binding** | Strato sottile che espone il core a una piattaforma (WASM/npm, C ABI, Godot, Unity). Nessuna logica di mumble speech. |
| **Voice** | Stile + altezza + velocità + variazione + seed. |
| **Render** | Audio di un testo intero, più la sua timeline. |
| **Speaker** | Oggetto con stato che produce il suono di un carattere alla volta (modalità macchina da scrivere). |
| **Advance** | Secondi da attendere dopo un carattere prima del successivo (1 slot, 2 o 4 per le pause). |
| **Vettore di conformità** | Caso di test condiviso (input → timeline attesa + hash del PCM) che ogni binding deve superare. |

## 3. Requisiti

Formato EARS. **[auto]** = test automatico in CI, **[man]** = verifica
manuale, **[rev]** = verifica in code review.

### L1 — Core

- **L1.1** Tutta la logica di mumble speech DEVE stare nel core Rust. I binding NON DEVONO reimplementarne nessuna parte. [rev]
- **L1.2** Il core DEVE implementare i comportamenti già specificati per la pagina: R1.4, R1.5, R3.1–R3.10, R4.2, R4.3, R5.5, R7.1, R7.4. [auto]
- **L1.3** Il core DEVE compilare sia per `wasm32-unknown-unknown` sia per i target nativi, senza I/O, thread o clock. [auto]
- **L1.4** A parità di input, il PCM prodotto DEVE essere identico bit per bit su tutte le piattaforme supportate e in WASM. [auto]
- **L1.5** Il sample rate DEVE essere configurabile tra 8 000 e 192 000 Hz, con default 48 000. [auto]
- **L1.6** La `Voice` DEVE includere un `seed` intero (default 0). A parità di stile, voce e seed, la sequenza di suoni DEVE dipendere solo dai caratteri, non dal testo che segue. [auto]

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

- **L4.1** (Web) Un pacchetto npm `@mumble-speech/web`, ESM con tipi TypeScript, DEVE esporre L2 e L3 e un helper `WebAudioPlayer`. Deve funzionare nei browser di R8.2 e in Node ≥ 20. [auto]
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

### L6 — Playground (la pagina web)

- **L6.1** La pagina DEVE usare solo l'API pubblica di `@mumble-speech/web`, senza import interni. [auto]
- **L6.2** I requisiti R1–R8 della pagina restano validi. R8.6 diventa: JS + CSS sotto i 50 KB gzip, WASM escluso, perché è coperto da L4.2. [auto]

## 4. Fuori scope (v1)

- Librerie precompilate per iOS, Android e console (la C ABI le rende possibili in seguito).
- Export web di Godot con GDExtension e Unity WebGL.
- Plugin Unreal dedicato (usabile tramite C ABI, senza wrapper).
- Stili personalizzati o definiti da dati.
- Sintesi in streaming nel thread audio.
- Pubblicazione sui registry (npm, Godot Asset Library, OpenUPM).

## 5. Domande risolte

Chiuse con i default proposti, approvati insieme alle spec il 2026-10-19.

| # | Domanda | Decisione |
|---|---|---|
| LQ1 | Nomi dei pacchetti (`@mumble-speech/web`, `com.mumble-speech.unity`, crate `mumble-speech`)? | Questi, previa verifica di disponibilità. |
| LQ2 | Licenza? | MIT OR Apache-2.0, convenzione Rust. |
| LQ3 | Hosting e CI? | GitHub + GitHub Actions. Serve inizializzare git e creare il repo. |
| LQ4 | Il cambio di seed (L1.6) cambia leggermente il comportamento di R3.8 nella pagina: il seed non deriva più dal testo. Va bene? | Sì: è necessario per L3.2. Nella pagina il seed resta 0. |
