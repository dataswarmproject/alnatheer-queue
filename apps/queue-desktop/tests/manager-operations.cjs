const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-manager-ops-')),
    file = path.join(directory, 'fixture.json'),
    profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'tests/desktop-fixture.ts'),
    ],
    {
      env: { ...env, QUEUE_FIXTURE_FILE: file, QUEUE_TEST_OPERATIONS: '1' },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  let app;
  try {
    let fixture;
    for (let i = 0; i < 120; i++) {
      try {
        fixture = JSON.parse(await fs.readFile(file, 'utf8'));
        break;
      } catch {}
      if (host.exitCode !== null) throw new Error('Fixture failed');
      await pause(250);
    }
    if (!fixture) throw new Error('Fixture timeout');
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    const page = await app.firstWindow(),
      errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('button', { name: /^إدارة الفرع/ }).click();
    await page.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture.manager.token);
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await expect(page.locator('[data-calendar="hijri"]')).toContainText('هـ');
    await expect(page.locator('[data-calendar="gregorian"]')).toBeVisible();
    await page.evaluate(() => window.queue.windowAction('maximize'));
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(true);
    await page.evaluate(() => window.queue.windowAction('maximize'));
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      )
      .toBe(false);
    await page.evaluate(() => window.queue.windowAction('minimize'));
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),
    ).toBe(false);
    const font = await page.evaluate(async () => {
      await document.fonts.load('14px "Thmanyah Sans"', 'العربية A-001');
      return [...document.fonts].some(
        f => f.family.includes('Thmanyah Sans') && f.status === 'loaded',
      );
    });
    expect(font).toBe(true);
    await page.getByRole('button', { name: 'إدارة النظام', exact: true }).click();
    await page.getByRole('button', { name: 'فحص قاعدة البيانات', exact: true }).click();
    await expect(page.locator('.operation-result')).toContainText('فحص القاعدة سليم');
    await page.getByRole('button', { name: 'إنشاء نسخة احتياطية', exact: true }).click();
    await expect(page.getByText(/^حُفظت نسخة متحققة/)).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'تحديث قائمة النسخ' }).click();
    await expect(page.getByRole('button', { name: 'تحقق من النسخة' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'تحقق من النسخة' }).first().click();
    await expect(page.locator('.operation-result')).toContainText('SHA-256');
    await page.getByRole('button', { name: 'استعادة في قاعدة منفصلة' }).first().click();
    await page.getByRole('button', { name: 'تهيئة النسخة المستعادة' }).click();
    await expect(page.locator('.operation-result')).toContainText('قاعدة الخدمة الحالية لم تتغير', {
      timeout: 60000,
    });
    const restored = await fs.readdir(path.join(directory, 'restores'));
    expect(restored).toHaveLength(1);
    expect((await page.evaluate(() => window.queue.snapshot())).counters).toHaveLength(1);
    await page.getByRole('button', { name: 'صيانة القاعدة', exact: true }).click();
    await expect(page.locator('.operation-result')).toContainText('اكتملت صيانة القاعدة', {
      timeout: 60000,
    });
    await page.getByLabel('نسخة يومية تلقائية').uncheck();
    await page.getByLabel('تقرير يومي بعد منتصف الليل السعودي').uncheck();
    await page.getByRole('button', { name: 'حفظ إعدادات التشغيل' }).click();
    await expect(page.locator('.operation-result')).toContainText('حُفظت إعدادات التشغيل');
    await page.getByRole('button', { name: 'مزامنة الآن', exact: true }).click();
    await expect(page.locator('.operation-result')).toContainText('مزامنة دفعة مؤكدة');
    const settings = await page.evaluate(() => window.queue.operationsStatus());
    expect(settings.settings.dailyBackups).toBe(false);
    expect(settings.settings.dailyReports).toBe(false);
    expect(JSON.stringify(settings)).not.toContain('a'.repeat(64));
    await page.screenshot({
      path: path.join(root, 'test-results/manager-operations-thmanyah-hijri.png'),
    });
    await page.getByRole('button', { name: 'الأداء والتقارير', exact: true }).click();
    for (const format of ['pdf', 'csv', 'json']) {
      const exportPath = path.join(directory, 'report.' + format);
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      }, exportPath);
      await page.getByLabel('صيغة تقرير الفرع').selectOption(format);
      await page.getByRole('button', { name: 'حفظ التقرير', exact: true }).click();
      await expect
        .poll(async () => {
          try {
            return (await fs.stat(exportPath)).size;
          } catch {
            return 0;
          }
        })
        .toBeGreaterThan(100);
      const data = await fs.readFile(exportPath);
      if (format === 'pdf') expect(data.subarray(0, 4).toString()).toBe('%PDF');
      if (format === 'csv') expect(data.toString()).toContain('Record type');
      if (format === 'json') expect(JSON.parse(data).timezone).toBe('Asia/Riyadh');
    }
    await page.screenshot({
      path: path.join(root, 'test-results/manager-performance-reports.png'),
    });
    await expect(page.getByRole('button', { name: 'التحديثات', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'التحديثات', exact: true })).toHaveAttribute(
      'title',
      /مصدر التحديثات الآمنة غير مهيأ/,
    );
    await expect(page.getByRole('button', { name: 'تنزيل التحديث', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(root, 'test-results/manager-update-footer.png') });
    for (const width of [360, 768, 1024]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width, height: 900 }),
        width,
      );
      await pause(100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page
          .locator('footer')
          .evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    await app.close();
    app = null;
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    const resumed = await app.firstWindow();
    await expect(resumed.locator('.performance')).toBeVisible();
    await expect(resumed.locator('.setup-choices')).toHaveCount(0);
    expect((await resumed.evaluate(() => window.queue.snapshot())).actor.role).toBe('manager');
    expect(
      (await resumed.evaluate(() => window.queue.operationsStatus())).settings.dailyBackups,
    ).toBe(false);
    await expect(resumed.locator('.update-footer .geist-badge')).toBeVisible();
    console.log(
      'Manager operations passed: real database check, backup/verify/separate restore, maintenance, sync settings and retry, Thmanyah loading, dual Saudi dates, truthful update footer and responsive layouts.',
    );
  } finally {
    await app?.close().catch(() => {});
    if (host.exitCode === null) {
      const stopped = new Promise(resolve => host.once('exit', resolve));
      host.kill();
      await stopped;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-manager-ops-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
