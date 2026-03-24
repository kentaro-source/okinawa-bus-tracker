// Parse route list from HTML dropdown
async function getRouteList() {
  const res = await fetch('https://www.busnavi-okinawa.com/top/Location');
  const html = await res.text();
  const routes = [];
  const re = /<option\s+value="([0-9a-f-]{36})">(\d+)\.(.+?)<\/option>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    routes.push({ keitouSid: m[1], number: m[2], name: m[3] });
  }
  return routes;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\//, '');

  // Custom endpoint: return all routes as JSON
  if (path === 'GetRouteList') {
    const routes = await getRouteList();
    return new Response(JSON.stringify(routes), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const target = `https://www.busnavi-okinawa.com/top/Location/${path}${url.search}`;

  const res = await fetch(target, {
    method: context.request.method,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json',
    },
  });

  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
