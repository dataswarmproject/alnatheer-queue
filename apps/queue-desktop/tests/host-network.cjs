const { expect } = require('@playwright/test');
const electron = require('./electron-launch.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { createServer } = require('node:net');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-network-test-'));
  const profile = path.join(directory, 'manager'),
    serverDirectory = path.join(profile, 'branch-server');
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find(value => value?.family === 'IPv4' && !value.internal)?.address;
  if (!address) throw new Error('A real LAN interface is required for the network qualification');
  const cert = path.join(directory, 'branch.crt'),
    key = path.join(directory, 'branch.key');
  const openssl =
    process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
      '-subj',
      `/CN=${address}`,
      '-addext',
      `subjectAltName=IP:${address}`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert };
  delete env.ELECTRON_RUN_AS_NODE;
  await fs.mkdir(profile);
  let app, teller, pid;
  const retired = [];
  try {
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    let page = await app.firstWindow();
    await page.getByRole('button', { name: /^خادم الفرع/ }).click();
    await page.getByText('اتصال أجهزة الفرع والمركز', { exact: true }).click();
    await page.getByLabel('منفذ الخادم', { exact: true }).fill(String(port));
    await page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true }).click();
    try {
      await expect(page.getByRole('button', { name: 'الإعدادات', exact: true })).toBeVisible({
        timeout: 60000,
      });
    } catch (error) {
      console.error('Host setup:', await page.getByRole('alert').allTextContents());
      throw error;
    }
    const before = await page.evaluate(() => window.queue.snapshot());
    const originalConfig = await fs.readFile(path.join(profile, 'branch-host.enc'));
    await page.getByRole('button', { name: 'إدارة النظام', exact: true }).click();
    await page.getByRole('button', { name: 'إعداد اتصال الشبكة', exact: true }).click();
    await page.getByLabel('واجهة شبكة الخادم').selectOption(address);
    await page.getByLabel('عنوان الخادم HTTPS').fill(`https://127.0.0.1:${port}`);
    for (const [button, file] of [
      ['اختيار الشهادة', cert],
      ['اختيار مفتاح الشهادة', key],
    ]) {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(
        page.getByLabel(button === 'اختيار الشهادة' ? 'شهادة اتصال الشبكة' : 'مفتاح شهادة الشبكة', {
          exact: true,
        }),
      ).toHaveValue(file);
    }
    await expect(page.getByLabel('شهادة اتصال الشبكة', { exact: true })).toHaveValue(cert);
    await expect(page.getByLabel('مفتاح شهادة الشبكة', { exact: true })).toHaveValue(key);
    await page
      .getByRole('button', { name: 'تفعيل اتصال الشبكة مع حفظ البيانات', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('HTTPS', { timeout: 15000 });
    expect(await fs.readFile(path.join(profile, 'branch-host.enc'))).toEqual(originalConfig);
    expect((await page.evaluate(() => window.queue.snapshot())).branchId).toBe(before.branchId);
    console.log('Network preflight rejected the wrong address and preserved the live host.');
    const endpoint = `https://${address}:${port}`;
    await page.getByLabel('عنوان الخادم HTTPS').fill(endpoint);
    // A failed atomic settings write happens after shutdown. It must restart
    // the original host over the original database instead of creating another.
    await fs.chmod(path.join(profile, 'branch-host.enc'), 0o400);
    await page
      .getByRole('button', { name: 'تفعيل اتصال الشبكة مع حفظ البيانات', exact: true })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: /queue:enable-host-network/ }),
    ).toContainText(/EPERM|EACCES|operation not permitted/, {
      timeout: 120000,
    });
    await fs.chmod(path.join(profile, 'branch-host.enc'), 0o600);
    console.log('Failed settings write recovered the original branch host.');
    expect(await fs.readFile(path.join(profile, 'branch-host.enc'))).toEqual(originalConfig);
    expect((await page.evaluate(() => window.queue.snapshot())).branchId).toBe(before.branchId);
    await page
      .getByRole('button', { name: 'تفعيل اتصال الشبكة مع حفظ البيانات', exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'فُعّل اتصال الفرع' })).toBeVisible({
      timeout: 120000,
    });
    expect((await page.evaluate(() => window.queue.connection())).url).toBe(endpoint);
    expect((await page.evaluate(() => window.queue.snapshot())).branchId).toBe(before.branchId);
    expect(
      (await fs.readdir(path.join(serverDirectory, 'backups'))).some(file =>
        file.endsWith('.pgdata.tar.gz'),
      ),
    ).toBe(true);
    pid = JSON.parse(
      await fs.readFile(path.join(serverDirectory, 'data/.queue-host.lock'), 'utf8'),
    ).pid;
    await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    await expect(page.getByLabel('عنوان اتصال الفرع الحالي')).toHaveValue(endpoint);
    await page.getByRole('button', { name: 'إضافة خدمة', exact: true }).click();
    await page.getByLabel('اسم الخدمة', { exact: true }).fill('خدمة تأهيل الشبكة');
    await page.getByLabel('بادئة الرقم', { exact: true }).fill('A');
    await page.getByRole('button', { name: 'حفظ إعدادات الفرع', exact: true }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.snapshot())).counters.length)
      .toBe(1);
    const after = await page.evaluate(() => window.queue.snapshot());
    await page.getByLabel('نوع الجهاز').selectOption('teller');
    await page
      .locator('.management form')
      .nth(1)
      .locator('select')
      .nth(1)
      .selectOption(after.counters[0].id);
    await page.getByLabel('اسم الموظف / الجهاز').fill('موظف تأهيل الشبكة');
    await page.getByLabel('معرّف الموظف').fill('NETWORK-TEST');
    await page.getByRole('button', { name: 'إصدار مفتاح جهاز', exact: true }).click();
    const file = path.join(directory, 'teller.queue-pairing.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
    await page.getByRole('button', { name: 'حفظ ملف الاقتران', exact: true }).click();
    await expect
      .poll(async () =>
        fs.access(file).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.url).toBe(endpoint);
    expect(saved.token).toMatch(/^[a-f0-9]{64}$/);
    const tellerProfile = path.join(directory, 'teller');
    await fs.mkdir(tellerProfile);
    teller = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: tellerProfile },
    });
    const setup = await teller.firstWindow();
    await setup.getByRole('button', { name: /^موظف الكاونتر/ }).click();
    await teller.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    const replacement = teller.waitForEvent('window');
    await setup.getByRole('button', { name: 'استيراد ملف الاقتران', exact: true }).click();
    const dock = await replacement;
    await expect(dock.locator('.dock-rail')).toBeVisible();
    expect((await dock.evaluate(() => window.queue.snapshot())).branchId).toBe(before.branchId);
    await teller.close();
    teller = null;
    retired.push(app);
    await app.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 10);
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    app = null;
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'الإعدادات', exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.queue.connection())).url).toBe(endpoint);
    expect((await page.evaluate(() => window.queue.snapshot())).branchId).toBe(before.branchId);
    console.log(
      'Existing host LAN transition passed: rejected bad HTTPS without changing configuration, verified backup, same database/UUID, trusted TLS on a real LAN interface, teller pairing-file export/import and persisted manager restart. No OS trust/firewall changes.',
    );
  } finally {
    if (app) {
      const current = app.windows()[0];
      if (current)
        console.log(
          'Network UI diagnostics:',
          await current
            .getByRole('alert')
            .allTextContents()
            .catch(() => []),
        );
    }
    await teller?.close().catch(() => {});
    if (!pid)
      try {
        pid = JSON.parse(
          await fs.readFile(path.join(serverDirectory, 'data/.queue-host.lock'), 'utf8'),
        ).pid;
      } catch {}
    if (pid)
      try {
        process.kill(pid);
      } catch {}
    await app?.close().catch(() => {});
    for (const previous of retired) await previous.close().catch(() => {});
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-network-test-')
    )
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
