import { createCompletionNotifier } from "../../../completion/notifier"
import type { ParentNotifierMessage } from "../../../completion/types"
import { bounded, recoveryClock } from "../../../lifecycle/__fixtures__/live-parent-clock"
import { observeLifecycleStore } from "../../../lifecycle/__fixtures__/observed-lifecycle-store"
import type { TaskRecordStore } from "../../../store"

/** Observe the real manager/lifecycle writes, with a controlled five-minute recovery budget and host-close deadline. */
export function hostWorldRecovery() {
  const time = recoveryClock()
  const listeners = new Set<() => void>()
  const events: string[] = []
  const messages: ParentNotifierMessage[] = []
  function changed() {
    for (const listener of listeners) listener()
  }
  function until(predicate: () => boolean): Promise<void> {
    const ready = Promise.withResolvers<void>()
    const listener = () => {
      if (predicate()) ready.resolve()
    }
    listeners.add(listener)
    listener()
    return bounded(ready.promise).finally(() => listeners.delete(listener))
  }
  return {
    messages,
    advance: time.advance,
    until,
    eventCount: (type: string) => events.filter((event) => event === type).length,
    attach(backing: TaskRecordStore, sessionId: string) {
      const notifier = createCompletionNotifier({
        store: backing,
        stateDir: backing.stateDir,
        notifier: { enqueue: (message) => messages.push(message) },
        getCurrentSessionId: () => sessionId,
      })
      return {
        store: observeLifecycleStore(backing, {
          changed,
          terminal: (record) => {
            notifier.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
          },
          event: (type) => {
            events.push(type)
            changed()
          },
          beforeMutate: () => undefined,
        }),
        now: () => time.clock.now,
        idleReclaimerScheduler: time.scheduler,
        // A close the host never answers is released by this clock too, not by wall time.
        hostCloseScheduler: time.scheduler,
        onStoreMutation: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    },
  }
}
