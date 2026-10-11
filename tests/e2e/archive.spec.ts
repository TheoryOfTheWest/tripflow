import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

test('save one journey, read its photos offline, and restore into a fresh local browser', async ({
  page,
  browser,
  baseURL,
}, info) => {
  await page.goto('./');
  await page.getByRole('button', { name: '先看看虚构三日示例' }).click();
  await page.getByRole('link', { name: '我的旅行', exact: true }).last().click();
  await page.getByRole('button', { name: '新建旅行', exact: true }).click();
  await page.getByLabel('旅行名称', { exact: true }).fill('不应包含的另一段旅行');
  await page.getByRole('button', { name: '保存旅行', exact: true }).click();
  await page.getByRole('link', { name: /关西慢游 · 虚构示例/ }).click();
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: '保存旅程到电脑', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1 张照片');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: '保存旅程到电脑', exact: true }).click();
  await page.screenshot({
    path: `test-results/${info.project.name}-archive-confirm.png`,
    fullPage: true,
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认保存并下载', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^TripFlow_关西慢游.*\.zip$/);
  await expect(page.getByRole('status').filter({ hasText: '旅程文件已生成' })).toBeVisible();
  const buffer = await readFile((await download.path())!);
  const archive = await JSZip.loadAsync(buffer);
  const data = JSON.parse(await archive.file('tripflow.json')!.async('string'));
  expect(data.documents).toHaveLength(1);
  expect(data.documents[0].trip.title).toBe('关西慢游 · 虚构示例');
  expect(data.documents[0].photos).toHaveLength(1);
  expect(data.documents[0].entries.length).toBeGreaterThan(5);

  // Open the extracted HTML through file:// with networking disabled.
  const folder = info.outputPath('extracted-journey');
  await mkdir(join(folder, 'photos'), { recursive: true });
  for (const entry of Object.values(archive.files).filter((file) => !file.dir)) {
    await writeFile(join(folder, entry.name), await entry.async('nodebuffer'));
  }
  const offline = await browser.newContext({ offline: true, viewport: page.viewportSize()! });
  try {
    const report = await offline.newPage();
    const remoteRequests: string[] = [];
    report.on('request', (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    await report.goto(pathToFileURL(join(folder, '旅程回顾.html')).href);
    await expect(report.getByRole('heading', { name: '关西慢游 · 虚构示例' })).toBeVisible();
    await expect(report.locator('img')).toHaveCount(1);
    await expect
      .poll(() =>
        report
          .locator('img')
          .evaluateAll((images) =>
            images.every((img) => (img as HTMLImageElement).naturalWidth > 0)
          )
      )
      .toBe(true);
    await report.screenshot({
      path: `test-results/${info.project.name}-archive-offline.png`,
      fullPage: true,
    });
    expect(remoteRequests).toEqual([]);
  } finally {
    await offline.close();
  }

  // Fresh context stands in for the separate local TripFlow source/storage.
  const fresh = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const restore = await fresh.newPage();
    await restore.goto(baseURL!);
    await expect(
      restore.getByRole('heading', { name: '你的下一段故事，从这里开始' })
    ).toBeVisible();
    await restore.getByRole('button', { name: '导入旅程', exact: true }).click();
    await restore
      .getByLabel('导入备份')
      .setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer });
    await expect(
      restore.getByText('记录和照片将保存在当前浏览器，导入后可直接查看和编辑。')
    ).toBeVisible();
    await restore.getByRole('button', { name: '确认导入为新旅行', exact: true }).click();
    await expect(
      restore.getByText('成功导入 1 段旅行，作为新旅行保存。', { exact: true })
    ).toBeVisible();
    await restore.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(restore.locator('.trip-card')).toHaveCount(1);
    await restore.getByRole('link', { name: /关西慢游 · 虚构示例/ }).click();
    await restore.reload();
    await expect(restore.locator('.photo-strip img')).toHaveCount(1);
    await expect
      .poll(() =>
        restore
          .locator('.photo-strip img')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0);
    await restore.getByRole('tab', { name: /DAY 03/ }).click();
    await expect(restore.getByText('承接前一天 · 全程 8 小时', { exact: true })).toBeVisible();
    expect(await restore.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );

    // In this isolated test context, simulate an unavailable attachment.
    await restore.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('tripflow-v1');
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('attachments', 'readwrite');
            transaction.objectStore('attachments').clear();
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
          request.onerror = () => reject(request.error);
        })
    );
    let failedDownloads = 0;
    restore.on('download', () => failedDownloads++);
    await restore.getByRole('button', { name: '保存旅程到电脑', exact: true }).click();
    await restore.getByRole('button', { name: '确认保存并下载', exact: true }).click();
    await expect(restore.getByRole('alert')).toBeVisible();
    expect(failedDownloads).toBe(0);
    await expect(
      restore.getByRole('button', { name: '确认保存并下载', exact: true })
    ).toBeEnabled();
  } finally {
    await fresh.close();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
