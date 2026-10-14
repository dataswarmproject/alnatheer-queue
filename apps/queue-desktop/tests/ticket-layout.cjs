const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path'),
  fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  for (const paper of ['58mm', '80mm'])
    for (const stress of [false, true]) {
      const name = `ticket-${stress ? 'stress-' : ''}${paper}`;
      const app = await electron.launch({
        executablePath: require('electron'),
        args: [
          path.join(__dirname, 'ticket-preview-main.cjs'),
          path.join(root, 'test-results', name + '.html'),
        ],
        env,
      });
      try {
        const page = await app.firstWindow();
        await page.locator('.number').waitFor();
        await page.evaluate(async () => {
          await Promise.all([
            document.fonts.load('12px TicketArabic'),
            document.fonts.load('12px TicketSans'),
            document.fonts.load('700 12px TicketMono'),
          ]);
          await document.fonts.ready;
          await Promise.all([...document.images].map(i => i.decode()));
        });
        expect(
          await page.evaluate(
            () =>
              document.fonts.check('12px TicketArabic') &&
              document.fonts.check('12px TicketSans') &&
              document.fonts.check('700 12px TicketMono'),
          ),
        ).toBe(true);
        const size = await page.locator('.ticket').evaluate(el => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
          overflow: el.scrollWidth > el.clientWidth + 1,
        }));
        const width = paper === '58mm' ? 58 : 80,
          height = Math.max(60, (size.height * 25.4) / 96 + 2);
        expect(size.overflow).toBe(false);
        expect(size.width).toBeCloseTo((width * 96) / 25.4, 0);
        expect(height).toBeLessThan(stress ? 200 : 120);
        expect(
          await page.locator('.number').evaluate(el => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        const bytes = await app.evaluate(
          async ({ BrowserWindow }, { width, height }) => [
            ...(await BrowserWindow.getAllWindows()[0].webContents.printToPDF({
              pageSize: { width: width / 25.4, height: height / 25.4 },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              printBackground: false,
            })),
          ],
          { width, height },
        );
        await fs.writeFile(path.join(root, 'test-results', name + '.pdf'), Buffer.from(bytes));
        expect(
          (
            Buffer.from(bytes)
              .toString('latin1')
              .match(/\/Type\s*\/Page\b/g) || []
          ).length,
        ).toBe(1);
        if (!stress) {
          expect(await page.locator('.service p').count()).toBe(1);
          await page.evaluate(() => {
            document.body.style.zoom = '2';
          });
          await page
            .locator('.ticket')
            .screenshot({ path: path.join(root, 'test-results', name + '.png') });
          await page.goto(
            require('node:url').pathToFileURL(
              path.join(root, 'test-results', `ticket-escaped-${paper}.html`),
            ).href,
          );
          expect(await page.locator('.service script').count()).toBe(0);
          expect(await page.locator('.service strong').textContent()).toContain('<script>');
          expect(await page.locator('.service p b').count()).toBe(0);
        }
        console.log(
          `${name}: ${((size.width * 25.4) / 96).toFixed(1)} × ${height.toFixed(1)}mm, no clipped content.`,
        );
      } finally {
        await app.close();
      }
    }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
