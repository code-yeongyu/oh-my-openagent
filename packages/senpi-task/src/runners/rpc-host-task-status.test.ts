import { afterEach, describe, expect, test } from "bun:test"

import type { FakeHost } from "./rpc-host/__fixtures__/fake-host"
import { startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"

/**
 * omo#10778: the host learns that a daemon-hosted task is finished the moment its record turns
 * terminal, not only when the parent detaches it cleanly - a parent that crashes before the detach
 * must not leave a finished session that a successor host reopens unattended. A transport reattach
 * starts no new run, so it never flips a finished session back to running.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

function taskStatusOf(context: unknown): unknown {
  return typeof context === "object" && context !== null && "task_status" in context ? context.task_status : undefined
}

/** Resolves once the host has received a patch publishing `status`; checking and arming happen in one tick. */
async function patchSeen(host: FakeHost, status: string): Promise<void> {
  const seen = (): boolean =>
    host.commands.some((command) => command.type === "set_session_context" && taskStatusOf(command.payload.patch) === status)
  while (!seen()) await host.waitForCommand("set_session_context")
}

function within<T>(work: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited 10s for ${what}, it never arrived`)), 10_000)
      timer.unref?.()
    }),
  ])
}

async function finishedChild(): Promise<{ readonly world: HostWorld; readonly parent: ParentSession; readonly taskId: string; readonly sessionPath: string }> {
  const world = await startHostWorld({ transcripts: true })
  worlds.push(world)
  const parent = world.connect("parent-a", { reattachDelaysMs: [0, 0] })
  await parent.startChildren(1)
  const taskId = parent.taskIds()[0]
  const session = world.host.sessions()[0]
  if (taskId === undefined || session === undefined) throw new Error("the child did not start on the host")
  const completed = patchSeen(world.host, "completed")
  world.host.completeTurn(session.routingId, "DONE")
  const settled = await parent.manager.waitFor(taskId, { signal: AbortSignal.timeout(10_000) })
  expect(settled.status).toBe("completed")
  await within(completed, "the completed task_status patch")
  return { world, parent, taskId, sessionPath: session.sessionPath }
}

function publishedStatus(world: HostWorld, sessionPath: string): unknown {
  return taskStatusOf(world.host.sessions().find((live) => live.sessionPath === sessionPath)?.context)
}

describe("a daemon-hosted task publishes its status to the host", () => {
  test("#given a resident child #when its turn finishes #then the host session publishes completed while the child is still attached", async () => {
    // given / when
    const { world, parent, taskId, sessionPath } = await finishedChild()

    // then - no detach happened: the record is resident and the host still holds the attachment
    expect(parent.store.load(taskId)?.residency_state).toBe("resident")
    expect(world.host.sessions().find((live) => live.sessionPath === sessionPath)?.attachments).toBe(1)
    expect(publishedStatus(world, sessionPath)).toBe("completed")
  })

  test("#given a finished resident child #when its transport drops and it reattaches #then the host session still publishes completed", async () => {
    // given
    const { world, parent, taskId, sessionPath } = await finishedChild()
    const reopened = world.host.waitForCommand("open_session")

    // when
    world.host.cutConnections()
    await within(reopened, "the reattach open_session")
    const handle = parent.manager.getResidentHandle(taskId)
    if (handle?.getEntries === undefined) throw new Error("the finished child has no live host-session handle")
    await handle.getEntries()

    // then
    expect(publishedStatus(world, sessionPath)).toBe("completed")
  })

  test("#given a finished resident child #when the host restarts and the child reattaches to its reopened session #then the host session publishes completed again", async () => {
    // given
    const { world, parent, taskId, sessionPath } = await finishedChild()
    const republished = world.host.waitForCommand("set_session_context")

    // when - the restarted host reopens the session from its transcript, with an empty context
    world.host.crash()
    await world.host.restart()
    await within(republished, "the completed mark re-sent after the reattach")
    const handle = parent.manager.getResidentHandle(taskId)
    if (handle?.getEntries === undefined) throw new Error("the finished child has no live host-session handle")
    await handle.getEntries()

    // then
    expect(publishedStatus(world, sessionPath)).toBe("completed")
  })

  test("#given a child that resumes on its own before its finished turn is recorded #when the record reopens #then the host session publishes running", async () => {
    // given
    const world = await startHostWorld({ transcripts: true })
    worlds.push(world)
    const parent = world.connect("parent-a")
    await parent.startChildren(1)
    const session = world.host.sessions()[0]
    if (session === undefined) throw new Error("the child did not start on the host")
    const running = (async () => {
      await patchSeen(world.host, "completed")
      while (taskStatusOf(world.host.commands.filter((command) => command.type === "set_session_context").at(-1)?.payload.patch) !== "running") {
        await world.host.waitForCommand("set_session_context")
      }
    })()

    // when - the turn's end and the child's own next run arrive together, before the terminal write
    world.host.completeTurn(session.routingId, "DONE")
    world.host.emitRecord(session.routingId, { type: "agent_start" })

    // then
    await within(running, "running published after the completed mark")
    expect(publishedStatus(world, session.sessionPath)).toBe("running")
  })
})
