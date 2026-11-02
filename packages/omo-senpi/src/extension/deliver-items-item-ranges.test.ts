import { expect, test } from "bun:test"
import { deliverItems } from "./deliver-items"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"

test("M5: the one send names every item's own text range inside the message, scoped or not", async () => {
  const sends: { readonly content: string; readonly items: readonly { readonly itemId: string; readonly contentRange?: readonly [number, number] }[] }[] = []
  const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((native, delivery) => {
    sends.push({ content: native.content, items: delivery.items })
    return undefined
  }, { ...options, message }))
  coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed", runRef: { kind: "task", id: "st_1" } })
  coordinator.enqueue({ key: "dag-run:r", source: "dag-run", content: "DAG \"r\" paused by your Stop.", contextScoped: true, runRef: { kind: "dag", id: "r" } })
  coordinator.flushOnIdle()
  await Promise.resolve()
  await Promise.resolve()
  expect(sends).toHaveLength(1)
  const [send] = sends
  if (send === undefined) throw new Error("no send")
  expect(send.items.map(item => item.contentRange === undefined ? undefined : send.content.slice(...item.contentRange)))
    .toEqual(["task st_1 completed", "DAG \"r\" paused by your Stop."])
})
