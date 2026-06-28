import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7843,         // dashboard dev server; gmap API runs on 7842
    proxy: {
      '/api': 'http://127.0.0.1:7842',
      '/ws':  { target: 'ws://127.0.0.1:7842', ws: true },
    },
  },
  build: {
    outDir: '../server/dist/public',  // served by @gmap/server in M4
  },
});
