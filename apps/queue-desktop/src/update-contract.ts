import { z } from 'zod';
export const updateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('download') }).strict(),
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('ignore') }).strict(),
  z.object({ action: z.literal('cancel_schedule') }).strict(),
  z.object({ action: z.literal('schedule'), at: z.string().datetime() }).strict(),
]);
export type UpdateAction = z.infer<typeof updateActionSchema>;
export type UpdateStatus = {
  currentVersion: string;
  state:
    | 'not_configured'
    | 'idle'
    | 'checking'
    | 'available'
    | 'ignored'
    | 'downloading'
    | 'downloaded'
    | 'scheduled'
    | 'installing'
    | 'error';
  availableVersion: string | null;
  progress: number | null;
  scheduledAt: string | null;
  message: string;
};
