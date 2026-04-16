import { useState, useEffect, useRef } from 'react'
import { fetchAllRoutes, getCoursesGroup, getStations, runWithConcurrency } from './api'
import { ALL_OTHER_STOPS } from './otherBuses'

const STATION_CACHE_KEY = 'bus-tracker-station-cache-v3';
const OLD_CACHE_KEY = 'bus-tracker-station-cache';

const POPULAR_STOPS = [
  '那覇バスターミナル',
  '県庁北口',
  '牧志',
  '泊高橋',
  '普天間',
  'アメリカンビレッジ',
  'イオンモール沖縄ライカム',
  '具志川バスターミナル',
  'コンベンションセンター前',
  '名護バスターミナル',
  '沖縄北ＩＣ',
];


// Haversine distance in meters
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadStationCache() {
  try {
    // Clean up old cache format
    localStorage.removeItem(OLD_CACHE_KEY);
    const cached = JSON.parse(localStorage.getItem(STATION_CACHE_KEY));
    if (!cached) return null;
    // 失敗路線が多かった場合はTTLを1時間に短縮（通常24時間）
    const ttl = cached.failedCount > 3 ? 3600000 : 86400000;
    if (cached.ts > Date.now() - ttl) return cached.data;
  } catch {}
  return null;
}

function saveStationCache(data, failedCount = 0) {
  localStorage.setItem(STATION_CACHE_KEY, JSON.stringify({ ts: Date.now(), data, failedCount }));
}

