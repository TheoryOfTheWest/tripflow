import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleDocument } from '../src/lib/fixture';
import { routePoints } from '../src/lib/route';
import { roughWalk } from '../src/services/geoapify';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('map providers and route projection', () => {
  it('projects daily markers in actual record order and keeps missing places harmless', () => {
    const doc = sampleDocument('local-demo'),
      points = routePoints(doc, '2026-10-16');
    expect(points[0].place.name).toContain('旅舍');
    expect(points.at(-1)?.place.name).toBe('清水寺');
    expect(points.some((p) => p.station)).toBe(true);
    expect(routePoints({ ...doc, entries: [doc.entries[1]] })[0].station).toBe(false);
    expect(() => routePoints({ ...doc, places: [] }, '2026-10-16')).not.toThrow();
  });
  it('calculates a labeled configurable straight-line estimate', () => {
    const doc = sampleDocument('local-demo'),
      a = roughWalk(doc.places[0], doc.places[1], 4),
      b = roughWalk(doc.places[0], doc.places[1], 8);
    expect(a.estimatedDistance).toBeGreaterThan(0);
    expect(a.estimatedDuration).toBeCloseTo(b.estimatedDuration * 2);
    expect(a.routeSource).toBe('straight-line');
  });
  it('parses route distance, seconds and geometry from a mocked official API shape and caches parameters', async () => {
    vi.stubEnv('VITE_GEOAPIFY_API_KEY', 'test-not-a-real-key');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            properties: { distance: 721, time: 632 },
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [135.759, 34.989],
                  [135.7588, 34.9858],
                ],
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetcher);
    const { geoapify } = await import('../src/services/geoapify'),
      doc = sampleDocument('local-demo');
    const result = await geoapify.walk(doc.places[0], doc.places[1]);
    expect(result.estimatedDistance).toBe(721);
    expect(result.estimatedDuration).toBe(632);
    expect(result.routeSource).toBe('geoapify');
    await geoapify.walk(doc.places[0], doc.places[1]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves search coordinates and exposes provider errors', async () => {
    vi.stubEnv('VITE_GEOAPIFY_API_KEY', 'test-not-a-real-key');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                name: '京都站',
                formatted: '日本 京都',
                lat: 34.9858,
                lon: 135.7588,
                place_id: 'provider-id',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    vi.stubGlobal('fetch', fetcher);
    const { geoapify } = await import('../src/services/geoapify');
    expect((await geoapify.search('京都', 'zh'))[0]).toMatchObject({
      latitude: 34.9858,
      longitude: 135.7588,
      providerPlaceId: 'provider-id',
    });
    await expect(geoapify.search('大阪', 'zh')).rejects.toThrow('429');
  });
});

it('reverse geocodes a real name, caches coordinates and preserves original GPS rather than snapped address coordinates', async () => {
  vi.stubEnv('VITE_GEOAPIFY_API_KEY', 'synthetic-key');
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            properties: {
              name: '虚构公园',
              formatted: '测试城市 · 虚构公园',
              lat: 35.1,
              lon: 135.1,
              place_id: 'reverse-id',
            },
          },
        ],
      }),
    });
  vi.stubGlobal('fetch', fetcher);
  const { geoapify } = await import('../src/services/geoapify');
  const first = await geoapify.reverse(35.000001, 135.000001);
  expect(first).toMatchObject({ name: '虚构公园', latitude: 35.000001, longitude: 135.000001 });
  const second = await geoapify.reverse(35.000002, 135.000002);
  expect(second.latitude).toBe(35.000002);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.pathname).toBe('/v1/geocode/reverse');
  expect(url.searchParams.get('lang')).toBe('zh');
});
it('does not cache failed or empty reverse results, allowing an explicit retry', async () => {
  vi.stubEnv('VITE_GEOAPIFY_API_KEY', 'synthetic-key');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 429 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { properties: { address_line1: '测试路', formatted: '测试路 1 号', lat: 0, lon: 0 } },
        ],
      }),
    });
  vi.stubGlobal('fetch', fetcher);
  const { geoapify } = await import('../src/services/geoapify');
  await expect(geoapify.reverse(0, 0)).rejects.toThrow('429');
  await expect(geoapify.reverse(0, 0)).rejects.toThrow('未查到');
  expect((await geoapify.reverse(0, 0)).name).toBe('测试路');
  await expect(geoapify.reverse(91, 0)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
