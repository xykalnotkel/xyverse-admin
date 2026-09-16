import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4400,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
    hmr: { clientPort: 443, protocol: 'wss' },
    // browser memanggil /api lewat origin yang sama, lalu di-proxy ke API lokal
    proxy: { '/api': { target: 'http://127.0.0.1:4500', changeOrigin: true } },
  },
});
