import { readSync, writeSync } from "node:fs"

import { capture, makeTransport } from "./otlp-test-support"

const [mode, dir, endpoint, ...rest] = process.argv.slice(2)
if (mode === undefined || dir === undefined || endpoint === undefined) {
  throw new Error("usage: otlp-spool-child.ts <hang|stall|race> <spool dir> <endpoint> [args]")
}

const say = (line: string): void => {
  writeSync(1, `${line}\n`)
}

// Blocks the whole event loop (no timer, no lease renewal) until the parent writes one byte.
const blockUntilParentWrites = (): void => {
  readSync(0, Buffer.alloc(1), 0, 1, null)
}

let sent = 0
const countingFetch = (url: string, init: RequestInit): Promise<Response> => {
  sent += 1
  return fetch(url, init)
}

if (mode === "hang") {
  const transport = makeTransport(dir, { endpoint, fetch: countingFetch, flushAt: 1_000 })
  for (const id of rest) capture(transport, "feature_used", { event_id: id })
  say("CAPTURED")
  await transport.flush()
} else if (mode === "stall") {
  const sleep = (): Promise<void> => {
    say("STALLED")
    blockUntilParentWrites()
    return Promise.resolve()
  }
  const transport = makeTransport(dir, { endpoint, fetch: countingFetch, flushAt: 1_000, sleep })
  for (const id of rest) capture(transport, "feature_used", { event_id: id })
  await transport.flush()
  say(`FLUSHED ${sent}`)
  process.exit(0)
} else if (mode === "race") {
  const deadPid = Number(rest[0])
  blockUntilParentWrites()
  const transport = makeTransport(dir, {
    endpoint,
    fetch: countingFetch,
    autoStart: true,
    isPidAlive: (pid) => pid !== deadPid,
  })
  await transport.ready
  say(`DONE ${sent}`)
  process.exit(0)
}
