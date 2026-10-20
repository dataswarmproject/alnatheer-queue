import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { id, snapshotSchema } from '@saraf/queue-core';
import { connectionInfo, connectionTrust, request, send } from './client';
import type { BranchTrust } from '@saraf/queue-core/branch-tls';
import type { TvStatus } from '../setup-contract';
import { speechAudioSchema, type SpeechRequest } from '@saraf/queue-core/speech';
import { desktopSpeechStatus, guardFreeSpeech } from './speech-policy';
import { spokenAnnouncementsEnabled } from '../audio-contract';

export function createTvController(
  rendererRoot: string,
  load: (win: BrowserWindow) => Promise<void>,
  managerWindow: () => BrowserWindow,
) {
  let window: BrowserWindow | null = null;
  let displayId: number | null = null;
  let device: { id: string; token: string; url: string; trust?: BranchTrust } | null = null;
  let changing = false;
  let generation = 0;
  const status = (): TvStatus => ({
    open: !!window && !window.isDestroyed(),
    displayId,
    monitors: screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      primary: d.id === screen.getPrimaryDisplay().id,
      width: d.size.width,
      height: d.size.height,
    })),
  });
  const close = async () => {
    generation++;
    const old = device;
    const oldWindow = window;
    window = null;
    displayId = null;
    device = null;
    if (oldWindow && !oldWindow.isDestroyed()) oldWindow.destroy();
    if (old && connectionInfo().url === old.url)
      await request('POST', '/v1/devices/revoke', { id: old.id }).catch(() => {});
  };
  const authorize = async () => {
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    if (snapshot.actor.role !== 'manager') throw new Error('Branch manager authorization required');
  };
  const open = async (selected: number) => {
    if (changing) throw new Error('TV screen change is already running');
    changing = true;
    let replacing = false;
    const initialGeneration = generation;
    try {
      await authorize();
      if (initialGeneration !== generation) throw new Error('TV request was canceled');
      const display = screen.getAllDisplays().find(d => d.id === selected);
      if (!display || display.id === screen.getDisplayMatching(managerWindow().getBounds()).id)
        throw new Error('اختر شاشة ثانية. وصّل HDMI ثم اختر «توسيع» في إعدادات عرض Windows.');
      replacing = true;
      await close();
      const openingGeneration = generation;
      const url = connectionInfo().url!;
      const actor = z
        .object({
          id,
          token: z.string().regex(/^[a-f0-9]{64}$/),
          role: z.literal('display'),
          counterId: z.null(),
        })
        .strict()
        .parse(
          await request('POST', '/v1/devices', {
            role: 'display',
            counterId: null,
            name: 'HDMI room display',
          }),
        );
      if (openingGeneration !== generation || url !== connectionInfo().url) {
        if (url === connectionInfo().url)
          await request('POST', '/v1/devices/revoke', { id: actor.id }).catch(() => {});
        throw new Error('TV request was canceled');
      }
      device = {
        id: actor.id,
        token: actor.token,
        url,
        ...(connectionTrust() ? { trust: connectionTrust() } : {}),
      };
      displayId = display.id;
      const win = new BrowserWindow({
        title: 'النذير · شاشة العرض',
        ...display.bounds,
        frame: true,
        transparent: false,
        backgroundColor: '#000000',
        show: false,
        skipTaskbar: true,
        autoHideMenuBar: true,
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
      window = win;
      win.on('page-title-updated', event => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', e => e.preventDefault());
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !['Escape', 'F11'].includes(input.key)) return;
        event.preventDefault();
        win.setFullScreen(input.key === 'F11' ? !win.isFullScreen() : false);
        win.setSkipTaskbar(win.isFullScreen());
      });
      win.on('closed', () => {
        if (window === win) void close();
      });
      await load(win);
      if (openingGeneration !== generation || win.isDestroyed())
        throw new Error('TV request was canceled');
      win.setBounds(display.bounds);
      win.setFullScreen(true);
      win.showInactive();
      managerWindow().focus();
    } catch (error) {
      if (replacing) await close();
      throw error;
    } finally {
      changing = false;
    }
  };
  screen.on('display-removed', (_event, display) => {
    if (display.id === displayId) void close();
  });
  return {
    status,
    open,
    close,
    isSender: (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
      !!window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame,
    snapshot: async () => {
      if (!device) throw new Error('TV is closed');
      return snapshotSchema.parse(await send(device, 'GET', '/v1/snapshot', undefined, 10000));
    },
    speechStatus: async () => {
      if (!device) throw new Error('TV is closed');
      const activeDevice = device;
      return desktopSpeechStatus(() =>
        send(activeDevice, 'GET', '/v1/speech/status', undefined, 10000),
      );
    },
    speech: async (input: SpeechRequest) => {
      if (!spokenAnnouncementsEnabled) throw new Error('النداء الصوتي غير متاح في هذا الإصدار.');
      if (!device) throw new Error('TV is closed');
      const activeDevice = device;
      await guardFreeSpeech(() => send(activeDevice, 'GET', '/v1/speech/status', undefined, 10000));
      return speechAudioSchema.parse(await send(activeDevice, 'POST', '/v1/speech', input, 20000));
    },
    connection: () => ({ configured: !!device, role: 'display' as const, companion: true }),
  };
}
