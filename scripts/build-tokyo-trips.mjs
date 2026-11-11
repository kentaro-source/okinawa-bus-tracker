#!/usr/bin/env node
// 東京バスGTFS静的データ（gtfs_data/tokyo_bus）から、GTFS-RTのtripIdで引ける
// 便別停車時分表 src/tokyoBusTrips.js を生成する。
// build-timetable.cjs と同時に再生成すること（GTFS更新時）。
// 使い方: node scripts/build-tokyo-trips.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GTFS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gtfs_data', 'tokyo_bus');
const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tokyoBusTrips.js');

function parseCSV(file) {
  const content = fs.readFileSync(path.join(GTFS_DIR, file), 'utf-8').replace(/^﻿/, '');
  const lines = content.trim().split('\n').map(l => l.replace(/\r$/, ''));
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).filter(Boolean).map(line => {
    const values = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') inQ = !inQ;
      else if (line[i] === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
      else cur += line[i];
    }
    values.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

const routes = Object.fromEntries(parseCSV('routes.txt').map(r => [r.route_id, r.route_short_name]));
const stops = Object.fromEntries(parseCSV('stops.txt').map(s => [s.stop_id, s.stop_name]));
const trips = parseCSV('trips.txt');

const timesByTrip = new Map();
for (const st of parseCSV('stop_times.txt')) {
  if (!timesByTrip.has(st.trip_id)) timesByTrip.set(st.trip_id, []);
  const [h, m] = st.departure_time.split(':').map(Number);
  timesByTrip.get(st.trip_id).push({
    seq: Number(st.stop_sequence),
    stopId: st.stop_id,
    name: stops[st.stop_id] || st.stop_id,
    min: h * 60 + m,
  });
}

const out = {};
for (const t of trips) {
  const times = (timesByTrip.get(t.trip_id) || []).sort((a, b) => a.seq - b.seq);
  if (times.length === 0) continue;
  out[t.trip_id] = {
    r: routes[t.route_id] || '',
    h: t.trip_headsign || '',
    stops: times.map(x => [x.stopId, x.name, x.min]),
  };
}

const body = `// 自動生成（scripts/build-tokyo-trips.mjs）。手で編集しないこと。
// 東京バスGTFS-RTのtripId → 便別停車時分表（GTFS静的データ由来）
// stops: [stopId, バス停名, 始発日0:00からの分数][]
export const TOKYO_TRIPS = ${JSON.stringify(out)};
`;
fs.writeFileSync(OUTPUT, body);
console.log(`trips: ${Object.keys(out).length}`);
console.log(`written: src/tokyoBusTrips.js (${(fs.statSync(OUTPUT).size / 1024).toFixed(0)} KiB)`);
