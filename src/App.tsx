import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Compass,
  Download,
  Ellipsis,
  FileText,
  Footprints,
  Globe2,
  Image,
  Leaf,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Route as RouteIcon,
  Search,
  StickyNote,
  TrainFront,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Modal } from './components/ui/modal';
import { Cover } from './components/Cover';
import { TripForm } from './components/TripForm';
import { EntryForm } from './components/EntryForm';
import { PhotoView } from './components/PhotoView';
import { AuthDialog } from './components/AuthDialog';
import { BackupDialog } from './components/BackupDialog';
import { SaveTripDialog } from './components/SaveTripDialog';
import {
  LOCAL_OWNER,
  supabase,
  clearAccountCache,
  putPhoto,
  deletePhotos,
} from './services/repository';
import { download } from './services/backup';
import { reportHtml } from './services/report';
import { useTrips } from './hooks/useTrips';
import {
  modes,
  removeEntry,
  type Entry,
  type Place,
  type TripDocument,
  type Photo,
} from './models';
import {
  actualSeconds,
  clock,
  dailyEntries,
  dates,
  duration,
  sorted,
  timelineRows,
  totalDuration,
} from './lib/time';
import { sampleDocument, samplePhoto } from './lib/fixture';
import { message } from './lib/utils';
const MapDialog = lazy(() => import('./components/map/MapDialog'));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <Compass size={36} />
        <h2>页面暂时遇到问题</h2>
        <p>已保存的数据仍在原处，可重新载入页面。</p>
        <Button onClick={() => window.location.reload()}>重新载入</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
