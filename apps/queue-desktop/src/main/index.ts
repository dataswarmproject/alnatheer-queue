import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  dialog,
  systemPreferences,
  shell,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import {
  snapshotSchema,
  commandSchema,
  commandResultSchema,
  configurationSchema,
  roleSchema,
  ticketSchema,
  eventSchema,
  id,
} from '@saraf/queue-core';
import {
  connect,
  disconnect,
  connectionInfo,
  loadConnection,
  request,
  verifyManager,
} from './client';
import { printTicket, exportReport } from './output';
import type { TicketService } from './ticket-layout';
import { analyticsSchema } from '@saraf/queue-core/analytics-contract';
import { readPreferences, savePreferences } from './preferences';
import { devicePreferencesSchema, printerSchema } from '@saraf/queue-core/device';
import { serverStatusSchema, backupSummarySchema } from '@saraf/queue-core/server';
import { deviceModeSchema } from '../setup-contract';
import {
  approveSetupPath,
  createHost,
  hostSetupInfo,
  resumeHost,
  startSavedHost,
  ownsConnectedHost,
  ownedHostFolder,
} from './host-setup';
import { createTvController } from './tv';
import { speechRequestSchema, speechAudioSchema } from '@saraf/queue-core/speech';
import { desktopSpeechStatus, guardFreeSpeech } from './speech-policy';
import { createAudioController } from './audio-settings';
import { spokenAnnouncementsEnabled } from '../audio-contract';
import {
  operationsSettingsSchema,
  operationsStatusSchema,
  operationSchema,
  operationResultSchema,
} from '@saraf/queue-core/operations';
import { createUpdates } from './updates';
import { updateActionSchema } from '../update-contract';
import { saveTvLayout, restoreTvLayout } from './tv-layout';
import { useWindowsNetworkTrust } from '@saraf/queue-core/network-trust';

