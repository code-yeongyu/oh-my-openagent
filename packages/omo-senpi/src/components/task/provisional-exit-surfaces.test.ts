import { afterEach, expect, test } from "bun:test"

import { createCompletionNotifier } from "../../../../senpi-task/src/completion/notifier"
import type { ParentNotifierMessage } from "../../../../senpi-task/src/completion/types"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { exitedTask } from "../../../../senpi-task/src/manager/__fixtures__/provisional-exit"
import { panelChildFromRecord } from "../side-panel/data/task-records"
import { buildWidgetRows, formatTaskRow, isTerminal } from "./status-row-format"
import { createMutationNotifyingStore } from "./store-mutation-observer"
import { createTaskTerminalObservers, type TaskTerminalEdge } from "./terminal-observers"

afterEach(cleanupProjects)

test("provisional process exits stay running in widgets, panel records and terminal notifications", async () => {
  // Given the real manager writing through the adapter's actual terminal-edge observer.
  const observers = createTaskTerminalObservers()
  const edges: TaskTerminalEdge[] = []
  const unsubscribe = observers.subscribe((edge) => edges.push(edge))
  const f = await exitedTask((store) => createMutationNotifyingStore(store, () => {}, observers))
  try {
    const record = f.store.load(f.taskId)
    if (record === null) throw new Error("missing task")
    const messages: ParentNotifierMessage[] = []
    const notifier = createCompletionNotifier({
      store: f.store, stateDir: f.store.stateDir, notifier: { enqueue: (message) => { messages.push(message) } },
    })
    // When UI readers and completion routing inspect the provisional durable record.
    expect(panelChildFromRecord(record).status).toBe("running")
    expect(panelChildFromRecord(record).finishedAt).toBeUndefined()
    expect(formatTaskRow(record)).toContain("status:running")
    expect(buildWidgetRows([record])).toHaveLength(1)
    expect(isTerminal(record.status)).toBe(false)
    expect(notifier.notifyTerminal({ record, runInBackground: true, parentState: { kind: "idle" } }).kind).toBe("skipped")
    // Then no terminal edge or user notification exists until the owning manager confirms.
    expect(edges).toEqual([])
    expect(messages).toEqual([])
    const terminal = f.manager.waitFor(f.taskId)
    f.clock.advance(2_000)
    const failed = await terminal
    expect(edges).toHaveLength(1)
    expect(edges[0]?.record.status).toBe("error")
    expect(panelChildFromRecord(failed).status).toBe("failed")
    expect(notifier.notifyTerminal({ record: failed, runInBackground: true, parentState: { kind: "idle" } }).kind).toBe("delivered")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.details[0]?.status).toBe("error")
  } finally {
    unsubscribe()
    f.dispose()
  }
})
