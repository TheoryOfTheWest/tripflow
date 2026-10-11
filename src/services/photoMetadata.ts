import { DateTime } from 'luxon';
import { validatePhotoFile } from './media';

export type AnchorMetadata = {
  wallTime?: string;
  utc?: string;
  offset?: string;
  timeSource?: 'original' | 'digitized' | 'gps';
  latitude?: number;
  longitude?: number;
  warnings: string[];
};
const captureFields = [
  'DateTimeOriginal',
  'CreateDate',
  'OffsetTimeOriginal',
  'OffsetTimeDigitized',
  'GPSLatitude',
  'GPSLatitudeRef',
  'GPSLongitude',
  'GPSLongitudeRef',
  'GPSDateStamp',
  'GPSTimeStamp',
];
function captureTime(value: unknown) {
  if (typeof value !== 'string') return;
  const match = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return;
  const [, y, m, d, h, min, sec] = match;
  const iso = `${y}-${m}-${d}T${h}:${min}:${sec}`;
  const parsed = DateTime.fromISO(iso, { zone: 'UTC' });
  return parsed.isValid && parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss") === iso ? iso : undefined;
}
function coordinate(tags: Record<string, unknown>, axis: 'Latitude' | 'Longitude') {
  const values = tags[`GPS${axis}`],
    ref = tags[`GPS${axis}Ref`];
  if (
    !Array.isArray(values) ||
    values.length !== 3 ||
    !values.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  )
    return;
  if (
    values[1] >= 60 ||
    values[2] >= 60 ||
    !(axis === 'Latitude' ? ['N', 'S'] : ['E', 'W']).includes(String(ref))
  )
    return;
  const value =
    (values[0] + values[1] / 60 + values[2] / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
  return Math.abs(value) <= (axis === 'Latitude' ? 90 : 180) ? value : undefined;
}
export function normalizeAnchorMetadata(tags: Record<string, unknown> = {}): AnchorMetadata {
  const result: AnchorMetadata = { warnings: [] };
  for (const [dateKey, offsetKey, source] of [
    ['DateTimeOriginal', 'OffsetTimeOriginal', 'original'],
    ['CreateDate', 'OffsetTimeDigitized', 'digitized'],
  ] as const) {
    const wallTime = captureTime(tags[dateKey]);
    if (!wallTime) continue;
    result.wallTime = wallTime;
    result.timeSource = source;
    const offset = tags[offsetKey];
    if (
      typeof offset === 'string' &&
      /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset.trim()) &&
      !/^[+-]14:(?!00)/.test(offset.trim())
    ) {
      result.offset = offset.trim();
      result.utc = DateTime.fromISO(`${wallTime}${result.offset}`, { setZone: true })
        .toUTC()
        .toISO()!;
    } else if (offset !== undefined)
      result.warnings.push('照片时区偏移无效，按表单时区解释拍摄时间');
    break;
  }
  if (
    !result.wallTime &&
    typeof tags.GPSDateStamp === 'string' &&
    Array.isArray(tags.GPSTimeStamp)
  ) {
    const time = tags.GPSTimeStamp;
    if (
      time.length === 3 &&
      time.every(
        (n, i) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < (i === 0 ? 24 : 60)
      )
    ) {
      const wall = captureTime(
        `${tags.GPSDateStamp} ${time.map((n) => String(Math.floor(n)).padStart(2, '0')).join(':')}`
      );
      if (wall) {
        result.utc = `${wall}Z`;
        result.timeSource = 'gps';
      }
    }
  }
  const latitude = coordinate(tags, 'Latitude'),
    longitude = coordinate(tags, 'Longitude');
  if (latitude !== undefined && longitude !== undefined) {
    result.latitude = latitude;
    result.longitude = longitude;
  }
  if (!result.wallTime && !result.utc) result.warnings.push('未找到有效拍摄时间，时间保持原值');
  if (result.latitude === undefined) result.warnings.push('未找到有效 GPS，地点保持原值');
  return result;
}
export async function readAnchorMetadata(file: File): Promise<AnchorMetadata> {
  validatePhotoFile(file);
  try {
    // Read only explicitly selected anchor files. Never infer capture time from filenames or mtime.
    const { parse } = await import('exifr');
    const tags = await parse(await file.arrayBuffer(), {
      pick: captureFields,
      reviveValues: false,
      xmp: false,
      makerNote: false,
      userComment: false,
    });
    return normalizeAnchorMetadata(tags || {});
  } catch {
    return { warnings: ['照片元数据无法读取，请手动填写时间与地点；图片仍可作为锚定照片保存'] };
  }
}
export function anchorTimeInput(metadata: AnchorMetadata, zone: string) {
  if (!metadata.utc && !metadata.wallTime) return;
  if (!DateTime.now().setZone(zone).isValid)
    throw new Error('当前时区无效，未自动改写时间，请修正时区后手动填写');
  if (metadata.utc) {
    const time = DateTime.fromISO(metadata.utc).setZone(zone);
    return {
      value: time.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
      offset: time.offset,
      note: '已按照片的时区信息换算到表单当前时区',
    };
  }
  return {
    value: metadata.wallTime!,
    offset: undefined,
    note: '照片没有时区信息，暂按表单当前时区解释，请核对',
  };
}
