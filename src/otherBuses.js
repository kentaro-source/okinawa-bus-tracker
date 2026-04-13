// バスナビ沖縄API対象外のバス会社データ（GTFS静的データベース）
// リアルタイム位置は取得できないため、時刻表ベース＋Google Mapsリンクで案内
import { TIMETABLE, DIRECTION_META } from './otherBusTimetable';

// Google Mapsでバス停を検索するURL
function googleMapsStopUrl(stopName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stopName + ' バス停 沖縄')}`;
}

// Google Mapsで路線の経路検索URL（バス停名+沖縄で精度を上げる）
// Google Mapsで「那覇空港バス停」だと空港建物にヒットして徒歩が入る
// →「国内線旅客ターミナル前バス停」に変換してバス停に直接ヒットさせる
function mapsStopName(name) {
  if (name === '那覇空港' || name === '旅客ターミナル前') return '国内線旅客ターミナル前';
  return name;
}

function googleMapsRouteUrl(from, to) {
  const f = mapsStopName(from);
  const t = mapsStopName(to);
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(f + 'バス停 沖縄')}&destination=${encodeURIComponent(t + 'バス停 沖縄')}&travelmode=transit`;
}

// 東京バスもGoogle Maps経路案内（出発地→目的地）
// 以前は路線名検索だったが、出発地が現在地になってしまう問題があった

// 東京バス路線データ
const TOKYO_BUS_ROUTES = [
  {
    id: 'TK01',
    name: '国際通り糸満線',
    company: '東京バス',
    stops: ['糸満市役所', '道の駅いとまん', '赤嶺駅', '那覇空港', '那覇商業高校（松山入口）', '国際通り入口'],
  },
  {
    id: 'TK02',
    name: 'ウミカジライナー',
    company: '東京バス',
    stops: ['国際通り入口', '那覇商業高校（松山入口）', '那覇空港', '赤嶺駅', '瀬長島ホテル ウミカジテラス', 'ストーリーライン瀬長島', 'あしびなー前', 'イーアス沖縄豊崎', '道の駅いとまん', 'サザンビーチホテル＆リゾート沖縄', '糸満市役所', '琉球ホテル＆リゾート名城ビーチ'],
  },
  {
    id: 'TK03',
    name: '名城ビーチリゾートライナー',
    company: '東京バス',
    stops: ['那覇空港', '琉球ホテル＆リゾート名城ビーチ'],
  },
  {
    id: 'TK04',
    name: '瀬長島リムジン',
    company: '東京バス',
    stops: ['那覇空港', '瀬長島ホテル ウミカジテラス', 'ストーリーライン瀬長島'],
  },
  {
    id: 'TK05',
    name: '北谷ゲートウェイライナー',
    company: '東京バス',
    stops: ['那覇空港', '国際通り入口', '北谷ゲートウェイ'],
    // GTFSのpickup_type/drop_off_typeより:
    // 下り（那覇空港→北谷）: 国際通り入口は乗車専用（降車不可）
    // 上り（北谷→那覇空港）: 国際通り入口は降車専用（乗車不可）
    fwdNoAlight: ['国際通り入口'],
    revNoBoard: ['国際通り入口'],
  },
  {
    id: 'TK06',
    name: 'ジャングリアエクスプレス',
    company: '東京バス',
    stops: ['国際通り入口', 'ジャングリア沖縄'],
  },
];

// やんばる急行バス路線データ
const YANBARU_ROUTES = [
  {
    id: 'YKB888',
    name: 'やんばる急行バス（那覇空港〜運天港）',
    company: 'やんばる急行バス',
    stops: [
      '那覇空港', '県庁北口', '泊高橋', '合同庁舎前', 'おもろまち一丁目',
      '古島駅前', '大平', '嘉数', '琉大入口', '中城',
      '喜舎場', '山里', '池武当', '道の駅許田', '世冨慶',
      '名護市役所前', '名護バスターミナル前', '北部会館', 'ホテルリゾネックス名護',
      '本部港', '本部博物館前', '本部高校入口',
      'ホテルマハイナウェルネスリゾートオキナワ', '記念公園前',
      'ロイヤルビューホテル美ら海（沖縄美ら海水族館）',
      'オリオンホテルモトブリゾート＆スパ',
      '今帰仁城跡', '今帰仁城跡入口', '仲尾次（北山高校）', '今帰仁村役場',
      'ウッパマビーチ付近', 'リゾートホテル・ベル・パライソ', '運天港',
    ],
  },
  {
    id: 'YKB3T',
    name: 'やんばる急行バス（古宇利島シャトル）',
    company: 'やんばる急行バス',
    stops: [
      '今帰仁城跡', '今帰仁城跡入口', '仲尾次（北山高校）', '仲宗根', '天底公民館',
      'DRIVE IN リカリカワルミ', '運天原', '古宇利大橋南詰展望所付近',
      '古宇利島の駅ソラハシ', 'トケイ浜・ハートロック', '古宇利オーシャンタワー',
    ],
  },
];

