#!/usr/bin/env node
// Real OpenCode Case B QA; no provider, host config, sleeps, or polling.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bun = process.env.QA_BUN;
const opencode = process.env.QA_OPENCODE;
const hostDb = process.env.QA_HOST_DB;
assert(bun && opencode && hostDb, 'Set QA_BUN, QA_OPENCODE, QA_HOST_DB to absolute paths');
assert.equal(execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim(), '1.4.0');
assert.equal(process.versions.node.split('.')[0], '24');
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'tuple-qa-private-')));
mkdirSync(out, { recursive: true });
const sandbox = mkdtempSync(join(tmpdir(), 'tuple-qa-sandbox-'));
assert(!sandbox.startsWith(repo + '/'));
writeFileSync(join(out, 'sandbox-private.txt'), sandbox);
const dirs = Object.fromEntries(['home', 'data', 'config', 'cache', 'state', 'tmp', 'project', 'pinned', 'local'].map(k => [k, join(sandbox, k)]));
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
execFileSync('git', ['init', '--quiet', dirs.project]);
const env = {
  PATH: `${dirname(bun)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: dirs.home, OPENCODE_TEST_HOME: dirs.home, TMPDIR: dirs.tmp,
  XDG_DATA_HOME: dirs.data, XDG_CONFIG_HOME: dirs.config,
  XDG_CACHE_HOME: dirs.cache, XDG_STATE_HOME: dirs.state,
  OPENCODE_CONFIG_DIR: join(dirs.config, 'opencode'),
  OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', DO_NOT_TRACK: '1',
  OMO_SEND_ANONYMOUS_TELEMETRY: '0', OMO_DISABLE_POSTHOG: '1',
  QA_PINNED: dirs.pinned, QA_LOCAL: dirs.local,
  PROBE_OUT: join(sandbox, 'decision.json'),
};
mkdirSync(env.OPENCODE_CONFIG_DIR, { recursive: true });
const count = db => Number(execFileSync('sqlite3', ['-readonly', db, 'SELECT count(*) FROM session'], { encoding: 'utf8' }).trim());
const before = count(hostDb);
const version = execFileSync(opencode, ['--version'], { env, cwd: dirs.project, encoding: 'utf8' }).trim();
const helpResult = spawnSync(opencode, ['serve', '--help'], { env, cwd: dirs.project, encoding: 'utf8' });
assert.equal(helpResult.status, 0);
const help = helpResult.stdout + helpResult.stderr;
assert(help.includes('--port') && help.includes('--hostname'));
writeFileSync(join(out, 'serve-help.txt'), help);
const oldProbe = join(repo, '.omo/evidence/20260906-7458-tuple-plugin-entry/probe-plugin.ts');
const probeSource = readFileSync(oldProbe, 'utf8').replaceAll('"./packages/', `"${repo}/packages/`);
const probeTs = join(sandbox, 'historical-probe.ts');
writeFileSync(probeTs, probeSource);
const entry = join(sandbox, 'entry.ts');
writeFileSync(entry, `import { OmoFixProbe } from ${JSON.stringify(probeTs)};
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
export default { id: 'tuple-refresh-probe', async server(input, options) {
  if (options.tupleMarker !== 'tuple-7458') throw new Error('tuple options lost');
  return { event: async (eventInput) => {
    if (eventInput.event.type !== 'session.created') return;
    const decisions = [];
    for (const directory of [process.env.QA_PINNED, process.env.QA_LOCAL]) {
      const probe = await OmoFixProbe({ directory });
      await probe.event(eventInput);
      decisions.push(JSON.parse(readFileSync(process.env.PROBE_OUT, 'utf8')));
    }
    writeFileSync(process.env.PROBE_OUT + '.pending', JSON.stringify({ tupleMarker: options.tupleMarker, decisions }));
    renameSync(process.env.PROBE_OUT + '.pending', process.env.PROBE_OUT + '.complete');
  }};
}};
`);
const bundle = join(sandbox, 'probe.js');
writeFileSync(join(out, 'probe-build.txt'), execFileSync(bun, ['build', entry, '--target=bun', '--format=esm', `--outfile=${bundle}`], { cwd: repo, env, encoding: 'utf8' }));
const localEntry = pathToFileURL(join(sandbox, 'oh-my-openagent', 'index.js')).href;
for (const [dir, plugins] of [
  [dirs.pinned, [['opencode-auto-resume@1.1.10', { chunkTimeoutMs: 300000 }], 'oh-my-openagent@4.19.4']],
  [dirs.local, [['unrelated-plugin', {}], [localEntry, { enabled: true }]]],
]) {
  mkdirSync(join(dir, '.opencode'));
  writeFileSync(join(dir, '.opencode/opencode.json'), JSON.stringify({ plugin: plugins }));
}
writeFileSync(join(dirs.project, 'opencode.json'), JSON.stringify({ plugin: [[pathToFileURL(bundle).href, { tupleMarker: 'tuple-7458' }]] }));
const bounded = (promise, label, ms = 60000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(timer));
};
const bus = new EventEmitter();
const controller = new AbortController();
let server, closed, watcher, streamTask;
let serverOutput = '', rawSse = '';
try {
  const ready = new Promise((resolveReady, reject) => {
    server = spawn(opencode, ['serve', '--port', '0', '--hostname', '127.0.0.1'], { env, cwd: dirs.project, stdio: ['ignore', 'pipe', 'pipe'] });
    closed = once(server, 'close');
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`server exited before readiness: ${code}`)));
    const capture = chunk => {
      serverOutput += chunk;
      const match = serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolveReady(match[0]);
    };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
  });
  const url = await bounded(ready, 'server readiness');
  const health = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).healthy, true);
  const connected = once(bus, 'server.connected');
  const created = once(bus, 'session.created');
  const response = await fetch(`${url}/event?directory=${encodeURIComponent(dirs.project)}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  streamTask = (async () => {
    let pending = '';
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body) {
        const text = decoder.decode(chunk, { stream: true });
        rawSse += text;
        pending += text;
        let end;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end).trim();
          pending = pending.slice(end + 1);
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));
            bus.emit(event.type, event);
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  streamTask.catch(error => bus.emit('error', error));
  await bounded(connected, 'SSE connected');
  const decision = new Promise((resolveDecision, reject) => {
    watcher = watch(sandbox, (event, filename) => {
      if (filename !== 'decision.json.complete') return;
      try { resolveDecision(JSON.parse(readFileSync(join(sandbox, filename), 'utf8'))); }
      catch (error) { reject(error); }
    });
    watcher.on('error', reject);
  });
  const posted = await fetch(`${url}/session?directory=${encodeURIComponent(dirs.project)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
  });
  assert.equal(posted.status, 200);
  const session = await posted.json();
  const [[wire], observed] = await bounded(Promise.all([created, decision]), 'session.created and checker decision');
  assert.equal(wire.properties.sessionID ?? wire.properties.info?.id, session.id);
  assert.equal(observed.tupleMarker, 'tuple-7458');
  const [pinned, local] = observed.decisions;
  assert.equal(pinned.ok, true);
  assert.equal(pinned.findPluginEntry.entry, 'oh-my-openagent@4.19.4');
  assert.equal(pinned.findPluginEntry.isPinned, true);
  assert.equal(pinned.findPluginEntry.pinnedVersion, '4.19.4');
  assert.equal(pinned.isLocalDev, false);
  assert.equal(local.ok, true);
  assert.equal(local.findPluginEntry, null);
  assert.equal(local.isLocalDev, true);
  const isolatedDb = execFileSync(opencode, ['db', 'path'], { env, cwd: dirs.project, encoding: 'utf8' }).trim();
  assert(isolatedDb.startsWith(dirs.data + '/'));
  assert.equal(count(isolatedDb), 1);
  writeFileSync(join(out, 'decision-raw.json'), JSON.stringify(observed, null, 2));
  writeFileSync(join(out, 'result.json'), JSON.stringify({ opencode: version, bun: '1.4.0', node: process.version,
    health: true, loadedTupleOptions: observed.tupleMarker, sse: ['server.connected', wire.type],
    pinned: { entry: pinned.findPluginEntry.entry, isPinned: true, pinnedVersion: '4.19.4', isLocalDev: false },
    localTuple: { findPluginEntry: null, isLocalDev: true }, isolatedSessions: 1,
    isolatedHomeAndAllXdg: true, projectOutsideCheckout: true, childEnvironmentAllowlisted: true, before,
  }, null, 2));
} finally {
  watcher?.close();
  controller.abort();
  if (streamTask) await streamTask;
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    try { await bounded(closed, 'server shutdown', 10000); }
    catch (error) { server.kill('SIGKILL'); await closed; throw error; }
  }
  writeFileSync(join(out, 'server-raw.txt'), serverOutput);
  writeFileSync(join(out, 'sse-raw.txt'), rawSse);
  const after = count(hostDb);
  writeFileSync(join(out, 'isolation.json'), JSON.stringify({ before, after, unchanged: before === after }, null, 2));
  assert.equal(after, before, 'host DB session count changed');
}
console.log(readFileSync(join(out, 'result.json'), 'utf8'));
console.log(readFileSync(join(out, 'isolation.json'), 'utf8'));
