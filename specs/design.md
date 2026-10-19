# Design

Riferimenti ai requisiti tra parentesi quadre, per esempio [R3.8].

## 1. Stack

| Ambito | Scelta | Motivo |
|---|---|---|
| Build | Vite, template `vanilla-ts` | Zero framework, bundle piccolo [R8.6] |
| Linguaggio | TypeScript `strict` | Modello dati esplicito |
| Test | Vitest (ambiente `node` per core e sintesi) | Core e sintesi sono puri [R8.5] |
| Audio | Sintesi DSP in TypeScript + `AudioContext` solo per la riproduzione | Nessun asset [R8.1], costo lineare [R5.4] (D6) |
| Font | Pixelify Sans self-hosted via `@fontsource` (D8) | Nessuna rete a runtime [R8.1] |

Nessuna dipendenza runtime oltre al font.

## 2. Architettura

Pipeline a senso unico. Tutto ciò che sta a sinistra di `Player` e del download
è puro e testabile in Node.

```
testo ──► normalize ──► tokenize ──► buildTimeline(style, voice, seed) ──► Timeline
                                                                            │
                                     ┌──────────────────────────────────────┤
                                     ▼                                      ▼
                     synthesize(Timeline) → Float32Array              Visualizer
                           │            │                        (pallini, highlight)
                           ▼            ▼
                        Player       encodeWav → Blob → download
```

Decisione chiave: **riproduzione ed export usano gli stessi campioni**,
generati una sola volta da `synthesize` (D1, D6). Il `Player` li copia in un
`AudioBuffer` e li suona con un `AudioBufferSourceNode`. Questo garantisce [R7.2] per costruzione e rende la
sincronizzazione visiva [R6.3] un semplice confronto tra `currentTime` e gli
`start` degli eventi.

### Struttura dei moduli

```
src/
  core/
    types.ts        # tipi condivisi (sezione 3)
    normalize.ts    # NFD + rimozione diacritici [R1.4]
    tokenize.ts     # classificazione caratteri [R1.5]
    rng.ts          # hash FNV-1a + PRNG mulberry32 [R3.8]
    timeline.ts     # scheduling slot/pause + applicazione voce [R3.6–R3.8, R4.2–R4.3]
  styles/
    index.ts        # registry: StyleId → Style
    beep.ts
    grunt.ts
    alphabet.ts
  audio/
    synth.ts        # Timeline → Float32Array, DSP puro (D6)
    cache.ts        # memoizza la sintesi della timeline corrente [R7.2]
    player.ts       # play/stop, posizione compensata dalla latenza (D7)
    wav.ts          # AudioBuffer-like → ArrayBuffer WAV [R7.1]
  ui/
    controls.ts     # textarea, stili, slider, pulsanti
    visualizer.ts   # griglia lettere + pallini + highlight
    filename.ts     # nome file export [R7.3]
  main.ts           # composizione e stato
  style.css
tests/              # specchio di src/core, src/styles, src/audio (tranne player)
```

## 3. Modello dati

```ts
type StyleId = 'beep' | 'grunt' | 'alphabet';

type TokenKind = 'letter' | 'digit' | 'space' | 'pause-short' | 'pause-long' | 'other';

interface Token {
  index: number;      // posizione nel testo originale (per la UI)
  char: string;       // carattere originale, mostrato nella UI
  base: string;       // carattere normalizzato minuscolo, usato dagli stili
  kind: TokenKind;
}

interface Voice {
  pitch: number;      // semitoni, −12..12
  speed: number;      // caratteri/secondo, 5..30
  variation: number;  // 0..1
}

// Cosa suonare: descrizione astratta, indipendente da Web Audio.
interface SoundSpec {
  waveform: 'square' | 'sawtooth' | 'triangle' | 'sine';
  frequency: number;          // Hz, prima di pitch/variazione
  glide?: number;             // semitoni di glissando su tutta la durata
  durationRatio: number;      // frazione dello slot, (0, 0.9]
  formants?: [number, number];// Hz, passa-banda in parallelo (timbro dei grunt)
  vocalTract?: Resonance[];   // risonatori in cascata (vocali) [R3.9]
  noiseBurst?: { centerHz: number; durationMs: number }; // attacco consonantico
  gain: number;               // 0..1
}

interface Resonance { frequency: number; bandwidth: number } // Hz

interface Dot { color: string; size: 'sm' | 'md' | 'lg' }

interface SoundEvent {
  tokenIndex: number;
  start: number;      // secondi dall'inizio
  duration: number;   // secondi
  sound: SoundSpec;   // con frequency già trasposta e variata
  dot: Dot;
}

interface Timeline {
  tokens: Token[];
  events: SoundEvent[];
  duration: number;   // fine ultimo evento + 0.05 [R7.4]
}

interface Style {
  id: StyleId;
  label: string;
  description: string;
  reference: string;
  // Puro: stesso input → stesso output. `prev` serve al vincolo di R3.3.
  voice(token: Token, rng: () => number, prev: SoundSpec | null): { sound: SoundSpec; dot: Dot };
}
```

