#!/usr/bin/env node
// Zero-dependency DAP REPL, modeled on oh-my-pi's debug tool. DAP framing is UTF-8 byte based.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { stdin, stdout, stderr, env } from "node:process";

export const MAX_ROWS = 100;
export const MAX_OUTPUT_BYTES = 32 * 1024;

export function isTcpAdapterSpec(spec) {
  const separator = spec.lastIndexOf(":");
  return separator > 0 &&
    !spec.includes("/") &&
    !spec.includes("\\") &&
    /^\d+$/.test(spec.slice(separator + 1));
}

export class DapFrameParser {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const messages = [];
    while (true) {
      const marker = this.buffer.indexOf(Buffer.from("\r\n\r\n"));
      if (marker < 0) break;
      const header = this.buffer.subarray(0, marker).toString("ascii");
      const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
      if (!match) { this.buffer = this.buffer.subarray(marker + 4); continue; }
      const length = Number(match[1]);
      const start = marker + 4;
      if (this.buffer.length < start + length) break;
      const body = this.buffer.subarray(start, start + length);
      this.buffer = this.buffer.subarray(start + length);
      try { messages.push(JSON.parse(body.toString("utf8"))); } catch { /* malformed frames are ignored */ }
    }
    return messages;
  }
}

const timeoutMs = Number(env.DAP_TIMEOUT_MS || 15000);
let transport = null;
let parser = null;
let nextSeq = 1;
let initialized = false;
let terminated = false;
let currentStop = null;
let topFrame = null;
const pending = new Map();
const breakpoints = new Map();
// Event-driven waits. A tight `await setImmediate` busy-loop starves Bun's socket
// data callbacks (the `initialized` event then never processes and launch deadlocks),
// so every wait subscribes to the actual DAP event instead of polling state.
const eventWaiters = new Map();
function onEvent(name) {
  return new Promise(resolve => {
    const list = eventWaiters.get(name) || [];
    list.push(resolve);
    eventWaiters.set(name, list);
  });
}
function emitEvent(name, value) {
  const list = eventWaiters.get(name) || [];
  eventWaiters.delete(name);
  for (const resolve of list) resolve(value);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const debugTraffic = Boolean(env.DAP_DEBUG);
function trace(direction, message) { if (debugTraffic) stderr.write(`DAP ${direction} ${JSON.stringify(message).slice(0, 300)}\n`); }
function line(text) { stdout.write(`${text}\n`); }
function error(kind, detail = "") { line(`ERR: ${kind}${detail ? ` ${detail}` : ""}`); }
function send(message) {
  trace(">", message);
  const body = Buffer.from(JSON.stringify(message));
  transport.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
}
function request(command, args = {}) {
  if (!transport || terminated) return Promise.reject(new Error("no-session"));
  const seq = nextSeq++;
  send({ type: "request", seq, command, arguments: args });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(seq); reject(new Error("timeout")); }, timeoutMs);
    pending.set(seq, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: value => { clearTimeout(timer); reject(value); } });
  });
}
function onMessage(message) {
  trace("<", message);
  if (message.type === "response") {
    const wait = pending.get(message.request_seq);
    if (!wait) return;
    pending.delete(message.request_seq);
    if (message.success === false) wait.reject(new Error("adapter-error")); else wait.resolve(message);
  } else if (message.type === "event") {
    if (message.event === "initialized") { initialized = true; emitEvent("initialized"); }
    if (message.event === "stopped") { currentStop = message.body || {}; emitEvent("stopped", currentStop); }
    if (message.event === "terminated" || message.event === "exited") { terminated = true; emitEvent("terminated"); }
  }
}
function connectTransport(write, read, close = read) {
  transport = { write: chunk => write.write(chunk), destroy: () => close.destroy?.() };
  parser = new DapFrameParser();
  read.on("data", chunk => { for (const message of parser.push(chunk)) onMessage(message); });
  read.on("error", () => { if (!terminated) error("adapter-failed"); });
  read.on("close", () => { if (!terminated) error("adapter-failed"); });
}
function connectSocket(socket) { connectTransport(socket, socket, socket); }
async function startAdapter(spec) {
  if (isTcpAdapterSpec(spec)) {
    const separator = spec.lastIndexOf(":");
    const socket = createConnection(Number(spec.slice(separator + 1)), spec.slice(0, separator));
    connectSocket(socket);
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  } else {
    // A .mjs/.cjs/.ts adapter spec runs under the current Bun/Node runtime (e.g. the
    // fixture adapter); any other spec is an adapter executable (lldb-dap, debugpy, dlv)
    // spawned directly with its own argv.
    const isScript = /\.(mjs|cjs|ts)$/.test(spec);
    const [cmd, argv] = isScript ? [process.execPath, [spec]] : [spec, []];
    const child = spawn(cmd, argv, { stdio: ["pipe", "pipe", "inherit"] });
    connectTransport(child.stdin, child.stdout, child);
    child.on("error", () => error("adapter-failed"));
  }
}
// Waits for a stopped event. When `required` is false this is a best-effort grace
// window (e.g. an optional stop-on-entry); it returns on the first stop OR on timeout
// without failing, so adapters that run straight to a breakpoint are not broken.
async function waitForStop(required = true, graceMs) {
  if (currentStop || terminated) return Boolean(currentStop);
  const budget = graceMs ?? timeoutMs;
  await Promise.race([onEvent("stopped"), onEvent("terminated"), sleep(budget)]);
  return Boolean(currentStop);
}
// Waits for the adapter's `initialized` event, event-driven (never a busy-loop).
async function waitInitialized() {
  if (initialized) return;
  await Promise.race([onEvent("initialized"), sleep(timeoutMs)]);
  if (!initialized) throw new Error("timeout");
}
// Adapters gate the `initialized` event on a recognized adapterID (debugpy withholds
// it for unknown IDs, hanging the handshake). Infer a known ID from the adapter spec.
function adapterIdFor(spec) {
  const base = String(spec).split("/").pop().toLowerCase();
  if (base.includes("debugpy") || base.includes("python")) return "debugpy";
  if (base.includes("lldb")) return "lldb-dap";
  if (base.includes("dlv") || base.includes("delve")) return "dlv";
  if (base.includes("js-debug")) return "js-debug";
  if (base.includes("gdb")) return "gdb";
  return "omo";
}
async function launch(adapter, program, args) {
  if (transport) return error("adapter-error", "session already exists");
  try {
    await startAdapter(adapter);
    await request("initialize", { clientID: "omo-dap", adapterID: adapterIdFor(adapter), linesStartAt1: true, columnsStartAt1: true, pathFormat: "path" });
    // Send launch BEFORE awaiting `initialized`: debugpy's adapter defers/flushes the
    // initialized event until further client activity, so waiting for it first
    // deadlocks the handshake. DAP allows launch any time after the initialize
    // response; `initialized` is only required before configurationDone.
    // stopOnEntry yields an initial stopped event with a real threadId, so the client
    // can set breakpoints and inspect from a valid stopped state before continuing.
    // `console: "internalConsole"` is REQUIRED by debugpy (without it the launch never
    // spawns the debug server -> "Server is not available"); lldb-dap ignores it.
    // lldb-dap reports the launch response success unreliably (false even when the
    // process started and stopped); the process/stopped EVENTS are the real signal,
    // so a non-success launch response is tolerated, not fatal.
    await request("launch", { program, args, console: "internalConsole", justMyCode: false, stopOnEntry: true }).catch(() => null);
    await waitInitialized();
    await request("configurationDone").catch(() => null);
    // Best-effort: lldb-dap stops at entry, other adapters run to the first breakpoint.
    await waitForStop(false, 2000);
    line("READY: launch");
  } catch (e) { error(e.message === "timeout" ? "timeout" : e.message === "adapter-error" ? "adapter-error" : "adapter-failed"); }
}
async function snapshot() {
  if (terminated) { line("EXIT: terminated"); return; }
  try {
    const response = await request("stackTrace", { threadId: currentStop?.threadId || 1, levels: 1 });
    topFrame = response.body?.stackFrames?.[0];
    const f = topFrame;
    if (f) line(`STOP: stopped reason=${currentStop?.reason || "unknown"} threadId=${currentStop?.threadId || ""} ${f.name} at ${f.source?.path || "?"}:${f.line || 0}:${f.column || 0}`);
    else line(`STOP: stopped reason=${currentStop?.reason || "unknown"} threadId=${currentStop?.threadId || ""} ? at ?:0:0`);
  } catch (e) { error(e.message === "timeout" ? "timeout" : "adapter-error"); }
}
function boundedTable(header, rows) {
  const all = rows.map(row => row.join("\t"));
  const chosen = all.slice(0, MAX_ROWS);
  const prefix = `${header.join("\t")}\n`;
  let output = prefix;
  let count = 0;
  for (const row of chosen) {
    const candidate = `${row}\n`;
    if (Buffer.byteLength(output + candidate) > MAX_OUTPUT_BYTES) break;
    output += candidate; count++;
  }
  stdout.write(output);
  const rowDropped = all.length - count;
  const byteDropped = Buffer.byteLength(all.slice(count).join("\n") + (all.length > count ? "\n" : ""));
  if (rowDropped > 0 || byteDropped > 0) line(`TRUNCATED: rows dropped=${rowDropped} bytes dropped=${byteDropped}`);
}
async function command(input) {
  const parts = input.trim().split(/\s+/);
  const cmd = parts.shift();
  if (!cmd) return;
  if (cmd === "quit") { transport?.destroy?.(); process.exit(0); }
  if (cmd === "launch") return launch(parts.shift(), parts.shift(), parts);
  if (cmd === "attach") {
    const [host, port] = (parts.shift() || "").split(":");
    try {
      await startAdapter(`${host}:${port}`);
      await request("initialize", { clientID: "omo-dap", adapterID: "debugpy", linesStartAt1: true, columnsStartAt1: true, pathFormat: "path" });
      await waitInitialized();
      await request("attach", { justMyCode: false });
      await request("configurationDone");
      line("READY: attach");
    } catch (e) { error(e.message === "timeout" ? "timeout" : "adapter-failed"); }
    return;
  }
  if (!transport) return error("no-session");
  try {
    if (cmd === "break" || cmd === "rmbreak") {
      const [file, lineNo] = (parts[0] || "").split(":");
      if (!file || !lineNo) return error("invalid-args");
      const set = breakpoints.get(file) || [];
      const next = cmd === "break" ? [...set.filter(x => x.line !== Number(lineNo)), { line: Number(lineNo) }] : set.filter(x => x.line !== Number(lineNo));
      const response = await request("setBreakpoints", { source: { path: file }, breakpoints: next });
      breakpoints.set(file, next);
      if (response.body?.breakpoints?.some(bp => bp.verified === false)) error("unverified-breakpoint"); else line(`BREAK: ${file}:${lineNo}`);
    } else if (["continue", "step", "next", "stepin", "stepout", "pause"].includes(cmd)) {
      const dapCmd = { step: "next", stepin: "stepIn", stepout: "stepOut" }[cmd] || cmd;
      const threadId = currentStop?.threadId || 1;
      currentStop = null;
      await request(dapCmd, { threadId });
      // Wait for the resulting stopped event (breakpoint hit / step completed) before
      // snapshotting; without this the stack is read while the debuggee is still running.
      await waitForStop();
      await snapshot();
    } else if (cmd === "stack") {
      const r = await request("stackTrace", { threadId: currentStop?.threadId || 1, levels: Number(parts[0]) || 100 });
      boundedTable(["FRAME", "NAME", "FILE", "LINE", "COLUMN"], (r.body?.stackFrames || []).map(f => [String(f.id), f.name, f.source?.path || "", String(f.line || ""), String(f.column || "")]));
    } else if (cmd === "scopes") {
      const r = await request("scopes", { frameId: topFrame?.id || 42 });
      boundedTable(["NAME", "VARIABLES_REFERENCE"], (r.body?.scopes || []).map(s => [s.name, String(s.variablesReference)]));
    } else if (cmd === "vars") {
      if (!parts[0]) return error("invalid-args");
      const r = await request("variables", { variablesReference: Number(parts[0]) });
      boundedTable(["NAME", "VALUE"], (r.body?.variables || []).map(v => [v.name, v.value ?? ""]));
    } else if (cmd === "eval") {
      if (!parts.length) return error("invalid-args");
      const r = await request("evaluate", { expression: parts.join(" "), frameId: topFrame?.id || 42 });
      line(`EVAL\t${r.body?.result || ""}`);
    } else if (cmd === "threads") {
      const r = await request("threads"); boundedTable(["ID", "NAME"], (r.body?.threads || []).map(t => [String(t.id), t.name]));
    } else if (cmd === "sessions") line("SESSION\tSTATE\n1\tactive");
    else if (cmd === "terminate") { await request("terminate", { restart: false }); line("EXIT: terminated"); terminated = true; }
    else error("invalid-args");
  } catch (e) { error(e.message === "timeout" ? "timeout" : e.message === "adapter-error" ? "adapter-error" : "adapter-failed"); }
}

if (import.meta.main) {
  // Serialize stdin commands: fire-and-forget (`void command(...)`) lets a `continue`
  // race ahead of the launch handshake's configurationDone, and the adapter then
  // drops or rejects the out-of-order request. Each line awaits the previous command.
  let chain = Promise.resolve();
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on("line", value => { chain = chain.then(() => command(value)).catch(() => {}); });
}
