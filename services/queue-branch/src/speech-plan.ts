import { z } from 'zod';
import { announcementText, announcementParts } from '@saraf/queue-core/speech';
export const speechPlanSchema = z
  .object({
    prefixes: z
      .array(z.string().regex(/^[A-Z]{1,3}$/))
      .min(1)
      .max(20),
    counters: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
    start: z.number().int().min(1).max(9999),
    end: z.number().int().min(1).max(9999),
    mode: z.enum(['full', 'split']).default('full'),
  })
  .strict();
export function planSpeech(input: unknown) {
  const plan = speechPlanSchema.parse(input);
  const count =
    (plan.end - plan.start + 1) * new Set(plan.prefixes).size * new Set(plan.counters).size;
  const clipCount =
    plan.mode === 'split'
      ? (plan.end - plan.start + 1) * new Set(plan.prefixes).size + new Set(plan.counters).size
      : count;
  if (plan.end < plan.start || clipCount > 10000)
    throw new Error('Use an ordered range and at most 10000 recordings per plan');
  const clips = new Map<string, { code: string; counterName: string; text: string }>();
  if (plan.mode === 'split') {
    for (const prefix of new Set(plan.prefixes))
      for (let number = plan.start; number <= plan.end; number++) {
        const code = `${prefix}-${number}`,
          text = announcementParts({ code, counterName: plan.counters[0] })[0];
        clips.set(text, { code, counterName: '', text });
      }
    for (const counterName of new Set(plan.counters)) {
      const text = announcementParts({ code: `${plan.prefixes[0]}-1`, counterName })[1];
      clips.set(text, { code: 'DESTINATION', counterName, text });
    }
    return [...clips.values()];
  }
  for (const prefix of new Set(plan.prefixes))
    for (let number = plan.start; number <= plan.end; number++)
      for (const counterName of new Set(plan.counters)) {
        const code = `${prefix}-${number}`,
          text = announcementText({ code, counterName });
        clips.set(text, { code, counterName, text });
      }
  return [...clips.values()];
}
