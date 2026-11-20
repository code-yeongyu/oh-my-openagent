import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { disableSync, isDeviceSyncOff } from "../../../../memory-core/src/sync/account/device-switch"
import { createPairingHttp } from "../../../../memory-core/src/sync/account/pairing-http"
import { RECOVER_REFUSALS } from "../../../../memory-core/src/sync/recovery/ports"
import {
  freshStateDir,
  removeWorldStateDirs,
} from "../../../../memory-core/src/sync/recovery/testing/world.test-support"
import { phraseBeginData } from "./desktop-sync/desktopRecoveryBridge"
import { desktopSyncRequest } from "./desktop-sync/protocol"
import { recoverRefusalCode } from "./sync-rpc-recover"
import {
  consent,
  ENROLLED,
  enrolledWorld,
  fakeMain,
  hits,
  phraseWords,
  recoverHarness,
  removeRecoverRoots,
} from "./sync-rpc-recover.test-support"

afterAll(() => {
  removeWorldStateDirs()
  removeRecoverRoots()
})

const consoleLines: string[] = []
// Telemetry (PostHog capture, the OTLP exporter) leaves the process only through fetch; any call is a sink to grep.
const outbound: string[] = []
const spies: ReturnType<typeof spyOn>[] = []
beforeEach(() => {
  consoleLines.length = 0
  outbound.length = 0
  spies.push(
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          outbound.push(`${String(input)} ${String(init?.body ?? "")}`)
          return new Response(null, { status: 204 })
        },
        { preconnect: () => undefined },
      ),
    ),
  )
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    spies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(" "))
      }),
    )
})
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

test("#given the enrolled phrase typed in desktop main's window #when the RPC recover runs #then the device recovers with sync on and no sink holds any rendering of the phrase", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({ world, main: (device) => fakeMain(device, [ENROLLED.join(" ")]) })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recovered", sync: "on" })
  expect(rpc.frames.some((frame) => frame.includes("recoverFinish"))).toBe(true)
  expect(outbound).toEqual([])
  expect(hits([...rpc.sinks(), ...consoleLines, ...outbound])).toEqual([])
})

const refusalCases = [
  ["history-incomplete", { kind: "recover_refused", code: "history-incomplete" }],
  ["cancelled", { kind: "cancelled" }],
  ["unavailable", { kind: "recover_refused", code: "unavailable" }],
  ["too-many-attempts", { kind: "recover_refused", code: "too-many-attempts" }],
  ["rp-mismatch", { kind: "recover_refused", code: "rp-mismatch" }],
  ["no-prf", { kind: "recover_refused", code: "authenticator-unsupported" }],
] as const

for (const [reason, answer] of refusalCases) {
  test(`#given desktop main refuses begin with ${reason} after the words were typed #when the RPC recover runs #then it answers the mapped code and no sink or error holds the phrase`, async () => {
    const world = await enrolledWorld()
    const rpc = await recoverHarness({
      world,
      main: (device) => {
        const real = fakeMain(device, [ENROLLED.join(" ")])
        return async (op, data) => {
          if (op !== "recoverBeginPhrase") return real(op, data)
          await real(op, data)
          return { op: "recoverBegin", ok: false, reason }
        }
      },
    })
    expect(await rpc.call("recover", { method: "phrase" })).toEqual(answer)
    expect(rpc.gate.state).toEqual({ account: false, device: false })
    expect(hits([...rpc.sinks(), ...consoleLines, ...outbound])).toEqual([])
  })
}

test("#given a valid phrase this account never enrolled #when the real words window path answers #then RPC recover refuses history-incomplete", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({ world, main: (device) => fakeMain(device, [phraseWords(99).join(" ")]) })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({
    kind: "recover_refused",
    code: "history-incomplete",
  })
})

test("#given every engine refusal reason #when it is mapped #then each lands on its documented RPC answer", () => {
  expect(recoverRefusalCode("cancelled")).toBe("cancelled")
  expect(recoverRefusalCode("no-user-verification")).toBe("authenticator-unsupported")
  expect(recoverRefusalCode("approval-required")).toBe("surface-unavailable")
  expect(recoverRefusalCode("bad-device")).toBe("refused")
  expect(recoverRefusalCode("too-many-recovery-keys")).toBe("refused")
  for (const same of [
    "already-member",
    "pin-conflict",
    "pin-corrupt",
    "phrase_keys_not_accepted",
    "join-unconfirmed",
  ] as const)
    expect(recoverRefusalCode(same)).toBe(same)
})

