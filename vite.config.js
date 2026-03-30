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
      '/api/Approach': {
        target: 'https://www.busnavi-okinawa.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => {
          const url = new URL('http://dummy' + path);
          const stationCode = url.searchParams.get('stationCode');
          return '/top/Approach/Result';
        },
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const url = new URL('http://dummy' + req.url);
            const stationCode = url.searchParams.get('stationCode');
            const body = JSON.stringify({ selectLang: 'ja', startStaCode: stationCode, goalStaCode: '', listSortMode: 0 });
            proxyReq.method = 'POST';
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
            proxyReq.write(body);
          });
        },
      },
      '/api/StationCorrection': {
        target: 'https://www.busnavi-okinawa.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace('/api/StationCorrection', '/top/Approach/StationCorrection'),
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
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
