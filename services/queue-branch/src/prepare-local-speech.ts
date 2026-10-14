import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planLocalSpeech } from './local-speech-plan';

const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    output: { type: 'string' },
    execute: { type: 'boolean', default: false },
    python: { type: 'string' },
    models: { type: 'string' },
    'samples-only': { type: 'boolean', default: false },
    'max-new-clips': { type: 'string' },
  },
});
if (!values.plan || !values.output) throw new Error('Supply --plan and --output');
if ((await stat(values.plan)).size > 131072) throw new Error('Plan too large');
const manifest = planLocalSpeech(JSON.parse(await readFile(values.plan, 'utf8')));
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
const file = path.join(output, 'manifest.json');
await writeFile(file, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    totalClips: manifest.totalClips,
    combinations: manifest.combinations,
    samples: manifest.samples.length,
    execute: values.execute,
    paidProvider: false,
    output,
  }),
);
if (values.execute) {
  const limit = Number(values['max-new-clips']);
  if (!values.python || !values.models || !Number.isInteger(limit) || limit < 1 || limit > 10100)
    throw new Error('Supply --python, --models and an explicit --max-new-clips limit');
  // This worker only opens the output/audio model files; it never opens a branch database.
  const worker = fileURLToPath(new URL('../local-voice/generate.py', import.meta.url));
  const child = spawn(
    path.resolve(values.python),
    [
      worker,
      '--manifest',
      file,
      '--models',
      path.resolve(values.models),
      '--output',
      output,
      '--max-new-clips',
      String(limit),
      ...(values['samples-only'] ? ['--samples-only'] : []),
    ],
    { windowsHide: true, stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } },
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}
