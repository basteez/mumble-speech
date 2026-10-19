# Mumble Speech — Specifiche

Generatore di "mumble speech" (il parlato finto dei videogiochi) in tre stili.
Due parti:

- **Libreria**: core in Rust con binding per web, Godot, Unity e C ABI.
- **Playground**: la pagina web, che usa la libreria tramite il pacchetto npm.

## Documenti

| Parte | Requisiti (*cosa*) | Design (*come*) | Task (*in che ordine*) |
|---|---|---|---|
| Playground | [requirements.md](requirements.md) (R*) | [design.md](design.md) | [tasks.md](tasks.md) |
| Libreria | [library/requirements.md](library/requirements.md) (L*) | [library/design.md](library/design.md) | [library/tasks.md](library/tasks.md) |

Gli algoritmi (stili, scheduling, sintesi) sono definiti in `design.md` §4–§6
e valgono per la libreria; `library/design.md` descrive solo dove vivono e cosa
cambia (LD1–LD5).

## Regole del processo

1. Le spec sono la fonte di verità. Un cambio di comportamento si fa prima qui,
   poi nel codice.
2. Ogni requisito ha un ID (`R3.2`). Task, test e commit lo citano.
3. Un task è chiuso solo quando i criteri di accettazione collegati sono
   verificati (test automatico o checklist manuale indicata nel task).
4. Le decisioni prese durante l'implementazione che non sono già nelle spec
   vanno aggiunte in `design.md` → *Registro decisioni*.

## Stato

- [x] requirements.md approvato (2026-10-19)
- [x] design.md approvato (2026-10-19), poi rivisto in implementazione: D5–D8
- [x] tasks.md approvato (2026-10-19)
- [x] library/requirements.md approvato (2026-10-19)
- [x] library/design.md approvato (2026-10-19)
- [x] library/tasks.md approvato (2026-10-19)
