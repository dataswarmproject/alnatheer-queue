// Opens the actual native dock against an empty, disposable local branch.
const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const appRoot = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(appRoot, '../../services/queue-branch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-dock-preview-'));
  const file = path.join(directory, 'pairing.json'),
    profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'dev/preview.ts'),
    ],
    {
      env: { ...env, QUEUE_PREVIEW_FILE: file },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let app;
  try {
    let pairing;
    for (let i = 0; i < 120; i++) {
      try {
        pairing = JSON.parse(await fs.readFile(file, 'utf8'));
        break;
      } catch {}
      if (host.exitCode !== null) throw new Error('Local preview host failed');
      await pause(250);
    }
    if (!pairing) throw new Error('Local preview host timed out');
    app = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    let page = await app.firstWindow();
    await page.getByRole('button', { name: /^موظف الكاونتر/ }).click();
    await page.getByLabel('عنوان خدمة الفرع').fill(pairing.url);
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(pairing.token);
    const appeared = app.waitForEvent('window');
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    page = await appeared;
    await expect(page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' })).toBeVisible();
    await expect(page.locator('.ticket-head strong')).toHaveText('—');
    await expect(page.locator('.dock-actions button')).toHaveCount(6);
    await page.screenshot({
      path: path.join(appRoot, 'test-results/dock-empty-preview.png'),
      omitBackground: true,
    });
    console.log(
      'Side dock is open: empty local preview, six actions, no customer tickets, no SARAF connection.',
    );
    if (process.argv.includes('--expanded')) {
      await page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' }).click();
      await expect(page.getByRole('button', { name: 'تصغير إلى الشريط' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'تصغير إلى الشريط' })).toBeEnabled();
      const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          bounds: window.getBounds(),
          area: screen.getDisplayMatching(window.getBounds()).workArea,
        };
      });
      expect(
        Math.abs(bounds.bounds.x + bounds.bounds.width / 2 - bounds.area.x - bounds.area.width / 2),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          bounds.bounds.y + bounds.bounds.height / 2 - bounds.area.y - bounds.area.height / 2,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: path.join(appRoot, 'test-results/teller-expanded-preview.png'),
      });
      console.log('Expanded teller panel is centered on the current display work area.');
    }
    await new Promise(resolve => app.on('close', resolve));
  } finally {
    if (app) await app.close().catch(() => {});
    host.kill();
    await pause(300);
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-dock-preview-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