// ひらがな→カタカナ変換
function toKatakana(str) {
  return str.replace(/[\u3041-\u3096]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

// カタカナ→ひらがな変換
function toHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

// バス停のよみがなエイリアス（ひらがな検索用）
// APIバス停にはYomiganaフィールドがあるが、他社バス停や地名検索を補完
const READING_ALIASES = {
  // 地名・地域
  'なは': '那覇',
  'なご': '名護',
  'ちゃたん': '北谷',
  'ぎのわん': '宜野湾',
  'うらそえ': '浦添',
  'おきなわ': '沖縄',
  'かでな': '嘉手納',
  'いとまん': '糸満',
  'とみぐすく': '豊見城',
  'にしはら': '西原',
  'ぎのざ': '宜野座',
  'きん': '金武',
  'おんな': '恩納',
  'よみたん': '読谷',
  'なかぐすく': '中城',
  'ちゃたん': '北谷',
  'もとぶ': '本部',
  'なきじん': '今帰仁',
  'くにがみ': '国頭',
  'うるま': 'うるま',
  'とよさき': '豊崎',
  'せなが': '瀬長',
  // バス停名
  'まきし': '牧志',
  'とまりん': '泊高橋',
  'ふてんま': '普天間',
  'こざ': 'コザ',
  'おもろまち': 'おもろまち',
  'しゅり': '首里',
  'やふそ': '屋富祖',
  'とまり': '泊',
  'あさひばし': '旭橋',
  'くもじ': '久茂地',
  'けんちょう': '県庁',
  'こくさい': '国際',
  'あかみね': '赤嶺',
  'つぼかわ': '壺川',
  'ふるじま': '古島',
  'おおひら': '大平',
  'かかず': '嘉数',
  'りゅうだい': '琉大',
  'きしゃば': '喜舎場',
  'やまざと': '山里',
  'いけんとう': '池武当',
  'きょだ': '許田',
  'せふけ': '世冨慶',
  'びせ': '備瀬',
  'こうり': '古宇利',
  'うんてん': '運天',
  'なかそね': '仲宗根',
  'あまそこ': '天底',
  'くうこう': '空港',
  'ちゅらうみ': '美ら海',
  'せそこ': '瀬底',
  'えめらるど': 'エメラルド',
};

export default function StationSelector({ onSelect, onClose, favorites, onToggleFavorite, title = 'バス停を選択', showAirportShortcut, onSelectAirport }) {
  const [query, setQuery] = useState('');
  const [allStations, setAllStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [nearbyStations, setNearbyStations] = useState(null); // [{station, distance}]
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 他社バス停のよみがな（APIにYomiganaがない停留所用）
  const OTHER_STOP_YOMIGANA = {
    '世冨慶': 'セフケ', '中城': 'ナカグスク', '今帰仁城跡': 'ナキジンジョウセキ',
    '今帰仁城跡入口': 'ナキジンジョウセキイリグチ', '今帰仁村役場': 'ナキジンソンヤクバ',
    '仲宗根': 'ナカソネ', '仲尾次（北山高校）': 'ナカオシ', '備瀬フクギ並木入口': 'ビセフクギナミキイリグチ',
    '北山病院付近': 'ホクザンビョウインフキン', '北谷ゲートウェイ': 'チャタンゲートウェイ',
    '北部会館': 'ホクブカイカン', '古宇利島の駅ソラハシ': 'コウリジマノエキソラハシ',
    '古宇利大橋南詰展望所付近': 'コウリオオハシミナミヅメテンボウショフキン',
    '古宇利大橋のまんなか付近': 'コウリオオハシノマンナカフキン',
    '古島駅前': 'フルジマエキマエ', '合同庁舎前': 'ゴウドウチョウシャマエ',
    '名護バスターミナル前': 'ナゴバスターミナルマエ', '名護市役所前': 'ナゴシヤクショマエ',
    '喜舎場': 'キシャバ', '嘉数': 'カカズ', '国際通り入口': 'コクサイドオリイリグチ',
    '壺川駅': 'ツボカワエキ', '大平': 'オオヒラ', '天底公民館': 'アマソココウミンカン',
    '山里': 'ヤマザト', '池武当': 'イケントウ', '泊高橋': 'トマリタカハシ',
    '瀬長島ホテル ウミカジテラス': 'セナガジマホテルウミカジテラス',
    '瀬長島ホテル　ウミカジテラス': 'セナガジマホテルウミカジテラス',
    '琉大入口': 'リュウダイイリグチ', '県庁北口': 'ケンチョウキタグチ',
    '糸満市役所': 'イトマンシヤクショ', '記念公園前': 'キネンコウエンマエ',
    '赤嶺駅': 'アカミネエキ', '運天原': 'ウンテンバル', '運天港': 'ウンテンコウ',
    '道の駅いとまん': 'ミチノエキイトマン', '道の駅許田': 'ミチノエキキョダ',
    '那覇商業高校（松山入口）': 'ナハショウギョウコウコウ', '旭橋': 'アサヒバシ',
    '旭橋駅・那覇バスターミナル前': 'アサヒバシエキナハバスターミナルマエ',
    '本部博物館前': 'モトブハクブツカンマエ', '本部港': 'モトブコウ',
    '本部高校入口': 'モトブコウコウイリグチ',
    '沖縄美ら海水族館（記念公園前）': 'オキナワチュラウミスイゾクカン',
    'おんなの駅（なかゆくい市場前）': 'オンナノエキナカユクイイチバマエ',
    'ハレクラニ沖縄前（伊武部希望ヶ丘入口）': 'ハレクラニオキナワマエ',
    'とまりん前（泊高橋）': 'トマリンマエトマリタカハシ',
    '琉球ホテル＆リゾート名城ビーチ': 'リュウキュウホテルナシロビーチ',
  };

  // 他社バス停をallStationsにマージ（同名バス停には路線情報を追加）
  function mergeOtherStops(stations) {
    const nameMap = new Map();
    const merged = stations.map(s => {
      const copy = { ...s, routes: [...s.routes] };
      nameMap.set(s.name, copy);
      return copy;
    });
    for (const [name, info] of ALL_OTHER_STOPS) {
      const companies = Array.from(info.companies);
      const existing = nameMap.get(name);
      if (existing) {
        // 既存バス停に他社の会社名を追加
        for (const c of companies) {
          if (!existing.routes.includes(c)) existing.routes.push(c);
        }
      } else {
        merged.push({
          name,
          fullName: name,
          yomigana: OTHER_STOP_YOMIGANA[name] || '',
          lat: info.lat,
          lng: info.lng,
          routes: companies,
          isOtherBus: true,
        });
      }
    }
    return merged;
  }

  // Load all station names from cache or API
  useEffect(() => {
    const cached = loadStationCache();
    if (cached) {
      setAllStations(mergeOtherStops(cached));
      return;
    }

    async function loadStations() {
      setLoading(true);
      const stationSet = new Map();

      const allRoutes = await fetchAllRoutes();
      let finalFailedCount = 0;

      // 路線スキャン処理（共通）
      const scanRoute = async (route) => {
        const groups = await getCoursesGroup(route.keitouSid);
        for (const group of groups) {
          const stations = await getStations(route.keitouSid, group.Sid);
          for (let stIdx = 0; stIdx < stations.length; stIdx++) {
            const s = stations[stIdx];
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
                routeOrder: { [route.short]: stIdx },
              });
            } else {
              const existing = stationSet.get(cleanName);
              if (!existing.routes.includes(route.short)) {
                existing.routes.push(route.short);
              }
              if (!existing.routeOrder) existing.routeOrder = {};
              if (existing.routeOrder[route.short] == null) {
                existing.routeOrder[route.short] = stIdx;
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
      };

      // 初回スキャン（5並列）
      let failedRoutes = [];
      const tasks = allRoutes.map((route) => async () => {
        try {
          await scanRoute(route);
        } catch (e) {
          console.warn(`Route ${route.short} scan failed:`, e);
          failedRoutes.push(route);
        }
      });
      await runWithConcurrency(tasks, 5);

      // 失敗した路線をリトライ（最大3回、並列数を下げて安定化）
      for (let retry = 1; retry <= 3 && failedRoutes.length > 0; retry++) {
        console.log(`Retry ${retry}: ${failedRoutes.length} failed routes...`);
        const stillFailed = [];
        const retryTasks = failedRoutes.map((route) => async () => {
          try {
            await scanRoute(route);
          } catch {
            stillFailed.push(route);
          }
        });
        await runWithConcurrency(retryTasks, 2);
        failedRoutes = stillFailed;
      }
      finalFailedCount = failedRoutes.length;
      if (finalFailedCount > 0) {
        console.warn(`${finalFailedCount} routes still failed after retries:`, failedRoutes.map(r => r.short));
      }

      const result = Array.from(stationSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setAllStations(mergeOtherStops(result));
      saveStationCache(result, finalFailedCount);
      setLoading(false);
    }

    loadStations();
  }, []);

  const filtered = query
    ? (() => {
        // よみがなエイリアスで変換（前方一致: よみ→読谷、ちゃ→北谷）
        const hiraQuery = toHiragana(query);
        const aliasMatches = Object.entries(READING_ALIASES)
          .filter(([key]) => key.startsWith(hiraQuery))
          .map(([, val]) => val);
        const aliasQuery = aliasMatches.length > 0 ? aliasMatches : null;
        const katakanaQuery = toKatakana(query);
        const hiraganaQuery = toHiragana(query);

        return allStations.filter(s => {
          const name = s.name;
          // バス停名本体のみで検索（fullNameの括弧内方向表記は除外）
          if (name.includes(query)) return true;
          if (name.includes(katakanaQuery)) return true;
          if (name.includes(hiraganaQuery)) return true;
          // よみがな検索（ひらがな入力→カタカナよみがなにマッチ）
          if (s.yomigana && s.yomigana.includes(katakanaQuery)) return true;
          if (aliasQuery && aliasQuery.some(a => name.includes(a))) return true;
          return false;
        }).sort((a, b) => {
          // クエリとの前方一致を優先
          const q = aliasQuery ? aliasQuery[0] : query;
          const aStarts = a.name.startsWith(q) || a.name.startsWith(katakanaQuery) || (aliasQuery && aliasQuery.some(a2 => a.name.startsWith(a2)));
          const bStarts = b.name.startsWith(q) || b.name.startsWith(katakanaQuery) || (aliasQuery && aliasQuery.some(a2 => b.name.startsWith(a2)));
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          // バスターミナル・駅を優先
          const aHub = /ターミナル|駅前|空港/.test(a.name);
          const bHub = /ターミナル|駅前|空港/.test(b.name);
          if (aHub !== bHub) return aHub ? -1 : 1;
          // 路線数が多い＝主要バス停
          return b.routes.length - a.routes.length;
        });
      })()
    : allStations;

  const handleGeolocate = async () => {
    if (!navigator.geolocation) {
      alert('位置情報に対応していません');
      return;
    }

    // 位置情報の権限を確認・要求
    if (navigator.permissions) {
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state === 'denied') {
          alert('位置情報がブロックされています。\nブラウザの設定から位置情報を許可してください。');
          return;
        }
      } catch {}
    }

    setGeoLoading(true);
    setNearbyStations(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const withDistance = allStations
          .filter(s => s.lat && s.lng)
          .map(s => ({
            station: s,
            distance: haversineDistance(latitude, longitude, s.lat, s.lng),
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 5);
        if (withDistance.length === 0) {
          alert('近くのバス停が見つかりませんでした。\nバス停データを再読み込みしてください。');
        }
        setNearbyStations(withDistance.length > 0 ? withDistance : null);
        setGeoLoading(false);
        setQuery('');
      },
      (err) => {
        setGeoLoading(false);
        if (err.code === 1) {
          alert('位置情報が許可されていません。\nブラウザの設定から許可してください。');
        } else if (err.code === 3) {
          alert('位置情報の取得がタイムアウトしました。\nもう一度お試しください。');
        } else {
          alert('位置情報を取得できませんでした。');
        }
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-search">
          <input
            ref={inputRef}
            type="text"
            placeholder="バス停名を入力..."
            value={query}
            onChange={e => { setQuery(e.target.value); setNearbyStations(null); }}
            className="search-input"
          />
          <button className="btn-geo" onClick={handleGeolocate} disabled={geoLoading}>
            {geoLoading ? '...' : '📍 現在地'}
          </button>
        </div>

        {showAirportShortcut && (
          <div className="modal-section">
            <button className="btn-airport-shortcut" onClick={onSelectAirport}>
              ✈ 那覇空港
            </button>
          </div>
        )}

        {favorites.length > 0 && !query && !nearbyStations && (
          <div className="modal-section">
            <h3>お気に入り</h3>
            {favorites.map(fav => (
              <div key={fav} className="station-item fav">
                <button className="station-btn" onClick={() => onSelect(fav)}>
                  ★ {fav}
                </button>
              </div>
            ))}
          </div>
        )}

        {!query && !nearbyStations && (
          <div className="modal-section">
            <h3>主要バス停</h3>
            <div className="popular-stops">
              {POPULAR_STOPS.map(s => (
                <button key={s} className="btn-popular" onClick={() => onSelect(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {nearbyStations && (
          <div className="modal-section">
            <h3>📍 最寄りバス停</h3>
            {nearbyStations.map(({ station, distance }) => (
              <div key={station.name} className="station-item">
                <button className="station-btn" onClick={() => onSelect(station.name)}>
                  <span className="station-name">{station.name}</span>
                  <span className="station-distance">
                    {distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`}
                  </span>
                </button>
                <button
                  className={`btn-fav-small ${favorites.includes(station.name) ? 'is-fav' : ''}`}
                  onClick={() => onToggleFavorite(station.name)}
                >
                  {favorites.includes(station.name) ? '★' : '☆'}
                </button>
              </div>
            ))}
            <button className="btn-clear-nearby" onClick={() => setNearbyStations(null)}>
              全バス停を表示
            </button>
          </div>
        )}

        {query && (
          <div className="modal-section">
            {loading ? (
              <div className="loading">バス停を検索中...</div>
            ) : (
              <div className="station-list">
                {filtered.slice(0, 50).map(s => (
                  <div key={s.name} className="station-item">
                    <button className="station-btn" onClick={() => onSelect(s.name)}>
                      <span className="station-name">{s.name}</span>
                      <span className="station-routes">{s.routes.map(r => /^\d+$/.test(r) ? r + '番' : r).join(' ')}</span>
                    </button>
                    <button
                      className={`btn-fav-small ${favorites.includes(s.name) ? 'is-fav' : ''}`}
                      onClick={() => onToggleFavorite(s.name)}
                    >
                      {favorites.includes(s.name) ? '★' : '☆'}
                    </button>
                  </div>
                ))}
                {filtered.length > 50 && (
                  <div className="more-hint">他 {filtered.length - 50} 件 — 絞り込んでください</div>
                )}
                {filtered.length === 0 && (
                  <div className="empty">「{query}」に一致するバス停がありません</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
