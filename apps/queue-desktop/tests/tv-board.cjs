const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch');
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-tv-board-test-')),
    file = path.join(directory, 'fixture.json');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.QUEUE_TEST_SPEECH_AUDIO;
  delete env.QUEUE_TEST_SPEECH_SPLIT;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'tests/desktop-fixture.ts'),
    ],
    {
      env: { ...env, QUEUE_FIXTURE_FILE: file, QUEUE_TEST_COUNTERS: '6' },
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
      if (host.exitCode !== null) throw new Error('Fixture exited');
      await pause(250);
    }
    if (!fixture) throw new Error('Fixture timed out');
    const request = async (actor, route, input) => {
      const response = await fetch(fixture.url + route, {
        method: 'POST',
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(JSON.stringify({ route, input, status: response.status, result }));
      return result;
    };
    const command = (actor, action, extra = {}) =>
      request(actor, '/v1/commands', { requestId: crypto.randomUUID(), action, ...extra });
    const actors = [fixture.teller];
    for (const counter of fixture.counters.slice(1))
      actors.push(
        await request(fixture.manager, '/v1/devices', { role: 'teller', counterId: counter.id }),
      );
    for (let i = 0; i < 3; i++) {
      await command(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
      await command(actors[i], 'next', { expectedRevision: 0 });
    }
    await command(actors[0], 'start', { expectedRevision: 1 });
    await command(actors[5], 'pause', { expectedRevision: 0 });
    const profile = path.join(directory, 'display');
    await fs.mkdir(profile);
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
    const appearing = app.waitForEvent('window');
    await setup.getByRole('button', { name: 'اتصال', exact: true }).click();
    const page = await appearing;
    await expect(page.locator('.tv-counters article')).toHaveCount(6);
    await expect(page.locator('button, select, input, footer, .audio-controls')).toHaveCount(0);
    await expect(page.locator('.customer-logo')).toBeVisible();
    await expect(page.locator('.customer-header time')).toBeVisible();
    await expect(page.locator('.tv-ticket')).toHaveText('A-003');
    // This visual-only test mutes announcements through authorized operator IPC.
    await page.evaluate(key => window.queue.unlockOperator(key), fixture.manager.token);
    await page.evaluate(async () => {
      const { settings } = await window.queue.audioStatus();
      await window.queue.saveAudioSettings({ ...settings, enabled: false });
    });
    // Opening the TV must not highlight an old call indefinitely.
    await expect(page.locator('.tv-current-called')).toHaveCount(0);
    await command(actors[2], 'recall', { expectedRevision: 1 });
    await expect(page.locator('.tv-current-called')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await expect(page.locator('.tv-current-called')).toHaveCSS('color', 'rgb(205, 22, 89)');
    await pause(350);
    for (let i = 0; i < 3; i++)
      await expect(page.locator(`[data-counter-id="${fixture.counters[i].id}"] strong`)).toHaveText(
        `A-00${i + 1}`,
      );
    await expect(page.locator('.tv-counter-idle')).toHaveCount(3);
    await expect(page.getByText('متوقف مؤقتًا', { exact: true })).toHaveCount(1);
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      const boxes = await page.locator('.tv-counters article').evaluateAll(nodes =>
        nodes.map(node => {
          const r = node.getBoundingClientRect();
          return {
            bottom: r.bottom,
            right: r.right,
            left: r.left,
            top: r.top,
            clipped: node.scrollHeight > node.clientHeight,
          };
        }),
      );
      await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
      await page.screenshot({
        path: path.join(root, `test-results/tv-counter-board-${width}.png`),
      });
      if (
        !boxes.every(
          box => box.bottom <= height && box.right <= width && box.left >= 0 && !box.clipped,
        )
      )
        console.log({ width, height, boxes });
      expect(
        boxes.every(
          box => box.bottom <= height && box.right <= width && box.left >= 0 && !box.clipped,
        ),
      ).toBe(true);
      expect(boxes).toHaveLength(6);
      // Every counter occupies the same column, in separate rows.
      expect(boxes.every(box => Math.abs(box.left - boxes[0].left) < 1)).toBe(true);
      expect(boxes.every((box, i) => i === 0 || box.top >= boxes[i - 1].bottom)).toBe(true);
      const mainPanel = await page.locator('.tv-current').boundingBox();
      expect(mainPanel.width).toBeGreaterThan((boxes[0].right - boxes[0].left) * 2.8);
    }
    await expect(page.locator('.tv-current-called')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.tv-current')).toHaveCSS('background-color', 'rgb(10, 10, 10)');
    await expect(page.locator('.tv-ticket')).toHaveText('A-003');
    // The board stays fixed beyond the former eight-second paging interval.
    await pause(8500);
    await expect(page.locator('.tv-counters article')).toHaveCount(6);
    await expect(page.locator('.tv-board-heading > span')).toHaveCount(0);
    for (const counter of fixture.counters)
      await expect(page.locator(`[data-counter-id="${counter.id}"]`)).toHaveCount(1);
    await command(actors[2], 'recall', { expectedRevision: 2 });
    await expect(page.locator('.tv-current-called')).toHaveCount(1);
    await command(actors[2], 'start', { expectedRevision: 3 });
    await expect(page.locator('.tv-current-called')).toHaveCount(0);
    await page.screenshot({ path: path.join(root, 'test-results/tv-counter-board-idle-1280.png') });
    await command(actors[0], 'complete', { expectedRevision: 2 });
    await expect(page.locator(`[data-counter-id="${fixture.counters[0].id}"] strong`)).toHaveText(
      '—',
    );
    await expect(page.locator(`[data-counter-id="${fixture.counters[0].id}"] small`)).toHaveText(
      'متاح',
    );
    await page.keyboard.press('Control+Shift+s');
    await expect(page.getByRole('heading', { name: 'إعدادات المشرف' })).toBeVisible();
    await page.getByLabel('مفتاح مدير الفرع').fill(fixture.manager.token);
    await page.getByRole('button', { name: 'فتح إعدادات المشرف' }).click();
    await expect(page.getByRole('heading', { name: 'إعدادات النداء' })).toBeVisible();
    await expect(page.getByLabel('أسلوب النداء')).toHaveValue('auto');
    await page.getByRole('button', { name: 'العودة إلى الشاشة', exact: true }).click();
    await expect(page.locator('.tv-counters article')).toHaveCount(6);
    await expect(page.locator('button,select,input,footer')).toHaveCount(0);
    console.log(
      'TV counter board passed: six fixed counters in one narrow column, no paging, current calls, service/idle/pause states, latest-call highlight, completion clears the correct row, no clipping at 1080p/720p. Disposable test data only.',
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
      path.basename(directory).startsWith('queue-tv-board-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
