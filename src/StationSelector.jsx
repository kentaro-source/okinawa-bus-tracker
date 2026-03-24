import { useState, useEffect, useRef } from 'react'
import { AIRPORT_ROUTES, getCoursesGroup, getStations } from './api'

const STATION_CACHE_KEY = 'bus-tracker-station-cache';

function loadStationCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(STATION_CACHE_KEY));
    if (cached && cached.ts > Date.now() - 86400000) return cached.data;
  } catch {}
  return null;
}

function saveStationCache(data) {
  localStorage.setItem(STATION_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
}

export default function StationSelector({ onSelect, onClose, favorites, onToggleFavorite }) {
  const [query, setQuery] = useState('');
  const [allStations, setAllStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
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

      const promises = Object.values(AIRPORT_ROUTES).map(async (route) => {
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
                  routes: [route.short],
                });
              } else {
                const existing = stationSet.get(cleanName);
                if (!existing.routes.includes(route.short)) {
                  existing.routes.push(route.short);
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Find nearest station (approximate using station coordinates if available)
        // For now, suggest common stations near the user
        setGeoLoading(false);
        alert(`現在地: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\n最寄りバス停検索は今後対応予定です。\nバス停名で検索してください。`);
      },
      () => {
        setGeoLoading(false);
        alert('位置情報を取得できませんでした');
      },
      { timeout: 10000 }
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>バス停を選択</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-search">
          <input
            ref={inputRef}
            type="text"
            placeholder="バス停名を入力..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="search-input"
          />
          <button className="btn-geo" onClick={handleGeolocate} disabled={geoLoading}>
            {geoLoading ? '...' : '📍 現在地'}
          </button>
        </div>

        {favorites.length > 0 && !query && (
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

        <div className="modal-section">
          {loading ? (
            <div className="loading">バス停一覧を読み込み中...</div>
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
                <div className="more-hint">他 {filtered.length - 50} 件 — 検索で絞り込んでください</div>
              )}
              {filtered.length === 0 && query && (
                <div className="empty">「{query}」に一致するバス停がありません</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
