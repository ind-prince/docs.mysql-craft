import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "mysql-craft \u26a1",
  description: "The modern, high-velocity MySQL engine for Node.js & TypeScript.",
  base: '/docs.mysql-craft/',
  appearance: true,
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/why-mysql-craft' },
      { text: 'API Reference', link: '/api-reference' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Why @mysql-craft?', link: '/why-mysql-craft' },
          { text: 'Installation', link: '/installation' },
          { text: 'Quick Start', link: '/quick-start' },
        ],
      },
      {
        text: 'Core Architecture',
        items: [
          { text: 'CRUD Engine', link: '/crud-engine' },
          { text: 'API Reference', link: '/api-reference' },
        ],
      },
      {
        text: 'Security & Infrastructure',
        items: [{ text: 'Security & Authentication', link: '/security-auth' }],
      },
      {
        text: 'Resilience & Telemetry',
        items: [{ text: 'Resilience & APM', link: '/resilience-apm' }],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ind-prince/mysql-craft' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@mysql-craft' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Crafted with \u2764 by <a href="https://github.com/ind-prince">ind-prince</a>',
    },
  },
})
