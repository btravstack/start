import { defineConfig } from "vitepress";

const SITE_DESCRIPTION =
  "Type-safe, 12-factor backend applications for TypeScript: one demesne graph, many transport hosts. A contract, a handler, and a host per invocation — HTTP, AMQP and Temporal over one kernel. Incubating.";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "start",
  description: SITE_DESCRIPTION,
  base: "/start/",
  lang: "en-US",
  cleanUrls: true,

  sitemap: {
    hostname: "https://btravstack.github.io/start/",
  },

  themeConfig: {
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg" },

    nav: [
      { text: "Guide", link: "/guide/the-idea" },
      {
        text: "Design RFCs",
        link: "https://github.com/btravstack/start/tree/main/design",
      },
      // Back to the btravstack hub (links the docs up to the landing page).
      { text: "btravstack", link: "https://btravstack.github.io/" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "The idea", link: "/guide/the-idea" },
            { text: "Status", link: "/guide/status" },
          ],
        },
        {
          text: "The pieces",
          items: [
            { text: "Hosts", link: "/guide/hosts" },
            { text: "Packages", link: "/guide/packages" },
            { text: "Examples", link: "/guide/examples" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/btravstack/start" }],

    footer: {
      message: "Released under the MIT License. Incubating — the API is still settling.",
      copyright: `Copyright © ${new Date().getFullYear()} Benoit TRAVERS`,
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/btravstack/start/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },

  vite: {
    // @btravstack/theme's entry imports `vitepress/theme` (which pulls in `.css`)
    // and its own `style.css`. VitePress externalizes node_modules deps in the SSR
    // build, so Node's ESM loader would hit those `.css` files and throw
    // ERR_UNKNOWN_FILE_EXTENSION. Bundling the theme through Vite handles the CSS.
    ssr: { noExternal: ["@btravstack/theme"] },
  },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/start/logo.svg" }],
    ["meta", { name: "author", content: "Benoit TRAVERS" }],
    ["meta", { name: "robots", content: "index, follow" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "typescript, backend, framework, 12-factor, hexagonal, dependency injection, hono, amqp, rabbitmq, temporal, demesne, unthrown, type-safe",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "start" }],
    ["meta", { property: "og:title", content: "start" }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { property: "og:image", content: "https://btravstack.github.io/start/og-start.png" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: "https://btravstack.github.io/start/og-start.png" }],
  ],
});
