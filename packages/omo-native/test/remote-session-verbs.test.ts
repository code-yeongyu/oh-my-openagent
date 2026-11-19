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

type JsonResult = { kind: string; thread?: string; error?: { code: string; details?: Record<string, unknown> } }

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
      expect(JSON.parse(result.out.join("") ?? "{}") as JsonResult).toMatchObject({
        kind: "error",
        error: { code: "not_found" },
      })
      expect(td.account.sent).toEqual([])
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
