import Dexie, { type Table } from 'dexie';
import { createClient } from '@supabase/supabase-js';
import { documentSchema, type TripDocument, type Photo } from '../models';

export const LOCAL_OWNER = 'local-demo';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (key?.startsWith('sb_secret_')) throw new Error('前端禁止使用 Supabase Secret Key');
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;
export const db = new Dexie('tripflow-v1') as Dexie & {
  documents: Table<{ key: string; ownerId: string; doc: TripDocument }>;
  attachments: Table<{ path: string; blob: Blob }>;
};
db.version(1).stores({ documents: 'key, ownerId', attachments: 'path' });
const cacheKey = (doc: TripDocument) => `${doc.trip.ownerId}:${doc.trip.id}`;
export async function cachedDocuments(ownerId: string) {
  return (await db.documents.where('ownerId').equals(ownerId).toArray()).map((r) =>
    documentSchema.parse(r.doc)
  );
}
export async function loadDocuments(ownerId: string): Promise<TripDocument[]> {
  if (ownerId === LOCAL_OWNER) return cachedDocuments(ownerId);
  if (!supabase) throw new Error('Supabase 尚未配置');
  const { data, error } = await supabase
    .from('trips')
    .select('data,revision')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`云端读取失败：${error.message}`);
  const docs = data.map((r) => documentSchema.parse({ ...r.data, revision: r.revision }));
  if (docs.some((d) => d.trip.ownerId !== ownerId)) throw new Error('云端账户校验失败');
  await db
    .transaction('rw', db.documents, async () => {
      await db.documents.where('ownerId').equals(ownerId).delete();
      await db.documents.bulkPut(docs.map((doc) => ({ key: cacheKey(doc), ownerId, doc })));
    })
    .catch(() => {}); // Successful cloud reads do not depend on cache quota.
  return docs;
}
export async function saveDocument(input: TripDocument): Promise<TripDocument> {
  const parsed = documentSchema.parse(input);
  const doc = { ...parsed, revision: parsed.revision + 1 };
  if (doc.trip.ownerId !== LOCAL_OWNER) {
    if (!supabase || !navigator.onLine)
      throw new Error('当前无法连接云端，未保存。请保持编辑窗口并在联网后重试');
    const row = {
      id: doc.trip.id,
      owner_id: doc.trip.ownerId,
      data: doc,
      revision: doc.revision,
      updated_at: new Date().toISOString(),
    };
    const result =
      parsed.revision === 0
        ? await supabase.from('trips').insert(row).select('revision').single()
        : await supabase
            .from('trips')
            .update(row)
            .eq('id', doc.trip.id)
            .eq('revision', parsed.revision)
            .select('revision')
            .maybeSingle();
    if (result.error) throw new Error(`云端未保存：${result.error.message}`);
    if (!result.data) throw new Error('另一设备已修改此旅行。请关闭编辑并刷新云端数据，再重新编辑');
  }
  try {
    await db.transaction('rw', db.documents, async () => {
      if (doc.trip.ownerId === LOCAL_OWNER) {
        const existing = await db.documents.get(cacheKey(doc));
        if ((existing?.doc.revision ?? 0) !== parsed.revision)
          throw new Error('此旅行已在另一窗口修改，请刷新后重试');
      }
      await db.documents.put({ key: cacheKey(doc), ownerId: doc.trip.ownerId, doc });
    });
  } catch (e) {
    if (doc.trip.ownerId === LOCAL_OWNER)
      throw e; /* Cloud is authoritative even if cache quota is exhausted. */
  }
  return doc;
}
export async function deleteDocument(doc: TripDocument) {
  if (doc.trip.ownerId !== LOCAL_OWNER) {
    if (!supabase || !navigator.onLine) throw new Error('离线时不能删除云端旅行');
    const { data, error } = await supabase
      .from('trips')
      .delete()
      .eq('id', doc.trip.id)
      .eq('revision', doc.revision)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data.length) throw new Error('旅行已在另一设备修改，请刷新后重试');
  }
  try {
    await db.documents.delete(cacheKey(doc));
  } catch (e) {
    if (doc.trip.ownerId === LOCAL_OWNER) throw e;
  }
  return deletePhotos(doc.photos);
}
export async function putPhoto(photo: Photo, blob: Blob) {
  if (photo.ownerId !== LOCAL_OWNER) {
    if (!supabase) throw new Error('未配置云端照片存储');
    const { error } = await supabase.storage
      .from('tripflow-photos')
      .upload(photo.storagePath, blob, { contentType: photo.mimeType, upsert: false });
    if (error) throw new Error(`照片未上传：${error.message}`);
    // Blob cache is optional after the server acknowledges upload.
    try {
      await db.attachments.put({ path: photo.storagePath, blob });
    } catch {
      /* cache quota */
    }
  } else await db.attachments.put({ path: photo.storagePath, blob });
}
export async function getPhotoBlob(photo: Photo): Promise<Blob> {
  if (photo.missing) throw new Error('此照片仅恢复了元数据，请使用完整 ZIP 备份恢复图片');
  const cached = await db.attachments.get(photo.storagePath);
  if (cached) return cached.blob;
  if (!supabase || photo.ownerId === LOCAL_OWNER) throw new Error('照片文件不可用');
  const { data, error } = await supabase.storage
    .from('tripflow-photos')
    .download(photo.storagePath);
  if (error) throw new Error(error.message);
  try {
    await db.attachments.put({ path: photo.storagePath, blob: data });
  } catch {
    /* cache quota */
  }
  return data;
}
export async function deletePhotos(photos: Photo[]): Promise<string | undefined> {
  if (photos.length === 0) return;
  const remote = photos.filter((p) => p.ownerId !== LOCAL_OWNER && !p.missing);
  let warning: string | undefined;
  if (remote.length && supabase) {
    const { error } = await supabase.storage
      .from('tripflow-photos')
      .remove(remote.map((p) => p.storagePath));
    if (error) warning = '记录已保存，但部分云端图片清理失败，请在 Storage 检查孤立文件';
  }
  try {
    await db.attachments.bulkDelete(photos.map((p) => p.storagePath));
  } catch {
    warning = warning || '记录已保存，但本地照片缓存清理失败';
  }
  return warning;
}
export async function clearAccountCache(ownerId: string) {
  await db.documents.where('ownerId').equals(ownerId).delete();
  const paths = await db.attachments.toCollection().primaryKeys();
  await db.attachments.bulkDelete(paths.filter((p) => String(p).startsWith(`${ownerId}/`)));
}
