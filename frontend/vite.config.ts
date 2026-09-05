/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend serves the API at http://127.0.0.1:5000/api. In dev we proxy
// /api to it so the app is same-origin (no CORS preflight, no absolute URLs in
// the client). In production, set VITE_API_URL to the deployed API base.
//
// 127.0.0.1 rather than "localhost": this proxy runs in Node, which resolves
// localhost to ::1 first, while the backend (and Docker's published ports) bind
// IPv4. The symptom is intermittent ECONNREFUSED that looks like the API being
// down.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Unit tests only, on the logic that has a wrong answer rather than a wrong
  // appearance: parsing another team's JSON, and the formatting the AI's scores
  // are read through. Component rendering is verified against the running stack,
  // where it can be judged, rather than asserted about in strings.
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
});
