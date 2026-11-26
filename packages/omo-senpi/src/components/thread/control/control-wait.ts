import { type CallWait, type WaitLoss, WaitLost } from "../../call-budget/call-deadline"
import { type ControlRefusal, refuse, type SessionControl } from "./port"

/**
 * A control's wait over its port calls (slice T1b): `read` for each port call before the control's write, `write` for the
 * write itself, each refusing a lost wait as the control's typed refusal, which the control's body answers as data.
 */
export type ControlWait = {
  readonly read: <T>(port: () => Promise<T>) => Promise<T>
  readonly write: <T>(port: () => Promise<T>) => Promise<T>
}

/** A control the caller gave no wait: every port call runs as it is (the thread tools, the shipped facade). */
export const NO_WAIT: ControlWait = { read: (port) => port(), write: (port) => port() }

/**
 * The answer to a lost wait. Before the write was sent nothing changed: `cancelled` for the caller's signal, `timeout` for
 * its deadline. After it was sent the control may have acted: `idempotency_uncertain`, which the receipt book records
 * under the call's key, so a repeat under that key answers it again and acts no second time.
 */
export function waitRefusal(loss: WaitLoss): ControlRefusal {
  const deadline = loss.deadline_ms === undefined ? {} : { deadline_ms: loss.deadline_ms }
  if (loss.sent)
    return refuse(
      "idempotency_uncertain",
      loss.reason === "cancelled"
        ? "The call was cancelled after the control was sent; it may have acted."
        : `The call's deadline (${loss.deadline_ms} ms) passed after the control was sent; it may have acted.`,
      "Read the thread's current state before repeating; a repeat under the same idempotency_key answers this again.",
      { reason: loss.reason, ...deadline },
    )
  return loss.reason === "cancelled"
    ? refuse(
        "cancelled",
        "The call was cancelled before the control was sent; nothing changed.",
        "Call it again if it is still wanted.",
      )
    : refuse(
        "timeout",
        `The call's deadline (${loss.deadline_ms} ms) passed before the control was sent; nothing changed.`,
        "Call it again with a longer deadline_ms.",
        deadline,
      )
}

const refused = (error: unknown): never => {
  throw error instanceof WaitLost ? waitRefusal(error.loss) : error
}

export function controlWait(wait: CallWait): ControlWait {
  return {
    read: (port) => wait.read(port).catch(refused),
    write: (port) => wait.write(port).catch(refused),
  }
}

export function waitedControl(control: SessionControl, wait: ControlWait): SessionControl {
  const { readEntryPage } = control
  return {
    thread_id: control.thread_id,
    ...(control.device === undefined ? {} : { device: control.device }),
    title: control.title,
    visible: () => wait.read(() => control.visible()),
    interrupt: (turnId) => wait.write(() => control.interrupt(turnId)),
    close: (options) => wait.write(() => control.close(options)),
    unload: (options) => wait.write(() => control.unload(options)),
    setName: (name) => wait.write(() => control.setName(name)),
    getAvailableModels: (options) => wait.read(() => control.getAvailableModels(options)),
    getModelState: () => wait.read(() => control.getModelState()),
    setModel: (provider, id) => wait.write(() => control.setModel(provider, id)),
    getAvailableThinkingLevels: () => wait.read(() => control.getAvailableThinkingLevels()),
    setThinkingLevel: (level) => wait.write(() => control.setThinkingLevel(level)),
    getMessages: () => wait.read(() => control.getMessages()),
    ...(readEntryPage === undefined ? {} : { readEntryPage: (read) => wait.read(() => readEntryPage(read)) }),
    waitSettled: (timeoutMs, signal) => wait.read(() => control.waitSettled(timeoutMs, signal)),
    running: () => wait.read(() => control.running()),
    setArchived: (archived) => wait.write(() => control.setArchived(archived)),
    listed: (archived) => wait.read(() => control.listed(archived)),
  }
}
