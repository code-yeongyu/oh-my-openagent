import { InProcessRunner } from "../../in-process"
import type { ChildSession } from "../child-handle"
import { acceptsConnections, createBuiltinChildMachine, loopbackPort, openBoundSession, watchHttpServers } from "./builtin-child"

// #9413, run in its own process so no other test file's module state can hide the bridge: start an
// in-process child that loads the builtin extensions (codemode included), note the bridge ports it
// opened, tear it down the way the runner does, and report which of those ports still accept a
// connection. "ac1" disposes a settled child; "ac3" makes handle construction fail, so the runner
// discards the session unstarted.
const scenario = process.argv[2] === "ac3" ? "ac3" : "ac1"
const watch = watchHttpServers()
const machine = await createBuiltinChildMachine()
const listening = (): number[] => watch.servers.filter((server) => server.listening).map(loopbackPort)
let bridges: number[] = []
let startError: string | undefined
if (scenario === "ac1") {
  const handle = await new InProcessRunner().start(machine.spec("ac1-child", "succeeds"))
  await handle.waitForIdle()
  bridges = listening()
  await handle.dispose()
} else {
  const runner = new InProcessRunner({
    createSession: async (options): Promise<ChildSession> => {
      const session = await openBoundSession(options)
      bridges = listening()
      // The real session with only handle construction made to fail: every other member is bound to it.
      return new Proxy(session, {
        get(target, property) {
          if (property === "subscribe") {
            return () => {
              throw new Error("handle construction failed")
            }
          }
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  })
  startError = await runner.start(machine.spec("ac3-child", "succeeds")).then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}
const stillListening = listening()
const stillOpen = (await Promise.all(bridges.map(async (port) => ((await acceptsConnections(port)) ? [port] : [])))).flat()
for (const server of watch.servers) {
  server.closeAllConnections()
  server.close()
}
watch.stop()
machine.cleanup()
// Exit only once the line is flushed: on Windows a write to a pipe completes asynchronously, and
// process.exit() would drop it. The explicit exit still ends the run if a leaked handle would keep it alive.
process.stdout.write(`${JSON.stringify({ bridges: bridges.length, stillListening: stillListening.length, stillOpen: stillOpen.length, startError })}\n`, () => process.exit(0))
