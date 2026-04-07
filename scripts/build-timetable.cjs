#!/usr/bin/env node
// GTFSデータから他社バスの時刻表データを生成するスクリプト
// 出力: src/otherBusTimetable.js

const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'gtfs_data');
const OUTPUT = path.join(__dirname, '..', 'src', 'otherBusTimetable.js');

// 各社のGTFSディレクトリと路線短縮名のマッピング
const COMPANIES = [
  { dir: 'tokyo_bus', name: '東京バス' },
  { dir: 'yanbaru_express', name: 'やんばる急行バス' },
  { dir: 'karry_kanko', name: 'カリー観光' },
  { dir: 'airport_shuttle', name: '沖縄エアポートシャトル' },
];

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = content.trim().split('\n').map(l => l.replace(/\r$/, ''));
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // CSVパース（ダブルクォート対応）
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += line[i];
      }
    }
    values.push(current.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}

function buildTimetable() {
  // 結果: { routeKey: { stopName: [{ time: "HH:MM", days: [0,1,...6] }] } }
  const timetable = {};

  for (const company of COMPANIES) {
    const dir = path.join(GTFS_DIR, company.dir);
    if (!fs.existsSync(dir)) {
      console.warn(`Skip: ${dir} not found`);
      continue;
    }

    const stops = parseCSV(path.join(dir, 'stops.txt'));
    const trips = parseCSV(path.join(dir, 'trips.txt'));
    const stopTimes = parseCSV(path.join(dir, 'stop_times.txt'));
    const calendar = parseCSV(path.join(dir, 'calendar.txt'));
    const routes = parseCSV(path.join(dir, 'routes.txt'));

    // stop_id → stop_name
    const stopMap = {};
    for (const s of stops) {
      stopMap[s.stop_id] = s.stop_name;
    }

    // route_id → route_short_name
    const routeMap = {};
    for (const r of routes) {
      routeMap[r.route_id] = r.route_short_name || r.route_id;
    }

    // service_id → 曜日ビットマスク [月,火,水,木,金,土,日]
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const serviceMap = {};
    for (const c of calendar) {
      const startDate = c.start_date;
      const endDate = c.end_date;
      // 有効期間チェック
      if (todayStr < startDate || todayStr > endDate) continue;
      serviceMap[c.service_id] = [
        parseInt(c.monday), parseInt(c.tuesday), parseInt(c.wednesday),
        parseInt(c.thursday), parseInt(c.friday), parseInt(c.saturday), parseInt(c.sunday),
      ];
    }

    // calendar_dates.txt で例外処理
    const calDatesPath = path.join(dir, 'calendar_dates.txt');
    const calendarDates = fs.existsSync(calDatesPath) ? parseCSV(calDatesPath) : [];

    // trip_id → { route_short_name, service_id, route_id }
    const tripMap = {};
    for (const t of trips) {
      const routeShort = routeMap[t.route_id] || t.route_id;
      tripMap[t.trip_id] = {
        routeShort,
        serviceId: t.service_id,
        routeId: t.route_id,
      };
    }

    // stop_timesを処理
    for (const st of stopTimes) {
      const trip = tripMap[st.trip_id];
      if (!trip) continue;

      const days = serviceMap[trip.serviceId];
      if (!days) continue;

      const stopName = stopMap[st.stop_id] || st.stop_id;
      const time = (st.departure_time || st.arrival_time || '').slice(0, 5);
      if (!time) continue;

      const routeKey = `${company.name}:${trip.routeShort}`;
      if (!timetable[routeKey]) timetable[routeKey] = {};
      if (!timetable[routeKey][stopName]) timetable[routeKey][stopName] = [];

      timetable[routeKey][stopName].push({ time, days });
    }
  }

  // 各バス停の時刻を時刻順にソート・重複除去
  for (const routeKey of Object.keys(timetable)) {
    for (const stopName of Object.keys(timetable[routeKey])) {
      const entries = timetable[routeKey][stopName];
      // 同じ time+days の重複除去
      const seen = new Set();
      const unique = entries.filter(e => {
        const key = `${e.time}:${e.days.join('')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => a.time.localeCompare(b.time));
      timetable[routeKey][stopName] = unique;
    }
  }

  // days配列をビットマスクに変換して圧縮
  // 月=1,火=2,水=4,木=8,金=16,土=32,日=64 (全日=127,平日=31,土日=96)
  const compact = {};
  for (const routeKey of Object.keys(timetable)) {
    compact[routeKey] = {};
    for (const stopName of Object.keys(timetable[routeKey])) {
      const groups = {};
      for (const e of timetable[routeKey][stopName]) {
        const mask = e.days.reduce((m, v, i) => m | (v << i), 0);
        if (!groups[mask]) groups[mask] = [];
        groups[mask].push(e.time);
      }
      compact[routeKey][stopName] = Object.entries(groups).map(
        ([mask, times]) => [parseInt(mask), times.join(',')]
      );
    }
  }

  // JS出力
  const output = `// 自動生成: scripts/build-timetable.cjs
// GTFSデータから生成した他社バス時刻表
// 生成日: ${new Date().toISOString().slice(0, 10)}
// フォーマット: { "会社名:路線": { "バス停名": [[曜日マスク, "HH:MM,..."], ...] } }
// 曜日マスク: 月=1,火=2,水=4,木=8,金=16,土=32,日=64

export const TIMETABLE = ${JSON.stringify(compact)};
`;

  fs.writeFileSync(OUTPUT, output);

  // サマリー表示
  let totalEntries = 0;
  for (const routeKey of Object.keys(timetable)) {
    for (const stopName of Object.keys(timetable[routeKey])) {
      totalEntries += timetable[routeKey][stopName].length;
    }
  }
  console.log(`Generated: ${OUTPUT}`);
  console.log(`Routes: ${Object.keys(timetable).length}`);
  console.log(`Total time entries: ${totalEntries}`);
}

buildTimetable();
