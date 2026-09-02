import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'capacitor-classic-scripts',
      apply: 'build',
      transformIndexHtml(html) {
        // Capacitor's WebView often fails to execute Vite's type="module"
        // + crossorigin assets. The production bundle is a single file
        // with no imports, so a classic script load matches the working
        // vanilla JS backup.
        return html
          .replace(/<script type="module"(?:\s+crossorigin)? /g, '<script defer ')
          .replace(/\s+crossorigin/g, '');
      },
    },
  ],
  root: '.',
  publicDir: 'public',
  base: './',
  build: {
    outDir: 'www',
    emptyOutDir: true,
    target: 'es2018',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'index.html',
      output: {
        inlineDynamicImports: true,
        format: 'iife',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 5173,
  },
});
