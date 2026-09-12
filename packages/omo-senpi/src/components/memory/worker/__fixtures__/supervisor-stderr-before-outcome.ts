import { writeSync } from "node:fs"

// The noise line must exceed the smallest configured output budget so the durable log is truncated.
writeSync(2, `diagnostic-noise:${"x".repeat(2_048)}\n`)
writeSync(2, "intentional supervisor pre-child failure\n")
writeSync(2, "error: intentional supervisor pre-child failure\n")
// The trailing block stands in for the interpreter crash output a real uncaught error emits. It is
// padded so the sealed tail cuts the `error:` prefix on every platform while the message itself stays
// inside the tail; an interpreter-generated stack plays the same role but is not platform-independent.
writeSync(2, `trailing-context:${"y".repeat(193)}\n`)
process.exit(1)
