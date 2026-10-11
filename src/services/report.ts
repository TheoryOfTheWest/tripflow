import type { TripDocument } from '../models';
import { sorted, duration, actualSeconds } from '../lib/time';
import { DateTime } from 'luxon';
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export function reportHtml(doc: TripDocument) {
  const t = doc.trip;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(t.title)} · TripFlow</title><style>body{max-width:780px;margin:60px auto;padding:0 25px;color:#29463c;font:16px/1.8 system-ui}h1{font-size:36px}article{border-top:1px solid #ddd;padding:20px 0;break-inside:avoid}small{color:#65756d}p{white-space:pre-wrap}@media print{body{margin:0;max-width:none}}</style><h1>${escape(t.title)}</h1><small>${t.startDate} — ${t.endDate} · ${escape(t.defaultTimezone)}</small><p>${escape(t.notes)}</p>${sorted(
    doc.entries
  )
    .map(
      (e) =>
        `<article><small>${escape(DateTime.fromISO(e.startAtUtc).setZone(e.timezone).toFormat('yyyy-MM-dd HH:mm ZZ'))} — ${escape(DateTime.fromISO(e.endAtUtc).setZone(e.endTimezone).toFormat('yyyy-MM-dd HH:mm ZZ'))} · ${duration(actualSeconds(e))}</small><h2>${escape(e.title)}</h2><p>${escape(e.type === 'transport' ? `${doc.places.find((p) => p.id === e.originPlaceId)?.name || ''} → ${doc.places.find((p) => p.id === e.destinationPlaceId)?.name || ''}\n${e.transport?.lineName || ''}\n${e.transport?.transferNotes || ''}` : doc.places.find((p) => p.id === e.placeId)?.name || '')}</p><p>${escape(e.notes)}</p><small>照片 ${doc.photos.filter((p) => p.entryId === e.id).length} 张（完整图片请查看 ZIP 备份）</small></article>`
    )
    .join(
      ''
    )}<footer>TripFlow 私人旅行报告 · 通过浏览器打印可保存为 PDF · 本报告未包含地图截图</footer></html>`;
}
