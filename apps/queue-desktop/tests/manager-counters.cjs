const { expect } = require('@playwright/test');
const electron = require('./electron-launch.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-manager-counters-')),
    file = path.join(directory, 'fixture.json');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.QUEUE_TEST_COUNTERS;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'tests/desktop-fixture.ts'),
    ],
    { env: { ...env, QUEUE_FIXTURE_FILE: file }, windowsHide: true, stdio: 'ignore' },
  );
  let app;
  try {
    let fixture;
    for (let i = 0; i < 120; i++) {
      try {
        fixture = JSON.parse(await fs.readFile(file, 'utf8'));
        break;
      } catch {}
      if (host.exitCode !== null) throw new Error('Fixture exited');
      await pause(250);
    }
    if (!fixture) throw new Error('Fixture timed out');
    fixture.counterId = fixture.teller.counterId;
    const profile = path.join(directory, 'manager');
    await fs.mkdir(profile);
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
    // Required fields explain the expected value and block invalid saves before IPC.
    await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    const servicesBefore = (await page.evaluate(() => window.queue.snapshot())).services;
    await page.getByRole('button', { name: 'إضافة خدمة', exact: true }).click();
    await page.getByLabel('اسم الخدمة', { exact: true }).last().fill('خدمة اختبار النموذج');
    const prefix = page.getByLabel('بادئة الرقم', { exact: true }).last();
    await expect(prefix).toHaveAttribute('placeholder', 'مثال: A');
    await page.getByRole('button', { name: 'حفظ إعدادات الفرع', exact: true }).click();
    await expect(page.locator('.form-validation')).toContainText('أكمل حقل «بادئة الرقم»');
    await expect(prefix).toBeFocused();
    expect((await page.evaluate(() => window.queue.snapshot())).services).toEqual(servicesBefore);
    await prefix.fill('A1');
    await page.getByRole('button', { name: 'حفظ إعدادات الفرع', exact: true }).click();
    await expect(page.locator('.form-validation')).toContainText('دون أرقام أو مسافات');
    await prefix.fill('Q');
    await expect(page.locator('.form-validation')).toHaveCount(0);
    for (const width of [1280, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator('.panel-content').evaluate(element => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(root, 'test-results/manager-form-guidance.png') });
    await page.getByRole('button', { name: 'الكاونترات', exact: true }).click();
    await expect(page.locator('.counter-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'إنشاء كاونتر', exact: true }).click();
    await expect(page.getByLabel('رقم الكاونتر')).toHaveValue('2');
    await page.getByLabel('اسم إضافي', { exact: false }).fill('الحوالات');
    await page.getByRole('button', { name: 'حفظ الكاونتر' }).click();
    await expect(page.locator('.counter-card')).toHaveCount(2);
    let second = page.locator('.counter-card').filter({ hasText: 'كاونتر 2 · الحوالات' });
    await expect(second).toContainText('الاستقبال متوقف');
    await second.getByRole('button', { name: 'تعديل', exact: true }).click();
    await page.getByLabel('اسم إضافي', { exact: false }).fill('خدمة العملات');
    await page.getByRole('button', { name: 'حفظ الكاونتر' }).click();
    second = page.locator('.counter-card').filter({ hasText: 'كاونتر 2 · خدمة العملات' });
    await second.getByRole('button', { name: 'تفعيل الاستقبال' }).click();
    await expect(second).toContainText('متاح');
    await second.getByRole('button', { name: 'إيقاف الاستقبال' }).click();
    await expect(second).toContainText('الاستقبال متوقف');
    const command = async (actor, action, extra = {}) => {
      const response = await fetch(fixture.url + '/v1/commands', {
        method: 'POST',
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), action, ...extra }),
      });
      if (!response.ok) throw new Error('Fixture command rejected');
      return response.json();
    };
    await command(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
    await command(fixture.teller, 'next', { expectedRevision: 0 });
    const first = page.locator(`[data-management-counter-id="${fixture.counterId}"]`);
    await expect(first.locator('.counter-current-ticket')).toHaveText('A-001');
    await expect(first.getByRole('button', { name: 'حذف', exact: true })).toBeDisabled();
    await first.getByRole('button', { name: 'إعادة النداء', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.queue.snapshot())).counters.find(
            c => c.id === fixture.counterId,
          ).revision,
      )
      .toBe(2);
    await command(fixture.teller, 'start', { expectedRevision: 2 });
    await command(fixture.teller, 'complete', { expectedRevision: 3 });
    await expect(first.locator('.counter-current-ticket')).toHaveText('—');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/manager-counters.png') });
    await first.getByRole('button', { name: 'تحليل الأداء' }).click();
    await expect(page.getByRole('region', { name: 'تحليل الكاونتر المحدد' })).toContainText(
      'عينة الخدمة: 1',
    );
    await expect(page.locator('.counter-analysis .metrics strong').first()).toHaveText('1');
    await page
      .locator('.counter-analysis')
      .screenshot({ path: path.join(root, 'test-results/manager-counter-analysis.png') });
    await page.getByRole('button', { name: 'الكاونترات', exact: true }).click();
    await page
      .locator(`[data-management-counter-id="${fixture.counterId}"]`)
      .getByRole('button', { name: 'حذف', exact: true })
      .click();
    await page.getByRole('button', { name: 'تأكيد حذف الكاونتر' }).click();
    await expect(page.locator('.counter-card')).toHaveCount(1);
    await expect(
      page.locator('.counter-card').getByRole('button', { name: 'حذف', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'الأداء والتقارير', exact: true }).click();
    await expect(
      page.getByLabel('تحليل كاونتر').locator('option').filter({ hasText: 'محذوف' }),
    ).toHaveCount(1);
    expect(errors).toEqual([]);
    console.log(
      'Manager counter UI passed: create/edit, pause/resume, recall, active-ticket and last-counter deletion guards, historical analysis after retirement, real branch records.',
    );
  } finally {
    await app?.close().catch(() => {});
    if (host.exitCode === null) {
      const ended = new Promise(r => host.once('exit', r));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-manager-counters-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
