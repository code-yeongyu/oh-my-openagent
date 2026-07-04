import { createServer, type ServerResponse } from "node:http"
import type { RuntimeSkillSourceEntry } from "./runtime-skill-config"

export type RuntimeSkillSourceServer = {
  readonly url: string
  readonly fetch: (request: Request) => Response | Promise<Response>
  readonly stop: () => void
}

type BunServeServer = {
  readonly url: URL
  stop(closeActiveConnections?: boolean): void
}

type BunServeRuntime = {
  serve(options: {
    readonly hostname: string
    readonly port: number
    readonly fetch: (request: Request) => Response | Promise<Response>
  }): BunServeServer
}

type RuntimeSkillSourceRuntime = typeof globalThis & { Bun?: BunServeRuntime }

const runtime = globalThis as RuntimeSkillSourceRuntime

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    headers: {
      "cache-control": "no-store",
    },
  })
}

function markdownResponse(markdown: string): Response {
  return new Response(markdown, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/markdown; charset=utf-8",
    },
  })
}

async function writeResponse(response: Response, output: ServerResponse): Promise<void> {
  output.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  )
  output.end(new Uint8Array(await response.arrayBuffer()))
}

export async function createRuntimeSkillSourceServer(
  options: {
    readonly skills: readonly RuntimeSkillSourceEntry[]
  },
  runtimeEnv: Pick<RuntimeSkillSourceRuntime, "Bun"> = runtime,
): Promise<RuntimeSkillSourceServer> {
  const skillMarkdownByPath = new Map(
    options.skills.map((skill) => [`/${skill.name}/SKILL.md`, skill.markdown]),
  )
  const index = {
    skills: options.skills.map((skill) => ({
      name: skill.name,
      files: ["SKILL.md"],
    })),
  }

  function handleRequest(request: Request): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/" || url.pathname === "/index.json") {
      return jsonResponse(index)
    }

    const markdown = skillMarkdownByPath.get(url.pathname)
    if (markdown) return markdownResponse(markdown)

    return new Response("not found", { status: 404 })
  }

  const bun = runtimeEnv.Bun
  if (!bun) {
    const server = createServer(async (request, response) => {
      try {
        const sourceUrl = new URL(request.url ?? "/", "http://127.0.0.1")
        await writeResponse(await handleRequest(new Request(sourceUrl.toString())), response)
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
        response.end(error instanceof Error ? error.message : String(error))
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(0, "127.0.0.1")
    })

    const address = server.address()
    if (typeof address !== "object" || address === null || typeof address.port !== "number") {
      server.close()
      throw new Error("Runtime skill source server failed to bind a loopback port")
    }

    return {
      url: `http://127.0.0.1:${address.port}/`,
      fetch: handleRequest,
      stop: () => server.close(),
    }
  }

  const server = bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handleRequest,
  })

  return {
    url: server.url.toString(),
    fetch: handleRequest,
    stop: () => server.stop(true),
  }
}
