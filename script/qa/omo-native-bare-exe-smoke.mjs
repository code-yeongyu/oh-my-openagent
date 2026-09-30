#!/usr/bin/env bun
// Runs a standalone omo binary the way a user runs a download: copied alone into an empty
// directory, isolated HOME/USERPROFILE, one scripted session that runs a shell command (the first
// terminal session is what loads pi-pty), launched twice so both the first run that provisions the
// runtime and a later run of the same download are covered (#7485).
import { spawn } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

const MARKER = "bare-exe-42"
const RUN_BUDGET_MS = 240_000

function providerSource() {
  return `
const MODEL = { id: "gpt-5.6-sol", name: "Bare exe", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }
function step(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  if (messages.some((message) => message?.role === "toolResult")) return { type: "text", text: "done" }
  const tools = (context?.tools ?? []).map((tool) => tool.name)
  if (tools.includes("bash")) return { type: "tool_call", name: "bash", arguments: { command: "echo ${MARKER}" } }
  return { type: "tool_call", name: "eval", arguments: { language: "js", code: "const r = await tool.bash({ command: 'echo ${MARKER}' }); print(r.text)", summary: "bare exe shell" } }
}
function stream(current, options) {
  const content = current.type === "text" ? [{ type: "text", text: current.text }] : [{ type: "toolCall", id: "bare-exe-1", name: current.name, arguments: current.arguments }]
  const final = { role: "assistant", content, api: "openai-completions", provider: "openai", model: MODEL.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: current.type === "text" ? "stop" : "toolUse", timestamp: Date.now() }
  const events = [{ type: "start", partial: { ...final, content: [] } }]
  if (current.type === "text") events.push({ type: "text_start", contentIndex: 0, partial: final }, { type: "text_delta", contentIndex: 0, delta: current.text, partial: final }, { type: "text_end", contentIndex: 0, content: current.text, partial: final })
  else events.push({ type: "toolcall_start", contentIndex: 0, partial: final }, { type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(current.arguments), partial: final }, { type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: final })
  events.push({ type: "done", reason: final.stopReason, message: options?.signal?.aborted ? { ...final, stopReason: "aborted" } : final })
  return { result: async () => final, async *[Symbol.asyncIterator]() { for (const event of events) yield event } }
}
export default function register(pi) {
  pi.registerProvider("openai", { name: "Bare exe", baseUrl: "file://bare-exe", apiKey: "bare-exe", api: "openai-completions", models: [MODEL], streamSimple(_model, context, options) { return stream(step(context), options) } })
}
`
}

function sandbox(root) {
  const home = join(root, "home")
  const agentDir = join(home, ".omo", "agent")
  const download = join(root, "download")
  const project = join(root, "project")
  const sessions = join(root, "sessions")
  for (const dir of [download, project, sessions, join(agentDir, "extensions"), join(agentDir, "omo-senpi", "omo-native")]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(agentDir, "omo-senpi", "omo-native", "onboarding-completed"), '{"version":1}\n')
  writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [realpathSync(project)]: true }))
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask", defaultProvider: "openai", defaultModel: "gpt-5.6-sol" }))
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: { models: [{ id: "gpt-5.6-sol", name: "Bare exe", contextWindow: 200000, maxTokens: 4096 }] } } }))
  writeFileSync(join(agentDir, "extensions", "bare-exe-provider.ts"), providerSource())
  return { home, download, project, sessions }
}

function environment(box) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(SENPI_|OMO_|PI_)/.test(key) || /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) continue
    env[key] = value
  }
  return { ...env, HOME: box.home, USERPROFILE: box.home, PI_OFFLINE: "1", PI_TELEMETRY: "0", OMO_SEND_ANONYMOUS_TELEMETRY: "0" }
}

function runSession(exe, box, sessionDir) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(exe, ["--mode", "rpc", "--approve", "--no-context-files", "--session-dir", sessionDir, "--provider", "openai", "--model", "gpt-5.6-sol"], {
      cwd: box.project, env: environment(box), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    const watchdog = setTimeout(() => { child.kill("SIGKILL"); rejectRun(new Error(`session exceeded ${RUN_BUDGET_MS}ms\n${stderr.slice(-3000)}`)) }, RUN_BUDGET_MS)
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.includes('"type":"agent_settled"')) child.stdin.end() })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.once("error", (error) => { clearTimeout(watchdog); rejectRun(error) })
    child.once("close", (code) => { clearTimeout(watchdog); resolveRun({ code, stderr }) })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: "Run the shell command." })}\n`)
  })
}

function toolResult(sessionDir) {
  const lines = readdirSync(sessionDir, { recursive: true }).map(String).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(sessionDir, name), "utf8").split("\n")).filter(Boolean).map((line) => JSON.parse(line))
  const message = lines.find((record) => record?.type === "message" && record.message?.role === "toolResult")?.message
  if (message === undefined) return undefined
  const text = Array.isArray(message.content) ? message.content.map((part) => (part?.type === "text" ? part.text : "")).join("\n") : ""
  return { tool: message.toolName, isError: message.isError === true, text }
}

async function main() {
  const index = process.argv.indexOf("--binary")
  if (index === -1 || process.argv[index + 1] === undefined) throw new Error("usage: bun script/qa/omo-native-bare-exe-smoke.mjs --binary <omo binary>")
  const source = resolve(process.argv[index + 1])
  const root = mkdtempSync(join(tmpdir(), "omo-bare-exe-"))
  const failures = []
  try {
    const box = sandbox(root)
    const exe = join(box.download, basename(source))
    copyFileSync(source, exe)
    for (const run of ["first run", "second run"]) {
      const sessionDir = join(box.sessions, run.replace(" ", "-"))
      mkdirSync(sessionDir, { recursive: true })
      const outcome = await runSession(exe, box, sessionDir)
      const result = toolResult(sessionDir)
      const ok = outcome.code === 0 && result !== undefined && !result.isError && result.text.includes(MARKER)
      process.stdout.write(`${ok ? "PASS" : "FAIL"} ${run}: exit=${outcome.code} ${result === undefined ? "no tool result" : `${result.tool} ${result.isError ? "error" : "ok"}: ${result.text.trim().slice(0, 300)}`}\n`)
      if (!ok) failures.push(`${run}: ${outcome.stderr.split("\n").filter((line) => /error|warning|cannot|missing/i.test(line)).slice(0, 8).join(" | ")}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`)
    process.exit(1)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
