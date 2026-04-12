#!/usr/bin/env node
// OTTOP APIから方向別の時刻表データを生成するスクリプト
// 出力: src/otherBusTimetable.js
// 方針: 各バス停のOTTOP stop IDを名前検索で取得 → timetable APIで方向別時刻を取得
// Rate limit対策: 2秒間隔 + 429リトライ

const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'src', 'otherBusTimetable.js');
const DELAY_MS = 2000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 対象バス会社（OTTOP agency名→表示名）
const COMPANY_NORMALIZE = {
  '東京バス株式会社': '東京バス',
  '合同会社やんばる急行バス': 'やんばる急行バス',
  '有限会社カリー観光': 'カリー観光',
  '沖縄エアポートシャトルLLP': '沖縄エアポートシャトル',
};
const TARGET_COMPANIES = Object.values(COMPANY_NORMALIZE);

// 全ルート定義
const ALL_ROUTES = [
  { company: '東京バス', id: 'TK01', stops: ['糸満市役所','道の駅いとまん','赤嶺駅','那覇空港','那覇商業高校（松山入口）','国際通り入口'] },
  { company: '東京バス', id: 'TK02', stops: ['国際通り入口','那覇商業高校（松山入口）','那覇空港','赤嶺駅','瀬長島ホテル ウミカジテラス','ストーリーライン瀬長島','あしびなー前','イーアス沖縄豊崎','道の駅いとまん','サザンビーチホテル＆リゾート沖縄','糸満市役所','琉球ホテル＆リゾート名城ビーチ'] },
  { company: '東京バス', id: 'TK03', stops: ['那覇空港','琉球ホテル＆リゾート名城ビーチ'] },
  { company: '東京バス', id: 'TK04', stops: ['那覇空港','瀬長島ホテル ウミカジテラス','ストーリーライン瀬長島'] },
  { company: '東京バス', id: 'TK05', stops: ['那覇空港','国際通り入口','北谷ゲートウェイ'] },
  { company: '東京バス', id: 'TK06', stops: ['国際通り入口','ジャングリア沖縄'] },
  { company: 'やんばる急行バス', id: 'YKB888', stops: ['那覇空港','県庁北口','泊高橋','合同庁舎前','おもろまち一丁目','古島駅前','大平','嘉数','琉大入口','中城','喜舎場','山里','池武当','道の駅許田','世冨慶','名護市役所前','名護バスターミナル前','北部会館','ホテルリゾネックス名護','本部港','本部博物館前','本部高校入口','ホテルマハイナウェルネスリゾートオキナワ','記念公園前','ロイヤルビューホテル美ら海（沖縄美ら海水族館）','オリオンホテルモトブリゾート＆スパ','今帰仁城跡','今帰仁城跡入口','仲尾次（北山高校）','今帰仁村役場','ウッパマビーチ付近','リゾートホテル・ベル・パライソ','運天港'] },
  { company: 'やんばる急行バス', id: 'YKB3T', stops: ['今帰仁城跡','今帰仁城跡入口','仲尾次（北山高校）','仲宗根','天底公民館','DRIVE IN リカリカワルミ','運天原','古宇利大橋南詰展望所付近','古宇利島の駅ソラハシ','トケイ浜・ハートロック','古宇利オーシャンタワー'] },
  { company: 'カリー観光', id: 'KR853', stops: ['那覇空港','県庁北口','おもろまち駅前','おもろまち一丁目','コンベンションセンター前','沖縄プリンスホテル','北谷ゲートウェイ'] },
  { company: 'カリー観光', id: 'KR854', stops: ['北谷ゲートウェイ','コンベンションセンター前','沖縄プリンスホテル','おもろまち一丁目','おもろまち駅前','県庁北口','旭橋','那覇空港'] },
  { company: 'カリー観光', id: 'KR797', stops: ['メインプレイス','おもろまち駅前','サンエーパルコシティ'] },
  { company: 'カリー観光', id: 'KR798', stops: ['サンエーパルコシティ','メインプレイス','おもろまち駅前'] },
  { company: '沖縄エアポートシャトル', id: 'OAS-APL', stops: ['那覇空港','県庁北口','ナビービーチ前','おんなの駅','タイガービーチ前','サンマリーナビーチ前','ハレクラニ沖縄前','かりゆしビーチ前'] },
  { company: '沖縄エアポートシャトル', id: 'OAS-RSL', stops: ['那覇空港','県庁北口','ナビービーチ前','おんなの駅','タイガービーチ前','サンマリーナビーチ前','ハレクラニ沖縄前','かりゆしビーチ前','名護市役所前','本部港','沖縄美ら海水族館','エメラルドビーチ前','備瀬フクギ並木入口'] },
  { company: '沖縄エアポートシャトル', id: 'OAS-RSL-RP', stops: ['那覇空港','県庁北口','名護市役所前','本部港','沖縄美ら海水族館','エメラルドビーチ前','備瀬フクギ並木入口'] },
];

