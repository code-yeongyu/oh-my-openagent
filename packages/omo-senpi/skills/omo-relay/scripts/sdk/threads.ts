import { batchOf, portErrorOf, settleEach, type BatchOptions, type BatchResult, type Settled } from "./outcome.ts"
import type {
  PortAnswer,
  PortOk,
  ThreadListOptions,
  ThreadPort,
  ThreadReadOptions,
  ThreadReadValue,
  ThreadRow,
  ThreadSendOptions,
  ThreadSendValue,
} from "./ports.ts"

export type ThreadOp<Target, Value> = (target: Target) => Promise<PortAnswer<Value>>

async function settleOne<Target, Value>(
  target: Target,
  op: ThreadOp<Target, Value>,
): Promise<Settled<Target, PortOk<Value>>> {
  try {
    const answer = await op(target)
    if (answer.kind === "error") return { kind: "rejected", target, error: answer.error }
    return { kind: "fulfilled", target, value: answer }
  } catch (thrown) {
    // A throwing callback is that target's failure; the other targets keep running and still settle.
    return { kind: "rejected", target, error: portErrorOf(thrown) }
  }
}

/** Runs `op` on each named thread (a `thread` value, alias or unique name); one outcome per name, in input order. */
export async function onThreads<Value>(
  targets: readonly string[],
  op: ThreadOp<string, Value>,
  options?: BatchOptions,
): Promise<BatchResult<string, PortOk<Value>>> {
  return batchOf(await settleEach(targets, (target) => settleOne(target, op), options?.concurrency))
}

/**
 * Lists the threads once, then runs `op` on every row. Rejects only when the list itself fails, because then
 * there is no target to report against and nothing ran.
 */
export async function onEveryThread<Value>(
  threads: ThreadPort,
  op: ThreadOp<ThreadRow, Value>,
  options?: BatchOptions & { readonly list?: ThreadListOptions },
): Promise<BatchResult<ThreadRow, PortOk<Value>>> {
  const listed = await threads.list(options?.list)
  if (listed.kind === "error") throw new ThreadListError(listed.error)
  return batchOf(await settleEach(listed.threads, (row) => settleOne(row, op), options?.concurrency))
}

export function sendToThreads(
  threads: ThreadPort,
  targets: readonly string[],
  message: string,
  options?: BatchOptions & ThreadSendOptions,
): Promise<BatchResult<string, PortOk<ThreadSendValue>>> {
  const sendOptions: ThreadSendOptions = {
    ...(options?.delivery === undefined ? {} : { delivery: options.delivery }),
    ...(options?.all_scope === undefined ? {} : { all_scope: options.all_scope }),
  }
  return onThreads(targets, (thread) => threads.send(thread, message, sendOptions), options)
}

export function readThreads(
  threads: ThreadPort,
  targets: readonly string[],
  options?: BatchOptions & ThreadReadOptions,
): Promise<BatchResult<string, PortOk<ThreadReadValue>>> {
  const readOptions: ThreadReadOptions = {
    ...(options?.wait_ms === undefined ? {} : { wait_ms: options.wait_ms }),
    ...(options?.max_bytes === undefined ? {} : { max_bytes: options.max_bytes }),
    ...(options?.all_scope === undefined ? {} : { all_scope: options.all_scope }),
  }
  return onThreads(targets, (thread) => threads.read(thread, readOptions), options)
}

export class ThreadListError extends Error {
  readonly code: string
  readonly next_action: string

  constructor(error: { readonly code: string; readonly message: string; readonly next_action: string }) {
    super(error.message)
    this.name = "ThreadListError"
    this.code = error.code
    this.next_action = error.next_action
  }
}
