const BASE = '/api';

// Known airport route numbers (used as default filter)
export const AIRPORT_ROUTE_NUMBERS = new Set([
  '26', '95', '99', '111', '113', '117', '120', '123', '125', '127', '132', '143', '189', '190',
]);

// バス停名のエイリアス（UIで使う名前 → APIの実際の名前）
const STATION_ALIASES = {
  '那覇空港': ['旅客ターミナル前'],
  '那覇バスターミナル': ['旭橋', 'バスターミナル前'],
};

// 逆引き: API上の正式名 → 内部統一名（エイリアス検索で使用）
const STATION_REVERSE_ALIASES = {
  '国内線旅客ターミナル前': '那覇空港',
  '国際線旅客ターミナル前': '那覇空港',
  '旅客ターミナル前': '那覇空港',
};

// 経由地として表示する主要バス停（ユーザーが判断しやすい目印）
const VIA_LANDMARKS = [
  '那覇バスターミナル', '旭橋', '牧志', '県庁北口', '県庁前',
  '沖縄タイムス前', '国際通り入口', '旅客ターミナル',
  '普天間', '宜野湾', '北谷', 'コンベンションセンター前',
  '沖縄南ＩＣ', '沖縄北ＩＣ', '西原ＩＣ',
  'ライカム', '読谷', '嘉手納',
];

// 経由地の表示名変換（わかりやすさ優先）
const VIA_DISPLAY_NAMES = {
  '牧志': '国際通り',
};

// 括弧内の方向表記を除外してバス停名の本体だけ取得
function getBaseName(name) {
  return name.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '')
    .replace(/[\s　]+(おりば|のりば|乗り場|乗場)[\s　]*\S*/g, '')
    .replace(/\s+/g, ' ').trim();
}

// 前方一致の除外サフィックス（別のバス停を示す接尾語）
const EXCLUDED_SUFFIXES = ['通り', '入口', '団地', '小学校', '中学校', '高校', '公園'];

// バス停マッチング: 括弧内を除外し、エイリアスも考慮
function matchStation(stationName, targetName) {
  const base = getBaseName(targetName);
  // 完全一致
  if (base === stationName) return true;
  // 前方一致（別バス停を示すサフィックスは除外）
  if (base.startsWith(stationName)) {
    const rest = base.slice(stationName.length);
    if (rest === '' || rest.startsWith(' ') || rest.startsWith('　')) return true;
    if (!EXCLUDED_SUFFIXES.some(s => rest.startsWith(s))) return true;
  }
  // 後方一致（例: 国内線旅客ターミナル前 → 旅客ターミナル前）
  if (base.endsWith(stationName)) return true;
  // エイリアスチェック
  const aliases = STATION_ALIASES[stationName];
  if (aliases) {
    return aliases.some(alias => base.includes(alias));
  }
  return false;
}

// Cache for the full route list
const ROUTE_LIST_CACHE_KEY = 'bus-tracker-route-list';
let routeListCache = null;

// Fetch all routes from the proxy (parses HTML dropdown)
export async function fetchAllRoutes() {
  if (routeListCache) return routeListCache;

  // Check localStorage
  try {
    const cached = JSON.parse(localStorage.getItem(ROUTE_LIST_CACHE_KEY));
    if (cached && cached.ts > Date.now() - 86400000) {
      routeListCache = cached.data;
      return routeListCache;
    }
  } catch {}

  const routes = await fetchJSON(`${BASE}/GetRouteList`);
  const normalized = routes.map(r => ({
    keitouSid: r.keitouSid,
    name: `${r.number}番 ${r.name}`,
    short: r.number,
  }));

  routeListCache = normalized;
  localStorage.setItem(ROUTE_LIST_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: normalized }));
  return normalized;
}

// Get airport routes only
export async function getAirportRoutes() {
  const all = await fetchAllRoutes();
  return all.filter(r => AIRPORT_ROUTE_NUMBERS.has(r.short));
}

// Legacy compat
export const AIRPORT_ROUTES = {};
// Will be populated on first call; use getAirportRoutes() instead

function dt() {
  const d = new Date();
  return '' + d.getHours() + d.getMinutes() + d.getSeconds();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text) return [];
  return JSON.parse(text);
}

export async function getCoursesGroup(keitouSid) {
  return fetchJSON(`${BASE}/GetCoursesGroup?keitouSid=${keitouSid}`);
}

export async function getCourses(courseGroupSid) {
  return fetchJSON(`${BASE}/GetCourses?courseGroupSid=${courseGroupSid}`);
}

