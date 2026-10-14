import { z } from 'zod';
import { id, type Snapshot } from '@saraf/queue-core';

export const deviceModeSchema = z.enum([
  'teller',
  'kiosk',
  'manager',
  'hdmi',
  'display',
  'counter-display',
]);
export type DeviceMode = z.infer<typeof deviceModeSchema>;
export function assertDeviceMode(mode: DeviceMode | undefined, snapshot: Snapshot) {
  if (!mode) return;
  const expectedRole = mode === 'hdmi' ? 'manager' : mode === 'counter-display' ? 'display' : mode;
  if (
    snapshot.actor.role !== expectedRole ||
    (mode === 'counter-display' && !snapshot.actor.counterId) ||
    (mode === 'display' && snapshot.actor.counterId)
  ) {
    throw new Error('مفتاح الجهاز لا يطابق الاستخدام المختار. اطلب المفتاح الصحيح من مدير الفرع.');
  }
}
export const hostSetupSchema = z
  .object({
    branchId: id,
    directory: z.string().min(1).max(500),
    port: z.number().int().min(1024).max(65535),
    host: z.string().min(1).max(200),
    url: z.string().min(1).max(200),
    cert: z.string().max(500).optional(),
    key: z.string().max(500).optional(),
    syncUrl: z.string().max(200).optional(),
    syncKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    openAtLogin: z.boolean(),
    speechVoiceId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .optional(),
    speechApiKey: z.string().min(10).max(300).optional(),
  })
  .strict();
export type HostSetup = z.infer<typeof hostSetupSchema>;
export type HostSetupInfo = {
  directory: string;
  configured: boolean;
  startupSupported: boolean;
  addresses: string[];
  localVoiceAvailable?: boolean;
};
export type Monitor = {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
};
export type TvStatus = { open: boolean; displayId: number | null; monitors: Monitor[] };
