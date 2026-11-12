// Row 55 failure path, run by the workflow's session0 job as SYSTEM in Session 0: capture answers
// PermissionDenied naming the session (reason not_interactive) and no frame is produced. The
// session id is read by the driver's own process, and the job fails unless it is 0.
import type { Engine } from "./engine.ts"
import { register, type Outcome } from "./scenario.ts"

async function sessionId(): Promise<number> {
  const child = Bun.spawn(["powershell", "-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).SessionId`], {
    stdout: "pipe",
  })
  return Number((await new Response(child.stdout).text()).trim())
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

register({ name: "capture-session0-refused", admit: "none", run })