export async function getStations(keitouSid, courseGroupSid, courseSid = 'AllStations', courseName = '全停留所表示') {
  return fetchJSON(
    `${BASE}/GetStations?datetime=${dt()}&keitouSid=${keitouSid}&courseGroupSid=${courseGroupSid}&courseSid=${encodeURIComponent(courseSid)}&courseName=${encodeURIComponent(courseName)}`
  );
}

export async function getBusLocation(keitouSid, courseGroupSid, courseSid = 'AllStations', courseName = '全停留所表示') {
  return fetchJSON(
    `${BASE}/BusLocation?datetime=${dt()}&keitouSid=${keitouSid}&courseGroupSid=${courseGroupSid}&courseSid=${encodeURIComponent(courseSid)}&courseName=${encodeURIComponent(courseName)}`
  );
}

export function parseNetDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/\/Date\((-?\d+)\)\//);
  if (!match) return null;
  return new Date(parseInt(match[1], 10));
}

// Check if a bus schedule applies to the current day of week
function isRunningToday(youbiKbn) {
  if (!youbiKbn) return true; // If no day info, assume it runs
  const dayFlags = ['IsSunday', 'IsMonday', 'IsTuesday', 'IsWednesday', 'IsThursday', 'IsFriday', 'IsSaturday'];
  const todayFlag = dayFlags[new Date().getDay()];
  return youbiKbn[todayFlag] === true;
}

