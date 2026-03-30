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
          {bus.isHolidayVariant && <span className="bus-holiday-tag">祝日便</span>}
        </div>
        <div className="bus-eta">
          <span className="eta-time">{formatETA(bus.etaMinutes)}</span>
          {bus.delayMinutes !== 0 && !bus.notDeparted && bus.stopsAway != null && bus.stopsAway <= 10 && (
            <span className={`eta-delay ${bus.delayMinutes > 0 ? 'late' : 'early'}`}>
              ({formatDelay(bus.delayMinutes)})
            </span>
          )}
        </div>
        {bus.notDeparted ? (
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
          {bus.scheduledTime && <span className="bus-scheduled">{bus.isHolidayVariant ? '定刻≈' : '定刻 '}{bus.scheduledTime}</span>}
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
