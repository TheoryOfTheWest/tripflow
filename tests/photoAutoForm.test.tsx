import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TripForm } from '../src/components/TripForm';
import { db } from '../src/services/repository';
import { geoapify } from '../src/services/geoapify';
vi.mock('../src/services/photoMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/photoMetadata')>();
  return {
    ...actual,
    readAnchorMetadata: vi.fn(async (file: File) => ({
      utc: file.name === 'end.jpg' ? '2026-10-16T00:20:00.000Z' : '2026-10-16T00:00:00.000Z',
      latitude: 35,
      longitude: 135,
      warnings: [],
    })),
  };
});
vi.mock('../src/services/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/media')>()),
  compressPhoto: vi.fn(
    async () => new Blob(['compressed synthetic image'], { type: 'image/jpeg' })
  ),
}));
vi.mock('../src/services/geoapify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/geoapify')>();
  return {
    ...actual,
    geoKey: 'local-mock',
    geoapify: {
      ...actual.geoapify,
      reverse: vi.fn(async (latitude: number, longitude: number) => ({
        name: '自动识别的测试公园',
        address: '虚构城市 · 测试公园',
        latitude,
        longitude,
      })),
    },
  };
});
beforeEach(() => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:synthetic-preview';
      }
      static revokeObjectURL() {}
    }
  );
});
afterEach(async () => {
  cleanup();
  await db.attachments.clear();
  await db.documents.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function upload() {
  fireEvent.change(screen.getByLabelText('旅行默认时区'), { target: { value: 'Asia/Tokyo' } });
  fireEvent.click(screen.getByRole('button', { name: '上传照片自动解析模式' }));
  fireEvent.change(screen.getByLabelText('批量旅程照片'), {
    target: {
      files: [
        new File(['a'], 'start.jpg', { type: 'image/jpeg' }),
        new File(['b'], 'end.jpg', { type: 'image/jpeg' }),
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('第 1 段开始地名')).toHaveValue('自动识别的测试公园')
  );
}
it('shows reverse-geocoded real place names in the preview and saves an editable trip from photos alone', async () => {
  const save = vi.fn().mockResolvedValue(undefined),
    close = vi.fn();
  render(<TripForm ownerId="local-demo" onSave={save} onClose={close} />);
  await upload();
  expect(screen.getByLabelText('旅行名称')).toHaveValue('照片旅程 · 2026-10-16');
  expect(screen.getByLabelText('第 1 段名称')).toHaveValue('自动识别的测试公园');
  fireEvent.click(screen.getByRole('button', { name: '确认生成并保存旅行' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const doc = save.mock.calls[0][0];
  expect(doc.entries).toHaveLength(1);
  expect(doc.photos.filter((p: { anchorRole?: string }) => p.anchorRole)).toHaveLength(2);
  expect(doc.places[0].name).toBe('自动识别的测试公园');
  expect(await db.attachments.count()).toBe(2);
});
it('retains the preview and compensates newly staged local photo files when saving fails', async () => {
  const close = vi.fn();
  render(
    <TripForm
      ownerId="local-demo"
      onSave={async () => {
        throw new Error('本地保存失败');
      }}
      onClose={close}
    />
  );
  await upload();
  fireEvent.click(screen.getByRole('button', { name: '确认生成并保存旅行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('本地保存失败');
  await waitFor(async () => expect(await db.attachments.count()).toBe(0));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('第 1 段开始地名')).toHaveValue('自动识别的测试公园');
});

it('changing one anchor preserves the manually corrected opposite place name', async () => {
  render(<TripForm ownerId="local-demo" onSave={vi.fn()} onClose={vi.fn()} />);
  await upload();
  fireEvent.change(screen.getByLabelText('第 1 段结束地名'), {
    target: { value: '手动确认的终点' },
  });
  const selector = screen.getByLabelText('第 1 段开始锚定照片') as HTMLSelectElement;
  const endOption = Array.from(selector.options).find((option) => option.text.includes('end.jpg'))!;
  fireEvent.change(selector, { target: { value: endOption.value } });
  await waitFor(() =>
    expect(screen.getByLabelText('第 1 段开始时间')).toHaveValue('2026-10-16T09:20')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认生成并保存旅行' })).toBeEnabled()
  );
  expect(screen.getByLabelText('第 1 段结束地名')).toHaveValue('手动确认的终点');
});
