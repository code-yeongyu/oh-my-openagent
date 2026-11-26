import { describe, expect, test } from "bun:test"

import {
  ALIAS,
  B,
  B_TWIN,
  createTwoDevices,
  KEY,
  T,
} from "../../omo-senpi/src/components/thread/address/testing/two-devices"
import { REMOTE_EXIT } from "../remote-exit"
import { run, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

// #14305 (design section 2): the session verbs resolve their target through the one address module, so a thread name,
// an alias, a thread id prefix and every device spelling reach a session the way the thread tools' addresses do, and a
// device that missed the listing round is host_unavailable, never "No session ... on this account".

type JsonResult = {
  kind: string
  thread?: string
  error?: { code: string; next_action?: string; details?: Record<string, unknown> }
}

// The --json line parsed without throwing, so a regression fails on the typed assertion, not on the parse.
const parsed = (out: readonly string[]): JsonResult | undefined => {
  try {
    return JSON.parse(out.join("")) as JsonResult
  } catch {
    return undefined
  }
}

const sentTo = (td: ReturnType<typeof createTwoDevices>, device: string, session: string) =>
  td.account.sent.filter((entry) => entry.device === device && entry.session === session)

describe("omo remote session verbs take every address form", () => {
  test("#given a thread name on another device #when send names it #then the message reaches that thread's device", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["send", "beta", "hello", "--no-wait", "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(result.code).toBe(REMOTE_EXIT.ok)
      expect(JSON.parse(result.out.join("") ?? "{}") as JsonResult).toMatchObject({
        kind: "ok",
        thread: T.bLive,
      })
      expect(sentTo(td, B.id, KEY.bLive)).toHaveLength(1)
    } finally {
      await td.cleanup()
    }
  })

  test("#given a device id prefix and a thread id prefix #when send addresses them #then it resolves to the one thread", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["send", "b7c41e/0bb00001", "hello", "--no-wait", "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(result.code).toBe(REMOTE_EXIT.ok)
      expect(JSON.parse(result.out.join("") ?? "{}") as JsonResult).toMatchObject({
        kind: "ok",
        thread: T.bLive,
      })
      expect(sentTo(td, B.id, KEY.bLive)).toHaveLength(1)
    } finally {
      await td.cleanup()
    }
  })

  test("#given here/<thread id> #when a verb addresses this device #then it answers the typed not_found and sends nothing there", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["interrupt", `here/${T.hereLive}`, "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(result.code).toBe(REMOTE_EXIT.failed)
      expect(JSON.parse(result.out.join("") ?? "{}") as JsonResult).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(td.account.sent).toEqual([])
    } finally {
      await td.cleanup()
    }
  })

  // #14305 review M2: a thread this device holds is outside omo remote's scope, whatever form reached it: the module's
  // typed not_found, with nothing sent, never a host_unavailable that tells a script to retry.
  test("#given an account alias this device holds #when send names it #then it answers not_found and sends nothing", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["send", ALIAS.here, "hello", "--no-wait", "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(result.code).toBe(REMOTE_EXIT.failed)
      expect(parsed(result.out)?.error?.code).toBe("not_found")
      expect(td.account.sent).toEqual([])
    } finally {
      await td.cleanup()
    }
  })

  // #14305 delta review H1: omo remote needs the relay, so a device service that is off, signed out or not set up is
  // host_unavailable naming its state for every verb, as before the address module, never a plain not_found.
  test.each(
    ["disabled", "signed_out", "not_configured", "sign_in_required"].flatMap((state) =>
      [
        ["send", `${B.id}/${T.bLive}`, "hello", "--no-wait"],
        ["model", `${B.id}/${T.bLive}`, "anthropic/claude-opus"],
        ["interrupt", `${B.id}/${T.bLive}`],
        ["close", `${B.id}/${T.bLive}`],
      ].map((args) => [state, args] as const),
    ),
  )(
    "#given a device service in state %s #when %p runs #then it is host_unavailable naming that state and nothing is sent",
    async (state, args) => {
      const td = createTwoDevices({ plan: state })
      try {
        const result = await run([...args, "--json"], undefined, undefined, undefined, td.remote)
        expect(result.code).toBe(REMOTE_EXIT.failed)
        expect(parsed(result.out)?.error).toMatchObject({ code: "host_unavailable", details: { state } })
        expect(td.account.sent).toEqual([])
      } finally {
        await td.cleanup()
      }
    },
  )

  // #14305 delta review L3: scripts read --json, so the eval-only thread_list advice is mapped there too.
  test("#given here/<thread id> #when a verb answers --json #then its next_action names no eval-only tool", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["interrupt", `here/${T.hereLive}`, "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(parsed(result.out)?.error?.code).toBe("not_found")
      expect(parsed(result.out)?.error?.next_action).not.toMatch(/\bthread_list\b/)
    } finally {
      await td.cleanup()
    }
  })

  // #14305 review M4: a person sees each candidate of an ambiguous device on its own line, so it can be typed back.
  test("#given two online devices sharing a name #when a verb names that device without --json #then each candidate is printed on its own line and nothing runs", async () => {
    const td = createTwoDevices({ twin: true })
    try {
      const result = await run(["interrupt", `${B.name}/${T.bLive}`], undefined, undefined, undefined, td.remote)
      expect(result.code).toBe(REMOTE_EXIT.failed)
      expect(result.err.filter((line) => line.includes(B.id) !== line.includes(B_TWIN.id))).toHaveLength(2)
      expect(td.account.sent).toEqual([])
    } finally {
      await td.cleanup()
    }
  })

  test("#given a device that missed the listing round #when send names its thread by id #then it answers host_unavailable, not a plain miss", async () => {
    const td = createTwoDevices({ incomplete: true })
    try {
      const result = await run(
        ["send", T.bLive, "hello", "--no-wait", "--json"],
        undefined,
        undefined,
        undefined,
        td.remote,
      )
      expect(result.code).toBe(REMOTE_EXIT.failed)
      expect(JSON.parse(result.out.join("") ?? "{}") as JsonResult).toMatchObject({
        kind: "error",
        error: { code: "host_unavailable", details: { reason: "listing_incomplete" } },
      })
      expect(td.account.sent).toEqual([])
    } finally {
      await td.cleanup()
    }
  })
})

