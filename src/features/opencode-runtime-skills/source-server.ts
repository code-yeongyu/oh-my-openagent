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

export function createRuntimeSkillSourceServer(options: {
  readonly skills: readonly RuntimeSkillSourceEntry[]
}): RuntimeSkillSourceServer {
  const skillMarkdownByPath = new Map(
    options.skills.map((skill) => [`/${skill.name}/SKILL.md`, skill.markdown]),
  )
  const index = {
    skills: options.skills.map((skill) => ({
      name: skill.name,
      files: ["SKILL.md"],
    })),
  }

  const bun = runtime.Bun
  if (!bun) {
    throw new Error("Runtime skill source server requires Bun.serve")
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
