import { describe, expect, it } from 'vitest';
import { sampleDocument } from '../src/lib/fixture';
import {
  actualSeconds,
  dailyEntries,
  dayBounds,
  sorted,
  timelineRows,
  toUtc,
  totalDuration,
} from '../src/lib/time';
describe('UTC / daily projection', () => {
  it('clips a single midnight entry into two days without duplicating persisted records', () => {
    const doc = sampleDocument('local-demo'),
      overnight = doc.entries.find((e) => e.title.includes('跨午夜'))!;
    const a = dailyEntries([overnight], '2026-10-17', 'Asia/Tokyo')[0],
      b = dailyEntries([overnight], '2026-10-18', 'Asia/Tokyo')[0];
    expect(a.toNext).toBe(true);
    expect(b.fromPrevious).toBe(true);
    expect((a.end - a.start + b.end - b.start) / 1000).toBe(8 * 3600);
    expect(doc.entries.filter((e) => e.id === overnight.id)).toHaveLength(1);
    expect(totalDuration(doc)).toBe(doc.entries.reduce((v, e) => v + actualSeconds(e), 0));
  });
  it('uses actual UTC order and duration for flights across time zones', () => {
    const e = sampleDocument('local-demo').entries.at(-1)!;
    expect(actualSeconds(e)).toBe(7200);
    const earlier = {
      ...e,
      id: crypto.randomUUID(),
      startAtUtc: toUtc('2026-10-18T18:30', 'Asia/Shanghai'),
    };
    expect(sorted([e, earlier])[0].id).toBe(earlier.id);
  });
  it('handles DST days of 23 / 25 hours', () => {
    const spring = dayBounds('2026-03-08', 'America/New_York'),
      fall = dayBounds('2026-11-01', 'America/New_York');
    expect(spring.to - spring.from).toBe(23 * 3600000);
    expect(fall.to - fall.from).toBe(25 * 3600000);
  });
  it('rejects nonexistent times and requires offsets for ambiguous ones', () => {
    expect(() => toUtc('2026-03-08T02:30', 'America/New_York')).toThrow('不存在');
    expect(() => toUtc('2026-11-01T01:30', 'America/New_York')).toThrow('出现两次');
    const a = toUtc('2026-11-01T01:30', 'America/New_York', -240),
      b = toUtc('2026-11-01T01:30', 'America/New_York', -300);
    expect(Date.parse(b) - Date.parse(a)).toBe(3600000);
  });
  it('does not create false gaps inside a longer overlapping stay', () => {
    const e = sampleDocument('local-demo').entries[0];
    const withTime = (a: string, b: string) => ({
      ...e,
      id: crypto.randomUUID(),
      startAtUtc: toUtc(`2026-10-16T${a}`, 'Asia/Tokyo'),
      endAtUtc: toUtc(`2026-10-16T${b}`, 'Asia/Tokyo'),
    });
    const rows = timelineRows(
      [
        withTime('09:00', '14:00'),
        withTime('10:00', '11:00'),
        withTime('12:00', '13:00'),
        withTime('15:00', '16:00'),
      ],
      '2026-10-16',
      'Asia/Tokyo'
    );
    expect(rows[2].gap).toBeUndefined();
    expect(rows[2].overlap).toBe(true);
    expect(rows[3].gap!.end - rows[3].gap!.start).toBe(3600000);
  });
  it('assigns an exact-midnight end only to the preceding day', () => {
    const e = sampleDocument('local-demo').entries[0];
    e.startAtUtc = toUtc('2026-10-16T23:00', 'Asia/Tokyo');
    e.endAtUtc = toUtc('2026-10-17T00:00', 'Asia/Tokyo');
    expect(dailyEntries([e], '2026-10-17', 'Asia/Tokyo')).toHaveLength(0);
  });
  it('splits unrecorded time at independent moments without duplicating gaps', () => {
    const e = sampleDocument('local-demo').entries[0];
    const moment = {
      ...e,
      id: crypto.randomUUID(),
      type: 'moment' as const,
      startAtUtc: toUtc('2026-10-16T12:00', 'Asia/Tokyo'),
      endAtUtc: toUtc('2026-10-16T12:00', 'Asia/Tokyo'),
    };
    const after = {
      ...e,
      id: crypto.randomUUID(),
      startAtUtc: toUtc('2026-10-16T13:00', 'Asia/Tokyo'),
      endAtUtc: toUtc('2026-10-16T14:00', 'Asia/Tokyo'),
    };
    const rows = timelineRows([e, moment, after], '2026-10-16', 'Asia/Tokyo');
    expect(rows[2].gap!.start).toBe(Date.parse(moment.startAtUtc));
  });
});
