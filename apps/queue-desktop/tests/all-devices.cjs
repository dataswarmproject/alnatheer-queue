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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-all-devices-')),
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
  const apps = [];
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
    await fetch(fixture.hqUrl + '/test/wan/off', { method: 'POST' });
    const launch = async role => {
      const profile = path.join(directory, role);
      await fs.mkdir(profile);
      const app = await electron.launch({
        executablePath: require('electron'),
        args: [root],
        env: { ...env, QUEUE_TEST_PROFILE: profile },
      });
      apps.push(app);
      const launchLogs = [];
      app.process().stderr?.on('data', data => launchLogs.push(data.toString()));
      let page;
      try {
        page = await app.firstWindow();
      } catch (error) {
        console.error(launchLogs.join('').slice(-2000));
        console.error(
          'Startup diagnostics',
          await app
            .evaluate(({ app, BrowserWindow }) => ({
              ready: app.isReady(),
              userData: app.getPath('userData'),
              pid: process.pid,
              windows: BrowserWindow.getAllWindows().map(window => ({
                id: window.id,
                visible: window.isVisible(),
                loading: window.webContents.isLoading(),
                url: window.webContents.getURL(),
              })),
            }))
            .catch(e => ({ mainUnavailable: e.message })),
        );
        throw error;
      }
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      if (['display', 'counterDisplay'].includes(role)) {
        await page.getByText('شاشات مستقلة · إعداد متقدم', { exact: true }).click();
        await page
          .getByRole('button', {
            name: role === 'display' ? 'شاشة انتظار مستقلة' : 'شاشة رقم الكاونتر',
            exact: true,
          })
          .click();
      } else {
        await page
          .getByRole('button', {
            name: { teller: 'موظف الكاونتر', kiosk: 'جهاز إصدار التذاكر', manager: 'إدارة الفرع' }[
              role
            ],
            exact: false,
          })
          .click();
      }
      await page.getByLabel('عنوان خدمة الفرع').fill(fixture.url);
      await page.getByLabel('مفتاح الجهاز', { exact: true }).fill(fixture[role].token);
      const replacement = ['kiosk', 'display', 'teller'].includes(fixture[role].role)
        ? app.waitForEvent('window')
        : null;
      await page.getByRole('button', { name: 'اتصال', exact: true }).click();
      if (replacement) {
        page = await replacement;
        page.on('pageerror', e => errors.push(e.message));
      }
      return { app, page, errors };
    };
    const kiosk = await launch('kiosk');
    await kiosk.app.evaluate(({ app, BrowserWindow }) => {
      app.queueTestPrints = [];
      app.queueTestPrintFailure = true;
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.getPrintersAsync = async () => [
        {
          name: 'TEST_THERMAL',
          displayName: 'TEST THERMAL',
          description: 'Disposable test driver',
          options: {},
        },
      ];
      Object.getPrototypeOf(contents).print = function (options, callback) {
        app.queueTestPrints.push(options);
        callback(
          !app.queueTestPrintFailure,
          app.queueTestPrintFailure ? 'TEST ONLY printer offline' : '',
        );
      };
    });
    await expect(kiosk.page.getByRole('heading', { name: 'كيف يمكننا خدمتك؟' })).toBeVisible();
    await expect
      .poll(() =>
        kiosk.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      )
      .toBe(true);
    await kiosk.page.getByRole('button', { name: 'إعدادات الجهاز', exact: true }).click();
    // Renderer access cannot bypass native authorization for public customer devices.
    expect(
      await kiosk.page.evaluate(async () => {
        try {
          await window.queue.disconnect();
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await kiosk.page.getByLabel('مفتاح مدير الفرع', { exact: true }).fill(fixture.teller.token);
    await kiosk.page.getByRole('button', { name: 'فتح إعدادات المشرف', exact: true }).click();
    await expect(kiosk.page.getByRole('alert')).toBeVisible();
    await kiosk.page.getByLabel('مفتاح مدير الفرع', { exact: true }).fill(fixture.manager.token);
    await kiosk.page.getByRole('button', { name: 'فتح إعدادات المشرف', exact: true }).click();
    await kiosk.page.getByLabel('الطابعة', { exact: true }).selectOption('TEST_THERMAL');
    await kiosk.page.getByLabel('عرض الورق').selectOption('58mm');
    await kiosk.page.getByLabel('طباعة تلقائية بعد إصدار التذكرة').check();
    await kiosk.page.getByRole('button', { name: 'حفظ إعدادات الجهاز', exact: true }).click();
    await expect(kiosk.page.getByRole('status')).toHaveText('تم حفظ إعدادات الجهاز.');
    await kiosk.page.getByRole('button', { name: 'العودة إلى الشاشة' }).click();
    await kiosk.page.getByRole('button', { name: 'TEST · صرافة', exact: true }).click();
    await expect(kiosk.page.locator('.kiosk-receipt strong')).toHaveText('A-001');
    await expect(kiosk.page.getByRole('alert')).toContainText('تعذرت الطباعة');
    await expect(kiosk.page.getByRole('button', { name: 'عميل جديد', exact: true })).toBeDisabled();
    const unprinted = await (
      await fetch(fixture.url + '/v1/snapshot', {
        headers: { authorization: 'Bearer ' + fixture.teller.token },
      })
    ).json();
    expect(unprinted.totals.waiting).toBe(0);
    expect(
      (
        await fetch(fixture.url + '/v1/commands', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + fixture.teller.token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            requestId: require('node:crypto').randomUUID(),
            action: 'next',
            expectedRevision: unprinted.counter.revision,
          }),
        })
      ).status,
    ).toBe(409);
    await kiosk.app.evaluate(({ app }) => {
      app.queueTestPrintFailure = false;
    });
    await kiosk.page.getByRole('button', { name: 'طباعة التذكرة', exact: true }).click();
    await expect(kiosk.page.getByRole('status')).toContainText('أُرسلت التذكرة');
    expect(await kiosk.app.evaluate(({ app }) => app.queueTestPrints.length)).toBe(2);
    const printed = await (
      await fetch(fixture.url + '/v1/snapshot', {
        headers: { authorization: 'Bearer ' + fixture.teller.token },
      })
    ).json();
    expect(printed.waiting).toHaveLength(1);
    expect(printed.waiting[0].code).toBe('A-001');
    expect(printed.waiting[0].printedAt).toBeTruthy();
    expect(await kiosk.app.evaluate(({ app }) => app.queueTestPrints[0])).toMatchObject({
      silent: true,
      deviceName: 'TEST_THERMAL',
      pageSize: { width: 58000 },
    });
    expect(
      (await kiosk.app.evaluate(({ app }) => app.queueTestPrints[0])).pageSize.height,
    ).toBeLessThan(140000);
    await kiosk.page.screenshot({ path: path.join(root, 'test-results/kiosk-ticket.png') });
    const tv = await launch('display');
    const counterTV = await launch('counterDisplay');
    await expect(counterTV.page.locator('.tv-other')).toHaveCount(0);
    await expect(tv.page.locator('.tv-ticket')).toHaveText('—');
    await expect
      .poll(() =>
        tv.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      )
      .toBe(true);
    const teller = await launch('teller');
    await expect(teller.page.evaluate(() => window.queue.branchIdentity('copy'))).rejects.toThrow();
    await expect(
      kiosk.page.evaluate(() => window.queue.branchIdentity('export')),
    ).rejects.toThrow();
    await expect(teller.page.getByRole('button', { name: 'نداء التذكرة التالية' })).toBeEnabled({
      timeout: 15000,
    });
    await teller.page.getByRole('button', { name: 'نداء التذكرة التالية' }).click();
    await expect(tv.page.locator('.tv-ticket')).toHaveText('A-001', { timeout: 15000 });
    await expect(counterTV.page.locator('.tv-ticket')).toHaveText('A-001', { timeout: 15000 });
    await expect(tv.page.locator('.tv-counter')).toHaveText('TEST · كاونتر ١');
    await teller.page.getByRole('button', { name: 'بدء الخدمة', exact: true }).click();
    await tv.page.screenshot({ path: path.join(root, 'test-results/tv-current-ticket.png') });
    await counterTV.page.screenshot({ path: path.join(root, 'test-results/counter-tv.png') });
    await teller.page.getByRole('button', { name: 'إنجاز الخدمة', exact: true }).click();
    await expect(tv.page.locator('.tv-ticket')).toHaveText('—', { timeout: 15000 });
    const newCustomer = kiosk.page.getByRole('button', { name: 'عميل جديد', exact: true });
    if (await newCustomer.isVisible()) await newCustomer.click();
    await kiosk.page.getByRole('button', { name: 'TEST · حوالات', exact: true }).click();
    await expect(kiosk.page.locator('.kiosk-receipt strong')).toHaveText('B-001');
    await expect(kiosk.page.getByRole('status')).toContainText('أُرسلت التذكرة');
    // All issuance/call/start/finish/display operations above ran while HQ was unavailable.
    await fetch(fixture.hqUrl + '/test/wan/on', { method: 'POST' });
    await expect
      .poll(
        async () => {
          const state = await (await fetch(fixture.hqUrl + '/state')).json();
          return state.waiting[0]?.code;
        },
        { timeout: 60000 },
      )
      .toBe('B-001');
    const centralState = await (await fetch(fixture.hqUrl + '/state')).json();
    expect(centralState.active).toHaveLength(0);
    expect(centralState.lastHeartbeatAt).not.toBeNull();
    const manager = await launch('manager');
    await manager.page.getByRole('button', { name: 'الأداء والتقارير' }).click();
    await expect(
      manager.page.getByRole('rowheader').filter({ hasText: 'TEST TELLER' }),
    ).toBeVisible();
    await manager.page.getByRole('button', { name: 'إدارة النظام', exact: true }).click();
    await expect(
      manager.page.getByRole('heading', { name: 'خادم الفرع', exact: true }),
    ).toBeVisible();
    await expect(manager.page.locator('.metrics')).toContainText(
      require('../package.json').version,
    );
    await manager.page.getByRole('button', { name: 'إنشاء نسخة احتياطية', exact: true }).click();
    await expect(
      manager.page.getByRole('status').filter({ hasText: 'حُفظت نسخة متحققة' }),
    ).toContainText('حُفظت نسخة متحققة', {
      timeout: 30000,
    });
    const backups = await fs.readdir(path.join(directory, 'backups'));
    expect(backups.filter(f => f.endsWith('.pgdata.tar.gz'))).toHaveLength(1);
    await manager.page.screenshot({ path: path.join(root, 'test-results/manager-server.png') });
    expect(
      (
        await fetch(
          fixture.url +
            '/v1/analytics?from=' +
            encodeURIComponent(new Date(Date.now() - 60000).toISOString()) +
            '&to=' +
            encodeURIComponent(new Date().toISOString()),
          { headers: { authorization: `Bearer ${fixture.kiosk.token}` } },
        )
      ).status,
    ).toBe(403);
    const oldTicketId = await kiosk.page.evaluate(
      async () => (await window.queue.snapshot()).waiting.find(t => t.code === 'B-001').id,
    );
    await kiosk.page.evaluate(
      async input => {
        await window.queue.unlockOperator(input.managerKey);
        await window.queue.connect({ url: input.url, token: input.deviceKey });
      },
      { managerKey: fixture.manager.token, url: fixture.url, deviceKey: fixture.kiosk.token },
    );
    expect(
      await kiosk.page.evaluate(async id => {
        try {
          await window.queue.print(id);
          return false;
        } catch {
          return true;
        }
      }, oldTicketId),
    ).toBe(true);
    expect(
      await kiosk.page.evaluate(async () => {
        try {
          await window.queue.disconnect();
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    // A manager print receipt beyond the first 100 waiting rows must unlock issuance.
    for (let i = 0; i < 101; i++) {
      const issued = await fetch(fixture.url + '/v1/commands', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + fixture.kiosk.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          requestId: require('node:crypto').randomUUID(),
          action: 'issue',
          serviceId: fixture.serviceId,
        }),
      });
      expect(issued.ok).toBe(true);
    }
    await manager.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      Object.getPrototypeOf(contents).print = function (_options, callback) {
        callback(true, '');
      };
    });
    await manager.page.getByRole('button', { name: 'الانتظار', exact: true }).click();
    await manager.page.getByRole('button', { name: 'TEST · صرافة', exact: true }).click();
    await expect(manager.page.locator('.issued-ticket strong')).toHaveText('A-103');
    await expect(
      manager.page.getByRole('button', { name: 'عميل جديد', exact: true }),
    ).toBeDisabled();
    await manager.page.getByRole('button', { name: 'طباعة التذكرة', exact: true }).click();
    await expect(
      manager.page.getByRole('button', { name: 'عميل جديد', exact: true }),
    ).toBeEnabled();
    await manager.page.getByRole('button', { name: 'عميل جديد', exact: true }).click();
    await expect(
      manager.page.getByRole('button', { name: 'TEST · صرافة', exact: true }),
    ).toBeEnabled();
    for (const device of [kiosk, tv, counterTV, teller, manager]) expect(device.errors).toEqual([]);
    console.log(
      'Five native devices passed: kiosk → teller → room TV and assigned counter TV → manager analytics and real backup. Local work continued during HQ outage; durable synchronization caught up afterward; no renderer errors.',
    );
  } finally {
    for (const app of apps.reverse()) await app.close().catch(() => {});
    if (host.exitCode === null) {
      const ended = new Promise(resolve => host.once('exit', resolve));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-all-devices-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
