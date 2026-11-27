// Sandbox wiring every EQ.omo case shares (fused-equivalence-e2e.mjs): the built plugin's trust, every config/state
// root inside the case sandbox, the telemetry opt-out, and the omo config the case runs with. Nothing here turns a
// plugin surface off.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"

// The engine walks up from the case cwd for instruction files, so a sandbox placed under an operator's home (a TMPDIR
// there) records that home's AGENTS.md into the system prompt and the golden (omo#14904). Refuse such a location.
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", join(".agents", "AGENTS.md")]

function instructionFileAbove(dir) {
  for (let parent = dirname(dir); ; parent = dirname(parent)) {
    const found = INSTRUCTION_FILES.map((name) => join(parent, name)).find((path) => existsSync(path))
    if (found !== undefined) return found
    if (dirname(parent) === parent) return undefined
  }
}

export function prepareCaseSandbox(run, omoConfig) {
  const root = run.box.dir
  const leaking = instructionFileAbove(root)
  if (leaking !== undefined) {
    throw new Error(
      `EQ case sandbox ${root} sits under an instruction file (${leaking}); the engine would load it into the recorded prompt. Run from a root with no instruction file above it (e.g. TMPDIR=/tmp).`,
    )
  }
  run.env.PATH = run.childPath
  // The CLI child gets its env from the senpi harness sandbox, which opts out of senpi's own telemetry (PI_TELEMETRY=0)
  // but not the plugin's. Off CI (no CI variable) and with a run root outside the OS temp dir, the plugin's consent gate
  // then reads the child as a real install: telemetry ON and the first-run notice in the observations (MRUN-P0 A2).
  Object.assign(run.env, withTelemetryOptOut(run.env))
  for (const [name, dir] of [
    ["XDG_CONFIG_HOME", "xdg-config"],
    ["XDG_DATA_HOME", "xdg-data"],
    ["XDG_CACHE_HOME", "xdg-cache"],
    ["XDG_STATE_HOME", "xdg-state"],
  ]) {
    run.env[name] = join(root, dir)
    mkdirSync(run.env[name], { recursive: true })
  }
  run.env.OMO_CODING_AGENT_DIR = run.box.agentDir
  run.env.PI_CODING_AGENT_DIR = run.box.agentDir
  run.env.OMO_MEMORY_HOME = join(root, "memory")
  // The child's os.tmpdir() reaches the observations (the computer skill is materialized under it and listed as a
  // skill root: senpi-desktop-tool/src/skill.ts materializeComputerSkill), so it is pinned inside the sandbox and the
  // recording host's TMPDIR never reaches a golden.
  const tmp = join(root, "tmp")
  mkdirSync(tmp, { recursive: true })
  for (const name of ["TMPDIR", "TMP", "TEMP"]) run.env[name] = tmp
  writeFileSync(join(run.box.agentDir, "trust.json"), `${JSON.stringify({ [run.box.cwd]: true }, null, 2)}\n`)
  // No mcp.json: the plugin's MCP declarations (`_ast_grep`, `context7`, `grep_app`) load exactly as in a normal
  // session, the two remote ones over the real network.
  mkdirSync(join(run.box.cwd, ".omo"), { recursive: true })
  writeFileSync(join(run.box.cwd, ".omo", "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
}
