import { useState, useEffect, useRef } from 'react'
import { fetchAllRoutes, getCoursesGroup, getStations } from './api'

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
      const promises = allRoutes.map(async (route) => {
        try {
          const groups = await getCoursesGroup(route.keitouSid);
          for (const group of groups) {
            const stations = await getStations(route.keitouSid, group.Sid);
            for (const s of stations) {
              const cleanName = s.Name.replace(/（.*?）$/, '').trim();
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
                // Update coordinates if missing
                if (!existing.lat && s.Latitude) {
                  existing.lat = s.Latitude;
                  existing.lng = s.Longitude;
                }
              }
            }
          }
        } catch {}
      });

      await Promise.all(promises);
      const result = Array.from(stationSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setAllStations(result);
      saveStationCache(result);
      setLoading(false);
    }

    loadStations();
  }, []);

  const filtered = query
    ? allStations.filter(s => s.name.includes(query) || s.fullName.includes(query))
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
              ✈ 那覇空港（デフォルト）
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
