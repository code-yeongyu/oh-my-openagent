import { describe, expect, test } from "bun:test"

import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, type World } from "../../device-service-core/test/local-api/conformance/world.ts"
import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { type RemoteClient, remoteClientForPerson } from "../../omo-senpi/src/components/remote/index"
import { REMOTE_EXIT } from "../remote-exit"
import { owners, privateDir, run, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"
import { commandTargets, liveKey, PEER, personWorld } from "./remote-person-world"

useRemoteCliCleanup()

// #14305 (design section 2): the session verbs resolve their target through the one address module, so a thread name and
// every device spelling reach a session the way the thread tools' addresses do, and a device that missed the listing
// round is host_unavailable, never "No session ... on this account". Each address form's resolution is pinned once, in
// thread/address/resolve.test.ts; these pin that `omo remote` routes through it (#13414 4c-2: on the person client).

type Failure = { kind: string; code?: string; next_action?: string; details?: Record<string, unknown> }

// The --json line parsed without throwing, so a regression fails on the typed assertion, not on the parse.
const parsed = (out: readonly string[]): Failure | undefined => {
  try {
    return JSON.parse(out.join("")) as Failure
  } catch {
    return undefined
  }
}

async function verb(args: readonly string[], world: World = personWorld()) {
  const owner = await startFakeOwner({ stateDir: privateDir(), world })
  owners.push(owner)
  const result = await run(args, owner.stateDir, SIGNED_IN, testBootstrap())
  return { ...result, targets: commandTargets(owner.state.bindings) }
}

describe("omo remote session verbs take every address form", () => {
  test("#given a thread name on another device #when send names it #then the message reaches that thread's device", async () => {
    const result = await verb(["send", "Live session", "hello", "--no-wait", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(result.targets).toEqual([`${PEER}/${liveKey()}`])
  })

  test("#given here/<thread id> #when a verb addresses this device #then it answers the typed not_found, with no eval-only tool in its next step, and sends nothing", async () => {
    const result = await verb(["interrupt", "here/0aa00001-0000-7000-8000-000000000001", "--json"])
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(parsed(result.out)).toMatchObject({ kind: "error", code: "not_found" })
    expect(parsed(result.out)?.next_action).not.toMatch(/\bthread_list\b/)
    expect(result.targets).toEqual([])
  })

  // #14305 delta review H1: omo remote needs the relay, so a device service that is off, signed out or not set up is
  // host_unavailable naming its state for every verb, as before the address module, never a plain not_found.
  test.each(
    ["disabled", "signed_out", "not_configured", "sign_in_required"].flatMap((state) =>
      [
        ["send", `${PEER}/${liveKey()}`, "hello", "--no-wait"],
        ["model", `${PEER}/${liveKey()}`, "anthropic/claude-opus"],
        ["interrupt", `${PEER}/${liveKey()}`],
        ["close", `${PEER}/${liveKey()}`],
      ].map((args) => [state, args] as const),
    ),
  )(
    "#given a device service in state %s #when %p runs #then it is host_unavailable naming that state and nothing is sent",
    async (state, args) => {
      const world = personWorld()
      const result = await verb([...args, "--json"], {
        ...world,
        status: { ...world.status, state } as World["status"],
      })
      expect(result.code).toBe(REMOTE_EXIT.failed)
      expect(parsed(result.out)).toMatchObject({ code: "host_unavailable", details: { state } })
      expect(result.targets).toEqual([])
    },
  )

  // #14305 review M4: a person sees each candidate of an ambiguous device on its own line, so it can be typed back.
  test("#given two online devices sharing a name #when a verb names that device without --json #then each candidate is printed on its own line and nothing runs", async () => {
    const base = defaultWorld()
    const twin = {
      device: "dev-peer-3",
      label: "Studio",
      kind: "desktop" as const,
      platform: "linux" as const,
      last_seen_ms: 1_790_000_000_000,
      online: true,
    }
    const result = await verb(
      ["interrupt", `Studio/${liveKey()}`],
      personWorld({ ...base, devices: [...base.devices, twin] }),
    )
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(result.err.filter((line) => line.includes(PEER) !== line.includes("dev-peer-3"))).toHaveLength(2)
    expect(result.targets).toEqual([])
  })

  test("#given a device that missed the listing round #when send names its thread by its listing key #then it answers host_unavailable, not a plain miss", async () => {
    const base = personWorld()
    const result = await verb(["send", liveKey(), "hello", "--no-wait", "--json"], {
      ...base,
      listing: {
        ...base.listing,
        revisions: [{ rows: [], incomplete: [PEER] }],
        devices: { ...base.listing.devices, [PEER]: "undelivered" },
      },
    })
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(parsed(result.out)).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "listing_incomplete" },
    })
    expect(result.targets).toEqual([])
  })
})

