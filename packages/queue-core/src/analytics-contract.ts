import { z } from 'zod';
import { id } from './index';
const count = z.number().int().nonnegative(),
  duration = z.number().nonnegative().nullable(),
  rate = z.number().min(0).max(1).nullable();
const counts = {
  calls: count,
  recalls: count,
  transfers: count,
  noShows: count,
  completed: count,
  starts: count,
};
export const analyticsSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    timezone: z.literal('Asia/Riyadh'),
    summary: z
      .object({
        arrivals: count,
        completed: count,
        noShows: count,
        transfers: count,
        recalls: count,
        open: count,
        meanWaitSeconds: duration,
        p90WaitSeconds: duration,
        waitSampleSize: count,
        meanCallResponseSeconds: duration,
        completionRate: rate,
        noShowRate: rate,
        oldestWaitingSeconds: duration,
        slaSeconds: duration,
        slaMetRate: rate,
        overdueWaiting: count.nullable(),
      })
      .strict(),
    tellers: z
      .array(
        z
          .object({
            actorId: id,
            name: z.string().max(80),
            staffRef: z.string().max(80).nullable(),
            counter: z.string().max(80).nullable(),
            ...counts,
            serviceSeconds: z.number().nonnegative(),
            meanServiceSeconds: duration,
            p90ServiceSeconds: duration,
            sampleSize: count,
            utilization: rate,
            services: z
              .array(
                z
                  .object({
                    serviceId: id,
                    name: z.string().max(80),
                    completed: count,
                    meanServiceSeconds: duration,
                  })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .max(10000),
    counters: z
      .array(
        z
          .object({
            id,
            name: z.string().max(80),
            availableSeconds: z.number().nonnegative(),
            pausedSeconds: duration,
            unknownSeconds: z.number().nonnegative(),
            busySeconds: z.number().nonnegative(),
            utilization: rate,
            completed: count,
            coverageKnown: z.boolean(),
            archived: z.boolean().optional(),
            calls: count.optional(),
            recalls: count.optional(),
            starts: count.optional(),
            transfers: count.optional(),
            noShows: count.optional(),
            meanServiceSeconds: duration.optional(),
            p90ServiceSeconds: duration.optional(),
            sampleSize: count.optional(),
            meanWaitSeconds: duration.optional(),
            p90WaitSeconds: duration.optional(),
            waitSampleSize: count.optional(),
            services: z
              .array(
                z
                  .object({
                    id,
                    name: z.string().max(80),
                    completed: count,
                    meanServiceSeconds: duration,
                  })
                  .strict(),
              )
              .max(20)
              .optional(),
          })
          .strict(),
      )
      .max(50),
    services: z
      .array(
        z
          .object({ id, name: z.string().max(80), ...counts, meanServiceSeconds: duration })
          .strict(),
      )
      .max(20),
    hourly: z.array(z.object({ hour: z.string().max(30), arrivals: count }).strict()).max(800),
    insights: z
      .array(z.object({ title: z.string().max(128), detail: z.string().max(1000) }).strict())
      .max(20),
    coverage: z
      .object({
        partial: z.boolean(),
        events: count,
        missingLegStarts: count,
        unassignedTellers: count,
      })
      .strict(),
    definitions: z
      .object({
        wait: z.string(),
        service: z.string(),
        completion: z.string(),
        utilization: z.string(),
        attribution: z.string(),
      })
      .strict(),
  })
  .strict();
