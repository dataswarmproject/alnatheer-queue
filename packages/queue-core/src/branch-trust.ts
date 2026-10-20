import { z } from 'zod';

// Public pairing contract. This module is safe in the sandboxed renderer.
export const branchTrustSchema = z
  .object({
    branchId: z.string().uuid(),
    ca: z.string().min(100).max(8192),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type BranchTrust = z.infer<typeof branchTrustSchema>;
