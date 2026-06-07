import http from "node:http"
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

const runtime = globalThis as typeof globalThis & { Bun?: BunServeRuntime }

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

export async function createRuntimeSkillSourceServer(options: {
  readonly skills: readonly RuntimeSkillSourceEntry[]
}): Promise<RuntimeSkillSourceServer> {
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

  const bun = runtime.Bun
  if (bun) {
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

  // Node.js HTTP server fallback for non-Bun environments (like Electron)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "", "http://127.0.0.1")
    if (url.pathname === "/" || url.pathname === "/index.json") {
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      })
      res.end(JSON.stringify(index))
      return
    }

    const markdown = skillMarkdownByPath.get(url.pathname)
    if (markdown) {
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/markdown; charset=utf-8",
      })
      res.end(markdown)
      return
    }

    res.writeHead(404, { "content-type": "text/plain" })
    res.end("not found")
  })

  await new Promise<void>((resolve, reject) => {
    server.on("listening", resolve)
    server.on("error", reject)
    server.listen(0, "127.0.0.1")
  })

  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/`,
    fetch: handleRequest,
    stop: () => {
      server.close()
    },
  }
}
