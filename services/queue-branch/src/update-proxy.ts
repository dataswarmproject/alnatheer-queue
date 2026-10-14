import type { BranchOperations } from './operations';
import { QueueError, trustedEndpoint } from '@saraf/queue-core';
import { verifyRelease } from '@saraf/queue-core/update-release';
import { queueReleasePublicKey } from '@saraf/queue-core/release-trust';
import { z } from 'zod';

export const updateDownloadSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export async function proxyRelease(
  operations: BranchOperations,
  branchId: string,
  download?: z.infer<typeof updateDownloadSchema>,
) {
  const source = operations.releaseSource();
  const base = trustedEndpoint(source.url),
    url = new URL('/api/queue/updates', base);
  if (download) {
    url.searchParams.set('version', download.version);
    url.searchParams.set('sha256', download.sha256);
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(download ? 300000 : 10000),
    headers: { authorization: `Bearer ${source.key}`, 'x-queue-branch': branchId },
  });
  if (!response.ok) throw new QueueError('UPDATE_SOURCE', 'تعذر الوصول إلى تحديثات المركز.', 503);
  if (download) return response;
  const reader = response.body?.getReader();
  if (!reader) throw new QueueError('UPDATE_SOURCE', 'Empty update response', 503);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) throw new Error('Update metadata too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return value === null ? null : verifyRelease(value, queueReleasePublicKey);
}
