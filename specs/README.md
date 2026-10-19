# Mumble Speech Playground — Specifications

Web page for trying out the `mumble-speech` library: you write a text,
choose a style, listen to it with synchronized visualization and export it
to WAV.

The library (Rust core, web/Godot/Unity/C bindings) lives in a separate
repository, `../mumble-speech`, with its own specs. This project will use it only
through the npm package `@mumble-speech/web` (tasks P1–P3).

## Documents

| File | Content | Question it answers |
|---|---|---|
| [requirements.md](requirements.md) | User stories and numbered acceptance criteria | *What* the page must do |
| [design.md](design.md) | Architecture, UI, state | *How* it does it |
| [tasks.md](tasks.md) | Traceable implementation plan | *In what order* we build it |

## Process rules

1. The specs are the source of truth. A behavior change is made here first
   (or in the library specs, if it concerns the sound), then in the code.
2. Every requirement has an ID (`R3.2`). Tasks, tests and commits cite it.
3. A task is closed only when the linked acceptance criteria are
   verified.
4. Decisions made during implementation go in `design.md` → *Decision log*.

## Status

- [x] requirements.md approved (2026-10-19)
- [x] design.md approved (2026-10-19), revised during implementation: D5–D9
- [x] tasks.md approved (2026-10-19)
