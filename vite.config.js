import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev-only proxies for NASA services that do not send CORS headers.
// Production builds use the pre-computed datasets in `public/data`.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // Bind to loopback by default (audit SEC-06). For a LAN/demo session run
    // `npm run dev -- --host` explicitly; Vite then prints the LAN URL.
    host: '127.0.0.1',
    proxy: {
      '/nasa/horizons': {
        target: 'https://ssd.jpl.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nasa\/horizons/, '/api/horizons.api'),
      },
    },
  },
  preview: {
    port: 4173,
    // Same loopback default; use `npm run preview -- --host` only for a
    // deliberate LAN demo (audit SEC-06).
    host: '127.0.0.1',
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Production source maps are disabled (audit SEC-10): the published bundle
    // must not ship full sources. Set VITE_SOURCEMAP=true for local debugging.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
  },
  test: {
    // The Miro MCP package uses node:test, not Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'mcp/**'],
  },
})
