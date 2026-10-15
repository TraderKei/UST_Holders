import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': resolve(import.meta.dirname) } },
  build: {
    outDir: 'standalone-dist',
    lib: {
      entry: 'standalone-entry.tsx',
      name: 'TicDashboard',
      formats: ['iife'],
      fileName: () => 'standalone.js',
    },
  },
});
