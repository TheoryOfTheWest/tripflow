import JSZip from 'jszip';
import { backupSchema, documentSchema, now, uuid, type Backup, type TripDocument } from '../models';
import { getPhotoBlob, putPhoto, saveDocument, deletePhotos } from './repository';
export function backupData(documents: TripDocument[]): Backup {
  return backupSchema.parse({ format: 'tripflow', version: 1, exportedAt: now(), documents });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportZip(documents: TripDocument[]) {
  const zip = new JSZip();
  zip.file('tripflow.json', JSON.stringify(backupData(documents), null, 2));
  for (const doc of documents)
    for (const p of doc.photos) {
      // Fail loudly instead of silently producing an incomplete "full" backup.
      zip.file(`photos/${p.id}`, await (await getPhotoBlob(p)).arrayBuffer());
    }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
function photoMime(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  throw new Error('备份含不支持的图片格式');
}
export async function readBackup(
  file: File
): Promise<{ backup: Backup; blobs: Map<string, Blob> }> {
  if (file.size > 100 * 1024 * 1024) throw new Error('单次导入文件上限为 100 MB');
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return { backup: backupSchema.parse(JSON.parse(await file.text())), blobs: new Map() };
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > 5001) throw new Error('ZIP 文件数过多');
  // Reject decompression bombs before inflate using central-directory sizes.
  let expanded = 0;
  for (const f of files) {
    const size = (f as unknown as { _data: { uncompressedSize: number } })._data?.uncompressedSize;
    if (!Number.isFinite(size) || size > 10 * 1024 * 1024) throw new Error('ZIP 内文件过大或无效');
    expanded += size;
  }
  if (expanded > 200 * 1024 * 1024) throw new Error('ZIP 解压后不能超过 200 MB');
  const json = zip.file('tripflow.json');
  if (!json) throw new Error('ZIP 中缺少 tripflow.json');
  const backup = backupSchema.parse(JSON.parse(await json.async('string')));
  const blobs = new Map<string, Blob>();
  const allowed = new Set([
    'tripflow.json',
    ...backup.documents.flatMap((d) => d.photos.map((p) => `photos/${p.id}`)),
  ]);
  for (const f of files) if (!allowed.has(f.name)) throw new Error(`ZIP 含未识别文件：${f.name}`);
  for (const doc of backup.documents)
    for (const p of doc.photos) {
      const f = zip.file(`photos/${p.id}`);
      if (!f) throw new Error(`ZIP 缺少照片：${p.id}`);
      const bytes = await f.async('uint8array'),
        mime = photoMime(bytes);
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('备份中的单张照片不能超过 8 MB');
      if (mime !== p.mimeType) throw new Error('照片类型与元数据不一致');
      blobs.set(p.id, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    }
  return { backup, blobs };
}
// Import as new trips, never overwrite an existing trip or reuse a foreign storage path.
export function rebindDocument(doc: TripDocument, ownerId: string, available: Set<string>) {
  const tripId = uuid();
  const ids = new Map([...doc.places, ...doc.entries, ...doc.photos].map((v) => [v.id, uuid()]));
  const ref = (v?: string | null) => (v ? ids.get(v) : undefined);
  return documentSchema.parse({
    trip: {
      ...doc.trip,
      id: tripId,
      ownerId,
      coverPhotoId: ref(doc.trip.coverPhotoId),
      createdAt: now(),
      updatedAt: now(),
    },
    revision: 0,
    places: doc.places.map((p) => ({ ...p, id: ids.get(p.id), tripId, ownerId })),
    entries: doc.entries.map((e) => ({
      ...e,
      id: ids.get(e.id),
      tripId,
      ownerId,
      placeId: ref(e.placeId),
      originPlaceId: ref(e.originPlaceId),
      destinationPlaceId: ref(e.destinationPlaceId),
      transport: e.transport
        ? {
            ...e.transport,
            boardingStationId: ref(e.transport.boardingStationId),
            alightingStationId: ref(e.transport.alightingStationId),
          }
        : undefined,
    })),
    photos: doc.photos.map((p) => ({
      ...p,
      id: ids.get(p.id),
      tripId,
      ownerId,
      entryId: ref(p.entryId) ?? null,
      storagePath: `${ownerId}/${tripId}/${ids.get(p.id)}`,
      missing: !available.has(p.id),
    })),
  });
}
export async function importBackup(data: Awaited<ReturnType<typeof readBackup>>, ownerId: string) {
  const saved: TripDocument[] = [];
  try {
    for (const source of data.backup.documents) {
      const doc = rebindDocument(source, ownerId, new Set(data.blobs.keys()));
      const uploaded = [];
      let saveAttempted = false;
      try {
        for (let i = 0; i < doc.photos.length; i++) {
          const blob = data.blobs.get(source.photos[i].id);
          if (blob) {
            await putPhoto(doc.photos[i], blob);
            uploaded.push(doc.photos[i]);
          }
        }
        saveAttempted = true;
        saved.push(await saveDocument(doc));
      } catch (error) {
        if (!saveAttempted || ownerId === 'local-demo') await deletePhotos(uploaded);
        throw error;
      }
    }
  } catch (e) {
    throw new Error(
      `导入中止，已确认导入 ${saved.length} 段旅行。请刷新核对最后一段的保存结果后再重试。${e instanceof Error ? e.message : ''}`
    );
  }
  return saved;
}
