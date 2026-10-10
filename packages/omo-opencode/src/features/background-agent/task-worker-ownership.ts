import { randomUUID } from "node:crypto"
import { createServer, get, type Server } from "node:http"
import { hostname } from "node:os"
import { z } from "zod"
import type { TaskOwner } from "./task-recovery-store"

const OwnerReplySchema = z.object({
  owner: z.string().uuid(), sessionId: z.string(), generation: z.string().uuid(),
  state: z.enum(["owned", "unknown"]),
}).strict()

export class TaskWorkerOwnership {
  private server?: Server
  private identity?: TaskOwner
  private opening?: Promise<TaskOwner>
  private closed = false

  constructor(private readonly inspect: (sessionId: string, generation: string) => Promise<"owned" | "unknown">) {}

  open(): Promise<TaskOwner> {
    if (this.opening) return this.opening
    this.opening = new Promise((resolve, reject) => {
      const ownerId = randomUUID()
      const server = createServer(async (request, response) => {
        try {
          const url = new URL(request.url ?? "/", "http://127.0.0.1")
          const sessionId = url.searchParams.get("session") ?? ""
          const generation = url.searchParams.get("generation") ?? ""
          if (url.pathname !== "/owner" || url.searchParams.get("owner") !== ownerId || this.closed) {
            response.writeHead(404).end()
            return
          }
          const state = await this.inspect(sessionId, generation)
          response.setHeader("Content-Type", "application/json")
          response.end(JSON.stringify({ owner: ownerId, sessionId, generation, state }))
        } catch (error) {
          if (!(error instanceof Error)) throw error
          response.writeHead(503).end()
        }
      })
      this.server = server
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address === null || typeof address === "string" || this.closed) {
          reject(new Error("Worker ownership responder unavailable"))
          server.close()
          return
        }
        this.identity = { id: ownerId, hostname: hostname(), port: address.port }
        server.unref()
        resolve(this.identity)
      })
    })
    return this.opening
  }

  close(): void {
    this.closed = true
    this.server?.closeAllConnections()
    this.server?.close()
  }
}

export function probeTaskOwner(record: { readonly owner: TaskOwner; readonly sessionId: string; readonly generation: string }): Promise<"dead" | "owned" | "unknown"> {
  if (record.owner.hostname !== hostname()) return Promise.resolve("unknown")
  const url = new URL(`http://127.0.0.1:${record.owner.port}/owner`)
  url.searchParams.set("owner", record.owner.id)
  url.searchParams.set("session", record.sessionId)
  url.searchParams.set("generation", record.generation)
  return new Promise((resolve) => {
    const request = get(url, { agent: false, signal: AbortSignal.timeout(1500) }, (response) => {
      let body = ""
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        body += chunk
        if (body.length > 4096) { request.destroy(); resolve("unknown") }
      })
      response.on("error", () => resolve("unknown"))
      response.on("end", () => {
        try {
          const reply = OwnerReplySchema.safeParse(JSON.parse(body))
          resolve(response.statusCode === 200 && reply.success
            && reply.data.owner === record.owner.id && reply.data.sessionId === record.sessionId
            && reply.data.generation === record.generation ? reply.data.state : "unknown")
        } catch (error) {
          if (!(error instanceof Error)) throw error
          resolve("unknown")
        }
      })
    })
    request.on("error", (error) => resolve("code" in error && error.code === "ECONNREFUSED" ? "dead" : "unknown"))
  })
}
