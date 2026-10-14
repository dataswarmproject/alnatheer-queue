import { parseArgs } from 'node:util';
import { restoreBackup } from './backups';
const { values } = parseArgs({
  options: {
    archive: { type: 'string' },
    directory: { type: 'string' },
    branch: { type: 'string' },
  },
});
if (!values.archive || !values.directory || !values.branch)
  throw new Error('Supply --archive, --directory (new folder), and --branch');
await restoreBackup(values.archive, values.directory, values.branch);
console.log(
  'Queue backup verified and restored into the new folder. Existing databases were preserved.',
);
