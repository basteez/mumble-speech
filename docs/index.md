---
layout: home

hero:
  name: mumble-speech
  text: Video-game mumble speech, generated at runtime
  tagline: The babble that game characters speak, in three styles. One Rust core, the same output bit for bit on the web, in Godot, in Unity and from C.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the playground
      link: /playground/
      target: _self
    - theme: alt
      text: GitHub
      link: https://github.com/basteez/mumble-speech

features:
  - title: Beep
    details: One beep for every letter, like Undertale.
    link: /guide/styles#beep
  - title: Grunt
    details: A few grunts per voice, never the same twice in a row, like Banjo-Kazooie.
    link: /guide/styles#grunt
  - title: Alphabet
    details: A vowel-based sound for every letter, like Animal Crossing.
    link: /guide/styles#alphabet
  - title: Typewriter dialogue
    details: Ask for one character at a time and get its sound plus how long to wait before the next one.
    link: /guide/concepts#typewriter-and-advance
  - title: Deterministic everywhere
    details: Same text and voice, same samples, on Linux, Windows, macOS (Apple Silicon and Intel) and WebAssembly. Checked in CI with shared conformance vectors.
    link: /reference/conformance
  - title: Nothing drawn for you
    details: You get audio and timing data. What appears on screen is up to you; the playground is just one example.
    link: /guide/concepts#sound-identifier
---

Inspired by UnitOfTime's video [I Gave My NPCs Voices Without Recording Anything](https://www.youtube.com/watch?v=NaW0d7Tghw0).
