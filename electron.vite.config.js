import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.js')
      },
      rollupOptions: {
        external: ['electron-store', 'chardet', 'iconv-lite']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.js')
      }
    }
  },
  renderer: {
    root: '.',
    server: {
      watch: {
        ignored: [
          '**/data/**',
          '**/downloads/**',
          '**/release/**',
          '**/custom_rules/**',
          '**/scratch/**',
          '**/*.tmp',
          '**/*.tmp.*'
        ]
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
})
