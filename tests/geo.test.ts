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
