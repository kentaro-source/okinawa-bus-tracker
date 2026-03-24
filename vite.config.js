import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev middleware to handle GetRouteList (parses HTML, same as Cloudflare Function)
function routeListPlugin() {
  return {
    name: 'route-list-middleware',
    configureServer(server) {
      server.middlewares.use('/api/GetRouteList', async (req, res) => {
        try {
          const resp = await fetch('https://www.busnavi-okinawa.com/top/Location');
          const html = await resp.text();
          const routes = [];
          const re = /<option\s+value="([0-9a-f-]{36})">(\d+)\.(.+?)<\/option>/gi;
          let m;
          while ((m = re.exec(html)) !== null) {
            routes.push({ keitouSid: m[1], number: m[2], name: m[3] });
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(routes));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), routeListPlugin()],
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
