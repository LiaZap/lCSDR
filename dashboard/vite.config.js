import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_TARGET permite redirecionar o proxy pro backend em qualquer ambiente.
// - Local (fora do Docker): http://localhost:3333
// - Docker Compose:         http://agente:3333
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3333';

// CHOKIDAR_USEPOLLING=true ativa file-watcher por polling, essencial pra HMR
// funcionar em bind-mount Docker em Windows (eventos de fs não chegam nativamente).
const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true' || process.env.DOCKER === 'true';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 600 } : undefined,
    hmr: { clientPort: 5173 },
    proxy: {
      '/api':  { target: API_TARGET, changeOrigin: true },
      '/auth': { target: API_TARGET, changeOrigin: true },
    },
  },
});
