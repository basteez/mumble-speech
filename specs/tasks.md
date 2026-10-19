# Piano di implementazione

Stato: **approvato il 2026-10-19.** Ogni fase si chiude con la CI verde; ogni
task cita i requisiti che copre.

## Fase A — Fondamenta

- [x] **A1** `git init`, struttura monorepo (design §1), workspace Cargo e npm. Il playground è spostato in un repository separato (`../mumble-speech-playground`) insieme alle sue spec. — L6.1, LD8
  - Fatto quando: il playground passa test e build nella nuova posizione e il repo della libreria non contiene app.
- [ ] **A2** Repository GitHub e CI minima (job core). — LQ3
  - Fatto quando: la CI è verde sul primo push.

## Fase B — Core Rust

- [ ] **B1** `mumble-core`: tipi, normalizzazione, tokenizzazione per grafemi, RNG. — L1.2 (R1.4, R1.5), L1.3
- [ ] **B2** Stili `beep`, `grunt`, `alphabet` e scheduling, con seed da voce. — L1.2 (R3.x, R4.2, R4.3), L1.6, LD1
- [ ] **B3** Sintesi con `libm`, limitazione del picco per suono, WAV. — L1.2 (R5.5, R7.1, R7.4), L1.4, L1.5, LD2
- [ ] **B4** `Speaker` e `render` costruito sopra lo Speaker. — L2.1–L2.3, L3.1–L3.4
  - Fatto quando: un test di proprietà su 200 testi casuali conferma L3.2 bit per bit.
- [ ] **B5** Porting di tutti i test Vitest del core in Rust, più il benchmark di L2.5.
  - Fatto quando: ogni test TS ha un corrispettivo Rust (tabella in fondo al file del test).

## Fase C — Conformità

- [ ] **C1** `mumble-conformance`: elenco di casi, generazione di `conformance/vectors.json` e dell'header C dei vettori. — L5.1, LD7
- [ ] **C2** CI core su Linux, macOS e Windows con verifica dei vettori. — L1.4

## Fase D — Web

- [ ] **D1** `mumble-wasm` + `@mumble-speech/web` (API di design §5.1, `WebAudioPlayer`). — L4.1
- [ ] **D2** Test Vitest del pacchetto: vettori in Node, budget di peso. — L1.4, L4.2, L5.2
- [ ] **D3** Prova di consumo esterno in CI: `npm pack`, installazione del tarball in un progetto vuoto, uso dell'API pubblica. — L6.2
  - Dopo D3, il playground (nel suo repo) migra al pacchetto: task P1–P3 delle sue spec.

## Fase E — C ABI

- [ ] **E1** `mumble-ffi` con `catch_unwind`, codici di errore, header `cbindgen`. — L4.3–L4.5
- [ ] **E2** Esempio C e test CTest sui vettori; build in CI per le tre piattaforme (macOS universal). — L4.3, L5.2

## Fase F — Godot

- [ ] **F1** `mumble-godot` con `gdext`: `MumbleVoice`, `MumbleSpeaker`, `MumbleTypewriter`. — L4.6
- [ ] **F2** Addon in `bindings/godot`, progetto di esempio e test headless in CI. — L4.6, L4.9, L5.2
- [ ] **F3** Verifica manuale in Godot 4.3 desktop: esempio, inspector, typewriter (checklist G1–G3). — L4.6

## Fase G — Unity

- [ ] **G1** Pacchetto UPM: `Native.cs`, `MumbleVoice`, `MumbleSpeaker`, typewriter TMP opzionale. — L4.7
- [ ] **G2** Sample `Basic` e test EditMode sui vettori. — L4.9, L5.2
- [ ] **G3** Verifica manuale in Unity 2022.3 LTS (checklist U1–U3). — L4.7

## Fase H — Rilascio

- [ ] **H1** Job `release` su tag: zip dell'addon Godot, pacchetto Unity, tarball npm, archivio C. — L5.3
- [ ] **H2** README per ogni binding con un esempio di 10 righe. — L4.8, L4.9

## Checklist manuale

| ID | Passi | Atteso | Requisiti |
|---|---|---|---|
| G1 | Aprire `bindings/godot/example` in Godot 4.3, premere Play | Una battuta compare lettera per lettera con il suono sincronizzato | L4.6, L4.9 |
| G2 | Creare una risorsa `MumbleVoice` dall'inspector e assegnarla | I parametri cambiano il suono senza scrivere codice | L4.6 |
| G3 | Chiamare `say()` su un `MumbleSpeaker` da GDScript | Suona la frase, poi emette `finished` | L4.6 |
| U1 | Importare il pacchetto da percorso locale in Unity 2022.3, aprire il sample `Basic` | Il sample suona senza errori in console | L4.7, L4.9 |
| U2 | Eseguire i test EditMode | Tutti i vettori passano | L5.2 |
| U3 | Con TextMeshPro installato, usare il typewriter | Testo e suono sincronizzati | L4.7 |

## Verificabilità su questa macchina

- Disponibili: Rust 1.97, Node 26, CMake, clang. Da installare: target
  `wasm32-unknown-unknown`, `wasm-bindgen-cli`, `cbindgen`.
- Non disponibili: Godot, Unity, .NET. Godot si verifica in CI (headless) e
  con G1–G3 da parte tua; Unity solo con U1–U3 da parte tua.
- Windows e Linux si verificano solo in CI.

## Tracciabilità

| Requisito | Task |
|---|---|
| L1 | B1–B5, C2 |
| L2 | B4, B5 |
| L3 | B4 |
| L4.1–L4.2 | D1, D2 |
| L4.3–L4.5 | E1, E2 |
| L4.6 | F1–F3 |
| L4.7 | G1–G3 |
| L4.8–L4.9 | F2, G2, H2 |
| L5 | C1, C2, D2, E2, F2, G2, H1 |
| L6 | A1, D3 |
