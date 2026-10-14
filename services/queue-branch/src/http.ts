import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { QueueError, roleSchema, id } from '@saraf/queue-core';
import type { QueueStore } from './store';
import { branchAnalytics } from './analytics';
import { z } from 'zod';
import { ticketJourney } from './journey';
import { createBackup } from './backups';
import { queueVersion } from '@saraf/queue-core/server';
import { announcementText, speechRequestSchema, speechTestText } from '@saraf/queue-core/speech';
import type { NeuralSpeech } from './speech';
import type { BranchOperations } from './operations';
import { proxyRelease, updateDownloadSchema } from './update-proxy';

async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new QueueError('CONTENT_TYPE', 'JSON required', 415);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 131072) throw new QueueError('BODY_SIZE', 'Request too large', 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new QueueError('JSON', 'Invalid JSON', 400);
  }
}

export function createBranchServer(
  store: QueueStore,
  options: {
    syncConfigured?: boolean;
    cert?: string;
    key?: string;
    backupDirectory?: string;
    reportsConfigured?: boolean;
    speech?: NeuralSpeech;
    operations?: BranchOperations;
    shutdown?: () => Promise<void>;
    isStopping?: () => boolean;
  } = {},
) {
  const rates = new Map<string, { count: number; since: number }>();
  const rateLimit = (key: string, limit: number) => {
    if (rates.size >= 2000)
      for (const [entry, value] of rates) if (Date.now() - value.since > 60000) rates.delete(entry);
    if (!rates.has(key) && rates.size >= 2000)
      throw new QueueError('RATE_LIMIT', 'Too many clients', 429);
    const rate = rates.get(key) ?? { count: 0, since: Date.now() };
    if (Date.now() - rate.since > 60000) {
      rate.count = 0;
      rate.since = Date.now();
    }
    rate.count++;
    rates.set(key, rate);
    if (rate.count > limit) throw new QueueError('RATE_LIMIT', 'Too many requests', 429);
  };
  const handler: http.RequestListener = async (req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    let status = 200,
      result: unknown;
    try {
      if (options.isStopping?.()) throw new QueueError('STOPPING', 'خادم الفرع يتوقف.', 503);
      if (req.headers.origin)
        throw new QueueError('ORIGIN', 'Browser access is not supported', 403);
      const address = req.socket.remoteAddress ?? 'unknown';
      // Branch PCs may share one NAT address; normal polling is limited per device.
      rateLimit('ip:' + address, 6000);
      const url = new URL(req.url ?? '/', 'http://branch.local');
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /healthz') {
        await store.db.query('SELECT 1');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, version: queueVersion }));
        return;
      }
      const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) throw new QueueError('AUTH', 'Device key required', 401);
      const actor = await store.authenticate(token);
      rateLimit('device:' + actor.id, 180);
      switch (route) {
        case 'GET /v1/update-release': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          if (!options.operations)
            throw new QueueError('UPDATE_SOURCE', 'ربط تحديثات المركز غير مهيأ.', 503);
          result = await proxyRelease(options.operations, store.branchId);
          break;
        }
        case 'POST /v1/update-release/download': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          if (!options.operations)
            throw new QueueError('UPDATE_SOURCE', 'ربط تحديثات المركز غير مهيأ.', 503);
          const input = updateDownloadSchema.parse(await body(req));
          const upstream = (await proxyRelease(
            options.operations,
            store.branchId,
            input,
          )) as Response;
          const reader = upstream.body?.getReader();
          if (!reader) throw new QueueError('UPDATE_SOURCE', 'Empty installer', 503);
          res.setHeader('content-type', 'application/octet-stream');
          res.writeHead(200);
          try {
            let bytes = 0;
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.length;
              if (bytes > 512 * 1024 * 1024 || res.destroyed)
                throw new Error('Update stream ended');
              if (!res.write(Buffer.from(value)))
                await new Promise<void>((resolve, reject) => {
                  const cleanup = () => {
                    res.off('drain', ready);
                    res.off('close', closed);
                  };
                  const ready = () => {
                    cleanup();
                    resolve();
                  };
                  const closed = () => {
                    cleanup();
                    reject(new Error('Client disconnected'));
                  };
                  res.once('drain', ready);
                  res.once('close', closed);
                });
            }
            res.end();
          } catch {
            res.destroy();
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          return;
        }
        case 'GET /v1/speech/status':
          if (actor.role === 'kiosk')
            throw new QueueError('FORBIDDEN', 'Display or staff required', 403);
          result = options.speech?.status() ?? { configured: false, cachedOnly: false };
          break;
        case 'POST /v1/speech': {
          if (actor.role === 'kiosk')
            throw new QueueError('FORBIDDEN', 'Display or staff required', 403);
          if (!options.speech)
            throw new QueueError('SPEECH_DISABLED', 'الصوت الطبيعي غير مهيأ على خادم الفرع.', 503);
          const input = speechRequestSchema.parse(await body(req));
          const snapshot = await store.snapshot(actor);
          const call =
            'sequence' in input
              ? snapshot.announcements.find(
                  a =>
                    a.sequence === input.sequence &&
                    (!actor.counterId || a.counterId === actor.counterId) &&
                    snapshot.active.some(t => t.id === a.ticketId && t.counterId === a.counterId) &&
                    Date.parse(snapshot.serverTime) - Date.parse(a.occurredAt) < 30000,
                )
              : undefined;
          if ('sequence' in input && !call)
            throw new QueueError('SPEECH_STALE', 'النداء لم يعد نشطًا.', 409);
          const text = call ? announcementText(call) : speechTestText;
          result = call
            ? await options.speech.callAudio(call, Date.parse(call.occurredAt) + 30000)
            : await options.speech.audio(text);
          if (call) {
            // Do not deliver speech after a transfer/completion during synthesis.
            const current = await store.snapshot(actor);
            if (
              !current.active.some(t => t.id === call.ticketId && t.counterId === call.counterId) ||
              Date.parse(current.serverTime) - Date.parse(call.occurredAt) >= 30000
            )
              throw new QueueError('SPEECH_STALE', 'النداء لم يعد نشطًا.', 409);
          }
          break;
        }
        case 'GET /v1/snapshot':
          result = await store.snapshot(
            actor,
            options.operations?.syncConfigured() ?? options.syncConfigured,
          );
          break;
        case 'POST /v1/commands':
          result = await store.command(actor, await body(req));
          break;
        case 'PUT /v1/configuration':
          await store.configure(actor, await body(req));
          result = { ok: true };
          break;
        case 'POST /v1/devices': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          const input = z
            .object({
              role: roleSchema,
              counterId: id.nullable(),
              name: z.string().trim().min(1).max(80).optional(),
              staffRef: z.string().trim().min(1).max(80).optional(),
            })
            .strict()
            .parse(await body(req));
          result = await store.provision(input.role, input.counterId, input, actor);
          break;
        }
        case 'GET /v1/devices':
          result = await store.devices(actor);
          break;
        case 'GET /v1/journey':
          result = await ticketJourney(
            store,
            actor,
            url.searchParams.get('code') ?? '',
            url.searchParams.get('day') ?? '',
          );
          break;
        case 'POST /v1/devices/revoke':
          await store.revoke(actor, id.parse((await body(req)).id));
          result = { ok: true };
          break;
        case 'GET /v1/analytics':
          result = await branchAnalytics(
            store,
            actor,
            url.searchParams.get('from') ?? '',
            url.searchParams.get('to') ?? '',
            url.searchParams.has('slaSeconds')
              ? Number(url.searchParams.get('slaSeconds'))
              : undefined,
          );
          break;
        case 'GET /v1/operations':
        case 'PUT /v1/operations':
        case 'POST /v1/operations': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          if (!options.operations)
            throw new QueueError(
              'OPERATIONS_DISABLED',
              'حدّث خادم الفرع لتفعيل أدوات التشغيل.',
              503,
            );
          if (req.method === 'PUT') {
            await options.operations.save(await body(req));
            result = await options.operations.status();
          } else if (req.method === 'POST')
            result = await options.operations.run(actor, await body(req));
          else result = await options.operations.status();
          break;
        }
        case 'POST /v1/maintenance/start': {
          z.object({})
            .strict()
            .parse(await body(req));
          result = await store.enterMaintenance(actor);
          break;
        }
        case 'POST /v1/maintenance/end': {
          const input = z
            .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
            .strict()
            .parse(await body(req));
          await store.leaveMaintenance(actor, input.token);
          result = { ok: true };
          break;
        }
        case 'POST /v1/shutdown': {
          const input = z
            .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
            .strict()
            .parse(await body(req));
          await store.validateMaintenance(actor, input.token);
          if (!options.shutdown)
            throw new QueueError('SHUTDOWN_DISABLED', 'إيقاف الخادم غير متاح في هذا التشغيل.', 503);
          result = { ok: true };
          setTimeout(() => void options.shutdown!(), 250);
          break;
        }
        case 'GET /v1/health':
          result = { ok: true, branchId: store.branchId };
          break;
        case 'GET /v1/status': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          const snapshot = await store.snapshot(
            actor,
            options.operations?.syncConfigured() ?? options.syncConfigured,
          );
          const meta = (
            await store.db.query<{ last_backup: unknown; enabled_devices: number }>(
              'SELECT last_backup,(SELECT count(*)::int FROM queue_devices WHERE enabled) AS enabled_devices FROM queue_meta',
            )
          ).rows[0];
          result = {
            version: queueVersion,
            branchId: store.branchId,
            serverTime: snapshot.serverTime,
            uptimeSeconds: Math.floor(process.uptime()),
            databaseReady: store.db.ready,
            maintenanceUntil: store.maintenanceUntil(),
            revision: snapshot.revision,
            sync: snapshot.sync,
            enabledDevices: meta.enabled_devices,
            backupsConfigured: !!options.backupDirectory,
            reportsConfigured:
              options.operations?.reportsConfigured() ?? !!options.reportsConfigured,
            lastBackup: meta.last_backup,
          };
          break;
        }
        case 'POST /v1/backups': {
          if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
          if (!options.backupDirectory)
            throw new QueueError(
              'BACKUPS_DISABLED',
              'Configure a private backup directory on the host first',
            );
          z.object({})
            .strict()
            .parse(await body(req));
          result = await createBackup(store, options.backupDirectory);
          await store.db.query('UPDATE queue_meta SET last_backup=$1', [JSON.stringify(result)]);
          break;
        }
        default:
          throw new QueueError('NOT_FOUND', 'Route unavailable', 404);
      }
    } catch (error) {
      if (error instanceof QueueError) {
        status = error.status;
        result = { error: { code: error.code, message: error.message } };
      } else if (error instanceof Error && error.name === 'ZodError') {
        status = 400;
        result = { error: { code: 'VALIDATION', message: 'Invalid request' } };
      } else {
        status = 500;
        result = { error: { code: 'INTERNAL', message: 'Operation failed' } };
      }
    }
    res.writeHead(status);
    res.end(JSON.stringify(result));
  };
  const server =
    options.cert && options.key
      ? https.createServer(
          { cert: readFileSync(options.cert), key: readFileSync(options.key) },
          handler,
        )
      : http.createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxConnections = 100;
  return server;
}
