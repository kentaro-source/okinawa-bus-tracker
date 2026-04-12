import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { getBusesBetween } from './api'
import { getOtherBusesBetween, getTokyoBusLive } from './otherBuses'
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
  if (name === '国内線旅客ターミナル前') return '旅客ターミナル前';
  if (name === '国際線旅客ターミナル前') return '旅客ターミナル前';
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
    toInternalName(localStorage.getItem(LAST_DEST_KEY) || '那覇バスターミナル')
  );
  const [buses, setBuses] = useState([]);
  // otherBusesは内部変数（BusCard形式に変換してbusesにマージ）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectorMode, setSelectorMode] = useState(null); // null | 'from' | 'to'
  const [showInfo, setShowInfo] = useState(false);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [routeFavorites, setRouteFavorites] = useState(loadRouteFavorites);
  const intervalRef = useRef(null);

  const prevBusesRef = useRef([]);
  const fetchBuses = useCallback(async (from, to) => {
    try {
      setError(null);
      if (from === to) {
        setBuses([]);
        prevBusesRef.current = [];
        setLastUpdate(new Date());
        return;
      }
      // 他社バス時刻表（静的データ）→ BusCard形式に変換
      const otherRoutes = getOtherBusesBetween(from, to);
      const scheduleBuses = [];
      for (const route of otherRoutes) {
        for (const dep of route.departures || []) {
          scheduleBuses.push({
            routeKey: `schedule-${route.routeId}`,
            routeShort: route.routeId,
            routeName: route.routeName,
            busId: `schedule-${route.routeId}-${dep.time}`,
            company: route.company,
            destination: route.toStop,
            etaMinutes: dep.eta,
            scheduledTime: dep.time,
            scheduledHour: parseInt(dep.time.split(':')[0]),
            scheduledMinute: parseInt(dep.time.split(':')[1]),
            delayMinutes: 0,
            notDeparted: false,
            isTimetable: true,
            isScheduleOnly: true,
            fromStop: route.fromStop,
            currentStop: null,
            stopsAway: null,
            viaStops: [],
            direction: '',
            passed: false,
          });
        }
      }
      const [data, tokyoLive] = await Promise.all([
        getBusesBetween(from, to),
        getTokyoBusLive(from, to),
      ]);

      // 前回表示されていたバスが今回消えた場合、最大2サイクル（90秒）維持（瞬断防止）
      const allData = [...data, ...tokyoLive, ...scheduleBuses];
      const newKeys = new Set(allData.map(b => b.busId));
      const retained = prevBusesRef.current.filter(b =>
        !newKeys.has(b.busId) && b.stopsAway != null && b.stopsAway > 0 && (b._retainCount || 0) < 2
      ).map(b => ({ ...b, _retainCount: (b._retainCount || 0) + 1 }));

      const merged = [...allData, ...retained].sort((a, b) => {
        if (a.notDeparted !== b.notDeparted) return a.notDeparted ? 1 : -1;
        if (a.etaMinutes === null) return 1;
        if (b.etaMinutes === null) return -1;
        return a.etaMinutes - b.etaMinutes;
      });
      setBuses(merged);
      prevBusesRef.current = merged;
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
            <button className="btn-info" onClick={() => setShowInfo(true)} title="このアプリについて">？</button>
            <a className="btn-gmaps-header" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(toDisplayName(station) + 'バス停 沖縄')}&destination=${encodeURIComponent(toDisplayName(destination) + 'バス停 沖縄')}&travelmode=transit`} target="_blank" rel="noopener noreferrer">Google Maps</a>
          </div>
        )}
      </header>

      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-content info-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>このアプリについて</h2>
              <button className="modal-close" onClick={() => setShowInfo(false)}>✕</button>
            </div>
            <div className="info-body">
              <p>「あと○分」の到着予測は、各バスの直近の通過記録と時刻表の定刻をもとに算出しています。</p>
              <p>道路状況等により実際の到着時刻とは異なる場合があります。同じバス停にいるバスでも、遅延状況が異なれば予測時間に差が出ます。</p>
              <p className="info-sub">データ: busnavi-okinawa.com / 45秒間隔で自動更新</p>
            </div>
          </div>
        </div>
      )}


      <main className="main">
        {loading && buses.length === 0 && (
          <div className="loading">バス情報を取得中...</div>
        )}
        {error && (
          <div className="error">エラー: {error}</div>
        )}
        {!loading && filteredBuses.length === 0 && !error && (
          <div className="empty">
            <p>現在、{toDisplayName(station)}→{toDisplayName(destination)}のバスは見つかりませんでした</p>
            <p className="empty-hint">
              {new Date().getHours() >= 22 || new Date().getHours() < 5
                ? '深夜帯のため運行が終了している可能性があります'
                : '直通バスがない区間か、一時的にデータが取得できない状態です'}
            </p>
            <a className="btn-gmaps-empty" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(toDisplayName(station) + 'バス停 沖縄')}&destination=${encodeURIComponent(toDisplayName(destination) + 'バス停 沖縄')}&travelmode=transit`} target="_blank" rel="noopener noreferrer">
              Google Mapsで経路を確認
            </a>
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
          <div className="footer-buttons">
            <button className="btn-action" onClick={() => setSelectorMode('from')}>
              バス停検索
            </button>
            <a className="btn-action btn-gmaps" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">
              Google Maps
            </a>
          </div>
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
