import type { TripDocument } from '../models';
import { sorted, duration, actualSeconds } from '../lib/time';
import { DateTime } from 'luxon';
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export function reportHtml(doc: TripDocument, photoSources?: ReadonlyMap<string, string>) {
  const photosHtml = (entryId: string | null) =>
    doc.photos
      .filter((p) => p.entryId === entryId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => {
        const src = photoSources?.get(p.id);
        return src
          ? `<figure><img src="${escape(src)}" alt="${escape(p.caption || '旅途照片')}"><figcaption>${escape(p.caption)}</figcaption></figure>`
          : '';
      })
      .join('');
  const t = doc.trip;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' file:"><title>${escape(t.title)} · TripFlow</title><style>body{max-width:780px;margin:60px auto;padding:0 25px;color:#29463c;font:16px/1.8 system-ui}h1{font-size:36px}article{border-top:1px solid #ddd;padding:20px 0;break-inside:avoid}small{color:#65756d}p{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:20px 0}img{max-width:100%;height:auto;border-radius:8px}figcaption{font-size:14px;color:#65756d}h1,h2{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}}</style><h1>${escape(t.title)}</h1><small>${t.startDate} — ${t.endDate} · ${escape(t.defaultTimezone)}</small><p>${escape(t.notes)}</p>${sorted(
    doc.entries
  )
    .map(
      (e) =>
        `<article><small>${escape(DateTime.fromISO(e.startAtUtc).setZone(e.timezone).toFormat('yyyy-MM-dd HH:mm ZZ'))} — ${escape(DateTime.fromISO(e.endAtUtc).setZone(e.endTimezone).toFormat('yyyy-MM-dd HH:mm ZZ'))} · ${duration(actualSeconds(e))}</small><h2>${escape(e.title)}</h2><p>${escape(e.type === 'transport' ? `${doc.places.find((p) => p.id === e.originPlaceId)?.name || ''} → ${doc.places.find((p) => p.id === e.destinationPlaceId)?.name || ''}\n${e.transport?.lineName || ''}\n${e.transport?.transferNotes || ''}` : doc.places.find((p) => p.id === e.placeId)?.name || '')}</p><p>${escape(e.notes)}</p>${photoSources ? photosHtml(e.id) : `<small>照片 ${doc.photos.filter((p) => p.entryId === e.id).length} 张（完整图片请查看 ZIP 备份）</small>`}</article>`
    )
    .join(
      ''
    )}${photoSources && doc.photos.some((p) => p.entryId === null) ? `<section><h2>其他旅途照片</h2>${photosHtml(null)}</section>` : ''}<footer>TripFlow 私人旅行报告 · 通过浏览器打印可保存为 PDF · 本报告未包含地图截图</footer></html>`;
}
