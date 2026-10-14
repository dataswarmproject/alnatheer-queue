// Disposable preview of the actual print document, never bundled in the installer.
const { app, BrowserWindow, Menu } = require('electron');
app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    const win = new BrowserWindow({
      width: 1000,
      height: 1500,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const file = process.argv.find(arg => arg.endsWith('.html'));
    if (!file) throw new Error('Ticket preview document is required');
    await win.loadFile(file);
    win.show();
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
