// Documentation site (specs/design.md §12, L7). The playground is built separately
// and copied to /playground/ by scripts/assemble-site.mjs.
import { defineConfig } from 'vitepress';

const repo = 'https://github.com/basteez/mumble-speech';

export default defineConfig({
  title: 'mumble-speech',
  description: 'Video-game mumble speech generated at runtime, for the web, Godot, Unity and C.',
  cleanUrls: true,
  // /playground/ is not a VitePress page: it is the playground app copied into the output.
  ignoreDeadLinks: [/^\/playground(\/.*)?$/],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      {
        text: 'Bindings',
        items: [
          { text: 'Web (npm)', link: '/bindings/web' },
          { text: 'Godot', link: '/bindings/godot' },
          { text: 'Unity', link: '/bindings/unity' },
          { text: 'C ABI', link: '/bindings/c' },
        ],
      },
      { text: 'Playground', link: '/playground/', target: '_self' },
      { text: 'Releases', link: 'https://github.com/basteez/mumble-speech/releases' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Styles', link: '/guide/styles' },
          { text: 'Concepts', link: '/guide/concepts' },
        ],
      },
      {
        text: 'Bindings',
        items: [
          { text: 'Web (npm)', link: '/bindings/web' },
          { text: 'Godot', link: '/bindings/godot' },
          { text: 'Unity', link: '/bindings/unity' },
          { text: 'C ABI', link: '/bindings/c' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'C ABI', link: '/reference/c-abi' },
          { text: 'Conformance vectors', link: '/reference/conformance' },
        ],
      },
      { text: 'Changelog', link: '/changelog' },
      { text: 'Contributing', link: '/contributing' },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Dual-licensed under MIT or Apache-2.0.' },
  },
});
