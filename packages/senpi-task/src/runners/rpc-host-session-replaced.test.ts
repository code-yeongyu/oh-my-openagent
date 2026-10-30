import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { TaskRecord } from "../state"
import type { FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import { startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"
import type { HostSessionReplaced } from "./rpc-host/session-client"

/**
 * F9 / omo#10018 (child half): a raw client can issue `new_session` on a child's routing handle;
 * the host keeps the handle, moves the session to a new durable id and transcript, and pushes
 * `session_replaced` to every attached client. The child must FOLLOW instead of reopening the
 * abandoned transcript on the next reattach: the handle's identity moves to the new path, the
 * record's host_session.session_path and child_session_id are re-stamped, and a `replaced` event
 * lands in the task log. Frames tagged for another routing handle stay dropped by `isRoutedTo`.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

type Child = { readonly world: HostWorld; readonly parent: ParentSession; readonly record: TaskRecord; readonly routingId: string }

async function oneChild(options: { readonly host?: FakeHostOptions; readonly parent?: Parameters<HostWorld["connect"]>[1] } = {}): Promise<Child> {
  const world = await startHostWorld({ drainRetryAfterMs: 250, ...options.host })
  worlds.push(world)
  const parent = world.connect("parent-a", { maxDrainAttempts: 1, ...options.parent })
  await parent.startChildren(1)
  const [record] = parent.records()
  const [session] = world.host.sessions()
  if (record === undefined || session === undefined) throw new Error("the child did not start on the host")
  return { world, parent, record, routingId: session.routingId }
}

// The manager's replace watch was registered when the run was tracked, so a listener added now
// runs after it: the re-stamp has reached the record by the time this resolves. Nothing is polled.
function replaceSeen(child: Child): Promise<HostSessionReplaced> {
  const handle = child.parent.manager.getResidentHandle(child.record.task_id)
  if (handle?.onReplaced === undefined) throw new Error("the child handle exposes no onReplaced seam: session_replaced is not observed")
  return new Promise<HostSessionReplaced>((resolve) => {
    handle.onReplaced?.((event) => resolve(event))
  })
}

function emitReplaced(child: Child, durableSessionId: string, sessionFile: string): void {
  child.world.host.emitRecord(child.routingId, {
    type: "session_replaced",
    durableSessionId,
    sessionFile,
    cwd: child.world.projectDir,
    sessionName: "replaced child",
  })
}

function taskEvents(parent: ParentSession, taskId: string): readonly { readonly type: string; readonly payload: unknown }[] {
  return readFileSync(join(parent.store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: unknown })
}

describe("a child whose session the host replaces", () => {
  test("#given a running child #when the host replaces its session #then the record follows the new identity and a replaced event lands in the task log", async () => {
    // given
    const child = await oneChild()
    const seen = replaceSeen(child)
    const sessionFile = join(child.world.projectDir, "replaced-child.jsonl")

    // when
    emitReplaced(child, "durable-replaced-1", sessionFile)
    const event = await seen

    // then - the child keeps running under the NEW identity; the routing handle stays
    expect(event).toMatchObject({ durableSessionId: "durable-replaced-1", sessionFile })
    const record = child.parent.store.load(child.record.task_id)
    expect(record?.status).toBe("running")
    expect(record?.residency_state).toBe("resident")
    expect(record?.host_session?.session_path).toBe(sessionFile)
    expect(record?.host_session?.routing_id).toBe(child.routingId)
    expect(record?.child_session_id).toBe("durable-replaced-1")
    expect(taskEvents(child.parent, child.record.task_id).filter((entry) => entry.type === "replaced")).toEqual([
      { type: "replaced", payload: { session_path: sessionFile, durable_session_id: "durable-replaced-1" } },
    ])
  })

  test("#given a running child #when the host replaces its session mid-turn #then the child ends interrupted with the replacement as its cause and a task_send action", async () => {
    // given
    const child = await oneChild()
    const seen = replaceSeen(child)
    const sessionFile = join(child.world.projectDir, "replaced-child.jsonl")
    const settled = child.parent.manager.waitFor(child.record.task_id)

    // when - senpi stops the turn first, naming the replacement, then announces it
    child.world.host.abortTurn(child.routingId, "partial", { kind: "session_replaced", reason: "new", targetSessionFile: sessionFile, targetSessionId: "durable-replaced-1" })
    emitReplaced(child, "durable-replaced-1", sessionFile)
    await seen
    await settled

    // then
    const record = child.parent.store.load(child.record.task_id)
    expect(record?.status).toBe("interrupted")
    expect(record?.interrupt_cause).toBe("session_replaced")
    expect(record?.error_message).toContain("task_send")
    // The task_send the message asks for reaches the new session only if the record followed it.
    expect(record?.host_session?.session_path).toBe(sessionFile)
    expect(record?.child_session_id).toBe("durable-replaced-1")
  })

  test("#given a running child #when the parent interrupts it itself #then it ends interrupted with no cause, so the parent is not notified", async () => {
    // given
    const child = await oneChild()

    // when
    const outcome = await child.parent.manager.interruptTask(child.record.task_id)

    // then
    expect(outcome.kind).toBe("interrupted")
    const record = child.parent.store.load(child.record.task_id)
    expect(record?.status).toBe("interrupted")
    expect(record?.interrupt_cause).toBeUndefined()
  })

  test("#given a replaced child #when its transport drops and recovers #then the reattach reopens the NEW session path and the child finishes there", async () => {
    // given
    const child = await oneChild({ host: { transcripts: true }, parent: { reattachDelaysMs: [0, 0] } })
    const seen = replaceSeen(child)
    const sessionFile = join(child.world.projectDir, "replaced-child.jsonl")
    emitReplaced(child, "durable-replaced-2", sessionFile)
    await seen
    const reopened = child.world.host.waitForCommand("open_session")
    const continued = child.world.host.waitForCommand("prompt")

    // when
    child.world.host.cutConnections()

    // then - the recovery opens the session the replace moved to, never the abandoned transcript
    const command = await reopened
    expect(command.payload.sessionPath).toBe(sessionFile)

    // and the child keeps working on that session once the recovery re-drove its in-flight turn
    await continued
    const live = child.world.host.sessions().find((session) => session.sessionPath === sessionFile)
    if (live === undefined) throw new Error("the host holds no session at the replaced path")
    child.world.host.completeTurn(live.routingId, "done after replace")
    const done = await child.parent.manager.waitFor(child.record.task_id, { signal: AbortSignal.timeout(10_000) })
    expect(done.status).toBe("completed")
    expect(done.final_response).toBe("done after replace")
  })

  test("#given a replace frame tagged for another routing handle on the child's connection #then it is dropped and the child's identity is untouched", async () => {
    // given
    const child = await oneChild()
    const before = child.parent.store.load(child.record.task_id)
    const answered = child.world.host.waitForCommand("extension_ui_response")

    // when - a frame addressed to ANOTHER routing handle lands on this child's connection, then a
    // request the client must answer: the answer proves the bogus frame was read first (one FIFO).
    child.world.host.emitRecord(child.routingId, {
      type: "session_replaced",
      sessionId: "routing-9999",
      durableSessionId: "durable-foreign",
      sessionFile: join(child.world.projectDir, "foreign.jsonl"),
    })
    child.world.host.requestUi(child.routingId, { id: "ui-sync-1", method: "confirm" })
    await answered

    // then
    const after = child.parent.store.load(child.record.task_id)
    expect(after?.host_session?.session_path).toBe(before?.host_session?.session_path)
    expect(after?.child_session_id).toBe(before?.child_session_id)
    expect(taskEvents(child.parent, child.record.task_id).some((entry) => entry.type === "replaced")).toBe(false)
  })
})
