import { useState, type FormEvent } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { DateTime } from 'luxon';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { now, uuid, tripSchema, newDocument, type TripDocument } from '../models';
import { message } from '../lib/utils';
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const trip = tripSchema.parse({
        id: doc?.trip.id ?? uuid(),
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
      await onSave(doc ? { ...doc, trip } : newDocument(trip));
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={doc ? '编辑旅行' : '一段新的旅程'}
      description="给旅程一个名字，留下接下来每一天的故事。"
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} className="form-body">
        <label>
          旅行名称
          <input
            aria-label="旅行名称"
            autoFocus
            required
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
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          />
        </label>
        <p className="muted small">每日视图以此时区划分；每条记录仍可单独选择出发与到达时区。</p>
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
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <footer className="form-footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}保存旅行
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
