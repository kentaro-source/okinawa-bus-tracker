import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://www.busnavi-okinawa.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/top/Location'),
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
        configure: (proxy) => {
          proxy.on('error', (err) => console.log('proxy error', err));
          proxy.on('proxyReq', (proxyReq, req) => console.log('proxy →', req.url));
          proxy.on('proxyRes', (proxyRes, req) => console.log('proxy ←', proxyRes.statusCode, req.url));
        },
      },
    },
  },
})
