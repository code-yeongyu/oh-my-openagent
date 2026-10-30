import { adaptInProcessHandle } from "../../../manager/child-handle"
import { InProcessRunner } from "../../in-process"
import { createBuiltinChildMachine } from "./builtin-child"

// A print-mode run in one process: delegate one in-process task, take its outcome, tear the child
// down the way the task lifecycle does, then return from the top level and let the process end.
const turn = process.argv[2] === "fails" ? "fails" : "succeeds"
const machine = await createBuiltinChildMachine()
const child = adaptInProcessHandle(await new InProcessRunner().start(machine.spec("print-run", turn)))
const outcome = await child.waitForOutcome()
await child.dispose()
machine.cleanup()
process.stdout.write(`${JSON.stringify({ status: outcome.status })}\n`)
