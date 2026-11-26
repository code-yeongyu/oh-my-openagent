import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { gatewayInboxDirectory } from "./gateway/paths"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHostSession } from "./tools"

/**
 * A free plan (no relay on the account) messaging a same-device thread in ANOTHER project's workspace - the Desktop
 * topology: one machine, one agent dir, several project folders. That send is not cross-device, so no answer may read
 * as one: resolution answers for a thread this device holds before the relay leg can speak, and the paid-plan refusal
 * stays what it was for addresses this device cannot hold (A5).
 */
describe("a free plan messaging a same-device thread in another workspace", () => {
  const fixture = createRemoteThreadFixture()
  const projects: string[] = []

  afterEach(async () => {
    await fixture.cleanup()
    for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function freePlan() {
    const a = fixture.account({ plan: "plan_required" })
    const otherProject = mkdtempSync(join(tmpdir(), "thread-other-project-"))
    projects.push(otherProject)
    const other: ThreadHostSession = {
      sessionId: "route-other",
      durableSessionId: "dur-other",
      cwd: otherProject,
      name: "site build",
      status: "open",
    }
    return { a, ...fixture.surface(a.remote, { sessions: [other] }) }
  }

  const nextAction = (result: unknown): string =>
    typeof result === "object" && result !== null && "error" in result
      ? String(((result as { readonly error?: { readonly next_action?: string } }).error ?? {}).next_action ?? "")
      : ""

  test("#given a plan with no relay #when a scoped thread_send names a same-device thread from another workspace #then the answer is scope_denied naming all_scope, never a paid-plan refusal, and nothing leaves this device", async () => {
    const { a, run, enqueuedFor } = freePlan()
    const result = await run("thread_send", { thread: "site build", message: "ping" })
    expect(result).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(nextAction(result)).toContain("all_scope")
    expect(a.sent).toEqual([])
    expect(enqueuedFor("dur-other")).toBe(0)
  })

  test("#given the same plan #when the send widens with all_scope #then the same name delivers on this device through the local transport, with no relay round trip", async () => {
    const { a, run, prompts, enqueuedFor, agentDir } = freePlan()
    const result = await run("thread_send", { thread: "site build", message: "ping", all_scope: true })
    expect(result).toMatchObject({ kind: "ok", thread: "dur-other", deduplicated: false })
    expect(enqueuedFor("dur-other")).toBe(1)
    expect(existsSync(gatewayInboxDirectory(agentDir, "dur-other"))).toBe(true)
    expect(prompts()).toBe(0)
    expect(a.sent).toEqual([])
  })

  test("#given the same plan #when thread_list widens with all_scope #then this device's other-workspace thread is listed and remote_unavailable still carries the paid-plan notice", async () => {
    const { run } = freePlan()
    const listed = await run("thread_list", { all_scope: true })
    expect(listed).toMatchObject({ kind: "ok", remote_unavailable: "relay_requires_paid_plan" })
    expect(listed.kind === "ok" && "threads" in listed ? listed.threads.map((thread) => thread.thread) : []).toEqual([
      "dur-other",
    ])
  })

  test("#given the same plan #when a scoped thread_send names a thread that exists nowhere #then the paid-plan refusal still answers, as it does for an id no device here holds (A5)", async () => {
    const { a, run } = freePlan()
    const result = await run("thread_send", { thread: "no such lane", message: "ping" })
    expect(result).toMatchObject({ kind: "error", error: { code: "relay_requires_paid_plan" } })
    expect(a.sent).toEqual([])
  })

  test("#given a configured relay that is failing (connecting) #when a scoped send names nothing on this device #then the typed host_unavailability still answers before not_found", async () => {
    const a = fixture.account({ plan: "connecting" })
    const surface = fixture.surface(a.remote)
    const result = await surface.run("thread_send", { thread: "no such lane", message: "ping" })
    expect(result).toMatchObject({ kind: "error", error: { code: "host_unavailable" } })
  })

  test("#given the free plan #when a scoped send addresses the other-workspace thread by its durable id #then the id ladder's scope_denied stands with its all_scope recovery", async () => {
    const { a, run, enqueuedFor } = freePlan()
    const result = await run("thread_send", { thread: "dur-other", message: "ping" })
    expect(result).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(nextAction(result)).toContain("all_scope")
    expect(a.sent).toEqual([])
    expect(enqueuedFor("dur-other")).toBe(0)
  })

  test("#given the free plan #when the all_scope retry sends by the durable id #then it too delivers on this device", async () => {
    const { a, run, enqueuedFor } = freePlan()
    const result = await run("thread_send", { thread: "dur-other", message: "ping", all_scope: true })
    expect(result).toMatchObject({ kind: "ok", thread: "dur-other" })
    expect(enqueuedFor("dur-other")).toBe(1)
    expect(a.sent).toEqual([])
  })
})
