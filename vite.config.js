import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev-only proxies for NASA services that do not send CORS headers.
// Production builds use the pre-computed datasets in `public/data`.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/nasa/horizons': {
        target: 'https://ssd.jpl.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nasa\/horizons/, '/api/horizons.api'),
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
})
