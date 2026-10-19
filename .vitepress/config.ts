import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "mysql-craft ⚡",
  description: "The modern, high-velocity MySQL engine for Node.js & TypeScript.",
  base: '/docs.mysql-craft/', // Critical for hosting correctly on GitHub Pages
  themeConfig: {
    // Top right navigation links
    nav: [
      { text: 'Guide', link: '/why-mysql-craft' },
      { text: 'API Reference', link: '/api-reference' },
    ],

    // Left sidebar navigation links
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Why @mysql-craft?', link: '/why-mysql-craft' },
          { text: 'Installation', link: '/installation' },
          { text: 'Quick Start', link: '/quick-start' }
        ]
      },
      {
        text: 'Core Architecture',
        items: [
          { text: 'Instant CRUD Engine', link: '/crud-engine' },
          { text: 'Database & Query API', link: '/api-reference' },
          { text: 'Deadlock Transactions', link: '/transactions' }
        ]
      },
      {
        text: 'Security & Infrastructure',
        items: [
          { text: 'Security Module', link: '/security' },
          { text: 'Express Middleware', link: '/middleware' },
          { text: 'Resilience & K8s Health', link: '/resilience' }
        ]
      }
    ],

    // Global GitHub and NPM header links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ind-prince/mysql-craft' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/mysql-craft' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Crafted with ❤ by <a href="https://github.com/ind-prince">ind-prince</a>'
    }
  }
})
