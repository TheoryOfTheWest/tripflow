import {
  now,
  uuid,
  documentSchema,
  type Entry,
  type Place,
  type TripDocument,
  type Photo,
} from '../models';
import { toUtc } from './time';
export function sampleDocument(ownerId: string): TripDocument {
  const tripId = uuid(),
    zone = 'Asia/Tokyo',
    stamp = now();
  const place = (
    name: string,
    latitude: number,
    longitude: number,
    category: Place['category'] = 'place'
  ): Place => ({
    id: uuid(),
    ownerId,
    tripId,
    name,
    latitude,
    longitude,
    category,
    address: '虚构验收行程 · 地点坐标仅用于功能测试',
  });
  const hotel = place('青岚旅舍（虚构）', 34.989, 135.759),
    kyoto = place('京都站', 34.9858, 135.7588, 'station'),
    gojo = place('五条站', 34.995, 135.7592, 'station'),
    temple = place('清水寺', 34.9949, 135.785),
    osaka = place('大阪站', 34.7025, 135.4959, 'station'),
    park = place('大阪城公园', 34.6873, 135.5262),
    cafe = place('河岸咖啡（虚构）', 34.694, 135.504),
    airport = place('关西国际机场', 34.4342, 135.2441, 'station'),
    shanghai = place('上海浦东国际机场', 31.1443, 121.8083, 'station');
  const entry = (
    date: string,
    start: string,
    end: string,
    title: string,
    p?: Place,
    destination?: Place,
    mode?: 'walk' | 'subway' | 'rail' | 'plane',
    endDate = date,
    endZone = zone,
    line = ''
  ): Entry => {
    const startAtUtc = toUtc(`${date}T${start}`, zone),
      endAtUtc = toUtc(`${endDate}T${end}`, endZone);
    return {
      id: uuid(),
      ownerId,
      tripId,
      type: mode ? 'transport' : 'stay',
      title,
      timezone: zone,
      endTimezone: endZone,
      startAtUtc,
      endAtUtc,
      notes: '虚构验收数据，并非真实旅行记录。',
      activityType: '游览',
      updatedAt: stamp,
      ...(mode
        ? {
            originPlaceId: p?.id,
            destinationPlaceId: destination?.id,
            transport: {
              mode,
              operatorName: '',
              lineName: line,
              boardingStationId: p?.id,
              alightingStationId: destination?.id,
              transferNotes: '',
              actualDuration: (Date.parse(endAtUtc) - Date.parse(startAtUtc)) / 1000,
              routeSource: 'none' as const,
            },
          }
        : { placeId: p?.id }),
    };
  };
  const entries = [
    entry('2026-10-16', '08:00', '09:00', '旅舍的早晨', hotel),
    entry('2026-10-16', '09:00', '09:12', '沿街步行到车站', hotel, kyoto, 'walk'),
    entry(
      '2026-10-16',
      '09:20',
      '09:25',
      '地铁出发',
      kyoto,
      gojo,
      'subway',
      undefined,
      undefined,
      '测试线路 · 请按实际填写'
    ),
    entry('2026-10-16', '10:00', '12:00', '山间的一座寺院', temple),
    entry(
      '2026-10-17',
      '09:00',
      '09:40',
      '前往另一座城市',
      kyoto,
      osaka,
      'rail',
      undefined,
      undefined,
      '测试列车 · 请按实际填写'
    ),
    entry('2026-10-17', '10:30', '12:00', '公园散步', park),
    entry('2026-10-17', '14:00', '15:00', '河岸的一杯咖啡', cafe),
    entry(
      '2026-10-17',
      '23:00',
      '07:00',
      '跨午夜交通测试（虚构）',
      osaka,
      airport,
      'rail',
      '2026-10-18',
      zone,
      '虚构夜行线路'
    ),
    entry(
      '2026-10-18',
      '20:00',
      '21:00',
      '跨时区航班测试（虚构）',
      airport,
      shanghai,
      'plane',
      undefined,
      'Asia/Shanghai',
      '虚构航班 TEST-01'
    ),
  ];
  return documentSchema.parse({
    trip: {
      id: tripId,
      ownerId,
      title: '关西慢游 · 虚构示例',
      startDate: '2026-10-16',
      endDate: '2026-10-18',
      defaultTimezone: zone,
      cover: 'city',
      notes:
        '供功能验收的三日虚构旅行。线路、班次、住宿与活动时间不是出行建议。步行示例未调用 API、未填入虚构距离。',
      createdAt: stamp,
      updatedAt: stamp,
    },
    places: [hotel, kyoto, gojo, temple, osaka, park, cafe, airport, shanghai],
    entries,
    photos: [],
    revision: 0,
  });
}
export async function samplePhoto(doc: TripDocument): Promise<{ photo: Photo; blob: Blob }> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#d4dcd0');
  sky.addColorStop(1, '#eee9d8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 960, 600);
  ctx.fillStyle = '#e9bb7b';
  ctx.beginPath();
  ctx.arc(700, 150, 55, 0, Math.PI * 2);
  ctx.fill();
  for (const [y, color] of [
    [350, '#adb9a7'],
    [450, '#6f8b78'],
    [540, '#3e6657'],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 600);
    ctx.lineTo(0, y);
    for (let x = 0; x <= 960; x += 80) ctx.lineTo(x, y - Math.sin(x / 160) * 70);
    ctx.lineTo(960, 600);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = '28px sans-serif';
  ctx.fillText('TRIPFLOW / FICTIONAL TEST ILLUSTRATION', 40, 555);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('示例照片生成失败'))), 'image/png')
  );
  const photo: Photo = {
    id: uuid(),
    tripId: doc.trip.id,
    ownerId: doc.trip.ownerId,
    entryId: doc.entries[3].id,
    takenAt: doc.entries[3].startAtUtc,
    storagePath: '',
    caption: '虚构验收插画 · 非旅行实拍',
    sortOrder: 0,
    mimeType: 'image/png',
  };
  photo.storagePath = `${photo.ownerId}/${photo.tripId}/${photo.id}`;
  return { photo, blob };
}
