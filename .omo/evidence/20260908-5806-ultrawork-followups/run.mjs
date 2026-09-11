import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync, watch } from "node:fs";

for (const part of ["home", "config/opencode", "data", "cache", "state", "project", "tmp"]) mkdirSync(`/qa/${part}`, { recursive: true });
let modelCalls = 0;
let markerDelivered = false;
let lossyCompactionSummary = false;
let autoResumeGuidance = { matchesRuntimeGuidance: false, sha256: "", bytes: 0 };
const modelBus = new EventEmitter();
function containsRuntimeGuidance(value, guidance) {
  if (typeof value === "string") return value.includes(guidance);
  if (Array.isArray(value)) return value.some((item) => containsRuntimeGuidance(item, guidance));
  return value !== null && typeof value === "object" && Object.values(value).some((item) => containsRuntimeGuidance(item, guidance));
}
const model = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const id = `r${++modelCalls}`;
  const requestInput = JSON.parse(raw).input ?? null;
  const serializedInput = JSON.stringify(requestInput);
  if (modelCalls === 2) markerDelivered = serializedInput.includes("<ultrawork-mode>active</ultrawork-mode>");
  const responseText = "Done.";
  if (modelCalls === 3) lossyCompactionSummary = responseText === "Done.";
  if (modelCalls === 4 && existsSync("/qa/system-guidance.txt")) {
    const guidance = readFileSync("/qa/system-guidance.txt", "utf8");
    const receipt = JSON.parse(readFileSync("/qa/system-guidance.json", "utf8"));
    autoResumeGuidance = {
      matchesRuntimeGuidance: containsRuntimeGuidance(requestInput, guidance),
      sha256: receipt.sha256,
      bytes: receipt.bytes,
    };
  }
  modelBus.emit("request");
  const item = { type: "message", id: `i${modelCalls}`, role: "assistant", content: [{ type: "output_text", text: responseText }] };
  const events = [
    { type: "response.created", response: { id, created_at: 1, model: "gpt-fake" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: item.id } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, delta: "Done." },
    { type: "response.output_item.done", output_index: 0, item: { ...item, status: "completed" } },
    { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end("data: [DONE]\n\n");
});
const ready = once(model, "listening", { signal: AbortSignal.timeout(10000) });
model.listen(0, "127.0.0.1");
await ready;
async function waitForModelCalls(count) {
  const signal = AbortSignal.timeout(15000);
  while (modelCalls < count) await once(modelBus, "request", { signal });
}
writeFileSync("/qa/config/opencode/opencode.json", JSON.stringify({
  plugin: ["file:///evidence/adapter.js"],
  model: "openai/gpt-fake",
  command: { "stop-continuation": { template: "Stop continuation.", description: "Synthetic stop command" } },
  agent: { sisyphus: { mode: "primary", model: "openai/gpt-fake", prompt: "Reply briefly." } },
  provider: { openai: { options: { apiKey: "synthetic", baseURL: `http://127.0.0.1:${model.address().port}/v1` }, models: { "gpt-fake": { limit: { context: 200000, output: 8192 } } } } },
}));
const env = {
  PATH: process.env.PATH, HOME: "/qa/home", TMPDIR: "/qa/tmp",
  XDG_CONFIG_HOME: "/qa/config", XDG_DATA_HOME: "/qa/data", XDG_CACHE_HOME: "/qa/cache", XDG_STATE_HOME: "/qa/state",
  OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", OMO_DISABLE_POSTHOG: "1",
};
const version = execFileSync("opencode", ["--version"], { env, encoding: "utf8" }).trim();
const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], {
  cwd: "/qa/project", env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const events = new Set();
const eventBus = new EventEmitter();
const streamAbort = new AbortController();
let consume;
let result = { status: "FAIL", opencode: version };
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server readiness timeout")), 60000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Early server exit ${code}`)); });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
      output += chunk;
      const match = output.match(/opencode server listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const sse = await fetch(`${url}/event?directory=/qa/project`, { signal: streamAbort.signal });
  assert(sse.ok);
  consume = (async () => {
    let pending = "";
    for await (const chunk of sse.body) {
      pending += Buffer.from(chunk).toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) if (line.startsWith("data: ")) {
        const type = JSON.parse(line.slice(6)).type;
        events.add(type);
        eventBus.emit(type);
      }
    }
  })().catch(error => { if (!streamAbort.signal.aborted) throw error; });
  const api = async (path, body, method = "POST") => {
    const response = await fetch(`${url}${path}?directory=/qa/project`, {
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const text = await response.text();
    assert(response.ok, text);
    return text ? JSON.parse(text) : undefined;
  };
  const messageEvent = once(eventBus, "message.updated", { signal: AbortSignal.timeout(90000) }).then(() => true, () => false);
  const session = await api("/session", { title: "ULW follow-up QA" });
  const prompt = text => api(`/session/${session.id}/message`, {
    agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-fake" }, parts: [{ type: "text", text }],
  });
  await prompt("ulw implement a tiny change");
  await prompt("and add error handling");
  const compactBus = new EventEmitter();
  const compactWatch = watch("/qa", (_event, name) => { if (name === "compacted.json") compactBus.emit(name); });
  const systemGuidanceWatch = watch("/qa", (_event, name) => { if (name === "system-guidance.json") compactBus.emit(name); });
  const autocontinueWatch = watch("/qa", (_event, name) => { if (name === "autocontinue.json") compactBus.emit(name); });
  const waitForReceipt = name => once(compactBus, name, { signal: AbortSignal.timeout(15000) }).then(() => true, () => false);
  const compactReady = waitForReceipt("compacted.json");
  const systemGuidanceReady = waitForReceipt("system-guidance.json");
  const autocontinueReady = waitForReceipt("autocontinue.json");
  const compactEvent = once(eventBus, "session.compacted", { signal: AbortSignal.timeout(15000) }).then(() => true, () => false);
  const autoResume = waitForModelCalls(4);
  try {
    await api(`/session/${session.id}/summarize`, { providerID: "openai", modelID: "gpt-fake", auto: true });
    assert(await compactReady, "Compaction must reach the dispatcher");
    assert(await systemGuidanceReady, "System transform must restore active ULW guidance");
    assert(await autocontinueReady, "Autocontinue must run before resume");
    assert(await compactEvent, "Compaction must reach SSE");
    assert(JSON.parse(readFileSync("/qa/compacted.json", "utf8")).routed);
    assert.deepEqual(JSON.parse(readFileSync("/qa/autocontinue.json", "utf8")), { enabled: true });
    await autoResume;
    assert(lossyCompactionSummary, "Compaction summary must remain deliberately lossy");
    assert(autoResumeGuidance.matchesRuntimeGuidance, "Model request 4 must include runtime system guidance");
    assert.match(autoResumeGuidance.sha256, /^[a-f0-9]{64}$/);
    assert(autoResumeGuidance.bytes > 0);
  } finally {
    compactWatch.close();
    systemGuidanceWatch.close();
    autocontinueWatch.close();
  }
  await prompt("continue after compaction");
  await prompt("another follow-up");
  await api(`/session/${session.id}/command`, { command: "stop-continuation", arguments: "", agent: "sisyphus" });
  await prompt("ordinary request");
  assert(existsSync("/qa/factory.json"), "PluginModule factory must run");
  const calls = readFileSync("/qa/calls.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  assert(calls.length >= 5);
  assert.deepEqual(calls.slice(0, 4).map(call => call.kind), ["full", "marker", "full", "marker"]);
  assert(calls.slice(4).every(call => !call.active));
  for (const call of [calls[1], calls[3]]) {
    assert(call.originalTextPreserved);
    assert.equal(call.addedParts, 1);
  }
  assert(markerDelivered, "The model must receive the compact activation marker");
  assert.equal(calls[1].override.modelID, "ulw-selected");
  assert.equal(calls.at(-1).override, null);
  await prompt("ulw reactivate before deletion");
  const reactivated = JSON.parse(readFileSync("/qa/calls.jsonl", "utf8").trim().split("\n").at(-1)).active;
  assert(reactivated);
  const receiptBus = new EventEmitter();
  const receiptWatch = watch("/qa", (_event, name) => { if (name === "deletion.json") receiptBus.emit("ready"); });
  const receiptReady = once(receiptBus, "ready", { signal: AbortSignal.timeout(15000) }).then(() => true, () => false);
  const deletionEvent = once(eventBus, "session.deleted", { signal: AbortSignal.timeout(15000) }).then(() => true, () => false);
  try {
    await api(`/session/${session.id}`, undefined, "DELETE");
    assert(await receiptReady, "Dispatcher deletion receipt must arrive");
  } finally {
    receiptWatch.close();
  }
  const deletion = JSON.parse(readFileSync("/qa/deletion.json", "utf8"));
  assert.deepEqual(deletion, { routed: true, cleared: true });
  assert(await messageEvent, "Real message event must reach SSE");
  assert(await deletionEvent, "Session deletion must reach SSE");
  result = { status: "PASS", opencode: version, calls, markerDelivered, lossyCompactionSummary, autoResumeGuidance,
    autocontinue: JSON.parse(readFileSync("/qa/autocontinue.json", "utf8")), reactivated, deletion, sse: [...events].sort(), modelCalls, externalModelCalls: 0,
    isolation: "Disposable Docker; evidence-only mount; HOME/XDG under /qa" };
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
} finally {
  streamAbort.abort();
  if (consume) await consume;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit", { signal: AbortSignal.timeout(15000) });
    child.kill("SIGTERM");
    await exited;
  }
  const closed = once(model, "close", { signal: AbortSignal.timeout(15000) });
  model.closeAllConnections();
  model.close();
  await closed;
  result.serverExited = child.exitCode !== null || child.signalCode !== null;
  writeFileSync("/evidence/opencode.log", output);
  writeFileSync("/evidence/result.json", JSON.stringify(result) + "\n");
  console.log(JSON.stringify(result));
}
