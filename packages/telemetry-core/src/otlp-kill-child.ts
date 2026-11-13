import { capture, makeTransport } from "./otlp-test-support"

const dir = process.argv[2]
if (dir === undefined) throw new Error("usage: otlp-kill-child.ts <spool dir>")

const transport = makeTransport(dir, { flushAt: 1_000 })
for (let index = 1; index <= 7; index += 1) {
  capture(transport, "feature_used", { event_id: `0190f000-0000-7000-8000-00000000000${index}`, seq: index })
}
process.stdout.write(`EMITTED ${process.pid}\n`)
setInterval(() => undefined, 60_000)
