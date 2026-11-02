import { expect, test } from "bun:test"
import { access, mkdir, symlink, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import { sweepStaleIsolations } from "./sweep"
import { backend, fixture } from "./test-fixture"

test("sweep stops dead backends, retains live/foreign/unknown/retained and skips symlinks", async () => {
  const { root, repoRoot } = await fixture()
  const sweepRoot = join(root, "wt")
  await mkdir(sweepRoot)
  const kinds = ["dead", "live", "foreign", "unknown", "retained"] as const
  for (const [i, kind] of kinds.entries()) {
    const name = `t${String(i).padStart(10, "0")}${kind === "retained" ? ".retained-1-x" : ""}`
    const base = join(sweepRoot, name)
    await mkdir(join(base, "m"), { recursive: true })
    await writeFile(join(base, ".omo-isolation-owner.json"), JSON.stringify({
      id: kind, hostname: kind === "foreign" ? "foreign.example" : hostname(), created_at: 0,
      host: { pid: i + 1, start_identity: null },
    }))
    await writeFile(join(base, ".omo-isolation-backend.json"), JSON.stringify({ backend: "rcopy" }))
  }
  await symlink(repoRoot, join(sweepRoot, "t9999999999"), "dir")
  const stopped: string[] = []
  const result = await sweepStaleIsolations([sweepRoot], {
    probe: { pidAlive: (pid) => pid === 2 ? "alive" : pid === 4 ? "unknown" : "dead" },
    backends: [backend({ stop: async (merged) => { await access(merged); stopped.push(merged) } })],
  })
  expect(result.reclaimed).toEqual([join(sweepRoot, "t0000000000")])
  expect(stopped).toEqual([join(sweepRoot, "t0000000000/m")])
  expect(result.kept).toHaveLength(4)
  expect(result.skipped).toEqual([{ path: join(sweepRoot, "t9999999999"), reason: "not a directory" }])
  await access(repoRoot)
})
test("sweep keeps dead trees when backend teardown fails", async () => {
  const { root } = await fixture()
  const base = join(root, "t0123456789")
  await mkdir(base)
  await writeFile(join(base, ".omo-isolation-owner.json"), JSON.stringify({
    id: "dead", hostname: hostname(), created_at: 0, host: { pid: 1, start_identity: null },
  }))
  await writeFile(join(base, ".omo-isolation-backend.json"), JSON.stringify({ backend: "rcopy" }))
  const result = await sweepStaleIsolations([root], {
    probe: { pidAlive: () => "dead" },
    backends: [backend({ stop: async () => { throw new Error("unmount denied") } })],
  })
  expect(result.reclaimed).toEqual([])
  expect(result.skipped.some((entry) => entry.path === base && entry.reason.includes("unmount denied"))).toBe(true)
  await access(base)
})

test("sweep reports nothing for a root that does not exist", async () => {
  const { root } = await fixture()
  const result = await sweepStaleIsolations([join(root, "absent")], {
    probe: { pidAlive: () => "dead" },
    backends: [],
  })
  expect(result).toEqual({ reclaimed: [], kept: [], skipped: [] })
})
