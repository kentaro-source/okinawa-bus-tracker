#!/usr/bin/env node
// GTFSデータから他社バスの時刻表データを生成するスクリプト
// 出力: src/otherBusTimetable.js
// 方向別に分離（上り・下りの時刻を混在させない）
// 乗降制限（pickup_type/drop_off_type）も記録

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

// 方向判定用のstop名正規化（括弧内を除去、スペース統一）
function normalizeForDir(name) {
  return name.replace(/[（(].+?[）)]/g, '').replace(/[\s　]+/g, '').trim();
}

// 参照tripのstop順序と比較して方向を判定（0=同じ方向, 1=逆方向）
function determineDirection(refStopNames, tripStopNames) {
  const refNorm = refStopNames.map(normalizeForDir);
  const tripNorm = tripStopNames.map(normalizeForDir);

  // 参照の位置マップ（正規化名→位置）
  const refPos = {};
  refNorm.forEach((n, i) => { if (!(n in refPos)) refPos[n] = i; });

  // ペア順序の一致/不一致をカウント
  let same = 0, diff = 0;
  for (let i = 0; i < tripNorm.length; i++) {
    for (let j = i + 1; j < tripNorm.length; j++) {
      const pi = refPos[tripNorm[i]];
      const pj = refPos[tripNorm[j]];
      if (pi !== undefined && pj !== undefined && pi !== pj) {
        if (pi < pj) same++;
        else diff++;
      }
    }
  }

  // 共通停留所が少なすぎる場合はfirstStopの位置で判断
  if (same + diff < 2) {
    const firstNorm = tripNorm[0];
    const lastNorm = tripNorm[tripNorm.length - 1];
    const firstPos = refPos[firstNorm];
    const lastPos = refPos[lastNorm];
    if (firstPos !== undefined && lastPos !== undefined) {
      return firstPos < lastPos ? 0 : 1;
    }
    // 片方だけ見つかった場合
    if (firstPos !== undefined) {
      return firstPos < refNorm.length / 2 ? 0 : 1;
    }
    if (lastPos !== undefined) {
      return lastPos < refNorm.length / 2 ? 1 : 0;
    }
    return 0; // 判定不能時はデフォルト0
  }

  return same >= diff ? 0 : 1;
}

