import { expect, test } from "bun:test"
import { join } from "node:path"
import { fixture } from "../test-fixture"
import { ReflinkBackend } from "./reflink"
import { isAtOrBelow } from "./copy-tree"
import { runtime, type BackendRuntime } from "./runtime"

function linuxIo(observe: (argv: string[], path: string) => void): BackendRuntime {
  return {
    ...runtime, platform: "linux" as const, which: () => true,
    device: async (path) => { observe([], path); return 1 },
    run: async (argv) => { observe(argv, argv[4] ?? ""); return { code: 0, stdout: "", stderr: "" } },
    accessible: async () => true, mounted: async () => false, waitMounted: async () => {},
  }
}

test("reflink probing writes only inside the supplied context base directory", async () => {
  const f = await fixture()
  const seen: { paths: string[]; cpDestinations: string[] } = { paths: [], cpDestinations: [] }
  const io = linuxIo((argv, path) => {
    if (argv.length) seen.cpDestinations.push(path)
    else seen.paths.push(path)
  })
  const ctx = { id: "probe", baseDir: join(f.root, "wt", "t1"), crossDevice: false }
  const backend = new ReflinkBackend(io, async () => undefined)
  expect((await backend.probe(f.repoRoot, ctx)).available).toBe(true)
  // Every path the probe touched other than the source itself must be the context
  // base directory or inside it; the nearest existing ancestor is a violation.
  const violations = [...seen.paths, ...seen.cpDestinations].filter((p) =>
    p !== f.repoRoot && p !== ctx.baseDir && !isAtOrBelow(p, ctx.baseDir))
  expect(violations).toEqual([])
})

test("reflink probing without a context stays read-only instead of writing into the source", async () => {
  const f = await fixture()
  const calls: string[][] = []
  const io = linuxIo((argv) => { if (argv.length) calls.push(argv) })
  const backend = new ReflinkBackend(io, async () => undefined)
  const probe = await backend.probe(f.repoRoot)
  expect(probe.available).toBe(false)
  expect(calls).toEqual([])
})
