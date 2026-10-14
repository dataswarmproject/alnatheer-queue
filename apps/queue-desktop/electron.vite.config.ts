import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  main: { build: { externalizeDeps: false, rollupOptions: { external: ['electron'] } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { external: ['electron'] } } },
  renderer: { plugins: [react()] },
});
