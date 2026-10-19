# Mumble Speech — Specifiche

Libreria che genera "mumble speech" (il parlato finto dei videogiochi) in tre
stili: core in Rust con binding per web (WASM/npm), Godot, Unity e C ABI.

La pagina web di prova è un progetto separato, `mumble-speech-playground`, con
le sue spec.

## Documenti

| File | Contenuto | Domanda a cui risponde |
|---|---|---|
| [requirements.md](requirements.md) | Requisiti numerati: comportamento (R*) e libreria (L*) | *Cosa* deve fare |
| [design.md](design.md) | Architettura, algoritmi, binding, CI | *Come* lo fa |
| [tasks.md](tasks.md) | Piano di implementazione tracciabile | *In che ordine* lo costruiamo |

## Regole del processo

1. Le spec sono la fonte di verità. Un cambio di comportamento si fa prima qui,
   poi nel codice.
2. Ogni requisito ha un ID (`R3.2`, `L3.2`). Task, test e commit lo citano.
3. Un task è chiuso solo quando i criteri di accettazione collegati sono
   verificati (test automatico o checklist manuale indicata nel task).
4. Le decisioni prese durante l'implementazione che non sono già nelle spec
   vanno aggiunte in `design.md` → *Registro decisioni*.

## Stato

- [x] requirements.md approvato (2026-10-19; R* dalla prima versione, L* dalla spec della libreria)
- [x] design.md approvato (2026-10-19)
- [x] tasks.md approvato (2026-10-19)
