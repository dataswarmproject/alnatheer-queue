import { verifyRelease, type SignedRelease } from './update-release';

export class GithubReleaseBroker {
  constructor(
    private options: { repository: string; token: string; publicKey: string; fetch?: typeof fetch },
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) || !options.token)
      throw new Error('Private release repository is not configured');
  }
  private async api(path: string, binary = false): Promise<Response> {
    let response = await (this.options.fetch ?? fetch)(
      'https://api.github.com/repos/' + this.options.repository + path,
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(binary ? 300000 : 15000),
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const url = new URL(response.headers.get('location') ?? '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
          url.hostname,
        )
      )
        throw new Error('Unexpected release redirect');
      // Never forward GitHub authorization to the asset CDN.
      response = await (this.options.fetch ?? fetch)(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(300000),
      });
    }
    return response;
  }
  private async json(response: Response, limit = 131072): Promise<unknown> {
    if (!response.ok || !response.body) throw new Error('Private release source unavailable');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error('Release metadata too large');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async release(version?: string): Promise<{ release: SignedRelease; assetId: number } | null> {
    if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
    const response = await this.api(
      version ? '/releases/tags/queue-v' + version : '/releases/latest',
    );
    if (response.status === 404 && !version) {
      const repository = (await this.json(await this.api(''))) as { private?: boolean };
      if (repository.private !== true) throw new Error('Private release repository unavailable');
      return null;
    }
    const record = (await this.json(response)) as {
      draft: boolean;
      prerelease: boolean;
      tag_name: string;
      assets: { id: number; name: string; size: number }[];
    };
    if (
      record.draft !== false ||
      record.prerelease !== false ||
      !/^queue-v\d+\.\d+\.\d+$/.test(record.tag_name) ||
      !Array.isArray(record.assets) ||
      record.assets.length > 30
    )
      throw new Error('Invalid stable queue release');
    const manifest = record.assets.find(asset => asset.name === 'queue-release.json');
    if (!manifest || !Number.isSafeInteger(manifest.id) || manifest.id <= 0 || manifest.size > 8192)
      throw new Error('Signed release manifest unavailable');
    const release = verifyRelease(
      await this.json(await this.api('/releases/assets/' + manifest.id, true), 8192),
      this.options.publicKey,
    );
    if (
      record.tag_name !== 'queue-v' + release.payload.version ||
      (version && version !== release.payload.version)
    )
      throw new Error('Release version mismatch');
    const asset = record.assets.find(asset => asset.name === release.payload.fileName);
    if (
      !asset ||
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      asset.size !== release.payload.size
    )
      throw new Error('Release installer unavailable');
    return { release, assetId: asset.id };
  }
  async download(version: string, sha256: string): Promise<Response> {
    const found = await this.release(version);
    if (!found || found.release.payload.sha256 !== sha256)
      throw new Error('Release digest mismatch');
    const response = await this.api('/releases/assets/' + found.assetId, true);
    if (!response.ok || !response.body) throw new Error('Private installer unavailable');
    let bytes = 0;
    const size = found.release.payload.size;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.length;
          if (bytes > size) throw new Error('Installer too large');
          controller.enqueue(chunk);
        },
        flush() {
          if (bytes !== size) throw new Error('Incomplete installer');
        },
      }),
    );
    return new Response(body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(size),
        'cache-control': 'no-store',
      },
    });
  }
}
