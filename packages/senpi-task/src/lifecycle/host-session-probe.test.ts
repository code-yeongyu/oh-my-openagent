import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HostSessionIdentity } from "../state"
import { createHostSessionProbe } from "./host-session"

const SOCKET = "/tmp/dh-fake/rpc.sock"

function identity(sessionPath: string): HostSessionIdentity {
  return { socket: SOCKET, routing_id: "routing", session_path: sessionPath, instance_id: "instance-1" }
}

function countingPorts(livePaths: readonly string[]) {
  const calls = { probes: 0, lists: 0 }
  return {
    calls,
    ports: {
      daemonReachable: () => {
        calls.probes += 1
        return Promise.resolve(true)
      },
      liveSessionPaths: () => {
        calls.lists += 1
        return Promise.resolve(livePaths)
      },
    },
  }
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("host session probe", () => {
  test("#given a child recorded under a symlinked project path #when the daemon lists the canonical path #then the session reads as live (#8932)", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "dh-probe-"))
    roots.push(root)
    const project = join(root, "real-project")
    mkdirSync(join(project, "children"), { recursive: true })
    symlinkSync(project, join(root, "linked-project"), "junction")
    const recorded = join(root, "linked-project", "children", "child.jsonl")
    const listed = join(realpathSync(project), "children", "child.jsonl")
    const probe = createHostSessionProbe(countingPorts([listed]).ports)

    // when
    const live = await probe.sessionLive(identity(recorded))

    // then
    expect(live).toBe(true)
  })

  test("#given many records on one daemon #when a reconcile pass asks about each of them #then the daemon is probed and listed exactly once", async () => {
    // given
    const { calls, ports } = countingPorts(["/a.jsonl", "/b.jsonl"])
    const probe = createHostSessionProbe(ports)

    // when
    const answers = await Promise.all([
      probe.sessionLive(identity("/a.jsonl")),
      probe.sessionLive(identity("/b.jsonl")),
      probe.sessionLive(identity("/c.jsonl")),
      probe.daemonAlive(identity("/a.jsonl")),
    ])

    // then
    expect(answers).toEqual([true, true, false, true])
    expect(calls).toEqual({ probes: 1, lists: 1 })
  })

  test("#given a probed pass #when the next pass refreshes #then the daemon is asked again", async () => {
    // given
    const { calls, ports } = countingPorts([])
    const probe = createHostSessionProbe(ports)
    await probe.daemonAlive(identity("/a.jsonl"))

    // when
    probe.refresh()
    await probe.daemonAlive(identity("/a.jsonl"))

    // then
    expect(calls).toEqual({ probes: 2, lists: 2 })
  })

  test("#given a daemon that does not answer #when liveness is asked #then nothing is live and the failure is not thrown at the caller", async () => {
    // given
    const probe = createHostSessionProbe({
      daemonReachable: () => Promise.reject(new Error("ECONNREFUSED")),
      liveSessionPaths: () => Promise.reject(new Error("ECONNREFUSED")),
    })

    // when
    const alive = await probe.daemonAlive(identity("/a.jsonl"))
    const live = await probe.sessionLive(identity("/a.jsonl"))

    // then
    expect(alive).toBe(false)
    expect(live).toBe(false)
  })
})
