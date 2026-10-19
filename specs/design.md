# Design

Stato: **approvato il 2026-10-19.** Riferimenti ai requisiti tra parentesi
quadre, per esempio [L3.2]. Gli algoritmi (§4–§7) vengono dalla prima versione
in TypeScript; i punti cambiati sono in §8.

## 1. Struttura del repository

Monorepo con workspace Cargo e npm.

```
crates/
  mumble-core/        # tutta la logica, #![no_std] + alloc [L1.1, L1.3]
  mumble-ffi/         # C ABI: cdylib + staticlib, header via cbindgen [L4.3–L4.5]
  mumble-wasm/        # export wasm-bindgen [L4.1]
  mumble-godot/       # GDExtension via godot-rust (gdext) [L4.6]
  mumble-conformance/ # generatore dei vettori [L5.1]
packages/
  web/                # @mumble-speech/web: wrapper TS + WebAudioPlayer [L4.1]
bindings/
  c/                  # mumble.h generato, esempio e test CMake
  godot/              # addons/mumble_speech + progetto di esempio e test
  unity/              # pacchetto UPM: Runtime/, Plugins/, Samples~/, Tests/
conformance/
  vectors.json        # [L5.1]
specs/
```

## 2. API del core (Rust)

```rust
pub enum StyleId { Beep, Grunt, Alphabet }

pub struct Voice {
    pub style: StyleId,
    pub pitch: f64,      // semitoni, −12..12
    pub speed: f64,      // caratteri/s, 5..30
    pub variation: f64,  // 0..1
    pub seed: u32,       // [L1.6]
}

pub enum DotSize { Sm, Md, Lg }
pub struct Dot { pub rgb: u32, pub size: DotSize }        // 0xRRGGBB [L2.3]

pub struct Event {
    pub grapheme_index: u32,
    pub utf8: Range<u32>,
    pub utf16: Range<u32>,                                // per JS e C# [L2.3]
    pub start: f64, pub duration: f64,                    // secondi
    pub dot: Dot,
}

pub struct Timeline { pub events: Vec<Event>, pub duration: f64 }

pub fn timeline(text: &str, voice: &Voice) -> Timeline;                    // [L2.2]
pub fn render(text: &str, voice: &Voice, sample_rate: u32) -> Render;     // [L2.1]
pub struct Render { pub samples: Vec<f32>, pub timeline: Timeline }
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8>;         // [L2.4]

pub struct Speaker { /* voice, rng, prev, sample_rate */ }                // [L3]
impl Speaker {
    pub fn new(voice: Voice, sample_rate: u32) -> Self;
    pub fn next(&mut self, text: &str) -> Utterance;
    pub fn reset(&mut self);
}
pub struct Utterance { pub samples: Vec<f32>, pub advance: f64, pub dot: Option<Dot> }
```

`render` è implementato sopra `Speaker`: per ogni grafema chiama `next` e
scrive i campioni a `round(t × sampleRate)`, con `t` pari agli advance
cumulati. Così L3.2 vale per costruzione, ed è comunque verificato da un test.

Dipendenze del core: `libm` (matematica deterministica [L1.4]) e
`unicode-segmentation` (grafemi, `no_std`). Nient'altro.

## 3. Determinismo cross-platform [L1.4]

- Tutti i calcoli interni in `f64`, uscita convertita in `f32` solo alla fine.
- Funzioni trascendenti (`sin`, `cos`, `exp`, `pow`, `log2`) solo da `libm`,
  mai da `std` o dalla libm di sistema, che differiscono tra piattaforme.
- Rust non fonde le operazioni in FMA in automatico; non si usa `mul_add`.
- Nessuna iterazione su `HashMap`; le tabelle sono array.
- Posizioni in campioni con `round` di `libm`.
- Verifica: gli stessi vettori di conformità girano su nativo (macOS, Windows,
  Linux) e su WASM in CI, confrontando l'hash del PCM.

## 4. Algoritmi

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

- `seed = fnv1a(styleId) XOR voice.seed` (LD1; nella prima versione derivava dal testo).
- `rng = mulberry32(seed)`: unica sorgente di casualità, consumata in ordine di token.
- Nessuna altra sorgente di casualità nel core.

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
## 6. Sintesi [R5.5, L2.5] (D6)

