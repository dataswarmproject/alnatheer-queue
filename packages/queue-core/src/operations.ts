import { z } from 'zod';
import { backupSummarySchema } from './server';
export const operationsSettingsSchema = z
  .object({
    syncEnabled: z.boolean(),
    syncUrl: z.string().max(500),
    syncKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    dailyBackups: z.boolean(),
    dailyReports: z.boolean(),
  })
  .strict();
export type OperationsSettings = z.infer<typeof operationsSettingsSchema>;
export const operationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync_now') }).strict(),
  z.object({ action: z.literal('database_check') }).strict(),
  z.object({ action: z.literal('database_maintenance') }).strict(),
  z.object({ action: z.literal('verify_backup'), filename: z.string().max(160) }).strict(),
  z.object({ action: z.literal('restore_backup'), filename: z.string().max(160) }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const operationsStatusSchema = z
  .object({
    settings: operationsSettingsSchema
      .omit({ syncKey: true })
      .extend({ hasSyncKey: z.boolean() })
      .strict(),
    databaseDirectory: z.string().max(1000),
    backupDirectory: z.string().max(1000),
    reportDirectory: z.string().max(1000),
    backups: z.array(backupSummarySchema).max(50),
  })
  .strict();
export type OperationsStatus = z.infer<typeof operationsStatusSchema>;
export const operationResultSchema = z
  .object({
    message: z.string().max(1000),
    directory: z.string().max(1000).optional(),
    tables: z
      .array(z.object({ name: z.string().max(100), rows: z.number().int().nonnegative() }).strict())
      .max(10)
      .optional(),
    invalidActiveTickets: z.number().int().nonnegative().optional(),
    bytes: z.number().nonnegative().nullable().optional(),
  })
  .strict();
export type OperationResult = z.infer<typeof operationResultSchema>;
