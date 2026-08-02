import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  server: {
    proxy: {
      '/carto-proxy': {
        target: 'https://tiles.basemaps.cartocdn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/carto-proxy/, '')
      },
      '/carto-mvt-proxy': {
        target: 'https://tiles-a.basemaps.cartocdn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/carto-mvt-proxy/, '')
      },
      '/signaling': {
        target: 'ws://localhost:4444',
        ws: true
      }
    }
  },
  preview: {
    proxy: {
      '/carto-proxy': {
        target: 'https://tiles.basemaps.cartocdn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/carto-proxy/, '')
      },
      '/carto-mvt-proxy': {
        target: 'https://tiles-a.basemaps.cartocdn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/carto-mvt-proxy/, '')
      }
    }
  },
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/webfunctions',
      filename: 'sw.ts',
      injectManifest: {
        // Enforce strict offline caching of all UI and Map assets
        globPatterns: ['**/*.{html,js,css,wasm,png,svg,json,geojson}'],
        maximumFileSizeToCacheInBytes: 150 * 1024 * 1024 // 150MB to allow massive state-wide map chunks
      },
      manifest: {
        name: 'AapdaSync Response Node',
        short_name: 'AapdaSync',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait'
      }
    })
  ],
  optimizeDeps: {
  },
  build: {
    chunkSizeWarningLimit: 3000
  }
});
