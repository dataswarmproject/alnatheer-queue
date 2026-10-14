import { defineConfig } from 'vitest/config';
// Each integration worker boots a real PostgreSQL WASM instance. Bound parallel
// initialization so backup/recovery checks remain reliable on branch-class PCs.
export default defineConfig({ test: { maxWorkers: 2 } });
