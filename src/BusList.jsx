const STATION_CACHE_KEY = 'bus-tracker-station-cache-v2';

function getStationCoordsFromCache(stationName) {
  try {
    const cached = JSON.parse(localStorage.getItem(STATION_CACHE_KEY));
    if (cached && cached.data) {
      const s = cached.data.find(s => s.name === stationName || s.name.includes(stationName));
      if (s && s.lat && s.lng) return { lat: s.lat, lng: s.lng };
    }
  } catch {}
  return null;
}

function MapLink({ stationName }) {
  const coords = getStationCoordsFromCache(stationName);
  if (!coords) return null;
  return (
    <a
      className="btn-map-inline"
      href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
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
  if (minutes === null) return '不明';
  if (minutes <= 0) return 'まもなく';
  if (minutes >= 60) return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
  return `あと${minutes}分`;
}

function formatDelay(minutes) {
  if (!minutes || minutes === 0) return '';
  if (minutes > 0) return `遅延${minutes}分`;
  return `${Math.abs(minutes)}分早い`;
}

function BusCard({ bus }) {
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
        </div>
        <div className="bus-eta">
          <span className="eta-time">{formatETA(bus.etaMinutes)}</span>
          {bus.delayMinutes !== 0 && (
            <span className={`eta-delay ${bus.delayMinutes > 0 ? 'late' : 'early'}`}>
              ({formatDelay(bus.delayMinutes)})
            </span>
          )}
        </div>
        {bus.notDeparted ? (
          <div className="bus-position not-departed">
            🕐 {String(bus.scheduledHour).padStart(2,'0')}:{String(bus.scheduledMinute).padStart(2,'0')}発（未出発）
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
        <div className="bus-detail">
          <span className="bus-company">{bus.company}</span>
          {bus.scheduledTime && <span className="bus-scheduled">定刻 {bus.scheduledTime}</span>}
          <span className="bus-dest">→ {bus.destination}</span>
        </div>
      </div>
    </div>
  );
}

export default function BusList({ buses }) {
  if (!buses || buses.length === 0) return null;

  const running = buses.filter(b => !b.notDeparted);
  const notDeparted = buses.filter(b => b.notDeparted);

  return (
    <div className="bus-list">
      {running.length > 0 && (
        <div className="bus-group">
          <div className="bus-group-header">🚌 走行中</div>
          {running.map((bus, i) => (
            <BusCard key={`${bus.routeKey}-${bus.busId}-${bus.direction}`} bus={bus} />
          ))}
        </div>
      )}
      {notDeparted.length > 0 && (
        <div className="bus-group">
          <div className="bus-group-header">🕐 まもなく出発</div>
          {notDeparted.map((bus) => (
            <BusCard key={`${bus.routeKey}-${bus.busId}-${bus.direction}`} bus={bus} />
          ))}
        </div>
      )}
    </div>
  );
}