## 4. Algoritmi del core

### 4.1 Normalizzazione e tokenizzazione [R1.4, R1.5]

1. `base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.
2. Classificazione, in quest'ordine:
   - `\n` o `. ! ? …` → `pause-long`
   - `, ; :` → `pause-short`
   - spazi e tab → `space`
   - `base` in `a–z` → `letter`
   - `0–9` → `digit`
   - tutto il resto → `other` (emoji, alfabeti non latini, simboli)
3. Si itera per *grapheme* (`Intl.Segmenter`), così un'emoji composta conta come un solo token.

### 4.2 Determinismo [R3.8]

- `seed = fnv1a(styleId + '\u0000' + text)`.
- `rng = mulberry32(seed)`: unica sorgente di casualità, consumata in ordine di token.
- Vietato usare `Math.random()` nel core (verificato da un test che lo sostituisce con una funzione che lancia errore).

### 4.3 Scheduling [R3.6, R3.7, R7.4]

```
slot = 1 / voice.speed
t = 0
per ogni token:
  space        → t += 1 slot
  pause-short  → t += 2 slot
  pause-long   → t += 4 slot
  sonoro       → { sound, dot } = style.voice(token, rng, prev)
                 dur = sound.durationRatio * slot      // ≤ 0.9 slot ⇒ nessuna sovrapposizione
                 semitoni = voice.pitch + (rng() * 2 - 1) * voice.variation * 2
                 freq = sound.frequency * 2^(semitoni / 12)
                 emetti evento(start = t, duration = dur)
                 t += 1 slot
