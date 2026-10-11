// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  normalizeAnchorMetadata,
  anchorTimeInput,
  readAnchorMetadata,
} from '../src/services/photoMetadata';
import { anchorJpeg } from './helpers/anchorPhoto';

describe('explicit anchor photo metadata', () => {
  it('reads real EXIF bytes, capture offset and DMS hemisphere values', async () => {
    const bytes = anchorJpeg(
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      '2026:10:16 09:30:15',
      '+09:00',
      [-33.5, -70.25]
    );
    const metadata = await readAnchorMetadata(
      new File([new Uint8Array(bytes)], 'synthetic.jpg', { type: 'image/jpeg' })
    );
    expect(metadata.utc).toBe('2026-10-16T00:30:15.000Z');
    expect(metadata.latitude).toBeCloseTo(-33.5);
    expect(metadata.longitude).toBeCloseTo(-70.25);
    expect(metadata.warnings).toEqual([]);
    expect(anchorTimeInput(metadata, 'Asia/Shanghai')?.value).toBe('2026-10-16T08:30:15');
  });
  it('keeps wall time when no offset exists, and resolves a known DST instant', () => {
    const wall = normalizeAnchorMetadata({ DateTimeOriginal: '2026:11:01 01:30:00' });
    expect(anchorTimeInput(wall, 'America/New_York')).toMatchObject({
      value: '2026-11-01T01:30:00',
      offset: undefined,
    });
    const known = normalizeAnchorMetadata({
      DateTimeOriginal: '2026:11:01 01:30:00',
      OffsetTimeOriginal: '-05:00',
    });
    expect(anchorTimeInput(known, 'America/New_York')?.offset).toBe(-300);
    expect(() => anchorTimeInput(wall, 'invalid/zone')).toThrow('时区无效');
  });
  it('accepts GPS UTC fallback and zero coordinates independently of capture time', () => {
    const metadata = normalizeAnchorMetadata({
      GPSDateStamp: '2026:10:16',
      GPSTimeStamp: [0, 30, 15.5],
      GPSLatitude: [0, 0, 0],
      GPSLatitudeRef: 'N',
      GPSLongitude: [0, 0, 0],
      GPSLongitudeRef: 'E',
    });
    expect(metadata.utc).toBe('2026-10-16T00:30:15Z');
    expect(metadata.latitude).toBe(0);
    expect(metadata.longitude).toBe(0);
  });
  it('rejects normalized invalid dates and malformed GPS without guessing from modify time', () => {
    for (const date of ['2026:02:30 12:00:00', '2026:10:16 24:00:00', '2026:10:16 12:60:00'])
      expect(normalizeAnchorMetadata({ DateTimeOriginal: date }).wallTime).toBeUndefined();
    expect(
      normalizeAnchorMetadata({ GPSDateStamp: '2026:10:16', GPSTimeStamp: [-0.1, 0, 0] }).utc
    ).toBeUndefined();
    expect(
      normalizeAnchorMetadata({ GPSDateStamp: '2026:10:16', GPSTimeStamp: [24, 0, 0] }).utc
    ).toBeUndefined();
    const invalid = normalizeAnchorMetadata({
      ModifyDate: '2026:10:16 12:00:00',
      GPSLatitude: [90, 1, 0],
      GPSLatitudeRef: 'N',
      GPSLongitude: [1, 0, 0],
      GPSLongitudeRef: 'E',
    });
    expect(invalid.latitude).toBeUndefined();
    expect(invalid.wallTime).toBeUndefined();
    expect(invalid.warnings).toHaveLength(2);
  });
  it('uses valid digitized capture time if original is absent, never accepts an invalid offset', () => {
    const metadata = normalizeAnchorMetadata({
      CreateDate: '2026:10:16 10:00:00',
      OffsetTimeDigitized: '+14:01',
    });
    expect(metadata.wallTime).toBe('2026-10-16T10:00:00');
    expect(metadata.utc).toBeUndefined();
    expect(metadata.warnings.join('')).toContain('偏移无效');
  });
  it('validates files before parsing and handles missing or unreadable metadata', async () => {
    await expect(
      readAnchorMetadata(new File(['x'], 'x.heic', { type: 'image/heic' }))
    ).rejects.toThrow();
    await expect(
      readAnchorMetadata(
        new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'x.jpg', { type: 'image/jpeg' })
      )
    ).rejects.toThrow();
    const metadata = await readAnchorMetadata(
      new File(['broken'], '20261016.jpg', { type: 'image/jpeg', lastModified: Date.now() })
    );
    expect(metadata.utc).toBeUndefined();
    expect(metadata.wallTime).toBeUndefined();
    expect(metadata.latitude).toBeUndefined();
    expect(metadata.warnings.length).toBeGreaterThan(0);
  });
});
