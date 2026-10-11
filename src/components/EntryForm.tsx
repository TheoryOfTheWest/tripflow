import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import {
  ArrowRight,
  Check,
  ImagePlus,
  LoaderCircle,
  MapPin,
  Navigation,
  Plus,
  TrainFront,
  StickyNote,
  X,
  Footprints,
} from 'lucide-react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { PhotoView } from './PhotoView';
import {
  modes,
  now,
  uuid,
  upsertEntry,
  transportSchema,
  type Entry,
  type Photo,
  type Place,
  type Transport,
  type TripDocument,
} from '../models';
import { localInput, sorted, toUtc, duration } from '../lib/time';
import { message } from '../lib/utils';
import { geoapify, roughWalk } from '../services/geoapify';
import { compressPhoto } from '../services/media';
import { putPhoto, deletePhotos, LOCAL_OWNER } from '../services/repository';
const MapDialog = lazy(() => import('./map/MapDialog'));
type Pending = { id: string; blob: Blob; caption: string };
function Preview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <img src={url} alt="待保存照片" />;
}
function OffsetChoice({
  local,
  zone,
  value,
  onChange,
}: {
  local: string;
  zone: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  const choices = DateTime.fromISO(local, { zone }).getPossibleOffsets();
  if (choices.length < 2) return null;
  return (
    <label className="notice">
      夏令时回拨：此时刻出现两次，请确认
      <select
        aria-label="UTC 偏移"
        required
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      >
        <option value="">选择 UTC 偏移</option>
        {choices.map((d) => (
          <option value={d.offset} key={d.offset}>
            {d.toFormat('ZZ')} · {d.toUTC().toFormat('HH:mm')} UTC
          </option>
        ))}
      </select>
    </label>
  );
}

export function EntryForm({
  doc,
  date,
  initial,
  onSave,
  onClose,
  onNotice,
  history = [],
}: {
  doc: TripDocument;
  date: string;
  initial?: Entry;
  onSave: (doc: TripDocument) => Promise<void>;
  onClose: () => void;
  onNotice: (text: string) => void;
  history?: TripDocument[];
}) {
  const previous = sorted(doc.entries)
    .filter(
      (e) => DateTime.fromISO(e.endAtUtc).setZone(doc.trip.defaultTimezone).toISODate() === date
    )
    .at(-1);
  const proposed = previous
    ? localInput(previous.endAtUtc, doc.trip.defaultTimezone)
    : `${date}T09:00`;
  const [type, setType] = useState<Entry['type']>(initial?.type ?? 'stay');
  const [title, setTitle] = useState(initial?.title || ''),
    [notes, setNotes] = useState(initial?.notes || ''),
    [activityType, setActivityType] = useState(initial?.activityType || '游览');
  const [start, setStart] = useState(
    initial ? localInput(initial.startAtUtc, initial.timezone) : proposed
  );
  const [end, setEnd] = useState(
    initial
      ? localInput(initial.endAtUtc, initial.endTimezone)
      : DateTime.fromISO(proposed).plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm")
  );
  const [startZone, setStartZone] = useState(initial?.timezone || doc.trip.defaultTimezone),
    [endZone, setEndZone] = useState(initial?.endTimezone || doc.trip.defaultTimezone);
  const [startOffset, setStartOffset] = useState<number | undefined>(
      initial ? DateTime.fromISO(initial.startAtUtc).setZone(initial.timezone).offset : undefined
    ),
    [endOffset, setEndOffset] = useState<number | undefined>(
      initial ? DateTime.fromISO(initial.endAtUtc).setZone(initial.endTimezone).offset : undefined
    );
  const [draftPlaces, setDraftPlaces] = useState<Place[]>([]),
    [picker, setPicker] = useState<'place' | 'origin' | 'destination'>();
  const [placeId, setPlaceId] = useState(initial?.placeId || '');
  const [originId, setOriginId] = useState(
      initial?.originPlaceId || previous?.destinationPlaceId || previous?.placeId || ''
    ),
    [destinationId, setDestinationId] = useState(initial?.destinationPlaceId || '');
  const [mode, setMode] = useState<Transport['mode']>(initial?.transport?.mode || 'walk');
  const [line, setLine] = useState(initial?.transport?.lineName || ''),
    [operator, setOperator] = useState(initial?.transport?.operatorName || ''),
    [transfer, setTransfer] = useState(initial?.transport?.transferNotes || '');
  const [estimate, setEstimate] = useState<Partial<Transport>>(initial?.transport || {}),
    [routeBusy, setRouteBusy] = useState(false),
    [routeNotice, setRouteNotice] = useState(''),
    [speed, setSpeed] = useState(initial?.transport?.walkingSpeedKmh || 4.5);
  const [photos, setPhotos] = useState(doc.photos.filter((p) => p.entryId === initial?.id));
  const [pending, setPending] = useState<Pending[]>([]),
    [photoBusy, setPhotoBusy] = useState(false);
  const stagedUploads = useRef(new Set<string>());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const allPlaces = [
    ...doc.places.filter((p) => !draftPlaces.some((d) => d.id === p.id)),
    ...draftPlaces,
  ];
  const find = (id: string) => allPlaces.find((p) => p.id === id);
  function invalidateEstimate() {
    setEstimate({});
    setRouteNotice('');
  }
  function choose(p: Place) {
    setDraftPlaces((v) => [...v.filter((x) => x.id !== p.id), p]);
    if (picker === 'place') setPlaceId(p.id);
    else {
      if (picker === 'origin') setOriginId(p.id);
      else setDestinationId(p.id);
      invalidateEstimate();
    }
  }
  async function calculateWalk() {
    if (!Number.isFinite(speed) || speed < 1 || speed > 10) {
      setRouteNotice('请设置 1–10 km/h 的有效步行速度');
      return;
    }
    const a = find(originId),
      b = find(destinationId);
    if (!a || !b) {
      setRouteNotice('请先选择起点与终点');
      return;
    }
    setRouteBusy(true);
    setRouteNotice('');
    try {
      setEstimate(await geoapify.walk(a, b));
      setRouteNotice('已获得 Geoapify 道路路线。预计时间与实际记录时间分别保存。');
    } catch (e) {
      setEstimate(roughWalk(a, b, speed));
      setRouteNotice(
        `${message(e)}。已使用直线距离 ÷ ${speed} km/h 粗略估算；未考虑道路、地形和绕行。`
      );
    } finally {
      setRouteBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    setPhotoBusy(true);
    setError('');
    try {
      if (files.length + pending.length + photos.length > 12)
        throw new Error('每条记录最多 12 张照片');
      const staged: Pending[] = [];
      for (const file of files)
        staged.push({ id: uuid(), blob: await compressPhoto(file), caption: '' });
      setPending((p) => [...p, ...staged]);
    } catch (e) {
      setError(message(e));
    } finally {
      setPhotoBusy(false);
    }
  }
  async function loadGPS(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2000000) throw new Error('GPS GeoJSON 不能超过 2 MB');
      const json = JSON.parse(await file.text());
      const geom = json.type === 'Feature' ? json.geometry : json;
      const routeGeometry = transportSchema.shape.routeGeometry.parse(
        geom.type === 'LineString'
          ? { type: 'MultiLineString', coordinates: [geom.coordinates] }
          : geom
      );
      setEstimate((v) => ({ ...v, routeGeometry, routeSource: 'gps' }));
      setRouteNotice('已载入用户 GPS 轨迹；请确认轨迹属于此路段。');
    } catch (e) {
      setError(message(e));
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const uploaded: Photo[] = [];
    let committed = false,
      saveAttempted = false;
    try {
      const startAtUtc = toUtc(start, startZone, startOffset),
        endAtUtc = type === 'moment' ? startAtUtc : toUtc(end, endZone, endOffset);
      const entry: Entry = {
        id: initial?.id || uuid(),
        ownerId: doc.trip.ownerId,
        tripId: doc.trip.id,
        type,
        title:
          title.trim() ||
          (type === 'transport'
            ? `${modes[mode]} · ${find(originId)?.name || '出发'} → ${find(destinationId)?.name || '到达'}`
            : find(placeId)?.name || '旅行随记'),
        startAtUtc,
        endAtUtc,
        timezone: startZone,
        endTimezone: type === 'moment' ? startZone : endZone,
        notes,
        activityType,
        updatedAt: now(),
        ...(type === 'transport'
          ? {
              originPlaceId: originId || undefined,
              destinationPlaceId: destinationId || undefined,
              transport: {
                mode,
                lineName: line,
                operatorName: operator,
                transferNotes: transfer,
                boardingStationId: originId || undefined,
                alightingStationId: destinationId || undefined,
                estimatedDistance: estimate.estimatedDistance,
                estimatedDuration: estimate.estimatedDuration,
                routeGeometry: estimate.routeGeometry,
                routeSource: estimate.routeSource || 'none',
                walkingSpeedKmh: estimate.walkingSpeedKmh,
                actualDuration: (Date.parse(endAtUtc) - Date.parse(startAtUtc)) / 1000,
              },
            }
          : { placeId: placeId || undefined }),
      };
      if (type === 'stay' && !placeId) throw new Error('请选择或手动创建一个地点');
      if (type === 'transport' && (!originId || !destinationId))
        throw new Error('请选择起点和终点，可用地图手动创建站点');
      const freshPhotos: Photo[] = pending.map((p, i) => ({
        id: p.id,
        tripId: doc.trip.id,
        ownerId: doc.trip.ownerId,
        entryId: entry.id,
        takenAt: startAtUtc,
        storagePath: `${doc.trip.ownerId}/${doc.trip.id}/${p.id}`,
        caption: p.caption,
        sortOrder: photos.length + i,
        mimeType: 'image/jpeg',
      }));
      const remainingPhotos = doc.photos.filter((p) => p.entryId !== initial?.id);
      const removed = doc.photos.filter(
        (p) => p.entryId === initial?.id && !photos.some((x) => x.id === p.id)
      );
      const coverPhotoId = removed.some((p) => p.id === doc.trip.coverPhotoId)
        ? undefined
        : doc.trip.coverPhotoId;
      const next = upsertEntry(
        {
          ...doc,
          trip: { ...doc.trip, coverPhotoId },
          photos: [...remainingPhotos, ...photos, ...freshPhotos],
        },
        entry,
        draftPlaces
      );
      for (let i = 0; i < pending.length; i++) {
        if (!stagedUploads.current.has(freshPhotos[i].id)) {
          await putPhoto(freshPhotos[i], pending[i].blob);
          stagedUploads.current.add(freshPhotos[i].id);
        }
        uploaded.push(freshPhotos[i]);
      }
      saveAttempted = true;
      await onSave(next);
      committed = true;
      const warning = await deletePhotos(removed);
      if (warning) onNotice(warning);
      onClose();
    } catch (e) {
      if (!committed && (!saveAttempted || doc.trip.ownerId === LOCAL_OWNER)) {
        await deletePhotos(uploaded).catch(() => {});
        uploaded.forEach((p) => stagedUploads.current.delete(p.id));
      }
      // A lost HTTP response may follow a committed database write. Preserve
      // cloud objects in that case, so committed metadata cannot lose photos.
      setError(
        message(e) +
          (!committed && saveAttempted && uploaded.length && doc.trip.ownerId !== LOCAL_OWNER
            ? '。已上传照片会保留，请刷新核对保存结果后重试。'
            : '')
      );
    } finally {
      setBusy(false);
    }
  }
  const locationButton = (
    kind: 'place' | 'origin' | 'destination',
    value: string,
    label: string
  ) => (
    <div className="location-control">
      <label>{label}</label>
      <div className="location-row">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => {
            if (kind === 'place') setPlaceId(e.target.value);
            else {
              if (kind === 'origin') setOriginId(e.target.value);
              else setDestinationId(e.target.value);
              invalidateEstimate();
            }
          }}
        >
          <option value="">从已保存地点选择</option>
          {allPlaces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={() => setPicker(kind)}>
          <MapPin size={16} />
          地图选点
        </Button>
      </div>
      {find(value) && (
        <p className="small muted">
          {find(value)!.address ||
            `${find(value)!.latitude.toFixed(5)}, ${find(value)!.longitude.toFixed(5)}`}
        </p>
      )}
    </div>
  );
  return (
    <>
      <Modal
        title={initial ? '编辑这段时光' : '记录下一段时光'}
        description="地点、路途，或一个值得留下的瞬间。"
        onClose={() => !busy && onClose()}
      >
        <form onSubmit={submit} className="form-body">
          <fieldset disabled={busy || routeBusy || photoBusy} className="form-fieldset">
            <div className="segmented">
              {(
                [
                  { key: 'stay', label: '地点停留', icon: MapPin },
                  { key: 'transport', label: '交通移动', icon: TrainFront },
                  { key: 'moment', label: '照片 / 备注', icon: StickyNote },
                ] as const
              ).map((t) => (
                <button
                  type="button"
                  key={t.key}
                  aria-pressed={type === t.key}
                  className={type === t.key ? 'active' : ''}
                  onClick={() => setType(t.key)}
                >
                  <t.icon size={16} />
                  {t.label}
                </button>
              ))}
            </div>
            <label>
              活动名称
              <input
                aria-label="活动名称"
                placeholder={
                  type === 'transport' ? '可留空，使用交通与站点名称' : '例如：在小巷里找一杯咖啡'
                }
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                {type === 'transport' ? '出发时间' : '开始时间'}
                <input
                  aria-label="开始时间"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setStartOffset(undefined);
                  }}
                />
              </label>
              {type !== 'moment' && (
                <label>
                  {type === 'transport' ? '到达时间' : '结束时间'}
                  <input
                    aria-label="结束时间"
                    type="datetime-local"
                    required
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setEndOffset(undefined);
                    }}
                  />
                </label>
              )}
              <label>
                开始时区
                <input
                  aria-label="开始时区"
                  required
                  list="timezones"
                  value={startZone}
                  onChange={(e) => {
                    setStartZone(e.target.value);
                    setStartOffset(undefined);
                  }}
                />
              </label>
              {type !== 'moment' && (
                <label>
                  结束时区
                  <input
                    aria-label="结束时区"
                    required
                    list="timezones"
                    value={endZone}
                    onChange={(e) => {
                      setEndZone(e.target.value);
                      setEndOffset(undefined);
                    }}
                  />
                </label>
              )}
            </div>
            <OffsetChoice
              local={start}
              zone={startZone}
              value={startOffset}
              onChange={setStartOffset}
            />
            {type !== 'moment' && (
              <OffsetChoice local={end} zone={endZone} value={endOffset} onChange={setEndOffset} />
            )}
            {type !== 'transport' ? (
              <>
                {locationButton(
                  'place',
                  placeId,
                  type === 'moment' ? '关联地点（可选）' : '活动地点'
                )}
                <label>
                  活动类型
                  <select value={activityType} onChange={(e) => setActivityType(e.target.value)}>
                    {['游览', '美食', '住宿', '购物', '休息', '其他'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  交通方式
                  <select
                    aria-label="交通方式"
                    value={mode}
                    onChange={(e) => {
                      setMode(e.target.value as Transport['mode']);
                      invalidateEstimate();
                    }}
                  >
                    {Object.entries(modes).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {locationButton(
                  'origin',
                  originId,
                  ['subway', 'rail', 'bus'].includes(mode) ? '上车站' : '起点'
                )}
                <div className="transfer-arrow">
                  <ArrowRight size={16} />
                </div>
                {locationButton(
                  'destination',
                  destinationId,
                  ['subway', 'rail', 'bus'].includes(mode) ? '下车站' : '终点'
                )}
                {['subway', 'rail', 'bus', 'ferry', 'plane', 'other'].includes(mode) && (
                  <>
                    <div className="form-grid">
                      <label>
                        线路 / 班次
                        <input
                          aria-label="线路名称"
                          list="line-history"
                          value={line}
                          onChange={(e) => setLine(e.target.value)}
                          placeholder="手动填写，可复用历史线路"
                        />
                      </label>
                      <label>
                        运营商（可选）
                        <input value={operator} onChange={(e) => setOperator(e.target.value)} />
                      </label>
                    </div>
                    <label>
                      换乘信息
                      <textarea
                        value={transfer}
                        onChange={(e) => setTransfer(e.target.value)}
                        placeholder="可将换乘拆成多个交通记录"
                      />
                    </label>
                  </>
                )}
                {mode === 'walk' && (
                  <div className="walk-panel">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <strong>
                          <Footprints size={16} />
                          步行路线估算
                        </strong>
                        <p className="small muted">确认起终点后主动计算，结果会缓存。</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={calculateWalk}
                        disabled={routeBusy}
                      >
                        {routeBusy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Navigation size={16} />
                        )}
                        计算步行
                      </Button>
                    </div>
                    <label>
                      粗略估算速度（km/h）
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="0.1"
                        value={speed}
                        onChange={(e) => {
                          setSpeed(Number(e.target.value));
                          invalidateEstimate();
                        }}
                      />
                    </label>
                    {estimate.estimatedDistance !== undefined && (
                      <p className="route-estimate">
                        {estimate.routeSource === 'straight-line' ? '直线粗估' : '预计步行'}{' '}
                        {(estimate.estimatedDistance / 1000).toFixed(2)} km ·{' '}
                        {duration(estimate.estimatedDuration || 0)}
                      </p>
                    )}
                    {routeNotice && (
                      <p role="status" className="small muted">
                        {routeNotice}
                      </p>
                    )}
                  </div>
                )}
                <label>
                  手动预计耗时（分钟，可选）
                  <input
                    aria-label="预计耗时"
                    type="number"
                    min="0"
                    step="1"
                    value={
                      estimate.estimatedDuration !== undefined
                        ? Math.round(estimate.estimatedDuration / 60)
                        : ''
                    }
                    onChange={(e) =>
                      setEstimate((v) => ({
                        ...v,
                        estimatedDuration:
                          e.target.value === '' ? undefined : Number(e.target.value) * 60,
                        routeSource: v.routeGeometry ? v.routeSource : 'manual',
                      }))
                    }
                  />
                </label>
                <details>
                  <summary className="small muted">导入此路段实际 GPS 轨迹（可选）</summary>
                  <input
                    aria-label="GPS 轨迹"
                    type="file"
                    accept=".geojson,.json"
                    onChange={(e) => void loadGPS(e.target.files?.[0])}
                  />
                  <p className="small muted">
                    支持 WGS84 GeoJSON LineString / MultiLineString，地图将标记为用户 GPS 轨迹。
                  </p>
                </details>
              </>
            )}
            <label>
              备注
              <textarea
                aria-label="记录备注"
                maxLength={10000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="天气、心情，或者偶然遇见的风景…"
              />
            </label>
            <div className="section-label">
              <span>
                照片 <span className="muted">{photos.length + pending.length} / 12</span>
              </span>
              <label className="upload-label">
                <ImagePlus size={16} />
                添加照片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    void upload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <p className="small muted">
              图片压缩至最长边 1800px，并移除 EXIF / GPS 元数据；保存记录时上传。
            </p>
            <div className="photo-edit-grid">
              {photos.map((p) => (
                <div key={p.id}>
                  <PhotoView photo={p} />
                  <button
                    type="button"
                    className="remove-photo"
                    aria-label="删除照片"
                    onClick={() => setPhotos((v) => v.filter((x) => x.id !== p.id))}
                  >
                    <X size={14} />
                  </button>
                  <input
                    aria-label="照片说明"
                    placeholder="照片说明"
                    maxLength={1000}
                    value={p.caption}
                    onChange={(e) =>
                      setPhotos((v) =>
                        v.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x))
                      )
                    }
                  />
                </div>
              ))}
              {pending.map((p) => (
                <div key={p.id}>
                  <Preview blob={p.blob} />
                  <button
                    type="button"
                    className="remove-photo"
                    aria-label="移除待上传照片"
                    onClick={() => setPending((v) => v.filter((x) => x.id !== p.id))}
                  >
                    <X size={14} />
                  </button>
                  <input
                    aria-label="新照片说明"
                    placeholder="照片说明"
                    maxLength={1000}
                    value={p.caption}
                    onChange={(e) =>
                      setPending((v) =>
                        v.map((x) => (x.id === p.id ? { ...x, caption: e.target.value } : x))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
          {photoBusy && (
            <p className="small muted" role="status">
              正在压缩照片…
            </p>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <footer className="form-footer">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy || photoBusy || routeBusy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存记录
            </Button>
          </footer>
        </form>
      </Modal>
      {picker && (
        <Suspense fallback={<div className="loading-overlay">地图加载中…</div>}>
          <MapDialog
            doc={{ ...doc, places: allPlaces }}
            historyPlaces={history.flatMap((d) => d.places)}
            defaultCategory={
              type === 'transport' && ['subway', 'rail', 'bus'].includes(mode) ? 'station' : 'place'
            }
            onClose={() => setPicker(undefined)}
            onSelect={choose}
          />
        </Suspense>
      )}
      <datalist id="line-history">
        {[
          ...new Set(
            [doc, ...history]
              .flatMap((d) => d.entries.map((e) => e.transport?.lineName))
              .filter(Boolean)
          ),
        ].map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}