duration = ultimo evento.start + ultimo evento.duration + 0.05
```

Nota: `rng()` per la variazione si consuma **sempre**, anche con variazione 0,
così la sequenza casuale degli stili non dipende dalla variazione.

## 5. Stili

Frequenze base prima della trasposizione [R4.2].

### 5.1 `beep` [R3.1]

| Proprietà | Valore |
|---|---|
| Forma d'onda | `square` |
| Frequenza | 520 Hz |
| `durationRatio` | 0.5 |
| Gain | 0.35 |
| Pallino | colore `--teal`, `md` |

Nessun uso di `rng` dentro lo stile.

### 5.2 `grunt` [R3.2, R3.3]

Quattro grunt fissi: onda `sawtooth` filtrata passa-basso, glissando verso il basso.

| # | Frequenza | Glide | `durationRatio` | Formanti | Pallino |
|---|---|---|---|---|---|
| 0 | 140 Hz | −3 | 0.5 | 600 / 1000 | `--teal`, `sm` |
| 1 | 180 Hz | −5 | 0.75 | 700 / 1200 | `--blue`, `md` |
| 2 | 110 Hz | −2 | 0.9 | 500 / 900 | `--olive`, `lg` |
| 3 | 210 Hz | −6 | 0.6 | 800 / 1400 | `--orange`, `md` |

Scelta: `i = floor(rng() * 4)`; se `i` coincide con il grunt precedente,
`i = (i + 1 + floor(rng() * 3)) % 4`. Così la distribuzione resta uniforme sui
tre grunt ammessi.

### 5.3 `alphabet` [R3.4, R3.5, R3.9, R3.10] (D9)

Ogni lettera = attacco consonantico opzionale (rumore filtrato) + vocale
sintetizzata con un tratto vocale a 3 formanti in cascata.

Formanti delle vocali italiane (voce media-acuta, adatta a un'altezza di
240 Hz), come coppie frequenza / larghezza di banda in Hz:

| Vocale | F1 | F2 | F3 |
|---|---|---|---|
| a | 850 / 90 | 1400 / 110 | 2800 / 170 |
| e | 450 / 80 | 2200 / 110 | 2900 / 170 |
| i | 310 / 70 | 2600 / 120 | 3300 / 200 |
| o | 500 / 80 | 900 / 100 | 2800 / 170 |
| u | 340 / 70 | 800 / 100 | 2700 / 170 |
| schwa | 550 / 90 | 1550 / 110 | 2650 / 170 |

Vocale di ogni lettera:

- le vocali `a e i o u` usano **la propria vocale** [R3.9];
- le consonanti usano la vocale del proprio nome inglese, stile Animalese (D4):

| Consonanti | Vocale |
|---|---|
| b c d g p t v z | i |
| f l m n s x | e |
| h j k | e |
| r y | a |
| q w | u |

Con `n = indice della lettera (a = 0 … z = 25)`:

- forma d'onda `sawtooth`, frequenza base `240 × 2^(o / 12)` con
  `o = ((n × 7) mod 5 − 2) × 0.5` semitoni, quindi `o ∈ {−1, −0.5, 0, 0.5, 1}` [R3.10];
- `glide` −1.5 semitoni: l'altezza cala leggermente dentro ogni sillaba, come nel parlato;
- `noiseBurst` solo per le consonanti: `centerHz = 1500 + n × 250`, `durationMs = 12`;
- `durationRatio = 0.85`, gain 0.4;
- pallino: `hsl(round(n × 360 / 26), 55%, 55%)`, `md`.

La coppia (vocale, `o`, `centerHz`) è diversa per ogni lettera; un test
verifica che le 26 `SoundSpec` siano tutte distinte [R3.4].

Cifre e `other`: schwa, 240 Hz, stesso glide, nessun rumore, pallino grigio
`--muted` [R3.5].

Verifica di R3.9: per ogni vocale si sintetizza un evento lungo a 100 Hz (a
240 Hz le armoniche sono troppo rade e il risultato dipende da dove cadono) e si misura
l'energia (Goertzel, in dB) nelle bande ±100 Hz attorno a F1, F2 e F3 di
ciascuna delle cinque vocali. Ogni banda si normalizza sottraendo la media
delle cinque vocali, così si elimina la pendenza spettrale comune (−6 dB/ottava),
che altrimenti favorirebbe sempre le vocali con formanti bassi. La vocale con
il punteggio più alto deve essere quella giusta. Il test usa solo la tabella
dei formanti, non il codice del filtro.

## 6. Audio

### 6.1 Sintesi [R5.4, R5.5, R7.2] (D6)

`synthesize(timeline, sampleRate = 44100): Float32Array`, funzione pura.

- Buffer di `ceil(duration × sampleRate)` campioni. Ogni evento scrive solo
  nei propri campioni `[start, start + duration)`, quindi il costo è lineare nel
  numero di campioni sonori.
- Oscillatore: accumulatore di fase. `square` e `sawtooth` con correzione
  PolyBLEP contro l'aliasing; `sine` e `triangle` diretti.
- `glide`: frequenza istantanea esponenziale da `f` a `f × 2^(glide/12)` lungo
  l'evento.
- `formants`: due biquad passa-banda in parallelo (RBJ cookbook, guadagno di
  picco 0 dB, Q = 8), ciascuno × 3 di makeup (D5). Stato dei filtri azzerato a
  ogni evento.
- `vocalTract`: risonatori di Klatt in cascata (guadagno unitario in continua,
  `y = A·x + B·y₁ + C·y₂`), uno per formante, seguiti da un guadagno di
  calibrazione fisso che porta il livello delle vocali vicino a quello degli
  altri stili. In cascata le ampiezze relative dei formanti escono già corrette,
  senza tarare un guadagno per formante (D9).
- Inviluppo: attacco lineare 3 ms, sustain, rilascio lineare negli ultimi 15 ms
  (o 30% della durata se più corta), così non ci sono click.
- `noiseBurst`: rumore bianco da `mulberry32(fnv1a('noise'))` (mai
  `Math.random`) → passa-banda a `centerHz`, Q = 2 → decadimento esponenziale
  fino a −60 dB in `durationMs`.
- Master gain 0.8. Alla fine si misura il picco: se > 0.98, si scala l'intero
  buffer per riportarlo a 0.98 [R5.5].

### 6.2 Player [R5.1–R5.4, R8.4]

- Un solo `AudioContext`, creato o ripreso con `unlock()` in modo sincrono
  dentro il click su *Play*, prima di qualunque `await` (Safari perde il gesto
  dopo un `await`).
- `play(samples)`: ferma eventuale sorgente attiva, copia i campioni in un
  `AudioBuffer`, crea `AudioBufferSourceNode`, memorizza
  `startTime = ctx.currentTime + 0.02`, avvia.
- `position()`: `ctx.currentTime − startTime − latenza`, dove latenza è
  `outputLatency` (o `baseLatency` dove manca), usato dal visualizer (D7).
- Evento `ended` → stato `idle`.
- Cache (`cache.ts`): i campioni della timeline corrente restano validi finché
  testo, stile e voce non cambiano; l'export li riusa.

### 6.3 WAV [R7.1]

`encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer`

- Header RIFF/WAVE standard, `fmt ` PCM (formato 1), 1 canale, 16 bit.
- Conversione: `clamp(x, −1, 1)`, poi `x < 0 ? x × 0x8000 : x × 0x7FFF`, little-endian.
- Funzione pura, prende direttamente l'output di `synthesize`.

## 7. UI

### 7.1 Layout

```
┌───────────────────────────────────────────────┐
│ Mumble Speech                                 │
│ ┌───────────────────────────────────────────┐ │
│ │ Hello                              5/500  │ │
│ └───────────────────────────────────────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │1 Beep    │ │2 Grunt   │ │3 Alphabet│  ← radio│
│ │Undertale │ │Banjo-K.  │ │Animal C. │        │
│ └──────────┘ └──────────┘ └──────────┘        │
│ Pitch  ───●───  0 st                          │
│ Speed  ────●──  15 c/s                        │
│ Var.   ●──────  0.00                          │
│                                               │
│    H   e   l   l   o                          │
│    ●   ●   ●   ●   ●                          │
│                                               │
│ [ ▶ Play ]   [ ⤓ Export WAV ]                 │
└───────────────────────────────────────────────┘
```

Su schermi stretti le card degli stili vanno in colonna [R6.4].

### 7.2 Stato applicativo

```ts
interface AppState {
  text: string;
  style: StyleId;
  voice: Voice;
  timeline: Timeline;          // derivato, ricalcolato a ogni input
  playback: 'idle' | 'rendering' | 'playing';
}
```

Ogni modifica di `text`, `style` o `voice` → stop [R4.5, R5.3] → nuova
`timeline` → invalidazione della cache audio → ridisegno del visualizer.
Il ricalcolo della timeline è sincrono e costa O(n) su 500 caratteri, quindi
nessun debounce. La sintesi avviene solo su *Play* o *Export*.

### 7.3 Visualizer [R6.1–R6.5]

- Ogni token è un `<span>`; i token consecutivi non-spazio sono raggruppati in
  una `.word` così l'a capo avviene tra parole (una parola più lunga della riga
  va comunque a capo al suo interno). I token sonori contengono un pallino
  (`<i>`) con `--dot-color` e classe di dimensione.
- Highlight: un loop `requestAnimationFrame` attivo solo durante `playing`
  trova l'evento con `start ≤ position() < start + duration` (ricerca binaria) e
  imposta `data-active` sul token. Gli spazi restano visibili come gap.
- Con `prefers-reduced-motion: reduce` niente `transform: scale`, solo colore.
- Il contenitore ha `aria-hidden="true"`: il testo è già nella textarea, e la
  visualizzazione è decorativa.

### 7.4 Accessibilità [R8.3]

- Stili come `<fieldset>` di radio nativi con card come `<label>`.
- Slider `<input type="range">` con `<output>` associato.
- Pulsante Play/Stop con `aria-pressed` e testo che cambia.
- Messaggio di R1.3 in una regione `aria-live="polite"`.

### 7.5 Tema [R8.7]

Variabili CSS: `--bg #000`, `--card #0b0d0f`, `--border #2a2d31`,
`--text #f2f2f2`, `--muted #9aa0a6`, `--teal #3f8f78`, `--blue #3f6fc4`,
`--olive #7d8f45`, `--orange #b85a33`.

