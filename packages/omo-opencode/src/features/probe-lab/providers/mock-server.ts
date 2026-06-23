export type MockServer = { url: string; close: () => void }

export function startMockServer(handler: (req: Request) => Response | Promise<Response>): MockServer {
  const server = Bun.serve({ port: 0, fetch: handler })
  return { url: `http://localhost:${server.port}`, close: () => { server.stop(true) } }
}
