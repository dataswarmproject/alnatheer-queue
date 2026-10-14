import { z } from 'zod';
import { id, snapshotSchema } from './index';
export const queueVersion = '0.4.2';
export const backupSummarySchema = z
  .object({
    version: z.literal(1),
    engine: z.literal('pglite'),
    engineVersion: z.literal('0.5.9'),
    branchId: id,
    filename: z.string().max(160),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
  })
  .strict();
export const serverStatusSchema = z
  .object({
    version: z.string().max(20),
    branchId: id,
    serverTime: z.string().datetime(),
    uptimeSeconds: z.number().nonnegative(),
    databaseReady: z.boolean(),
    maintenanceUntil: z.string().datetime().nullable().optional(),
    revision: z.number().int().nonnegative(),
    sync: snapshotSchema.shape.sync,
    enabledDevices: z.number().int().nonnegative(),
    backupsConfigured: z.boolean(),
    reportsConfigured: z.boolean(),
    lastBackup: backupSummarySchema.nullable(),
  })
  .strict();
export type ServerStatus = z.infer<typeof serverStatusSchema>;
