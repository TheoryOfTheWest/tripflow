import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, MapPin, Check, Navigation, LoaderCircle } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { geoapify, geoKey, type PlaceResult } from '../../services/geoapify';
import { placeSchema, uuid, type Place, type TripDocument } from '../../models';
import { routePoints } from '../../lib/route';
import { clock } from '../../lib/time';
import { message } from '../../lib/utils';

type Props = {
  doc: TripDocument;
  onClose: () => void;
  onSelect?: (place: Place) => void;
  focus?: Place;
  date?: string;
  onEntry?: (id: string) => void;
  historyPlaces?: Place[];
  defaultCategory?: 'place' | 'station';
};
function View({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1)
      map.fitBounds(latLngBounds(points), { padding: [45, 45], maxZoom: 16 });
  }, [map, JSON.stringify(points)]);
  return null;
}
function Pick({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
const pin = (n: number, station = false) =>
  divIcon({
    className: 'number-marker',
    html: `<span class="${station ? 'station' : ''}">${n}</span>`,
    iconSize: [34, 40],
    iconAnchor: [17, 36],
  });

export default function MapDialog({
  doc,
  onClose,
  onSelect,
  focus,
  date,
  onEntry,
  historyPlaces = [],
  defaultCategory = 'place',
}: Props) {
  const picking = !!onSelect;
  const [query, setQuery] = useState(''),
    [lang, setLang] = useState('zh');
  const [results, setResults] = useState<PlaceResult[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [tileError, setTileError] = useState(false);
  const [name, setName] = useState(focus?.name || ''),
    [address, setAddress] = useState(focus?.address || '');
  const [lat, setLat] = useState(focus ? String(focus.latitude) : ''),
    [lon, setLon] = useState(focus ? String(focus.longitude) : '');
  const [category, setCategory] = useState<'place' | 'station'>(focus?.category || defaultCategory);
  const [chosen, setChosen] = useState<PlaceResult | Place>();
  useEffect(() => {
    if (!picking || query.trim().length < 2 || !geoKey) {
      setResults([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setBusy(true);
      setError('');
      geoapify
        .search(
          query.trim(),
          lang,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        )
        .then((v) => {
          if (!controller.signal.aborted) setResults(v);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(message(e));
            setResults([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 450);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, lang, picking]);
  const select = (p: PlaceResult | Place) => {
    setChosen(p);
    setName(p.name);
    setAddress(p.address);
    setLat(String(p.latitude));
    setLon(String(p.longitude));
    if ('category' in p) setCategory(p.category);
  };
  const points = useMemo(
    () =>
      focus
        ? [{ place: focus, entry: undefined, time: '', station: focus.category === 'station' }]
        : routePoints(doc, date),
    [doc, focus, date]
  );
  const coordsValid =
    lat.trim() !== '' &&
    lon.trim() !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lon)) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lon)) <= 180;
  const viewPoints: [number, number][] = picking
    ? coordsValid
      ? [[Number(lat), Number(lon)]]
      : []
    : points.map((p) => [p.place.latitude, p.place.longitude]);
  const recent = [
    ...new Map(
      [...historyPlaces.filter((p) => p.ownerId === doc.trip.ownerId), ...doc.places].map((p) => [
        `${p.name}:${p.latitude}:${p.longitude}`,
        p,
      ])
    ).values(),
  ]
    .filter((p) => !query || `${p.name} ${p.address}`.toLowerCase().includes(query.toLowerCase()))
    .slice(-8)
    .reverse();
  function confirm() {
    try {
      if (!coordsValid) throw new Error('请填写有效的纬度和经度');
      const existing = doc.places.find(
        (p) =>
          p.name === name.trim() &&
          Math.abs(p.latitude - Number(lat)) < 0.000001 &&
          Math.abs(p.longitude - Number(lon)) < 0.000001
      );
      const p = placeSchema.parse({
        id: existing?.id ?? uuid(),
        ownerId: doc.trip.ownerId,
        tripId: doc.trip.id,
        name,
        address,
        latitude: Number(lat),
        longitude: Number(lon),
        category,
        providerPlaceId:
          chosen && chosen.latitude === Number(lat) && chosen.longitude === Number(lon)
            ? chosen.providerPlaceId
            : undefined,
      });
      onSelect?.(p);
      onClose();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Modal
      wide
      title={
        picking ? '把下一站，放进旅程' : focus ? focus.name : date ? '今日路线' : '整段旅行地图'
      }
      description={
        picking
          ? '搜索地点、复用收藏，或点击地图选择坐标'
          : '地点按记录时间排序；虚线只表示移动顺序'
      }
      onClose={onClose}
    >
      {picking && (
        <div className="map-search">
          <Search size={18} />
          <input
            aria-label="搜索地点"
            placeholder="搜索城市、景点、车站…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="搜索语言" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
          {busy && <LoaderCircle className="spin" size={18} />}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {picking && (
        <div className="place-results">
          {results.map((p, i) => (
            <button key={i} onClick={() => select(p)}>
              <MapPin size={16} />
              <span>
                <strong>{p.name}</strong>
                <small>{p.address}</small>
              </span>
              <Navigation size={14} />
            </button>
          ))}
          {!busy && query.length > 1 && geoKey && !results.length && (
            <p className="muted small">没有搜索结果？可在下方手动填写。</p>
          )}
          {recent.length > 0 && (
            <>
              <p className="eyebrow">已保存地点 · 可重复使用</p>
              {recent.map((p) => (
                <button key={p.id} onClick={() => select(p)}>
                  <MapPin size={16} />
                  <span>
                    {p.name}
                    <small>{p.address}</small>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {!geoKey && (
        <p className="notice">
          未配置 Geoapify，底图与在线搜索未启用。仍可缩放、点击坐标网格或手动输入经纬度。
        </p>
      )}
      {tileError && (
        <p className="notice">
          底图加载失败。地点与路线仍可查看，请检查网络、Key 的来源限制与配额。
        </p>
      )}
      <div className="map-frame">
        <MapContainer center={[35.68, 139.76]} zoom={3} scrollWheelZoom className="leaflet-map">
          {geoKey && (
            <TileLayer
              url={`https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(geoKey)}`}
              attribution={
                'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
              }
              eventHandlers={{ tileerror: () => setTileError(true) }}
            />
          )}
          <View points={viewPoints} />
          {picking ? (
            <>
              <Pick
                onPick={(a, b) => {
                  setLat(a.toFixed(6));
                  setLon(b.toFixed(6));
                  setChosen(undefined);
                }}
              />
              {coordsValid && (
                <Marker position={[Number(lat), Number(lon)]} icon={pin(1)}>
                  <Popup>{name || '已选坐标'}</Popup>
                </Marker>
              )}
            </>
          ) : (
            <>
              {points.map((p, i) => (
                <Marker
                  key={`${p.place.id}-${i}`}
                  position={[p.place.latitude, p.place.longitude]}
                  icon={pin(i + 1, p.station)}
                >
                  <Popup>
                    <strong>{p.place.name}</strong>
                    <p>{p.time && clock(p.time, doc.trip.defaultTimezone)}</p>
                    {p.entry && (
                      <button
                        onClick={() => {
                          onClose();
                          onEntry?.(p.entry!.id);
                        }}
                      >
                        返回对应时间线
                      </button>
                    )}
                  </Popup>
                </Marker>
              ))}
              {points.length > 1 && (
                <Polyline
                  positions={points.map((p) => [p.place.latitude, p.place.longitude])}
                  pathOptions={{ color: '#988369', weight: 3, dashArray: '6 9', opacity: 0.8 }}
                />
              )}
              {(date
                ? doc.entries.filter((e) => routePoints(doc, date).some((p) => p.entry.id === e.id))
                : doc.entries
              )
                .filter((e) => e.transport?.routeGeometry)
                .map((e) => (
                  <Polyline
                    key={e.id}
                    positions={e.transport!.routeGeometry!.coordinates.map((line) =>
                      line.map(([lng, latitude]) => [latitude, lng] as [number, number])
                    )}
                    pathOptions={{
                      color: e.transport!.routeSource === 'gps' ? '#9874a6' : '#2a7766',
                      weight: 5,
                    }}
                  >
                    <Popup>
                      {e.title} ·{' '}
                      {e.transport!.routeSource === 'gps' ? '用户 GPS 轨迹' : 'Geoapify 道路路线'}
                      （跨天记录显示完整路段）
                    </Popup>
                  </Polyline>
                ))}
            </>
          )}
        </MapContainer>
        {!picking && !points.length && <div className="map-empty">这一天还没有带坐标的地点</div>}
      </div>
      {picking ? (
        <div className="map-manual">
          <div className="form-grid">
            <label className="span-2">
              地点名称
              <input
                aria-label="地点名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：京都站"
                maxLength={300}
              />
            </label>
            <label className="span-2">
              地址
              <input
                aria-label="地点地址"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              纬度
              <input
                aria-label="纬度"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </label>
            <label>
              经度
              <input
                aria-label="经度"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
              />
            </label>
            <label>
              地点类型
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as 'place' | 'station')}
              >
                <option value="place">活动地点</option>
                <option value="station">交通站点</option>
              </select>
            </label>
          </div>
          <footer className="form-footer">
            <span className="muted small">保存精确坐标，可随时重复访问</span>
            <Button onClick={confirm}>
              <Check size={17} />
              确认地点
            </Button>
          </footer>
        </div>
      ) : (
        <div className="map-legend">
          <span>
            <i className="legend-line" />
            道路路线
          </span>
          <span>
            <i className="legend-line gps" />
            用户 GPS 轨迹
          </span>
          <span>
            <i className="legend-line dashed" />
            顺序示意线（非真实轨道 / 航线）
          </span>
          <span>方形标记为交通站点</span>
        </div>
      )}
    </Modal>
  );
}
