#!/usr/bin/env node
// Visual QA for the memory write notice row (plan memory-tui-notice-style, C1/C4).
// Drives the REAL senpi TUI in an isolated agent dir + OMO_MEMORY_HOME with the shared
// mock provider scripted to call the memory tool once, then captures the rendered tool
// row through the repo's xterm.js web terminal (true color, never tmux):
//   collapsed run: the row shows the notice contract; "committed locally" and the
//                  command name are absent
//   expanded run:  after {Ctrl+o} the row's detail line carries the commit sha
// Evidence lands in .omo/evidence/<date>-memory-notice-style/; the sandbox is removed
// and the cleanup receipt printed. Usage:
//   node packages/omo-senpi/scripts/qa/memory-write-visual-qa.mjs [--keep-sandbox]
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const qaScript = join(repoRoot, "script", "qa", "web-terminal-visual-qa.mjs")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const keepSandbox = process.argv.includes("--keep-sandbox")

const senpiBin = process.env.SENPI_BIN ?? "senpi"
const evidenceDir = join(repoRoot, ".omo", "evidence", "20260819-memory-notice-style")
mkdirSync(evidenceDir, { recursive: true })

const failures = []
function record(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
  if (!ok) failures.push(name)
}

const sandboxes = []
function freshSandbox() {
  const sandbox = createSandbox()
  sandboxes.push(sandbox)
  seedSandbox(sandbox)
  const script = {
    steps: [
      {
        type: "tool_call",
        name: "memory",
        arguments: {
          command: "create",
          reason: "Track the deploy runbook",
          file_path: "knowledge/deploy.md",
          description: "Deploy runbook location",
          file_text: "The deploy runbook lives in the team wiki under Runbooks/Deploy.\n",
        },
      },
      { type: "text", text: "noted" },
    ],
  }
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return sandbox
}

try {
  function capture(label, inputs) {
    const sandbox = freshSandbox()
    const envPrefix = [
      `SENPI_CODING_AGENT_DIR=${sandbox.agentDir}`,
      `XDG_CONFIG_HOME=${sandbox.xdgConfigHome}`,
      `OMO_MEMORY_HOME=${join(sandbox.root, "memory")}`,
      `HOME=${sandbox.homeDir}`,
    ].join(" ")
    const senpiCmd = `${envPrefix} ${senpiBin} -e ${mockProviderEntry} --provider omo-mock --model mock-1`
    const outDir = join(evidenceDir, label)
    const args = [
      qaScript,
      "--title", `memory-write-notice-${label}`,
      "--command", senpiCmd,
      "--cwd", sandbox.cwd,
      "--cols", "110", "--rows", "30",
      "--dwell-ms", "15000",
      "--key-delay-ms", "6000",
      "--evidence-dir", outDir,
      "--source-label", "senpi interactive mock-provider memory write",
    ]
    for (const input of inputs) args.push("--input", input)
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180_000 })
    if (run.status !== 0) {
      record(`${label} capture`, false, (run.stderr ?? run.stdout ?? "").split("\n").slice(-3).join(" | "))
      return { transcript: "", ansi: "" }
    }
    const transcript = existsSync(join(outDir, "terminal.txt")) ? readFileSync(join(outDir, "terminal.txt"), "utf8") : ""
    const ansi = existsSync(join(outDir, "terminal-ansi.txt")) ? readFileSync(join(outDir, "terminal-ansi.txt"), "utf8") : ""
    return { transcript, ansi }
  }

  // Collapsed row: typed prompt -> mock emits the memory tool call -> real tool executes.
  const collapsed = capture("collapsed", ["remember the deploy runbook location", "{Enter}"])
  record("collapsed: notice title rendered", /Memory updated/.test(collapsed.transcript), "expects 'Memory updated' in row")
  record("collapsed: old line gone", !/committed locally/.test(collapsed.transcript), "'committed locally' must not appear")
  record("collapsed: command name gone", !/create committed|Memory create/.test(collapsed.transcript), "command name must not appear")
  record("collapsed: why line names path", /knowledge\/deploy\.md/.test(collapsed.transcript), "affected path visible")
  record("collapsed: bold title styling", /\[1m.*Memory updated/s.test(collapsed.ansi), "SGR bold around title")

  // Expanded row: same flow, then {Ctrl+o} toggles tool output to reveal the detail line.
  const expanded = capture("expanded", ["remember the deploy runbook location", "{Enter}", "{Ctrl+o}"])
  record("expanded: sha in detail", /[0-9a-f]{7} · /.test(expanded.transcript), "sha7 + separator in expanded detail")
  record("expanded: subject in detail", /Track the deploy runbook/.test(expanded.transcript), "commit subject in expanded detail")

  console.log(`evidence: ${evidenceDir}`)
} finally {
  for (const sandbox of sandboxes) {
    if (keepSandbox) {
      console.log(`sandbox kept: ${sandbox.root}`)
    } else {
      rmSync(sandbox.root, { recursive: true, force: true })
      console.log(`cleanup: removed sandbox ${sandbox.root}; exists=${existsSync(sandbox.root)}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`memory-write visual QA FAILED: ${failures.join(", ")}`)
  process.exit(1)
}
console.log("memory-write visual QA passed")