// カリー観光路線データ（沖縄本島のみ、石垣島路線は除外）
const KARRY_ROUTES = [
  {
    id: 'KR853',
    name: '北谷ライナー（空港→北谷）',
    company: 'カリー観光',
    stops: ['那覇空港', '県庁北口', 'おもろまち駅前', 'おもろまち一丁目', 'コンベンションセンター前', '沖縄プリンスホテル', '北谷ゲートウェイ'],
  },
  {
    id: 'KR854',
    name: '北谷ライナー（北谷→空港）',
    company: 'カリー観光',
    stops: ['北谷ゲートウェイ', 'コンベンションセンター前', '沖縄プリンスホテル', 'おもろまち一丁目', 'おもろまち駅前', '県庁北口', '旭橋', '那覇空港'],
  },
  {
    id: 'KR797',
    name: 'パルコシティシャトル（メインプレイス→パルコ）',
    company: 'カリー観光',
    stops: ['メインプレイス', 'おもろまち駅前', 'サンエーパルコシティ'],
  },
  {
    id: 'KR798',
    name: 'パルコシティシャトル（パルコ→メインプレイス）',
    company: 'カリー観光',
    stops: ['サンエーパルコシティ', 'メインプレイス', 'おもろまち駅前'],
  },
];

// 沖縄エアポートシャトル路線データ
const AIRPORT_SHUTTLE_ROUTES = [
  {
    id: 'OAS-APL',
    name: 'エアポートライナー',
    company: '沖縄エアポートシャトル',
    stops: ['那覇空港', '県庁北口', 'ナビービーチ前', 'おんなの駅', 'タイガービーチ前', 'サンマリーナビーチ前', 'ハレクラニ沖縄前', 'かりゆしビーチ前'],
  },
  {
    id: 'OAS-RSL',
    name: 'リゾートライナー',
    company: '沖縄エアポートシャトル',
    stops: ['那覇空港', '県庁北口', 'ナビービーチ前', 'おんなの駅', 'タイガービーチ前', 'サンマリーナビーチ前', 'ハレクラニ沖縄前', 'かりゆしビーチ前', '名護市役所前', '本部港', '沖縄美ら海水族館', 'エメラルドビーチ前', '備瀬フクギ並木入口'],
    // 下り（那覇→北部）: 県庁北口は乗車専用（降車不可）
    // 上り（北部→那覇）: 美ら海・エメラルド・備瀬は降車専用（乗車不可）
    fwdNoAlight: ['県庁北口'],
    revNoBoard: ['沖縄美ら海水族館', 'エメラルドビーチ前', '備瀬フクギ並木入口'],
  },
  {
    id: 'OAS-RSL-RP',
    name: 'リゾートライナー特急',
    company: '沖縄エアポートシャトル',
    stops: ['那覇空港', '県庁北口', '名護市役所前', '本部港', '沖縄美ら海水族館', 'エメラルドビーチ前', '備瀬フクギ並木入口'],
    fwdNoAlight: ['県庁北口'],
    revNoBoard: ['沖縄美ら海水族館', 'エメラルドビーチ前', '備瀬フクギ並木入口'],
  },
];

const ALL_OTHER_ROUTES = [...TOKYO_BUS_ROUTES, ...YANBARU_ROUTES, ...KARRY_ROUTES, ...AIRPORT_SHUTTLE_ROUTES];

// 東京バス停留所の座標（GTFS stops.txtから抽出）
const STOP_COORDS = {
  'イーアス沖縄豊崎': [26.156252, 127.651171],
  '瀬長島ホテル ウミカジテラス': [26.176453, 127.641852],
  '赤嶺駅': [26.193643, 127.660407],
  '那覇空港': [26.206481, 127.651126],
  'あしびなー前': [26.157929, 127.657424],
  '国際通り入口': [26.21442, 127.680154],
  '道の駅いとまん': [26.138723, 127.660969],
  'サザンビーチホテル＆リゾート沖縄': [26.132392, 127.653098],
  '糸満市役所': [26.123773, 127.66517],
  '那覇商業高校（松山入口）': [26.216556, 127.677528],
  '琉球ホテル＆リゾート名城ビーチ': [26.100608, 127.659446],
  'ストーリーライン瀬長島': [26.175417, 127.643931],
  '北谷ゲートウェイ': [26.314291, 127.758541],
  'ジャングリア沖縄': [26.643068, 127.972481],
};

