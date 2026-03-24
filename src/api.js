const BASE = '/api';

// Known airport route numbers (used as default filter)
export const AIRPORT_ROUTE_NUMBERS = new Set([
  '26', '95', '99', '113', '120', '123', '125', '127', '132', '143', '189', '190',
]);

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
function processBuses(buses, stationName, route, group, direction) {
  const results = [];

  for (const bus of buses) {
    if (!bus.Daiya) continue;

    // Skip buses not scheduled for today's day of week
    if (!isRunningToday(bus.Daiya.YoubiKbn)) continue;

    const schedules = bus.Daiya.PassedSchedules || [];
    const passages = bus.Passages || [];

    // Find when bus is scheduled at our station
    const stationSchedule = schedules.find(s =>
      s.Station.Name.includes(stationName)
    );

    // If this route doesn't pass through our station (in this direction), skip
    if (!stationSchedule) continue;

    // Check if bus already passed our station
    const stationPassage = passages.find(p =>
      p.Station.Name.includes(stationName)
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

        if (actualArrival && lastSchedule) {
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
          // Fallback: use schedule + delay
          const adjustedTime = new Date(scheduledDate.getTime() + (delayMinutes || 0) * 60000);
          etaMinutes = Math.round((adjustedTime - now) / 60000);
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
      currentStop = lastPassage.Station.ShortName || lastPassage.Station.Name.replace(/（.*?）$/, '');
      // Count stops between last passage and our station in the schedule
      const lastPassageOrder = lastPassage.Schedule?.OrderNo;
      const ourOrder = stationSchedule.OrderNo;
      if (lastPassageOrder != null && ourOrder != null) {
        stopsAway = ourOrder - lastPassageOrder;
      }
    }

    // Determine if bus has not departed yet (no passage data)
    const notDeparted = !busAlreadyPassed && passages.length === 0;

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
      delayMinutes: delayMinutes || 0,
      passed: busAlreadyPassed,
      notDeparted,
      destination,
      speed: bus.Speed,
      currentStop,
      stopsAway,
    });
  }

  return results;
}

// Fetch buses for a given set of routes, filtered by station name
async function fetchBusesForRoutes(routes, stationName, destinationName) {
  const results = [];

  const promises = routes.map(async (route) => {
    try {
      const groups = await getCoursesGroup(route.keitouSid);

      for (const group of groups) {
        const isUp = group.Name.includes('上り');
        const direction = isUp ? 'up' : 'down';

        const [buses, stations] = await Promise.all([
          getBusLocation(route.keitouSid, group.Sid),
          getStations(route.keitouSid, group.Sid),
        ]);

        // Check if this direction passes through the departure station
        const hasStation = stations.some(s => s.Name.includes(stationName));
        if (!hasStation) continue;

        // If destination specified, check if this direction also passes through it
        if (destinationName) {
          const hasDestination = stations.some(s => s.Name.includes(destinationName));
          if (!hasDestination) continue;

          // Ensure departure comes before destination in the route order
          const depOrder = stations.find(s => s.Name.includes(stationName))?.OrderNo;
          const destOrder = stations.find(s => s.Name.includes(destinationName))?.OrderNo;
          if (depOrder != null && destOrder != null) {
            // OrderNo can be an array; use first value
            const depIdx = Array.isArray(depOrder) ? depOrder[0] : depOrder;
            const destIdx = Array.isArray(destOrder) ? destOrder[0] : destOrder;
            if (depIdx >= destIdx) continue; // wrong direction for this pair
          }
        }

        const processed = processBuses(buses, stationName, route, group, direction);
        results.push(...processed);
      }
    } catch (e) {
      console.warn(`Route ${route.short} failed:`, e);
    }
  });

  await Promise.all(promises);

  return results
    .filter(r => r.etaMinutes !== -1)
    .sort((a, b) => {
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

// Get buses between any two stations across ALL routes
export async function getBusesBetween(fromStation, toStation) {
  const allRoutes = await fetchAllRoutes();
  return fetchBusesForRoutes(allRoutes, fromStation, toStation);
}

// Backwards compatible alias
export const getAllAirportBuses = getAllBuses;

export async function getAllRoutes() {
  return fetchAllRoutes();
}