test("#given desktop main answers begin with a reply that does not decode #when the RPC recover runs #then it answers unavailable and logs only bridge_result_invalid", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({
    world,
    main: () => async () => ({ op: "recoverBegin", ok: false, reason: ENROLLED.join(" ") }),
  })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recover_refused", code: "unavailable" })
  expect(rpc.warnings.filter((line) => line.includes("bridge_result_invalid"))).toHaveLength(1)
  expect(hits(rpc.warnings)).toEqual([])
})

test("#given the private-channel phrase begin payload #when it carries any extra field #then the schema refuses it, so no words can ride along", () => {
  const hint = { credentialId: "c", enrollmentNonce: "n", sealing_public_key: "s", signing_public_key: "p" }
  expect(phraseBeginData.safeParse({ account: "a", hints: [hint] }).success).toBe(true)
  expect(phraseBeginData.safeParse({ account: "a", hints: [hint], typed: "words" }).success).toBe(false)
  expect(phraseBeginData.safeParse({ account: "a", hints: [{ ...hint, typed: "words" }] }).success).toBe(false)
  expect(desktopSyncRequest.safeParse({ op: "recoverBeginPhrase", handle: "h", data: {} }).success).toBe(true)
})

test("#given the shared refusal fixture #when compared with the engine's bridge refusal list #then they are equal", () => {
  const fixture = JSON.parse(
    readFileSync(
      join(import.meta.dir, "../../../../memory-core/src/sync/recovery/fixtures/recover-refusals-v1.json"),
      "utf8",
    ),
  )
  expect(fixture.refusals).toEqual([...RECOVER_REFUSALS])
})

test("#given a service that gates reads on the device switch #when RPC recover succeeds #then both switches are on, the off mark is gone, the engines resume once and a pull answers 200", async () => {
  const world = await enrolledWorld()
  const gate = consent()
  const pinDir = freshStateDir()
  await disableSync({
    account: world.account,
    serviceDeviceId: "svc-fresh",
    pinDir,
    pairing: {
      ...createPairingHttp({ baseUrl: "https://unused.invalid", token: () => "" }),
      disableDeviceSync: async () => ({ ok: true }),
    },
  })
  expect(gate.pull()).toBe(403)
  const rpc = await recoverHarness({ world, gate, pinDir, main: (device) => fakeMain(device, [ENROLLED.join(" ")]) })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recovered", sync: "on" })
  expect(gate.state).toEqual({ account: true, device: true })
  expect(await isDeviceSyncOff(pinDir, world.account)).toBe(false)
  expect(rpc.resumes()).toBe(1)
  expect(gate.pull()).toBe(200)
})

test("#given recovery succeeds but the device switch call fails #when RPC recover answers #then it is recovered with sync off, nothing resumes, and enable is the next step", async () => {
  const world = await enrolledWorld()
  const rpc = await recoverHarness({
    world,
    gate: consent(true),
    main: (device) => fakeMain(device, [ENROLLED.join(" ")]),
  })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recovered", sync: "off" })
  expect(rpc.resumes()).toBe(0)
  expect(rpc.warnings.some((line) => line.includes("switch_failed"))).toBe(true)
})

test("#given a recovery whose device switch failed #when enable runs next over RPC #then it answers joined, both switches are on and a pull answers 200 (D12 test 13)", async () => {
  const world = await enrolledWorld()
  const gate = consent(true)
  const rpc = await recoverHarness({ world, gate, main: (device) => fakeMain(device, [ENROLLED.join(" ")]) })
  expect(await rpc.call("recover", { method: "phrase" })).toEqual({ kind: "recovered", sync: "off" })
  gate.control.failDevice = false
  expect(await rpc.call("enable", {})).toMatchObject({ kind: "joined" })
  expect(gate.state).toEqual({ account: true, device: true })
  expect(gate.pull()).toBe(200)
})
