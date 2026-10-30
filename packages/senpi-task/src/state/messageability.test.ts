import { describe, expect, test } from "bun:test"

import { messageability } from "./messageability"
import type { HostSessionIdentity } from "./types"

describe("host-session record messageability", () => {
  const hostSession: HostSessionIdentity = {
    socket: "/tmp/omo-agent/rpc/rpc.sock",
    routing_id: "routing-12345",
    session_path: "01a0815e-session-path",
    instance_id: "inst-uuid-001",
  }

  test("terminal rpc_detached host-session with reachable daemon is revive", () => {
    expect(
      messageability("completed", "rpc_detached", "process", false, "host-session", hostSession, () => true),
    ).toBe("revive")
    expect(
      messageability("error", "rpc_detached", "process", false, "host-session", hostSession, () => true),
    ).toBe("revive")
    expect(
      messageability("interrupted", "rpc_detached", "process", false, "host-session", hostSession, () => true),
    ).toBe("revive")
  })

  // SPEC CHANGE (todo 32, "PARKED children stay reachable"): an rpc_detached host-session record is
  // a PARKED session, not a live process - the daemon evicted it or died mid-turn. Reopening it
  // from its transcript and delivering is exactly what retaining it is for, so `running` is revive
  // here. A `pending` child was never opened, so it still has nothing to reopen.
  test("running rpc_detached host-session with a reachable daemon is revive", () => {
    expect(
      messageability("running", "rpc_detached", "process", false, "host-session", hostSession, () => true),
    ).toBe("revive")
  })

  test("pending rpc_detached host-session is not-continuable", () => {
    expect(
      messageability("pending", "rpc_detached", "process", false, "host-session", hostSession, () => true),
    ).toBe("not-continuable")
  })

  test("killed terminal host-session is not-continuable", () => {
    expect(
      messageability("error", "rpc_detached", "process", true, "host-session", hostSession, () => true),
    ).toBe("not-continuable")
  })

  test("terminal host-session with unreachable daemon is not-continuable", () => {
    expect(
      messageability("completed", "rpc_detached", "process", false, "host-session", hostSession, () => false),
    ).toBe("not-continuable")
  })

  test("terminal host-session with old instance_id is still revive (keyed on session_path)", () => {
    const hostSessionWithOldInstance: HostSessionIdentity = {
      ...hostSession,
      instance_id: "old-instance-uuid",
    }

    expect(
      messageability(
        "completed",
        "rpc_detached",
        "process",
        false,
        "host-session",
        hostSessionWithOldInstance,
        () => true,
      ),
    ).toBe("revive")
  })

  test("child-process runner rpc_detached terminal record is revive (legacy)", () => {
    expect(messageability("completed", "rpc_detached", "process", false, "child-process")).toBe("revive")
    expect(messageability("error", "rpc_detached", "process", false, "child-process")).toBe("revive")
  })
})
