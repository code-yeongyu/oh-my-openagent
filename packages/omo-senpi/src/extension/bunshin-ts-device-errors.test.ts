import { describe, expect, it } from "bun:test"

import {
  HubTransportError,
  MachineHubConnectError,
  MachineWireError,
  type BunshinClient,
  type StandaloneMachine,
} from "../../vendor/bunshin-ts/index.js"

import { createLazyBunshinClient } from "./bunshin-ts-default-client"
import { BunshinSessionError, pickTransport } from "./bunshin-ts-pick-transport"

const DEVICE = "studio"
const OPERATIONS = ["read", "write", "grep", "shell"] as const

const relayEntry = (code: string, uncertain?: true) => ({
  state: "failed",
  error: { code, message: `relay said ${code}`, ...(uncertain ? { uncertain } : {}) },
})

function machineFailingWith(failure: () => unknown): StandaloneMachine {
  const reject = async () => {
    throw failure()
  }
  return {
    id: "dev-1",
    alias: DEVICE,
    shell: reject,
    read: reject,
    write: reject,
    grep: reject,
    withToken: () => machineFailingWith(failure),
  } as unknown as StandaloneMachine
}

function clientFailingWith(failure: () => unknown): BunshinClient {
  return createLazyBunshinClient(
    async () =>
      ({
        getMachine: async () => machineFailingWith(failure),
        close: async () => {},
      }) as unknown as BunshinClient,
  )
}

async function failureOf(client: BunshinClient, operation: (typeof OPERATIONS)[number]): Promise<BunshinSessionError> {
  const machine = await client.getMachine(DEVICE)
  const call = machine[operation] as (...args: unknown[]) => Promise<unknown>
  const caught: unknown = await call("/srv/app/a.txt", "x").then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(BunshinSessionError)
  return caught as BunshinSessionError
}

const SCENARIOS = [
  {
    scenario: "a bad argument",
    error: () => new HubTransportError("malformed", "pattern must be a string", "op-1"),
    code: "invalid_arguments",
    next: (operation: string) => `fix the arguments of ${operation}`,
  },
  {
    scenario: "an offline device",
    error: () =>
      new MachineWireError("device_offline", "device is offline", "op-1", undefined, relayEntry("device_offline")),
    code: "device_offline",
    next: () => `resend once ${DEVICE} is online`,
  },
  {
    scenario: "a denied path",
    error: () => new MachineWireError("policy_denied", "outside the scope root", "op-1"),
    code: "scope_denied",
    next: () => "inside its allowed scope root",
  },
  {
    scenario: "a lost transport",
    error: () => new HubTransportError("closed", "socket closed", "op-1"),
    code: "transport_closed",
    next: () => "the connection dropped",
  },
] as const

describe("bunshin-ts device operation failures", () => {
  for (const operation of OPERATIONS) {
    for (const { scenario, error, code, next } of SCENARIOS) {
      it(`#given ${scenario} #when ${operation} fails #then it is ${code} naming ${operation} and the device`, async () => {
        const failure = await failureOf(clientFailingWith(error), operation)
        expect(failure.code).toBe(code)
        expect(failure.next_action).toContain(next(operation))
        expect(failure.message).toContain(`${operation} on ${DEVICE} failed`)
        expect(failure.message).not.toContain("hub transport error")
        expect(failure.toJSON()).toMatchObject({ code, next_action: failure.next_action })
      })
    }
  }

  const RELAY_CODES = [
    { code: "device_offline", uncertain: false, next: `resend once ${DEVICE} is online` },
    { code: "undelivered", uncertain: false, next: "resend it" },
    { code: "transport_expired", uncertain: true, next: 'bunshin.resultOf("op-7")' },
    { code: "unconfirmed", uncertain: true, next: 'bunshin.resultOf("op-7")' },
    { code: "timeout", uncertain: true, next: 'bunshin.resultOf("op-7")' },
    { code: "host_error", uncertain: false, next: 'bunshin.resultOf("op-7")' },
    { code: "host_not_answering", uncertain: false, next: "never answered machine.describe" },
  ] as const

  for (const { code, uncertain, next } of RELAY_CODES) {
    it(`#given the relay op result ${code} #when read fails #then the code is kept 1:1 with uncertain=${uncertain}`, async () => {
      const failure = await failureOf(
        clientFailingWith(
          () =>
            new MachineWireError(
              code,
              `relay said ${code}`,
              "op-7",
              undefined,
              relayEntry(code, uncertain ? true : undefined),
            ),
        ),
        "read",
      )
      expect(failure.code).toBe(code)
      expect(failure.uncertain).toBe(uncertain)
      expect(failure.next_action).toContain(next)
      expect(failure.toJSON().uncertain).toBe(uncertain ? true : undefined)
    })
  }

  it("#given a device answering an fs.read result this SDK cannot decode #when read fails #then it is unsupported, not a raw decode sentence", async () => {
    const decodeError = Object.assign(
      new Error("invalid fs.read result: truncated must be a boolean for byte results"),
      {
        name: "ComposedToolResultError",
        capability: "fs.read",
        reason: "truncated must be a boolean for byte results",
      },
    )
    const failure = await failureOf(
      clientFailingWith(() => decodeError),
      "read",
    )
    expect(failure.code).toBe("unsupported")
    expect(failure.next_action).toContain("update omo on both devices")
  })

  it("#given a connect that fails #when an operation runs #then the connect failure carries a code and a next action", async () => {
    const client = createLazyBunshinClient(async () => {
      throw new MachineHubConnectError("hub refused the session")
    })
    const caught: unknown = await client.listMachines().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(caught).toBeInstanceOf(BunshinSessionError)
    expect((caught as BunshinSessionError).code).toBe("host_unavailable")
    expect((caught as BunshinSessionError).next_action).toContain("retry")
  })

  it("#given no connected device service and no hub #when the transport is picked #then no_transport names the next action", async () => {
    const caught: unknown = await pickTransport({}, { relayStatus: async () => ({ connected: false }) }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(caught).toBeInstanceOf(BunshinSessionError)
    expect((caught as BunshinSessionError).code).toBe("no_transport")
    expect((caught as BunshinSessionError).next_action).toContain("omo remote status")
  })
})
