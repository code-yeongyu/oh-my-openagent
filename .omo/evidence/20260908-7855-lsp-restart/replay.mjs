// Run inside a disposable Linux container with this PR mounted at /repo.
// Only the provider is scripted; OpenCode, MCP proxy and daemon are real.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createConnection, createServer as socketServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(process.argv[2] ?? "/repo");
const cli = join(repo, "packages/lsp-daemon/dist/cli.js");
assert(existsSync(cli), "Build the PR daemon first");
const root = mkdtempSync(join(tmpdir(), "pr7855-"));
const project = join(root, "project");
const home = join(root, "home");
const version = JSON.parse(readFileSync(join(repo, "packages/lsp-daemon/package.json"))).version;
const daemonRoot = join(root, "daemon");
const dir = join(daemonRoot, `v${version}`);
const endpoint = join(dir, "daemon.sock");
const ownerPath = join(dir, "daemon.owner");
const authPath = join(dir, "daemon.auth");
for (const path of [project, home, dir, ...["data", "config", "cache", "state"].map(x => join(root, x))]) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
const env = {
  PATH: process.env.PATH, HOME: home, TMPDIR: root,
  XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config"),
  XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
  OPENCODE_TEST_HOME: home, OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1",
  OMO_DISABLE_POSTHOG: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OMO_LSP_DAEMON_DIR: daemonRoot, OMO_LSP_DAEMON_CLI: cli, OMO_LSP_DAEMON_VERSION: version,
  LSP_TOOLS_MCP_PROJECT_CONFIG: join(project, "lsp.json"),
  LSP_TOOLS_MCP_USER_CONFIG: join(home, "lsp.json"),
  LSP_TOOLS_MCP_INSTALL_DECISIONS: join(home, "install-decisions.json"),
};
const deadline = (label, ms = 60000) => AbortSignal.timeout(ms);
function waitEvent(emitter, event, label, ms = 60000) {
  return once(emitter, event, { signal: deadline(label, ms) });
}
function rpc(params, method = "omo/ping") {
  return new Promise((resolveResult, reject) => {
    const socket = createConnection(endpoint);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("IPC response timeout")); }, 10000);
    let data = "";
    socket.once("error", error => { clearTimeout(timer); reject(error); });
    socket.once("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n"));
    socket.on("data", chunk => {
      data += chunk;
      if (!data.includes("\n")) return;
      clearTimeout(timer);
      socket.destroy();
      try { resolveResult(JSON.parse(data.split("\n")[0])); } catch (error) { reject(error); }
    });
  });
}
let server;
let model;
let replacement;
let selectedTool;
let modelCalls = 0;
const result = {
  sourceHead: "da130a5550e78c2181f412fb7373e4c1ba2e8d4b",
  capturedAt: new Date().toISOString(),
  node: process.version,
  bun: execFileSync("bun", ["--version"], { env }).toString().trim(),
  opencode: execFileSync("opencode", ["--version"], { env }).toString().trim(),
  runtime: "packages/lsp-daemon/dist/cli.js",
  runtimeSha256: createHash("sha256").update(readFileSync(cli)).digest("hex"),
  isolation: { home: "<sandbox>/home", xdg: "<sandbox>/{data,config,cache,state}", daemon: "<sandbox>/daemon", hostMounts: "repository-only" },
};
try {
  // This child exits naturally: the fixture PID is verified dead, never guessed.
  const dead = spawn(process.execPath, ["-e", ""], { env, stdio: "ignore" });
  const deadExit = waitEvent(dead, "exit", "fixture process exit");
  assert.equal((await deadExit)[0], 0);
  assert.throws(() => process.kill(dead.pid, 0), { code: "ESRCH" });
  const fixtureSocket = socketServer();
  const listening = waitEvent(fixtureSocket, "listening", "fixture socket");
  fixtureSocket.listen(endpoint);
  await listening;
  const { dev, ino } = statSync(endpoint);
  const closed = waitEvent(fixtureSocket, "close", "fixture socket close");
  fixtureSocket.close();
  await closed;
  assert.equal(existsSync(endpoint), false);
  const staleToken = randomBytes(32).toString("hex");
  const stale = { pid: dead.pid, nonce: randomUUID(), startedAt: new Date(0).toISOString(), endpoint: { kind: "unix", path: endpoint, dev, ino } };
  for (const [name, text] of [["daemon.owner", JSON.stringify(stale)], ["daemon.pid", String(dead.pid)], ["daemon.endpoint", endpoint], ["daemon.auth", staleToken]]) {
    writeFileSync(join(dir, name), text, { mode: 0o600 });
  }
  await assert.rejects(rpc({ _omo: { protocolVersion: 1, token: staleToken } }), { code: "ENOENT" });
  result.before = { pid: dead.pid, nonce: stale.nonce, pidDead: true, persistedEndpointKind: "unix", endpointAbsent: true, authenticatedPingError: "ENOENT" };

  // The provider selects the actual tool name advertised by OpenCode, not a stub.
  model = httpServer(async (request, response) => {
    try {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const tools = (body.tools ?? []).map(tool => tool.name ?? tool.function?.name);
      const name = tools.find(name => name?.endsWith("lsp_status"));
      const input = JSON.stringify(body.input ?? []);
      const toolResult = input.includes('"type":"function_call_output"');
      const call = ++modelCalls;
      const id = `resp_${call}`;
      const item = `item_${call}`;
      const tool = name && !toolResult && input.includes("PR7855_RESTART");
      if (tool) selectedTool = name;
      const output = tool
        ? { type: "function_call", id: item, call_id: `call_${call}`, name, arguments: "{}" }
        : { type: "message", id: item, role: "assistant", content: [{ type: "output_text", text: "Restart probe complete." }] };
      const events = [
        { type: "response.created", response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" } },
        { type: "response.output_item.added", output_index: 0, item: tool ? { ...output, arguments: "" } : { type: "message", id: item } },
        tool ? { type: "response.function_call_arguments.delta", item_id: item, output_index: 0, delta: "{}" }
          : { type: "response.output_text.delta", item_id: item, output_index: 0, delta: "Restart probe complete." },
        { type: "response.output_item.done", output_index: 0, item: { ...output, status: "completed" } },
        { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  const modelReady = waitEvent(model, "listening", "local provider");
  model.listen(0, "127.0.0.1");
  await modelReady;
  const config = {
    model: "openai/gpt-fake", permission: "allow", plugin: [],
    provider: { openai: { options: { apiKey: "local-fixture", baseURL: `http://127.0.0.1:${model.address().port}/v1` }, models: { "gpt-fake": { tool_call: true, limit: { context: 200000, output: 8192 } } } } },
    mcp: { lsp: { type: "local", command: [process.execPath, cli, "mcp"], environment: env } },
  };
  const configPath = join(root, "opencode.json");
  writeFileSync(configPath, JSON.stringify(config));
  const password = randomBytes(24).toString("hex");
  const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project, env: { ...env, OPENCODE_CONFIG: configPath, OPENCODE_SERVER_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolveUrl, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("OpenCode did not report listening")), 60000);
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`OpenCode exited ${code}`)); });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => {
      output += chunk;
      const match = output.match(/opencode server listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveUrl(match[1]); }
    });
  });
  async function api(path, body) {
    const response = await fetch(url + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: deadline(path, 90000) });
    assert(response.ok, `${path}: HTTP ${response.status}`);
    return response.json();
  }
  result.health = await api("/global/health");
  const session = await api("/session", { title: "PR 7855 isolated restart" });
  // The synchronous prompt response is the exact turn-completion signal.
  await api(`/session/${session.id}/message`, { model: { providerID: "openai", modelID: "gpt-fake" }, parts: [{ type: "text", text: "PR7855_RESTART: invoke the LSP status tool once." }] });
  const messages = await api(`/session/${session.id}/message`);
  const tool = messages.flatMap(message => message.parts ?? []).find(part => part.type === "tool" && part.tool === selectedTool);
  assert(tool, "OpenCode did not invoke the advertised LSP tool");
  assert.equal(tool.state.status, "completed");
  assert(tool.state.output.length > 0);
  replacement = JSON.parse(readFileSync(ownerPath));
  assert.notEqual(replacement.pid, stale.pid);
  assert.notEqual(replacement.nonce, stale.nonce);
  process.kill(replacement.pid, 0);
  assert(statSync(endpoint).isSocket());
  const token = readFileSync(authPath, "utf8").trim();
  assert.notEqual(token, staleToken);
  const ping = await rpc({ _omo: { protocolVersion: 1, token } });
  assert.equal(ping.result.pid, replacement.pid);
  assert.equal(ping.result.nonce, replacement.nonce);
  const rejected = await rpc({ _omo: { protocolVersion: 1, token: staleToken } });
  assert.equal(rejected.error.data.code, "daemon_authentication_failed");
  const context = {
    cwd: project, projectConfigPaths: [env.LSP_TOOLS_MCP_PROJECT_CONFIG],
    userConfigPath: env.LSP_TOOLS_MCP_USER_CONFIG,
    installDecisionsPath: env.LSP_TOOLS_MCP_INSTALL_DECISIONS,
    capabilities: { installDecisionTool: true },
  };
  const call = await rpc({ name: "lsp_status", arguments: { _context: context }, _omo: { protocolVersion: 1, token } }, "tools/call");
  assert.equal(call.error, undefined);
  assert.equal(Boolean(call.result.isError), false);
  assert(call.result.content.length > 0);
  result.after = { pid: replacement.pid, nonce: replacement.nonce, pidAlive: true, endpointSocket: true, authRotated: true, authenticatedPingMatchesOwner: true, staleAuthRejected: true, authenticatedToolCallSucceeded: true };
  result.harness = { surface: "OpenCode serve HTTP prompt -> lsp MCP stdio proxy -> authenticated daemon", tool: selectedTool, status: tool.state.status, output: tool.state.output, modelCalls, externalModelCalls: 0 };
  result.isolation.sandboxSessions = Number(execFileSync("sqlite3", [join(root, "data/opencode/opencode.db"), "select count(*) from session"]).toString().trim());
  const serialized = JSON.stringify(result);
  for (const secret of [token, staleToken, password, auth]) assert(!serialized.includes(secret), "Secret in public capture");
} finally {
  if (server && server.exitCode === null) {
    const stopped = waitEvent(server, "exit", "OpenCode exit", 15000);
    server.kill("SIGTERM");
    await stopped;
  }
  if (existsSync(ownerPath)) {
    const current = JSON.parse(readFileSync(ownerPath));
    // Only terminate the daemon spawned under this task's private root.
    assert(current.pid !== result.before?.pid);
    if (replacement) assert.equal(current.nonce, replacement.nonce);
    const watcher = watch(dir);
    const removed = new Promise((resolveRemoved, reject) => {
      const timer = setTimeout(() => reject(new Error("Owned daemon metadata remained")), 15000);
      watcher.on("change", () => { if (!existsSync(ownerPath)) { clearTimeout(timer); resolveRemoved(); } });
    });
    process.kill(current.pid, "SIGTERM");
    try { await removed; } finally { watcher.close(); }
  }
  if (model) { const stopped = waitEvent(model, "close", "provider exit"); model.closeAllConnections(); model.close(); await stopped; }
  result.cleanup = { opencodeExited: !server || server.exitCode !== null || server.signalCode !== null, daemonMetadataRemoved: !existsSync(ownerPath), providerClosed: true };
  rmSync(root, { recursive: true, force: true });
  result.cleanup.sandboxRemoved = !existsSync(root);
}
result.result = "PASS";
console.log(JSON.stringify(result, null, 2).replaceAll(root, "<sandbox>").replaceAll(repo, "<repo>"));
