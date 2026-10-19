# Mumble Speech Playground — Specifiche

Pagina web per provare la libreria `mumble-speech`: si scrive un testo, si
sceglie uno stile, si ascolta con visualizzazione sincronizzata e si esporta
in WAV.

La libreria (core Rust, binding web/Godot/Unity/C) sta in un repository
separato, `../mumble-speech`, con le sue spec. Questo progetto la userà solo
tramite il pacchetto npm `@mumble-speech/web` (task P1–P3).

## Documenti

| File | Contenuto | Domanda a cui risponde |
|---|---|---|
| [requirements.md](requirements.md) | User story e criteri di accettazione numerati | *Cosa* deve fare la pagina |
| [design.md](design.md) | Architettura, UI, stato | *Come* lo fa |
| [tasks.md](tasks.md) | Piano di implementazione tracciabile | *In che ordine* lo costruiamo |

## Regole del processo

1. Le spec sono la fonte di verità. Un cambio di comportamento si fa prima qui
   (o nelle spec della libreria, se riguarda il suono), poi nel codice.
2. Ogni requisito ha un ID (`R3.2`). Task, test e commit lo citano.
3. Un task è chiuso solo quando i criteri di accettazione collegati sono
   verificati.
4. Le decisioni prese in implementazione vanno in `design.md` → *Registro decisioni*.

## Stato

- [x] requirements.md approvato (2026-10-19)
- [x] design.md approvato (2026-10-19), rivisto in implementazione: D5–D9
- [x] tasks.md approvato (2026-10-19)
