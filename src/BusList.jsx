import { getAirportPlatform } from './api'

// Googleマップでバス停にヒットする名前に変換
function toMapsStopName(name) {
  if (name === '那覇空港' || name === '旅客ターミナル前')
    return '国内線旅客ターミナル前';
  return name;
}

function MapLink({ stationName }) {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stationName + 'バス停 沖縄')}`;
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
            🕐 {bus.scheduledTime}発（位置情報なし）
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
          <a
            className="btn-google-maps"
            href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(toMapsStopName(bus.fromStop) + ' バス停')}&destination=${encodeURIComponent(toMapsStopName(bus.destination) + ' バス停')}&travelmode=transit`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Mapsで経路確認
          </a>
        )}
      </div>
    </div>
  );
}

export default function BusList({ buses, fromStation }) {
  const hasBuses = buses && buses.length > 0;
  if (!hasBuses) return null;

  // 出発地が那覇空港系の場合、乗り場番号を表示
  const isAirport = fromStation === '旅客ターミナル前' || fromStation === '那覇空港'
    || fromStation === '国内線旅客ターミナル前' || fromStation === '国際線旅客ターミナル前';

  const running = hasBuses ? buses.filter(b => !b.notDeparted && !b.isTimetable) : [];
  const waiting = hasBuses ? buses.filter(b => b.notDeparted || b.isTimetable) : [];

  return (
    <div className="bus-list">
      {running.length > 0 && (
        <div className="bus-group">
          <div className="bus-group-header">🚌 走行中</div>
          {running.map((bus, i) => (
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
