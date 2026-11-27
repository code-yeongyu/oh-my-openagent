import type { ChildSession } from "./child-handle"

// The pre-admission counterpart of rpc/start-cleanup.ts: when handle construction itself throws,
// the session that createSession() already opened belongs to nobody - no handle exists, so neither
// the manager nor the lifecycle destruction port can ever reach it. Discarding it here keeps that
// teardown beside the handle's own dispose, so the single-writer rule still holds: lifecycle remains the only INVOKER for admitted handles.
export async function discardUnstartedChildSession(session: ChildSession): Promise<void> {
  await shutDownChildSession(session)
}

// #9413: a bare dispose() never emits session_shutdown; only senpi's AgentSessionRuntime does. An
// in-process child loads the builtin extensions, and codemode closes its per-session bridge server
// (like every other shutdown-scoped resource) only on session_shutdown, so without this the child
// leaks a listening socket that keeps `omo -p` alive. The runner applies the host's per-handler
// shutdown budget, so a hung handler cannot hold teardown, and dispose() runs either way.
export async function shutDownChildSession(session: ChildSession): Promise<void> {
  try {
    const runner = session.extensionRunner
    if (runner?.hasHandlers("session_shutdown") === true)
      await runner.emit({ type: "session_shutdown", reason: "quit" })
  } finally {
    session.dispose()
    // dispose() folds the session's already-started first-start work into this barrier, so awaiting it keeps a child
    // writer from landing after a caller removes the directory that child's agent dir lives in (#13520).
    await session.whenToolChildClosed?.()
  }
}
