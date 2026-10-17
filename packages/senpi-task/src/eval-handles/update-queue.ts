import type { HandleSnapshot } from "@code-yeongyu/senpi"

export type UpdateQueue = {
  push(snapshot: HandleSnapshot): void
  end(): void
  readonly updates: AsyncIterable<HandleSnapshot>
}

export function createUpdateQueue(): UpdateQueue {
  const buffered: HandleSnapshot[] = []
  let waiting: ((result: IteratorResult<HandleSnapshot>) => void) | undefined
  let ended = false
  const push = (snapshot: HandleSnapshot): void => {
    if (ended) return
    if (waiting === undefined) {
      buffered.push(snapshot)
      return
    }
    const resolve = waiting
    waiting = undefined
    resolve({ value: snapshot, done: false })
  }
  const end = (): void => {
    if (ended) return
    ended = true
    const resolve = waiting
    waiting = undefined
    resolve?.({ value: undefined, done: true })
  }
  const next = (): Promise<IteratorResult<HandleSnapshot>> => {
    const head = buffered.shift()
    if (head !== undefined) return Promise.resolve({ value: head, done: false })
    if (ended) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => { waiting = resolve })
  }
  return { push, end, updates: { [Symbol.asyncIterator]: () => ({ next, return: async () => { end(); return { value: undefined, done: true } } }) } }
}
