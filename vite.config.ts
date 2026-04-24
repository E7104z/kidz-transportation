import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // @react-pdf/renderer uses Node's Buffer in the browser
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      // Disable COOP for local dev so Firebase Auth popups can open and close freely.
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
})
