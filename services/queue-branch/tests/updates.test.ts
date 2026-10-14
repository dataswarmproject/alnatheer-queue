import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { waitForHostExit } from '../../../apps/queue-desktop/src/process-exit';
import {
  UpdateController,
  type UpdatePreferences,
} from '../../../apps/queue-desktop/src/update-controller';
class Engine extends EventEmitter {
  version = '0.4.1';
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: this.version } }));
  downloadUpdate = vi.fn(async () => ['installer.exe']);
  quitAndInstall = vi.fn();
}
const empty: UpdatePreferences = {
  ignoredVersion: null,
  scheduledVersion: null,
  scheduledAt: null,
};
function fixture(preferences = empty) {
  const engine = new Engine(),
    verify = vi.fn(async () => {}),
    prepareInstall = vi.fn(async () => {}),
    save = vi.fn(async (_p: UpdatePreferences) => {});
  let manager = true;
  const control = new UpdateController({
    engine,
    currentVersion: '0.4.0',
    preferences,
    save,
    verify,
    prepareInstall,
    isManager: () => manager,
    now: () => 100000,
  });
  return {
    engine,
    control,
    verify,
    prepareInstall,
    save,
    setManager: (v: boolean) => {
      manager = v;
    },
  };
}
describe('signed desktop update workflow', () => {
  it('recovers the stopped host after an emitted nonthrowing installer failure', async () => {
    const f = fixture(),
      recover = vi.fn(async () => {});
    const controller = new UpdateController({
      currentVersion: '0.4.0',
      engine: f.engine,
      preferences: empty,
      save: f.save,
      verify: f.verify,
      prepareInstall: async () => recover,
      isManager: () => true,
    });
    await controller.action({ action: 'check' });
    await controller.action({ action: 'download' });
    f.engine.quitAndInstall.mockImplementationOnce(() => {
      f.engine.emit('error', new Error('installer spawn failed'));
    });
    await controller.action({ action: 'install' });
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(controller.getStatus().state).toBe('error');
    expect(controller.getStatus().message).toContain('spawn failed');
  });
  it('waits for actual host exit even when its listening socket is already closed', async () => {
    let alive = true;
    const wait = vi.fn(async () => {
      alive = false;
    });
    await waitForHostExit(async () => alive, wait);
    expect(wait).toHaveBeenCalledTimes(1);
    await expect(
      waitForHostExit(
        async () => true,
        async () => {},
        2,
      ),
    ).rejects.toThrow('لم يخرج');
  });
  it('rejects unconfigured delivery, unauthorized actions and downgrades', async () => {
    const f = fixture();
    f.setManager(false);
    await expect(f.control.action({ action: 'check' })).rejects.toThrow('مدير');
    f.setManager(true);
    f.engine.version = '0.3.5';
    expect((await f.control.action({ action: 'check' })).availableVersion).toBeNull();
    const controller = new UpdateController({
      currentVersion: '0.4.0',
      engine: null,
      preferences: empty,
      save: f.save,
      verify: f.verify,
      prepareInstall: f.prepareInstall,
      isManager: () => true,
    });
    expect(controller.getStatus().state).toBe('not_configured');
    await expect(controller.action({ action: 'download' })).rejects.toThrow();
  });
  it('never installs unverified files or before successful maintenance/backup', async () => {
    const f = fixture();
    await f.control.action({ action: 'check' });
    f.verify.mockRejectedValueOnce(new Error('invalid publisher'));
    await expect(f.control.action({ action: 'download' })).rejects.toThrow('publisher');
    await expect(f.control.action({ action: 'install' })).rejects.toThrow();
    expect(f.prepareInstall).not.toHaveBeenCalled();
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    await f.control.action({ action: 'download' });
    f.prepareInstall.mockRejectedValueOnce(new Error('active tickets'));
    await expect(f.control.action({ action: 'install' })).rejects.toThrow('active tickets');
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    await f.control.action({ action: 'install' });
    expect(f.engine.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it('ignores only a selected version and reports progress', async () => {
    const f = fixture();
    await f.control.action({ action: 'check' });
    await f.control.action({ action: 'ignore' });
    expect((await f.control.action({ action: 'check' })).state).toBe('ignored');
    f.engine.version = '0.4.2';
    expect((await f.control.action({ action: 'check' })).state).toBe('available');
    let finish!: (value: string[]) => void;
    f.engine.downloadUpdate.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const downloading = f.control.action({ action: 'download' });
    f.engine.emit('download-progress', { percent: 40 });
    expect(f.control.getStatus().progress).toBe(40);
    finish(['installer.exe']);
    await downloading;
  });
  it('honors cancellation while a due scheduled download is pending after restart', async () => {
    const f = fixture({
      ...empty,
      scheduledVersion: '0.4.1',
      scheduledAt: new Date(99000).toISOString(),
    });
    let finish!: (v: string[]) => void;
    f.engine.downloadUpdate.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const ticking = f.control.tick();
    await vi.waitFor(() => expect(f.engine.downloadUpdate).toHaveBeenCalled());
    await f.control.action({ action: 'cancel_schedule' });
    finish(['installer.exe']);
    await ticking;
    expect(f.engine.quitAndInstall).not.toHaveBeenCalled();
    expect(f.prepareInstall).not.toHaveBeenCalled();
    expect(f.control.getStatus().scheduledAt).toBeNull();
  });
  it('waits for Saudi schedule and checks manager authorization after download', async () => {
    const f = fixture({
      ...empty,
      scheduledVersion: '0.4.1',
      scheduledAt: new Date(200000).toISOString(),
    });
    await f.control.tick();
    expect(f.engine.downloadUpdate).not.toHaveBeenCalled();
    await f.control.action({ action: 'cancel_schedule' });
    await f.control.action({ action: 'check' });
    await f.control.action({ action: 'schedule', at: new Date(200000).toISOString() });
    expect(f.control.getStatus().state).toBe('scheduled');
    const due = fixture({
      ...empty,
      scheduledVersion: '0.4.1',
      scheduledAt: new Date(99000).toISOString(),
    });
    due.verify.mockImplementationOnce(async () => {
      due.setManager(false);
    });
    await due.control.tick();
    expect(due.engine.quitAndInstall).not.toHaveBeenCalled();
  });
});
