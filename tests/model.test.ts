import { describe, expect, it } from 'vitest';
import { backupSchema, documentSchema, removeEntry, upsertEntry } from '../src/models';
import { sampleDocument } from '../src/lib/fixture';
import { backupData, rebindDocument } from '../src/services/backup';
describe('validated CRUD and backups', () => {
  it('upserts an entry, retains reusable places and deletes by identity', () => {
    let doc = sampleDocument('local-demo'),
      e = { ...doc.entries[0], title: '修改后的活动' };
    doc = upsertEntry(doc, e, [doc.places[0]]);
    expect(doc.entries.find((v) => v.id === e.id)?.title).toBe(e.title);
    expect(doc.places).toHaveLength(9);
    doc = removeEntry(doc, e.id);
    expect(doc.entries.some((v) => v.id === e.id)).toBe(false);
  });
  it('rejects invalid coordinates, dangling references and foreign owners', () => {
    const doc = sampleDocument('local-demo');
    expect(() =>
      documentSchema.parse({ ...doc, places: [{ ...doc.places[0], latitude: 999 }] })
    ).toThrow();
    expect(() =>
      documentSchema.parse({
        ...doc,
        entries: [{ ...doc.entries[0], placeId: crypto.randomUUID() }],
      })
    ).toThrow();
    expect(() =>
      documentSchema.parse({ ...doc, entries: [{ ...doc.entries[0], ownerId: 'someone-else' }] })
    ).toThrow();
  });
  it('rejects impossible date ranges and out of range entries', () => {
    const doc = sampleDocument('local-demo');
    expect(() =>
      documentSchema.parse({ ...doc, trip: { ...doc.trip, endDate: '2026-10-16' } })
    ).toThrow();
    expect(() =>
      documentSchema.parse({ ...doc, trip: { ...doc.trip, startDate: '2026-02-30' } })
    ).toThrow();
  });
  it('JSON export and parse preserves all records and routes', () => {
    const doc = sampleDocument('local-demo'),
      b = backupData([doc]);
    expect(backupSchema.parse(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(() => backupSchema.parse({ ...b, version: 99 })).toThrow();
  });
  it('rebinds imported records to current owner with new IDs', () => {
    const source = sampleDocument('local-demo'),
      copy = rebindDocument(source, 'new-owner', new Set());
    expect(copy.trip.id).not.toBe(source.trip.id);
    expect(copy.trip.ownerId).toBe('new-owner');
    expect(copy.entries[0].placeId).toBe(copy.places[0].id);
    expect(copy.entries[0].id).not.toBe(source.entries[0].id);
  });
  it('rejects a privileged storage path embedded in an imported photo', () => {
    const doc = sampleDocument('local-demo');
    expect(() =>
      documentSchema.parse({
        ...doc,
        photos: [
          {
            id: crypto.randomUUID(),
            ownerId: 'local-demo',
            tripId: doc.trip.id,
            entryId: doc.entries[0].id,
            takenAt: doc.entries[0].startAtUtc,
            storagePath: 'other-user/private/photo',
            caption: '',
            sortOrder: 0,
            mimeType: 'image/jpeg',
          },
        ],
      })
    ).toThrow();
  });
});
