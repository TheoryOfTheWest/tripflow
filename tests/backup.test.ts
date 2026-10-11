import JSZip from 'jszip';
import { afterEach, expect, it } from 'vitest';
import { db, putPhoto } from '../src/services/repository';
import { sampleDocument } from '../src/lib/fixture';
import {
  exportZip,
  exportTripArchive,
  tripArchiveName,
  readBackup,
  importBackup,
} from '../src/services/backup';
import type { Photo } from '../src/models';
afterEach(async () => {
  await db.documents.clear();
  await db.attachments.clear();
});
it('exports actual image bytes to ZIP and restores photo references to new identities', async () => {
  const doc = sampleDocument('local-demo'),
    id = crypto.randomUUID();
  const photo: Photo = {
    id,
    ownerId: 'local-demo',
    tripId: doc.trip.id,
    entryId: doc.entries[0].id,
    takenAt: doc.entries[0].startAtUtc,
    storagePath: `local-demo/${doc.trip.id}/${id}`,
    mimeType: 'image/png',
    caption: 'photo',
    sortOrder: 0,
  };
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await putPhoto(photo, new Blob([bytes], { type: 'image/png' }));
  doc.photos.push(photo);
  const blob = await exportZip([doc]),
    zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(await zip.file(`photos/${id}`)!.async('uint8array')).toEqual(bytes);
  const read = await readBackup(new File([blob], 'backup.zip'));
  const imported = (await importBackup(read, 'local-demo'))[0];
  expect(imported.photos[0].caption).toBe('photo');
  expect(imported.photos[0].missing).toBe(false);
  expect(imported.photos[0].entryId).toBe(imported.entries[0].id);
  expect(imported.trip.id).not.toBe(doc.trip.id);
});
it('fails a full export when actual photos are unavailable', async () => {
  const doc = sampleDocument('local-demo'),
    id = crypto.randomUUID();
  doc.photos.push({
    id,
    ownerId: 'local-demo',
    tripId: doc.trip.id,
    entryId: null,
    takenAt: doc.trip.createdAt,
    storagePath: `local-demo/${doc.trip.id}/${id}`,
    mimeType: 'image/png',
    caption: '',
    sortOrder: 0,
    missing: true,
  });
  await expect(exportZip([doc])).rejects.toThrow('ZIP');
});
it('rejects extra archive content and executable image payloads', async () => {
  const zip = new JSZip();
  zip.file(
    'tripflow.json',
    JSON.stringify({
      format: 'tripflow',
      version: 1,
      exportedAt: new Date().toISOString(),
      documents: [],
    })
  );
  zip.file('unexpected.html', '<script>alert(1)</script>');
  await expect(
    readBackup(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'backup.zip'))
  ).rejects.toThrow('未识别');
});

it('archives only one journey with escaped offline photo pages and restores the full v1 data', async () => {
  const doc = sampleDocument('local-demo');
  doc.trip.title = '旅程 <script>alert(1)</script>';
  doc.trip.notes = '<img src="https://invalid.example/x" onerror="alert(1)">';
  const photo: Photo = {
    id: crypto.randomUUID(),
    ownerId: 'local-demo',
    tripId: doc.trip.id,
    entryId: null,
    takenAt: doc.trip.createdAt,
    storagePath: '',
    mimeType: 'image/png',
    caption: '<script>照片说明</script>',
    sortOrder: 0,
  };
  photo.storagePath = `local-demo/${doc.trip.id}/${photo.id}`;
  doc.photos.push(photo);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await putPhoto(photo, new Blob([bytes], { type: 'image/png' }));
  const blob = await exportTripArchive(doc);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const html = await zip.file('旅程回顾.html')!.async('string');
  const dom = new DOMParser().parseFromString(html, 'text/html');
  expect(dom.querySelector('h1')?.textContent).toBe(doc.trip.title);
  expect(dom.querySelectorAll('script, iframe')).toHaveLength(0);
  expect(dom.querySelector('img')?.getAttribute('src')).toBe(`photos/${photo.id}`);
  expect(dom.querySelector('figcaption')?.textContent).toBe(photo.caption);
  expect(
    dom.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
  ).toContain("default-src 'none'");
  expect(await zip.file('使用说明.txt')!.async('string')).toContain('确认导入为新旅行');
  const read = await readBackup(new File([blob], 'journey.zip'));
  expect(read.backup.version).toBe(1);
  expect(read.backup.documents).toEqual([doc]);
  const restored = (await importBackup(read, 'local-demo'))[0];
  const transportDetails = (document: typeof doc) =>
    document.entries.map((entry) =>
      entry.transport
        ? {
            ...entry.transport,
            boardingStationId: document.places.find(
              (place) => place.id === entry.transport?.boardingStationId
            )?.name,
            alightingStationId: document.places.find(
              (place) => place.id === entry.transport?.alightingStationId
            )?.name,
          }
        : undefined
    );
  expect(transportDetails(restored)).toEqual(transportDetails(doc));
  expect(restored.photos[0].missing).toBe(false);
  expect(restored.photos[0].entryId).toBeNull();
  expect(restored.trip.id).not.toBe(doc.trip.id);
});
it('rejects an archive with a missing or oversized photo rather than downloading an unrestorable file', async () => {
  const doc = sampleDocument('local-demo');
  const id = crypto.randomUUID();
  const photo: Photo = {
    id,
    ownerId: 'local-demo',
    tripId: doc.trip.id,
    entryId: null,
    takenAt: doc.trip.createdAt,
    storagePath: `local-demo/${doc.trip.id}/${id}`,
    mimeType: 'image/png',
    caption: '',
    sortOrder: 0,
  };
  doc.photos.push(photo);
  await expect(exportTripArchive(doc)).rejects.toThrow();
  await putPhoto(photo, new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' }));
  await expect(exportTripArchive(doc)).rejects.toThrow('8 MB');
});
it('uses a filesystem-safe journey title, travel dates and timestamp for each archive filename', () => {
  const doc = sampleDocument('local-demo');
  doc.trip.title = '京都 / 大阪: 旅程?';
  const filename = tripArchiveName(doc, '2026-10-12T01:02:03.000Z');
  expect(filename).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
  expect(filename).toContain(doc.trip.startDate);
  expect(filename).toContain('2026-10-12T01-02-03-000Z.zip');
});
