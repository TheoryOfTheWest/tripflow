import { afterEach, describe, expect, it } from 'vitest';
import {
  db,
  loadDocuments,
  saveDocument,
  deleteDocument,
  LOCAL_OWNER,
  putPhoto,
  getPhotoBlob,
} from '../src/services/repository';
import { sampleDocument } from '../src/lib/fixture';
import type { Photo } from '../src/models';
afterEach(async () => {
  await db.documents.clear();
  await db.attachments.clear();
});
describe('IndexedDB local persistence', () => {
  it('rejects a stale local edit instead of overwriting another window', async () => {
    const saved = await saveDocument(sampleDocument(LOCAL_OWNER));
    await saveDocument({ ...saved, trip: { ...saved.trip, title: '另一窗口已保存' } });
    await expect(saveDocument(saved)).rejects.toThrow('另一窗口修改');
    expect((await loadDocuments(LOCAL_OWNER))[0].trip.title).toBe('另一窗口已保存');
  });
  it('creates, reloads, updates and deletes a real stored trip', async () => {
    const doc = sampleDocument(LOCAL_OWNER);
    const saved = await saveDocument(doc);
    expect(saved.revision).toBe(1);
    expect((await loadDocuments(LOCAL_OWNER))[0].entries).toEqual(doc.entries);
    const updated = await saveDocument({ ...saved, trip: { ...saved.trip, title: '新旅行名' } });
    expect(updated.revision).toBe(2);
    expect((await loadDocuments(LOCAL_OWNER))[0].trip.title).toBe('新旅行名');
    await deleteDocument(updated);
    expect(await loadDocuments(LOCAL_OWNER)).toEqual([]);
  });
  it('stores real photo blobs and cleans them after trip deletion', async () => {
    const doc = sampleDocument(LOCAL_OWNER),
      id = crypto.randomUUID();
    const photo: Photo = {
      id,
      tripId: doc.trip.id,
      ownerId: LOCAL_OWNER,
      entryId: doc.entries[0].id,
      storagePath: `${LOCAL_OWNER}/${doc.trip.id}/${id}`,
      caption: 'test',
      takenAt: doc.entries[0].startAtUtc,
      sortOrder: 0,
      mimeType: 'image/png',
    };
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    await putPhoto(photo, blob);
    const saved = await saveDocument({ ...doc, photos: [photo] });
    expect((await getPhotoBlob(photo)).size).toBe(blob.size);
    await deleteDocument(saved);
    expect(await db.attachments.get(photo.storagePath)).toBeUndefined();
  });
});
