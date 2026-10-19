import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { composeOmoSenpiExtension } from "./compose"
import { releaseHerdrAgentHint } from "./herdr-agent-hint"

const MARKER = "OMO_HERDR_AGENT_HINT"
const roots: string[] = []
const saved = { hint: process.env.HERDR_AGENT, marker: process.env[MARKER] }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const [key, value] of [["HERDR_AGENT", saved.hint], [MARKER, saved.marker]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("releaseHerdrAgentHint (#10448)", () => {
  test("#given the hint the launcher set #when released #then the hint and its marker are gone", () => {
    const env: NodeJS.ProcessEnv = { HERDR_AGENT: "pi", [MARKER]: "pi", HERDR_ENV: "1" }
    releaseHerdrAgentHint(env)
    expect(env).toEqual({ HERDR_ENV: "1" })
  })

  test("#given a HERDR_AGENT the user set #when released #then it stays exactly as set", () => {
    const env: NodeJS.ProcessEnv = { HERDR_AGENT: "claude", HERDR_ENV: "1" }
    releaseHerdrAgentHint(env)
    expect(env).toEqual({ HERDR_AGENT: "claude", HERDR_ENV: "1" })
  })

  test("#given a marker that no longer matches the hint #when released #then only the marker is dropped", () => {
    const env: NodeJS.ProcessEnv = { HERDR_AGENT: "claude", [MARKER]: "pi" }
    releaseHerdrAgentHint(env)
    expect(env).toEqual({ HERDR_AGENT: "claude" })
  })

  test("#given the extension loads #then the engine's environment no longer carries the launcher's hint", async () => {
    process.env.HERDR_AGENT = "pi"
    process.env[MARKER] = "pi"
    const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    await composeOmoSenpiExtension([], { logger: silent })({})
    expect(process.env.HERDR_AGENT).toBeUndefined()
    expect(process.env[MARKER]).toBeUndefined()
  })

  // herdr reads the hint from the process's exec'd environment (/proc/<pid>/environ on Linux,
  // KERN_PROCARGS2 on macOS, which \`ps eww\` shows). Releasing it must keep it there for herdr and
  // keep it away from every child.
  test.skipIf(process.platform === "win32")("#given an engine started with the launcher's hint #when it releases it #then herdr still sees it on the engine and no child inherits it", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-herdr-hint-"))
    roots.push(root)
    const script = join(root, "engine.ts")
    writeFileSync(script, `import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { releaseHerdrAgentHint } from ${JSON.stringify(join(import.meta.dir, "herdr-agent-hint.ts"))}
releaseHerdrAgentHint()
const own = process.platform === "linux"
  ? readFileSync("/proc/" + process.pid + "/environ", "latin1")
  : spawnSync("ps", ["eww", "-o", "command=", "-p", String(process.pid)], { encoding: "utf8" }).stdout
const child = spawnSync("sh", ["-c", "printf %s \\"\${HERDR_AGENT-unset}\\""], { encoding: "utf8" }).stdout
console.log(JSON.stringify({ own: own.includes("HERDR_AGENT=pi"), child }))
`)
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, HERDR_AGENT: "pi", [MARKER]: "pi" } })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual({ own: true, child: "unset" })
  })
})
