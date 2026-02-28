import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { resolve } from 'path'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
      'styled-system': resolve(__dirname, 'styled-system'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3457',
      '/rpc': 'http://localhost:3457',
    },
  },
  build: { outDir: 'dist' },
})
