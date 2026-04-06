// バスナビ沖縄API対象外のバス会社データ（GTFS静的データベース）
// リアルタイム位置は取得できないため、時刻表ベース＋Google Mapsリンクで案内

// Google Mapsでバス停を検索するURL
function googleMapsStopUrl(stopName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stopName + ' バス停 沖縄')}`;
}

// Google Mapsで路線の経路検索URL
function googleMapsRouteUrl(from, to, companyName) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=transit`;
}

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

const ALL_OTHER_ROUTES = [...TOKYO_BUS_ROUTES, ...YANBARU_ROUTES];

// 全バス停の一覧（重複除去）
const ALL_OTHER_STOPS = (() => {
  const stopSet = new Map(); // stopName -> { routes, companies }
  for (const route of ALL_OTHER_ROUTES) {
    for (const stop of route.stops) {
      if (!stopSet.has(stop)) {
        stopSet.set(stop, { routes: [], companies: new Set() });
      }
      const entry = stopSet.get(stop);
      entry.routes.push({ id: route.id, name: route.name, company: route.company });
      entry.companies.add(route.company);
    }
  }
  return stopSet;
})();

// 出発地→目的地間のバスを検索（他社バス）
// 両方のバス停を含む路線を返す（順序チェックあり）
export function getOtherBusesBetween(fromStation, toStation) {
  const results = [];

  for (const route of ALL_OTHER_ROUTES) {
    const fromIdx = route.stops.findIndex(s => stationMatch(fromStation, s));
    const toIdx = toStation ? route.stops.findIndex(s => stationMatch(toStation, s)) : -1;

    // 出発地がこの路線にない場合スキップ
    if (fromIdx === -1) continue;

    // 目的地が指定されている場合、出発地より後にあるか確認
    if (toStation && (toIdx === -1 || toIdx <= fromIdx)) continue;

    results.push({
      routeId: route.id,
      routeName: route.name,
      company: route.company,
      fromStop: route.stops[fromIdx],
      toStop: toStation ? route.stops[toIdx] : route.stops[route.stops.length - 1],
      stopsAway: toStation ? toIdx - fromIdx : null,
      googleMapsUrl: googleMapsRouteUrl(
        route.stops[fromIdx] + ' 沖縄',
        (toStation ? route.stops[toIdx] : route.stops[route.stops.length - 1]) + ' 沖縄'
      ),
    });
  }

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