## 8. Strategia di test

| Livello | Cosa | Requisiti |
|---|---|---|
| Unit (Vitest, node) | normalize, tokenize, rng, timeline, tre stili, synthesize, cache, encodeWav, filename | R1.3–R1.5, R3.x, R4.2–R4.3, R5.5, R6.2, R7.1–R7.4, R8.5 |
| Performance (Vitest) | `synthesize` su 500 caratteri a velocità 5, tutti gli stili, sotto 250 ms | R5.4 |
| Smoke (Chrome headless, non nel repo) | play, highlight, stop su modifica, export, layout 320 px | R5, R6, R7, M2, M6, M9 |
| Property-based leggero | per 200 testi casuali: nessuna sovrapposizione, determinismo, nessun grunt ripetuto | R3.3, R3.7, R3.8 |
| Snapshot | timeline di `"Hello, world!"` per ogni stile | regressioni |
| Manuale | checklist in `tasks.md` (audio, sync, browser, a11y) | resto |

Solo il `Player` non si testa in Node. R7.2 è garantito dall'architettura
(stessi campioni) e verificato con un test che controlla che l'export usi i
campioni in cache.

## 9. Registro decisioni

| # | Decisione | Alternativa scartata | Motivo |
|---|---|---|---|
| D1 | Render offline anche per la riproduzione | Scheduling live su `AudioContext` | Un solo percorso di codice, export identico, sync semplice |
| D2 | Seed derivato da stile + testo | Seed casuale per sessione | Determinismo e test riproducibili |
| D3 | Suoni ≤ 0.9 slot | Sovrapposizioni consentite | Niente clipping da somma, timeline più semplice |
| D4 | Mapping vocale dal nome inglese delle lettere, solo per le consonanti (rivisto da D9) | Mapping arbitrario | Più vicino ad Animalese, regola spiegabile |
| D5 | Makeup ×3 sui formanti | Nessuna compensazione | Un passa-banda stretto lascia passare circa un'armonica: senza makeup `grunt` e `alphabet` sono molto più bassi di `beep` |
| D6 | Sintesi DSP in TypeScript (sostituisce il grafo `OfflineAudioContext`) | `OfflineAudioContext` | Misurato su Chrome: 1,4–9,5 s per 500 caratteri, perché i nodi restano attivi per tutta la durata (costo O(eventi × durata)), quindi viola R5.4. La sintesi diretta è lineare, testabile in Node e identica tra browser |
| D7 | Highlight compensato da `outputLatency` | `currentTime` grezzo | Con cuffie Bluetooth la latenza arriva a 100–200 ms, oltre il limite di R6.3 |
| D8 | Pixelify Sans al posto di Silkscreen | Silkscreen | Silkscreen ha solo maiuscole e maiuscoletto; il riferimento mostra minuscole vere |
| D9 | `alphabet`: vocali con 3 formanti in cascata, ogni vocale suona sé stessa, altezza quasi costante | 2 passa-banda stretti in parallelo, vocali dal nome inglese, ±6 semitoni tra lettere | Feedback all'ascolto: non sembrava Animal Crossing e le vocali non erano riconoscibili (la `a` suonava "e", la `i` suonava "a"). I passa-banda stretti fischiano, la cascata dà vocali credibili; i salti di nota facevano sembrare il risultato una melodia |
