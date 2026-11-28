import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoAtomicSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createReplaySpawn, exited, readFixture } from "./__fixtures__/replay-spawn"
import { type AtomicProbe, type AtomicProbeOptions, type AtomicSpawnOutcome, probeAtomic } from "./index"
import type { AtomicSpawnRequest } from "./process"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeExecutable(directory: string, name = "atomic"): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, "#!/bin/sh\n")
  chmodSync(path, 0o755)
  return path
}

function layout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atomic-core-probe-")))
  tempDirs.push(root)
  const repository = join(root, "repo")
  mkdirSync(join(repository, ".git"), { recursive: true })
  makeExecutable(join(repository, "bin"))
  const trusted = makeExecutable(join(root, "trusted", "bin"))
  return { repository, trusted, trustedBin: join(root, "trusted", "bin"), repositoryBin: join(repository, "bin") }
}

function cliOutput(overrides: Partial<Record<string, AtomicSpawnOutcome>> = {}) {
  const outputs: Record<string, AtomicSpawnOutcome> = {
    "--version": exited(readFixture("version.txt")),
    status: exited(readFixture("status-json.txt")),
    identity: exited(readFixture("identity-whoami.txt")),
    agent: exited(readFixture("agent-status-json.txt")),
    ...overrides,
  }
  return createReplaySpawn((request: AtomicSpawnRequest) => outputs[request.args[0] ?? ""] ?? exited("", 2))
}

const enabledPolicy = { settings: OmoAtomicSettingsSchema.parse({ enabled: true }), authorized: true }

function options(spawn: AtomicProbeOptions["spawn"], overrides: Partial<AtomicProbeOptions> = {}): AtomicProbeOptions {
  return { cwd: "/", policy: enabledPolicy, spawn, environment: { PATH: "" }, platform: "darwin", ...overrides }
}

function unavailableCode(probe: AtomicProbe): string {
  return probe.kind === "unavailable" ? probe.error.code : probe.kind
}

describe("probeAtomic", () => {
  test("#given Atomic is off or not authorized #when probed #then nothing is spawned", async () => {
    // given
    const cli = cliOutput()
    const disabled = { settings: OmoAtomicSettingsSchema.parse({}), authorized: false }
    const projectEnabled = { settings: OmoAtomicSettingsSchema.parse({ enabled: true }), authorized: false }

    // when
    const results = await Promise.all([
      probeAtomic(options(cli.spawn, { policy: disabled })),
      probeAtomic(options(cli.spawn, { policy: projectEnabled })),
    ])

    // then
    expect(results).toEqual([{ kind: "disabled" }, { kind: "unauthorized" }])
    expect(cli.requests).toEqual([])
  })

  test("#given PATH with empty, relative and in-repository segments #when probed #then only the trusted binary runs", async () => {
    // given
    const dirs = layout()
    const cli = cliOutput()
    const pathValue = ["", "relative/bin", dirs.repositoryBin, dirs.trustedBin].join(":")

    // when
    const probe = await probeAtomic(options(cli.spawn, { cwd: dirs.repository, environment: { PATH: pathValue } }))

    // then
    expect(probe.kind).toBe("ready")
    if (probe.kind !== "ready") return
    expect(probe.executable).toBe(dirs.trusted)
    expect(new Set(cli.requests.map((request) => request.executable))).toEqual(new Set([dirs.trusted]))
    expect(probe.version.text).toBe("0.22.1")
    expect([probe.compatibility, probe.identity, probe.capabilities]).toEqual(["supported", "present", { mutations: true, recording: true }])
    expect(probe.currentView).toBe(JSON.parse(readFixture("status-json.txt")).view)
  })

  test("#given a configured binary_path #when probed #then it wins over PATH", async () => {
    // given
    const dirs = layout()
    const configured = makeExecutable(join(dirs.trustedBin, "..", "configured"))
    const cli = cliOutput()
    const policy = { settings: OmoAtomicSettingsSchema.parse({ enabled: true, binary_path: configured }), authorized: true }

    // when
    const probe = await probeAtomic(options(cli.spawn, { cwd: dirs.repository, policy, environment: { PATH: dirs.trustedBin } }))

    // then
    expect(probe.kind === "ready" ? probe.executable : probe.kind).toBe(configured)
  })

  test("#given only an in-repository binary #when probed #then the binary counts as missing", async () => {
    // given
    const dirs = layout()
    const cli = cliOutput()

    // when
    const probe = await probeAtomic(options(cli.spawn, { cwd: dirs.repository, environment: { PATH: dirs.repositoryBin } }))

    // then
    expect(unavailableCode(probe)).toBe("binary_missing")
    expect(cli.requests).toEqual([])
  })

  test("#given version output #when probed #then old releases are unavailable and newer families degrade", async () => {
    // given
    const dirs = layout()
    const environment = { PATH: dirs.trustedBin }
    const old = cliOutput({ "--version": exited("atomic 0.21.9\n") })
    const newer = cliOutput({ "--version": exited("atomic 0.23.0\n") })
    const garbled = cliOutput({ "--version": exited("atomic version unknown\n") })

    // when
    const [oldProbe, newerProbe, garbledProbe] = await Promise.all([
      probeAtomic(options(old.spawn, { cwd: dirs.repository, environment })),
      probeAtomic(options(newer.spawn, { cwd: dirs.repository, environment })),
      probeAtomic(options(garbled.spawn, { cwd: dirs.repository, environment })),
    ])

    // then
    expect(unavailableCode(oldProbe)).toBe("version_unsupported")
    expect(newerProbe.kind === "ready" ? [newerProbe.compatibility, newerProbe.capabilities] : newerProbe.kind).toEqual([
      "degraded",
      { mutations: false, recording: false },
    ])
    expect(unavailableCode(garbledProbe)).toBe("invalid_response")
  })

  test("#given a directory outside any Atomic repository #when probed #then it is not_repository", async () => {
    // given
    const dirs = layout()
    const cli = cliOutput({ status: exited("", 3, readFixture("not-repository.stderr.txt")) })

    // when
    const probe = await probeAtomic(options(cli.spawn, { cwd: dirs.repository, environment: { PATH: dirs.trustedBin } }))

    // then
    expect(unavailableCode(probe)).toBe("not_repository")
  })

  test("#given a fresh HOME without an identity #when probed #then identity is missing", async () => {
    // given
    const dirs = layout()
    const cli = cliOutput({
      identity: exited(readFixture("identity-whoami-missing.txt"), 0, readFixture("identity-whoami-missing.stderr.txt")),
    })

    // when
    const probe = await probeAtomic(options(cli.spawn, { cwd: dirs.repository, environment: { PATH: dirs.trustedBin } }))

    // then
    expect(probe.kind === "ready" ? probe.identity : probe.kind).toBe("missing")
  })

  test("#given Windows #when probed #then atomic.exe resolves through ';' and mutations stay disabled", async () => {
    // given
    const dirs = layout()
    const exe = makeExecutable(dirs.trustedBin, "atomic.exe")
    const cli = cliOutput()

    // when
    const probe = await probeAtomic(
      options(cli.spawn, { cwd: dirs.repository, platform: "win32", environment: { Path: `relative;${dirs.trustedBin}` } }),
    )

    // then
    expect(probe.kind === "ready" ? [probe.executable, probe.capabilities] : probe.kind).toEqual([
      exe,
      { mutations: false, recording: false },
    ])
  })
})
