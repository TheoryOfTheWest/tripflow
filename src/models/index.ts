import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';

const id = z.string().uuid();
const owner = z.string().min(1).max(100);
const text = z.string().max(10000);
const instant = z
  .string()
  .refine((v) => /Z$/.test(v) && DateTime.fromISO(v).isValid, '需要有效的 UTC 时间');
const zone = z.string().refine((v) => IANAZone.isValidZone(v), '无效的 IANA 时区');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => DateTime.fromISO(v).isValid);
export const modes = {
  walk: '步行',
  subway: '地铁',
  rail: '铁路',
  bus: '公交',
  bicycle: '自行车',
  car: '汽车 / 出租车',
  plane: '飞机',
  ferry: '轮渡',
  other: '其他',
} as const;
const geometry = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z
    .array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2))
    .min(1),
});
export const placeSchema = z.object({
  id,
  ownerId: owner,
  tripId: id,
  name: z.string().trim().min(1).max(300),
  address: text,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  providerPlaceId: z.string().max(1000).optional(),
  category: z.enum(['place', 'station']).default('place'),
});
export const transportSchema = z.object({
  mode: z.enum(Object.keys(modes) as [keyof typeof modes, ...(keyof typeof modes)[]]),
  operatorName: text,
  lineName: text,
  boardingStationId: id.optional(),
  alightingStationId: id.optional(),
  transferNotes: text,
  estimatedDuration: z.number().nonnegative().optional(),
  estimatedDistance: z.number().nonnegative().optional(),
  actualDuration: z.number().nonnegative(),
  routeGeometry: geometry.optional(),
  routeSource: z.enum(['geoapify', 'gps', 'straight-line', 'manual', 'none']),
  walkingSpeedKmh: z.number().min(1).max(10).optional(),
});
export const entrySchema = z
  .object({
    id,
    ownerId: owner,
    tripId: id,
    type: z.enum(['stay', 'transport', 'moment']),
    title: z.string().trim().min(1).max(300),
    startAtUtc: instant,
    endAtUtc: instant,
    timezone: zone,
    endTimezone: zone,
    placeId: id.optional(),
    endPlaceId: id.optional(),
    originPlaceId: id.optional(),
    destinationPlaceId: id.optional(),
    activityType: z.string().max(100),
    notes: text,
    transport: transportSchema.optional(),
    updatedAt: instant,
  })
  .superRefine((v, ctx) => {
    const seconds = (Date.parse(v.endAtUtc) - Date.parse(v.startAtUtc)) / 1000;
    if (seconds < 0 || (v.type !== 'moment' && seconds === 0))
      ctx.addIssue({ code: 'custom', message: '结束时间必须晚于开始时间' });
    if (v.type === 'moment' && seconds !== 0)
      ctx.addIssue({ code: 'custom', message: '独立时间点的起止时间应相同' });
    if (v.type === 'transport' && !v.transport)
      ctx.addIssue({ code: 'custom', message: '缺少交通信息' });
    if (v.type !== 'transport' && v.transport)
      ctx.addIssue({ code: 'custom', message: '普通记录不能含交通详情' });
    if (v.transport && Math.abs(v.transport.actualDuration - seconds) > 0.001)
      ctx.addIssue({ code: 'custom', message: '实际交通时长不一致' });
    if (v.transport?.routeGeometry && !['gps', 'geoapify'].includes(v.transport.routeSource))
      ctx.addIssue({ code: 'custom', message: '路线几何必须注明可靠来源' });
  });
export const photoSchema = z.object({
  id,
  ownerId: owner,
  tripId: id,
  entryId: id.nullable(),
  takenAt: instant,
  storagePath: z.string().min(1).max(1000),
  caption: z.string().max(1000),
  sortOrder: z.number().int().nonnegative(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  missing: z.boolean().optional(),
  anchorRole: z.enum(['start', 'end']).optional(),
});
export const tripSchema = z
  .object({
    id,
    ownerId: owner,
    title: z.string().trim().min(1).max(150),
    startDate: day,
    endDate: day,
    defaultTimezone: zone,
    cover: z.enum(['mountain', 'coast', 'city', 'forest']),
    coverPhotoId: id.optional(),
    notes: text,
    createdAt: instant,
    updatedAt: instant,
  })
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      DateTime.fromISO(v.endDate).diff(DateTime.fromISO(v.startDate), 'days').days <= 365,
    '旅行日期须有序，最多 366 天'
  );
