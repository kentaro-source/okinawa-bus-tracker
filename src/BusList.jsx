import { getAirportPlatform } from './api'

// Googleマップでバス停にヒットする名前に変換
function mapsStopName(name) {
  if (name === '那覇空港' || name === '旅客ターミナル前') return '国内線旅客ターミナル前';
  return name;
}

function MapLink({ stationName }) {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsStopName(stationName) + 'バス停 沖縄')}`;
  return (
    <a
      className="btn-map-inline"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${stationName}をGoogleマップで表示`}
      onClick={e => e.stopPropagation()}
    >
      🗺
    </a>
  );
}

function getStatusColor(eta) {
  if (eta === null) return 'gray';
  if (eta <= 5) return 'green';
  if (eta <= 20) return 'yellow';
  return 'red';
}

function getStatusEmoji(eta) {
  if (eta === null) return '⏳';
  if (eta <= 5) return '🟢';
  if (eta <= 20) return '🟡';
  return '🔴';
}

function formatETA(minutes) {
  if (minutes === null) return '走行中';
  if (minutes <= 0) return 'まもなく';
  if (minutes >= 60) return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
  return `あと${minutes}分`;
}

function formatDelay(minutes) {
  if (!minutes || minutes === 0) return '';
  if (minutes > 0) return `遅延${minutes}分`;
  return `${Math.abs(minutes)}分早い`;
}

