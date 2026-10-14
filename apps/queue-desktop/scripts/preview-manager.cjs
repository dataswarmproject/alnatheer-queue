const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const root = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(root, '../../services/queue-branch'),
  directory = path.join(root, 'release/local-manager-preview');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'running.queue-pairing.json'),
    profile = path.join(directory, 'profile');
  await fs.mkdir(profile, { recursive: true });
  await fs.unlink(file).catch(e => {
    if (e.code !== 'ENOENT') throw e;
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const host = spawn(
    process.execPath,
    [
      '--import',
      require('node:url').pathToFileURL(require.resolve('tsx/esm', { paths: [hostRoot] })).href,
      path.join(hostRoot, 'dev/manager-preview.ts'),
    ],
    {
      env: { ...env, QUEUE_PREVIEW_ROOT: directory, QUEUE_PREVIEW_FILE: file },
      windowsHide: true,
      stdio: 'ignore',
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
      if (host.exitCode !== null) throw new Error('Local preview failed');
      await pause(250);
    }
    if (!pairing) throw new Error('Preview timeout');
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      env: { ...env, QUEUE_TEST_PROFILE: profile },
    });
    const page = await app.firstWindow();
    const connection = await page.evaluate(() => window.queue.connection());
    if (connection.configured) await page.evaluate(() => window.queue.disconnect());
    await expect(page.getByRole('button', { name: /^إدارة الفرع/ })).toBeVisible();
    await page.getByRole('button', { name: /^إدارة الفرع/ }).click();
    await page.getByLabel('عنوان خدمة الفرع').fill(pairing.url);
    await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(pairing.token);
    await page.getByRole('button', { name: 'اتصال', exact: true }).click();
    await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    console.log(
      'Updated manager app is open on its isolated local database. No operational sample data or HQ connection. Close the app to stop this preview; entered records are preserved locally.',
    );
    await new Promise(resolve => app.on('close', resolve));
  } finally {
    await app?.close().catch(() => {});
    host.kill();
  }
})().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
