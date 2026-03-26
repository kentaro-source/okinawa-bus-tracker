import { useState, useEffect, useRef } from 'react'
import { fetchAllRoutes, getCoursesGroup, getStations, runWithConcurrency } from './api'

const STATION_CACHE_KEY = 'bus-tracker-station-cache-v2';
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
    if (cached && cached.ts > Date.now() - 86400000) return cached.data;
  } catch {}
  return null;
}

function saveStationCache(data) {
  localStorage.setItem(STATION_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
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

// 主要バス停のよみがなエイリアス（ひらがな検索用）
const READING_ALIASES = {
  'よみたん': '読谷',
  'なは': '那覇',
  'ちゃたん': '北谷',
  'ぎのわん': '宜野湾',
  'うらそえ': '浦添',
  'なご': '名護',
  'おきなわ': '沖縄',
  'かでな': '嘉手納',
  'まきし': '牧志',
  'とまりん': '泊高橋',
  'ふてんま': '普天間',
  'こざ': 'コザ',
  'おもろまち': 'おもろまち',
  'しゅり': '首里',
  'いとまん': '糸満',
  'とみぐすく': '豊見城',
  'にしはら': '西原',
  'ぎのざ': '宜野座',
  'きん': '金武',
  'おんな': '恩納',
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

  // Load all station names from cache or API
  useEffect(() => {
    const cached = loadStationCache();
    if (cached) {
      setAllStations(cached);
      return;
    }

    async function loadStations() {
      setLoading(true);
      const stationSet = new Map();

      const allRoutes = await fetchAllRoutes();
      const tasks = allRoutes.map((route) => async () => {
        try {
          const groups = await getCoursesGroup(route.keitouSid);
          for (const group of groups) {
            const stations = await getStations(route.keitouSid, group.Sid);
            for (const s of stations) {
              // 括弧（全角・半角両方）を除去してバス停名を正規化
              const cleanName = s.Name.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '').trim();
              if (!stationSet.has(cleanName)) {
                stationSet.set(cleanName, {
                  name: cleanName,
                  fullName: s.Name,
                  lat: s.Latitude || null,
                  lng: s.Longitude || null,
                  routes: [route.short],
                });
              } else {
                const existing = stationSet.get(cleanName);
                if (!existing.routes.includes(route.short)) {
                  existing.routes.push(route.short);
                }
                if (!existing.lat && s.Latitude) {
                  existing.lat = s.Latitude;
                  existing.lng = s.Longitude;
                }
              }
            }
          }
        } catch {}
      });

      await runWithConcurrency(tasks, 5);

      // 類似名の統合（「那覇バスターミナル前」→「那覇バスターミナル」に吸収）
      const names = Array.from(stationSet.keys()).sort((a, b) => a.length - b.length);
      for (const shorter of names) {
        for (const longer of names) {
          if (shorter === longer) continue;
          if (longer.startsWith(shorter) && longer.length - shorter.length <= 2) {
            const suffix = longer.slice(shorter.length);
            if (/^(前|口|下)$/.test(suffix)) {
              // 短い方に統合
              const shortEntry = stationSet.get(shorter);
              const longEntry = stationSet.get(longer);
              if (shortEntry && longEntry) {
                for (const r of longEntry.routes) {
                  if (!shortEntry.routes.includes(r)) shortEntry.routes.push(r);
                }
                if (!shortEntry.lat && longEntry.lat) {
                  shortEntry.lat = longEntry.lat;
                  shortEntry.lng = longEntry.lng;
                }
                stationSet.delete(longer);
              }
            }
          }
        }
      }

      const result = Array.from(stationSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setAllStations(result);
      saveStationCache(result);
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

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      alert('位置情報に対応していません');
      return;
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
        setNearbyStations(withDistance);
        setGeoLoading(false);
        setQuery('');
      },
      () => {
        setGeoLoading(false);
        alert('位置情報を取得できませんでした');
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
                      <span className="station-routes">{s.routes.map(r => r + '番').join(' ')}</span>
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
