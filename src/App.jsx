import { useState, useEffect, useCallback, useRef } from 'react'
import { getAllBuses, getBusesBetween } from './api'
import BusList from './BusList'
import StationSelector from './StationSelector'
import './App.css'

const REFRESH_INTERVAL = 45000;
const FAVORITES_KEY = 'bus-tracker-favorites';
const LAST_STATION_KEY = 'bus-tracker-last-station';
const LAST_DEST_KEY = 'bus-tracker-last-dest';
const DEFAULT_DEST = '那覇空港';

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

function App() {
  const [station, setStation] = useState(() =>
    localStorage.getItem(LAST_STATION_KEY) || '屋富祖'
  );
  const [destination, setDestination] = useState(() =>
    localStorage.getItem(LAST_DEST_KEY) || DEFAULT_DEST
  );
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectorMode, setSelectorMode] = useState(null); // null | 'from' | 'to'
  const [favorites, setFavorites] = useState(loadFavorites);
  const intervalRef = useRef(null);

  const isAirport = destination === DEFAULT_DEST;

  const fetchBuses = useCallback(async (from, to) => {
    try {
      setError(null);
      const data = to === DEFAULT_DEST
        ? await getAllBuses(from)
        : await getBusesBetween(from, to);
      setBuses(data);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const changeStation = useCallback((newStation) => {
    setStation(newStation);
    localStorage.setItem(LAST_STATION_KEY, newStation);
    setSelectorMode(null);
    setLoading(true);
    setBuses([]);
    fetchBuses(newStation, destination);
  }, [fetchBuses, destination]);

  const changeDestination = useCallback((newDest) => {
    setDestination(newDest);
    localStorage.setItem(LAST_DEST_KEY, newDest);
    setSelectorMode(null);
    setLoading(true);
    setBuses([]);
    fetchBuses(station, newDest);
  }, [fetchBuses, station]);

  const resetToAirport = useCallback(() => {
    changeDestination(DEFAULT_DEST);
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

  useEffect(() => {
    fetchBuses(station, destination);
    intervalRef.current = setInterval(() => fetchBuses(station, destination), REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [station, destination, fetchBuses]);

  const isFavorite = favorites.includes(station);

  // For airport mode, keep direction filter; for custom dest, show all results
  const filteredBuses = isAirport
    ? buses.filter(b => b.direction === 'up')
    : buses;

  return (
    <div className="app">
      <header className="header">
        <div className="header-route">
          <button className="header-station-btn" onClick={() => setSelectorMode('from')}>
            <span className="header-from">{station}</span>
          </button>
          <span className="header-arrow">→</span>
          <button className="header-station-btn" onClick={() => setSelectorMode('to')}>
            <span className={`header-to ${isAirport ? '' : 'custom-dest'}`}>{destination}</span>
          </button>
          {!isAirport && (
            <button className="btn-reset-dest" onClick={resetToAirport} title="空港行きに戻す">
              ✈
            </button>
          )}
          <button
            className={`btn-fav ${isFavorite ? 'is-fav' : ''}`}
            onClick={() => toggleFavorite(station)}
            title={isFavorite ? 'お気に入り解除' : 'お気に入り登録'}
          >
            {isFavorite ? '★' : '☆'}
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
            現在、{station}→{destination}のバスは見つかりませんでした
          </div>
        )}
        <BusList buses={filteredBuses} />
      </main>

      <footer className="footer">
        <div className="footer-actions">
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
          title={selectorMode === 'from' ? '出発バス停を選択' : '目的地を選択'}
          showAirportShortcut={selectorMode === 'to'}
          onSelectAirport={selectorMode === 'to' ? resetToAirport : null}
        />
      )}
    </div>
  );
}

export default App
