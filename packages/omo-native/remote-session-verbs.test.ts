import { describe, expect, test } from "bun:test"
import { connectDeviceService } from "../device-service-core/src/index.ts"
import { type FakeOwner, startFakeOwner } from "../device-service-core/test/local-api/conformance/fake-owner.ts"
import { pushRecords } from "../omo-senpi/src/components/remote/attach.test-support"
import { type FakeClock, fakeClock } from "../device-service-core/test/local-api/conformance/fake-clock.ts"
import { type RemoteClient, remoteClientForPerson } from "../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "./remote-exit"
import { parseSession } from "./remote-session-args"
import { owners, privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./test/remote-cli-harness"
import { liveKey, PEER, personWorld } from "./test/remote-person-world"

useRemoteCliCleanup()

const onOwner = async (world = personWorld()) => {
  const owner = await startFakeOwner({ stateDir: privateDir(), world })
  owners.push(owner)
  return owner
}

describe("omo remote session verbs close what they opened", () => {
  test("#given a session verb ran on the person client #when it returns #then the client was closed once (#14074)", async () => {
    const owner = await onOwner()
    let closes = 0
    const client = (): RemoteClient => {
      const real = remoteClientForPerson({
        version: "5.1.52",
        stateDir: owner.stateDir,
        connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      })
      return {
        ...real,
        close: () => {
          closes += 1
          real.close()
        },
      }
    }
    const result = await run(
      ["interrupt", `${PEER}/no-such-session`, "--json"],
      owner.stateDir,
      SIGNED_IN,
      testBootstrap(),
      {
        client,
      },
    )
    expect({ closes, answered: result.out.length + result.err.length > 0 }).toEqual({ closes: 1, answered: true })
  })
})

// #13425: a waiting send settles typed inside a bound; the session's end reaches --json too.
describe("omo remote send bounded settle (#13425)", () => {
  test("#given the session closes before the turn settles #when the send waits under --json #then one JSON value answers session_ended", async () => {
    // Once the engine took the prompt, senpi settles its turn because the session closed under it.
    let pushed = false
    const owner: FakeOwner = await startFakeOwner({
      stateDir: privateDir(),
      world: personWorld(),
      onRequest: () => {
        const prompt = owner.state.commands.findLast((rpc) => rpc["type"] === "prompt")
        if (pushed || prompt === undefined) return
        pushed = true
        pushRecords(owner, [
          { type: "turn_start", clientMessageId: prompt["clientMessageId"] as string },
          { type: "agent_settled", reason: "session_closed" },
        ])
      },
    })
    owners.push(owner)
    const result = await run(["send", "--timeout", "5", `${PEER}/${liveKey()}`, "ping", "--json"], owner.stateDir)
    const parsed = JSON.parse(result.out.at(-1) ?? "{}")
    expect({ code: result.code, kind: parsed.kind, end: parsed.end }).toEqual({
      code: REMOTE_EXIT.failed,
      kind: "session_ended",
      end: "session_closed",
    })
  })

  test("#given a turn that never settles #when a person waits with --timeout #then the send answers a typed timeout when the bound passes on the client's clock", async () => {
    const owner = await onOwner()
    const base = fakeClock()
    // Resolves when the send arms its one-second bound, so the clock moves only after the wait is armed.
    let armedBound = (): void => {}
    const bound = new Promise<void>((resolve) => {
      armedBound = resolve
    })
    const clock: FakeClock = {
      ...base,
      after: (ms, fn) => {
        const cancel = base.after(ms, fn)
        if (ms === 1_000) armedBound()
        return cancel
      },
    }
    const sending = run(
      ["send", "--timeout", "1", `${PEER}/${liveKey()}`, "ping", "--json"],
      owner.stateDir,
      SIGNED_IN,
      testBootstrap(),
      {
        timers: clock,
      },
    )
    await bound
    clock.advance(1_000)
    const result = await sending
    const parsed = JSON.parse(result.out.at(-1) ?? "{}")
    expect({ code: result.code, kind: parsed.kind, waited_ms: parsed.waited_ms }).toEqual({
      code: REMOTE_EXIT.failed,
      kind: "timeout",
      waited_ms: 1_000,
    })
  })
})

describe("#14333: omo remote send and open default to auto", () => {
  test("#given no --steer or --follow-up #when send and open --prompt are parsed #then both carry the shared default; --follow-up is kept", () => {
    expect(parseSession("send", ["b/rk-on-b", "ping"]).session).toMatchObject({ delivery: "auto" })
    expect(parseSession("open", ["b", "--prompt", "go"]).session).toMatchObject({ delivery: "auto" })
    expect(parseSession("send", ["--follow-up", "b/rk-on-b", "ping"]).session).toMatchObject({ delivery: "follow_up" })
  })
})
