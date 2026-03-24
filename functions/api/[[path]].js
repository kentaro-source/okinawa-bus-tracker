export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\//, '');
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
