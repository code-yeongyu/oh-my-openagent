import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const failure = (result: unknown) =>
  (result as { error?: { code: string; next_action: string; details?: object } }).error

describe("thread_create: the folder a new thread starts in", () => {
  test("#given a relative cwd #when the thread is created on this device #then it starts in that folder under the caller's folder", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    expect(await run("thread_create", { cwd: "packages" })).toMatchObject({ kind: "ok" })
    expect(openSession.mock.calls.map((call) => call[0])).toEqual([{ cwd: join(process.cwd(), "packages") }])
  })

  test("#given a cwd that does not exist #when the thread is created on this device #then invalid_arguments folder_missing and nothing opens", async () => {
    const a = account()
    const { run, openSession } = surface(a.remote)
    const result = await run("thread_create", { cwd: join(process.cwd(), "no-such-folder-here") })
    expect(failure(result)).toMatchObject({ code: "invalid_arguments", details: { reason: "folder_missing" } })
    expect(openSession).not.toHaveBeenCalled()
  })

  test("#given a relative cwd #when the thread is created on device b #then invalid_arguments relative_path and nothing reaches b", async () => {
    const a = account()
    const { run } = surface(a.remote)
    const result = await run("thread_create", { device: "studio", cwd: "sub/dir" })
    expect(failure(result)).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "relative_path", device: "b" },
    })
    expect(a.sent).toEqual([])
  })

  test("#given b has no such folder #when the thread is created there #then b's missing_session_cwd answers invalid_arguments folder_missing naming b, not an omo update", async () => {
    const a = account({ refuse: "missing_session_cwd" })
    const { run } = surface(a.remote)
    const result = await run("thread_create", { device: "studio", cwd: "/no/such/folder" })
    expect(failure(result)).toMatchObject({
      code: "invalid_arguments",
      details: { reason: "folder_missing", device: "b", path: "/no/such/folder" },
    })
  })

  test("#given a Windows absolute cwd #when the thread is created on device b #then it is passed to b unchanged", async () => {
    const a = account()
    const { run } = surface(a.remote)
    expect(await run("thread_create", { device: "studio", cwd: "C:\\work\\repo" })).toMatchObject({ kind: "ok" })
    expect(a.sent[0]?.rpc).toMatchObject({ type: "open_session", cwd: "C:\\work\\repo" })
  })

  test.each([
    ["an unknown device", "nope", {}, "not_found"],
    ["an offline device", "studio", { online: false }, "device_offline"],
    ["no relay connection", "studio", { plan: "disconnected" }, "host_unavailable"],
    ["a plan without relay", "studio", { plan: "plan_required" }, "relay_requires_paid_plan"],
    ["a device that never answers", "studio", { refuse: "request_timeout" }, "host_unavailable"],
  ] as const)(
    "#given %s #when thread_create names it #then a typed code with a next_action, never internal_error",
    async (_label, device, options, code) => {
      const a = account(options)
      const { run, openSession } = surface(a.remote)
      const error = failure(await run("thread_create", { device }))
      expect(error).toMatchObject({ code })
      expect(error?.next_action.length).toBeGreaterThan(0)
      expect(openSession).not.toHaveBeenCalled()
    },
  )
})
