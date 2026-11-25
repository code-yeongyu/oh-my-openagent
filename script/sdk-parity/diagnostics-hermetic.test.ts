import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createDiagnosticsLoader } from "../../packages/omo-native/diagnostics-loader"
import { assembleOmoSdk } from "../../packages/omo-senpi/src/components/omo-sdk/assembly"

// Design ruling on the diagnostics.run driver (#14959): run's sections read the file system directly, so a scenario run
// is only evidence when it reads the scratch root its fakes own. The process's own HOME points at a "real" home full of
// canaries that every direct-reading section would pick up; the root is built for an empty scratch root. Nothing of the
// real home may reach the answer, and neither tree may change.
const CANARY = "CANARY9f31"
const roots: string[] = []
// The process environment a user's own run would carry, every variable pointing into the real home.
const REAL_ENV = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "OMO_MEMORY_HOME", "XDG_CONFIG_HOME"] as const
const saved = Object.fromEntries(REAL_ENV.map((key) => [key, process.env[key]]))
function restoreEnv(): void {
  for (const key of REAL_ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}
afterEach(() => {
  restoreEnv()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function tree(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).toSorted()) {
      const path = join(dir, name)
      const info = statSync(path)
      if (info.isDirectory()) walk(path)
      else out.push(`${path.slice(root.length)} ${info.size} ${readFileSync(path, "utf8")}`)
    }
  }
  walk(root)
  return out
}

test("#given a real home full of canaries and a root built for an empty scratch root #when diagnostics.run answers #then no canary or real path reaches the findings, the empty-state findings come back and neither tree changes", async () => {
  const realHome = mkdtempSync(join(tmpdir(), "c1b-real-home-"))
  const scratch = mkdtempSync(join(tmpdir(), "c1b-scratch-"))
  roots.push(realHome, scratch)
  write(join(realHome, ".omo", "omo.jsonc"), `{ "${CANARY}": true }`)
  write(join(realHome, ".omo", "agent", "settings.json"), JSON.stringify({ packages: ["@code-yeongyu/omo-senpi"] }))
  mkdirSync(join(realHome, ".omo", "memory", "agents", `${CANARY}-identity`, "repo"), { recursive: true })
  write(join(realHome, ".pi", "agent", "settings.json"), `{"${CANARY}":1}`)
  write(
    join(realHome, ".config", "opencode", "opencode.json"),
    JSON.stringify({ plugin: [`oh-my-opencode-${CANARY}`] }),
  )
  const home = join(scratch, "home")
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  const before = { real: tree(realHome), scratch: tree(scratch) }

  Object.assign(process.env, {
    HOME: realHome,
    USERPROFILE: realHome,
    PI_CODING_AGENT_DIR: join(realHome, ".omo", "agent"),
    OMO_MEMORY_HOME: join(realHome, ".omo", "memory"),
    XDG_CONFIG_HOME: join(realHome, ".config"),
  })
  const loader = createDiagnosticsLoader({
    process: { spawn: async () => ({ exitCode: 0, stdout: "" }), signal: async () => {} },
    host: { status: async () => ({ endpoints: [] }) },
    fetchDistTags: () => undefined,
  })
  const root = assembleOmoSdk(
    { env: { HOME: home, OMO_CODING_AGENT_DIR: agentDir, PATH: "" }, cwd: home, home },
    { cores: { diagnostics: loader } },
  )
  const answer = await root.diagnostics.run({})
  restoreEnv()

  if (answer.kind !== "ok") throw new Error(`run answered ${JSON.stringify(answer)}`)
  const text = JSON.stringify(answer)
  expect(text).not.toContain(CANARY)
  expect(text).not.toContain(realHome)
  const messages = answer.value.findings.map((finding) => finding.message)
  expect(messages).toContain(`config dir: ${agentDir}`)
  expect(messages).toContain("Daemon: not running")
  expect(answer.value.findings.filter((finding) => finding.check.startsWith("memory."))).toEqual([])
  expect(answer.value.findings.filter((finding) => finding.check === "settings.packages")).toEqual([])
  expect({ real: tree(realHome), scratch: tree(scratch) }).toEqual(before)
})

test("#given a relative memory home and a project layer under the process's own cwd and a root built for a scratch cwd #when diagnostics.run answers #then the memory sections and the daemon's config loader read the root's cwd only", async () => {
  const processCwd = mkdtempSync(join(tmpdir(), "c1b-process-cwd-"))
  const scratch = mkdtempSync(join(tmpdir(), "c1b-scratch-cwd-"))
  roots.push(processCwd, scratch)
  mkdirSync(join(processCwd, "rel-memory", "agents", `${CANARY}-identity`, "repo"), { recursive: true })
  const home = join(scratch, "home")
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  const seenCwd: string[] = []
  const loader = createDiagnosticsLoader({
    process: { spawn: async () => ({ exitCode: 0, stdout: "" }), signal: async () => {} },
    host: { status: async () => ({ endpoints: [] }) },
    fetchDistTags: () => undefined,
    loadTaskConfig: () => ({
      resolveDaemonTaskSettings: ({ cwd }: { readonly cwd: string }) => {
        seenCwd.push(cwd)
        return {}
      },
    }),
  })
  const root = assembleOmoSdk(
    {
      env: { HOME: home, OMO_CODING_AGENT_DIR: agentDir, OMO_MEMORY_HOME: "rel-memory", PATH: "" },
      cwd: scratch,
      home,
    },
    { cores: { diagnostics: loader } },
  )
  const previous = process.cwd()
  process.chdir(processCwd)
  let answer
  try {
    answer = await root.diagnostics.run({})
  } finally {
    process.chdir(previous)
  }
  expect(JSON.stringify(answer)).not.toContain(CANARY)
  expect(JSON.stringify(answer)).not.toContain(processCwd)
  expect(seenCwd.length).toBeGreaterThan(0)
  expect([...new Set(seenCwd)]).toEqual([scratch])
})
