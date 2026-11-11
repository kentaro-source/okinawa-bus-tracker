#!/usr/bin/env node
// バス停索引（メイン4社）を本番APIから生成し public/station-index.json に出力する。
// アプリ初回起動時にこの索引を同梱データとして読み、全路線スキャンなしで
// バス停選択と路線の絞り込みを即時に効かせるためのもの。
// 掃引ロジック（バス停名の整形）は StationSelector.jsx の scanRoute と同一に保つこと。
// 使い方: node scripts/build-station-index.mjs

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const u = typeof url === 'string' && url.startsWith('/api/')
    ? 'https://okinawa-bus.pages.dev' + url
    : url;
  return realFetch(u, opts);
};

const { fetchAllRoutes, getCoursesGroup, getStations, runWithConcurrency } =
  await import('../src/api.js');

const stationSet = new Map();

async function scanRoute(route) {
  const groups = await getCoursesGroup(route.keitouSid);
  for (const group of groups) {
    const stations = await getStations(route.keitouSid, group.Sid);
    for (const s of stations) {
      const cleanName = s.Name
        .replace(/（.*?）/g, '').replace(/\(.*?\)/g, '')
        .replace(/[\s　]+(おりば|のりば|乗り場|乗場)[\s　]*\S*/g, '')
        .replace(/[\s　]+[A-Za-z0-9０-９]+$/g, '')
        .trim();
      if (!stationSet.has(cleanName)) {
        stationSet.set(cleanName, {
          name: cleanName,
          fullName: s.Name,
          yomigana: s.Yomigana || '',
          lat: s.Position?.Latitude || null,
          lng: s.Position?.Longitude || null,
          routes: [route.short],
        });
      } else {
        const existing = stationSet.get(cleanName);
        if (!existing.routes.includes(route.short)) {
          existing.routes.push(route.short);
        }
        if (!existing.lat && s.Position?.Latitude) {
          existing.lat = s.Position.Latitude;
          existing.lng = s.Position.Longitude;
        }
        if (!existing.yomigana && s.Yomigana) {
          existing.yomigana = s.Yomigana;
        }
      }
    }
  }
}

const allRoutes = await fetchAllRoutes();
console.log(`routes: ${allRoutes.length}`);

let failed = [];
const tasks = allRoutes.map((route) => async () => {
  try {
    await scanRoute(route);
  } catch (e) {
    console.warn(`Route ${route.short} scan failed: ${e.message || e}`);
    failed.push(route);
  }
});
await runWithConcurrency(tasks, 8);

for (let retry = 1; retry <= 2 && failed.length > 0; retry++) {
  console.log(`Retry ${retry}: ${failed.length} routes`);
  const still = [];
  const retryTasks = failed.map((route) => async () => {
    try {
      await scanRoute(route);
    } catch {
      still.push(route);
    }
  });
  await runWithConcurrency(retryTasks, 2);
  failed = still;
}
if (failed.length > 0) {
  console.warn(`FAILED after retries: ${failed.map(r => r.short).join(', ')}`);
}

const stations = Array.from(stationSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
const out = { generatedAt: new Date().toISOString(), stations };
const fs = await import('node:fs');
const path = new URL('../public/station-index.json', import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));
console.log(`stations: ${stations.length}`);
console.log(`written: public/station-index.json (${(fs.statSync(path).size / 1024).toFixed(0)} KiB)`);
