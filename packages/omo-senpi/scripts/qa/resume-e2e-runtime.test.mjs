import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  findTaskByName,
  readTaskRecords,
  revivedAfterSuspend,
  sessionIdFromEvents,
  waitForFileCommand,
  waitForRecordStatusCommand,
} from "./resume-e2e-runtime.mjs"
import { taskSendRevived } from "./task-resume-e2e.mjs"
import {
  CONTINUATION_MARKER,
  MIDTURN_CONTINUED_TOKEN,
  PING_TOKEN,
  PONG_TOKEN,
} from "./task-resume-e2e-scenarios.mjs"
import {
  CONTINUATION_MARKER as PROVIDER_CONTINUATION_MARKER,
  MIDTURN_CONTINUED_TOKEN as PROVIDER_MIDTURN_CONTINUED_TOKEN,
  PING_TOKEN as PROVIDER_PING_TOKEN,
  PONG_TOKEN as PROVIDER_PONG_TOKEN,
  routeChildStep,
} from "./task-resume-e2e-mock-provider.ts"

describe("token contract", () => {
  test("#given the scenarios module and the mock provider #when tokens compare #then they are identical", () => {
    expect(CONTINUATION_MARKER).toBe(PROVIDER_CONTINUATION_MARKER)
    expect(MIDTURN_CONTINUED_TOKEN).toBe(PROVIDER_MIDTURN_CONTINUED_TOKEN)
    expect(PING_TOKEN).toBe(PROVIDER_PING_TOKEN)
    expect(PONG_TOKEN).toBe(PROVIDER_PONG_TOKEN)
  })
})

