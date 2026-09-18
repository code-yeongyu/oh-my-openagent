import { mkdirSync, writeFileSync, readFileSync, existsSync, watch } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

const root = "/qa/migration";
const project = `${root}/home/project`;
const evidence = "/evidence";
for (const dir of ["home", "config", "data", "state", "cache", "tmp", "home/project/.omo", "home/project/.opencode"]) mkdirSync(`${root}/${dir}`, { recursive: true });
const env = {
  PATH: "/usr/local/bin:/usr/bin:/bin", HOME: `${root}/home`, OPENCODE_TEST_HOME: `${root}/home`,
  XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`,
  XDG_STATE_HOME: `${root}/state`, XDG_CACHE_HOME: `${root}/cache`, TMPDIR: `${root}/tmp`,
  OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
  OMO_DISABLE_POSTHOG: "1", OMO_DISABLE_PROCESS_CLEANUP: "1",
};
const target = `${project}/.omo/omo.jsonc`;
const legacy = `${project}/.opencode/oh-my-opencode.json`;
const fixtures = {
  legacy: { disabled_providers: ["qa-legacy-provider"], model_fallback: true },
  unified: { "[opencode]": {
    disabled_providers: ["qa-kept-provider"], model_fallback: false, telemetry: false,
    disabled_mcps: ["websearch", "context7", "grep_app", "lsp"],
    disabled_skills: ["security-research", "security-review"],
  } },
  opencode: { plugin: ["file:///plugin/dist/index.js"] },
};
assert.equal("_migrations" in fixtures.unified, false);
writeFileSync(legacy, JSON.stringify(fixtures.legacy));
writeFileSync(target, JSON.stringify(fixtures.unified));
writeFileSync(`${project}/opencode.jsonc`, JSON.stringify(fixtures.opencode));
writeFileSync(`${evidence}/fixtures.json`, JSON.stringify(fixtures, null, 2));
const bounded = async (promise, label, timeout = 60000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeout); })]); }
  finally { clearTimeout(timer); }
};
const logPath = `${root}/tmp/oh-my-opencode.log`;
const marker = "[config-migration] startup completed ";
let resolveReceipt;
const receipt = new Promise(resolve => { resolveReceipt = resolve; });
const inspectLog = () => {
  if (!existsSync(logPath)) return;
  const line = readFileSync(logPath, "utf8").split("\n").find(line => line.includes(marker));
  if (line) resolveReceipt(line);
};
// Register the filesystem receipt subscription before triggering the factory.
const watcher = watch(`${root}/tmp`, inspectLog);
const child = spawn("/qa/runtime/node_modules/.bin/opencode", ["serve", "--hostname", "127.0.0.1", "--port", "49256", "--print-logs"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
const exit = once(child, "exit");
let stdout = "", stderr = "", wire = "";
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
child.once("error", rejectReady);
child.stdout.on("data", data => { stdout += data; const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) resolveReady(url); });
child.stderr.on("data", data => { stderr += data; });
const abort = new AbortController();
let pump;
const report = { surface: "real OpenCode 1.18.30; sole built default plugin; global SSE before GET /config", environment: env, passed: false };
try {
  const url = await bounded(ready, "server listening");
  report.health = await fetch(`${url}/global/health`).then(r => r.json());
  let resolveConnected, resolveToast;
  const connected = new Promise(resolve => { resolveConnected = resolve; });
  const toast = new Promise(resolve => { resolveToast = resolve; });
  const response = await fetch(`${url}/global/event`, { signal: abort.signal });
  assert.equal(response.status, 200);
  const events = [];
  pump = (async () => {
    let pending = "";
    for await (const chunk of response.body) {
      const text = new TextDecoder().decode(chunk); wire += text; pending += text;
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const envelope = JSON.parse(line.slice(6)); const event = envelope.payload ?? envelope;
          events.push(event);
          if (event.type === "server.connected") resolveConnected(event);
          if (event.type === "tui.toast.show" && event.properties?.title === "Configuration migrated") resolveToast(event);
        }
      }
    }
  })();
  await bounded(connected, "server.connected");
  report.subscribedBeforeConfig = true;
  const configResponse = await fetch(`${url}/config?directory=${encodeURIComponent(project)}`, { signal: AbortSignal.timeout(60000) });
  const config = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.deepEqual(config.plugin, ["file:///plugin/dist/index.js"]);
  const agentNames = Object.keys(config.agent ?? {});
  assert.ok(agentNames.some(name => name.startsWith("Sisyphus")), "actual plugin config hook must populate agents");
  writeFileSync(`${evidence}/config-summary.json`, JSON.stringify({ status: configResponse.status, plugin: config.plugin, agentNames }, null, 2));
  await bounded(toast, "migration toast");
  inspectLog();
  const line = await bounded(receipt, "production startup-completed log receipt");
  writeFileSync(`${evidence}/startup-completed.log`, `${line}\n`);
  const payload = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  assert.equal(payload.error, undefined);
  assert.equal(payload.skippedConflictCount, 2);
  assert.deepEqual(payload.skippedConflictPaths, ["[opencode].disabled_providers", "[opencode].model_fallback"]);
  for (const value of ["qa-legacy-provider", "qa-kept-provider", "legacy=", "kept="]) assert.equal(line.includes(value), false);
  assert.deepEqual(Object.keys(payload).sort(), ["journalResumed", "migratedFrom", "skippedConflictCount", "skippedConflictPaths"].sort());
  const after = JSON.parse(readFileSync(target, "utf8"));
  assert.deepEqual(after["[opencode]"].disabled_providers, ["qa-kept-provider"]);
  assert.equal(after["[opencode]"].model_fallback, false);
  assert.ok(after._migrations);
  report.payload = payload;
  report.markerAfter = after._migrations;
  report.eventTypes = events.map(e => e.type);
  report.targetValuesPreserved = true;
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  watcher.close(); abort.abort();
  if (pump) await pump.catch(error => { if (error.name !== "AbortError") throw error; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  child.kill("SIGTERM");
  const [code, signal] = await exit; clearTimeout(timer);
  report.exit = { code, signal };
  writeFileSync(`${evidence}/server-stdout.raw.txt`, stdout);
  writeFileSync(`${evidence}/server-stderr.raw.txt`, stderr);
  writeFileSync(`${evidence}/events.sse`, wire);
  const count = spawnSync("sqlite3", ["-readonly", `${root}/data/opencode/opencode.db`, "SELECT count(*) FROM session"], { encoding: "utf8" });
  report.isolatedDbCount = count.stdout.trim();
  writeFileSync(`${evidence}/live-report.json`, JSON.stringify(report, null, 2));
  assert.equal(count.status, 0, count.stderr);
  assert.equal(count.stdout.trim(), "0");
}
console.log(JSON.stringify(report, null, 2));
