import { EventEmitter } from 'node:events';
import type { UpdateStatus, UpdateAction } from './update-contract';
export interface UpdateEngine extends EventEmitter {
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void | Promise<void>;
}
export type UpdatePreferences = {
  ignoredVersion: string | null;
  scheduledVersion: string | null;
  scheduledAt: string | null;
};
// Stable releases only; never offer the same version, a prerelease or a downgrade.
function newer(version: string, current: string) {
  const parse = (value: string) =>
    /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const next = parse(version),
    old = parse(current);
  if (!next || !old) throw new Error('بيانات الإصدار غير صالحة.');
  for (let i = 0; i < 3; i++) if (next[i] !== old[i]) return next[i] > old[i];
  return false;
}
export class UpdateController {
  private status: UpdateStatus;
  private preferences: UpdatePreferences;
  private checking = false;
  private downloading = false;
  private installing = false;
  private recovering = false;
  private installRecovery: (() => Promise<void>) | null = null;
  private verifiedVersion: string | null = null;
  private verifiedFile: string | null = null;
  private scheduleGeneration = 0;
  constructor(
    private options: {
      currentVersion: string;
      engine: UpdateEngine | null;
      preferences: UpdatePreferences;
      save: (value: UpdatePreferences) => Promise<void>;
      verify: (file: string) => Promise<void>;
      prepareInstall: () => Promise<void | (() => Promise<void>)>;
      isManager: () => boolean;
      now?: () => number;
    },
  ) {
    this.preferences = options.preferences;
    this.status = {
      currentVersion: options.currentVersion,
      state: options.engine ? 'idle' : 'not_configured',
      availableVersion: null,
      progress: null,
      scheduledAt: options.preferences.scheduledAt,
      message: options.engine ? '' : 'مصدر التحديثات الآمنة غير مهيأ. تواصل مع مسؤول النظام.',
    };
    options.engine?.on('download-progress', ({ percent }: { percent: number }) => {
      if (this.downloading) this.status.progress = Math.max(0, Math.min(100, percent));
    });
    options.engine?.on('error', (error: Error) => {
      if (this.installing && this.installRecovery) void this.recoverInstall(error);
    });
  }
  getStatus() {
    return { ...this.status };
  }
  private async persist(value: UpdatePreferences) {
    await this.options.save(value);
    this.preferences = value;
    this.status.scheduledAt = value.scheduledAt;
    this.scheduleGeneration++;
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  async action(action: UpdateAction) {
    if (!this.options.isManager()) throw new Error('إجراءات التحديث متاحة لمدير الفرع فقط.');
    if (this.installing || this.recovering)
      throw new Error('جارٍ تثبيت التحديث أو استعادة تشغيل الفرع.');
    if ((this.checking || this.downloading) && action.action !== 'cancel_schedule')
      throw new Error('انتظر انتهاء العملية الحالية.');
    try {
      if (action.action === 'cancel_schedule') {
        await this.persist({ ...this.preferences, scheduledAt: null, scheduledVersion: null });
        if (!this.downloading && !this.checking)
          this.status.state = this.verifiedVersion
            ? 'downloaded'
            : this.status.availableVersion
              ? 'available'
              : this.options.engine
                ? 'idle'
                : 'not_configured';
        this.status.message = 'أُلغيت الجدولة. لن يُثبّت التحديث تلقائيًا.';
        return this.getStatus();
      }
      if (!this.options.engine) throw new Error(this.status.message);
      if (action.action === 'check') await this.check();
      else if (action.action === 'download') await this.download();
      else if (action.action === 'install') await this.install();
      else if (action.action === 'ignore') {
        if (this.downloading || this.checking) throw new Error('انتظر انتهاء العملية الحالية.');
        if (!this.status.availableVersion) throw new Error('لا يوجد إصدار جديد لتجاهله.');
        await this.persist({
          ignoredVersion: this.status.availableVersion,
          scheduledAt: null,
          scheduledVersion: null,
        });
        this.status.state = 'ignored';
        this.status.message = 'تم تجاهل هذا الإصدار فقط؛ سيظهر إشعار عند توفر إصدار آخر.';
      } else {
        const at = Date.parse(action.at);
        if (!Number.isFinite(at) || at < this.now() + 60000 || at > this.now() + 31 * 86400000)
          throw new Error('اختر وقتًا لاحقًا خلال 31 يومًا.');
        if (!this.status.availableVersion) throw new Error('تحقق من وجود إصدار جديد أولًا.');
        await this.persist({
          ignoredVersion: null,
          scheduledAt: action.at,
          scheduledVersion: this.status.availableVersion,
        });
        await this.download();
        this.status.state = 'scheduled';
        this.status.message =
          'التحديث جاهز. يُثبّت في الموعد عند خلو الفرع من التذاكر المفتوحة وبعد نسخة متحققة.';
      }
    } catch (e) {
      this.status.state = this.options.engine ? 'error' : 'not_configured';
      this.status.message = e instanceof Error ? e.message : 'تعذر إجراء التحديث.';
      throw e;
    }
    return this.getStatus();
  }
  private async check() {
    if (this.checking || this.downloading) throw new Error('عملية تحديث أخرى جارية.');
    this.checking = true;
    this.status.state = 'checking';
    this.status.message = '';
    try {
      const result = await this.options.engine!.checkForUpdates();
      const version = result?.updateInfo.version;
      if (!version || !newer(version, this.options.currentVersion)) {
        this.status.availableVersion = null;
        this.status.state = 'idle';
        this.status.message = 'أنت تستخدم الإصدار الحالي.';
        return;
      }
      this.status.availableVersion = version;
      this.status.state =
        this.preferences.ignoredVersion === version
          ? 'ignored'
          : this.verifiedVersion === version
            ? this.preferences.scheduledAt
              ? 'scheduled'
              : 'downloaded'
            : 'available';
      if (this.preferences.scheduledVersion && this.preferences.scheduledVersion !== version)
        await this.persist({ ...this.preferences, scheduledAt: null, scheduledVersion: null });
    } finally {
      this.checking = false;
    }
  }
  private async download() {
    if (this.verifiedVersion === this.status.availableVersion && this.verifiedVersion) return;
    if (!this.status.availableVersion || this.checking || this.downloading)
      throw new Error('تحقق من الإصدار أو انتظر انتهاء التنزيل.');
    this.downloading = true;
    this.status.state = 'downloading';
    this.status.progress = 0;
    this.status.message = '';
    try {
      const files = await this.options.engine!.downloadUpdate();
      if (files.length !== 1) throw new Error('ملف تثبيت غير متوقع.');
      await this.options.verify(files[0]);
      this.verifiedVersion = this.status.availableVersion;
      this.verifiedFile = files[0];
      this.status.state = this.preferences.scheduledAt ? 'scheduled' : 'downloaded';
      this.status.progress = 100;
    } finally {
      this.downloading = false;
    }
  }
  private async install() {
    if (
      this.downloading ||
      this.checking ||
      !this.verifiedVersion ||
      this.verifiedVersion !== this.status.availableVersion
    )
      throw new Error('نزّل الإصدار المتحقق أولًا.');
    this.installing = true;
    this.status.state = 'installing';
    this.status.message = 'التحقق من خلو الفرع وإنشاء نسخة احتياطية…';
    this.installRecovery = null;
    try {
      // Verify before taking a working branch through maintenance, then verify again
      // after draining it to cover changes while the backup is being created.
      await this.verifyDownloadedFile();
      this.installRecovery = (await this.options.prepareInstall()) || null;
      if (!this.options.isManager()) throw new Error('تغير اتصال مدير الفرع.');
      await this.verifyDownloadedFile();
      await this.persist({ ignoredVersion: null, scheduledAt: null, scheduledVersion: null });
      try {
        await this.options.engine!.quitAndInstall(false, true);
      } catch (error) {
        this.verifiedVersion = null;
        this.verifiedFile = null;
        throw error;
      }
    } catch (e) {
      await this.recoverInstall(e);
      throw e;
    }
  }
  private async verifyDownloadedFile() {
    try {
      if (!this.verifiedFile) throw new Error('نزّل الإصدار المتحقق أولًا.');
      await this.options.verify(this.verifiedFile);
    } catch (error) {
      this.verifiedVersion = null;
      this.verifiedFile = null;
      this.status.progress = null;
      throw error;
    }
  }
  private async recoverInstall(error: unknown) {
    if (this.recovering) return;
    this.recovering = true;
    this.installing = false;
    this.status.state = 'error';
    this.status.message = error instanceof Error ? error.message : 'تعذر تشغيل المثبّت.';
    const recover = this.installRecovery;
    this.installRecovery = null;
    try {
      await recover?.();
    } catch {
      this.status.message += ' تعذر استئناف الخادم؛ افتح التطبيق مجددًا لاستئنافه.';
    } finally {
      this.recovering = false;
    }
  }
  async tick() {
    if (
      !this.options.isManager() ||
      !this.preferences.scheduledAt ||
      Date.parse(this.preferences.scheduledAt) > this.now() ||
      this.installing ||
      this.recovering ||
      this.downloading ||
      this.checking ||
      !this.options.engine
    )
      return;
    const generation = this.scheduleGeneration,
      version = this.preferences.scheduledVersion;
    try {
      await this.check();
      if (generation !== this.scheduleGeneration || this.status.availableVersion !== version)
        return;
      await this.download();
      if (
        generation !== this.scheduleGeneration ||
        !this.preferences.scheduledAt ||
        !this.options.isManager()
      )
        return;
      await this.install();
    } catch (e) {
      this.status.state = 'error';
      this.status.message = e instanceof Error ? e.message : 'تعذر تنفيذ التحديث المجدول.';
    }
  }
}
