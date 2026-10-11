import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { anchorJpeg } from '../helpers/anchorPhoto';

test('photos alone create an editable trip, condensed anchors can be corrected, and editing appends without losing old records', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#6b927d';
    ctx.fillRect(0, 0, 48, 32);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const jpeg = Buffer.from(base64, 'base64');
  const file = (name: string, time?: string, gps?: [number, number]) => ({
    name,
    mimeType: 'image/jpeg',
    buffer: time ? anchorJpeg(jpeg, `2026:10:16 ${time}`, '+09:00', gps) : jpeg,
  });
  const files = Array.from({ length: 20 }, (_, i) =>
    file(
      `公园-${String(i + 1).padStart(2, '0')}.jpg`,
      `09:${String(i).padStart(2, '0')}:15`,
      [35, 135]
    )
  );
  files.push(
    file('第二地点开始.jpg', '11:00:00', [35.1, 135.1]),
    file('第二地点结束.jpg', '11:10:00', [35.1, 135.1]),
    file('时间缺失.jpg')
  );
  await page.getByRole('button', { name: '开启一段旅程' }).click();
  await page.getByLabel('旅行默认时区', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '上传照片自动解析模式', exact: true }).click();
  await page.getByLabel('批量旅程照片').setInputFiles(files);
  await expect(page.locator('.auto-group')).toHaveCount(2);
  await expect(page.getByLabel('旅行名称', { exact: true })).toHaveValue('照片旅程 · 2026-10-16');
  await expect(page.getByLabel('出发日期', { exact: true })).toHaveValue('2026-10-16');
  await expect(page.getByLabel('结束日期', { exact: true })).toHaveValue('2026-10-16');
  await expect(page.getByLabel('第 1 段开始时间')).toHaveValue('2026-10-16T09:00:15');
  await expect(page.getByLabel('第 1 段结束时间')).toHaveValue('2026-10-16T09:19:15');
  await page.getByRole('button', { name: '确认生成并保存旅行' }).click();
  await expect(page.getByRole('alert')).toContainText('尚未分组');
  expect(
    await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const r = indexedDB.open('tripflow-v1');
          r.onsuccess = () => {
            const db = r.result,
              q = db.transaction('attachments').objectStore('attachments').count();
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        })
    )
  ).toBe(0);
  await page.getByText('照片信息纠错与暂不导入（23 张）', { exact: true }).click();
  await page.getByLabel('照片 23 拍摄时间', { exact: true }).fill('2026-10-16T12:00');
  await page.getByRole('button', { name: '按纠正信息重新分组' }).click();
  await expect(page.locator('.auto-group')).toHaveCount(3);
  const first = page.getByLabel('自动时间线第 1 段', { exact: true });
  await page
    .getByLabel('第 1 段开始锚定照片')
    .selectOption({ label: '公园-06.jpg · 2026-10-16 09:05:15' });
  await expect(page.getByLabel('第 1 段开始时间')).toHaveValue('2026-10-16T09:05:15');
  await page.getByLabel('第 1 段结束锚定照片').selectOption('');
  await expect(page.getByLabel('第 1 段结束时间')).toHaveValue('2026-10-16T09:19:15');
  await page.getByLabel('第 1 段名称').fill('纠正后的公园时光');
  await page.getByLabel('第 1 段开始地名').fill('我确认的公园');
  await page.getByLabel('第 1 段结束时间').fill('2026-10-16T09:25:20');
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/${info.project.name}-photo-auto.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '确认生成并保存旅行' }).click();
  await page.getByRole('link', { name: /照片旅程 · 2026-10-16/ }).click();
  await expect(page.locator('.timeline-item h3')).toHaveCount(3);
  await expect(page.locator('.photo-strip img')).toHaveCount(23);
  await expect(page.locator('.photo-strip .photo-anchor-badge')).toHaveCount(4);
  await page.reload();
  await page.getByRole('button', { name: '编辑纠正后的公园时光' }).click();
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-16T09:05:15');
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('2026-10-16T09:25:20');
  await expect(page.getByLabel('活动地点', { exact: true }).locator('option:checked')).toHaveText(
    '我确认的公园'
  );
  await page.getByLabel('活动名称', { exact: true }).fill('生成后仍可编辑');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByRole('button', { name: '编辑旅行', exact: true }).click();
  await page.getByRole('button', { name: '上传照片自动解析模式', exact: true }).click();
  await page
    .getByLabel('批量旅程照片')
    .setInputFiles(file('新增一张.jpg', '13:00:00', [35.2, 135.2]));
  await expect(page.locator('.auto-group')).toHaveCount(1);
  await page.getByRole('button', { name: '确认生成并保存旅行' }).click();
  await expect(page.locator('.timeline-item h3')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: '生成后仍可编辑' })).toBeVisible();
  await expect(page.locator('.photo-strip img')).toHaveCount(24);
  await page.getByRole('button', { name: '保存旅程到电脑', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认保存并下载' }).click();
  const download = await downloading;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const doc = JSON.parse(await zip.file('tripflow.json')!.async('string')).documents[0];
  expect(doc.entries).toHaveLength(4);
  expect(doc.photos).toHaveLength(24);
  expect(doc.photos.filter((p: { anchorRole?: string }) => p.anchorRole)).toHaveLength(5);
  expect(
    Object.values(zip.files).filter((f) => f.name.startsWith('photos/') && !f.dir)
  ).toHaveLength(24);
  expect(errors).toEqual([]);
});
