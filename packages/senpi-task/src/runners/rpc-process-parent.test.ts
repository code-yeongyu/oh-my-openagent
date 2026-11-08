import type { ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import type { ForwardableDialog } from "./child-dialogs/forwardable-dialog"
import type { ParentPermissionMode } from "./parent-link"
import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { stopFakeChild } from "./rpc/__fixtures__/stop-fake-child"
import type { RpcSpawnDescriptor } from "./rpc/spawn"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcChildHandle } from "./types"

// #6189 F2c-F2e on the spawned-CLI runner (a classic `--mode rpc` child in its own process): it launches in the
// parent's effective mode, its prompting dialogs are answered on the parent's UI, and it follows the parent's changes.

const WAIT_MS = 5_000
const children: ChildProcess[] = []
const tmpDirs: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) await stopFakeChild(child)
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function parentMode(initial: string | undefined): ParentPermissionMode & { change(preset: string): void } {
  let current = initial
  const listeners = new Set<(preset: string) => void>()
  return {
    current: () => current,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    change: (preset) => { current = preset; for (const listener of listeners) listener(preset) },
  }
}

function startChild(options: {
  readonly mode?: ParentPermissionMode
  readonly forwarder?: ChildDialogForwarder
  readonly env?: Readonly<Record<string, string>>
}): { readonly started: Promise<RpcChildHandle>; readonly descriptor: () => RpcSpawnDescriptor | undefined; readonly commandLog: string } {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-6189-"))
  tmpDirs.push(stateDir)
  const commandLog = join(stateDir, "commands.jsonl")
  let descriptor: RpcSpawnDescriptor | undefined
  const runner = new RpcProcessRunner({
    ...(options.mode === undefined ? {} : { parentPermission: options.mode }),
    ...(options.forwarder === undefined ? {} : { dialogs: options.forwarder }),
    spawnChild: (built) => {
      descriptor = built
      const child = spawnFakeChild({ ...built.env, FAKE_COMMAND_LOG: commandLog, ...options.env })
      children.push(child)
      return child
    },
  })
  const started = runner.start({ task_id: "st_6189b", cwd: process.cwd(), state_dir: stateDir, prompt: "hold" })
  return { started, descriptor: () => descriptor, commandLog }
}

function nextEvent(handle: RpcChildHandle, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for session_info_changed ${name}, never seen`)), WAIT_MS)
    handle.subscribe((event) => {
      if (event.type === "session_info_changed" && "name" in event && event.name === name) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

describe("RpcProcessRunner with a parent session", () => {
  test("#given a parent whose next gated decision asks #when a child launches #then it launches with --permission-preset ask", async () => {
    // given
    const launched = startChild({ mode: parentMode("ask") })

    // when
    await launched.started

    // then
    const args = launched.descriptor()?.args ?? []
    expect(args.slice(args.indexOf("--permission-preset"), args.indexOf("--permission-preset") + 2)).toEqual(["--permission-preset", "ask"])
  })

  test("#given a parent with no permission system #when a child launches #then no mode is named", async () => {
    // given
    const launched = startChild({ mode: parentMode(undefined) })

    // when
    await launched.started

    // then
    expect(launched.descriptor()?.args).not.toContain("--permission-preset")
  })

  test("#given a child permission prompt #when the parent answers Allow #then the child receives Allow for that prompt", async () => {
    // given
    const seen: { dialog: ForwardableDialog; taskId: string }[] = []
    const person = Promise.withResolvers<void>()
    const forwarder: ChildDialogForwarder = {
      forward: async (dialog, child) => {
        seen.push({ dialog, taskId: child.taskId })
        await person.promise
        return { kind: "value", value: "Allow" }
      },
    }
    const frame = { id: "ui-b", method: "select", title: "Run bash?", options: ["Allow", "Deny"], toolCallId: "call-b" }
    const launched = startChild({ forwarder, env: { FAKE_EMIT_UI_FRAME: JSON.stringify(frame) } })
    const handle = await launched.started
    const answered = nextEvent(handle, "ui:value:Allow")

    // when
    person.resolve()
    await answered

    // then
    expect(seen).toEqual([{ taskId: "st_6189b", dialog: { method: "select", title: "Run bash?", options: ["Allow", "Deny"], toolCallId: "call-b" } }])
  })

  test("#given a running child in full-access #when the parent moves to ask #then the child is sent set_permission_preset ask", async () => {
    // given
    const mode = parentMode("full-access")
    const launched = startChild({ mode })
    const handle = await launched.started
    const applied = nextEvent(handle, "preset:ask")

    // when
    mode.change("ask")

    // then
    await applied
    const sent = readFileSync(launched.commandLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type?: string })
      .filter((command) => command.type === "set_permission_preset")
    expect(sent).toEqual([expect.objectContaining({ type: "set_permission_preset", permissionPreset: "ask" })])
  })
})