// omo#13905: a close that closed nothing is a typed failure, and send can take its text from stdin, never argv.
describe("omo remote close and send stdin (#13905)", () => {
  // The person client the verb runs, with chosen sessions members standing in for the device's answer.
  async function onClient(overrides: (original: RemoteClient["sessions"]) => Partial<RemoteClient["sessions"]>) {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: personWorld() })
    owners.push(owner)
    const client = (): RemoteClient => {
      const real = remoteClientForPerson({
        version: "5.1.52",
        stateDir: owner.stateDir,
        connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
      })
      // The same client object: the remote module lends its connection keyed on it, so the members are replaced in place.
      Object.assign(real.sessions, overrides({ ...real.sessions }))
      return real
    }
    return { owner, client }
  }

  test("#given a session its device no longer runs #when close names it #then it fails typed with a non-zero exit, never ok with closed:false", async () => {
    const { owner, client } = await onClient(() => ({
      close: async () => ({ kind: "ok", value: { closed: false, dropped_deliveries: [] } }) as const,
    }))
    const result = await run(["close", `${PEER}/${liveKey()}`, "--json"], owner.stateDir, SIGNED_IN, testBootstrap(), {
      client,
    })
    expect(parsed(result.out)).toMatchObject({ kind: "error", code: "not_found" })
    expect(result.code).toBe(REMOTE_EXIT.failed)
  })

  // Train 12's 5.1.72 case on the person client: the device no longer holds the session at all.
  test("#given a session key its device does not hold #when close names it #then it fails typed not_found with a non-zero exit and nothing is sent", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: personWorld() })
    owners.push(owner)
    const result = await run(
      ["close", `${PEER}/bm8tc3VjaC1zZXNzaW9uLWtleQ`, "--json"],
      owner.stateDir,
      SIGNED_IN,
      testBootstrap(),
    )
    expect(parsed(result.out)).toMatchObject({ kind: "error", code: "not_found" })
    expect(result.code).toBe(REMOTE_EXIT.failed)
    expect(commandTargets(owner.state.bindings)).toEqual([])
  })

  test("#given send <target> - #when stdin holds the text #then the prompt is those exact bytes and argv carries none of it", async () => {
    const text = "--first line\nzweite Zeile, 한국어\n"
    const sent: string[] = []
    const { owner, client } = await onClient((original) => ({
      send: (thread, request) => {
        sent.push(request.text)
        return original.send(thread, request)
      },
    }))
    const args = ["send", `${PEER}/${liveKey()}`, "-", "--no-wait", "--json"]
    const result = await run(args, owner.stateDir, SIGNED_IN, testBootstrap(), { client, readStdin: async () => text })
    expect(result.code).toBe(REMOTE_EXIT.ok)
    expect(args.join(" ")).not.toContain("first line")
    expect(sent).toEqual([text])
  })

  test("#given send <target> - #when stdin is empty #then it is a usage error and nothing is sent", async () => {
    const owner = await startFakeOwner({ stateDir: privateDir(), world: personWorld() })
    owners.push(owner)
    const result = await run(
      ["send", `${PEER}/${liveKey()}`, "-", "--no-wait"],
      owner.stateDir,
      SIGNED_IN,
      testBootstrap(),
      { readStdin: async () => "" },
    )
    expect(result.code).toBe(REMOTE_EXIT.usage)
    expect(commandTargets(owner.state.bindings)).toEqual([])
  })
})
