# Libreria — Design

Stato: **approvato il 2026-10-19.** Riferimenti ai requisiti tra parentesi
quadre, per esempio [L3.2]. Gli algoritmi (stili, scheduling, sintesi) sono
quelli di [`../design.md`](../design.md) §4–§6 e qui non si ripetono: cambia
solo dove vivono e i punti in §4.

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
apps/
  playground/         # la pagina web attuale [L6]
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

## 4. Cambiamenti rispetto al design della pagina

| # | Cosa | Prima | Ora | Motivo |
|---|---|---|---|---|
| LD1 | Seed | `fnv1a(stile + testo)` | `fnv1a(stile) XOR voice.seed` | In modalità macchina da scrivere lo Speaker non conosce il testo che segue [L1.6, L3.2]. Chi vuole varietà tra battute passa un seed diverso, per esempio l'id della battuta. |
| LD2 | Limitazione del picco | Scala globale del buffer | Ogni suono limitato a 0,98 da solo | Con una scala globale `render` e Speaker non coinciderebbero. Gli eventi non si sovrappongono, quindi R5.5 resta valido. |
| LD3 | Colore del pallino | Stringa CSS (`var(--teal)`, `hsl(…)`) | `0xRRGGBB` | Neutro rispetto alla piattaforma. Il playground lo converte in `#rrggbb`. |
| LD4 | Sample rate di default | 44 100 | 48 000 | Default di Unity e dei dispositivi moderni. Il playground passa 44 100 o il rate dell'`AudioContext`. |
| LD5 | Implementazione | TypeScript | Rust; il TS attuale viene rimosso dopo il porting | Un'unica implementazione [L1.1]. I test Vitest esistenti diventano test Rust e vettori di conformità. |

## 5. Binding

### 5.1 Web: `mumble-wasm` + `@mumble-speech/web` [L4.1, L4.2]

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

- `WebAudioPlayer` è il `Player` attuale, spostato nel pacchetto.
- Test: Vitest in Node carica il WASM ed esegue i vettori [L5.2].

### 5.2 C ABI: `mumble-ffi` [L4.3–L4.5]

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

### 5.3 Godot: `mumble-godot` [L4.6]

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

### 5.4 Unity [L4.7]

- Pacchetto `com.mumble-speech.unity`:
  - `Runtime/Native.cs`: `[DllImport("mumble_ffi")]` sulla C ABI.
  - `Runtime/MumbleVoice.cs` (`ScriptableObject`).
  - `Runtime/MumbleSpeaker.cs` (`MonoBehaviour` con `AudioSource`): `Say(string)` crea un `AudioClip` con `AudioClip.Create` + `SetData`; `SpeakCharacter(string)`; eventi `OnCharacter(int)` e `OnFinished`.
  - `Runtime/TMP/MumbleTypewriterTMP.cs` in un assembly separato, compilato solo se `com.unity.textmeshpro` è presente (`versionDefines`). Usa `maxVisibleCharacters` e gli advance.
  - `Plugins/{macOS,Windows,Linux}/`: binari della C ABI.
  - `Samples~/Basic`: scena di esempio [L4.9].
  - `Tests/EditMode`: esecuzione dei vettori [L5.2].
- Verifica: manuale, perché una licenza Unity in CI non è disponibile.

## 6. Build e CI [L4.3, L5.2]

GitHub Actions, matrice:

| Job | Runner | Produce / verifica |
|---|---|---|
| core | ubuntu, macos, windows | `cargo test`, vettori nativi, benchmark L2.5 |
| wasm | ubuntu | build WASM, test Vitest del pacchetto, budget L4.2 |
| ffi | ubuntu, macos, windows | libreria nativa (macOS universal con `lipo`), test CTest |
| godot | ubuntu | build GDExtension, test headless |
| playground | ubuntu | build, test, budget R8.6/L6.2 |
| release | su tag | artefatti: zip dell'addon Godot, pacchetto Unity, tarball npm, archivio C |

## 7. Migrazione

1. Porting del core in Rust con i test attuali tradotti (stesse proprietà:
   determinismo, no sovrapposizioni, grunt mai ripetuti, vocali R3.9…).
2. Snapshot Vitest → vettori di conformità. Gli hash cambiano rispetto al TS
   per LD1–LD2 e per l'uso di `libm`: è atteso.
3. Il playground passa a `@mumble-speech/web`. Si eliminano `src/core`,
   `src/styles`, `src/audio/synth.ts`, `src/audio/wav.ts`. Restano UI,
   visualizer e cache; il player si sposta nel pacchetto.
4. Solo dopo che il playground passa i suoi test e la checklist M si aggiungono
   C ABI, Godot e Unity.

## 8. Rischi

| Rischio | Mitigazione |
|---|---|
| Bit-exactness WASM ↔ nativo | `libm` ovunque + vettori in CI su tutte le piattaforme |
| Quarantena di macOS sui `.dylib` scaricati (Godot, Unity) | Documentare `xattr -d`; firma e notarizzazione fuori scope v1 |
| Compatibilità `gdext` con le versioni di Godot | Fissare la versione minima (4.3) e testarla in CI |
| Peso del WASM | Niente `serde`, `opt-level = "z"`, `wasm-opt`, budget verificato in CI |
| Unity non verificabile in CI | Test EditMode nel pacchetto + checklist manuale |

## 9. Registro decisioni

| # | Decisione | Alternativa scartata | Motivo |
|---|---|---|---|
| LD0 | Core unico in Rust + binding | Porting multipli; solo TS | Scelta dell'utente: una sola implementazione, output identico ovunque |
| LD1–LD5 | Vedi §4 | | |
| LD6 | Godot tramite `gdext` sul core, non tramite C ABI | GDExtension in C++ sulla C ABI | Meno codice di collegamento, tipi Godot nativi, stesso linguaggio del core |
| LD7 | Hash dei vettori FNV-1a 64 | SHA-256 | Implementabile in poche righe in C, C#, GDScript e TS |
