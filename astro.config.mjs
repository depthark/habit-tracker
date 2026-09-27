// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// The site is served from a sub-path on GitHub Pages, so `base` has to be set
// or every asset 404s. See the README.
export default defineConfig({
  site: 'https://depthark.github.io',
  base: '/habit-tracker',
  trailingSlash: 'ignore',
  build: {
    // Serve the build as-is; there is nothing to compress at the Pages layer.
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