// omo#13905: a close that closed nothing is a typed failure, and send can take its text from stdin, never argv.
describe("omo remote close and send stdin (#13905)", () => {
  test("#given a session its device no longer runs #when close names it #then it fails typed with a non-zero exit, never ok with closed:false", async () => {
    const td = createTwoDevices()
    // The device no longer holds the session: every record naming it is refused unknown_session (the 5.1.72 case).
    const remote = {
      ...td.remote,
      sessions: {
        ...td.remote.sessions,
        sessionCommand: async () => ({ kind: "refused", reason: "unknown_session" }) as const,
      },
    } as typeof td.remote
    try {
      const result = await run(["close", `${B.id}/${T.bLive}`, "--json"], undefined, undefined, undefined, remote)
      expect(parsed(result.out)).toMatchObject({ kind: "error", error: { code: "not_found" } })
      expect(result.code).toBe(REMOTE_EXIT.failed)
    } finally {
      await td.cleanup()
    }
  })

  test("#given send <target> - #when stdin holds the text #then the prompt is those exact bytes and argv carries none of it", async () => {
    const td = createTwoDevices()
    const text = "--first line\nzweite Zeile, 한국어\n"
    try {
      const args = ["send", `${B.id}/${T.bLive}`, "-", "--no-wait", "--json"]
      const result = await run(args, undefined, undefined, undefined, td.remote, { readStdin: async () => text })
      expect(result.code).toBe(REMOTE_EXIT.ok)
      expect(args.join(" ")).not.toContain("first line")
      expect(JSON.stringify(td.account.sent)).toContain(JSON.stringify(text).slice(1, -1))
    } finally {
      await td.cleanup()
    }
  })

  test("#given send <target> - #when stdin is empty #then it is a usage error and nothing is sent", async () => {
    const td = createTwoDevices()
    try {
      const result = await run(
        ["send", `${B.id}/${T.bLive}`, "-", "--no-wait"],
        undefined,
        undefined,
        undefined,
        td.remote,
        {
          readStdin: async () => "",
        },
      )
      expect(result.code).toBe(REMOTE_EXIT.usage)
      expect(td.account.sent).toEqual([])
    } finally {
      await td.cleanup()
    }
  })
})
