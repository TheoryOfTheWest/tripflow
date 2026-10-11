import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { sampleDocument } from '../src/lib/fixture';
const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../src/services/geoapify', () => ({ geoKey: 'test-key', geoapify: { search } }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="map">{children}</div>
  ),
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Polyline: () => null,
  useMap: () => ({ invalidateSize() {}, setView() {}, fitBounds() {} }),
  useMapEvents: () => ({}),
}));
import MapDialog from '../src/components/map/MapDialog';
afterEach(() => {
  cleanup();
  search.mockReset();
});
it('copies a historical place into the current trip without foreign trip references', () => {
  search.mockResolvedValue([]);
  const old = sampleDocument('local-demo'),
    current = sampleDocument('local-demo');
  const historical = { ...old.places[0], name: '历史站点', category: 'station' as const };
  const select = vi.fn();
  render(
    <MapDialog doc={current} historyPlaces={[historical]} onClose={() => {}} onSelect={select} />
  );
  fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '历史站点' } });
  fireEvent.click(screen.getByText('历史站点'));
  fireEvent.click(screen.getByRole('button', { name: '确认地点' }));
  expect(select.mock.calls[0][0]).toMatchObject({
    tripId: current.trip.id,
    ownerId: 'local-demo',
    category: 'station',
  });
  expect(select.mock.calls[0][0].id).not.toBe(historical.id);
});
it('debounces search, selects a provider result and persists exact coordinates', async () => {
  search.mockResolvedValue([
    {
      name: '京都搜索结果',
      address: '日本 京都市',
      latitude: 34.985849,
      longitude: 135.758767,
      providerPlaceId: 'geoapify-id',
    },
  ]);
  const select = vi.fn();
  render(<MapDialog doc={sampleDocument('local-demo')} onClose={() => {}} onSelect={select} />);
  fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '京' } });
  fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '京都' } });
  await screen.findByText('京都搜索结果');
  expect(search).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('京都搜索结果'));
  fireEvent.click(screen.getByRole('button', { name: '确认地点' }));
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      latitude: 34.985849,
      longitude: 135.758767,
      providerPlaceId: 'geoapify-id',
    })
  );
});
it('shows failed search and still permits manual coordinates', async () => {
  search.mockRejectedValue(new Error('API 请求失败'));
  const select = vi.fn();
  render(<MapDialog doc={sampleDocument('local-demo')} onClose={() => {}} onSelect={select} />);
  fireEvent.change(screen.getByLabelText('搜索地点'), { target: { value: '不存在的站点' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('API 请求失败');
  fireEvent.change(screen.getByLabelText('地点名称'), { target: { value: '手动站点' } });
  fireEvent.change(screen.getByLabelText('纬度'), { target: { value: '30.12345' } });
  fireEvent.change(screen.getByLabelText('经度'), { target: { value: '120.98765' } });
  fireEvent.click(screen.getByRole('button', { name: '确认地点' }));
  await waitFor(() =>
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ name: '手动站点', latitude: 30.12345, longitude: 120.98765 })
    )
  );
});
