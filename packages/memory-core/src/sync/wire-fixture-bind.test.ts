import { expect, test } from "bun:test"

import { startChainWireServer } from "./account/testing/chain-wire-server.test-support.ts"
import { startWireServer } from "./engine/adapters/wire-server.test-support.ts"

// Platform contract of the sync wire fixtures: the client dials 127.0.0.1, so a fixture must own that
// exact address. On a wildcard bind, another process on the host (a parallel test run) may bind
// 127.0.0.1 on the same port and answer the fixture's requests with its own 404s.
const CONTENDER = `
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.CONTENDER_PORT), fetch: () => new Response("contender", { status: 404 }) })
console.log("BOUND " + server.port)
for await (const _ of process.stdin) {}
server.stop(true)
`

const fixtures = [
  { name: "account chain wire server", start: () => startChainWireServer("acct-bind", []) },
  { name: "engine wire server", start: () => startWireServer({ token: "t", devices: { a: "device-a" } }) },
]

for (const { name, start } of fixtures) {
  test(`the ${name} answers its own requests while another process tries to bind its loopback port`, async () => {
    const server = start()
    const port = Number(new URL(server.url).port)
    const contender = Bun.spawn([process.execPath, "-e", CONTENDER], {
      env: { ...process.env, CONTENDER_PORT: String(port) },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    })
    try {
      // given: the contender either bound the port (it prints BOUND) or failed to and exited
      const outcome = async (): Promise<string> => {
        let printed = ""
        for await (const chunk of contender.stdout) {
          printed += new TextDecoder().decode(chunk)
          if (printed.includes("BOUND")) return printed.trim()
        }
        return `exited ${await contender.exited}`
      }
      let deadline: ReturnType<typeof setTimeout> | undefined
      const settled = await Promise.race([
        outcome(),
        new Promise<string>((resolve) => { deadline = setTimeout(() => resolve("the contender neither bound nor exited within 10 s"), 10_000) }),
      ])
      clearTimeout(deadline)

      // when: the client dials the fixture's URL with no credentials
      const response = await fetch(`${server.url}/v1/sync/state`, { headers: { connection: "close" } })

      // then: the fixture itself refuses it; the contender never got the port
      expect({ status: response.status, body: await response.json().catch(() => "not the fixture's JSON") }).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } })
      expect(settled).toStartWith("exited ")
    } finally {
      contender.kill()
      await contender.exited
      await server.stop()
    }
  }, 30_000)
}
