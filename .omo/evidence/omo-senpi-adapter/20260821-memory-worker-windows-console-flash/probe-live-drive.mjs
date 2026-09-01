// Diagnostics for the senpi-qa drive.mjs lanes: reuses the driver's OWN sandbox/seed helpers and
// repeats its exact senpi invocation, but prints status/stdout/stderr instead of a pass/fail verdict.
// Read-only with respect to the repo; the sandbox lives under the OS temp dir and is kept for reading.
import { spawnSync } from "node:child_process"
import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "../../../../packages/omo-senpi/scripts/qa/drive.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..")
const mockProviderEntry = join(repoRoot, "packages/omo-senpi/scripts/qa/mock-provider/index.ts")
const senpiBin = process.env.SENPI_BIN
const sandbox = createSandbox()
seedSandbox(sandbox)
writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps: [{ type: "text", text: "ultrawork scenario complete" }] }, null, 2)}\n`)
const r = spawnSync(senpiBin, ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1", "ulw please respond"], {
  cwd: sandbox.cwd,
  env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, OMO_SENPI_QA: "1" },
  encoding: "utf8",
  timeout: 60_000,
})
console.log("status:", r.status, "signal:", r.signal, "error:", String(r.error && r.error.message))
console.log("--- stdout (last 1500) ---\n" + String(r.stdout || "").slice(-1500))
console.log("--- stderr (last 2000) ---\n" + String(r.stderr || "").slice(-2000))
const sessions = join(sandbox.agentDir, "sessions")
console.log("--- sessions present:", existsSync(sessions) ? readdirSync(sessions).length : "none")
console.log("sandboxRoot:", sandbox.root)