// 全バス停の一覧（重複除去）
const ALL_OTHER_STOPS = (() => {
  const stopSet = new Map(); // stopName -> { routes, companies, lat, lng }
  for (const route of ALL_OTHER_ROUTES) {
    for (const stop of route.stops) {
      if (!stopSet.has(stop)) {
        const coord = STOP_COORDS[stop];
        stopSet.set(stop, { routes: [], companies: new Set(), lat: coord?.[0] || null, lng: coord?.[1] || null });
      }
      const entry = stopSet.get(stop);
      entry.routes.push({ id: route.id, name: route.name, company: route.company });
      entry.companies.add(route.company);
    }
  }
  return stopSet;
})();

// スペース正規化（全角・半角スペースを統一）
function normalizeSpace(s) {
  return s.replace(/[\s　]+/g, ' ').trim();
}

// 時刻表からバス停名にマッチするキーを探す
function findTimetableStop(timetableStops, stopName) {
  if (!timetableStops) return null;
  // 完全一致
  if (timetableStops[stopName]) return stopName;
  // スペース正規化で一致
  const normName = normalizeSpace(stopName);
  for (const key of Object.keys(timetableStops)) {
    if (normalizeSpace(key) === normName) return key;
  }
  // 部分一致・エイリアス
  for (const key of Object.keys(timetableStops)) {
    if (stationMatch(stopName, key)) return key;
  }
  return null;
}

// 時刻表ルートキーを生成（方向対応）
// directionStops: 現在マッチしている方向のstops配列（forward or reverse）
function timetableRouteKey(company, routeId, directionStops) {
  // GTFSのroute_short_nameとotherBuses.jsのidが異なる場合のマッピング
  const keyMap = {
    'カリー観光:KR853': 'カリー観光:北谷ライナー',
    'カリー観光:KR854': 'カリー観光:北谷ライナー',
    'カリー観光:KR797': 'カリー観光:パルコシティシャトル',
    'カリー観光:KR798': 'カリー観光:パルコシティシャトル',
    '沖縄エアポートシャトル:OAS-APL': '沖縄エアポートシャトル:OAS/APL',
    '沖縄エアポートシャトル:OAS-RSL': '沖縄エアポートシャトル:OAS/RSL',
    '沖縄エアポートシャトル:OAS-RSL-RP': '沖縄エアポートシャトル:OAS/RSL-RP',
  };

  // ベースキー（方向なし）を解決
  const directKey = `${company}:${routeId}`;
  let baseKey = null;
  if (DIRECTION_META[directKey]) {
    baseKey = directKey;
  } else if (keyMap[directKey] && DIRECTION_META[keyMap[directKey]]) {
    baseKey = keyMap[directKey];
  } else {
    // 部分一致
    for (const key of Object.keys(DIRECTION_META)) {
      if (key.startsWith(company + ':') && key.includes(routeId)) {
        baseKey = key;
        break;
      }
    }
  }

  if (!baseKey || !directionStops || directionStops.length === 0) {
    // フォールバック: 方向0を返す
    const fallback = `${baseKey || directKey}:0`;
    return TIMETABLE[fallback] ? fallback : null;
  }

  // DIRECTION_METAで方向を特定
  // directionStops[0]がDIRECTION_METAのfirstStopに近い方向を選ぶ
  const meta = DIRECTION_META[baseKey];
  if (!meta) {
    const fallback = `${baseKey}:0`;
    return TIMETABLE[fallback] ? fallback : null;
  }

  const fromStop = directionStops[0];
  const toStop = directionStops[directionStops.length - 1];

  let bestDir = 0;
  let bestScore = -1;

  for (let d = 0; d < meta.length; d++) {
    if (!meta[d]) continue;
    const [dirFirst, dirLast] = meta[d];
    // fromStopがdirFirstに近い＝同じ方向
    let score = 0;
    if (stationMatch(fromStop, dirFirst)) score += 10;
    if (stationMatch(toStop, dirLast)) score += 10;
    // firstStopの正規化比較
    if (normalizeSpace(fromStop) === normalizeSpace(dirFirst)) score += 5;
    if (normalizeSpace(toStop) === normalizeSpace(dirLast)) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }

  const key = `${baseKey}:${bestDir}`;
  return TIMETABLE[key] ? key : null;
}

