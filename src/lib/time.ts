import { DateTime } from 'luxon';
import type { Entry, TripDocument } from '../models';

// Reject nonexistent DST wall times. Ambiguous wall times require an explicit offset.
export function toUtc(local: string, timezone: string, offset?: number): string {
  const time = DateTime.fromISO(local, { zone: timezone });
  if (!time.isValid || time.toFormat("yyyy-MM-dd'T'HH:mm") !== local.slice(0, 16))
    throw new Error('这个当地时间不存在（可能处于夏令时跳变），请选择其他时间');
  const choices = time.getPossibleOffsets();
  if (choices.length > 1) {
    const chosen = choices.find((d) => d.offset === offset);
    if (!chosen) throw new Error('这个时间出现两次，请选择 UTC 偏移以确认实际时间');
    return chosen.toUTC().toISO()!;
  }
  return time.toUTC().toISO()!;
}
export const localInput = (utc: string, zone: string) =>
  DateTime.fromISO(utc).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm:ss");
export const clock = (utc: string | number, zone: string) =>
  (typeof utc === 'number' ? DateTime.fromMillis(utc) : DateTime.fromISO(utc))
    .setZone(zone)
    .toFormat('HH:mm');
export const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
};
export const actualSeconds = (e: Entry) =>
  (Date.parse(e.endAtUtc) - Date.parse(e.startAtUtc)) / 1000;
export const sorted = (entries: Entry[]) =>
  [...entries].sort(
    (a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc) || a.id.localeCompare(b.id)
  );
export function dayBounds(date: string, zone: string) {
  const from = DateTime.fromISO(date, { zone }).startOf('day');
  return { from: from.toMillis(), to: from.plus({ days: 1 }).toMillis() };
}
export function dailyEntries(entries: Entry[], date: string, zone: string) {
  const { from, to } = dayBounds(date, zone);
  return sorted(entries)
    .filter((e) => {
      const s = Date.parse(e.startAtUtc),
        t = Date.parse(e.endAtUtc);
      return e.type === 'moment' ? s >= from && s < to : s < to && t > from;
    })
    .map((e) => ({
      entry: e,
      start: Math.max(from, Date.parse(e.startAtUtc)),
      end: Math.min(to, Date.parse(e.endAtUtc)),
      fromPrevious: Date.parse(e.startAtUtc) < from,
      toNext: Date.parse(e.endAtUtc) > to,
    }));
}
export function timelineRows(entries: Entry[], date: string, zone: string) {
  const items = dailyEntries(entries, date, zone);
  let occupiedUntil: number | undefined;
  return items.map((item) => {
    const gap =
      occupiedUntil !== undefined && item.start > occupiedUntil
        ? { start: occupiedUntil, end: item.start }
        : undefined;
    const overlap =
      item.entry.type !== 'moment' && occupiedUntil !== undefined && item.start < occupiedUntil;
    occupiedUntil = Math.max(occupiedUntil ?? item.end, item.end);
    return { ...item, gap, overlap };
  });
}
export function dates(start: string, end: string) {
  const output: string[] = [];
  for (
    let d = DateTime.fromISO(start);
    d.toISODate()! <= end && output.length < 367;
    d = d.plus({ days: 1 })
  )
    output.push(d.toISODate()!);
  return output;
}
export function totalDuration(doc: TripDocument) {
  return doc.entries.reduce((sum, e) => sum + actualSeconds(e), 0);
}
