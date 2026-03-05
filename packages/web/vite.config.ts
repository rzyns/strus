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
  // OTel browser packages reference process.env in some code paths
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3457',
      '/rpc': 'http://localhost:3457',
      // Proxy OTLP from browser to the collector — avoids CORS entirely in dev.
      // Browser sends to /otlp/v1/traces → forwarded to http://localhost:4318/v1/traces
      '/otlp': {
        target: 'http://localhost:4318',
        rewrite: (path) => path.replace(/^\/otlp/, ''),
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
})
