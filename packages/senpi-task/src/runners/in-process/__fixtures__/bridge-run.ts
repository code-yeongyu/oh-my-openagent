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
      return {
        sessionId: session.sessionId,
        extensionRunner: session.extensionRunner,
        prompt: (text) => session.prompt(text),
        steer: (text) => session.steer(text),
        followUp: (text) => session.followUp(text),
        abort: () => session.abort(),
        subscribe: () => {
          throw new Error("handle construction failed")
        },
        getLastAssistantText: () => session.getLastAssistantText(),
        dispose: () => session.dispose(),
      }
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
process.stdout.write(`${JSON.stringify({ bridges: bridges.length, stillListening: stillListening.length, stillOpen: stillOpen.length, startError })}\n`)
process.exit(0)
