#!/usr/bin/env node
// Minimal standalone reproduction of the defect the live QA found at feat/memorian-gate HEAD
// (32188aa8c): the memorian gate child NEVER spawns in a real session, because the fire-and-forget
// settle launch reads the senpi extension ctx AFTER the session disposed it.
//
// Run:  bun run .omo/evidence/omo-senpi-adapter/20260831-memorian-gate/repro-stale-ctx.mjs
//
// Expected output at the defective HEAD:
//   STUB_INVOCATIONS=0
//   OBSERVED_WARNING=memorian gate launch failed ... "This extension ctx is stale after ..."
//   REPRO=CONFIRMED
//
// POST stale-ctx fix (d2085bc5 + d6d2f8b0): REPRO=NOT-REPRODUCED and the gate child DOES launch.
// reflection.sandbox "off" is a HARNESS requirement only: the stub records its invocations to a log
// under the sandbox ROOT, while the production sandbox profile (correctly) allows writes only inside
// the scratch run dir, so under the default "auto" the stub itself dies with EPERM before it can
// report that it ran. The production sandbox policy is covered by its own unit tests.
//
// The stub installed through the production SENPI_BIN seam records every gate-child launch. Zero
// invocations plus the stale-ctx warning IS the defect: candidate collection succeeded (the runner
// was entered), and the throw happens at resolveModelRegistry() inside launchOnce.
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const qaDir = join(repoRoot, "packages", "omo-senpi", "scripts", "qa")
const { createSandbox, seedSandbox } = await import(join(qaDir, "drive.mjs"))
const mockProviderEntry = join(qaDir, "task-e2e-mock-provider.ts")
const omoExtension = join(repoRoot, "packages", "omo-senpi", "plugin", "extensions", "omo.js")
const senpiCli = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")

const NOTE_PATH = "reference/project/test-note.md"
const TOKEN = "zebra-quokka rebase ordering rule"

const sandbox = createSandbox()
seedSandbox(sandbox)
mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
writeFileSync(join(sandbox.agentDir, "auth.json"), JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2))
writeFileSync(
  join(sandbox.cwd, ".omo", "omo.json"),
  JSON.stringify(
    {
      categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
      memory: { enabled: true, reflection: { trigger: { step_count: 0, on_compaction: false }, sandbox: "off" } },
    },
    null,
    2,
  ),
)

// The stub gate child, installed through the PRODUCTION launcher seam (SENPI_BIN).
const stubLog = join(sandbox.root, "stub-invocations.jsonl")
const stubPath = join(sandbox.root, "stub-senpi")
writeFileSync(
  stubPath,
  `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs")
appendFileSync(${JSON.stringify(stubLog)}, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n")
if (process.env.MEMORIAN_NUDGE_PATH) {
  writeFileSync(process.env.MEMORIAN_NUDGE_PATH, JSON.stringify({ path: ${JSON.stringify(NOTE_PATH)}, hint: "repro hint" }) + "\\n")
}
process.exit(0)
`,
  { mode: 0o755 },
)
chmodSync(stubPath, 0o755)

function runSenpi(prompt, sessionId) {
  return spawnSync(
    process.execPath,
    [
      senpiCli,
      "-e", mockProviderEntry,
      "-e", omoExtension,
      "-p", "--mode", "json",
      "--provider", "omo-mock", "--model", "mock-1",
      "--session-dir", join(sandbox.agentDir, "sessions"),
      "--session-id", sessionId,
      prompt,
    ],
    {
      cwd: sandbox.cwd,
      env: {
        ...process.env,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        OMO_MEMORY_HOME: join(sandbox.root, "memory"),
        SENPI_BIN: stubPath,
      },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

// PREP: one memory write so the identity repo exists.
writeFileSync(
  join(sandbox.cwd, "mock-script.json"),
  JSON.stringify(
    {
      parentSteps: [
        { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "system/facts.md", description: "harness facts", file_text: "senpi is a pi harness", reason: "seed" } },
        { type: "text", text: "ok" },
      ],
      childSteps: [{ type: "text", text: "unused" }],
    },
    null,
    2,
  ),
)
const prep = runSenpi("seed the harness memory repo", "01a05b6d-0000-7000-8000-0000000000ee")
console.log(`PREP_EXIT=${prep.status}`)

// Commit the corpus note so lexical candidates exist at settle.
const agentsDir = join(sandbox.root, "memory", "agents")
const agent = readdirSync(agentsDir)[0]
const repo = join(agentsDir, agent, "repo")
mkdirSync(join(repo, "reference", "project"), { recursive: true })
writeFileSync(
  join(repo, NOTE_PATH),
  `---\ndescription: Project rebase ordering rule captured for repro\n---\n\nThe ${TOKEN} says: rebase the oldest reviewed branch first, then replay the\ndependent branches in merge order so the stack never inverts.\n`,
)
spawnSync("git", ["add", NOTE_PATH], { cwd: repo })
spawnSync("git", ["commit", "-m", "repro: seed corpus note"], { cwd: repo })

// The turn that must trigger the gate at settle.
writeFileSync(join(sandbox.cwd, "mock-script.json"), JSON.stringify({ parentSteps: [{ type: "text", text: "ok" }], childSteps: [{ type: "text", text: "unused" }] }, null, 2))
const turn = runSenpi(`remind me about the ${TOKEN} before I restack the branches`, "01a05b6d-0000-7000-8000-0000000000aa")
console.log(`TURN_EXIT=${turn.status}`)

const invocations = existsSync(stubLog) ? readFileSync(stubLog, "utf8").split("\n").filter((line) => line.trim() !== "") : []
console.log(`STUB_INVOCATIONS=${invocations.length}`)

const stderr = turn.stderr ?? ""
const warned = stderr.includes("memorian gate launch failed")
const stale = stderr.includes("This extension ctx is stale after session replacement or reload")
console.log(`OBSERVED_WARNING=${warned ? "memorian gate launch failed" : "(none)"}`)
console.log(`OBSERVED_STALE_CTX=${stale}`)

rmSync(sandbox.root, { recursive: true, force: true })
console.log(`SANDBOX_REMOVED=${!existsSync(sandbox.root)}`)

const confirmed = invocations.length === 0 && warned && stale
console.log(`REPRO=${confirmed ? "CONFIRMED" : "NOT-REPRODUCED"}`)
process.exit(confirmed ? 0 : 1)