export const documentSchema = z
  .object({
    trip: tripSchema,
    places: z.array(placeSchema).max(10000),
    entries: z.array(entrySchema).max(20000),
    photos: z.array(photoSchema).max(5000),
    revision: z.number().int().nonnegative(),
  })
  .superRefine((doc, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    for (const list of [doc.places, doc.entries, doc.photos]) {
      if (new Set(list.map((v) => v.id)).size !== list.length) fail('ID 重复');
      for (const v of list)
        if (v.tripId !== doc.trip.id || v.ownerId !== doc.trip.ownerId)
          fail('记录所属旅行或账户不一致');
    }
    const places = new Set(doc.places.map((v) => v.id)),
      entries = new Set(doc.entries.map((v) => v.id));
    for (const e of doc.entries) {
      for (const ref of [
        e.placeId,
        e.endPlaceId,
        e.originPlaceId,
        e.destinationPlaceId,
        e.transport?.boardingStationId,
        e.transport?.alightingStationId,
      ])
        if (ref && !places.has(ref)) fail('地点引用不存在');
      const start = DateTime.fromISO(e.startAtUtc).setZone(doc.trip.defaultTimezone).toISODate()!;
      const end = DateTime.fromMillis(
        Math.max(Date.parse(e.startAtUtc), Date.parse(e.endAtUtc) - 1)
      )
        .setZone(doc.trip.defaultTimezone)
        .toISODate()!;
      if (start < doc.trip.startDate || end > doc.trip.endDate)
        fail('记录超出旅行日期，请先扩展旅行日期范围');
    }
    const anchorKeys = new Set<string>();
    for (const p of doc.photos) {
      if (p.anchorRole) {
        const key = `${p.entryId}:${p.anchorRole}`;
        if (!p.entryId || anchorKeys.has(key)) fail('每条记录的开始和结束锚定照片各最多一张');
        if (
          p.anchorRole === 'end' &&
          doc.entries.find((e) => e.id === p.entryId)?.type === 'moment'
        )
          fail('独立瞬间没有结束锚定节点');
        anchorKeys.add(key);
      }
      if (p.entryId && !entries.has(p.entryId)) fail('照片记录引用不存在');
      if (p.storagePath !== `${doc.trip.ownerId}/${doc.trip.id}/${p.id}`)
        fail('无效的照片存储路径');
    }
    if (doc.trip.coverPhotoId && !doc.photos.some((p) => p.id === doc.trip.coverPhotoId))
      fail('封面照片不存在');
  });
export const backupSchema = z
  .object({
    format: z.literal('tripflow'),
    version: z.literal(1),
    exportedAt: instant,
    documents: z.array(documentSchema).max(100),
  })
  .refine(
    (v) => new Set(v.documents.map((d) => d.trip.id)).size === v.documents.length,
    '旅行 ID 重复'
  );
export type Trip = z.infer<typeof tripSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Transport = z.infer<typeof transportSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type TripDocument = z.infer<typeof documentSchema>;
export type Backup = z.infer<typeof backupSchema>;
export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const newDocument = (trip: Trip): TripDocument => ({
  trip,
  places: [],
  entries: [],
  photos: [],
  revision: 0,
});
export function removeEntry(doc: TripDocument, entryId: string): TripDocument {
  const photos = doc.photos.filter((p) => p.entryId !== entryId);
  return documentSchema.parse({
    ...doc,
    trip: {
      ...doc.trip,
      coverPhotoId: photos.some((p) => p.id === doc.trip.coverPhotoId)
        ? doc.trip.coverPhotoId
        : undefined,
    },
    entries: doc.entries.filter((e) => e.id !== entryId),
    photos,
  });
}
export function upsertEntry(doc: TripDocument, entry: Entry, places: Place[]): TripDocument {
  const all = new Map(doc.places.map((p) => [p.id, p]));
  places.forEach((p) => all.set(p.id, p));
  return documentSchema.parse({
    ...doc,
    places: [...all.values()],
    entries: [...doc.entries.filter((e) => e.id !== entry.id), entry],
    trip: { ...doc.trip, updatedAt: now() },
  });
}
