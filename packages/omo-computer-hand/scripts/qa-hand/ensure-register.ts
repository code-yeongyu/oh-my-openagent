import { randomBytes } from "node:crypto"
import { callHostApi, connectDaemon } from "../../src/index.ts"
import { processIdentity } from "../../src/process-info.ts"
import { check, run, seamPaths, spawningWorld } from "./world.ts"

/** The attach-only role, run as its OWN process: hand.ensure over the host API, then attach with that capability. */
export async function attachOnlyRole(seam: string): Promise<void> {
  const paths = seamPaths(seam)
  const self = processIdentity(process.pid)
  if (self === undefined) throw new Error("no process identity")
  const reply = await callHostApi(paths.hostAddress, "hand.ensure", self)
  const ensured: unknown = reply.result
  const field = (name: string): unknown =>
    typeof ensured === "object" && ensured !== null ? Reflect.get(ensured, name) : undefined
  const endpoint = field("endpoint")
  const capability = field("capability")
  const generation = field("generation")
  if (field("kind") !== "ensured" || typeof endpoint !== "string" || typeof capability !== "string") {
    console.log(JSON.stringify({ attach: "refused", reply }))
    return
  }
  const link = await connectDaemon(endpoint, Buffer.from(capability, "hex"))
  const answer = await link.call("desktop.capabilities", {})
  console.log(
    JSON.stringify({
      attach: "attached",
      pid: self.pid,
      generation,
      capabilityBytes: Buffer.from(capability, "hex").length,
      answer: answer.result === undefined ? answer : "result",
    }),
  )
  link.close()
}

/** A same-uid process that never called hand.ensure dials the daemon directly. */
export async function strangerRole(seam: string): Promise<void> {
  const paths = seamPaths(seam)
  const link = await connectDaemon(paths.daemonEndpoint, randomBytes(32))
  const outcome = await Promise.race([
    link.call("desktop.capabilities", {}).then(
      () => "answered",
      () => "closed",
    ),
    link.closed.then(() => "closed"),
  ])
  console.log(JSON.stringify({ stranger: outcome }))
}

/**
 * Row 37's real-surface proof: a spawning host built from source serves hand.ensure on the host API
 * address the engine resolves; an attach-only PROCESS calls it, the host runs hand.register on the
 * REAL row 29 daemon's authority connection, and the attach-only process is admitted with the
 * minted capability. A process that skipped hand.ensure is closed unread. The engine itself, run
 * host-less, dials this host's API and reads its latch.
 */
export async function ensureRegister(engine: string, self: string): Promise<boolean> {
  const world = await spawningWorld(engine)
  let ok = true
  try {
    const attach = await run(
      process.execPath,
      [self, "--role", "attach-only", "--seam", world.seam],
      { ...world.env, PATH: process.env.PATH ?? "" },
      "",
    )
    console.log(`attach-only process: ${attach.out.trim()} ${attach.err.trim()}`)
    ok =
      check(
        /"attach":"attached"/.test(attach.out) &&
          /"capabilityBytes":32/.test(attach.out) &&
          /"answer":"result"/.test(attach.out),
        "attach-only process: hand.ensure -> hand.register -> admitted, desktop.capabilities answered",
      ) && ok
    const generation = await world.launcher.ensure()
    ok =
      check(
        generation.generation === 1,
        `one daemon generation served every caller (generation ${generation.generation}, pid ${generation.child.pid})`,
      ) && ok
    const stranger = await run(
      process.execPath,
      [self, "--role", "stranger", "--seam", world.seam],
      { ...world.env, PATH: process.env.PATH ?? "" },
      "",
    )
    ok =
      check(
        /"stranger":"closed"/.test(stranger.out),
        `a process without hand.ensure is closed before any frame: ${stranger.out.trim()}`,
      ) && ok
    // The engine, run host-less on the same seam, finds this host by the address both resolve.
    const open = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.open", params: {} })}\n`
    world.answerLatch(true)
    const byApi = await run(engine, ["--stdio"], world.env, open)
    ok =
      check(
        /"host_latch"/.test(byApi.out),
        `host API answers latched (file clear): the engine refuses ${byApi.out.slice(0, 160).trim()}`,
      ) && ok
    world.answerLatch(false)
    const clear = await run(engine, ["--stdio"], world.env, open)
    ok =
      check(
        /"result":\{"capabilities"/.test(clear.out),
        "host API answers clear (same files): session.open opens, so the refusal above came from this host's answer",
      ) && ok
    world.latch.set({ suspended: true, stopEpoch: 1 })
    const byFile = await run(engine, ["--stdio"], world.env, open)
    ok =
      check(
        /"host_latch"/.test(byFile.out),
        `the persisted host-latch file alone stops the engine: ${byFile.out.slice(0, 160).trim()}`,
      ) && ok
  } finally {
    await world.close()
  }
  return ok
}
