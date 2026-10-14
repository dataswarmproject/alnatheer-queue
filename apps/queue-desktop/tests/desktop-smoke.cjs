const { _electron: electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const appRoot = path.resolve(__dirname, '..'),
  hostRoot = path.resolve(appRoot, '../../services/queue-branch');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-native-test-')),
    fixtureFile = path.join(directory, 'fixture.json');
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
      env: { ...env, QUEUE_FIXTURE_FILE: fixtureFile },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let hostErrors = '';
  host.stderr.on('data', chunk => (hostErrors += chunk));
  let app;
  try {
    let fixture;
    for (let i = 0; i < 120; i++) {
      try {
        fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
        break;
      } catch {}
      if (host.exitCode != null) throw new Error(hostErrors);
      await pause(250);
    }
    if (!fixture) throw new Error('Fixture did not start: ' + hostErrors);
    const request = async (actor, action, extra = {}) => {
      const response = await fetch(fixture.url + '/v1/commands', {
        method: 'POST',
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), action, ...extra }),
      });
      if (!response.ok) throw new Error('Fixture command rejected ' + response.status);
      return response.json();
    };
    const launch = async (role, profile) => {
      await fs.mkdir(path.join(directory, profile));
      app = await electron.launch({
        executablePath: require('electron'),
        args: [appRoot],
        env: { ...env, QUEUE_TEST_PROFILE: path.join(directory, profile) },
      });
      let page = await app.firstWindow();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page
        .getByRole('button', {
          name: role === 'teller' ? 'موظف الكاونتر' : 'إدارة الفرع',
          exact: false,
        })
        .click();
      await page.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
      await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture[role].token);
      const replaced = role === 'teller' ? app.waitForEvent('window') : null;
      await page.getByRole('button', { name: 'اتصال', exact: true }).click();
      if (replaced) {
        page = await replaced;
        page.on('pageerror', error => errors.push(error.message));
      }
      return { page, errors };
    };
    const { page, errors } = await launch('teller', 'teller');
    await expect(page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' })).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width),
    ).toBe(84);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),
    ).toBe(true);
    const pinnedAfterFocusChange = await app.evaluate(async ({ BrowserWindow }) => {
      const dock = BrowserWindow.getAllWindows()[0];
      const other = new BrowserWindow({ width: 320, height: 240, show: false });
      await other.loadURL('data:text/html,<title>Disposable focus probe</title>');
      other.show();
      other.focus();
      const pinned = dock.isAlwaysOnTop() && !dock.isMinimizable();
      other.close();
      return pinned;
    });
    expect(pinnedAfterFocusChange).toBe(true);
    const issued = await request(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
    await expect(page.getByRole('button', { name: 'نداء التذكرة التالية' })).toBeEnabled({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'نداء التذكرة التالية' }).click();
    await expect(page.locator('.ticket-head strong')).toHaveText(issued.ticket.code);
    await page.getByRole('button', { name: 'إعادة نداء التذكرة الحالية' }).click();
    await page.getByRole('button', { name: 'إيقاف استقبال تذاكر جديدة' }).click();
    await expect(page.getByRole('button', { name: 'استئناف الكاونتر' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'بدء الخدمة', exact: true })).toBeDisabled();
    await page.screenshot({
      path: path.join(appRoot, 'test-results/dock-paused.png'),
      omitBackground: true,
    });
    await page.getByRole('button', { name: 'استئناف الكاونتر' }).click();
    await page.getByRole('button', { name: 'بدء الخدمة', exact: true }).click();
    await expect(page.getByRole('button', { name: 'العميل لم يحضر' })).toBeDisabled();
    await page.getByRole('button', { name: 'الخدمات المفضلة' }).click();
    await expect(page.locator('.dock-actions button')).toHaveCount(6);
    await page.screenshot({
      path: path.join(appRoot, 'test-results/dock-serving.png'),
      omitBackground: true,
    });
    await page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' }).click();
    await expect(page.getByRole('button', { name: 'تصغير إلى الشريط' })).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width),
    ).toBeGreaterThan(400);
    const centered = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0],
        b = window.getBounds(),
        area = screen.getDisplayMatching(b).workArea;
      return (
        Math.abs(b.x + b.width / 2 - area.x - area.width / 2) <= 1 &&
        Math.abs(b.y + b.height / 2 - area.y - area.height / 2) <= 1
      );
    });
    expect(centered).toBe(true);
    await expect(page.locator('.teller-actions button')).toHaveCount(6);
    await page.evaluate(async () => {
      await Promise.all([
        window.queue.expand(false),
        window.queue.expand(true),
        window.queue.expand(false),
      ]);
    });
    await expect(page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' })).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()),
    ).toBe(1);
    await page.getByRole('button', { name: 'توسيع عرض قائمة الانتظار' }).click();
    await page.getByRole('button', { name: 'إنجاز الخدمة', exact: true }).click();
    await expect(page.locator('.current-card strong')).toHaveText('—');
    await request(fixture.kiosk, 'issue', { serviceId: fixture.serviceId });
    await expect(page.getByRole('button', { name: 'نداء التالي', exact: true })).toBeEnabled({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'نداء التالي', exact: true }).click();
    await page.getByRole('button', { name: 'تصغير إلى الشريط' }).click();
    await page.getByRole('button', { name: 'تحويل إلى خدمة أخرى' }).click();
    await page.getByLabel('الخدمة المطلوبة').selectOption(fixture.secondService);
    await page.getByRole('button', { name: 'تحويل', exact: true }).click();
    await expect(page.locator('.current-card strong')).toHaveText('—');
    await page.getByRole('button', { name: 'نداء التالي', exact: true }).click();
    await page.getByRole('button', { name: 'تصغير إلى الشريط' }).click();
    await page.getByRole('button', { name: 'العميل لم يحضر' }).click();
    await expect(page.locator('.ticket-head strong')).toHaveText('—');
    expect(errors).toEqual([]);
    await app.close();
    app = null;
    const management = await launch('manager', 'manager');
    await management.page.getByRole('button', { name: 'الأداء والتقارير' }).click();
    await expect(
      management.page.getByRole('rowheader').filter({ hasText: 'TEST TELLER' }),
    ).toBeVisible();
    const theme = await management.page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('14px "Thmanyah Sans"'),
        document.fonts.load('14px "Thmanyah Sans"', 'A-001 0123456789'),
      ]);
      await document.fonts.ready;
      const root = getComputedStyle(document.documentElement);
      return {
        font: root.fontFamily,
        background: root.getPropertyValue('--ds-background-100').trim(),
        radius: getComputedStyle(document.querySelector('button')).borderRadius,
        sans: [...document.fonts].some(
          font => font.family.includes('Thmanyah Sans') && font.status === 'loaded',
        ),
        mono: [...document.fonts].some(
          font => font.family.includes('Thmanyah Sans') && font.status === 'loaded',
        ),
      };
    });
    expect(theme.font).toContain('Thmanyah Sans');
    expect(theme.background).toBe('hsl(0, 0%, 4%)');
    expect(theme.sans).toBe(true);
    expect(theme.mono).toBe(true);
    await management.page.getByRole('button', { name: 'الأداء والتقارير' }).click();
    await expect(
      management.page.getByRole('rowheader').filter({ hasText: 'TEST TELLER' }),
    ).toBeVisible();
    await expect(management.page.getByRole('heading', { name: 'رؤى تشغيلية' })).toBeVisible();
    await management.page.screenshot({
      path: path.join(appRoot, 'test-results/management-performance.png'),
    });
    await management.page.getByRole('button', { name: 'متابعة التذاكر', exact: true }).click();
    await management.page.getByLabel('رقم التذكرة', { exact: true }).fill(issued.ticket.code);
    await management.page.getByRole('button', { name: 'بحث', exact: true }).click();
    await expect(management.page.getByText('إنجاز الخدمة', { exact: true })).toBeVisible();
    await management.page.getByRole('button', { name: 'الأداء والتقارير' }).click();
    for (const width of [320, 768, 1024, 1440]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setBounds({ width, height: 760 }),
        width,
      );
      const overflow = await management.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow).toBe(false);
    }
    expect(management.errors).toEqual([]);
    console.log(
      'Native Electron workflow passed: real branch HTTP/database, six actions, pause/resume, favorites, expand, completion, manager performance, four widths; no renderer errors.',
    );
  } finally {
    if (app) await app.close();
    host.kill();
    await pause(500);
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-native-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
