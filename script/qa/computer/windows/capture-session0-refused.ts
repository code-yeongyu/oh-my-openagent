// Row 55 failure path, run by the workflow's session0 job as SYSTEM in Session 0: capture answers
// PermissionDenied naming the session (reason not_interactive) and no frame is produced. The
// session id is read by the driver's own process, and the job fails unless it is 0.
import type { Engine } from "./engine.ts"
import { sessionId } from "./host.ts"
import { register, type Outcome } from "./scenario.ts"

/** Only Session 0 can prove the refusal; anywhere else --all counts this scenario BLOCKED. */
async function precondition(): Promise<string | undefined> {
  const session = await sessionId()
  return session === 0 ? undefined : `session ${session} is not session 0`
}

async function run(engine: Engine): Promise<Outcome> {
  const session = await sessionId()
  const reply = await engine.call("capture", { target: "desktop" })
  const data = reply.error?.data ?? {}
  const refused = data.code === "PermissionDenied" && data.reason === "not_interactive"
  return {
    pass: session === 0 && reply.result === undefined && refused,
    facts: { sessionId: session, error: reply.error ?? null, frame: reply.result !== undefined },
    receipts: [],
  }
}

register({ name: "capture-session0-refused", admit: "none", precondition, run })
