import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { installMonitorTargetResolution, type MonitorTargetResolution } from "./monitor-target"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

// This device ("here") holds `dur-local` ("local peer"); device b, listed as "studio", runs `dur-on-b`.
const resolve = async (target: string, options: Parameters<typeof account>[0] = {}) =>
  await surface(account(options).remote).monitorTarget(target)

const refusedCode = (resolution: MonitorTargetResolution): string | undefined =>
  resolution.kind === "refused" ? resolution.failure.code : undefined

describe("monitor rpc target addressing (#14294): the address thread_send takes", () => {
  test("#given a thread running on another device #when the target is its bare thread id #then it names that device's id", async () => {
    expect(await resolve("dur-on-b")).toEqual({ kind: "target", target: "b/dur-on-b" })
  })

  test("#given device b listed as studio #when the target is <device name>/<thread> #then it is the same target as <device id>/<thread>", async () => {
    expect(await resolve("studio/dur-on-b")).toEqual({ kind: "target", target: "b/dur-on-b" })
    expect(await resolve("b/dur-on-b")).toEqual({ kind: "keep" })
    expect(await resolve("studio/*")).toEqual({ kind: "target", target: "b/*" })
  })

  test("#given a thread on this device #when the target is its name #then it is the thread id senpi's local watch matches", async () => {
    expect(await resolve("local peer")).toEqual({ kind: "target", target: "dur-local" })
    expect(await resolve("dur-local")).toEqual({ kind: "keep" })
  })

  test("#given senpi's own local forms #when they are the target #then they pass through untouched", async () => {
    for (const target of ["children", "all", "st_0123abcd", "/tmp/a/session.jsonl", "./rel/x.jsonl"])
      expect(await resolve(target)).toEqual({ kind: "keep" })
  })

  test("#given a target no device lists #when it is armed #then the refusal is typed not_found, never an empty watch", async () => {
    expect(refusedCode(await resolve("no-such-thread-anywhere"))).toBe("not_found")
    expect(refusedCode(await resolve("nowhere/dur-on-b"))).toBe("not_found")
  })

  test("#14477: a timed-out probe keeps its reason when the monitor refuses a bare thread id", async () => {
    expect(
      await resolve("0195f0c2-1a2b-7c3d-8e4f-00000000a003", { wakeFeature: true, lookupTimeouts: ["b"] }),
    ).toMatchObject({
      kind: "refused",
      failure: { code: "host_unavailable", details: { device_reasons: { b: "lookup_timeout" } } },
    })
  })

  test("#given device b offline #when either form names its thread #then the refusal is device_offline", async () => {
    expect(refusedCode(await resolve("studio/dur-on-b", { online: false }))).toBe("device_offline")
    expect(refusedCode(await resolve("dur-on-b", { online: false }))).toBe("device_offline")
  })

  test("#given two devices share the name studio #when <device name>/<thread> names it #then the refusal is ambiguous_target", async () => {
    const twins = { devices: [{ device: "c", label: "studio", online: true }] }
    expect(refusedCode(await resolve("studio/dur-on-b", twins))).toBe("ambiguous_target")
  })
})

describe("monitor rpc target addressing (#14294): the tool_call hook", () => {
  function hooked(resolution: MonitorTargetResolution, remoteWakeSeam = true) {
    const seen: string[] = []
    let handler: ((event: unknown, ctx?: unknown) => unknown) | undefined
    installMonitorTargetResolution(
      {
        on: (event, registered) => {
          if (event === "tool_call") handler = registered
        },
        ...(remoteWakeSeam ? { registerRpcRemoteSource: () => undefined } : {}),
      },
      async (target) => {
        seen.push(target)
        return resolution
      },
    )
    if (handler === undefined) throw new Error("no tool_call handler was installed")
    return { handler, seen }
  }

  test("#given a resolvable rpc target #when monitor is called #then the call's target is rewritten before it runs", async () => {
    const { handler } = hooked({ kind: "target", target: "b/dur-on-b" })
    const input: Record<string, unknown> = { type: "rpc", target: "studio/dur-on-b", description: "watch b" }
    expect(await handler({ toolName: "monitor", input })).toBeUndefined()
    expect(input["target"]).toBe("b/dur-on-b")
  })

  test("#given an engine without the remote-wake seam #when a bare id resolves to a thread on another device #then the call is refused remote_wake_unavailable, never armed", async () => {
    const { handler } = hooked({ kind: "target", target: "b/dur-on-b" }, false)
    const input: Record<string, unknown> = { type: "rpc", target: "dur-on-b", description: "watch b" }
    const result = (await handler({ toolName: "monitor", input })) as { block?: boolean; reason?: string }
    expect([result.block, result.reason?.split(":")[0], input["target"]]).toEqual([
      true,
      "remote_wake_unavailable",
      "dur-on-b",
    ])
  })

  test("#given an unresolvable rpc target #when monitor is called #then the call is blocked with the typed reason", async () => {
    const { handler } = hooked({
      kind: "refused",
      failure: { code: "not_found", message: "No thread is named x.", next_action: "List threads." },
    })
    const result = (await handler({ toolName: "monitor", input: { target: "x", description: "d" } })) as {
      block?: boolean
      reason?: string
    }
    expect(result.block).toBe(true)
    expect(result.reason?.startsWith("not_found:")).toBe(true)
  })

  test("#given calls that arm no rpc watch #when they run #then the resolver is never asked", async () => {
    const { handler, seen } = hooked({ kind: "target", target: "never" })
    for (const event of [
      { toolName: "bash", input: { target: "x" } },
      { toolName: "monitor", input: { type: "command", command: "true", description: "d" } },
      { toolName: "monitor", input: { action: "stop", target: "x" } },
      { toolName: "monitor", input: { type: "rpc", target: 7 } },
    ])
      expect(await handler(event)).toBeUndefined()
    expect(seen).toEqual([])
  })
})
