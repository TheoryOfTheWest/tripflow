import { z } from 'zod';
import type { Place, Transport } from '../models';
export type PlaceResult = Pick<
  Place,
  'name' | 'address' | 'latitude' | 'longitude' | 'providerPlaceId'
>;
export interface PlaceProvider {
  search(query: string, language: string, signal?: AbortSignal): Promise<PlaceResult[]>;
  reverse(latitude: number, longitude: number, language?: string): Promise<PlaceResult>;
  walk(
    origin: Place,
    destination: Place
  ): Promise<
    Pick<Transport, 'estimatedDistance' | 'estimatedDuration' | 'routeGeometry' | 'routeSource'>
  >;
}
export const geoKey = import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined;
const reverseCache = new Map<string, Promise<PlaceResult>>();
const routeCache = new Map<string, Awaited<ReturnType<PlaceProvider['walk']>>>();
async function request(path: string, params: Record<string, string>, signal?: AbortSignal) {
  if (!geoKey) throw new Error('未配置 Geoapify Key，可手动输入地点和坐标');
  const response = await fetch(
    `https://api.geoapify.com/v1/${path}?${new URLSearchParams({ ...params, apiKey: geoKey })}`,
    { signal: signal ?? AbortSignal.timeout(15000) }
  );
  if (!response.ok) throw new Error(`地图服务暂不可用（${response.status}），请使用手动输入`);
  return response.json();
}
const searchResponse = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        formatted: z.string(),
        name: z.string().optional(),
        address_line1: z.string().optional(),
        place_id: z.string().optional(),
      }),
    })
  ),
});
const routeResponse = z.object({
  features: z
    .array(
      z.object({
        properties: z.object({
          distance: z.number().nonnegative(),
          time: z.number().nonnegative(),
        }),
        geometry: z.object({
          type: z.literal('MultiLineString'),
          coordinates: z
            .array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])))
            .min(1),
        }),
      })
    )
    .min(1),
});
export const geoapify: PlaceProvider = {
  async search(query, language, signal) {
    const data = searchResponse.parse(
      await request(
        'geocode/autocomplete',
        { text: query, lang: language, limit: '6', format: 'geojson' },
        signal
      )
    );
    return data.features.map(({ properties: p }) => ({
      name: (p.name || p.address_line1 || p.formatted).slice(0, 300),
      address: p.formatted,
      latitude: p.lat,
      longitude: p.lon,
      providerPlaceId: p.place_id,
    }));
  },
  async reverse(latitude, longitude, language = 'zh') {
    z.number().min(-90).max(90).parse(latitude);
    z.number().min(-180).max(180).parse(longitude);
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}|${language}`;
    if (!reverseCache.has(key)) {
      const pending = (async () => {
        const data = searchResponse.parse(
          await request(
            'geocode/reverse',
            {
              lat: String(latitude),
              lon: String(longitude),
              lang: language,
              limit: '1',
              format: 'geojson',
            },
            AbortSignal.timeout(8000)
          )
        );
        const p = data.features[0]?.properties;
        if (!p) throw new Error('该坐标未查到地名，请手动填写');
        return {
          name: (p.name || p.address_line1 || p.formatted).slice(0, 300),
          address: p.formatted,
          // Reverse geocoding may snap to a nearby address. Keep the actual photo GPS.
          latitude,
          longitude,
          providerPlaceId: p.place_id,
        };
      })();
      reverseCache.set(key, pending);
      pending.catch(() => reverseCache.delete(key));
      if (reverseCache.size > 300) reverseCache.delete(reverseCache.keys().next().value!);
    }
    const result = await reverseCache.get(key)!;
    return { ...result, latitude, longitude };
  },
  async walk(origin, destination) {
    const key = `${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}`;
    if (routeCache.has(key)) return routeCache.get(key)!;
    const data = routeResponse.parse(
      await request('routing', { waypoints: key, mode: 'walk', units: 'metric', format: 'geojson' })
    );
    const route = data.features[0];
    const result = {
      estimatedDistance: route.properties.distance,
      estimatedDuration: route.properties.time,
      routeGeometry: route.geometry,
      routeSource: 'geoapify' as const,
    };
    routeCache.set(key, result);
    if (routeCache.size > 100) routeCache.delete(routeCache.keys().next().value!);
    return result;
  },
};
export function roughWalk(
  a: Pick<Place, 'latitude' | 'longitude'>,
  b: Pick<Place, 'latitude' | 'longitude'>,
  speed = 4.5
) {
  if (!Number.isFinite(speed) || speed < 1 || speed > 10) throw new Error('步行速度须为 1–10 km/h');
  const rad = (n: number) => (n * Math.PI) / 180;
  const hav =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  const estimatedDistance =
    6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(Math.max(0, 1 - hav)));
  return {
    estimatedDistance,
    estimatedDuration: estimatedDistance / ((speed * 1000) / 3600),
    routeSource: 'straight-line' as const,
    walkingSpeedKmh: speed,
  };
}
