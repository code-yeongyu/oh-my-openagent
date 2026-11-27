// The lease a revive takes is held from the first revive acquisition until the fold of the LAST
// revive, counting a revive-send still in flight: the fold is ordered against in-flight verbs by the
// run's reservation, so it can never drop the lease while another send of this host revives (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { sendRun, THIS_HOST, type SendAnswer } from "./__fixtures__/send-run"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** B's task manager answer waits at a gate; `entered` resolves when B's send reached it. */
function gatedB(answer: SendAnswer) {
  let open = (): void => undefined
  const gate = new Promise<void>((resolve) => (open = resolve))
  let markEntered = (): void => undefined
  const entered = new Promise<void>((resolve) => (markEntered = resolve))
  const answerFor = async (taskId: string): Promise<SendAnswer> => {
    if (taskId !== "task-b") return "revived"
    markEntered()
    await gate
    return answer
  }
  return { open, entered, answerFor }
}

describe("DAG revive lease across overlapping revive-sends", () => {
  test("#given A reviving and B's revive in flight #when A's child finishes first #then the lease stays for B until B's fold", async () => {
    // given
    const b = gatedB("revived")
    const run = sendRun(cleanupRoots, ["a", "b", "c"], { answer: b.answerFor })
    const revivedA = await run.send("a")
    const sendingB = run.send("b")
    await b.entered

    // when - A's child finishes while B's send is still waiting on its child
    run.manager.complete("task-a")
    await run.manager.waitFor("task-a")
    b.open()
    const revivedB = await sendingB

    // then
    expect(revivedB.delivery).toBe("revive")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    expect(await run.refusalOf(() => run.otherRetry("c"))).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    await revivedA.settled
    expect(run.nodeState("a")).toBe("completed")
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    run.manager.complete("task-b")
    await revivedB.settled
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })

  test("#given A reviving and B's revive in flight #when A's child finishes first and B's revive is refused #then A folds last and the lease leaves with it", async () => {
    // given
    const b = gatedB("refused")
    const run = sendRun(cleanupRoots, ["a", "b"], { answer: b.answerFor })
    const revivedA = await run.send("a")
    const sendingB = run.send("b")
    await b.entered

    // when
    run.manager.complete("task-a")
    await run.manager.waitFor("task-a")
    b.open()
    const refusal = await run.refusalOf(() => sendingB)
    await revivedA.settled

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_continuable" }))
    expect(run.nodeState("a")).toBe("completed")
    expect(run.nodeState("b")).toBe("failed")
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })

  test("#given A's revive folded #when B revives afterwards #then B takes the lease itself", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a", "b"])
    const revivedA = await run.send("a")
    run.manager.complete("task-a")
    await revivedA.settled
    expect(run.read()?.leaseHolderPid).toBeUndefined()

    // when
    const revivedB = await run.send("b")

    // then
    expect(run.leaseAtSend).toEqual([THIS_HOST, THIS_HOST])
    expect(run.read()?.leaseHolderPid).toBe(THIS_HOST)
    run.manager.complete("task-b")
    await revivedB.settled
    expect(run.read()?.leaseHolderPid).toBeUndefined()
  })

  for (const order of [
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
  ]) {
    test(`#given three revived nodes #when they fold in the order ${order.join(", ")} #then the lease leaves exactly with the last fold`, async () => {
      // given
      const run = sendRun(cleanupRoots, ["a", "b", "c"])
      const settled = new Map<string, Promise<void> | undefined>()
      for (const id of ["a", "b", "c"]) settled.set(id, (await run.send(id)).settled)

      // when / then
      for (const [index, id] of order.entries()) {
        run.manager.complete(`task-${id}`)
        await settled.get(id)
        expect(run.read()?.leaseHolderPid).toBe(index === order.length - 1 ? undefined : THIS_HOST)
      }
    })
  }
})
