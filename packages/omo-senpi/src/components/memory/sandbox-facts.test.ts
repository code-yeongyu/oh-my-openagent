import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import type { FactsSpawnArgs } from "./worker/spawn"
import { buildFactsSandboxTransform, SandboxUnavailableError } from "./sandbox"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

interface LockFixture {
  readonly agentDir: string
  readonly agentDirReal: string
  readonly spawnArgs: FactsSpawnArgs
}

function fixture(): LockFixture {
  const root = mkdtempSync(join(tmpdir(), "omo-facts-lock-sandbox-"))
  roots.push(root)
  const agentDir = join(root, "agent")
  const runDir = join(root, "runtime", "facts", "runs", "facts-run-1")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(agentDir, "settings.json"), "{}")
  writeFileSync(join(agentDir, "auth.json"), "{}")
  writeFileSync(join(runDir, "facts-payload.json"), "{}")
  return {
    agentDir,
    agentDirReal: realpathSync(agentDir),
    spawnArgs: {
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
    },
  }
}

async function renderDarwinProfile(setup: LockFixture): Promise<string> {
  const transform = buildFactsSandboxTransform({
    policy: "required",
    platform: "darwin",
    which: () => "/usr/bin/sandbox-exec",
  })
  const transformed = await transform(setup.spawnArgs)
  return transformed.args[1] ?? ""
}

describe("facts worker OS sandbox", () => {
  test("#given Darwin with sandbox-exec available #when facts spawn arguments are transformed #then the wrapper keeps the inner command and grants the run directory", async () => {
    // given
    const setup = fixture()
    const transform = buildFactsSandboxTransform({
      policy: "required",
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
    })

    // when
    const transformed = await transform(setup.spawnArgs)

    // then
    expect(transformed.command).toBe("/usr/bin/sandbox-exec")
    expect(transformed.args[1] ?? "").toContain(`(allow file-write* (subpath ${JSON.stringify(realpathSync(setup.spawnArgs.paths.runDir))}))`)
    expect(transformed.args.slice(-4)).toEqual(["--", "/bin/sh", "-c", "exit 0"])
  }, 30_000)

  test("#given a missing facts inner command #when the transform is built #then its warning names the facts surface", async () => {
    // given
    const setup = fixture()
    let warning: string | undefined
    const transform = buildFactsSandboxTransform({
      policy: "required",
      platform: "darwin",
      which: () => "/usr/bin/sandbox-exec",
      onWarning: (value) => { warning = value },
    })

    // when
    await transform({
      ...setup.spawnArgs,
      command: "missing-senpi",
      env: { PATH: "", OMO_CODING_AGENT_DIR: setup.agentDir },
    })

    // then
    expect(warning).toBe('facts sandbox unavailable: inner command "missing-senpi" is not absolute and could not be resolved; running unsandboxed')
  }, 30_000)
})

