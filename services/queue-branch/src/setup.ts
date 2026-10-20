import { open, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { id, roleSchema } from '@saraf/queue-core';
import { QueueStore } from './store';

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    branch: { type: 'string' },
    output: { type: 'string' },
    role: { type: 'string', default: 'manager' },
    counter: { type: 'string' },
  },
});
if (!values.directory || !values.output)
  throw new Error('Supply --directory, --branch and --output (new private pairing file)');
const branchId = id.parse(values.branch);
const output = await open(values.output, 'wx', 0o600);
let store: QueueStore | undefined,
  saved = false;
try {
  store = await QueueStore.open(values.directory, branchId);
  const actor = await store.provision(
    roleSchema.parse(values.role ?? 'manager'),
    values.counter ? id.parse(values.counter) : null,
  );
  await output.writeFile(
    JSON.stringify({ branchId, url: 'http://127.0.0.1:4318', ...actor }, null, 2),
  );
  saved = true;
  console.log('Device provisioned; pairing details saved to the requested private file.');
} finally {
  await output.close();
  if (!saved) await unlink(values.output);
  await store?.close();
}