// 現在時刻から次の発車時刻を取得（最大maxCount本）
// role: 'from'=出発地（乗車）, 'to'=目的地（降車）
function getNextDepartures(routeKey, stopName, maxCount = 2, role = 'from') {
  const timetableStops = TIMETABLE[routeKey];
  if (!timetableStops) return [];

  const ttStop = findTimetableStop(timetableStops, stopName);
  if (!ttStop) return [];

  const entries = timetableStops[ttStop];
  if (!entries) return [];

  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 月=0,...日=6 → ビットマスク位置
  const dowBit = 1 << dow;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const times = [];
  for (const entry of entries) {
    const [mask, timeStr, flags] = entry;
    if (!(mask & dowBit)) continue;

    // 乗降制限チェック
    // flags: 1=乗車専用(降車不可), 2=降車専用(乗車不可)
    if (role === 'from' && flags === 2) continue; // 降車専用のバス停からは乗れない
    if (role === 'to' && flags === 1) continue;   // 乗車専用のバス停では降りれない

    for (const t of timeStr.split(',')) {
      const [h, m] = t.split(':').map(Number);
      const mins = h * 60 + m;
      const eta = mins - nowMinutes;
      if (eta > 0 && eta <= 30) {
        times.push({ time: t, minutes: mins, eta });
      }
    }
  }

  times.sort((a, b) => a.minutes - b.minutes);
  return times.slice(0, maxCount);
}

// 出発地→目的地間のバスを検索（他社バス）
// 両方のバス停を含む路線を返す（往復両方向チェック）
// 次の発車時刻がある路線のみ表示
export function getOtherBusesBetween(fromStation, toStation) {
  const results = [];
  const seen = new Set(); // 同じ路線IDの重複防止

  for (const route of ALL_OTHER_ROUTES) {
    if (seen.has(route.id)) continue;

    // 順方向・逆方向の両方をチェック（乗降制限付き）
    const directions = [
      { stops: route.stops, noAlight: route.fwdNoAlight || [], noBoard: route.fwdNoBoard || [] },
      { stops: [...route.stops].reverse(), noAlight: route.revNoAlight || [], noBoard: route.revNoBoard || [] },
    ];
    for (const { stops, noAlight, noBoard } of directions) {
      const fromIdx = stops.findIndex(s => stationMatch(fromStation, s));
      const toIdx = toStation ? stops.findIndex(s => stationMatch(toStation, s)) : -1;

      if (fromIdx === -1) continue;
      if (toStation && (toIdx === -1 || toIdx <= fromIdx)) continue;

      // 乗降制限チェック: 乗車不可のバス停からは乗れない、降車不可のバス停では降りれない
      if (noBoard.some(s => stationMatch(stops[fromIdx], s))) continue;
      if (toStation && noAlight.some(s => stationMatch(stops[toIdx], s))) continue;

      // 同じルートID+同じ出発バス停の重複を防止
      const seenKey = `${route.id}:${stops[fromIdx]}`;
      if (!seen.has(seenKey)) {
        // 時刻表から次の発車時刻を取得（方向別）
        const routeKey = timetableRouteKey(route.company, route.id, stops);
        const departures = routeKey ? getNextDepartures(routeKey, stops[fromIdx], 2, 'from') : [];

        // 次の便がない路線はスキップ
        if (departures.length === 0) continue;

        // 目的地の降車制限チェック（timetable flagsベース）
        if (toStation && routeKey) {
          const toCheck = getNextDepartures(routeKey, stops[toIdx], 99, 'to');
          // 目的地で降車できる時刻が一つもなければスキップ
          if (toCheck.length === 0 && TIMETABLE[routeKey]) {
            const ttStop = findTimetableStop(TIMETABLE[routeKey], stops[toIdx]);
            if (ttStop) {
              // バス停自体はあるがflagsで全て除外された → 降車不可
              const rawEntries = TIMETABLE[routeKey][ttStop];
              const allPickupOnly = rawEntries && rawEntries.every(e => e[2] === 1);
              if (allPickupOnly) continue;
            }
          }
        }

        seen.add(seenKey);
        results.push({
          routeId: route.id,
          routeName: route.name,
          company: route.company,
          fromStop: stops[fromIdx],
          toStop: toStation ? stops[toIdx] : stops[stops.length - 1],
          stopsAway: toStation ? toIdx - fromIdx : null,
          departures,
          googleMapsUrl: googleMapsRouteUrl(
                stops[fromIdx],
                toStation ? stops[toIdx] : stops[stops.length - 1]
              ),
        });
      }
    }
  }

  // 直近の出発時刻順にソート
  results.sort((a, b) => (a.departures[0]?.minutes || 9999) - (b.departures[0]?.minutes || 9999));
  return results;
}

