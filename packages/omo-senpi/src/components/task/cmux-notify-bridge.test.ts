import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { IdleInjectionCoordinator, IdleInjectionRetiredError } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { CMUX_NOTIFY_BODY_MAX_CHARS, type CmuxNotifyBridge, createCmuxNotifyBridge } from "./cmux-notify-bridge"
import { createParentNotifier } from "./parent-notifier"

const details = {
  task_id: "st_1",
  name: "worker",
  status: "completed" as const,
  model: "chatgpt-subscription/gpt-5.6-luna-fast",
  duration_ms: 10,
  final_response: "ok",
  continuation_hint: "continue",
}

function completion(overrides: Partial<typeof details> = {}) {
  return {
    customType: "senpi-task.completion" as const,
    content: "st_1 completed",
    display: false,
    details: [{ ...details, ...overrides }],
    triggerTurn: true,
  }
}

function fakePi(): SenpiExtensionAPI {
  return {
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    registerMessageRenderer: () => undefined,
  }
}

function recordingBridge(): CmuxNotifyBridge & { readonly calls: string[] } {
  const calls: string[] = []
  return { calls, notify: (message) => { calls.push(message.details.map((detail) => detail.task_id).join(",")) } }
}

describe("cmux notification for Senpi task completions (#6580)", () => {
  let directory = ""
  let argsFile = ""
  let originalPath: string | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "omo-cmux-"))
    argsFile = join(directory, "args.txt")
    const fakeCmux = join(directory, "cmux")
    writeFileSync(fakeCmux, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}.tmp" && mv "${argsFile}.tmp" "${argsFile}"\n`)
    chmodSync(fakeCmux, 0o755)
    originalPath = process.env.PATH
    process.env.PATH = [directory, originalPath].filter(Boolean).join(delimiter)
  })

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(directory, { recursive: true, force: true })
  })

  function waitForArgs(timeoutMs = 5000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); watcher.close(); resolve(readFileSync(argsFile, "utf8").trimEnd().split("\n")) }
      const watcher = watch(directory, (_event, name) => { if (name === "args.txt") done() })
      const timer = setTimeout(() => { watcher.close(); reject(new Error(`waited ${timeoutMs}ms for the fake cmux to be called, it never ran`)) }, timeoutMs)
    })
  }

  test("#given cmux on PATH on macOS #when a completion is delivered through the coordinator #then cmux notify runs with the task title and body", async () => {
    //#given
    const bridge = createCmuxNotifyBridge({ platform: "darwin" })
    let flush: (() => void) | undefined
    const coordinator = new IdleInjectionCoordinator(() => undefined, { scheduleFlush: (run) => { flush = run } })
    const notifier = createParentNotifier(fakePi(), coordinator, () => true, undefined, undefined, bridge)
    const args = waitForArgs()

    //#when
    notifier.enqueue(completion())
    flush?.()

    //#then
    const [verb, titleFlag, title, bodyFlag, body] = await args
    expect([verb, titleFlag, title, bodyFlag]).toEqual(["notify", "--title", "OMO task completed", "--body"])
    expect(body).toContain("st_1")
  })

  test("#given a completion still in the batch window #when the coordinator retires before the flush #then no notification is sent", () => {
    //#given
    const bridge = recordingBridge()
    const coordinator = new IdleInjectionCoordinator(() => undefined, { scheduleFlush: () => undefined })
    const failures: unknown[] = []
    const notifier = createParentNotifier(fakePi(), coordinator, () => true, (_ids, error) => failures.push(error), undefined, bridge)

    //#when
    notifier.enqueue(completion())
    coordinator.retire()

    //#then
    expect(failures[0]).toBeInstanceOf(IdleInjectionRetiredError)
    expect(bridge.calls).toEqual([])
  })

  test("#given no coordinator #when a completion is sent directly #then the notification follows the send", () => {
    //#given
    const bridge = recordingBridge()
    const notifier = createParentNotifier(fakePi(), undefined, undefined, undefined, undefined, bridge)

    //#when
    notifier.enqueue(completion())

    //#then
    expect(bridge.calls).toEqual(["st_1"])
  })

  test("#given a non-macOS host or no cmux binary #when notify is called #then nothing is spawned", () => {
    //#given
    const spawned: string[] = []
    const spawnProcess = (path: string) => { spawned.push(path); return { onError: () => undefined, onClose: () => undefined, unref: () => undefined } }

    //#when
    createCmuxNotifyBridge({ platform: "linux", pathLookup: () => "/bin/cmux", spawnProcess }).notify(completion())
    createCmuxNotifyBridge({ platform: "darwin", pathLookup: () => null, spawnProcess }).notify(completion())

    //#then
    expect(spawned).toEqual([])
  })

  test("#given a very long completion body #when notify builds its arguments #then the body is capped with a truncation marker", () => {
    //#given
    const captured: (readonly string[])[] = []
    const spawnProcess = (_path: string, args: readonly string[]) => { captured.push(args); return { onError: () => undefined, onClose: () => undefined, unref: () => undefined } }

    //#when
    createCmuxNotifyBridge({ platform: "darwin", pathLookup: () => "/bin/cmux", spawnProcess }).notify(completion({ final_response: "x".repeat(5000) }))

    //#then
    const body = captured[0]?.[4] ?? ""
    expect(body.length).toBeLessThanOrEqual(CMUX_NOTIFY_BODY_MAX_CHARS)
    expect(body.endsWith("(truncated)")).toBe(true)
  })
})
