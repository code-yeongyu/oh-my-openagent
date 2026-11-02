// Engine-client probes for task-host-e2e.mjs (todo 41). `omo daemon status` publishes session COUNTS and
// the task store collapses a start failure to one fixed sentence, so the two questions those surfaces
// cannot answer - what a session's context carries, and why `open_session` refused - are asked straight
// on the socket with the engine client this repo pins. Both are DIAGNOSTICS: a binary whose engine
// cannot be imported here reports `unavailable` rather than failing a scenario on a harness dependency.

import { createConnection } from "node:net"

async function withClient(socketPath, use) {
  let client
  try {
    const { RpcClient } = await import("@code-yeongyu/senpi")
    client = new RpcClient({ socketPath, onDisconnect: () => {} })
    await client.start()
    return await use(client)
  } catch (error) {
    return { probe: `unavailable: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    await client?.stop().catch(() => {})
  }
}

export async function probeSessionContext(socketPath) {
  // Older SDK listSessions() drops options. Send the worker-inclusive request on the wire so
  // this read-only census is independent of whatever engine happens to be installed beside QA.
  return await new Promise((resolve) => {
    const socket = createConnection(socketPath)
    let buffer = ""
    const timer = setTimeout(() => finish({ probe: "unavailable: census deadline" }), 60_000)
    const finish = (result) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    socket.setEncoding("utf8")
    socket.on("error", (error) => finish({ probe: `unavailable: ${error.message}` }))
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: "qa-census", type: "list_sessions", include_workers: true })}\n`))
    socket.on("data", (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        let row
        try { row = JSON.parse(line) } catch { continue }
        if (row.id !== "qa-census") continue
        if (row.success !== true) return finish({ probe: `unavailable: ${row.error ?? "census rejected"}` })
        const data = row.data
        return finish({ probe: "ok", rows: Array.isArray(data) ? data : (data?.sessions ?? []) })
      }
    })
  })
}

/**
 * The root-cause probe for a child that could not start: opens ONE worker session exactly the way
 * `RpcHostRunner.openChild` does - a `<stateDir>/sessions/<taskId>/<iso>_<uuid>.jsonl` path, `kind:
 * "worker"`, `retain_on_disconnect` - and reports the host's verbatim refusal.
 */
export async function probeChildSessionOpen(socketPath, cwd, sessionPath) {
  return await withClient(socketPath, async (client) => {
    try {
      const opened = await client.openSession({
        sessionPath,
        cwd,
        provider: "omo-mock",
        modelId: "mock-1",
        kind: "worker",
        context: { role: "child", task_id: "st_probe" },
        retain_on_disconnect: true,
        auto_title: false,
      })
      await client.closeSession(opened.sessionId)
      return { probe: "ok", opened: true, sessionPath }
    } catch (error) {
      return { probe: "ok", opened: false, sessionPath, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
