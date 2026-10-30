import { expect, test } from "bun:test"
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import { readOwnerLiveness, writeOwnerMarker, type OwnerProbe } from "./owner"
import { fixture } from "./test-fixture"

const now = 2_000_000
const dead: OwnerProbe = { pidAlive: () => "dead" }
async function marked(name = "t0123456789", child?: object, host = hostname()) {
  const { root } = await fixture()
  const base = join(root, name)
  await mkdir(base)
  await writeFile(join(base, ".omo-isolation-owner.json"), JSON.stringify({
    id: "id", hostname: host, created_at: 0,
    host: { pid: 101, start_identity: "proc-start-epoch:10" },
    ...(child ? { child } : {}),
  }))
  await utimes(base, 0, 0)
  return base
}
test("dead host is dead", async () => {
  expect(await readOwnerLiveness(await marked(), dead, now)).toBe("dead")
})
test("recycled host start identity is passed to the probe and rejected", async () => {
  const probe: OwnerProbe = {
    pidAlive: (pid, identity) => pid === 101 && identity === "proc-start-epoch:20" ? "alive" : "dead",
  }
  expect(await readOwnerLiveness(await marked(), probe, now)).toBe("dead")
})
test.each([["old", 0, "reclaimable"], ["young", now, "creating"]] as const)(
  "malformed %s marker obeys the grace period", async (_label, mtime, result) => {
    const base = await marked()
    await writeFile(join(base, ".omo-isolation-owner.json"), "{")
    await utimes(base, mtime / 1000, mtime / 1000)
    expect(await readOwnerLiveness(base, dead, now)).toBe(result)
  },
)
test("missing marker is only reclaimable after grace", async () => {
  const { root } = await fixture()
  const base = join(root, "t0123456789")
  await mkdir(base)
  await utimes(base, now / 1000, now / 1000)
  expect(await readOwnerLiveness(base, dead, now)).toBe("creating")
  await utimes(base, 0, 0)
  expect(await readOwnerLiveness(base, dead, now)).toBe("reclaimable")
})
test("foreign host is never probed", async () => {
  expect(await readOwnerLiveness(await marked(undefined, undefined, "foreign.example"), {
    pidAlive: () => { throw new Error("must not probe foreign pid") },
  }, now)).toBe("foreign")
})
test("retained directory is never probed", async () => {
  expect(await readOwnerLiveness(await marked("t0123456789.retained-1-ab"), {
    pidAlive: () => { throw new Error("must not probe retained owner") },
  }, now)).toBe("retained")
})
test("young creating directory with dead owner stays creating", async () => {
  const base = await marked("t0123456789.creating-101")
  await utimes(base, now / 1000, now / 1000)
  expect(await readOwnerLiveness(base, dead, now)).toBe("creating")
})
test("old creating directory with alive owner stays creating", async () => {
  expect(await readOwnerLiveness(await marked("t0123456789.creating-101"), {
    pidAlive: () => "alive",
  }, now)).toBe("creating")
})
test("old creating directory with dead owner becomes reclaimable", async () => {
  expect(await readOwnerLiveness(await marked("t0123456789.creating-101"), dead, now)).toBe("reclaimable")
})
test("live process child preserves a dead host tree", async () => {
  expect(await readOwnerLiveness(await marked(undefined, {
    kind: "process", pid: 202, start_identity: "proc-start-epoch:30",
  }), { pidAlive: (pid) => pid === 202 ? "alive" : "dead" }, now)).toBe("live")
})
test.each([["alive", "live"], ["unknown", "unknown"], ["dead", "dead"]] as const)(
  "host-session %s with dead host returns %s", async (state, expected) => {
    const base = await marked(undefined, { kind: "host-session", socket: "/socket", session_path: "/session" })
    expect(await readOwnerLiveness(base, {
      pidAlive: () => "dead",
      hostSessionAlive: async (socket, session) => {
        expect([socket, session]).toEqual(["/socket", "/session"])
        return state
      },
    }, now)).toBe(expected)
  },
)
test("missing host-session probe is unknown, never dead", async () => {
  expect(await readOwnerLiveness(await marked(undefined, {
    kind: "host-session", socket: "/socket", session_path: "/session",
  }), dead, now)).toBe("unknown")
})
test("unknown pid ownership wins over old age", async () => {
  expect(await readOwnerLiveness(await marked("t0123456789.creating-101"), {
    pidAlive: () => "unknown",
  }, now)).toBe("unknown")
})
test("records host and child identities separately", async () => {
  const { root } = await fixture()
  await writeOwnerMarker(root, "task", {
    host: { pid: 101 }, child: { kind: "process", pid: 202 },
  }, async (pid) => `test:${pid}`)
  const marker = JSON.parse(await readFile(join(root, ".omo-isolation-owner.json"), "utf8"))
  expect(marker.host).toEqual({ pid: 101, start_identity: "test:101" })
  expect(marker.child).toEqual({ kind: "process", pid: 202, start_identity: "test:202" })
})
