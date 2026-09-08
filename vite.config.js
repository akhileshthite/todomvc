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
      NODE_ENV: mode === 'production' ? 'production' : 'development'
    })
  }
}))
