#!/usr/bin/env node
// Plan node 27 end-to-end check: a Python `@tool` defined in the parent's eval kernel is granted to a real
// omo child by that Python cell (`tool.task(..., tools=["add"])`); the child calls it and the call runs back in the parent kernel.
// Usage: SENPI_BIN=<senpi> node kernel-tools-python-e2e.mjs [--out <evidence.json>]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { createOwnedProcessRegistry, startSenpiRun } from "./team-e2e-runtime.mjs"
import { parseEvents } from "./team-e2e-support.mjs"
import { resolveSenpi } from "./team-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(scriptDir, "..", "..", "plugin")
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")

const DEFINE_TOOL = [
  "calls = []",
  "@tool",
  "def add(a: int, b: int) -> int:",
  '    """Add two integers."""',
  "    calls.append((a, b))",
  "    return a + b",
  "'defined'",
].join("\n")
// Grants come from the calling kernel: the Python cell that defined the tool spawns the child.
const CALL_CHILD = "reply = tool.task(prompt='MOCK' + 'ROLE=quick add 1 and 2 with the add tool', subagent_type='fixture', tools=['add'])\nreply"
const READ_CALLS = "calls"

const SCRIPT = {
  lead: [
    { type: "tool_call", name: "eval", arguments: { language: "py", summary: "define a Python tool", code: DEFINE_TOOL } },
    { type: "tool_call", name: "eval", arguments: { language: "py", summary: "a child calls the Python tool", code: CALL_CHILD } },
    { type: "tool_call", name: "eval", arguments: { language: "py", summary: "read the calls the parent kernel served", code: READ_CALLS } },
    { type: "text", text: "KERNEL-TOOLS-PY-DONE" },
  ],
  quick: [
    { type: "tool_call", name: "add", arguments: { a: 1, b: 2 } },
    { type: "text", text: "CHILD-DONE" },
  ],
}

const OMO_CONFIG = {
  task: { reattach_on_reconcile: false },
  categories: { quick: { model: "omo-mock/mock-1" } },
  agents: { fixture: { model: "omo-mock/mock-1", description: "kernel-tools fixture agent", prompt: "You are the fixture agent." } },
}

function evalResults(stdout) {
  return parseEvents(stdout)
    .filter((event) => event?.type === "tool_execution_end" && event.toolName === "eval")
    .map((event) => ({
      isError: event.result?.details?.isError === true,
      text: (event.result?.content ?? []).map((part) => part.text ?? "").join("\n"),
    }))
}

function childToolResults(agentDir) {
  const found = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".jsonl") && path.includes(`${join("senpi-task", "children")}`)) {
        for (const line of readFileSync(path, "utf8").split("\n")) {
          if (!line.includes('"toolResult"') || !line.includes('"add"')) continue
          try {
            const message = JSON.parse(line).message
            if (message?.role === "toolResult" && message.toolName === "add") {
              found.push({ isError: message.isError === true, text: (message.content ?? []).map((part) => part.text ?? "").join("") })
            }
          } catch {
            // a partial trailing line while the child was writing is not a tool result
          }
        }
      }
    }
  }
  walk(agentDir)
  return found
}

// A granted kernel tool answers the child with {"kernel_tool": <name>, "value": <result>}.
function kernelToolValue(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed?.kernel_tool === "add" ? parsed.value : undefined
  } catch {
    return undefined
  }
}

async function main() {
  const outIndex = process.argv.indexOf("--out")
  const out = outIndex === -1 ? undefined : resolve(process.argv[outIndex + 1])
  const senpiBin = resolveSenpi()
  if (senpiBin === null) throw new Error("real Senpi binary is unavailable (set SENPI_BIN)")
  const sandbox = createSandbox()
  const processes = createOwnedProcessRegistry()
  let run
  let childResults = []
  let leaked = 0
  try {
    seedSandbox(sandbox)
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
    writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
    // Children run as RPC host sessions, which load extensions from the plugin's daemon launch spec: put the
    // mock provider there too, on a private copy of the plugin, so the child resolves omo-mock like the parent.
    const pluginCopy = join(sandbox.root, "plugin")
    cpSync(pluginRoot, pluginCopy, { recursive: true })
    const specPath = join(pluginCopy, "daemon-launch-spec.json")
    const spec = JSON.parse(readFileSync(specPath, "utf8"))
    spec.core.extensions.push(mockProviderEntry)
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
    const settingsPath = join(sandbox.agentDir, "settings.json")
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, packages: [pluginCopy] }, null, 2)}\n`)
    const active = startSenpiRun({
      senpiBin,
      sandbox,
      prompt: "Run the scripted cells.",
      script: SCRIPT,
      mockProviderEntry,
      parseEvents,
      onPid: (pid) => processes.onSpawn(pid),
      onClose: (pid) => processes.onClose(pid),
    })
    try {
      run = await active.completion
    } finally {
      await active.kill()
    }
    childResults = childToolResults(sandbox.agentDir)
  } finally {
    leaked = await processes.cleanup()
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  const cells = evalResults(run?.stdout ?? "")
  const checks = {
    tool_defined: cells[0]?.isError === false && cells[0].text.includes("defined") ? "PASS" : "FAIL",
    child_ran: cells[1]?.isError === false && cells[1].text.includes("CHILD-DONE") ? "PASS" : "FAIL",
    child_got_sum: childResults.some((result) => !result.isError && kernelToolValue(result.text) === 3) ? "PASS" : "FAIL",
    parent_kernel_served: cells[2]?.isError === false && /\(1,\s*2\)/.test(cells[2].text) ? "PASS" : "FAIL",
    no_leaked_processes: leaked === 0 ? "PASS" : "FAIL",
  }
  const result = Object.values(checks).every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const payload = { result, checks, cells, childResults, exit: run?.status ?? null, leaked }
  if (out !== undefined) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
  }
  console.log(JSON.stringify({ result, checks }))
  process.exitCode = result === "PASS" ? 0 : 1
}

await main()
