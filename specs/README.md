# Mumble Speech — Specifications

Library that generates "mumble speech" (the fake speech of video games) in three
styles: Rust core with bindings for web (WASM/npm), Godot, Unity and C ABI.

The web playground is a private app in this repository (`apps/playground`),
with its own specs in [`playground/`](playground/README.md).

## Documents

| File | Content | Question it answers |
|---|---|---|
| [requirements.md](requirements.md) | Numbered requirements: behavior (R*) and library (L*) | *What* it must do |
| [design.md](design.md) | Architecture, algorithms, bindings, CI | *How* it does it |
| [tasks.md](tasks.md) | Traceable implementation plan | *In what order* we build it |
| [playground/](playground/README.md) | Requirements (R1–R8), design and tasks of the web playground | Same three questions, for the page |

## Process rules

1. The specs are the source of truth. A behavior change is made here first,
   then in the code.
2. Every requirement has an ID (`R3.2`, `L3.2`). Tasks, tests and commits cite it.
3. A task is closed only when the linked acceptance criteria are
   verified (automated test or manual checklist indicated in the task).
4. Decisions made during implementation that are not already in the specs
   must be added to `design.md` → *Decision log*.
5. Every change lands through a pull request: `main` is protected (CI checks
   required, no direct pushes, enforced for admins). Branch names and PR
   titles cite the task ID.
6. A pull request that changes behavior or public API adds an entry to the
   *Unreleased* section of `CHANGELOG.md` (L8.4).

## Status

- [x] requirements.md approved (2026-10-19; R* from the first version, L* from the library spec)
- [x] design.md approved (2026-10-19)
- [x] tasks.md approved (2026-10-19)
- [x] Revision of 2026-10-24 (LQ6 sound identifier, L7 site, L8 release; design §12–§13, LD14–LD15; tasks I1–J3, H1–H3): approved (2026-10-24, PR #8)