// Process buses from a single group (上り or 下り)
function processBuses(buses, stationName, route, group, direction, destinationName, allStations) {
  const results = [];

  for (const bus of buses) {
    if (!bus.Daiya) continue;

    // BusLocation APIが返すバスは実際に運行中 → YoubiKbnフィルタは不要
    // （祝日便が平日に走るケース等、YoubiKbnが実態と合わない場合がある）

    const schedules = bus.Daiya.PassedSchedules || [];
    const passages = bus.Passages || [];

    // 祝日便等でPassedSchedulesが空の場合、AllStations＋Passagesで通常便と同等に処理
    if (schedules.length === 0 && passages.length > 0 && allStations) {
      // 出発地を既に通過済みならスキップ
      const passedOurStation = passages.some(p => matchStation(stationName, p.Station.Name));
      if (passedOurStation) continue;

      if (destinationName) {
        // 目的地を既に通過済みならスキップ（行き先が逆方向）
        const passedDest = passages.some(p => matchStation(destinationName, p.Station.Name));
        if (passedDest) continue;
      }

      // AllStationsからOrderNoを逆引きするヘルパー
      // Passage側のStation.Nameにも括弧付き方向表記が含まれるため、baseName同士で比較
      const getOrderFromAllStations = (name) => {
        const baseName = getBaseName(name);
        const match = allStations.find(s => {
          const sBase = getBaseName(s.Name);
          return sBase === baseName || sBase.includes(baseName) || baseName.includes(sBase);
        });
        return match?.OrderNo ?? null;
      };

      // AllStationsから出発地のOrderNoを取得
      const ourOrderNo = getOrderFromAllStations(stationName);

      // 目的地がAllStations上で出発地より先にあるか確認
      // （AllStationsは全コース共通だが、OrderNoで方向判定は可能）
      if (destinationName && ourOrderNo != null) {
        const destOrderNo = getOrderFromAllStations(destinationName);
        if (destOrderNo != null && destOrderNo <= ourOrderNo) continue; // 目的地が手前＝このコースでは行けない
        if (destOrderNo == null) continue; // 目的地がAllStationsにない＝この路線では行けない
      }

      // 現在位置・stopsAway計算
      const lastPassage = passages[passages.length - 1];
      const currentStop = lastPassage.Station.ShortName || getBaseName(lastPassage.Station.Name);
      // PassageのSchedule.OrderNoがなければAllStationsから補完
      let lastPassageOrder = lastPassage.Schedule?.OrderNo;
      if (lastPassageOrder == null) {
        lastPassageOrder = getOrderFromAllStations(lastPassage.Station.Name);
      }
      let stopsAway = null;
      if (ourOrderNo != null && lastPassageOrder != null) {
        stopsAway = ourOrderNo - lastPassageOrder;
        if (stopsAway < 0) continue; // 既に通過
      }

      // Passagesのデータから定刻・ETA・遅延を推定
      let etaMinutes = null;
      let delayMinutes = 0;
      let scheduledTime = null;
      let scheduledHour = null;
      let scheduledMinute = null;
      const lastArrival = parseNetDate(lastPassage.ArrivalTime);
      const isNearOrigin = lastPassageOrder != null && lastPassageOrder <= 2;

      if (passages.length >= 2 && stopsAway != null) {
        const firstPassage = passages[0];
        const firstArrival = parseNetDate(firstPassage.ArrivalTime);
        // PassageのSchedule.OrderNoがなければAllStationsから補完
        let firstOrder = firstPassage.Schedule?.OrderNo;
        if (firstOrder == null) {
          firstOrder = getOrderFromAllStations(firstPassage.Station.Name);
        }

        if (firstOrder != null && lastPassageOrder != null && lastPassageOrder > firstOrder) {
          const stopCount = lastPassageOrder - firstOrder;

          // ETA推定: 実績ベースの1停あたり時間
          if (firstArrival && lastArrival) {
            const actualPerStop = (lastArrival - firstArrival) / 60000 / stopCount;
            const elapsed = (new Date() - lastArrival) / 60000;
            etaMinutes = Math.max(1, Math.round(actualPerStop * stopsAway - elapsed));
          }

          // 定刻推定: PassageにScheduledTimeがあればそれを使用、なければ実績ベース
          const firstSched = firstPassage.Schedule?.ScheduledTime;
          const lastSched = lastPassage.Schedule?.ScheduledTime;
          if (firstSched && lastSched) {
            const schedFirst = firstSched.Hour * 60 + firstSched.Minute;
            const schedLast = lastSched.Hour * 60 + lastSched.Minute;
            const schedPerStop = (schedLast - schedFirst) / stopCount;
            const estMinutes = schedLast + Math.round(schedPerStop * stopsAway);
            scheduledHour = Math.floor(estMinutes / 60) % 24;
            scheduledMinute = estMinutes % 60;
            scheduledTime = `${String(scheduledHour).padStart(2, '0')}:${String(scheduledMinute).padStart(2, '0')}`;
          } else if (firstArrival && lastArrival) {
            // ScheduledTimeなし → 実績から定刻を推定
            const actualPerStop = (lastArrival - firstArrival) / 60000 / stopCount;
            const estArrival = new Date(lastArrival.getTime() + actualPerStop * stopsAway * 60000);
            scheduledHour = estArrival.getHours();
            scheduledMinute = estArrival.getMinutes();
            scheduledTime = `${String(scheduledHour).padStart(2, '0')}:${String(scheduledMinute).padStart(2, '0')}`;
          }

          // 遅延推定
          if (!isNearOrigin && lastArrival && lastSched) {
            const lastSchedDate = new Date();
            lastSchedDate.setHours(lastSched.Hour, lastSched.Minute, 0, 0);
            delayMinutes = Math.round((lastArrival - lastSchedDate) / 60000);
          }
        }
      }

      // 経由地抽出（AllStationsベース）
      // 出発地〜目的地間の主要経由地を抽出
      let destOrderNo = null;
      if (destinationName) {
        destOrderNo = getOrderFromAllStations(destinationName);
      }
      const viaStops = [];
      if (ourOrderNo != null) {
        for (const s of allStations) {
          const sOrder = s.OrderNo;
          if (sOrder == null || sOrder <= ourOrderNo) continue;
          if (destOrderNo != null && sOrder >= destOrderNo) break;
          const base = getBaseName(s.Name);
          if (VIA_LANDMARKS.some(v => base.includes(v))) {
            const displayName = VIA_DISPLAY_NAMES[base] || base;
            if (!viaStops.includes(displayName)) {
              viaStops.push(displayName);
            }
          }
          if (viaStops.length >= 3) break;
        }
      }

      results.push({
        routeKey: route.short,
        routeName: route.name,
        routeShort: route.short,
        direction,
        busId: bus.Bus.Id,
        company: bus.Bus.Company.Name,
        position: {
          lat: bus.Position.Latitude,
          lng: bus.Position.Longitude,
        },
        gpsTime: parseNetDate(bus.GpsTime),
        scheduledTime,
        scheduledHour,
        scheduledMinute,
        etaMinutes,
        delayMinutes: stopsAway != null && stopsAway <= 10 ? delayMinutes : 0,
        passed: false,
        notDeparted: false,
        destination: getBaseName(allStations[allStations.length - 1]?.Name) || group.YukisakiName || '',
        speed: bus.Speed,
        currentStop: (lastPassageOrder == null || lastPassageOrder > 2) ? currentStop : null,
        stopsAway,
        viaStops,
        isHolidayVariant: true,
      });
      continue;
    }

    // 目的地が指定されている場合、この便のスケジュールに目的地があるか確認
    // （AllStationsでは通るが、個別便では通らないケースを除外）
    if (destinationName) {
      const destInSchedule = schedules.some(s => matchStation(destinationName, s.Station.Name));
      if (!destInSchedule) continue;
    }

    // Find when bus is scheduled at our station (using base name matching + aliases)
    const stationSchedule = schedules.find(s => matchStation(stationName, s.Station.Name));

    // If this route doesn't pass through our station (in this direction), skip
    if (!stationSchedule) continue;

    // Check if bus already passed our station (match same station as schedule)
    const matchedStationName = stationSchedule.Station.Name;
    const stationPassage = passages.find(p =>
      p.Station.Name === matchedStationName
    );
    const busAlreadyPassed = !!stationPassage;

    // Calculate ETA
    let etaMinutes = null;
    let scheduledTime = stationSchedule.ScheduledTime.Value;
    let delayMinutes = null;

    const now = new Date();
    const scheduledDate = new Date();
    scheduledDate.setHours(stationSchedule.ScheduledTime.Hour, stationSchedule.ScheduledTime.Minute, 0, 0);

    if (!busAlreadyPassed) {
      if (passages.length > 0) {
        // Use last passage to estimate: actual arrival at last stop + remaining scheduled travel time
        const lastPassage = passages[passages.length - 1];
        const actualArrival = parseNetDate(lastPassage.ArrivalTime);
        const lastSchedule = lastPassage.Schedule;

        // Check if bus is still at or near its origin stop (OrderNo ≤ 2)
        // Delay data at the origin is unreliable (depot GPS, driver login timing, etc.)
        const isNearOrigin = lastSchedule?.OrderNo != null && lastSchedule.OrderNo <= 2;

        if (actualArrival && lastSchedule && !isNearOrigin) {
          // Delay = actual arrival - scheduled arrival at last stop
          const lastScheduledDate = new Date();
          lastScheduledDate.setHours(lastSchedule.ScheduledTime.Hour, lastSchedule.ScheduledTime.Minute, 0, 0);
          delayMinutes = Math.round((actualArrival - lastScheduledDate) / 60000);

          // Remaining travel time = scheduled time at our stop - scheduled time at last passed stop
          const remainingScheduledMinutes =
            (stationSchedule.ScheduledTime.Hour * 60 + stationSchedule.ScheduledTime.Minute) -
            (lastSchedule.ScheduledTime.Hour * 60 + lastSchedule.ScheduledTime.Minute);

          // ETA = last actual arrival + remaining travel time - now
          // 遅延はactualArrivalに既に反映済み（実到着時刻ベース）
          const estimatedArrival = new Date(actualArrival.getTime() + remainingScheduledMinutes * 60000);
          etaMinutes = Math.round((estimatedArrival - now) / 60000);
        } else {
          // At origin or no valid data: use scheduled time (no delay shown)
          etaMinutes = Math.round((scheduledDate - now) / 60000);
        }
      } else {
        // No passage data yet - use scheduled time
        etaMinutes = Math.round((scheduledDate - now) / 60000);
      }
    } else {
      etaMinutes = -1; // already passed
    }

    // Destination from the group or last station in schedule
    const lastStation = schedules[schedules.length - 1];
    const destination = getBaseName(lastStation?.Station?.Name) || group.YukisakiName || '';

    // Current position info: last passed stop and stops remaining
    let currentStop = null;
    let stopsAway = null;
    if (!busAlreadyPassed && passages.length > 0) {
      const lastPassage = passages[passages.length - 1];
      const lastPassageOrder = lastPassage.Schedule?.OrderNo;
      const ourOrder = stationSchedule.OrderNo;

      // Calculate stopsAway first (HEAD bug fix: skip buses with negative stopsAway)
      if (lastPassageOrder != null && ourOrder != null) {
        stopsAway = ourOrder - lastPassageOrder;
        // If stopsAway is negative, the bus hasn't started this trip yet
        // (it's still on the inbound trip heading to the origin)
        if (stopsAway < 0) continue;
      }

      // 始発付近（OrderNo ≤ 2）はPassageが出発時の記録のまま更新されないため位置非表示
      // （例: 空港出発の120番が那覇BT手前でも「国際線旅客ターミナル前」と表示される問題）
      if (lastPassageOrder == null || lastPassageOrder > 2) {
        currentStop = lastPassage.Station.ShortName || lastPassage.Station.Name.replace(/（.*?）$/, '');
      }
    }

    // Determine if bus has not departed yet (no passage data)
    const notDeparted = !busAlreadyPassed && passages.length === 0;

    // If not departed and past scheduled time, mark as possibly delayed
    if (notDeparted && etaMinutes !== null && etaMinutes <= 0) {
      if (etaMinutes < -30) {
        // 30分以上遅れは異常 → 表示しない
        continue;
      }
      delayMinutes = Math.abs(etaMinutes);
      etaMinutes = 1; // keep visible, show as "まもなく"
    }

    // 出発地〜目的地間の主要経由地を抽出
    const ourOrder = stationSchedule.OrderNo;
    const viaStops = [];
    if (ourOrder != null) {
      // 目的地のOrderNoを取得（目的地より先の経由地は不要）
      let destOrder = null;
      if (destinationName) {
        const destSchedule = schedules.find(s => matchStation(destinationName, s.Station.Name));
        destOrder = destSchedule?.OrderNo ?? null;
      }
      for (const s of schedules) {
        if (s.OrderNo <= ourOrder) continue;
        if (destOrder != null && s.OrderNo >= destOrder) break; // 目的地以降は不要
        const base = getBaseName(s.Station.Name);
        if (VIA_LANDMARKS.some(v => base.includes(v))) {
          const displayName = VIA_DISPLAY_NAMES[base] || base;
          if (!viaStops.includes(displayName)) {
            viaStops.push(displayName);
          }
        }
        if (viaStops.length >= 3) break;
      }
    }

    results.push({
      routeKey: route.short,
      routeName: route.name,
      routeShort: route.short,
      direction,
      busId: bus.Bus.Id,
      company: bus.Bus.Company.Name,
      position: {
        lat: bus.Position.Latitude,
        lng: bus.Position.Longitude,
      },
      gpsTime: parseNetDate(bus.GpsTime),
      scheduledTime,
      scheduledHour: stationSchedule.ScheduledTime.Hour,
      scheduledMinute: stationSchedule.ScheduledTime.Minute,
      etaMinutes,
      delayMinutes: notDeparted ? 0 : (delayMinutes || 0),
      passed: busAlreadyPassed,
      notDeparted,
      destination,
      speed: bus.Speed,
      currentStop,
      stopsAway,
      viaStops,
    });
  }

  return results;
}

