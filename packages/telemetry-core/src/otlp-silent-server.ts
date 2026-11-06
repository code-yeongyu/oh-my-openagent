// A real local collector in its own process that accepts every request and never answers it.
// Prints its port, then one "REQUEST" line per request it receives.
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  fetch: () => {
    process.stdout.write("REQUEST\n")
    return new Promise<Response>(() => undefined)
  },
})
process.stdout.write(`${server.port}\n`)