Funzione pura: timeline + sample rate → campioni `f32`.

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
- Master gain 0.8. Il picco si limita **per suono**: se un suono supera 0.98,
  si scala quel suono per riportarlo a 0.98 [R5.5] (LD2).
## 7. WAV [R7.1, L2.4]

`encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer`

- Header RIFF/WAVE standard, `fmt ` PCM (formato 1), 1 canale, 16 bit.
- Conversione: `clamp(x, −1, 1)`, poi `x < 0 ? x × 0x8000 : x × 0x7FFF`, little-endian.
- Funzione pura, prende direttamente l'output del render.

## 8. Cambiamenti rispetto alla prima versione (TypeScript)

| # | Cosa | Prima | Ora | Motivo |
|---|---|---|---|---|
| LD1 | Seed | `fnv1a(stile + testo)` | `fnv1a(stile) XOR voice.seed` | In modalità macchina da scrivere lo Speaker non conosce il testo che segue [L1.6, L3.2]. Chi vuole varietà tra battute passa un seed diverso, per esempio l'id della battuta. |
| LD2 | Limitazione del picco | Scala globale del buffer | Ogni suono limitato a 0,98 da solo | Con una scala globale `render` e Speaker non coinciderebbero. Gli eventi non si sovrappongono, quindi R5.5 resta valido. |
| LD3 | Colore del pallino | Stringa CSS (`var(--teal)`, `hsl(…)`) | `0xRRGGBB` | Neutro rispetto alla piattaforma. I colori dei temi CSS diventano: teal `0x3f8f78`, blue `0x3f6fc4`, olive `0x7d8f45`, orange `0xb85a33`, muted `0x9aa0a6`; `hsl(h 55% 55%)` si converte in RGB. |
| LD4 | Sample rate di default | 44 100 | 48 000 | Default di Unity e dei dispositivi moderni. |
| LD5 | Implementazione | TypeScript (nel playground) | Rust | Un'unica implementazione [L1.1]. I test Vitest del core TS diventano test Rust e vettori di conformità. |

## 9. Binding

### 9.1 Web: `mumble-wasm` + `@mumble-speech/web` [L4.1, L4.2]

- `wasm-bindgen` (versione fissata) con `--target web`, build con
  `opt-level = "z"`, LTO e `wasm-opt -Oz`.
- Gli oggetti attraversano il confine in forma compatta: i campioni come
  `Float32Array`, gli eventi come `Float64Array` impacchettato. Il wrapper TS li
  trasforma in oggetti tipizzati. Niente `serde`, per il peso [L4.2].
- API TS:

```ts
await init();                        // carica il WASM, idempotente
render(text, voice, sampleRate?) → { samples: Float32Array; timeline: Timeline }
timeline(text, voice) → Timeline
encodeWav(samples, sampleRate) → Uint8Array
new Speaker(voice, sampleRate?)  .next(text) → Utterance  .reset()  .free()
new WebAudioPlayer()  .unlock()  .play(samples, sampleRate)  .stop()  .position()
```

- `WebAudioPlayer` è il `Player` del playground, spostato nel pacchetto.
- Test: Vitest in Node carica il WASM ed esegue i vettori [L5.2]. Una prova di consumo esterno fa `npm pack`, installa il tarball in un progetto vuoto e usa l'API pubblica [L6.2].

### 9.2 C ABI: `mumble-ffi` [L4.3–L4.5]