useWindowsNetworkTrust();
protocol.registerSchemesAsPrivileged([
  { scheme: 'queue', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (!app.isPackaged && process.env.QUEUE_TEST_PROFILE)
  app.setPath('userData', process.env.QUEUE_TEST_PROFILE);
const hostOnly = process.argv.includes('--queue-host-only');
const localPreview = !app.isPackaged && process.env.QUEUE_LOCAL_PREVIEW === '1';
if (!hostOnly && !app.requestSingleInstanceLock()) app.quit();
let window: BrowserWindow,
  expanded = true,
  tellerWindow = false;
let customerWindow = false;
let framedWindow = true;
let operatorUntil = 0;
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
function requireOperator() {
  if (customerWindow && Date.now() >= operatorUntil)
    throw new Error('Branch manager authorization required');
}
const rendererRoot = path.join(__dirname, '../renderer');
let tv: ReturnType<typeof createTvController>;
let audio: Awaited<ReturnType<typeof createAudioController>>;
const favoriteFile = () => path.join(app.getPath('userData'), 'favorites.json');
const range = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    slaSeconds: z.number().min(1).max(86400).optional(),
  })
  .strict();
const device = z
  .object({
    role: roleSchema,
    counterId: id.nullable(),
    name: z.string().trim().min(1).max(80).optional(),
    staffRef: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
const tickets = new Map<string, z.infer<typeof commandResultSchema>['ticket']>();
const serviceNames = new Map<string, TicketService>();
const ticketServices = new Map<string, TicketService>();
type PrintableTicket = NonNullable<z.infer<typeof commandResultSchema>['ticket']>;
const automaticPrints = new Map<string, Promise<PrintableTicket>>();
const acceptedPrints = new Set<string>();
const activePrints = new Map<string, Promise<PrintableTicket>>();
let connectionGeneration = 0;
let pairing: {
  url: string;
  id: string;
  role: z.infer<typeof roleSchema>;
  counterId: string | null;
  token: string;
} | null = null;
function resetConnectionContext() {
  connectionGeneration++;
  tickets.clear();
  ticketServices.clear();
  serviceNames.clear();
  automaticPrints.clear();
  acceptedPrints.clear();
  activePrints.clear();
  operatorUntil = 0;
  pairing = null;
}
let transitionVersion = 0;
async function fadeWindow(target: number, duration: number, version: number) {
  const initial = window.getOpacity(),
    started = performance.now();
  await new Promise<void>(resolve => {
    const frame = () => {
      if (window.isDestroyed() || version !== transitionVersion) {
        resolve();
        return;
      }
      const progress = Math.min(1, (performance.now() - started) / duration);
      window.setOpacity(initial + (target - initial) * (1 - Math.pow(1 - progress, 3)));
      if (progress === 1) resolve();
      else setTimeout(frame, 16);
    };
    frame();
  });
}
async function switchView(value: boolean) {
  const version = ++transitionVersion;
  if (systemPreferences.getAnimationSettings().prefersReducedMotion || value === expanded) {
    size(value);
    window.setOpacity(1);
    return;
  }
  // Commit the new renderer view while the native window is invisible.
  await fadeWindow(0, 70, version);
  if (version !== transitionVersion || window.isDestroyed()) return;
  size(value);
  await new Promise(resolve => setTimeout(resolve, 40));
  if (!window.isDestroyed() && version === transitionVersion) await fadeWindow(1, 140, version);
}
function validateSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
    throw new Error('Untrusted IPC sender');
}
function size(isExpanded: boolean) {
  expanded = isExpanded;
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  const width = isExpanded ? Math.min(tellerWindow ? 560 : 1000, area.width) : 84;
  const height = isExpanded
    ? Math.min(tellerWindow ? 620 : 760, area.height)
    : Math.min(552, area.height);
  window.setIgnoreMouseEvents(false);
  window.setBounds({
    x: isExpanded ? area.x + Math.round((area.width - width) / 2) : area.x,
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  });
  window.setAlwaysOnTop(tellerWindow, isExpanded ? 'floating' : 'screen-saver');
  window.setMinimizable(isExpanded);
  window.setSkipTaskbar(!isExpanded);
  window.moveTop();
  window.webContents.send('queue:view', isExpanded);
}
async function adaptRole() {
  try {
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    tellerWindow = snapshot.actor.role === 'teller';
    const customer = ['kiosk', 'display'].includes(snapshot.actor.role);
    await replaceWindow(customer);
    if (customer) {
      expanded = true;
      window.setAlwaysOnTop(false);
      window.setSkipTaskbar(false);
      window.setMinimizable(localPreview);
      window.setResizable(true);
      window.setMaximizable(true);
      window.setFullScreen(true);
      window.webContents.send('queue:view', true);
    } else {
      window.setFullScreen(false);
      window.setResizable(snapshot.actor.role === 'manager');
      window.setMaximizable(snapshot.actor.role === 'manager');
      size(snapshot.actor.role !== 'teller');
    }
  } catch {
    if (customerWindow) {
      expanded = true;
      window.setAlwaysOnTop(false);
      window.setFullScreen(true);
    } else size(true);
  }
}
function createMainWindow(customer: boolean, framed: boolean) {
  const win = new BrowserWindow({
    title: 'Alnatheer Queue',
    width: 760,
    height: 740,
    frame: framed,
    transparent: !customer && !framed,
    show: false,
    backgroundColor: customer || framed ? '#000000' : '#00000000',
    resizable: customer,
    hasShadow: false,
    icon: path.join(rendererRoot, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const sendWindowState = () => {
    if (win === window && !win.isDestroyed())
      win.webContents.send('queue:window-state', { maximized: win.isMaximized() });
  };
  win.on('maximize', sendWindowState);
  win.on('unmaximize', sendWindowState);
  win.on('close', event => {
    if (win === window && framedWindow && (!customerWindow || localPreview) && !quitting) {
      event.preventDefault();
      quitting = true;
      void Promise.resolve(tv?.close()).finally(() => app.quit());
      return;
    }
    if (
      win === window &&
      customerWindow &&
      !localPreview &&
      !quitting &&
      Date.now() >= operatorUntil
    )
      event.preventDefault();
  });
  if (localPreview && customer) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') win.setFullScreen(false);
      if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    });
  }
  win.on('blur', () => {
    if (win === window && !expanded && !win.isDestroyed()) win.moveTop();
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  return win;
}
async function loadRenderer(win: BrowserWindow) {
  const devURL = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devURL) {
    const url = new URL(devURL);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.protocol !== 'http:')
      throw new Error('Untrusted development URL');
    await win.loadURL(url.href);
  } else await win.loadURL('queue://app/index.html');
}
async function replaceWindow(
  customer: boolean,
  framed = (customer && localPreview) || (!customer && !tellerWindow),
) {
  if (customer === customerWindow && framed === framedWindow) return;
  ++transitionVersion;
  const previous = window;
  customerWindow = customer;
  framedWindow = framed;
  window = createMainWindow(customer, framed);
  await loadRenderer(window);
  window.show();
  previous.destroy();
}
function handle(channel: string, work: (input: unknown) => Promise<unknown>) {
  ipcMain.handle(channel, async (event, input) => {
    if (channel === 'queue:speech' && !spokenAnnouncementsEnabled)
      throw new Error('النداء الصوتي غير متاح في هذا الإصدار.');
    if (tv?.isSender(event)) {
      if (channel === 'queue:connection') return tv.connection();
      if (channel === 'queue:snapshot') return tv.snapshot();
      if (channel === 'queue:speech-status') return tv.speechStatus();
      if (channel === 'queue:speech') return tv.speech(speechRequestSchema.parse(input));
      if (channel === 'queue:preferences') return [];
      if (channel === 'queue:audio-status') return audio.status();
      if (channel === 'queue:audio-report') return audio.report(input);
      throw new Error('HDMI screen is read-only; use the manager window');
    }
    validateSender(event);
    try {
      return await work(input);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message.slice(0, 160) : 'Operation failed');
    }
  });
}
app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
app.whenReady().then(async () => {
  if (hostOnly) {
    try {
      await startSavedHost();
    } finally {
      app.quit();
    }
    return;
  }
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.alnatheer.queue');
  protocol.handle('queue', async req => {
    const url = new URL(req.url);
    const file = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname));
    if (url.hostname !== 'app' || !file.startsWith(rendererRoot + path.sep))
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  await loadConnection();
  // The independently running branch process survives closure of the manager UI.
  await startSavedHost().catch(() => {});
  customerWindow = ['kiosk', 'display'].includes(connectionInfo().role ?? '');
  tellerWindow = connectionInfo().role === 'teller';
  framedWindow = (customerWindow && localPreview) || (!customerWindow && !tellerWindow);
  window = createMainWindow(customerWindow, framedWindow);
  tv = createTvController(rendererRoot, loadRenderer, () => window);
  audio = await createAudioController(() => BrowserWindow.getAllWindows());
  handle('queue:connection', async () => connectionInfo());
  handle('queue:speech-status', () =>
    desktopSpeechStatus(() => request('GET', '/v1/speech/status')),
  );
  handle('queue:speech', async input => {
    const speechInput = speechRequestSchema.parse(input);
    await guardFreeSpeech(() => request('GET', '/v1/speech/status'));
    return speechAudioSchema.parse(await request('POST', '/v1/speech', speechInput, 20000));
  });
  handle('queue:connect', async input => {
    requireOperator();
    await tv.close();
    await connect(input);
    resetConnectionContext();
    await adaptRole();
  });
  handle('queue:disconnect', async () => {
    requireOperator();
    await tv.close();
    await disconnect();
    resetConnectionContext();
    tellerWindow = false;
    await replaceWindow(false);
    window.setFullScreen(false);
    size(true);
  });
  const finishSetup = async () => {
    resetConnectionContext();
    await adaptRole();
  };
  handle('queue:import-pairing', async input => {
    requireOperator();
    const mode = deviceModeSchema.parse(input);
    const selected = await dialog.showOpenDialog(window, {
      title: 'استيراد ملف اقتران الجهاز',
      properties: ['openFile'],
      filters: [{ name: 'Queue pairing', extensions: ['json'] }],
    });
    if (selected.canceled) return false;
    if ((await stat(selected.filePaths[0])).size > 16384) throw new Error('Pairing file too large');
    const pairing = z
      .object({ url: z.string().max(200), token: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .parse(JSON.parse(await readFile(selected.filePaths[0], 'utf8')));
    await tv.close();
    await connect({ url: pairing.url, token: pairing.token, mode });
    await finishSetup();
    return true;
  });
  handle('queue:host-setup-info', async () => {
    requireOperator();
    return hostSetupInfo();
  });
  handle('queue:setup-path', async input => {
    requireOperator();
    const kind = z.enum(['directory', 'cert', 'key']).parse(input);
    if (connectionInfo().configured) throw new Error('Disconnect before setting up the server');
    const selected = await dialog.showOpenDialog(window, {
      title: kind === 'directory' ? 'اختر مجلدًا فارغًا لبيانات الفرع' : 'اختر ملف شهادة الشبكة',
      properties: kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
    });
    if (selected.canceled) return null;
    const value = selected.filePaths[0];
    approveSetupPath(kind, value);
    return value;
  });
  handle('queue:create-host', async input => {
    requireOperator();
    await createHost(input);
    await finishSetup();
  });
  handle('queue:resume-host', async () => {
    requireOperator();
    await resumeHost();
    await finishSetup();
  });
  const requireManager = async () => {
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    if (snapshot.actor.role !== 'manager') throw new Error('Branch manager authorization required');
    return snapshot;
  };
  handle('queue:can-browse-host-folders', async () => {
    const snapshot = await requireManager();
    return ownsConnectedHost(snapshot.branchId);
  });
  handle('queue:browse-host-folder', async input => {
    const kind = z.enum(['database', 'backup', 'report']).parse(input);
    const snapshot = await requireManager();
    if (!(await ownsConnectedHost(snapshot.branchId)))
      throw new Error('استعرض ملفات الخادم من الكمبيوتر الذي يشغّله.');
    const error = await shell.openPath(await ownedHostFolder(kind));
    if (error) throw new Error('تعذر فتح مجلد الخادم.');
  });
  const requireLocalManager = () => {
    if (connectionInfo().role !== 'manager')
      throw new Error('Branch manager authorization required');
  };
  handle('queue:window-state', async () => {
    requireLocalManager();
    return { maximized: window.isMaximized() };
  });
  handle('queue:window-action', async input => {
    requireLocalManager();
    const action = z.enum(['minimize', 'maximize', 'close']).parse(input);
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else {
      await tv.close();
      app.quit();
    }
  });
  handle('queue:tv-status', async () => {
    requireLocalManager();
    return tv.status();
  });
  const updates = await createUpdates(() => tv.close());
  handle('queue:update-status', async () => {
    requireLocalManager();
    return updates.getStatus();
  });
  handle('queue:update-action', async input => {
    await requireManager();
    return updates.action(updateActionSchema.parse(input));
  });
  let lastUpdateCheck = 0;
  const pollUpdates = async () => {
    await updates.tick();
    if (
      connectionInfo().role === 'manager' &&
      Date.now() - lastUpdateCheck > 4 * 3600000 &&
      ['idle', 'available', 'ignored', 'downloaded', 'error'].includes(updates.getStatus().state)
    ) {
      lastUpdateCheck = Date.now();
      await updates.action({ action: 'check' }).catch(() => {});
    }
  };
  const updateTimer = setInterval(() => void pollUpdates(), 60000),
    firstUpdateCheck = setTimeout(() => void pollUpdates(), 5000);
  app.once('before-quit', () => {
    clearInterval(updateTimer);
    clearTimeout(firstUpdateCheck);
  });
  handle('queue:tv-open', async input => {
    const display = z.number().int().parse(input);
    await tv.open(display);
    await saveTvLayout(display);
  });
  handle('queue:tv-close', async () => {
    requireLocalManager();
    await saveTvLayout(null);
    await tv.close();
    audio.clear();
  });
  const requireAudioOperator = async () => {
    if (connectionInfo().role === 'display') requireOperator();
    else await requireManager();
  };
  handle('queue:audio-status', async () => {
    const role = connectionInfo().role;
    if (role !== 'manager' && role !== 'display') throw new Error('Audio access denied');
    const status = audio.status();
    return role === 'manager' && !tv.status().open ? { ...status, runtime: null } : status;
  });
  handle('queue:save-audio-settings', async input => {
    await requireAudioOperator();
    return audio.save(input);
  });
  handle('queue:audio-test', async () => {
    await requireAudioOperator();
    if (connectionInfo().role === 'manager' && !tv.status().open)
      throw new Error('شغّل شاشة العرض أولًا.');
    audio.test();
  });
  handle('queue:audio-report', async input => {
    if (connectionInfo().role !== 'display') throw new Error('Audio report requires a display');
    audio.report(input);
  });
  handle('queue:snapshot', async () => {
    const generation = connectionGeneration;
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    if (generation !== connectionGeneration) throw new Error('Connection changed');
    serviceNames.clear();
    for (const service of snapshot.services)
      serviceNames.set(service.id, {
        name: service.name,
        ...(service.nameEn ? { nameEn: service.nameEn } : {}),
      });
    if (snapshot.pendingPrintTicket) {
      const ticket = snapshot.pendingPrintTicket;
      if (!tickets.get(ticket.id)?.printedAt) tickets.set(ticket.id, ticket);
      ticketServices.set(ticket.id, serviceNames.get(ticket.serviceId) ?? { name: 'خدمة العملاء' });
    }
    return snapshot;
  });
  handle('queue:command', async input => {
    const generation = connectionGeneration;
    const parsed = commandSchema.parse(input);
    if (parsed.action === 'printed')
      throw new Error('Print confirmation is managed by the native printer');
    const command = parsed.action === 'issue' ? { ...parsed, requirePrint: true as const } : parsed;
    const result = commandResultSchema.parse(await request('POST', '/v1/commands', command));
    if (generation !== connectionGeneration)
      throw new Error('Connection changed; verify the command in its original branch');
    if (command.action === 'issue' && result.ticket) {
      tickets.set(result.ticket.id, result.ticket);
      if (!ticketServices.has(result.ticket.id))
        ticketServices.set(
          result.ticket.id,
          serviceNames.get(result.ticket.serviceId) ?? { name: 'خدمة العملاء' },
        );
      if (tickets.size > 5) {
        const oldest = tickets.keys().next().value!;
        tickets.delete(oldest);
        ticketServices.delete(oldest);
        acceptedPrints.delete(oldest);
      }
    }
    return result;
  });
  handle('queue:configure', async input =>
    request('PUT', '/v1/configuration', configurationSchema.parse(input)),
  );
  handle('queue:provision', async input => {
    const generation = connectionGeneration;
    const result = z
      .object({
        id,
        role: roleSchema,
        counterId: id.nullable(),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(await request('POST', '/v1/devices', device.parse(input)));
    if (generation !== connectionGeneration)
      throw new Error('Connection changed; verify device assignment in its original branch');
    pairing = { ...result, url: connectionInfo().url! };
    return result;
  });
  handle('queue:save-pairing', async () => {
    await requireManager();
    const generation = connectionGeneration;
    const value = pairing;
    if (!value || value.url !== connectionInfo().url)
      throw new Error('Issue a device key before saving its pairing file');
    const result = await dialog.showSaveDialog(window, {
      title: 'حفظ ملف اقتران الجهاز',
      defaultPath: `${value.role}.queue-pairing.json`,
      filters: [{ name: 'Queue pairing', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    if (generation !== connectionGeneration)
      throw new Error('Connection changed; issue a new device key in the selected branch');
    await writeFile(result.filePath, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    return true;
  });
  handle('queue:devices', async () =>
    z
      .array(
        z
          .object({
            id,
            role: roleSchema,
            counterId: id.nullable(),
            name: z.string().max(80).nullable(),
            staffRef: z.string().max(80).nullable(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(10000)
      .parse(await request('GET', '/v1/devices')),
  );
  handle('queue:revoke', async input =>
    request('POST', '/v1/devices/revoke', { id: id.parse(input) }),
  );
  handle('queue:journey', async input => {
    const parsed = z
      .object({
        code: z.string().regex(/^[A-Z]{1,3}-\d{1,12}$/),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict()
      .parse(input);
    return z
      .object({
        ticket: ticketSchema.nullable(),
        events: z.array(eventSchema).max(200),
        partial: z.boolean(),
      })
      .strict()
      .parse(await request('GET', '/v1/journey?' + new URLSearchParams(parsed)));
  });
  const analytics = async (input: unknown) => {
    const parsed = range.parse(input);
    return analyticsSchema.parse(
      await request(
        'GET',
        '/v1/analytics?' +
          new URLSearchParams(Object.entries(parsed).map(([k, v]) => [k, String(v)])),
      ),
    );
  };
  handle('queue:analytics', analytics);
  handle('queue:expand', async input => {
    if (customerWindow) throw new Error('Customer screens remain fullscreen');
    return switchView(z.boolean().parse(input));
  });
  ipcMain.on('queue:pointer', (event, input) => {
    if (tv.isSender(event)) return;
    try {
      validateSender(event);
      if (!expanded) window.setIgnoreMouseEvents(!z.boolean().parse(input), { forward: true });
    } catch {
      /* Ignore invalid one-way pointer messages without interrupting staff windows. */
    }
  });
  handle('queue:preferences', async () => {
    try {
      return z
        .array(id)
        .max(20)
        .parse(JSON.parse(await readFile(favoriteFile(), 'utf8')));
    } catch {
      return [];
    }
  });
  handle('queue:favorites', async input =>
    writeFile(favoriteFile(), JSON.stringify(z.array(id).max(20).parse(input))),
  );
  const printAndConfirm = (
    ticket: PrintableTicket,
    preferences: Awaited<ReturnType<typeof readPreferences>>,
  ) => {
    const previous = activePrints.get(ticket.id);
    if (previous) return previous;
    const generation = connectionGeneration;
    const job = (async () => {
      // Retry acknowledgement without another print when Windows already accepted the job.
      if (!acceptedPrints.has(ticket.id) || ticket.printedAt) {
        await printTicket(
          ticket,
          preferences,
          ticketServices.get(ticket.id) ?? { name: 'خدمة العملاء' },
        );
        if (generation !== connectionGeneration)
          throw new Error('Connection changed; verify the ticket in its original branch');
        acceptedPrints.add(ticket.id);
      }
      if (generation !== connectionGeneration) throw new Error('Connection changed');
      if (ticket.printRequired && !ticket.printedAt) {
        const result = commandResultSchema.parse(
          await request('POST', '/v1/commands', {
            requestId: ticket.id,
            action: 'printed',
            ticketId: ticket.id,
          }),
        );
        if (generation !== connectionGeneration) throw new Error('Connection changed');
        if (result.ticket) tickets.set(ticket.id, result.ticket);
      }
      return tickets.get(ticket.id) ?? ticket;
    })();
    activePrints.set(ticket.id, job);
    void job
      .finally(() => {
        if (activePrints.get(ticket.id) === job) activePrints.delete(ticket.id);
      })
      .catch(() => {});
    return job;
  };
  handle('queue:print', async input => {
    const generation = connectionGeneration;
    const ticket = tickets.get(id.parse(input));
    if (!ticket) throw new Error('Issue a ticket on this device before printing');
    const preferences = await readPreferences();
    if (generation !== connectionGeneration) throw new Error('Connection changed');
    const printedTicket = await printAndConfirm(ticket, preferences);
    automaticPrints.set(ticket.id, Promise.resolve(printedTicket));
    return printedTicket;
  });
  handle('queue:auto-print', async input => {
    const generation = connectionGeneration;
    const ticket = tickets.get(id.parse(input));
    if (!ticket) throw new Error('Issue a ticket on this device before printing');
    const preferences = await readPreferences();
    if (generation !== connectionGeneration) throw new Error('Connection changed');
    if (!preferences.autoPrint) throw new Error('Automatic printing is not enabled');
    let job = automaticPrints.get(ticket.id);
    if (!job) {
      job = printAndConfirm(ticket, preferences);
      automaticPrints.set(ticket.id, job);
      if (automaticPrints.size > 5) automaticPrints.delete(automaticPrints.keys().next().value!);
    }
    return await job;
  });
  handle('queue:printers', async () =>
    z
      .array(printerSchema)
      .max(1000)
      .parse(
        (await window.webContents.getPrintersAsync()).map(p => ({
          name: p.name,
          displayName: p.displayName,
          description: p.description,
        })),
      ),
  );
  handle('queue:device-preferences', async () => readPreferences());
  handle('queue:server-status', async () =>
    serverStatusSchema.parse(await request('GET', '/v1/status')),
  );
  handle('queue:operations-status', async () =>
    operationsStatusSchema.parse(await request('GET', '/v1/operations')),
  );
  handle('queue:operations-save', async input =>
    operationsStatusSchema.parse(
      await request('PUT', '/v1/operations', operationsSettingsSchema.parse(input), 120000),
    ),
  );
  handle('queue:operation', async input =>
    operationResultSchema.parse(
      await request('POST', '/v1/operations', operationSchema.parse(input), 120000),
    ),
  );
  handle('queue:backup', async () =>
    backupSummarySchema.parse(await request('POST', '/v1/backups', {}, 120000)),
  );
  handle('queue:save-device-preferences', async input => {
    requireOperator();
    const value = devicePreferencesSchema.parse(input);
    if (
      value.printerName &&
      !(await window.webContents.getPrintersAsync()).some(p => p.name === value.printerName)
    )
      throw new Error('Selected printer is unavailable');
    return savePreferences(value);
  });
  handle('queue:export', async input => {
    const { format, ...period } = range
      .extend({ format: z.enum(['pdf', 'csv', 'json']).default('pdf') })
      .parse(input);
    const generation = connectionGeneration;
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    const report = await analytics(period);
    if (generation !== connectionGeneration)
      throw new Error('تغير اتصال الفرع. أنشئ التقرير مجددًا.');
    return exportReport(window, report, format, snapshot.branchId);
  });
  handle('queue:quit', async () => {
    requireOperator();
    await tv.close();
    app.quit();
  });
  handle('queue:operator-unlock', async input => {
    await verifyManager(input);
    operatorUntil = Date.now() + 120000;
  });
  handle('queue:operator-lock', async () => {
    operatorUntil = 0;
  });
  await loadRenderer(window);
  window.show();
  await adaptRole();
  await restoreTvLayout(tv);
  const restoreTvTimer = setInterval(() => {
    if (updates.getStatus().state !== 'installing') void restoreTvLayout(tv);
  }, 15000);
  app.once('before-quit', () => clearInterval(restoreTvTimer));
});
app.on('window-all-closed', () => app.quit());
