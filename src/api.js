const BASE = '/api';

// Known airport route numbers (used as default filter)
export const AIRPORT_ROUTE_NUMBERS = new Set([
  '26', '95', '99', '111', '113', '117', '120', '123', '125', '127', '132', '143', '189', '190',
]);

// バス停名のエイリアス（UIで使う名前 → APIの実際の名前）
const STATION_ALIASES = {
  '那覇空港': ['旅客ターミナル前'],
};

// 経由地として表示する主要バス停（ユーザーが判断しやすい目印）
const VIA_LANDMARKS = [
  '那覇バスターミナル', '旭橋', '久茂地', '牧志', '県庁北口', '県庁前',
  '泊高橋', '国際通り入口', '旅客ターミナル',
  '普天間', '宜野湾', '北谷', 'コンベンションセンター前',
  '沖縄南ＩＣ', '沖縄北ＩＣ', '西原ＩＣ',
  'ライカム', '読谷', '嘉手納',
];

// 括弧内の方向表記を除外してバス停名の本体だけ取得
function getBaseName(name) {
  return name.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

// バス停マッチング: 括弧内を除外し、エイリアスも考慮
function matchStation(stationName, targetName) {
  const base = getBaseName(targetName);
  // 完全一致
  if (base === stationName) return true;
  // 前方一致（通り除外）
  if (base.startsWith(stationName) && !base.slice(stationName.length).startsWith('通り')) return true;
  // 部分一致（baseのみ）
  if (base.includes(stationName)) return true;
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

      // 目的地を既に通過済みならスキップ（行き先が逆方向）
      if (destinationName) {
        const passedDest = passages.some(p => matchStation(destinationName, p.Station.Name));
        if (passedDest) continue;
      }

      // AllStationsから出発地のOrderNoを取得
      const allStationMatch = allStations.find(s => matchStation(stationName, s.Name));
      const ourOrderNo = allStationMatch?.OrderNo ?? null;

      // 現在位置・stopsAway計算
      const lastPassage = passages[passages.length - 1];
      const currentStop = lastPassage.Station.ShortName || getBaseName(lastPassage.Station.Name);
      const lastPassageOrder = lastPassage.Schedule?.OrderNo;
      let stopsAway = null;
      if (ourOrderNo != null && lastPassageOrder != null) {
        stopsAway = ourOrderNo - lastPassageOrder;
        if (stopsAway < 0) continue; // 既に通過
      }

      // ETA推定: Passagesの通過実績から1停留所あたりの所要時間を計算
      let etaMinutes = null;
      let delayMinutes = 0;
      const lastArrival = parseNetDate(lastPassage.ArrivalTime);
      if (lastArrival && passages.length >= 2 && stopsAway != null) {
        const firstPassage = passages[0];
        const firstArrival = parseNetDate(firstPassage.ArrivalTime);
        const firstOrder = firstPassage.Schedule?.OrderNo;
        if (firstArrival && firstOrder != null && lastPassageOrder != null && lastPassageOrder > firstOrder) {
          const totalMinutes = (lastArrival - firstArrival) / 60000;
          const totalStops = lastPassageOrder - firstOrder;
          const minutesPerStop = totalMinutes / totalStops;
          etaMinutes = Math.round(minutesPerStop * stopsAway + (lastArrival - new Date()) / 60000 + minutesPerStop * stopsAway);
          // 簡易計算: 残り停留所 × 1停あたり時間 + (最終通過からの経過を考慮)
          const elapsed = (new Date() - lastArrival) / 60000;
          etaMinutes = Math.max(1, Math.round(minutesPerStop * stopsAway - elapsed));
        }
      }

      // 始発地付近（OrderNo ≤ 2）では遅延データ非表示
      const isNearOrigin = lastPassageOrder != null && lastPassageOrder <= 2;
      if (!isNearOrigin && lastArrival && lastPassage.Schedule?.ScheduledTime) {
        const lastSched = lastPassage.Schedule.ScheduledTime;
        const lastSchedDate = new Date();
        lastSchedDate.setHours(lastSched.Hour, lastSched.Minute, 0, 0);
        delayMinutes = Math.round((lastArrival - lastSchedDate) / 60000);
      }

      // 経由地抽出（AllStationsベース）
      const viaStops = [];
      if (ourOrderNo != null) {
        for (const s of allStations) {
          const sOrder = s.OrderNo;
          if (sOrder == null || sOrder <= ourOrderNo) continue;
          const base = getBaseName(s.Name);
          if (VIA_LANDMARKS.some(v => base.includes(v)) && !viaStops.includes(base)) {
            viaStops.push(base);
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
        scheduledTime: null,
        scheduledHour: null,
        scheduledMinute: null,
        etaMinutes,
        delayMinutes: stopsAway != null && stopsAway <= 10 ? delayMinutes : 0,
        passed: false,
        notDeparted: false,
        destination: group.YukisakiName || '',
        speed: bus.Speed,
        currentStop: (lastPassageOrder == null || lastPassageOrder > 2) ? currentStop : null,
        stopsAway,
        viaStops,
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
    const destination = group.YukisakiName || lastStation?.Station?.ShortName || '';

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

      // Skip unreliable position data near origin (OrderNo ≤ 2)
      if (lastPassageOrder == null || lastPassageOrder > 2) {
        currentStop = lastPassage.Station.ShortName || lastPassage.Station.Name.replace(/（.*?）$/, '');
      }
    }

    // Determine if bus has not departed yet (no passage data)
    const notDeparted = !busAlreadyPassed && passages.length === 0;

    // If not departed and past scheduled time, mark as possibly delayed
    // Keep ETA as 1 so it's not filtered out (actual arrival unknown)
    if (notDeparted && etaMinutes !== null && etaMinutes <= 0) {
      delayMinutes = Math.abs(etaMinutes);
      etaMinutes = 1; // keep visible, show as "まもなく"
    }

    // 出発地より先の主要経由地を抽出
    const ourOrder = stationSchedule.OrderNo;
    const viaStops = [];
    if (ourOrder != null) {
      for (const s of schedules) {
        if (s.OrderNo <= ourOrder) continue;
        const base = getBaseName(s.Station.Name);
        if (VIA_LANDMARKS.some(v => base.includes(v)) && !viaStops.includes(base)) {
          viaStops.push(base);
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

// Look up which route numbers serve a station (from station cache)
// Collects routes from ALL matching stations (not just the first match)
function getCachedRoutesForStation(stationName) {
  try {
    const cached = JSON.parse(localStorage.getItem('bus-tracker-station-cache-v2'));
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

// Get airport-bound buses from a station (default behavior)
export async function getAllBuses(stationName) {
  const airportRoutes = await getAirportRoutes();
  return fetchBusesForRoutes(airportRoutes, stationName, null);
}

// Get buses between any two stations, pre-filtered by station cache
export async function getBusesBetween(fromStation, toStation) {
  const allRoutes = await fetchAllRoutes();

  // Use cached station data to narrow down routes (avoids hundreds of API calls)
  const knownRoutes = getCachedRoutesForStation(fromStation);
  const routes = knownRoutes
    ? allRoutes.filter(r => knownRoutes.includes(r.short))
    : allRoutes;

  return fetchBusesForRoutes(routes, fromStation, toStation);
}

// Backwards compatible alias
export const getAllAirportBuses = getAllBuses;

export async function getAllRoutes() {
  return fetchAllRoutes();
}
