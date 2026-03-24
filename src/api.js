const BASE = '/api';

// All airport-related route definitions
export const AIRPORT_ROUTES = {
  '26': {
    keitouSid: 'de8fb322-e8e0-4b16-9838-f9c613ab3146',
    name: '26番 宜野湾空港線',
    short: '26',
  },
  '120': {
    keitouSid: 'c2d5a846-d5ab-41a8-9da6-9ca28e8fa812',
    name: '120番 名護西空港線',
    short: '120',
  },
  '132': {
    keitouSid: '48dcf8fe-ff26-4a5b-b9d8-6df2f8127881',
    name: '132番 空港コンベンション線',
    short: '132',
  },
  '95': {
    keitouSid: '0a8869a0-e40f-4914-a7b6-e4790abbc64f',
    name: '95番 空港あしびなー線',
    short: '95',
  },
  '99': {
    keitouSid: '6db19623-9894-4304-ad04-67f829e85467',
    name: '99番 天久新都心線',
    short: '99',
  },
  '113': {
    keitouSid: 'db39c118-28ed-4b03-8f12-9440b4cb6e00',
    name: '113番 具志川空港線',
    short: '113',
  },
  '123': {
    keitouSid: '2f1a9887-e290-4bd2-a96e-9a5fd00328ca',
    name: '123番 石川空港線',
    short: '123',
  },
  '125': {
    keitouSid: '18576435-f639-4dc0-afbe-64e5cfc1c45c',
    name: '125番 普天間空港線',
    short: '125',
  },
  '127': {
    keitouSid: 'b45c2134-a337-45aa-8023-ff239d09043a',
    name: '127番 屋慶名高速線',
    short: '127',
  },
  '143': {
    keitouSid: '0c6cf7ef-6a7a-47ee-911d-480c8938e3cd',
    name: '143番 空港北谷線',
    short: '143',
  },
  '189': {
    keitouSid: '74ed9a6c-ffc7-4229-b07e-caee6d9da8da',
    name: '189番 糸満空港線',
    short: '189',
  },
  '190': {
    keitouSid: 'db87aff5-5c46-4363-81d4-203e17ced42b',
    name: '190番 知花空港線',
    short: '190',
  },
};

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

// Get all buses (both directions) across all routes, filtered by station name
export async function getAllBuses(stationName) {
  const results = [];

  const promises = Object.values(AIRPORT_ROUTES).map(async (route) => {
    try {
      const groups = await getCoursesGroup(route.keitouSid);

      for (const group of groups) {
        const isUp = group.Name.includes('上り');
        const direction = isUp ? 'up' : 'down';

        const [buses, stations] = await Promise.all([
          getBusLocation(route.keitouSid, group.Sid),
          getStations(route.keitouSid, group.Sid),
        ]);

        // Check if this direction passes through the station
        const hasStation = stations.some(s => s.Name.includes(stationName));
        if (!hasStation) continue;

        const processed = processBuses(buses, stationName, route, group, direction);
        results.push(...processed);
      }
    } catch (e) {
      console.warn(`Route ${route.short} failed:`, e);
    }
  });

  await Promise.all(promises);

  // Sort: not-passed first (by ETA), then passed
  return results
    .filter(r => r.etaMinutes !== -1)
    .sort((a, b) => {
      if (a.etaMinutes === null) return 1;
      if (b.etaMinutes === null) return -1;
      return a.etaMinutes - b.etaMinutes;
    });
}

// Backwards compatible alias
export const getAllAirportBuses = getAllBuses;

export async function getAllRoutes() {
  return Object.entries(AIRPORT_ROUTES).map(([key, route]) => ({
    key,
    ...route,
  }));
}
