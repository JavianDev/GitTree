import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Builds the webview bundle. The extension host loads dist/webview/index.js
// through a nonce'd <script> tag under a strict CSP, so the output must be a
// single self-contained ES module with no code splitting and no dynamic import.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/webview'),
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/webview/main.tsx'),
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index[extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
