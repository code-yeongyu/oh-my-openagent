import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import type { FactsSpawnArgs } from "./worker/spawn"
import { buildFactsSandboxTransform, SandboxUnavailableError } from "./sandbox"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const seatbeltTest = test.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))

interface ScratchFixture {
  readonly agentDir: string
  readonly agentDirReal: string
  readonly settingsFile: string
  readonly authFile: string
  readonly spawnArgs: FactsSpawnArgs
}

function spawnArgsFor(agentDir: string, runDir: string): FactsSpawnArgs {
  return {
    runId: "facts-run-1",
    attempt: 1,
    hardDeadlineAt: Date.now() + 10_000,
    model: "fixture/model",
    command: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: runDir,
    env: { PATH: process.env.PATH, OMO_CODING_AGENT_DIR: agentDir },
    detached: true,
    paths: {
      runDir,
      payload: join(runDir, "facts-payload.json"),
      extraction: join(runDir, "extraction.jsonl"),
    },
  }
}

function scratchFixture(): ScratchFixture {
  const root = mkdtempSync(join(tmpdir(), "omo-facts-lock-invariants-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  const runDir = join(root, "runtime", "facts", "runs", "facts-run-1")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(agentDir, "settings.json"), '{"scratch":"settings"}')
  writeFileSync(join(agentDir, "auth.json"), '{"scratch":"auth"}')
  writeFileSync(join(runDir, "facts-payload.json"), "{}")
  return {
    agentDir,
    agentDirReal: realpathSync(agentDir),
    settingsFile: join(agentDir, "settings.json"),
    authFile: join(agentDir, "auth.json"),
    spawnArgs: spawnArgsFor(agentDir, runDir),
  }
}

function requiredFactsTransform() {
  return buildFactsSandboxTransform({
    policy: "required",
    platform: "darwin",
    which: () => "/usr/bin/sandbox-exec",
  })
}

async function runUnderFactsSandbox(setup: ScratchFixture, script: string): Promise<number | null> {
  const transform = requiredFactsTransform()
  const transformed = await transform({ ...setup.spawnArgs, args: ["-c", script] })
  const run = Bun.spawnSync([transformed.command, ...transformed.args], { cwd: transformed.cwd, env: transformed.env })
  return run.exitCode
}

describe("facts sandbox absent lock parent", () => {
  test("#given an agent dir that does not exist at all (fresh machine) #when the required-policy facts sandbox is built #then a typed unavailable error names the missing parent instead of a raw ENOENT", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-facts-absent-agent-"))
    roots.push(root)
    const agentDir = join(root, "missing-agent")
    const runDir = join(root, "runtime", "facts", "runs", "facts-run-1")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "facts-payload.json"), "{}")

    // when
    let thrown: unknown
    try {
      await requiredFactsTransform()(spawnArgsFor(agentDir, runDir))
    } catch (error) {
      thrown = error
    }

    // then
    expect(thrown).toBeInstanceOf(SandboxUnavailableError)
    expect(thrown instanceof Error ? thrown.message : String(thrown)).toContain(agentDir)
  }, 30_000)

  test("#given an agent dir that does not exist at all (fresh machine) #when the auto-policy facts sandbox is built #then it degrades to the unsandboxed identity transform with an explicit warning naming the missing parent", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-facts-absent-agent-"))
    roots.push(root)
    const agentDir = join(root, "missing-agent")
    const runDir = join(root, "runtime", "facts", "runs", "facts-run-1")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "facts-payload.json"), "{}")
    let warning: string | undefined
    const transform = buildFactsSandboxTransform({
      policy: "auto",
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
      onWarning: (value) => { warning = value },
    })
    const spawnArgs = spawnArgsFor(agentDir, runDir)

    // when
    const transformed = await transform(spawnArgs)

    // then
    expect(transformed).toBe(spawnArgs)
    expect(warning).toContain(agentDir)
    expect(warning).toContain("running unsandboxed because policy is auto")
  }, 30_000)
})

describe("facts sandbox lock-grant invariants (real seatbelt)", () => {
  seatbeltTest("#given the real Darwin seatbelt profile rendered by the facts sandbox #when a child runs the full mkdir/touch/rm/rmdir lifecycle on both granted locks #then every operation succeeds and leaves no lock directory behind", async () => {
    // given
    const setup = scratchFixture()
    const settingsLock = join(setup.agentDirReal, "settings.json.lock")
    const authLock = join(setup.agentDirReal, "auth.json.lock")
    const lifecycle = (lock: string) => `mkdir '${lock}' && touch '${lock}/owner' && rm '${lock}/owner' && rmdir '${lock}'`

    // when
    const exitCode = await runUnderFactsSandbox(setup, `${lifecycle(settingsLock)} && ${lifecycle(authLock)}`)

    // then
    expect(exitCode).toBe(0)
    expect(existsSync(settingsLock)).toBe(false)
    expect(existsSync(authLock)).toBe(false)
  }, 30_000)

  seatbeltTest("#given the same profile #when a child mkdirs a THIRD lock path (models.json.lock) #then the deny-by-default wall rejects it", async () => {
    // given
    const setup = scratchFixture()
    const thirdLock = join(setup.agentDirReal, "models.json.lock")

    // when
    const exitCode = await runUnderFactsSandbox(setup, `mkdir '${thirdLock}'`)

    // then
    expect(exitCode).not.toBe(0)
    expect(existsSync(thirdLock)).toBe(false)
  }, 30_000)

  seatbeltTest("#given the same profile #when a child appends to auth.json and to settings.json #then both appends are denied and the files stay byte-identical", async () => {
    // given
    const setup = scratchFixture()
    const settingsBefore = readFileSync(setup.settingsFile)
    const authBefore = readFileSync(setup.authFile)

    // when
    const settingsDenied = await runUnderFactsSandbox(setup, `printf tampered >> '${setup.settingsFile}'`)
    const authDenied = await runUnderFactsSandbox(setup, `printf tampered >> '${setup.authFile}'`)

    // then
    expect(settingsDenied).not.toBe(0)
    expect(authDenied).not.toBe(0)
    expect(readFileSync(setup.settingsFile)).toEqual(settingsBefore)
    expect(readFileSync(setup.authFile)).toEqual(authBefore)
  }, 30_000)

  seatbeltTest("#given an agent dir where NEITHER lock directory exists yet #when the facts profile is rendered #then the build succeeds and carries both lock grants", async () => {
    // given
    const setup = scratchFixture()
    const settingsLock = join(setup.agentDirReal, "settings.json.lock")
    const authLock = join(setup.agentDirReal, "auth.json.lock")
    expect(existsSync(settingsLock)).toBe(false)
    expect(existsSync(authLock)).toBe(false)

    // when
    const transformed = await requiredFactsTransform()(setup.spawnArgs)
    const profile = transformed.args[1] ?? ""

    // then
    // proper-lockfile mkdirs the lock DIRECTORY (literal grant) and writes inside it (subpath
    // grant); neither exists yet, so the absent-entry canonicalization must still render both.
    expect(profile).toContain(`(allow file-write* (literal ${JSON.stringify(settingsLock)}) (subpath ${JSON.stringify(settingsLock)}))`)
    expect(profile).toContain(`(allow file-write* (literal ${JSON.stringify(authLock)}) (subpath ${JSON.stringify(authLock)}))`)
    expect(existsSync(settingsLock)).toBe(false)
    expect(existsSync(authLock)).toBe(false)
  }, 30_000)
})
