import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  build: {
    // chel serve <dir> serves <dir>/index.html at /app/ and <dir>/assets/* at
    // /assets/, which is Vite's default output.
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: mode !== 'production'
  },
  resolve: {
    alias: {
      // @chelonia/lib imports node's Buffer (CIDs, message serialisation, zkpp).
      buffer: 'buffer/'
    }
  },
  define: {
    // @chelonia/lib reads process.env at module scope. Replacing the whole
    // object avoids having to track which flags it reads.
    'process.env': JSON.stringify({
      NODE_ENV: mode === 'production' ? 'production' : 'development',
      // A browser keeps no copy of the message log, so Chelonia takes each
      // contract's HEAD from the saved state instead of a local database.
      // Without this the log is an empty map after a reload, and the first
      // new event on a contract fails with "No latest HEAD".
      LIGHTWEIGHT_CLIENT: 'true'
    })
  }
}))