// Run async tasks with concurrency limit
export async function runWithConcurrency(tasks, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// キャッシュから路線の停留所順序を取得（from→toが正方向かチェック用）
function getRouteOrderAtStation(stationName, routeShort) {
  try {
    const cached = JSON.parse(localStorage.getItem('bus-tracker-station-cache-v3'));
    if (!cached || !cached.data) return null;
    for (const s of cached.data) {
      if (s.name === stationName || s.name.includes(stationName) || stationName.includes(s.name)) {
        if (s.routeOrder && s.routeOrder[routeShort] != null) return s.routeOrder[routeShort];
      }
    }
    // エイリアス対応
    const aliases = STATION_ALIASES[stationName];
    if (aliases) {
      for (const alias of aliases) {
        for (const s of cached.data) {
          if (s.name.includes(alias) && s.routeOrder && s.routeOrder[routeShort] != null) {
            return s.routeOrder[routeShort];
          }
        }
      }
    }
  } catch {}
  return null;
}

// Look up which route numbers serve a station (from station cache)
// Collects routes from ALL matching stations (not just the first match)
function getCachedRoutesForStation(stationName) {
  try {
    const cached = JSON.parse(localStorage.getItem('bus-tracker-station-cache-v3'));
    if (cached && cached.data) {
      const routes = new Set();

      // Direct/partial match against all stations
      for (const s of cached.data) {
        if (s.name === stationName || s.name.includes(stationName) || stationName.includes(s.name)) {
          s.routes.forEach(r => routes.add(r));
        }
      }

      // Alias match (e.g. 那覇空港 → 旅客ターミナル前)
      if (routes.size === 0) {
        // 正引き: ユーザー名→API名
        const aliases = STATION_ALIASES[stationName];
        if (aliases) {
          for (const alias of aliases) {
            for (const s of cached.data) {
              if (s.name.includes(alias)) {
                s.routes.forEach(r => routes.add(r));
              }
            }
          }
        }
        // 逆引き: API名→ユーザー名→API名（例: 国内線旅客ターミナル前→那覇空港→旅客ターミナル前）
        if (routes.size === 0) {
          const normalized = STATION_REVERSE_ALIASES[stationName];
          if (normalized) {
            const normAliases = STATION_ALIASES[normalized];
            if (normAliases) {
              for (const alias of normAliases) {
                for (const s of cached.data) {
                  if (s.name.includes(alias)) {
                    s.routes.forEach(r => routes.add(r));
                  }
                }
              }
            }
          }
        }
      }

      if (routes.size > 0) return Array.from(routes);
    }
  } catch {}
  return null;
}

// Fetch buses for a given set of routes, filtered by station name
async function fetchBusesForRoutes(routes, stationName, destinationName) {
  const results = [];

  const tasks = routes.map((route) => async () => {
    try {
      const groups = await getCoursesGroup(route.keitouSid);

      for (const group of groups) {
        const isUp = group.Name.includes('上り');
        const direction = isUp ? 'up' : 'down';

        // First check stations only (lighter call) before fetching bus locations
        const stations = await getStations(route.keitouSid, group.Sid);

        // Match stations using base name matching (excludes parenthetical direction info)
        const findMatchingStations = (name) => stations.filter(s => matchStation(name, s.Name));
        const getOrderNo = (s) => {
          const o = s.OrderNo;
          return o != null ? (Array.isArray(o) ? o[0] : o) : null;
        };

        const depStations = findMatchingStations(stationName);
        if (depStations.length === 0) continue;

        // If destination specified, check if this direction also passes through it
        if (destinationName) {
          const destStations = findMatchingStations(destinationName);
          if (destStations.length === 0) continue;

          // Check if ANY combination of dep/dest has correct order (dep before dest)
          const hasValidPair = depStations.some(ds => {
            const depIdx = getOrderNo(ds);
            return destStations.some(dest => {
              const destIdx = getOrderNo(dest);
              return depIdx == null || destIdx == null || depIdx < destIdx;
            });
          });
          if (!hasValidPair) continue;
        }

        // Only fetch bus locations after confirming route serves both stations
        const buses = await getBusLocation(route.keitouSid, group.Sid);
        const processed = processBuses(buses, stationName, route, group, direction, destinationName, stations);
        results.push(...processed);
      }
    } catch (e) {
      console.warn(`Route ${route.short} failed:`, e);
    }
  });

  await runWithConcurrency(tasks, 5);

  return results
    .filter(r => {
      // Remove passed buses
      if (r.etaMinutes !== null && r.etaMinutes <= 0) return false;
      // Remove 未出発 buses more than 60 minutes away
      if (r.notDeparted && r.etaMinutes !== null && r.etaMinutes > 60) return false;
      return true;
    })
    .sort((a, b) => {
      // 走行中 first, 未出発 second
      if (a.notDeparted !== b.notDeparted) return a.notDeparted ? 1 : -1;
      if (a.etaMinutes === null) return 1;
      if (b.etaMinutes === null) return -1;
      return a.etaMinutes - b.etaMinutes;
    });
}

// StationCodeキャッシュ（セッション中有効）
const stationCodeCache = new Map();

// StationCorrectionに未登録のバス停のStationCodeを手動定義
const KNOWN_STATION_CODES = {
  '国内線旅客ターミナル前': '1602',
  '旅客ターミナル前': '1602', // 内部名
};

// バス停名からStationCodeを取得
async function getStationCode(stationName) {
  if (stationCodeCache.has(stationName)) return stationCodeCache.get(stationName);

  // ハードコード済みStationCodeを優先
  if (KNOWN_STATION_CODES[stationName]) {
    const code = KNOWN_STATION_CODES[stationName];
    stationCodeCache.set(stationName, code);
    return code;
  }

  // エイリアス解決
  const aliases = STATION_ALIASES[stationName];
  const names = aliases ? [stationName, ...aliases] : [stationName];

  for (const name of names) {
    // エイリアス先もハードコードチェック
    if (KNOWN_STATION_CODES[name]) {
      const code = KNOWN_STATION_CODES[name];
      stationCodeCache.set(stationName, code);
      return code;
    }
    try {
      const data = await fetchJSON(`${BASE}/StationCorrection?stationName=${encodeURIComponent(name)}`);
      if (data && data.length > 0) {
        const code = data[0].StationCode;
        stationCodeCache.set(stationName, code);
        return code;
      }
    } catch {}
  }
  return null;
}

// 接近情報 or 時刻表を取得してBusList互換の形式に変換
async function getApproachBuses(stationName, destinationName) {
  const stationCode = await getStationCode(stationName);
  if (!stationCode) return [];

  try {
    const result = await fetchJSON(`${BASE}/Approach?stationCode=${stationCode}`);
    const buses = result?.buses || [];
    const stationSid = result?.stationSid || null;

    // 接近情報があればフォーマット
    const formatted = buses.length > 0 ? formatApproachBuses(buses, destinationName) : [];

    // 接近情報が少ない場合（始発停等）のみ時刻表を補完
    if (formatted.length < 3 && stationSid) {
      const busStopCode = stationCode + '0000';
      const timetable = await getTimetableBuses(stationSid, busStopCode, destinationName);
      const approachKeys = new Set(formatted.map(b => `${b.routeShort}-${b.scheduledTime}`));
      const uniqueTimetable = timetable.filter(b => !approachKeys.has(`${b.routeShort}-${b.scheduledTime}`));
      return [...formatted, ...uniqueTimetable];
    }

    return formatted;
  } catch (e) {
    console.warn('Approach/Timetable API failed:', e);
    return [];
  }
}

// 接近情報をBusList形式に変換（フィルタはgetBusesBetween側で実施）
function formatApproachBuses(buses, destinationName) {
  return buses
    .filter(b => filterByDestination(b.destination, b.routeName, destinationName))
    .map(b => {
      const timeParts = b.scheduledTime?.match(/^(\d+):(\d+)$/);
      const hour = timeParts ? parseInt(timeParts[1]) : null;
      const minute = timeParts ? parseInt(timeParts[2]) : null;

      let etaMinutes = null;
      if (b.arrivalTime) {
        const arrParts = b.arrivalTime.match(/^(\d+):(\d+)$/);
        if (arrParts) {
          const now = new Date();
          const arrDate = new Date();
          arrDate.setHours(parseInt(arrParts[1]), parseInt(arrParts[2]), 0, 0);
          etaMinutes = Math.max(1, Math.round((arrDate - now) / 60000));
        }
      } else if (b.isApproaching) {
        etaMinutes = 1;
      }

      return {
        routeKey: b.routeNumber,
        routeName: `${b.routeNumber}番 ${b.routeName.replace(/^.*?線/, '線').replace(/（共同運行）/, '')}`,
        routeShort: b.routeNumber,
        direction: '',
        busId: `approach-${b.routeNumber}-${b.scheduledTime}`,
        company: '',
        position: null,
        gpsTime: null,
        scheduledTime: b.scheduledTime,
        scheduledHour: hour,
        scheduledMinute: minute,
        etaMinutes,
        delayMinutes: 0,
        passed: false,
        notDeparted: false,
        destination: b.destination.replace(/（終点）|（起点）/g, ''),
        speed: null,
        currentStop: b.currentStop?.replace(/\[着\]|\[発\]/g, '') || null,
        stopsAway: b.stopsAway,
        viaStops: [],
        isApproach: true,
      };
    });
}

// 時刻表データをBusList形式に変換（始発停フォールバック）
async function getTimetableBuses(stationSid, busStopCode, destinationName) {
  try {
    const departures = await fetchJSON(
      `${BASE}/Timetable?stationSid=${encodeURIComponent(stationSid)}&busStopCode=${encodeURIComponent(busStopCode)}`
    );
    if (!departures || !Array.isArray(departures)) return [];

    // 時刻表は終点名しか持たないため目的地フィルタしない（経由地判定不可能）
    // getBusesBetween側で逆方向フィルタ＋目的地フィルタする
    // 大規模ターミナルでは多路線あるので多めに取得し、フィルタ後に絞る
    return departures
      .slice(0, 50)
      .map(d => {
        const now = new Date();
        const depDate = new Date();
        depDate.setHours(d.hour, d.minute, 0, 0);
        const etaMinutes = Math.round((depDate - now) / 60000);

        return {
          routeKey: d.routeNumber,
          routeName: `${d.routeNumber}番 ${d.destination}行き`,
          routeShort: d.routeNumber,
          direction: '',
          busId: `timetable-${d.routeNumber}-${d.scheduledTime}`,
          company: d.company,
          position: null,
          gpsTime: null,
          scheduledTime: d.scheduledTime,
          scheduledHour: d.hour,
          scheduledMinute: d.minute,
          etaMinutes,
          delayMinutes: 0,
          passed: false,
          notDeparted: true,
          destination: d.destination,
          speed: null,
          currentStop: null,
          stopsAway: null,
          viaStops: [],
          isTimetable: true, // 時刻表由来フラグ
        };
      });
  } catch (e) {
    console.warn('Timetable API failed:', e);
    return [];
  }
}

// 目的地フィルタ共通処理
function filterByDestination(dest, routeName, destinationName) {
  if (!destinationName) return true;
  dest = dest || '';
  routeName = routeName || '';
  if (matchStation(destinationName, dest)) return true;
  if (matchStation(destinationName, routeName)) return true;
  const aliases = STATION_ALIASES[destinationName];
  if (aliases) {
    return aliases.some(a => dest.includes(a) || routeName.includes(a));
  }
  return false;
}

// Get airport-bound buses from a station (default behavior)
export async function getAllBuses(stationName) {
  const airportRoutes = await getAirportRoutes();
  return fetchBusesForRoutes(airportRoutes, stationName, null);
}

// Get buses between any two stations, pre-filtered by station cache
// BusLocation（リアルタイム）とApproach（接近情報）を並列取得してマージ
export async function getBusesBetween(fromStation, toStation) {
  const allRoutes = await fetchAllRoutes();

  // Use cached station data to narrow down routes (avoids hundreds of API calls)
  // 出発地＋目的地両方のキャッシュを使用（片方だけ失敗したケースをカバー）
  const fromRoutes = getCachedRoutesForStation(fromStation);
  const toRoutes = toStation ? getCachedRoutesForStation(toStation) : null;
  const knownRoutes = (fromRoutes || toRoutes)
    ? new Set([...(fromRoutes || []), ...(toRoutes || [])])
    : null;
  const routes = knownRoutes
    ? allRoutes.filter(r => knownRoutes.has(r.short))
    : allRoutes;

  // リアルタイムデータと接近情報を並列取得
  // 接近情報は目的地フィルタなしで取得（getBusesBetween側でフィルタ）
  const [realtime, approach] = await Promise.all([
    fetchBusesForRoutes(routes, fromStation, toStation),
    getApproachBuses(fromStation, toStation),
  ]);

  // 接近情報を方向＋目的地でフィルタ
  const filteredApproach = approach.filter(b => {
    // 逆方向フィルタ: 行先が出発地と同じ＝出発地に到着するバス＝逆方向
    if (fromStation && b.destination && matchStation(fromStation, b.destination)) return false;
    // 目的地フィルタ: 行先に目的地が含まれているか、行先の途中に目的地があるか
    if (!toStation) return true;
    if (filterByDestination(b.destination, b.routeName, toStation)) return true;
    // 時刻表由来: 行き先名に目的地が含まれないが、途中で通る可能性あり
    // → キャッシュで路線が目的地を通るか確認 + 停留所順序で方向判定
    if (b.isTimetable) {
      const destRoutes = toStation ? getCachedRoutesForStation(toStation) : null;
      if (!destRoutes || !destRoutes.includes(b.routeShort)) return false;
      // 方向判定: fromの順序 < toの順序なら同方向
      const fromOrder = getRouteOrderAtStation(fromStation, b.routeShort);
      const toOrder = getRouteOrderAtStation(toStation, b.routeShort);
      if (fromOrder != null && toOrder != null) {
        return toOrder > fromOrder; // toがfromより後 = 同方向
      }
      return true; // 順序不明ならフォールバックで表示
    }
    return false;
  });

  // 重複排除: 同じ路線番号＋近い定刻（±3分）のバスはリアルタイム側を優先
  // 接近情報とBusLocationで定刻が1-2分ずれることがあるため、完全一致ではなく近似マッチ
  const realtimeByRoute = {};
  for (const b of realtime) {
    const min = b.scheduledHour * 60 + b.scheduledMinute;
    if (!realtimeByRoute[b.routeShort]) realtimeByRoute[b.routeShort] = [];
    realtimeByRoute[b.routeShort].push(min);
  }
  const uniqueApproach = filteredApproach.filter(b => {
    if (!b.scheduledTime) return true;
    const parts = b.scheduledTime.match(/^(\d+):(\d+)$/);
    if (!parts) return true;
    const approachMin = parseInt(parts[1]) * 60 + parseInt(parts[2]);
    const rtMins = realtimeByRoute[b.routeShort];
    if (!rtMins) return true;
    // リアルタイム側に±3分以内の同路線バスがあればスキップ（リアルタイム側を優先）
    return !rtMins.some(m => Math.abs(m - approachMin) <= 3);
  });

  // 時刻表エントリが多すぎないよう、フィルタ後に最大5本に制限
  const timetableOnly = uniqueApproach.filter(b => b.isTimetable);
  const approachOnly = uniqueApproach.filter(b => !b.isTimetable);
  const limitedTimetable = timetableOnly.slice(0, 5);
  const merged = [...realtime, ...approachOnly, ...limitedTimetable];

  return merged
    .filter(r => {
      // 通過済みのバスは除外
      if (r.passed) return false;
      // 時刻表データは定刻過ぎたら即消す（瞬断の心配なし）
      if (r.isTimetable && r.etaMinutes !== null && r.etaMinutes < 0) return false;
      // 走行中バスは2分バッファ（バス停間移動中の瞬断防止）
      if (r.stopsAway != null && r.stopsAway > 0) { /* 手前にいるので残す */ }
      else if (r.etaMinutes !== null && r.etaMinutes < -2) return false;
      if (r.notDeparted && r.etaMinutes !== null && r.etaMinutes > 60) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.notDeparted !== b.notDeparted) return a.notDeparted ? 1 : -1;
      if (a.etaMinutes === null) return 1;
      if (b.etaMinutes === null) return -1;
      return a.etaMinutes - b.etaMinutes;
    });
}

// Backwards compatible alias
export const getAllAirportBuses = getAllBuses;

export async function getAllRoutes() {
  return fetchAllRoutes();
}
