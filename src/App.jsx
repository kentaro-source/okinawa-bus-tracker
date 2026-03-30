import { useState, useEffect, useCallback, useRef } from 'react'
import { getBusesBetween } from './api'
import BusList from './BusList'
import StationSelector from './StationSelector'
import './App.css'

const REFRESH_INTERVAL = 45000;
const FAVORITES_KEY = 'bus-tracker-favorites';
const ROUTE_FAVORITES_KEY = 'bus-tracker-route-favorites';
const MAX_ROUTE_FAVORITES = 5;
const LAST_STATION_KEY = 'bus-tracker-last-station';
const LAST_DEST_KEY = 'bus-tracker-last-dest';
// 那覇空港は内部的に '旅客ターミナル前' で処理（国内線/国際線両方にマッチ）
// 表示名→内部名の変換（APIに存在しないバス停名を実名に変換）
function toInternalName(name) {
  if (name === '那覇空港') return '旅客ターミナル前';
  return name;
}
// 内部名→表示名の逆変換（正式なバス停名を表示）
function toDisplayName(name) {
  if (name === '旅客ターミナル前') return '国内線旅客ターミナル前';
  return name;
}
function googleMapsUrl(stationName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stationName + 'バス停 沖縄')}`;
}

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

function loadRouteFavorites() {
  try {
    return JSON.parse(localStorage.getItem(ROUTE_FAVORITES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRouteFavorites(routes) {
  localStorage.setItem(ROUTE_FAVORITES_KEY, JSON.stringify(routes));
}

function App() {
  const [station, setStation] = useState(() =>
    toInternalName(localStorage.getItem(LAST_STATION_KEY) || '那覇バスターミナル')
  );
  const [destination, setDestination] = useState(() =>
    localStorage.getItem(LAST_DEST_KEY) || '那覇バスターミナル'
  );
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectorMode, setSelectorMode] = useState(null); // null | 'from' | 'to'
  const [favorites, setFavorites] = useState(loadFavorites);
  const [routeFavorites, setRouteFavorites] = useState(loadRouteFavorites);
  const intervalRef = useRef(null);

  const fetchBuses = useCallback(async (from, to) => {
    try {
      setError(null);
      if (from === to) {
        setBuses([]);
        setLastUpdate(new Date());
        return;
      }
      const data = await getBusesBetween(from, to);
      setBuses(data);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const changeStation = useCallback((newStation) => {
    const internal = toInternalName(newStation);
    setStation(internal);
    localStorage.setItem(LAST_STATION_KEY, internal);
    setSelectorMode(null);
    setLoading(true);
    setBuses([]);
    fetchBuses(internal, destination);
  }, [fetchBuses, destination]);

  const changeDestination = useCallback((newDest) => {
    const internal = toInternalName(newDest);
    setDestination(internal);
    localStorage.setItem(LAST_DEST_KEY, internal);
    setSelectorMode(null);
    setLoading(true);
    setBuses([]);
    fetchBuses(station, internal);
  }, [fetchBuses, station]);

  const resetToAirport = useCallback(() => {
    changeDestination('那覇空港');
  }, [changeDestination]);

  const toggleFavorite = useCallback((stationName) => {
    setFavorites(prev => {
      const next = prev.includes(stationName)
        ? prev.filter(f => f !== stationName)
        : [...prev, stationName];
      saveFavorites(next);
      return next;
    });
  }, []);

  const isRouteFavorite = routeFavorites.some(r => r.from === station && r.to === destination);

  const toggleRouteFavorite = useCallback(() => {
    setRouteFavorites(prev => {
      const exists = prev.findIndex(r => r.from === station && r.to === destination);
      let next;
      if (exists >= 0) {
        next = prev.filter((_, i) => i !== exists);
      } else {
        next = [...prev, { from: station, to: destination }].slice(-MAX_ROUTE_FAVORITES);
      }
      saveRouteFavorites(next);
      return next;
    });
  }, [station, destination]);

  const switchToRoute = useCallback((from, to) => {
    const internalFrom = toInternalName(from);
    setStation(internalFrom);
    setDestination(to);
    localStorage.setItem(LAST_STATION_KEY, internalFrom);
    localStorage.setItem(LAST_DEST_KEY, to);
    setLoading(true);
    setBuses([]);
    fetchBuses(internalFrom, to);
  }, [fetchBuses]);

  useEffect(() => {
    fetchBuses(station, destination);
    intervalRef.current = setInterval(() => fetchBuses(station, destination), REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [station, destination, fetchBuses]);

  const isFavorite = favorites.includes(station);
  const isDestFavorite = favorites.includes(destination);

  const filteredBuses = buses;

  return (
    <div className="app">
      <header className="header">
        <div className="header-route">
          <button className="header-station-btn" onClick={() => setSelectorMode('from')}>
            <span className="header-from">{toDisplayName(station)}</span>
          </button>
          <a className="btn-map-icon" href={googleMapsUrl(toDisplayName(station))} target="_blank" rel="noopener noreferrer" title="地図で見る">📍</a>
          <button
            className={`btn-fav ${isFavorite ? 'is-fav' : ''}`}
            onClick={() => toggleFavorite(station)}
            title={isFavorite ? 'お気に入り解除' : 'お気に入り登録'}
          >
            {isFavorite ? '★' : '☆'}
          </button>
          <button className="header-swap-btn" onClick={() => {
            const newFrom = destination;
            const newTo = station;
            setStation(newFrom);
            setDestination(newTo);
            localStorage.setItem(LAST_STATION_KEY, newFrom);
            localStorage.setItem(LAST_DEST_KEY, newTo);
          }} title="出発地と目的地を入れ替え">
            <span className="header-arrow">→</span>
          </button>
          <button className="header-station-btn" onClick={() => setSelectorMode('to')}>
            <span className="header-to custom-dest">{toDisplayName(destination)}</span>
          </button>
          <a className="btn-map-icon" href={googleMapsUrl(toDisplayName(destination))} target="_blank" rel="noopener noreferrer" title="地図で見る">📍</a>
          <button
            className={`btn-fav ${isDestFavorite ? 'is-fav' : ''}`}
            onClick={() => toggleFavorite(destination)}
            title={isDestFavorite ? 'お気に入り解除' : 'お気に入り登録'}
          >
            {isDestFavorite ? '★' : '☆'}
          </button>
          <button
            className={`btn-fav-route ${isRouteFavorite ? 'is-fav' : ''}`}
            onClick={toggleRouteFavorite}
            title={isRouteFavorite ? 'ルート解除' : 'ルート登録'}
          >
            {isRouteFavorite ? '🔖' : '📌'}
          </button>
        </div>
        {lastUpdate && (
          <div className="header-update">
            最終更新: {lastUpdate.toLocaleTimeString('ja-JP')}
            <button className="btn-refresh" onClick={() => fetchBuses(station, destination)} disabled={loading}>
              {loading ? '...' : '↻'}
            </button>
          </div>
        )}
      </header>


      <main className="main">
        {loading && buses.length === 0 && (
          <div className="loading">バス情報を取得中...</div>
        )}
        {error && (
          <div className="error">エラー: {error}</div>
        )}
        {!loading && filteredBuses.length === 0 && !error && (
          <div className="empty">
            現在、{toDisplayName(station)}→{toDisplayName(destination)}のバスは見つかりませんでした
          </div>
        )}
        <BusList buses={filteredBuses} />
      </main>

      <footer className="footer">
        <div className="footer-actions">
          {routeFavorites.length > 0 && (
            <div className="route-fav-list">
              {routeFavorites.map((r, i) => (
                <button
                  key={`${r.from}-${r.to}-${i}`}
                  className={`btn-route-fav ${r.from === station && r.to === destination ? 'active' : ''}`}
                  onClick={() => switchToRoute(r.from, r.to)}
                >
                  🔖 {r.from}→{r.to}
                </button>
              ))}
            </div>
          )}
          <div className="fav-list">
            {favorites.map(fav => (
              <button
                key={fav}
                className={`btn-fav-station ${fav === station ? 'active' : ''}`}
                onClick={() => changeStation(fav)}
              >
                ★ {fav}
              </button>
            ))}
          </div>
          <button className="btn-action" onClick={() => setSelectorMode('from')}>
            バス停検索
          </button>
        </div>
      </footer>

      {selectorMode && (
        <StationSelector
          onSelect={selectorMode === 'from' ? changeStation : changeDestination}
          onClose={() => setSelectorMode(null)}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          title={selectorMode === 'from' ? '出発バス停を選択' : '目的バス停を選択'}
          showAirportShortcut={true}
          onSelectAirport={() => {
            if (selectorMode === 'from') {
              changeStation('那覇空港');
            } else {
              resetToAirport();
            }
          }}
        />
      )}
    </div>
  );
}

export default App
