import { useState, useEffect, useCallback, useRef } from 'react'
import { getAllBuses } from './api'
import BusList from './BusList'
import StationSelector from './StationSelector'
import './App.css'

const REFRESH_INTERVAL = 45000;
const FAVORITES_KEY = 'bus-tracker-favorites';
const LAST_STATION_KEY = 'bus-tracker-last-station';

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || ['屋富祖'];
  } catch {
    return ['屋富祖'];
  }
}

function saveFavorites(favs) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

function App() {
  const [station, setStation] = useState(() =>
    localStorage.getItem(LAST_STATION_KEY) || '屋富祖'
  );
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showSelector, setShowSelector] = useState(false);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [direction, setDirection] = useState('up'); // 'up' = 空港行き, 'down' = 空港発
  const intervalRef = useRef(null);

  const fetchBuses = useCallback(async (stationName) => {
    try {
      setError(null);
      const data = await getAllBuses(stationName);
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
    setShowSelector(false);
    setLoading(true);
    setBuses([]);
    fetchBuses(newStation);
  }, [fetchBuses]);

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
    fetchBuses(station);
    intervalRef.current = setInterval(() => fetchBuses(station), REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [station, fetchBuses]);

  const isFavorite = favorites.includes(station);
  const filteredBuses = buses.filter(b => b.direction === direction);

  return (
    <div className="app">
      <header className="header">
        <div className="header-route">
          <span className="header-from">{station}</span>
          <span className="header-arrow">⇄</span>
          <span className="header-to">那覇空港</span>
          <button className="btn-change" onClick={() => setShowSelector(true)}>変更</button>
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
            <button className="btn-refresh" onClick={() => fetchBuses(station)} disabled={loading}>
              {loading ? '...' : '↻'}
            </button>
          </div>
        )}
      </header>

      <div className="direction-tabs">
        <button
          className={`tab ${direction === 'up' ? 'active' : ''}`}
          onClick={() => setDirection('up')}
        >
          空港行き
        </button>
        <button
          className={`tab ${direction === 'down' ? 'active' : ''}`}
          onClick={() => setDirection('down')}
        >
          空港発
        </button>
      </div>

      <main className="main">
        {loading && buses.length === 0 && (
          <div className="loading">バス情報を取得中...</div>
        )}
        {error && (
          <div className="error">エラー: {error}</div>
        )}
        {!loading && filteredBuses.length === 0 && !error && (
          <div className="empty">
            現在、{station}を通る{direction === 'up' ? '空港行き' : '空港発'}バスは運行していません
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
          <button className="btn-action" onClick={() => setShowSelector(true)}>
            バス停検索
          </button>
        </div>
      </footer>

      {showSelector && (
        <StationSelector
          onSelect={changeStation}
          onClose={() => setShowSelector(false)}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

export default App
