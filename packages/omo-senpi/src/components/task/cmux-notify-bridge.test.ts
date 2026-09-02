import { describe, expect, test } from "bun:test"

import type { ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import { createCmuxNotifyBridge, CMUX_NOTIFY_BODY_MAX_CHARS } from "./cmux-notify-bridge"

type SpawnCall = { readonly path: string; readonly args: readonly string[] }

function detail(overrides: Partial<ParentNotifierMessage["details"][number]> = {}): ParentNotifierMessage["details"][number] {
  return {
    task_id: "st_1",
    name: "worker",
    status: "completed",
    model: "quotio-openai/gpt-5.6-luna-fast",
    duration_ms: 10,
    final_response: "ok",
    continuation_hint: "",
    ...overrides,
  }
}

function message(details: ParentNotifierMessage["details"]): ParentNotifierMessage {
  return {
    customType: "senpi-task.completion",
    content: details.map((entry) => entry.task_id).join(","),
    display: false,
    details,
    triggerTurn: true,
  }
}

function recorder(): { spawns: SpawnCall[]; spawnCmux: (path: string, args: readonly string[]) => void } {
  const spawns: SpawnCall[] = []
  return {
    spawns,
    spawnCmux: (path, args) => {
      spawns.push({ path, args })
    },
  }
}

function darwinDeps(spawnCmux: (path: string, args: readonly string[]) => void, cmuxPath = "/usr/local/bin/cmux") {
  return {
    platform: "darwin" as const,
    pathLookup: (binaryName: string) => (binaryName === "cmux" ? cmuxPath : null),
    spawnCmux,
  }
}

describe("createCmuxNotifyBridge", () => {
  test("#given a non-darwin platform #when a completion notifies #then no cmux process spawns", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge({
      platform: "linux",
      pathLookup: () => "/usr/local/bin/cmux",
      spawnCmux,
    })

    // when
    bridge.notify(message([detail()]))

    // then the macOS gate blocks the notification entirely
    expect(spawns).toHaveLength(0)
  })

  test("#given darwin without cmux on PATH #when a completion notifies #then no cmux process spawns", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge({
      platform: "darwin",
      pathLookup: () => null,
      spawnCmux,
    })

    // when
    bridge.notify(message([detail()]))

    // then the missing binary gate blocks the notification
    expect(spawns).toHaveLength(0)
  })

  test("#given darwin with cmux on PATH #when one completed task notifies #then cmux notify spawns with the completion title and body", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))

    // when
    bridge.notify(message([detail()]))

    // then
    expect(spawns).toHaveLength(1)
    const call = spawns[0]
    expect(call?.path).toBe("/usr/local/bin/cmux")
    expect(call?.args[0]).toBe("notify")
    expect(call?.args[1]).toBe("--title")
    expect(call?.args[2]).toBe("OMO task completed")
    expect(call?.args[3]).toBe("--body")
    const body = call?.args[4] ?? ""
    expect(body).toContain("id:st_1")
    expect(body).toContain('result:"ok"')
  })

  test("#given an error-terminal task #when it notifies #then the title reports failure", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))

    // when
    bridge.notify(message([detail({ status: "error", final_response: "boom" })]))

    // then
    expect(spawns[0]?.args[2]).toBe("OMO task failed")
  })

  test("#given a lost terminal task #when it notifies #then the title reports loss", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))

    // when
    bridge.notify(message([detail({ status: "lost" })]))

    // then
    expect(spawns[0]?.args[2]).toBe("OMO task lost")
  })

  test("#given mixed statuses batched into one message #when it notifies #then the generic title covers the batch", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))

    // when
    bridge.notify(message([detail({ task_id: "st_1" }), detail({ task_id: "st_2", status: "error" })]))

    // then one notification carries both tasks under the neutral title
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.args[2]).toBe("OMO background tasks")
    expect(spawns[0]?.args[4]).toContain("id:st_1")
    expect(spawns[0]?.args[4]).toContain("id:st_2")
  })

  test("#given an oversized completion body #when it notifies #then the body is truncated at the cap with a marker", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))
    const longResponse = "x".repeat(CMUX_NOTIFY_BODY_MAX_CHARS + 500)

    // when
    bridge.notify(message([detail({ final_response: longResponse })]))

    // then
    const body = spawns[0]?.args[4] ?? ""
    expect(body.length).toBeLessThanOrEqual(CMUX_NOTIFY_BODY_MAX_CHARS)
    expect(body.endsWith("(truncated)")).toBe(true)
  })

  test("#given the cmux spawn throws synchronously #when a completion notifies #then the error never escapes the bridge", () => {
    // given
    const bridge = createCmuxNotifyBridge(
      darwinDeps(() => {
        throw new Error("spawn exploded")
      }),
    )

    // when / then notify swallows the failure so task completion is unaffected
    expect(() => bridge.notify(message([detail()]))).not.toThrow()
  })

  test("#given a message with no details #when it notifies #then nothing spawns", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    const bridge = createCmuxNotifyBridge(darwinDeps(spawnCmux))

    // when
    bridge.notify(message([]))

    // then
    expect(spawns).toHaveLength(0)
  })

  test("#given repeated notifications #when the bridge resolves cmux #then the PATH lookup runs once and is cached", () => {
    // given
    const { spawns, spawnCmux } = recorder()
    let lookups = 0
    const bridge = createCmuxNotifyBridge({
      platform: "darwin",
      pathLookup: (binaryName) => {
        if (binaryName !== "cmux") return null
        lookups += 1
        return "/usr/local/bin/cmux"
      },
      spawnCmux,
    })

    // when two completions notify through the same bridge
    bridge.notify(message([detail({ task_id: "st_1" })]))
    bridge.notify(message([detail({ task_id: "st_2" })]))

    // then the binary resolution happened once
    expect(spawns).toHaveLength(2)
    expect(lookups).toBe(1)
  })
})
