import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TicketAssets } from './ticket-layout';
let assets: Promise<TicketAssets> | undefined;
export function ticketAssets(rendererRoot: string) {
  return (assets ??= (async () => {
    const data = async (file: string, mime: string) =>
      `data:${mime};base64,${(await readFile(path.join(rendererRoot, file))).toString('base64')}`;
    const [logo, arabic, sans, mono] = await Promise.all([
      data('icon.png', 'image/png'),
      data('fonts/thmanyahsans-Regular.woff2', 'font/woff2'),
      data('fonts/thmanyahsans-Regular.woff2', 'font/woff2'),
      data('fonts/thmanyahsans-Bold.woff2', 'font/woff2'),
    ]);
    return { logo, arabic, sans, mono };
  })());
}
