import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TripForm } from '../src/components/TripForm';
import { EntryForm } from '../src/components/EntryForm';
import { sampleDocument } from '../src/lib/fixture';
afterEach(cleanup);
it('creates a trip with actual form data', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<TripForm ownerId="local-demo" onClose={() => {}} onSave={save} />);
  fireEvent.change(screen.getByLabelText('旅行名称'), { target: { value: '真实填写的旅行' } });
  fireEvent.click(screen.getByRole('button', { name: '保存旅行' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].trip.title).toBe('真实填写的旅行');
});
it('keeps the editor open when persistence fails', async () => {
  const close = vi.fn();
  render(
    <TripForm
      ownerId="local-demo"
      onClose={close}
      onSave={async () => {
        throw new Error('网络中断，未保存');
      }}
    />
  );
  fireEvent.change(screen.getByLabelText('旅行名称'), { target: { value: '旅行' } });
  fireEvent.click(screen.getByRole('button', { name: '保存旅行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('未保存');
  expect(close).not.toHaveBeenCalled();
});
it('saves subway line and reusable boarding/alighting places', async () => {
  const doc = sampleDocument('local-demo'),
    entry = doc.entries[2],
    save = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <EntryForm
      doc={doc}
      date="2026-10-16"
      initial={entry}
      onClose={close}
      onSave={save}
      onNotice={() => {}}
    />
  );
  fireEvent.change(screen.getByLabelText('线路名称'), { target: { value: '我的地铁线路' } });
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  const saved = save.mock.calls[0][0].entries.find((e: { id: string }) => e.id === entry.id);
  expect(saved.transport.lineName).toBe('我的地铁线路');
  expect(saved.transport.boardingStationId).toBe(entry.originPlaceId);
  expect(saved.transport.alightingStationId).toBe(entry.destinationPlaceId);
});
