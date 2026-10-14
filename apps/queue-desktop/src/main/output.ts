import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { Ticket } from '@saraf/queue-core';
import type { DevicePreferences } from '@saraf/queue-core/device';
import path from 'node:path';
import {
  ticketDocument,
  measureTicket,
  ticketHeightMicrons,
  type TicketService,
} from './ticket-layout';
import { ticketAssets } from './ticket-assets';
import type { z } from 'zod';
import type { analyticsSchema } from '@saraf/queue-core/analytics-contract';
type QueueAnalytics = z.infer<typeof analyticsSchema>;
import { reportDocument, reportCsv } from './report-layout';

export async function printTicket(
  ticket: Ticket,
  preferences: DevicePreferences,
  service: TicketService,
) {
  const printWindow = new BrowserWindow({
    show: false,
    width: Math.ceil(((preferences.paperWidth === '58mm' ? 58 : 80) * 96) / 25.4),
    height: 900,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const html = ticketDocument(
      ticket,
      preferences.paperWidth,
      service,
      await ticketAssets(path.join(__dirname, '../renderer')),
    );
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const layout = (await printWindow.webContents.executeJavaScript(measureTicket)) as {
      height: number;
      overflow: boolean;
    };
    if (layout.overflow) throw new Error('Ticket layout exceeds paper width');
    await new Promise<void>((resolve, reject) =>
      printWindow.webContents.print(
        {
          silent: preferences.autoPrint,
          deviceName: preferences.printerName ?? undefined,
          printBackground: false,
          color: false,
          margins: { marginType: 'none' },
          pageSize: {
            width: preferences.paperWidth === '58mm' ? 58000 : 80000,
            height: ticketHeightMicrons(layout.height),
          },
        },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'Printing cancelled'))),
      ),
    );
  } finally {
    printWindow.destroy();
  }
}
export async function exportReport(
  window: BrowserWindow,
  report: QueueAnalytics,
  format: 'pdf' | 'csv' | 'json' = 'pdf',
  branchId = '',
) {
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'حفظ تقرير أداء الفرع',
    defaultPath: 'queue-performance.' + format,
    filters: [{ name: 'Performance report', extensions: [format] }],
  });
  if (canceled || !filePath) return;
  if (format === 'json')
    await writeFile(filePath, JSON.stringify({ branchId, ...report }, null, 2));
  else if (format === 'csv') await writeFile(filePath, reportCsv(report, branchId));
  else {
    const preview = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await preview.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            reportDocument(
              report,
              await ticketAssets(path.join(__dirname, '../renderer')),
              branchId,
            ),
          ),
      );
      await preview.webContents.executeJavaScript(
        'document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))',
      );
      await writeFile(
        filePath,
        await preview.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        }),
      );
    } finally {
      preview.destroy();
    }
  }
}