async function fetchRetry(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 429) {
        console.warn(`  429 rate limited, waiting 15s...`);
        await sleep(15000);
        continue;
      }
      return null;
    } catch (e) {
      if (i < 2) { await sleep(5000); continue; }
      return null;
    }
  }
  return null;
}

async function buildTimetable() {
  // 1. 全バス停を一括取得（1回のAPIコールで沖縄全域）
  console.log('Fetching all OTTOP stops...');
  const allStops = await fetchRetry('https://api.ottop.org/transit/stops?lat=26.3&lng=127.8&distance=200');
  if (!allStops) { console.error('Failed to fetch stops'); process.exit(1); }
  console.log(`  ${allStops.length} stops found`);
  await sleep(DELAY_MS);

  // 2. バス停名 → OTTOP stop IDのマッピング構築
  const stopsByName = {};
  for (const s of allStops) {
    if (!stopsByName[s.name]) stopsByName[s.name] = [];
    stopsByName[s.name].push(s.id);
  }

  // 3. 対象バス停のstop IDを収集
  const uniqueStopNames = new Set();
  for (const r of ALL_ROUTES) for (const s of r.stops) uniqueStopNames.add(s);

  // バス停名のエイリアス（OTTOP上の名称が異なる場合）
  const NAME_ALIASES = {
    '那覇空港': ['那覇空港', '国内線旅客ターミナル前', '国際線旅客ターミナル前'],
    '瀬長島ホテル ウミカジテラス': ['瀬長島ホテル　ウミカジテラス', '瀬長島ホテル ウミカジテラス', '瀬長島ホテルウミカジテラス'],
  };

  const targetStopIds = new Map(); // stopName → [stopId, ...]
  for (const name of uniqueStopNames) {
    const aliases = NAME_ALIASES[name] || [name];
    const ids = [];
    for (const alias of aliases) {
      if (stopsByName[alias]) ids.push(...stopsByName[alias]);
    }
    if (ids.length > 0) {
      targetStopIds.set(name, [...new Set(ids)]);
      console.log(`  ${name}: ${ids.length} stop(s)`);
    } else {
      console.warn(`  ${name}: NOT FOUND in OTTOP`);
    }
  }

  // 4. timetable取得（各stop IDについて平日・土・日）
  const dates = { weekday: '2026-04-13', saturday: '2026-04-11', sunday: '2026-04-12' };
  const timetable = {}; // routeKey → stopName → direction → {weekday:[], saturday:[], sunday:[]}
  const processedIds = new Set();

  let totalCalls = 0;
  const totalIds = [...targetStopIds.values()].reduce((s, ids) => s + ids.length, 0);
  console.log(`\nFetching timetables for ${totalIds} stop IDs...`);

  for (const [stopName, ids] of targetStopIds) {
    for (const stopId of ids) {
      if (processedIds.has(stopId)) continue;
      processedIds.add(stopId);

      // 最初に平日の時刻表だけ取得し、対象会社ルートがあるか確認
      const weekdayData = await fetchRetry(`https://api.ottop.org/transit/stops/${stopId}/timetable?date=${dates.weekday}`);
      totalCalls++;
      await sleep(DELAY_MS);

      if (!weekdayData) continue;

      // 対象会社のルートがあるか
      const hasTarget = weekdayData.some(e => {
        const c = COMPANY_NORMALIZE[e.agency?.name] || e.agency?.name;
        return TARGET_COMPANIES.includes(c);
      });
      if (!hasTarget) continue; // このstop IDはスキップ

      // 対象あり → 土日も取得
      const satData = await fetchRetry(`https://api.ottop.org/transit/stops/${stopId}/timetable?date=${dates.saturday}`);
      totalCalls++;
      await sleep(DELAY_MS);
      const sunData = await fetchRetry(`https://api.ottop.org/transit/stops/${stopId}/timetable?date=${dates.sunday}`);
      totalCalls++;
      await sleep(DELAY_MS);

      // データ格納
      for (const [dayType, data] of [['weekday', weekdayData], ['saturday', satData], ['sunday', sunData]]) {
        if (!data) continue;
        for (const entry of data) {
          if (!entry.agency || !entry.short_name) continue;
          const company = COMPANY_NORMALIZE[entry.agency.name] || entry.agency.name;
          if (!TARGET_COMPANIES.includes(company)) continue;

          const longName = entry.long_name || '';
          let direction = 'unknown';
          if (longName.includes('下り')) direction = 'down';
          else if (longName.includes('上り')) direction = 'up';

          const routeKey = `${company}:${entry.short_name}`;
          if (!timetable[routeKey]) timetable[routeKey] = {};
          if (!timetable[routeKey][stopName]) timetable[routeKey][stopName] = {};
          if (!timetable[routeKey][stopName][direction]) {
            timetable[routeKey][stopName][direction] = { weekday: [], saturday: [], sunday: [] };
          }

          const times = entry.times.map(t => (t.departure_time || t.arrival_time || '').slice(0, 5)).filter(Boolean);
          timetable[routeKey][stopName][direction][dayType].push(...times);
        }
      }

      if (totalCalls % 30 === 0) console.log(`  Progress: ${totalCalls} API calls, processing ${stopName}...`);
    }
  }

  console.log(`  Total API calls: ${totalCalls}`);

  // 5. 整理・重複除去
  for (const rk of Object.keys(timetable)) {
    for (const sn of Object.keys(timetable[rk])) {
      for (const dir of Object.keys(timetable[rk][sn])) {
        const d = timetable[rk][sn][dir];
        for (const dt of Object.keys(d)) d[dt] = [...new Set(d[dt])].sort();
      }
    }
  }

  // 6. 方向別キーで出力フォーマットに変換
  const compact = {};
  for (const routeKey of Object.keys(timetable)) {
    for (const stopName of Object.keys(timetable[routeKey])) {
      for (const direction of Object.keys(timetable[routeKey][stopName])) {
        const fullKey = direction === 'unknown' ? routeKey : `${routeKey}:${direction}`;
        if (!compact[fullKey]) compact[fullKey] = {};

        const dayData = timetable[routeKey][stopName][direction];
        const groups = {};
        const wd = dayData.weekday.join(',');
        const sat = dayData.saturday.join(',');
        const sun = dayData.sunday.join(',');

        if (wd === sat && sat === sun && wd) {
          groups[127] = dayData.weekday;
        } else {
          if (wd) groups[31] = dayData.weekday;
          if (sat === sun && sat) {
            groups[96] = dayData.saturday;
          } else {
            if (sat) groups[32] = dayData.saturday;
            if (sun) groups[64] = dayData.sunday;
          }
        }

        compact[fullKey][stopName] = Object.entries(groups)
          .filter(([_, t]) => t.length > 0)
          .map(([mask, t]) => [parseInt(mask), t.join(',')]);
      }
    }
  }

  // 7. 方向マッピング（最初のバス停で判定 — 終点は出発時刻がないため使えない）
  const directionMap = {};
  for (const route of ALL_ROUTES) {
    const rk = `${route.company}:${route.id}`;
    const first = route.stops[0];
    if (compact[`${rk}:down`]?.[first]) directionMap[route.id] = { forward: 'down', reverse: 'up' };
    else if (compact[`${rk}:up`]?.[first]) directionMap[route.id] = { forward: 'up', reverse: 'down' };
    else directionMap[route.id] = { forward: 'down', reverse: 'up' };
  }

  // 8. 出力
  const output = `// 自動生成: scripts/build-timetable-api.cjs
// OTTOP APIから生成した方向別時刻表
// 生成日: ${new Date().toISOString().slice(0, 10)}
// フォーマット: { "会社名:路線:方向": { "バス停名": [[曜日マスク, "HH:MM,..."], ...] } }
// 方向: up=上り, down=下り
// 曜日マスク: 月=1,火=2,水=4,木=8,金=16,土=32,日=64

export const TIMETABLE = ${JSON.stringify(compact)};

// ルートのforward方向がup/downどちらかのマッピング
export const DIRECTION_MAP = ${JSON.stringify(directionMap)};
`;

  fs.writeFileSync(OUTPUT, output);

  console.log(`\nGenerated: ${OUTPUT}`);
  console.log(`Route keys: ${Object.keys(compact).length}`);
  let total = 0;
  for (const rk of Object.keys(compact)) {
    for (const sn of Object.keys(compact[rk])) {
      for (const e of compact[rk][sn]) total += e[1].split(',').length;
    }
  }
  console.log(`Total time entries: ${total}`);
  console.log('\nDirection mapping:');
  for (const [id, m] of Object.entries(directionMap)) console.log(`  ${id}: forward=${m.forward}, reverse=${m.reverse}`);
}

buildTimetable().catch(e => { console.error('Build failed:', e); process.exit(1); });
