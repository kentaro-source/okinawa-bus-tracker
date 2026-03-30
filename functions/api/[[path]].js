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

// 接近情報HTMLをパースしてJSON化
function parseApproachHtml(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const buses = [];
  // 2行ずつペア: [定刻, 路線名, 接近状態, 到着予定] + [系統番号, _, 現在位置, 終点]
  for (let i = 2; i < rows.length - 1; i += 2) {
    const tds1 = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(t => t[1].replace(/<[^>]+>/g, '').trim());
    const tds2 = [...rows[i + 1][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(t => t[1].replace(/<[^>]+>/g, '').trim());
    if (tds1.length < 3 || tds2.length < 3) continue;

    // 到着予定を抽出 (例: "19:36到着予定" or "まもなく到着")
    const arrivalText = tds1[tds1.length - 1] || '';
    const arrivalMatch = arrivalText.match(/(\d+:\d+)到着予定/);
    const arrivalTime = arrivalMatch ? arrivalMatch[1] : null;

    // 残り停留所数 (数字のみの場合)
    const stopsText = tds1.length >= 4 ? tds1[2] : '';
    const stopsAway = /^\d+$/.test(stopsText) ? parseInt(stopsText) : (stopsText === 'まもなく到着' ? 0 : null);

    buses.push({
      scheduledTime: tds1[0],       // "19:25"
      routeName: tds1[1],           // "読谷線..."
      stopsAway,
      arrivalTime,
      isApproaching: stopsText === 'まもなく到着',
      routeNumber: tds2[0],         // "28"
      currentStop: tds2[tds2.length - 2] || '',  // "宮城（浦添市）"
      destination: tds2[tds2.length - 1] || '',   // "読谷バスターミナル（終点）"
    });
  }
  return buses;
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

  // 接近情報エンドポイント: StationCodeで接近中バスを取得
  if (path === 'Approach') {
    const stationCode = url.searchParams.get('stationCode');
    if (!stationCode) {
      return new Response(JSON.stringify({ error: 'stationCode required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const res = await fetch('https://www.busnavi-okinawa.com/top/Approach/Result', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        selectLang: 'ja',
        startStaCode: stationCode,
        goalStaCode: '',
        listSortMode: 0,
      }),
    });
    const html = await res.text();
    // APIはJSON文字列でHTMLを返す
    let parsed;
    try {
      parsed = JSON.parse(html);
    } catch {
      parsed = html;
    }
    const buses = parseApproachHtml(parsed);
    return new Response(JSON.stringify(buses), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // バス停名からStationCodeを取得
  if (path === 'StationCorrection') {
    const stationName = url.searchParams.get('stationName');
    if (!stationName) {
      return new Response(JSON.stringify({ error: 'stationName required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const res = await fetch(
      `https://www.busnavi-okinawa.com/top/Approach/StationCorrection?selectLang=ja&stationName=${encodeURIComponent(stationName)}`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
    );
    const body = await res.text();
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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
