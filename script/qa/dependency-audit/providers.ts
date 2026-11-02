import { once } from "node:events"
import { createServer, type ServerHttp2Session, type ServerHttp2Stream, type IncomingHttpHeaders } from "node:http2"
import { join } from "node:path"
import { classifyFailure, providerSchema } from "./contracts"
import { Rpc } from "./rpc"
import { writeModels, type Runtime } from "./runtime"

export async function captureProviders(runtime: Runtime) {
  const observed: { readonly api: string; readonly path: string }[] = []
  const bedrock = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 10,
    fetch(request) {
      observed.push({ api: "bedrock-converse-stream", path: new URL(request.url).pathname })
      return Response.json({ __type: "UnrecognizedClientException", message: "The security token included in the request is invalid." },
        { status: 403, headers: { "x-amzn-errortype": "UnrecognizedClientException" } })
    },
  })
  const devin = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 10,
    fetch(request) {
      observed.push({ api: "devin-agent", path: new URL(request.url).pathname })
      return Response.json({ code: "unauthenticated", message: "Unauthorized audit credential" }, { status: 401 })
    },
  })
  const sessions = new Set<ServerHttp2Session>()
  const cursor = createServer()
  cursor.on("session", (session) => { sessions.add(session); session.on("close", () => sessions.delete(session)) })
  cursor.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    const path = String(headers[":path"])
    observed.push({ api: "cursor-agent", path })
    stream.respond({ ":status": 401, "content-type": "application/json" })
    stream.end(JSON.stringify({ code: "unauthenticated", message: "Unauthorized audit credential" }))
  })
  try {
    const listening = once(cursor, "listening")
    cursor.listen(0, "127.0.0.1")
    await listening
    const address = cursor.address()
    if (!address || typeof address === "string") throw new TypeError("HTTP/2 server did not bind an IP address")
    const providers = {
      "audit-bedrock": { api: "bedrock-converse-stream", baseUrl: `http://127.0.0.1:${bedrock.port}` },
      "audit-cursor": { api: "cursor-agent", baseUrl: `http://127.0.0.1:${address.port}` },
      "audit-devin": { api: "devin-agent", baseUrl: `http://127.0.0.1:${devin.port}` },
    } as const
    await writeModels(runtime, providers)
    const rows = []
    for (const mode of ["classic", "multi"] as const) {
      for (const [provider, model] of Object.entries(providers)) {
        const before = observed.length
        await using rpc = new Rpc(runtime, mode, provider)
        await rpc.request({ type: "get_protocol_info" })
        const sessionId = mode === "multi" ? await rpc.open(join(runtime.cwd, `${provider}.jsonl`), provider) : undefined
        const message = await rpc.prompt("audit-provider-auth", sessionId)
        const errorMessage = message.errorMessage ?? message.content.map((part) => part.text ?? "").join("")
        const requests = observed.slice(before).filter((request) => request.api === model.api)
        const requestObserved = model.api === "cursor-agent" ? requests.some((request) => request.path === "/agent.v1.AgentService/Run") : requests.length > 0
        rows.push(providerSchema.parse({ mode, api: model.api, requestObserved, stopReason: message.stopReason,
          failureClass: classifyFailure(errorMessage), errorMessage }))
        if (sessionId) await rpc.request({ type: "close_session", sessionId })
      }
    }
    return { pass: rows.every((row) => row.requestObserved && row.failureClass === "auth" && row.stopReason === "error"), rows, requests: observed, serversClosed: true }
  } finally {
    for (const session of sessions) session.destroy()
    await Promise.all([bedrock.stop(true), devin.stop(true), new Promise<void>((resolve, reject) => cursor.close((error) => error ? reject(error) : resolve()))])
  }
}
