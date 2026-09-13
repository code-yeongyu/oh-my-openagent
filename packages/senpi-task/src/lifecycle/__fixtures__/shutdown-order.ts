import { FakeRegistry, type CallLog } from "./lifecycle-fakes"

// A registry that records forget() into the same call log as the fake handles, so tests can prove
// ownership is dropped BEFORE abort settles the turn (the todo-7 outcome guard depends on it).
export class OrderRegistry extends FakeRegistry {
  readonly #order: CallLog

  constructor(order: CallLog) {
    super()
    this.#order = order
  }

  override forget(taskId: string): void {
    this.#order.push(`forget:${taskId}`)
    super.forget(taskId)
  }
}
