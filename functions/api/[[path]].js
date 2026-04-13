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

// GTFS-RT protobufデコーダ（軽量版）
function decodeProtobuf(buf, start, end) {
  const fields = {};
  let pos = start || 0;
  end = end || buf.length;
  while (pos < end) {
    let result = 0, shift = 0, b;
    do { b = buf[pos++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && pos < end);
    const fieldNum = result >> 3, wireType = result & 7;
    if (wireType === 0) {
      result = 0; shift = 0;
      do { b = buf[pos++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && pos < end);
      fields[fieldNum] = result;
    } else if (wireType === 2) {
      result = 0; shift = 0;
      do { b = buf[pos++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && pos < end);
      if (pos + result > end) break;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(new Uint8Array(buf.buffer || buf, buf.byteOffset + pos, result));
      pos += result;
    } else if (wireType === 5) {
      if (pos + 4 > end) break;
      const view = new DataView(buf.buffer || buf, buf.byteOffset + pos, 4);
      fields[fieldNum] = view.getFloat32(0, true);
      pos += 4;
    } else if (wireType === 1) {
      if (pos + 8 > end) break;
      pos += 8;
    } else break;
  }
  return fields;
}

function textFromBuf(arr) {
  return arr ? new TextDecoder().decode(arr) : undefined;
}

// GTFS-RT vehiclePositionsをJSONに変換
function parseVehiclePositions(data) {
  const buf = new Uint8Array(data);
  const msg = decodeProtobuf(buf, 0, buf.length);
  const entities = msg[2] || [];
  const vehicles = [];
  for (const eb of entities) {
    const entity = decodeProtobuf(eb, 0, eb.length);
    const id = entity[1]?.[0] ? textFromBuf(entity[1][0]) : null;
    if (!entity[4]) continue;
    const vp = decodeProtobuf(entity[4][0], 0, entity[4][0].length);
    const pos = vp[2] ? decodeProtobuf(vp[2][0], 0, vp[2][0].length) : {};
    const trip = vp[1] ? decodeProtobuf(vp[1][0], 0, vp[1][0].length) : {};
    const veh = vp[8] ? decodeProtobuf(vp[8][0], 0, vp[8][0].length) : {};
    vehicles.push({
      id,
      lat: pos[1] || null,
      lng: pos[2] || null,
      tripId: trip[1]?.[0] ? textFromBuf(trip[1][0]) : null,
      routeId: trip[5]?.[0] ? textFromBuf(trip[5][0]) : null,
      vehicleId: veh[1]?.[0] ? textFromBuf(veh[1][0]) : null,
      timestamp: vp[5] || null,
    });
  }
  return vehicles;
}

// GTFS-RT tripUpdatesをパース（tripId → stopUpdates のマップを返す）
function parseTripUpdates(data) {
  const buf = new Uint8Array(data);
  const msg = decodeProtobuf(buf, 0, buf.length);
  const entities = msg[2] || [];
  const trips = {};

  for (const eb of entities) {
    const entity = decodeProtobuf(eb, 0, eb.length);
    if (!entity[3]) continue; // field 3 = trip_update
    const tu = decodeProtobuf(entity[3][0], 0, entity[3][0].length);
    const trip = tu[1] ? decodeProtobuf(tu[1][0], 0, tu[1][0].length) : {};
    const tripId = trip[1]?.[0] ? textFromBuf(trip[1][0]) : null;
    if (!tripId) continue;

    const stopUpdates = [];
    for (const sb of (tu[2] || [])) {
      const su = decodeProtobuf(sb, 0, sb.length);
      const stopSeq = su[1] || null; // field 1 = stop_sequence
      const stopId = su[4]?.[0] ? textFromBuf(su[4][0]) : null;
      // field 2 = arrival, field 3 = departure
      const dep = su[3] ? decodeProtobuf(su[3][0], 0, su[3][0].length) : null;
      const depTime = dep?.[2] || null; // field 2 = time (timestamp)
      stopUpdates.push({ stopId, stopSeq, depTime });
    }
    trips[tripId] = stopUpdates;
  }
  return trips;
}

// 現在の曜日種別を判定
function getDayType() {
  // JST (UTC+9) で曜日判定
  const now = new Date();
  const jstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  if (jstDay === 0) return 'holiday'; // 日曜
  if (jstDay === 6) return 'saturday';
  return 'weekday';
  // TODO: 祝日判定
}

// LINE Bot: 署名検証
async function verifyLineSignature(body, signature, channelSecret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

// LINE Bot: メッセージ返信
async function lineReply(replyToken, messages, accessToken) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

// LINE Bot: バス停名から接近情報を取得してテキスト生成
async function getBusInfoForLine(stationName, baseUrl) {
  // バス停コードを取得
  const corrRes = await fetch(
    `${baseUrl}/api/StationCorrection?stationName=${encodeURIComponent(stationName)}`
  );
  const corrText = await corrRes.text();
  let stations;
  try { stations = JSON.parse(corrText); } catch { return `「${stationName}」が見つかりませんでした。`; }
  if (!Array.isArray(stations) || stations.length === 0) return `「${stationName}」が見つかりませんでした。`;

  const station = stations[0];
  const code = station.StationCode || station.stationCode;
  const name = station.StationName || station.stationName || stationName;
  if (!code) return `「${stationName}」のバス停コードが取得できませんでした。`;

  // 接近情報を取得
  const appRes = await fetch(`${baseUrl}/api/Approach?stationCode=${encodeURIComponent(code)}`);
  const appData = await appRes.json();
  const buses = appData.buses || [];

  if (buses.length === 0) return `📍 ${name}\n\n現在、接近中のバスはありません。`;

  let text = `📍 ${name}\n\n`;
  const shown = buses.slice(0, 5);
  for (const b of shown) {
    text += `🚌 ${b.routeNumber}番 ${b.routeName}\n`;
    if (b.isApproaching) {
      text += `  まもなく到着\n`;
    } else if (b.stopsAway != null) {
      text += `  ${b.stopsAway}停留所前`;
      if (b.arrivalTime) text += `（${b.arrivalTime}到着予定）`;
      text += `\n`;
    }
    if (b.currentStop) text += `  📍 ${b.currentStop}\n`;
    text += `  → ${b.destination}\n\n`;
  }
  if (buses.length > 5) text += `他${buses.length - 5}件\n`;
  text += `\n🔗 詳細: https://okinawa-bus.pages.dev`;
  return text;
}

// LINE Bot: Webhookハンドラ
async function handleLineWebhook(context) {
  const channelSecret = context.env.LINE_CHANNEL_SECRET;
  const accessToken = context.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !accessToken) {
    return new Response('LINE bot not configured', { status: 500 });
  }

  const body = await context.request.text();
  const signature = context.request.headers.get('X-Line-Signature');

  if (!signature || !await verifyLineSignature(body, signature, channelSecret)) {
    return new Response('Invalid signature', { status: 403 });
  }

  const data = JSON.parse(body);
  const baseUrl = new URL(context.request.url).origin;

  for (const event of (data.events || [])) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userText = event.message.text.trim();

    // ヘルプ
    if (userText === 'ヘルプ' || userText === 'help') {
      await lineReply(event.replyToken, [{
        type: 'text',
        text: '🚌 バスどこ沖縄\n\nバス停名を送信すると、接近中のバス情報をお返しします。\n\n例: 県庁北口\n例: 那覇バスターミナル\n例: おもろまち駅前',
      }], accessToken);
      continue;
    }

    // バス停名として検索
    const reply = await getBusInfoForLine(userText, baseUrl);
    await lineReply(event.replyToken, [{ type: 'text', text: reply }], accessToken);
  }

  return new Response('OK', { status: 200 });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api\//, '');

  // LINE Bot Webhook
  if (path === 'line-webhook') {
    if (context.request.method === 'POST') return handleLineWebhook(context);
    return new Response('OK', { status: 200 }); // GET for verification
  }

  // OTTOP GTFS-RT: 東京バスのリアルタイム車両位置 + 遅延情報
  if (path === 'TokyoBusPositions') {
    try {
      const [vpRes, tuRes] = await Promise.all([
        fetch('https://api.ottop.org/realtime/7011501003070/vehiclePositions'),
        fetch('https://api.ottop.org/realtime/7011501003070/tripUpdates'),
      ]);
      if (!vpRes.ok) throw new Error('OTTOP vehiclePositions error: ' + vpRes.status);

      const vehicles = parseVehiclePositions(await vpRes.arrayBuffer());

      // tripUpdatesがあれば遅延情報をマージ
      if (tuRes.ok) {
        const tripUpdates = parseTripUpdates(await tuRes.arrayBuffer());
        for (const v of vehicles) {
          if (v.tripId && tripUpdates[v.tripId]) {
            v.stopUpdates = tripUpdates[v.tripId];
          }
        }
      }

      return new Response(JSON.stringify(vehicles), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

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

    // 現在時刻以降の出発のみ、今日の曜日種別でフィルタ（JST = UTC+9）
    const now = new Date();
    const jstHours = (now.getUTCHours() + 9) % 24;
    const currentMinutes = jstHours * 60 + now.getUTCMinutes();
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
