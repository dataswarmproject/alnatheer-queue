const { _electron: electron, expect } = require('@playwright/test');
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
    await page.getByRole('button', { name: 'تغيير الاستخدام', exact: true }).click();
    await page.getByRole('button', { name: 'خادم الفرع', exact: false }).click();
    const setupInfo = await page.evaluate(() => window.queue.hostSetupInfo());
    if (setupInfo.localVoiceAvailable) {
      await expect(
        page.getByText('نداء عربي جاهز يعمل دون اشتراك أو اتصال بالإنترنت.'),
      ).toBeVisible();
      await expect(page.getByLabel('مفتاح خدمة الصوت', { exact: true })).toHaveCount(0);
    }
    await expect(page.getByLabel('معرّف الفرع في SARAF')).toBeVisible();
    await expect(page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true })).toBeVisible();
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    await page.getByLabel('معرّف الفرع في SARAF').fill(crypto.randomUUID());
    await page.getByText('اتصال أجهزة الفرع والمركز', { exact: true }).click();
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
    await page.getByRole('button', { name: 'إنشاء خادم الفرع', exact: true }).click();
    await expect(page.getByRole('button', { name: 'الإعدادات', exact: true })).toBeVisible({
      timeout: 60000,
    });
    const snapshot = await page.evaluate(() => window.queue.snapshot());
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
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
