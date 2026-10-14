// Opt-in physical HDMI qualification. No simulated monitors or speech playback.
const { expect } = require('@playwright/test');
const electron = require('./electron-launch.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-hdmi-hardware-')),
    file = path.join(directory, 'fixture.json');
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
      env: {
        ...env,
        QUEUE_FIXTURE_FILE: file,
        QUEUE_TEST_COUNTERS: '6',
        QUEUE_TEST_LOCAL_SPEECH: path.join(root, 'release/arabic-voice-library-free/speech-cache'),
      },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  let app, observedManager, observedTv;
  try {
    let fixture;
    for (let i = 0; i < 120; i++) {
      try {
        fixture = JSON.parse(await fs.readFile(file, 'utf8'));
        break;
      } catch {}
      if (host.exitCode !== null) throw new Error('Hardware fixture exited');
      await pause(250);
    }
    if (!fixture) throw new Error('Hardware fixture timed out');
    const request = async (actor, route, input) => {
      const response = await fetch(fixture.url + route, {
        method: input ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ' + actor.token, 'content-type': 'application/json' },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          'Hardware test request rejected: ' +
            response.status +
            ' ' +
            (result.error?.message ?? ''),
        );
      return result;
    };
    const command = async (actor, action, extra = {}) => {
      const snapshot = await request(actor, '/v1/snapshot');
      return request(actor, '/v1/commands', {
        requestId: randomUUID(),
        action,
        expectedRevision: snapshot.counter?.revision ?? 0,
        ...extra,
      });
    };
    await fetch(fixture.hqUrl + '/test/wan/off', { method: 'POST' });
    // Prepare A-023 in this disposable database, before opening the TV.
    for (let i = 0; i < 22; i++) {
      await command(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
      await command(fixture.teller, 'next');
      await command(fixture.teller, 'no_show');
    }
    const third = await request(fixture.manager, '/v1/devices', {
      role: 'teller',
      counterId: fixture.counters[2].id,
      name: 'TEST HDMI COUNTER 3',
      staffRef: 'TEST-ONLY',
    });
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
    });
    const manager = await app.firstWindow({ timeout: 60000 });
    observedManager = manager;
    const errors = [];
    manager.on('pageerror', error => errors.push(error.message));
    await manager.getByRole('button', { name: /^إدارة الفرع/ }).evaluate(button => button.click());
    await manager.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
    await manager.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture.manager.token);
    await manager
      .getByRole('button', { name: 'اتصال', exact: true })
      .evaluate(button => button.click());
    await manager
      .getByRole('button', { name: 'شاشات العرض', exact: true })
      .evaluate(button => button.click());
    if (process.env.QUEUE_TEST_EMULATED_HDMI === '1') {
      await app.evaluate(({ screen }) => {
        const primary = screen.getPrimaryDisplay();
        screen.getAllDisplays = () => [
          primary,
          {
            ...primary,
            id: primary.id + 10000,
            label: 'TEST EMULATED HDMI',
            bounds: { ...primary.bounds, x: primary.bounds.x + primary.bounds.width },
          },
        ];
        screen.getDisplayMatching = bounds =>
          bounds.x >= primary.bounds.x + primary.bounds.width
            ? screen.getAllDisplays()[1]
            : primary;
      });
      await manager
        .getByRole('button', { name: 'تحديث الشاشات', exact: true })
        .evaluate(button => button.click());
    }
    const status = await manager.evaluate(() => window.queue.tvStatus());
    const monitor = status.monitors
      .filter(m => !m.primary)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!monitor) throw new Error('No real secondary TV detected. Windows must be in Extend mode.');
    await manager.getByLabel('شاشة العرض').selectOption(String(monitor.id));
    const appeared = app.waitForEvent('window');
    await manager
      .getByRole('button', { name: 'تشغيل شاشة العرض', exact: true })
      .evaluate(button => button.click());
    const tv = await appeared;
    observedTv = tv;
    // Keep this disposable automation window separate from the manager the user tests.
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.getTitle().includes('شاشة العرض')) {
          window.webContents.setBackgroundThrottling(false);
          window.hide();
        }
    });
    tv.on('pageerror', error => errors.push(error.message));
    await expect(tv.locator('.tv-counters article')).toHaveCount(6);
    await expect(tv.locator('button,input,select,footer')).toHaveCount(0);
    const idleBackground = await tv
      .locator('.tv-current')
      .evaluate(panel => getComputedStyle(panel).backgroundColor);
    await expect
      .poll(async () => (await manager.evaluate(() => window.queue.audioStatus())).runtime?.mode)
      .toBe('natural');
    await manager.evaluate(async () => {
      const { settings } = await window.queue.audioStatus();
      await window.queue.saveAudioSettings({
        ...settings,
        enabled: true,
        mode: 'natural',
        volume: 0.7,
      });
    });
    const actual = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(window =>
        window.getTitle().includes('شاشة العرض'),
      );
      return {
        fullScreen: window.isFullScreen(),
        displayId: screen.getDisplayMatching(window.getBounds()).id,
        bounds: window.getBounds(),
      };
    });
    expect(actual.fullScreen).toBe(true);
    if (process.env.QUEUE_TEST_EMULATED_HDMI !== '1') expect(actual.displayId).toBe(monitor.id);
    // Observe genuine media events without replacing playback or its timing.
    await tv.evaluate(() => {
      window.queueHardwareAudio = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        const clip = { started: performance.now(), ended: null, error: null, kind: 'media' };
        window.queueHardwareAudio.push(clip);
        this.addEventListener(
          'ended',
          () => {
            clip.ended = performance.now();
          },
          { once: true },
        );
        this.addEventListener(
          'error',
          () => {
            clip.error = this.error?.message ?? 'media error';
          },
          { once: true },
        );
        return original.apply(this, args).catch(error => {
          clip.error = error.message;
          throw error;
        });
      };
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function (...args) {
        const source = createSource.apply(this, args);
        const clip = { started: null, ended: null, error: null, kind: 'voice-buffer' };
        const start = source.start;
        source.start = function (...parameters) {
          clip.started = performance.now();
          window.queueHardwareAudio.push(clip);
          return start.apply(this, parameters);
        };
        source.addEventListener(
          'ended',
          () => {
            clip.ended = performance.now();
          },
          { once: true },
        );
        return source;
      };
    });
    const issued = await command(fixture.kiosk, 'issue', {
      serviceId: fixture.serviceId,
      requirePrint: true,
    });
    expect(issued.ticket.code).toBe('A-023');
    await expect(command(third, 'next')).rejects.toThrow('No waiting customers');
    await manager
      .getByRole('button', { name: 'شاشات العرض', exact: true })
      .evaluate(button => button.click());
    await command(fixture.kiosk, 'printed', { ticketId: issued.ticket.id });
    await command(third, 'next');
    await expect(tv.locator('.tv-ticket')).toHaveText('A-023', { timeout: 15000 });
    await expect(tv.locator('.tv-counter')).toHaveText('TEST · كاونتر 3');
    await expect(tv.locator('.tv-current')).toHaveCSS('background-color', 'rgb(255, 255, 255)', {
      timeout: 10000,
    });
    await expect(tv.locator('.tv-current')).toHaveCSS('color', 'rgb(205, 22, 89)');
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await tv.screenshot({ path: path.join(root, 'test-results/real-hdmi-calling-A023.png') });
    console.log('Real TV call: A-023 → counter 3; alert and cached Arabic voice playing.');
    await expect
      .poll(() => tv.evaluate(() => window.queueHardwareAudio.length), { timeout: 20000 })
      .toBe(3);
    await expect
      .poll(
        () =>
          tv.evaluate(() =>
            window.queueHardwareAudio.every(clip => clip.ended !== null && !clip.error),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const endedAt = await tv.evaluate(() => window.queueHardwareAudio.at(-1).ended);
    await expect(tv.locator('.tv-current')).toHaveCSS('background-color', idleBackground, {
      timeout: 10000,
    });
    const returnDelay = await tv.evaluate(ended => performance.now() - ended, endedAt);
    expect(returnDelay).toBeGreaterThanOrEqual(4900);
    await command(third, 'recall');
    await expect
      .poll(() => tv.evaluate(() => window.queueHardwareAudio.length), { timeout: 15000 })
      .toBe(6);
    await expect
      .poll(
        () =>
          tv.evaluate(() =>
            window.queueHardwareAudio.every(clip => clip.ended !== null && !clip.error),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    await command(third, 'pause');
    await expect(command(third, 'start')).rejects.toThrow('Resume');
    await command(third, 'resume');
    await command(third, 'start');
    await command(third, 'transfer', { serviceId: fixture.secondService });
    await expect(tv.locator('.tv-ticket')).toHaveText('—', { timeout: 10000 });
    await command(third, 'next');
    await expect(tv.locator('.tv-ticket')).toHaveText('A-023', { timeout: 10000 });
    await expect
      .poll(() => tv.evaluate(() => window.queueHardwareAudio.length), { timeout: 15000 })
      .toBe(9);
    await expect
      .poll(
        () =>
          tv.evaluate(() =>
            window.queueHardwareAudio.every(clip => clip.ended !== null && !clip.error),
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    await command(third, 'start');
    await command(third, 'complete');
    await expect(tv.locator('.tv-ticket')).toHaveText('—', { timeout: 10000 });
    await expect(command(third, 'next')).rejects.toThrow('No waiting customers');
    const channelResults = [];
    await manager
      .getByRole('button', { name: 'شاشات العرض', exact: true })
      .evaluate(button => button.click());
    for (const [voiceEnabled, alertEnabled, expectedClips] of [
      [true, false, 2],
      [false, true, 1],
      [true, true, 3],
      [false, false, 0],
    ]) {
      const settings = (await manager.evaluate(() => window.queue.audioStatus())).settings;
      if (settings.voiceEnabled !== voiceEnabled)
        await manager
          .getByRole('button', {
            name: settings.voiceEnabled ? 'كتم النداء الصوتي' : 'تشغيل النداء الصوتي',
            exact: true,
          })
          .evaluate(button => button.click());
      await expect
        .poll(
          async () =>
            (await manager.evaluate(() => window.queue.audioStatus())).settings.voiceEnabled,
        )
        .toBe(voiceEnabled);
      const afterVoice = (await manager.evaluate(() => window.queue.audioStatus())).settings;
      if (afterVoice.alertEnabled !== alertEnabled)
        await manager
          .getByRole('button', {
            name: afterVoice.alertEnabled ? 'كتم صوت التنبيه' : 'تشغيل صوت التنبيه',
            exact: true,
          })
          .evaluate(button => button.click());
      await expect
        .poll(
          async () =>
            (await manager.evaluate(() => window.queue.audioStatus())).settings.alertEnabled,
        )
        .toBe(alertEnabled);
      await tv.evaluate(() => {
        window.queueHardwareAudio = [];
      });
      const ticket = await command(fixture.kiosk, 'issue', {
        serviceId: fixture.serviceId,
        requirePrint: true,
      });
      await command(fixture.kiosk, 'printed', { ticketId: ticket.ticket.id });
      await command(third, 'next');
      await expect(tv.locator('.tv-ticket')).toHaveText(ticket.ticket.code, { timeout: 15000 });
      await expect(tv.locator('.tv-current')).toHaveCSS('background-color', 'rgb(255, 255, 255)', {
        timeout: 10000,
      });
      await expect
        .poll(() => tv.evaluate(() => window.queueHardwareAudio.length), { timeout: 20000 })
        .toBe(expectedClips);
      if (expectedClips)
        await expect
          .poll(
            () =>
              tv.evaluate(() =>
                window.queueHardwareAudio.every(clip => clip.ended !== null && !clip.error),
              ),
            { timeout: 30000 },
          )
          .toBe(true);
      await expect(tv.locator('.tv-current')).toHaveCSS('background-color', idleBackground, {
        timeout: 10000,
      });
      const clips = await tv.evaluate(() => window.queueHardwareAudio);
      expect(clips.filter(clip => clip.kind === 'media')).toHaveLength(alertEnabled ? 1 : 0);
      expect(clips.filter(clip => clip.kind === 'voice-buffer')).toHaveLength(voiceEnabled ? 2 : 0);
      channelResults.push({ voiceEnabled, alertEnabled, clips: clips.length });
      await command(third, 'start');
      await command(third, 'complete');
    }
    expect(
      JSON.parse(await fs.readFile(path.join(profile, 'announcement-settings.json'), 'utf8')),
    ).toMatchObject({ voiceEnabled: false, alertEnabled: false });
    await manager.screenshot({
      path: path.join(root, 'test-results/manager-separate-audio-controls.png'),
    });
    if (process.env.QUEUE_TEST_EMULATED_HDMI === '1') {
      // Simulate voice availability only. Alert/media playback remains genuine.
      await tv.evaluate(() => {
        speechSynthesis.getVoices = () => [];
        speechSynthesis.dispatchEvent(new Event('voiceschanged'));
      });
      await manager.evaluate(async () => {
        const { settings } = await window.queue.audioStatus();
        await window.queue.saveAudioSettings({
          ...settings,
          mode: 'local',
          voiceEnabled: true,
          alertEnabled: true,
        });
      });
      await expect
        .poll(async () => (await manager.evaluate(() => window.queue.audioStatus())).runtime?.ready)
        .toBe(false);
      await tv.evaluate(() => {
        window.queueHardwareAudio = [];
      });
      await manager.getByRole('button', { name: 'اختبار النداء', exact: true }).waitFor();
      await expect(
        manager.getByRole('button', { name: 'اختبار النداء', exact: true }),
      ).toBeEnabled();
      await manager
        .getByRole('button', { name: 'اختبار النداء', exact: true })
        .evaluate(button => button.click());
      await expect.poll(() => tv.evaluate(() => window.queueHardwareAudio.length)).toBe(1);
      await expect
        .poll(
          () =>
            tv.evaluate(
              () =>
                window.queueHardwareAudio[0].ended !== null && !window.queueHardwareAudio[0].error,
            ),
          { timeout: 15000 },
        )
        .toBe(true);
      const fallbackTicket = await command(fixture.kiosk, 'issue', {
        serviceId: fixture.serviceId,
        requirePrint: true,
      });
      await command(fixture.kiosk, 'printed', { ticketId: fallbackTicket.ticket.id });
      await command(third, 'next');
      await expect
        .poll(() => tv.evaluate(() => window.queueHardwareAudio.length), { timeout: 15000 })
        .toBe(2);
      await expect
        .poll(
          () =>
            tv.evaluate(() =>
              window.queueHardwareAudio.every(clip => clip.ended !== null && !clip.error),
            ),
          { timeout: 15000 },
        )
        .toBe(true);
      expect(
        await tv.evaluate(() => window.queueHardwareAudio.every(clip => clip.kind === 'media')),
      ).toBe(true);
      await command(third, 'start');
      await command(third, 'complete');
      channelResults.push({
        voiceUnavailable: true,
        alertEnabled: true,
        clips: 2,
        testAndCall: true,
      });
      await manager
        .getByRole('button', { name: 'كتم صوت التنبيه', exact: true })
        .evaluate(button => button.click());
      await expect(
        manager.getByRole('button', { name: 'اختبار النداء', exact: true }),
      ).toBeDisabled();
      await tv.evaluate(() => {
        window.queueHardwareAudio = [];
      });
      const silentTicket = await command(fixture.kiosk, 'issue', {
        serviceId: fixture.serviceId,
        requirePrint: true,
      });
      await command(fixture.kiosk, 'printed', { ticketId: silentTicket.ticket.id });
      await command(third, 'next');
      await expect(tv.locator('.tv-ticket')).toHaveText(silentTicket.ticket.code, {
        timeout: 15000,
      });
      await expect(tv.locator('.tv-current')).toHaveCSS('background-color', 'rgb(255, 255, 255)', {
        timeout: 10000,
      });
      await expect(tv.locator('.tv-current')).toHaveCSS('background-color', idleBackground, {
        timeout: 10000,
      });
      expect(await tv.evaluate(() => window.queueHardwareAudio.length)).toBe(0);
      await command(third, 'start');
      await command(third, 'complete');
      channelResults.push({ voiceUnavailable: true, alertEnabled: false, clips: 0 });
    }
    await fetch(fixture.hqUrl + '/test/wan/on', { method: 'POST' });
    await expect
      .poll(async () => (await (await fetch(fixture.hqUrl + '/state')).json()).acknowledged, {
        timeout: 60000,
      })
      .toBe((await request(fixture.manager, '/v1/snapshot')).revision);
    await manager
      .getByRole('button', { name: 'الأداء والتقارير', exact: true })
      .evaluate(button => button.click());
    await expect(
      manager.getByRole('rowheader').filter({ hasText: 'TEST HDMI COUNTER 3' }),
    ).toBeVisible();
    await manager
      .getByRole('button', { name: 'إدارة النظام', exact: true })
      .evaluate(button => button.click());
    await manager
      .getByRole('button', { name: 'إنشاء نسخة احتياطية', exact: true })
      .evaluate(button => button.click());
    await expect(manager.getByRole('status').filter({ hasText: 'حُفظت نسخة متحققة' })).toBeVisible({
      timeout: 30000,
    });
    await tv.screenshot({ path: path.join(root, 'test-results/real-hdmi-idle.png') });
    const report = {
      monitor,
      actual,
      audioClips: 9 + channelResults.reduce((sum, result) => sum + result.clips, 0),
      voiceReturnDelayMs: Math.round(returnDelay),
      rendererErrors: errors,
      channelResults,
      monitorQualification: process.env.QUEUE_TEST_EMULATED_HDMI === '1' ? 'emulated' : 'physical',
      printer: 'Windows print acceptance simulated; physical printer not provided',
      lan: 'Local client/server qualification; separate LAN PCs not tested',
    };
    expect(errors).toEqual([]);
    await fs.writeFile(
      path.join(root, 'test-results/real-hdmi-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log('Physical HDMI workflow passed: ' + JSON.stringify(report));
  } catch (error) {
    console.error(
      'Audio diagnostics',
      await observedManager?.evaluate(() => window.queue.audioStatus()).catch(() => null),
      await observedTv
        ?.evaluate(() => ({
          clips: window.queueHardwareAudio,
          visibility: document.visibilityState,
        }))
        .catch(() => null),
      await observedManager
        ?.getByRole('button')
        .allTextContents()
        .catch(() => null),
    );
    throw error;
  } finally {
    await app?.close().catch(() => {});
    if (host.exitCode === null) {
      const ended = new Promise(resolve => host.once('exit', resolve));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-hdmi-hardware-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