// バス停名のマッチング（部分一致、那覇空港エイリアス対応）
function stationMatch(query, stopName) {
  if (!query || !stopName) return false;
  // 完全一致
  if (query === stopName) return true;
  // 那覇空港系の統一
  const airportAliases = ['那覇空港', '旅客ターミナル前', '国内線旅客ターミナル前', '国際線旅客ターミナル前'];
  if (airportAliases.includes(query) && stopName.startsWith('那覇空港')) return true;
  if (stopName.startsWith('那覇空港') && airportAliases.includes(query)) return true;
  // 部分一致
  if (stopName.includes(query) || query.includes(stopName)) return true;
  return false;
}

// 2点間の距離（度→km概算）
function geoDistKm(lat1, lng1, lat2, lng2) {
  const dlat = (lat2 - lat1) * 111;
  const dlng = (lng2 - lng1) * 91; // 沖縄の緯度での経度1度≈91km
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

// 東京バスのGTFS-RTリアルタイム車両位置を取得し、出発バス停に向かうバスを検出
export async function getTokyoBusLive(fromStation, toStation) {
  try {
    const res = await fetch('/api/TokyoBusPositions');
    if (!res.ok) return [];
    const vehicles = await res.json();
    if (!Array.isArray(vehicles) || vehicles.length === 0) return [];

    const results = [];

    for (const v of vehicles) {
      if (!v.lat || !v.lng) continue;

      // 各路線の各方向で、車両がどのバス停付近にいるか判定
      for (const route of TOKYO_BUS_ROUTES) {
        const directions = [route.stops, [...route.stops].reverse()];
        for (const stops of directions) {
          const fromIdx = stops.findIndex(s => stationMatch(fromStation, s));
          const toIdx = toStation ? stops.findIndex(s => stationMatch(toStation, s)) : -1;
          if (fromIdx === -1) continue;
          if (toStation && (toIdx === -1 || toIdx <= fromIdx)) continue;

          // 車両の最寄りバス停を探す
          let nearestIdx = -1;
          let nearestDist = Infinity;
          for (let i = 0; i < stops.length; i++) {
            const info = ALL_OTHER_STOPS.get(stops[i]);
            if (!info || !info.lat || !info.lng) continue;
            const dist = geoDistKm(v.lat, v.lng, info.lat, info.lng);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestIdx = i;
            }
          }

          // 5km以上離れていたらこの路線ではない
          if (nearestDist > 5) continue;
          // 出発バス停より先（通過済み）ならスキップ
          if (nearestIdx >= fromIdx) continue;

          const stopsAway = fromIdx - nearestIdx;

          // tripUpdatesのstopUpdatesからETAを計算
          let etaMinutes;
          if (v.stopUpdates && v.stopUpdates.length > 0) {
            // 出発バス停に最も近いstopUpdateの出発予定時刻を使う
            const lastUpdate = v.stopUpdates[v.stopUpdates.length - 1];
            if (lastUpdate.depTime) {
              const now = Date.now() / 1000;
              etaMinutes = Math.round((lastUpdate.depTime - now) / 60);
            } else {
              etaMinutes = stopsAway * 3;
            }
          } else {
            // フォールバック: 1停留所あたり約3分で概算
            etaMinutes = stopsAway * 3;
          }

          results.push({
            routeKey: route.id,
            routeName: route.name,
            routeShort: route.id,
            direction: '',
            busId: `gtfs-rt-${v.vehicleId}`,
            company: '東京バス',
            position: { lat: v.lat, lng: v.lng },
            gpsTime: v.timestamp ? new Date(v.timestamp * 1000) : null,
            scheduledTime: null,
            scheduledHour: null,
            scheduledMinute: null,
            etaMinutes,
            delayMinutes: 0,
            passed: false,
            notDeparted: false,
            destination: toStation || stops[stops.length - 1],
            speed: null,
            currentStop: stops[nearestIdx],
            stopsAway,
            viaStops: [],
            isTokyoBusLive: true,
          });
          break; // 1つの方向でマッチしたら次の路線へ
        }
      }
    }

    return results;
  } catch (e) {
    console.warn('Tokyo Bus GTFS-RT fetch failed:', e);
    return [];
  }
}

// バス停名の検索（StationSelectorで使用）
export function searchOtherStops(query) {
  if (!query || query.length === 0) return [];
  const results = [];
  for (const [name, info] of ALL_OTHER_STOPS) {
    if (name.includes(query) || query.includes(name)) {
      results.push({
        name,
        companies: Array.from(info.companies),
        routes: info.routes,
      });
    }
  }
  return results;
}

export { ALL_OTHER_ROUTES, ALL_OTHER_STOPS };