type Store = ReturnType<typeof useTrips>;
function Home({
  store,
  ownerId,
  readonly,
  onNew,
  onImport,
  onNotice,
}: {
  store: Store;
  ownerId: string;
  readonly: boolean;
  onNew: () => void;
  onImport: () => void;
  onNotice: (s: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [sampleBusy, setSampleBusy] = useState(false);
  const navigate = useNavigate();
  const docs = store.docs
    .filter((d) => `${d.trip.title} ${d.trip.notes}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.trip.startDate.localeCompare(a.trip.startDate));
  async function loadSample() {
    setSampleBusy(true);
    let staged: Photo | undefined;
    try {
      const doc = sampleDocument(ownerId),
        generated = await samplePhoto(doc);
      staged = generated.photo;
      await putPhoto(generated.photo, generated.blob);
      doc.photos.push(generated.photo);
      const saved = await store.save(doc);
      navigate(`/trip/${saved.trip.id}?date=${saved.trip.startDate}`);
      onNotice('已载入虚构三日旅行，含测试插画；未调用在线路线 API。');
    } catch (e) {
      if (staged) await deletePhotos([staged]);
      onNotice(message(e));
    } finally {
      setSampleBusy(false);
    }
  }
  return (
    <main className="home-page page-width">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-line" /> A LITTLE FURTHER, A LITTLE SLOWER
          </p>
          <h1>
            沿着时间，
            <br />
            收藏<span>旅行。</span>
          </h1>
          <p className="hero-description">
            把经过的地方、路上的片刻，
            <br />
            串成只属于你的旅行时间线。
          </p>
          <Button onClick={onNew} disabled={readonly}>
            <Plus size={18} />
            开启一段旅程
            <ArrowRight size={17} />
          </Button>
          <div className="hero-footnote">
            <Leaf size={14} />
            慢慢走，也好好记住。
          </div>
        </div>
        <div className="hero-landscape">
          <Cover hero theme="mountain" />
          <div className="postcard-label">
            <span>PLACES WE GO</span>
            <strong>每一步，都有故事。</strong>
            <span className="postcard-coordinate">35° 00′ N &nbsp; 135° 46′ E · 插画</span>
          </div>
          <div className="postcard-stamp">
            TF
            <br />
            <small>TRAVEL JOURNAL</small>
          </div>
        </div>
      </section>
      <section className="trips-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR JOURNEYS</p>
            <h2>
              我的旅行 <span className="count-badge">{store.docs.length}</span>
            </h2>
          </div>
          <div className="collection-tools">
            <Button variant="outline" onClick={onImport} disabled={readonly}>
              <ArrowDownToLine size={17} />
              导入旅程
            </Button>
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="搜索旅行"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="寻找一段旅程"
              />
            </div>
            <Button variant="outline" onClick={onNew} disabled={readonly}>
              <Plus size={17} />
              <span>新建旅行</span>
            </Button>
          </div>
        </div>
        {store.loading ? (
          <div className="loading-card">
            <LoaderCircle className="spin" />
            正在打开你的旅行手记…
          </div>
        ) : docs.length ? (
          <div className="trip-grid">
            {docs.map((doc) => {
              const t = doc.trip,
                count = dates(t.startDate, t.endDate).length;
              return (
                <Link className="trip-card" to={`/trip/${t.id}?date=${t.startDate}`} key={t.id}>
                  <div className="trip-cover">
                    <Cover theme={t.cover} doc={doc} />
                    <span className="trip-days">{count} DAYS</span>
                    <span className="trip-cover-arrow">
                      <ArrowRight size={20} />
                    </span>
                  </div>
                  <div className="trip-card-body">
                    <div className="trip-meta">
                      <CalendarDays size={13} />
                      {t.startDate.replaceAll('-', '.')} — {t.endDate.slice(5).replace('-', '.')}
                    </div>
                    <h3>{t.title}</h3>
                    <p>{t.notes || '沿着时间，留下一路的小事。'}</p>
                    <div className="trip-card-footer">
                      <span>
                        <MapPin size={14} />
                        {doc.places.length} 个地点
                      </span>
                      <span>
                        {doc.entries.length} 段记录
                        <ArrowRight size={14} />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-home">
            <div className="empty-compass">
              <Compass size={36} />
            </div>
            <h3>{query ? '还没找到这段旅程' : '你的下一段故事，从这里开始'}</h3>
            <p>
              {query ? '试试其他旅行名称或备注关键词。' : '新建旅行，选一个日子，记录第一个地点。'}
            </p>
            <Button
              variant="outline"
              onClick={query ? () => setQuery('') : onNew}
              disabled={!query && readonly}
            >
              {query ? '清除搜索' : '创建我的第一段旅行'}
              <ArrowRight size={16} />
            </Button>
            {ownerId === LOCAL_OWNER && !query && (
              <button
                className="text-button sample-link"
                onClick={loadSample}
                disabled={sampleBusy || readonly}
              >
                {sampleBusy ? '正在准备…' : '先看看虚构三日示例'}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </section>
      <footer className="page-footer">
        <span className="brand-word">
          TripFlow<span>®</span>
        </span>
        <span>走过的路，值得被记住。</span>
        <span>PERSONAL TRAVEL JOURNAL</span>
      </footer>
    </main>
  );
}

function TripPage({
  store,
  readonly,
  onNotice,
}: {
  store: Store;
  readonly: boolean;
  onNotice: (s: string) => void;
}) {
  const { id } = useParams(),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const doc = store.docs.find((d) => d.trip.id === id);
  const [editTrip, setEditTrip] = useState(false),
    [editEntry, setEditEntry] = useState<Entry | 'new'>();
  const [map, setMap] = useState<{ focus?: Place; all?: boolean }>(),
    [photo, setPhoto] = useState<Photo>();
  const [confirm, setConfirm] = useState<Entry | 'trip'>(),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(''),
    [overview, setOverview] = useState(false),
    [saveTrip, setSaveTrip] = useState(false);
  if (store.loading)
    return (
      <main className="page-width loading-card">
        <LoaderCircle className="spin" />
        正在加载时间线…
      </main>
    );
  if (!doc)
    return (
      <main className="page-width empty-home">
        <Compass size={34} />
        <h2>这段旅行暂不可用</h2>
        <p>请确认账户，或返回旅行列表刷新。</p>
        <Link className="btn btn-outline" to="/">
          返回我的旅行
        </Link>
      </main>
    );
  const t = doc.trip,
    allDates = dates(t.startDate, t.endDate),
    date = allDates.includes(params.get('date') || '') ? params.get('date')! : t.startDate;
  const index = allDates.indexOf(date),
    items = timelineRows(doc.entries, date, t.defaultTimezone),
    todayEntries = items.map((i) => i.entry);
  const prevDate = allDates[index - 1],
    nextDate = allDates[index + 1];
  const prevEntry = prevDate
    ? dailyEntries(doc.entries, prevDate, t.defaultTimezone).at(-1)?.entry
    : undefined;
  const nextEntry = nextDate
    ? dailyEntries(doc.entries, nextDate, t.defaultTimezone)[0]?.entry
    : undefined;
  const place = (ref?: string) => doc.places.find((p) => p.id === ref);
  const changeDate = (d?: string) => {
    if (d) {
      setParams({ date: d });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const save = async (d: TripDocument) => {
    await store.save(d);
    onNotice(t.ownerId === LOCAL_OWNER ? '已保存在此浏览器 · 未上传云端' : '已保存到云端');
  };
  async function remove() {
    setDeleting(true);
    setDeleteError('');
    try {
      if (confirm === 'trip') {
        const warning = await store.remove(doc!);
        navigate('/');
        onNotice(warning || '旅行已删除');
      } else if (confirm) {
        const removedPhotos = doc!.photos.filter((p) => p.entryId === confirm.id);
        await save(removeEntry(doc!, confirm.id));
        const warning = await deletePhotos(removedPhotos);
        if (warning) onNotice(warning);
      }
      setConfirm(undefined);
    } catch (e) {
      setDeleteError(message(e));
    } finally {
      setDeleting(false);
    }
  }
  function jump(entryId: string) {
    const e = doc!.entries.find((e) => e.id === entryId);
    if (!e) return;
    const d = DateTime.fromISO(e.startAtUtc).setZone(t.defaultTimezone).toISODate()!;
    setParams({ date: allDates.includes(d) ? d : date });
    setTimeout(
      () =>
        document
          .getElementById(`entry-${entryId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      100
    );
  }
  const transportSeconds = items
    .filter((i) => i.entry.type === 'transport')
    .reduce((sum, i) => sum + (i.end - i.start) / 1000, 0);
  return (
    <main className="trip-page page-width">
      <div className="breadcrumbs">
        <Link to="/">
          <ArrowLeft size={15} />
          我的旅行
        </Link>
        <span>/</span>
        <span>{t.title}</span>
      </div>
      <section className="trip-heading">
        <div>
          <p className="eyebrow">YOUR TRAVEL JOURNAL</p>
          <h1>{t.title}</h1>
          <div className="trip-subtitle">
            <span>
              <CalendarDays size={15} />
              {t.startDate} — {t.endDate}
            </span>
            <span>
              <Globe2 size={15} />
              {t.defaultTimezone}
            </span>
            <span>{allDates.length} 天的故事</span>
          </div>
        </div>
        <div className="trip-heading-actions">
          <Button size="sm" onClick={() => setSaveTrip(true)}>
            <Download size={15} />
            保存旅程到电脑
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOverview(true)}>
            <FileText size={15} />
            旅行概览
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="编辑旅行"
            disabled={readonly}
            onClick={() => setEditTrip(true)}
          >
            <Pencil size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除旅行"
            disabled={readonly}
            onClick={() => {
              setConfirm('trip');
              setDeleteError('');
            }}
          >
            <Trash2 size={17} />
          </Button>
        </div>
      </section>
      {t.notes && <p className="trip-description">{t.notes}</p>}
      <div className="day-navigation">
        <div className="day-tabs" role="tablist" aria-label="旅行日期">
          {allDates.map((d, i) => (
            <button
              role="tab"
              aria-selected={d === date}
              key={d}
              className={d === date ? 'active' : ''}
              onClick={() => changeDate(d)}
            >
              <span>DAY {String(i + 1).padStart(2, '0')}</span>
              <strong>{DateTime.fromISO(d).toFormat('MM.dd')}</strong>
              <small>{DateTime.fromISO(d).setLocale('zh-CN').toFormat('ccc')}</small>
            </button>
          ))}
        </div>
        <Button className="day-route-button" variant="outline" onClick={() => setMap({})}>
          <RouteIcon size={17} />
          查看今日路线
        </Button>
      </div>
      <section className="daily-content">
        <header className="daily-heading">
          <div>
            <div className="eyebrow">
              DAY {String(index + 1).padStart(2, '0')} <span className="tiny-line" />
            </div>
            <h2>
              {DateTime.fromISO(date).setLocale('zh-CN').toFormat('M 月 d 日')}
              <span>{DateTime.fromISO(date).setLocale('zh-CN').toFormat('cccc')}</span>
            </h2>
          </div>
          <div className="date-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label="上一天"
              disabled={!prevDate}
              onClick={() => changeDate(prevDate)}
            >
              <ChevronLeft size={19} />
            </Button>
            <label className="date-picker-label">
              <CalendarDays size={16} />
              <input
                aria-label="选择日期"
                type="date"
                min={t.startDate}
                max={t.endDate}
                value={date}
                onChange={(e) => changeDate(e.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label="下一天"
              disabled={!nextDate}
              onClick={() => changeDate(nextDate)}
            >
              <ChevronRight size={19} />
            </Button>
          </div>
        </header>
        <div className="daily-stats">
          <span>
            <MapPin size={16} />
            <strong>
              {
                new Set(
                  todayEntries
                    .flatMap((e) => [e.placeId, e.originPlaceId, e.destinationPlaceId])
                    .filter(Boolean)
                ).size
              }
            </strong>
            个地点
          </span>
          <span>
            <StickyNote size={16} />
            <strong>{todayEntries.length}</strong>段记录
          </span>
          <span>
            <Navigation size={16} />
            <strong>{duration(transportSeconds)}</strong>在路上
          </span>
          <span>
            <Image size={16} />
            <strong>
              {doc.photos.filter((p) => todayEntries.some((e) => e.id === p.entryId)).length}
            </strong>
            张照片
          </span>
        </div>
        {prevEntry && (
          <button className="day-connection" onClick={() => changeDate(prevDate)}>
            <ArrowLeft size={14} />
            <span>前一天的最后一站 · {prevEntry.title}</span>
            <span>
              {DateTime.fromISO(prevEntry.endAtUtc)
                .setZone(t.defaultTimezone)
                .toFormat('MM.dd HH:mm')}
            </span>
          </button>
        )}
        <div className="timeline">
          {items.length ? (
            items.map((item) => {
              const e = item.entry,
                at = place(e.placeId),
                from = place(e.originPlaceId),
                to = place(e.destinationPlaceId),
                pics = doc.photos
                  .filter((p) => p.entryId === e.id)
                  .sort((a, b) => a.sortOrder - b.sortOrder);
              return (
                <div key={e.id}>
                  {item.gap && (
                    <div className="timeline-gap">
                      <span>{duration((item.gap.end - item.gap.start) / 1000)}</span>
                      <span>未记录时段</span>
                      <button
                        disabled={readonly}
                        onClick={() => setEditEntry('new')}
                        aria-label="在空白时段添加记录"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                  <article id={`entry-${e.id}`} className={`timeline-item ${e.type}`}>
                    <aside className="timeline-time">
                      <strong>{clock(item.start, t.defaultTimezone)}</strong>
                      <span>
                        {item.end ===
                        DateTime.fromISO(date, { zone: t.defaultTimezone })
                          .plus({ days: 1 })
                          .toMillis()
                          ? '24:00'
                          : clock(item.end, t.defaultTimezone)}
                      </span>
                      <small>
                        {e.type === 'moment' ? '瞬间' : duration((item.end - item.start) / 1000)}
                      </small>
                    </aside>
                    <div className="timeline-dot">
                      {e.type === 'transport' ? (
                        e.transport?.mode === 'walk' ? (
                          <Footprints size={15} />
                        ) : (
                          <TrainFront size={15} />
                        )
                      ) : e.type === 'moment' ? (
                        <Image size={15} />
                      ) : (
                        <MapPin size={15} />
                      )}
                    </div>
                    <div className="entry-card">
                      <div className="entry-topline">
                        <span className={`entry-type ${e.type}`}>
                          {e.type === 'transport'
                            ? modes[e.transport!.mode]
                            : e.type === 'moment'
                              ? '旅行随记'
                              : e.activityType}
                        </span>
                        <div className="entry-actions">
                          {(at || from) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`在地图查看${at?.name || from?.name}`}
                              onClick={() => setMap({ focus: at || from })}
                            >
                              <MapPin size={16} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`编辑${e.title}`}
                            disabled={readonly}
                            onClick={() => setEditEntry(e)}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除${e.title}`}
                            disabled={readonly}
                            onClick={() => {
                              setConfirm(e);
                              setDeleteError('');
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </div>
                      <h3>{e.title}</h3>
                      {e.type === 'transport' ? (
                        <>
                          <div className="transport-stations">
                            <button onClick={() => from && setMap({ focus: from })}>
                              {from?.name || '未指定起点'}
                            </button>
                            <ArrowRight size={14} />
                            <button onClick={() => to && setMap({ focus: to })}>
                              {to?.name || '未指定终点'}
                            </button>
                          </div>
                          {e.transport!.lineName && (
                            <p className="line-label">
                              <TrainFront size={13} />
                              {e.transport!.operatorName} {e.transport!.lineName}
                            </p>
                          )}
                          {e.transport!.transferNotes && (
                            <p className="small muted">换乘：{e.transport!.transferNotes}</p>
                          )}
                          {e.transport!.estimatedDuration !== undefined && (
                            <p className="estimate-line">
                              {e.transport!.routeSource === 'straight-line'
                                ? '直线粗估（精度有限）'
                                : e.transport!.routeSource === 'geoapify'
                                  ? '道路路线预计'
                                  : '手动预计'}{' '}
                              {e.transport!.estimatedDistance !== undefined &&
                                `${(e.transport!.estimatedDistance / 1000).toFixed(2)} km · `}
                              {duration(e.transport!.estimatedDuration)}
                              <span>实际记录 {duration(actualSeconds(e))}</span>
                            </p>
                          )}
                        </>
                      ) : (
                        at && (
                          <button className="entry-place" onClick={() => setMap({ focus: at })}>
                            <MapPin size={14} />
                            {at.name}
                            <ArrowRight size={13} />
                          </button>
                        )
                      )}
                      {(e.timezone !== t.defaultTimezone ||
                        e.endTimezone !== t.defaultTimezone) && (
                        <p className="timezone-detail">
                          当地时间{' '}
                          {DateTime.fromISO(e.startAtUtc)
                            .setZone(e.timezone)
                            .toFormat('MM.dd HH:mm')}
                          （{e.timezone}）→{' '}
                          {DateTime.fromISO(e.endAtUtc)
                            .setZone(e.endTimezone)
                            .toFormat('MM.dd HH:mm')}
                          （{e.endTimezone}）
                        </p>
                      )}
                      {e.notes && <p className="entry-notes">{e.notes}</p>}
                      {(item.fromPrevious || item.toNext) && (
                        <p className="cross-day">
                          <CalendarDays size={14} />
                          {item.fromPrevious ? '承接前一天' : ''}
                          {item.fromPrevious && item.toNext ? ' · ' : ''}
                          {item.toNext ? '延续至后一天' : ''} · 全程 {duration(actualSeconds(e))}
                        </p>
                      )}
                      {item.overlap && (
                        <p className="overlap-warning">
                          <TriangleAlert size={13} />
                          与其他记录时间重叠，已保留
                        </p>
                      )}
                      {pics.length > 0 && (
                        <details className="entry-photos" open>
                          <summary>
                            <Image size={14} />
                            {pics.length} 张照片
                          </summary>
                          <div className="photo-strip">
                            {pics.map((p) => (
                              <PhotoView key={p.id} photo={p} onClick={() => setPhoto(p)} />
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </article>
                </div>
              );
            })
          ) : (
            <div className="empty-day">
              <div className="empty-compass">
                <MapPin size={30} />
              </div>
              <h3>这一天，还等着你的故事</h3>
              <p>从第一个地点开始，也可以先记下一段路途或心情。</p>
              <Button onClick={() => setEditEntry('new')} disabled={readonly}>
                <Plus size={17} />
                添加第一条记录
              </Button>
            </div>
          )}
        </div>
        {items.length > 0 && (
          <button className="add-timeline" disabled={readonly} onClick={() => setEditEntry('new')}>
            <span>
              <Plus size={19} />
            </span>
            记录下一段时光<small>地点、路途，或一个瞬间</small>
          </button>
        )}
        {nextEntry && (
          <button className="day-connection next" onClick={() => changeDate(nextDate)}>
            <span>下一天的第一站 · {nextEntry.title}</span>
            <span>
              {DateTime.fromISO(nextEntry.startAtUtc)
                .setZone(t.defaultTimezone)
                .toFormat('MM.dd HH:mm')}
            </span>
            <ArrowRight size={14} />
          </button>
        )}
        <footer className="daily-footer">
          <span>每一段留白，也是旅程的一部分。</span>
          <Button variant="ghost" disabled={!nextDate} onClick={() => changeDate(nextDate)}>
            下一天
            <ArrowRight size={16} />
          </Button>
        </footer>
      </section>
      {saveTrip && <SaveTripDialog doc={doc} onClose={() => setSaveTrip(false)} />}
      {editTrip && (
        <TripForm doc={doc} ownerId={t.ownerId} onClose={() => setEditTrip(false)} onSave={save} />
      )}
      {editEntry && (
        <EntryForm
          doc={doc}
          date={date}
          initial={editEntry === 'new' ? undefined : editEntry}
          onClose={() => setEditEntry(undefined)}
          onSave={save}
          onNotice={onNotice}
          history={store.docs}
        />
      )}
      {map && (
        <Suspense
          fallback={
            <div className="loading-overlay">
              <LoaderCircle className="spin" />
              地图加载中…
            </div>
          }
        >
          <MapDialog
            doc={doc}
            date={map.all ? undefined : date}
            focus={map.focus}
            onClose={() => setMap(undefined)}
            onEntry={jump}
          />
        </Suspense>
      )}
      {photo && (
        <Modal wide title={photo.caption || '旅途照片'} onClose={() => setPhoto(undefined)}>
          <div className="photo-viewer">
            <PhotoView photo={photo} large />
            <p>{photo.caption}</p>
            <small className="muted">
              {DateTime.fromISO(photo.takenAt)
                .setZone(t.defaultTimezone)
                .toFormat('yyyy.MM.dd HH:mm')}
            </small>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm === 'trip' ? '删除这段旅行？' : '删除这条记录？'}
          description="删除后无法直接撤销，建议先导出备份。相关照片也会删除。"
          onClose={() => !deleting && setConfirm(undefined)}
        >
          <div className="form-body">
            <p>{confirm === 'trip' ? t.title : confirm.title}</p>
            {deleteError && (
              <p className="notice error" role="alert">
                {deleteError}
              </p>
            )}
            <footer className="form-footer">
              <Button variant="outline" disabled={deleting} onClick={() => setConfirm(undefined)}>
                保留
              </Button>
              <Button variant="destructive" disabled={deleting} onClick={remove}>
                {deleting ? '正在删除…' : '确认删除'}
              </Button>
            </footer>
          </div>
        </Modal>
      )}
      {overview && (
        <Modal
          wide
          title="旅行概览"
          description="完整记录按实际时间排列，跨天记录只统计一次。"
          onClose={() => setOverview(false)}
        >
          <div className="form-body">
            <div className="overview-actions">
              <Button
                variant="outline"
                onClick={() => {
                  setOverview(false);
                  setMap({ all: true });
                }}
              >
                <Globe2 size={16} />
                整段旅行地图
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    new Blob([reportHtml(doc)], { type: 'text/html;charset=utf-8' }),
                    'tripflow-report.html'
                  )
                }
              >
                <Download size={16} />
                HTML 报告
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <FileText size={16} />
                打印 / PDF
              </Button>
            </div>
            <div className="print-report">
              <h2>{t.title}</h2>
              <p className="muted">
                {t.startDate} — {t.endDate} · {t.defaultTimezone}
              </p>
              <p>{t.notes}</p>
              <div className="overview-stats">
                {doc.entries.length} 段记录 · 记录时长合计 {duration(totalDuration(doc))}
                （并行活动分别计时）· {doc.photos.length} 张照片
              </div>
              {sorted(doc.entries).map((e) => (
                <article className="report-entry" key={e.id}>
                  <small>
                    {DateTime.fromISO(e.startAtUtc).setZone(e.timezone).toFormat('MM.dd HH:mm ZZ')}{' '}
                    →{' '}
                    {DateTime.fromISO(e.endAtUtc).setZone(e.endTimezone).toFormat('MM.dd HH:mm ZZ')}{' '}
                    · {duration(actualSeconds(e))}
                  </small>
                  <h3>{e.title}</h3>
                  <p>{e.notes}</p>
                </article>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!supabase);
  const ownerId = user?.id || LOCAL_OWNER;
  const store = useTrips(ownerId),
    [online, setOnline] = useState(navigator.onLine);
  const [auth, setAuth] = useState(false),
    [newTrip, setNewTrip] = useState(false),
    [backup, setBackup] = useState(false),
    [toast, setToast] = useState('');
  const readonly = ownerId !== LOCAL_OWNER && (!online || store.cached);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setToast('登录状态读取失败，请重新登录');
      setUser(data.session?.user || null);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      setAuthReady(true);
      if (event === 'SIGNED_OUT') {
        setToast('已退出云端账户，当前显示本地模式');
        setNewTrip(false);
        setBackup(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 6500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function signOut() {
    if (!supabase || !user) return;
    const owner = user.id;
    const { error } = await supabase.auth.signOut();
    if (error) setToast(error.message);
    else await clearAccountCache(owner);
  }
  if (!authReady)
    return (
      <div className="loading-card">
        <LoaderCircle className="spin" />
        正在检查个人账户…
      </div>
    );
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="TripFlow 首页">
            <span className="brand-icon">
              <Navigation size={20} />
            </span>
            <span className="brand-word">
              TripFlow<span>®</span>
            </span>
          </Link>
          <nav>
            <Link to="/" className="nav-active">
              我的旅行
            </Link>
            <button onClick={() => setBackup(true)}>备份与导出</button>
          </nav>
          <div className="header-account">
            <span className={`sync-status ${ownerId === LOCAL_OWNER ? 'local' : ''}`}>
              {ownerId === LOCAL_OWNER ? (
                <CloudOff size={14} />
              ) : online && !store.cached ? (
                <Cloud size={14} />
              ) : (
                <CloudOff size={14} />
              )}
              <span>
                {ownerId === LOCAL_OWNER
                  ? '本地模式'
                  : !online || store.cached
                    ? '离线 / 缓存'
                    : '云端已连接'}
              </span>
            </span>
            {user ? (
              <button
                className="account-avatar"
                aria-label="退出云端账户"
                title={`退出 ${user.email}`}
                onClick={() => void signOut()}
              >
                {user.email?.[0].toUpperCase()}
                <LogOut size={12} />
              </button>
            ) : supabase ? (
              <Button variant="outline" size="sm" onClick={() => setAuth(true)}>
                <LogIn size={15} />
                <span>登录</span>
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <button className="mobile-backup" aria-label="打开备份与导出" onClick={() => setBackup(true)}>
        <ArrowDownToLine size={16} />
        <span>备份与导出</span>
      </button>
      {ownerId === LOCAL_OWNER && (
        <div className="mode-banner">
          <span className="status-dot" />
          本地模式 · 记录仅保存在当前浏览器，尚未上传云端。
          {supabase && (
            <button onClick={() => setAuth(true)}>
              连接个人账户
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      )}
      {!online && (
        <div className="network-banner" role="status">
          当前离线。
          {ownerId === LOCAL_OWNER
            ? '本地记录仍可编辑，在线地图暂不可用。'
            : '仅可查看已缓存内容，云端编辑暂时停用。'}
        </div>
      )}
      {store.error && (
        <div className="error-banner" role="alert">
          {store.error}
          <button onClick={() => void store.refresh()}>重试读取</button>
        </div>
      )}
      <div key={ownerId}>
        <Routes>
          <Route
            path="/"
            element={
              <Home
                store={store}
                ownerId={ownerId}
                readonly={readonly}
                onNew={() => setNewTrip(true)}
                onImport={() => setBackup(true)}
                onNotice={setToast}
              />
            }
          />
          <Route
            path="/trip/:id"
            element={<TripPage store={store} readonly={readonly} onNotice={setToast} />}
          />
          <Route
            path="*"
            element={
              <main className="empty-home">
                <h2>这一页还没有故事</h2>
                <Link to="/">返回我的旅行</Link>
              </main>
            }
          />
        </Routes>
      </div>
      {auth && <AuthDialog onClose={() => setAuth(false)} />}
      {newTrip && (
        <TripForm
          ownerId={ownerId}
          onClose={() => setNewTrip(false)}
          onSave={async (doc) => {
            await store.save(doc);
            setToast(ownerId === LOCAL_OWNER ? '旅行已在本地创建' : '旅行已保存到云端');
          }}
        />
      )}
      {backup && (
        <BackupDialog
          docs={store.docs}
          ownerId={ownerId}
          readonly={readonly}
          onClose={() => setBackup(false)}
          onImported={store.refresh}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <datalist id="timezones">
        {[
          'Asia/Shanghai',
          'Asia/Tokyo',
          'Asia/Hong_Kong',
          'Asia/Singapore',
          'Asia/Seoul',
          'Asia/Bangkok',
          'Europe/London',
          'Europe/Paris',
          'America/New_York',
          'America/Los_Angeles',
          'Pacific/Honolulu',
          'Australia/Sydney',
          'UTC',
        ].map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </ErrorBoundary>
  );
}
