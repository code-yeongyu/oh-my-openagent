import { realScheduler, startHeartbeat, type DaemonLink } from "../../src/index.ts"
import { check, sinkLines, spawningWorld } from "./world.ts"

async function openArmed(authority: DaemonLink): Promise<void> {
  await authority.call("session.open", {})
  await authority.call("stopPath.start", { chord: "ctrl+alt+shift+escape" })
  await authority.call("capture", { target: "101" })
}

/** The plan's happy scenario: the spawning host beats stopPath.heartbeat and one click is delivered. */
export async function heartbeatAndClick(engine: string): Promise<boolean> {
  const world = await spawningWorld(engine)
  try {
    const { authority } = await world.launcher.ensure()
    await openArmed(authority)
    let beats = 0
    const stop = startHeartbeat({
      scheduler: realScheduler,
      brainLastSeenMs: () => Date.now(),
      send: () => {
        beats += 1
        void authority.call("stopPath.heartbeat", {})
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1_600))
    const clicked = await authority.call("click", { target: "101", x: 10, y: 10, callId: "qa-hand-click" })
    stop()
    const posted = sinkLines(world.seam).filter((line) => line.startsWith("post_input")).length
    console.log(`click reply: ${JSON.stringify(clicked).slice(0, 240)}`)
    let ok = check(clicked.error === undefined && clicked.result !== undefined, "the click is answered with a result")
    ok = check(posted >= 1, `the fake sink recorded the delivered input (${posted} post_input lines)`) && ok
    return check(beats > 0, `heartbeat count ${beats} > 0`) && ok
  } finally {
    await world.close()
  }
}
