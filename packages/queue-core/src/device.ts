import { z } from 'zod';
export const devicePreferencesSchema = z
  .object({
    printerName: z.string().min(1).max(256).nullable(),
    paperWidth: z.enum(['58mm', '80mm']),
    autoPrint: z.boolean(),
    resetSeconds: z.number().int().min(5).max(60),
  })
  .strict()
  .refine(
    value => !value.autoPrint || !!value.printerName,
    'Select a printer before enabling automatic printing',
  );
export type DevicePreferences = z.infer<typeof devicePreferencesSchema>;
export const defaultDevicePreferences: DevicePreferences = {
  printerName: null,
  paperWidth: '80mm',
  autoPrint: false,
  resetSeconds: 20,
};
export const printerSchema = z
  .object({
    name: z.string().max(256),
    displayName: z.string().max(256),
    description: z.string().max(512),
  })
  .strict();
export type QueuePrinter = z.infer<typeof printerSchema>;
