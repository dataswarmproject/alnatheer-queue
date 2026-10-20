import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const legacy = process.env.QUEUE_BUILD_TARGET === 'windows7';
export default defineConfig({
  main: {
    build: {
      ...(legacy ? { outDir: 'out-win7/main', target: 'node16' } : {}),
      externalizeDeps: false,
      rollupOptions: { external: ['electron'] },
    },
  },
  preload: {
    build: {
      ...(legacy ? { outDir: 'out-win7/preload', target: 'node16' } : {}),
      externalizeDeps: false,
      rollupOptions: { external: ['electron'] },
    },
  },
  renderer: {
    plugins: [react()],
    build: legacy
      ? {
          outDir: path.resolve(__dirname, 'out-win7/renderer'),
          target: 'chrome108',
          cssTarget: 'chrome108',
        }
      : {},
  },
});
