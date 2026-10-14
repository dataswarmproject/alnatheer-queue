const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch');
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let freeBundle = false;
  try {
    freeBundle =
      JSON.parse(
        await fs.readFile(
          path.join(root, 'release/arabic-voice-library-free/speech-cache/voice-library.json'),
          'utf8',
        ),
      ).complete === true;
  } catch {}
  if (freeBundle && !process.env.QUEUE_TEST_LOCAL_SPEECH && !process.env.QUEUE_TEST_SPEECH_AUDIO)
    process.env.QUEUE_TEST_LOCAL_SPEECH = path.join(
      root,
      'release/arabic-voice-library-free/speech-cache',
    );
  const upgradeCase = freeBundle && Boolean(process.env.QUEUE_TEST_LOCAL_SPEECH);
  const paidBlockedCase = freeBundle && !process.env.QUEUE_TEST_LOCAL_SPEECH;
  const split = Boolean(process.env.QUEUE_TEST_SPEECH_SPLIT || process.env.QUEUE_TEST_LOCAL_SPEECH);
  if (!process.env.QUEUE_TEST_SPEECH_AUDIO && !process.env.QUEUE_TEST_LOCAL_SPEECH)
    throw new Error(
      'Set QUEUE_TEST_LOCAL_SPEECH to the generated cache, or QUEUE_TEST_SPEECH_AUDIO to a valid MP3 fixture.',
    );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-natural-test-')),
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
    { env: { ...env, QUEUE_FIXTURE_FILE: file }, windowsHide: true, stdio: 'ignore' },
  );
  let app, page;
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
    const profile = path.join(directory, 'display');
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
    const setup = await app.firstWindow();
    await setup.getByText('شاشات مستقلة · إعداد متقدم', { exact: true }).click();
    await setup.getByRole('button', { name: 'شاشة انتظار مستقلة', exact: true }).click();
    await setup.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
    await setup.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture.display.token);
    await app.evaluate(({ app }, paidStatus) => {
      app.queuePaidStatus = paidStatus;
      app.queueSpeechRequests = [];
      const fetchOriginal = global.fetch;
      global.fetch = async (url, options) => {
        if (String(url).endsWith('/v1/speech/status') && app.queuePaidStatus)
          return new Response(JSON.stringify({ configured: true, cachedOnly: false }), {
            headers: { 'content-type': 'application/json' },
          });
        if (String(url).endsWith('/v1/speech')) {
          app.queueSpeechRequests.push(JSON.parse(options.body));
          if (app.queueFailSpeech && JSON.parse(options.body).sequence) {
            app.queueFailSpeech = false;
            return new Response(JSON.stringify({ error: 'TEST temporary audio failure' }), {
              status: 503,
            });
          }
          if (app.queueHoldSpeech && JSON.parse(options.body).sequence) {
            app.queueSpeechWaiting = true;
            await new Promise(resolve => {
              app.queueResumeSpeech = resolve;
            });
          }
        }
        return fetchOriginal(url, options);
      };
    }, upgradeCase);
    const appearing = app.waitForEvent('window');
    await setup.getByRole('button', { name: 'اتصال', exact: true }).click();
    page = await appearing;
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false);
        window.hide();
      }
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (upgradeCase || paidBlockedCase) {
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.queue.audioStatus())).runtime?.natural
              ?.restartRequired,
        )
        .toBe(true);
      const blocked = await page.evaluate(() =>
        window.queue.speech({ test: true }).then(
          () => 'UNEXPECTED SUCCESS',
          error => String(error),
        ),
      );
      expect(blocked).toContain('FREE_VOICE_RESTART_REQUIRED');
      expect(await app.evaluate(({ app }) => app.queueSpeechRequests)).toEqual([]);
      if (paidBlockedCase) {
        console.log(
          'Free bundle correctly rejected the paid-configured legacy fixture before any speech POST. Use the local cache for playback tests.',
        );
        return;
      }
      await app.evaluate(({ app }) => {
        app.queuePaidStatus = false;
      });
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.queue.audioStatus())).runtime?.natural
              ?.restartRequired,
          { timeout: 12000 },
        )
        .not.toBe(true);
    }
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).runtime?.mode, {
        timeout: 12000,
      })
      .toBe('natural');
    await expect(page.locator('button,select,input,footer')).toHaveCount(0);
    // Standalone screens require manager authorization for hidden operator controls.
    expect(
      await page.evaluate(() =>
        window.queue
          .saveAudioSettings({ enabled: false, mode: 'auto', voiceURI: '', volume: 1 })
          .then(
            () => false,
            () => true,
          ),
      ),
    ).toBe(true);
    await page.evaluate(key => window.queue.unlockOperator(key), fixture.manager.token);
    await page.evaluate(() => {
      window.queuePlayback = [];
      const Original = window.Audio;
      window.Audio = class extends Original {
        constructor(src) {
          super(src);
          const alert = String(src).includes('queue-alert-sound');
          this.addEventListener('playing', () =>
            window.queuePlayback.push({ event: 'playing', duration: this.duration, alert }),
          );
          this.addEventListener('ended', () =>
            window.queuePlayback.push({ event: 'ended', alert }),
          );
          this.addEventListener('error', () => window.queuePlayback.push({ event: 'error' }));
        }
      };
      const start = AudioBufferSourceNode.prototype.start;
      const createSource = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function (...args) {
        const source = createSource.apply(this, args);
        // Observe completion before the player closes its audio context.
        source.addEventListener('ended', () =>
          window.queuePlayback.push({ event: 'ended', segment: true }),
        );
        return source;
      };
      AudioBufferSourceNode.prototype.start = function (when, ...args) {
        window.queuePlayback.push({
          event: 'playing',
          segment: true,
          when,
          duration: this.buffer?.duration,
          state: this.context.state,
        });
        return start.call(this, when, ...args);
      };
    });
    await page.evaluate(() => window.queue.testTvAudio());
    await expect
      .poll(() =>
        page.evaluate(
          () => window.queuePlayback.filter(x => x.event === 'playing' && !x.alert).length,
        ),
      )
      .toBe(1);
    expect(
      (await page.evaluate(() => window.queuePlayback.find(x => x.event === 'playing' && !x.alert)))
        .duration,
    ).toBeGreaterThan(5);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.queuePlayback.filter(x => x.event === 'ended' && !x.alert).length,
          ),
        { timeout: 25000 },
      )
      .toBe(1);
    const command = async (actor, action, extra = {}) => {
      const result = await fetch(fixture.url + '/v1/commands', {
        method: 'POST',
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), action, ...extra }),
      });
      expect(result.ok).toBe(true);
      return result.json();
    };
    expect((await page.evaluate(() => window.queue.audioStatus())).settings.enabled).toBe(true);
    await app.evaluate(({ app }) => {
      app.queueHoldSpeech = true;
    });
    await command(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
    await command(fixture.teller, 'next', { expectedRevision: 0 });
    await expect.poll(() => app.evaluate(({ app }) => app.queueSpeechWaiting)).toBe(true);
    await expect(page.locator('.tv-current-called')).toHaveCount(0);
    await app.evaluate(({ app }) => {
      app.queueHoldSpeech = false;
      app.queueResumeSpeech();
    });
    await expect(page.locator('.tv-current-called')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.queuePlayback.filter(x => x.event === 'playing' && !x.alert).length,
        ),
      )
      .toBe(split ? 3 : 2);
    // Adjusting volume during speech must preserve playback and its completion callback.
    await page.evaluate(async () => {
      const { settings } = await window.queue.audioStatus();
      await window.queue.saveAudioSettings({ ...settings, volume: 0.55 });
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.queuePlayback.filter(x => x.event === 'ended' && !x.alert).length,
          ),
        { timeout: 25000 },
      )
      .toBe(split ? 3 : 2);
    await expect(page.locator('.tv-current-called')).toHaveCount(1);
    await pause(2000);
    await expect(page.locator('.tv-current-called')).toHaveCount(1);
    await expect(page.locator('.tv-current-called')).toHaveCount(0, { timeout: 6000 });
    await fetch(fixture.hqUrl + '/test/wan/off');
    await command(fixture.teller, 'recall', { expectedRevision: 1 });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.queuePlayback.filter(x => x.event === 'ended' && !x.alert).length,
          ),
        { timeout: 25000 },
      )
      .toBe(split ? 5 : 3);
    await page.evaluate(async () => {
      const { settings } = await window.queue.audioStatus();
      await window.queue.saveAudioSettings({ ...settings, enabled: false });
    });
    await command(fixture.teller, 'recall', { expectedRevision: 2 });
    await pause(2300);
    expect(
      (
        await page.evaluate(() =>
          window.queuePlayback.filter(x => x.event === 'playing' && !x.alert),
        )
      ).length,
    ).toBe(split ? 5 : 3);
    if (split) {
      const scheduled = await page.evaluate(() =>
        window.queuePlayback.filter(x => x.segment && x.event === 'playing' && !x.alert),
      );
      expect(scheduled).toHaveLength(4);
      expect(scheduled.every(x => x.state === 'running')).toBe(true);
      expect(scheduled[1].when - (scheduled[0].when + scheduled[0].duration)).toBeCloseTo(0.12, 3);
    }
    expect(errors).toEqual([]);
    const playback = await page.evaluate(() => window.queuePlayback);
    expect(playback.filter(x => x.alert && x.event === 'ended')).toHaveLength(3);
    let alertEnded = false;
    for (const event of playback) {
      if (event.alert && event.event === 'playing') alertEnded = false;
      if (event.alert && event.event === 'ended') alertEnded = true;
      if (!event.alert && event.event === 'playing') expect(alertEnded).toBe(true);
    }
    await page.evaluate(async () => {
      const { settings } = await window.queue.audioStatus();
      await window.queue.saveAudioSettings({ ...settings, enabled: true });
    });
    await app.evaluate(({ app }) => {
      app.queueFailSpeech = true;
    });
    await command(fixture.teller, 'recall', { expectedRevision: 3 });
    await expect
      .poll(async () => (await page.evaluate(() => window.queue.audioStatus())).runtime?.error)
      .toContain('هذا النداء غير متاح');
    await command(fixture.teller, 'recall', { expectedRevision: 4 });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.queuePlayback.filter(x => x.event === 'ended' && !x.alert).length,
          ),
        { timeout: 25000 },
      )
      .toBe(split ? 7 : 4);
    expect((await page.evaluate(() => window.queue.audioStatus())).runtime.error).toBe('');
    console.log(
      process.env.QUEUE_TEST_LOCAL_SPEECH
        ? 'Free local audio native flow passed: authenticated branch → IPC → generated Arabic MP3 decode/play/end, ticket and counter segments, alert/highlight timing, offline recall, mute. No paid provider; physical HDMI sound quality is not certified.'
        : 'Natural audio native flow passed: authenticated branch → IPC → real MP3 decode/play/end, real calls, cached recall during provider outage, mute. Provider synthesis is mocked; physical HDMI sound quality is not certified.',
    );
  } catch (error) {
    if (app)
      console.log('Speech request trace', await app.evaluate(({ app }) => app.queueSpeechRequests));
    if (page && !page.isClosed())
      console.log(
        JSON.stringify(
          await page.evaluate(() => ({
            playback: window.queuePlayback,
            alerts: [...document.querySelectorAll('[role="alert"]')].map(x => x.textContent),
            controls: document.querySelector('.audio-controls')?.textContent,
            snapshot: window.queue
              .snapshot()
              .then(x => ({ active: x.active, announcements: x.announcements })),
          })),
          null,
          2,
        ),
      );
    throw error;
  } finally {
    await app?.close().catch(() => {});
    if (host.exitCode === null) {
      const ended = new Promise(r => host.once('exit', r));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-natural-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
