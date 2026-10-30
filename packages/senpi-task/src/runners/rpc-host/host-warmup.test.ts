import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { startFakeHost, type FakeHost } from "./__fixtures__/fake-host"
import { HOST_WARMUP_TASK_ID, warmTaskHost } from "./host-warmup"
import { HOST_WARMUP_CONTEXT, isHostWarmupSession } from "./session-role"

const hosts: FakeHost[] = []
const roots: string[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function world(options: Parameters<typeof startFakeHost>[0] = {}) {
  const host = await startFakeHost({ enforceSessionDir: true, ...options })
  hosts.push(host)
  const tempRoot = mkdtempSync(join(tmpdir(), "omo-warmup-test-"))
  roots.push(tempRoot)
  const warm = () =>
    warmTaskHost({
      socket: host.socketPath,
      cwd: "/tmp/parent-cwd",
      tempRoot,
      ports: { probeProtocolInfo: () => host.probeProtocolInfo() },
    })
  const of = (type: string) => host.commands.filter((command) => command.type === type)
  return { host, tempRoot, warm, of }
}

function childWarmContext(stateDir: string) {
  return { role: "child", task_id: HOST_WARMUP_TASK_ID, state_dir: stateDir, [HOST_WARMUP_CONTEXT]: "1" }
}

describe("warmTaskHost", () => {
  test("#given a current host #when it is warmed #then one child-shaped warm command loads the session services and no session opens", async () => {
    // given
    const w = await world()

    // when
    const outcome = await w.warm()

    // then
    expect(outcome).toBe("warmed")
    const warms = w.of("warm")
    expect(warms).toHaveLength(1)
    const payload = warms[0]?.payload ?? {}
    expect(payload["cwd"]).toBe("/tmp/parent-cwd")
    expect(payload["kind"]).toBe("worker")
    expect(payload["sessionId"]).toBeUndefined()
    const context = payload["context"]
    const stateDir = typeof context === "object" && context !== null && "state_dir" in context ? String(context.state_dir) : ""
    expect(context).toEqual(childWarmContext(stateDir))
    expect(w.of("open_session")).toEqual([])
    expect(readdirSync(w.tempRoot)).toEqual([])
  })

  test("#given a host that already warmed this profile #when it is warmed #then the answer is kept and no session opens", async () => {
    // given
    const w = await world({ warm: { state: "already_warm" } })

    // when
    const outcome = await w.warm()

    // then
    expect(outcome).toBe("already_warm")
    expect(w.of("open_session")).toEqual([])
  })

  test("#given an engine from before the warm command #when it is warmed #then one child-shaped, unretained warm-up session opens and is closed instead", async () => {
    // given
    const w = await world({ warm: { refuse: "missing_session_id" } })

    // when
    const outcome = await w.warm()

    // then
    expect(outcome).toBe("warm_up_session")
    expect(w.of("warm")).toHaveLength(1)
    const opens = w.of("open_session")
    expect(opens).toHaveLength(1)
    const payload = opens[0]?.payload ?? {}
    expect(payload["context"]).toEqual(childWarmContext(dirname(String(payload["sessionPath"]))))
    expect(payload["retain_on_disconnect"]).toBe(false)
    expect(payload["kind"]).toBe("worker")
    expect(w.of("close_session")).toHaveLength(1)
    expect(w.host.sessions()).toEqual([])
    expect(readdirSync(w.tempRoot)).toEqual([])
  })

  test("#given a host whose registry cannot warm #when it is warmed #then it falls back to the warm-up session", async () => {
    // given
    const w = await world({ warm: { state: "unsupported" } })

    // when
    const outcome = await w.warm()

    // then
    expect(outcome).toBe("warm_up_session")
    expect(w.of("open_session")).toHaveLength(1)
    expect(w.host.sessions()).toEqual([])
  })

  test("#given a draining host #when it is warmed #then the refusal reaches the caller and no session is opened on it", async () => {
    // given
    const w = await world({ warm: { refuse: "host_draining" } })

    // when
    const error = await w.warm().then(
      () => undefined,
      (caught: unknown) => caught,
    )

    // then
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("host_draining")
    expect(w.of("open_session")).toEqual([])
    expect(readdirSync(w.tempRoot)).toEqual([])
  })

  test("#given an older host that refuses the fallback open #when it is warmed #then the refusal reaches the caller and nothing is left behind", async () => {
    // given
    const w = await world({ warm: { refuse: "missing_session_id" }, openFailure: { code: "invalid_launch_profile", detail: "refused" } })

    // when
    const outcome = await w.warm().then(
      () => "resolved",
      () => "rejected",
    )

    // then
    expect(outcome).toBe("rejected")
    expect(readdirSync(w.tempRoot)).toEqual([])
    expect(w.host.sessions()).toEqual([])
    await w.host.waitForConnections(0)
  })

  test("#given an ordinary child context #when it is read #then it is not a warm-up session", () => {
    expect(isHostWarmupSession({ sessionContext: { role: "child", task_id: "t-1" } })).toBe(false)
    expect(isHostWarmupSession({ sessionContext: childWarmContext("/tmp/x") })).toBe(true)
    expect(isHostWarmupSession({})).toBe(false)
  })
})
