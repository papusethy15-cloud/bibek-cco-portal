import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Split vendor libraries into separate cacheable chunks so the main
    // app bundle stays well under the 500 kB warning threshold.
    rollupOptions: {
      output: {
        manualChunks: {
          // React runtime — almost never changes, cache indefinitely
          'vendor-react': ['react', 'react-dom'],
          // Routing
          'vendor-router': ['react-router-dom'],
          // HTTP client
          'vendor-axios': ['axios'],
          // State management
          'vendor-zustand': ['zustand'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
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
