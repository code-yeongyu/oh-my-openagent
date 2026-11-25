import { afterEach, describe, expect, test } from "bun:test"
import type { RemoteClient } from "./client"
import {
  remoteClientForCli,
  remoteClientForConnector,
  remoteClientForPerson,
  remoteClientForService,
  remoteClientForSession,
} from "./factories"
import { fakeClock } from "./testing/fake-service"

// Public API contract of the remote module's factories (first-party design 4.1, the openRemote facade): P1b projects
// every member onto the omo SDK root, so each factory's client must keep exactly this member tree.

const clients: RemoteClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.close()
})

const deps = { version: "5.1.74", stateDir: "/nonexistent-p1b-pin", timers: fakeClock() }
const FACTORIES: ReadonlyArray<readonly [string, () => RemoteClient]> = [
  ["person", () => remoteClientForPerson(deps)],
  ["session", () => remoteClientForSession("dur-1", deps)],
  ["connector", () => remoteClientForConnector("binding-1", deps)],
  ["cli", () => remoteClientForCli("501", deps)],
  ["service", () => remoteClientForService(deps)],
]

const memberTree = (client: RemoteClient): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(client).map(([name, member]) => [
      name,
      typeof member === "function"
        ? "function"
        : Object.fromEntries(Object.entries(member as object).map(([key, value]) => [key, typeof value])),
    ]),
  )

const fns = (...names: string[]) => Object.fromEntries(names.map((name) => [name, "function"]))

describe("remote client factories: the member tree", () => {
  for (const [kind, build] of FACTORIES)
    test(`#given the ${kind} factory #when its client is built #then its members are exactly the shipped tree`, () => {
      const client = build()
      clients.push(client)
      expect(memberTree(client)).toEqual({
        service: fns("info", "status", "setEnabled", "control", "setControl", "bootstrap", "wake", "setWake"),
        devices: fns("list", "resolve"),
        sessions: fns(
          "list",
          "resolve",
          "get",
          "open",
          "send",
          "read",
          "follow",
          "wait",
          "interrupt",
          "setModel",
          "setReasoning",
          "close",
          "archive",
        ),
        attach: "function",
        aliases: fns("resolve", "set", "clear"),
        close: "function",
      })
    })
})
