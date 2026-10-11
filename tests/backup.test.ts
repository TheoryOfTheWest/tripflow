import JSZip from 'jszip';
import { afterEach, expect, it } from 'vitest';
import { db, putPhoto } from '../src/services/repository';
import { sampleDocument } from '../src/lib/fixture';
import { exportZip, readBackup, importBackup } from '../src/services/backup';
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
