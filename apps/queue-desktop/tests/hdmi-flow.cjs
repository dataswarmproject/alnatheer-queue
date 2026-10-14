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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-hdmi-test-'));
  const file = path.join(directory, 'fixture.json');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'tests/desktop-fixture.ts'),
    ],
    { env: { ...env, QUEUE_FIXTURE_FILE: file }, windowsHide: true, stdio: 'ignore' },
  );
  let app, kioskApp;
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
    const profile = path.join(directory, 'manager');
    await fs.mkdir(profile);
    // Voice qualification explicitly opts in; production displays start muted.
    await fs.writeFile(
      path.join(profile, 'announcement-settings.json'),
      JSON.stringify({
        enabled: true,
        voiceEnabled: true,
        alertEnabled: true,
        mode: 'auto',
        voiceURI: '',
        volume: 1,
      }),
    );
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/setup-role-choice.png') });
    await page.getByRole('button', { name: 'موظف الكاونتر', exact: false }).click();
    await page.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture.manager.token);
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('لا يطابق الاستخدام المختار');
    expect(await page.evaluate(() => window.queue.connection())).toEqual({ configured: false });
    await expect(fs.access(path.join(profile, 'connection.enc'))).rejects.toThrow();
    await page.getByRole('button', { name: 'تغيير الاستخدام', exact: true }).click();
    await page.getByRole('button', { name: 'شاشات العرض', exact: false }).click();
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture.manager.token);
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'إدارة شاشات العرض' })).toBeVisible();
    // Emulate monitor inventory only. Actual HDMI wiring/audio needs a hardware pilot.
    const displayId = await app.evaluate(({ screen, app, BrowserWindow }) => {
      const primary = screen.getPrimaryDisplay();
      const tvId = primary.id + 10000;
      const tv = {
        ...primary,
        id: tvId,
        label: 'TEST شاشة العرض',
        bounds: { ...primary.bounds, x: primary.bounds.x + primary.bounds.width },
        size: primary.size,
      };
      screen.getAllDisplays = () => [primary, tv];
      screen.getDisplayMatching = () => primary;
      app.queueTvBounds = [];
      const old = BrowserWindow.prototype.setBounds;
      BrowserWindow.prototype.setBounds = function (bounds, ...rest) {
        if (this.getTitle().includes('شاشة العرض')) app.queueTvBounds.push(bounds);
        return old.call(this, bounds, ...rest);
      };
      return tvId;
    });
    await page.getByRole('button', { name: 'تحديث الشاشات', exact: true }).click();
    await page.getByLabel('شاشة العرض').selectOption(String(displayId));
    const appeared = app.waitForEvent('window');
    await page.getByRole('button', { name: 'تشغيل شاشة العرض', exact: true }).click();
    const tvPage = await appeared;
    tvPage.on('pageerror', error => errors.push(error.message));
    await expect(tvPage.locator('.tv-ticket')).toHaveText('—');
    const availableArabic = await tvPage.evaluate(
      () =>
        speechSynthesis.getVoices().filter(v => v.localService && /^ar(?:-|$)/i.test(v.lang))
          .length,
    );
    console.log(`Installed local Arabic voices exposed to the native TV: ${availableArabic}.`);
    // Test the Windows fallback explicitly; the installed free library otherwise becomes default.
    if (process.env.QUEUE_TEST_LOCAL_SPEECH)
      await expect
        .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).runtime?.mode)
        .toBe('natural');
    await page.getByLabel('أسلوب النداء').selectOption('local');
    // Mock the speech engine only; actual calls below still traverse the branch database.
    await tvPage.evaluate(() => {
      window.queueSpoken = [];
      window.queueVoices = [
        { voiceURI: 'test-english', name: 'TEST ENGLISH', lang: 'en-US', localService: true },
        { voiceURI: 'test-remote', name: 'TEST REMOTE', lang: 'ar-SA', localService: false },
      ];
      speechSynthesis.getVoices = () => window.queueVoices;
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      speechSynthesis.speak = utterance => {
        window.queueSpoken.push({
          text: utterance.text,
          lang: utterance.lang,
          voiceURI: utterance.voice.voiceURI,
        });
        setTimeout(() => utterance.onend?.({}), 0);
      };
      speechSynthesis.cancel = () => {};
      speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await expect(page.getByRole('button', { name: 'اختبار النداء', exact: true })).toBeDisabled();
    await expect(page.getByText('لا يوجد صوت عربي محلي متاح.', { exact: false })).toBeVisible();
    await tvPage.evaluate(() => {
      window.queueVoices.push(
        { voiceURI: 'test-egypt', name: 'TEST EGYPT', lang: 'ar-EG', localService: true },
        { voiceURI: 'test-saudi', name: 'TEST SAUDI', lang: 'ar-SA', localService: true },
      );
      speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    });
    await expect(page.getByLabel('الصوت العربي')).toHaveValue('test-saudi');
    await expect(page.getByLabel('الصوت العربي').locator('option')).toHaveCount(2);
    await page.getByLabel('الصوت العربي').selectOption('test-egypt');
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).runtime?.voiceURI)
      .toBe('test-egypt');
    await page.getByLabel('الصوت العربي').selectOption('test-saudi');
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).runtime?.voiceURI)
      .toBe('test-saudi');
    await page.getByRole('button', { name: 'اختبار النداء', exact: true }).click();
    await expect
      .poll(() => tvPage.evaluate(() => window.queueSpoken.length), { timeout: 10000 })
      .toBe(1);
    expect((await tvPage.evaluate(() => window.queueSpoken))[0]).toEqual({
      text: 'هذا اختبار للصوت. على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
      lang: 'ar-SA',
      voiceURI: 'test-saudi',
    });
    await tvPage.evaluate(() => {
      window.queueSpoken = [];
    });
    // Calls are enabled by default; controls live only in the manager window.
    await expect(tvPage.locator('button,select,input,footer')).toHaveCount(0);
    await page.getByLabel('مستوى صوت النداء', { exact: false }).press('ArrowLeft');
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).settings.volume)
      .toBe(0.95);
    await expect(tvPage.getByRole('button', { name: 'إعدادات الجهاز', exact: true })).toHaveCount(
      0,
    );
    const state = await page.evaluate(() => window.queue.tvStatus());
    await tvPage.evaluate(() => window.queue.pointer(false));
    expect(state.open).toBe(true);
    expect(state.displayId).toBe(displayId);
    expect(
      JSON.parse(await fs.readFile(path.join(profile, 'tv-layout.json'), 'utf8')),
    ).toMatchObject({ url: fixture.url, enabled: true, displayId });
    const native = await app.evaluate(({ app, BrowserWindow }) => ({
      bounds: app.queueTvBounds,
      windows: BrowserWindow.getAllWindows().map(w => ({
        title: w.getTitle(),
        fullScreen: w.isFullScreen(),
      })),
    }));
    expect(native.bounds.length).toBeGreaterThan(0);
    expect(native.windows.find(w => w.title.includes('شاشة العرض')).fullScreen).toBe(true);
    expect(native.windows.find(w => !w.title.includes('شاشة العرض')).fullScreen).toBe(false);
    for (const operation of [
      'command',
      'connect',
      'createHost',
      'tvStatus',
      'quit',
      'savePairing',
      'saveAudioSettings',
      'testTvAudio',
    ]) {
      expect(
        await tvPage.evaluate(async operation => {
          try {
            await window.queue[operation]({});
            return false;
          } catch {
            return true;
          }
        }, operation),
      ).toBe(true);
    }
    const run = async (actor, action, extra = {}) => {
      const response = await fetch(fixture.url + '/v1/commands', {
        method: 'POST',
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), action, ...extra }),
      });
      if (!response.ok) throw new Error('Fixture command rejected');
      return response.json();
    };
    const issued = await run(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
    await run(fixture.teller, 'next', { expectedRevision: 0 });
    await expect(tvPage.locator('.tv-ticket')).toHaveText(issued.ticket.code, { timeout: 15000 });
    await expect
      .poll(() => tvPage.evaluate(() => window.queueSpoken.length), { timeout: 20000 })
      .toBe(1);
    expect((await tvPage.evaluate(() => window.queueSpoken))[0].text).toBe(
      'على صاحب التذكرة رقم A... واحد، التوجّه إلى الكاونتر رقم واحد.',
    );
    await run(fixture.teller, 'recall', { expectedRevision: 1 });
    await expect
      .poll(() => tvPage.evaluate(() => window.queueSpoken.length), { timeout: 20000 })
      .toBe(2);
    const spoken = await tvPage.evaluate(() => window.queueSpoken);
    expect(spoken[1]).toEqual(spoken[0]);
    await pause(2300);
    expect((await tvPage.evaluate(() => window.queueSpoken)).length).toBe(2);
    await page.getByRole('button', { name: 'كتم النداء الصوتي', exact: true }).click();
    await run(fixture.teller, 'recall', { expectedRevision: 2 });
    await pause(2300);
    expect((await tvPage.evaluate(() => window.queueSpoken)).length).toBe(2);
    await tvPage.screenshot({ path: path.join(root, 'test-results/hdmi-tv-current-ticket.png') });
    await page.screenshot({ path: path.join(root, 'test-results/manager-tv-audio-settings.png') });
    const savedAudio = JSON.parse(
      await fs.readFile(path.join(profile, 'announcement-settings.json'), 'utf8'),
    );
    expect(savedAudio).toMatchObject({
      enabled: true,
      voiceEnabled: false,
      alertEnabled: true,
      mode: 'local',
      volume: 0.95,
    });
    await page.getByRole('button', { name: 'إيقاف شاشة العرض', exact: true }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.tvStatus())).open)
      .toBe(false);
    const devices = await page.evaluate(() => window.queue.devices());
    expect(devices.find(d => d.name === 'HDMI room display').enabled).toBe(false);
    const reopened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'تشغيل شاشة العرض', exact: true }).click();
    const reopenedTv = await reopened;
    await expect(reopenedTv.locator('.tv-ticket')).toHaveText(issued.ticket.code);
    await expect(reopenedTv.locator('button,select,input,footer')).toHaveCount(0);
    expect((await page.evaluate(() => window.queue.audioStatus())).settings).toEqual(savedAudio);
    await page.getByRole('button', { name: 'إيقاف شاشة العرض', exact: true }).click();
    // A late provisioning response must not reopen a TV the manager already stopped.
    await app.evaluate(({ app }) => {
      const original = global.fetch;
      app.queueOriginalFetch = original;
      app.queueProvisionPaused = false;
      global.fetch = async (url, options) => {
        if (String(url).endsWith('/v1/devices') && options?.method === 'POST') {
          app.queueProvisionPaused = true;
          await new Promise(resolve => {
            app.queueResumeProvision = resolve;
          });
        }
        return original(url, options);
      };
    });
    const lateOpen = page.evaluate(async id => {
      try {
        await window.queue.openTv(id);
        return false;
      } catch {
        return true;
      }
    }, displayId);
    await expect.poll(() => app.evaluate(({ app }) => app.queueProvisionPaused)).toBe(true);
    await page.evaluate(() => window.queue.closeTv());
    await app.evaluate(({ app }) => {
      global.fetch = app.queueOriginalFetch;
      app.queueResumeProvision();
    });
    expect(await lateOpen).toBe(true);
    expect((await page.evaluate(() => window.queue.tvStatus())).open).toBe(false);
    // Manager exports a file; another role imports it without typing the key.
    await page.evaluate(() =>
      window.queue.provision({ role: 'kiosk', counterId: null, name: 'TEST PAIRING FILE' }),
    );
    const pairingFile = path.join(directory, 'kiosk.queue-pairing.json');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, pairingFile);
    expect(await page.evaluate(() => window.queue.savePairing())).toBe(true);
    const kioskProfile = path.join(directory, 'kiosk');
    await fs.mkdir(kioskProfile);
    kioskApp = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: kioskProfile },
      timeout: 30000,
    });
    const kioskPage = await kioskApp.firstWindow();
    await kioskPage.getByRole('button', { name: 'جهاز إصدار التذاكر', exact: false }).click();
    await kioskApp.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, pairingFile);
    const kioskReplaced = kioskApp.waitForEvent('window');
    await kioskPage.getByRole('button', { name: 'استيراد ملف الاقتران', exact: true }).click();
    const connectedKiosk = await kioskReplaced;
    await expect(connectedKiosk.getByRole('heading', { name: 'كيف يمكننا خدمتك؟' })).toBeVisible();
    expect(errors).toEqual([]);
    console.log(
      'HDMI workflow passed: role mismatch rejection, monitor routing, independent manager/TV windows, real queue updates, read-only TV IPC, display key revocation, canceled-opening race, manager pairing-file export and kiosk import. Monitor inventory is emulated.',
    );
  } finally {
    await kioskApp?.close().catch(() => {});
    await app?.close().catch(() => {});
    if (host.exitCode === null) {
      const ended = new Promise(resolve => host.once('exit', resolve));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-hdmi-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
