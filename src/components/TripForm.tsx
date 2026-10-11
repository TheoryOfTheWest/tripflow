import { useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { now, uuid, tripSchema, newDocument, type TripDocument } from '../models';
import { message } from '../lib/utils';
import { PhotoAutoMode } from './PhotoAutoMode';
import {
  emptyAutoDraft,
  autoDateRange,
  appendPhotoTimeline,
  type PhotoAutoDraft,
} from '../services/photoTimeline';
import { putPhoto, deletePhotos, LOCAL_OWNER } from '../services/repository';
import type { Photo } from '../models';
export function TripForm({
  doc,
  ownerId,
  onSave,
  onClose,
}: {
  doc?: TripDocument;
  ownerId: string;
  onSave: (doc: TripDocument) => Promise<void>;
  onClose: () => void;
}) {
  const today = DateTime.now().toISODate()!;
  const tripId = useRef(doc?.trip.id || uuid());
  const uploadedIds = useRef(new Set<string>());
  const autoTitle = useRef('');
  const saving = useRef(false);
  const [automatic, setAutomatic] = useState(false);
  const [draft, setDraft] = useState(emptyAutoDraft);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [title, setTitle] = useState(doc?.trip.title || ''),
    [start, setStart] = useState(doc?.trip.startDate || today),
    [end, setEnd] = useState(doc?.trip.endDate || today);
  const [zone, setZone] = useState(
      doc?.trip.defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    ),
    [notes, setNotes] = useState(doc?.trip.notes || ''),
    [cover, setCover] = useState(doc?.trip.cover || 'mountain');
  const [coverPhotoId, setCoverPhotoId] = useState(doc?.trip.coverPhotoId || '');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function updateDraft(next: PhotoAutoDraft) {
    setDraft(next);
    try {
      const range = autoDateRange(next.groups, zone);
      if (!range) return;
      setStart(doc ? [doc.trip.startDate, range.start].sort()[0] : range.start);
      setEnd(doc ? [doc.trip.endDate, range.end].sort().at(-1)! : range.end);
      const generated = `照片旅程 · ${range.start}`;
      const previousTitle = autoTitle.current;
      autoTitle.current = generated;
      setTitle((current) => (!current || current === previousTitle ? generated : current));
    } catch {
      /* Invalid draft fields remain editable and are validated on save. */
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current || photoBusy || uncertain) return;
    saving.current = true;
    const uploaded: Photo[] = [];
    let attempted = false;
    setBusy(true);
    setError('');
    try {
      const trip = tripSchema.parse({
        id: tripId.current,
        ownerId,
        title,
        startDate: start,
        endDate: end,
        defaultTimezone: zone,
        cover,
        coverPhotoId: coverPhotoId || undefined,
        notes,
        createdAt: doc?.trip.createdAt || now(),
        updatedAt: now(),
      });
      const base = doc ? { ...doc, trip } : newDocument(trip);
      let result = base;
      if (automatic) {
        const generated = appendPhotoTimeline(base, draft, zone);
        result = generated.doc;
        for (const photo of generated.photos) {
          if (!uploadedIds.current.has(photo.id)) {
            await putPhoto(photo, generated.blobs.get(photo.id)!);
            uploadedIds.current.add(photo.id);
          }
          uploaded.push(photo);
        }
      }
      attempted = true;
      await onSave(result);
      onClose();
    } catch (e) {
      if (attempted && ownerId !== LOCAL_OWNER) {
        setUncertain(true);
        setError(
          `${message(e)}。保存结果需要核对，已上传图片保留；请关闭窗口并刷新查看，避免重复生成。`
        );
      } else {
        await deletePhotos(uploaded).catch(() => {});
        uploaded.forEach((photo) => uploadedIds.current.delete(photo.id));
        setError(message(e));
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={doc ? '编辑旅行' : '一段新的旅程'}
      description="给旅程一个名字，留下接下来每一天的故事。"
      wide={automatic}
      onClose={() => !busy && !photoBusy && onClose()}
    >
      <form onSubmit={submit} className="form-body">
        <fieldset disabled={busy || photoBusy || uncertain} className="form-fieldset">
          <div className="segmented auto-mode-choice">
            <button
              type="button"
              aria-pressed={!automatic}
              disabled={draft.photos.length > 0}
              className={!automatic ? 'active' : ''}
              onClick={() => setAutomatic(false)}
            >
              手动记录模式
            </button>
            <button
              type="button"
              aria-pressed={automatic}
              className={automatic ? 'active' : ''}
              onClick={() => setAutomatic(true)}
            >
              上传照片自动解析模式
            </button>
          </div>
        </fieldset>
        {automatic && (
          <PhotoAutoMode
            value={draft}
            zone={zone}
            disabled={busy || uncertain}
            onChange={updateDraft}
            onBusyChange={setPhotoBusy}
          />
        )}
        <fieldset disabled={busy || photoBusy || uncertain} className="form-fieldset">
          <label>
            旅行名称
            <input
              aria-label="旅行名称"
              autoFocus
              required={!automatic}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={150}
              placeholder="例如：在关西，慢慢走"
            />
          </label>
          <div className="form-grid">
            <label>
              出发日期
              <input
                aria-label="出发日期"
                type="date"
                required
                disabled={automatic && draft.groups.length > 0}
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (end < e.target.value) setEnd(e.target.value);
                }}
              />
            </label>
            <label>
              结束日期
              <input
                aria-label="结束日期"
                type="date"
                required
                min={start}
                disabled={automatic && draft.groups.length > 0}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <label>
            旅行默认时区
            <input
              aria-label="旅行默认时区"
              required
              list="timezones"
              disabled={automatic && draft.photos.length > 0}
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            />
          </label>
          <p className="muted small">
            每日视图以此时区划分；每条记录仍可单独选择出发与到达时区。
            {automatic &&
              '自动模式按草稿填写旅行名称和日期；如需更换本批次时区，请先清空待生成照片。保存后仍可编辑旅行资料与每条记录。'}
          </p>
          <label>
            旅行备注
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="想去的地方、想做的小事…"
              maxLength={10000}
            />
          </label>
          <label>封面风格</label>
          <div className="cover-options">
            {(['mountain', 'coast', 'city', 'forest'] as const).map((c, i) => (
              <button
                type="button"
                className={`cover-option cover-${c} ${cover === c ? 'selected' : ''}`}
                key={c}
                onClick={() => setCover(c)}
              >
                {['山间', '海岸', '城市', '森林'][i]}
                {cover === c && <Check size={15} />}
              </button>
            ))}
          </div>
          {doc && doc.photos.length > 0 && (
            <label>
              或使用旅行照片作为封面
              <select value={coverPhotoId} onChange={(e) => setCoverPhotoId(e.target.value)}>
                <option value="">使用插画封面</option>
                {doc.photos
                  .filter((p) => !p.missing)
                  .map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {p.caption || `照片 ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy || photoBusy}>
            取消
          </Button>
          <Button type="submit" disabled={busy || photoBusy || uncertain}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
            {automatic ? '确认生成并保存旅行' : '保存旅行'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
