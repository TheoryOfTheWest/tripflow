import { describe, expect, it } from 'vitest';
import { sampleDocument } from '../src/lib/fixture';
import { backupData, rebindDocument } from '../src/services/backup';
import {
  groupPhotos,
  setGroupAnchor,
  appendPhotoTimeline,
  emptyAutoDraft,
  coordinates,
  autoDateRange,
  type PhotoDraft,
} from '../src/services/photoTimeline';
const zone = 'Asia/Tokyo';
const photo = (time: string, latitude = '35', longitude = '135'): PhotoDraft => ({
  id: crypto.randomUUID(),
  fileName: 'synthetic.jpg',
  blob: new Blob(['test']),
  time,
  latitude,
  longitude,
  warnings: [],
  excluded: false,
});
const base = () => ({ ...sampleDocument('local-demo'), photos: [], entries: [], places: [] });
const draft = (photos: PhotoDraft[]) => ({
  ...emptyAutoDraft(),
  photos,
  groups: groupPhotos(photos, zone).groups,
});

describe('photo-generated timeline', () => {
  it('orders photos by actual time and condenses a large continuous visit into exactly two anchors', () => {
    const photos = Array.from({ length: 25 }, (_, i) =>
      photo(`2026-10-16T09:${String(i).padStart(2, '0')}:10`)
    ).reverse();
    const value = draft(photos);
    expect(value.groups).toHaveLength(1);
    expect(value.groups[0].startPhotoId).toBe(photos.at(-1)!.id);
    expect(value.groups[0].endPhotoId).toBe(photos[0].id);
    const result = appendPhotoTimeline(base(), value, zone);
    expect(result.doc.entries).toHaveLength(1);
    expect(result.doc.photos).toHaveLength(25);
    expect(result.doc.photos.filter((p) => p.anchorRole)).toHaveLength(2);
    expect(result.doc.entries[0].startAtUtc).toBe('2026-10-16T00:00:10.000Z');
    expect(result.blobs.size).toBe(25);
  });
  it('separates long gaps, distinct places and later return visits without merging by name alone', () => {
    const photos = [
      photo('2026-10-16T09:00:00'),
      photo('2026-10-16T09:15:00', '36'),
      photo('2026-10-16T09:30:00'),
      photo('2026-10-16T12:00:00'),
    ];
    expect(groupPhotos(photos, zone).groups).toHaveLength(4);
    expect(groupPhotos([photos[0], photos[3]], zone, 200, 240).groups).toHaveLength(1);
    expect(() => groupPhotos(photos, zone, 0, 90)).toThrow();
  });
  it('prevents chained coordinate drift and accepts zero coordinates', () => {
    const photos = [
      photo('2026-10-16T09:00:00', '0', '0'),
      photo('2026-10-16T09:01:00', '0.001', '0'),
      photo('2026-10-16T09:02:00', '0.002', '0'),
    ];
    expect(groupPhotos(photos, zone, 150).groups.map((g) => g.photoIds.length)).toEqual([2, 1]);
    expect(coordinates(photos[0])).toEqual({ latitude: 0, longitude: 0 });
    expect(coordinates({ ...photos[0], latitude: '' })).toBeUndefined();
    expect(coordinates({ ...photos[0], latitude: '91' })).toBeUndefined();
  });
  it('keeps photos without GPS as independent moments and requires correction or explicit exclusion of missing times', () => {
    const photos = [
      photo('2026-10-16T09:00:00', '', ''),
      photo('2026-10-16T09:01:00', '', ''),
      photo('', '', ''),
    ];
    const value = draft(photos);
    expect(value.groups).toHaveLength(2);
    expect(() => appendPhotoTimeline(base(), value, zone)).toThrow('尚未分组');
    photos[2].excluded = true;
    const result = appendPhotoTimeline(base(), draft(photos), zone);
    expect(result.doc.entries.every((e) => e.type === 'moment' && !e.placeId)).toBe(true);
    expect(result.doc.photos).toHaveLength(2);
  });
  it('allows changing and removing selected anchors while preserving intermediate attachments and confirmed edits', () => {
    const photos = [
      photo('2026-10-16T09:00:00'),
      photo('2026-10-16T09:20:00'),
      photo('2026-10-16T09:40:00'),
    ];
    const value = draft(photos);
    value.groups[0] = setGroupAnchor(value.groups[0], 'start', photos[1]);
    expect(value.groups[0].start).toBe(photos[1].time);
    value.groups[0] = setGroupAnchor(value.groups[0], 'end');
    expect(value.groups[0].end).toBe(photos[2].time);
    value.groups[0].end = '2026-10-16T10:10:11';
    value.groups[0].startLocation.name = '手动纠正地名';
    const result = appendPhotoTimeline(base(), value, zone).doc;
    expect(result.photos).toHaveLength(3);
    expect(result.photos.filter((p) => p.anchorRole)).toHaveLength(1);
    expect(result.photos.find((p) => p.id === photos[0].id)?.anchorRole).toBeUndefined();
    expect(result.places.find((p) => p.id === result.entries[0].placeId)?.name).toBe(
      '手动纠正地名'
    );
    expect(result.entries[0].endAtUtc).toBe('2026-10-16T01:10:11.000Z');
  });
  it('retains existing records and v1 backup relations when appending to a trip', () => {
    const existing = sampleDocument('local-demo'),
      photos = [photo('2026-10-16T09:00:00'), photo('2026-10-16T09:20:00')];
    const result = appendPhotoTimeline(existing, draft(photos), zone).doc;
    expect(result.entries.slice(0, existing.entries.length)).toEqual(existing.entries);
    expect(backupData([result]).version).toBe(1);
    const rebound = rebindDocument(result, 'local-demo', new Set(result.photos.map((p) => p.id)));
    const appended = rebound.entries.at(-1)!;
    expect(rebound.photos.filter((p) => p.entryId === appended.id && p.anchorRole)).toHaveLength(2);
    expect(rebound.places.some((p) => p.id === appended.endPlaceId)).toBe(true);
  });
  it('rejects stale, unassigned, duplicated and reversed drafts before writing attachments', () => {
    const photos = [photo('2026-10-16T09:00:00'), photo('2026-10-16T09:20:00')],
      value = draft(photos);
    expect(() => appendPhotoTimeline(base(), { ...value, dirty: true }, zone)).toThrow('重新分组');
    expect(() =>
      appendPhotoTimeline(base(), { ...value, groups: [...value.groups, ...value.groups] }, zone)
    ).toThrow('尚未分组');
    value.groups[0].end = '2026-10-16T08:00:00';
    expect(() => appendPhotoTimeline(base(), value, zone)).toThrow('早于');
  });
  it('requires DST disambiguation and keeps a UTC-sorted fallback-hour interval', () => {
    const first = photo('2026-11-01T01:30:00'),
      last = photo('2026-11-01T01:15:00');
    expect(groupPhotos([first], 'America/New_York').unresolved).toEqual([first.id]);
    first.offset = -240;
    last.offset = -300;
    const result = groupPhotos([last, first], 'America/New_York');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].startPhotoId).toBe(first.id);
    expect(autoDateRange(result.groups, 'America/New_York')).toEqual({
      start: '2026-11-01',
      end: '2026-11-01',
    });
  });
});
