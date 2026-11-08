import { join } from "node:path"
import { z } from "zod"
import { AuditError } from "./contracts"
import { modelServer } from "./model-server"
import { Rpc } from "./rpc"
import { writeModels, type Runtime } from "./runtime"

export async function captureRpc(runtime: Runtime) {
  const mock = modelServer()
  try {
    await writeModels(runtime, { "audit-local": { api: "openai-completions", baseUrl: mock.baseUrl } })
    await using rpc = new Rpc(runtime, "multi")
    const protocol = await rpc.request({ type: "get_protocol_info" })
    const paths = [join(runtime.cwd, "first.jsonl"), join(runtime.cwd, "second.jsonl")]
    const sessions = await Promise.all(paths.map(async (path, index) => ({ path, sessionId: await rpc.open(path), sentinel: `audit-route-${index}` })))
    const messages = await Promise.all(sessions.map(async (session) => {
      const message = await rpc.prompt(session.sentinel, session.sessionId)
      const text = message.content.map((part) => part.text ?? "").join("")
      if (text !== session.sentinel || message.stopReason !== "stop") throw new AuditError("rpc routing", JSON.stringify(message))
      return { ...session, text, stopReason: message.stopReason }
    }))
    const first = sessions[0]
    if (!first) throw new AuditError("rpc", "missing first session")
    const reopened = z.object({ sessionId: z.string(), attached: z.literal(true) }).parse((await rpc.request({ type: "open_session", sessionPath: first.path })).data)
    if (reopened.sessionId !== first.sessionId || new Set(sessions.map((session) => session.sessionId)).size !== 2) throw new AuditError("rpc", "session identity mismatch")
    await rpc.request({ type: "close_session", sessionId: first.sessionId })
    for (const session of sessions) await rpc.request({ type: "close_session", sessionId: session.sessionId })
    const listed = z.object({ sessions: z.array(z.unknown()).length(0) }).parse((await rpc.request({ type: "list_sessions" })).data)
    return { pass: true, protocol: protocol.data, sessions: messages, attached: true, workerTeardown: listed.sessions.length === 0, serverClosed: true }
  } finally { await mock.server.stop(true) }
}

const identitySchema = z.object({
  sentinel: z.string(), helperValue: z.literal(42), cwd: z.string(), assetUrl: z.string(),
  identity: z.object({ typebox: z.literal(true), tui: z.literal(true), engine: z.literal(true) }),
  label: z.string(), agentDir: z.string(), packageDir: z.string(),
})
export async function captureExtension(runtime: Runtime) {
  const modes = []
  for (const mode of ["classic", "multi"] as const) {
    await using rpc = new Rpc(runtime, mode)
    await rpc.request({ type: "get_protocol_info" })
    const sessionId = mode === "multi" ? await rpc.open(join(runtime.cwd, "extension.jsonl")) : undefined
    const sentinel = `audit-identity-${mode}`
    const data = identitySchema.parse(await rpc.extension("audit.identity", { sentinel }, sessionId))
    if (data.sentinel !== sentinel || data.label !== sentinel || data.cwd !== runtime.cwd || !data.assetUrl.endsWith("/wide.png")) throw new AuditError("extension", JSON.stringify(data))
    modes.push({ mode, ...data })
    if (sessionId) await rpc.request({ type: "close_session", sessionId })
  }
  return { pass: true, modes }
}

export async function capturePhoton(runtime: Runtime) {
  await using rpc = new Rpc(runtime, "classic")
  await rpc.request({ type: "get_protocol_info" })
  const result = z.object({ data: z.string().min(1), mimeType: z.string(), width: z.literal(800), height: z.literal(400),
    originalWidth: z.literal(3200), originalHeight: z.literal(1600), wasResized: z.literal(true) }).parse(await rpc.extension("audit.photon", {}))
  const output = Buffer.from(result.data, "base64")
  const decoded = await new Bun.Image(output).metadata()
  if (decoded.width !== 800 || decoded.height !== 400) throw new AuditError("photon", "independent decoder dimensions differ")
  const { data: _data, ...observables } = result
  return { pass: true, ...observables, outputBytes: output.byteLength, independentlyDecoded: decoded }
}
