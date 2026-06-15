// app-server-client.mjs - drive a real `codex app-server` turn for QA.
//
// This is the FIRST-PARTY way to QA the omo Codex plugin: instead of scripting
// the TUI, we speak the app-server's own protocol (newline-delimited JSON over
// stdio - NO "jsonrpc" field) and watch the structured notification stream.
//
//   initialize -> initialized -> thread/start -> turn/start
//   ... collect hook/started + hook/completed (plugin proof)
//   ... collect item/completed agentMessage (assistant text)
//   stop on turn/completed (turn.status == "completed" | "failed")
//
// Env (CODEX_HOME is inherited and MUST already point at the isolated home):
//   MOCK_PORT     port of the mock model server (required; no real API call).
//   PROMPT        user message text (default "say hello").
//   QA_CWD        conversation working dir (default process.cwd()).
//   DEADLINE_MS   hard stop (default 60000).
//   EXPECT_HOOK   comma-separated hook eventNames that MUST complete for exit 0
//                 (e.g. "userPromptSubmit,sessionStart"). Empty = only require
//                 turn/completed.
//   CODEX_BIN     codex binary (default "codex"; PATH lookup, no shell function).
//
// Prints a JSON summary to stdout. Exit 0 iff the turn completed AND every
// EXPECT_HOOK fired with status "completed".
import { spawn } from "node:child_process";

const CODEX_BIN = process.env.CODEX_BIN || "codex";
const MOCK_PORT = process.env.MOCK_PORT;
const PROMPT = process.env.PROMPT || "say hello";
const CWD = process.env.QA_CWD || process.cwd();
const DEADLINE_MS = Number(process.env.DEADLINE_MS || 60000);
const EXPECT = (process.env.EXPECT_HOOK || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!MOCK_PORT) {
  console.error("app-server-client: MOCK_PORT is required (start lib/mock-model.mjs first)");
  process.exit(2);
}

// Config overrides force codex onto the local mock provider, never the real one.
const overrides = [
  `model="mock-model"`,
  `model_provider="mock_provider"`,
  `model_providers.mock_provider.name="codex-qa mock"`,
  `model_providers.mock_provider.base_url="http://127.0.0.1:${MOCK_PORT}/v1"`,
  `model_providers.mock_provider.wire_api="responses"`,
  `model_providers.mock_provider.request_max_retries=0`,
  `model_providers.mock_provider.stream_max_retries=0`,
  `approval_policy="never"`,
  `sandbox_mode="read-only"`,
];
const args = overrides.flatMap((o) => ["-c", o]).concat("app-server");

const child = spawn(CODEX_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
let stderr = "";
child.stderr.on("data", (c) => (stderr += c));

const hooks = [];
let assistantText = null;
let threadId = null;
let turnId = null;
let turnStatus = null;
let buf = "";
let finished = false;

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

function finish() {
  if (finished) return;
  finished = true;
  try { child.kill("SIGTERM"); } catch {}
  const completed = new Set(hooks.filter((h) => h.method === "hook/completed" && h.status === "completed").map((h) => h.eventName));
  const missing = EXPECT.filter((e) => !completed.has(e));
  const ok = turnStatus === "completed" && missing.length === 0;
  console.log(JSON.stringify({ ok, turnStatus, assistantText, threadId, turnId, expectHook: EXPECT, missingHooks: missing, hooks, stderrTail: stderr.split("\n").slice(-10).join("\n") }, null, 2));
  process.exit(ok ? 0 : 1);
}

function handle(msg) {
  if (msg.id === 1 && msg.result) {
    send({ method: "initialized" });
    send({ id: 2, method: "thread/start", params: { cwd: CWD } });
  } else if (msg.id === 2 && msg.result) {
    threadId = msg.result.thread?.id;
    send({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: PROMPT }] } });
  } else if (msg.id === 3 && msg.result) {
    turnId = msg.result.turn?.id;
  } else if (msg.method === "hook/started" || msg.method === "hook/completed") {
    const run = msg.params?.run || {};
    hooks.push({ method: msg.method, eventName: run.eventName, status: run.status, source: run.source ?? run.pluginId });
  } else if (msg.method === "item/completed") {
    const item = msg.params?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") assistantText = item.text;
  } else if (msg.method === "turn/completed") {
    turnStatus = msg.params?.turn?.status;
    finish();
  }
}

child.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
child.on("exit", (code) => {
  if (finished) return;
  console.log(JSON.stringify({ ok: false, exitCode: code, turnStatus, hooks, stderrTail: stderr.split("\n").slice(-15).join("\n") }, null, 2));
  process.exit(1);
});

send({ id: 1, method: "initialize", params: { clientInfo: { name: "codex-qa", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
setTimeout(() => { stderr += "\n[driver] deadline reached\n"; finish(); }, DEADLINE_MS);
