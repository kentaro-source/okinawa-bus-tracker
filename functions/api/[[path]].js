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

// 時刻表HTMLをパースしてJSON化
function parseTimetableHtml(html) {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)];
  const routes = [];

  for (const table of tables) {
    const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    if (rows.length < 3) continue;

    // ヘッダ行から路線情報抽出
    const headerCells = [...rows[0][1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const routeInfo = headerCells[headerCells.length - 1] || '';
    const numMatch = routeInfo.match(/\[(\d+)\]/);
    const routeNumber = numMatch ? numMatch[1] : '';
    const destMatch = routeInfo.match(/（(.+?)行き）/);
    const destination = destMatch ? destMatch[1] : '';
    const companyMatch = routeInfo.match(/行き）\s*(.+)$/);
    const company = companyMatch ? companyMatch[1].trim() : '';

    // 平日/土曜/日祝ブロックのパース
    const schedules = { weekday: [], saturday: [], holiday: [] };
    let currentType = null;

    for (let i = 2; i < rows.length; i++) {
      const cells = [...rows[i][1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

      if (cells.length === 0) continue;

      // 曜日ブロック切替
      if (cells[0] === '平日') { currentType = 'weekday'; }
      else if (cells[0] === '土曜') { currentType = 'saturday'; }
      else if (cells[0] === '日祝') { currentType = 'holiday'; }

      if (!currentType) continue;

      // 時間行: [hour, minutes...]
      const hourCell = cells[0] === '平日' || cells[0] === '土曜' || cells[0] === '日祝' ? cells[1] : cells[0];
      const minuteCell = cells[0] === '平日' || cells[0] === '土曜' || cells[0] === '日祝' ? cells[2] : cells[1];
      const hour = parseInt(hourCell);
      if (isNaN(hour)) continue;

      if (minuteCell) {
        const minutes = minuteCell.split(/\s+/).map(m => m.replace(/[^\d]/g, '')).filter(m => m);
        for (const min of minutes) {
          schedules[currentType].push({ hour: hour % 24, minute: parseInt(min) });
        }
      }
    }

    routes.push({ routeNumber, routeName: routeInfo, destination, company, schedules });
  }
  return routes;
}

// 現在の曜日種別を判定
function getDayType() {
  const day = new Date().getDay();
  if (day === 0) return 'holiday'; // 日曜
  if (day === 6) return 'saturday';
  return 'weekday';
  // TODO: 祝日判定
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

    // stationSidを隠しフィールドから抽出（時刻表フォールバック用）
    const sidMatch = parsed.match(/_hdnSelectStationSid[^>]*value="([^"]+)"/);
    const stationSid = sidMatch ? sidMatch[1] : null;

    return new Response(JSON.stringify({ buses, stationSid }), {
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

  // 時刻表エンドポイント: stationSidとbusStopCodeで全路線の時刻表を取得
  if (path === 'Timetable') {
    const stationSid = url.searchParams.get('stationSid');
    const busStopCode = url.searchParams.get('busStopCode');
    if (!stationSid || !busStopCode) {
      return new Response(JSON.stringify({ error: 'stationSid and busStopCode required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    const res = await fetch(
      `https://www.busnavi-okinawa.com/top/ViewTimeTable/TimeTableAll?selectLang=ja&parentCompanyCode=9000&stationSid=${encodeURIComponent(stationSid)}&busStopCode=${encodeURIComponent(busStopCode)}&goalStationCode=`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
    );
    const html = await res.text();
    let parsed;
    try { parsed = JSON.parse(html); } catch { parsed = html; }

    const allRoutes = parseTimetableHtml(parsed);
    const dayType = getDayType();

    // 現在時刻以降の出発のみ、今日の曜日種別でフィルタ
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = [];

    for (const route of allRoutes) {
      const times = route.schedules[dayType] || [];
      for (const t of times) {
        const totalMin = t.hour * 60 + t.minute;
        if (totalMin >= currentMinutes - 5) { // 5分前まで表示
          upcoming.push({
            routeNumber: route.routeNumber,
            routeName: route.routeName,
            destination: route.destination,
            company: route.company,
            scheduledTime: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`,
            hour: t.hour,
            minute: t.minute,
          });
        }
      }
    }

    // 時刻順ソート
    upcoming.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));

    return new Response(JSON.stringify(upcoming), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // 5分キャッシュ
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