```c
uint32_t mumble_abi_version(void);

typedef struct { uint32_t style; double pitch, speed, variation; uint32_t seed; } MumbleVoice;
typedef struct { uint32_t grapheme_index, utf8_start, utf8_len, utf16_start, utf16_len;
                 double start, duration; uint32_t dot_rgb; uint8_t dot_size; } MumbleEvent;

typedef struct MumbleRender MumbleRender;   // opaco, posseduto dal chiamante
int32_t mumble_render(const char *utf8, size_t len, const MumbleVoice *v,
                      uint32_t sample_rate, MumbleRender **out);
const float *mumble_render_samples(const MumbleRender *r, size_t *len);  // valido fino a free
size_t mumble_render_event_count(const MumbleRender *r);
int32_t mumble_render_event(const MumbleRender *r, size_t i, MumbleEvent *out);
void mumble_render_free(MumbleRender *r);

typedef struct MumbleSpeaker MumbleSpeaker;
MumbleSpeaker *mumble_speaker_new(const MumbleVoice *v, uint32_t sample_rate);
int32_t mumble_speaker_next(MumbleSpeaker *s, const char *utf8, size_t len,
                            const float **samples, size_t *count,   // validi fino alla prossima chiamata
                            double *advance, uint32_t *dot_rgb, uint8_t *dot_size);
void mumble_speaker_reset(MumbleSpeaker *s);
void mumble_speaker_free(MumbleSpeaker *s);

int32_t mumble_encode_wav(const float *samples, size_t len, uint32_t sample_rate,
                          uint8_t **out, size_t *out_len);
void mumble_bytes_free(uint8_t *p, size_t len);
```

- Codici: `0` ok, `<0` errore (`-1` argomento nullo, `-2` UTF-8 non valido,
  `-3` voce fuori range, `-99` panic intercettato con `catch_unwind`) [L4.4].
- Header generato da `cbindgen` in build e committato in `bindings/c/`.
- Test: programma C (CMake + CTest) che esegue un sottoinsieme dei vettori,
  incorporati come header generato dal crate di conformità.

### 9.3 Godot: `mumble-godot` [L4.6]

- GDExtension scritta in Rust con `gdext`, che usa il core direttamente (non
  la C ABI): un passaggio in meno, tipi Godot nativi.
- Classi:
  - `MumbleVoice` (`Resource`): `style`, `pitch`, `speed`, `variation`, `seed`, modificabili dall'inspector.
  - `MumbleSpeaker` (`Node`): `voice`, `bus`; `say(text)`, `speak_character(c)`, `stop()`, `render_stream(text) → AudioStreamWAV`; segnali `character_spoken(index)` e `finished`. Al suo interno usa un `AudioStreamPlayer`.
  - `MumbleTypewriter` (`Node`): `label: NodePath`, `speaker: NodePath`; `type_text(text)` imposta il testo, rivela un carattere alla volta con `visible_characters` usando gli advance e suona ogni carattere; segnale `finished`.
- Distribuzione: `bindings/godot/addons/mumble_speech/` con il file
  `.gdextension` e i binari per piattaforma in `bin/`.
- Test: progetto Godot di test eseguito in CI con `godot --headless`, che
  verifica i vettori tramite `MumbleSpeaker.render_stream` e il funzionamento del typewriter.

### 9.4 Unity [L4.7]

- Pacchetto `com.mumble-speech.unity`:
  - `Runtime/Native.cs`: `[DllImport("mumble_ffi")]` sulla C ABI.
  - `Runtime/MumbleVoice.cs` (`ScriptableObject`).
  - `Runtime/MumbleSpeaker.cs` (`MonoBehaviour` con `AudioSource`): `Say(string)` crea un `AudioClip` con `AudioClip.Create` + `SetData`; `SpeakCharacter(string)`; eventi `OnCharacter(int)` e `OnFinished`.
  - `Runtime/TMP/MumbleTypewriterTMP.cs` in un assembly separato, compilato solo se `com.unity.textmeshpro` è presente (`versionDefines`). Usa `maxVisibleCharacters` e gli advance.
  - `Plugins/{macOS,Windows,Linux}/`: binari della C ABI.
  - `Samples~/Basic`: scena di esempio [L4.9].
  - `Tests/EditMode`: esecuzione dei vettori [L5.2].
- Verifica: manuale, perché una licenza Unity in CI non è disponibile.

## 10. Build e CI [L4.3, L5.2]

GitHub Actions, matrice:

| Job | Runner | Produce / verifica |
|---|---|---|
| core | ubuntu, macos, windows | `cargo test`, vettori nativi, benchmark L2.5 |
| wasm | ubuntu | build WASM, test Vitest del pacchetto, budget L4.2, consumo esterno L6.2 |
| ffi | ubuntu, macos, windows | libreria nativa (macOS universal con `lipo`), test CTest |
| godot | ubuntu | build GDExtension, test headless |
| release | su tag | artefatti: zip dell'addon Godot, pacchetto Unity, tarball npm, archivio C |

## 11. Migrazione

1. Porting del core in Rust con i test del core TS (nel playground) tradotti:
   stesse proprietà (determinismo, no sovrapposizioni, grunt mai ripetuti,
   vocali R3.9…).
2. Snapshot Vitest → vettori di conformità. Gli hash cambiano rispetto al TS
   per LD1–LD2 e per l'uso di `libm`: è atteso.
3. Il playground, nel suo repository, passa a `@mumble-speech/web` tramite il
   tarball o una dipendenza `file:` [L6.2]. Quella migrazione è tracciata nelle
   spec del playground.
4. Solo dopo che il playground funziona con il pacchetto si aggiungono C ABI,
   Godot e Unity.

## 12. Rischi

| Rischio | Mitigazione |
|---|---|
| Bit-exactness WASM ↔ nativo | `libm` ovunque + vettori in CI su tutte le piattaforme |
| Quarantena di macOS sui `.dylib` scaricati (Godot, Unity) | Documentare `xattr -d`; firma e notarizzazione fuori scope v1 |
| Compatibilità `gdext` con le versioni di Godot | Fissare la versione minima (4.3) e testarla in CI |
| Peso del WASM | Niente `serde`, `opt-level = "z"`, `wasm-opt`, budget verificato in CI |
| Unity non verificabile in CI | Test EditMode nel pacchetto + checklist manuale |

## 13. Registro decisioni

| # | Decisione | Alternativa scartata | Motivo |
|---|---|---|---|
| LD0 | Core unico in Rust + binding | Porting multipli; solo TS | Scelta dell'utente: una sola implementazione, output identico ovunque |
| LD1–LD5 | Vedi §8 | | |
| LD6 | Godot tramite `gdext` sul core, non tramite C ABI | GDExtension in C++ sulla C ABI | Meno codice di collegamento, tipi Godot nativi, stesso linguaggio del core |
| LD7 | Hash dei vettori FNV-1a 64 | SHA-256 | Implementabile in poche righe in C, C#, GDScript e TS |
| LD8 | Playground in un repository separato | `apps/playground` nel monorepo | Richiesta dell'utente: il repo della libreria contiene solo la libreria [L6.1] |

Decisioni ereditate dalla prima versione (ID invariati):

| # | Decisione | Alternativa scartata | Motivo |
|---|---|---|---|
| D3 | Suoni ≤ 0.9 slot | Sovrapposizioni consentite | Niente clipping da somma, timeline più semplice |
| D4 | Mapping vocale dal nome inglese delle lettere, solo per le consonanti (rivisto da D9) | Mapping arbitrario | Più vicino ad Animalese, regola spiegabile |
| D5 | Makeup ×3 sui formanti | Nessuna compensazione | Un passa-banda stretto lascia passare circa un'armonica: senza makeup `grunt` e `alphabet` sono molto più bassi di `beep` |
| D6 | Sintesi DSP in TypeScript (sostituisce il grafo `OfflineAudioContext`) | `OfflineAudioContext` | Misurato su Chrome: 1,4–9,5 s per 500 caratteri, perché i nodi restano attivi per tutta la durata (costo O(eventi × durata)), quindi violava il requisito di latenza del playground (R5.4). La sintesi diretta è lineare, testabile in Node e identica tra browser |
| D9 | `alphabet`: vocali con 3 formanti in cascata, ogni vocale suona sé stessa, altezza quasi costante | 2 passa-banda stretti in parallelo, vocali dal nome inglese, ±6 semitoni tra lettere | Feedback all'ascolto: non sembrava Animal Crossing e le vocali non erano riconoscibili (la `a` suonava "e", la `i` suonava "a"). I passa-banda stretti fischiano, la cascata dà vocali credibili; i salti di nota facevano sembrare il risultato una melodia |
