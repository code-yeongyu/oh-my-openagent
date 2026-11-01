import { afterAll, expect, test } from "bun:test"
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareTrustDirectory } from "../trust-generation"
import { attestUsernsRoots, attestedOverflowRoot, inheritedTrustPaths, readUsernsView, USERNS_ROOTS_ENV } from "../trust-userns"

const NAMESPACED_MAP = "      1000       1000          1\n"
const INITIAL_MAP = "         0          0 4294967295\n"
const proc = (files: Record<string, string>) => (path: string) => {
  const text = files[path]
  if (text === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" })
  return text
}
const sandboxed = proc({ "/proc/self/uid_map": NAMESPACED_MAP, "/proc/sys/kernel/overflowuid": "65534\n" })
const rootInode = { uid: 65534, dev: 64769n, ino: 2n }
const ROOT_ENTRY = JSON.stringify([["/", "64769:2"]])
const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

// Security contract (senpi#5334): an overflow-owned ancestor is root only with every fact below; each other row stays refused.
test.each([
  ["namespaced, overflow uid, attested path and inode", sandboxed, ROOT_ENTRY, "/", rootInode, true],
  ["another user's directory (never attested)", sandboxed, ROOT_ENTRY, "/", { ...rootInode, ino: 3n }, false],
  ["an attested inode reached under another path (overlay inode reuse)", sandboxed, ROOT_ENTRY, "/srv", rootInode, false],
  ["same inode number on another device", sandboxed, ROOT_ENTRY, "/", { ...rootInode, dev: 46n }, false],
  ["a mapped uid that is not the overflow uid", sandboxed, ROOT_ENTRY, "/", { ...rootInode, uid: 1001 }, false],
  ["the initial namespace", proc({ "/proc/self/uid_map": INITIAL_MAP, "/proc/sys/kernel/overflowuid": "65534" }), ROOT_ENTRY, "/", rootInode, false],
  ["an unreadable uid map", proc({ "/proc/sys/kernel/overflowuid": "65534" }), ROOT_ENTRY, "/", rootInode, false],
  ["an unreadable overflow uid", proc({ "/proc/self/uid_map": NAMESPACED_MAP }), ROOT_ENTRY, "/", rootInode, false],
  ["a malformed entry poisons the whole value", sandboxed, JSON.stringify([["/", "64769:2"], ["/home", "x"]]), "/", rootInode, false],
  ["a relative path entry", sandboxed, JSON.stringify([["home", "64769:2"]]), "/", rootInode, false],
  ["more entries than the cap", sandboxed, JSON.stringify(Array.from({ length: 65 }, () => ["/", "64769:2"])), "/", rootInode, false],
  ["the old comma format", sandboxed, "64769:2", "/", rootInode, false],
  ["no attestation", sandboxed, undefined, "/", rootInode, false],
] as const)("#given %s #when the ancestor is judged #then root equivalence matches the table", (_name, read, value, path, stat, expected) => {
  const view = readUsernsView(value === undefined ? {} : { [USERNS_ROOTS_ENV]: value }, read)
  expect(attestedOverflowRoot(view, path, stat)).toBe(expected)
})

test.skipIf(process.platform !== "linux")("#given the launcher in the initial namespace #when it attests a path #then it lists root-owned ancestors by path and nothing user-owned", () => {
  const root = lstatSync("/", { bigint: true })
  const home = process.env.HOME ?? "/"
  const homeStat = lstatSync(home, { bigint: true })
  const attested = JSON.parse(attestUsernsRoots([`${home}/.omo/engine-trust`], proc({ "/proc/self/uid_map": INITIAL_MAP })) ?? "[]") as [string, string][]
  expect(attested).toContainEqual(["/", `${root.dev}:${root.ino}`])
  if (homeStat.uid !== 0n) expect(attested.map(([path]) => path)).not.toContain(home)
})

test("#given a launcher that is itself in a user namespace #when it attests #then it attests nothing", () => {
  expect(attestUsernsRoots(["/"], sandboxed)).toBeUndefined()
})

test("#given an inherited trust marker #when its paths are read #then the generation file and both defaults are attested candidates", () => {
  const marker = JSON.stringify({ v: 1, file: "/var/tmp/omo-engine-trust-a/g.pem", defaults: { file: "/var/tmp/d/empty.pem", dir: "/var/tmp/d/empty.d" } })
  expect(inheritedTrustPaths(marker)).toEqual(["/var/tmp/omo-engine-trust-a/g.pem", "/var/tmp/d/empty.pem", "/var/tmp/d/empty.d"])
  expect(inheritedTrustPaths("not json")).toEqual([])
  expect(inheritedTrustPaths(undefined)).toEqual([])
})

test("#given a non-Linux platform #when an existing private trust directory is prepared #then it is used as before with no read-only probe", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-trust-userns-")))
  roots.push(root)
  const requested = join(root, "engine-trust")
  expect(await prepareTrustDirectory(requested, "darwin")).toEqual({ directory: requested, codes: [] })
})
