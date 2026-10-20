const { expect } = require('@playwright/test');
const electron = require('./electron-launch.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
const { createServer } = require('node:net');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-setup-test-'));
  const env = { ...process.env, QUEUE_TEST_PROFILE: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let hostPid;
  const retiredApps = [];
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env,
      timeout: 30000,
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'كيف سيُستخدم هذا الكمبيوتر؟' })).toBeVisible();
    await page.getByRole('button', { name: 'شاشات العرض', exact: false }).click();
    await expect(page.getByText('وصّل شاشة العرض بهذا الكمبيوتر عبر HDMI')).toBeVisible();
    await expect(page.getByLabel('عنوان خدمة الفرع')).toBeVisible();
    await expect(page.getByLabel('عنوان خدمة الفرع')).toHaveValue('');
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await expect(page.locator('.form-validation')).toContainText('عنوان خدمة الفرع');
    await expect(page.locator('.form-validation')).toContainText('مفتاح الجهاز');
    await expect(page.getByLabel('عنوان خدمة الفرع')).toBeFocused();
    await page.getByLabel('عنوان خدمة الفرع').fill('not-an-address');
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await expect(page.locator('.form-validation')).toContainText('عنوانًا كاملًا');
    await expect(page.locator('.form-validation')).toContainText('64');
    await page.getByRole('button', { name: 'تغيير الاستخدام', exact: true }).click();
    await page.getByRole('button', { name: 'خادم الفرع', exact: false }).click();
    const setupInfo = await page.evaluate(() => window.queue.hostSetupInfo());
    await expect(page.getByText('نداء عربي جاهز', { exact: false })).toHaveCount(0);
    await expect(page.getByLabel('مفتاح خدمة الصوت', { exact: true })).toHaveCount(0);
    await expect(page.getByText('يُنشأ معرّف الفرع تلقائيًا', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true })).toBeVisible();
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    await page.getByText('لديّ معرّف فرع مسجّل في SARAF', { exact: true }).click();
    await page.getByLabel('معرّف الفرع الحالي · اختياري').fill('not-a-uuid');
    await page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('UUID');
    await page.getByLabel('معرّف الفرع الحالي · اختياري').fill('');
    await page.getByText('اتصال أجهزة الفرع والمركز', { exact: true }).click();
    await expect(page.getByLabel('عنوان مزامنة SARAF · اختياري')).toBeEnabled();
    await page.getByLabel('منفذ الخادم').fill(String(port));
    // The wizard never replaces an occupied folder, including a real-looking old database.
    const occupied = path.join(directory, 'occupied');
    await fs.mkdir(occupied);
    await fs.writeFile(path.join(occupied, 'existing.db'), 'PRESERVE THIS DATABASE');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, occupied);
    await page.getByRole('button', { name: 'اختيار مجلد فارغ', exact: true }).click();
    await page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('اختر مجلدًا فارغًا');
    expect(await fs.readFile(path.join(occupied, 'existing.db'), 'utf8')).toBe(
      'PRESERVE THIS DATABASE',
    );
    const serverFolder = path.join(directory, 'server');
    await fs.mkdir(serverFolder);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, serverFolder);
    await page.getByRole('button', { name: 'اختيار مجلد فارغ', exact: true }).click();
    await page.getByText('لديّ معرّف فرع مسجّل في SARAF', { exact: true }).click();
    await page.getByText('اتصال أجهزة الفرع والمركز', { exact: true }).click();
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/branch-auto-setup.png') });
    await page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true }).click();
    try {
      await expect(page.getByRole('button', { name: 'الإعدادات', exact: true })).toBeVisible({
        timeout: 60000,
      });
    } catch (error) {
      console.error('Setup alert:', await page.getByRole('alert').allTextContents());
      throw error;
    }
    const snapshot = await page.evaluate(() => window.queue.snapshot());
    expect(snapshot.branchId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    await page.getByRole('button', { name: 'إدارة النظام', exact: true }).click();
    await page.getByRole('button', { name: 'نسخ المعرّف', exact: true }).click();
    await expect(page.getByText('نُسخ معرّف الفرع.', { exact: true })).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(snapshot.branchId);
    const identityFile = path.join(directory, 'branch-identity.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, identityFile);
    await page.getByRole('button', { name: 'حفظ ملف المعرّف', exact: true }).click();
    await expect(page.getByText('حُفظ ملف معرّف الفرع لربط SARAF.', { exact: true })).toBeVisible();
    expect(JSON.parse(await fs.readFile(identityFile, 'utf8'))).toEqual({
      version: 1,
      kind: 'saraf-branch-identity',
      branchId: snapshot.branchId,
    });
    await expect(page.evaluate(() => window.queue.branchIdentity('export'))).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(identityFile, 'utf8'))).toEqual({
      version: 1,
      kind: 'saraf-branch-identity',
      branchId: snapshot.branchId,
    });
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    expect(await page.evaluate(() => window.queue.branchIdentity('export'))).toBe(false);
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/branch-identity-saved.png') });
    if (setupInfo.localVoiceAvailable) {
      const voice = JSON.parse(
        await fs.readFile(path.join(serverFolder, 'speech-cache/voice-library.json'), 'utf8'),
      );
      expect(voice.recordings).toBe(1010);
      expect(voice.complete).toBe(true);
      const recordings = (await fs.readdir(path.join(serverFolder, 'speech-cache'))).filter(name =>
        /^[a-f0-9]{64}\.mp3$/.test(name),
      );
      expect(recordings).toHaveLength(1010);
    }
    expect(snapshot.totals.waiting).toBe(0);
    expect(snapshot.services.length).toBe(0);
    expect(snapshot.actor.role).toBe('manager');
    await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    await page.getByRole('button', { name: 'إضافة خدمة', exact: false }).click();
    await page.getByLabel('اسم الخدمة', { exact: true }).fill('خدمة اختبار التهيئة');
    await page.getByLabel('بادئة الرقم', { exact: true }).fill('A');
    await page.getByRole('button', { name: 'حفظ إعدادات الفرع', exact: true }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.snapshot())).counters.length)
      .toBe(1);
    expect((await page.evaluate(() => window.queue.snapshot())).counters[0].paused).toBe(true);
    hostPid = JSON.parse(
      await fs.readFile(path.join(serverFolder, 'data/.queue-host.lock'), 'utf8'),
    ).pid;
    expect((await fs.readFile(path.join(directory, 'branch-host.enc'))).toString()).not.toContain(
      '"token"',
    );
    await expect(
      fs.access(path.join(serverFolder, 'initial-manager.queue-pairing.json')),
    ).rejects.toThrow();
    const endpoint = `http://127.0.0.1:${port}`;
    expect(await page.evaluate(() => window.queue.canBrowseHostFolders())).toBe(true);
    await app.evaluate(({ app, shell }) => {
      app.queueTestFolders = [];
      shell.openPath = async folder => {
        app.queueTestFolders.push(folder);
        return '';
      };
    });
    for (const kind of ['database', 'backup', 'report'])
      await page.evaluate(value => window.queue.browseHostFolder(value), kind);
    expect(await app.evaluate(({ app }) => app.queueTestFolders)).toEqual(
      await Promise.all(
        ['data', 'backups', 'reports'].map(folder => fs.realpath(path.join(serverFolder, folder))),
      ),
    );
    await expect(page.evaluate(() => window.queue.browseHostFolder('../other'))).rejects.toThrow();
    // Playwright launches through cmd.exe on Windows, which waits for descendants.
    // Close the real GUI first; keep its test wrapper until the detached host is stopped.
    retiredApps.push(app);
    await app.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 100);
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    app = null;
    expect((await fetch(endpoint + '/healthz')).status).toBe(200);
    console.log('Wizard provisioned a real database; host remains healthy after manager exit.');
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env,
      timeout: 30000,
    });
    const restarted = await app.firstWindow();
    await expect(restarted.getByRole('button', { name: 'الإعدادات', exact: true })).toBeVisible();
    expect((await restarted.evaluate(() => window.queue.snapshot())).branchId).toBe(
      snapshot.branchId,
    );
    const errors = [];
    restarted.on('pageerror', error => errors.push(error.message));
    await restarted.getByRole('button', { name: 'شاشات العرض', exact: true }).click();
    await expect(restarted.getByRole('heading', { name: 'إدارة شاشات العرض' })).toBeVisible();
    const monitors = await restarted.evaluate(() => window.queue.tvStatus());
    // It must refuse to cover the manager's own monitor.
    await expect(
      restarted.evaluate(id => window.queue.openTv(id), monitors.monitors.find(m => m.primary).id),
    ).rejects.toThrow();
    expect(errors).toEqual([]);
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await restarted.screenshot({ path: path.join(root, 'test-results/hdmi-setup.png') });
    await restarted.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    await restarted.getByRole('button', { name: 'إضافة خدمة', exact: true }).click();
    await restarted.setViewportSize({ width: 1280, height: 1000 });
    await restarted.locator('.panel-content').evaluate(element => {
      element.scrollTop = 0;
    });
    await restarted.screenshot({
      path: path.join(root, 'test-results/manager-empty-form-guidance.png'),
    });
    console.log(
      'First-run wizard passed: real database provisioning, encrypted configuration, occupied-folder preservation, independent server lifetime and restart, manager HDMI controls and primary-screen protection.',
    );
  } finally {
    if (!hostPid) {
      try {
        hostPid = JSON.parse(
          await fs.readFile(path.join(directory, 'server/data/.queue-host.lock'), 'utf8'),
        ).pid;
      } catch {}
    }
    if (hostPid) {
      try {
        process.kill(hostPid);
      } catch {}
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          process.kill(hostPid, 0);
        } catch {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await app?.close().catch(() => {});
    for (const old of retiredApps) await old.close().catch(() => {});
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-setup-test-')
    )
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
