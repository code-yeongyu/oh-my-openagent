import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const home = "/qa/home";
const codexHome = "/qa/codex";
const plugin = `${codexHome}/plugins/cache/qa/git-bash/1.0.0`;
for (const path of [home, codexHome, "/qa/project", `${plugin}/.codex-plugin`]) mkdirSync(path, { recursive: true });
cpSync("/component/dist", `${plugin}/dist`, { recursive: true });
cpSync("/component/hooks", `${plugin}/hooks`, { recursive: true });
writeFileSync(`${plugin}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(`${plugin}/.codex-plugin/plugin.json`, JSON.stringify({ name: "git-bash", version: "1.0.0", hooks: ["./hooks/hooks.json"] }));
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const shippedHooks = JSON.parse(readFileSync(`${plugin}/hooks/hooks.json`, "utf8"));
let config = `approval_policy = "never"\nsandbox_mode = "danger-full-access"\nmodel_catalog_json = "/task/model-catalog.json"\n[features]\nplugins = true\nhooks = true\nunified_exec = true\ncode_mode = true\n[plugins."git-bash@qa"]\nenabled = true\n[mcp_servers.git_bash]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["/task/mcp-fixture.mjs"]\n`;
for (const [event, label] of [["PreToolUse", "pre_tool_use"], ["PostCompact", "post_compact"]]) {
  for (const [gi, group] of shippedHooks.hooks[event].entries()) {
    for (const [hi, hook] of group.hooks.entries()) {
      const normalized = { type: "command", command: hook.command, timeout: Math.max(hook.timeout ?? 600, 1), async: false,
        ...(hook.statusMessage === undefined ? {} : { statusMessage: hook.statusMessage }) };
      const identity = { event_name: label, hooks: [normalized], ...(group.matcher === undefined ? {} : { matcher: group.matcher }) };
      const hash = createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex");
      const key = `git-bash@qa:hooks/hooks.json:${label}:${gi}:${hi}`;
      config += `\n[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = "sha256:${hash}"\n`;
    }
  }
}
writeFileSync(`${codexHome}/config.toml`, config);
const { applyGitBashPreToolUseReminder } = await import(`${plugin}/dist/codex-hook.js`);
const control = JSON.parse(applyGitBashPreToolUseReminder({
  cwd: "/qa/project", hook_event_name: "PreToolUse", model: "mock-model", permission_mode: "default",
  session_id: "control", tool_input: { command: "pwd" }, tool_name: "Bash", tool_use_id: "control",
  transcript_path: null, turn_id: "control",
}, { platform: "win32", env: {}, pluginDataRoot: "/qa/control" }));
const expectedContext = control.hookSpecificOutput.additionalContext;
const strings = value => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) :
  value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
let requests = 0;
let delivered = false;
let topLevelTools = [];
let mcpLoading = [];
let toolSearchExposed = false;
const model = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requests++;
  if (requests === 1) {
    toolSearchExposed = (body.tools ?? []).some(tool => tool.type === "tool_search");
    const entries = (body.tools ?? []).flatMap(tool => tool.type === "namespace"
      ? tool.tools.map(member => ({ namespace: tool.name, name: member.name, deferred: member.defer_loading ?? tool.defer_loading ?? false }))
      : [{ name: tool.name, deferred: tool.defer_loading ?? false }]);
    topLevelTools = entries.map(tool => tool.name).filter(name => typeof name === "string");
    mcpLoading = entries.filter(tool => tool.namespace?.includes("git_bash") || tool.name?.includes("git_bash"));
  }
  if (requests > 1 && strings(body.input).some(text => text.includes(expectedContext))) delivered = true;
  const id = `response_${requests}`;
  const code = requests === 1
    ? 'const native = ALL_TOOLS.find(t => t.name.endsWith("exec_command")); if (!native) throw new Error("native executor absent"); text(await tools[native.name]({cmd:"printf QA_EXEC_OK",login:false}));'
    : 'const bash = ALL_TOOLS.find(t => t.name.includes("git_bash") && t.name.endsWith("which_bash")); if (!bash) throw new Error("which_bash absent"); text(await tools[bash.name]({}));';
  const item = requests <= 2
    ? { type: "custom_tool_call", id: `item_${requests}`, call_id: `qa_exec_${requests}`, name: "exec", input: code }
    : { type: "message", id: `item_${requests}`, role: "assistant", content: [{ type: "output_text", text: "Completed." }] };
  const events = [
    { type: "response.created", response: { id, created_at: 1, model: "mock-model" } },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item: { ...item, status: "completed" } },
    { type: "response.completed", response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
});
const ready = once(model, "listening", { signal: AbortSignal.timeout(10000) });
model.listen(0, "127.0.0.1");
await ready;
const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome, OS: "Windows_NT",
  XDG_CONFIG_HOME: "/qa/config", XDG_DATA_HOME: "/qa/data", XDG_STATE_HOME: "/qa/state", XDG_CACHE_HOME: "/qa/cache",
  OMO_DISABLE_POSTHOG: "1", OMO_CODEX_DISABLE_POSTHOG: "1" };
const version = execFileSync("codex", ["--version"], { env, encoding: "utf8" }).trim();
const overrides = [
  'model="mock-model"', 'model_provider="qa"',
  'model_providers.qa.name="qa"', `model_providers.qa.base_url="http://127.0.0.1:${model.address().port}/v1"`,
  'model_providers.qa.wire_api="responses"', "model_providers.qa.request_max_retries=0", "model_providers.qa.stream_max_retries=0",
];
const child = spawn("codex", [...overrides.flatMap(value => ["-c", value]), "app-server"], { env, stdio: ["pipe", "pipe", "pipe"] });
const bus = new EventEmitter();
const hooks = [];
let commandCompleted = false;
let stderr = "";
let pending = "";
let result = { status: "FAIL", codex: version };
child.stderr.on("data", chunk => stderr += chunk);
const send = value => child.stdin.write(JSON.stringify(value) + "\n");
const finished = once(bus, "finished", { signal: AbortSignal.timeout(90000) }).then(([value]) => value, error => ({ status: "timeout", error: String(error) }));
child.once("error", error => bus.emit("finished", { status: "error", error: String(error) }));
child.once("exit", code => bus.emit("finished", { status: "early-exit", code }));
child.stdout.on("data", chunk => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.error) bus.emit("finished", { status: "error", error: message.error });
    if (message.id === 1 && message.result) {
      send({ method: "initialized" });
      send({ id: 2, method: "thread/start", params: { cwd: "/qa/project" } });
    } else if (message.id === 2 && message.result) {
      send({ id: 3, method: "turn/start", params: { threadId: message.result.thread.id, input: [{ type: "text", text: "Run printf QA_EXEC_OK once." }] } });
    } else if (["hook/started", "hook/completed"].includes(message.method)) {
      const run = message.params.run;
      hooks.push({ method: message.method, id: run.id, eventName: run.eventName, status: run.status });
    } else if (message.method === "item/completed" && message.params.item.type === "commandExecution") {
      commandCompleted = message.params.item.exitCode === 0;
    } else if (message.method === "turn/completed") {
      bus.emit("finished", message.params.turn);
    }
  }
});
try {
  send({ id: 1, method: "initialize", params: { clientInfo: { name: "git-bash-qa", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
  const turn = await finished;
  assert.equal(turn.status, "completed", JSON.stringify(turn));
  const completed = hooks.filter(h => h.method === "hook/completed" && h.eventName === "preToolUse" && h.status === "completed");
  assert(completed.some(end => hooks.some(start => start.method === "hook/started" && start.id === end.id)));
  assert(commandCompleted);
  assert(delivered, "Actual hook context must reach a subsequent model request");
  assert(topLevelTools.includes("exec"));
  assert(toolSearchExposed && mcpLoading.length === 0, "MCP tools must be omitted before deferred discovery");
  const mcp = JSON.parse(readFileSync("/qa/mcp-call.json", "utf8"));
  assert.equal(mcp.input.params.name, "which_bash");
  assert.equal(mcp.response.error, undefined);
  const resolution = JSON.parse(mcp.response.result.content[0].text);
  assert.equal(resolution.source, "not-required");
  const markers = readdirSync("/qa", { recursive: true }).filter(path => path.includes("git-bash-reminder/") && path.endsWith(".seen") && !path.startsWith("control/"));
  assert(markers.length > 0);
  result = { status: "PASS", codex: version, hooks, context: expectedContext, contextDelivered: delivered, commandCompleted,
    requests, markerCount: markers.length, topLevelTools, mcpLoading, toolSearchExposed, deferredTool: mcp.input.params.name, resolution,
    nativeWindowsTested: false, deferredExecutionTested: true, linuxLauncherShim: true, externalModelCalls: 0 };
} catch (error) {
  result.error = String(error);
  result.hooks = hooks;
  result.contextDelivered = delivered;
  result.commandCompleted = commandCompleted;
  result.topLevelTools = topLevelTools;
  result.mcpLoading = mcpLoading;
  result.toolSearchExposed = toolSearchExposed;
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit", { signal: AbortSignal.timeout(15000) });
    child.stdin.end();
    child.kill("SIGTERM");
    await exited;
  }
  const closed = once(model, "close", { signal: AbortSignal.timeout(15000) });
  model.closeAllConnections();
  model.close();
  await closed;
  result.appServerExited = child.exitCode !== null || child.signalCode !== null;
  result.isolation = "Disposable Docker; network disabled; only component and QA artifacts mounted; HOME/CODEX_HOME under /qa";
  writeFileSync("/task/result.json", JSON.stringify(result) + "\n");
  writeFileSync("/task/stderr.log", stderr);
  console.log(JSON.stringify(result));
}
