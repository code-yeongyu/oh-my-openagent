import { z } from "zod"

const requestSchema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.union([
  z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()), z.null(),
]) }).passthrough()) }).passthrough()
export function modelServer(fixedSentinel?: string) {
  const requests: { readonly path: string; readonly sentinel: string }[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 30,
    async fetch(request) {
      const body = requestSchema.safeParse(await request.json())
      if (!body.success) return Response.json({ error: "invalid audit request" }, { status: 400 })
      const content = body.data.messages.findLast((message) => message.role === "user")?.content
      const sentinel = fixedSentinel ?? (typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("") ?? "audit-ok")
      requests.push({ path: new URL(request.url).pathname, sentinel })
      const base = { id: "audit-completion", object: "chat.completion.chunk", created: 1, model: "audit-v1" }
      const records = [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", content: sentinel }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ]
      return new Response(`${records.map((record) => `data: ${JSON.stringify(record)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { server, requests, baseUrl: `http://127.0.0.1:${server.port}/v1` }
}