function buildTimetable() {
  // 結果: { routeKey: { stopName: [{ time, days, pickup, dropoff }] } }
  const timetable = {};
  // 方向メタデータ: { "company:routeShort": { 0: { first, last }, 1: { first, last } } }
  const directionMeta = {};

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

    const stopMap = {};
    for (const s of stops) stopMap[s.stop_id] = s.stop_name;

    const routeMap = {};
    for (const r of routes) routeMap[r.route_id] = r.route_short_name || r.route_id;

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const serviceMap = {};
    for (const c of calendar) {
      if (todayStr < c.start_date || todayStr > c.end_date) continue;
      serviceMap[c.service_id] = [
        parseInt(c.monday), parseInt(c.tuesday), parseInt(c.wednesday),
        parseInt(c.thursday), parseInt(c.friday), parseInt(c.saturday), parseInt(c.sunday),
      ];
    }

    const tripMap = {};
    for (const t of trips) {
      const routeShort = routeMap[t.route_id] || t.route_id;
      tripMap[t.trip_id] = { routeShort, serviceId: t.service_id, routeId: t.route_id };
    }

    // --- Phase 1: 各tripのstop順序を取得 ---
    const tripStopOrder = {}; // trip_id → [{ stopName, seq }]
    for (const st of stopTimes) {
      if (!tripMap[st.trip_id]) continue;
      if (!tripStopOrder[st.trip_id]) tripStopOrder[st.trip_id] = [];
      tripStopOrder[st.trip_id].push({
        stopName: stopMap[st.stop_id] || st.stop_id,
        seq: parseInt(st.stop_sequence),
      });
    }
    for (const tid of Object.keys(tripStopOrder)) {
      tripStopOrder[tid].sort((a, b) => a.seq - b.seq);
    }

    // --- Phase 2: routeShortごとに方向を判定 ---
    // routeShort → trip_id[] をグループ化
    const routeTrips = {};
    for (const [tid, info] of Object.entries(tripMap)) {
      if (!tripStopOrder[tid]) continue;
      if (!routeTrips[info.routeShort]) routeTrips[info.routeShort] = [];
      routeTrips[info.routeShort].push(tid);
    }

    const tripDirection = {}; // trip_id → 0 or 1

    for (const [routeShort, tripIds] of Object.entries(routeTrips)) {
      // 最も停車数が多いtripを参照tripとする
      let refTripId = tripIds[0];
      let maxStops = 0;
      for (const tid of tripIds) {
        if (tripStopOrder[tid].length > maxStops) {
          maxStops = tripStopOrder[tid].length;
          refTripId = tid;
        }
      }
      const refStops = tripStopOrder[refTripId].map(s => s.stopName);

      // 各tripの方向を判定
      for (const tid of tripIds) {
        const tripStops = tripStopOrder[tid].map(s => s.stopName);
        tripDirection[tid] = determineDirection(refStops, tripStops);
      }

      // 方向メタデータを記録
      const routeKeyBase = `${company.name}:${routeShort}`;
      if (!directionMeta[routeKeyBase]) directionMeta[routeKeyBase] = {};
      for (const tid of tripIds) {
        const d = tripDirection[tid];
        if (!directionMeta[routeKeyBase][d]) {
          const ts = tripStopOrder[tid];
          directionMeta[routeKeyBase][d] = {
            first: ts[0].stopName,
            last: ts[ts.length - 1].stopName,
          };
        }
      }
    }

    // --- Phase 3: stop_timesを方向別にtimetableに格納 ---
    for (const st of stopTimes) {
      const trip = tripMap[st.trip_id];
      if (!trip) continue;
      const days = serviceMap[trip.serviceId];
      if (!days) continue;
      const stopName = stopMap[st.stop_id] || st.stop_id;
      const time = (st.departure_time || st.arrival_time || '').slice(0, 5);
      if (!time) continue;

      const pickupType = parseInt(st.pickup_type || '0');
      const dropOffType = parseInt(st.drop_off_type || '0');

      const dirIdx = tripDirection[st.trip_id] ?? 0;
      const routeKey = `${company.name}:${trip.routeShort}:${dirIdx}`;

      if (!timetable[routeKey]) timetable[routeKey] = {};
      if (!timetable[routeKey][stopName]) timetable[routeKey][stopName] = [];

      timetable[routeKey][stopName].push({ time, days, pickupType, dropOffType });
    }
  }

  // --- 重複除去・ソート ---
  for (const routeKey of Object.keys(timetable)) {
    for (const stopName of Object.keys(timetable[routeKey])) {
      const entries = timetable[routeKey][stopName];
      const seen = new Set();
      const unique = entries.filter(e => {
        const key = `${e.time}:${e.days.join('')}:${e.pickupType}:${e.dropOffType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => a.time.localeCompare(b.time));
      timetable[routeKey][stopName] = unique;
    }
  }

  // --- days配列をビットマスクに変換して圧縮 ---
  // フォーマット: [[曜日マスク, "HH:MM,..."], ...]
  // 乗降制限がある場合: [[曜日マスク, "HH:MM,...", flags], ...]
  //   flags: 1=乗車専用(降車不可), 2=降車専用(乗車不可)
  const compact = {};
  for (const routeKey of Object.keys(timetable)) {
    compact[routeKey] = {};
    for (const stopName of Object.keys(timetable[routeKey])) {
      // 同じmask+flagsでグループ化
      const groups = {};
      for (const e of timetable[routeKey][stopName]) {
        const mask = e.days.reduce((m, v, i) => m | (v << i), 0);
        let flags = 0;
        if (e.dropOffType === 1) flags = 1; // 乗車専用（降車不可）
        if (e.pickupType === 1) flags = 2;  // 降車専用（乗車不可）
        const groupKey = `${mask}:${flags}`;
        if (!groups[groupKey]) groups[groupKey] = { mask, flags, times: [] };
        groups[groupKey].times.push(e.time);
      }
      compact[routeKey][stopName] = Object.values(groups).map(g => {
        const entry = [g.mask, g.times.join(',')];
        if (g.flags > 0) entry.push(g.flags);
        return entry;
      });
    }
  }

  // --- 方向メタデータを圧縮 ---
  // { "company:routeShort": [[dir0first, dir0last], [dir1first, dir1last]] }
  const dirMeta = {};
  for (const [routeKeyBase, dirs] of Object.entries(directionMeta)) {
    dirMeta[routeKeyBase] = [];
    for (const d of [0, 1]) {
      if (dirs[d]) {
        dirMeta[routeKeyBase][d] = [dirs[d].first, dirs[d].last];
      }
    }
  }

  // --- JS出力 ---
  const output = `// 自動生成: scripts/build-timetable.cjs
// GTFSデータから生成した他社バス時刻表（方向別）
// 生成日: ${new Date().toISOString().slice(0, 10)}
// フォーマット: { "会社名:路線:方向": { "バス停名": [[曜日マスク, "HH:MM,...", flags?], ...] } }
// 方向: 0=参照trip順, 1=逆方向
// 曜日マスク: 月=1,火=2,水=4,木=8,金=16,土=32,日=64
// flags(省略時0): 1=乗車専用(降車不可), 2=降車専用(乗車不可)

export const TIMETABLE = ${JSON.stringify(compact)};

// 方向メタデータ: { "会社名:路線": [[方向0の始発停, 方向0の終着停], [方向1の始発停, 方向1の終着停]] }
export const DIRECTION_META = ${JSON.stringify(dirMeta)};
`;

  fs.writeFileSync(OUTPUT, output);

  // サマリー表示
  let totalEntries = 0;
  const routeKeys = Object.keys(timetable);
  for (const routeKey of routeKeys) {
    for (const stopName of Object.keys(timetable[routeKey])) {
      totalEntries += timetable[routeKey][stopName].length;
    }
  }
  console.log(`Generated: ${OUTPUT}`);
  console.log(`Direction keys: ${routeKeys.length}`);
  console.log(`Total time entries: ${totalEntries}`);

  // 方向メタデータを表示
  for (const [key, dirs] of Object.entries(dirMeta)) {
    for (let d = 0; d < dirs.length; d++) {
      if (dirs[d]) {
        console.log(`  ${key}:${d} → ${dirs[d][0]} → ${dirs[d][1]}`);
      }
    }
  }
}

buildTimetable();
