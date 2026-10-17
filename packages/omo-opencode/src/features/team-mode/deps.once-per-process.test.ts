/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, mock, test } from "bun:test"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"

const savedPath = process.env.PATH
type FakeProc = { exited: Promise<number>; kill?: () => void }
let behaviour: (cmd: string) => FakeProc = () => ({ exited: Promise.resolve(0) })
const spawned: string[] = []

beforeEach(async () => {
  spawned.length = 0
  behaviour = () => ({ exited: Promise.resolve(0) })
  mock.module("../../shared/bun-spawn-shim", () => ({
    spawn: (options: { cmd: string[] }) => {
      spawned.push(options.cmd.join(" "))
      return behaviour(options.cmd[0] ?? "")
    },
  }))
  const { resetTeamModeProbeCache } = await import("./deps")
  resetTeamModeProbeCache()
  process.env.PATH = "/fix47/path-a"
})

afterEach(() => {
  mock.restore()
  process.env.PATH = savedPath
})

const config = () => TeamModeConfigSchema.parse({})

test("default-spawner probes run once per process and PATH (local fix 47)", async () => {
  const { checkTeamModeDependencies } = await import("./deps")

  const first = await checkTeamModeDependencies(config(), { tmuxEnv: "" })
  const second = await checkTeamModeDependencies(config(), { tmuxEnv: "" })

  expect(first).toEqual({ tmuxAvailable: true, gitAvailable: true })
  expect(second).toEqual(first)
  expect(spawned).toEqual(["tmux -V", "git --version"])
})

test("concurrent callers share one in-flight probe", async () => {
  const { checkTeamModeDependencies } = await import("./deps")
  let release: (code: number) => void = () => {}
  const gate = new Promise<number>((resolve) => { release = resolve })
  behaviour = () => ({ exited: gate })

  const a = checkTeamModeDependencies(config(), { tmuxEnv: "set" })
  const b = checkTeamModeDependencies(config(), { tmuxEnv: "set" })
  release(0)

  expect(await a).toEqual({ tmuxAvailable: true, gitAvailable: true })
  expect(await b).toEqual({ tmuxAvailable: true, gitAvailable: true })
  expect(spawned).toEqual(["git --version"])
})

test("a probe that never exits is killed at its deadline, settles unavailable and is not remembered", async () => {
  const { checkTeamModeDependencies } = await import("./deps")
  let killed = 0
  behaviour = () => ({ exited: new Promise<number>(() => {}), kill: () => { killed += 1 } })

  const started = Date.now()
  const report = await checkTeamModeDependencies(config(), { tmuxEnv: "set", probeTimeoutMs: 50 })

  expect(report).toEqual({ tmuxAvailable: true, gitAvailable: false })
  expect(Date.now() - started).toBeLessThan(2_000)
  expect(killed).toBe(1)

  behaviour = () => ({ exited: Promise.resolve(0) })
  const retried = await checkTeamModeDependencies(config(), { tmuxEnv: "set", probeTimeoutMs: 50 })
  expect(retried.gitAvailable).toBe(true)
  expect(spawned).toEqual(["git --version", "git --version"])
})

test("a spawn failure is remembered only for the negative TTL, then the probe recovers", async () => {
  const { checkTeamModeDependencies } = await import("./deps")
  let clock = 1_000
  const now = () => clock
  behaviour = () => { throw new Error("ENOENT") }

  expect((await checkTeamModeDependencies(config(), { tmuxEnv: "set", now })).gitAvailable).toBe(false)
  behaviour = () => ({ exited: Promise.resolve(0) })
  expect((await checkTeamModeDependencies(config(), { tmuxEnv: "set", now })).gitAvailable).toBe(false)
  expect(spawned).toEqual(["git --version"])

  clock += 5 * 60_000 + 1
  expect((await checkTeamModeDependencies(config(), { tmuxEnv: "set", now })).gitAvailable).toBe(true)
  expect(spawned).toEqual(["git --version", "git --version"])
})

test("a PATH change probes again", async () => {
  const { checkTeamModeDependencies } = await import("./deps")

  await checkTeamModeDependencies(config(), { tmuxEnv: "set" })
  process.env.PATH = "/fix47/path-b"
  await checkTeamModeDependencies(config(), { tmuxEnv: "set" })

  expect(spawned).toEqual(["git --version", "git --version"])
})

test("an injected spawner is never cached and is bounded by the same deadline", async () => {
  const { checkTeamModeDependencies } = await import("./deps")
  let calls = 0
  const spawn = (() => {
    calls += 1
    return { exited: new Promise<number>(() => {}), kill: () => {} }
  }) as never

  const report = await checkTeamModeDependencies(config(), { spawn, tmuxEnv: "", probeTimeoutMs: 30 })
  await checkTeamModeDependencies(config(), { spawn, tmuxEnv: "", probeTimeoutMs: 30 })

  expect(report).toEqual({ tmuxAvailable: false, gitAvailable: false })
  expect(calls).toBe(4)
})
