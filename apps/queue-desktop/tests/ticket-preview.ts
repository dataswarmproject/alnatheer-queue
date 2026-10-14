import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ticketDocument } from '../src/main/ticket-layout';
import { ticketAssets } from '../src/main/ticket-assets';
import type { Ticket } from '@saraf/queue-core';
const root = path.resolve('..', '..', 'apps', 'queue-desktop');
async function main() {
  const assets = await ticketAssets(path.join(root, 'src', 'renderer', 'public'));
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  const ticket: Ticket = {
    id: '11111111-1111-4111-8111-111111111111',
    serviceId: '22222222-2222-4222-8222-222222222222',
    originalServiceId: '22222222-2222-4222-8222-222222222222',
    code: 'A-023',
    counterId: null,
    status: 'waiting',
    issuedAt: '2026-10-13T10:01:00.000Z',
    queuedAt: '2026-10-13T10:01:00.000Z',
    calledAt: null,
    startedAt: null,
    completedAt: null,
  };
  for (const paper of ['58mm', '80mm'] as const) {
    await writeFile(
      path.join(root, 'test-results', `ticket-${paper}.html`),
      ticketDocument(
        ticket,
        paper,
        { name: 'بيع وشراء العملات', nameEn: 'Buying & selling currencies' },
        assets,
      ),
    );
    await writeFile(
      path.join(root, 'test-results', `ticket-stress-${paper}.html`),
      ticketDocument(
        { ...ticket, code: 'ABC-123456789012' },
        paper,
        { name: 'خدمة '.repeat(16).trim(), nameEn: 'Currency exchange '.repeat(4).trim() },
        assets,
      ),
    );
  }
  console.log('Actual ticket print documents generated, with preview-only sample content.');
  for (const paper of ['58mm', '80mm'] as const)
    await writeFile(
      path.join(root, 'test-results', `ticket-escaped-${paper}.html`),
      ticketDocument(
        ticket,
        paper,
        {
          name: 'بيع العملات <script>window.injected=true</script>',
          nameEn: 'Cash & <b>exchange</b>',
        },
        assets,
      ),
    );
}
void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
