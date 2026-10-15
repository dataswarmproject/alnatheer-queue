import { contextBridge, ipcRenderer } from 'electron';
import type { QueueBridge } from '../bridge';
import { audioSettingsSchema } from '../audio-contract';
const bridge: QueueBridge = {
  windowState: () => ipcRenderer.invoke('queue:window-state'),
  windowAction: action => ipcRenderer.invoke('queue:window-action', action),
  onWindowState: listener => {
    const receive = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) =>
      listener(state);
    ipcRenderer.on('queue:window-state', receive);
    return () => ipcRenderer.removeListener('queue:window-state', receive);
  },
  updateStatus: () => ipcRenderer.invoke('queue:update-status'),
  updateAction: input => ipcRenderer.invoke('queue:update-action', input),
  connection: () => ipcRenderer.invoke('queue:connection'),
  connect: input => ipcRenderer.invoke('queue:connect', input),
  importPairing: mode => ipcRenderer.invoke('queue:import-pairing', mode),
  savePairing: () => ipcRenderer.invoke('queue:save-pairing'),
  hostSetupInfo: () => ipcRenderer.invoke('queue:host-setup-info'),
  chooseSetupPath: kind => ipcRenderer.invoke('queue:setup-path', kind),
  canBrowseHostFolders: () => ipcRenderer.invoke('queue:can-browse-host-folders'),
  browseHostFolder: kind => ipcRenderer.invoke('queue:browse-host-folder', kind),
  createHost: input => ipcRenderer.invoke('queue:create-host', input),
  branchIdentity: action => ipcRenderer.invoke('queue:branch-identity', action),
  resumeHost: () => ipcRenderer.invoke('queue:resume-host'),
  tvStatus: () => ipcRenderer.invoke('queue:tv-status'),
  openTv: id => ipcRenderer.invoke('queue:tv-open', id),
  closeTv: () => ipcRenderer.invoke('queue:tv-close'),
  audioStatus: () => ipcRenderer.invoke('queue:audio-status'),
  saveAudioSettings: input => ipcRenderer.invoke('queue:save-audio-settings', input),
  reportAudio: input => ipcRenderer.invoke('queue:audio-report', input),
  testTvAudio: () => ipcRenderer.invoke('queue:audio-test'),
  onAudioSettings: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = audioSettingsSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on('queue:audio-settings', receive);
    return () => ipcRenderer.removeListener('queue:audio-settings', receive);
  },
  onAudioTest: listener => {
    const receive = () => listener();
    ipcRenderer.on('queue:audio-test', receive);
    return () => ipcRenderer.removeListener('queue:audio-test', receive);
  },
  disconnect: () => ipcRenderer.invoke('queue:disconnect'),
  snapshot: () => ipcRenderer.invoke('queue:snapshot'),
  speechStatus: () => ipcRenderer.invoke('queue:speech-status'),
  speech: input => ipcRenderer.invoke('queue:speech', input),
  command: input => ipcRenderer.invoke('queue:command', input),
  configure: input => ipcRenderer.invoke('queue:configure', input),
  provision: input => ipcRenderer.invoke('queue:provision', input),
  devices: () => ipcRenderer.invoke('queue:devices'),
  revoke: id => ipcRenderer.invoke('queue:revoke', id),
  journey: input => ipcRenderer.invoke('queue:journey', input),
  analytics: input => ipcRenderer.invoke('queue:analytics', input),
  expand: expanded => ipcRenderer.invoke('queue:expand', expanded),
  onViewChange: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value === 'boolean') listener(value);
    };
    ipcRenderer.on('queue:view', receive);
    return () => ipcRenderer.removeListener('queue:view', receive);
  },
  pointer: interactive => ipcRenderer.send('queue:pointer', interactive),
  preferences: () => ipcRenderer.invoke('queue:preferences'),
  favorites: ids => ipcRenderer.invoke('queue:favorites', ids),
  print: id => ipcRenderer.invoke('queue:print', id),
  autoPrint: id => ipcRenderer.invoke('queue:auto-print', id),
  printers: () => ipcRenderer.invoke('queue:printers'),
  devicePreferences: () => ipcRenderer.invoke('queue:device-preferences'),
  serverStatus: () => ipcRenderer.invoke('queue:server-status'),
  operationsStatus: () => ipcRenderer.invoke('queue:operations-status'),
  saveOperations: input => ipcRenderer.invoke('queue:operations-save', input),
  runOperation: input => ipcRenderer.invoke('queue:operation', input),
  backup: () => ipcRenderer.invoke('queue:backup'),
  saveDevicePreferences: input => ipcRenderer.invoke('queue:save-device-preferences', input),
  exportReport: input => ipcRenderer.invoke('queue:export', input),
  quit: () => ipcRenderer.invoke('queue:quit'),
  unlockOperator: key => ipcRenderer.invoke('queue:operator-unlock', key),
  lockOperator: () => ipcRenderer.invoke('queue:operator-lock'),
};
contextBridge.exposeInMainWorld('queue', bridge);
