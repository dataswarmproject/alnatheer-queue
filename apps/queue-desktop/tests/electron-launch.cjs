const { _electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = {
  async launch(options) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const app = await _electron.launch(options);
      try {
        await app.firstWindow({ timeout: 15000 });
        return app;
      } catch (error) {
        // On Windows, the SDK occasionally misses the initial page event even
        // though the real native renderer has fully loaded. Never retry a broken
        // renderer or an already-provisioned host, and never retry test actions.
        const healthy = await app
          .evaluate(async ({ BrowserWindow }) => {
            const windows = BrowserWindow.getAllWindows();
            return (
              windows.length === 1 &&
              windows[0].isVisible() &&
              !windows[0].webContents.isLoading() &&
              windows[0].webContents.getURL() === 'queue://app/index.html' &&
              (await windows[0].webContents.executeJavaScript('document.readyState')) === 'complete'
            );
          })
          .catch(() => false);
        const profile = options.env?.QUEUE_TEST_PROFILE;
        const ownsHost =
          !profile ||
          (await fs.stat(path.join(profile, 'branch-host.enc')).then(
            () => true,
            error => error.code !== 'ENOENT',
          ));
        if (!healthy || ownsHost || attempt || !/firstWindow.*Timeout/s.test(error.message)) {
          if (!ownsHost) await app.close().catch(() => {});
          else if (profile)
            await app
              .evaluate(({ app }) => {
                setTimeout(() => app.quit(), 10);
              })
              .catch(() => {});
          throw error;
        }
        await app.close();
        console.log(
          'Retrying SDK startup observation: native renderer was fully loaded; no test actions ran.',
        );
      }
    }
    throw new Error('Native startup observation failed');
  },
};
