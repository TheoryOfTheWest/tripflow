import { DateTime } from 'luxon';
import {
  uuid,
  now,
  documentSchema,
  type TripDocument,
  type Photo,
  type Entry,
  type Place,
} from '../models';
import { toUtc, localInput } from '../lib/time';
import { roughWalk, geoapify, geoKey } from './geoapify';
import { readAnchorMetadata, anchorTimeInput } from './photoMetadata';
import { compressPhoto, MAX_ENTRY_PHOTOS } from './media';

export const MAX_BATCH_PHOTOS = MAX_ENTRY_PHOTOS;
export const MAX_BATCH_BYTES = 80 * 1024 * 1024;
export type PhotoDraft = {
  id: string;
  fileName: string;
  blob: Blob;
  time: string;
  offset?: number;
  latitude: string;
  longitude: string;
  warnings: string[];
  excluded: boolean;
};
export type DraftLocation = { name: string; address: string; latitude: string; longitude: string };
export type PhotoGroup = {
  id: string;
  photoIds: string[];
  startPhotoId: string;
  endPhotoId: string;
  title: string;
  start: string;
  end: string;
  startOffset?: number;
  endOffset?: number;
  startLocation: DraftLocation;
  endLocation: DraftLocation;
  notes: string;
};
export type PhotoAutoDraft = {
  photos: PhotoDraft[];
  groups: PhotoGroup[];
  dirty: boolean;
  failures: string[];
  notice: string;
};
export const emptyAutoDraft = (): PhotoAutoDraft => ({
  photos: [],
  groups: [],
  dirty: false,
  failures: [],
  notice: '',
});
export function coordinates(location: Pick<DraftLocation, 'latitude' | 'longitude'>) {
  if (!location.latitude.trim() || !location.longitude.trim()) return;
  const latitude = Number(location.latitude),
    longitude = Number(location.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return;
  return { latitude, longitude };
}
export async function parseDraftPhoto(file: File, zone: string): Promise<PhotoDraft> {
  const metadata = await readAnchorMetadata(file);
  const blob = await compressPhoto(file);
  let time: ReturnType<typeof anchorTimeInput>;
  const warnings = [...metadata.warnings];
  try {
    time = anchorTimeInput(metadata, zone);
    if (time) warnings.push(time.note);
  } catch {
    warnings.push('时区无效，时间需手动确认');
  }
  return {
    id: uuid(),
    fileName: file.name,
    blob,
    time: time?.value || '',
    offset: time?.offset,
    latitude: metadata.latitude === undefined ? '' : String(metadata.latitude),
    longitude: metadata.longitude === undefined ? '' : String(metadata.longitude),
    warnings,
    excluded: false,
  };
}
export function locationFromPhoto(photo?: PhotoDraft): DraftLocation {
  const point = photo && coordinates(photo);
  return {
    name: point ? '照片地点（待核对）' : '',
    address: '',
    latitude: photo?.latitude || '',
    longitude: photo?.longitude || '',
  };
}
export function makePhotoGroup(photos: PhotoDraft[]): PhotoGroup {
  const first = photos[0],
    last = photos.at(-1)!;
  const interval = first.time !== last.time || first.offset !== last.offset;
  return {
    id: uuid(),
    photoIds: photos.map((p) => p.id),
    startPhotoId: first.id,
    endPhotoId: interval ? last.id : '',
    title: coordinates(first) ? '照片地点（待核对）' : '照片随记',
    start: first.time,
    end: last.time,
    startOffset: first.offset,
    endOffset: last.offset,
    startLocation: locationFromPhoto(first),
    endLocation: locationFromPhoto(interval ? last : undefined),
    notes: '',
  };
}
export function groupPhotos(photos: PhotoDraft[], zone: string, radius = 200, gapMinutes = 90) {
  if (
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 5000 ||
    !Number.isFinite(gapMinutes) ||
    gapMinutes < 1 ||
    gapMinutes > 1440
  )
    throw new Error('合并范围须为 1–5000 米，时间间隔须为 1–1440 分钟');
  const unresolved: string[] = [];
  const timed = photos
    .filter((p) => !p.excluded)
    .flatMap((photo) => {
      try {
        return [{ photo, utc: toUtc(photo.time, zone, photo.offset) }];
      } catch {
        unresolved.push(photo.id);
        return [];
      }
    })
    .sort((a, b) => Date.parse(a.utc) - Date.parse(b.utc));
  const clusters: (typeof timed)[] = [];
  for (const item of timed) {
    const group = clusters.at(-1),
      first = group?.[0],
      last = group?.at(-1);
    const a = first && coordinates(first.photo),
      b = coordinates(item.photo);
    // Compare to the group's first coordinate, not just the previous point, to avoid geographic drift.
    if (
      group &&
      first &&
      last &&
      a &&
      b &&
      Date.parse(item.utc) - Date.parse(last.utc) <= gapMinutes * 60000 &&
      roughWalk(a, b).estimatedDistance <= radius
    )
      group.push(item);
    else clusters.push([item]);
  }
  return {
    groups: clusters.map((group) => makePhotoGroup(group.map((item) => item.photo))),
    unresolved,
  };
}
export async function namePhotoGroups(
  groups: PhotoGroup[],
  progress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
  roles: readonly ('startLocation' | 'endLocation')[] = ['startLocation', 'endLocation']
) {
  let unavailable = !geoKey,
    failed = false;
  const output: PhotoGroup[] = [];
  for (const [i, group] of groups.entries()) {
    const next = {
      ...group,
      startLocation: { ...group.startLocation },
      endLocation: { ...group.endLocation },
    };
    if (shouldStop?.()) unavailable = true;
    if (!unavailable) {
      const named = await Promise.all(
        roles.map(async (key) => {
          const point = coordinates(next[key]);
          if (!point) return;
          try {
            const result = await geoapify.reverse(point.latitude, point.longitude);
            return { key, result };
          } catch {
            unavailable = true;
            failed = true;
            return;
          }
        })
      );
      for (const item of named)
        if (item) {
          next[item.key] = {
            ...next[item.key],
            name: item.result.name,
            address: item.result.address,
          };
          if (item.key === 'startLocation' && next.title === '照片地点（待核对）')
            next.title = item.result.name;
        }
    }
    output.push(next);
    progress?.(i + 1, groups.length);
  }
  return {
    groups: output,
    notice: failed
      ? '地名服务暂不可用，已保留坐标；可重试识别地名或手动修改。'
      : !geoKey
        ? '当前未配置地名服务，保留坐标供手动填写。'
        : '地名来自坐标附近的地址，请核对实际地点；未推测交通方式或未拍照的时段。',
  };
}
export function setGroupAnchor(
  group: PhotoGroup,
  role: 'start' | 'end',
  photo?: PhotoDraft
): PhotoGroup {
  const next = { ...group, [role === 'start' ? 'startPhotoId' : 'endPhotoId']: photo?.id || '' };
  if (photo) {
    const other = role === 'start' ? 'endPhotoId' : 'startPhotoId';
    if (next[other] === photo.id) next[other] = '';
    if (role === 'start') {
      next.start = photo.time || group.start;
      next.startOffset = photo.offset;
      next.startLocation = coordinates(photo) ? locationFromPhoto(photo) : group.startLocation;
    } else {
      next.end = photo.time || group.end;
      next.endOffset = photo.offset;
      next.endLocation = coordinates(photo) ? locationFromPhoto(photo) : group.endLocation;
    }
  }
  return next;
}
export function autoDateRange(groups: PhotoGroup[], zone: string) {
  const times = groups.flatMap((g) => [
    toUtc(g.start, zone, g.startOffset),
    toUtc(g.end, zone, g.endOffset),
  ]);
  if (!times.length) return;
  times.sort();
  return {
    start: DateTime.fromISO(times[0]).setZone(zone).toISODate()!,
    end: DateTime.fromISO(times.at(-1)!).setZone(zone).toISODate()!,
  };
}
export function appendPhotoTimeline(doc: TripDocument, draft: PhotoAutoDraft, zone: string) {
  if (draft.dirty) throw new Error('照片信息或合并规则已改变，请先按纠正信息重新分组');
  if (!draft.groups.length) throw new Error('请上传照片并生成至少一段可用记录');
  const included = draft.photos.filter((p) => !p.excluded),
    assigned = draft.groups.flatMap((g) => g.photoIds);
  if (
    new Set(assigned).size !== assigned.length ||
    assigned.length !== included.length ||
    included.some((p) => !assigned.includes(p.id))
  )
    throw new Error('部分照片尚未分组，请修正缺失时间或勾选暂不导入，再重新分组');
  const photos: Photo[] = [],
    entries: Entry[] = [],
    places = [...doc.places];
  function placeId(location: DraftLocation) {
    const point = coordinates(location);
    if (!point) {
      if (location.latitude || location.longitude)
        throw new Error('请填写完整有效的经纬度，或同时清空');
      return;
    }
    const name = location.name.trim() || '照片地点（待核对）';
    const existing = places.find(
      (p) =>
        Math.abs(p.latitude - point.latitude) < 1e-7 &&
        Math.abs(p.longitude - point.longitude) < 1e-7 &&
        p.name === name
    );
    if (existing) return existing.id;
    const place: Place = {
      id: uuid(),
      tripId: doc.trip.id,
      ownerId: doc.trip.ownerId,
      ...point,
      name,
      address: location.address,
      category: 'place',
    };
    places.push(place);
    return place.id;
  }
  for (const group of draft.groups) {
    const startAtUtc = toUtc(group.start, zone, group.startOffset),
      endAtUtc = toUtc(group.end, zone, group.endOffset);
    if (Date.parse(endAtUtc) < Date.parse(startAtUtc))
      throw new Error('分组结束时间早于开始时间，请纠正锚定照片或时间');
    const moment = startAtUtc === endAtUtc;
    const startPlace = placeId(group.startLocation),
      endPlace = moment ? undefined : placeId(group.endLocation);
    if (!moment && !startPlace)
      throw new Error('有持续时间的分组需填写开始地点；无 GPS 的单张照片可作为照片随记');
    if (
      (group.startPhotoId && !group.photoIds.includes(group.startPhotoId)) ||
      (group.endPhotoId && !group.photoIds.includes(group.endPhotoId))
    )
      throw new Error('锚定照片必须属于该分组');
    if (group.startPhotoId && group.startPhotoId === group.endPhotoId)
      throw new Error('同一张照片不能同时作为开始和结束锚点');
    entries.push({
      id: group.id,
      tripId: doc.trip.id,
      ownerId: doc.trip.ownerId,
      type: moment ? 'moment' : 'stay',
      title: group.title.trim() || group.startLocation.name || '照片随记',
      startAtUtc,
      endAtUtc,
      timezone: zone,
      endTimezone: zone,
      placeId: startPlace,
      endPlaceId: endPlace,
      activityType: '游览',
      notes: group.notes,
      updatedAt: now(),
    });
    for (const [index, id] of group.photoIds.entries()) {
      const photo = included.find((p) => p.id === id);
      if (!photo) throw new Error('分组中照片不存在');
      const role =
        id === group.startPhotoId
          ? 'start'
          : !moment && id === group.endPhotoId
            ? 'end'
            : undefined;
      photos.push({
        id,
        ownerId: doc.trip.ownerId,
        tripId: doc.trip.id,
        entryId: group.id,
        takenAt:
          role === 'start'
            ? startAtUtc
            : role === 'end'
              ? endAtUtc
              : toUtc(photo.time, zone, photo.offset),
        anchorRole: role,
        storagePath: `${doc.trip.ownerId}/${doc.trip.id}/${id}`,
        caption: photo.fileName.slice(0, 1000),
        sortOrder: index,
        mimeType: 'image/jpeg',
      });
    }
  }
  const range = autoDateRange(draft.groups, zone)!;
  const next = documentSchema.parse({
    ...doc,
    trip: {
      ...doc.trip,
      startDate: [doc.trip.startDate, range.start].sort()[0],
      endDate: [doc.trip.endDate, range.end].sort().at(-1)!,
      updatedAt: now(),
    },
    entries: [...doc.entries, ...entries],
    photos: [...doc.photos, ...photos],
    places,
  });
  return { doc: next, photos, blobs: new Map(included.map((p) => [p.id, p.blob])) };
}
export function draftTimeLabel(photo: PhotoDraft, zone: string) {
  try {
    return localInput(toUtc(photo.time, zone, photo.offset), zone).replace('T', ' ');
  } catch {
    return '拍摄时间待纠正';
  }
}
