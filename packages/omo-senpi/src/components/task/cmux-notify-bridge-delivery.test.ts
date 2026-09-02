import { describe, expect, test } from "bun:test"

import type { ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import { createCmuxNotifyBridge, CMUX_NOTIFY_BODY_MAX_CHARS } from "./cmux-notify-bridge"

type SpawnCall = { readonly path: string; readonly args: readonly string[] }
type Diagnostic =
  | { readonly kind: "spawn_error"; readonly message: string }
  | { readonly kind: "nonzero_exit"; readonly code: number }

function detail(overrides: Partial<ParentNotifierMessage["details"][number]> = {}): ParentNotifierMessage["details"][number] {
  return {
    task_id: "st_1",
    name: "worker",
    status: "completed",
    model: "openai/gpt-5.6-luna-fast",
    duration_ms: 10,
    final_response: "ok",
    continuation_hint: "",
    ...overrides,
  }
}

function message(details: ParentNotifierMessage["details"]): ParentNotifierMessage {
  return {
    customType: "senpi-task.completion",
    content: "completion",
    display: false,
    details,
    triggerTurn: true,
  }
}

function fakeSpawnProcess() {
  let errorListener: (error: Error) => void = () => undefined
  let closeListener: (code: number | null) => void = () => undefined
  let unrefCount = 0
  return {
    process: {
      onError: (listener: (error: Error) => void) => {
        errorListener = listener
      },
      onClose: (listener: (code: number | null) => void) => {
        closeListener = listener
      },
      unref: () => {
        unrefCount += 1
      },
    },
    emitError: (error: Error) => errorListener(error),
    emitClose: (code: number | null) => closeListener(code),
    unrefCount: () => unrefCount,
  }
}

describe("createCmuxNotifyBridge delivery policy", () => {
  test("#given cmux is initially missing #when a later completion retries discovery #then the recovered binary launches", () => {
    // given
    const spawns: SpawnCall[] = []
    let lookups = 0
    const bridge = createCmuxNotifyBridge({
      platform: "darwin",
      pathLookup: () => {
        lookups += 1
        return lookups === 1 ? null : "/usr/local/bin/cmux"
      },
      spawnCmux: (path, args) => spawns.push({ path, args }),
    })

    // when
    bridge.notify(message([detail({ task_id: "st_1" })]))
    bridge.notify(message([detail({ task_id: "st_2" })]))

    // then
    expect(lookups).toBe(2)
    expect(spawns.map((call) => call.path)).toEqual(["/usr/local/bin/cmux"])
  })

  test("#given the default process path #when launch errors and exits nonzero #then structured diagnostics observe both failures", () => {
    // given
    const child = fakeSpawnProcess()
    const diagnostics: Diagnostic[] = []
    const deps = {
      platform: "darwin" as const,
      pathLookup: () => "/missing/cmux",
      spawnProcess: () => child.process,
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    }
    const bridge = createCmuxNotifyBridge(deps)

    // when
    bridge.notify(message([detail()]))
    child.emitError(new Error("launch failed"))
    child.emitClose(17)

    // then
    expect(child.unrefCount()).toBe(1)
    expect(diagnostics).toEqual([
      { kind: "spawn_error", message: "launch failed" },
      { kind: "nonzero_exit", code: 17 },
    ])
  })

  test("#given truncation lands on an emoji boundary #when the body is capped #then it contains no dangling surrogate", () => {
    // given
    const spawns: SpawnCall[] = []
    const bridge = createCmuxNotifyBridge({
      platform: "darwin",
      pathLookup: () => "/usr/local/bin/cmux",
      spawnCmux: (path, args) => spawns.push({ path, args }),
    })
    const token = "UNIQUE_RESPONSE_TOKEN"
    bridge.notify(message([detail({ final_response: token })]))
    const probeBody = spawns[0]?.args[4] ?? ""
    const responseOffset = probeBody.indexOf(token)
    const marker = "(truncated)"
    const sliceLength = CMUX_NOTIFY_BODY_MAX_CHARS - marker.length
    const response = `${"x".repeat(sliceLength - responseOffset - 1)}😀${"z".repeat(100)}`

    // when
    bridge.notify(message([detail({ final_response: response })]))

    // then
    const body = spawns[1]?.args[4] ?? ""
    const lastContentCodeUnit = body.charCodeAt(body.length - marker.length - 1)
    expect(lastContentCodeUnit).not.toBeGreaterThanOrEqual(0xd800)
    expect(body.length).toBeLessThanOrEqual(CMUX_NOTIFY_BODY_MAX_CHARS)
    expect(body.endsWith(marker)).toBe(true)
  })

  test("#given multiline output spilled to a file #when cmux notifies #then the body preserves both transport details", () => {
    // given
    const spawns: SpawnCall[] = []
    const bridge = createCmuxNotifyBridge({
      platform: "darwin",
      pathLookup: () => "/usr/local/bin/cmux",
      spawnCmux: (path, args) => spawns.push({ path, args }),
    })

    // when
    bridge.notify(message([detail({
      final_response: "line one\nline two",
      final_response_file: "local://completion-results/st_1.txt",
    })]))

    // then
    const body = spawns[0]?.args[4] ?? ""
    expect(body).toContain('result:"line one\nline two"')
    expect(body).toContain("result_file:local://completion-results/st_1.txt")
  })
})
