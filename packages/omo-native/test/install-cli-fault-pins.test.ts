import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Slice C1c (#14960): what `omo setup --yes` does today when a later stage's write throws after an earlier stage wrote,
// in both editions, pinned against the code before the install calls moved. The earlier stage's write stays and the
// later stages do not run; the npm launcher prints the error and exits 1, the compiled entry has no catch of its own.

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const CANARY = "SK-C1C-FAULT-CANARY"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

// A pending API key (the credentials stage writes auth.json) and a pending skill whose target cannot be a directory:
// the agent dir's `skills` is a file, so the assets stage's copy throws after the credentials stage wrote.
function faultFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-c1c-fault-")))
  roots.push(root)
  const home = join(root, "home")
  const agentDir = join(root, "agent")
  mkdirSync(home, { recursive: true })
  writeFile(join(root, "xdg", "opencode", "auth.json"), JSON.stringify({ google: { type: "api", key: CANARY } }))
  writeFile(
    join(root, "xdg-config", "opencode", "skills", "fixture-skill", "SKILL.md"),
    "---\nname: fixture-skill\ndescription: d\n---\nbody\n",
  )
  writeFile(join(agentDir, "skills"), "not a directory\n")
  const app = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  writeFile(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  const env = {
    PATH: "/usr/bin:/bin",
    ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }),
    HOME: home,
    USERPROFILE: home,
    SENPI_CODING_AGENT_DIR: agentDir,
    XDG_DATA_HOME: join(root, "xdg"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  }
  return { root, agentDir, env, launcher: join(app, "bin", "omo.js") }
}

function outcome(result: ReturnType<typeof spawnSync>, fixture: ReturnType<typeof faultFixture>) {
  if (result.error) throw result.error
  const clean = (text: unknown) =>
    String(text).replaceAll("\r\n", "\n").replaceAll(fixture.root, "<ROOT>").replaceAll(SOURCE_ROOT, "<SOURCE>")
  expect(`${result.stdout}${result.stderr}`).not.toContain(CANARY)
  const authFile = join(fixture.agentDir, "auth.json")
  return {
    status: result.status,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    imported: existsSync(authFile) ? Object.keys(JSON.parse(readFileSync(authFile, "utf8"))).sort() : null,
  }
}

describe.skipIf(process.platform === "win32")("C1c fault pins: a setup stage whose write throws", () => {
  // The compiled entry has no catch of its own: the fault ends as the runtime's unhandled-error report. Its stack
  // carries source line numbers, so the pin holds what is stable: the exit, the error line and the report's marks.
  test("#given the compiled entry #then the credentials stage's write stays and the fault is an unhandled-error report, exit 1", () => {
    const fixture = faultFixture()
    const result = spawnSync(process.execPath, [join(SOURCE_ROOT, "compile-entry.ts"), "setup", "--yes"], {
      encoding: "utf8",
      env: fixture.env,
    })
    const seen = outcome(result, fixture)
    expect({ status: seen.status, imported: seen.imported }).toEqual({ status: 1, imported: ["google"] })
    expect(seen.stderr).toContain("ENOTDIR: not a directory, lstat '<ROOT>/agent/skills/fixture-skill'")
    expect(seen.stderr).toContain("at applySetupStages (")
    expect(seen.stderr).toMatch(/\nBun v\d+\.\d+\.\d+ /)
    expect(seen.stderr).not.toContain("omo: ENOTDIR")
  })

  test("#given the npm launcher #then the credentials stage's write stays, the error is printed and the exit is 1", () => {
    const fixture = faultFixture()
    const result = spawnSync(process.execPath, [fixture.launcher, "setup", "--yes"], {
      encoding: "utf8",
      env: fixture.env,
    })
    expect(outcome(result, fixture)).toMatchInlineSnapshot(`
      {
        "imported": [
          "google",
        ],
        "status": 1,
        "stderr": 
      "omo: ENOTDIR: not a directory, lstat '<ROOT>/agent/skills/fixture-skill'
      "
      ,
        "stdout": 
      "Found your OpenCode setup
        logins        1 API key (google) - will be imported
        skills        1 will be imported (fixture-skill)
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      "
      ,
      }
    `)
  })
})
