import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true,
    proxy: {
      // Proxy HTTP API calls
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy WebSocket connections — fixes Firefox "can't establish connection"
      // by routing ws://localhost:3001/ws/* → ws://localhost:8000/ws/*
      // This avoids direct cross-port WS from browser to backend on Windows dev.
      '/ws': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
