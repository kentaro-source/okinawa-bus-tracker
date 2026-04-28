import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { getBusesBetween } from './api'
import { getOtherBusesBetween, getTokyoBusLive } from './otherBuses'
import BusList from './BusList'
import StationSelector from './StationSelector'
import './App.css'

const REFRESH_INTERVAL = 45000;
// 不具合報告フォーム（Google Form）
const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSecgiLuskOh0OmITRqb_wGqRR9hJsFP2X-f3CeTaTXpTy7-sQ/viewform';
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
function mapsStopName(name) {
  if (name === '那覇空港' || name === '旅客ターミナル前' || name === '国内線旅客ターミナル前') return '国内線旅客ターミナル前';
  if (name === '国際線旅客ターミナル前') return '国際線旅客ターミナル前';
  return name;
}

function googleMapsUrl(stationName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsStopName(stationName) + 'バス停 沖縄')}`;
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
  const [via, setVia] = useState(''); // 経由地（空文字=乗換モードOFF）
  const [buses, setBuses] = useState([]);
  const [otherBuses, setOtherBuses] = useState([]);
  const [busesLeg2, setBusesLeg2] = useState([]); // 2区間目（乗換モード時）
  const [otherBusesLeg2, setOtherBusesLeg2] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectorMode, setSelectorMode] = useState(null); // null | 'from' | 'via' | 'to'
  const [showInfo, setShowInfo] = useState(false);
  const [menuView, setMenuView] = useState('menu'); // menu | about | usage | troubleshoot | credits
  const [favorites, setFavorites] = useState(loadFavorites);
  const [routeFavorites, setRouteFavorites] = useState(loadRouteFavorites);
  const intervalRef = useRef(null);

  const prevBusesRef = useRef([]);
  const fetchBuses = useCallback(async (from, to, viaPoint = '') => {
    try {
      setError(null);
      if (from === to && !viaPoint) {
        setBuses([]);
        setOtherBuses([]);
        setBusesLeg2([]);
        setOtherBusesLeg2([]);
        prevBusesRef.current = [];
        setLastUpdate(new Date());
        return;
      }

      // 乗換モード: 2区間を並列取得
      if (viaPoint) {
        setOtherBuses(getOtherBusesBetween(from, viaPoint));
        setOtherBusesLeg2(getOtherBusesBetween(viaPoint, to));
        const [data1, data2] = await Promise.all([
          getBusesBetween(from, viaPoint),
          getBusesBetween(viaPoint, to),
        ]);
        setBuses(data1.sort((a, b) => {
          if (a.notDeparted !== b.notDeparted) return a.notDeparted ? 1 : -1;
          if (a.etaMinutes === null) return 1;
          if (b.etaMinutes === null) return -1;
          return a.etaMinutes - b.etaMinutes;
        }));
        setBusesLeg2(data2.sort((a, b) => {
          if (a.notDeparted !== b.notDeparted) return a.notDeparted ? 1 : -1;
          if (a.etaMinutes === null) return 1;
          if (b.etaMinutes === null) return -1;
          return a.etaMinutes - b.etaMinutes;
        }));
        prevBusesRef.current = []; // 乗換モードでは保持なし（簡略化）
        setLastUpdate(new Date());
        return;
      }

      // 単区間モード
      setBusesLeg2([]);
      setOtherBusesLeg2([]);
      // 他社バス（静的データ、即時）
      setOtherBuses(getOtherBusesBetween(from, to));
      const data = await getBusesBetween(from, to);
      // 東京バスGTFS-RTは一時停止（ルート方向判定・座標マッチング要改善）
      // const tokyoLive = await getTokyoBusLive(from, to);

      // 前回表示されていたバスが今回消えた場合、最大2サイクル（90秒）維持（瞬断防止）
      const allData = data;
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
        <div className="header-top">
          <button className="btn-menu" onClick={() => setShowInfo(true)} title="メニュー" aria-label="メニュー">≡</button>
        </div>
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
            <a className="btn-transit-link" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(toDisplayName(station) + 'バス停 沖縄')}&destination=${encodeURIComponent(toDisplayName(destination) + 'バス停 沖縄')}&travelmode=transit`} target="_blank" rel="noopener noreferrer">🗺 Googleで乗換案内</a>
          </div>
        )}
      </header>

      {showInfo && (
        <div className="modal-overlay" onClick={() => { setShowInfo(false); setMenuView('menu'); }}>
          <div className="modal info-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>メニュー</h2>
              <button className="btn-close" onClick={() => { setShowInfo(false); setMenuView('menu'); }}>✕</button>
            </div>
            <div className="info-body">
              <ul className="menu-list">
                <li>
                  <button className={`menu-item ${menuView === 'about' ? 'active' : ''}`} onClick={() => setMenuView('about')}>
                    <span>このアプリについて</span><span className="menu-chev">›</span>
                  </button>
                </li>
                <li>
                  <button className={`menu-item ${menuView === 'usage' ? 'active' : ''}`} onClick={() => setMenuView('usage')}>
                    <span>使い方・アイコンの意味</span><span className="menu-chev">›</span>
                  </button>
                </li>
                <li>
                  <button className={`menu-item ${menuView === 'troubleshoot' ? 'active' : ''}`} onClick={() => setMenuView('troubleshoot')}>
                    <span>うまく動かないとき</span><span className="menu-chev">›</span>
                  </button>
                </li>
                {FEEDBACK_FORM_URL && (
                  <li>
                    <a className="menu-item" href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer">
                      <span>不具合報告・ご要望</span><span className="menu-chev">↗</span>
                    </a>
                  </li>
                )}
                <li>
                  <button className={`menu-item ${menuView === 'credits' ? 'active' : ''}`} onClick={() => setMenuView('credits')}>
                    <span>データ提供元</span><span className="menu-chev">›</span>
                  </button>
                </li>
              </ul>

              {menuView === 'about' && (
                <>
                  <h3 className="info-section-title">このアプリについて</h3>
                  <p>県外から沖縄にちょくちょく来る中で、バスの遅延が多くて「次に来るバスがどれなのか予想できない」のが不便で、個人的に作っている沖縄のバスアプリです。</p>
                  <p>広告も入れずぼちぼち運用しているので、多少の表示ズレや不具合は大目に見てもらえるとありがたいです。</p>
                  <p>「あと○分」の到着予測は、バスの通過記録と定刻をもとに計算しています。道路状況やGPSの精度で実際とは数分ずれることがあります。</p>
                  <p>現在は直通バスのみ表示しています。乗り換え案内は今後実装予定ですが、渋滞でバスが遅れているときは近くのバス停を出発地に変更すると別便が見つかることがあります。詳しい乗換案内が必要なときは「Googleで乗換案内」リンクをご利用ください。</p>
                  <p>気づいた点があれば「不具合報告・ご要望」から教えてください。気長に直していきます。</p>
                  <p className="info-sub">更新間隔: 45秒</p>
                </>
              )}

              {menuView === 'usage' && (
                <>
                  <h3 className="info-section-title">画面の見方</h3>
                  <p>上部の「出発バス停 → 目的バス停」をタップして、それぞれを変更できます。</p>
                  <p>下部の「バスカード」には到着予測時刻、現在の位置、定刻と遅延が表示されます。</p>
                  <h3 className="info-section-title">アイコンの意味</h3>
                  <ul className="info-list">
                    <li><strong>📍</strong>: そのバス停をGoogleマップで開く</li>
                    <li><strong>☆ / ★</strong>: バス停をお気に入り登録（ヘッダー下に表示される）</li>
                    <li><strong>📌 / 🔖</strong>: 出発地と目的地の組み合わせ（ルート）を登録</li>
                    <li><strong>→</strong>: 出発地と目的地を入れ替える</li>
                    <li><strong>≡</strong>: メニュー（このページ）</li>
                  </ul>
                  <h3 className="info-section-title">バスカードの色</h3>
                  <ul className="info-list">
                    <li><strong>🟢</strong>: あと5分以内（もうすぐ到着）</li>
                    <li><strong>🟡</strong>: あと20分以内</li>
                    <li><strong>🔴</strong>: それ以降</li>
                    <li><strong>⏳</strong>: 走行中で時刻不明</li>
                  </ul>
                  <h3 className="info-section-title">更新</h3>
                  <p>45秒ごとに自動で更新されます。スマホでは画面を引き下げて手動更新もできます。</p>
                </>
              )}

              {menuView === 'troubleshoot' && (
                <>
                  <h3 className="info-section-title">うまく動かないとき</h3>
                  <ul className="info-list">
                    <li><strong>バスが表示されない</strong>: 深夜・早朝で運行終了、または直通バスがない区間の可能性。「Googleで乗換案内」で代替経路をご確認ください。</li>
                    <li><strong>現在地がずれる</strong>: GPS精度が低い（屋内・ビル街）と数百m単位でずれます。最寄りバス停画面に「GPS精度: ±XXm」が表示されるので、100m超なら開けた場所で再取得してください。</li>
                    <li><strong>表示が古い</strong>: 45秒ごとに自動更新します。手動で今すぐ更新したい場合は画面を引き下げて再読込してください。</li>
                    <li><strong>違うバスが出る</strong>: バス停名のマッチングが外れている可能性があります。「不具合報告」から該当バス停・路線をお知らせください。</li>
                  </ul>
                </>
              )}

              {menuView === 'credits' && (
                <>
                  <h3 className="info-section-title">データ提供</h3>
                  <p className="info-credit">
                    <strong>busnavi-okinawa.com（モバイルクリエイト株式会社）</strong><br />
                    メイン4社（琉球バス交通・那覇バス・沖縄バス・東陽バス）の位置・接近情報
                  </p>
                  <p className="info-credit">
                    このアプリは以下の著作物を改変して利用しています。<br />
                    沖縄県内バス事業者のGTFS時刻表データ、OTTOP（Okinawa Transit and Tourism Opendata Platform）・各バス会社、
                    <a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener noreferrer">クリエイティブ・コモンズ・ライセンス表示4.0国際</a>
                  </p>
                </>
              )}
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
        {!loading && filteredBuses.length === 0 && otherBuses.length === 0 && !error && (
          <div className="empty">
            <p>現在、{toDisplayName(station)}→{toDisplayName(destination)}のバスは見つかりませんでした</p>
            <p className="empty-hint">
              {(() => {
                const h = new Date().getHours();
                if (h >= 22 || h < 2) return '深夜帯のため運行が終了している可能性があります';
                if (h < 6) return '早朝のためまだ運行が始まっていない可能性があります';
                return '直通バスがない区間か、一時的にデータが取得できない状態です';
              })()}
            </p>
            <a className="btn-gmaps-empty" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(toDisplayName(station) + 'バス停 沖縄')}&destination=${encodeURIComponent(toDisplayName(destination) + 'バス停 沖縄')}&travelmode=transit`} target="_blank" rel="noopener noreferrer">
              Google Mapsで経路を確認
            </a>
          </div>
        )}
        <BusList buses={filteredBuses} otherBuses={otherBuses} />
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
