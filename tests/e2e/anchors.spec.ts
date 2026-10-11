import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import exifr from 'exifr';
import JSZip from 'jszip';
import { anchorJpeg } from '../helpers/anchorPhoto';

test('explicit anchors fill nodes, ordinary attachments stay inert, and ZIP restores anchors', async ({
  page,
  browser,
  baseURL,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#5b947b';
    ctx.fillRect(0, 0, 48, 32);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const jpeg = Buffer.from(data, 'base64');
  const photo = (date?: string, offset?: string, gps?: [number, number]) => ({
    name: 'synthetic.jpg',
    mimeType: 'image/jpeg',
    buffer: anchorJpeg(jpeg, date, offset, gps),
  });
  await page.getByRole('button', { name: '开启一段旅程' }).click();
  await page.getByLabel('旅行名称', { exact: true }).fill('照片锚定测试');
  await page.getByLabel('出发日期', { exact: true }).fill('2026-10-16');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-18');
  await page.getByLabel('旅行默认时区', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('link', { name: /照片锚定测试/ }).click();
  await page.getByRole('button', { name: '添加第一条记录' }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('锚定漫步');
  await page
    .getByLabel('开始锚定照片', { exact: true })
    .setInputFiles(photo('2026:10:16 09:30:15', '+09:00', [34.98, 135.75]));
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-16T09:30:15');
  await expect(page.getByLabel('活动地点', { exact: true })).toHaveValue(/.+/);
  await page
    .getByLabel('结束锚定照片', { exact: true })
    .setInputFiles(photo('2026:10:16 09:45:30', '+08:00', [34.99, 135.76]));
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('2026-10-16T10:45:30');
  await expect(page.getByLabel('结束地点（可选）', { exact: true })).toHaveValue(/.+/);
  const place = await page.getByLabel('活动地点', { exact: true }).inputValue();
  const endPlace = await page.getByLabel('结束地点（可选）', { exact: true }).inputValue();
  expect(place).not.toBe(endPlace);
  await page
    .getByLabel('普通附件照片', { exact: true })
    .setInputFiles(photo('2026:10:18 16:00:00', '+09:00', [50, 80]));
  await expect(page.getByLabel('新照片说明')).toHaveCount(3);
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-16T09:30:15');
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('2026-10-16T10:45:30');
  await expect(page.getByLabel('活动地点', { exact: true })).toHaveValue(place);
  await expect(page.getByLabel('活动地点', { exact: true }).locator('option')).toHaveCount(3);
  // Replacing an anchor keeps the former image as an ordinary attachment.
  await page
    .getByLabel('开始锚定照片', { exact: true })
    .setInputFiles(photo('2026:10:16 09:31:16', '+09:00', [34.98, 135.75]));
  await expect(page.getByLabel('新照片说明')).toHaveCount(4);
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-16T09:31:16');
  await page.getByLabel('结束时间', { exact: true }).fill('2026-10-16T10:50:45');
  await page.screenshot({
    path: `test-results/${info.project.name}-anchor-form.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('heading', { name: '锚定漫步' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.photo-strip img')).toHaveCount(4);
  await expect(page.locator('.photo-strip .photo-anchor-badge')).toHaveCount(2);
  await page.getByRole('button', { name: '查看今日路线', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑锚定漫步' }).click();
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue('2026-10-16T09:31:16');
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('2026-10-16T10:50:45');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '保存旅程到电脑', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认保存并下载', exact: true }).click();
  const download = await downloading;
  const buffer = await readFile((await download.path())!);
  const zip = await JSZip.loadAsync(buffer);
  const doc = JSON.parse(await zip.file('tripflow.json')!.async('string')).documents[0];
  expect(doc.entries[0].placeId).toBe(place);
  expect(doc.entries[0].endPlaceId).toBe(endPlace);
  expect(doc.photos.filter((p: { anchorRole?: string }) => p.anchorRole)).toHaveLength(2);
  expect(doc.photos.find((p: { anchorRole?: string }) => p.anchorRole === 'end').takenAt).toBe(
    '2026-10-16T01:50:45.000Z'
  );
  for (const image of Object.values(zip.files).filter(
    (f) => f.name.startsWith('photos/') && !f.dir
  )) {
    const tags = await exifr.parse(await image.async('nodebuffer'));
    expect(tags?.DateTimeOriginal).toBeUndefined();
    expect(tags?.GPSLatitude).toBeUndefined();
  }
  expect(await zip.file('旅程回顾.html')!.async('string')).toContain('结束锚定');
  const fresh = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const restore = await fresh.newPage();
    await restore.goto(baseURL!);
    await restore.getByRole('button', { name: '导入旅程', exact: true }).click();
    await restore
      .getByLabel('导入备份')
      .setInputFiles({ name: 'anchors.zip', mimeType: 'application/zip', buffer });
    await restore.getByRole('button', { name: '确认导入为新旅行', exact: true }).click();
    await expect(
      restore.getByText('成功导入 1 段旅行，作为新旅行保存。', { exact: true })
    ).toBeVisible();
    await restore.getByRole('button', { name: '关闭', exact: true }).click();
    await restore.getByRole('link', { name: /照片锚定测试/ }).click();
    await restore.reload();
    await expect(restore.locator('.photo-strip img')).toHaveCount(4);
    await expect(restore.locator('.photo-strip .photo-anchor-badge')).toHaveCount(2);
    await restore.getByRole('button', { name: '编辑锚定漫步' }).click();
    await expect(restore.getByLabel('开始时间', { exact: true })).toHaveValue(
      '2026-10-16T09:31:16'
    );
    await expect(restore.getByLabel('结束地点（可选）', { exact: true })).toHaveValue(/.+/);
    // A point-in-time entry can only keep a start anchor.
    await restore.getByRole('button', { name: '照片 / 备注', exact: true }).click();
    await expect(restore.getByLabel('结束锚定照片')).toHaveCount(0);
    await restore.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(restore.locator('.photo-strip .photo-anchor-badge')).toHaveCount(1);
  } finally {
    await fresh.close();
  }
  expect(errors).toEqual([]);
});

test('GPS-only and metadata-free anchors preserve fields they cannot extract', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '先看看虚构三日示例' }).click();
  await page.getByRole('button', { name: '编辑山间的一座寺院' }).click();
  const start = await page.getByLabel('开始时间', { exact: true }).inputValue();
  const place = await page.getByLabel('活动地点', { exact: true }).inputValue();
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    return c.toDataURL('image/jpeg').split(',')[1];
  });
  const jpeg = Buffer.from(base64, 'base64');
  await page
    .getByLabel('开始锚定照片')
    .setInputFiles({ name: '202610161500.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByText(/未找到有效拍摄时间，时间保持原值/)).toBeVisible();
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue(start);
  await expect(page.getByLabel('活动地点', { exact: true })).toHaveValue(place);
  await page.getByLabel('开始锚定照片').setInputFiles({
    name: 'gps-only.jpg',
    mimeType: 'image/jpeg',
    buffer: anchorJpeg(jpeg, undefined, undefined, [35.1, 135.9]),
  });
  await expect(page.getByText(/已填写开始地点 GPS 坐标/)).toBeVisible();
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue(start);
  await expect(page.getByLabel('活动地点', { exact: true })).not.toHaveValue(place);
  // Removing the photo leaves the explicitly prefilled fields for manual review.
  const prefilled = await page.getByLabel('活动地点', { exact: true }).inputValue();
  await page.getByRole('button', { name: '移除待上传照片' }).last().click();
  await expect(page.getByLabel('活动地点', { exact: true })).toHaveValue(prefilled);
});
