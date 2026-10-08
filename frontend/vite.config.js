import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the PWA runs on :5173 and proxies API + WebSocket calls to FastAPI on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
