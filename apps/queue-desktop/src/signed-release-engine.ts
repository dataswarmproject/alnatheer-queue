import { EventEmitter } from 'node:events';
import {
  verifyRelease,
  verifyReleaseFile,
  type SignedRelease,
} from '@saraf/queue-core/update-release';
import type { UpdateEngine } from './update-controller';

export class SignedReleaseEngine extends EventEmitter implements UpdateEngine {
  private release: SignedRelease | null = null;
  private installer: string | null = null;
  constructor(
    private options: {
      publicKey: string;
      latest: () => Promise<unknown>;
      download: (release: SignedRelease, progress: (percent: number) => void) => Promise<string>;
      install: (file: string) => Promise<void>;
    },
  ) {
    super();
  }
  async checkForUpdates() {
    const value = await this.options.latest();
    this.release = value === null ? null : verifyRelease(value, this.options.publicKey);
    return this.release ? { updateInfo: { version: this.release.payload.version } } : null;
  }
  async downloadUpdate() {
    if (!this.release) throw new Error('No signed release available');
    const release = this.release;
    const file = await this.options.download(release, percent =>
      this.emit('download-progress', { percent }),
    );
    await verifyReleaseFile(file, release, this.options.publicKey);
    this.installer = file;
    return [file];
  }
  async verify(file: string) {
    if (!this.release || this.installer !== file) throw new Error('Unexpected release installer');
    await verifyReleaseFile(file, this.release, this.options.publicKey);
  }
  async quitAndInstall() {
    if (!this.installer) throw new Error('Verified release not downloaded');
    await this.verify(this.installer);
    await this.options.install(this.installer);
  }
}
