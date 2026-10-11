import { describe, expect, it, onTestFinished, spyOn } from "bun:test"
import * as childProcess from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"
import { dispatchInput, sessionEventCtx } from "./ultrawork.test-support"

describe("omo-senpi ultrawork once-per-session arming", () => {
  it("#given the packaged extension reloaded uncached #when the same session triggers on the second load #then injects the reminder not the full directive", async () => {
    // The full plugin also prewarms a real task host. Own its short socket/temp root,
    // observe each warmup's directory removal, and retain its spawn handle (#9766).
    const root = mkdtempSync(process.platform === "win32" ? join(tmpdir(), "omo-ulw-reload-") : "/tmp/omo-ulw-reload-")
    const hosts: Array<{ readonly child: childProcess.ChildProcess; readonly exited: Promise<void> }> = []
    const sessions: FakeExtensionAPI[] = []
    onTestFinished(async () => {
      for (const pi of sessions) await pi.dispatch("session_shutdown", {})
      for (const { child } of hosts) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      }
      const waitForExit = async (): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all(hosts.map(({ exited }) => exited)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("packaged reload task host did not exit")), 10_000)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      let exited = false
      try {
        try {
          await waitForExit()
          exited = true
        } catch (error) {
          for (const { child } of hosts) {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
          }
          await waitForExit()
          exited = true
          throw error
        }
        expect(readdirSync(root).filter((name) => name.startsWith("senpi-rpc-host-internal-"))).toEqual([])
      } finally {
        if (exited) rmSync(root, { recursive: true, force: true })
      }
    })
    const pinned = { TMPDIR: root, TEMP: root, TMP: root, OMO_CODING_AGENT_DIR: join(root, "agent"), OMO_RPC_SHARD_ROOT: join(root, "shards") }
    const previous = Object.fromEntries(Object.keys(pinned).map((name) => [name, process.env[name]]))
    onTestFinished(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    })
    Object.assign(process.env, pinned)
    const spawn = childProcess.spawn
    const spawnSpy = spyOn(childProcess, "spawn")
    onTestFinished(() => spawnSpy.mockRestore())
    spawnSpy.mockImplementation(new Proxy(spawn, {
      apply(target, thisArg, args) {
        const child: childProcess.ChildProcess = Reflect.apply(target, thisArg, args)
        const launchArgs: readonly string[] | undefined = args[1]
        if (launchArgs?.includes("--socket") && launchArgs.some((arg) => arg.startsWith(root))) {
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
          hosts.push({ child, exited })
        }
        return child
      },
    }))
    const warmups = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    let completedWarmups = 0
    const remove = fs.rm
    const rmSpy = spyOn(fs, "rm")
    onTestFinished(() => rmSpy.mockRestore())
    rmSpy.mockImplementation(async (...args: Parameters<typeof remove>) => {
      await remove(...args)
      const path = args[0]
      if (typeof path === "string" && path.startsWith(`${root}/`) && basename(path).startsWith("omo-host-warmup-")) {
        warmups[completedWarmups++]?.resolve()
      }
    })

    // A query-suffixed relative import reproduces Senpi's uncached Jiti importer:
    // Bun keys its module cache on the full specifier (a file URL drops the query).
    const loadPackagedExtension = async (reload: number): Promise<(pi: unknown) => Promise<void>> => {
      const module = await import(`../../../plugin/extensions/omo.js?reload=${reload}`)
      return module.default
    }
    const ctx = { ...sessionEventCtx("session-reload"), cwd: root }
    const piBeforeReload = new FakeExtensionAPI()
    piBeforeReload.cwd = root
    sessions.push(piBeforeReload)
    await (await loadPackagedExtension(1))(piBeforeReload)
    await piBeforeReload.dispatch("session_start", {}, ctx)
    await dispatchInput(piBeforeReload, "ulw first pass")
    if (process.platform !== "win32") await warmups[0]?.promise
    const firstInjection = piBeforeReload.messages.find((call) => call.message["customType"] === "omo-ultrawork:directive")
    expect(firstInjection?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)

    // Reload the entire packaged extension for the same session, whose transcript
    // already contains the directive, and await this registration's own warmup.
    const piAfterReload = new FakeExtensionAPI()
    piAfterReload.cwd = root
    sessions.push(piAfterReload)
    await (await loadPackagedExtension(2))(piAfterReload)
    await piAfterReload.dispatch("session_start", {}, ctx)
    await dispatchInput(piAfterReload, "ulw keep going")
    if (process.platform !== "win32") await warmups[1]?.promise
    if (process.platform !== "win32") expect(hosts).toHaveLength(1)

    const reinjection = piAfterReload.messages.find((call) => call.message["customType"] === "omo-ultrawork:directive")
    const content = reinjection?.message["content"]
    if (typeof content !== "string") throw new Error("expected one ultrawork injection after reload")
    expect(content.length).toBeLessThan(400)
    expect(content).not.toContain("<ultrawork-mode>")
  }, 90_000)
})