function BusCard({ bus, platform }) {
  const color = getStatusColor(bus.etaMinutes);

  return (
    <div className={`bus-card ${color}`}>
      <div className="bus-status">
        <span className="bus-emoji">{getStatusEmoji(bus.etaMinutes)}</span>
      </div>
      <div className="bus-info">
        <div className="bus-route">
          <span className="route-number">{bus.routeShort}番</span>
          <span className="route-name">{bus.routeName.replace(/^\d+番\s*/, '')}</span>
          {bus.isHolidayVariant && <span className="bus-holiday-tag">臨時</span>}
        </div>
        <div className="bus-eta">
          <span className="eta-time">{formatETA(bus.etaMinutes)}</span>
          {bus.delayMinutes > 0 && !bus.notDeparted && bus.stopsAway != null && bus.stopsAway <= 15 && (
            <span className="eta-delay late">
              ({formatDelay(bus.delayMinutes)})
            </span>
          )}
        </div>
        {bus.isScheduleOnly ? (
          <div className="bus-position not-departed">
            🕐 {bus.scheduledTime}発 <span className="schedule-label">（時刻表）</span>
          </div>
        ) : bus.isTimetable ? (
          <div className="bus-position not-departed">
            🕐 {bus.scheduledTime}発
          </div>
        ) : bus.notDeparted ? (
          <div className="bus-position not-departed">
            🕐 {String(bus.scheduledHour).padStart(2,'0')}:{String(bus.scheduledMinute).padStart(2,'0')}発
            {bus.delayMinutes > 0 ? `（遅延${bus.delayMinutes}分）` : '（未出発）'}
          </div>
        ) : bus.currentStop ? (
          <div className="bus-position">
            📍 {bus.currentStop}
            <MapLink stationName={bus.currentStop} />
            {bus.stopsAway != null && bus.stopsAway > 0 && (
              <span className="stops-away">（{bus.stopsAway}停留所前）</span>
            )}
          </div>
        ) : null}
        {bus.viaStops && bus.viaStops.length > 0 && (
          <div className="bus-via">経由: {bus.viaStops.join('・')}</div>
        )}
        <div className="bus-detail">
          <span className="bus-company">{bus.company}</span>
          {bus.scheduledTime && !bus.isScheduleOnly && <span className="bus-scheduled">{bus.isHolidayVariant ? '定刻≈' : '定刻 '}{bus.scheduledTime}</span>}
          <span className="bus-dest">→ {bus.destination}</span>
          {platform && <span className="bus-platform">のりば{platform}</span>}
        </div>
        {bus.isScheduleOnly && (
          <div className="other-bus-note">
            {bus.company === '東京バス'
              ? '📡 Google Mapsで遅延情報を確認できます'
              : bus.company === 'やんばる急行バス'
              ? <span>📋 時刻表データ（位置情報は<a href="https://yanbaru-bus-navi.com" target="_blank" rel="noopener noreferrer">公式バスロケ</a>で確認）</span>
              : bus.company === '沖縄エアポートシャトル'
              ? <span>📋 時刻表データ（位置情報は<a href="http://bus-viewer.jp/okinawa-shuttle/view/searchDistrict.html?lang=0" target="_blank" rel="noopener noreferrer">Bus-Vision</a>で確認）</span>
              : '📋 時刻表データ（リアルタイム位置情報なし）'}
          </div>
        )}
        {bus.googleMapsUrl && (
          <a className="btn-google-maps" href={bus.googleMapsUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
            Google Mapsで確認
          </a>
        )}
      </div>
    </div>
  );
}

export default function BusList({ buses, otherBuses, fromStation }) {
  // otherBusesをBusCard形式に変換して統合
  const otherAsBusCards = (otherBuses || []).flatMap(route => {
    if (!route.departures || route.departures.length === 0) return [];
    return route.departures.slice(0, 2).map((dep, i) => ({
      routeKey: route.routeId,
      routeName: route.routeName,
      routeShort: route.routeId,
      direction: '',
      busId: `other-${route.routeId}-${dep.time}-${i}`,
      company: route.company,
      position: null,
      gpsTime: null,
      scheduledTime: dep.time,
      scheduledHour: parseInt(dep.time.split(':')[0]),
      scheduledMinute: parseInt(dep.time.split(':')[1]),
      etaMinutes: dep.eta,
      delayMinutes: 0,
      passed: false,
      notDeparted: true,
      destination: route.toStop,
      speed: null,
      currentStop: null,
      stopsAway: null,
      viaStops: [],
      isScheduleOnly: true, // 定刻データフラグ
      googleMapsUrl: route.googleMapsUrl,
    }));
  });

  // 重複排除: 同じ会社・路線・時刻のバスは1つだけ表示
  // isScheduleOnly（GTFS時刻表）を優先（会社情報やリンクが充実）、isTimetable（Timetable API）は除外
  const otherKeys = new Set(otherAsBusCards.map(b => `${b.company}:${b.routeShort}:${b.scheduledTime}`));
  const dedupedBuses = (buses || []).filter(b => {
    if (b.isTimetable && otherKeys.has(`${b.company}:${b.routeShort}:${b.scheduledTime}`)) return false;
    return true;
  });
  // otherAsBusCards内の重複も排除（同路線・同時刻）
  const seenOther = new Set();
  const dedupedOther = otherAsBusCards.filter(b => {
    const key = `${b.routeShort}:${b.scheduledTime}`;
    if (seenOther.has(key)) return false;
    seenOther.add(key);
    return true;
  });
  const allBuses = [...dedupedBuses, ...dedupedOther];
  if (allBuses.length === 0) return null;

  const running = allBuses.filter(b => !b.notDeparted && !b.isTimetable && !b.isScheduleOnly);
  const waiting = allBuses.filter(b => b.notDeparted || b.isTimetable || b.isScheduleOnly)
    .sort((a, b) => (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999));

  const isAirport = fromStation === '那覇空港' || fromStation === '旅客ターミナル前' || fromStation === '国内線旅客ターミナル前' || fromStation === '国際線旅客ターミナル前';

  return (
    <div className="bus-list">
      {running.length > 0 && (
        <div className="bus-group">
          <div className="bus-group-header">🚌 走行中</div>
          {running.map((bus) => (
            <BusCard key={`${bus.routeKey}-${bus.busId}-${bus.direction}`} bus={bus} platform={isAirport ? getAirportPlatform(bus.routeShort) : null} />
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <div className="bus-group">
          <div className="bus-group-header">🕐 まもなく出発</div>
          {waiting.map((bus) => (
            <BusCard key={`${bus.routeKey}-${bus.busId}-${bus.direction || ''}`} bus={bus} platform={isAirport ? getAirportPlatform(bus.routeShort) : null} />
          ))}
        </div>
      )}
    </div>
  );
}
