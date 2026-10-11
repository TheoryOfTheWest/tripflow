import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
test('create, map-select, reorder, route, back up, restore and delete a private local trip', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '你的下一段故事，从这里开始' })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-home.png`, fullPage: true });
  await page.getByRole('button', { name: '开启一段旅程' }).click();
  await page.getByLabel('旅行名称', { exact: true }).fill('京都 · 验收旅行');
  await page.getByLabel('出发日期', { exact: true }).fill('2026-10-16');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-18');
  await page.getByLabel('旅行默认时区', { exact: true }).fill('Asia/Tokyo');
  await page.getByRole('button', { name: '保存旅行' }).click();
  await page.getByRole('link', { name: /京都 · 验收旅行/ }).click();
  await page.getByRole('button', { name: '添加第一条记录' }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('早晨的咖啡');
  await page.getByLabel('开始时间', { exact: true }).fill('2026-10-16T09:00');
  await page.getByLabel('结束时间', { exact: true }).fill('2026-10-16T10:00');
  await page.getByRole('button', { name: '地图选点' }).click();
  await page.getByLabel('地点名称', { exact: true }).fill('手动测试地点');
  await page.getByLabel('地点地址', { exact: true }).fill('京都市 · 测试');
  await page.getByLabel('纬度', { exact: true }).fill('34.9858');
  await page.getByLabel('经度', { exact: true }).fill('135.7588');
  await page.getByRole('button', { name: '确认地点' }).click();
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('heading', { name: '早晨的咖啡' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '早晨的咖啡' })).toBeVisible();
  await page.getByRole('button', { name: '在地图查看手动测试地点' }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /记录下一段时光/ }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('更早的早餐');
  await page.getByLabel('开始时间', { exact: true }).fill('2026-10-16T08:00');
  await page.getByLabel('结束时间', { exact: true }).fill('2026-10-16T08:30');
  await page.getByLabel('活动地点', { exact: true }).selectOption({ label: '手动测试地点' });
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.timeline-item h3')).toHaveText(['更早的早餐', '早晨的咖啡']);
  await expect(page.getByText('未记录时段', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑早晨的咖啡' }).click();
  await page.getByLabel('开始时间', { exact: true }).fill('2026-10-16T07:00');
  await page.getByLabel('结束时间', { exact: true }).fill('2026-10-16T07:30');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.timeline-item h3')).toHaveText(['早晨的咖啡', '更早的早餐']);
  await page.getByRole('button', { name: '查看今日路线', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-timeline.png`, fullPage: true });
  if (info.project.name === 'mobile') {
    // Backup remains reachable on narrow screens through the header menu.
    await page.getByRole('button', { name: '打开备份与导出' }).click();
  } else await page.getByRole('button', { name: '备份与导出', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.locator('.backup-option').first().getByRole('button', { name: '导出' }).click();
  const file = await downloaded;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page.getByLabel('导入备份').setInputFiles(path!);
  await page.getByRole('button', { name: '确认导入为新旅行' }).click();
  await expect(
    page.getByText('成功导入 1 段旅行，作为新旅行保存。', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '删除更早的早餐' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByRole('heading', { name: '更早的早餐' })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
test('fictional three-day journey supports photos, midnight continuity, timezone math and walking fallback', async ({
  page,
}, info) => {
  await page.goto('./');
  await page.getByRole('button', { name: '先看看虚构三日示例' }).click();
  await expect(
    page.getByRole('heading', { name: '关西慢游 · 虚构示例', exact: true })
  ).toBeVisible();
  await expect(page.locator('.photo-strip img')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑沿街步行到车站' }).click();
  await page.getByRole('button', { name: '计算步行' }).click();
  await expect(page.getByText(/已使用直线距离/)).toBeVisible();
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByText(/直线粗估（精度有限）/)).toBeVisible();
  await page.getByRole('tab', { name: /DAY 02/ }).click();
  await expect(page.getByText('延续至后一天 · 全程 8 小时', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /DAY 03/ }).click();
  await expect(page.getByText('承接前一天 · 全程 8 小时', { exact: true })).toBeVisible();
  await expect(page.getByText(/当地时间 10.18 20:00/)).toBeVisible();
  await page.getByRole('button', { name: '查看今日路线', exact: true }).click();
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: '打开备份与导出' }).click();
  else await page.getByRole('button', { name: '备份与导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('.backup-option').nth(1).getByRole('button', { name: '导出' }).click();
  const archiveDownload = await download;
  expect(archiveDownload.suggestedFilename()).toBe('tripflow-full-backup.zip');
  const archive = await JSZip.loadAsync(await readFile((await archiveDownload.path())!));
  const imageFiles = Object.values(archive.files).filter(
    (f) => f.name.startsWith('photos/') && !f.dir
  );
  expect(imageFiles).toHaveLength(1);
  expect((await imageFiles[0].async('uint8array')).length).toBeGreaterThan(1000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: /DAY 01/ }).click();
  await page.getByRole('button', { name: '编辑山间的一座寺院' }).click();
  await page.getByRole('button', { name: '删除照片', exact: true }).click();
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.photo-strip img')).toHaveCount(0);
  const attachmentCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('tripflow-v1');
        request.onsuccess = () => {
          const db = request.result,
            count = db.transaction('attachments', 'readonly').objectStore('attachments').count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
          count.onerror = () => reject(count.error);
        };
      })
  );
  expect(attachmentCount).toBe(0);
});
