import type {
  Command,
  Snapshot,
  Service,
  Counter,
  Role,
  Ticket,
  QueueEvent,
} from '@saraf/queue-core';
import type { QueueAnalytics } from '@saraf/queue-core/analytics';
import type { DevicePreferences, QueuePrinter } from '@saraf/queue-core/device';
import type { ServerStatus } from '@saraf/queue-core/server';
import type { SpeechRequest, SpeechAudio } from '@saraf/queue-core/speech';
import type { z } from 'zod';
import type { backupSummarySchema } from '@saraf/queue-core/server';
import type { DeviceMode, HostSetup, HostSetupInfo, TvStatus } from './setup-contract';
import type { AudioSettings, AudioRuntime, AudioStatus } from './audio-contract';
import type {
  OperationsSettings,
  OperationsStatus,
  Operation,
  OperationResult,
} from '@saraf/queue-core/operations';
import type { UpdateStatus, UpdateAction } from './update-contract';
export interface QueueBridge {
  windowState(): Promise<{ maximized: boolean }>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onWindowState(listener: (state: { maximized: boolean }) => void): () => void;
  updateStatus(): Promise<UpdateStatus>;
  updateAction(input: UpdateAction): Promise<UpdateStatus>;
  connection(): Promise<{
    configured: boolean;
    url?: string;
    role?: Role;
    mode?: DeviceMode;
    companion?: boolean;
  }>;
  connect(input: { url: string; token: string; mode?: DeviceMode }): Promise<void>;
  importPairing(mode: DeviceMode): Promise<boolean>;
  savePairing(): Promise<boolean>;
  hostSetupInfo(): Promise<HostSetupInfo>;
  chooseSetupPath(kind: 'directory' | 'cert' | 'key'): Promise<string | null>;
  canBrowseHostFolders(): Promise<boolean>;
  browseHostFolder(kind: 'database' | 'backup' | 'report'): Promise<void>;
  createHost(input: HostSetup): Promise<void>;
  resumeHost(): Promise<void>;
  tvStatus(): Promise<TvStatus>;
  openTv(displayId: number): Promise<void>;
  closeTv(): Promise<void>;
  audioStatus(): Promise<AudioStatus>;
  saveAudioSettings(input: AudioSettings): Promise<AudioSettings>;
  reportAudio(input: AudioRuntime): Promise<void>;
  testTvAudio(): Promise<void>;
  onAudioSettings(listener: (settings: AudioSettings) => void): () => void;
  onAudioTest(listener: () => void): () => void;
  disconnect(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  speechStatus(): Promise<{ configured: boolean; cachedOnly: boolean; restartRequired?: boolean }>;
  speech(input: SpeechRequest): Promise<SpeechAudio>;
  command(input: Command): Promise<{ ticket: Ticket | null; counter: Counter | null }>;
  configure(input: { services: Service[]; counters: Counter[] }): Promise<void>;
  provision(input: {
    role: Role;
    counterId: string | null;
    name?: string;
    staffRef?: string;
  }): Promise<{ token: string }>;
  devices(): Promise<
    {
      id: string;
      role: Role;
      counterId: string | null;
      name: string | null;
      staffRef: string | null;
      enabled: boolean;
    }[]
  >;
  revoke(id: string): Promise<void>;
  journey(input: {
    code: string;
    day: string;
  }): Promise<{ ticket: Ticket | null; events: QueueEvent[]; partial: boolean }>;
  analytics(input: { from: string; to: string; slaSeconds?: number }): Promise<QueueAnalytics>;
  expand(expanded: boolean): Promise<void>;
  onViewChange(listener: (expanded: boolean) => void): () => void;
  pointer(interactive: boolean): void;
  preferences(): Promise<string[]>;
  favorites(ids: string[]): Promise<void>;
  print(ticketId: string): Promise<Ticket>;
  autoPrint(ticketId: string): Promise<Ticket>;
  printers(): Promise<QueuePrinter[]>;
  devicePreferences(): Promise<DevicePreferences>;
  saveDevicePreferences(input: DevicePreferences): Promise<DevicePreferences>;
  serverStatus(): Promise<ServerStatus>;
  operationsStatus(): Promise<OperationsStatus>;
  saveOperations(input: OperationsSettings): Promise<OperationsStatus>;
  runOperation(input: Operation): Promise<OperationResult>;
  backup(): Promise<z.infer<typeof backupSummarySchema>>;
  exportReport(input: {
    from: string;
    to: string;
    slaSeconds?: number;
    format?: 'pdf' | 'csv' | 'json';
  }): Promise<void>;
  quit(): Promise<void>;
  unlockOperator(managerKey: string): Promise<void>;
  lockOperator(): Promise<void>;
}
declare global {
  interface Window {
    queue: QueueBridge;
  }
}