describe("facts sandbox agent lockfile grants", () => {
  test("#given an agent dir whose lock directories do not exist yet #when the facts Darwin profile is built #then it renders both literal and subpath write grants for each lock path", async () => {
    // given
    const setup = fixture()
    const settingsLock = join(setup.agentDirReal, "settings.json.lock")
    const authLock = join(setup.agentDirReal, "auth.json.lock")
    expect(existsSync(settingsLock)).toBe(false)
    expect(existsSync(authLock)).toBe(false)

    // when
    const profile = await renderDarwinProfile(setup)

    // then
    // proper-lockfile mkdirs the lock DIRECTORY and writes inside it, so both forms are required;
    // neither path exists before the child runs, so neither may be realpath-canonicalized.
    expect(profile).toContain(`(allow file-write* (literal ${JSON.stringify(settingsLock)}) (subpath ${JSON.stringify(settingsLock)}))`)
    expect(profile).toContain(`(allow file-write* (literal ${JSON.stringify(authLock)}) (subpath ${JSON.stringify(authLock)}))`)
    expect(existsSync(settingsLock)).toBe(false)
    expect(existsSync(authLock)).toBe(false)
  }, 30_000)

  test("#given the facts Darwin profile #when its write grants are inspected #then the bare agent dir is never writable", async () => {
    // given
    const setup = fixture()

    // when
    const profile = await renderDarwinProfile(setup)

    // then
    const agentDirGrants = profile.split("\n").filter((line) =>
      line.startsWith("(allow file-write*")
      && (line.includes(`(subpath ${JSON.stringify(setup.agentDirReal)})`)
        || line.includes(`(literal ${JSON.stringify(setup.agentDirReal)})`)))
    expect(agentDirGrants).toEqual([])
    expect(profile).not.toContain(JSON.stringify(join(setup.agentDirReal, "auth.json")))
    expect(profile).not.toContain(JSON.stringify(join(setup.agentDirReal, "settings.json")))
  }, 30_000)

  test("#given the facts Darwin profile #when the run directory grant is inspected #then the run dir stays the only writable subtree beside the lock paths and the sandbox temp dir", async () => {
    // given
    const setup = fixture()
    const runDirReal = realpathSync(setup.spawnArgs.paths.runDir)

    // when
    const profile = await renderDarwinProfile(setup)

    // then
    expect(profile).toContain(`(allow file-write* (subpath ${JSON.stringify(runDirReal)}))`)
    const subpathOnlyGrants = profile.split("\n").filter((line) => line.startsWith("(allow file-write* (subpath "))
    expect(subpathOnlyGrants).toEqual([
      `(allow file-write* (subpath ${JSON.stringify(runDirReal)}))`,
      `(allow file-write* (subpath ${JSON.stringify(join(runDirReal, ".sandbox-tmp"))}))`,
    ])
  }, 30_000)

  test("#given Linux with bwrap available and required policy #when lock grants are requested #then a typed unavailable error names the lock-grant gap", () => {
    // given
    const setup = fixture()
    const transform = buildFactsSandboxTransform({
      policy: "required",
      platform: "linux",
      which: () => "/usr/bin/bwrap",
    })

    // when
    const attempt = () => transform(setup.spawnArgs)

    // then
    expect(attempt).toThrow(SandboxUnavailableError)
    expect(attempt).toThrow(/lock/)
    expect(attempt).toThrow(/linux/)
  }, 30_000)

  test("#given Linux with bwrap available and auto policy #when lock grants are requested #then spawn arguments pass through with an explicit degradation warning", async () => {
    // given
    const setup = fixture()
    let warning: string | undefined
    const transform = buildFactsSandboxTransform({
      policy: "auto",
      platform: "linux",
      which: () => "/usr/bin/bwrap",
      onWarning: (value) => { warning = value },
    })

    // when
    const transformed = await transform(setup.spawnArgs)

    // then
    expect(transformed).toBe(setup.spawnArgs)
    expect(warning).toContain("lock")
    expect(warning).toContain("running unsandboxed because policy is auto")
  }, 30_000)

  test.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "#given the real Darwin seatbelt built from a not-yet-existing lock path #when a child creates and removes that lock directory #then the operations succeed while the agent config files stay unwritable",
    async () => {
      // given
      const setup = fixture()
      const transform = buildFactsSandboxTransform({
        policy: "required",
        platform: "darwin",
        which: () => "/usr/bin/sandbox-exec",
      })
      const authLock = join(setup.agentDirReal, "auth.json.lock")
      const authFile = join(setup.agentDirReal, "auth.json")

      // when
      const grantedRun = await transform({
        ...setup.spawnArgs,
        args: ["-c", `mkdir '${authLock}' && printf lock > '${authLock}/owner' && rm -rf '${authLock}'`],
      })
      const granted = Bun.spawnSync([grantedRun.command, ...grantedRun.args], { cwd: grantedRun.cwd, env: grantedRun.env })
      const deniedRun = await transform({
        ...setup.spawnArgs,
        args: ["-c", `printf tampered >> '${authFile}'`],
      })
      const denied = Bun.spawnSync([deniedRun.command, ...deniedRun.args], { cwd: deniedRun.cwd, env: deniedRun.env })

      // then
      expect(granted.exitCode).toBe(0)
      expect(existsSync(authLock)).toBe(false)
      expect(denied.exitCode).not.toBe(0)
      expect(Bun.file(authFile).size).toBe(2)
    },
    30_000,
  )
})
