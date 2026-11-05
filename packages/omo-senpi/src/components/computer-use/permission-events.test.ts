import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { FakeExtensionAPI, enableFakeExtensionEvents } from "../../../test-support/fake-extension-api"
import type { ComputerPermissionScope, wireComputerPermissionEvents } from "./permission-events"

// O12 (brain/hand split): a hand opens one loopless runtime per execution scope. That runtime gets no
// session_start, has no transcript to append a marker to, and its session ancestry is not the caller's,
// so a denial raised there is reported from the scope's own identity.
const logger = { info() {}, warn() {}, error() {} }
const EVENT = "omo.computer.permission_required"

class HandScopeApi extends FakeExtensionAPI {
  readonly entries: unknown[] = []
  readonly report: ReturnType<typeof wireComputerPermissionEvents>
  constructor(
    scope: ComputerPermissionScope,
    wire: typeof wireComputerPermissionEvents,
    env: NodeJS.ProcessEnv = {},
  ) {
    super()
    this.rpc = { emit: (name, data) => { this.rpcEvents.push({ name, data }) } }
    enableFakeExtensionEvents(this)
    this.report = wire(this, env, logger, scope)
  }
  appendEntry(customType: string, data: unknown): void {
    this.entries.push({ customType, data })
  }
}

async function freshWire(): Promise<typeof wireComputerPermissionEvents> {
  const module: typeof import("./permission-events") = await import(`./permission-events.ts?generation=${crypto.randomUUID()}`)
  return module.wireComputerPermissionEvents
}

function handScope(): ComputerPermissionScope {
  return { scopeId: `scope-${crypto.randomUUID()}`, rootOwner: `root-${crypto.randomUUID()}` }
}

describe("OS-permission reporting from a hand's execution scope (O12)", () => {
  test("#given a hand scope that never saw session_start #when the device denies screen recording #then the owning session gets one report correlated by scope and root owner, with no marker written", async () => {
    // given
    const scope = handScope()
    const pi = new HandScopeApi(scope, await freshWire())
    // when
    pi.report({ permission: "screen_recording", app: "Test App" })
    pi.report({ permission: "screen_recording", app: "Test App" })
    // then
    expect(pi.rpcEvents).toEqual([{
      name: EVENT,
      data: { session_id: scope.rootOwner, scope_id: scope.scopeId, permission: "screen_recording", app: "Test App" },
    }])
    expect(pi.entries).toEqual([])
  })

  test("#given a hand scope whose process carries a task child's ancestry #when the device denies #then the report still goes to the scope's root owner, not to a child forward", async () => {
    // given
    const scope = handScope()
    const pi = new HandScopeApi(scope, await freshWire(), {
      OMO_SENPI_TASK_RPC_CHILD: "1", OMO_SENPI_TASK_ROOT_SESSION_ID: "another-root",
    })
    // when
    pi.report({ permission: "accessibility" })
    // then
    expect(pi.rpcEvents).toEqual([{
      name: EVENT, data: { session_id: scope.rootOwner, scope_id: scope.scopeId, permission: "accessibility" },
    }])
  })

  test("#given a reported denial #when the extension reloads in the same process #then the same (root owner, permission) stays latched and another permission still reports", async () => {
    // given
    const scope = handScope()
    const first = new HandScopeApi(scope, await freshWire())
    first.report({ permission: "screen_recording" })
    // when
    const reloaded = new HandScopeApi(scope, await freshWire())
    reloaded.report({ permission: "screen_recording" })
    reloaded.report({ permission: "accessibility" })
    // then
    expect([...first.rpcEvents, ...reloaded.rpcEvents]).toEqual(["screen_recording", "accessibility"].map((permission) => ({
      name: EVENT, data: { session_id: scope.rootOwner, scope_id: scope.scopeId, permission },
    })))
  })

  test("MULTI #given two execution scopes of different owners on one hand #when both are denied the same permission #then each owner gets its own report and neither suppresses nor sees the other's", async () => {
    // given
    const wire = await freshWire()
    const scopeA = handScope()
    const scopeB = handScope()
    const a = new HandScopeApi(scopeA, wire)
    const b = new HandScopeApi(scopeB, wire)
    // when
    a.report({ permission: "screen_recording" })
    b.report({ permission: "screen_recording" })
    a.report({ permission: "screen_recording" })
    // then
    expect(a.rpcEvents).toEqual([{
      name: EVENT, data: { session_id: scopeA.rootOwner, scope_id: scopeA.scopeId, permission: "screen_recording" },
    }])
    expect(b.rpcEvents).toEqual([{
      name: EVENT, data: { session_id: scopeB.rootOwner, scope_id: scopeB.scopeId, permission: "screen_recording" },
    }])
  })

  test("#given a hand process that reported a denial #when the scope's owner is denied again in a new hand process #then it is reported again", async () => {
    // given: the latch lives for one process, so a resumed owner after a grant change is prompted again.
    const scope = handScope()
    const script = [
      `import { wireComputerPermissionEvents } from ${JSON.stringify(join(import.meta.dir, "permission-events.ts"))}`,
      "const events = []",
      "const pi = { on() {}, rpc: { emit: (name, data) => { events.push({ name, data }) } } }",
      "const report = wireComputerPermissionEvents(pi, {}, { info() {}, warn() {}, error() {} },",
      "  { scopeId: process.env.O12_SCOPE, rootOwner: process.env.O12_OWNER })",
      "report({ permission: 'screen_recording' })",
      "report({ permission: 'screen_recording' })",
      "console.log(JSON.stringify(events))",
    ].join("\n")
    const run = async () => {
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { PATH: process.env.PATH, O12_SCOPE: scope.scopeId, O12_OWNER: scope.rootOwner },
        stdout: "pipe", stderr: "pipe", timeout: 60_000,
      })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
      return JSON.parse(stdout)
    }
    // when
    const first = await run()
    const second = await run()
    // then
    const once = [{ name: EVENT, data: { session_id: scope.rootOwner, scope_id: scope.scopeId, permission: "screen_recording" } }]
    expect([first, second]).toEqual([once, once])
  }, 120_000)
})
