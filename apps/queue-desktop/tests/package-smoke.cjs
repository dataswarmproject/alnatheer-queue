const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const appRoot = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'saraf-queue-package-test-'));
  const data = path.join(directory, 'data'),
    pairing = path.join(directory, 'manager.queue-pairing.json'),
    branchId = crypto.randomUUID();
  const root = path.join(appRoot, 'release/win-unpacked'),
    exe = path.join(root, 'Alnatheer Queue.exe'),
    resources = path.join(root, 'resources/branch');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  let host;
  try {
    const voiceRoot = path.join(resources, 'voice-library-free');
    const voiceProfile = JSON.parse(
      await fs.readFile(path.join(voiceRoot, 'speech-cache/voice-library.json'), 'utf8'),
    );
    assert.equal(voiceProfile.complete, true);
    assert.equal(voiceProfile.recordings, 1010);
    assert.equal(voiceProfile.model, 'chatterbox_multilingual_v3');
    await fs.cp(path.join(voiceRoot, 'speech-cache'), path.join(directory, 'speech-cache'), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await promisify(execFile)(
      exe,
      [
        path.join(resources, 'setup.js'),
        '--directory',
        data,
        '--branch',
        branchId,
        '--output',
        pairing,
      ],
      { env, windowsHide: true },
    );
    const manager = JSON.parse(await fs.readFile(pairing, 'utf8'));
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    host = spawn(exe, [path.join(resources, 'main.js')], {
      env: {
        ...env,
        QUEUE_BRANCH_ID: branchId,
        QUEUE_DATA_DIR: data,
        QUEUE_LISTEN_HOST: '127.0.0.1',
        QUEUE_LISTEN_PORT: String(port),
        QUEUE_SYNC_URL: '',
        QUEUE_SYNC_KEY: '',
        QUEUE_REPORT_DIR: '',
        QUEUE_BACKUP_DIR: path.join(directory, 'backups'),
        QUEUE_SPEECH_CACHE_DIR: path.join(directory, 'speech-cache'),
        QUEUE_SPEECH_API_KEY: '',
        QUEUE_SPEECH_VOICE_ID: '',
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    let snapshot;
    for (let i = 0; i < 120; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v1/snapshot`, {
          headers: { authorization: `Bearer ${manager.token}` },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          snapshot = await response.json();
          break;
        }
      } catch {}
      if (host.exitCode !== null) throw new Error('Packaged host exited before readiness');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(snapshot, 'Packaged host started');
    assert.equal(snapshot.branchId, branchId);
    assert.equal(snapshot.totals.waiting, 0);
    assert.equal(snapshot.totals.completed, 0);
    assert.equal(snapshot.services.length, 0);
    assert.equal(snapshot.actor.role, 'manager');
    const headers = {
      authorization: `Bearer ${manager.token}`,
      'content-type': 'application/json',
    };
    const voiceStatus = await (
      await fetch(`http://127.0.0.1:${port}/v1/speech/status`, { headers })
    ).json();
    assert.equal(voiceStatus.configured, true);
    assert.equal(voiceStatus.cachedOnly, true);
    const audioResponse = await fetch(`http://127.0.0.1:${port}/v1/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ test: true }),
    });
    assert.equal(audioResponse.status, 200);
    const audio = await audioResponse.json();
    assert.equal(audio.cached, true);
    assert.ok(Buffer.from(audio.audio, 'base64').length > 10000);
    for (const filename of ['queue-restore.cmd', 'restore.js', 'queue-start.cmd.example'])
      await fs.access(path.join(resources, filename));
    const backupResponse = await fetch(`http://127.0.0.1:${port}/v1/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${manager.token}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(backupResponse.status, 200);
    const backup = await backupResponse.json();
    assert.ok(backup.sizeBytes > 0);
    const target = path.join(directory, 'restored');
    await promisify(execFile)(
      exe,
      [
        path.join(resources, 'restore.js'),
        '--archive',
        path.join(directory, 'backups', backup.filename),
        '--directory',
        target,
        '--branch',
        branchId,
      ],
      { env, windowsHide: true },
    );
    await fs.access(path.join(data, 'PG_VERSION'));
    await fs.access(path.join(target, 'PG_VERSION'));
    console.log(
      'Packaged Windows runtime passed: free Arabic bundle, cache-only authenticated audio without a key, private initial provisioning, independent persistent database, real backup and bundled restore into a new directory, no seeded tickets or services.',
    );
  } finally {
    if (host && host.exitCode === null) {
      const ended = new Promise(resolve => host.once('exit', resolve));
      host.kill();
      await ended;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-package-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