describe("routeChildStep", () => {
  const childContext = (messages) => ({ messages })

  test("#given the continuation nudge as the last user message #when routing #then the mid-turn child finishes", () => {
    const context = childContext([
      { role: "user", content: "midturn-child first unit" },
      { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
      { role: "user", content: `Your previous turn was ${CONTINUATION_MARKER}. Resume.` },
    ])
    expect(routeChildStep(context)).toEqual({ type: "text", text: MIDTURN_CONTINUED_TOKEN })
  })

  test("#given the unique ping as the last user message #when routing #then the pong proves steerability", () => {
    const context = childContext([
      { role: "user", content: "finished-child second unit" },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: `${PING_TOKEN} post-resume steerability probe` },
    ])
    const step = routeChildStep(context)
    expect(step.type).toBe("text")
    expect(step.text).toContain(PONG_TOKEN)
  })

  test("#given a mid-turn child prompt #when no assistant message exists #then turn one is an instant read", () => {
    const step = routeChildStep(childContext([{ role: "user", content: "midturn-child first unit" }]))
    expect(step).toEqual({ type: "tool_call", name: "read", arguments: { path: "mock-script.json" } })
  })

  test("#given a mid-turn child after its first tool result #when an assistant message exists #then it hangs mid-turn", () => {
    const context = childContext([
      { role: "user", content: "midturn-child first unit" },
      { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
      { role: "toolResult", content: [{ type: "text", text: "file bytes" }] },
    ])
    expect(routeChildStep(context)).toEqual({ type: "hang" })
  })

  test("#given a finished child prompt #when routing #then a plain text completes it", () => {
    const step = routeChildStep(childContext([{ role: "user", content: "finished-child second unit" }]))
    expect(step.type).toBe("text")
  })
})

describe("sessionIdFromEvents", () => {
  test("#given a json event stream #when the session header is present #then its id is returned", () => {
    expect(sessionIdFromEvents([{ type: "session", id: "abc-123" }, { type: "message" }])).toBe("abc-123")
  })

  test("#given no session header #when extracting #then undefined", () => {
    expect(sessionIdFromEvents([{ type: "message" }])).toBeUndefined()
  })
})

describe("revivedAfterSuspend", () => {
  test("#given a suspend then a resident transition #when scanning the log #then revival is proven", () => {
    const log = [
      JSON.stringify({ type: "transition_applied", payload: { status: "running", residency_state: "resident" } }),
      JSON.stringify({ type: "suspended", payload: { reason: "quit" } }),
      JSON.stringify({ type: "transition_applied", payload: { status: "running", residency_state: "resident" } }),
    ].join("\n")
    expect(revivedAfterSuspend(log)).toBe(true)
  })

  test("#given no suspension #when scanning #then no revival", () => {
    const log = JSON.stringify({ type: "transition_applied", payload: { status: "running", residency_state: "resident" } })
    expect(revivedAfterSuspend(log)).toBe(false)
  })

  test("#given only non-resident transitions after the suspend #when scanning #then no revival", () => {
    const log = [
      JSON.stringify({ type: "suspended", payload: { reason: "quit" } }),
      JSON.stringify({ type: "transition_applied", payload: { status: "completed", residency_state: "persisted_only" } }),
    ].join("\n")
    expect(revivedAfterSuspend(log)).toBe(false)
  })

  test("#given a reconcile_reattached event after the suspend #when scanning #then revival is proven", () => {
    // The reconcile claim is a store.mutate CAS (no transition_applied line); the reattach event is
    // the durable revival signal for terminal witnesses that never run another turn.
    const log = [
      JSON.stringify({ type: "transition_applied", payload: { status: "completed", residency_state: "persisted_only" } }),
      JSON.stringify({ type: "suspended", payload: { reason: "quit" } }),
      JSON.stringify({ type: "reconcile_reattached", payload: {} }),
    ].join("\n")
    expect(revivedAfterSuspend(log)).toBe(true)
  })
})

describe("taskSendRevived", () => {
  test("#given a task_send result reviving the finished child #when searching #then it matches", () => {
    const events = [
      { type: "tool_execution_end", toolName: "task_send", result: { details: { kind: "revived", task_id: "st_fin", run_epoch: 1 } } },
    ]
    expect(taskSendRevived(events, "st_fin")).toBe(true)
  })

  test("#given a revived result for a different task #when searching #then no match", () => {
    const events = [
      { type: "tool_execution_end", toolName: "task_send", result: { details: { kind: "revived", task_id: "st_other", run_epoch: 1 } } },
    ]
    expect(taskSendRevived(events, "st_fin")).toBe(false)
  })
})

describe("agent-side wait commands", () => {
  test("#given a sentinel path #when building the wait command #then the path is embedded and no sleep is asserted", () => {
    const command = waitForFileCommand("/tmp/release-1")
    expect(command).toContain("node -e")
    expect(command).toContain('"/tmp/release-1"')
    expect(command).toContain("existsSync")
  })

  test("#given a record wait #when building the command #then name and status are argv", () => {
    const command = waitForRecordStatusCommand("/tmp/project", "lruone", "completed")
    expect(command).toContain('"lruone"')
    expect(command).toContain('"completed"')
    expect(command).toContain(JSON.stringify(join("/tmp/project", ".omo", "senpi-task", "tasks")))
  })
})

describe("store readers", () => {
  test("#given a fixture store #when reading records #then findTaskByName matches", () => {
    const root = mkdtempSync(join(tmpdir(), "resume-e2e-store-"))
    try {
      const tasksDir = join(root, ".omo", "senpi-task", "tasks")
      mkdirSync(tasksDir, { recursive: true })
      writeFileSync(join(tasksDir, "st_one.json"), `${JSON.stringify({ task_id: "st_one", name: "midchild", status: "running", residency_state: "persisted_only" })}\n`)
      writeFileSync(join(tasksDir, "st_two.json"), `${JSON.stringify({ task_id: "st_two", name: "finchild", status: "completed", residency_state: "resident" })}\n`)
      expect(readTaskRecords(root)).toHaveLength(2)
      expect(findTaskByName(root, "midchild")?.task_id).toBe("st_one")
      expect(findTaskByName(root, "missing")).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
