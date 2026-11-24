import { describe, expect, test } from "bun:test"

import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld, type World } from "../../device-service-core/test/local-api/conformance/world.ts"
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
